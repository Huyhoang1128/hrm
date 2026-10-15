"""
Serializer và logic xử lý import nhân viên từ file CSV/Excel.
"""
import io
import os
import logging
import traceback
import unicodedata

import pandas as pd
from rest_framework import serializers
from django.contrib.auth.models import User
from django.db import transaction

from .models import (
    Employee, Department, Position, CompanyUnit,
    GENDER, EMPLOYMENT_STATUS, WORK_FORM, EDUCATION_LEVEL,
    MARITAL_STATUS, CONTRACT_TYPE, FILE_STATUS, PROBATION_RATE,
    WORK_LOCATION,
)
from hrm.models import EmployeeContract

logger = logging.getLogger(__name__)

DEFAULT_PASSWORD = os.environ.get("EMPLOYEE_IMPORT_DEFAULT_PASSWORD", "ChangeMe@2024")


def _normalize_col(s: str) -> str:
    """NFC + lowercase + strip — dùng cho mọi so khớp tiếng Việt."""
    return unicodedata.normalize('NFC', s.strip().lower())


# ---------------------------------------------------------------------------
# Mapping: tên cột trong file → tên field trên model Employee
# ---------------------------------------------------------------------------
COLUMN_MAP = {
    # Bắt buộc
    "mã nhân viên": "employee_id",
    "mã nv": "employee_id",
    "employee id": "employee_id",
    "employee_id": "employee_id",
    "mã": "employee_id",

    # Thông tin cá nhân
    "họ và tên": "full_name",
    "họ tên": "full_name",
    "full name": "full_name",
    "full_name": "full_name",
    "tên": "full_name",

    "giới tính": "gender",
    "gender": "gender",

    "ngày sinh": "date_of_birth",
    "date of birth": "date_of_birth",
    "dob": "date_of_birth",

    "số điện thoại": "phone_number",
    "phone": "phone_number",
    "phone number": "phone_number",
    "điện thoại": "phone_number",

    "email cá nhân": "personal_email",
    "email": "personal_email",
    "personal email": "personal_email",

    "facebook": "facebook_link",
    "facebook link": "facebook_link",
    "link facebook": "facebook_link",

    # Tổ chức
    "vùng/miền": "region",
    "vùng": "region",
    "region": "region",

    "khối": "block",
    "block": "block",

    "bộ phận": "section",
    "section": "section",

    "cấp bậc": "rank",
    "rank": "rank",

    "địa điểm làm việc": "work_location",
    "work location": "work_location",

    "team bác sĩ": "doctor_team",
    "bác sĩ chính": "doctor_team",
    "doctor team": "doctor_team",

    # Phòng ban / vị trí (theo code)
    "mã phòng ban": "department_code",
    "department code": "department_code",
    "phòng ban": "department_code",
    "phòng/ban": "department_code",

    "mã vị trí": "position_code",
    "position code": "position_code",
    "vị trí": "position_code",
    "chức danh": "position_code",

    "mã quản lý": "manager_code",
    "manager code": "manager_code",
    "quản lý": "manager_code",
    "quản lý trực tiếp": "manager_code",

    # Hợp đồng & làm việc
    "hình thức làm việc": "work_form",
    "work form": "work_form",

    "trình độ học vấn": "education_level",
    "education level": "education_level",
    "học vấn": "education_level",

    "loại hợp đồng": "contract_type",
    "contract type": "contract_type",

    "ngày bắt đầu": "start_date",
    "ngày bắt đầu làm việc": "start_date",
    "start date": "start_date",
    "ngày vào làm": "start_date",

    "ngày kết thúc": "end_date",
    "end date": "end_date",
    "ngày nghỉ việc": "end_date",

    "ngày kết thúc thử việc": "probation_end_date",
    "probation end date": "probation_end_date",

    "ngày lên chính thức": "official_start_date",
    "ngày chính thức": "official_start_date",
    "official start date": "official_start_date",

    "tháng thử việc": "probation_months",
    "thời gian thử việc(tháng)": "probation_months",
    "probation months": "probation_months",

    "tỉ lệ thử việc": "probation_rate",
    "tỉ lệ hưởng thử việc": "probation_rate",
    "probation rate": "probation_rate",

    "trạng thái làm việc": "employment_status",
    "employment status": "employment_status",

    "ghi chú trạng thái": "employment_status_notes",

    "lý do nghỉ việc": "termination_reason",

    # Lương & phụ cấp
    "lương cơ bản": "basic_salary",
    "lương": "basic_salary",
    "basic salary": "basic_salary",

    "phụ cấp": "allowance",
    "allowance": "allowance",

    "ghi chú lương": "salary_notes",
    "ghi chú công việc": "employment_status_notes",
    "ghi chú phụ cấp": "allowance_notes",

    # Ngân hàng
    "tên ngân hàng": "bank_name",
    "bank name": "bank_name",

    "số tài khoản": "bank_account",
    "số tài khoản đăng ký nhận lương": "bank_account",
    "bank account": "bank_account",

    "chi nhánh ngân hàng": "bank_branch",
    "bank branch": "bank_branch",

    "chủ tài khoản": "bank_account_holder",
    "bank account holder": "bank_account_holder",

    # BHXH & thuế
    "mã bhxh": "social_insurance_number",
    "mã số bhxh": "social_insurance_number",
    "social insurance": "social_insurance_number",

    "mã số thuế": "tax_code",
    "mã số tncn": "tax_code",
    "tax code": "tax_code",

    "mã hộ gia đình": "household_code",

    "đang tham gia đóng": "insurance_participation",
    "insurance participation": "insurance_participation",

    "thời điểm báo tăng": "insurance_increase_time",

    # CCCD / VNEID
    "số cccd": "cccd_number",
    "cccd": "cccd_number",
    "số cmnd cũ": "old_id_number",
    "cmnd": "old_id_number",

    "ngày cấp cccd": "cccd_issue_date",
    "nơi cấp cccd": "cccd_issue_place",

    "link cccd/cmt": "link_cccd",
    "link cccd": "link_cccd",

    "nơi khai sinh": "birth_place",
    "nơi đăng ký khai sinh": "birth_place",
    "nơi thường trú": "permanent_residence",
    "địa chỉ thường trú": "permanent_residence",
    "địa chỉ hiện tại": "current_address",

    "tình trạng hôn nhân": "marital_status",
    "marital status": "marital_status",

    "dân tộc": "ethnicity",
    "ethnicity": "ethnicity",

    "quốc tịch": "nationality",
    "nationality": "nationality",

    # Người liên hệ khẩn cấp
    "người liên hệ khẩn cấp": "emergency_contact_name",
    "khi cần liên hệ với ai?": "emergency_contact_name",
    "emergency contact name": "emergency_contact_name",

    "mối quan hệ": "emergency_contact_relationship",
    "mối quan hệ của người thân với ai?": "emergency_contact_relationship",
    "emergency contact relationship": "emergency_contact_relationship",

    "sđt người thân": "emergency_contact_phone",
    "số điện thoại người thân": "emergency_contact_phone",
    "emergency contact phone": "emergency_contact_phone",

    "ngày sinh người thân": "emergency_contact_dob",

    "nghề nghiệp người thân": "emergency_contact_occupation",

    "địa chỉ người liên hệ": "emergency_contact_address",
    "địa chỉ của người khi cần liên hệ": "emergency_contact_address",

    # Hồ sơ
    "trạng thái hồ sơ": "file_status",
    "trạng thái nộp hồ sơ": "file_status",
    "file status": "file_status",

    "hạn nộp hồ sơ": "file_submission_deadline",

    "ngày nộp hồ sơ": "file_submission_date",

    "ghi chú hồ sơ": "file_review_notes",

    "sơ yếu lý lịch": "doc_resume",
    "cccd (hồ sơ)": "doc_cccd",
    "bằng cấp": "doc_degree",
    "giấy khám sức khỏe": "doc_health",

    # Đơn vị (CompanyUnit FK, lookup theo tên)
    "đơn vị": "company_unit_name",
    "company unit": "company_unit_name",

    # Ghi chú
    "ghi chú": "notes",
    "notes": "notes",

    # Tỷ lệ doanh số & lợi nhuận
    "tỷ lệ % doanh số hưởng": "revenue_percentage",
    "tỷ lệ doanh số": "revenue_percentage",
    "revenue percentage": "revenue_percentage",

    "tỷ lệ % lợi nhuận hưởng": "profit_percentage",
    "tỷ lệ lợi nhuận": "profit_percentage",
    "profit percentage": "profit_percentage",

    # Ngày hợp đồng
    "ngày bắt đầu hợp đồng": "contract_start_date",
    "contract start date": "contract_start_date",

    "ngày kết thúc hợp đồng": "contract_end_date",
    "contract end date": "contract_end_date",

    # Trạng thái
    "đang hoạt động": "is_active",
    "is active": "is_active",

    "là nhân viên hr": "is_hr",
    "is hr": "is_hr",
}

