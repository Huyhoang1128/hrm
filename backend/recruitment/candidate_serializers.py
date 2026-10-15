"""
recruitment/candidate_serializers.py – Serializers cho Candidate.
"""
from rest_framework import serializers

from .candidate_models import Candidate


class FlexibleFileOrKeyField(serializers.FileField):
    def to_internal_value(self, data):
        if isinstance(data, str):
            return data.strip()
        return super().to_internal_value(data)

    def to_representation(self, value):
        if not value:
            return None
        name = getattr(value, 'name', None)
        if name:
            return str(name)
        return str(value)


def resolve_candidate_cv_url(candidate):
    if getattr(candidate, 'cv_file', None):
        try:
            from hrm.utils import get_cloudfly_presigned_url
            return get_cloudfly_presigned_url(str(candidate.cv_file))
        except Exception:
            return None
    return candidate.cv_url or None


def resolve_uploader_display_name(user):
    if not user:
        return None

    employee = getattr(user, 'employee', None)
    if employee and getattr(employee, 'full_name', None):
        return employee.full_name

    full_name = user.get_full_name()
    if full_name:
        return full_name

    return user.username


def _recruiter_info(user):
    """Return MNV + Họ tên of the user who created the candidate."""
    if not user:
        return None, None
    employee = getattr(user, 'employee', None)
    employee_id = employee.employee_id if employee else None
    full_name = resolve_uploader_display_name(user)
    return employee_id, full_name


class CandidateListSerializer(serializers.ModelSerializer):
    source_display = serializers.SerializerMethodField(read_only=True)
    gender_display = serializers.CharField(source='get_gender_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    application_count = serializers.IntegerField(
        source='applications.count', read_only=True
    )
    latest_job_title = serializers.SerializerMethodField(read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)
    recruiter_employee_id = serializers.SerializerMethodField(read_only=True)
    recruiter_full_name = serializers.SerializerMethodField(read_only=True)
    need_interviewer_employee_id = serializers.SerializerMethodField(read_only=True)
    need_interviewer_full_name = serializers.SerializerMethodField(read_only=True)
    cv_file_url = serializers.SerializerMethodField(read_only=True)
    latest_application_id = serializers.SerializerMethodField(read_only=True)
    latest_need_id = serializers.SerializerMethodField(read_only=True)
    latest_application_cv_approved = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Candidate
        fields = [
            'id', 'full_name', 'email', 'phone',
            'gender', 'gender_display',
            'source', 'source_display',
            'status', 'status_display',
            'experience_years', 'current_position', 'current_company',
            'overall_evaluation',
            'latest_job_title',
            'is_blacklisted', 'application_count',
            'referred_by_employee_id', 'referral_need',
            'created_by_name',
            'recruiter_employee_id', 'recruiter_full_name',
            'need_interviewer_employee_id', 'need_interviewer_full_name',
            'notes',
            'cv_url', 'cv_file_url',
            'latest_application_id', 'latest_need_id', 'latest_application_cv_approved',
            'created_at',
        ]

    def get_cv_file_url(self, obj):
        return resolve_candidate_cv_url(obj)

    def get_latest_application_id(self, obj):
        latest = self._latest_application(obj)
        return latest.id if latest else None

    def get_latest_need_id(self, obj):
        latest = self._latest_application(obj)
        if latest and latest.job and latest.job.recruitment_need:
            return latest.job.recruitment_need_id
        return None

    def get_latest_application_cv_approved(self, obj):
        latest = self._latest_application(obj)
        return bool(latest and latest.cv_process_status == 'ACCEPTED')

    def _latest_application(self, obj):
        return obj.applications.select_related(
            'job__position', 'job__recruitment_need__interviewer'
        ).order_by('-applied_at').first()

    def get_latest_job_title(self, obj):
        latest = self._latest_application(obj)
        if latest and latest.job:
            return latest.job.title or (latest.job.position.title if latest.job.position else None)
        return None

    def get_recruiter_employee_id(self, obj):
        emp_id, _ = _recruiter_info(obj.created_by)
        return emp_id

    def get_recruiter_full_name(self, obj):
        _, name = _recruiter_info(obj.created_by)
        return name

    def _need_interviewer(self, obj):
        latest = self._latest_application(obj)
        if not latest:
            return None
        return latest.get_effective_interviewer()

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

    def get_source_display(self, obj):
        return obj.get_source_display()


class CandidateSerializer(serializers.ModelSerializer):
    source_display = serializers.SerializerMethodField(read_only=True)
    gender_display = serializers.CharField(source='get_gender_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    created_by_name = serializers.CharField(
        source='created_by.get_full_name', read_only=True
    )
    recruiter_employee_id = serializers.SerializerMethodField(read_only=True)
    recruiter_full_name = serializers.SerializerMethodField(read_only=True)
    latest_job_title = serializers.SerializerMethodField(read_only=True)
    cv_file_url = serializers.SerializerMethodField(read_only=True)
    cv_file = FlexibleFileOrKeyField(required=False, allow_null=True)

    class Meta:
        model = Candidate
        fields = [
            'id', 'full_name', 'email', 'phone',
            'gender', 'gender_display', 'date_of_birth', 'address',
            'cv_file', 'cv_file_url', 'cv_url', 'avatar',
            'skills', 'experience_years', 'experience_summary',
            'overall_evaluation',
            'education', 'current_company', 'current_position',
            'latest_job_title',
            'expected_salary',
            'source', 'source_display', 'status', 'status_display', 'tags', 'notes',
            'is_blacklisted', 'blacklist_reason',
            'referred_by_employee_id', 'referral_need', 'referral_note',
            'created_by', 'created_by_name',
            'recruiter_employee_id', 'recruiter_full_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_recruiter_employee_id(self, obj):
        emp_id, _ = _recruiter_info(obj.created_by)
        return emp_id

    def get_recruiter_full_name(self, obj):
        _, name = _recruiter_info(obj.created_by)
        return name

    def get_latest_job_title(self, obj):
        latest = obj.applications.select_related('job__position').order_by('-applied_at').first()
        if latest and latest.job:
            return latest.job.title or (latest.job.position.title if latest.job.position else None)
        return None

    def get_source_display(self, obj):
        return obj.get_source_display()

    def get_cv_file_url(self, obj):
        return resolve_candidate_cv_url(obj)

    def _upload_file_fields(self, validated_data):
        file_field_map = {
            'cv_file': 'recruitment/cv',
            'avatar': 'recruitment/avatars',
        }

        for field_name, folder in file_field_map.items():
            file_obj = validated_data.get(field_name)
            if file_obj and hasattr(file_obj, 'read'):
                from hrm.utils import upload_file_to_cloudfly
                validated_data[field_name] = upload_file_to_cloudfly(file_obj, folder)

        return validated_data

    def create(self, validated_data):
        return super().create(self._upload_file_fields(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._upload_file_fields(validated_data))
