from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework import serializers

from employee.models import Employee
from users.fields import UserDisplayNameField
from users.utils import get_user_display_name


class _CreatedBySerializer(serializers.Serializer):
    created_by_name = UserDisplayNameField(source='created_by')


class _Obj:
    def __init__(self, created_by):
        self.created_by = created_by


class UserDisplayNameTests(TestCase):
    def test_prefers_employee_full_name_then_family_name_first(self):
        user = User.objects.create_user('dn-1', password='x', first_name='A', last_name='Nguyễn Văn')
        self.assertEqual(user.get_full_name(), 'A Nguyễn Văn')  # thứ tự bị đảo của Django
        self.assertEqual(get_user_display_name(user), 'Nguyễn Văn A')
        Employee.objects.create(user=user, employee_id='NV95001', full_name='Phạm Văn D')
        user.refresh_from_db()
        self.assertEqual(get_user_display_name(user), 'Phạm Văn D')

    def test_falls_back_to_username(self):
        self.assertEqual(get_user_display_name(User.objects.create_user('dn-2', password='x')), 'dn-2')
        self.assertEqual(get_user_display_name(None), '')

    def test_serializer_field(self):
        user = User.objects.create_user('dn-3', password='x', first_name='B', last_name='Trần Thị')
        self.assertEqual(_CreatedBySerializer(_Obj(user)).data['created_by_name'], 'Trần Thị B')
        self.assertIsNone(_CreatedBySerializer(_Obj(None)).data['created_by_name'])

    def test_login_response_uses_display_name(self):
        User.objects.create_user('dn-4', password='pw-12345', first_name='C', last_name='Lê Văn')
        res = self.client.post(reverse('token-obtain'), {'username': 'dn-4', 'password': 'pw-12345'},
                               content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['user']['full_name'], 'Lê Văn C')
