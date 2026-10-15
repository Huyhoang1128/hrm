"""
hrm/feedback_views.py
══════════════════════
API "Tiếp nhận - xử lý - Phản hồi IT/HC" (tên cũ "Hòm thư góp ý", hrm/feedback_models.py).

/api-hrm/feedbacks/
    POST            – Mọi nhân sự đã đăng nhập gửi góp ý
                      (topic, is_anonymous, difficulties, support_needed,
                      career_sharing, work_proposal, other_sharing,
                      images[] – tối đa 5 ảnh, mỗi ảnh ≤ 10MB; gửi multipart)
    GET             – CHỈ HCNS/Admin: danh sách, lọc ?topic=&status=&search=,
                      phân trang ?page=&page_size=; status nhận nhiều giá trị
                      cách nhau dấu phẩy (vd NEW,IN_PROGRESS = chưa xử lý xong)
    GET  summary/   – CHỈ HCNS/Admin: số góp ý theo trạng thái (cho tab đếm)
    PATCH <pk>/     – CHỈ HCNS/Admin: cập nhật status, hr_note (nội bộ),
                      response_note (phản hồi người gửi xem được)
    GET  mine/      – Mọi nhân sự: ý kiến CHÍNH MÌNH đã gửi (kể cả ẩn danh) để
                      tự theo dõi trạng thái, lọc ?status=; kèm counts theo
                      trạng thái; KHÔNG trả hr_note
    GET  notices/   – Mọi nhân sự: số góp ý mới cần mình xử lý (HCNS/Admin) +
                      góp ý của mình vừa được xử lý xong mà chưa xem thông báo
    POST acknowledge-resolved/ – Người gửi bấm "Đã hiểu" ({ids: [...]})

HCNS/Admin chỉ thấy góp ý thuộc nhóm vấn đề của mình — xem _visible_topics().
"""
import logging

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Max, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from employee.models import Employee

from .feedback_models import Feedback, FeedbackAttachment
from .models import _is_hr
from .pagination import StandardResultsSetPagination

logger = logging.getLogger(__name__)

MAX_ANSWER_LENGTH = 5000
MAX_IMAGES = 5
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}
OPEN_STATUSES = ("NEW", "IN_PROGRESS")
# Mã phòng ban IT ("Công nghệ thông tin", "Phòng IT").
IT_DEPARTMENT_CODES = {"IT", "CÔNG_NGHỆ_THÔNG_TIN"}


def _validate_images(files):
    """Trả về thông báo lỗi (str) hoặc None. Kiểm tra bằng Pillow để chắc là
    ảnh thật, không chỉ dựa vào đuôi file/content-type do client gửi."""
    if len(files) > MAX_IMAGES:
        return f"Chỉ được đính kèm tối đa {MAX_IMAGES} ảnh."
    from PIL import Image
    for f in files:
        if f.size > MAX_IMAGE_BYTES:
            return f'Ảnh "{f.name}" vượt quá {MAX_IMAGE_BYTES // (1024 * 1024)}MB.'
        try:
            f.seek(0)
            with Image.open(f) as img:
                fmt = img.format
                img.verify()
        except Exception:
            return f'File "{f.name}" không phải ảnh hợp lệ.'
        finally:
            f.seek(0)
        if fmt not in ALLOWED_IMAGE_FORMATS:
            return f'Ảnh "{f.name}" không đúng định dạng (chỉ nhận JPG, PNG, WEBP, GIF).'
    return None


def _attachment_url(att, request):
    if getattr(settings, "CLOUDFLY_ENABLED", False):
        from .utils import get_cloudfly_presigned_url
        return get_cloudfly_presigned_url(str(att.file), expires_in=3600)
    return request.build_absolute_uri(att.file.url) if request else att.file.url


