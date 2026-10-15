"""
recruitment/candidate_views.py – ViewSet cho Candidate.
"""
import logging

from django.db import transaction

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .candidate_models import Candidate
from .candidate_serializers import CandidateSerializer, CandidateListSerializer
from .cv_processing import process_candidate_cv


logger = logging.getLogger(__name__)


class CandidateViewSet(viewsets.ModelViewSet):
    """CRUD ứng viên."""

    queryset = Candidate.objects.select_related('created_by').order_by('-created_at')
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_serializer_class(self):
        if self.action == 'list':
            return CandidateListSerializer
        return CandidateSerializer

    def perform_create(self, serializer):
        extra = {'created_by': self.request.user}

        if self.request.data.get('source') == 'REFERRAL' and not self.request.data.get('referred_by_employee_id'):
            employee = getattr(self.request.user, 'employee', None)
            if employee:
                extra['referred_by_employee_id'] = employee.id

        serializer.save(**extra)

    def perform_update(self, serializer):
        extra = {}
        was_blacklisted = serializer.instance.is_blacklisted

        if self.request.data.get('source') == 'REFERRAL' and not self.request.data.get('referred_by_employee_id'):
            employee = getattr(self.request.user, 'employee', None)
            if employee:
                extra['referred_by_employee_id'] = employee.id

        candidate = serializer.save(**extra)

        if not was_blacklisted and candidate.is_blacklisted:
            self._remove_candidate_from_current_needs(candidate)

    def _remove_candidate_from_current_needs(self, candidate):
        """Xóa ứng viên khỏi tất cả nhu cầu tuyển dụng còn hiệu lực."""
        from .pipeline_models import Application

        applications_qs = Application.objects.filter(
            candidate=candidate,
            job__recruitment_need__isnull=False,
        ).exclude(
            job__recruitment_need__status__in=['FILLED', 'CANCELLED']
        )

        deleted_count = applications_qs.count()
        if deleted_count:
            applications_qs.delete()

        return deleted_count

    @action(detail=False, methods=['post'], url_path='preview-cv', parser_classes=[MultiPartParser, FormParser, JSONParser])
    def preview_cv(self, request):
        cv_file = request.FILES.get('cv_file') or request.data.get('cv_file')
        if not cv_file or not hasattr(cv_file, 'read'):
            return Response(
                {'detail': 'Vui lòng chọn file CV hợp lệ.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            result = process_candidate_cv(cv_file)
        except Exception as exc:
            logger.exception('Cannot process candidate CV')
            return Response(
                {'detail': f'Không thể xử lý CV: {exc}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(result, status=status.HTTP_200_OK)

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get('search')
        source = self.request.query_params.get('source')
        candidate_status = self.request.query_params.get('status')
        is_blacklisted = self.request.query_params.get('blacklisted')

        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(full_name__icontains=search) |
                Q(email__icontains=search) |
                Q(phone__icontains=search)
            )
        if source:
            qs = qs.filter(source=source)
        if candidate_status:
            qs = qs.filter(status=candidate_status)
        if is_blacklisted is not None:
            qs = qs.filter(is_blacklisted=is_blacklisted.lower() == 'true')
        return qs

    @action(detail=True, methods=['post'], url_path='blacklist')
    def blacklist(self, request, pk=None):
        """Thêm ứng viên vào blacklist."""
        candidate = self.get_object()
        reason = request.data.get('reason', '')

        with transaction.atomic():
            candidate.is_blacklisted = True
            candidate.blacklist_reason = reason
            candidate.save(update_fields=['is_blacklisted', 'blacklist_reason', 'updated_at'])
            removed_count = self._remove_candidate_from_current_needs(candidate)

        return Response({
            'detail': 'Đã thêm vào blacklist và gỡ ứng viên khỏi các nhu cầu tuyển dụng hiện có.',
            'removed_applications_count': removed_count,
        })

    @action(detail=True, methods=['post'], url_path='unblacklist')
    def unblacklist(self, request, pk=None):
        """Xoá ứng viên khỏi blacklist."""
        candidate = self.get_object()
        candidate.is_blacklisted = False
        candidate.blacklist_reason = ''
        candidate.save()
        return Response({'detail': 'Đã xoá khỏi blacklist.'})
