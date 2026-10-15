"""
recruitment/views.py – ViewSets cho RecruitmentNeed, Job, JobChannel.
"""
import re

from docx import Document
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from django.utils import timezone
from django.core.exceptions import PermissionDenied
from django.db.models import Q

from .models import RecruitmentNeed, Job, JobChannel
from .serializers import (
    RecruitmentNeedSerializer,
    RecruitmentNeedListSerializer,
    JobSerializer,
    JobListSerializer,
    JobChannelSerializer,
)


class RecruitmentNeedViewSet(viewsets.ModelViewSet):
    """CRUD nhu cầu tuyển dụng."""

    queryset = RecruitmentNeed.objects.select_related(
        'department', 'position', 'requested_by'
    ).order_by('-created_at')
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['approval_status', 'is_published_internally', 'status']

    def _is_hr_user(self, user):
        if getattr(user, 'is_staff', False):
            return True

        employee = getattr(user, 'employee', None)
        if employee and getattr(employee, 'is_hr', False):
            return True

        hrm_user = getattr(user, 'hrm_user', None)
        if hrm_user and getattr(hrm_user, 'is_hr', False):
            return True

        return False

    def _auto_expire_overdue(self):
        """Auto chuyển nhu cầu quá ngày onboard sang EXPIRED."""
        today = timezone.now().date()
        RecruitmentNeed.objects.filter(
            target_onboard_date__lt=today,
            target_onboard_date__isnull=False,
        ).exclude(
            status__in=['FILLED', 'EXPIRED', 'CANCELLED'],
        ).update(status='EXPIRED')

    def get_queryset(self):
        self._auto_expire_overdue()
        qs = super().get_queryset()
        user = self.request.user

        # Internally published needs should be visible to all authenticated users
        # (used by Home "Cơ hội nghề nghiệp" widget)
        published_internally_param = str(
            self.request.query_params.get('is_published_internally', '')
        ).lower()
        if published_internally_param in {'true', '1', 'yes'}:
            return qs

        is_hr_user = self._is_hr_user(user)
        is_admin_user = getattr(user, 'is_superuser', False)

        if is_hr_user or is_admin_user:
            return qs

        return qs.filter(
            Q(requested_by=user) | Q(interviewer=user)
        ).distinct()

    def get_serializer_class(self):
        if self.action == 'list':
            return RecruitmentNeedListSerializer
        return RecruitmentNeedSerializer

    def _is_hr_or_admin(self, user):
        is_hr_user = self._is_hr_user(user)
        is_admin_user = getattr(user, 'is_superuser', False)
        return is_hr_user or is_admin_user

    def _resolve_user_department(self, user):
        # Ưu tiên hồ sơ nhân sự employee
        if hasattr(user, 'employee') and getattr(user.employee, 'department_id', None):
            return user.employee.department

        # Fallback hồ sơ hrm_user nếu có
        if hasattr(user, 'hrm_user') and getattr(user.hrm_user, 'department_id', None):
            return user.hrm_user.department

        return None

    def perform_create(self, serializer):
        user = self.request.user
        save_kwargs = {'requested_by': user}

        if not serializer.validated_data.get('interviewer'):
            save_kwargs['interviewer'] = user

        if not self._is_hr_or_admin(user) and not serializer.validated_data.get('department'):
            save_kwargs['department'] = self._resolve_user_department(user)

        need = serializer.save(**save_kwargs)
        self._auto_attach_existing_jobs(need)

    def perform_update(self, serializer):
        """Check edit permissions: chỉ requester hoặc HR mới có thể sửa trước khi finalize."""
        need = self.get_object()
        user = self.request.user
        
        # If approved, only HR can edit
        if need.approval_status == 'APPROVED':
            is_hr_user = self._is_hr_user(user)
            if not is_hr_user:
                raise PermissionDenied("Nhu cầu đã được duyệt không thể chỉnh sửa. Liên hệ HR để sửa.")
        
        # If in other statuses, only requester or HR can edit
        if need.approval_status in ['REJECTED']:
            is_hr_user = self._is_hr_user(user)
            is_requester = need.requested_by == user
            if not (is_hr_user or is_requester):
                raise PermissionDenied("Chỉ người yêu cầu hoặc HR mới có thể chỉnh sửa.")
        
        need = serializer.save()
        self._auto_attach_existing_jobs(need)

    def _auto_attach_existing_jobs(self, need: RecruitmentNeed):
        """Tự động gắn JD sẵn có cùng vị trí vào nhu cầu tuyển dụng nếu JD chưa gắn nhu cầu nào."""
        if not need.position_id:
            return

        Job.objects.filter(
            position_id=need.position_id,
            recruitment_need__isnull=True,
        ).update(recruitment_need=need)

    def perform_destroy(self, instance):
        """Only HR/Admin can delete recruitment needs."""
        user = self.request.user
        is_hr_user = self._is_hr_user(user)
        is_admin_user = getattr(user, 'is_superuser', False)

        if not (is_hr_user or is_admin_user):
            raise PermissionDenied("Chỉ HR hoặc Admin mới có quyền xóa nhu cầu tuyển dụng.")

        instance.delete()

    @action(detail=False, methods=['get'], url_path='open')
    def open_needs(self, request):
        """Danh sách nhu cầu tuyển dụng đang mở."""
        qs = self.get_queryset().filter(status__in=['OPEN', 'IN_PROGRESS'])
        serializer = RecruitmentNeedListSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='approve')
    def approve_need(self, request, pk=None):
        """HR duyệt nhu cầu tuyển dụng. Yêu cầu user có quyền HR hoặc can_approve_recruitment."""
        need = self.get_object()
        
        # Check permission: HR role or can_approve_recruitment permission
        user = request.user
        is_hr_user = self._is_hr_user(user)
        if not is_hr_user:
            raise PermissionDenied("Chỉ HR mới có quyền duyệt nhu cầu tuyển dụng.")
        
        if need.approval_status != 'PENDING':
            return Response(
                {'detail': f"Nhu cầu đã ở trạng thái {need.get_approval_status_display()}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        # Update approval
        need.approval_status = 'APPROVED'
        need.approved_by = user
        need.approved_at = timezone.now()
        need.status = 'IN_PROGRESS'  # Automatically move to IN_PROGRESS after approval
        need.save()
        
        return Response(
            RecruitmentNeedSerializer(need).data,
            status=status.HTTP_200_OK
        )

    @action(detail=True, methods=['post'], url_path='reject')
    def reject_need(self, request, pk=None):
        """HR từ chối nhu cầu tuyển dụng."""
        need = self.get_object()
        
        # Check permission
        user = request.user
        is_hr_user = self._is_hr_user(user)
        if not is_hr_user:
            raise PermissionDenied("Chỉ HR mới có quyền từ chối nhu cầu tuyển dụng.")
        
        if need.approval_status != 'PENDING':
            return Response(
                {'detail': f"Nhu cầu đã ở trạng thái {need.get_approval_status_display()}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        # Update rejection
        note = request.data.get('note', '')
        need.approval_status = 'REJECTED'
        need.approval_note = note
        need.rejected_at = timezone.now()
        need.status = 'CANCELLED'
        need.save()
        
        return Response(
            RecruitmentNeedSerializer(need).data,
            status=status.HTTP_200_OK
        )

    @action(detail=True, methods=['post'], url_path='publish-internally')
    def publish_internally(self, request, pk=None):
        """HR công khai nhu cầu tuyển dụng nội bộ để nhân viên giới thiệu ứng viên."""
        need = self.get_object()
        
        # Check permission
        user = request.user
        is_hr_user = self._is_hr_user(user)
        if not is_hr_user:
            raise PermissionDenied("Chỉ HR mới có quyền công khai tuyển dụng nội bộ.")
        
        if need.approval_status != 'APPROVED':
            return Response(
                {'detail': "Nhu cầu phải được duyệt trước khi công khai nội bộ."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        if need.is_published_internally:
            return Response(
                {'detail': "Nhu cầu đã được công khai nội bộ."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        # Publish internally
        need.is_published_internally = True
        need.published_internally_at = timezone.now()
        need.published_internally_by = user
        need.save()
        
        return Response(
            RecruitmentNeedSerializer(need).data,
            status=status.HTTP_200_OK
        )


class JobViewSet(viewsets.ModelViewSet):
    """CRUD tin tuyển dụng (JD)."""

    queryset = Job.objects.select_related(
        'recruitment_need', 'created_by'
    ).prefetch_related('channels').order_by('-created_at')
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['recruitment_need', 'status']

    def get_serializer_class(self):
        if self.action == 'list':
            return JobListSerializer
        return JobSerializer

    def perform_create(self, serializer):
        serializer.save(
            created_by=self.request.user,
            status='PUBLISHED',
            published_at=timezone.now(),
        )

    @action(detail=False, methods=['get'], url_path='published')
    def published(self, request):
        """Danh sách tin đang đăng."""
        qs = self.get_queryset().filter(status='PUBLISHED')
        serializer = JobListSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='publish')
    def publish(self, request, pk=None):
        """Đăng tin tuyển dụng."""
        from django.utils import timezone
        job = self.get_object()
        if job.status != 'DRAFT':
            return Response(
                {'detail': 'Chỉ có thể đăng tin ở trạng thái Nháp.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        job.status = 'PUBLISHED'
        job.published_at = timezone.now()
        job.save()
        return Response(JobSerializer(job).data)

    @action(detail=True, methods=['post'], url_path='close')
    def close(self, request, pk=None):
        """Đóng tin tuyển dụng."""
        from django.utils import timezone
        job = self.get_object()
        job.status = 'CLOSED'
        job.closed_at = timezone.now()
        job.save()
        return Response(JobSerializer(job).data)

    @action(
        detail=False, methods=['post'], url_path='parse-file',
        parser_classes=[MultiPartParser, FormParser],
    )
    def parse_file(self, request):
        """Parse JD từ file .docx/.pdf upload → trả về {title, description, requirements, benefits}.

        FE upload file → BE đọc full text → tách section dựa trên heading thường gặp:
        - Mô tả công việc / Nhiệm vụ / Trách nhiệm  → description
        - Yêu cầu / Kỹ năng / Năng lực              → requirements
        - Quyền lợi / Phúc lợi / Lương thưởng       → benefits
        Phần không match → ghép vào description.
        """
        file = request.FILES.get('file')
        if not file:
            return Response(
                {'detail': 'Thiếu file upload (field "file").'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        filename = file.name.lower()
        if not filename.endswith('.docx'):
            return Response(
                {'detail': 'Chỉ hỗ trợ file .docx. Hãy export từ Google Docs/Word.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            doc = Document(file)
        except Exception as exc:
            return Response(
                {'detail': f'Không đọc được file: {exc}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]

        SECTION_PATTERNS = {
            'description': re.compile(
                r'(mô tả|mô tả|nhiệm vụ|trách nhiệm|công việc|job description|job desc)',
                re.IGNORECASE,
            ),
            'requirements': re.compile(
                r'(yêu cầu|yêu cầu|kỹ năng|năng lực|điều kiện|requirements|skills)',
                re.IGNORECASE,
            ),
            'benefits': re.compile(
                r'(quyền lợi|phúc lợi|lương thưởng|chế độ|đãi ngộ|benefits)',
                re.IGNORECASE,
            ),
        }

        title = ''
        sections = {'description': [], 'requirements': [], 'benefits': [], 'other': []}
        current = 'other'

        for idx, line in enumerate(paragraphs):
            if idx == 0 and len(line) < 200:
                title = line
                continue

            matched_section = None
            if len(line) < 100:
                for sec_name, pat in SECTION_PATTERNS.items():
                    if pat.search(line):
                        matched_section = sec_name
                        break

            if matched_section:
                current = matched_section
                continue

            sections[current].append(line)

        # Thêm bullet "- " tự động cho mỗi dòng + strip bullet/số đầu dòng
        # (•, ▪, -, *, "1.", "2)" …) để tránh trùng khi file gốc đã có sẵn bullet.
        BULLET_STRIP_RE = re.compile(r'^[\s\-\*•▪◦‣·]+')
        NUMBERED_STRIP_RE = re.compile(r'^\d+[\.\)]\s*')

        def with_bullets(lines):
            out = []
            for raw in lines:
                line = raw.strip()
                if not line:
                    continue
                line = BULLET_STRIP_RE.sub('', line)
                line = NUMBERED_STRIP_RE.sub('', line)
                line = line.strip()
                if line:
                    out.append(f'- {line}')
            return '\n'.join(out)

        description = with_bullets(sections['description'] + sections['other'])
        requirements = with_bullets(sections['requirements'])
        benefits = with_bullets(sections['benefits'])

        return Response({
            'title': title,
            'description': description,
            'requirements': requirements,
            'benefits': benefits,
        })


class JobChannelViewSet(viewsets.ModelViewSet):
    """CRUD kênh đăng tuyển."""

    queryset = JobChannel.objects.select_related('job').order_by('job', 'channel_type')
    permission_classes = [IsAuthenticated]
    serializer_class = JobChannelSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        job_id = self.request.query_params.get('job')
        if job_id:
            qs = qs.filter(job_id=job_id)
        return qs
