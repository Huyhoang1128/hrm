"""
GET /api-hrm/salary-advance/config/ — cấu hình "Tạm ứng lương", CHỈ ĐỌC. API DUY NHẤT để web / app lấy quy
định tạm ứng — FE không tự ghi cứng con số / khung ngày / câu chữ nào.

Mọi giá trị lấy đúng từ chỗ backend dùng để kiểm tra đơn (hằng số SALARY_ADVANCE_* và các hàm trên
GenericRequestSerializer, GenericRequestViewSet._check_salary_advance_window, 2 công tắc khoá) — đổi quy
định ở backend là web hiển thị và chặn theo, không cần sửa FE.

Trả về:
  max_amount                   trần tuyệt đối (đ); null = không có trần
  max_ratio, max_ratio_percent tỷ lệ tối đa so với lương cơ bản (không có lương cơ bản: chỉ áp max_amount)
  official_contracts           loại hợp đồng được ứng (mã + nhãn); [] = không xét loại hợp đồng
  requires_probation_end       phải hết thử việc mới được ứng
  window                       khung TẠO đơn: enabled, first_day, last_day, cutoff ('HH:MM' | null),
                               text ('từ ngày 1 đến 15h30 ngày 3'), open (đang trong khung, giờ VN)
  creation_lock_supported      có công tắc mở khoá tạo đơn (creation-lock)
  creation_unlocked            Admin đang mở khoá tạo đơn ngoài khung (chỉ tháng này)
  can_create                   tạo được ngay lúc này (open hoặc đã mở khoá) — chưa xét điều kiện cá nhân
  approval_window              khung DUYỆT: enabled, first_day, last_day, text, open
  approval_window_days         [1..last_day]
  approval_unlocked            Admin đang mở khoá duyệt ngoài khung
  conditions                   điều kiện để hiển thị
  me                           của người đang đăng nhập: basic_salary_set, cap_by_ratio, cap, eligible,
                               reasons (cùng câu báo lỗi với backend khi tạo đơn)
"""
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from employee.models import Employee

from .models import GenericRequest, SalaryAdvanceApprovalLock, SalaryAdvanceCreationLock
from .serializers import GenericRequestSerializer as S


def _money(value):
    return f'{value:,}đ'.replace(',', '.')


def _my_eligibility(employee, can_create):
    """Điều kiện cá nhân khi tạo đơn — cùng thứ tự / câu báo lỗi với _validate_salary_advance."""
    basic_salary = float(employee.basic_salary or 0)
    cap_by_ratio = int(basic_salary * S.SALARY_ADVANCE_MAX_RATIO) if basic_salary > 0 else None
    cap = min(S.SALARY_ADVANCE_MAX_AMOUNT, cap_by_ratio) if cap_by_ratio else S.SALARY_ADVANCE_MAX_AMOUNT

    reasons = []
    if not can_create:
        reasons.append(f'Chỉ nhận đơn tạm ứng lương {S.salary_advance_create_window_text()} hàng tháng. '
                       'Liên hệ Admin để mở khoá nếu cần tạo đơn ngoài thời gian này.')
    if (employee.employment_status or '').upper() != 'ACTIVE':
        reasons.append('Chỉ nhân viên đang làm việc mới được tạm ứng lương.')
    if (employee.contract_type or '').upper() not in S.SALARY_ADVANCE_OFFICIAL_CONTRACTS:
        reasons.append(f'Chỉ nhân viên chính thức ({S.salary_advance_contracts_text()}) mới được tạm ứng lương.')
    if GenericRequest.objects.filter(
        employee=employee, request_type='RESIGNATION',
        status__in=['PENDING_MANAGER', 'PENDING_ADMIN', 'APPROVED'], is_deleted=False,
    ).exists():
        reasons.append('Bạn đang có đơn xin nghỉ việc, không thể tạm ứng lương.')
    now = timezone.now()
    if GenericRequest.objects.filter(
        employee=employee, request_type='SALARY_ADVANCE',
        status__in=['DRAFT', 'PENDING_MANAGER', 'PENDING_ADMIN', 'APPROVED'], is_deleted=False,
        created_at__year=now.year, created_at__month=now.month,
    ).exists():
        reasons.append('Bạn đã có đơn tạm ứng lương trong tháng này. Mỗi nhân viên chỉ được làm 1 đơn / tháng.')

    return {
        'basic_salary_set': basic_salary > 0,
        'cap_by_ratio': cap_by_ratio,
        'cap': cap,
        'eligible': not reasons,
        'reasons': reasons,
    }


def build_salary_advance_config(user):
    window_open = S.is_salary_advance_creation_window_open()
    creation_unlocked = not SalaryAdvanceCreationLock.get_solo().is_effectively_locked()
    can_create = window_open or creation_unlocked
    approval_last_day = S.SALARY_ADVANCE_APPROVAL_LAST_DAY
    pct = S.salary_advance_ratio_percent()
    employee = Employee.objects.filter(user=user).first()
    return {
        'max_amount': S.SALARY_ADVANCE_MAX_AMOUNT,
        'max_ratio': S.SALARY_ADVANCE_MAX_RATIO,
        'max_ratio_percent': pct,
        'official_contracts': [{'id': code, 'label': label} for code, label in S.salary_advance_contracts()],
        'requires_probation_end': False,
        'window': {
            'enabled': True,
            'first_day': 1,
            'last_day': S.SALARY_ADVANCE_CREATE_LAST_DAY,
            'cutoff': '%02d:%02d' % S.SALARY_ADVANCE_CREATE_CUTOFF,
            'text': S.salary_advance_create_window_text(),
            'open': window_open,
        },
        'creation_lock_supported': True,
        'creation_unlocked': creation_unlocked,
        'can_create': can_create,
        'approval_window': {
            'enabled': True,
            'first_day': 1,
            'last_day': approval_last_day,
            'text': S.salary_advance_approval_window_text(),
            'open': S.is_salary_advance_approval_window_open(),
        },
        'approval_window_days': list(range(1, approval_last_day + 1)),
        'approval_unlocked': not SalaryAdvanceApprovalLock.get_solo().is_locked,
        'conditions': [
            f'Nhân viên chính thức ({S.salary_advance_contracts_text()}), đang làm việc',
            'Không có đơn xin nghỉ việc',
            'Mỗi tháng 1 đơn',
            f'Tối đa {pct}% lương cơ bản và không quá {_money(S.SALARY_ADVANCE_MAX_AMOUNT)}',
            'Quản lý trực tiếp duyệt → HCNS duyệt cuối',
        ],
        'me': _my_eligibility(employee, can_create) if employee else None,
    }


class SalaryAdvanceConfigAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(build_salary_advance_config(request.user))
