"""
recruitment/pipeline_views.py – ViewSets cho Application, Interview, Evaluation, Offer.
"""
import logging
from datetime import datetime, time, timedelta

from django.utils.dateparse import parse_datetime, parse_date
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.core.exceptions import PermissionDenied

from .pipeline_models import (
    Application, ApplicationStageHistory,
    Interview, InterviewEvaluation, Offer,
    PIPELINE_STAGE, REJECTION_REASON,
)
from .pipeline_serializers import (
    ApplicationSerializer, ApplicationListSerializer,
    ApplicationStageHistorySerializer,
    InterviewSerializer, InterviewListSerializer,
    InterviewEvaluationSerializer,
    OfferSerializer,
)
from hrm import branding

logger = logging.getLogger(__name__)


def _notify_users_for_interview(interview, users):
    """Tạo CompanyAnnouncement báo lịch phỏng vấn cho danh sách user (Employee) —
    họ sẽ thấy thông báo ở chuông thông báo trên HRM.

    Fail silent: lỗi ở đây không được chặn việc tạo/sửa lịch phỏng vấn.
    """
    try:
        from hrm.models import CompanyAnnouncement
        from employee.models import Employee

        target_users = [u for u in users if u]
        if not target_users:
            return

        target_employees = Employee.objects.filter(
            user__in=target_users
        ).distinct()
        if not target_employees.exists():
            return

        application = interview.application
        job = getattr(application, 'job', None)
        need = getattr(job, 'recruitment_need', None) if job else None
        candidate_name = getattr(application.candidate, 'full_name', 'Ứng viên')
        job_title = getattr(job, 'title', None) or getattr(need, 'position_name', '')
        scheduled_str = timezone.localtime(interview.scheduled_at).strftime(
            '%H:%M %d/%m/%Y'
        ) if interview.scheduled_at else ''
        location = interview.location or 'Chưa cập nhật'
        interview_type = interview.get_interview_type_display()

        title = f"Lịch phỏng vấn mới: {candidate_name}"
        content = (
            f"Ứng viên: {candidate_name}\n"
            f"Vị trí: {job_title}\n"
            f"Loại phỏng vấn: {interview_type}\n"
            f"Thời gian: {scheduled_str}\n"
            f"Địa điểm: {location}"
        )

        today = timezone.localdate()
        announcement = CompanyAnnouncement.objects.create(
            title=title,
            content=content,
            announcement_type='ANNOUNCEMENT',
            priority='HIGH',
            apply_to_all=False,
            effective_from=today,
            is_active=True,
            published_at=timezone.now(),
        )
        announcement.employees.set(target_employees)
    except Exception as exc:
        logger.warning(
            "Không tạo được thông báo lịch phỏng vấn (interview_id=%s): %s",
            getattr(interview, 'id', None), exc,
        )


def _notify_recruitment_need_for_interview(interview):
    """Báo lịch phỏng vấn mới cho người phỏng vấn (RecruitmentNeed.interviewer)
    và người yêu cầu tuyển (requested_by)."""
    application = interview.application
    job = getattr(application, 'job', None)
    need = getattr(job, 'recruitment_need', None) if job else None
    if need is None:
        return
    _notify_users_for_interview(interview, [need.interviewer, need.requested_by])


def sync_candidate_status_from_application(application):
    """Derive Candidate.status từ trạng thái interviews/evaluations của application.

    Quy tắc (ưu tiên từ trên xuống):
    - Có interview DONE + evaluation.is_recommended=True  → INTERVIEW_PASSED
    - Có interview DONE + evaluation.is_recommended=False → INTERVIEW_FAILED
    - Có interview DONE (chưa eval)                       → INTERVIEWING
    - Có interview SCHEDULED                              → INTERVIEW_SCHEDULED
    - cv_process_status == ACCEPTED, không còn interview  → CV_APPROVED
    - Else                                                 → PENDING_CV_REVIEW
    """
    candidate = application.candidate
    interviews = application.interviews.all().order_by('-scheduled_at')

    new_status = None
    done_interview = interviews.filter(status='DONE').first()
    if done_interview:
        latest_eval = done_interview.evaluations.order_by('-updated_at').first()
        if latest_eval is None:
            new_status = 'INTERVIEWING'
        elif latest_eval.is_recommended is True:
            new_status = 'INTERVIEW_PASSED'
        elif latest_eval.is_recommended is False:
            new_status = 'INTERVIEW_FAILED'
        else:
            new_status = 'INTERVIEWING'
    elif interviews.filter(status='SCHEDULED').exists():
        new_status = 'INTERVIEW_SCHEDULED'
    elif application.cv_process_status == 'ACCEPTED':
        new_status = 'CV_APPROVED'
    else:
        new_status = 'PENDING_CV_REVIEW'

    if candidate.status != new_status:
        candidate.status = new_status
        candidate.save(update_fields=['status'])


def build_interview_email_context(application, scheduled_at, duration_minutes, location, interviewer_names):
    job = application.job
    candidate = application.candidate

    return {
        'candidate_name': candidate.full_name,
        'job_title': job.title if job else 'Chưa xác định',
        'scheduled_at_formatted': scheduled_at.strftime('%d/%m/%Y lúc %H:%M'),
        'duration_minutes': duration_minutes,
        'location': location or 'Sẽ được xác nhận',
        'interviewer_names': interviewer_names or 'Đang xác định',
        'company_name': branding.company_name(),
    }