# Choices map: NFC-normalized display value → stored code (và cả raw code)
def _build_choice_map(choices):
    m = {}
    for k, v in choices:
        m[_normalize_col(v)] = k   # display label → code
        m[_normalize_col(k)] = k   # raw code → code
    return m

GENDER_MAP = _build_choice_map(GENDER)
EMPLOYMENT_STATUS_MAP = _build_choice_map(EMPLOYMENT_STATUS)
WORK_FORM_MAP = _build_choice_map(WORK_FORM)
EDUCATION_LEVEL_MAP = _build_choice_map(EDUCATION_LEVEL)
MARITAL_STATUS_MAP = _build_choice_map(MARITAL_STATUS)
CONTRACT_TYPE_MAP = _build_choice_map(CONTRACT_TYPE)
FILE_STATUS_MAP = _build_choice_map(FILE_STATUS)
PROBATION_RATE_MAP = _build_choice_map(PROBATION_RATE)
WORK_LOCATION_MAP = _build_choice_map(WORK_LOCATION)


def _safe_str(val):
    """Trả về chuỗi hoặc None nếu rỗng/NaN."""
    if _is_empty_excel_value(val):
        return None
    s = str(val).strip()
    if s.lower() in {"nan", "nat", "none", "null"}:
        return None
    # Strip ".0" cho số nguyên bị đọc thành float (vd: 1812312313.0 → "1812312313")
    if s.endswith('.0') and s[:-2].lstrip('-').isdigit():
        s = s[:-2]
    return s if s and s.lower() != 'nan' else None


