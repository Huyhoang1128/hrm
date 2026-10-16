from decimal import Decimal
from types import SimpleNamespace

from django.test import SimpleTestCase

from hrm.shift_config_utils import shift_configs_to_rules, shift_workday


def _shift(hours, fixed=None, shift_type='FULL_DAY'):
    return SimpleNamespace(
        name='Ca thử', shift_type=shift_type, working_hours=Decimal(hours), fixed_workday=fixed,
        start_time='09:00:00', end_time='12:00:00', break_start_time=None, break_end_time=None,
    )


class ShiftFixedWorkdayTests(SimpleTestCase):
    def test_derived_from_hours_when_not_set(self):
        self.assertEqual(shift_workday(_shift('8')), 1.0)
        self.assertEqual(shift_workday(_shift('4')), 0.5)
        self.assertEqual(shift_workday(_shift('5.5')), 0.5)

    def test_fixed_workday_overrides_hours(self):
        self.assertEqual(shift_workday(_shift('3', fixed=Decimal('1.00'))), 1.0)
        self.assertEqual(shift_workday(_shift('8', fixed=Decimal('0.50'))), 0.5)
        self.assertEqual(shift_workday(_shift('8', fixed=Decimal('0'))), 0.0)  # 0 vẫn là giá trị đặt

    def test_rules_use_fixed_workday(self):
        rules = shift_configs_to_rules([_shift('3', fixed=Decimal('1.00'))])
        self.assertEqual(rules[0]['conditions']['workday'], 1.0)