def _can_view_feedbacks(user, employee) -> bool:
    """Góp ý có thể chứa nội dung nhạy cảm (bức xúc với quản lý...) nên chỉ
    HCNS/Admin được xem — KHÔNG mở cho quản lý có quyền duyệt chấm công như
    _is_hr_or_admin_broad."""
    if user.is_staff or user.is_superuser:
        return True
    try:
        from users.utils import get_user_role
        if get_user_role(user) in ("admin", "hr"):
            return True
    except ImportError:
        pass
    return _is_hr(employee)


def _is_it_department(department) -> bool:
    seen = set()
    while department is not None and department.pk not in seen:
        if (department.code or "").strip().upper() in IT_DEPARTMENT_CODES:
            return True
        seen.add(department.pk)
        department = department.parent_department
    return False


def _visible_topics(user, employee):
    """Các vấn đề tài khoản này được xem/xử lý; None = không có quyền.

    Phân theo phòng ban chứ không theo role, vì role admin và HR chồng
    nhau (trưởng phòng HCNS là superuser, NV IT được tick HR):
      - HCNS/Admin thuộc phòng IT, hoặc tài khoản admin hệ thống không gắn NV
        → chỉ góp ý IT/app (Feedback.IT_TOPICS).
      - HCNS/Admin thuộc phòng ban khác → mọi vấn đề còn lại.
    """
    if not _can_view_feedbacks(user, employee):
        return None
    if employee is None or _is_it_department(employee.department):
        return list(Feedback.IT_TOPICS)
    return [code for code, _label in Feedback.TOPIC_CHOICES if code not in Feedback.IT_TOPICS]


def _excerpt(f: Feedback, limit=120) -> str:
    text = next((getattr(f, field) for field, _label in Feedback.ANSWER_FIELDS if getattr(f, field).strip()), "")
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


class FeedbackViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def _get_employee(self, request):
        return Employee.objects.filter(user=request.user).select_related("department").first()

    def _forbidden(self):
        return Response({"error": "Bạn không có quyền xem trang Tiếp nhận - xử lý - Phản hồi IT/HC"}, status=status.HTTP_403_FORBIDDEN)

    def create(self, request):
        topic = request.data.get("topic")
        if topic not in dict(Feedback.TOPIC_CHOICES):
            return Response({"error": "Vui lòng chọn vấn đề bạn muốn góp ý."}, status=status.HTTP_400_BAD_REQUEST)

        answers = {}
        for field, _label in Feedback.ANSWER_FIELDS:
            value = str(request.data.get(field) or "").strip()
            if len(value) > MAX_ANSWER_LENGTH:
                return Response(
                    {"error": f"Mỗi câu trả lời tối đa {MAX_ANSWER_LENGTH} ký tự."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            answers[field] = value
        images = request.FILES.getlist("images")
        if not any(answers.values()) and not images:
            return Response(
                {"error": "Vui lòng chia sẻ ít nhất 1 nội dung trước khi gửi."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        image_error = _validate_images(images)
        if image_error:
            return Response({"error": image_error}, status=status.HTTP_400_BAD_REQUEST)

        # Cloudfly: upload hết TRƯỚC khi tạo bản ghi — lỗi giữa chừng thì không
        # để lại góp ý thiếu ảnh mà người gửi tưởng đã gửi đủ.
        stored_files = list(images)
        if images and getattr(settings, "CLOUDFLY_ENABLED", False):
            from .utils import upload_file_to_cloudfly
            try:
                stored_files = [upload_file_to_cloudfly(f, "feedback") for f in images]
            except Exception:
                logger.exception("Upload ảnh góp ý lên Cloudfly thất bại")
                return Response(
                    {"error": "Tải ảnh lên thất bại, vui lòng thử lại."},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

        is_anonymous = str(request.data.get("is_anonymous")).lower() in ("true", "1")
        with transaction.atomic():
            feedback = Feedback.objects.create(
                # Ẩn danh vẫn lưu người gửi để kiểm soát lạm dụng — _serialize() mới là nơi ẩn.
                employee=self._get_employee(request),
                is_anonymous=is_anonymous,
                topic=topic,
                **answers,
            )
            for original, stored in zip(images, stored_files):
                FeedbackAttachment.objects.create(feedback=feedback, file=stored, file_name=original.name[:255])
        return Response({"id": feedback.id}, status=status.HTTP_201_CREATED)

    def list(self, request):
        topics = _visible_topics(request.user, self._get_employee(request))
        if topics is None:
            return self._forbidden()

        qs = Feedback.objects.filter(topic__in=topics).select_related(
            "employee", "employee__department", "handled_by",
        ).prefetch_related("attachments").order_by("-created_at")

        topic = request.query_params.get("topic")
        if topic:
            qs = qs.filter(topic=topic)
        statuses = [s for s in (request.query_params.get("status") or "").split(",") if s]
        if statuses:
            qs = qs.filter(status__in=statuses)

        search = (request.query_params.get("search") or "").strip()
        if search:
            content_q = Q()
            for field, _label in Feedback.ANSWER_FIELDS:
                content_q |= Q(**{f"{field}__icontains": search})
            # Tìm theo tên/mã/phòng ban CHỈ áp cho góp ý không ẩn danh — nếu không,
            # gõ tên 1 người là lộ được góp ý ẩn danh nào của họ.
            identity_q = (
                Q(employee__full_name__icontains=search)
                | Q(employee__employee_id__icontains=search)
                | Q(employee__department__name__icontains=search)
            ) & Q(is_anonymous=False)
            qs = qs.filter(content_q | identity_q)

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response([self._serialize(f, request) for f in page])

    @action(detail=False, methods=["get"])
    def summary(self, request):
        topics = _visible_topics(request.user, self._get_employee(request))
        if topics is None:
            return self._forbidden()
        counts = dict(
            Feedback.objects.filter(topic__in=topics).order_by().values_list("status").annotate(n=Count("id"))
        )
        return Response({
            "total": sum(counts.values()),
            "open": sum(counts.get(code, 0) for code in OPEN_STATUSES),
            **{code: counts.get(code, 0) for code, _label in Feedback.STATUS_CHOICES},
            "topics": topics,
        })

    @action(detail=False, methods=["get"])
    def notices(self, request):
        """FE gọi định kỳ để hiện thông báo — gọn nhẹ, không phân trang."""
        employee = self._get_employee(request)
        topics = _visible_topics(request.user, employee)
        data = {"can_handle": topics is not None, "pending_count": 0, "latest_pending_id": None, "resolved": []}
        if topics is not None:
            agg = Feedback.objects.filter(topic__in=topics, status="NEW").aggregate(n=Count("id"), latest=Max("id"))
            data["pending_count"] = agg["n"]
            data["latest_pending_id"] = agg["latest"]
        if employee is not None:
            # Chỉ trả về cho CHÍNH người gửi (kể cả góp ý ẩn danh của họ) —
            # HCNS/Admin không thấy được ai đã nhận/đã xem thông báo.
            resolved = Feedback.objects.filter(
                employee=employee, status="RESOLVED", resolved_seen_at__isnull=True,
            ).order_by("-resolved_at", "-id")[:20]
            data["resolved"] = [
                {
                    "id": f.id,
                    "topic_display": f.get_topic_display(),
                    "is_anonymous": f.is_anonymous,
                    "excerpt": _excerpt(f),
                    "created_at": f.created_at.isoformat(),
                    "resolved_at": f.resolved_at.isoformat() if f.resolved_at else None,
                    "response_note": f.response_note,
                }
                for f in resolved
            ]
        return Response(data)

    @action(detail=False, methods=["post"], url_path="acknowledge-resolved")
    def acknowledge_resolved(self, request):
        employee = self._get_employee(request)
        ids = request.data.get("ids")
        if employee is None or not isinstance(ids, list):
            return Response({"error": "Thiếu danh sách góp ý"}, status=status.HTTP_400_BAD_REQUEST)
        updated = Feedback.objects.filter(
            id__in=[i for i in ids if isinstance(i, int)], employee=employee,
            status="RESOLVED", resolved_seen_at__isnull=True,
        ).update(resolved_seen_at=timezone.now())
        return Response({"updated": updated})

    def partial_update(self, request, pk=None):
        handler = self._get_employee(request)
        topics = _visible_topics(request.user, handler)
        if topics is None:
            return self._forbidden()
        feedback = Feedback.objects.filter(pk=pk, topic__in=topics).first()
        if not feedback:
            return Response(status=status.HTTP_404_NOT_FOUND)

        new_status = request.data.get("status")
        if new_status is not None:
            if new_status not in dict(Feedback.STATUS_CHOICES):
                return Response({"error": "Trạng thái không hợp lệ"}, status=status.HTTP_400_BAD_REQUEST)
            feedback.change_status(new_status)
        for field in ("hr_note", "response_note"):
            if field in request.data:
                setattr(feedback, field, str(request.data.get(field) or "").strip()[:MAX_ANSWER_LENGTH])
        feedback.handled_by = handler
        feedback.handled_at = timezone.now()
        feedback.save()
        return Response(self._serialize(feedback, request))

    @action(detail=False, methods=["get"])
    def mine(self, request):
        """Ý kiến chính mình đã gửi (kể cả ẩn danh — chỉ chính người gửi thấy)
        để tự theo dõi đang ở bước nào; counts dùng cho bộ lọc theo trạng thái."""
        employee = self._get_employee(request)
        own = Feedback.objects.filter(employee=employee) if employee else Feedback.objects.none()
        counts = dict(own.order_by().values_list("status").annotate(n=Count("id")))

        qs = own.prefetch_related("attachments").order_by("-created_at")
        statuses = [s for s in (request.query_params.get("status") or "").split(",") if s]
        if statuses:
            qs = qs.filter(status__in=statuses)

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(qs, request)
        response = paginator.get_paginated_response([self._serialize_for_sender(f, request) for f in page])
        response.data["counts"] = {
            "total": sum(counts.values()),
            **{code: counts.get(code, 0) for code, _label in Feedback.STATUS_CHOICES},
        }
        return response

    @staticmethod
    def _serialize_for_sender(f: Feedback, request=None) -> dict:
        """Phần người gửi và người xử lý cùng thấy — KHÔNG có hr_note (ghi chú
        nội bộ) hay tên người xử lý."""
        return {
            "id": f.id,
            "is_anonymous": f.is_anonymous,
            "topic": f.topic,
            "topic_display": f.get_topic_display(),
            "handler_unit": "IT" if f.topic in Feedback.IT_TOPICS else "HCNS",
            "answers": [
                {"field": field, "question": label, "answer": getattr(f, field)}
                for field, label in Feedback.ANSWER_FIELDS
            ],
            "attachments": [
                {"id": a.id, "file_name": a.file_name, "url": _attachment_url(a, request)}
                for a in f.attachments.all()
            ],
            "status": f.status,
            "status_display": f.get_status_display(),
            "response_note": f.response_note,
            "created_at": f.created_at.isoformat(),
            "received_at": f.received_at.isoformat() if f.received_at else None,
            "resolved_at": f.resolved_at.isoformat() if f.resolved_at else None,
        }

    @staticmethod
    def _serialize(f: Feedback, request=None) -> dict:
        emp = None if f.is_anonymous else f.employee
        return {
            **FeedbackViewSet._serialize_for_sender(f, request),
            "employee_code": emp.employee_id if emp else None,
            "employee_name": emp.full_name if emp else None,
            "department_name": emp.department.name if emp and emp.department else None,
            "hr_note": f.hr_note,
            "handled_by_name": f.handled_by.full_name if f.handled_by else None,
            "handled_at": f.handled_at.isoformat() if f.handled_at else None,
        }
