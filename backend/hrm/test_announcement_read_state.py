from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from .models import CompanyAnnouncement, CompanyAnnouncementViewLog
from .views import CompanyAnnouncementViewSet


class AnnouncementReadStateTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser(
            username='announcement-admin-without-employee',
            email='announcement-admin@example.com',
            password='test-password',
        )
        self.announcement = CompanyAnnouncement.objects.create(
            announcement_code='ANN-READ-STATE-TEST',
            title='Thông báo kiểm thử',
            content='Nội dung',
            effective_from=timezone.now().date() - timedelta(days=1),
            apply_to_all=True,
            is_active=True,
        )
        self.factory = APIRequestFactory()

    def test_admin_without_employee_keeps_mark_all_read_state_after_reload(self):
        mark_all_view = CompanyAnnouncementViewSet.as_view({'post': 'mark_all_read'})
        # Query params are how the real frontend sends these filters.
        mark_request = self.factory.post(
            '/api-hrm/company-announcements/mark-all-read/?is_current=true&home_feed=true'
        )
        force_authenticate(mark_request, user=self.user)

        mark_response = mark_all_view(mark_request)

        self.assertEqual(mark_response.status_code, 200)
        self.assertEqual(mark_response.data['marked_count'], 1)
        self.assertTrue(CompanyAnnouncementViewLog.objects.filter(
            announcement=self.announcement,
            user=self.user,
            employee__isnull=True,
            acknowledged=True,
        ).exists())

        list_view = CompanyAnnouncementViewSet.as_view({'get': 'list'})
        reload_request = self.factory.get(
            '/api-hrm/company-announcements/',
            {
                'is_current': 'true',
                'home_feed': 'true',
                'unread_only': 'true',
                'page_size': 100,
            },
        )
        force_authenticate(reload_request, user=self.user)

        reload_response = list_view(reload_request)

        self.assertEqual(reload_response.status_code, 200)
        self.assertEqual(reload_response.data['results'], [])
