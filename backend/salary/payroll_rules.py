"""
Quy định tiền lương dùng chung — NGUỒN DUY NHẤT cho cả tính lương (hrm/finalization_views.py
build_salary_row, salary/payslip.py) lẫn web (hrm/system_rules/payroll.py → GET
/api-hrm/system-rules/?sections=payroll).

Trước đây web tự ghi cứng tỷ lệ BH, biểu thuế, giảm trừ gia cảnh, lương cơ sở / tối thiểu vùng...
nên khi backend (hoặc cấu hình bảng thuế trong DB) đổi thì web vẫn tính theo số cũ. Đổi số ở đây
là cả bảng lương lẫn web theo — KHÔNG chép các số này sang chỗ khác.
"""
import datetime as dt
from dataclasses import dataclass
from decimal import Decimal

# ── Bảo hiểm bắt buộc phần người lao động ────────────────────────────────────
# Tính trên mức lương đóng BH; trừ vào lương (phiếu lương) và trừ khi tính thuế TNCN.
EMPLOYEE_BHXH_RATE = Decimal('0.08')
EMPLOYEE_BHYT_RATE = Decimal('0.015')
EMPLOYEE_BHTN_RATE = Decimal('0.01')
EMPLOYEE_INSURANCE_RATE = EMPLOYEE_BHXH_RATE + EMPLOYEE_BHYT_RATE + EMPLOYEE_BHTN_RATE  # 0.105

# Mức lương đóng BH tối đa = hệ số × lương cơ sở (BHXH, BHYT) / × lương tối thiểu vùng (BHTN).
# CHỈ phần xem trước cấu hình lương trên web dùng; bảng lương hiện KHÔNG áp trần này (mức đóng
# lấy nguyên theo kỳ đóng BH của nhân viên) — áp trần vào bảng lương là quyết định nghiệp vụ riêng.
INSURANCE_SALARY_CAP_MULTIPLIER = 20

# ── Thuế TNCN ────────────────────────────────────────────────────────────────
# Khấu trừ cố định (thử việc / HĐ không chính thức / có công chính thức < 14 ngày mà không đóng BH):
# thuế = tỷ lệ này × tổng thu nhập chịu thuế, không giảm trừ gia cảnh.
FLAT_TAX_RATE = Decimal('0.10')

# Từ kỳ thuế này áp biểu 5 bậc + giảm trừ gia cảnh mới (khi DB chưa cấu hình TaxBracketConfig).
NEW_PIT_LAW_YEAR = 2026

_DEFAULT_TAX_BRACKETS_NEW = (
    (Decimal('0'), Decimal('10000000'), Decimal('0.05')),
    (Decimal('10000000'), Decimal('30000000'), Decimal('0.10')),
    (Decimal('30000000'), Decimal('60000000'), Decimal('0.20')),
    (Decimal('60000000'), Decimal('100000000'), Decimal('0.30')),
    (Decimal('100000000'), None, Decimal('0.35')),
)
_DEFAULT_TAX_BRACKETS_LEGACY = (
    (Decimal('0'), Decimal('5000000'), Decimal('0.05')),
    (Decimal('5000000'), Decimal('10000000'), Decimal('0.10')),
    (Decimal('10000000'), Decimal('18000000'), Decimal('0.15')),
    (Decimal('18000000'), Decimal('32000000'), Decimal('0.20')),
    (Decimal('32000000'), Decimal('52000000'), Decimal('0.25')),
    (Decimal('52000000'), Decimal('80000000'), Decimal('0.30')),
    (Decimal('80000000'), None, Decimal('0.35')),
)
# (giảm trừ bản thân, giảm trừ mỗi người phụ thuộc) / tháng
_DEFAULT_FAMILY_DEDUCTIONS_NEW = (Decimal('15500000'), Decimal('6200000'))
_DEFAULT_FAMILY_DEDUCTIONS_LEGACY = (Decimal('11000000'), Decimal('4400000'))

# ── Bảng lương theo luật chỉ phần xem trước cấu hình lương dùng ──────────────
# Mới nhất trước; effective_from=None = áp cho mọi ngày trước mốc của dòng phía trên.
BASE_SALARY_HISTORY = (
    {'effective_from': dt.date(2024, 7, 1), 'amount': Decimal('2340000')},
    {'effective_from': None, 'amount': Decimal('1800000')},
)
REGIONAL_MINIMUM_HISTORY = (
    {'effective_from': dt.date(2026, 1, 1), 'legal_basis': 'NĐ 293/2025/NĐ-CP',
     'by_region': {'I': Decimal('5310000'), 'II': Decimal('4730000'),
                   'III': Decimal('4140000'), 'IV': Decimal('3700000')}},
    {'effective_from': None, 'legal_basis': '',
     'by_region': {'I': Decimal('4960000'), 'II': Decimal('4410000'),
                   'III': Decimal('3860000'), 'IV': Decimal('3450000')}},
)

