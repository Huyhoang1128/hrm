from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from team.models import Team, TeamMembership


class TeamScopedQuerySet(models.QuerySet):
	def visible_to(self, user):
		if not user or not user.is_authenticated:
			return self.none()
		if user.is_superuser:
			return self
		return self.filter(
			team__memberships__user=user,
			team__memberships__status=TeamMembership.STATUS_ACTIVE,
		).distinct()


class TeamScopedModel(models.Model):
	team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name='%(class)ss', verbose_name='Team')
	created_by = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='created_%(class)ss',
		verbose_name='Người tạo',
	)
	updated_by = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='updated_%(class)ss',
		verbose_name='Người cập nhật cuối',
	)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	objects = TeamScopedQuerySet.as_manager()

	class Meta:
		abstract = True


class PerformanceCycle(TeamScopedModel):
	FRAMEWORK_KPI = 'KPI'
	FRAMEWORK_OKR = 'OKR'
	FRAMEWORK_CHOICES = [
		(FRAMEWORK_KPI, 'KPI'),
		(FRAMEWORK_OKR, 'OKR'),
	]

	TYPE_WEEKLY = 'WEEKLY'
	TYPE_MONTHLY = 'MONTHLY'
	TYPE_QUARTERLY = 'QUARTERLY'
	TYPE_YEARLY = 'YEARLY'
	TYPE_CUSTOM = 'CUSTOM'
	CYCLE_TYPE_CHOICES = [
		(TYPE_WEEKLY, 'Tuần'),
		(TYPE_MONTHLY, 'Tháng'),
		(TYPE_QUARTERLY, 'Quý'),
		(TYPE_YEARLY, 'Năm'),
		(TYPE_CUSTOM, 'Tuỳ biến'),
	]

	STATUS_DRAFT = 'DRAFT'
	STATUS_ACTIVE = 'ACTIVE'
	STATUS_CLOSED = 'CLOSED'
	STATUS_ARCHIVED = 'ARCHIVED'
	STATUS_CHOICES = [
		(STATUS_DRAFT, 'Nháp'),
		(STATUS_ACTIVE, 'Đang chạy'),
		(STATUS_CLOSED, 'Đã đóng'),
		(STATUS_ARCHIVED, 'Lưu trữ'),
	]

	name = models.CharField(max_length=150, verbose_name='Tên chu kỳ')
	code = models.CharField(max_length=50, verbose_name='Mã chu kỳ')
	framework = models.CharField(max_length=10, choices=FRAMEWORK_CHOICES, verbose_name='Khung quản trị')
	cycle_type = models.CharField(max_length=20, choices=CYCLE_TYPE_CHOICES, default=TYPE_MONTHLY, verbose_name='Loại chu kỳ')
	start_date = models.DateField(verbose_name='Ngày bắt đầu')
	end_date = models.DateField(verbose_name='Ngày kết thúc')
	status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT, verbose_name='Trạng thái')
	description = models.TextField(blank=True, verbose_name='Mô tả')
	is_locked = models.BooleanField(default=False, verbose_name='Khoá chỉnh sửa')

	class Meta:
		verbose_name = 'Performance Cycle'
		verbose_name_plural = 'Performance Cycles'
		ordering = ['-start_date', 'team__name', 'framework']
		unique_together = [('team', 'code')]
		indexes = [
			models.Index(fields=['team', 'framework', 'status']),
			models.Index(fields=['team', 'start_date', 'end_date']),
		]

	def __str__(self):
		return f'{self.team.name} - {self.name}'

	def clean(self):
		if self.end_date < self.start_date:
			raise ValidationError('Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.')


