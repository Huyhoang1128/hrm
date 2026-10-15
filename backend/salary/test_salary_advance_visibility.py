from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from employee.models import Employee
from .salary_data_models import SalaryAdvance
from .views import SalaryAdvanceViewSet


class SalaryAdvanceVisibilityTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.view = SalaryAdvanceViewSet.as_view({'get': 'list'})

        self.manager = self.create_employee('manager')
        self.direct_report = self.create_employee('direct', manager=self.manager)
        self.indirect_report = self.create_employee('indirect', manager=self.direct_report)
        self.unrelated = self.create_employee('unrelated')

        for employee in (self.direct_report, self.indirect_report, self.unrelated):
            SalaryAdvance.objects.create(
                employee=employee,
                year=2026,
                month=7,
                amount=Decimal('1000000'),
            )

    def create_employee(self, suffix, **overrides):
        user = User.objects.create_user(username=f'advance-{suffix}')
        values = {
            'user': user,
            'employee_id': f'ADV-{suffix}',
            'full_name': f'Advance {suffix}',
        }
        values.update(overrides)
        return Employee.objects.create(**values)

    def get_results(self, user):
        request = self.factory.get('/api/v1/salary/advances/', {'year': 2026, 'month': 7})
        force_authenticate(request, user=user)
        response = self.view(request)
        self.assertEqual(response.status_code, 200)
        return response.data['results'] if 'results' in response.data else response.data

    def test_manager_only_sees_direct_reports(self):
        results = self.get_results(self.manager.user)

        self.assertEqual(
            {record['employee'] for record in results},
            {self.direct_report.id},
        )
        self.assertNotIn('basic_salary', results[0])

    def test_hr_sees_all_approved_advances(self):
        hr = self.create_employee('hr', is_hr=True)

        results = self.get_results(hr.user)

        self.assertEqual(
            {record['employee'] for record in results},
            {self.direct_report.id, self.indirect_report.id, self.unrelated.id},
        )
        self.assertTrue(all('basic_salary' not in record for record in results))

    def test_admin_sees_all_approved_advances(self):
        admin = User.objects.create_superuser(
            username='advance-admin',
            email='advance-admin@example.com',
            password='test-password',
        )

        results = self.get_results(admin)

        self.assertEqual(
            {record['employee'] for record in results},
            {self.direct_report.id, self.indirect_report.id, self.unrelated.id},
        )
        self.assertTrue(all('basic_salary' in record for record in results))

    def test_employee_without_direct_reports_is_denied(self):
        request = self.factory.get('/api/v1/salary/advances/')
        force_authenticate(request, user=self.unrelated.user)

        response = self.view(request)

        self.assertEqual(response.status_code, 403)
