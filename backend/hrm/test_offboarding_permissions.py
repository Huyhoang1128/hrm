from datetime import date

from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase

from employee.models import Employee
from hrm.models import GenericRequest


class OffboardingHRPermissionsTests(APITestCase):
    def setUp(self):
        self.hr_user = User.objects.create_user(
            username='offboarding-hr',
            password='test-password',
        )
        self.hr_employee = Employee.objects.create(
            user=self.hr_user,
            employee_id='OFF-HR-001',
            full_name='HR Offboarding',
            is_hr=True,
        )

        owner_user = User.objects.create_user(
            username='offboarding-owner',
            password='test-password',
        )
        self.owner = Employee.objects.create(
            user=owner_user,
            employee_id='OFF-NV-001',
            full_name='Nhân viên nghỉ việc',
        )

        self.resignation = GenericRequest.objects.create(
            employee=self.owner,
            request_type='RESIGNATION',
            title='Đơn xin nghỉ việc',
            reason='Lý do cá nhân',
            expected_date=date(2026, 7, 31),
            status='PENDING_ADMIN',
        )
        self.proposal = GenericRequest.objects.create(
            employee=self.owner,
            request_type='PROPOSAL',
            title='Đơn đề xuất',
            reason='Đề xuất mua thiết bị',
            status='PENDING_ADMIN',
        )

        self.client.force_authenticate(self.hr_user)

    def test_hr_sees_resignations_but_not_other_employees_proposals(self):
        response = self.client.get(
            '/api-hrm/generic-requests/',
            {'request_type': 'RESIGNATION'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['id'], self.resignation.id)

        response = self.client.get(
            '/api-hrm/generic-requests/',
            {'request_type': 'PROPOSAL'},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 0)

    def test_hr_can_final_approve_resignation_only(self):
        response = self.client.post(
            f'/api-hrm/generic-requests/{self.resignation.id}/admin-approve/',
            {'approval_note': 'Đã xác nhận offboarding'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.resignation.refresh_from_db()
        self.owner.refresh_from_db()
        self.assertEqual(self.resignation.status, 'APPROVED')
        self.assertEqual(self.resignation.admin_approved_by, self.hr_user)
        self.assertEqual(self.owner.end_date, self.resignation.expected_date)

        response = self.client.post(
            f'/api-hrm/generic-requests/{self.proposal.id}/admin-approve/',
            {},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