class KPI(TeamScopedModel):
	DIRECTION_UP = 'INCREASE'
	DIRECTION_DOWN = 'DECREASE'
	DIRECTION_MAINTAIN = 'MAINTAIN'
	DIRECTION_CHOICES = [
		(DIRECTION_UP, 'Càng cao càng tốt'),
		(DIRECTION_DOWN, 'Càng thấp càng tốt'),
		(DIRECTION_MAINTAIN, 'Duy trì trong ngưỡng'),
	]

	FREQUENCY_DAILY = 'DAILY'
	FREQUENCY_WEEKLY = 'WEEKLY'
	FREQUENCY_MONTHLY = 'MONTHLY'
	FREQUENCY_QUARTERLY = 'QUARTERLY'
	FREQUENCY_CHOICES = [
		(FREQUENCY_DAILY, 'Hàng ngày'),
		(FREQUENCY_WEEKLY, 'Hàng tuần'),
		(FREQUENCY_MONTHLY, 'Hàng tháng'),
		(FREQUENCY_QUARTERLY, 'Hàng quý'),
	]

	STATUS_DRAFT = 'DRAFT'
	STATUS_ACTIVE = 'ACTIVE'
	STATUS_ON_HOLD = 'ON_HOLD'
	STATUS_CLOSED = 'CLOSED'
	STATUS_CHOICES = [
		(STATUS_DRAFT, 'Nháp'),
		(STATUS_ACTIVE, 'Đang theo dõi'),
		(STATUS_ON_HOLD, 'Tạm dừng'),
		(STATUS_CLOSED, 'Đã đóng'),
	]

	cycle = models.ForeignKey(PerformanceCycle, on_delete=models.CASCADE, related_name='kpis', verbose_name='Chu kỳ KPI')
	owner = models.ForeignKey(
		TeamMembership,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='owned_kpis',
		verbose_name='Người phụ trách',
	)
	name = models.CharField(max_length=200, verbose_name='Tên KPI')
	code = models.CharField(max_length=50, verbose_name='Mã KPI')
	description = models.TextField(blank=True, verbose_name='Mô tả')
	category = models.CharField(max_length=100, blank=True, verbose_name='Nhóm KPI')
	unit = models.CharField(max_length=30, default='point', verbose_name='Đơn vị đo')
	direction = models.CharField(max_length=20, choices=DIRECTION_CHOICES, default=DIRECTION_UP, verbose_name='Hướng đánh giá')
	frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES, default=FREQUENCY_WEEKLY, verbose_name='Tần suất cập nhật')
	baseline_value = models.DecimalField(max_digits=14, decimal_places=2, default=0, verbose_name='Giá trị gốc')
	target_value = models.DecimalField(max_digits=14, decimal_places=2, verbose_name='Mục tiêu')
	current_value = models.DecimalField(max_digits=14, decimal_places=2, default=0, verbose_name='Giá trị hiện tại')
	warning_threshold = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True, verbose_name='Ngưỡng cảnh báo')
	critical_threshold = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True, verbose_name='Ngưỡng nguy hiểm')
	weight = models.DecimalField(max_digits=5, decimal_places=2, default=1, verbose_name='Trọng số')
	data_source = models.CharField(max_length=100, blank=True, verbose_name='Nguồn dữ liệu')
	status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE, verbose_name='Trạng thái')

	class Meta:
		verbose_name = 'KPI'
		verbose_name_plural = 'KPIs'
		ordering = ['team__name', 'name']
		unique_together = [('team', 'code')]
		indexes = [
			models.Index(fields=['team', 'status']),
			models.Index(fields=['cycle', 'status']),
		]

	def __str__(self):
		return f'{self.team.name} - {self.name}'

	def clean(self):
		if self.cycle.framework != PerformanceCycle.FRAMEWORK_KPI:
			raise ValidationError('KPI chỉ được gắn với chu kỳ có framework = KPI.')
		if self.cycle.team_id != self.team_id:
			raise ValidationError('Chu kỳ KPI phải thuộc cùng team.')
		if self.owner and self.owner.team_id != self.team_id:
			raise ValidationError('Owner KPI phải thuộc cùng team.')

	@property
	def progress_percent(self):
		if self.target_value in (None, Decimal('0')):
			return Decimal('0')
		if self.direction == self.DIRECTION_DOWN:
			if self.baseline_value == self.target_value:
				return Decimal('100') if self.current_value <= self.target_value else Decimal('0')
			progress = ((self.baseline_value - self.current_value) / (self.baseline_value - self.target_value)) * 100
		else:
			progress = (self.current_value / self.target_value) * 100
		return max(Decimal('0'), min(Decimal('100'), progress.quantize(Decimal('0.01'))))


