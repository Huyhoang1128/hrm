"""
hrm/test_contract_appendix_type.py
══════════════════════════════════
Template hợp đồng / hợp đồng đã tạo có thêm loại "Phụ lục hợp đồng"
(APPENDIX). Loại này KHÔNG dành cho onboarding/hồ sơ nhân viên — nhân viên
không có "loại HĐ = phụ lục".
"""
from django.contrib.auth.models import User
from django.test import TestCase

from employee.models import Employee
from hrm.models import CONTRACT_TYPE, ContractTemplate, EmployeeContract, OnboardingProcess
from hrm.serializers import ContractTemplateSerializer


class ContractAppendixTypeTests(TestCase):
    def test_template_accepts_appendix(self):
        s = ContractTemplateSerializer(data={'name': 'Phụ lục điều chỉnh lương', 'contract_type': 'APPENDIX'})
        s.is_valid()
        self.assertNotIn('contract_type', s.errors)

    def test_unknown_type_still_rejected(self):
        s = ContractTemplateSerializer(data={'name': 'X', 'contract_type': 'NOT_A_TYPE'})
        s.is_valid()
        self.assertIn('contract_type', s.errors)

    def test_display_labels(self):
        template = ContractTemplate(name='PL', contract_type='APPENDIX')
        self.assertEqual(template.get_contract_type_display(), 'Phụ lục hợp đồng')
        user = User.objects.create_user(username='a', password='x')
        emp = Employee.objects.create(user=user, employee_id='NV90001', full_name='Nhân viên thử')
        contract = EmployeeContract(employee=emp, contract_type='APPENDIX')
        self.assertEqual(contract.get_contract_type_display(), 'Phụ lục hợp đồng')

    def test_onboarding_and_employee_types_unchanged(self):
        self.assertNotIn('APPENDIX', dict(CONTRACT_TYPE))
        onboarding_choices = dict(OnboardingProcess._meta.get_field('contract_type').choices)
        self.assertNotIn('APPENDIX', onboarding_choices)
        employee_choices = dict(Employee._meta.get_field('contract_type').choices or [])
        self.assertNotIn('APPENDIX', employee_choices)
