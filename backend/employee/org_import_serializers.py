"""
Serializer và logic xử lý import Phòng ban / Vị trí từ file CSV/Excel hàng loạt.

Tái sử dụng các helper chuẩn hoá (_normalize_header, _safe_str, _safe_int,
_safe_bool) từ import_serializers.py — nơi các vấn đề NFD/NFC, khoảng trắng lạ,
và việc chọn nhầm sheet trong file nhiều sheet đã được xử lý khi làm tính năng
import nhân viên, tránh lặp lại đúng những lỗi đã từng gặp ở đó.

Natural key để tạo-hoặc-cập-nhật: `code` (đã unique=True trên cả 2 model).
"""
import io
import os
import re
import logging
import traceback

import pandas as pd
from rest_framework import serializers
from django.db import transaction

from .models import Department, Position, Employee
from .import_serializers import _normalize_header, _safe_str, _safe_int, _safe_bool

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Phòng ban
# ---------------------------------------------------------------------------
DEPARTMENT_COLUMN_MAP = {
    "mã phòng ban": "code",
    "ma phong ban": "code",
    "code": "code",
    "tên phòng ban": "name",
    "phòng ban": "name",
    "name": "name",
    "mô tả": "description",
    "description": "description",
    "phòng ban cha": "parent_department_code",
    "mã phòng ban cha": "parent_department_code",
    "trưởng phòng": "manager_employee_id",
    "mã trưởng phòng": "manager_employee_id",
    "mã nhân viên trưởng phòng": "manager_employee_id",
}
_DEPARTMENT_COLUMN_MAP_NORM = {_normalize_header(k): v for k, v in DEPARTMENT_COLUMN_MAP.items()}


# ---------------------------------------------------------------------------
# Vị trí
# ---------------------------------------------------------------------------
POSITION_COLUMN_MAP = {
    "mã vị trí": "code",
    "ma vi tri": "code",
    "code": "code",
    "chức danh": "title",
    "tên vị trí": "title",
    "title": "title",
    "mô tả": "description",
    "description": "description",
    "phòng ban": "department_codes",
    "mã phòng ban": "department_codes",
    "cấp bậc": "level",
    "level": "level",
    "vị trí cấp trên": "parent_position_code",
    "mã vị trí cấp trên": "parent_position_code",
    "vị trí quản lý": "is_management",
    "là vị trí quản lý": "is_management",
    "is_management": "is_management",
}
_POSITION_COLUMN_MAP_NORM = {_normalize_header(k): v for k, v in POSITION_COLUMN_MAP.items()}


_HINT_SUFFIX = re.compile(r"\s*\([^()]*\)\s*$")


def _header_key(col):
    """Khoá so khớp tiêu đề cột: chuẩn hoá + bỏ phần chú thích trong ngoặc ở cuối,
    vd "Phòng ban cha (mã)" / "Vị trí quản lý (x = có)" như trong file mẫu."""
    return _normalize_header(_HINT_SUFFIX.sub("", str(col)))


def _read_dataframe(file, column_map_norm, required_field):
    """Đọc CSV/Excel, quét toàn bộ sheet và chọn sheet đầu tiên có cột khớp được
    `required_field` (giống cách xử lý import nhân viên) — tránh đọc nhầm sheet khi
    workbook có nhiều sheet (hướng dẫn, sheet cũ...) nằm trước sheet dữ liệu thật.
    """
    ext = os.path.splitext(file.name)[1].lower()
    content = file.read()
    if ext == ".csv":
        df = pd.read_csv(io.BytesIO(content), header=0, dtype=str)
        df.columns = [str(c).strip() for c in df.columns]
        return df, None
    if ext not in (".xlsx", ".xls"):
        raise ValueError(f"Định dạng file không được hỗ trợ: {ext}")

    all_sheets = pd.read_excel(io.BytesIO(content), header=0, dtype=str, sheet_name=None)
    if not all_sheets:
        raise ValueError("File Excel không có sheet nào.")

    chosen_name, chosen_df = next(iter(all_sheets.items()))
    for name, sheet_df in all_sheets.items():
        cols = [str(c).strip() for c in sheet_df.columns]
        if any(column_map_norm.get(_header_key(c)) == required_field for c in cols):
            chosen_name, chosen_df = name, sheet_df
            break

    chosen_df.columns = [str(c).strip() for c in chosen_df.columns]
    return chosen_df, chosen_name


