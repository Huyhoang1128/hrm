"""
recruitment/serializers.py – Serializers cho RecruitmentNeed, Job, JobChannel.
"""
from rest_framework import serializers

from .models import RecruitmentNeed, Job, JobChannel


class JobChannelSerializer(serializers.ModelSerializer):
    channel_type_display = serializers.CharField(
        source='get_channel_type_display', read_only=True
    )

    class Meta:
        model = JobChannel
        fields = [
            'id', 'channel_type', 'channel_type_display',
            'url', 'posted_at', 'is_active', 'notes', 'created_at',
        ]


class JobListSerializer(serializers.ModelSerializer):
    """Serializer rút gọn cho danh sách."""
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    channel_count = serializers.IntegerField(source='channels.count', read_only=True)
    position_name = serializers.CharField(source='position.title', read_only=True, default=None)

    class Meta:
        model = Job
        fields = [
            'id', 'recruitment_need', 'position', 'position_name', 'title', 'status', 'status_display',
            'channel_count', 'published_at', 'created_at',
        ]


class JobSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    channels = JobChannelSerializer(many=True, read_only=True)
    created_by_name = serializers.CharField(
        source='created_by.get_full_name', read_only=True
    )
    position_name = serializers.CharField(source='position.title', read_only=True, default=None)

    class Meta:
        model = Job
        fields = [
            'id', 'recruitment_need', 'position', 'position_name', 'title', 'description',
            'requirements', 'benefits', 'status', 'status_display',
            'published_at', 'closed_at',
            'channels', 'created_by', 'created_by_name', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class RecruitmentNeedListSerializer(serializers.ModelSerializer):
    """Serializer rút gọn cho danh sách."""
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    approval_status_display = serializers.CharField(
        source='get_approval_status_display', read_only=True
    )
    department_name = serializers.CharField(
        source='department.name', read_only=True
    )
    position_display = serializers.CharField(
        source='position.title', read_only=True
    )
    employment_type_display = serializers.CharField(
        source='get_employment_type_display', read_only=True
    )
    approved_by_name = serializers.CharField(
        source='approved_by.get_full_name', read_only=True
    )
    requested_by_name = serializers.CharField(
        source='requested_by.get_full_name', read_only=True
    )
    interviewer_name = serializers.CharField(
        source='interviewer.get_full_name', read_only=True
    )
    interviewer_employee_id = serializers.SerializerMethodField()
    cv_approver_name = serializers.CharField(
        source='cv_approver.get_full_name', read_only=True
    )
    cv_approver_employee_id = serializers.SerializerMethodField()

    def get_interviewer_employee_id(self, obj):
        user = obj.interviewer
        if user and hasattr(user, 'employee'):
            return user.employee.employee_id
        return None

    def get_cv_approver_employee_id(self, obj):
        user = obj.cv_approver
        if user and hasattr(user, 'employee'):
            return user.employee.employee_id
        return None

    class Meta:
        model = RecruitmentNeed
        fields = [
            'id', 'position_name', 'position_display', 'department_name',
            'headcount', 'employment_type', 'employment_type_display',
            'status', 'status_display',
            'approval_status', 'approval_status_display',
            'approved_by_name', 'approved_at', 'approval_note',
            'requested_by_name', 'interviewer_name', 'interviewer_employee_id',
            'cv_approver_name', 'cv_approver_employee_id',
            'is_published_internally', 'published_internally_at',
            'target_onboard_date', 'reason', 'created_at',
        ]


class RecruitmentNeedSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    approval_status_display = serializers.CharField(
        source='get_approval_status_display', read_only=True
    )
    department_name = serializers.CharField(
        source='department.name', read_only=True
    )
    position_display = serializers.CharField(
        source='position.title', read_only=True
    )
    employment_type_display = serializers.CharField(
        source='get_employment_type_display', read_only=True
    )
    requested_by_name = serializers.CharField(
        source='requested_by.get_full_name', read_only=True
    )
    approved_by_name = serializers.CharField(
        source='approved_by.get_full_name', read_only=True
    )
    published_internally_by_name = serializers.CharField(
        source='published_internally_by.get_full_name', read_only=True
    )
    interviewer_name = serializers.CharField(
        source='interviewer.get_full_name', read_only=True
    )
    interviewer_employee_id = serializers.SerializerMethodField()
    cv_approver_name = serializers.CharField(
        source='cv_approver.get_full_name', read_only=True
    )
    cv_approver_employee_id = serializers.SerializerMethodField()

    def get_interviewer_employee_id(self, obj):
        user = obj.interviewer
        if user and hasattr(user, 'employee'):
            return user.employee.employee_id
        return None

    def get_cv_approver_employee_id(self, obj):
        user = obj.cv_approver
        if user and hasattr(user, 'employee'):
            return user.employee.employee_id
        return None

    class Meta:
        model = RecruitmentNeed
        fields = [
            'id', 'position_name', 'position', 'position_display',
            'department', 'department_name',
            'headcount', 'employment_type', 'employment_type_display',
            'expected_salary_min', 'expected_salary_max',
            'reason', 'target_onboard_date',
            'status', 'status_display',
            'approval_status', 'approval_status_display',
            'approved_by', 'approved_by_name', 'approved_at', 'approval_note', 'rejected_at',
            'is_published_internally', 'published_internally_at', 'published_internally_by_name',
            'requested_by', 'requested_by_name',
            'interviewer', 'interviewer_name', 'interviewer_employee_id',
            'cv_approver', 'cv_approver_name', 'cv_approver_employee_id',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'created_at', 'updated_at',
            'approval_status', 'approved_by', 'approved_at', 'rejected_at',
            'published_internally_at', 'published_internally_by',
        ]
