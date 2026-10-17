"""
View xử lý upload file CSV/Excel để import nhân viên hàng loạt.
"""
import io
import logging
import unicodedata
from decimal import Decimal, InvalidOperation

import pandas as pd

from rest_framework import permissions
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from rest_framework.views import APIView

from users.utils import get_user_role
from .models import Employee
from .import_serializers import EmployeeImportSerializer
from .org_import_serializers import DepartmentImportSerializer, PositionImportSerializer
from hrm.permissions import IsAdminOrHR

logger = logging.getLogger(__name__)


def _normalize_text(value):
    text = str(value or '').strip().lower()
    text = unicodedata.normalize('NFD', text)
    text = ''.join(ch for ch in text if unicodedata.category(ch) != 'Mn')
    text = ' '.join(text.split())
    return text


def _normalize_employee_code(raw_value):
    value = str(raw_value or '').strip().replace('\ufeff', '').replace('\xa0', '').upper()
    if value.endswith('.0'):
        value = value[:-2]
    value = value.replace(' ', '')
    return value


def _parse_decimal(raw_value):
    text = str(raw_value or '').strip()
    if not text:
        return None
    text = text.replace(' ', '').replace('\xa0', '')
    if text in {'-', '--'}:
        return None

    if ',' in text and '.' in text:
        if text.rfind(',') > text.rfind('.'):
            text = text.replace('.', '').replace(',', '.')
        else:
            text = text.replace(',', '')
    elif ',' in text:
        parts = text.split(',')
        if len(parts) == 2 and len(parts[1]) <= 2:
            text = text.replace(',', '.')
        else:
            text = text.replace(',', '')
    elif '.' in text:
        parts = text.split('.')
        if len(parts) > 2 or (len(parts) == 2 and len(parts[1]) == 3 and parts[0].isdigit()):
            text = ''.join(parts)

    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        raise ValueError(f"Mức đóng bảo hiểm không hợp lệ: {raw_value}")


