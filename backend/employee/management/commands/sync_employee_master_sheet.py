"""
employee/management/commands/sync_employee_master_sheet.py
══════════════════════════════════════════════════
Đồng bộ dữ liệu nhân sự từ 1 Google Sheet "master" (sheet vận hành song
song với app HRM, do HR duy trì thủ công) vào Employee.

Quy tắc đã thống nhất:
  - "Sheet luôn thắng": bất kỳ cột nào trong sheet có giá trị sẽ GHI ĐÈ
    giá trị đang có trên Employee tương ứng — kể cả khi giá trị đó vừa
    được sửa tay trong app (không có khái niệm "app mới hơn nên giữ").
  - Ô TRỐNG trong sheet KHÔNG xoá dữ liệu đã có trên HRM (an toàn hơn,
    tránh mất dữ liệu chỉ vì 1 dòng đang sửa dở/lỗi định dạng trên
    sheet). Nếu cần xoá 1 field thật sự, phải sửa trực tiếp trong app.
  - Khớp nhân viên theo mã NV (employee_id) — dùng đúng cột mapping với
    tính năng "Nhập từ file" đã có (Quản lý nhân viên).
  - Nhân viên có mã trong sheet nhưng CHƯA tồn tại trong HRM: CHỈ báo
    cáo (not_found), KHÔNG tự tạo mới — tránh tạo nhầm tài khoản/hồ sơ
    thiếu thông tin từ 1 dòng nháp/lỗi trên sheet; HR tự onboard qua app
    như bình thường.
  - Nhân viên đang có trong HRM nhưng KHÔNG còn trong sheet: KHÔNG đụng
    tới (không tự nghỉ việc/xoá) — sync này chỉ cập nhật, không dọn dẹp.

Cấu hình (biến môi trường — xem .env.example):
  GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE   đường dẫn file JSON key của
                                        Service Account (đã được share
                                        quyền Viewer trên sheet)
  EMPLOYEE_MASTER_SHEET_ID             ID của sheet (đoạn giữa /d/ và
                                        /edit trong URL)
  EMPLOYEE_MASTER_SHEET_RANGE          tên tab + range, VD:
                                        "Nhân sự!A1:ZZ" (mặc định:
                                        "A1:ZZ" — tab đầu tiên)

Cách dùng:
  python manage.py sync_employee_master_sheet --dry-run
  python manage.py sync_employee_master_sheet

Không cài thêm dependency nào — google-api-python-client và google-auth
đã có sẵn trong requirements.txt (đang dùng cho tích hợp Gmail).
"""

import logging

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from employee.import_serializers import process_row, map_columns, _normalize_col
from employee.models import Employee, Department, Position, CompanyUnit

logger = logging.getLogger(__name__)


def _fetch_sheet_dataframe():
    """Đọc toàn bộ sheet (dòng 1 = header) thành pandas.DataFrame (mọi ô ở
    dạng string, giống cách file CSV import đang đọc — để tái dùng nguyên
    logic parse của process_row())."""
    import pandas as pd
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError

    sa_file = getattr(settings, 'GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE', None)
    sheet_id = getattr(settings, 'EMPLOYEE_MASTER_SHEET_ID', None)
    sheet_range = getattr(settings, 'EMPLOYEE_MASTER_SHEET_RANGE', None) or 'A1:ZZ'

    if not sa_file:
        raise CommandError(
            'Thiếu cấu hình GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE (đường dẫn file JSON key '
            'của Service Account) trong .env.'
        )
    if not sheet_id:
        raise CommandError('Thiếu cấu hình EMPLOYEE_MASTER_SHEET_ID (ID của Google Sheet) trong .env.')

    try:
        creds = service_account.Credentials.from_service_account_file(
            sa_file, scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
        )
    except FileNotFoundError:
        raise CommandError(f'Không tìm thấy file Service Account key tại "{sa_file}".')

    service = build('sheets', 'v4', credentials=creds)
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=sheet_id, range=sheet_range
        ).execute()
    except HttpError as exc:
        raise CommandError(
            f'Không đọc được sheet (kiểm tra sheet đã share quyền Viewer cho Service '
            f'Account, và EMPLOYEE_MASTER_SHEET_ID/RANGE đúng chưa): {exc}'
        )

    values = result.get('values', [])
    if not values:
        raise CommandError('Sheet rỗng hoặc không đọc được dữ liệu ở range đã cấu hình.')

    header = [str(c).strip() for c in values[0]]
    data_rows = values[1:]
    # Google Sheets API cắt bớt các ô trống ở CUỐI mỗi dòng -> pad cho đủ
    # số cột bằng header để không bị lệch cột.
    normalized_rows = [row + [''] * (len(header) - len(row)) for row in data_rows]
    return pd.DataFrame(normalized_rows, columns=header)


