"""Quy định mảng "Khác" (hrm/system_rules/misc.py) và các chỗ backend tự kiểm tra đúng quy định đó."""
from unittest import mock

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from employee.models import Employee
from hrm.system_rules import build_rules

RULES_URL = '/api-hrm/system-rules/'


class PasswordRulesTests(TestCase):
    def test_public_section_matches_validators(self):
        from hrm.utils import RESET_PASSWORD_LENGTH
        data = APIClient().get(RULES_URL, {'sections': 'password'}).json()
        self.assertEqual(data['password']['min_length'], 8)
        self.assertEqual(len(data['password']['help_texts']), 4)
        self.assertEqual(data['password']['reset_generated_length'], RESET_PASSWORD_LENGTH)

    @override_settings(AUTH_PASSWORD_VALIDATORS=[{
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 11},
    }])
    def test_min_length_follows_config(self):
        rules = build_rules(None, {'password'})['password']
        self.assertEqual(rules['min_length'], 11)
        self.assertEqual(len(rules['help_texts']), 1)

    @override_settings(AUTH_PASSWORD_VALIDATORS=[])
    def test_no_min_length_validator(self):
        self.assertIsNone(build_rules(None, {'password'})['password']['min_length'])


class HrmPasswordPathsTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='pw-admin', password='Admin-Pass-2026')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.staff_user = User.objects.create_user(username='pw-staff', password='Old-Pass-2026', email='a@b.vn')
        self.staff = Employee.objects.create(
            user=self.staff_user, employee_id='PW-001', full_name='Nhân viên Mật khẩu', personal_email='a@b.vn',
        )

    def test_hr_reset_generates_configured_length(self):
        from hrm.utils import RESET_PASSWORD_LENGTH
        with mock.patch('hrm.serializers.send_account_info_email', return_value=True) as sent:
            response = self.client.post(f'/api-hrm/employees/{self.staff.id}/reset-password/')
        self.assertEqual(response.status_code, 200, response.data)
        new_password = sent.call_args.kwargs['new_password']
        self.assertEqual(len(new_password), RESET_PASSWORD_LENGTH)
        self.staff_user.refresh_from_db()
        self.assertTrue(self.staff_user.check_password(new_password))

    def test_forgot_password_generates_configured_length(self):
        from hrm.utils import RESET_PASSWORD_LENGTH
        with mock.patch('hrm.serializers.send_account_info_email', return_value=True) as sent:
            response = APIClient().post('/api-hrm/forgot-password/', {'employee_id': 'PW-001'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(sent.call_args.kwargs['new_password']), RESET_PASSWORD_LENGTH)

    def test_send_account_emails_does_not_log_password(self):
        with self.assertLogs('hrm.views', level='INFO') as logs:
            response = self.client.post('/api-hrm/employees/send-account-emails/', {'employee_ids': [self.staff.id]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        from hrm.models import EmailQueue
        new_password = EmailQueue.objects.get(employee=self.staff).new_password
        self.assertTrue(new_password)
        self.assertFalse(any(new_password in line for line in logs.output))
        self.assertTrue(any('pw-staff' in line for line in logs.output))

    def test_employee_create_validates_password(self):
        payload = {'employee_id': 'PW-NEW', 'full_name': 'Người mới', 'username': 'pw-new'}
        weak = self.client.post('/api-hrm/employees/', {**payload, 'password': '12345678'}, format='json')
        self.assertEqual(weak.status_code, 400)
        self.assertIn('password', weak.data)
        self.assertFalse(User.objects.filter(username='pw-new').exists())
        ok = self.client.post('/api-hrm/employees/', {**payload, 'password': 'Hoa-Mai-2026-xyz'}, format='json')
        self.assertEqual(ok.status_code, 201, ok.data)


class MiscSectionsMatchBackendTests(TestCase):
    """Giá trị trong system-rules phải là đúng hằng số / cấu hình backend dùng để kiểm tra."""

    def setUp(self):
        self.user = User.objects.create_user(username='rules-misc', password='x-Pass-12345')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _rules(self, section):
        return self.client.get(RULES_URL, {'sections': section}).json()[section]

    def test_private_sections_hidden_from_anonymous(self):
        data = APIClient().get(RULES_URL).json()
        self.assertIn('branding', data)
        for name in ('uploads', 'feedback', 'chat', 'assets', 'recruitment', 'regulation', 'account'):
            self.assertNotIn(name, data)

    def test_uploads(self):
        from hrm import upload_limits
        from hrm.payment_document_views import ALLOWED_EXTENSIONS, MAX_ATTACHMENT_SIZE
        rules = self._rules('uploads')
        self.assertEqual(rules['avatar']['max_bytes'], upload_limits.AVATAR_MAX_BYTES)
        self.assertEqual(set(rules['avatar']['types']), set(upload_limits.AVATAR_ALLOWED_TYPES))
        self.assertEqual(rules['announcement_attachment']['max_bytes'], upload_limits.ANNOUNCEMENT_ATTACHMENT_MAX_BYTES)
        self.assertEqual(rules['payment_document_attachment']['max_bytes'], MAX_ATTACHMENT_SIZE)
        self.assertEqual(set(rules['payment_document_attachment']['extensions']), ALLOWED_EXTENSIONS)
        self.assertEqual(rules['contract_template']['extensions'], ['docx'])

    def test_feedback(self):
        from hrm.feedback_models import Feedback
        from hrm.feedback_views import MAX_ANSWER_LENGTH, MAX_IMAGE_BYTES, MAX_IMAGES
        rules = self._rules('feedback')
        self.assertEqual(rules['max_answer_length'], MAX_ANSWER_LENGTH)
        self.assertEqual(rules['max_images'], MAX_IMAGES)
        self.assertEqual(rules['max_image_bytes'], MAX_IMAGE_BYTES)
        self.assertEqual(set(rules['image_types']), {'image/jpeg', 'image/png', 'image/webp', 'image/gif'})
        self.assertEqual([t['value'] for t in rules['topics']], [c for c, _ in Feedback.TOPIC_CHOICES])
        self.assertEqual(rules['it_topics'], list(Feedback.IT_TOPICS))
        self.assertEqual([q['field'] for q in rules['questions']], [f for f, _ in Feedback.ANSWER_FIELDS])

    def test_chat(self):
        from chat.views import CHAT_IMAGE_MAX_SIZE, REACTION_SOURCE_MAX_SIZE
        rules = self._rules('chat')
        self.assertEqual(rules['image_max_bytes'], CHAT_IMAGE_MAX_SIZE)
        self.assertEqual(rules['reaction_source_max_bytes'], REACTION_SOURCE_MAX_SIZE)

    def test_assets(self):
        from hrm.models import ASSET_TYPE, ASSET_TYPE_MAX_LENGTH, Asset
        rules = self._rules('assets')
        self.assertEqual([t['value'] for t in rules['standard_types']], [c for c, _ in ASSET_TYPE])
        self.assertEqual(rules['type_max_length'], ASSET_TYPE_MAX_LENGTH)
        self.assertEqual(set(rules['multi_holder_types']), Asset.MULTI_HOLDER_TYPES)
        self.assertEqual(set(rules['unassignable_conditions']), {'POOR', 'BROKEN'})

    def test_recruitment(self):
        from recruitment.models import RECRUITMENT_STATUS
        rules = self._rules('recruitment')
        self.assertEqual([s['value'] for s in rules['need_statuses']], [c for c, _ in RECRUITMENT_STATUS])

    @override_settings(REGULATION_MIN_READ_SECONDS=25, SEND_ALL_ACCOUNT_EMAILS_COOLDOWN_SECONDS=300)
    def test_regulation_and_account_follow_settings(self):
        self.assertEqual(self._rules('regulation')['min_read_seconds'], 25)
        self.assertEqual(self._rules('account')['send_all_emails_cooldown_seconds'], 300)

    @override_settings(COMPANY_CITY='Đà Nẵng', HR_DEPARTMENT_LABEL='Phòng Nhân sự',
                       PENALTY_REPORT_SUBMIT_DEADLINE='16h00', DEFAULT_PASSWORD_PREFIX='bimat')
    def test_branding_public_and_without_password_prefix(self):
        rules = APIClient().get(RULES_URL, {'sections': 'branding'}).json()['branding']
        self.assertEqual(rules['company_city'], 'Đà Nẵng')
        self.assertEqual(rules['hr_department_label'], 'Phòng Nhân sự')
        self.assertEqual(rules['penalty_report_submit_deadline'], '16h00')
        self.assertNotIn('bimat', str(rules))


class UploadEnforcementTests(TestCase):
    """Backend tự chặn file theo đúng hằng số đã công bố (trước đây chỉ web chặn)."""

    def setUp(self):
        self.admin = User.objects.create_superuser(username='up-admin', password='Admin-Pass-2026')
        self.employee = Employee.objects.create(user=self.admin, employee_id='UP-001', full_name='Người tải')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_avatar_size_limit(self):
        from hrm import upload_limits
        big = SimpleUploadedFile('a.png', b'x' * 2048, content_type='image/png')
        with mock.patch.object(upload_limits, 'AVATAR_MAX_BYTES', 1024):
            with mock.patch('hrm.utils.upload_file_to_cloudfly') as upload:
                response = self.client.post('/api-hrm/change-avatar/', {'avatar': big}, format='multipart')
        self.assertEqual(response.status_code, 400)
        upload.assert_not_called()

    def test_avatar_type(self):
        bad = SimpleUploadedFile('a.bmp', b'x' * 10, content_type='image/bmp')
        response = self.client.post('/api-hrm/change-avatar/', {'avatar': bad}, format='multipart')
        self.assertEqual(response.status_code, 400)

    def _announcement(self, files):
        payload = {
            'title': 'Thông báo', 'content': 'Nội dung', 'announcement_type': 'ANNOUNCEMENT',
            'priority': 'MEDIUM', 'effective_from': '2026-11-01', 'attachments': files,
        }
        return self.client.post('/api-hrm/company-announcements/', payload, format='multipart')

    def test_announcement_attachment_rules(self):
        from hrm import upload_limits
        from hrm.models import CompanyAnnouncement
        bad_ext = SimpleUploadedFile('virus.exe', b'x', content_type='application/octet-stream')
        response = self._announcement([bad_ext])
        self.assertEqual(response.status_code, 400)
        self.assertIn('attachments', response.json())
        self.assertFalse(CompanyAnnouncement.objects.exists())

        big = SimpleUploadedFile('a.pdf', b'x' * 2048, content_type='application/pdf')
        with mock.patch.object(upload_limits, 'ANNOUNCEMENT_ATTACHMENT_MAX_BYTES', 1024):
            response = self._announcement([big])
        self.assertEqual(response.status_code, 400)
        self.assertFalse(CompanyAnnouncement.objects.exists())

        ok = SimpleUploadedFile('a.pdf', b'x' * 10, content_type='application/pdf')
        response = self._announcement([ok])
        self.assertEqual(response.status_code, 201, response.content)

    def test_contract_template_must_be_docx(self):
        from hrm.models import ContractTemplate
        bad = SimpleUploadedFile('mau.pdf', b'%PDF-1.4', content_type='application/pdf')
        with mock.patch('boto3.client') as s3:
            response = self.client.post('/api-hrm/contract-templates/', {'name': 'Mẫu', 'contract_type': 'PROBATION', 'file': bad}, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertIn('file', response.json())
        s3.assert_not_called()
        self.assertFalse(ContractTemplate.objects.exists())


class SendAllAccountEmailsCooldownTests(TestCase):
    URL = '/api-hrm/employees/send-account-emails/'

    def setUp(self):
        self.admin = User.objects.create_superuser(username='cd-admin', password='Admin-Pass-2026')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        user = User.objects.create_user(username='cd-staff', password='Old-Pass-2026')
        self.staff = Employee.objects.create(user=user, employee_id='CD-001', full_name='NV',
                                             personal_email='s@b.vn', employment_status='ACTIVE')

    @override_settings(SEND_ALL_ACCOUNT_EMAILS_COOLDOWN_SECONDS=120)
    def test_second_send_all_blocked_within_cooldown(self):
        first = self.client.post(self.URL, {'send_all': True}, format='json')
        self.assertEqual(first.status_code, 200, first.data)
        second = self.client.post(self.URL, {'send_all': True}, format='json')
        self.assertEqual(second.status_code, 429)
        self.assertTrue(0 < second.data['retry_after'] <= 120)
        # Gửi cho từng người đã chọn không bị chặn.
        single = self.client.post(self.URL, {'employee_ids': [self.staff.id]}, format='json')
        self.assertEqual(single.status_code, 200, single.data)

    @override_settings(SEND_ALL_ACCOUNT_EMAILS_COOLDOWN_SECONDS=120)
    def test_allowed_again_after_cooldown(self):
        from datetime import timedelta
        from django.utils import timezone
        from hrm.models import EmailBatch
        self.assertEqual(self.client.post(self.URL, {'send_all': True}, format='json').status_code, 200)
        EmailBatch.objects.update(created_at=timezone.now() - timedelta(seconds=121))
        self.assertEqual(self.client.post(self.URL, {'send_all': True}, format='json').status_code, 200)

    @override_settings(SEND_ALL_ACCOUNT_EMAILS_COOLDOWN_SECONDS=0)
    def test_zero_disables_cooldown(self):
        self.assertEqual(self.client.post(self.URL, {'send_all': True}, format='json').status_code, 200)
        self.assertEqual(self.client.post(self.URL, {'send_all': True}, format='json').status_code, 200)


class AssetAssignConditionTests(TestCase):
    def setUp(self):
        from hrm.models import Asset
        self.admin = User.objects.create_superuser(username='as-admin', password='Admin-Pass-2026')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        target_user = User.objects.create_user(username='as-target', password='x-Pass-12345')
        self.target = Employee.objects.create(user=target_user, employee_id='AS-001', full_name='Người nhận')
        self.broken = Asset.objects.create(name='MAY-HONG', asset_type='LAPTOP', condition='BROKEN')
        self.poor = Asset.objects.create(name='MAY-KEM', asset_type='LAPTOP', condition='POOR')
        self.good = Asset.objects.create(name='MAY-TOT', asset_type='LAPTOP', condition='GOOD')

    def _assign(self, asset):
        return self.client.post(f'/api-hrm/assets/{asset.id}/assign/', {'employee_id': self.target.id}, format='json')

    def test_poor_and_broken_rejected(self):
        from hrm.models import AssetAssignmentHistory
        for asset in (self.broken, self.poor):
            response = self._assign(asset)
            self.assertEqual(response.status_code, 400, asset.condition)
            self.assertEqual(response.data['error_code'], 'CONDITION_UNASSIGNABLE')
        self.assertFalse(AssetAssignmentHistory.objects.exists())

    def test_good_asset_assignable(self):
        self.assertEqual(self._assign(self.good).status_code, 200)
