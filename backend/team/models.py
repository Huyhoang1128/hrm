from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from django.utils.crypto import get_random_string

from employee.models import Employee


def _get_employee_for_user(user):
	if not user:
		return None
	try:
		return user.employee
	except Employee.DoesNotExist:
		return None


class TeamQuerySet(models.QuerySet):
	def active(self):
		return self.filter(is_active=True)

	def visible_to(self, user):
		if not user or not user.is_authenticated:
			return self.none()
		if user.is_superuser:
			return self
		return self.filter(
			memberships__user=user,
			memberships__status=TeamMembership.STATUS_ACTIVE,
		).distinct()


class Team(models.Model):
	VISIBILITY_PRIVATE = 'PRIVATE'
	VISIBILITY_INTERNAL = 'INTERNAL'
	VISIBILITY_PUBLIC = 'PUBLIC'
	VISIBILITY_CHOICES = [
		(VISIBILITY_PRIVATE, 'Riêng tư'),
		(VISIBILITY_INTERNAL, 'Nội bộ công ty'),
		(VISIBILITY_PUBLIC, 'Công khai nội bộ'),
	]

	name = models.CharField(max_length=150, verbose_name='Tên team')
	code = models.SlugField(max_length=50, unique=True, verbose_name='Mã team')
	description = models.TextField(blank=True, verbose_name='Mô tả')
	owner = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.PROTECT,
		related_name='owned_teams',
		verbose_name='Chủ team',
	)
	created_by = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='created_teams',
		verbose_name='Người tạo',
	)
	invite_code = models.CharField(max_length=16, unique=True, editable=False, verbose_name='Mã mời')
	visibility = models.CharField(
		max_length=20,
		choices=VISIBILITY_CHOICES,
		default=VISIBILITY_PRIVATE,
		verbose_name='Phạm vi hiển thị',
	)
	is_active = models.BooleanField(default=True, verbose_name='Đang hoạt động')
	metadata = models.JSONField(default=dict, blank=True, verbose_name='Metadata')
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	objects = TeamQuerySet.as_manager()

	class Meta:
		verbose_name = 'Team'
		verbose_name_plural = 'Teams'
		ordering = ['name']

	def __str__(self):
		return self.name

	def save(self, *args, **kwargs):
		is_new = self._state.adding
		if not self.created_by:
			self.created_by = self.owner
		if not self.invite_code:
			self.invite_code = self._generate_unique_invite_code()
		super().save(*args, **kwargs)
		if is_new:
			TeamMembership.objects.get_or_create(
				team=self,
				user=self.owner,
				defaults={
					'employee': _get_employee_for_user(self.owner),
					'role': TeamMembership.ROLE_OWNER,
					'status': TeamMembership.STATUS_ACTIVE,
					'joined_at': timezone.now(),
					'can_manage_members': True,
					'can_manage_kpi': True,
					'can_manage_okr': True,
					'can_manage_tasks': True,
				},
			)

	def _generate_unique_invite_code(self):
		while True:
			candidate = get_random_string(10).upper()
			if not Team.objects.filter(invite_code=candidate).exists():
				return candidate

	def is_member(self, user):
		return self.memberships.filter(user=user, status=TeamMembership.STATUS_ACTIVE).exists()


