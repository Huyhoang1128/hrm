"""
recruitment/pipeline_serializers.py – Serializers cho pipeline, phỏng vấn, đánh giá, offer.
"""
from rest_framework import serializers

from .pipeline_models import (
    Application, ApplicationStageHistory,
    Interview, InterviewEvaluation, Offer,
)
from .candidate_serializers import CandidateListSerializer, resolve_candidate_cv_url
from .serializers import JobListSerializer


# ---------------------------------------------------------------------------
# ApplicationStageHistory
# ---------------------------------------------------------------------------

class ApplicationStageHistorySerializer(serializers.ModelSerializer):
    stage_display = serializers.CharField(source='get_stage_display', read_only=True)
    changed_by_name = serializers.CharField(
        source='changed_by.get_full_name', read_only=True
    )

    class Meta:
        model = ApplicationStageHistory
        fields = [
            'id', 'stage', 'stage_display', 'entered_at', 'exited_at',
            'changed_by', 'changed_by_name', 'note',
        ]
        read_only_fields = ['entered_at']


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

class ApplicationListSerializer(serializers.ModelSerializer):
    candidate_name = serializers.CharField(
        source='candidate.full_name', read_only=True
    )
    candidate_email = serializers.CharField(
        source='candidate.email', read_only=True
    )
    job_title = serializers.CharField(source='job.title', read_only=True)
    current_stage_display = serializers.CharField(
        source='get_current_stage_display', read_only=True
    )
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    assignee_name = serializers.CharField(
        source='assignee.get_full_name', read_only=True
    )
    cv_process_status_display = serializers.CharField(
        source='get_cv_process_status_display', read_only=True
    )
    candidate_source = serializers.CharField(
        source='candidate.get_source_display', read_only=True
    )
    candidate_cv_url = serializers.SerializerMethodField()
    is_referral = serializers.SerializerMethodField()
    need_interviewer_employee_id = serializers.SerializerMethodField()
    need_interviewer_full_name = serializers.SerializerMethodField()

    class Meta:
        model = Application
        fields = [
            'id', 'candidate', 'candidate_name', 'candidate_email',
            'job', 'job_title',
            'current_stage', 'current_stage_display',
            'status', 'status_display',
            'assignee', 'assignee_name',
            'cv_process_status', 'cv_process_status_display',
            'cv_processed_at',
            'applied_at',
            'candidate_source', 'candidate_cv_url', 'is_referral',
            'need_interviewer_employee_id', 'need_interviewer_full_name',
        ]

    def get_is_referral(self, obj):
        return obj.candidate.source == 'REFERRAL'

    def get_candidate_cv_url(self, obj):
        return resolve_candidate_cv_url(obj.candidate)

    def _need_interviewer(self, obj):
        return obj.get_effective_interviewer()

    def get_need_interviewer_employee_id(self, obj):
        user = self._need_interviewer(obj)
        if user and hasattr(user, 'employee'):
            return user.employee.employee_id
        return None

    def get_need_interviewer_full_name(self, obj):
        user = self._need_interviewer(obj)
        if not user:
            return None
        employee = getattr(user, 'employee', None)
        if employee and getattr(employee, 'full_name', None):
            return employee.full_name
        return user.get_full_name() or user.username


class ApplicationSerializer(serializers.ModelSerializer):
    candidate_detail = CandidateListSerializer(source='candidate', read_only=True)
    job_detail = JobListSerializer(source='job', read_only=True)
    current_stage_display = serializers.CharField(
        source='get_current_stage_display', read_only=True
    )
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    assignee_name = serializers.CharField(
        source='assignee.get_full_name', read_only=True
    )
    cv_process_status_display = serializers.CharField(
        source='get_cv_process_status_display', read_only=True
    )
    stage_history = ApplicationStageHistorySerializer(many=True, read_only=True)

    class Meta:
        model = Application
        fields = [
            'id', 'candidate', 'candidate_detail',
            'job', 'job_detail',
            'current_stage', 'current_stage_display',
            'status', 'status_display',
            'assignee', 'assignee_name',
            'source', 'rejection_reason', 'rejection_note',
            'notes',
            'cv_process_status', 'cv_process_status_display',
            'cv_processed_by_id', 'cv_processed_at',
            'applied_at', 'updated_at',
            'stage_history',
        ]
        read_only_fields = ['applied_at', 'updated_at']