class IsAdminUserRole(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        role = (get_user_role(request.user) or '').lower()
        return request.user.is_superuser or role == 'admin'


class EmployeeImportView(APIView):
    """
    POST /api/hrm/employees/import/
    Upload file CSV hoặc Excel để tạo/cập nhật nhân viên hàng loạt.

    Nếu nhân viên chưa tồn tại, một tài khoản user sẽ được tạo tự động với:
      - username = mã nhân viên
      - mật khẩu mặc định (EMPLOYEE_IMPORT_DEFAULT_PASSWORD)

    Request: multipart/form-data với trường `file` là file CSV/Excel.
    Response: tóm tắt kết quả import (số tạo mới, cập nhật, lỗi).
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = EmployeeImportSerializer(
            data=request.data, context={"request": request}
        )
        if not serializer.is_valid():
            return Response(
                {"success": False, "errors": serializer.errors},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            result = serializer.save()
        except Exception as exc:
            logger.error("Employee import failed", exc_info=True)
            return Response(
                {"success": False, "message": "Import thất bại. Vui lòng kiểm tra lại file và thử lại."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        http_status = (
            status.HTTP_200_OK if result["failed"] == 0 else status.HTTP_207_MULTI_STATUS
        )
        return Response(
            {
                "success": True,
                "summary": {
                    "total": result["total"],
                    "created": result["created"],
                    "updated": result["updated"],
                    "failed": result["failed"],
                },
                "errors": result["errors"],
            },
            status=http_status,
        )


class EmployeeSocialInsuranceImportView(APIView):
    """
    POST /api/hrm/employees/social-insurance/import/
    Import mức đóng BHXH theo file CSV/Excel.

    Cột hỗ trợ (tiếng Việt):
      - Mã nhân viên (bắt buộc)
      - Mức đóng bảo hiểm (tùy chọn)

    Quy tắc:
      - Nếu ô "Mức đóng bảo hiểm" trống -> không cập nhật cột đó.
      - Chỉ Admin mới được import.
    """

    permission_classes = [IsAuthenticated, IsAdminUserRole]

    EMPLOYEE_HEADERS = {
        'ma nhan vien',
        'Mã nhân viên',
        'ma nv',
        'employee_id',
        'employee id',
    }
    INSURANCE_HEADERS = {
        'muc dong bao hiem',
        'Mức đóng bảo hiểm',
        'muc dong bhxh',
        'social_insurance_contribution_level',
    }

    @staticmethod
    def _find_column_name(normalized_columns, candidates):
        normalized_candidates = {_normalize_text(cand) for cand in candidates}

        # 1) Exact match first
        for cand in normalized_candidates:
            if cand in normalized_columns:
                return normalized_columns[cand]

        # 2) Fuzzy contains match (handles messy headers from Excel CSV exports)
        for norm_name, original_name in normalized_columns.items():
            if not norm_name or norm_name.startswith('unnamed'):
                continue
            if any(cand in norm_name for cand in normalized_candidates):
                return original_name
            if any(norm_name in cand for cand in normalized_candidates):
                return original_name

        return None

    def _read_dataframe(self, upload_file):
        filename = (upload_file.name or '').lower()
        content = upload_file.read()
        if filename.endswith(('.xlsx', '.xls')):
            return pd.read_excel(io.BytesIO(content), dtype=object)

        csv_attempts = [
            {'encoding': 'utf-8-sig', 'sep': None, 'engine': 'python'},
            {'encoding': 'utf-8-sig', 'sep': ';'},
            {'encoding': 'utf-8-sig', 'sep': ','},
            {'encoding': 'utf-8-sig', 'sep': '\t'},
            {'encoding': 'utf-8', 'sep': None, 'engine': 'python'},
            {'encoding': 'utf-8', 'sep': ';'},
            {'encoding': 'utf-8', 'sep': ','},
            {'encoding': 'utf-8', 'sep': '\t'},
        ]

        last_error = None
        for attempt in csv_attempts:
            try:
                dataframe = pd.read_csv(io.BytesIO(content), dtype=object, **attempt)
                if dataframe is not None and len(dataframe.columns) > 0:
                    return dataframe
            except Exception as exc:
                last_error = exc

        if last_error:
            raise last_error
        raise ValueError('Không đọc được dữ liệu CSV từ file upload.')

    def post(self, request):
        upload_file = request.FILES.get('file')
        if not upload_file:
            return Response(
                {"success": False, "message": "Thiếu file upload."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            dataframe = self._read_dataframe(upload_file)
        except Exception as exc:
            return Response(
                {"success": False, "message": f"Không đọc được file: {exc}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if dataframe.empty:
            return Response(
                {"success": False, "message": "File không có dữ liệu."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        normalized_columns = {
            _normalize_text(col): col
            for col in dataframe.columns
        }
        employee_col = self._find_column_name(normalized_columns, self.EMPLOYEE_HEADERS)
        insurance_col = self._find_column_name(normalized_columns, self.INSURANCE_HEADERS)

        if not employee_col:
            return Response(
                {"success": False, "message": "Thiếu cột bắt buộc: Mã nhân viên."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not insurance_col:
            return Response(
                {"success": False, "message": "Thiếu cột: Mức đóng bảo hiểm."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        employee_map = {
            _normalize_employee_code(emp.employee_id): emp
            for emp in Employee.objects.all().only('id', 'employee_id', 'social_insurance_contribution_level')
        }

        total = 0
        updated = 0
        skipped = 0
        errors = []

        for idx, row in dataframe.iterrows():
            line_no = idx + 2
            raw_code = row.get(employee_col)
            employee_code = _normalize_employee_code(raw_code)
            insurance_raw = row.get(insurance_col)

            if not employee_code:
                errors.append({"row": line_no, "employee": "", "error": "Thiếu mã nhân viên."})
                continue

            employee = employee_map.get(employee_code)
            if not employee:
                errors.append({"row": line_no, "employee": str(raw_code or ''), "error": "Không tìm thấy nhân viên."})
                continue

            total += 1

            if pd.isna(insurance_raw) or str(insurance_raw).strip() == '':
                skipped += 1
                continue

            try:
                amount = _parse_decimal(insurance_raw)
                if amount is None:
                    skipped += 1
                    continue

                if employee.social_insurance_contribution_level == amount:
                    skipped += 1
                    continue
                if employee.social_insurance_periods.exists():
                    errors.append({"row": line_no, "employee": employee.employee_id, "error": 'Nhân viên đang quản lý BHXH theo kỳ đóng — sửa mức đóng trong "Kỳ đóng BHXH" thay vì trên hồ sơ.'})
                    continue

                employee.social_insurance_contribution_level = amount
                employee.save(update_fields=['social_insurance_contribution_level', 'updated_at'])
                updated += 1
            except Exception as exc:
                errors.append({"row": line_no, "employee": employee.employee_id, "error": str(exc)})

        return Response(
            {
                "success": True,
                "summary": {
                    "total": total,
                    "updated": updated,
                    "skipped": skipped,
                },
                "errors": errors,
            },
            status=status.HTTP_200_OK,
        )


def _flatten_error_detail(detail):
    """Làm phẳng ValidationError.detail (str | list | dict lồng nhau) thành list chuỗi."""
    if isinstance(detail, dict):
        out = []
        for v in detail.values():
            out.extend(_flatten_error_detail(v))
        return out
    if isinstance(detail, list):
        out = []
        for v in detail:
            out.extend(_flatten_error_detail(v))
        return out
    return [str(detail)]


class _OrgImportView(APIView):
    """Upload CSV/Excel để tạo/cập nhật hàng loạt (natural key: mã). Chỉ Admin/HCNS."""

    permission_classes = [IsAuthenticated, IsAdminOrHR]
    serializer_class = None
    label = ''

    def post(self, request):
        serializer = self.serializer_class(data=request.data)
        if not serializer.is_valid():
            return Response({"success": False, "errors": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = serializer.save()
        except ValidationError as exc:
            message = "; ".join(_flatten_error_detail(exc.detail))
            return Response({"success": False, "message": message}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.error("%s import failed", self.label, exc_info=True)
            return Response(
                {"success": False, "message": "Import thất bại. Vui lòng kiểm tra lại file và thử lại."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        http_status = status.HTTP_200_OK if result["failed"] == 0 else status.HTTP_207_MULTI_STATUS
        return Response({
            "success": True,
            "summary": {k: result[k] for k in ("total", "created", "updated", "failed")},
            "errors": result["errors"],
        }, status=http_status)


class DepartmentImportView(_OrgImportView):
    """POST /api-hrm/departments/import/"""
    serializer_class = DepartmentImportSerializer
    label = 'Department'


class PositionImportView(_OrgImportView):
    """POST /api-hrm/positions/import/"""
    serializer_class = PositionImportSerializer
    label = 'Position'