def render_interview_scheduled_email_from_context(context):
    from .email_templates import render_email_template

    return render_email_template('interview_scheduled', context)


def queue_interview_scheduled_email(interview, actor):
    """Queue email thông báo lịch phỏng vấn cho ứng viên theo luồng hiện có."""
    from hrm.models import EmailQueue

    candidate = interview.application.candidate
    interviewer_names = ' & '.join([
        interviewer.get_full_name() or interviewer.username
        for interviewer in interview.interviewers.all()
    ])

    context = build_interview_email_context(
        interview.application,
        interview.scheduled_at,
        interview.duration_minutes,
        interview.location,
        interviewer_names,
    )

    rendered = render_interview_scheduled_email_from_context(context)

    EmailQueue.objects.create(
        recipient_email=candidate.email,
        subject=rendered['subject'],
        body_text=rendered['body_text'],
        body_html=rendered['body_html'],
        email_type='interview_scheduled',
        related_object_id=interview.id,
        created_by=actor,
    )

    interview.interview_email_sent = True
    interview.interview_email_sent_at = timezone.now()
    interview.save(update_fields=['interview_email_sent', 'interview_email_sent_at', 'updated_at'])


class ApplicationViewSet(viewsets.ModelViewSet):
    """CRUD đơn ứng tuyển + pipeline management."""

    queryset = Application.objects.select_related(
        'candidate', 'job', 'assignee'
    ).prefetch_related('stage_history').order_by('-applied_at')
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'list':
            return ApplicationListSerializer
        return ApplicationSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        job_id = self.request.query_params.get('job')
        candidate_id = self.request.query_params.get('candidate')
        stage = self.request.query_params.get('stage')
        status_filter = self.request.query_params.get('status')
        assignee_id = self.request.query_params.get('assignee')

        if job_id:
            qs = qs.filter(job_id=job_id)
        if candidate_id:
            qs = qs.filter(candidate_id=candidate_id)
        if stage:
            qs = qs.filter(current_stage=stage)
        if status_filter:
            qs = qs.filter(status=status_filter)
        if assignee_id:
            qs = qs.filter(assignee_id=assignee_id)
        return qs

    def _is_hr_or_admin(self, user):
        if getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False):
            return True
        # Source of truth: Employee.is_hr (đồng bộ với hrm/finalization_lock_mixin.py)
        try:
            if getattr(user.employee, 'is_hr', False):
                return True
        except Exception:
            pass
        # Legacy fallback (relation cũ user.hrm_user.is_hr)
        try:
            if getattr(user.hrm_user, 'is_hr', False):
                return True
        except Exception:
            pass
        return False

    def _can_schedule_application(self, application, user):
        if self._is_hr_or_admin(user):
            return True

        recruitment_need = getattr(application.job, 'recruitment_need', None)
        return bool(recruitment_need and recruitment_need.interviewer_id == user.id)

    def _get_available_rooms(self, start_time, end_time):
        from hrm.models import MeetingRoom, MeetingRoomBooking

        occupied_room_ids = MeetingRoomBooking.objects.filter(
            start_time__lt=end_time,
            end_time__gt=start_time,
        ).values_list('room_id', flat=True)

        return MeetingRoom.objects.filter(is_active=True).exclude(
            id__in=occupied_room_ids
        ).order_by('capacity', 'name')

    @action(detail=True, methods=['get'], url_path='schedule-options')
    def schedule_options(self, request, pk=None):
        """Lấy gợi ý khung giờ + phòng họp trống cho lịch phỏng vấn."""
        application = self.get_object()
        user = request.user

        if not self._can_schedule_application(application, user):
            raise PermissionDenied("Bạn không có quyền đặt lịch phỏng vấn cho hồ sơ này.")

        duration_minutes = int(request.query_params.get('duration_minutes') or request.query_params.get('duration') or 60)
        duration_minutes = max(duration_minutes, 15)

        recruitment_need = getattr(application.job, 'recruitment_need', None)
        interviewer = getattr(recruitment_need, 'interviewer', None)

        from hrm.models import MeetingRoomSetting
        setting = MeetingRoomSetting.get_solo()

        date_param = request.query_params.get('date')
        target_date = parse_date(date_param) if date_param else timezone.localdate()
        if target_date is None:
            return Response({'detail': 'Ngày không hợp lệ (định dạng YYYY-MM-DD).'}, status=status.HTTP_400_BAD_REQUEST)

        tz = timezone.get_current_timezone()
        workday_start = timezone.make_aware(datetime.combine(target_date, time(setting.workday_start_hour, 0)), tz)
        workday_end = timezone.make_aware(datetime.combine(target_date, time(setting.workday_end_hour, 0)), tz)

        now = timezone.now()
        suggested_slots = []
        slot_cursor = workday_start
        while slot_cursor + timedelta(minutes=duration_minutes) <= workday_end and len(suggested_slots) < 8:
            slot_end = slot_cursor + timedelta(minutes=duration_minutes)
            if slot_cursor >= now:
                rooms = self._get_available_rooms(slot_cursor, slot_end)
                if rooms.exists():
                    recommended_room = rooms.first()
                    suggested_slots.append({
                        'start_time': slot_cursor.isoformat(),
                        'label': timezone.localtime(slot_cursor).strftime('%H:%M'),
                        'available_room_count': rooms.count(),
                        'recommended_room_id': recommended_room.id,
                        'recommended_room_name': recommended_room.name,
                    })
            slot_cursor += timedelta(minutes=30)

        available_rooms = []
        scheduled_at_param = request.query_params.get('scheduled_at')
        if scheduled_at_param:
            scheduled_at = parse_datetime(scheduled_at_param)
            if scheduled_at:
                if timezone.is_naive(scheduled_at):
                    scheduled_at = timezone.make_aware(scheduled_at, tz)
                end_at = scheduled_at + timedelta(minutes=duration_minutes)
                rooms = self._get_available_rooms(scheduled_at, end_at)
                available_rooms = [
                    {
                        'id': room.id,
                        'name': room.name,
                        'code': room.code,
                        'capacity': room.capacity,
                    }
                    for room in rooms
                ]

        return Response({
            'application_id': application.id,
            'candidate_name': application.candidate.full_name,
            'interviewer_id': interviewer.id if interviewer else None,
            'interviewer_name': (interviewer.get_full_name() or interviewer.username) if interviewer else 'Chưa gán',
            'duration_minutes': duration_minutes,
            'suggested_slots': suggested_slots,
            'available_rooms': available_rooms,
        })

    @action(detail=True, methods=['post'], url_path='preview-schedule-email')
    def preview_schedule_email(self, request, pk=None):
        """Xem trước email lịch phỏng vấn trước khi tạo lịch thực tế."""
        application = self.get_object()
        user = request.user

        if not self._can_schedule_application(application, user):
            raise PermissionDenied("Bạn không có quyền xem trước email cho hồ sơ này.")

        scheduled_at_raw = request.data.get('scheduled_at')
        if not scheduled_at_raw:
            return Response({'detail': 'Vui lòng chọn thời gian phỏng vấn.'}, status=status.HTTP_400_BAD_REQUEST)

        scheduled_at = parse_datetime(scheduled_at_raw)
        if not scheduled_at:
            return Response({'detail': 'Định dạng thời gian không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        tz = timezone.get_current_timezone()
        if timezone.is_naive(scheduled_at):
            scheduled_at = timezone.make_aware(scheduled_at, tz)

        duration_minutes = int(request.data.get('duration_minutes') or 60)
        duration_minutes = max(duration_minutes, 15)
        interview_end = scheduled_at + timedelta(minutes=duration_minutes)

        rooms = self._get_available_rooms(scheduled_at, interview_end)
        room_id = request.data.get('room_id')
        selected_room = None
        if room_id:
            selected_room = rooms.filter(id=room_id).first()
            if not selected_room:
                return Response({'detail': 'Phòng đã chọn không còn trống ở khung giờ này.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            selected_room = rooms.first()

        recruitment_need = getattr(application.job, 'recruitment_need', None)
        interviewer = getattr(recruitment_need, 'interviewer', None)
        interviewer_names = (interviewer.get_full_name() or interviewer.username) if interviewer else 'Đang xác định'

        location = request.data.get('location', '')
        if not location and selected_room:
            location = f"{selected_room.name} ({selected_room.code})"

        context = build_interview_email_context(
            application,
            scheduled_at,
            duration_minutes,
            location,
            interviewer_names,
        )
        rendered = render_interview_scheduled_email_from_context(context)

        return Response({
            'subject': rendered['subject'],
            'body_html': rendered['body_html'],
            'body_text': rendered['body_text'],
        })

    @action(detail=True, methods=['post'], url_path='schedule-interview')
    def schedule_interview(self, request, pk=None):
        """Đặt lịch phỏng vấn từ hồ sơ ứng tuyển, tự động book phòng họp nếu có phòng trống."""
        application = self.get_object()
        user = request.user

        if not self._can_schedule_application(application, user):
            raise PermissionDenied("Bạn không có quyền đặt lịch phỏng vấn cho hồ sơ này.")

        scheduled_at_raw = request.data.get('scheduled_at')
        if not scheduled_at_raw:
            return Response({'detail': 'Vui lòng chọn thời gian phỏng vấn.'}, status=status.HTTP_400_BAD_REQUEST)

        scheduled_at = parse_datetime(scheduled_at_raw)
        if not scheduled_at:
            return Response({'detail': 'Định dạng thời gian không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        tz = timezone.get_current_timezone()
        if timezone.is_naive(scheduled_at):
            scheduled_at = timezone.make_aware(scheduled_at, tz)

        duration_minutes = int(request.data.get('duration_minutes') or 60)
        duration_minutes = max(duration_minutes, 15)
        interview_end = scheduled_at + timedelta(minutes=duration_minutes)

        rooms = self._get_available_rooms(scheduled_at, interview_end)
        room_id = request.data.get('room_id')
        selected_room = None
        if room_id:
            selected_room = rooms.filter(id=room_id).first()
            if not selected_room:
                return Response({'detail': 'Phòng đã chọn không còn trống ở khung giờ này.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            selected_room = rooms.first()

        booking = None
        if selected_room:
            from employee.models import Employee
            from hrm.models import MeetingRoomBooking

            employee = None
            try:
                employee = Employee.objects.get(user=user)
            except Employee.DoesNotExist:
                employee = None

            booking = MeetingRoomBooking.objects.create(
                room=selected_room,
                title=f"Phỏng vấn: {application.candidate.full_name}",
                note=request.data.get('notes', '') or '',
                booked_by=employee,
                booked_by_user=user,
                booking_source='USER',
                contact_name=(employee.full_name if employee else (user.get_full_name() or user.username)),
                contact_phone=(getattr(employee, 'phone_number', '') if employee else ''),
                start_time=scheduled_at,
                end_time=interview_end,
            )

        recruitment_need = getattr(application.job, 'recruitment_need', None)
        interviewer = getattr(recruitment_need, 'interviewer', None)

        location = request.data.get('location', '')
        if not location and selected_room:
            location = f"{selected_room.name} ({selected_room.code})"

        interview = Interview.objects.create(
            application=application,
            interview_type=request.data.get('interview_type', 'HR'),
            scheduled_at=scheduled_at,
            duration_minutes=duration_minutes,
            location=location,
            notes=request.data.get('notes', '') or '',
            room_booking_id=booking.id if booking else None,
            created_by=user,
        )

        if interviewer:
            interview.interviewers.add(interviewer)

        email_send_error = None
        try:
            queue_interview_scheduled_email(interview, user)
        except Exception as exc:
            email_send_error = str(exc)

        # Mark pipeline status
        application.cv_process_status = 'ACCEPTED'
        application.cv_processed_by_id = user.id
        application.cv_processed_at = timezone.now()

        if application.current_stage in ('APPLIED', 'SCREENING'):
            ApplicationStageHistory.objects.filter(
                application=application,
                stage=application.current_stage,
                exited_at__isnull=True,
            ).update(exited_at=timezone.now())

            application.current_stage = 'INTERVIEW'
            ApplicationStageHistory.objects.create(
                application=application,
                stage='INTERVIEW',
                changed_by=user,
                note='Đã đặt lịch phỏng vấn và chuyển sang chờ phỏng vấn.',
            )

        application.save()
        sync_candidate_status_from_application(application)

        response_data = InterviewSerializer(interview).data
        response_data['email_status'] = 'sent' if interview.interview_email_sent else 'pending'
        if email_send_error:
            response_data['email_error'] = email_send_error

        return Response(response_data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='move-stage')
    def move_stage(self, request, pk=None):
        """Chuyển ứng viên sang stage tiếp theo."""
        application = self.get_object()
        new_stage = request.data.get('stage')
        note = request.data.get('note', '')

        valid_stages = [s[0] for s in PIPELINE_STAGE]
        if new_stage not in valid_stages:
            return Response(
                {'detail': f'Stage không hợp lệ. Chọn một trong: {valid_stages}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Đóng stage hiện tại
        ApplicationStageHistory.objects.filter(
            application=application,
            stage=application.current_stage,
            exited_at__isnull=True,
        ).update(exited_at=timezone.now())

        # Lưu stage mới
        application.current_stage = new_stage
        if new_stage == 'HIRED':
            application.status = 'HIRED'
        elif new_stage in ('REJECTED', 'WITHDRAWN'):
            application.status = new_stage
        application.save()

        ApplicationStageHistory.objects.create(
            application=application,
            stage=new_stage,
            changed_by=request.user,
            note=note,
        )
        return Response(ApplicationSerializer(application).data)

    @action(detail=True, methods=['post'], url_path='approve-cv')
    def approve_cv(self, request, pk=None):
        """Người phỏng vấn duyệt CV và chuyển ứng viên sang trạng thái chờ hẹn lịch phỏng vấn."""
        application = self.get_object()
        user = request.user

        recruitment_need = getattr(application.job, 'recruitment_need', None)

        is_hr_user = getattr(user, 'is_staff', False) or (
            hasattr(user, 'hrm_user') and getattr(user.hrm_user, 'is_hr', False)
        )
        is_admin_user = getattr(user, 'is_superuser', False)
        is_interviewer = bool(
            recruitment_need and recruitment_need.interviewer_id == user.id
        )
        is_cv_approver = bool(
            recruitment_need and recruitment_need.cv_approver_id == user.id
        )

        if not (is_hr_user or is_admin_user or is_interviewer or is_cv_approver):
            raise PermissionDenied("Chỉ người duyệt CV, người phỏng vấn, HR hoặc Admin mới có quyền duyệt CV.")

        if application.status != 'ACTIVE':
            return Response(
                {'detail': 'Chỉ có thể duyệt CV cho hồ sơ đang hoạt động.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Mark CV as accepted by reviewer
        application.cv_process_status = 'ACCEPTED'
        application.cv_processed_by_id = user.id
        application.cv_processed_at = timezone.now()

        # Chờ hẹn lịch phỏng vấn -> chuyển stage sang INTERVIEW nếu còn ở đầu pipeline
        if application.current_stage in ('APPLIED', 'SCREENING'):
            ApplicationStageHistory.objects.filter(
                application=application,
                stage=application.current_stage,
                exited_at__isnull=True,
            ).update(exited_at=timezone.now())

            application.current_stage = 'INTERVIEW'

            note = request.data.get('note', '') or 'CV đã được duyệt, chuyển sang chờ hẹn lịch phỏng vấn.'
            ApplicationStageHistory.objects.create(
                application=application,
                stage='INTERVIEW',
                changed_by=user,
                note=note,
            )

        application.save()

        candidate = application.candidate
        if candidate.status == 'PENDING_CV_REVIEW':
            candidate.status = 'CV_APPROVED'
            candidate.save(update_fields=['status'])

        return Response(ApplicationSerializer(application).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='reject-cv')
    def reject_cv(self, request, pk=None):
        """Đánh dấu CV không phù hợp — đóng đơn ứng tuyển với status REJECTED."""
        application = self.get_object()
        user = request.user

        recruitment_need = getattr(application.job, 'recruitment_need', None)

        is_hr_user = getattr(user, 'is_staff', False) or (
            hasattr(user, 'hrm_user') and getattr(user.hrm_user, 'is_hr', False)
        )
        is_admin_user = getattr(user, 'is_superuser', False)
        is_interviewer = bool(
            recruitment_need and recruitment_need.interviewer_id == user.id
        )
        is_cv_approver = bool(
            recruitment_need and recruitment_need.cv_approver_id == user.id
        )

        if not (is_hr_user or is_admin_user or is_interviewer or is_cv_approver):
            raise PermissionDenied("Chỉ người duyệt CV, người phỏng vấn, HR hoặc Admin mới có quyền từ chối CV.")

        if application.status != 'ACTIVE':
            return Response(
                {'detail': 'Chỉ có thể từ chối CV cho hồ sơ đang hoạt động.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = (request.data.get('reason') or '').strip().upper()
        valid_reasons = {choice[0] for choice in REJECTION_REASON}
        if reason and reason not in valid_reasons:
            return Response(
                {'detail': 'Lý do từ chối không hợp lệ.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        note = (request.data.get('note') or '').strip() or 'CV không phù hợp.'

        # Đóng stage history hiện tại + ghi stage REJECTED mới
        ApplicationStageHistory.objects.filter(
            application=application,
            stage=application.current_stage,
            exited_at__isnull=True,
        ).update(exited_at=timezone.now())

        application.cv_process_status = 'REJECTED'
        application.cv_processed_by_id = user.id
        application.cv_processed_at = timezone.now()
        application.status = 'REJECTED'
        application.current_stage = 'REJECTED'
        if reason:
            application.rejection_reason = reason
        application.rejection_note = note
        application.save()

        ApplicationStageHistory.objects.create(
            application=application,
            stage='REJECTED',
            changed_by=user,
            note=note,
        )

        return Response(ApplicationSerializer(application).data, status=status.HTTP_200_OK)


class InterviewViewSet(viewsets.ModelViewSet):
    """CRUD lịch phỏng vấn."""

    queryset = Interview.objects.select_related(
        'application__candidate', 'application__job', 'created_by'
    ).prefetch_related('interviewers').order_by('-scheduled_at')
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'list':
            return InterviewListSerializer
        return InterviewSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        application_id = self.request.query_params.get('application')
        interview_status = self.request.query_params.get('status')

        if application_id:
            qs = qs.filter(application_id=application_id)
        if interview_status:
            qs = qs.filter(status=interview_status)
        return qs

    @action(detail=False, methods=['get'], url_path='interviewer-candidates')
    def interviewer_candidates(self, request):
        """Danh sách nhân viên đủ điều kiện làm "Bộ phận phỏng vấn":
        là quản lý (is_manager — giống điều kiện dùng ở trang Onboard nhân sự)
        hoặc có quyền "Quyền Tuyển dụng" (EmployeePermission.can_manage_recruitment).
        """
        from django.db.models import Q
        from employee.models import Employee, Department
        from hrm.models import EmployeePermission

        dept_manager_ids = Department.objects.exclude(manager__isnull=True).values_list('manager_id', flat=True)
        emp_manager_ids = Employee.objects.exclude(manager__isnull=True).values_list('manager_id', flat=True)
        recruitment_permission_employee_ids = EmployeePermission.objects.filter(
            can_manage_recruitment=True
        ).values_list('employee_id', flat=True)

        qs = Employee.objects.filter(
            Q(position__is_management=True)
            | Q(id__in=dept_manager_ids)
            | Q(id__in=emp_manager_ids)
            | Q(id__in=recruitment_permission_employee_ids),
            is_active=True,
        ).distinct()

        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(Q(employee_id__icontains=search) | Q(full_name__icontains=search))

        qs = qs.select_related('user').order_by('full_name')[:50]

        data = [
            {'user_id': e.user_id, 'employee_id': e.employee_id, 'full_name': e.full_name}
            for e in qs if e.user_id
        ]
        return Response(data)

    def perform_create(self, serializer):
        interview = serializer.save(created_by=self.request.user)
        sync_candidate_status_from_application(interview.application)
        _notify_recruitment_need_for_interview(interview)

    def perform_update(self, serializer):
        interview = serializer.save()
        sync_candidate_status_from_application(interview.application)

    def perform_destroy(self, instance):
        application = instance.application
        instance.delete()
        sync_candidate_status_from_application(application)

    @action(detail=True, methods=['patch'], url_path='interviewer')
    def set_interviewer(self, request, pk=None):
        """Đổi "Bộ phận phỏng vấn" (Interview.interviewers) — chỉ áp dụng cho
        đúng lịch phỏng vấn này, không ảnh hưởng các lịch phỏng vấn khác cùng
        nhu cầu tuyển dụng.

        Đồng thời gửi thông báo lịch phỏng vấn này cho nhân viên vừa được chọn.
        """
        from django.contrib.auth import get_user_model
        User = get_user_model()

        interview = self.get_object()

        user_id = request.data.get('interviewer')
        new_user = None
        if user_id not in (None, ''):
            try:
                new_user = User.objects.get(pk=user_id)
            except User.DoesNotExist:
                return Response({'detail': 'Không tìm thấy nhân viên.'}, status=status.HTTP_400_BAD_REQUEST)

        if new_user is not None:
            interview.interviewers.set([new_user])
            _notify_users_for_interview(interview, [new_user])
        else:
            interview.interviewers.clear()

        return Response(InterviewListSerializer(interview, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'], url_path='mark-done')
    def mark_done(self, request, pk=None):
        """Đánh dấu phỏng vấn đã hoàn thành."""
        interview = self.get_object()
        interview.status = 'DONE'
        interview.save()
        sync_candidate_status_from_application(interview.application)
        return Response(InterviewSerializer(interview).data)

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        """Huỷ lịch phỏng vấn."""
        interview = self.get_object()
        interview.status = 'CANCELLED'
        interview.save()
        sync_candidate_status_from_application(interview.application)
        return Response(InterviewSerializer(interview).data)

    @action(detail=True, methods=['post'], url_path='mark-no-show')
    def mark_no_show(self, request, pk=None):
        """Đánh dấu ứng viên không đến phỏng vấn."""
        interview = self.get_object()
        interview.status = 'NO_SHOW'
        interview.save()
        sync_candidate_status_from_application(interview.application)
        return Response(InterviewSerializer(interview).data)

    @action(detail=True, methods=['post'], url_path='confirm')
    def confirm_interview(self, request, pk=None):
        """
        Người phỏng vấn xác nhận tham gia phỏng vấn.
        Hệ thống sẽ tự động book phòng họp nếu cần.
        """
        interview = self.get_object()
        user = request.user
        
        # Check: user phải là một trong các interviewers
        if not interview.interviewers.filter(id=user.id).exists():
            raise PermissionDenied("Bạn không phải là người phỏng vấn của lịch này.")
        
        if interview.status != 'SCHEDULED':
            return Response(
                {'detail': f'Chỉ có thể xác nhận lịch "Đã lên lịch", hiện tại là {interview.get_status_display()}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        if interview.interviewer_confirmed:
            return Response(
                {'detail': 'Lịch phỏng vấn đã được xác nhận.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        # Mark as confirmed
        interview.interviewer_confirmed = True
        interview.interviewer_confirmed_at = timezone.now()
        
        # Try to auto-book meeting room if location is not provided
        if not interview.location or 'meet.google.com' not in interview.location:
            try:
                room_booking_id = self._auto_book_meeting_room(interview, user)
                if room_booking_id:
                    interview.room_booking_id = room_booking_id
                    if not interview.location:
                        interview.location = f"Phòng họp tự động xếp (ID: {room_booking_id})"
            except Exception as e:
                # Log error but don't fail the confirmation
                print(f"Error auto-booking room: {str(e)}")
        
        interview.save()
        return Response(InterviewSerializer(interview).data)

    def _auto_book_meeting_room(self, interview, user):
        """
        Tự động đặt phòng họp khi người phỏng vấn xác nhận.
        Ưu tiên: phòng có sức chứa >= số người phỏng vấn, không bị conflict, trong khung giờ làm việc.
        """
        try:
            from django.db import models as db_models
            from hrm.models import MeetingRoom, MeetingRoomBooking, MeetingRoomSetting
            
            # Get booking constraints
            setting = MeetingRoomSetting.get_solo()
            interview_start = interview.scheduled_at
            interview_end = interview.scheduled_at + timezone.timedelta(minutes=interview.duration_minutes)
            
            # Find available rooms (not booked during this time)
            occupied_rooms = MeetingRoomBooking.objects.filter(
                start_time__lt=interview_end,
                end_time__gt=interview_start
            ).values_list('room_id', flat=True)
            
            available_rooms = MeetingRoom.objects.filter(
                is_active=True
            ).exclude(id__in=occupied_rooms).order_by('capacity')[:1]
            
            if not available_rooms.exists():
                return None  # No available room
            
            room = available_rooms.first()
            
            # Create booking
            booking = MeetingRoomBooking.objects.create(
                room=room,
                title=f"Phỏng vấn: {interview.application.candidate.full_name}",
                note=f"Tự động book cho {interview.get_interview_type_display()}",
                booked_by_user=user,
                booking_source='AI',
                ai_agent_name='recruitment_autobooker',
                contact_name=user.username,
                contact_phone=getattr(user, 'phone', '') or '+84',
                start_time=interview_start,
                end_time=interview_end,
            )
            
            return booking.id
        except Exception as e:
            print(f"Auto-book room error: {str(e)}")
            return None

    @action(detail=True, methods=['post'], url_path='onboard-candidate')
    def onboard_candidate(self, request, pk=None):
        """Onboard ứng viên từ lịch phỏng vấn."""
        interview = self.get_object()
        application = interview.application

        if interview.status != 'DONE':
            return Response(
                {'detail': 'Chỉ có thể onboard ứng viên sau khi phỏng vấn đã hoàn thành.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Close current stage history (if any)
        ApplicationStageHistory.objects.filter(
            application=application,
            stage=application.current_stage,
            exited_at__isnull=True,
        ).update(exited_at=timezone.now())

        application.current_stage = 'HIRED'
        application.status = 'HIRED'
        application.save()

        ApplicationStageHistory.objects.create(
            application=application,
            stage='HIRED',
            changed_by=request.user,
            note='Onboard từ màn hình lịch phỏng vấn.',
        )

        onboarding_process_id = self._create_onboarding_process_from_interview(interview, request.user)

        return Response({
            'detail': 'Đã onboard ứng viên thành công.',
            'onboarding_process_id': onboarding_process_id,
            'interview': InterviewSerializer(interview).data,
        }, status=status.HTTP_200_OK)

    def _create_onboarding_process_from_interview(self, interview, initiated_by_user):
        try:
            from django.apps import apps

            try:
                OnboardingProcess = apps.get_model('hrm', 'OnboardingProcess')
            except LookupError:
                return None

            candidate = interview.application.candidate
            job = interview.application.job

            onboarding = OnboardingProcess.objects.create(
                candidate_name=candidate.full_name,
                candidate_email=candidate.email,
                candidate_phone=candidate.phone,
                position=job.title if job else 'Chưa xác định',
                onboard_date=timezone.localdate() + timedelta(days=1),
                status='PENDING',
                created_by=initiated_by_user,
            )

            return onboarding.id
        except Exception as e:
            print(f"Create onboarding from interview error: {str(e)}")
            return None

    @action(detail=True, methods=['get'], url_path='preview-email')
    def preview_interview_email(self, request, pk=None):
        """Xem trước email lịch phỏng vấn."""
        from .email_templates import render_email_template
        from datetime import datetime
        
        interview = self.get_object()
        candidate = interview.application.candidate
        job = interview.application.job
        scheduled_at = interview.scheduled_at
        
        # Format datetime for display
        scheduled_at_formatted = scheduled_at.strftime('%d/%m/%Y lúc %H:%M')
        interviewer_names = ' & '.join([
            interviewer.get_full_name() or interviewer.username 
            for interviewer in interview.interviewers.all()
        ])
        
        context = {
            'candidate_name': candidate.full_name,
            'job_title': job.title if job else 'Chưa xác định',
            'scheduled_at_formatted': scheduled_at_formatted,
            'duration_minutes': interview.duration_minutes,
            'location': interview.location or 'Sẽ được xác nhận',
            'interviewer_names': interviewer_names or 'Đang xác định',
            'company_name': branding.company_name(),
        }
        
        try:
            rendered = render_email_template('interview_scheduled', context)
            return Response({
                'subject': rendered['subject'],
                'body_html': rendered['body_html'],
                'body_text': rendered['body_text'],
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='send-interview-email')
    def send_interview_email(self, request, pk=None):
        """Gửi email lịch phỏng vấn cho ứng viên."""

        interview = self.get_object()
        candidate = interview.application.candidate

        try:
            queue_interview_scheduled_email(interview, request.user)

            return Response({
                'detail': f'Email lịch phỏng vấn đã được gửi tới {candidate.email}',
                'status': 'queued'
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class InterviewEvaluationViewSet(viewsets.ModelViewSet):
    """CRUD đánh giá phỏng vấn."""

    queryset = InterviewEvaluation.objects.select_related(
        'interview__application__candidate', 'evaluator'
    ).order_by('-created_at')
    permission_classes = [IsAuthenticated]
    serializer_class = InterviewEvaluationSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        interview_id = self.request.query_params.get('interview')
        if interview_id:
            qs = qs.filter(interview_id=interview_id)
        return qs

    def perform_create(self, serializer):
        interview = serializer.validated_data.get('interview')
        if interview and InterviewEvaluation.objects.filter(interview=interview).exists():
            from rest_framework.exceptions import ValidationError
            raise ValidationError({
                'detail': 'Phỏng vấn này đã có đánh giá rồi. Mỗi phỏng vấn chỉ được đánh giá 1 lần.'
            })
        evaluation = serializer.save(evaluator=self.request.user)
        sync_candidate_status_from_application(evaluation.interview.application)

    def perform_update(self, serializer):
        evaluation = serializer.save()
        sync_candidate_status_from_application(evaluation.interview.application)

    def perform_destroy(self, instance):
        application = instance.interview.application
        instance.delete()
        sync_candidate_status_from_application(application)


class OfferViewSet(viewsets.ModelViewSet):
    """CRUD offer letter."""

    queryset = Offer.objects.select_related(
        'application__candidate', 'application__job', 'created_by'
    ).order_by('-created_at')
    permission_classes = [IsAuthenticated]
    serializer_class = OfferSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='accept')
    def accept(self, request, pk=None):
        """Ứng viên chấp nhận offer. Tự động tạo quy trình onboarding."""
        offer = self.get_object()
        actual_onboard = request.data.get('actual_onboard_date')
        confirmed_onboard = request.data.get('confirmed_onboard_date')
        
        offer.status = 'ACCEPTED'
        offer.responded_at = timezone.now()
        if actual_onboard:
            offer.actual_onboard_date = actual_onboard
        if confirmed_onboard:
            offer.confirmed_onboard_date = confirmed_onboard
        
        # Cập nhật application
        offer.application.status = 'HIRED'
        offer.application.current_stage = 'HIRED'
        offer.application.save()
        
        # Tự động tạo quy trình onboarding nếu có confirmed_onboard_date
        if confirmed_onboard or offer.expected_onboard_date:
            try:
                onboarding_process_id = self._create_onboarding_process(offer, request.user)
                if onboarding_process_id:
                    offer.onboarding_process_id = onboarding_process_id
            except Exception as e:
                # Log error but don't fail the acceptance
                print(f"Error creating onboarding process: {str(e)}")
        
        offer.save()
        return Response(OfferSerializer(offer).data)

    def _create_onboarding_process(self, offer, initiated_by_user):
        """
        Tạo quy trình onboarding cho ứng viên được tuyển.
        Tích hợp với hrm.OnboardingProcess nếu có.
        """
        try:
            # Check if hrm.OnboardingProcess exists
            from django.apps import apps
            try:
                OnboardingProcess = apps.get_model('hrm', 'OnboardingProcess')
            except LookupError:
                # Model không tồn tại, skip
                return None
            
            candidate = offer.application.candidate
            job = offer.application.job
            recruitment_need = job.recruitment_need if job else None
            
            onboarding_date = offer.confirmed_onboard_date or offer.expected_onboard_date or timezone.now().date()
            
            # Create onboarding process
            onboarding = OnboardingProcess.objects.create(
                candidate_name=candidate.full_name,
                candidate_email=candidate.email,
                candidate_phone=candidate.phone,
                position=job.title if job else offer.position_title or 'Chưa xác định',
                onboard_date=onboarding_date,
                status='PENDING',
                created_by=initiated_by_user,
            )
            
            return onboarding.id
        except Exception as e:
            print(f"Create onboarding process error: {str(e)}")
            return None

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        """Ứng viên từ chối offer."""
        offer = self.get_object()
        offer.status = 'REJECTED'
        offer.responded_at = timezone.now()
        offer.rejection_note = request.data.get('note', '')
        offer.save()
        return Response(OfferSerializer(offer).data)
    @action(detail=True, methods=['get'], url_path='preview-letter')
    def preview_offer_letter(self, request, pk=None):
        """Xem trước thư đề nghị việc làm (offer letter HTML)."""
        from .email_templates import render_email_template
        
        offer = self.get_object()
        candidate = offer.application.candidate
        job = offer.application.job
        
        context = {
            'candidate_name': candidate.full_name,
            'job_title': job.title if job else offer.position_title or 'Chưa xác định',
            'company_name': branding.company_name(),
            'proposed_salary': float(offer.proposed_salary),
            'allowances': float(offer.allowances),
            'expected_onboard_date': str(offer.expected_onboard_date) if offer.expected_onboard_date else 'Tùy thỏa thuận',
            'probation_months': offer.probation_months,
            'offer_link': f"{request.build_absolute_uri('/dashboard/')}recruitment/offers/{offer.id}/",
        }
        
        try:
            rendered = render_email_template('offer_letter', context)
            return Response({
                'subject': rendered['subject'],
                'body_html': rendered['body_html'],
                'body_text': rendered['body_text'],
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='send-offer-email')
    def send_offer_email(self, request, pk=None):
        """Gửi email thư đề nghị việc làm cho ứng viên."""
        from django.core.mail import send_mail
        from .email_templates import render_email_template
        from hrm.models import EmailQueue
        
        offer = self.get_object()
        candidate = offer.application.candidate
        job = offer.application.job
        
        context = {
            'candidate_name': candidate.full_name,
            'job_title': job.title if job else offer.position_title or 'Chưa xác định',
            'company_name': branding.company_name(),
            'proposed_salary': float(offer.proposed_salary),
            'allowances': float(offer.allowances),
            'expected_onboard_date': str(offer.expected_onboard_date) if offer.expected_onboard_date else 'Tùy thỏa thuận',
            'probation_months': offer.probation_months,
            'offer_link': f"{request.build_absolute_uri('/dashboard/')}recruitment/offers/{offer.id}/",
        }
        
        try:
            rendered = render_email_template('offer_letter', context)
            
            # Create email queue record
            EmailQueue.objects.create(
                recipient_email=candidate.email,
                subject=rendered['subject'],
                body_text=rendered['body_text'],
                body_html=rendered['body_html'],
                email_type='offer_letter',
                related_object_id=offer.id,
                created_by=request.user,
            )
            
            offer.sent_at = timezone.now()
            offer.save()
            
            return Response({
                'detail': f'Email thư đề nghị công việc đã được gửi tới {candidate.email}',
                'status': 'queued'
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)