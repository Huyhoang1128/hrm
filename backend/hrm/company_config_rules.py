"""Giới hạn các ô số của Cấu hình công ty (CompanyConfig) — NGUỒN DUY NHẤT.

Trước đây giá trị mặc định / min / max nằm cứng ở form web (CompanyConfigCreate/Edit) và lệch backend
(vd nghỉ ốm web 12 vs model 5, hệ số OT web cho tới 10 trong khi cột chỉ chứa tối đa 9.99), backend
lại không kiểm tra khoảng giá trị.

- CompanyConfigSerializer kiểm tra theo field_rules().
- Web đọc cùng field_rules() qua GET /api-hrm/system-rules/ (section "hr", key company_config_fields)
  để điền giá trị mặc định khi tạo mới và đặt min / max / step cho ô nhập.
- Mặc định lấy từ default của field model; max của DecimalField nếu không đặt riêng thì lấy theo
  max_digits / decimal_places; step = 10^-decimal_places (số nguyên: 1).
"""
from decimal import Decimal

from django.db import models

# Khoảng giá trị nghiệp vụ (giữ đúng khoảng form web đang cho nhập). Không có 'max' -> theo cột DB.
NUMERIC_LIMITS = {
    'default_working_hours_per_day': {'min': 1, 'max': 24},
    'default_working_days_per_week': {'min': 1, 'max': 7},
    'overtime_multiplier_weekday': {'min': 1},
    'overtime_multiplier_weekend': {'min': 1},
    'overtime_multiplier_holiday': {'min': 1},
    'late_threshold_minutes': {'min': 0, 'max': 240},
    'early_leave_threshold_minutes': {'min': 0, 'max': 240},
    'half_day_threshold_hours': {'min': 0, 'max': 12},
    'annual_leave_days_per_year': {'min': 0, 'max': 365},
    'sick_leave_days_per_year': {'min': 0, 'max': 365},
    'maternity_leave_days': {'min': 0, 'max': 365},
    'paternity_leave_days': {'min': 0, 'max': 365},
    'max_explanation_count_per_month': {'min': 0, 'max': 100},
    'max_late_explanation_per_month': {'min': 0, 'max': 100},
    'max_early_leave_explanation_per_month': {'min': 0, 'max': 100},
    'max_incomplete_attendance_explanation_per_month': {'min': 0, 'max': 100},
    'manager_combined_explanation_quota': {'min': 0, 'max': 100},
    'manager_incomplete_explanation_quota': {'min': 0, 'max': 100},
    'supplement_work_hours_per_month': {'min': 0, 'max': 200},
    'max_leave_count_per_month': {'min': 0},
    'max_online_work_count_per_month': {'min': 0},
}


def _number(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _numeric_fields():
    from .models import CompanyConfig
    for field in CompanyConfig._meta.concrete_fields:
        if field.primary_key or not field.editable:
            continue
        if isinstance(field, (models.IntegerField, models.DecimalField)):
            yield field


_POSITIVE_FIELDS = (models.PositiveIntegerField, models.PositiveSmallIntegerField, models.PositiveBigIntegerField)


def _raw_rules():
    out = {}
    for field in _numeric_fields():
        limits = NUMERIC_LIMITS.get(field.name, {})
        if isinstance(field, models.DecimalField):
            step = Decimal(1).scaleb(-field.decimal_places)
            column_max = Decimal(10) ** (field.max_digits - field.decimal_places) - step
            max_value = min(Decimal(str(limits['max'])), column_max) if 'max' in limits else column_max
        else:
            step = 1
            max_value = limits.get('max')
        min_value = limits.get('min')
        if min_value is None and isinstance(field, _POSITIVE_FIELDS):
            min_value = 0
        out[field.name] = {
            'default': field.default if field.has_default() else None,
            'min': min_value,
            'max': max_value,
            'step': step,
            'nullable': field.null,
        }
    return out


def field_rules():
    """{tên field: {default, min, max, step, nullable}} cho mọi ô số sửa được của CompanyConfig (JSON)."""
    return {
        name: {key: (val if key == 'nullable' else _number(val)) for key, val in rule.items()}
        for name, rule in _raw_rules().items()
    }


def validate_values(attrs):
    """Lỗi {field: thông báo} cho các giá trị ngoài khoảng cho phép."""
    errors = {}
    for name, rule in _raw_rules().items():
        if name not in attrs or attrs[name] is None:
            continue
        value = Decimal(str(attrs[name]))
        if rule['min'] is not None and value < Decimal(str(rule['min'])):
            errors[name] = f'Giá trị tối thiểu là {_number(rule["min"])}.'
        elif rule['max'] is not None and value > Decimal(str(rule['max'])):
            errors[name] = f'Giá trị tối đa là {_number(rule["max"])}.'
    return errors