def _safe_phone(val):
    """Parse số điện thoại, khôi phục số 0 đầu bị mất khi Excel đọc dạng Number."""
    s = _safe_str(val)
    if not s:
        return None
    # Nếu Excel đọc số điện thoại dạng Number → mất số 0 đầu (vd: 912345678 → thêm 0)
    if s.isdigit() and len(s) == 9:
        s = '0' + s
    return s


def _is_empty_excel_value(val):
    if val is None:
        return True
    if val is pd.NaT:
        return True
    if isinstance(val, str) and not val.strip():
        return True
    try:
        return bool(pd.isna(val))
    except Exception:
        return False


def _safe_date(val):
    """Parse ngày, chỉ nhận DD/MM/YYYY (string) hoặc Excel serial/datetime object."""
    import datetime as dt
    if _is_empty_excel_value(val):
        return None
    if isinstance(val, pd.Timestamp):
        try:
            return None if pd.isna(val) else val.date()
        except Exception:
            return None
    if isinstance(val, dt.datetime):
        try:
            return val.date()
        except Exception:
            return None
    if isinstance(val, dt.date):
        return val
    if isinstance(val, (int, float)):
        try:
            return (pd.Timestamp('1899-12-30') + pd.Timedelta(days=int(val))).date()
        except Exception:
            return None
    try:
        result = pd.to_datetime(str(val).strip(), format='%d/%m/%Y', errors='coerce')
        return None if pd.isna(result) else result.date()
    except Exception:
        return None


