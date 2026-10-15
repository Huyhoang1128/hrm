"""
recruitment/admin.py – Đăng ký models vào Django Admin.
"""
from django.contrib import admin

from .models import RecruitmentNeed, Job, JobChannel
from .candidate_models import Candidate
from .pipeline_models import (
    Application, ApplicationStageHistory,
    Interview, InterviewEvaluation, Offer,
)


# ---------------------------------------------------------------------------
# Inline admins
# ---------------------------------------------------------------------------

class JobChannelInline(admin.TabularInline):
    model = JobChannel
    extra = 1


class ApplicationStageHistoryInline(admin.TabularInline):
    model = ApplicationStageHistory
    extra = 0
    readonly_fields = ['entered_at']


class InterviewEvaluationInline(admin.TabularInline):
    model = InterviewEvaluation
    extra = 0


# ---------------------------------------------------------------------------
# ModelAdmin registrations
# ---------------------------------------------------------------------------

@admin.register(RecruitmentNeed)
class RecruitmentNeedAdmin(admin.ModelAdmin):
    list_display = [
        'position_name', 'department', 'headcount',
        'employment_type', 'status', 'target_onboard_date', 'created_at',
    ]
    list_filter = ['status', 'employment_type', 'department']
    search_fields = ['position_name']


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ['title', 'recruitment_need', 'status', 'published_at', 'created_at']
    list_filter = ['status']
    search_fields = ['title']
    inlines = [JobChannelInline]


@admin.register(Candidate)
class CandidateAdmin(admin.ModelAdmin):
    list_display = [
        'full_name', 'email', 'phone', 'source', 'status',
        'experience_years', 'is_blacklisted', 'created_at',
    ]
    list_filter = ['source', 'status', 'gender', 'is_blacklisted']
    search_fields = ['full_name', 'email', 'phone']


@admin.register(Application)
class ApplicationAdmin(admin.ModelAdmin):
    list_display = [
        'candidate', 'job', 'current_stage', 'status',
        'assignee', 'applied_at',
    ]
    list_filter = ['current_stage', 'status']
    search_fields = ['candidate__full_name', 'job__title']
    inlines = [ApplicationStageHistoryInline]


@admin.register(Interview)
class InterviewAdmin(admin.ModelAdmin):
    list_display = [
        'application', 'interview_type', 'scheduled_at',
        'duration_minutes', 'status',
    ]
    list_filter = ['interview_type', 'status']
    inlines = [InterviewEvaluationInline]


@admin.register(Offer)
class OfferAdmin(admin.ModelAdmin):
    list_display = [
        'application', 'proposed_salary', 'status',
        'expected_onboard_date', 'actual_onboard_date',
    ]
    list_filter = ['status']
    search_fields = ['application__candidate__full_name']
