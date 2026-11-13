"""Section quy định: Lương, bảo hiểm, thuế TNCN, phụ cấp, tăng ca (tiền).

Xem hrm/system_rules/__init__.py. Mỗi hàm @rule_section trả dict, giá trị lấy từ đúng chỗ backend dùng.

Dòng bảng lương / phiếu lương đã có sẵn mọi số (thực lĩnh, BH, thuế từng bậc...) — web KHÔNG tính lại
bảng lương. Section này chỉ phục vụ phần "xem trước" khi cấu hình lương 1 nhân viên và câu chữ giải
thích, để web không ghi cứng tỷ lệ / biểu thuế / lương cơ sở...
Công chuẩn của 1 tháng cụ thể KHÔNG ở đây: GET /api/v1/salary/records/standard-days/?year=&month=.
"""
from django.utils import timezone

from . import rule_section


def _money(value):
    return float(value) if value is not None else None


def _date(value):
    return value.isoformat() if value else None


@rule_section('payroll')
def payroll_rules(request):
    from hrm.attendance_engine import PolicyLoader
    from salary.payroll_rules import (
        BASE_SALARY_HISTORY,
        EMPLOYEE_BHTN_RATE,
        EMPLOYEE_BHXH_RATE,
        EMPLOYEE_BHYT_RATE,
        EMPLOYEE_INSURANCE_RATE,
        FLAT_TAX_RATE,
        INSURANCE_SALARY_CAP_MULTIPLIER,
        MAX_LUNCH_ALLOWANCE_CAP,
        OT_HOURS_PER_DAY,
        REGIONAL_MINIMUM_HISTORY,
        resolve_tax_policy,
    )

    today = timezone.localdate()
    # Đúng hàm bảng lương dùng (TaxBracketConfig trong DB, không có thì biểu mặc định theo năm).
    tax = resolve_tax_policy(today)
    # Mức gửi xe/ngày của chính sách chấm công đang áp — cùng nguồn với ParkingAllowanceRule khi chốt công.
    attendance_policy = PolicyLoader.load(today)['policy']
    return {
        # Tỷ lệ BH phần người lao động (trừ vào lương, trừ khi tính thuế)
        'insurance_rates': {
            'bhxh': float(EMPLOYEE_BHXH_RATE),
            'bhyt': float(EMPLOYEE_BHYT_RATE),
            'bhtn': float(EMPLOYEE_BHTN_RATE),
            'total': float(EMPLOYEE_INSURANCE_RATE),
        },
        # Trần mức lương đóng BH = hệ số × lương cơ sở (BHXH, BHYT) / × lương tối thiểu vùng (BHTN).
        # Chỉ phần xem trước dùng — bảng lương hiện không áp trần.
        'insurance_salary_cap_multiplier': INSURANCE_SALARY_CAP_MULTIPLIER,
        # Thuế khấu trừ cố định (mọi phương pháp FLAT_*)
        'flat_tax_rate': float(FLAT_TAX_RATE),
        # Biểu thuế + giảm trừ gia cảnh bảng lương áp cho hôm nay
        'tax': {
            'as_of': today.isoformat(),
            'source': tax.source,
            'personal_deduction': float(tax.personal_deduction),
            'dependent_deduction': float(tax.dependent_deduction),
            'brackets': [
                {'min': _money(b['min']), 'max': _money(b['max']), 'rate': float(b['rate'])}
                for b in tax.brackets
            ],
        },
        # Lương cơ sở / lương tối thiểu vùng theo ngày hiệu lực (mới nhất trước; effective_from null =
        # áp cho mọi ngày trước mốc của dòng phía trên)
        'base_salary_history': [
            {'effective_from': _date(e['effective_from']), 'amount': float(e['amount'])}
            for e in BASE_SALARY_HISTORY
        ],
        'regional_minimum_history': [
            {
                'effective_from': _date(e['effective_from']),
                'legal_basis': e['legal_basis'],
                'by_region': {region: float(amount) for region, amount in e['by_region'].items()},
            }
            for e in REGIONAL_MINIMUM_HISTORY
        ],
        # Trần PC ăn trưa/tháng; trần riêng của nhân viên để trống / 0 = dùng trần này
        'lunch_allowance_max_cap': float(MAX_LUNCH_ALLOWANCE_CAP),
        # Mức gửi xe/ngày mặc định (gợi ý khi chọn "Vé ngày" lúc cấu hình lương)
        'parking_allowance_per_day': float(attendance_policy['parking_allowance_per_day']),
        # Đơn giá OT tính từ lương: lương cơ bản ÷ công chuẩn ÷ số giờ này
        'ot_hours_per_day': float(OT_HOURS_PER_DAY),
    }
