from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Employee
from recruitment.models import RecruitmentNeed


class RecruitmentNeedVisibilityTests(APITestCase):
	def setUp(self):
		self.hr_user = User.objects.create_user(
			username='hr_user',
			password='testpass123',
		)
		Employee.objects.create(
			user=self.hr_user,
			employee_id='HR001',
			full_name='HR User',
			is_hr=True,
		)

		self.normal_user = User.objects.create_user(
			username='normal_user',
			password='testpass123',
		)

		self.owner_user = User.objects.create_user(
			username='owner_user',
			password='testpass123',
		)

		self.need = RecruitmentNeed.objects.create(
			position_name='Backend Developer',
			requested_by=self.owner_user,
		)

	def test_hr_employee_can_see_all_recruitment_needs(self):
		self.client.force_authenticate(user=self.hr_user)

		response = self.client.get('/api/v1/recruitment/needs/')

		self.assertEqual(response.status_code, 200)
		self.assertEqual(len(response.data), 1)
		self.assertEqual(response.data[0]['id'], self.need.id)

	def test_normal_user_only_sees_own_or_interviewer_needs(self):
		self.client.force_authenticate(user=self.normal_user)

		response = self.client.get('/api/v1/recruitment/needs/')

		self.assertEqual(response.status_code, 200)
		self.assertEqual(len(response.data), 0)
