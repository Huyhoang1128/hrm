import io
import shutil
import tempfile

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from employee.models import Department, Employee
from hrm.feedback_models import Feedback


def _png(name='loi-app.png'):
    buf = io.BytesIO()
    Image.new('RGB', (4, 4), 'red').save(buf, format='PNG')
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')


class FeedbackApiTests(APITestCase):
    def setUp(self):
        self.hcns = Department.objects.create(name='HCNS', code='FB-HCNS')
        self.hr_user = User.objects.create_user(username='feedback-hr', password='x')
        self.hr_employee = Employee.objects.create(
            user=self.hr_user, employee_id='FB-HR-001', full_name='HCNS Góp ý', is_hr=True, department=self.hcns,
        )
        self.staff_user = User.objects.create_user(username='feedback-staff', password='x')
        self.staff = Employee.objects.create(
            user=self.staff_user, employee_id='FB-NV-001', full_name='Nhân viên Góp ý',
        )

    def _submit(self, **extra):
        self.client.force_authenticate(self.staff_user)
        payload = {'topic': 'WORK', 'difficulties': 'Quy trình duyệt đơn hay bị treo'}
        payload.update(extra)
        return self.client.post('/api-hrm/feedbacks/', payload, format='json')

    def test_staff_submits_named_feedback(self):
        response = self._submit()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        fb = Feedback.objects.get(id=response.data['id'])
        self.assertEqual(fb.employee, self.staff)
        self.assertFalse(fb.is_anonymous)
        self.assertEqual(fb.status, 'NEW')

    def test_anonymous_feedback_stores_employee_but_hides_identity(self):
        response = self._submit(is_anonymous=True)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        fb = Feedback.objects.get(id=response.data['id'])
        self.assertEqual(fb.employee, self.staff)
        self.assertTrue(fb.is_anonymous)

        self.client.force_authenticate(self.hr_user)
        row = self.client.get('/api-hrm/feedbacks/', {'page': 1}).data['results'][0]
        self.assertIsNone(row['employee_name'])
        self.assertIsNone(row['employee_code'])
        self.assertIsNone(row['department_name'])
        # Tìm theo tên/mã người gửi không được lộ góp ý ẩn danh của họ.
        for term in ('Nhân viên Góp ý', 'FB-NV-001'):
            response = self.client.get('/api-hrm/feedbacks/', {'page': 1, 'search': term})
            self.assertEqual(response.data['count'], 0)

    def test_requires_topic_and_some_content(self):
        self.assertEqual(self._submit(topic='').status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self._submit(difficulties='   ').status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Feedback.objects.count(), 0)

    def test_staff_cannot_list_or_update(self):
        self._submit()
        fb_id = Feedback.objects.get().id
        self.assertEqual(self.client.get('/api-hrm/feedbacks/').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.get('/api-hrm/feedbacks/summary/').status_code, status.HTTP_403_FORBIDDEN)
        response = self.client.patch(f'/api-hrm/feedbacks/{fb_id}/', {'status': 'RESOLVED'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_hr_lists_filters_and_updates(self):
        self._submit()
        self._submit(topic='POLICY', difficulties='', work_proposal='Tăng phụ cấp', is_anonymous=True)

        self.client.force_authenticate(self.hr_user)
        response = self.client.get('/api-hrm/feedbacks/', {'page': 1, 'page_size': 20})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 2)
        anon = next(r for r in response.data['results'] if r['is_anonymous'])
        self.assertIsNone(anon['employee_name'])
        named = next(r for r in response.data['results'] if not r['is_anonymous'])
        self.assertEqual(named['employee_code'], 'FB-NV-001')

        response = self.client.get('/api-hrm/feedbacks/', {'page': 1, 'topic': 'POLICY'})
        self.assertEqual(response.data['count'], 1)
        response = self.client.get('/api-hrm/feedbacks/', {'page': 1, 'search': 'treo'})
        self.assertEqual(response.data['count'], 1)

        response = self.client.patch(
            f"/api-hrm/feedbacks/{named['id']}/", {'status': 'RESOLVED', 'hr_note': 'Đã báo IT'}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'RESOLVED')
        self.assertEqual(response.data['handled_by_name'], 'HCNS Góp ý')

        summary = self.client.get('/api-hrm/feedbacks/summary/').data
        self.assertEqual(
            {k: summary[k] for k in ('total', 'open', 'NEW', 'IN_PROGRESS', 'RESOLVED')},
            {'total': 2, 'open': 1, 'NEW': 1, 'IN_PROGRESS': 0, 'RESOLVED': 1},
        )
        self.assertNotIn('HRM_APP', summary['topics'])

        # Tab "Tất cả" chỉ lấy góp ý chưa xử lý xong.
        response = self.client.get('/api-hrm/feedbacks/', {'page': 1, 'status': 'NEW,IN_PROGRESS'})
        self.assertEqual(response.data['count'], 1)
        self.assertTrue(response.data['results'][0]['is_anonymous'])


class FeedbackRoutingTests(APITestCase):
    """Góp ý IT/app → HCNS/Admin phòng IT (+ admin hệ thống); vấn đề khác → HCNS/Admin phòng còn lại."""

    def setUp(self):
        hcns = Department.objects.create(name='HCNS', code='FB-RT-HCNS')
        it = Department.objects.create(name='Công nghệ thông tin', code='CÔNG_NGHỆ_THÔNG_TIN')

        def make(username, code, department=None, is_hr=False, superuser=False):
            user = User.objects.create_user(username=username, password='x', is_staff=superuser, is_superuser=superuser)
            emp = Employee.objects.create(
                user=user, employee_id=code, full_name=username, is_hr=is_hr, department=department,
            ) if code else None
            return user, emp

        self.hr_user, _ = make('rt-hr', 'RT-HR', hcns, is_hr=True)
        self.hr_head, _ = make('rt-hr-head', 'RT-HRHEAD', hcns, is_hr=True, superuser=True)
        self.it_user, _ = make('rt-it', 'RT-IT', it, is_hr=True)
        self.sys_admin, _ = make('rt-admin', None, superuser=True)
        self.staff_user, self.staff = make('rt-staff', 'RT-NV')
        self.other_user, _ = make('rt-other', 'RT-NV2')

    def _submit(self, topic, user=None, **extra):
        self.client.force_authenticate(user or self.staff_user)
        payload = {'topic': topic, 'difficulties': f'Góp ý {topic}', **extra}
        response = self.client.post('/api-hrm/feedbacks/', payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return response.data['id']

    def _topics_seen_by(self, user):
        self.client.force_authenticate(user)
        response = self.client.get('/api-hrm/feedbacks/', {'page': 1, 'page_size': 50})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return sorted(r['topic'] for r in response.data['results'])

    def test_topics_routed_by_department(self):
        app_id = self._submit('HRM_APP')
        self._submit('IT_SUPPORT')
        self._submit('POLICY')
        self.assertEqual(self._topics_seen_by(self.hr_user), ['POLICY'])
        # Trưởng phòng HCNS là superuser nhưng vẫn chỉ thấy phần HCNS.
        self.assertEqual(self._topics_seen_by(self.hr_head), ['POLICY'])
        self.assertEqual(self._topics_seen_by(self.it_user), ['HRM_APP', 'IT_SUPPORT'])
        self.assertEqual(self._topics_seen_by(self.sys_admin), ['HRM_APP', 'IT_SUPPORT'])

        self.client.force_authenticate(self.hr_user)
        response = self.client.patch(f'/api-hrm/feedbacks/{app_id}/', {'status': 'RESOLVED'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_pending_notice_counts_only_new_in_own_scope(self):
        self._submit('HRM_APP')
        policy_id = self._submit('POLICY')
        latest_id = self._submit('WORK')

        self.client.force_authenticate(self.hr_user)
        self.client.patch(f'/api-hrm/feedbacks/{policy_id}/', {'status': 'IN_PROGRESS'}, format='json')
        notice = self.client.get('/api-hrm/feedbacks/notices/').data
        self.assertTrue(notice['can_handle'])
        self.assertEqual(notice['pending_count'], 1)
        self.assertEqual(notice['latest_pending_id'], latest_id)

        self.client.force_authenticate(self.it_user)
        self.assertEqual(self.client.get('/api-hrm/feedbacks/notices/').data['pending_count'], 1)

        self.client.force_authenticate(self.staff_user)
        notice = self.client.get('/api-hrm/feedbacks/notices/').data
        self.assertFalse(notice['can_handle'])
        self.assertEqual(notice['pending_count'], 0)

    def test_sender_notified_when_resolved_until_acknowledged(self):
        named_id = self._submit('POLICY')
        anon_id = self._submit('WORK', is_anonymous=True)
        self._submit('OTHER')  # chưa xử lý -> không báo

        self.client.force_authenticate(self.hr_user)
        for fb_id in (named_id, anon_id):
            self.client.patch(f'/api-hrm/feedbacks/{fb_id}/', {'status': 'RESOLVED'}, format='json')

        self.client.force_authenticate(self.staff_user)
        resolved = self.client.get('/api-hrm/feedbacks/notices/').data['resolved']
        self.assertEqual(sorted(r['id'] for r in resolved), sorted([named_id, anon_id]))
        self.assertTrue(all(r['resolved_at'] for r in resolved))

        # Người khác không xác nhận hộ được.
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.client.get('/api-hrm/feedbacks/notices/').data['resolved'], [])
        response = self.client.post('/api-hrm/feedbacks/acknowledge-resolved/', {'ids': [named_id]}, format='json')
        self.assertEqual(response.data['updated'], 0)

        self.client.force_authenticate(self.staff_user)
        response = self.client.post(
            '/api-hrm/feedbacks/acknowledge-resolved/', {'ids': [named_id, anon_id]}, format='json',
        )
        self.assertEqual(response.data['updated'], 2)
        self.assertEqual(self.client.get('/api-hrm/feedbacks/notices/').data['resolved'], [])

        # Mở lại rồi xử lý xong lần nữa -> báo lại.
        self.client.force_authenticate(self.hr_user)
        self.client.patch(f'/api-hrm/feedbacks/{named_id}/', {'status': 'IN_PROGRESS'}, format='json')
        self.assertIsNone(Feedback.objects.get(id=named_id).resolved_at)
        self.client.patch(f'/api-hrm/feedbacks/{named_id}/', {'status': 'RESOLVED'}, format='json')
        self.client.force_authenticate(self.staff_user)
        resolved = self.client.get('/api-hrm/feedbacks/notices/').data['resolved']
        self.assertEqual([r['id'] for r in resolved], [named_id])

    def test_sender_tracks_own_feedbacks_with_reply_but_not_internal_note(self):
        """Người gửi tự theo dõi ý kiến của mình: trạng thái, mốc tiếp nhận/xử
        lý xong, phản hồi — không thấy ghi chú nội bộ, không thấy ý kiến người khác."""
        policy_id = self._submit('POLICY')
        app_id = self._submit('HRM_APP', is_anonymous=True)
        self._submit('WORK', user=self.other_user)

        self.client.force_authenticate(self.hr_user)
        self.client.patch(f'/api-hrm/feedbacks/{policy_id}/', {
            'status': 'IN_PROGRESS', 'hr_note': 'Nội bộ: chờ BGĐ', 'response_note': 'HCNS đã tiếp nhận, sẽ phản hồi trong tuần',
        }, format='json')
        self.client.force_authenticate(self.it_user)
        self.client.patch(f'/api-hrm/feedbacks/{app_id}/', {'status': 'RESOLVED', 'response_note': 'Đã sửa lỗi'}, format='json')

        self.client.force_authenticate(self.staff_user)
        data = self.client.get('/api-hrm/feedbacks/mine/', {'page': 1}).data
        self.assertEqual(data['count'], 2)
        self.assertEqual(data['counts'], {'total': 2, 'NEW': 0, 'IN_PROGRESS': 1, 'RESOLVED': 1})
        by_id = {r['id']: r for r in data['results']}
        policy = by_id[policy_id]
        self.assertEqual(policy['status_display'], 'Đang xử lý')
        self.assertEqual(policy['response_note'], 'HCNS đã tiếp nhận, sẽ phản hồi trong tuần')
        self.assertEqual(policy['handler_unit'], 'HCNS')
        self.assertIsNotNone(policy['received_at'])
        self.assertIsNone(policy['resolved_at'])
        self.assertNotIn('hr_note', policy)
        self.assertEqual(by_id[app_id]['handler_unit'], 'IT')
        self.assertIsNotNone(by_id[app_id]['received_at'])

        filtered = self.client.get('/api-hrm/feedbacks/mine/', {'page': 1, 'status': 'RESOLVED'}).data
        self.assertEqual([r['id'] for r in filtered['results']], [app_id])
        notice = self.client.get('/api-hrm/feedbacks/notices/').data['resolved']
        self.assertEqual(notice[0]['response_note'], 'Đã sửa lỗi')

        # Chuyển về "Chờ tiếp nhận" thì xoá mốc tiếp nhận.
        self.client.force_authenticate(self.hr_user)
        self.client.patch(f'/api-hrm/feedbacks/{policy_id}/', {'status': 'NEW'}, format='json')
        self.assertIsNone(Feedback.objects.get(id=policy_id).received_at)


class FeedbackImageTests(APITestCase):
    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=self.media, CLOUDFLY_ENABLED=False)
        override.enable()
        self.addCleanup(override.disable)

        # Góp ý lỗi app (HRM_APP) do HCNS/Admin phòng IT xem.
        it = Department.objects.create(name='Phòng IT', code='IT')
        self.hr_user = User.objects.create_user(username='fb-img-hr', password='x')
        Employee.objects.create(user=self.hr_user, employee_id='FB-IMG-HR', full_name='IT', is_hr=True, department=it)
        self.staff_user = User.objects.create_user(username='fb-img-staff', password='x')
        Employee.objects.create(user=self.staff_user, employee_id='FB-IMG-NV', full_name='NV')

    def _post(self, images, **extra):
        self.client.force_authenticate(self.staff_user)
        payload = {'topic': 'HRM_APP', 'difficulties': 'Lỗi màn hình duyệt đơn', 'images': images}
        payload.update(extra)
        return self.client.post('/api-hrm/feedbacks/', payload, format='multipart')

    def test_images_are_saved_and_returned_to_hr(self):
        response = self._post([_png('a.png'), _png('b.png')])
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Feedback.objects.get().attachments.count(), 2)

        self.client.force_authenticate(self.hr_user)
        row = self.client.get('/api-hrm/feedbacks/', {'page': 1}).data['results'][0]
        self.assertEqual([a['file_name'] for a in row['attachments']], ['a.png', 'b.png'])
        self.assertTrue(all(a['url'] for a in row['attachments']))

    def test_image_only_feedback_is_allowed(self):
        response = self._post([_png()], difficulties='')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_rejects_non_image_and_too_many(self):
        fake = SimpleUploadedFile('virus.png', b'not an image', content_type='image/png')
        self.assertEqual(self._post([fake]).status_code, status.HTTP_400_BAD_REQUEST)
        too_many = [_png(f'{i}.png') for i in range(6)]
        self.assertEqual(self._post(too_many).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Feedback.objects.count(), 0)