class KPIUpdate(TeamScopedModel):
	kpi = models.ForeignKey(KPI, on_delete=models.CASCADE, related_name='updates', verbose_name='KPI')
	value = models.DecimalField(max_digits=14, decimal_places=2, verbose_name='Giá trị cập nhật')
	note = models.TextField(blank=True, verbose_name='Ghi chú')
	confidence_score = models.PositiveSmallIntegerField(default=100, verbose_name='Độ tin cậy (%)')
	recorded_at = models.DateTimeField(verbose_name='Thời điểm ghi nhận')

	class Meta:
		verbose_name = 'KPI Update'
		verbose_name_plural = 'KPI Updates'
		ordering = ['-recorded_at']
		indexes = [models.Index(fields=['kpi', 'recorded_at'])]

	def __str__(self):
		return f'{self.kpi.name} @ {self.recorded_at:%d/%m/%Y %H:%M}'

	def clean(self):
		if self.kpi.team_id != self.team_id:
			raise ValidationError('KPI update phải cùng team với KPI.')
		if not 0 <= self.confidence_score <= 100:
			raise ValidationError('Độ tin cậy phải nằm trong khoảng 0-100.')

	def save(self, *args, **kwargs):
		super().save(*args, **kwargs)
		KPI.objects.filter(pk=self.kpi_id).update(current_value=self.value)


class OKRObjective(TeamScopedModel):
	STATUS_DRAFT = 'DRAFT'
	STATUS_ACTIVE = 'ACTIVE'
	STATUS_AT_RISK = 'AT_RISK'
	STATUS_COMPLETED = 'COMPLETED'
	STATUS_DROPPED = 'DROPPED'
	STATUS_CHOICES = [
		(STATUS_DRAFT, 'Nháp'),
		(STATUS_ACTIVE, 'Đang chạy'),
		(STATUS_AT_RISK, 'Rủi ro'),
		(STATUS_COMPLETED, 'Hoàn thành'),
		(STATUS_DROPPED, 'Dừng'),
	]

	cycle = models.ForeignKey(PerformanceCycle, on_delete=models.CASCADE, related_name='objectives', verbose_name='Chu kỳ OKR')
	owner = models.ForeignKey(
		TeamMembership,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='owned_objectives',
		verbose_name='Owner objective',
	)
	title = models.CharField(max_length=255, verbose_name='Objective')
	description = models.TextField(blank=True, verbose_name='Mô tả')
	priority = models.PositiveSmallIntegerField(default=3, verbose_name='Độ ưu tiên')
	confidence_score = models.PositiveSmallIntegerField(default=70, verbose_name='Confidence (%)')
	status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE, verbose_name='Trạng thái')
	progress_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name='Tiến độ (%)')

	class Meta:
		verbose_name = 'OKR Objective'
		verbose_name_plural = 'OKR Objectives'
		ordering = ['team__name', 'priority', 'title']
		indexes = [
			models.Index(fields=['team', 'status']),
			models.Index(fields=['cycle', 'status']),
		]

	def __str__(self):
		return self.title

	def clean(self):
		if self.cycle.framework != PerformanceCycle.FRAMEWORK_OKR:
			raise ValidationError('Objective chỉ được gắn với chu kỳ có framework = OKR.')
		if self.cycle.team_id != self.team_id:
			raise ValidationError('Chu kỳ OKR phải thuộc cùng team.')
		if self.owner and self.owner.team_id != self.team_id:
			raise ValidationError('Owner objective phải thuộc cùng team.')
		if not 0 <= self.confidence_score <= 100:
			raise ValidationError('Confidence phải nằm trong khoảng 0-100.')