# ── Phụ cấp ──────────────────────────────────────────────────────────────────
# Trần phụ cấp ăn trưa / tháng (không tính thuế). Trần riêng của nhân viên
# (lunchAllowancePolicy.monthly_cap) để trống hoặc 0 = dùng trần này; lớn hơn thì bị hạ về trần này.
MAX_LUNCH_ALLOWANCE_CAP = Decimal('500000')

# ── Tăng ca ──────────────────────────────────────────────────────────────────
# Đơn giá OT tính từ lương (OvertimeRateConfig calc_method=FROM_BASIC):
# lương cơ bản ÷ công chuẩn ÷ số giờ này.
OT_HOURS_PER_DAY = Decimal('7.5')


def default_tax_brackets(year: int) -> list:
    """Biểu thuế mặc định theo kỳ thuế (khi DB chưa có bậc thuế)."""
    table = _DEFAULT_TAX_BRACKETS_NEW if year >= NEW_PIT_LAW_YEAR else _DEFAULT_TAX_BRACKETS_LEGACY
    return [{'min': lower, 'max': upper, 'rate': rate} for lower, upper, rate in table]


def default_family_deductions(year: int) -> tuple:
    """(giảm trừ bản thân, giảm trừ mỗi người phụ thuộc) mặc định theo kỳ thuế."""
    return _DEFAULT_FAMILY_DEDUCTIONS_NEW if year >= NEW_PIT_LAW_YEAR else _DEFAULT_FAMILY_DEDUCTIONS_LEGACY


@dataclass(frozen=True)
class TaxPolicy:
    """Biểu thuế + giảm trừ gia cảnh áp cho 1 ngày tính lương."""
    personal_deduction: Decimal
    dependent_deduction: Decimal
    brackets: tuple          # mỗi bậc {'min', 'max' (None = không giới hạn), 'rate'}
    source: str              # 'config' (bậc thuế cấu hình trong DB) | 'default' (biểu mặc định theo năm)
    config: object = None    # TaxBracketConfig đang áp (có thể chỉ cấu hình giảm trừ, chưa có bậc)


def resolve_tax_policy(calc_date: dt.date) -> TaxPolicy:
    """Biểu thuế bảng lương dùng cho ngày calc_date (cuối tháng lương).

    - TaxBracketConfig hiệu lực tại ngày đó (không có thì bảng đang bật) quyết định giảm trừ gia
      cảnh — kể cả khi bảng đó chưa có bậc thuế. Lưu ý: model mặc định 11tr / 4,4tr (luật cũ).
    - Bậc thuế lấy từ bảng đó nếu có, ngược lại theo biểu mặc định của kỳ thuế.
    """
    from .salary_data_models import TaxBracketConfig

    cfg = TaxBracketConfig.get_for_date(calc_date) or TaxBracketConfig.get_active()
    personal, dependent = default_family_deductions(calc_date.year)
    db_brackets = []
    if cfg:
        personal, dependent = cfg.personal_deduction, cfg.dependent_deduction
        db_brackets = [{'min': b.min_income, 'max': b.max_income, 'rate': b.rate}
                       for b in cfg.brackets.order_by('order')]
    if db_brackets:
        return TaxPolicy(personal, dependent, tuple(db_brackets), 'config', cfg)
    return TaxPolicy(personal, dependent, tuple(default_tax_brackets(calc_date.year)), 'default', cfg)


def progressive_tax_breakdown(taxable_income: Decimal, brackets) -> list:
    """Thuế luỹ tiến theo từng bậc: [{bac, tu, den, thue_suat, thu_nhap_trong_bac, thue}].
    Tổng thuế = tổng 'thue' (Decimal)."""
    result = []
    if taxable_income <= Decimal('0'):
        return result
    for number, bracket in enumerate(brackets, start=1):
        lower, upper, rate = bracket['min'], bracket['max'], bracket['rate']
        if taxable_income <= lower:
            break
        amount = taxable_income - lower if upper is None else min(taxable_income, upper) - lower
        if amount <= Decimal('0'):
            continue
        result.append({'bac': number, 'tu': lower, 'den': upper, 'thue_suat': rate,
                       'thu_nhap_trong_bac': amount, 'thue': amount * rate})
    return result


def is_flat_tax_method(tax_method) -> bool:
    """Mọi phương pháp FLAT_* (FLAT_10_PROBATION, FLAT_10_NON_OFFICIAL, FLAT_10_MIXED_LT14...)."""
    return str(tax_method or '').upper().startswith('FLAT_')


def history_value_for_date(history, day: dt.date) -> dict:
    """Dòng của bảng *_HISTORY áp cho ngày `day` (bảng sắp mới nhất trước)."""
    for entry in history:
        if entry['effective_from'] is None or entry['effective_from'] <= day:
            return entry
    return history[-1]
