from datetime import date, timedelta

from django.test import SimpleTestCase

from employee.models import compute_effective_employment_status


class EffectiveEmploymentStatusTests(SimpleTestCase):
    def test_keeps_manually_inactive_employee_inactive_without_end_date(self):
        self.assertEqual(
            compute_effective_employment_status('INACTIVE', None),
            'INACTIVE',
        )

    def test_keeps_manually_inactive_employee_inactive_with_future_end_date(self):
        self.assertEqual(
            compute_effective_employment_status(
                'INACTIVE',
                date.today() + timedelta(days=1),
            ),
            'INACTIVE',
        )

    def test_derives_inactive_from_end_date_for_active_employee(self):
        self.assertEqual(
            compute_effective_employment_status('ACTIVE', date.today()),
            'INACTIVE',
        )
