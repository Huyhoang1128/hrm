from django.contrib import admin

from .models import (
	KPI,
	KPIUpdate,
	KeyResult,
	OKRObjective,
	PerformanceCycle,
	TaskMetric,
	TaskMetricScore,
	WeeklySprint,
	WeeklyTask,
)


@admin.register(PerformanceCycle)
class PerformanceCycleAdmin(admin.ModelAdmin):
	list_display = ('name', 'team', 'framework', 'cycle_type', 'start_date', 'end_date', 'status', 'is_locked')
	list_filter = ('framework', 'cycle_type', 'status', 'team')
	search_fields = ('name', 'code', 'team__name')
	readonly_fields = ('created_at', 'updated_at')


@admin.register(KPI)
class KPIAdmin(admin.ModelAdmin):
	list_display = ('name', 'team', 'cycle', 'owner', 'target_value', 'current_value', 'status')
	list_filter = ('status', 'frequency', 'direction', 'team')
	search_fields = ('name', 'code', 'team__name')
	readonly_fields = ('created_at', 'updated_at')


@admin.register(KPIUpdate)
class KPIUpdateAdmin(admin.ModelAdmin):
	list_display = ('kpi', 'value', 'confidence_score', 'recorded_at', 'created_by')
	list_filter = ('team', 'recorded_at')
	search_fields = ('kpi__name', 'note')
	readonly_fields = ('created_at', 'updated_at')


@admin.register(OKRObjective)
class OKRObjectiveAdmin(admin.ModelAdmin):
	list_display = ('title', 'team', 'cycle', 'owner', 'status', 'progress_percent', 'confidence_score')
	list_filter = ('status', 'team', 'cycle')
	search_fields = ('title', 'description', 'team__name')
	readonly_fields = ('created_at', 'updated_at')


@admin.register(KeyResult)
class KeyResultAdmin(admin.ModelAdmin):
	list_display = ('title', 'objective', 'owner', 'current_value', 'target_value', 'status')
	list_filter = ('status', 'metric_type', 'team')
	search_fields = ('title', 'description', 'objective__title')
	readonly_fields = ('created_at', 'updated_at')


@admin.register(WeeklySprint)
class WeeklySprintAdmin(admin.ModelAdmin):
	list_display = ('name', 'team', 'week_start', 'week_end', 'status', 'scrum_master')
	list_filter = ('status', 'team')
	search_fields = ('name', 'goal', 'team__name')
	readonly_fields = ('created_at', 'updated_at')


@admin.register(WeeklyTask)
class WeeklyTaskAdmin(admin.ModelAdmin):
	list_display = ('title', 'team', 'sprint', 'assignee', 'status', 'priority', 'due_date')
	list_filter = ('status', 'priority', 'task_type', 'team')
	search_fields = ('title', 'description', 'assignee__user__username', 'key_result__title')
	readonly_fields = ('created_at', 'updated_at')


@admin.register(TaskMetric)
class TaskMetricAdmin(admin.ModelAdmin):
	list_display = ('name', 'team', 'code', 'weight', 'scale_type', 'is_required', 'is_active')
	list_filter = ('team', 'scale_type', 'is_required', 'is_active')
	search_fields = ('name', 'code', 'description')
	readonly_fields = ('created_at', 'updated_at')


@admin.register(TaskMetricScore)
class TaskMetricScoreAdmin(admin.ModelAdmin):
	list_display = ('task', 'metric', 'score', 'evaluator', 'created_at')
	list_filter = ('team', 'metric')
	search_fields = ('task__title', 'metric__name', 'note')
	readonly_fields = ('created_at', 'updated_at')