# ---------------------------------------------------------------------------
# Interview
# ---------------------------------------------------------------------------

class InterviewListSerializer(serializers.ModelSerializer):
    candidate_name = serializers.CharField(
        source='application.candidate.full_name', read_only=True
    )
    job_title = serializers.CharField(
        source='application.job.title', read_only=True
    )
    interview_type_display = serializers.CharField(
        source='get_interview_type_display', read_only=True
    )
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    interviewer_names = serializers.SerializerMethodField()
    evaluation_count = serializers.IntegerField(
        source='evaluations.count', read_only=True
    )
    application_status = serializers.CharField(
        source='application.status', read_only=True
    )
    application_current_stage = serializers.CharField(
        source='application.current_stage', read_only=True
    )
    candidate_email = serializers.CharField(
        source='application.candidate.email', read_only=True
    )
    candidate_gender = serializers.CharField(
        source='application.candidate.gender', read_only=True
    )
    candidate_phone = serializers.CharField(
        source='application.candidate.phone', read_only=True
    )
    candidate_source = serializers.CharField(
        source='application.candidate.source', read_only=True
    )
    candidate_source_display = serializers.SerializerMethodField()
    candidate_notes = serializers.CharField(
        source='application.candidate.notes', read_only=True
    )
    candidate_cv_url = serializers.CharField(
        source='application.candidate.cv_url', read_only=True
    )
    candidate_cv_file_url = serializers.SerializerMethodField()
    # Người tạo hồ sơ ứng viên (recruiter phụ trách)
    recruiter_employee_id = serializers.SerializerMethodField()
    recruiter_full_name = serializers.SerializerMethodField()
    # Người PV được set trên RecruitmentNeed (BP phỏng vấn) — đồng bộ Ứng viên tab
    need_interviewer_employee_id = serializers.SerializerMethodField()
    need_interviewer_full_name = serializers.SerializerMethodField()
    # Người phỏng vấn set riêng cho lịch phỏng vấn này (Interview.interviewers)
    interviewer_user_ids = serializers.SerializerMethodField()
    interviewer_employee_id = serializers.SerializerMethodField()
    interviewer_employee_code = serializers.SerializerMethodField()
    interviewer_full_name = serializers.SerializerMethodField()

    def get_interviewer_names(self, obj):
        return [u.get_full_name() or u.username for u in obj.interviewers.all()]

    def get_interviewer_user_ids(self, obj):
        return list(obj.interviewers.values_list('id', flat=True))

    def _first_interviewer_employee(self, obj):
        for u in obj.interviewers.all():
            try:
                emp = u.employee
                if emp:
                    return emp
            except Exception:
                continue
        return None

    def get_interviewer_employee_id(self, obj):
        """ID Employee (HRM) của interviewer đầu tiên — pre-fill 'Quản lý trực tiếp' khi onboard."""
        emp = self._first_interviewer_employee(obj)
        return emp.id if emp else None

    def get_interviewer_employee_code(self, obj):
        emp = self._first_interviewer_employee(obj)
        return emp.employee_id if emp else None

    def get_interviewer_full_name(self, obj):
        emp = self._first_interviewer_employee(obj)
        if emp:
            return emp.full_name
        for u in obj.interviewers.all():
            return u.get_full_name() or u.username
        return None

    def _candidate(self, obj):
        try:
            return obj.application.candidate
        except Exception:
            return None

    def get_candidate_source_display(self, obj):
        cand = self._candidate(obj)
        if not cand:
            return None
        return cand.get_source_display()

    def get_candidate_cv_file_url(self, obj):
        from .candidate_serializers import resolve_candidate_cv_url
        cand = self._candidate(obj)
        if not cand:
            return None
        try:
            return resolve_candidate_cv_url(cand)
        except Exception:
            return None

    def _recruiter(self, obj):
        cand = self._candidate(obj)
        return getattr(cand, 'created_by', None) if cand else None

    def get_recruiter_employee_id(self, obj):
        user = self._recruiter(obj)
        try:
            return user.employee.employee_id if user else None
        except Exception:
            return None

    def get_recruiter_full_name(self, obj):
        user = self._recruiter(obj)
        if not user:
            return None
        try:
            emp = getattr(user, 'employee', None)
            if emp and getattr(emp, 'full_name', None):
                return emp.full_name
        except Exception:
            pass
        return user.get_full_name() or user.username

    def _need_interviewer(self, obj):
        try:
            need = obj.application.job.recruitment_need
            return need.interviewer if need else None
        except Exception:
            return None

    def get_need_interviewer_employee_id(self, obj):
        user = self._need_interviewer(obj)
        try:
            return user.employee.employee_id if user else None
        except Exception:
            return None

    def get_need_interviewer_full_name(self, obj):
        user = self._need_interviewer(obj)
        if not user:
            return None
        try:
            emp = getattr(user, 'employee', None)
            if emp and getattr(emp, 'full_name', None):
                return emp.full_name
        except Exception:
            pass
        return user.get_full_name() or user.username

    class Meta:
        model = Interview
        fields = [
            'id', 'application', 'candidate_name', 'job_title',
            'interview_type', 'interview_type_display',
            'scheduled_at', 'duration_minutes', 'location',
            'interviewer_names', 'interviewer_confirmed', 'interviewer_confirmed_at',
            'status', 'status_display',
            'interview_email_sent', 'interview_email_sent_at',
            'evaluation_count',
            'application_status', 'application_current_stage',
            'candidate_email', 'candidate_gender', 'candidate_phone',
            'candidate_source', 'candidate_source_display',
            'candidate_notes', 'candidate_cv_url', 'candidate_cv_file_url',
            'recruiter_employee_id', 'recruiter_full_name',
            'need_interviewer_employee_id', 'need_interviewer_full_name',
            'interviewer_user_ids', 'interviewer_employee_code', 'interviewer_full_name',
            'interviewer_employee_id',
        ]