class KeyResult(TeamScopedModel):
	METRIC_NUMBER = 'NUMBER'
	METRIC_PERCENT = 'PERCENT'
	METRIC_CURRENCY = 'CURRENCY'
	METRIC_BOOLEAN = 'BOOLEAN'
	METRIC_CHOICES = [
		(METRIC_NUMBER, 'Số lượng'),
		(METRIC_PERCENT, 'Phần trăm'),
		(METRIC_CURRENCY, 'Tiền tệ'),
		(METRIC_BOOLEAN, 'Đạt / Không đạt'),
	]

	STATUS_NOT_STARTED = 'NOT_STARTED'
	STATUS_ON_TRACK = 'ON_TRACK'
	STATUS_AT_RISK = 'AT_RISK'
	STATUS_DONE = 'DONE'
	STATUS_CHOICES = [
		(STATUS_NOT_STARTED, 'Chưa bắt đầu'),
		(STATUS_ON_TRACK, 'Đúng tiến độ'),
		(STATUS_AT_RISK, 'Rủi ro'),
		(STATUS_DONE, 'Hoàn thành'),
	]

	objective = models.ForeignKey(OKRObjective, on_delete=models.CASCADE, related_name='key_results', verbose_name='Objective')
	owner = models.ForeignKey(
		TeamMembership,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='owned_key_results',
		verbose_name='Owner KR',
	)
	title = models.CharField(max_length=255, verbose_name='Key Result')
	description = models.TextField(blank=True, verbose_name='Mô tả')
	metric_type = models.CharField(max_length=20, choices=METRIC_CHOICES, default=METRIC_NUMBER, verbose_name='Loại đo lường')
	unit = models.CharField(max_length=30, default='point', verbose_name='Đơn vị')
	start_value = models.DecimalField(max_digits=14, decimal_places=2, default=0, verbose_name='Giá trị đầu kỳ')
	target_value = models.DecimalField(max_digits=14, decimal_places=2, verbose_name='Mục tiêu')
	current_value = models.DecimalField(max_digits=14, decimal_places=2, default=0, verbose_name='Giá trị hiện tại')
	weight = models.DecimalField(max_digits=5, decimal_places=2, default=1, verbose_name='Trọng số')
	status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_NOT_STARTED, verbose_name='Trạng thái')
	due_date = models.DateField(null=True, blank=True, verbose_name='Hạn KR')

	class Meta:
		verbose_name = 'Key Result'
		verbose_name_plural = 'Key Results'
		ordering = ['objective__title', 'title']
		indexes = [
			models.Index(fields=['objective', 'status']),
			models.Index(fields=['team', 'status']),
		]

	def __str__(self):
		return self.title

	def clean(self):
		if self.objective.team_id != self.team_id:
			raise ValidationError('Key Result phải thuộc cùng team với Objective.')
		if self.owner and self.owner.team_id != self.team_id:
			raise ValidationError('Owner KR phải thuộc cùng team.')

	@property
	def progress_percent(self):
		if self.metric_type == self.METRIC_BOOLEAN:
			return Decimal('100.00') if self.current_value >= self.target_value else Decimal('0.00')
		denominator = self.target_value - self.start_value
		if denominator == 0:
			return Decimal('100.00') if self.current_value >= self.target_value else Decimal('0.00')
		progress = ((self.current_value - self.start_value) / denominator) * 100
		return max(Decimal('0.00'), min(Decimal('100.00'), progress.quantize(Decimal('0.01'))))


class WeeklySprint(TeamScopedModel):
	STATUS_PLANNED = 'PLANNED'
	STATUS_ACTIVE = 'ACTIVE'
	STATUS_REVIEW = 'REVIEW'
	STATUS_CLOSED = 'CLOSED'
	STATUS_CHOICES = [
		(STATUS_PLANNED, 'Planned'),
		(STATUS_ACTIVE, 'Active'),
		(STATUS_REVIEW, 'Review'),
		(STATUS_CLOSED, 'Closed'),
	]

	name = models.CharField(max_length=150, verbose_name='Tên sprint')
	goal = models.CharField(max_length=255, blank=True, verbose_name='Mục tiêu sprint')
	week_start = models.DateField(verbose_name='Bắt đầu tuần')
	week_end = models.DateField(verbose_name='Kết thúc tuần')
	status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PLANNED, verbose_name='Trạng thái')
	scrum_master = models.ForeignKey(
		TeamMembership,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='scrum_sprints',
		verbose_name='Scrum master',
	)
	review_note = models.TextField(blank=True, verbose_name='Ghi chú review')

	class Meta:
		verbose_name = 'Weekly Sprint'
		verbose_name_plural = 'Weekly Sprints'
		ordering = ['-week_start', 'team__name']
		unique_together = [('team', 'week_start', 'week_end')]
		indexes = [models.Index(fields=['team', 'status', 'week_start'])]

	def __str__(self):
		return f'{self.team.name} - {self.name}'

	def clean(self):
		if self.week_end < self.week_start:
			raise ValidationError('Ngày kết thúc sprint phải sau ngày bắt đầu.')
		if self.scrum_master and self.scrum_master.team_id != self.team_id:
			raise ValidationError('Scrum master phải thuộc cùng team.')