def _safe_decimal(val):
    """Parse số thực, trả về float hoặc None."""
    import math
    if _is_empty_excel_value(val):
        return None
    try:
        result = float(str(val).replace(",", ".").strip())
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def _safe_int(val):
    if _is_empty_excel_value(val):
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def _safe_bool(val):
    if _is_empty_excel_value(val):
        return None
    if isinstance(val, bool):
        return val
    s = str(val).strip().lower()
    if s in ("1", "true", "yes", "có", "x"):
        return True
    if s in ("0", "false", "no", "không", ""):
        return False
    return None


def _map_choice(val, mapping):
    """Chuyển giá trị text/code sang giá trị lưu trong DB theo mapping (NFC-normalized)."""
    if not val:
        return None
    return mapping.get(_normalize_col(val))


_COLUMN_MAP_NORMALIZED = {_normalize_col(k): v for k, v in COLUMN_MAP.items()}


# ---------------------------------------------------------------------------
# Đọc file
# ---------------------------------------------------------------------------

def _read_excel_openpyxl(content: bytes) -> pd.DataFrame:
    """Đọc Excel bằng openpyxl, giữ nguyên kiểu dữ liệu gốc (datetime, int, float, str).
    - datetime → _safe_date xử lý trực tiếp
    - int/float phone → _safe_phone thêm số 0 đầu nếu cần
    - None (ô trống) → _safe_str / _safe_date trả None → không ghi đè
    """
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return pd.DataFrame()
    headers = [str(c).strip() if c is not None else "" for c in rows[0]]
    data = [list(row) for row in rows[1:]]
    return pd.DataFrame(data, columns=headers)


def read_dataframe(file):
    """Đọc CSV hoặc Excel, trả về DataFrame với cột đã chuẩn hoá."""
    ext = os.path.splitext(file.name)[1].lower()
    content = file.read()
    if ext in (".xlsx", ".xls"):
        df = _read_excel_openpyxl(content)
    elif ext == ".csv":
        df = pd.read_csv(io.BytesIO(content), header=0, dtype=str)
    else:
        raise ValueError(f"Định dạng file không được hỗ trợ: {ext}")

    df.columns = [str(c).strip() for c in df.columns]
    return df


def map_columns(df):
    """Trả về dict {field_name: series} từ DataFrame."""
    field_series = {}
    for col in df.columns:
        field = _COLUMN_MAP_NORMALIZED.get(_normalize_col(str(col)))
        if field and field not in field_series:
            field_series[field] = df[col]
    return field_series


# ---------------------------------------------------------------------------
# Xử lý từng dòng
# ---------------------------------------------------------------------------

def _get(field_series, field, row):
    s = field_series.get(field)
    if s is None:
        return None
    return row.get(field, None) if isinstance(row, dict) else s.iloc[row]


def generate_next_employee_id():
    """
    Sinh mã nhân viên tiếp theo theo dạng <PREFIX>00001 → <PREFIX>99999,
    PREFIX = Employee.EMPLOYEE_ID_FALLBACK_PREFIX (settings EMPLOYEE_ID_FALLBACK_PREFIX).
    """
    import re

    prefix = Employee.EMPLOYEE_ID_FALLBACK_PREFIX
    pattern = rf"^{re.escape(prefix)}(\d{{5}})$"
    employee_numbers = []

    all_ids = Employee.objects.filter(
        employee_id__iregex=rf"^{re.escape(prefix)}\d{{5}}$"
    ).values_list("employee_id", flat=True)
    # Kiểm tra thêm cả User table để tránh race condition
    all_usernames = User.objects.filter(
        username__iregex=rf"^{re.escape(prefix)}\d{{5}}$"
    ).values_list("username", flat=True)
    for value in list(all_ids) + list(all_usernames):
        m = re.search(pattern, str(value), re.IGNORECASE)
        if m:
            employee_numbers.append(int(m.group(1)))

    if not employee_numbers:
        return f"{prefix}00001"

    next_number = max(employee_numbers) + 1
    if next_number > 99999:
        raise ValueError(f"Đã đạt giới hạn mã nhân viên ({prefix}99999)")

    return f"{prefix}{next_number:05d}"


