import datetime as dt
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Department, Employee, Position
from hrm.models import SELF_UPDATE_CODE_PREFIX, OnboardingProcess


class EmployeeSelfUpdateLinkTests(APITestCase):
    def setUp(self):
        self.dept = Department.objects.create(code='SU', name='Phòng SU')
        self.position = Position.objects.create(code='SU-NV', title='Nhân viên SU', level=1)
        self.hr = self._emp('NV00401', is_hr=True, personal_email='hr@example.com')
        self.staff = self._emp(
            'NV00402', personal_email='nv@example.com', basic_salary=Decimal(12_000_000), region='Miền Bắc',
            work_form='FULL_TIME', current_address='Địa chỉ cũ', bank_account='111', bank_name='Ngân hàng A',
            bank_account_holder='NV 402', cccd_number='001200000001', date_of_birth=dt.date(1995, 5, 1),
            education_level='BACHELOR', vneid_screenshot='vneid/old.png')

    def _emp(self, code, **kw):
        return Employee.objects.create(
            user=User.objects.create_user(code.lower(), password='x'), employee_id=code, full_name=f'NV {code}',
            department=self.dept, position=self.position, start_date=dt.date(2025, 1, 1), is_active=True,
            employment_status='ACTIVE', **kw)

    def _link(self, user, employee):
        self.client.force_authenticate(user)
        return self.client.post(f'/api-hrm/employees/{employee.id}/generate-self-update-link/')

    def _token(self):
        res = self._link(self.hr.user, self.staff)
        self.assertEqual(res.status_code, 200, res.data)
        return res.data['data']['employee_form_url'].rstrip('/').split('/')[-1]

    def test_only_hr_or_admin_and_email_required(self):
        self.assertEqual(self._link(self.staff.user, self.staff).status_code, 403)
        no_email = self._emp('NV00403')
        no_email.user.email = ''
        no_email.user.save()
        self.assertEqual(self._link(self.hr.user, no_email).status_code, 400)

    def test_creates_hidden_self_update_process_without_onboarding_tasks(self):
        self._token()
        onboarding = OnboardingProcess.objects.get(employee=self.staff)
        self.assertTrue(onboarding.is_self_update)
        self.assertTrue(onboarding.onboarding_code.startswith(SELF_UPDATE_CODE_PREFIX))
        self.assertEqual(onboarding.tasks.count(), 0)
        self.client.force_authenticate(User.objects.create_superuser('su-admin', 'a@example.com', 'x'))
        res = self.client.get('/api-hrm/onboardings/')
        rows = res.data['results'] if isinstance(res.data, dict) else res.data
        self.assertNotIn(onboarding.id, [r['id'] for r in rows])

    def test_form_is_prefilled_with_current_profile(self):
        token = self._token()
        self.client.force_authenticate(None)
        data = self.client.get(f'/api-hrm/employee-onboarding-form/by-token/{token}/').data['data']
        self.assertTrue(data['is_self_update'])
        self.assertEqual((data['current_address'], data['bank_account'], data['citizen_id'], data['date_of_birth'],
                          data['education_level'], data['has_vneid_screenshot']),
                         ('Địa chỉ cũ', '111', '001200000001', '1995-05-01', 'Cử nhân đại học', True))
        self.assertNotIn('salary', data)

    def test_submit_updates_personal_fields_but_never_hr_fields(self):
        token = self._token()
        OnboardingProcess.objects.filter(employee=self.staff).update(citizen_id_file='onboarding/cccd.pdf')
        payload = {
            'candidate_name': 'NV NV00402', 'date_of_birth': '1995-05-01', 'gender': 'M', 'candidate_phone': '0900000002',
            'education_level': 'Cử nhân đại học', 'ethnicity': 'Kinh', 'birth_place': 'Hà Nội', 'nationality': 'Việt Nam',
            'facebook_link': 'https://facebook.com/nv402', 'citizen_id': '001200000001',
            'citizen_id_issue_date': '2021-06-01', 'citizen_id_issue_place': 'POLICE_ADMIN',
            'permanent_address': 'Thường trú mới', 'current_address': 'Địa chỉ mới', 'marital_status': 'SINGLE',
            'emergency_contact_name': 'Người Thân', 'emergency_contact_relationship': 'Mẹ',
            'emergency_contact_phone': '0900000003', 'emergency_contact_dob': '1970-01-01',
            'emergency_contact_occupation': 'Nội trợ', 'emergency_contact_address': 'Hà Nội',
            'bank_account': '222', 'bank_name': 'Ngân hàng B', 'bank_account_holder': 'NV 402',
            # cố tình gửi các trường HCNS quản lý — phải bị bỏ qua
            'salary': '99000000', 'allowance': '5000000', 'probation_period_months': '6', 'position': 'Giám đốc',
            'sub_department': 'Phòng Mới', 'region': 'Miền Nam', 'work_form': 'PART_TIME', 'job_rank': 'Cấp cao',
        }
        self.client.force_authenticate(None)
        res = self.client.post(f'/api-hrm/employee-onboarding-form/submit/{token}/', payload, format='multipart')
        self.assertEqual(res.status_code, 200, res.data)

        self.staff.refresh_from_db()
        self.assertEqual((self.staff.current_address, self.staff.bank_account, self.staff.bank_name),
                         ('Địa chỉ mới', '222', 'Ngân hàng B'))
        self.assertEqual((self.staff.basic_salary, self.staff.position_id, self.staff.department_id,
                          self.staff.region, self.staff.work_form),
                         (Decimal(12_000_000), self.position.id, self.dept.id, 'Miền Bắc', 'FULL_TIME'))
        self.assertFalse(Position.objects.filter(title='Giám đốc').exists())
        self.assertFalse(Department.objects.filter(name='Phòng Mới').exists())
        # token đã dùng thì không mở lại được
        self.assertEqual(self.client.get(f'/api-hrm/employee-onboarding-form/by-token/{token}/').status_code, 400)