def _map_columns(df, column_map_norm):
    field_series = {}
    for col in df.columns:
        field = column_map_norm.get(_header_key(col))
        if field and field not in field_series:
            field_series[field] = df[col]
    return field_series


class DepartmentImportSerializer(serializers.Serializer):
    """Nhận file CSV/Excel, tạo/cập nhật Phòng ban hàng loạt (natural key = code)."""

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
            df, sheet_name = _read_dataframe(file, _DEPARTMENT_COLUMN_MAP_NORM, "code")
        except Exception:
            logger.error("Cannot read department import file", exc_info=True)
            raise serializers.ValidationError(
                "Không đọc được file. Vui lòng kiểm tra định dạng và thử lại."
            )

        field_series = _map_columns(df, _DEPARTMENT_COLUMN_MAP_NORM)

        if "code" not in field_series or "name" not in field_series:
            detected = ", ".join(f"'{c}'" for c in df.columns) or "(không đọc được cột nào)"
            sheet_info = f" Đang đọc sheet '{sheet_name}'." if sheet_name else ""
            raise serializers.ValidationError(
                "File thiếu cột 'Mã phòng ban' hoặc 'Tên phòng ban'. "
                f"{sheet_info} Các cột phát hiện được trong file: {detected}"
            )

        rows = [
            {field: series.iloc[i] for field, series in field_series.items()}
            for i in range(len(df))
        ]

        summary = {"total": len(rows), "created": 0, "updated": 0, "failed": 0, "errors": []}

        dept_cache = {d.code: d for d in Department.objects.filter(is_section=False)}
        emp_cache = {e.employee_id: e for e in Employee.objects.all()}

        for idx, row in enumerate(rows):
            row_num = idx + 2  # dòng 1 = header
            code = _safe_str(row.get("code"))
            name = _safe_str(row.get("name"))
            try:
                if not code:
                    summary["errors"].append({
                        "row": row_num, "code": None,
                        "warnings": ["Dòng không có mã phòng ban, bỏ qua."],
                    })
                    continue
                if not name:
                    summary["failed"] += 1
                    summary["errors"].append({
                        "row": row_num, "code": code, "errors": ["Thiếu tên phòng ban."],
                    })
                    continue

                description = _safe_str(row.get("description")) or ""

                parent = None
                parent_code = _safe_str(row.get("parent_department_code"))
                if parent_code:
                    parent = dept_cache.get(parent_code)
                    if not parent:
                        summary["errors"].append({
                            "row": row_num, "code": code,
                            "warnings": [f"Không tìm thấy phòng ban cha có mã '{parent_code}', bỏ qua liên kết."],
                        })

                manager = None
                manager_id = _safe_str(row.get("manager_employee_id"))
                if manager_id:
                    manager = emp_cache.get(manager_id)
                    if not manager:
                        summary["errors"].append({
                            "row": row_num, "code": code,
                            "warnings": [f"Không tìm thấy nhân viên có mã '{manager_id}' để làm trưởng phòng."],
                        })

                with transaction.atomic():
                    existing = dept_cache.get(code)
                    if existing:
                        if existing.is_deleted:
                            # Import lại mã của phòng ban đã xoá mềm = dùng lại phòng ban đó
                            existing.is_deleted = False
                            existing.deleted_at = None
                            existing.deleted_by = None
                            summary["errors"].append({
                                "row": row_num, "code": code,
                                "warnings": [f"Phòng ban '{code}' đã bị xoá trước đó — đã khôi phục."],
                            })
                        existing.name = name
                        if description:
                            existing.description = description
                        if parent is not None:
                            existing.parent_department = parent
                        if manager is not None:
                            existing.manager = manager
                        existing.is_section = False
                        existing.clean()
                        existing.save()
                        summary["updated"] += 1
                        dept_cache[code] = existing
                    else:
                        new_dept = Department(
                            code=code, name=name, description=description,
                            parent_department=parent, manager=manager, is_section=False,
                        )
                        new_dept.clean()
                        new_dept.save()
                        summary["created"] += 1
                        dept_cache[code] = new_dept

            except Exception as exc:
                logger.warning(f"Import department row {row_num} failed: {exc}\n{traceback.format_exc()}")
                summary["failed"] += 1
                summary["errors"].append({"row": row_num, "code": code, "errors": [str(exc)]})

        return summary