def process_row(row_dict, field_series, row_index):
    """
    Trả về (employee_data: dict, errors: list).
    employee_data chứa các trường đã parse sẵn để tạo/cập nhật Employee.
    """
    errors = []

    def get(field):
        return row_dict.get(field)

    # employee_id: nếu không có trong file thì để None → caller sẽ tự sinh
    employee_id = _safe_str(get("employee_id"))
    data = {"employee_id": employee_id}  # None được xử lý trong _import_row

    # Thông tin cá nhân
    full_name = _safe_str(get("full_name"))
    if full_name:
        data["full_name"] = full_name

    gender_raw = _safe_str(get("gender"))
    if gender_raw:
        gender = _map_choice(gender_raw, GENDER_MAP)
        if gender:
            data["gender"] = gender
        else:
            errors.append(f"Giới tính không hợp lệ: '{gender_raw}'")

    dob = _safe_date(get("date_of_birth"))
    if dob:
        data["date_of_birth"] = dob

    _phone_fields = {"phone_number", "emergency_contact_phone"}
    for simple_str_field in [
        "phone_number", "personal_email", "facebook_link",
        "region", "block", "section", "rank", "doctor_team",
        "bank_name", "bank_account", "bank_branch", "bank_account_holder",
        "social_insurance_number", "tax_code", "household_code",
        "insurance_participation", "insurance_increase_time",
        "cccd_number", "old_id_number", "cccd_issue_place", "link_cccd",
        "birth_place", "permanent_residence", "current_address",
        "ethnicity", "nationality",
        "emergency_contact_name", "emergency_contact_relationship",
        "emergency_contact_phone", "emergency_contact_occupation",
        "emergency_contact_address",
        "employment_status_notes", "termination_reason",
        "file_review_notes", "notes", "salary_notes", "allowance_notes",
        "revenue_percentage", "profit_percentage",
    ]:
        v = _safe_phone(get(simple_str_field)) if simple_str_field in _phone_fields else _safe_str(get(simple_str_field))
        if v is not None:
            data[simple_str_field] = v

    # Choice fields
    for field, mapping in [
        ("work_form", WORK_FORM_MAP),
        ("education_level", EDUCATION_LEVEL_MAP),
        ("marital_status", MARITAL_STATUS_MAP),
        ("contract_type", CONTRACT_TYPE_MAP),
        ("file_status", FILE_STATUS_MAP),
        ("probation_rate", PROBATION_RATE_MAP),
        ("employment_status", EMPLOYMENT_STATUS_MAP),
    ]:
        raw = _safe_str(get(field))
        if raw:
            mapped = _map_choice(raw, mapping)
            if mapped:
                data[field] = mapped
            else:
                errors.append(f"Giá trị không hợp lệ cho {field}: '{raw}'")

    # work_location
    raw_wl = _safe_str(get("work_location"))
    if raw_wl:
        mapped_wl = _map_choice(raw_wl, WORK_LOCATION_MAP)
        if mapped_wl:
            data["work_location"] = mapped_wl
        else:
            # Lưu nguyên nếu không map được (user có thể dùng code trực tiếp)
            data["work_location"] = raw_wl

    # Date fields
    for date_field in [
        "start_date", "end_date", "probation_end_date",
        "official_start_date", "file_submission_deadline",
        "file_submission_date", "emergency_contact_dob",
        "cccd_issue_date",
        "contract_start_date", "contract_end_date",
    ]:
        d = _safe_date(get(date_field))
        if d:
            data[date_field] = d

    # Numeric fields
    for dec_field in ["basic_salary", "allowance"]:
        v = _safe_decimal(get(dec_field))
        if v is not None:
            data[dec_field] = v

    pm = _safe_int(get("probation_months"))
    if pm is not None:
        data["probation_months"] = pm

    # Boolean fields
    for bool_field in ["doc_resume", "doc_cccd", "doc_degree", "doc_health", "is_active", "is_hr"]:
        v = _safe_bool(get(bool_field))
        if v is not None:
            data[bool_field] = v

    # FK look-ups (by code)
    department_code = _safe_str(get("department_code"))
    if department_code:
        data["_department_code"] = department_code

    position_code = _safe_str(get("position_code"))
    if position_code:
        data["_position_code"] = position_code

    manager_code = _safe_str(get("manager_code"))
    if manager_code:
        data["_manager_code"] = manager_code

    company_unit_name = _safe_str(get("company_unit_name"))
    if company_unit_name:
        data["_company_unit_name"] = company_unit_name

    return data, errors