class Command(BaseCommand):
    help = (
        'Đồng bộ dữ liệu nhân sự từ Google Sheet "master" vào Employee '
        '(sheet luôn thắng cho field có giá trị, không tự tạo NV mới, '
        'không tự xoá NV không còn trong sheet).'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Chỉ đọc sheet + thống kê, KHÔNG lưu thay đổi vào DB',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        df = _fetch_sheet_dataframe()
        field_series = map_columns(df)

        if 'employee_id' not in field_series:
            raise CommandError(
                'Sheet thiếu cột mã nhân viên (chấp nhận: "Mã nhân viên", "Mã NV", '
                '"employee_id", "Mã").'
            )

        rows = []
        for i in range(len(df)):
            row_dict = {field: series.iloc[i] for field, series in field_series.items()}
            rows.append(row_dict)

        # Pre-load cache tra cứu, cùng kiểu với EmployeeImportSerializer.
        emp_cache = {e.employee_id: e for e in Employee.objects.all()}
        dept_cache = {}
        for d in Department.objects.all():
            dept_cache[d.code] = d
            dept_cache[_normalize_col(d.name)] = d
        pos_cache = {}
        for p in Position.objects.all():
            pos_cache[p.code] = p
            pos_cache[_normalize_col(p.title)] = p
        cu_cache = {}
        for cu in CompanyUnit.objects.all():
            cu_cache[cu.name] = cu
            cu_cache[cu.name.lower()] = cu
            if cu.code:
                cu_cache[cu.code.lower()] = cu

        summary = {
            'total_rows': len(rows),
            'updated': 0,
            'unchanged': 0,
            'not_found': [],
            'warnings': [],
            'errors': [],
        }

        for idx, row_dict in enumerate(rows):
            row_num = idx + 2  # dòng 1 = header
            try:
                parsed, parse_errors = process_row(row_dict, field_series, idx)
            except Exception as exc:
                logger.warning('sync_employee_master_sheet: row %s failed to parse: %s', row_num, exc, exc_info=True)
                summary['errors'].append({'row': row_num, 'error': str(exc)})
                continue

            employee_id = parsed.get('employee_id')
            if not employee_id:
                continue  # dòng trống, bỏ qua âm thầm — không phải lỗi

            if parse_errors:
                summary['warnings'].append({'row': row_num, 'employee_id': employee_id, 'messages': parse_errors})

            emp = emp_cache.get(employee_id)
            if not emp:
                summary['not_found'].append(employee_id)
                continue

            try:
                changed_fields = self._apply_row(emp, parsed, dept_cache, pos_cache, emp_cache, cu_cache, dry_run)
            except Exception as exc:
                logger.warning('sync_employee_master_sheet: row %s (NV %s) failed to apply: %s', row_num, employee_id, exc, exc_info=True)
                summary['errors'].append({'row': row_num, 'employee_id': employee_id, 'error': str(exc)})
                continue

            if changed_fields:
                summary['updated'] += 1
            else:
                summary['unchanged'] += 1

        self._print_summary(summary, dry_run)

    # ------------------------------------------------------------------
    def _apply_row(self, emp, parsed, dept_cache, pos_cache, emp_cache, cu_cache, dry_run):
        """Tương đương nhánh 'cập nhật NV đã có' trong
        EmployeeImportSerializer._import_row — chỉ ghi đè field có giá trị
        trong sheet (parsed), bỏ qua field sheet để trống. KHÔNG có nhánh
        tạo mới. Trả về danh sách tên field thực sự thay đổi."""
        changed = []

        def maybe_set(field_name, value):
            if value in (None, '', []):
                return
            if getattr(emp, field_name) == value:
                return
            setattr(emp, field_name, value)
            changed.append(field_name)

        for field, value in parsed.items():
            if field in ('employee_id', '_department_code', '_position_code', '_manager_code', '_company_unit_name'):
                continue
            maybe_set(field, value)

        dept_code = parsed.get('_department_code')
        if dept_code:
            dept = dept_cache.get(dept_code) or dept_cache.get(_normalize_col(dept_code))
            if dept:
                maybe_set('department', dept)

        pos_code = parsed.get('_position_code')
        if pos_code:
            pos = pos_cache.get(pos_code) or pos_cache.get(_normalize_col(pos_code))
            if pos:
                maybe_set('position', pos)

        mgr_code = parsed.get('_manager_code')
        if mgr_code:
            mgr = emp_cache.get(mgr_code)
            if mgr:
                maybe_set('manager', mgr)

        cu_name = parsed.get('_company_unit_name')
        if cu_name:
            cu = cu_cache.get(cu_name) or cu_cache.get(cu_name.lower())
            if cu:
                maybe_set('company_unit', cu)

        if changed and not dry_run:
            emp.save(update_fields=changed)

        return changed

    # ------------------------------------------------------------------
    def _print_summary(self, summary, dry_run):
        self.stdout.write(f"Tổng số dòng đọc được từ sheet: {summary['total_rows']}")
        self.stdout.write(self.style.SUCCESS(f"Đã cập nhật: {summary['updated']} NV"))
        self.stdout.write(f"Không có gì thay đổi: {summary['unchanged']} NV")

        if summary['not_found']:
            self.stdout.write(self.style.WARNING(
                f"{len(summary['not_found'])} mã NV có trong sheet nhưng CHƯA có trong HRM "
                f"(không tự tạo — cần HR tự kiểm tra/onboard):"
            ))
            for code in summary['not_found'][:50]:
                self.stdout.write(f'    - {code}')
            if len(summary['not_found']) > 50:
                self.stdout.write(f"    ... và {len(summary['not_found']) - 50} mã khác.")

        if summary['warnings']:
            self.stdout.write(self.style.WARNING(f"{len(summary['warnings'])} dòng có cảnh báo khi parse:"))
            for w in summary['warnings'][:30]:
                self.stdout.write(f"    - Dòng {w['row']} (NV {w['employee_id']}): {'; '.join(w['messages'])}")

        if summary['errors']:
            self.stdout.write(self.style.ERROR(f"{len(summary['errors'])} dòng lỗi:"))
            for e in summary['errors'][:30]:
                self.stdout.write(f"    - Dòng {e['row']} (NV {e.get('employee_id', '?')}): {e.get('error', '')}")

        if dry_run:
            self.stdout.write(self.style.WARNING('Dry-run: CHƯA lưu thay đổi gì. Bỏ --dry-run để áp dụng thật.'))