class WeeklyTask(TeamScopedModel):
	TYPE_FEATURE = 'FEATURE'
	TYPE_BUG = 'BUG'
	TYPE_IMPROVEMENT = 'IMPROVEMENT'
	TYPE_SUPPORT = 'SUPPORT'
	TYPE_RESEARCH = 'RESEARCH'
	TYPE_CHOICES = [
		(TYPE_FEATURE, 'Feature'),
		(TYPE_BUG, 'Bug'),
		(TYPE_IMPROVEMENT, 'Improvement'),
		(TYPE_SUPPORT, 'Support'),
		(TYPE_RESEARCH, 'Research'),
	]

	PRIORITY_LOW = 'LOW'
	PRIORITY_MEDIUM = 'MEDIUM'
	PRIORITY_HIGH = 'HIGH'
	PRIORITY_CRITICAL = 'CRITICAL'
	PRIORITY_CHOICES = [
		(PRIORITY_LOW, 'Thấp'),
		(PRIORITY_MEDIUM, 'Trung bình'),
		(PRIORITY_HIGH, 'Cao'),
		(PRIORITY_CRITICAL, 'Khẩn cấp'),
	]

	STATUS_BACKLOG = 'BACKLOG'
	STATUS_TODO = 'TODO'
	STATUS_IN_PROGRESS = 'IN_PROGRESS'
	STATUS_BLOCKED = 'BLOCKED'
	STATUS_IN_REVIEW = 'IN_REVIEW'
	STATUS_DONE = 'DONE'
	STATUS_CANCELLED = 'CANCELLED'
	STATUS_CHOICES = [
		(STATUS_BACKLOG, 'Backlog'),
		(STATUS_TODO, 'Todo'),
		(STATUS_IN_PROGRESS, 'In Progress'),
		(STATUS_BLOCKED, 'Blocked'),
		(STATUS_IN_REVIEW, 'In Review'),
		(STATUS_DONE, 'Done'),
		(STATUS_CANCELLED, 'Cancelled'),
	]

	sprint = models.ForeignKey(WeeklySprint, on_delete=models.CASCADE, related_name='tasks', verbose_name='Sprint')
	objective = models.ForeignKey(
		OKRObjective,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='tasks',
		verbose_name='Objective liên quan',
	)
	key_result = models.ForeignKey(
		KeyResult,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='tasks',
		verbose_name='KR đóng góp',
	)
	assignee = models.ForeignKey(
		TeamMembership,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='assigned_tasks',
		verbose_name='Người thực hiện',
	)
	reviewer = models.ForeignKey(
		TeamMembership,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='review_tasks',
		verbose_name='Người review',
	)
	parent_task = models.ForeignKey(
		'self',
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='subtasks',
		verbose_name='Task cha',
	)
	title = models.CharField(max_length=255, verbose_name='Tên task')
	description = models.TextField(blank=True, verbose_name='Mô tả')
	task_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default=TYPE_FEATURE, verbose_name='Loại task')
	priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default=PRIORITY_MEDIUM, verbose_name='Độ ưu tiên')
	status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_TODO, verbose_name='Trạng thái')
	story_points = models.PositiveSmallIntegerField(default=0, verbose_name='Story point')
	estimate_hours = models.DecimalField(max_digits=8, decimal_places=2, default=0, verbose_name='Giờ ước tính')
	actual_hours = models.DecimalField(max_digits=8, decimal_places=2, default=0, verbose_name='Giờ thực tế')
	completion_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name='Hoàn thành (%)')
	contribution_weight = models.DecimalField(max_digits=5, decimal_places=2, default=1, verbose_name='Mức đóng góp vào KR')
	due_date = models.DateField(null=True, blank=True, verbose_name='Hạn hoàn thành')
	completed_at = models.DateTimeField(null=True, blank=True, verbose_name='Ngày hoàn thành')
	blocked_reason = models.TextField(blank=True, verbose_name='Lý do blocked')
	review_summary = models.TextField(blank=True, verbose_name='Tóm tắt review')

	class Meta:
		verbose_name = 'Weekly Task'
		verbose_name_plural = 'Weekly Tasks'
		ordering = ['-sprint__week_start', 'priority', 'title']
		indexes = [
			models.Index(fields=['team', 'status', 'priority']),
			models.Index(fields=['sprint', 'status']),
			models.Index(fields=['key_result', 'status']),
		]

	def __str__(self):
		return self.title

	def clean(self):
		relations = [self.sprint.team_id == self.team_id]
		if not all(relations):
			raise ValidationError('Task phải thuộc cùng team với sprint.')
		if self.objective and self.objective.team_id != self.team_id:
			raise ValidationError('Objective của task phải thuộc cùng team.')
		if self.key_result and self.key_result.team_id != self.team_id:
			raise ValidationError('KR của task phải thuộc cùng team.')
		if self.assignee and self.assignee.team_id != self.team_id:
			raise ValidationError('Assignee phải thuộc cùng team.')
		if self.reviewer and self.reviewer.team_id != self.team_id:
			raise ValidationError('Reviewer phải thuộc cùng team.')
		if self.parent_task and self.parent_task.team_id != self.team_id:
			raise ValidationError('Task cha phải thuộc cùng team.')
		if not 0 <= self.completion_percent <= 100:
			raise ValidationError('Tiến độ task phải nằm trong khoảng 0-100.')
		if self.key_result and self.objective and self.key_result.objective_id != self.objective_id:
			raise ValidationError('KR phải thuộc đúng objective đã chọn.')

	@property
	def weighted_metric_score(self):
		total_weight = Decimal('0')
		total_score = Decimal('0')
		for metric_score in self.metric_scores.select_related('metric').all():
			total_weight += metric_score.metric.weight
			total_score += metric_score.score * metric_score.metric.weight
		if not total_weight:
			return None
		return round(total_score / total_weight, 2)