class InterviewSerializer(serializers.ModelSerializer):
    interview_type_display = serializers.CharField(
        source='get_interview_type_display', read_only=True
    )
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    interviewer_names = serializers.SerializerMethodField()
    evaluation_count = serializers.IntegerField(
        source='evaluations.count', read_only=True
    )

    def get_interviewer_names(self, obj):
        return [u.get_full_name() or u.username for u in obj.interviewers.all()]

    class Meta:
        model = Interview
        fields = [
            'id', 'application',
            'interview_type', 'interview_type_display',
            'scheduled_at', 'duration_minutes', 'location',
            'interviewers', 'interviewer_names',
            'status', 'status_display',
            'notes', 'evaluation_count',
            'interviewer_confirmed', 'interviewer_confirmed_at',
            'room_booking_id',
            'interview_email_sent', 'interview_email_sent_at',
            'created_by', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'created_at', 'updated_at',
            'interviewer_confirmed', 'interviewer_confirmed_at',
            'interview_email_sent', 'interview_email_sent_at',
        ]


# ---------------------------------------------------------------------------
# InterviewEvaluation
# ---------------------------------------------------------------------------

class InterviewEvaluationSerializer(serializers.ModelSerializer):
    evaluator_name = serializers.CharField(
        source='evaluator.get_full_name', read_only=True
    )

    class Meta:
        model = InterviewEvaluation
        fields = [
            'id', 'interview',
            'evaluator', 'evaluator_name',
            'technical_score', 'cultural_fit_score',
            'communication_score', 'overall_score',
            'strengths', 'weaknesses', 'recommendation',
            'is_recommended',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


# ---------------------------------------------------------------------------
# Offer
# ---------------------------------------------------------------------------

class OfferSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    candidate_name = serializers.CharField(
        source='application.candidate.full_name', read_only=True
    )
    job_title = serializers.CharField(
        source='application.job.title', read_only=True
    )
    created_by_name = serializers.CharField(
        source='created_by.get_full_name', read_only=True
    )

    class Meta:
        model = Offer
        fields = [
            'id', 'application', 'candidate_name', 'job_title',
            'proposed_salary', 'allowances', 'position_title',
            'probation_months',
            'expected_onboard_date', 'actual_onboard_date',
            'confirmed_onboard_date',
            'status', 'status_display',
            'rejection_note', 'offer_letter_file',
            'sent_at', 'responded_at',
            'onboard_email_sent', 'onboard_email_sent_at',
            'onboarding_process_id',
            'created_by', 'created_by_name',
            'notes', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'created_at', 'updated_at',
            'onboard_email_sent', 'onboard_email_sent_at', 'onboarding_process_id',
        ]
