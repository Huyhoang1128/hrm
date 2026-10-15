"""
hrm/test_employee_probation_filter.py
════════════════════════════════════
Bug: ở trang "Quản lý nhân viên", chọn filter Trạng thái = "Thử việc"
(employment_status=PROBATION) không lọc được gì (filter bị bỏ qua hoàn toàn),
vì EmployeeViewSet.get_queryset() không có nhánh nào cho 'PROBATION' — chỉ có
SUSPENDED/INACTIVE/ACTIVE. Xác nhận trên production: filter(employment_status=
'PROBATION').count() = 0 dù đang có 108 nhân sự thực sự trong hạn thử việc.

Thực chất "Thử việc" không còn là 1 giá trị hợp lệ của field employment_status
(choices chỉ còn ACTIVE/SUSPENDED/PAUSED/INACTIVE) — nó được track qua
contract_type hoặc probation_end_date. Fix:
thêm nhánh PROBATION dựa trên 2 field đó (OR).

Cập nhật 2026-10-09: ACTIVE ("Đang làm việc") GỒM cả người đang thử việc để
khớp ô thống kê và nhãn trạng thái; PROBATION là tập con đang làm việc (không
tính người thử việc đã nghỉ).
"""
import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from employee.models import Employee

from .views import EmployeeViewSet


def _queryset_for(status_param):
    """get_queryset() có thêm nhánh giới hạn theo Employee.manager cho
    Trưởng phòng, dereference self.request.user — cần 1 user thật (is_superuser)
    để nhánh đó bỏ qua giới hạn, khớp với cách admin xem trang danh sách."""
    admin_user, _ = User.objects.get_or_create(
        username='_test_admin', defaults={'is_superuser': True, 'is_staff': True}
    )
    factory = APIRequestFactory()
    django_request = factory.get('/api-hrm/employees/', {'employment_status': status_param} if status_param else {})
    view = EmployeeViewSet()
    view.request = Request(django_request)
    # Gán qua DRF Request — gán vào django_request.user bị DRF bỏ qua (ra AnonymousUser).
    view.request.user = admin_user
    view.action = 'list'
    view.format_kwarg = None
    return view.get_queryset()


class EmployeeProbationFilterTests(TestCase):
    def setUp(self):
        today = datetime.date.today()

        def make(employee_id, **kwargs):
            user = User.objects.create_user(username=f'user_{employee_id}', password='x')
            return Employee.objects.create(
                user=user, employee_id=employee_id, full_name=f'NV {employee_id}',
                gender='F', is_active=True, **kwargs,
            )

        self.active_emp = make('ACT-001', employment_status='ACTIVE')
        self.probation_by_contract = make('PROB-001', employment_status='ACTIVE', contract_type='PROBATION')
        self.probation_by_date = make(
            'PROB-002', employment_status='ACTIVE',
            probation_end_date=today + datetime.timedelta(days=10),
        )
        self.inactive_emp = make(
            'INA-001', employment_status='ACTIVE', end_date=today - datetime.timedelta(days=1),
        )
        self.suspended_emp = make('SUS-001', employment_status='SUSPENDED')
        self.paused_emp = make('PAU-001', employment_status='PAUSED')
        # Nhân viên đã hết hạn thử việc từ lâu (contract_type khác PROBATION, probation_end_date đã qua) → không tính là đang thử việc
        self.expired_probation_emp = make(
            'PROB-OLD', employment_status='ACTIVE', contract_type='ONE_YEAR',
            probation_end_date=today - datetime.timedelta(days=30),
        )

    def test_probation_filter_excludes_active_employees(self):
        """Bug gốc: filter PROBATION không được lẫn nhân viên ACTIVE thuần."""
        ids = set(_queryset_for('PROBATION').values_list('employee_id', flat=True))
        self.assertNotIn('ACT-001', ids)

    def test_probation_filter_includes_probation_by_contract_type(self):
        ids = set(_queryset_for('PROBATION').values_list('employee_id', flat=True))
        self.assertIn('PROB-001', ids)

    def test_probation_filter_includes_probation_by_end_date(self):
        ids = set(_queryset_for('PROBATION').values_list('employee_id', flat=True))
        self.assertIn('PROB-002', ids)

    def test_probation_filter_excludes_expired_probation(self):
        ids = set(_queryset_for('PROBATION').values_list('employee_id', flat=True))
        self.assertNotIn('PROB-OLD', ids)

    def test_probation_filter_excludes_suspended_and_paused(self):
        ids = set(_queryset_for('PROBATION').values_list('employee_id', flat=True))
        self.assertNotIn('SUS-001', ids)
        self.assertNotIn('PAU-001', ids)

    def test_active_filter_includes_probation_employees(self):
        """"Đang làm việc" = mọi người đang đi làm, GỒM người thử việc — khớp ô
        thống kê (case 2026-10-09: lọc ra 240, ô thống kê 319)."""
        ids = set(_queryset_for('ACTIVE').values_list('employee_id', flat=True))
        self.assertEqual(ids, {'ACT-001', 'PROB-001', 'PROB-002', 'PROB-OLD'})

    def test_probation_filter_excludes_probation_employees_who_left(self):
        today = datetime.date.today()
        user = User.objects.create_user(username='user_PROB-LEFT', password='x')
        Employee.objects.create(
            user=user, employee_id='PROB-LEFT', full_name='NV PROB-LEFT', gender='F', is_active=True,
            employment_status='ACTIVE', contract_type='PROBATION', end_date=today - datetime.timedelta(days=5),
        )
        ids = set(_queryset_for('PROBATION').values_list('employee_id', flat=True))
        self.assertEqual(ids, {'PROB-001', 'PROB-002'})

    def test_stats_match_list_filters(self):
        today = datetime.date.today()
        user = User.objects.create_user(username='user_PROB-LEFT2', password='x')
        Employee.objects.create(
            user=user, employee_id='PROB-LEFT2', full_name='NV', gender='F', is_active=True,
            employment_status='ACTIVE', contract_type='PROBATION', end_date=today - datetime.timedelta(days=5),
        )
        admin_user, _ = User.objects.get_or_create(
            username='_test_admin', defaults={'is_superuser': True, 'is_staff': True}
        )
        view = EmployeeViewSet()
        view.request = Request(APIRequestFactory().get('/api-hrm/employees/stats/'))
        view.request.user = admin_user
        view.format_kwarg = None
        data = view.stats(view.request).data
        self.assertEqual(data['active'], _queryset_for('ACTIVE').count())
        self.assertEqual(data['probation'], _queryset_for('PROBATION').count())