class TeamMembership(models.Model):
	ROLE_OWNER = 'OWNER'
	ROLE_LEAD = 'LEAD'
	ROLE_MEMBER = 'MEMBER'
	ROLE_VIEWER = 'VIEWER'
	ROLE_CHOICES = [
		(ROLE_OWNER, 'Owner'),
		(ROLE_LEAD, 'Lead'),
		(ROLE_MEMBER, 'Member'),
		(ROLE_VIEWER, 'Viewer'),
	]

	STATUS_INVITED = 'INVITED'
	STATUS_ACTIVE = 'ACTIVE'
	STATUS_LEFT = 'LEFT'
	STATUS_REMOVED = 'REMOVED'
	STATUS_CHOICES = [
		(STATUS_INVITED, 'Đã mời'),
		(STATUS_ACTIVE, 'Đang tham gia'),
		(STATUS_LEFT, 'Đã rời team'),
		(STATUS_REMOVED, 'Đã gỡ khỏi team'),
	]

	team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name='memberships', verbose_name='Team')
	user = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.CASCADE,
		related_name='team_memberships',
		verbose_name='Người dùng',
	)
	employee = models.ForeignKey(
		Employee,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='team_memberships',
		verbose_name='Nhân sự',
	)
	role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_MEMBER, verbose_name='Vai trò')
	status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE, verbose_name='Trạng thái')
	title = models.CharField(max_length=150, blank=True, verbose_name='Chức danh trong team')
	allocation_percent = models.DecimalField(max_digits=5, decimal_places=2, default=100, verbose_name='Tỉ lệ phân bổ')
	joined_at = models.DateTimeField(null=True, blank=True, verbose_name='Ngày tham gia')
	left_at = models.DateTimeField(null=True, blank=True, verbose_name='Ngày rời team')
	invited_by = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='invited_team_memberships',
		verbose_name='Người mời',
	)
	can_manage_members = models.BooleanField(default=False, verbose_name='Quản lý thành viên')
	can_manage_kpi = models.BooleanField(default=False, verbose_name='Quản lý KPI')
	can_manage_okr = models.BooleanField(default=False, verbose_name='Quản lý OKR')
	can_manage_tasks = models.BooleanField(default=False, verbose_name='Quản lý task')
	is_default_team = models.BooleanField(default=False, verbose_name='Team mặc định')
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		verbose_name = 'Team Membership'
		verbose_name_plural = 'Team Memberships'
		ordering = ['team__name', 'user__username']
		unique_together = [('team', 'user')]
		indexes = [
			models.Index(fields=['team', 'status']),
			models.Index(fields=['user', 'status']),
		]

	def __str__(self):
		return f'{self.team.name} - {self.user.username}'

	def clean(self):
		if self.employee and self.employee.user_id != self.user_id:
			raise ValidationError('Nhân sự phải thuộc đúng user của membership.')

	def save(self, *args, **kwargs):
		if not self.employee:
			self.employee = _get_employee_for_user(self.user)
		if not self.joined_at and self.status == self.STATUS_ACTIVE:
			self.joined_at = timezone.now()
		if self.role in {self.ROLE_OWNER, self.ROLE_LEAD}:
			self.can_manage_members = True
			self.can_manage_kpi = True
			self.can_manage_okr = True
			self.can_manage_tasks = True
		super().save(*args, **kwargs)


class TeamInvitation(models.Model):
	STATUS_PENDING = 'PENDING'
	STATUS_ACCEPTED = 'ACCEPTED'
	STATUS_EXPIRED = 'EXPIRED'
	STATUS_REVOKED = 'REVOKED'
	STATUS_CHOICES = [
		(STATUS_PENDING, 'Chờ phản hồi'),
		(STATUS_ACCEPTED, 'Đã chấp nhận'),
		(STATUS_EXPIRED, 'Hết hạn'),
		(STATUS_REVOKED, 'Đã thu hồi'),
	]

	team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name='invitations', verbose_name='Team')
	email = models.EmailField(verbose_name='Email được mời')
	invited_user = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='team_invitations',
		verbose_name='User được mời',
	)
	invited_by = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='sent_team_invitations',
		verbose_name='Người mời',
	)
	role = models.CharField(max_length=20, choices=TeamMembership.ROLE_CHOICES, default=TeamMembership.ROLE_MEMBER)
	invite_code = models.CharField(max_length=12, db_index=True, editable=False, verbose_name='Mã invite')
	token = models.CharField(max_length=64, unique=True, editable=False, verbose_name='Token mời')
	message = models.TextField(blank=True, verbose_name='Lời nhắn')
	status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, verbose_name='Trạng thái')
	expires_at = models.DateTimeField(verbose_name='Hạn mời')
	accepted_at = models.DateTimeField(null=True, blank=True, verbose_name='Thời điểm chấp nhận')
	accepted_membership = models.ForeignKey(
		TeamMembership,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='accepted_invitations',
		verbose_name='Membership tạo ra',
	)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		verbose_name = 'Team Invitation'
		verbose_name_plural = 'Team Invitations'
		ordering = ['-created_at']
		indexes = [
			models.Index(fields=['team', 'status']),
			models.Index(fields=['email', 'status']),
		]

	def __str__(self):
		return f'{self.team.name} - {self.email}'

	def save(self, *args, **kwargs):
		if not self.invite_code:
			self.invite_code = self._generate_unique_code('invite_code', 8)
		if not self.token:
			self.token = self._generate_unique_code('token', 48)
		if not self.expires_at:
			self.expires_at = timezone.now() + timedelta(days=7)
		super().save(*args, **kwargs)

	def clean(self):
		if self.expires_at and self.expires_at <= timezone.now() and self.status == self.STATUS_PENDING:
			raise ValidationError('Lời mời đã hết hạn.')

	def _generate_unique_code(self, field_name, length):
		while True:
			candidate = get_random_string(length).upper()
			if not TeamInvitation.objects.filter(**{field_name: candidate}).exists():
				return candidate

	@property
	def is_expired(self):
		return timezone.now() > self.expires_at
