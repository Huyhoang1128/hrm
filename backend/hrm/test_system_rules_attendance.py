"""Quy định chấm công / tăng ca trả cho web (hrm/system_rules/attendance.py) phải lấy ĐÚNG giá trị
backend dùng khi kiểm tra — web đọc API này thay vì ghi cứng số."""
import datetime
from types import SimpleNamespace

from django.contrib.auth.models import User
from django.test import TestCase

from employee.models import Employee
from hrm.overtime_reconciliation import OT_MIN_DURATION_MINUTES, OT_MIN_DURATION_TYPES
from hrm.registration_serializers import RegistrationRequestCreateSerializer
from hrm.system_rules import build_rules


def _admin_request():
    user, _ = User.objects.get_or_create(
        username='_rules_att_admin', defaults={'is_staff': True, 'is_superuser': True},
    )
    return SimpleNamespace(user=user)


class OvertimeRulesTests(TestCase):
    def setUp(self):
        user = User.objects.create_user(username='_rules_att_emp', password='x')
        self.employee = Employee.objects.create(
            user=user, employee_id='RATT-1', full_name='NV Rules', gender='F', is_active=True,
        )

    def _validate(self, reg_type, start, end):
        serializer = RegistrationRequestCreateSerializer(
            data={
                'employee_id': self.employee.id,
                'attendance_date': str(datetime.date.today()),
                'registration_type': reg_type,
                'start_time': start,
                'end_time': end,
                'reason': 'test',
            },
            context={'request': _admin_request()},
        )
        serializer.is_valid()
        return serializer.errors

    def test_section_matches_constants(self):
        rules = build_rules(None, {'overtime'})
        # Section không public: chưa đăng nhập không có.
        self.assertNotIn('overtime', rules)
        section = build_rules(_admin_request(), {'overtime'})['overtime']
        self.assertEqual(section['min_minutes'], OT_MIN_DURATION_MINUTES)
        self.assertEqual(section['min_applies_to'], list(OT_MIN_DURATION_TYPES))

    def test_minimum_applies_only_to_listed_types(self):
        """Web chỉ chặn sàn cho min_applies_to — backend cũng phải đúng như vậy."""
        short_end = (
            datetime.datetime.combine(datetime.date.today(), datetime.time(18, 0))
            + datetime.timedelta(minutes=OT_MIN_DURATION_MINUTES - 10)
        ).strftime('%H:%M')
        self.assertIn('OVERTIME', OT_MIN_DURATION_TYPES)
        self.assertIn('hours', self._validate('OVERTIME', '18:00', short_end))
        self.assertNotIn('EXTRA_HOURS', OT_MIN_DURATION_TYPES)
        self.assertNotIn('hours', self._validate('EXTRA_HOURS', '18:00', short_end))
