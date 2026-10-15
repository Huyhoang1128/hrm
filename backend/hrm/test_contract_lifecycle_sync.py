from datetime import date

from django.contrib.auth.models import User
from django.test import TestCase

from employee.models import Employee
from hrm.models import EmployeeContract, OnboardingProcess, OnboardingTask
from hrm.serializers import EmployeeSerializer


class OnboardingContractSyncTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='contract-sync')
        self.employee = Employee.objects.create(
            user=self.user,
            employee_id='SYNC001',
            full_name='Nhân viên đồng bộ',
        )
        self.onboarding = OnboardingProcess.objects.create(
            onboarding_code='ONB-SYNC-001',
            candidate_name=self.employee.full_name,
            candidate_email='sync@example.com',
            start_date=date(2026, 7, 1),
            expected_end_date=date(2026, 8, 31),
            contract_type='PROBATION',
            status='IN_PROGRESS',
            employee=self.employee,
        )
        self.task = OnboardingTask.objects.get(
            onboarding_process=self.onboarding,
            task_code='SIGN_CONTRACT',
        )
        self.task.status = 'IN_PROGRESS'
        self.task.save(update_fields=['status'])

    def test_completing_sign_contract_task_creates_signed_bulk_contract(self):
        self.assertTrue(self.task.complete_task())

        contract = EmployeeContract.objects.get(
            onboarding_process=self.onboarding,
            employee=self.employee,
        )
        self.assertEqual(contract.status, 'SIGNED')
        self.assertEqual(contract.contract_type, 'PROBATION')
        self.assertEqual(contract.start_date, date(2026, 7, 1))
        self.assertEqual(contract.end_date, date(2026, 8, 31))

    def test_retry_does_not_create_duplicate_contract(self):
        self.assertTrue(self.task.complete_task())
        self.task.status = 'IN_PROGRESS'
        self.task.save(update_fields=['status'])
        self.assertTrue(self.task.complete_task())

        self.assertEqual(
            EmployeeContract.objects.filter(onboarding_process=self.onboarding).count(),
            1,
        )


class ResignationContractSyncTests(TestCase):
    def test_resignation_cancels_open_contracts(self):
        user = User.objects.create_user(username='resignation-sync')
        employee = Employee.objects.create(
            user=user,
            employee_id='SYNC002',
            full_name='Nhân viên nghỉ việc',
        )
        contract = EmployeeContract.objects.create(
            employee=employee,
            contract_type='PROBATION',
            status='SIGNED',
        )

        serializer = EmployeeSerializer(
            employee,
            data={
                'employment_status': 'INACTIVE',
                'end_date': date.today(),
            },
            partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()

        contract.refresh_from_db()
        self.assertEqual(contract.status, 'CANCELLED')