class PositionImportSerializer(serializers.Serializer):
    """Nhận file CSV/Excel, tạo/cập nhật Vị trí hàng loạt (natural key = code)."""

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
            df, sheet_name = _read_dataframe(file, _POSITION_COLUMN_MAP_NORM, "code")
        except Exception:
            logger.error("Cannot read position import file", exc_info=True)
            raise serializers.ValidationError(
                "Không đọc được file. Vui lòng kiểm tra định dạng và thử lại."
            )

        field_series = _map_columns(df, _POSITION_COLUMN_MAP_NORM)

        if "code" not in field_series or "title" not in field_series:
            detected = ", ".join(f"'{c}'" for c in df.columns) or "(không đọc được cột nào)"
            sheet_info = f" Đang đọc sheet '{sheet_name}'." if sheet_name else ""
            raise serializers.ValidationError(
                "File thiếu cột 'Mã vị trí' hoặc 'Chức danh'. "
                f"{sheet_info} Các cột phát hiện được trong file: {detected}"
            )

        rows = [
            {field: series.iloc[i] for field, series in field_series.items()}
            for i in range(len(df))
        ]

        summary = {"total": len(rows), "created": 0, "updated": 0, "failed": 0, "errors": []}

        pos_cache = {p.code: p for p in Position.objects.all()}
        dept_cache = {d.code: d for d in Department.objects.filter(is_deleted=False)}

        for idx, row in enumerate(rows):
            row_num = idx + 2  # dòng 1 = header
            code = _safe_str(row.get("code"))
            title = _safe_str(row.get("title"))
            try:
                if not code:
                    summary["errors"].append({
                        "row": row_num, "code": None,
                        "warnings": ["Dòng không có mã vị trí, bỏ qua."],
                    })
                    continue
                if not title:
                    summary["failed"] += 1
                    summary["errors"].append({
                        "row": row_num, "code": code, "errors": ["Thiếu chức danh."],
                    })
                    continue

                description = _safe_str(row.get("description")) or ""
                level = _safe_int(row.get("level"))
                is_management = _safe_bool(row.get("is_management"))

                departments = []
                missing_dept_codes = []
                dept_codes_raw = _safe_str(row.get("department_codes"))
                if dept_codes_raw:
                    for dc in re.split(r"[,;/]", dept_codes_raw):
                        dc = dc.strip()
                        if not dc:
                            continue
                        dept = dept_cache.get(dc)
                        if dept:
                            departments.append(dept)
                        else:
                            missing_dept_codes.append(dc)
                if missing_dept_codes:
                    summary["errors"].append({
                        "row": row_num, "code": code,
                        "warnings": [f"Không tìm thấy phòng ban có mã: {', '.join(missing_dept_codes)}."],
                    })

                parent = None
                parent_code = _safe_str(row.get("parent_position_code"))
                if parent_code:
                    parent = pos_cache.get(parent_code)
                    if not parent:
                        summary["errors"].append({
                            "row": row_num, "code": code,
                            "warnings": [f"Không tìm thấy vị trí cấp trên có mã '{parent_code}'."],
                        })

                with transaction.atomic():
                    existing = pos_cache.get(code)
                    if existing:
                        existing.title = title
                        if description:
                            existing.description = description
                        if level is not None:
                            existing.level = level
                        if is_management is not None:
                            existing.is_management = is_management
                        if parent is not None:
                            existing.parent_position = parent
                        existing.clean()
                        existing.save()
                        if departments:
                            existing.department.set(departments)
                        summary["updated"] += 1
                        pos_cache[code] = existing
                    else:
                        new_pos = Position(
                            code=code, title=title, description=description,
                            level=level if level is not None else 1,
                            is_management=bool(is_management), parent_position=parent,
                        )
                        new_pos.clean()
                        new_pos.save()
                        if departments:
                            new_pos.department.set(departments)
                        summary["created"] += 1
                        pos_cache[code] = new_pos

            except Exception as exc:
                logger.warning(f"Import position row {row_num} failed: {exc}\n{traceback.format_exc()}")
                summary["failed"] += 1
                summary["errors"].append({"row": row_num, "code": code, "errors": [str(exc)]})

        return summary
