"""Quy định nhân sự một nguồn (backend) — hrm/system_rules/hr.py và các chỗ kiểm tra tương ứng."""
import datetime as dt
import importlib
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from employee.models import (
    EDUCATION_LEVEL, RANK_CHOICES, CompanyUnit, Department, Employee, Position,
    normalize_education_level, normalize_rank, rank_label,
)
from hrm import onboarding_rules
from hrm.models import CompanyConfig, EmployeeContract, OnboardingProcess
from hrm.serializers import CompanyConfigSerializer, EmployeeOnboardingFormSerializer, EmployeeSerializer
from hrm.system_rules import build_rules
from hrm.system_rules.hr import hr_rules

RULES_URL = '/api-hrm/system-rules/'


def _user(name, **kw):
    return User.objects.create_user(name, password='x-Pass-12345', **kw)


class SystemRulesHrSectionsTests(APITestCase):
    def test_public_sections_for_anonymous_and_hr_only_when_logged_in(self):
        data = self.client.get(RULES_URL).json()
        self.assertIn('choices', data)
        self.assertIn('onboarding', data)
        self.assertNotIn('hr', data)
        self.client.force_authenticate(_user('rules-hr'))
        self.assertIn('hr', self.client.get(RULES_URL, {'sections': 'hr'}).json())

    def test_choices_come_from_model_constants(self):
        choices = build_rules(None)['choices']
        self.assertEqual([(o['value'], o['label']) for o in choices['rank']], RANK_CHOICES)
        self.assertEqual([(o['value'], o['label']) for o in choices['education_level']], EDUCATION_LEVEL)
        self.assertIn('MATERNITY_LEAVE', [o['value'] for o in choices['employment_status']])
        self.assertIn('APPENDIX', [o['value'] for o in choices['contract_document_type']])
        self.assertNotIn('APPENDIX', [o['value'] for o in choices['contract_type']])
        self.assertIn('SERVICE', choices['contract_type_groups']['labor'])
        self.assertNotIn('CONFIDENTIALITY', choices['contract_type_groups']['labor'])

    def test_onboarding_text_limits_follow_target_model_fields(self):
        limits = build_rules(None)['onboarding']['text_max_length']
        # Lưu tạm 500 ở onboarding nhưng chép sang Employee.birth_place (255) -> lấy 255.
        self.assertEqual(limits['birth_place'], Employee._meta.get_field('birth_place').max_length)
        self.assertEqual(limits['permanent_address'], Employee._meta.get_field('permanent_residence').max_length)
        self.assertEqual(limits['candidate_name'], Employee._meta.get_field('full_name').max_length)
        self.assertEqual(limits['emergency_contact_relationship'],
                         Employee._meta.get_field('emergency_contact_relationship').max_length)
        self.assertEqual(limits['bank_account'], OnboardingProcess._meta.get_field('bank_account').max_length)

    @override_settings(CONTRACT_EXPIRING_SOON_DAYS=9, CONTRACT_RENEWAL_WINDOW_DAYS=21)
    def test_hr_section_reads_settings_and_model_fields(self):
        rules = hr_rules(None)
        self.assertEqual(rules['contract_expiring_soon_days'], 9)
        self.assertEqual(rules['contract_renewal_window_days']['default'], 21)
        fields = rules['company_config_fields']
        self.assertEqual(fields['sick_leave_days_per_year']['default'], 5)
        self.assertEqual(fields['paternity_leave_days']['default'], 5)
        # DecimalField(max_digits=3, decimal_places=2) -> tối đa 9.99, bước 0.01
        self.assertEqual(fields['overtime_multiplier_holiday']['max'], 9.99)
        self.assertEqual(fields['overtime_multiplier_holiday']['step'], 0.01)
        self.assertTrue(fields['manager_incomplete_explanation_quota']['nullable'])
        self.assertEqual(rules['company_unit_prefix'],
                         {'max_length': CompanyUnit._meta.get_field('prefix_code').max_length, 'required': False})


