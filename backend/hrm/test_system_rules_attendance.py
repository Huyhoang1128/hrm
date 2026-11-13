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


class PenaltyPolicyRulesTests(TestCase):
    """Bảng "Quy định kỷ luật" ở trang Chấm công dựng từ attendance.penalty_policy."""

    def setUp(self):
        from hrm.attendance_engine import PolicyLoader
        PolicyLoader.clear_cache()
        self.addCleanup(PolicyLoader.clear_cache)

    def _section(self):
        return build_rules(_admin_request(), {'attendance'})['attendance']

    def test_defaults_match_engine(self):
        from hrm.attendance_engine import _DEFAULT_PENALTY_TABLE, _DEFAULT_POLICY
        from hrm.penalty_config import PENALTY_AMOUNT_PER_VIOLATION

        section = self._section()
        policy = section['penalty_policy']
        self.assertIsNone(policy['effective_from'])
        self.assertEqual(
            [(t['max_minutes'], t['fine_regular'], t['fine_manager'], t['work_deduction']) for t in policy['tiers']],
            list(_DEFAULT_PENALTY_TABLE),
        )
        self.assertEqual(policy['multiplier_threshold'], _DEFAULT_POLICY['penalty_multiplier_threshold'])
        self.assertEqual(policy['incomplete_over_quota_deduction'], _DEFAULT_POLICY['incomplete_over_quota_deduction'])
        self.assertEqual(section['unreported_absence_penalty'], PENALTY_AMOUNT_PER_VIOLATION)

    def test_configured_policy_is_returned(self):
        from hrm.attendance_models import AttendancePolicyConfig, AttendancePolicyVersion, PenaltyTierConfig

        version = AttendancePolicyVersion.objects.create(
            version_code='vtest', name='Test', effective_from=datetime.date(2025, 1, 1), is_active=True,
        )
        PenaltyTierConfig.objects.create(version=version, order=1, max_minutes=15,
                                         fine_amount_regular=70_000, fine_amount_manager=90_000)
        PenaltyTierConfig.objects.create(version=version, order=2, max_minutes=None, deduct_work_credit=1)
        AttendancePolicyConfig.objects.create(version=version, penalty_multiplier_threshold=5,
                                              incomplete_no_expl_deduction=0.5)
        policy = self._section()['penalty_policy']
        self.assertEqual(policy['version_code'], 'vtest')
        self.assertEqual(policy['effective_from'], '2025-01-01')
        self.assertEqual(policy['tiers'], [
            {'max_minutes': 15, 'fine_regular': 70_000, 'fine_manager': 90_000, 'work_deduction': 0.0},
            {'max_minutes': None, 'fine_regular': 0, 'fine_manager': 0, 'work_deduction': 1.0},
        ])
        self.assertEqual(policy['multiplier_threshold'], 5)
        self.assertEqual(policy['incomplete_no_expl_deduction'], 0.5)


class FullDayHoursThresholdTests(TestCase):
    def test_section_uses_engine_constant(self):
        from hrm.shift_config_utils import FULL_DAY_HOURS_THRESHOLD, shift_workday

        section = build_rules(_admin_request(), {'attendance'})['attendance']
        self.assertEqual(section['full_day_hours_threshold'], FULL_DAY_HOURS_THRESHOLD)
        # shift_workday dùng cùng hằng số (ca > ngưỡng -> 1.0 công)
        self.assertEqual(shift_workday(SimpleNamespace(fixed_workday=None, working_hours=FULL_DAY_HOURS_THRESHOLD + 0.5)), 1.0)
        self.assertEqual(shift_workday(SimpleNamespace(fixed_workday=None, working_hours=FULL_DAY_HOURS_THRESHOLD)), 0.5)


class RegistrationRulesTests(TestCase):
    def test_unauthorized_absence_max_days_matches_serializer(self):
        section = build_rules(_admin_request(), {'attendance'})['attendance']
        self.assertEqual(section['unauthorized_absence_max_days'],
                         RegistrationRequestCreateSerializer.MAX_UNAUTHORIZED_ABSENCE_RANGE_DAYS)

    def test_telesale_codes_match_engine(self):
        from hrm.main_api import TELESALE_POSITION_CODES

        section = build_rules(_admin_request(), {'shift'})['shift']
        self.assertEqual(set(section['telesale_position_codes']), set(TELESALE_POSITION_CODES))