class TaskMetric(TeamScopedModel):
	SCALE_FIVE = '5_POINT'
	SCALE_TEN = '10_POINT'
	SCALE_PERCENT = 'PERCENT'
	SCALE_CHOICES = [
		(SCALE_FIVE, '1-5'),
		(SCALE_TEN, '1-10'),
		(SCALE_PERCENT, '0-100'),
	]

	code = models.CharField(max_length=50, verbose_name='Mã metric')
	name = models.CharField(max_length=150, verbose_name='Tên metric')
	description = models.TextField(blank=True, verbose_name='Mô tả')
	weight = models.DecimalField(max_digits=5, decimal_places=2, default=1, verbose_name='Trọng số')
	scale_type = models.CharField(max_length=20, choices=SCALE_CHOICES, default=SCALE_FIVE, verbose_name='Thang điểm')
	min_score = models.DecimalField(max_digits=5, decimal_places=2, default=1, verbose_name='Điểm tối thiểu')
	max_score = models.DecimalField(max_digits=5, decimal_places=2, default=5, verbose_name='Điểm tối đa')
	is_required = models.BooleanField(default=True, verbose_name='Bắt buộc')
	is_active = models.BooleanField(default=True, verbose_name='Đang áp dụng')

	class Meta:
		verbose_name = 'Task Metric'
		verbose_name_plural = 'Task Metrics'
		ordering = ['team__name', 'name']
		unique_together = [('team', 'code')]
		indexes = [models.Index(fields=['team', 'is_active'])]

	def __str__(self):
		return self.name

	def clean(self):
		if self.max_score <= self.min_score:
			raise ValidationError('Điểm tối đa phải lớn hơn điểm tối thiểu.')


class TaskMetricScore(TeamScopedModel):
	task = models.ForeignKey(WeeklyTask, on_delete=models.CASCADE, related_name='metric_scores', verbose_name='Task')
	metric = models.ForeignKey(TaskMetric, on_delete=models.CASCADE, related_name='scores', verbose_name='Metric')
	evaluator = models.ForeignKey(
		TeamMembership,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='task_metric_scores',
		verbose_name='Người chấm',
	)
	score = models.DecimalField(max_digits=6, decimal_places=2, verbose_name='Điểm')
	note = models.TextField(blank=True, verbose_name='Nhận xét')

	class Meta:
		verbose_name = 'Task Metric Score'
		verbose_name_plural = 'Task Metric Scores'
		ordering = ['task__title', 'metric__name']
		unique_together = [('task', 'metric', 'evaluator')]
		indexes = [
			models.Index(fields=['task', 'metric']),
			models.Index(fields=['team', 'metric']),
		]

	def __str__(self):
		return f'{self.task.title} - {self.metric.name}'

	def clean(self):
		if self.task.team_id != self.team_id or self.metric.team_id != self.team_id:
			raise ValidationError('Task score phải cùng team với task và metric.')
		if self.evaluator and self.evaluator.team_id != self.team_id:
			raise ValidationError('Evaluator phải thuộc cùng team.')
		if self.score < self.metric.min_score or self.score > self.metric.max_score:
			raise ValidationError('Điểm đánh giá nằm ngoài thang điểm của metric.')