class RankNormalizationTests(TestCase):
    def test_labels_codes_and_unknown(self):
        self.assertEqual(normalize_rank('Nhân viên'), 'STAFF')
        self.assertEqual(normalize_rank(' trưởng phòng '), 'MANAGER')
        self.assertEqual(normalize_rank('Trưởng nhóm'), 'LEADER')
        self.assertEqual(normalize_rank('intern'), 'INTERN')
        self.assertEqual(normalize_rank('Cấp cao'), 'Cấp cao')
        self.assertEqual(rank_label('STAFF'), 'Nhân viên')
        self.assertEqual(rank_label('Cấp cao'), 'Cấp cao')

    def test_education_legacy_labels(self):
        self.assertEqual(normalize_education_level('Cử nhân đại học'), 'BACHELOR')
        self.assertEqual(normalize_education_level('Trung cấp'), 'HIGH_SCHOOL')
        self.assertEqual(normalize_education_level('DOCTORATE'), 'DOCTORATE')
        self.assertIsNone(normalize_education_level('???'))

    def test_employee_serializer_stores_code(self):
        emp = Employee.objects.create(user=_user('rank-ser'), employee_id='RK001', full_name='NV RK')
        serializer = EmployeeSerializer(emp, data={'rank': 'Phó phòng'}, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        emp.refresh_from_db()
        self.assertEqual(emp.rank, 'DEPUTY_MANAGER')

    def test_data_migration_converts_known_labels_only(self):
        migration = importlib.import_module('employee.migrations.0005_rank_labels_to_codes')
        a = Employee.objects.create(user=_user('rank-m1'), employee_id='RK101', full_name='A', rank='Nhân viên')
        b = Employee.objects.create(user=_user('rank-m2'), employee_id='RK102', full_name='B', rank='Leader')
        c = Employee.objects.create(user=_user('rank-m3'), employee_id='RK103', full_name='C', rank='Cấp cao')
        d = Employee.objects.create(user=_user('rank-m4'), employee_id='RK104', full_name='D', rank='STAFF')
        migration._convert(Employee, 'Employee')
        self.assertEqual([Employee.objects.get(pk=e.pk).rank for e in (a, b, c, d)],
                         ['STAFF', 'LEADER', 'Cấp cao', 'STAFF'])


@override_settings(CONTRACT_EXPIRING_SOON_DAYS=5)
class ContractExpiringWindowTests(APITestCase):
    def setUp(self):
        self.today = timezone.now().date()
        self.admin = User.objects.create_superuser('hr-rules-admin', 'a@example.com', 'x-Pass-12345')
        self.me = Employee.objects.create(user=self.admin, employee_id='EXP000', full_name='Admin')

    def _emp(self, code, **kw):
        return Employee.objects.create(user=_user(code.lower()), employee_id=code, full_name=code, is_active=True, **kw)

    def _ids(self, **params):
        self.client.force_authenticate(self.admin)
        res = self.client.get('/api-hrm/employees/', {'page_size': 100, **params})
        self.assertEqual(res.status_code, 200, res.data)
        return {row['employee_id'] for row in res.data['results']}

    def test_employee_list_filter_uses_backend_window(self):
        self._emp('EXP001', contract_end_date=self.today + dt.timedelta(days=5))
        self._emp('EXP002', contract_end_date=self.today + dt.timedelta(days=6))
        self._emp('EXP003', probation_end_date=self.today + dt.timedelta(days=2))
        self._emp('EXP004', contract_end_date=self.today - dt.timedelta(days=1))
        self.assertEqual(self._ids(expiring_soon='true'), {'EXP001', 'EXP003'})
        with self.settings(CONTRACT_EXPIRING_SOON_DAYS=6):
            self.assertEqual(self._ids(expiring_soon='true'), {'EXP001', 'EXP002', 'EXP003'})
        self.assertIn('EXP002', self._ids())

    def _contract(self, days, contract_type='ONE_YEAR', employee=None):
        return EmployeeContract.objects.create(
            employee=employee or self.me, contract_type=contract_type, status='SIGNED',
            end_date=self.today + dt.timedelta(days=days))

    def test_expiring_alert_and_expiring_soon_use_setting(self):
        inside = self._contract(5)
        self._contract(6)
        self._contract(3, contract_type='CONFIDENTIALITY')  # không phải HĐ lao động
        self.client.force_authenticate(self.admin)
        res = self.client.get('/api-hrm/employee-contracts/expiring-alert/')
        self.assertEqual(res.data['days'], 5)
        self.assertEqual([c['id'] for c in res.data['contracts']], [inside.id])
        soon = self.client.get('/api-hrm/employee-contracts/expiring_soon/')
        self.assertEqual(soon.data['days'], 5)
        self.assertEqual(soon.data['count'], 2)

    @override_settings(CONTRACT_RENEWAL_WINDOW_DAYS=10)
    def test_renewal_candidates_default_and_clamp(self):
        self._contract(10)
        self._contract(11)
        self.client.force_authenticate(self.admin)
        res = self.client.get('/api-hrm/employee-contracts/renewal-candidates/')
        self.assertEqual((res.data['days'], res.data['count']), (10, 1))
        res = self.client.get('/api-hrm/employee-contracts/renewal-candidates/', {'days': 1000})
        self.assertEqual(res.data['days'], 90)
        res = self.client.get('/api-hrm/employee-contracts/renewal-candidates/', {'days': 'abc'})
        self.assertEqual(res.data['days'], 10)


class CompanyConfigValidationTests(TestCase):
    def _data(self, **kw):
        return {'name': 'Cấu hình', 'code': 'CFG-T', 'effective_from': '2026-01-01', **kw}

    def test_out_of_range_rejected(self):
        serializer = CompanyConfigSerializer(data=self._data(late_threshold_minutes=241, default_working_days_per_week=0))
        self.assertFalse(serializer.is_valid())
        self.assertIn('late_threshold_minutes', serializer.errors)
        self.assertIn('default_working_days_per_week', serializer.errors)
        # Cột DecimalField(3,2) không chứa nổi 10
        serializer = CompanyConfigSerializer(data=self._data(overtime_multiplier_holiday='10'))
        self.assertFalse(serializer.is_valid())
        self.assertIn('overtime_multiplier_holiday', serializer.errors)

    def test_zero_and_model_defaults_kept(self):
        serializer = CompanyConfigSerializer(data=self._data(sick_leave_days_per_year=0, overtime_multiplier_weekday='9.99'))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        config = serializer.save()
        self.assertEqual(config.sick_leave_days_per_year, 0)
        self.assertEqual(config.overtime_multiplier_weekday, Decimal('9.99'))
        self.assertEqual(config.paternity_leave_days, CompanyConfig._meta.get_field('paternity_leave_days').default)


class OnboardingSubmitRulesTests(TestCase):
    def setUp(self):
        self.dept = Department.objects.create(code='OB-D', name='Phòng OB')
        self.position = Position.objects.create(code='OB-P', title='Nhân viên OB', level=1)
        self.employee = Employee.objects.create(user=_user('ob-emp'), employee_id='OB001', full_name='Ứng viên')
        self.onboarding = OnboardingProcess.objects.create(
            onboarding_code='ONB-RULES-1', candidate_name='Ứng viên', candidate_email='ob@example.com',
            start_date=dt.date(2026, 7, 1), status='IN_PROGRESS', employee=self.employee)

    def _payload(self, **kw):
        data = {
            'candidate_name': 'Nguyễn Văn A', 'date_of_birth': '1995-05-01', 'gender': 'M',
            'candidate_phone': '0900000001', 'education_level': 'BACHELOR', 'ethnicity': 'Kinh',
            'birth_place': 'Hà Nội', 'nationality': 'Việt Nam', 'facebook_link': 'https://facebook.com/a',
            'region': 'Miền Bắc', 'block': 'Khối Marketing', 'sub_department': 'Phòng OB',
            'position': 'Nhân viên OB', 'job_rank': 'STAFF', 'work_form': 'FULL_TIME', 'work_location': 'VP_HA_NOI',
            'citizen_id': '001200000001', 'citizen_id_issue_date': '2021-06-01',
            'citizen_id_issue_place': 'POLICE_ADMIN', 'permanent_address': 'Thường trú',
            'current_address': 'Hiện tại', 'marital_status': 'SINGLE',
            'emergency_contact_name': 'Người Thân', 'emergency_contact_relationship': 'Mẹ',
            'emergency_contact_phone': '0900000003', 'emergency_contact_dob': '1970-01-01',
            'emergency_contact_occupation': 'Nội trợ', 'emergency_contact_address': 'Hà Nội',
            'salary': '10000000', 'bank_account': '111', 'bank_name': 'NH A', 'bank_account_holder': 'NGUYEN VAN A',
        }
        data.update(kw)
        return data

    def _serializer(self, **kw):
        return EmployeeOnboardingFormSerializer(self.onboarding, data=self._payload(**kw), partial=True, context={})

    def test_valid_payload_saves_codes(self):
        serializer = self._serializer(job_rank='Nhân viên', education_level='Cử nhân đại học')
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        self.employee.refresh_from_db()
        self.onboarding.refresh_from_db()
        self.assertEqual((self.employee.rank, self.onboarding.rank), ('STAFF', 'STAFF'))
        self.assertEqual((self.employee.education_level, self.onboarding.education_level), ('BACHELOR', 'BACHELOR'))
        self.assertEqual((self.employee.department, self.employee.position), (self.dept, self.position))

    def test_doctorate_now_kept(self):
        serializer = self._serializer(education_level='DOCTORATE')
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.education_level, 'DOCTORATE')

    def test_text_longer_than_employee_column_rejected(self):
        limit = Employee._meta.get_field('birth_place').max_length
        self.assertTrue(self._serializer(birth_place='x' * limit).is_valid())
        serializer = self._serializer(birth_place='x' * (limit + 1))
        self.assertFalse(serializer.is_valid())
        self.assertIn('birth_place', serializer.errors)

    def test_form_rules_enforced(self):
        cases = {
            'candidate_name': 'Nguyen 123',
            'candidate_phone': '09000',
            'citizen_id': '12345678901',
            'old_id_number': '1234',
            'social_insurance_number': '123',
            'tax_code': '123456789',
            'date_of_birth': (dt.date.today() - dt.timedelta(days=17 * 365)).isoformat(),
            'emergency_contact_dob': (dt.date.today() - dt.timedelta(days=10 * 365)).isoformat(),
            'citizen_id_issue_date': '2018-12-31',
            'emergency_contact_relationship': 'Mẹ 2',
        }
        for field, value in cases.items():
            serializer = self._serializer(**{field: value})
            self.assertFalse(serializer.is_valid(), field)
            self.assertIn(field, serializer.errors, field)
        self.assertTrue(self._serializer(tax_code='0123456789123', old_id_number='123456789',
                                         social_insurance_number='0123456789').is_valid())

    def test_unknown_department_rejected_and_not_created(self):
        serializer = self._serializer(sub_department='Phòng Không Có')
        self.assertFalse(serializer.is_valid())
        self.assertIn('sub_department', serializer.errors)
        self.assertFalse(Department.objects.filter(name='Phòng Không Có').exists())
        serializer = self._serializer(position='Vị trí lạ')
        self.assertFalse(serializer.is_valid())
        self.assertIn('position', serializer.errors)

    def test_file_rules_shared(self):
        too_big = SimpleUploadedFile('cccd.pdf', b'0' * (onboarding_rules.CITIZEN_ID_FILE_MAX_BYTES + 1),
                                     content_type='application/pdf')
        with self.assertRaises(Exception):
            onboarding_rules.validate_citizen_id_file(too_big)
        with self.assertRaises(Exception):
            onboarding_rules.validate_citizen_id_file(SimpleUploadedFile('cccd.jpg', b'0', content_type='image/jpeg'))
        with self.assertRaises(Exception):
            onboarding_rules.validate_vneid_screenshot(SimpleUploadedFile('a.pdf', b'0', content_type='application/pdf'))
        heic = SimpleUploadedFile('a.heic', b'0', content_type='application/octet-stream')
        self.assertIs(onboarding_rules.validate_vneid_screenshot(heic), heic)