# ---------------------------------------------------------------------------
# Serializer chính
# ---------------------------------------------------------------------------

class EmployeeImportSerializer(serializers.Serializer):
    """Nhận file CSV/Excel, import nhân viên hàng loạt."""

    file = serializers.FileField(required=True)

    def validate_file(self, value):
        allowed = {".xlsx", ".xls", ".csv"}
        ext = os.path.splitext(value.name)[1].lower()
        if ext not in allowed:
            raise serializers.ValidationError(
                f"Định dạng file không hỗ trợ. Chỉ chấp nhận: {', '.join(allowed)}"
            )
        max_size = 10 * 1024 * 1024  # 10 MB
        if value.size > max_size:
            raise serializers.ValidationError("File vượt quá giới hạn 10 MB.")
        return value

    def create(self, validated_data):
        file = validated_data["file"]

        try:
            df = read_dataframe(file)
        except Exception as exc:
            logger.error("Cannot read import file", exc_info=True)
            raise serializers.ValidationError("Không đọc được file. Vui lòng kiểm tra định dạng và thử lại.")

        field_series = map_columns(df)

        if "employee_id" not in field_series:
            raise serializers.ValidationError(
                "File thiếu cột mã nhân viên. "
                "Cột hợp lệ: 'Mã nhân viên', 'Mã NV', 'employee_id', ..."
            )

        # Xây dict hàng cho từng row dựa trên field_series đã map
        rows = []
        for i in range(len(df)):
            row_dict = {field: series.iloc[i] for field, series in field_series.items()}
            rows.append(row_dict)

        summary = {
            "total": len(rows),
            "created": 0,
            "updated": 0,
            "failed": 0,
            "errors": [],
        }

        # Pre-load lookup caches (code + normalized name để match case-insensitive)
        dept_cache: dict = {}
        for d in Department.objects.all():
            dept_cache[d.code] = d
            dept_cache[_normalize_col(d.name)] = d
        pos_cache: dict = {}
        for p in Position.objects.all():
            pos_cache[p.code] = p
            pos_cache[_normalize_col(p.title)] = p
        emp_cache = {e.employee_id: e for e in Employee.objects.all()}
        # cu_cache: tra cứu theo tên chính xác, tên lowercase, code lowercase
        _all_cu = list(CompanyUnit.objects.all())
        cu_cache = {}
        for cu in _all_cu:
            cu_cache[cu.name] = cu
            cu_cache[cu.name.lower()] = cu
            cu_cache[cu.code.lower()] = cu

        for idx, row_dict in enumerate(rows):
            row_num = idx + 2  # dòng 1 = header
            try:
                parsed, parse_errors = process_row(row_dict, field_series, idx)

                if parse_errors:
                    summary["errors"].append({
                        "row": row_num,
                        "employee_id": parsed.get("employee_id"),
                        "warnings": parse_errors,
                    })

                employee_id = parsed.get("employee_id")

                # Nếu không có employee_id trong file, bỏ qua dòng đó
                if not employee_id:
                    summary["errors"].append({
                        "row": row_num,
                        "employee_id": None,
                        "warnings": ["Dòng không có mã nhân viên, bỏ qua."],
                    })
                    continue

                with transaction.atomic():
                    self._import_row(parsed, employee_id, dept_cache, pos_cache, emp_cache, cu_cache, summary, row_num)

            except Exception as exc:
                logger.warning(f"Import row {row_num} failed: {exc}\n{traceback.format_exc()}")
                summary["failed"] += 1
                summary["errors"].append({
                    "row": row_num,
                    "employee_id": _safe_str(row_dict.get("employee_id")),
                    "errors": [str(exc)],
                })

        return summary

    # ------------------------------------------------------------------
    def _import_row(self, parsed, employee_id, dept_cache, pos_cache, emp_cache, cu_cache, summary, row_num):
        def _warn_skip_field(field_name, exc):
            summary["errors"].append({
                "row": row_num,
                "employee_id": employee_id,
                "warnings": [
                    f"Cột '{field_name}' lỗi ({exc}), bỏ qua cập nhật cột này."
                ],
            })

        def _try_save_field(emp_obj, field_name, value):
            original_value = getattr(emp_obj, field_name)
            try:
                setattr(emp_obj, field_name, value)
                emp_obj.save(update_fields=[field_name])
                return True
            except Exception as exc:
                setattr(emp_obj, field_name, original_value)
                _warn_skip_field(field_name, exc)
                return False

        # Resolve FK
        department = None
        dept_code = parsed.pop("_department_code", None)
        if dept_code:
            department = dept_cache.get(dept_code) or dept_cache.get(_normalize_col(dept_code))
            if not department:
                try:
                    department = Department.objects.get(name__iexact=dept_code)
                    dept_cache[dept_code] = department
                    dept_cache[_normalize_col(dept_code)] = department
                except Department.DoesNotExist:
                    summary["errors"].append({
                        "row": row_num,
                        "employee_id": employee_id,
                        "warnings": [f"Không tìm thấy phòng ban '{dept_code}', bỏ qua"],
                    })

        position = None
        pos_code = parsed.pop("_position_code", None)
        if pos_code:
            position = pos_cache.get(pos_code) or pos_cache.get(_normalize_col(pos_code))
            if not position:
                try:
                    position = Position.objects.get(title__iexact=pos_code)
                    pos_cache[pos_code] = position
                    pos_cache[_normalize_col(pos_code)] = position
                except Position.DoesNotExist:
                    summary["errors"].append({
                        "row": row_num,
                        "employee_id": employee_id,
                        "warnings": [f"Không tìm thấy vị trí '{pos_code}', bỏ qua"],
                    })

        manager = None
        mgr_code = parsed.pop("_manager_code", None)
        if mgr_code:
            manager = emp_cache.get(mgr_code)
            if not manager:
                try:
                    manager = Employee.objects.get(employee_id=mgr_code)
                    emp_cache[mgr_code] = manager
                except Employee.DoesNotExist:
                    summary["errors"].append({
                        "row": row_num,
                        "employee_id": employee_id,
                        "warnings": [f"Không tìm thấy quản lý '{mgr_code}', bỏ qua"],
                    })

        company_unit = None
        cu_name = parsed.pop("_company_unit_name", None)
        if cu_name:
            # 1. exact → 2. lowercase → 3. code lowercase
            company_unit = (
                cu_cache.get(cu_name)
                or cu_cache.get(cu_name.lower())
                or cu_cache.get(cu_name.strip().lower())
            )
            if not company_unit:
                # 4. tìm tên chứa từ khóa (fallback, lấy kết quả đầu tiên)
                try:
                    company_unit = CompanyUnit.objects.filter(
                        name__icontains=cu_name
                    ).first() or CompanyUnit.objects.filter(
                        code__iexact=cu_name
                    ).first()
                    if company_unit:
                        cu_cache[cu_name.lower()] = company_unit
                except Exception:
                    pass
            if not company_unit:
                summary["errors"].append({
                    "row": row_num,
                    "employee_id": employee_id,
                    "warnings": [f"Không tìm thấy đơn vị '{cu_name}', bỏ qua"],
                })

        existing_emp = emp_cache.get(employee_id)
        new_emp = None

        if existing_emp:
            # Cập nhật nhân viên đã có — chỉ ghi đè trường có data trong file
            for field, value in parsed.items():
                if field != "employee_id" and value not in (None, "", []):
                    _try_save_field(existing_emp, field, value)
            if department is not None:
                _try_save_field(existing_emp, "department", department)
            if position is not None:
                _try_save_field(existing_emp, "position", position)
            if manager is not None:
                _try_save_field(existing_emp, "manager", manager)
            if company_unit is not None:
                _try_save_field(existing_emp, "company_unit", company_unit)
            summary["updated"] += 1
        else:
            # Tạo user mới nếu chưa tồn tại
            username = employee_id
            user = User.objects.filter(username=username).first()
            if not user:
                full_name = parsed.get("full_name", "") or ""
                # Tên tiếng Việt: họ đệm đứng trước, tên riêng đứng cuối
                # first_name = tên riêng (phần cuối), last_name = họ đệm (phần trước)
                parts = full_name.rsplit(" ", 1) if full_name else []
                first_name = parts[-1] if parts else ""
                last_name = parts[0] if len(parts) > 1 else ""
                user = User.objects.create_user(
                    username=username,
                    password=DEFAULT_PASSWORD,
                    first_name=first_name,
                    last_name=last_name,
                    email=parsed.get("personal_email") or "",
                )

            new_emp = Employee.objects.create(
                employee_id=employee_id,
                user=user,
                full_name=parsed.get("full_name") or employee_id,
                gender=parsed.get("gender") or "M",
            )

            for field, value in parsed.items():
                if field in {"employee_id", "full_name", "gender"}:
                    continue
                if value not in (None, "", []):
                    _try_save_field(new_emp, field, value)

            if department is not None:
                _try_save_field(new_emp, "department", department)
            if position is not None:
                _try_save_field(new_emp, "position", position)
            if manager is not None:
                _try_save_field(new_emp, "manager", manager)
            if company_unit is not None:
                _try_save_field(new_emp, "company_unit", company_unit)

            emp_cache[employee_id] = new_emp
            summary["created"] += 1

        # ------------------------------------------------------------------
        # Tự động tạo EmployeeContract (DRAFT) nếu import có loại hợp đồng
        # ------------------------------------------------------------------
        emp = existing_emp if existing_emp else new_emp
        ct = emp.contract_type
        if ct:
            try:
                c_start = emp.contract_start_date or emp.start_date
                c_end = emp.contract_end_date or emp.end_date
                # Tránh duplicate khi re-import: skip nếu đã có DRAFT cùng loại + ngày bắt đầu
                duplicate = EmployeeContract.objects.filter(
                    employee=emp,
                    contract_type=ct,
                    status='DRAFT',
                    start_date=c_start,
                ).exists()
                if not duplicate:
                    EmployeeContract.objects.create(
                        employee=emp,
                        contract_type=ct,
                        start_date=c_start,
                        end_date=c_end,
                        company_unit=emp.company_unit,
                        template=None,
                        status='DRAFT',
                    )
            except Exception as exc:
                summary["errors"].append({
                    "row": row_num,
                    "employee_id": employee_id,
                    "warnings": [
                        f"Không thể tạo/cập nhật hợp đồng tự động ({exc}), bỏ qua phần hợp đồng."
                    ],
                })
