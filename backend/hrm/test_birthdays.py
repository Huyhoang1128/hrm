from datetime import date

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from employee.models import Employee
from .views import EmployeeViewSet


class BirthdayEmployeesTests(TestCase):
    birthday = date(1990, 7, 8)
    target_date = date(2026, 7, 8)

    def setUp(self):
        self.request_user = User.objects.create_superuser(
            username='birthday-admin',
            email='birthday-admin@example.com',
            password='test-password',
        )
        self.factory = APIRequestFactory()
        self.view = EmployeeViewSet.as_view({'get': 'birthdays_today'})

    def create_employee(self, suffix, **overrides):
        user = User.objects.create_user(username=f'birthday-{suffix}')
        values = {
            'user': user,
            'employee_id': f'BD-{suffix}',
            'full_name': f'Birthday {suffix}',
            'date_of_birth': self.birthday,
            'is_active': True,
            'employment_status': 'ACTIVE',
        }
        values.update(overrides)
        return Employee.objects.create(**values)

    def test_excludes_departed_employees_from_birthday_list(self):
        active = self.create_employee('ACTIVE')
        future_departure = self.create_employee(
            'FUTURE',
            end_date=date(2026, 7, 9),
        )
        suspended = self.create_employee(
            'SUSPENDED',
            employment_status='SUSPENDED',
            end_date=date(2026, 7, 1),
        )
        self.create_employee('INACTIVE', employment_status='INACTIVE')
        self.create_employee('ENDED', end_date=self.target_date)

        request = self.factory.get(
            '/api-hrm/employees/birthdays_today/',
            {'date': self.target_date.isoformat()},
        )
        force_authenticate(request, user=self.request_user)

        response = self.view(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {employee['employee_id'] for employee in response.data},
            {active.employee_id, future_departure.employee_id, suspended.employee_id},
        )
