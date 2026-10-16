import decimal

from django.db import models
from hrm import branding
from django.contrib.auth.models import User
from django.utils import timezone
from django.core.exceptions import ValidationError
from employee.models import Employee, CompanyUnit
from employee.models import CONTRACT_TYPE as EMPLOYEE_CONTRACT_TYPE, PROBATION_CONTRACT_TYPES, OFFICIAL_LABOR_CONTRACT_TYPES, probation_months_for
from django.core.validators import MaxValueValidator, MinValueValidator

# Create your models here.

# ======================
# ENUM CHOICES
# ======================

LEAVE_TYPE = [
    ('ANNUAL', 'Nghỉ phép năm'),
    ('SICK', 'Nghỉ ốm'),
    ('MATERNITY', 'Nghỉ thai sản'),
    ('PATERNITY', 'Nghỉ thai sản cho cha'),
    ('MARRIAGE', 'Nghỉ cưới'),
    ('FUNERAL', 'Nghỉ tang lễ'),
    ('UNPAID', 'Nghỉ không lương'),
    ('OTHER', 'Khác'),
]

OVERTIME_TYPE = [
    ('WEEKDAY', 'Ngày thường'),
    ('WEEKEND', 'Cuối tuần'),
    ('HOLIDAY', 'Ngày lễ'),
    ('NIGHT', 'Ban đêm'),
]

ATTENDANCE_STATUS = [
    ('PRESENT', 'Có mặt'),
    ('LATE', 'Đi muộn'),
    ('EARLY_LEAVE', 'Về sớm'),
    ('ABSENT', 'Vắng mặt'),
    ('HALF_DAY', 'Nửa ngày'),
    ('INCOMPLETE_ATTENDANCE', 'Quên chấm công'),
]

REQUEST_STATUS = [
    ('DRAFT', 'Nháp'),
    ('PENDING', 'Chờ duyệt'),
    ('APPROVED', 'Đã duyệt'),
    ('REJECTED', 'Từ chối'),
    ('CANCELLED', 'Đã hủy'),
]

APPROVAL_ACTION = [
    ('APPROVE', 'Duyệt'),
    ('REJECT', 'Từ chối'),
    ('RETURN', 'Trả lại'),
    ('FORWARD', 'Chuyển tiếp'),
]

APPROVAL_LEVEL = [
    ('DIRECT_MANAGER', 'Quản lý trực tiếp'),
    ('DEPARTMENT_HEAD', 'Trưởng phòng'),
    ('HR', 'Nhân sự'),
    ('DIRECTOR', 'Giám đốc'),
    ('CEO', 'Tổng giám đốc'),
]

# ======================
# UTILITY FUNCTIONS
# ======================

def is_department_head(employee):
    """Kiểm tra xem nhân viên có phải là trưởng phòng không"""
    return employee.department and employee.department.manager == employee

def is_director(employee):
    """Kiểm tra xem nhân viên có phải là giám đốc không"""
    if employee.position:
        title_lower = employee.position.title.lower()
        return 'giám đốc' in title_lower or 'director' in title_lower
    return False

def is_senior_manager(employee):
    """Kiểm tra xem nhân viên có phải là quản lý cấp cao (trưởng phòng/giám đốc) không"""
    return is_department_head(employee) or is_director(employee) or (employee.position and employee.position.is_management)

def _is_hr(employee):
    """Kiểm tra xem nhân viên có phải là nhân viên HR không"""
    if not employee:
        return False
    return getattr(employee, 'is_hr', False) == True

def _has_approve_permission(employee):
    """Kiểm tra xem nhân viên có quyền phê duyệt chấm công không"""
    try:
        from .models import EmployeePermission
        perm = EmployeePermission.objects.get(employee=employee)
        return perm.can_approve_attendance
    except:
        return False


def _is_hr_or_admin_strict(employee):
    """HCNS hoặc Admin theo nghĩa HẸP — dùng cho các quyền NHẠY CẢM: huỷ đơn
    nghỉ phép/nghỉ không phép, và cấp "Mở khoá đặc biệt".

    Khác hai hàm họ hàng:
    - `_is_hr_or_admin_broad()` còn nhận cả người có chức danh chứa "HR" /
      "NHÂN SỰ" hoặc thuộc phòng HCNS — cố tình rộng, dành cho quyền XEM.
    - `_has_approve_permission()` (can_approve_attendance) KHÔNG được tính ở
      đây: quản lý thường cũng có cờ này, mà dưới cơ chế phạt 500k (HCNS áp
      từ 10/2026) thì quản lý tự huỷ được đơn là tự xoá lỗi của chính mình —
      huỷ 1 đơn đã duyệt muộn sẽ biến lỗi "Duyệt đơn quá hạn" của quản lý
      thành lỗi "Nghỉ không tạo đơn" của nhân viên. HCNS chốt 2026-10-09.
    """
    if not employee:
        return False
    u = getattr(employee, "user", None)
    if u is not None and (getattr(u, "is_staff", False) or getattr(u, "is_superuser", False)):
        return True
    return _is_hr(employee)


# Hai loại đơn bị siết quyền huỷ theo cơ chế phạt 500k (HCNS 10/2026).
LEAVE_LIKE_REQUEST_TYPES = ("LEAVE", "UNAUTHORIZED_ABSENCE")


def record_request_edit(d, actor, changed_fields, old_values):
    """Ghi log việc user tự chỉnh sửa đơn (chưa duyệt) của chính mình vào
    EmployeeEvent.data — dùng chung cho giải trình/nghỉ phép, tăng ca, làm online.

    `d` là dict data hiện tại (đã copy), sẽ được mutate và trả về.
    `changed_fields`: list tên field đã đổi; `old_values`: dict field -> giá trị cũ.
    """
    from django.utils import timezone as _tz

    now_str = _tz.now().isoformat()
    history = list(d.get('edit_history') or [])
    history.append({
        'edited_at': now_str,
        'edited_by_id': getattr(actor, 'id', None),
        'edited_by_name': getattr(actor, 'full_name', None),
        'changes': {f: {'old': old_values.get(f), 'new': d.get(f)} for f in changed_fields},
    })
    d['edit_history'] = history
    d['last_edited_at'] = now_str
    d['last_edited_by_id'] = getattr(actor, 'id', None)
    d['last_edited_by_name'] = getattr(actor, 'full_name', None)
    return d


def reset_approval_for_privileged_edit(d, actor, *, is_admin, is_hr_user, has_perm, is_management):
    """Khi QLTT (is_management, KHÔNG phải Admin/HR/has_perm) sửa 1 đơn ĐÃ
    DUYỆT (status='APPROVED'), đơn phải quay lại chờ HCNS duyệt lại — theo
    yêu cầu HCNS 2026-09-21: "quản lý có thể sửa được lại nhé, nhưng sau
    khi sửa sẽ ghi audit log đàng hoàng và HCNS phải duyệt lại". Admin/HR/
    has_perm tự sửa thì KHÔNG cần lặp lại bước duyệt (họ đã là cấp thẩm
    quyền cao nhất, tự duyệt chính mình là vô nghĩa).

    Giữ nguyên direct_manager_approved (chính QLTT sửa tức là đã tự xác
    nhận lại bước của mình rồi), chỉ reset bước HR — `d` bị mutate tại chỗ.
    Trả về True nếu đã reset (để caller ghi thêm dấu vết vào audit log).
    Dùng cho RegistrationRequestViewSet/OnlineWorkRequestViewSet/
    AttendanceExplanationViewSet.update() — KHÔNG dùng cho
    overtime_reconciliation (mục đích khác: sửa số liệu cho khớp chấm
    công thực tế, không phải sửa nội dung đơn)."""
    if d.get('status') != 'APPROVED':
        return False
    # CHỦ Ý (siết lại 2026-09-23 theo yêu cầu HCNS "QLTT mà edit gì là HCNS lại
    # phải duyệt lại hết"): chỉ Admin và HR thật sự mới được miễn bước duyệt
    # lại. Trước đây `has_perm` (EmployeePermission.can_approve_attendance)
    # cũng được miễn — hiện tại vô hại vì cả 2 người đang giữ quyền này đều
    # thuộc HCNS (is_hr=True), nhưng nếu sau này HCNS cấp quyền đó cho 1 QUẢN
    # LÝ thì người đó sẽ sửa được đơn đã duyệt mà HCNS không phải duyệt lại.
    # Vẫn nhận tham số has_perm để không phải sửa chữ ký ở 3 nơi gọi.
    if is_admin or is_hr_user or not is_management:
        return False
    d['status'] = 'PENDING'
    d['hr_approved'] = False
    d['hr_approved_at'] = None
    d['hr_approved_by_name'] = None
    d['hr_approved_by_id'] = None
    d['reapproval_reason'] = (
        f"Quản lý trực tiếp ({getattr(actor, 'full_name', '')}) đã sửa đơn sau khi đã duyệt "
        f"— cần HCNS duyệt lại."
    )
    return True


def soft_cancel_request(d, actor, reason=None):
    """Thu hồi (soft-delete) đơn của chính user thay vì xoá cứng — giữ lại đơn cũ
    làm log ai xoá/lúc nào, đơn biến mất khỏi hàng chờ duyệt vì status != PENDING/DRAFT.

    `d` là dict data hiện tại (đã copy), sẽ được mutate và trả về.
    """
    from django.utils import timezone as _tz

    now_str = _tz.now().isoformat()
    d['status'] = 'CANCELLED'
    d['is_deleted'] = True
    d['deleted_at'] = now_str
    d['deleted_by_id'] = getattr(actor, 'id', None)
    d['deleted_by_name'] = getattr(actor, 'full_name', None)
    if reason:
        d['cancel_reason'] = reason
    return d


def log_request_cancel(event, actor, old_data, reason=None, request=None):
    """Ghi 1 dòng EmployeeEventAuditLog cho MỖI lần huỷ đơn.

    Vì sao cần: trước 2026-10-09 việc huỷ đơn chỉ để lại dấu bên trong
    EmployeeEvent.data (is_deleted / deleted_by_id / deleted_by_name) — không
    query được, nên không trả lời được câu "ai đã huỷ những đơn nào tháng này".
    Dưới cơ chế phạt 500k thì huỷ đơn làm ngày đó thành "nghỉ không tạo đơn",
    tức có thể dịch chuyển tiền phạt giữa quản lý và nhân viên, nên HCNS
    yêu cầu "nhớ lưu đủ log" khi siết quyền xoá.

    Gọi SAU khi đã save event (cần event.pk). Lỗi ở đây KHÔNG được làm hỏng
    việc huỷ đơn — nhưng cũng không nuốt im: ghi vào logger để còn phát hiện
    được, và dấu trong `data` vẫn là bản lưu dự phòng.
    """
    try:
        from .event_models import EmployeeEventAuditLog
        old_data = old_data or {}
        new_data = event.data or {}
        changed = ["status"]
        if reason:
            changed.append("cancel_reason")
        user = getattr(actor, "user", None) or getattr(request, "user", None)
        if user is not None and not getattr(user, "is_authenticated", False):
            user = None
        role = "admin" if (user is not None and (user.is_staff or user.is_superuser)) \
            else ("hr" if _is_hr(actor) else "user")
        EmployeeEventAuditLog.objects.create(
            event=event,
            employee=event.employee,
            action=EmployeeEventAuditLog.Action.CANCEL,
            old_values={
                "status": old_data.get("status"),
                "direct_manager_approved": old_data.get("direct_manager_approved"),
                "hr_approved": old_data.get("hr_approved"),
                "registration_type": old_data.get("registration_type"),
                "explanation_type": old_data.get("explanation_type"),
            },
            new_values={
                "status": new_data.get("status"),
                "cancel_reason": new_data.get("cancel_reason"),
                "deleted_by_name": new_data.get("deleted_by_name"),
            },
            changed_fields=changed,
            performed_by_user=user,
            performed_by_employee=actor,
            performed_by_role=role,
            request_payload={"reason": reason} if reason else None,
        )
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).exception(
            "Khong ghi duoc audit log huy don event_id=%s", getattr(event, "pk", None)
        )


def _is_hr_or_admin_broad(user, employee) -> bool:
    """Kiểm tra "quyền quản trị rộng" (được xem dữ liệu chấm công của MỌI
    nhân viên) — gộp TẤT CẢ các cách hệ thống hiện đang dùng để coi 1 tài
    khoản là HR/Admin, rải rác ở nhiều nơi khác nhau (StaffOwnDataPermission
    ở hrm/views.py, AttendanceViewSet._get_user_roles, _is_hr ở trên) — để
    tránh 1 tài khoản được coi là "HR" ở chỗ này nhưng lại không được coi là
    "HR" ở chỗ khác, dẫn đến chặn nhầm người có quyền hợp lệ."""
    if not user:
        return False
    if getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False):
        return True
    try:
        from users.utils import get_user_role
        if get_user_role(user) in ('admin', 'hr'):
            return True
    except ImportError:
        pass
    if not employee:
        return False
    if _is_hr(employee):
        return True
    if employee.position and employee.position.title:
        t = employee.position.title.upper()
        if 'HR' in t or 'NHÂN SỰ' in t:
            return True
    if employee.department and employee.department.name:
        d = employee.department.name.upper()
        if 'HR' in d or 'NHÂN SỰ' in d:
            return True
    return _has_approve_permission(employee)


def can_view_employee_attendance(user, viewer_employee, target_employee) -> bool:
    """True nếu `user`/`viewer_employee` được phép xem dữ liệu chấm công
    (lịch, bảng công, phạt tiền...) của `target_employee`.

    Được phép nếu:
      1. Xem chính mình.
      2. Admin/HR (theo mọi định nghĩa hiện có — xem _is_hr_or_admin_broad).
      3. Là quản lý trực tiếp / quản lý cấp 2 / cấp 3 của target_employee
         (Employee.manager / manager_level_2 / manager_level_3).
      4. Là trưởng phòng (Department.manager) của phòng ban target_employee
         đang thuộc về.

    Dùng ở AttendanceCalendarView (hrm/attendance_views.py) và
    AttendanceViewSet.list() (hrm/views.py) — TRƯỚC đây 2 chỗ này thiếu hẳn
    hoặc chặn quá tay (chỉ Admin/HR mới xem được ai khác ngoài chính mình,
    quản lý trực tiếp không xem được cấp dưới) — xem lịch sử sửa đổi.
    """
    if not target_employee:
        return False
    if viewer_employee and viewer_employee.id == target_employee.id:
        return True
    if _is_hr_or_admin_broad(user, viewer_employee):
        return True
    if not viewer_employee:
        return False
    if target_employee.manager_id == viewer_employee.id:
        return True
    if getattr(target_employee, 'manager_level_2_id', None) == viewer_employee.id:
        return True
    if getattr(target_employee, 'manager_level_3_id', None) == viewer_employee.id:
        return True
    if target_employee.department_id and target_employee.department.manager_id == viewer_employee.id:
        return True
    return False


def get_auto_adjusted_workflow(employee, workflow):
    """Điều chỉnh workflow tự động dựa trên vai trò của người tạo đơn"""
    if not workflow:
        return None
    
    adjusted_order = list(workflow.approval_order)
    
    # TRƯỜNG HỢP 1: Người tạo đơn là Senior Manager (trưởng phòng/giám đốc)
    if is_senior_manager(employee):
        # Nếu workflow yêu cầu DEPARTMENT_HEAD và người tạo đơn là trưởng phòng/giám đốc
        # thì bỏ qua bước duyệt của DEPARTMENT_HEAD
        if 'DEPARTMENT_HEAD' in adjusted_order:
            adjusted_order.remove('DEPARTMENT_HEAD')
        
        # Nếu workflow yêu cầu DIRECT_MANAGER và người tạo đơn là senior manager
        # có thể cần xem xét bỏ qua DIRECT_MANAGER nếu không có quản lý trực tiếp
        # (giữ lại logic này để xử lý sau)

    # TRƯỜNG HỢP 2: Người tạo đơn là nhân viên HR
    if employee.is_hr:
        # Nếu là nhân viên HR, không cần bước HR duyệt lần 2 sau khi Manager đã duyệt
        # (Theo yêu cầu: Manager phê duyệt là Final)
        if 'HR' in adjusted_order:
            adjusted_order.remove('HR')
    
    return adjusted_order


# ======================
# BASE MODELS
# ======================

class ApprovalWorkflow(models.Model):
    """Quy trình duyệt chung cho các loại đơn"""
    name = models.CharField(max_length=255, verbose_name="Tên quy trình")
    code = models.CharField(max_length=64, unique=True, verbose_name="Mã quy trình")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    
    # Cấu hình quy trình
    requires_direct_manager = models.BooleanField(default=True, verbose_name="Yêu cầu duyệt quản lý trực tiếp")
    requires_department_head = models.BooleanField(default=False, verbose_name="Yêu cầu duyệt trưởng phòng")
    requires_hr = models.BooleanField(default=True, verbose_name="Yêu cầu duyệt nhân sự")
    requires_director = models.BooleanField(default=False, verbose_name="Yêu cầu duyệt giám đốc")
    
    # Thứ tự duyệt
    approval_order = models.JSONField(default=list, verbose_name="Thứ tự duyệt",
                                     help_text="Danh sách các cấp duyệt theo thứ tự")
    
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"{self.code} - {self.name}"
    
    class Meta:
        verbose_name = "Quy trình duyệt"
        verbose_name_plural = "Quy trình duyệt"
        ordering = ['code']
    
    def save(self, *args, **kwargs):
        """Tự động tạo approval_order nếu chưa có"""
        if not self.approval_order:
            order = []
            if self.requires_direct_manager:
                order.append('DIRECT_MANAGER')
            if self.requires_department_head:
                order.append('DEPARTMENT_HEAD')
            if self.requires_hr:
                order.append('HR')
            if self.requires_director:
                order.append('DIRECTOR')
            self.approval_order = order
        super().save(*args, **kwargs)


class BaseRequest(models.Model):
    """Model cơ sở cho các loại đơn/request"""
    request_code = models.CharField(max_length=64, unique=True, null=True, blank=True, verbose_name="Mã đơn")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='%(class)s_requests',
                                verbose_name="Nhân viên")
    workflow = models.ForeignKey(ApprovalWorkflow, on_delete=models.SET_NULL, null=True, blank=True,
                                verbose_name="Quy trình duyệt")
    
    # Trạng thái
    status = models.CharField(max_length=20, choices=REQUEST_STATUS, default='DRAFT', verbose_name="Trạng thái")
    current_approval_level = models.CharField(max_length=20, choices=APPROVAL_LEVEL, blank=True,
                                             verbose_name="Cấp duyệt hiện tại")
    
    # Thông tin chung
    reason = models.TextField(verbose_name="Lý do")
    start_date = models.DateField(verbose_name="Ngày bắt đầu")
    end_date = models.DateField(null=True, blank=True, verbose_name="Ngày kết thúc")
    total_days = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Tổng số ngày")
    
    # File đính kèm
    attachment = models.FileField(upload_to='hrm/attachments/', blank=True, null=True, verbose_name="File đính kèm")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    submitted_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm gửi")
    approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm duyệt")
    rejected_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm từ chối")
    
    class Meta:
        abstract = True
        ordering = ['-created_at']
    
    def clean(self):
        """Validate date range"""
        if self.start_date and self.end_date:
            if self.end_date < self.start_date:
                raise ValidationError("Ngày kết thúc phải sau ngày bắt đầu")
    
    def save(self, *args, **kwargs):
        """Tự động tính total_days và tạo request_code"""
        if self.start_date and self.end_date:
            delta = self.end_date - self.start_date
            self.total_days = delta.days + 1  # Bao gồm cả ngày bắt đầu
        
        if not self.request_code:
            # Tạo mã tự động dựa trên loại request
            self.request_code = self._generate_request_code()
        
        super().save(*args, **kwargs)
    
    def _generate_request_code(self):
        """Tạo mã đơn duy nhất theo cấu trúc riêng cho từng loại"""
        from django.db.models import Max
        import uuid
        
        # Xác định prefix theo loại đơn
        model_name = self.__class__.__name__
        if model_name == 'LeaveRequest':
            prefix = 'LEAVE'
            # Tìm số thứ tự cao nhất cho LEAVE
            last_code = LeaveRequest.objects.filter(
                request_code__startswith='LEAVE-'
            ).aggregate(Max('request_code'))['request_code__max']
        elif model_name == 'OvertimeRequest':
            prefix = 'OT'
            # Tìm số thứ tự cao nhất cho OT
            last_code = OvertimeRequest.objects.filter(
                request_code__startswith='OT-'
            ).aggregate(Max('request_code'))['request_code__max']
        elif model_name == 'AttendanceExplanation':
            prefix = 'ATT-EXPL'
            # Tìm số thứ tự cao nhất cho ATT-EXPL
            last_code = AttendanceExplanation.objects.filter(
                request_code__startswith='ATT-EXPL-'
            ).aggregate(Max('request_code'))['request_code__max']
        else:
            prefix = 'REQ'
            last_code = None
        
        # Xác định số thứ tự tiếp theo
        if last_code:
            try:
                # Trích xuất số từ mã cuối cùng: PREFIX-YYYYMM-XXXX
                parts = last_code.split('-')
                if len(parts) >= 3:
                    # Định dạng: PREFIX-YYYYMM-NNNN
                    last_num = int(parts[-1])
                    next_num = last_num + 1
                else:
                    # Định dạng cũ: PREFIX-TIMESTAMP
                    next_num = 1
            except (ValueError, IndexError):
                next_num = 1
        else:
            next_num = 1
        
        # Tạo mã mới: PREFIX-YYYYMM-NNNN
        year_month = timezone.now().strftime('%Y%m')
        return f"{prefix}-{year_month}-{next_num:04d}"
    
    def submit_for_approval(self):
        """Gửi đơn để duyệt"""
        if self.status == 'DRAFT':
            self.status = 'PENDING'
            self.submitted_at = timezone.now()
            
            # Xác định cấp duyệt đầu tiên
            if self.workflow and self.workflow.approval_order:
                # Kiểm tra nếu người tạo đơn là senior manager (trưởng phòng/giám đốc)
                if is_senior_manager(self.employee):
                    # Điều chỉnh workflow để bỏ qua các bước không cần thiết
                    adjusted_order = get_auto_adjusted_workflow(self.employee, self.workflow)
                    
                    # Nếu có adjusted_order, sử dụng nó
                    if adjusted_order:
                        # Tìm cấp duyệt đầu tiên phù hợp
                        for level in adjusted_order:
                            # Bỏ qua DEPARTMENT_HEAD nếu người tạo đơn là trưởng phòng
                            if level == 'DEPARTMENT_HEAD' and is_department_head(self.employee):
                                continue
                            # Bỏ qua DIRECT_MANAGER nếu không có quản lý trực tiếp
                            if level == 'DIRECT_MANAGER' and not self.employee.manager:
                                continue
                            
                            self.current_approval_level = level
                            break
                    else:
                        self.current_approval_level = self.workflow.approval_order[0]
                else:
                    self.current_approval_level = self.workflow.approval_order[0]
            
            self.save()
            return True
        return False
    
    def get_next_approver(self):
        """Xác định người duyệt tiếp theo"""
        if not self.workflow or not self.current_approval_level:
            return None
        
        try:
            current_index = self.workflow.approval_order.index(self.current_approval_level)
            if current_index + 1 < len(self.workflow.approval_order):
                next_level = self.workflow.approval_order[current_index + 1]
                return self.get_approver_by_level(next_level)
        except (ValueError, IndexError):
            pass
        return None
    
    def get_approver_by_level(self, level):
        """Lấy người duyệt dựa trên cấp độ"""
        # Kiểm tra nếu người tạo đơn là senior manager
        if is_senior_manager(self.employee):
            # Nếu là trưởng phòng/giám đốc, xử lý đặc biệt
            if level == 'DIRECT_MANAGER':
                # Nếu là trưởng phòng/giám đốc, có thể không có quản lý trực tiếp
                # hoặc quản lý trực tiếp là cấp cao hơn
                if self.employee.manager:
                    return self.employee.manager
                else:
                    # Nếu không có quản lý trực tiếp, chuyển thẳng đến HR
                    return None  # Sẽ được xử lý trong logic workflow
            elif level == 'DEPARTMENT_HEAD':
                # Nếu người tạo đơn là trưởng phòng, bỏ qua bước này
                if is_department_head(self.employee):
                    return None  # Bỏ qua, chuyển đến cấp tiếp theo
                elif self.employee.department and self.employee.department.manager:
                    return self.employee.department.manager
        
        # Logic bình thường
        if level == 'DIRECT_MANAGER':
            return self.employee.manager
        elif level == 'DEPARTMENT_HEAD':
            if self.employee.department and self.employee.department.manager:
                return self.employee.department.manager
        elif level == 'HR':
            # Tìm nhân viên HR trong cùng phòng ban hoặc toàn công ty
            # Ưu tiên HR trong cùng phòng ban
            if self.employee.department:
                hr_in_department = Employee.objects.filter(
                    department=self.employee.department,
                    position__title__icontains='nhân sự'
                ).first()
                if hr_in_department:
                    return hr_in_department
            
            # Nếu không có HR trong phòng ban, tìm HR bất kỳ
            return Employee.objects.filter(
                position__title__icontains='nhân sự'
            ).first()
        elif level == 'DIRECTOR':
            # Tìm giám đốc
            return Employee.objects.filter(
                position__title__icontains='giám đốc'
            ).first()
        return None


# ======================
# MAIN MODELS
# ======================

class LeaveRequest(BaseRequest):
    """Đơn xin nghỉ phép"""
    leave_type = models.CharField(max_length=20, choices=LEAVE_TYPE, verbose_name="Loại nghỉ phép")
    is_half_day = models.BooleanField(default=False, verbose_name="Nghỉ nửa ngày")
    half_day_period = models.CharField(max_length=10, choices=[('MORNING', 'Buổi sáng'), ('AFTERNOON', 'Buổi chiều')],
                                      blank=True, verbose_name="Buổi nghỉ")
    
    # Thông tin bổ sung cho nghỉ ốm
    medical_certificate = models.FileField(upload_to='hrm/medical_certificates/', blank=True, null=True,
                                          verbose_name="Giấy khám bệnh")
    doctor_name = models.CharField(max_length=255, blank=True, verbose_name="Tên bác sĩ")
    hospital_name = models.CharField(max_length=255, blank=True, verbose_name="Tên bệnh viện")
    
    # Thông tin bổ sung cho nghỉ thai sản
    expected_delivery_date = models.DateField(null=True, blank=True, verbose_name="Ngày dự sinh")
    child_birth_date = models.DateField(null=True, blank=True, verbose_name="Ngày sinh con")
    
    def __str__(self):
        return f"Đơn nghỉ phép {self.request_code} - {self.employee.full_name}"
    
    class Meta:
        verbose_name = "Đơn xin nghỉ phép"
        verbose_name_plural = "Đơn xin nghỉ phép"
    
    def save(self, *args, **kwargs):
        """Điều chỉnh total_days cho nghỉ nửa ngày và đồng bộ EmployeeEvent"""
        if self.is_half_day:
            self.total_days = 0.5

        # Phát hiện thay đổi trạng thái trước khi lưu
        old_status = None
        if self.pk:
            old_status = (
                LeaveRequest.objects.filter(pk=self.pk)
                .values_list('status', flat=True)
                .first()
            )

        super().save(*args, **kwargs)

        # Đồng bộ EmployeeEvent khi trạng thái thay đổi
        if old_status != self.status:
            self._sync_employee_events(old_status)

    def _sync_employee_events(self, old_status):
        """
        Tạo EmployeeEvent(leave_request) cho từng ngày khi đơn được duyệt (APPROVED).
        Xoá các EmployeeEvent đó khi đơn không còn ở trạng thái APPROVED.

        Convention data:
          {
            "leave_request_id": <int>,
            "leave_type":       "PAID" | "UNPAID",   # dùng cho rule engine
            "original_leave_type": "ANNUAL" | "SICK" | ...,
            "reason":           <str>,
            "is_half_day":      <bool>,
            "half_day_period":  "MORNING" | "AFTERNOON" | "",
          }
        """
        import datetime as _dt
        import logging as _logging
        _logger = _logging.getLogger(__name__)

        from hrm.event_models import EmployeeEvent

        # Xoá EmployeeEvent cũ nếu trước đó là APPROVED
        if old_status == 'APPROVED':
            EmployeeEvent.objects.filter(
                employee=self.employee,
                event_type=EmployeeEvent.EventType.LEAVE_REQUEST,
                data__leave_request_id=self.id,
            ).delete()

        # Tạo mới khi chuyển sang APPROVED
        if self.status == 'APPROVED':
            end_date = self.end_date or self.start_date
            engine_leave_type = "UNPAID" if self.leave_type == "UNPAID" else "PAID"
            event_data = {
                'leave_request_id': self.id,
                'leave_type': engine_leave_type,
                'original_leave_type': self.leave_type,
                'reason': self.reason or '',
                'is_half_day': self.is_half_day,
                'half_day_period': self.half_day_period or '',
            }
            cur = self.start_date
            while cur <= end_date:
                # Tránh tạo trùng nếu đã tồn tại event cho ngày này từ đơn này
                if not EmployeeEvent.objects.filter(
                    employee=self.employee,
                    event_date=cur,
                    event_type=EmployeeEvent.EventType.LEAVE_REQUEST,
                    data__leave_request_id=self.id,
                ).exists():
                    EmployeeEvent.objects.create(
                        employee=self.employee,
                        event_date=cur,
                        event_type=EmployeeEvent.EventType.LEAVE_REQUEST,
                        data={**event_data, 'date': cur.isoformat()},
                        notes=self.reason or '',
                    )
                    _logger.info(
                        "[LeaveRequest] Tạo EmployeeEvent leave_request cho %s ngày %s (leave_id=%s)",
                        self.employee, cur, self.id,
                    )
                cur += _dt.timedelta(days=1)


class OvertimeRequest(BaseRequest):
    """Đơn xin bổ sung công/OT"""
    overtime_type = models.CharField(max_length=20, choices=OVERTIME_TYPE, verbose_name="Loại OT")
    
    # Thời gian làm thêm
    start_time = models.TimeField(verbose_name="Giờ bắt đầu")
    end_time = models.TimeField(verbose_name="Giờ kết thúc")
    total_hours = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Tổng số giờ")
    
    # Tỷ lệ tính lương
    multiplier = models.DecimalField(max_digits=3, decimal_places=2, default=1.5, verbose_name="Hệ số lương")
    
    # Công việc cụ thể
    task_description = models.TextField(verbose_name="Mô tả công việc")
    expected_output = models.TextField(blank=True, verbose_name="Kết quả mong đợi")
    
    def __str__(self):
        return f"Đơn OT {self.request_code} - {self.employee.full_name}"
    
    class Meta:
        verbose_name = "Đơn xin làm thêm giờ"
        verbose_name_plural = "Đơn xin làm thêm giờ"
    
    def clean(self):
        """Validate time range"""
        super().clean()
        if self.start_time and self.end_time:
            if self.end_time <= self.start_time:
                raise ValidationError("Giờ kết thúc phải sau giờ bắt đầu")
    
    def save(self, *args, **kwargs):
        """Tính total_hours"""
        if self.start_time and self.end_time:
            # Chuyển đổi thời gian thành giờ
            from datetime import datetime
            start_dt = datetime.combine(self.start_date, self.start_time)
            end_dt = datetime.combine(self.start_date, self.end_time)
            
            # Nếu end_time < start_time, có thể qua ngày hôm sau
            if self.end_time <= self.start_time:
                end_dt = datetime.combine(self.start_date + timezone.timedelta(days=1), self.end_time)
            
            delta = end_dt - start_dt
            self.total_hours = delta.total_seconds() / 3600  # Chuyển sang giờ
        
        super().save(*args, **kwargs)


class AttendanceExplanation(BaseRequest):
    """Giải trình chấm công"""
    # Thông tin chấm công cần giải trình
    attendance_date = models.DateField(verbose_name="Ngày chấm công")
    original_status = models.CharField(max_length=25, choices=ATTENDANCE_STATUS, verbose_name="Trạng thái ban đầu")
    expected_status = models.CharField(max_length=25, choices=ATTENDANCE_STATUS, verbose_name="Trạng thái mong muốn")
    
    # Bằng chứng
    evidence = models.FileField(upload_to='hrm/attendance_evidence/', blank=True, null=True,
                               verbose_name="Bằng chứng")
    
    # Thông tin thời gian cụ thể
    actual_check_in = models.TimeField(null=True, blank=True, verbose_name="Giờ vào thực tế")
    actual_check_out = models.TimeField(null=True, blank=True, verbose_name="Giờ ra thực tế")
    expected_check_in = models.TimeField(null=True, blank=True, verbose_name="Giờ vào dự kiến")
    expected_check_out = models.TimeField(null=True, blank=True, verbose_name="Giờ ra dự kiến")
    
    # Kết quả duyệt (giữ lại từ cũ)
    approval_decision = models.CharField(max_length=20, choices=[
        ('APPROVED', 'Chấp nhận'),
        ('REJECTED', 'Từ chối'),
        ('ADJUSTED', 'Điều chỉnh'),
    ], blank=True, verbose_name="Quyết định duyệt")
    approved_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='approved_explanations', verbose_name="Người duyệt")
    
    # Approval tracking by level
    direct_manager_approved = models.BooleanField(default=False, verbose_name="Quản lý trực tiếp đã duyệt")
    hr_approved = models.BooleanField(default=False, verbose_name="HR đã duyệt")
    
    direct_manager_approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm quản lý duyệt")
    hr_approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm HR duyệt")
    
    direct_manager_approved_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                                  related_name='direct_manager_approved_explanations',
                                                  verbose_name="Quản lý trực tiếp duyệt")
    hr_approved_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                      related_name='hr_approved_explanations',
                                      verbose_name="HR duyệt")
    
    def __str__(self):
        return f"Giải trình {self.request_code} - {self.employee.full_name}"
    
    class Meta:
        verbose_name = "Giải trình chấm công"
        verbose_name_plural = "Giải trình chấm công"
        ordering = ['-attendance_date', '-created_at']
    
    def save(self, *args, **kwargs):
        """Ghi đè save để đảm bảo start_date và end_date được set từ attendance_date"""
        if self.attendance_date and not self.start_date:
            self.start_date = self.attendance_date
            self.end_date = self.attendance_date
        
        # Gọi save của BaseRequest
        super().save(*args, **kwargs)
    
    def submit_for_approval(self):
        """Gửi giải trình để duyệt - ghi đè để sử dụng workflow"""
        if self.status == 'DRAFT':
            self.status = 'PENDING'
            self.submitted_at = timezone.now()
            
            # Xác định cấp duyệt đầu tiên từ workflow
            if self.workflow and self.workflow.approval_order:
                self.current_approval_level = self.workflow.approval_order[0]
            
            self.save()
            return True
        return False

    def can_approve(self, approver):
        """Kiểm tra xem người này có quyền duyệt giải trình không (sử dụng workflow)"""
        # Người tạo đơn không thể duyệt đơn của chính mình
        if approver == self.employee:
            return False, "Người tạo đơn không thể duyệt đơn của chính mình"
        
        # Kiểm tra nếu đã được duyệt hoàn thành
        if self.status == 'APPROVED' or self.status == 'REJECTED':
            return False, "Giải trình đã được xử lý hoàn thành"
        
        # Nếu không có workflow, sử dụng logic cũ
        if not self.workflow:
            return self._can_approve_without_workflow(approver)
        
        # Kiểm tra xem người duyệt có trong workflow không
        # 1. Xác định cấp duyệt của người này
        approver_level = self._get_approver_level(approver)
        if not approver_level:
            return False, "Không có quyền duyệt giải trình này"
        
        # 2. Kiểm tra xem cấp duyệt này có trong workflow không
        if approver_level not in self.workflow.approval_order:
            return False, f"Cấp duyệt {approver_level} không có trong workflow"
        
        # 3. Kiểm tra xem đã đến lượt duyệt của cấp này chưa
        if not self._is_approver_turn(approver_level):
            return False, f"Chưa đến lượt duyệt của cấp {approver_level}"
        
        # 4. Kiểm tra xem cấp này đã duyệt chưa
        if self._has_approver_already_approved(approver_level):
            return False, f"Cấp {approver_level} đã duyệt rồi"
        
        # 5. Xử lý đặc biệt cho trường hợp người tạo đơn là senior manager
        if is_senior_manager(self.employee):
            # Nếu người tạo đơn là trưởng phòng/giám đốc, xử lý đặc biệt
            if approver_level == 'DEPARTMENT_HEAD' and is_department_head(self.employee):
                # Nếu người duyệt là trưởng phòng và người tạo đơn cũng là trưởng phòng
                # (có thể là cùng một người hoặc trưởng phòng khác)
                if approver == self.employee:
                    return False, "Người tạo đơn không thể duyệt đơn của chính mình"
                # Nếu người duyệt là trưởng phòng khác, có thể duyệt
                # (trong trường hợp công ty có nhiều trưởng phòng)
            
            # Nếu người tạo đơn là giám đốc, có thể cần xử lý đặc biệt
            if approver_level == 'DIRECT_MANAGER' and is_director(self.employee):
                # Giám đốc có thể không có quản lý trực tiếp
                # Nếu không có quản lý trực tiếp, bỏ qua bước này
                if not self.employee.manager:
                    return False, "Giám đốc không có quản lý trực tiếp để duyệt"
        
        return True, f"Cấp duyệt: {approver_level}"
    
    def _get_approver_level(self, approver):
        """Xác định cấp duyệt của người duyệt"""
        if approver == self.employee.manager:
            return 'DIRECT_MANAGER'
        elif self.employee.department and self.employee.department.manager and approver == self.employee.department.manager:
            return 'DEPARTMENT_HEAD'
        elif approver.position and ('HR' in approver.position.title.upper() or 'NHÂN SỰ' in approver.position.title.upper()):
            return 'HR'
        elif approver.user and (approver.user.is_staff or approver.user.is_superuser):
            return 'ADMIN'
        
        # Check if approver has can_approve_attendance permission
        try:
            from .models import EmployeePermission
            permission = EmployeePermission.objects.get(employee=approver)
            if permission.can_approve_attendance:
                return 'HR'  # Người có quyền phê duyệt công được coi là HR
        except EmployeePermission.DoesNotExist:
            pass
        
        return None
    
    def _is_approver_turn(self, approver_level):
        """Kiểm tra xem đã đến lượt duyệt của cấp này chưa"""
        if not self.workflow or not self.current_approval_level:
            return False
        
        # Tìm vị trí của cấp duyệt hiện tại và cấp muốn duyệt
        try:
            current_index = self.workflow.approval_order.index(self.current_approval_level)
            approver_index = self.workflow.approval_order.index(approver_level)
            
            # Cấp duyệt có thể duyệt nếu là cấp hiện tại hoặc cấp trước đó đã duyệt xong
            # (cho phép duyệt lại nếu cần)
            return approver_index <= current_index
        except ValueError:
            return False
    
    def _has_approver_already_approved(self, approver_level):
        """Kiểm tra xem cấp này đã duyệt chưa"""
        from .models import ApprovalRecord
        return ApprovalRecord.objects.filter(
            request_type='AttendanceExplanation',
            request_id=self.id,
            approval_level=approver_level,
            action='APPROVE'
        ).exists()
    
    def _can_approve_without_workflow(self, approver):
        """Logic duyệt cũ khi không có workflow"""
        # 1. Quản lý trực tiếp có thể duyệt (chỉ khi chưa có ai duyệt)
        if self.employee.manager and approver == self.employee.manager:
            # Kiểm tra xem đã có quản lý trực tiếp duyệt chưa
            from .models import ApprovalRecord
            manager_approval = ApprovalRecord.objects.filter(
                request_type='AttendanceExplanation',
                request_id=self.id,
                approval_level='DIRECT_MANAGER',
                action='APPROVE'
            ).exists()
            
            if not manager_approval:
                return True, "Quản lý trực tiếp (duyệt lần đầu)"
            else:
                return False, "Quản lý trực tiếp đã duyệt rồi"
        
        # 2. HR có thể duyệt (kiểm tra vị trí có chứa 'HR' hoặc 'nhân sự')
        if approver.position and ('HR' in approver.position.title.upper() or 'NHÂN SỰ' in approver.position.title.upper()):
            # HR chỉ có thể duyệt sau khi quản lý trực tiếp đã duyệt
            # Kiểm tra xem có bản ghi duyệt nào từ quản lý trực tiếp chưa
            from .models import ApprovalRecord
            manager_approval = ApprovalRecord.objects.filter(
                request_type='AttendanceExplanation',
                request_id=self.id,
                approval_level='DIRECT_MANAGER',
                action='APPROVE'
            ).exists()
            
            if manager_approval:
                # Kiểm tra xem HR đã duyệt chưa
                hr_approval = ApprovalRecord.objects.filter(
                    request_type='AttendanceExplanation',
                    request_id=self.id,
                    approval_level='HR',
                    action='APPROVE'
                ).exists()
                
                if not hr_approval:
                    return True, "HR (duyệt cuối cùng)"
                else:
                    return False, "HR đã duyệt rồi"
            else:
                return False, "HR chỉ có thể duyệt sau khi quản lý trực tiếp đã duyệt"
        
        # 3. Trưởng phòng có thể duyệt (nếu có và chưa duyệt)
        if self.employee.department and self.employee.department.manager and approver == self.employee.department.manager:
            # Kiểm tra xem trưởng phòng đã duyệt chưa
            from .models import ApprovalRecord
            dept_head_approval = ApprovalRecord.objects.filter(
                request_type='AttendanceExplanation',
                request_id=self.id,
                approval_level='DEPARTMENT_HEAD',
                action='APPROVE'
            ).exists()
            
            if not dept_head_approval:
                return True, "Trưởng phòng"
            else:
                return False, "Trưởng phòng đã duyệt rồi"
        
        # 4. Admin/Quản trị viên có thể duyệt bất kỳ lúc nào
        if approver.user and (approver.user.is_staff or approver.user.is_superuser):
            return True, "Quản trị viên"
        
        # 5. Người có quyền can_approve_attendance có thể duyệt bất kỳ lúc nào
        try:
            from .models import EmployeePermission
            permission = EmployeePermission.objects.get(employee=approver)
            if permission.can_approve_attendance:
                return True, "Người có quyền phê duyệt công"
        except EmployeePermission.DoesNotExist:
            pass
        
        return False, "Không có quyền duyệt giải trình này"
    
    def _is_workflow_completed(self):
        """Kiểm tra xem workflow đã hoàn thành chưa"""
        if not self.workflow:
            return False
        
        from .models import ApprovalRecord
        
        # Kiểm tra xem tất cả các cấp trong workflow đã duyệt chưa
        for level in self.workflow.approval_order:
            has_approval = ApprovalRecord.objects.filter(
                request_type='AttendanceExplanation',
                request_id=self.id,
                approval_level=level,
                action='APPROVE'
            ).exists()
            
            if not has_approval:
                return False
        
        return True
    
    def _get_next_approval_level(self):
        """Lấy cấp duyệt tiếp theo trong workflow"""
        if not self.workflow or not self.current_approval_level:
            return None
        
        try:
            current_index = self.workflow.approval_order.index(self.current_approval_level)
            if current_index + 1 < len(self.workflow.approval_order):
                return self.workflow.approval_order[current_index + 1]
        except ValueError:
            pass
        
        return None

    def approve(self, approver, approval_note=''):
        """Duyệt giải trình (sử dụng workflow)"""
        can_approve, message = self.can_approve(approver)
        if not can_approve:
            return False, message
        
        # Xác định cấp duyệt
        approval_level = self._get_approver_level(approver)
        if not approval_level:
            return False, "Không thể xác định cấp duyệt"
        
        # Xử lý đặc biệt cho trường hợp người tạo đơn là senior manager
        if is_senior_manager(self.employee):
            # Nếu người tạo đơn là trưởng phòng/giám đốc
            if approval_level == 'DEPARTMENT_HEAD' and is_department_head(self.employee):
                # Nếu người duyệt là trưởng phòng và người tạo đơn cũng là trưởng phòng
                # Có thể bỏ qua bước này nếu cần
                # Trong trường hợp này, vẫn tạo bản ghi duyệt nhưng có thể xử lý đặc biệt
                pass
            
            # Nếu người tạo đơn là giám đốc và không có quản lý trực tiếp
            if approval_level == 'DIRECT_MANAGER' and is_director(self.employee) and not self.employee.manager:
                # Giám đốc không có quản lý trực tiếp, có thể bỏ qua bước này
                # Chuyển thẳng đến cấp tiếp theo
                # Tạo bản ghi duyệt ảo (hoặc bỏ qua)
                pass
        
        # Tạo bản ghi duyệt
        from .models import ApprovalRecord
        ApprovalRecord.create_record(
            request=self,
            approver=approver,
            level=approval_level,
            action='APPROVE',
            note=approval_note
        )
        
        # Kiểm tra xem đã hoàn thành workflow chưa
        if self._is_workflow_completed():
            # Hoàn thành duyệt
            self.status = 'APPROVED'
            self.approval_decision = 'APPROVED'
            self.approval_note = approval_note
            self.approved_by = approver
            self.approved_at = timezone.now()
            self.save()
            return True, "Duyệt hoàn thành"
        else:
            # Chuyển đến cấp duyệt tiếp theo
            next_level = self._get_next_approval_level()
            if next_level:
                self.current_approval_level = next_level
                self.save()
                return True, f"Đã duyệt ở cấp {approval_level}, chuyển đến cấp {next_level}"
            else:
                # Vẫn giữ nguyên cấp hiện tại
                return True, f"Đã duyệt ở cấp {approval_level}"

    def reject(self, approver, approval_note=''):
        """Từ chối giải trình"""
        can_approve, message = self.can_approve(approver)
        if not can_approve:
            return False, message
        
        # Xác định cấp duyệt
        approval_level = 'DIRECT_MANAGER'
        if approver == self.employee.manager:
            approval_level = 'DIRECT_MANAGER'
        elif self.employee.department and self.employee.department.manager and approver == self.employee.department.manager:
            approval_level = 'DEPARTMENT_HEAD'
        elif approver.position and ('HR' in approver.position.title.upper() or 'NHÂN SỰ' in approver.position.title.upper()):
            approval_level = 'HR'
        elif approver.user and (approver.user.is_staff or approver.user.is_superuser):
            approval_level = 'ADMIN'
        
        # Từ chối là kết thúc ngay, không cần chờ cấp khác
        self.status = 'REJECTED'
        self.approval_decision = 'REJECTED'
        self.approval_note = approval_note
        self.approved_by = approver
        self.approved_at = timezone.now()
        self.save()
        
        # Tạo bản ghi từ chối
        from .models import ApprovalRecord
        ApprovalRecord.create_record(
            request=self,
            approver=approver,
            level=approval_level,
            action='REJECT',
            note=approval_note
        )
        
        return True, "Từ chối thành công"


# ======================
# GENERIC REQUEST (Đơn từ tổng hợp)
# ======================

GENERIC_REQUEST_TYPE = [
    ('RESIGNATION', 'Đơn xin nghỉ việc'),
    ('SALARY_ADVANCE', 'Đơn tạm ứng lương'),
    ('PROPOSAL', 'Đơn đề xuất'),
    ('CONFIRMATION', 'Đơn xác nhận'),
    ('COMPLAINT', 'Đơn khiếu nại / phản ánh'),
    ('OTHER', 'Đơn khác'),
]

# Status flow riêng cho GenericRequest: NV → Manager → Admin
GENERIC_REQUEST_STATUS = [
    ('DRAFT', 'Nháp'),
    ('PENDING_MANAGER', 'Chờ Quản lý duyệt'),
    ('PENDING_ADMIN', 'Chờ HCNS duyệt'),
    ('APPROVED', 'Đã duyệt'),
    ('REJECTED', 'Từ chối'),
    ('CANCELLED', 'Đã huỷ'),
]


class GenericRequest(BaseRequest):
    """
    Đơn từ tổng hợp - dùng cho các loại đơn chung ngoài chấm công.
    Mở rộng bằng cách thêm vào GENERIC_REQUEST_TYPE + tuỳ schema trong extra_data.

    Workflow phê duyệt: NV → Manager → Admin
    """
    # Override status từ BaseRequest để dùng GENERIC_REQUEST_STATUS riêng
    status = models.CharField(
        max_length=20,
        choices=GENERIC_REQUEST_STATUS,
        default='DRAFT',
        verbose_name="Trạng thái"
    )

    request_type = models.CharField(
        max_length=30, choices=GENERIC_REQUEST_TYPE,
        verbose_name="Loại đơn"
    )
    title = models.CharField(max_length=255, verbose_name="Tiêu đề")
    expected_date = models.DateField(
        null=True, blank=True,
        verbose_name="Ngày dự kiến (vd: ngày nghỉ việc)"
    )
    extra_data = models.JSONField(
        default=dict, blank=True,
        verbose_name="Dữ liệu mở rộng theo từng loại đơn"
    )

    # Approval tracking — Manager (cấp 1) và Admin (cấp 2 cuối)
    manager_approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Manager duyệt lúc")
    manager_approved_by = models.ForeignKey(
        Employee, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='manager_approved_generic_requests',
        verbose_name="Manager đã duyệt"
    )
    admin_approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Admin duyệt lúc")
    admin_approved_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='admin_approved_generic_requests',
        verbose_name="Admin đã duyệt"
    )
    rejected_level = models.CharField(
        max_length=20, blank=True, null=True,
        verbose_name="Cấp từ chối (MANAGER hoặc ADMIN)"
    )
    approval_note = models.TextField(blank=True, default='', verbose_name="Ghi chú phê duyệt")

    # Soft delete — Admin có thể xoá đơn ở mọi trạng thái nhưng không mất dữ liệu
    is_deleted = models.BooleanField(default=False, verbose_name="Đã xoá")
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm xoá")
    deleted_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='deleted_generic_requests',
        verbose_name="Người xoá"
    )

    REQUEST_PREFIX_MAP = {
        'RESIGNATION': 'RES',
        'SALARY_ADVANCE': 'ADV',
        'PROPOSAL': 'PRO',
        'CONFIRMATION': 'CON',
        'COMPLAINT': 'CMP',
        'OTHER': 'GEN',
    }

    class Meta:
        verbose_name = "Đơn từ tổng hợp"
        verbose_name_plural = "Đơn từ tổng hợp"
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        # GenericRequest không bắt buộc start/end_date — gán mặc định để pass NOT NULL
        if not self.start_date:
            self.start_date = self.expected_date or timezone.now().date()
        super().save(*args, **kwargs)

    def _generate_request_code(self):
        """Override để tạo mã theo request_type, vd: RES-202604-0001"""
        from django.db.models import Max
        prefix = self.REQUEST_PREFIX_MAP.get(self.request_type, 'GEN')
        last_code = GenericRequest.objects.filter(
            request_type=self.request_type,
            request_code__startswith=f'{prefix}-'
        ).aggregate(Max('request_code'))['request_code__max']

        if last_code:
            try:
                parts = last_code.split('-')
                next_num = int(parts[-1]) + 1
            except (ValueError, IndexError):
                next_num = 1
        else:
            next_num = 1

        year_month = timezone.now().strftime('%Y%m')
        return f"{prefix}-{year_month}-{next_num:04d}"


class SalaryAdvanceApprovalLock(models.Model):
    """
    Công tắc khoá/mở khoá rule "đơn tạm ứng lương (SALARY_ADVANCE) chỉ được
    duyệt trong 3 ngày đầu tháng". Khi is_locked=False, Quản lý trực tiếp/HCNS
    có thể duyệt (manager_approve/admin_approve) ngoài khung ngày 1-3.
    Chỉ Admin được bật/tắt (xem GenericRequestViewSet.approval_lock).
    """
    is_locked = models.BooleanField(default=True, verbose_name="Khoá duyệt ngoài ngày 1-3")
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='salary_advance_locks_updated',
        verbose_name="Người cập nhật",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Khoá duyệt tạm ứng lương"
        verbose_name_plural = "Khoá duyệt tạm ứng lương"

    def __str__(self):
        return "Đã khoá" if self.is_locked else "Đã mở khoá"

    @classmethod
    def get_solo(cls):
        setting = cls.objects.first()
        if setting:
            return setting
        return cls.objects.create()


class SalaryAdvanceCreationLock(models.Model):
    """
    Công tắc khoá/mở khoá rule "đơn tạm ứng lương (SALARY_ADVANCE) chỉ được
    TẠO trong 3 ngày đầu tháng" (khác SalaryAdvanceApprovalLock — cái đó
    khoá phía DUYỆT). Khi mở khoá (is_locked=False), nhân viên tạo được đơn
    kể cả đã qua ngày 3. Chỉ Admin được bật/tắt (xem
    GenericRequestViewSet.creation_lock).

    Mở khoá chỉ có hiệu lực cho phần còn lại của THÁNG lúc bấm mở — sang
    tháng mới tự động coi như đã khoá lại (is_effectively_locked()), không
    cần Admin nhớ khoá tay lại mỗi tháng — tránh trường hợp quên khoá làm hở
    rule cho các tháng sau. Muốn mở lại cho tháng mới thì bấm mở khoá lại.
    """
    is_locked = models.BooleanField(default=True, verbose_name="Khoá tạo đơn ngoài ngày 1-3")
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='salary_advance_creation_locks_updated',
        verbose_name="Người cập nhật",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Khoá tạo đơn tạm ứng lương"
        verbose_name_plural = "Khoá tạo đơn tạm ứng lương"

    def __str__(self):
        return "Đã khoá" if self.is_locked else "Đã mở khoá"

    @classmethod
    def get_solo(cls):
        setting = cls.objects.first()
        if setting:
            return setting
        return cls.objects.create()

    def is_effectively_locked(self) -> bool:
        """True nếu rule ngày 1-3 đang được áp (chặn tạo đơn ngoài ngày 1-3).
        is_locked=True -> luôn khoá. is_locked=False (Admin đã mở) chỉ có
        hiệu lực trong THÁNG lúc mở (so theo updated_at) — sang tháng khác
        tự động coi như đã khoá lại, dù DB vẫn lưu is_locked=False cho tới
        khi Admin tương tác lại."""
        if self.is_locked:
            return True
        now = timezone.now()
        return not (self.updated_at.year == now.year and self.updated_at.month == now.month)


def request_template_upload_path(instance, filename):
    """Lưu template đơn từ vào folder theo loại + đơn vị"""
    return f"request_templates/{instance.request_type}/{instance.company_unit_id}_{filename}"


class RequestTemplate(models.Model):
    """
    Template DOCX cho đơn từ tổng hợp.
    Mỗi loại đơn (request_type) có 1 template riêng cho từng đơn vị (company_unit).
    Khi user làm đơn, hệ thống auto load đúng template theo loại + đơn vị → fill data → preview PDF.
    """
    name = models.CharField(max_length=255, verbose_name="Tên template")
    request_type = models.CharField(
        max_length=30, choices=GENERIC_REQUEST_TYPE,
        verbose_name="Loại đơn"
    )
    company_unit = models.ForeignKey(
        CompanyUnit, on_delete=models.CASCADE,
        related_name='request_templates',
        verbose_name="Đơn vị áp dụng"
    )
    file = models.FileField(
        upload_to=request_template_upload_path,
        verbose_name="File template (.docx)"
    )
    description = models.TextField(blank=True, verbose_name="Mô tả")
    is_active = models.BooleanField(default=True, verbose_name="Đang sử dụng")
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_request_templates'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Template đơn từ"
        verbose_name_plural = "Templates đơn từ"
        unique_together = [['request_type', 'company_unit']]
        ordering = ['request_type', 'company_unit__name']

    def __str__(self):
        return f"{self.get_request_type_display()} - {self.company_unit.name}"


# ======================
# APPROVAL MODELS
# ======================

class ApprovalRecord(models.Model):
    """Lịch sử duyệt đơn"""
    request_type = models.CharField(max_length=50, verbose_name="Loại đơn")
    request_id = models.IntegerField(verbose_name="ID đơn")
    
    # Người duyệt và hành động
    approver = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='approval_records',
                                verbose_name="Người duyệt")
    approval_level = models.CharField(max_length=20, choices=APPROVAL_LEVEL, verbose_name="Cấp duyệt")
    action = models.CharField(max_length=20, choices=APPROVAL_ACTION, verbose_name="Hành động")
    
    # Thông tin duyệt
    note = models.TextField(blank=True, verbose_name="Ghi chú")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"{self.approval_level} - {self.action} - {self.request_type} #{self.request_id}"
    
    class Meta:
        verbose_name = "Lịch sử duyệt đơn"
        verbose_name_plural = "Lịch sử duyệt đơn"
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['request_type', 'request_id']),
        ]
    
    @classmethod
    def create_record(cls, request, approver, level, action, note=''):
        """Tạo bản ghi duyệt"""
        return cls.objects.create(
            request_type=request.__class__.__name__,
            request_id=request.id,
            approver=approver,
            approval_level=level,
            action=action,
            note=note
        )


# ======================
# ATTENDANCE MODELS
# ======================

class Attendance(models.Model):
    """Bản ghi chấm công hàng ngày"""
    attendance_code = models.CharField(max_length=64, unique=True, verbose_name="Mã chấm công")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='attendances',
                                verbose_name="Nhân viên")
    
    # Thông tin ngày
    attendance_date = models.DateField(verbose_name="Ngày chấm công")
    
    # Thời gian chấm công
    check_in = models.TimeField(null=True, blank=True, verbose_name="Giờ vào")
    check_out = models.TimeField(null=True, blank=True, verbose_name="Giờ ra")
    
    # Trạng thái chấm công
    status = models.CharField(max_length=25, choices=ATTENDANCE_STATUS, default='PRESENT', verbose_name="Trạng thái")
    
    # Thông tin ca làm
    shift_type = models.CharField(max_length=20, choices=[
        ('MORNING', 'Ca sáng'),
        ('AFTERNOON', 'Ca chiều'),
        ('EVENING', 'Ca tối'),
        ('FULL_DAY', 'Cả ngày'),
        ('NIGHT', 'Ca đêm'),
    ], default='FULL_DAY', verbose_name="Loại ca")
    
    # Thông tin tính toán
    working_hours = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Số giờ làm việc")
    overtime_hours = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Số giờ làm thêm")
    late_minutes = models.IntegerField(default=0, verbose_name="Số phút đi muộn")
    early_leave_minutes = models.IntegerField(default=0, verbose_name="Số phút về sớm")
    
    # Ghi chú
    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    
    # Thông tin import
    imported_from_file = models.CharField(max_length=255, blank=True, verbose_name="Import từ file")
    import_batch = models.CharField(max_length=100, blank=True, verbose_name="Lô import")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_attendances', verbose_name="Người tạo")
    
    def __str__(self):
        return f"Chấm công {self.attendance_code} - {self.employee.full_name} - {self.attendance_date}"
    
    class Meta:
        verbose_name = "Chấm công"
        verbose_name_plural = "Chấm công"
        ordering = ['-attendance_date', 'employee']
        unique_together = ['employee', 'attendance_date', 'shift_type']
        indexes = [
            models.Index(fields=['employee', 'attendance_date']),
            models.Index(fields=['attendance_date']),
            models.Index(fields=['status']),
            models.Index(fields=['shift_type']),
        ]
    
    def save(self, *args, **kwargs):
        """Tự động tạo mã chấm công và tính toán thông tin"""
        if not self.attendance_code:
            # Generate unique attendance code with microsecond precision
            import uuid
            timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
            # Add microseconds and a random component to ensure uniqueness
            microsecond = timezone.now().microsecond
            random_component = str(uuid.uuid4())[:8]
            self.attendance_code = f"ATT-{timestamp}-{microsecond:06d}-{random_component}"
        
        # Tính toán working_hours nếu có check_in và check_out
        if self.check_in and self.check_out:
            from datetime import datetime
            check_in_dt = datetime.combine(self.attendance_date, self.check_in)
            check_out_dt = datetime.combine(self.attendance_date, self.check_out)
            
            # Nếu check_out < check_in, có thể qua ngày hôm sau
            if self.check_out <= self.check_in:
                check_out_dt = datetime.combine(self.attendance_date + timezone.timedelta(days=1), self.check_out)
            
            delta = check_out_dt - check_in_dt
            self.working_hours = delta.total_seconds() / 3600  # Chuyển sang giờ
        
        # Gọi rule engine để tính toán trạng thái
        try:
            from .rule_engine import AttendanceRuleEngine
            calculation_result = AttendanceRuleEngine.apply_rules_to_attendance(self)
            
            # Cập nhật trạng thái và các thông tin tính toán từ rule engine
            self.status = calculation_result.get('status', self.status)
            self.working_hours = calculation_result.get('work_hours', self.working_hours)
            self.late_minutes = calculation_result.get('late_minutes', self.late_minutes)
            self.early_leave_minutes = calculation_result.get('early_leave_minutes', self.early_leave_minutes)
            self.overtime_hours = calculation_result.get('overtime_hours', self.overtime_hours)
        except Exception as e:
            # Nếu rule engine gặp lỗi, vẫn lưu attendance với trạng thái mặc định
            # Log lỗi nếu cần
            pass
        
        super().save(*args, **kwargs)
    
    @property
    def department(self):
        """Lấy phòng ban từ nhân viên"""
        return self.employee.department if self.employee else None
    
    def calculate_status(self):
        """Tính toán trạng thái dựa trên thời gian chấm công"""
        if not self.check_in and not self.check_out:
            return 'ABSENT'
        
        # Logic tính toán trạng thái dựa trên thời gian
        # Có thể mở rộng thêm
        return self.status


class AttendanceImportLog(models.Model):
    """Lịch sử import file chấm công"""
    import_code = models.CharField(max_length=64, unique=True, verbose_name="Mã import")
    file_name = models.CharField(max_length=255, verbose_name="Tên file")
    file_size = models.IntegerField(verbose_name="Kích thước file (bytes)")
    
    # Thông tin import
    total_records = models.IntegerField(default=0, verbose_name="Tổng số bản ghi")
    imported_records = models.IntegerField(default=0, verbose_name="Số bản ghi import thành công")
    failed_records = models.IntegerField(default=0, verbose_name="Số bản ghi import thất bại")
    duplicate_records = models.IntegerField(default=0, verbose_name="Số bản ghi trùng lặp")
    
    # Kết quả import
    import_result = models.JSONField(default=dict, verbose_name="Kết quả import")
    error_log = models.TextField(blank=True, verbose_name="Log lỗi")
    
    # Thông tin người import
    imported_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='attendance_imports', verbose_name="Người import")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm hoàn thành")
    
    def __str__(self):
        return f"Import {self.import_code} - {self.file_name}"
    
    class Meta:
        verbose_name = "Lịch sử import chấm công"
        verbose_name_plural = "Lịch sử import chấm công"
        ordering = ['-created_at']
    
    def save(self, *args, **kwargs):
        """Tạo mã import tự động"""
        if not self.import_code:
            timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
            self.import_code = f"IMP-{timestamp}"
        super().save(*args, **kwargs)


# ======================
# ASSET MANAGEMENT MODELS
# ======================

ASSET_TYPE = [
    ('LAPTOP', 'Laptop'),
    ('DESKTOP', 'Máy tính để bàn'),
    ('MONITOR', 'Màn hình'),
    ('SIM', 'Sim'),
    ('PHONE', 'Điện thoại'),
    ('TABLET', 'Máy tính bảng'),
    ('PRINTER', 'Máy in'),
    ('SCANNER', 'Máy scan'),
    ('NETWORK', 'Thiết bị mạng'),
    ('SERVER', 'Máy chủ'),
    ('FURNITURE', 'Nội thất'),
    ('VEHICLE', 'Phương tiện'),
    ('OTHER', 'Khác'),
]

# "Phân loại" tài sản là text tự do: gõ gì lưu nấy, KHÔNG quy giá trị lạ về
# "Khác". ASSET_TYPE ở trên chỉ còn là các loại chuẩn có hành vi riêng (SIM,
# cấu hình máy...) và nhãn hiển thị của chúng.
STANDARD_ASSET_TYPES = {code for code, _ in ASSET_TYPE}
ASSET_TYPE_MAX_LENGTH = 100
# Tên gọi khác của loại chuẩn mà file Excel cũ vẫn dùng.
_ASSET_TYPE_ALIASES = {"máy tính xách tay": "LAPTOP"}


def normalize_asset_type(raw) -> str:
    """Chuẩn hoá "Phân loại" người dùng gõ (web lẫn Excel).

    Chỉ gom khoảng trắng thừa. Riêng giá trị trùng Y HỆT (không phân biệt hoa
    thường) mã hoặc nhãn của 1 loại chuẩn — vd "Laptop", "sim", "Máy tính để
    bàn", "Khác" — thì lưu theo mã chuẩn, để dữ liệu cũ/file export cũ và các
    hành vi theo loại (SIM, Màn hình...) giữ nguyên. Còn lại giữ đúng chữ đã gõ.
    """
    text = " ".join(str(raw or "").split())
    if not text:
        return ""
    key = text.casefold()
    for code, label in ASSET_TYPE:
        if key in (code.casefold(), label.casefold()):
            return code
    return _ASSET_TYPE_ALIASES.get(key, text)


ASSET_STATUS = [
    ('NEW', 'Mới'),
    ('IN_USE', 'Đang sử dụng'),
    ('IDLE', 'Không sử dụng'),
    ('UNDER_MAINTENANCE', 'Đang bảo trì'),
    ('DAMAGED', 'Hư hỏng'),
    ('RETIRED', 'Đã thanh lý'),
    ('TERMINATED', 'Đã cắt'),  # Dùng cho SIM — khi nhà mạng cắt dịch vụ
    ('LOST', 'Bị mất'),
]

ASSET_CONDITION = [
    ('EXCELLENT', 'Rất tốt'),
    ('GOOD', 'Tốt'),
    ('FAIR', 'Khá'),
    ('POOR', 'Kém'),
    ('BROKEN', 'Hỏng'),
]

DEPRECIATION_METHOD = [
    ('STRAIGHT_LINE', 'Đường thẳng'),
]

class Asset(models.Model):
    """Quản lý tài sản công ty"""
    asset_code = models.CharField(max_length=64, unique=True, verbose_name="Mã tài sản")
    name = models.CharField(max_length=255, verbose_name="Tên tài sản")
    asset_type = models.CharField(max_length=ASSET_TYPE_MAX_LENGTH, choices=ASSET_TYPE, verbose_name="Loại tài sản")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    
    # Thông tin mua sắm
    purchase_date = models.DateField(null=True, blank=True, verbose_name="Ngày mua")
    purchase_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, verbose_name="Giá mua")
    supplier = models.CharField(max_length=255, blank=True, verbose_name="Nhà cung cấp")
    invoice_number = models.CharField(max_length=100, blank=True, verbose_name="Số hóa đơn")
    
    # Thông tin kỹ thuật
    brand = models.CharField(max_length=100, blank=True, verbose_name="Thương hiệu")
    model = models.CharField(max_length=100, blank=True, verbose_name="Model")
    serial_number = models.CharField(max_length=100, blank=True, verbose_name="Số serial")
    specifications = models.JSONField(default=dict, blank=True, verbose_name="Thông số kỹ thuật")
    
    # Trạng thái và tình trạng
    status = models.CharField(max_length=20, choices=ASSET_STATUS, default='NEW', verbose_name="Trạng thái")
    condition = models.CharField(max_length=20, choices=ASSET_CONDITION, default='EXCELLENT', verbose_name="Tình trạng")
    
    # Thông tin bảo hành
    warranty_period = models.IntegerField(default=12, verbose_name="Thời hạn bảo hành (tháng)")
    warranty_expiry = models.DateField(null=True, blank=True, verbose_name="Ngày hết hạn bảo hành")
    warranty_provider = models.CharField(max_length=255, blank=True, verbose_name="Nhà cung cấp bảo hành")
    
    # Vị trí và người sử dụng
    department = models.ForeignKey('employee.Department', on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='assets', verbose_name="Phòng ban")
    location = models.CharField(max_length=255, blank=True, verbose_name="Vị trí lưu trữ")
    managed_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='managed_assets', verbose_name="Người quản lý (Kho)")
    assigned_to = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='assigned_assets', verbose_name="Người được gán")
    assigned_date = models.DateField(null=True, blank=True, verbose_name="Ngày gán")

    # Kích thước vật lý + nơi thực tế đang sử dụng — TÁCH biệt với `department`
    # (phòng ban QUẢN LÝ tài sản) vì tài sản có thể do phòng A quản lý nhưng phòng
    # B đang dùng. "Người sử dụng" dùng chung `assigned_to`.
    dimensions = models.CharField(max_length=100, blank=True, verbose_name="Kích thước")
    usage_area = models.CharField(max_length=255, blank=True, verbose_name="Khu vực sử dụng")
    usage_department = models.ForeignKey(
        'employee.Department', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='assets_in_use', verbose_name="Phòng ban sử dụng",
    )
    facility_code = models.CharField(max_length=50, blank=True, verbose_name="Mã cơ sở")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_assets', verbose_name="Người tạo")
    
    # Soft delete fields
    is_deleted = models.BooleanField(default=False, verbose_name="Đã xóa")
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm xóa")

    # Khấu hao — "Giá trị hiện tại"/"Mức khấu hao" KHÔNG lưu cột riêng mà tính
    # động qua property (xem bên dưới) để luôn khớp thời điểm hiện tại.
    depreciation_period_months = models.PositiveIntegerField(
        null=True, blank=True, verbose_name="Thời gian khấu hao (tháng)")
    depreciation_method = models.CharField(
        max_length=20, choices=DEPRECIATION_METHOD, default='STRAIGHT_LINE',
        verbose_name="Phương pháp khấu hao")

    # Hình ảnh tài sản — CharField lưu S3 key (giống Employee.avatar), upload qua
    # action upload_image(), đọc ra bằng presigned URL ở serializer.
    current_image = models.CharField(max_length=500, blank=True, null=True,
                                     verbose_name="Hình ảnh tài sản hiện tại")
    purchase_image = models.CharField(max_length=500, blank=True, null=True,
                                      verbose_name="Hình ảnh tài sản mới mua")

    def save(self, *args, **kwargs):
        if not self.asset_code:
            # Generate a new asset code like AST-0001
            import datetime
            year = datetime.datetime.now().year
            last_asset = Asset.objects.all().order_by('id').last()
            if not last_asset:
                new_id = 1
            else:
                new_id = last_asset.id + 1
            self.asset_code = f"AST-{year}-{new_id:04d}"
        super(Asset, self).save(*args, **kwargs)

    def __str__(self):
        return f"{self.asset_code} - {self.name}"
    
    class Meta:
        verbose_name = "Tài sản"
        verbose_name_plural = "Tài sản"
        ordering = ['asset_code']
        indexes = [
            models.Index(fields=['asset_code']),
            models.Index(fields=['asset_type']),
            models.Index(fields=['status']),
            models.Index(fields=['assigned_to']),
            models.Index(fields=['department']),
        ]
    
    def save(self, *args, **kwargs):
        """Tự động tạo mã tài sản và tính ngày hết hạn bảo hành"""
        if not self.asset_code:
            # Tạo mã tự động: ASSET-YYYYMM-XXXX
            timestamp = timezone.now().strftime('%Y%m')
            last_asset = Asset.objects.filter(asset_code__startswith=f'ASSET-{timestamp}').order_by('asset_code').last()
            if last_asset:
                last_num = int(last_asset.asset_code.split('-')[-1])
                new_num = last_num + 1
            else:
                new_num = 1
            self.asset_code = f"ASSET-{timestamp}-{new_num:04d}"
        
        # Tính ngày hết hạn bảo hành nếu có ngày mua
        if self.purchase_date and self.warranty_period:
            from dateutil.relativedelta import relativedelta
            self.warranty_expiry = self.purchase_date + relativedelta(months=self.warranty_period)
        
        super().save(*args, **kwargs)

    # ======== Khấu hao (đường thẳng) — tính động, không lưu DB ========
    @property
    def monthly_depreciation(self):
        """Mức khấu hao mỗi tháng = Giá mua ÷ Thời gian khấu hao (tháng)."""
        if not self.purchase_price or not self.depreciation_period_months:
            return None
        try:
            return round(self.purchase_price / self.depreciation_period_months, 2)
        except (TypeError, ZeroDivisionError, decimal.InvalidOperation):
            return None

    @property
    def months_since_purchase(self):
        """Số tháng đã trôi qua kể từ ngày mua tới hôm nay (chưa tròn tháng thì không tính)."""
        if not self.purchase_date:
            return 0
        today = timezone.now().date()
        if today < self.purchase_date:
            return 0
        months = (today.year - self.purchase_date.year) * 12 + (today.month - self.purchase_date.month)
        if today.day < self.purchase_date.day:
            months -= 1
        return max(0, months)

    @property
    def accumulated_depreciation(self):
        """Tổng đã khấu hao tính đến hiện tại, không vượt quá giá mua."""
        monthly = self.monthly_depreciation
        if monthly is None:
            return None
        months_used = self.months_since_purchase
        if self.depreciation_period_months:
            months_used = min(months_used, self.depreciation_period_months)
        return min(monthly * months_used, self.purchase_price)

    @property
    def current_value(self):
        """Giá trị hiện tại sau khấu hao. Không cấu hình khấu hao thì bằng giá mua."""
        if self.purchase_price is None:
            return None
        accumulated = self.accumulated_depreciation
        if accumulated is None:
            return self.purchase_price
        return max(self.purchase_price - accumulated, 0)

    # ======== Multi-holder helpers ========
    # Loại tài sản cho phép nhiều đơn vị + bàn giao cho nhiều người.
    MULTI_HOLDER_TYPES = {'MONITOR', 'OTHER'}

    @classmethod
    def is_multi_holder_type(cls, asset_type) -> bool:
        """Loại có Số lượng + bàn giao cho nhiều người: Màn hình, Khác, và mọi
        "Phân loại" gõ tự do ngoài danh sách chuẩn (hành vi giống "Khác")."""
        return asset_type in cls.MULTI_HOLDER_TYPES or asset_type not in STANDARD_ASSET_TYPES

    @property
    def total_quantity(self) -> int:
        """Tổng số đơn vị vật lý — dùng ``specifications.quantity``
        cho các loại nhiều đơn vị (is_multi_holder_type). Các loại khác mặc định 1.
        """
        if self.is_multi_holder_type(self.asset_type):
            try:
                return max(1, int((self.specifications or {}).get('quantity', 1) or 1))
            except (TypeError, ValueError):
                return 1
        return 1

    @property
    def assigned_quantity_total(self) -> int:
        """Tổng quantity đang CONFIRMED (đã bàn giao, chưa thu hồi)."""
        from django.db.models import Sum
        if not self.pk:
            return 0
        return int(
            self.assignment_history.filter(status='CONFIRMED')
            .aggregate(total=Sum('assigned_quantity'))['total'] or 0
        )

    @property
    def remaining_quantity(self) -> int:
        return max(0, self.total_quantity - self.assigned_quantity_total)

    def is_multi_holder(self) -> bool:
        """True nếu asset thuộc loại cho phép chia cho nhiều người (qty>1)."""
        return self.is_multi_holder_type(self.asset_type) and self.total_quantity > 1

    def assign_to_employee(self, employee, assigned_date=None, notes=None,
                           assigned_by=None, override_pending=False, quantity=1):
        """Tạo yêu cầu bàn giao ở trạng thái PENDING, chờ nhân viên xác nhận.

        Không cập nhật trạng thái asset ngay — asset chỉ chuyển IN_USE khi nhân viên
        xác nhận (xem ``AssetViewSet.confirm_handover``). Nếu asset đã có một bản ghi
        ``PENDING``:

        - ``override_pending=False`` (mặc định): raise ``ValidationError``; exception
          mang thêm attribute ``existing_pending`` để view có thể trả thông tin cho FE.
        - ``override_pending=True``: hủy bản ghi PENDING cũ (chuyển sang ``CANCELLED``)
          rồi mới tạo bản ghi mới.
        """
        from django.core.exceptions import ValidationError
        from django.db import transaction
        from datetime import date, datetime

        # Chuẩn hoá assigned_date về kiểu date (FE có thể gửi string ISO)
        if isinstance(assigned_date, str) and assigned_date:
            try:
                assigned_date = datetime.strptime(assigned_date, "%Y-%m-%d").date()
            except ValueError:
                raise ValidationError("Định dạng assigned_date không hợp lệ (YYYY-MM-DD)")
        if not isinstance(assigned_date, date):
            assigned_date = timezone.now().date()

        # ---- Validate quantity ----
        try:
            quantity = int(quantity) if quantity is not None else 1
        except (TypeError, ValueError):
            quantity = 1

        if quantity < 1:
            err = ValidationError("Số lượng bàn giao phải >= 1")
            err.error_code = 'QUANTITY_MISSING'  # type: ignore[attr-defined]
            err.total_quantity = self.total_quantity  # type: ignore[attr-defined]
            err.remaining_quantity = self.remaining_quantity  # type: ignore[attr-defined]
            raise err

        if not self.is_multi_holder_type(self.asset_type) and quantity != 1:
            err = ValidationError("Loại tài sản này không hỗ trợ bàn giao nhiều đơn vị")
            err.error_code = 'NOT_MULTI_HOLDER_TYPE'  # type: ignore[attr-defined]
            raise err

        remaining = self.remaining_quantity
        if quantity > remaining:
            err = ValidationError(
                f"Chỉ còn {remaining}/{self.total_quantity} đơn vị trong kho để bàn giao"
            )
            err.error_code = 'QUANTITY_OVER_LIMIT'  # type: ignore[attr-defined]
            err.total_quantity = self.total_quantity  # type: ignore[attr-defined]
            err.remaining_quantity = remaining  # type: ignore[attr-defined]
            err.requested_quantity = quantity  # type: ignore[attr-defined]
            raise err

        with transaction.atomic():
            # PENDING check phân biệt theo asset type:
            # - Non-MONITOR: giữ logic cũ — 1 PENDING tổng, support override_pending.
            # - MONITOR: chỉ chặn khi cùng recipient đã có PENDING (tránh duplicate).
            if self.is_multi_holder():
                existing_pending = AssetAssignmentHistory.objects.filter(
                    asset=self, status='PENDING', assigned_to=employee,
                ).first()
                if existing_pending and not override_pending:
                    err = ValidationError(
                        f"Đã có yêu cầu bàn giao chờ {employee.full_name} xác nhận"
                    )
                    err.existing_pending = existing_pending  # type: ignore[attr-defined]
                    err.error_code = 'PENDING_EXISTS'  # type: ignore[attr-defined]
                    raise err
                if existing_pending:
                    existing_pending.status = 'CANCELLED'
                    existing_pending.rejected_at = timezone.now()
                    existing_pending.rejection_reason = (
                        f"Hủy bởi quản lý kho để bàn giao lại cho {employee.full_name}"
                    )
                    existing_pending.save()
            else:
                existing_pending = AssetAssignmentHistory.objects.filter(
                    asset=self, status='PENDING'
                ).first()
                if existing_pending:
                    if not override_pending:
                        err = ValidationError("Asset đang có yêu cầu bàn giao chờ xác nhận")
                        err.existing_pending = existing_pending  # type: ignore[attr-defined]
                        err.error_code = 'PENDING_EXISTS'  # type: ignore[attr-defined]
                        raise err
                    existing_pending.status = 'CANCELLED'
                    existing_pending.rejected_at = timezone.now()
                    existing_pending.rejection_reason = (
                        f"Hủy bởi quản lý kho để bàn giao lại cho {employee.full_name}"
                    )
                    existing_pending.save()

            history = AssetAssignmentHistory.objects.create(
                asset=self,
                assigned_to=employee,
                assigned_date=assigned_date,
                assignment_notes=notes or "Bàn giao tài sản",
                assigned_by=assigned_by,
                status='PENDING',
                assigned_quantity=quantity,
            )
        return history

    def return_asset(self, return_date=None, condition=None, notes='', history_id=None, return_quantity=None):
        """Thu hồi tài sản (hỗ trợ partial cho MONITOR multi-holder).

        - ``history_id=None`` (mặc định): thu hồi toàn bộ holder hiện tại
          (flow cũ, dành cho non-MONITOR và MONITOR single-holder).
        - ``history_id=X``: chỉ thu hồi đúng history record đó.
        - ``return_quantity``: số lượng thu hồi (chỉ dùng khi có ``history_id``).
          Nếu ``return_quantity < assigned_quantity`` → split record:
          giữ phần còn lại CONFIRMED, tạo record RETURNED cho phần thu hồi.
          Nếu ``None`` hoặc ``>= assigned_quantity`` → thu hồi toàn bộ record.

        Sau khi thu hồi, recompute ``Asset.status``:
        - ``remaining == total`` → IDLE, ``assigned_to=None``
        - ``remaining < total`` → IN_USE (vẫn còn holder khác), set
          ``assigned_to`` = CONFIRMED mới nhất còn lại (hoặc None nếu hết)
        """
        from datetime import date, datetime
        if isinstance(return_date, str) and return_date:
            try:
                return_date = datetime.strptime(return_date, "%Y-%m-%d").date()
            except ValueError:
                return_date = None
        if not isinstance(return_date, date):
            return_date = timezone.now().date()

        if history_id is not None:
            # Partial return theo history cụ thể
            history = AssetAssignmentHistory.objects.filter(
                id=history_id, asset=self, status='CONFIRMED',
            ).first()
            if not history:
                return False

            qty = return_quantity
            if qty is not None and 0 < qty < (history.assigned_quantity or 1):
                # Split: giảm record hiện tại, tạo record RETURNED mới
                history.assigned_quantity -= qty
                history.save()
                AssetAssignmentHistory.objects.create(
                    asset=self,
                    assigned_to=history.assigned_to,
                    assigned_date=history.assigned_date,
                    assigned_by=history.assigned_by,
                    assignment_notes=history.assignment_notes,
                    assigned_quantity=qty,
                    status='RETURNED',
                    confirmed_at=history.confirmed_at,
                    returned_date=return_date,
                    return_condition=condition or '',
                    return_notes=notes or '',
                )
            else:
                # Thu hồi toàn bộ record
                history.status = 'RETURNED'
                history.returned_date = return_date
                history.return_condition = condition or ''
                history.return_notes = notes or ''
                history.save()
        else:
            # Full return — đánh dấu tất cả CONFIRMED của holder hiện tại
            if not self.assigned_to:
                return False
            AssetAssignmentHistory.objects.filter(
                asset=self,
                assigned_to=self.assigned_to,
                status='CONFIRMED',
                returned_date__isnull=True,
            ).update(
                status='RETURNED',
                returned_date=return_date,
                return_condition=condition or self.condition,
                return_notes=notes,
            )

        # Recompute asset state từ các CONFIRMED còn lại
        remaining_confirmed = self.assignment_history.filter(
            status='CONFIRMED'
        ).order_by('-confirmed_at', '-id')
        if remaining_confirmed.exists():
            top = remaining_confirmed.first()
            self.assigned_to = top.assigned_to
            self.assigned_date = top.assigned_date
            self.status = 'IN_USE'
        else:
            self.assigned_to = None
            self.assigned_date = None
            self.status = 'IDLE'

        if condition and history_id is None:
            # Với full return, giữ behavior cũ là update condition của asset
            self.condition = condition
        self.save()

        return True
    
    def get_assignment_history(self):
        """Lấy lịch sử gán tài sản"""
        return self.assignment_history.all().order_by('-assigned_date')


class AssetAssignmentHistory(models.Model):
    """Lịch sử gán tài sản cho nhân viên"""
    ASSIGNMENT_STATUS = [
        ('PENDING', 'Chờ nhân viên xác nhận'),
        ('CONFIRMED', 'Đã xác nhận nhận máy'),
        ('REJECTED', 'Đã từ chối nhận máy'),
        ('CANCELLED', 'Đã hủy bởi quản lý'),
        ('RETURNED', 'Đã thu hồi'),
    ]

    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name='assignment_history',
                             verbose_name="Tài sản")
    assigned_to = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='asset_assignments',
                                   verbose_name="Người được gán")
    assigned_date = models.DateField(verbose_name="Ngày gán")
    returned_date = models.DateField(null=True, blank=True, verbose_name="Ngày trả")

    # Trạng thái của bản ghi bàn giao
    status = models.CharField(max_length=20, choices=ASSIGNMENT_STATUS, default='PENDING',
                              verbose_name="Trạng thái")
    confirmed_at = models.DateTimeField(null=True, blank=True,
                                        verbose_name="Thời điểm nhân viên xác nhận")
    rejected_at = models.DateTimeField(null=True, blank=True,
                                       verbose_name="Thời điểm nhân viên từ chối")
    rejection_reason = models.TextField(blank=True, default='',
                                        verbose_name="Lý do từ chối")

    # Thông tin khi trả
    return_condition = models.CharField(max_length=20, choices=ASSET_CONDITION, blank=True,
                                       verbose_name="Tình trạng khi trả")
    return_notes = models.TextField(blank=True, verbose_name="Ghi chú khi trả")

    # Thông tin gán
    assignment_notes = models.TextField(blank=True, verbose_name="Ghi chú gán")
    assigned_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='approved_assignments', verbose_name="Người gán")

    # Số lượng đơn vị bàn giao — mặc định 1. Chỉ MONITOR (multi-holder) mới
    # có thể > 1 hoặc chia thành nhiều history record cùng lúc.
    assigned_quantity = models.PositiveIntegerField(
        default=1, verbose_name="Số lượng đã bàn giao"
    )

    # Nhân viên đã xem thông báo thu hồi (dùng để không hiện lại dialog)
    seen_by = models.ManyToManyField(
        Employee,
        blank=True,
        related_name='seen_return_notifications',
        verbose_name="Đã xem bởi",
    )

    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"{self.asset.asset_code} - {self.assigned_to.full_name} ({self.assigned_date})"
    
    class Meta:
        verbose_name = "Lịch sử gán tài sản"
        verbose_name_plural = "Lịch sử gán tài sản"
        ordering = ['-assigned_date']
        indexes = [
            models.Index(fields=['asset', 'assigned_to']),
            models.Index(fields=['assigned_date']),
        ]
    
    @property
    def duration_days(self):
        """Số ngày sử dụng"""
        if self.returned_date:
            return (self.returned_date - self.assigned_date).days
        return (timezone.now().date() - self.assigned_date).days


class AssetMaintenance(models.Model):
    """Lịch sử bảo trì tài sản"""
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name='maintenance_records',
                             verbose_name="Tài sản")
    
    # Thông tin bảo trì
    maintenance_date = models.DateField(verbose_name="Ngày bảo trì")
    maintenance_type = models.CharField(max_length=50, verbose_name="Loại bảo trì")
    description = models.TextField(verbose_name="Mô tả công việc")
    cost = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, verbose_name="Chi phí")
    
    # Người thực hiện
    performed_by = models.CharField(max_length=255, blank=True, verbose_name="Người thực hiện")
    performed_by_employee = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                             related_name='performed_maintenance', verbose_name="Nhân viên thực hiện")
    
    # Kết quả
    result = models.TextField(blank=True, verbose_name="Kết quả")
    next_maintenance_date = models.DateField(null=True, blank=True, verbose_name="Ngày bảo trì tiếp theo")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_maintenance', verbose_name="Người tạo bản ghi")
    
    def __str__(self):
        return f"Bảo trì {self.asset.asset_code} - {self.maintenance_date}"
    
    class Meta:
        verbose_name = "Bảo trì tài sản"
        verbose_name_plural = "Bảo trì tài sản"
        ordering = ['-maintenance_date']
        indexes = [
            models.Index(fields=['asset', 'maintenance_date']),
        ]



INVENTORY_CHECK_RESULT = [
    ('MATCH', 'Khớp'),
    ('MISSING', 'Thiếu / không tìm thấy'),
    ('DAMAGED', 'Hư hỏng'),
    ('WRONG_HOLDER', 'Sai vị trí / người giữ'),
    ('OTHER', 'Khác'),
]


class AssetInventoryCheck(models.Model):
    """Lịch sử kiểm kê tài sản — mỗi bản ghi là 1 lần kiểm kê thực tế cho 1 tài sản."""
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name='inventory_checks',
                              verbose_name="Tài sản")
    check_date = models.DateField(verbose_name="Ngày kiểm kê")
    checked_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='performed_inventory_checks', verbose_name="Người kiểm kê")
    actual_condition = models.CharField(max_length=20, choices=ASSET_CONDITION, blank=True,
                                        verbose_name="Tình trạng thực tế")
    result = models.CharField(max_length=20, choices=INVENTORY_CHECK_RESULT, default='MATCH',
                              verbose_name="Kết quả kiểm kê")
    notes = models.TextField(blank=True, verbose_name="Ghi chú")

    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='created_inventory_checks', verbose_name="Người tạo bản ghi")

    def __str__(self):
        return f"Kiểm kê {self.asset.asset_code} - {self.check_date}"

    class Meta:
        verbose_name = "Kiểm kê tài sản"
        verbose_name_plural = "Kiểm kê tài sản"
        ordering = ['-check_date']
        indexes = [
            models.Index(fields=['asset', 'check_date']),
        ]

# ======================
# COMPANY CONFIGURATION MODELS
# ======================

class OnlineWorkQuotaOverride(models.Model):
    """Ghi đè hạn mức số ngày làm việc online tối đa/tháng cho ĐÚNG 1 phạm vi: một nhân
    viên, một vị trí hoặc một phòng ban (mỗi phạm vi tối đa 1 bản ghi).

    Thứ tự ưu tiên khi tra cứu (xem stats_utils.get_max_online_work_quota): nhân viên >
    vị trí > phòng ban > CompanyConfig.max_online_work_count_per_month.
    """
    employee = models.OneToOneField(
        'employee.Employee', on_delete=models.CASCADE, null=True, blank=True,
        related_name='online_work_quota_override', verbose_name="Nhân viên",
    )
    position = models.OneToOneField(
        'employee.Position', on_delete=models.CASCADE, null=True, blank=True,
        related_name='online_work_quota_override', verbose_name="Vị trí",
    )
    department = models.OneToOneField(
        'employee.Department', on_delete=models.CASCADE, null=True, blank=True,
        related_name='online_work_quota_override', verbose_name="Phòng ban",
    )
    max_online_days = models.DecimalField(
        max_digits=4, decimal_places=1,
        validators=[MinValueValidator(0), MaxValueValidator(31)],
        verbose_name="Số ngày online tối đa/tháng",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Hạn mức ngày làm online"
        verbose_name_plural = "Hạn mức ngày làm online"
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(employee__isnull=False, position__isnull=True, department__isnull=True)
                    | models.Q(employee__isnull=True, position__isnull=False, department__isnull=True)
                    | models.Q(employee__isnull=True, position__isnull=True, department__isnull=False)
                ),
                name='online_work_quota_override_exactly_one_scope',
            ),
        ]

    def __str__(self):
        scope = self.employee or self.position or self.department
        return f"{scope}: tối đa {self.max_online_days} ngày online/tháng"

    def clean(self):
        if sum(1 for v in (self.employee_id, self.position_id, self.department_id) if v) != 1:
            raise ValidationError("Phải chọn đúng 1 trong 3: nhân viên, vị trí hoặc phòng ban.")


class ChildCareRegime(models.Model):
    """Chế độ con nhỏ của 1 nhân viên trong 1 khoảng ngày: mỗi ngày được đi muộn tối
    đa ``allowance_minutes`` phút và về sớm tối đa ``allowance_minutes`` phút — xem
    hrm/child_care_regime.py. Lưu theo khoảng ngày để tính lại tháng cũ vẫn đúng."""
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name='child_care_regimes',
        verbose_name="Nhân viên",
    )
    start_date = models.DateField(verbose_name="Từ ngày")
    end_date = models.DateField(null=True, blank=True, verbose_name="Đến ngày",
                                help_text="Để trống = chưa xác định ngày kết thúc")
    allowance_minutes = models.PositiveSmallIntegerField(
        default=60, validators=[MinValueValidator(1), MaxValueValidator(240)],
        verbose_name="Số phút được đi muộn / về sớm",
        help_text="Áp dụng riêng cho mỗi chiều: đi muộn tối đa N phút và về sớm tối đa N phút mỗi ngày.",
    )
    note = models.CharField(max_length=255, blank=True, default='', verbose_name="Ghi chú")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Chế độ con nhỏ"
        verbose_name_plural = "Chế độ con nhỏ"
        ordering = ['-start_date', 'employee__full_name']

    def __str__(self):
        return f"{self.employee} · {self.start_date} → {self.end_date or '…'} · {self.allowance_minutes}'"


class CompanyConfig(models.Model):
    """Cấu hình chung của công ty"""
    name = models.CharField(max_length=255, verbose_name="Tên cấu hình")
    code = models.CharField(max_length=64, unique=True, verbose_name="Mã cấu hình")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    
    # Cấu hình chung
    default_working_hours_per_day = models.DecimalField(max_digits=4, decimal_places=2, default=8.0, 
                                                       verbose_name="Số giờ làm việc mặc định mỗi ngày")
    default_working_days_per_week = models.IntegerField(default=5, verbose_name="Số ngày làm việc mặc định mỗi tuần")
    overtime_multiplier_weekday = models.DecimalField(max_digits=3, decimal_places=2, default=1.5,
                                                     verbose_name="Hệ số làm thêm ngày thường")
    overtime_multiplier_weekend = models.DecimalField(max_digits=3, decimal_places=2, default=2.0,
                                                     verbose_name="Hệ số làm thêm cuối tuần")
    overtime_multiplier_holiday = models.DecimalField(max_digits=3, decimal_places=2, default=3.0,
                                                     verbose_name="Hệ số làm thêm ngày lễ")
    
    # Cấu hình chấm công
    late_threshold_minutes = models.IntegerField(default=15, verbose_name="Ngưỡng đi muộn (phút)")
    early_leave_threshold_minutes = models.IntegerField(default=15, verbose_name="Ngưỡng về sớm (phút)")
    half_day_threshold_hours = models.DecimalField(max_digits=4, decimal_places=2, default=4.0,
                                                  verbose_name="Ngưỡng nửa ngày (giờ)")
    
    # Cấu hình nghỉ phép
    annual_leave_days_per_year = models.IntegerField(default=12, verbose_name="Số ngày nghỉ phép năm mỗi năm")
    sick_leave_days_per_year = models.IntegerField(default=5, verbose_name="Số ngày nghỉ ốm mỗi năm")
    maternity_leave_days = models.IntegerField(default=180, verbose_name="Số ngày nghỉ thai sản")
    paternity_leave_days = models.IntegerField(default=5, verbose_name="Số ngày nghỉ thai sản cho cha")
    
    # Cấu hình giải trình và bổ sung công
    max_explanation_count_per_month = models.IntegerField(default=3, verbose_name="Số lần giải trình tối đa mỗi tháng")
    supplement_work_hours_per_month = models.DecimalField(max_digits=5, decimal_places=2, default=10.0,
                                                         verbose_name="Số giờ bổ sung công tối đa mỗi tháng")
    max_leave_count_per_month = models.DecimalField(max_digits=4, decimal_places=1, default=1.0,
                                                    verbose_name="Số ngày nghỉ phép tháng tối đa mỗi tháng")
    max_online_work_count_per_month = models.DecimalField(max_digits=4, decimal_places=1, default=3.0, verbose_name="Số ngày làm việc online tối đa mỗi tháng")
    
    # Trạng thái
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    effective_from = models.DateField(verbose_name="Có hiệu lực từ")
    effective_to = models.DateField(null=True, blank=True, verbose_name="Có hiệu lực đến")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_company_configs', verbose_name="Người tạo")
    
    def __str__(self):
        return f"{self.code} - {self.name}"
    
    class Meta:
        verbose_name = "Cấu hình công ty"
        verbose_name_plural = "Cấu hình công ty"
        ordering = ['-effective_from', 'code']
    
    def clean(self):
        """Validate date range"""
        if self.effective_to and self.effective_from:
            if self.effective_to < self.effective_from:
                raise ValidationError("Ngày hiệu lực đến phải sau ngày hiệu lực từ")
    
    def save(self, *args, **kwargs):
        """Tự động tạo mã cấu hình nếu chưa có"""
        if not self.code:
            timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
            self.code = f"CONFIG-{timestamp}"
        super().save(*args, **kwargs)
    
    @property
    def is_current(self):
        """Kiểm tra xem cấu hình có đang hiệu lực không"""
        today = timezone.now().date()
        if self.effective_from <= today:
            if not self.effective_to or self.effective_to >= today:
                return True
        return False


class AttendanceAppDownloadConfig(models.Model):
    """Link tải ứng dụng chấm công dùng trên thanh điều hướng."""

    name = models.CharField(max_length=120, default='Ứng dụng chấm công', verbose_name='Tên hiển thị')
    ios_url = models.URLField(max_length=500, blank=True, verbose_name='Link tải iOS')
    android_url = models.URLField(max_length=500, blank=True, verbose_name='Link tải Android')
    is_active = models.BooleanField(default=True, verbose_name='Đang sử dụng')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Cấu hình link tải app chấm công'
        verbose_name_plural = 'Cấu hình link tải app chấm công'
        ordering = ['-is_active', '-updated_at']

    def __str__(self):
        return self.name


class ShiftConfig(models.Model):
    """Cấu hình ca làm việc"""
    APPLY_SCOPE_CHOICES = [
        ('CA_NHAN', 'Cá nhân'),
        ('VI_TRI', 'Vị trí'),
        ('PHONG_BAN', 'Phòng ban'),
        ('DEFAULT', 'Mặc định'),
    ]

    name = models.CharField(max_length=255, verbose_name="Tên ca")
    code = models.CharField(max_length=64, unique=True, verbose_name="Mã ca")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    
    # Thời gian ca làm
    start_time = models.TimeField(verbose_name="Giờ bắt đầu")
    end_time = models.TimeField(verbose_name="Giờ kết thúc")
    break_start_time = models.TimeField(null=True, blank=True, verbose_name="Giờ bắt đầu nghỉ")
    break_end_time = models.TimeField(null=True, blank=True, verbose_name="Giờ kết thúc nghỉ")
    break_duration_minutes = models.IntegerField(default=60, verbose_name="Thời gian nghỉ (phút)")
    
    # Tính toán
    total_hours = models.DecimalField(max_digits=4, decimal_places=2, default=8.0, verbose_name="Tổng số giờ")
    working_hours = models.DecimalField(max_digits=4, decimal_places=2, default=7.0, verbose_name="Số giờ làm việc")
    
    # Loại ca
    shift_type = models.CharField(max_length=20, choices=[
        ('MORNING', 'Ca sáng'),
        ('AFTERNOON', 'Ca chiều'),
        ('EVENING', 'Ca tối'),
        ('NIGHT', 'Ca đêm'),
        ('FLEXIBLE', 'Ca linh hoạt'),
        ('OTHER', 'Khác'),
    ], default='MORNING', verbose_name="Loại ca")
    
    # Áp dụng cho
    apply_scope = models.CharField(
        max_length=20,
        choices=APPLY_SCOPE_CHOICES,
        null=True,
        blank=True,
        verbose_name="Phạm vi áp dụng"
    )
    apply_to_departments = models.ManyToManyField('employee.Department', blank=True,
                                                 related_name='shift_configs', verbose_name="Áp dụng cho phòng ban")
    apply_to_positions = models.ManyToManyField('employee.Position', blank=True,
                                               related_name='shift_configs', verbose_name="Áp dụng cho vị trí")
    apply_to_employees = models.ManyToManyField(Employee, blank=True,
                                               related_name='shift_configs', verbose_name="Áp dụng cho nhân viên")
    
    # Ngày áp dụng
    effective_from = models.DateField(verbose_name="Có hiệu lực từ")
    effective_to = models.DateField(null=True, blank=True, verbose_name="Có hiệu lực đến")
    
    # Trạng thái
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    is_default = models.BooleanField(default=False, verbose_name="Ca mặc định")
    detection_only = models.BooleanField(
        default=False,
        verbose_name="Chỉ dùng để tự nhận diện (không làm ca mặc định)",
        help_text=(
            "Bật cờ này cho các ca DÀI/HOẠ HOẰN mới xảy ra (vd \"Ca kinh doanh\" "
            "13:00-21:00) mà bạn muốn gán cho nhiều vị trí/phòng ban để hệ thống TỰ "
            "NHẬN DIỆN đúng những ngày nhân viên thực sự làm ca đó (checkin/checkout "
            "khớp) — nhưng KHÔNG BAO GIỜ muốn nó trở thành ca mặc định cho cả tháng, "
            "dù được gán ở cấp nào (cá nhân/vị trí/phòng ban). Nếu không bật cờ này, "
            "gán 1 ca dài vào 1 vị trí/phòng ban CHƯA có sẵn ca ngắn cạnh tranh ở "
            "ĐÚNG CÙNG CẤP sẽ khiến nó tự động thắng thành ca mặc định — làm mọi "
            "ngày nhân viên đi làm giờ hành chính bình thường bị tính thiếu công "
            "(xem sự cố CSKH Miền Bắc 2026-09-17, hrm/shift_config_utils.py)."
        ),
    )
    counts_as_night_duty = models.BooleanField(
        default=False,
        verbose_name="Tính 1 buổi trực tối khi làm ca này",
        help_text=(
            "Bật cho ca kéo dài tới tối (vd \"Ca kinh doanh\" 13:00-21:00): ngày nào hệ "
            "thống nhận ra nhân viên làm đúng ca này (có đủ giờ vào/ra khớp ca) thì "
            "được cộng 1 buổi trực tối, không cần làm đơn trực tối. Ngày đã có đơn "
            "trực tối được duyệt thì chỉ tính theo đơn (không cộng thêm)."
        ),
    )

    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_shift_configs', verbose_name="Người tạo")
    
    def __str__(self):
        return f"{self.code} - {self.name} ({self.start_time} - {self.end_time})"
    
    class Meta:
        verbose_name = "Cấu hình ca làm"
        verbose_name_plural = "Cấu hình ca làm"
        ordering = ['start_time', 'code']
    
    def clean(self):
        """Validate time range"""
        if self.start_time and self.end_time:
            if self.end_time <= self.start_time:
                raise ValidationError("Giờ kết thúc phải sau giờ bắt đầu")
        
        if self.effective_to and self.effective_from:
            if self.effective_to < self.effective_from:
                raise ValidationError("Ngày hiệu lực đến phải sau ngày hiệu lực từ")
    
    def save(self, *args, **kwargs):
        """Tự động tạo mã ca và tính toán giờ làm"""
        if not self.code:
            timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
            self.code = f"SHIFT-{timestamp}"
        
        # Tính toán total_hours và working_hours
        if self.start_time and self.end_time:
            from datetime import datetime, timedelta
            start_dt = datetime.combine(timezone.now().date(), self.start_time)
            end_dt = datetime.combine(timezone.now().date(), self.end_time)
            
            # Nếu end_time < start_time, có thể qua ngày hôm sau
            if self.end_time <= self.start_time:
                end_dt = datetime.combine(timezone.now().date() + timedelta(days=1), self.end_time)
            
            delta = end_dt - start_dt
            total_hours = delta.total_seconds() / 3600
            
            # Trừ thời gian nghỉ
            working_hours = total_hours
            if self.break_duration_minutes:
                working_hours -= self.break_duration_minutes / 60
            
            self.total_hours = total_hours
            self.working_hours = working_hours
        
        super().save(*args, **kwargs)
    
    @property
    def is_current(self):
        """Kiểm tra xem ca làm có đang hiệu lực không"""
        today = timezone.now().date()
        if self.effective_from <= today:
            if not self.effective_to or self.effective_to >= today:
                return True
        return False


class HolidayConfig(models.Model):
    """Cấu hình ngày lễ"""
    name = models.CharField(max_length=255, verbose_name="Tên ngày lễ")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    
    # Ngày lễ
    holiday_date = models.DateField(verbose_name="Ngày lễ")
    is_recurring = models.BooleanField(default=True, verbose_name="Lặp lại hàng năm")
    
    # Loại ngày lễ
    holiday_type = models.CharField(max_length=20, choices=[
        ('PUBLIC_HOLIDAY', 'Ngày lễ quốc gia'),
        ('COMPANY_HOLIDAY', 'Ngày lễ công ty'),
        ('SPECIAL_EVENT', 'Sự kiện đặc biệt'),
        ('OTHER', 'Khác'),
    ], default='PUBLIC_HOLIDAY', verbose_name="Loại ngày lễ")
    
    # Cấu hình làm việc
    is_working_day = models.BooleanField(default=False, verbose_name="Là ngày làm việc")
    allow_voluntary_work = models.BooleanField(default=True, verbose_name="Cho phép làm việc tự nguyện")
    overtime_multiplier = models.DecimalField(max_digits=3, decimal_places=2, default=3.0,
                                             verbose_name="Hệ số làm thêm")
    
    # Áp dụng cho
    apply_to_all = models.BooleanField(default=True, verbose_name="Áp dụng cho tất cả")
    excluded_departments = models.ManyToManyField('employee.Department', blank=True,
                                                 related_name='excluded_holidays', verbose_name="Phòng ban không áp dụng")
    excluded_positions = models.ManyToManyField('employee.Position', blank=True,
                                               related_name='excluded_holidays', verbose_name="Vị trí không áp dụng")
    excluded_employees = models.ManyToManyField(Employee, blank=True,
                                               related_name='excluded_holidays', verbose_name="Nhân viên không áp dụng")
    
    # Thông tin bổ sung
    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    
    # Trạng thái
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_holiday_configs', verbose_name="Người tạo")
    
    def __str__(self):
        return f"{self.name} - {self.holiday_date}"
    
    class Meta:
        verbose_name = "Cấu hình ngày lễ"
        verbose_name_plural = "Cấu hình ngày lễ"
        ordering = ['holiday_date']
        unique_together = ['holiday_date', 'name']
    
    def save(self, *args, **kwargs):
        """Tự động điều chỉnh ngày lễ nếu là ngày lễ lặp lại"""
        super().save(*args, **kwargs)
    
    @property
    def is_today(self):
        """Kiểm tra xem có phải là ngày lễ hôm nay không"""
        today = timezone.now().date()
        if self.is_recurring:
            # So sánh tháng và ngày (bỏ qua năm)
            return self.holiday_date.month == today.month and self.holiday_date.day == today.day
        else:
            return self.holiday_date == today
    
    def should_apply_to_employee(self, employee):
        """Kiểm tra xem ngày lễ có áp dụng cho nhân viên không"""
        if not self.is_active:
            return False
        
        # Nếu áp dụng cho tất cả, kiểm tra xem nhân viên có bị loại trừ không
        if self.apply_to_all:
            # Kiểm tra phòng ban bị loại trừ
            if employee.department and self.excluded_departments.filter(id=employee.department.id).exists():
                return False
            
            # Kiểm tra vị trí bị loại trừ
            if employee.position and self.excluded_positions.filter(id=employee.position.id).exists():
                return False
            
            # Kiểm tra nhân viên bị loại trừ
            if self.excluded_employees.filter(id=employee.id).exists():
                return False
            
            return True
        
        # Nếu không áp dụng cho tất cả, mặc định là không áp dụng
        # (trừ khi có logic cụ thể khác)
        return False
    
    @property
    def is_holiday_today(self):
        """Kiểm tra xem hôm nay có phải là ngày lễ không"""
        return self.is_today
    
    def get_working_status_for_employee(self, employee):
        """Lấy trạng thái làm việc cho nhân viên trong ngày lễ"""
        if not self.should_apply_to_employee(employee):
            # Nếu không áp dụng, trả về trạng thái làm việc bình thường
            return {
                'is_holiday': False,
                'is_working_day': True,
                'overtime_multiplier': 1.0,
                'notes': 'Ngày làm việc bình thường'
            }
        
        return {
            'is_holiday': True,
            'is_working_day': self.is_working_day,
            'allow_voluntary_work': self.allow_voluntary_work,
            'overtime_multiplier': float(self.overtime_multiplier),
            'notes': self.notes or f"Ngày lễ: {self.name}"
        }


# ======================
# COMPANY INFORMATION MODELS
# ======================

COMPANY_DOCUMENT_TYPE = [
    ('TRAINING', 'Tài liệu đào tạo hội nhập'),
    ('ANNOUNCEMENT', 'Thông báo, quyết định ban hành'),
    ('REGULATION', 'Nội quy công ty'),
    ('FORM', 'Mẫu giấy tờ nội bộ'),
    ('PROCEDURE', 'Quy trình làm việc các bộ phận'),
    ('OTHER', 'Khác'),
]

COMPANY_DOCUMENT_STATUS = [
    ('DRAFT', 'Nháp'),
    ('PUBLISHED', 'Đã công bố'),
    ('ARCHIVED', 'Đã lưu trữ'),
    ('EXPIRED', 'Hết hiệu lực'),
]

ACCESS_LEVEL = [
    ('PUBLIC', 'Công khai'),
    ('INTERNAL', 'Nội bộ'),
    ('RESTRICTED', 'Hạn chế'),
    ('CONFIDENTIAL', 'Bảo mật'),
]


class CompanyDocument(models.Model):
    """Tài liệu công ty"""
    document_code = models.CharField(max_length=64, unique=True, verbose_name="Mã tài liệu")
    title = models.CharField(max_length=255, verbose_name="Tiêu đề")
    document_type = models.CharField(max_length=20, choices=COMPANY_DOCUMENT_TYPE, verbose_name="Loại tài liệu")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    
    # File tài liệu
    file = models.FileField(upload_to='company/documents/', verbose_name="File tài liệu")
    file_name = models.CharField(max_length=255, verbose_name="Tên file")
    file_size = models.IntegerField(verbose_name="Kích thước file (bytes)")
    file_type = models.CharField(max_length=50, verbose_name="Loại file")
    
    # Thông tin xuất bản
    version = models.CharField(max_length=20, default='1.0', verbose_name="Phiên bản")
    effective_from = models.DateField(verbose_name="Có hiệu lực từ")
    effective_to = models.DateField(null=True, blank=True, verbose_name="Có hiệu lực đến")
    
    # Trạng thái và quyền truy cập
    status = models.CharField(max_length=20, choices=COMPANY_DOCUMENT_STATUS, default='DRAFT', verbose_name="Trạng thái")
    access_level = models.CharField(max_length=20, choices=ACCESS_LEVEL, default='INTERNAL', verbose_name="Mức độ truy cập")
    
    # Phân loại
    department = models.ForeignKey('employee.Department', on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='company_documents', verbose_name="Phòng ban liên quan")
    tags = models.JSONField(default=list, blank=True, verbose_name="Tags")
    
    # Thông tin người tạo
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_company_documents', verbose_name="Người tạo")
    published_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='published_company_documents', verbose_name="Người công bố")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm công bố")
    
    def __str__(self):
        return f"{self.document_code} - {self.title}"
    
    class Meta:
        verbose_name = "Tài liệu công ty"
        verbose_name_plural = "Tài liệu công ty"
        ordering = ['-effective_from', 'document_code']
        indexes = [
            models.Index(fields=['document_type']),
            models.Index(fields=['status']),
            models.Index(fields=['access_level']),
            models.Index(fields=['department']),
            models.Index(fields=['effective_from']),
        ]
    
    def clean(self):
        """Validate date range"""
        if self.effective_to and self.effective_from:
            if self.effective_to < self.effective_from:
                raise ValidationError("Ngày hiệu lực đến phải sau ngày hiệu lực từ")
    
    def save(self, *args, **kwargs):
        """Tự động tạo mã tài liệu"""
        if not self.document_code:
            timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
            self.document_code = f"DOC-{timestamp}"
        
        # Tự động lấy thông tin file
        if self.file:
            self.file_name = self.file.name
            self.file_size = self.file.size
            # Lấy loại file từ extension
            import os
            _, ext = os.path.splitext(self.file.name)
            self.file_type = ext.lower().replace('.', '') if ext else 'unknown'
        
        super().save(*args, **kwargs)
    
    @property
    def is_current(self):
        """Kiểm tra xem tài liệu có đang hiệu lực không"""
        today = timezone.now().date()
        if self.status == 'PUBLISHED' and self.effective_from <= today:
            if not self.effective_to or self.effective_to >= today:
                return True
        return False
    
    def publish(self, published_by_employee):
        """Công bố tài liệu"""
        if self.status == 'DRAFT':
            self.status = 'PUBLISHED'
            self.published_by = published_by_employee
            self.published_at = timezone.now()
            self.save()
            return True
        return False
    
    def archive(self):
        """Lưu trữ tài liệu"""
        if self.status == 'PUBLISHED':
            self.status = 'ARCHIVED'
            self.save()
            return True
        return False
    
    def can_access(self, employee):
        """Kiểm tra xem nhân viên có thể truy cập tài liệu không"""
        if self.access_level == 'PUBLIC':
            return True
        
        if self.access_level == 'INTERNAL':
            return True  # Tất cả nhân viên nội bộ
        
        if self.access_level == 'RESTRICTED':
            # Chỉ nhân viên trong phòng ban liên quan
            if self.department and employee.department == self.department:
                return True
            return False
        
        if self.access_level == 'CONFIDENTIAL':
            # Chỉ người tạo và quản lý
            if self.created_by == employee or employee.is_management:
                return True
            return False
        
        return False


class CompanyAnnouncement(models.Model):
    """Thông báo, quyết định công ty"""
    announcement_code = models.CharField(max_length=64, unique=True, verbose_name="Mã thông báo")
    title = models.CharField(max_length=255, verbose_name="Tiêu đề")
    content = models.TextField(verbose_name="Nội dung")
    
    # Loại thông báo
    announcement_type = models.CharField(max_length=20, choices=[
        ('ANNOUNCEMENT', 'Thông báo'),
        ('DECISION', 'Quyết định'),
        ('NOTICE', 'Thông cáo'),
        ('CIRCULAR', 'Thông tư'),
        ('DIRECTIVE', 'Chỉ thị'),
        ('OTHER', 'Khác'),
    ], default='ANNOUNCEMENT', verbose_name="Loại thông báo")
    
    # Mức độ quan trọng
    priority = models.CharField(max_length=20, choices=[
        ('LOW', 'Thấp'),
        ('MEDIUM', 'Trung bình'),
        ('HIGH', 'Cao'),
        ('URGENT', 'Khẩn cấp'),
    ], default='MEDIUM', verbose_name="Mức độ ưu tiên")
    
    # Phạm vi áp dụng
    apply_to_all = models.BooleanField(default=True, verbose_name="Áp dụng cho tất cả")
    departments = models.ManyToManyField('employee.Department', blank=True,
                                        related_name='announcements', verbose_name="Phòng ban áp dụng")
    positions = models.ManyToManyField('employee.Position', blank=True,
                                      related_name='announcements', verbose_name="Vị trí áp dụng")
    employees = models.ManyToManyField(Employee, blank=True,
                                      related_name='announcements', verbose_name="Nhân viên áp dụng")
    
    # File đính kèm
    attachment = models.FileField(upload_to='company/announcements/', blank=True, null=True,
                                 max_length=500, verbose_name="File đính kèm")
    
    # Thông tin xuất bản
    effective_from = models.DateField(verbose_name="Có hiệu lực từ")
    effective_to = models.DateField(null=True, blank=True, verbose_name="Có hiệu lực đến")
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    
    # Thông tin người tạo
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_announcements', verbose_name="Người tạo")
    approved_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='approved_announcements', verbose_name="Người phê duyệt")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm công bố")
    
    def __str__(self):
        return f"{self.announcement_code} - {self.title}"
    
    class Meta:
        verbose_name = "Thông báo công ty"
        verbose_name_plural = "Thông báo công ty"
        ordering = ['-effective_from', '-priority']
        indexes = [
            models.Index(fields=['announcement_type']),
            models.Index(fields=['priority']),
            models.Index(fields=['is_active']),
            models.Index(fields=['effective_from']),
        ]
    
    def clean(self):
        """Validate date range"""
        if self.effective_to and self.effective_from:
            if self.effective_to < self.effective_from:
                raise ValidationError("Ngày hiệu lực đến phải sau ngày hiệu lực từ")
    
    def save(self, *args, **kwargs):
        """Tự động tạo mã thông báo"""
        if not self.announcement_code:
            import uuid

            timestamp = timezone.now().strftime('%Y%m%d%H%M%S%f')
            announcement_code = f"ANN-{timestamp}-{uuid.uuid4().hex[:8].upper()}"
            while CompanyAnnouncement.objects.filter(announcement_code=announcement_code).exists():
                announcement_code = f"ANN-{timestamp}-{uuid.uuid4().hex[:8].upper()}"
            self.announcement_code = announcement_code
        
        super().save(*args, **kwargs)
    
    @property
    def is_current(self):
        """Kiểm tra xem thông báo có đang hiệu lực không"""
        today = timezone.now().date()
        if self.is_active and self.effective_from <= today:
            if not self.effective_to or self.effective_to >= today:
                return True
        return False
    
    def should_apply_to_employee(self, employee):
        """Kiểm tra xem thông báo có áp dụng cho nhân viên không"""
        if not self.is_active:
            return False
        
        if self.apply_to_all:
            return True
        
        # Kiểm tra phòng ban
        if self.departments.exists() and employee.department in self.departments.all():
            return True
        
        # Kiểm tra vị trí
        if self.positions.exists() and employee.position in self.positions.all():
            return True
        
        # Kiểm tra nhân viên cụ thể
        if self.employees.exists() and employee in self.employees.all():
            return True
        
        return False
    
    def publish(self, approved_by_employee=None):
        """Công bố thông báo"""
        if not self.published_at:
            self.published_at = timezone.now()
            if approved_by_employee:
                self.approved_by = approved_by_employee
            self.save()
            return True
        return False


class CompanyDocumentViewLog(models.Model):
    """Lịch sử xem tài liệu công ty"""
    document = models.ForeignKey(CompanyDocument, on_delete=models.CASCADE, related_name='view_logs',
                                verbose_name="Tài liệu")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='document_views',
                                verbose_name="Nhân viên")
    
    # Thông tin xem
    viewed_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời điểm xem")
    duration_seconds = models.IntegerField(default=0, verbose_name="Thời gian xem (giây)")
    page_count = models.IntegerField(default=1, verbose_name="Số trang đã xem")
    
    # Thông tin thiết bị
    user_agent = models.TextField(blank=True, verbose_name="User Agent")
    ip_address = models.GenericIPAddressField(null=True, blank=True, verbose_name="Địa chỉ IP")
    
    class Meta:
        verbose_name = "Lịch sử xem tài liệu"
        verbose_name_plural = "Lịch sử xem tài liệu"
        ordering = ['-viewed_at']
        indexes = [
            models.Index(fields=['document', 'employee']),
            models.Index(fields=['viewed_at']),
        ]
        unique_together = ['document', 'employee', 'viewed_at']
    
    def __str__(self):
        return f"{self.employee.full_name} xem {self.document.title}"


class CompanyAnnouncementViewLog(models.Model):
    """Lịch sử xem thông báo công ty"""
    announcement = models.ForeignKey(CompanyAnnouncement, on_delete=models.CASCADE, related_name='view_logs',
                                    verbose_name="Thông báo")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='announcement_views',
                                null=True, blank=True, verbose_name="Nhân viên")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='company_announcement_views',
                             null=True, blank=True, verbose_name="Tài khoản")
    
    # Thông tin xem
    viewed_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời điểm xem")
    duration_seconds = models.IntegerField(default=0, verbose_name="Thời gian xem (giây)")
    
    # Xác nhận đã đọc
    acknowledged = models.BooleanField(default=False, verbose_name="Đã xác nhận đọc")
    acknowledged_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm xác nhận")
    
    # Thông tin thiết bị
    user_agent = models.TextField(blank=True, verbose_name="User Agent")
    ip_address = models.GenericIPAddressField(null=True, blank=True, verbose_name="Địa chỉ IP")
    
    class Meta:
        verbose_name = "Lịch sử xem thông báo"
        verbose_name_plural = "Lịch sử xem thông báo"
        ordering = ['-viewed_at']
        indexes = [
            models.Index(fields=['announcement', 'employee']),
            models.Index(fields=['viewed_at']),
            models.Index(fields=['acknowledged']),
        ]
        unique_together = ['announcement', 'employee', 'viewed_at']
    
    def __str__(self):
        viewer_name = self.employee.full_name if self.employee else (self.user.username if self.user else 'Ẩn danh')
        return f"{viewer_name} xem {self.announcement.title}"
    
    def acknowledge(self):
        """Xác nhận đã đọc thông báo"""
        if not self.acknowledged:
            self.acknowledged = True
            self.acknowledged_at = timezone.now()
            self.save()
            return True
        return False


class CompanyAnnouncementAttachment(models.Model):
    announcement = models.ForeignKey(
        CompanyAnnouncement, on_delete=models.CASCADE, related_name='attachments'
    )
    file = models.FileField(upload_to='company/announcements/', max_length=500, blank=True)
    file_name = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['uploaded_at']

    def __str__(self):
        return self.file_name


# ======================
# EMPLOYEE PERMISSION MODELS
# ======================

class EmployeePermission(models.Model):
    """Phân quyền cho nhân viên - Quyền hạn đặc biệt trong hệ thống HRM"""
    employee = models.OneToOneField(Employee, on_delete=models.CASCADE, related_name='permissions',
                                   verbose_name="Nhân viên")
    
    # Quyền phê duyệt
    can_approve_attendance = models.BooleanField(default=False, verbose_name="Quyền phê duyệt công")
    can_approve_leave = models.BooleanField(default=False, verbose_name="Quyền phê duyệt nghỉ phép")
    can_approve_overtime = models.BooleanField(default=False, verbose_name="Quyền phê duyệt làm thêm giờ")
    
    # Quyền quản lý nhân sự
    can_create_employee = models.BooleanField(default=False, verbose_name="Quyền tạo nhân viên")
    can_edit_employee = models.BooleanField(default=False, verbose_name="Quyền chỉnh sửa thông tin nhân viên")
    can_view_all_employees = models.BooleanField(default=False, verbose_name="Quyền xem tất cả nhân viên")
    
    # Quyền quản lý chấm công
    can_manage_attendance = models.BooleanField(default=False, verbose_name="Quyền quản lý chấm công")
    can_import_attendance = models.BooleanField(default=False, verbose_name="Quyền import chấm công")
    can_adjust_attendance = models.BooleanField(default=False, verbose_name="Quyền điều chỉnh chấm công")
    can_edit_attendance = models.BooleanField(default=False, verbose_name="Quyền sửa dữ liệu chấm công")
    
    # Quyền quản lý tài sản
    can_manage_assets = models.BooleanField(default=False, verbose_name="Quyền quản lý tài sản")
    can_assign_assets = models.BooleanField(default=False, verbose_name="Quyền gán tài sản")
    can_approve_asset_requests = models.BooleanField(default=False, verbose_name="Quyền phê duyệt yêu cầu tài sản")
    
    # Quyền quản lý phòng ban
    can_manage_departments = models.BooleanField(default=False, verbose_name="Quyền quản lý phòng ban")
    can_manage_positions = models.BooleanField(default=False, verbose_name="Quyền quản lý vị trí")
    
    # Quyền cấu hình hệ thống
    can_manage_company_config = models.BooleanField(default=False, verbose_name="Quyền quản lý cấu hình công ty")
    can_manage_attendance_rules = models.BooleanField(default=False, verbose_name="Quyền quản lý quy tắc chấm công")
    can_manage_leave_policies = models.BooleanField(default=False, verbose_name="Quyền quản lý chính sách nghỉ phép")
    
    # Quyền báo cáo
    can_view_reports = models.BooleanField(default=False, verbose_name="Quyền xem báo cáo")
    can_export_reports = models.BooleanField(default=False, verbose_name="Quyền xuất báo cáo")

    # Quyền quản lý phê duyệt chốt công
    can_manage_attendance_finalization_approval = models.BooleanField(
        default=False, verbose_name="Quyền quản lý phê duyệt chốt công"
    )

    # Quyền quản lý phạt biên bản
    can_manage_disciplinary_penalties = models.BooleanField(
        default=False, verbose_name="Quyền ghi nhận / quản lý phạt biên bản"
    )

    # Quyền xem tạm ứng lương (vd: Kế toán trưởng cần xem tab "Đã duyệt" như HR)
    can_view_salary_advance = models.BooleanField(
        default=False, verbose_name="Quyền xem tạm ứng lương"
    )

    # Quyền Tuyển dụng (thao tác tương tự role is_manager ở page Tuyển dụng:
    # xem group "Tuyển dụng" + tab "Nhu cầu tuyển dụng" + "Phỏng vấn")
    can_manage_recruitment = models.BooleanField(
        default=False, verbose_name="Quyền Tuyển dụng"
    )

    # Quyền xem các tab trên trang Dashboard
    can_view_dashboard_overview = models.BooleanField(
        default=False, verbose_name="Xem tab Tổng quan"
    )
    can_view_dashboard_employee = models.BooleanField(
        default=False, verbose_name="Xem tab Nhân viên"
    )
    can_view_dashboard_recruitment = models.BooleanField(
        default=False, verbose_name="Xem tab Tuyển dụng"
    )
    can_view_dashboard_insurance = models.BooleanField(
        default=False, verbose_name="Xem tab BHXH"
    )
    can_view_dashboard_asset = models.BooleanField(
        default=False, verbose_name="Xem tab Tài sản"
    )

    # Ghi chú
    notes = models.TextField(blank=True, verbose_name="Ghi chú về quyền hạn")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_permissions', verbose_name="Người tạo quyền")
    
    def __str__(self):
        return f"Quyền hạn của {self.employee.full_name}"
    
    class Meta:
        verbose_name = "Quyền hạn nhân viên"
        verbose_name_plural = "Quyền hạn nhân viên"
        ordering = ['employee__employee_id']
    
    def save(self, *args, **kwargs):
        """Tự động tạo quyền hạn mặc định cho nhân viên HR"""
        # Nếu nhân viên là HR và chưa có quyền, tự động gán một số quyền cơ bản
        if self.employee.is_hr and not self.pk:
            if not any([
                self.can_approve_attendance,
                self.can_create_employee,
                self.can_manage_attendance,
                self.can_manage_assets
            ]):
                self.can_approve_attendance = True
                self.can_create_employee = True
                self.can_manage_attendance = True
                self.can_manage_assets = True
                self.can_view_all_employees = True
                self.can_manage_departments = True
                self.can_manage_positions = True
        
        super().save(*args, **kwargs)
    
    @property
    def has_any_permission(self):
        """Kiểm tra xem nhân viên có bất kỳ quyền nào không"""
        permission_fields = [
            'can_approve_attendance', 'can_approve_leave', 'can_approve_overtime',
            'can_create_employee', 'can_edit_employee', 'can_view_all_employees',
            'can_manage_attendance', 'can_import_attendance', 'can_adjust_attendance', 'can_edit_attendance',
            'can_manage_assets', 'can_assign_assets', 'can_approve_asset_requests',
            'can_manage_departments', 'can_manage_positions',
            'can_manage_company_config', 'can_manage_attendance_rules', 'can_manage_leave_policies',
            'can_view_reports', 'can_export_reports',
            'can_manage_attendance_finalization_approval',
            'can_manage_disciplinary_penalties',
            'can_view_salary_advance',
            'can_manage_recruitment',
        ]
        
        return any(getattr(self, field) for field in permission_fields)
    
    def get_permission_summary(self):
        """Lấy tóm tắt quyền hạn"""
        permissions = []

        if self.can_approve_attendance:
            permissions.append("Phê duyệt công")
        if self.can_create_employee:
            permissions.append("Tạo nhân viên")
        if self.can_manage_attendance:
            permissions.append("Quản lý chấm công")
        if self.can_edit_attendance:
            permissions.append("Sửa dữ liệu chấm công")
        if self.can_manage_assets:
            permissions.append("Quản lý tài sản")

        # Thêm các quyền khác nếu có
        if self.can_approve_leave:
            permissions.append("Phê duyệt nghỉ phép")
        if self.can_approve_overtime:
            permissions.append("Phê duyệt làm thêm giờ")
        if self.can_manage_departments:
            permissions.append("Quản lý phòng ban")
        if self.can_manage_disciplinary_penalties:
            permissions.append("Quản lý phạt biên bản")
        if self.can_view_salary_advance:
            permissions.append("Xem tạm ứng lương")
        if self.can_manage_recruitment:
            permissions.append("Quyền Tuyển dụng")

        # Quyền xem tab Dashboard (mới thêm)
        if self.can_view_dashboard_overview:
            permissions.append("Dashboard: Tổng quan")
        if self.can_view_dashboard_employee:
            permissions.append("Dashboard: Nhân viên")
        if self.can_view_dashboard_recruitment:
            permissions.append("Dashboard: Tuyển dụng")
        if self.can_view_dashboard_insurance:
            permissions.append("Dashboard: BHXH")
        if self.can_view_dashboard_asset:
            permissions.append("Dashboard: Tài sản")

        return ", ".join(permissions) if permissions else "Không có quyền đặc biệt"


# ======================
# ATTENDANCE RULE CONFIGURATION MODELS
# ======================

ATTENDANCE_RULE_TYPE = [
    ('SHIFT_RULE', 'Quy tắc ca làm'),
    ('LEAVE_POLICY', 'Chính sách nghỉ phép'),
    ('WORK_HOUR_CALCULATION', 'Tính toán giờ làm'),
    ('OVERTIME_RULE', 'Quy tắc làm thêm giờ'),
    ('LATE_EARLY_RULE', 'Quy tắc đi muộn/về sớm'),
]

class AttendanceRuleConfig(models.Model):
    """
    Cấu hình quy tắc chấm công linh hoạt
    """
    name = models.CharField(max_length=255, verbose_name="Tên quy tắc")
    code = models.CharField(max_length=64, unique=True, verbose_name="Mã quy tắc")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    
    # Loại quy tắc
    rule_type = models.CharField(max_length=30, choices=ATTENDANCE_RULE_TYPE, verbose_name="Loại quy tắc")
    
    # Cấu hình chi tiết (JSON field để linh hoạt)
    configuration = models.JSONField(default=dict, verbose_name="Cấu hình chi tiết")
    
    # Áp dụng cho
    apply_to_all = models.BooleanField(default=True, verbose_name="Áp dụng cho tất cả")
    apply_to_departments = models.ManyToManyField('employee.Department', blank=True,
                                                 related_name='attendance_rules', verbose_name="Áp dụng cho phòng ban")
    apply_to_positions = models.ManyToManyField('employee.Position', blank=True,
                                               related_name='attendance_rules', verbose_name="Áp dụng cho vị trí")
    apply_to_employees = models.ManyToManyField(Employee, blank=True,
                                               related_name='attendance_rules', verbose_name="Áp dụng cho nhân viên")
    
    # Hiệu lực
    effective_from = models.DateField(verbose_name="Có hiệu lực từ")
    effective_to = models.DateField(null=True, blank=True, verbose_name="Có hiệu lực đến")
    
    # Trạng thái
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    is_default = models.BooleanField(default=False, verbose_name="Quy tắc mặc định")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_attendance_rules', verbose_name="Người tạo")
    
    def __str__(self):
        return f"{self.code} - {self.name}"
    
    class Meta:
        verbose_name = "Cấu hình quy tắc chấm công"
        verbose_name_plural = "Cấu hình quy tắc chấm công"
        ordering = ['-effective_from', 'code']
        indexes = [
            models.Index(fields=['rule_type']),
            models.Index(fields=['is_active']),
            models.Index(fields=['effective_from']),
        ]
    
    def clean(self):
        """Validate date range"""
        if self.effective_to and self.effective_from:
            if self.effective_to < self.effective_from:
                raise ValidationError("Ngày hiệu lực đến phải sau ngày hiệu lực từ")
    
    def save(self, *args, **kwargs):
        """Tự động tạo mã quy tắc"""
        if not self.code:
            timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
            self.code = f"RULE-{timestamp}"
        super().save(*args, **kwargs)
    
    @property
    def is_current(self):
        """Kiểm tra xem quy tắc có đang hiệu lực không"""
        today = timezone.now().date()
        if self.is_active and self.effective_from <= today:
            if not self.effective_to or self.effective_to >= today:
                return True
        return False
    
    def should_apply_to_employee(self, employee):
        """Kiểm tra xem quy tắc có áp dụng cho nhân viên không"""
        if not self.is_active:
            return False
        
        if self.apply_to_all:
            return True
        
        # Kiểm tra phòng ban
        if self.apply_to_departments.exists() and employee.department in self.apply_to_departments.all():
            return True
        
        # Kiểm tra vị trí
        if self.apply_to_positions.exists() and employee.position in self.apply_to_positions.all():
            return True
        
        # Kiểm tra nhân viên cụ thể
        if self.apply_to_employees.exists() and employee in self.apply_to_employees.all():
            return True
        
        return False
    
    def get_configuration_for_employee(self, employee):
        """Lấy cấu hình áp dụng cho nhân viên"""
        if not self.should_apply_to_employee(employee):
            return None
        
        return self.configuration


class AttendanceRuleHistory(models.Model):
    """
    Lịch sử áp dụng quy tắc chấm công
    """
    attendance = models.ForeignKey(Attendance, on_delete=models.CASCADE, related_name='rule_history',
                                  verbose_name="Chấm công")
    rule = models.ForeignKey(AttendanceRuleConfig, on_delete=models.CASCADE, related_name='applied_history',
                            verbose_name="Quy tắc áp dụng")
    
    # Kết quả áp dụng
    applied_configuration = models.JSONField(default=dict, verbose_name="Cấu hình đã áp dụng")
    calculation_result = models.JSONField(default=dict, verbose_name="Kết quả tính toán")
    
    # Thông tin hệ thống
    applied_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời điểm áp dụng")
    applied_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='applied_attendance_rules', verbose_name="Người áp dụng")
    
    def __str__(self):
        return f"{self.attendance.attendance_code} - {self.rule.code}"
    
    class Meta:
        verbose_name = "Lịch sử áp dụng quy tắc"
        verbose_name_plural = "Lịch sử áp dụng quy tắc"
        ordering = ['-applied_at']
        indexes = [
            models.Index(fields=['attendance', 'rule']),
            models.Index(fields=['applied_at']),
        ]


class LeavePolicyConfig(models.Model):
    """
    Cấu hình chính sách nghỉ phép
    """
    name = models.CharField(max_length=255, verbose_name="Tên chính sách")
    code = models.CharField(max_length=64, unique=True, verbose_name="Mã chính sách")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    
    # Loại nghỉ phép
    leave_type = models.CharField(max_length=20, choices=LEAVE_TYPE, verbose_name="Loại nghỉ phép")
    
    # Yêu cầu báo trước (JSON để linh hoạt)
    advance_notice_rules = models.JSONField(default=list, verbose_name="Quy định báo trước")
    # Ví dụ: [
    #   {"max_days": 1, "advance_hours": 4, "advance_days": null, "description": "Nghỉ dưới 1 ngày: báo trước 4 giờ làm việc"},
    #   {"max_days": 3, "advance_hours": null, "advance_days": 1, "description": "Nghỉ từ 1-3 ngày: báo trước 1 ngày làm việc"},
    #   {"max_days": 7, "advance_hours": null, "advance_days": 5, "description": "Nghỉ từ 4-7 ngày: báo trước 5 ngày làm việc"},
    #   {"max_days": null, "advance_hours": null, "advance_days": 10, "description": "Nghỉ từ 8 ngày trở lên: báo trước 10 ngày làm việc"}
    # ]
    
    # Trường hợp khẩn cấp
    emergency_notice_hours = models.IntegerField(default=2, verbose_name="Báo trước trường hợp khẩn cấp (giờ)")
    
    # Yêu cầu tài liệu
    requires_medical_certificate = models.BooleanField(default=False, verbose_name="Yêu cầu giấy khám bệnh")
    requires_approval = models.BooleanField(default=True, verbose_name="Yêu cầu phê duyệt")
    
    # Số ngày tối đa
    max_days_per_year = models.IntegerField(null=True, blank=True, verbose_name="Số ngày tối đa mỗi năm")
    max_consecutive_days = models.IntegerField(null=True, blank=True, verbose_name="Số ngày liên tiếp tối đa")
    
    # Áp dụng cho
    apply_to_all = models.BooleanField(default=True, verbose_name="Áp dụng cho tất cả")
    apply_to_departments = models.ManyToManyField('employee.Department', blank=True,
                                                 related_name='leave_policies', verbose_name="Áp dụng cho phòng ban")
    apply_to_positions = models.ManyToManyField('employee.Position', blank=True,
                                               related_name='leave_policies', verbose_name="Áp dụng cho vị trí")
    apply_to_employees = models.ManyToManyField(Employee, blank=True,
                                               related_name='leave_policies', verbose_name="Áp dụng cho nhân viên")
    
    # Hiệu lực
    effective_from = models.DateField(verbose_name="Có hiệu lực từ")
    effective_to = models.DateField(null=True, blank=True, verbose_name="Có hiệu lực đến")
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_leave_policies', verbose_name="Người tạo")
    
    def __str__(self):
        return f"{self.code} - {self.name}"
    
    class Meta:
        verbose_name = "Cấu hình chính sách nghỉ phép"
        verbose_name_plural = "Cấu hình chính sách nghỉ phép"
        ordering = ['-effective_from', 'code']
    
    def clean(self):
        """Validate date range"""
        if self.effective_to and self.effective_from:
            if self.effective_to < self.effective_from:
                raise ValidationError("Ngày hiệu lực đến phải sau ngày hiệu lực từ")
    
    def save(self, *args, **kwargs):
        """Tự động tạo mã chính sách"""
        if not self.code:
            timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
            self.code = f"LEAVE-{timestamp}"
        super().save(*args, **kwargs)
    
    @property
    def is_current(self):
        """Kiểm tra xem chính sách có đang hiệu lực không"""
        today = timezone.now().date()
        if self.is_active and self.effective_from <= today:
            if not self.effective_to or self.effective_to >= today:
                return True
        return False
    
    def should_apply_to_employee(self, employee):
        """Kiểm tra xem chính sách có áp dụng cho nhân viên không"""
        if not self.is_active:
            return False
        
        if self.apply_to_all:
            return True
        
        # Kiểm tra phòng ban
        if self.apply_to_departments.exists() and employee.department in self.apply_to_departments.all():
            return True
        
        # Kiểm tra vị trí
        if self.apply_to_positions.exists() and employee.position in self.apply_to_positions.all():
            return True
        
        # Kiểm tra nhân viên cụ thể
        if self.apply_to_employees.exists() and employee in self.apply_to_employees.all():
            return True
        
        return False
    
    def validate_leave_request(self, leave_request, employee):
        """Validate đơn xin nghỉ dựa trên chính sách"""
        if not self.should_apply_to_employee(employee):
            return {
                'valid': False,
                'errors': ['Chính sách không áp dụng cho nhân viên này']
            }
        
        errors = []
        warnings = []
        
        # Kiểm tra số ngày nghỉ
        total_days = leave_request.total_days
        if self.max_days_per_year and total_days > self.max_days_per_year:
            errors.append(f"Số ngày nghỉ ({total_days}) vượt quá giới hạn năm ({self.max_days_per_year} ngày)")
        
        if self.max_consecutive_days and total_days > self.max_consecutive_days:
            errors.append(f"Số ngày nghỉ liên tiếp ({total_days}) vượt quá giới hạn ({self.max_consecutive_days} ngày)")
        
        # Kiểm tra yêu cầu giấy khám bệnh
        if self.requires_medical_certificate and leave_request.leave_type == 'SICK':
            if total_days >= self.medical_certificate_days_threshold:
                if not leave_request.medical_certificate:
                    errors.append(f"Yêu cầu giấy khám bệnh cho nghỉ ốm từ {self.medical_certificate_days_threshold} ngày trở lên")
        
        return {
            'valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings
        }


# ======================
# MONTHLY WORK CREDIT CALCULATION MODELS
# ======================

WORK_CREDIT_STATUS = [
    ('DRAFT', 'Nháp'),
    ('CALCULATING', 'Đang tính toán'),
    ('CALCULATED', 'Đã tính toán'),
    ('APPROVED', 'Đã duyệt'),
    ('REJECTED', 'Từ chối'),
    ('PAID', 'Đã thanh toán'),
]

class MonthlyWorkCredit(models.Model):
    """
    Bản ghi tính công hàng tháng cho nhân viên
    """
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='monthly_work_credits',
                                verbose_name="Nhân viên")
    
    # Thông tin tháng/năm
    year = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")
    
    # Mã bản ghi
    credit_code = models.CharField(max_length=64, unique=True, verbose_name="Mã tính công")
    
    # Trạng thái
    status = models.CharField(max_length=20, choices=WORK_CREDIT_STATUS, default='DRAFT', verbose_name="Trạng thái")
    
    # Thông tin tính toán
    total_work_days = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Tổng số ngày công")
    total_work_hours = models.DecimalField(max_digits=7, decimal_places=2, default=0, verbose_name="Tổng số giờ công")
    total_overtime_hours = models.DecimalField(max_digits=7, decimal_places=2, default=0, verbose_name="Tổng số giờ làm thêm")
    ot_weekday_hours = models.DecimalField(max_digits=7, decimal_places=2, default=0, verbose_name="Giờ OT ngày thường")
    ot_weekend_hours = models.DecimalField(max_digits=7, decimal_places=2, default=0, verbose_name="Giờ OT cuối tuần")
    ot_holiday_hours = models.DecimalField(max_digits=7, decimal_places=2, default=0, verbose_name="Giờ OT ngày lễ")
    total_late_minutes = models.IntegerField(default=0, verbose_name="Tổng số phút đi muộn")
    total_early_leave_minutes = models.IntegerField(default=0, verbose_name="Tổng số phút về sớm")
    
    # Livestream
    total_livestream_sessions = models.IntegerField(default=0, verbose_name="Tổng số phiên livestream")
    
    # Hệ số công
    work_coefficient = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Hệ số công")
    overtime_coefficient = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Hệ số làm thêm")
    
    # Thông tin nghỉ phép
    total_leave_days = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Tổng số ngày nghỉ")
    annual_leave_days = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Số ngày nghỉ phép năm")
    sick_leave_days = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Số ngày nghỉ ốm")
    unpaid_leave_days = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Số ngày nghỉ không lương")
    
    # Kết quả tính toán chi tiết (JSON)
    calculation_details = models.JSONField(default=dict, verbose_name="Chi tiết tính toán")
    applied_rules = models.JSONField(default=list, verbose_name="Quy tắc đã áp dụng")
    
    # Ghi chú
    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    
    # Thông tin duyệt
    approved_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='approved_work_credits', verbose_name="Người duyệt")
    approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm duyệt")
    approval_note = models.TextField(blank=True, verbose_name="Ghi chú duyệt")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    calculated_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm tính toán")
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_work_credits', verbose_name="Người tạo")
    
    def __str__(self):
        return f"Tính công {self.credit_code} - {self.employee.full_name} - {self.month}/{self.year}"
    
    class Meta:
        verbose_name = "Tính công hàng tháng"
        verbose_name_plural = "Tính công hàng tháng"
        ordering = ['-year', '-month', 'employee']
        unique_together = ['employee', 'year', 'month']
        indexes = [
            models.Index(fields=['employee', 'year', 'month']),
            models.Index(fields=['year', 'month']),
            models.Index(fields=['status']),
            models.Index(fields=['credit_code']),
        ]
    
    def clean(self):
        """Validate month and year"""
        if self.month < 1 or self.month > 12:
            raise ValidationError("Tháng phải từ 1 đến 12")
        
        if self.year < 2000 or self.year > 2100:
            raise ValidationError("Năm không hợp lệ")
    
    def save(self, *args, **kwargs):
        """Tự động tạo mã tính công"""
        if not self.credit_code:
            timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
            self.credit_code = f"CREDIT-{self.year}{self.month:02d}-{timestamp}"
        
        super().save(*args, **kwargs)
    
    @property
    def period(self):
        """Lấy chu kỳ tính công (YYYY-MM)"""
        return f"{self.year}-{self.month:02d}"
    
    @property
    def total_effective_work_days(self):
        """Tính tổng số ngày công hiệu quả (bao gồm hệ số)"""
        return self.total_work_days * self.work_coefficient
    
    def calculate_work_credit(self):
        """Tính toán công cho tháng"""
        from .rule_engine import AttendanceRuleEngine
        from datetime import datetime, timedelta
        
        # Lấy tất cả attendance trong tháng
        start_date = datetime(self.year, self.month, 1).date()
        if self.month == 12:
            end_date = datetime(self.year + 1, 1, 1).date() - timedelta(days=1)
        else:
            end_date = datetime(self.year, self.month + 1, 1).date() - timedelta(days=1)
        
        attendances = Attendance.objects.filter(
            employee=self.employee,
            attendance_date__gte=start_date,
            attendance_date__lte=end_date
        ).order_by('attendance_date')
        
        calculation_details = {
            'period': self.period,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'total_days': (end_date - start_date).days + 1,
            'attendances': [],
            'daily_calculations': [],
            'summary': {}
        }
        
        total_work_days = 0
        total_work_hours = 0
        total_overtime_hours = 0
        total_late_minutes = 0
        total_early_leave_minutes = 0
        total_work_coefficient = 0
        total_overtime_coefficient = 0
        
        applied_rules = []
        
        for attendance in attendances:
            # Áp dụng rule engine cho từng attendance
            calculation_result = AttendanceRuleEngine.apply_rules_to_attendance(attendance)
            
            # Cập nhật tổng
            total_work_days += 1 if calculation_result.get('work_coefficient', 0) >= 0.5 else 0
            total_work_hours += calculation_result.get('work_hours', 0)
            total_overtime_hours += calculation_result.get('overtime_hours', 0)
            total_late_minutes += calculation_result.get('late_minutes', 0)
            total_early_leave_minutes += calculation_result.get('early_leave_minutes', 0)
            total_work_coefficient += calculation_result.get('work_coefficient', 0)
            
            # Tính hệ số làm thêm
            overtime_hours = calculation_result.get('overtime_hours', 0)
            if overtime_hours > 0:
                # Giả sử hệ số làm thêm là 1.5 cho ngày thường
                total_overtime_coefficient += overtime_hours * 1.5 / 8  # Quy đổi sang công
            
            # Lưu chi tiết
            daily_calc = {
                'date': attendance.attendance_date.isoformat(),
                'attendance_id': attendance.id,
                'attendance_code': attendance.attendance_code,
                'check_in': attendance.check_in.isoformat() if attendance.check_in else None,
                'check_out': attendance.check_out.isoformat() if attendance.check_out else None,
                'status': attendance.status,
                'work_hours': float(attendance.working_hours),
                'work_coefficient': calculation_result.get('work_coefficient', 0),
                'overtime_hours': float(attendance.overtime_hours),
                'late_minutes': attendance.late_minutes,
                'early_leave_minutes': attendance.early_leave_minutes,
                'applied_rules': calculation_result.get('applied_rules', []),
                'notes': calculation_result.get('notes', [])
            }
            
            calculation_details['daily_calculations'].append(daily_calc)
            
            # Thu thập các rule đã áp dụng
            for rule_info in calculation_result.get('applied_rules', []):
                if rule_info not in applied_rules:
                    applied_rules.append(rule_info)
        
        # Tính tổng ngày nghỉ
        leave_requests = LeaveRequest.objects.filter(
            employee=self.employee,
            status='APPROVED',
            start_date__lte=end_date,
            end_date__gte=start_date
        )
        
        total_leave_days = 0
        annual_leave_days = 0
        sick_leave_days = 0
        unpaid_leave_days = 0
        
        for leave in leave_requests:
            # Tính số ngày nghỉ trong tháng
            overlap_start = max(leave.start_date, start_date)
            overlap_end = min(leave.end_date, end_date)
            overlap_days = (overlap_end - overlap_start).days + 1
            
            total_leave_days += overlap_days
            
            if leave.leave_type == 'ANNUAL':
                annual_leave_days += overlap_days
            elif leave.leave_type == 'SICK':
                sick_leave_days += overlap_days
            elif leave.leave_type == 'UNPAID':
                unpaid_leave_days += overlap_days
        
        # Cập nhật model
        self.total_work_days = total_work_days
        self.total_work_hours = total_work_hours
        self.total_overtime_hours = total_overtime_hours
        self.total_late_minutes = total_late_minutes
        self.total_early_leave_minutes = total_early_leave_minutes
        self.work_coefficient = total_work_coefficient
        self.overtime_coefficient = total_overtime_coefficient
        self.total_leave_days = total_leave_days
        self.annual_leave_days = annual_leave_days
        self.sick_leave_days = sick_leave_days
        self.unpaid_leave_days = unpaid_leave_days
        
        # Lưu chi tiết tính toán
        calculation_details['summary'] = {
            'total_work_days': float(total_work_days),
            'total_work_hours': float(total_work_hours),
            'total_overtime_hours': float(total_overtime_hours),
            'total_late_minutes': total_late_minutes,
            'total_early_leave_minutes': total_early_leave_minutes,
            'work_coefficient': float(total_work_coefficient),
            'overtime_coefficient': float(total_overtime_coefficient),
            'total_leave_days': float(total_leave_days),
            'annual_leave_days': float(annual_leave_days),
            'sick_leave_days': float(sick_leave_days),
            'unpaid_leave_days': float(unpaid_leave_days)
        }
        
        self.calculation_details = calculation_details
        self.applied_rules = applied_rules
        
        # Cập nhật trạng thái và thời gian
        self.status = 'CALCULATED'
        self.calculated_at = timezone.now()
        
        self.save()
        
        return {
            'success': True,
            'message': f'Đã tính công cho {self.employee.full_name} tháng {self.month}/{self.year}',
            'summary': calculation_details['summary']
        }
    
    def approve(self, approver, note=''):
        """Duyệt bản ghi tính công"""
        if self.status != 'CALCULATED':
            return {
                'success': False,
                'message': 'Chỉ có thể duyệt bản ghi đã tính toán'
            }
        
        self.status = 'APPROVED'
        self.approved_by = approver
        self.approved_at = timezone.now()
        self.approval_note = note
        self.save()
        
        return {
            'success': True,
            'message': f'Đã duyệt tính công {self.credit_code}'
        }
    
    def reject(self, approver, note=''):
        """Từ chối bản ghi tính công"""
        if self.status != 'CALCULATED':
            return {
                'success': False,
                'message': 'Chỉ có thể từ chối bản ghi đã tính toán'
            }
        
        self.status = 'REJECTED'
        self.approved_by = approver
        self.approved_at = timezone.now()
        self.approval_note = note
        self.save()
        
        return {
            'success': True,
            'message': f'Đã từ chối tính công {self.credit_code}'
        }


class WorkCreditCalculationLog(models.Model):
    """
    Lịch sử tính công
    """
    work_credit = models.ForeignKey(MonthlyWorkCredit, on_delete=models.CASCADE, related_name='calculation_logs',
                                   verbose_name="Bản ghi tính công")
    
    # Thông tin tính toán
    calculation_type = models.CharField(max_length=50, verbose_name="Loại tính toán")
    calculation_details = models.JSONField(default=dict, verbose_name="Chi tiết tính toán")
    calculation_result = models.JSONField(default=dict, verbose_name="Kết quả tính toán")
    
    # Thông tin hệ thống
    calculated_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời điểm tính toán")
    calculated_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name='calculated_work_credits', verbose_name="Người tính toán")
    
    def __str__(self):
        return f"Lịch sử tính công {self.work_credit.credit_code} - {self.calculation_type}"
    
    class Meta:
        verbose_name = "Lịch sử tính công"
        verbose_name_plural = "Lịch sử tính công"
        ordering = ['-calculated_at']
        indexes = [
            models.Index(fields=['work_credit', 'calculated_at']),
            models.Index(fields=['calculation_type']),
        ]
    
    @classmethod
    def create_log(cls, work_credit, calculation_type, calculation_details, calculation_result, calculated_by=None):
        """Tạo bản ghi lịch sử tính công"""
        return cls.objects.create(
            work_credit=work_credit,
            calculation_type=calculation_type,
            calculation_details=calculation_details,
            calculation_result=calculation_result,
            calculated_by=calculated_by
        )
# ======================
# ONBOARDING MODELS
# ======================

ONBOARDING_STATUS = [
    ('DRAFT', 'Nháp'),
    ('PENDING', 'Chờ xử lý'),
    ('IN_PROGRESS', 'Đang thực hiện'),
    ('COMPLETED', 'Hoàn thành'),
    ('CANCELLED', 'Đã hủy'),
]

ONBOARDING_PROGRESS = [
    ('RECEIVE_DOC', 'Tiếp nhận hồ sơ'),
    ('SIGN_CONTRACT', 'Ký hợp đồng'),
    ('TRAINING', 'Đào tạo'),
    ('HANDOVER', 'Bàn giao công việc'),
]

ONBOARDING_STAGE = [
    (1, 'Ứng viên mới'),
    (2, 'Đang onboarding'),
    (3, 'Hoàn thành'),
]

ONBOARDING_TASK_STATUS = [
    ('PENDING', 'Chờ thực hiện'),
    ('IN_PROGRESS', 'Đang thực hiện'),
    ('COMPLETED', 'Hoàn thành'),
    ('SKIPPED', 'Bỏ qua'),
]

# Cùng danh sách với hồ sơ nhân viên (employee.models.CONTRACT_TYPE).
CONTRACT_TYPE = list(EMPLOYEE_CONTRACT_TYPE)

# Loại của template / hợp đồng đã tạo: thêm Phụ lục hợp đồng. Không thêm vào
# CONTRACT_TYPE vì danh sách đó còn là loại HĐ của onboarding / hồ sơ nhân viên —
# nhân viên không có "loại HĐ = phụ lục".
CONTRACT_DOCUMENT_TYPE = CONTRACT_TYPE + [
    ('APPENDIX', 'Phụ lục hợp đồng'),
]


# Mã của quy trình chỉ tạo ra để NV đang làm (chưa từng onboarding trên hệ thống)
# tự cập nhật hồ sơ — ẩn khỏi danh sách / thống kê onboarding.
SELF_UPDATE_CODE_PREFIX = 'SELF-'

# Trường HCNS quản lý: link tự cập nhật hồ sơ không được nhận / ghi đè.
SELF_UPDATE_BLOCKED_FORM_FIELDS = (
    'salary', 'allowance', 'allowance_notes', 'probation_period_months', 'probation_rate',
    'company_unit', 'region', 'block', 'sub_department', 'section', 'team', 'position',
    'position_title', 'job_rank', 'rank', 'doctor_team', 'work_form', 'work_type', 'work_location',
    'employee_id', 'candidate_email',
)
SELF_UPDATE_KEPT_EMPLOYEE_FIELDS = (
    'position', 'department', 'region', 'block', 'section', 'rank', 'work_form', 'work_location',
    'doctor_team', 'basic_salary', 'allowance', 'allowance_notes', 'probation_months',
    'probation_end_date', 'official_start_date', 'probation_rate', 'extra_info',
)
SELF_UPDATE_KEPT_ONBOARDING_FIELDS = (
    'position', 'department', 'company_unit', 'rank', 'section', 'doctor_team', 'region', 'block',
    'work_form',
)


class OnboardingProcess(models.Model):
    """Quy trình onboarding cho nhân viên mới"""
    onboarding_code = models.CharField(max_length=64, unique=True, verbose_name="Mã onboarding")
    desired_employee_id = models.CharField(max_length=20, blank=True, verbose_name="Mã nhân viên")
    # Thông tin ứng viên
    candidate_name = models.CharField(max_length=255, verbose_name="Họ và tên")
    candidate_email = models.EmailField(verbose_name="Email")
    candidate_phone = models.CharField(max_length=20, blank=True, verbose_name="Số điện thoại")
    
    # Thông tin cá nhân
    citizen_id = models.CharField(max_length=20, blank=True, verbose_name="CCCD/CMND")
    date_of_birth = models.DateField(null=True, blank=True, verbose_name="Ngày sinh")
    gender = models.CharField(max_length=10, choices=[
        ('MALE', 'Nam'),
        ('FEMALE', 'Nữ'),
        ('OTHER', 'Khác'),
    ], blank=True, verbose_name="Giới tính")
    ethnicity = models.CharField(max_length=100, blank=True, null=True, verbose_name="Dân tộc")
    nationality = models.CharField(max_length=100, blank=True, null=True, verbose_name="Quốc tịch")

    # Địa chỉ
    permanent_address = models.TextField(blank=True, verbose_name="Địa chỉ thường trú")
    current_address = models.TextField(blank=True, verbose_name="Địa chỉ tạm trú")
    birth_place = models.CharField(max_length=500, blank=True, verbose_name="Nơi sinh")
    
    # Thông tin học vấn
    education_level = models.CharField(max_length=100, blank=True, verbose_name="Trình độ học vấn")
    university = models.CharField(max_length=255, blank=True, verbose_name="Trường đại học")
    major = models.CharField(max_length=255, blank=True, verbose_name="Chuyên ngành")
    graduation_year = models.IntegerField(null=True, blank=True, verbose_name="Năm tốt nghiệp")
    
    # Thông tin công việc
    position = models.ForeignKey('employee.Position', on_delete=models.SET_NULL, null=True,
                                related_name='onboarding_processes', verbose_name="Vị trí tuyển dụng")
    department = models.ForeignKey('employee.Department', on_delete=models.SET_NULL, null=True,
                                  related_name='onboarding_processes', verbose_name="Phòng ban")
    direct_manager = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                      related_name='managed_onboardings', verbose_name="Quản lý trực tiếp")
    
    # Thông tin tổ chức (từ form nhân viên điền)
    company_unit = models.CharField(max_length=20, blank=True, null=True, verbose_name="Đơn vị làm việc")
    rank = models.CharField(max_length=100, blank=True, null=True, verbose_name="Cấp bậc")
    section = models.CharField(max_length=100, blank=True, null=True, verbose_name="Bộ phận")
    doctor_team = models.CharField(max_length=100, blank=True, null=True, verbose_name="Team Bác sĩ")
    region = models.CharField(max_length=100, blank=True, null=True, verbose_name="Vùng/Miền")
    block = models.CharField(max_length=100, blank=True, null=True, verbose_name="Khối")
    work_form = models.CharField(max_length=20, blank=True, null=True, verbose_name="Hình thức làm việc")
    marital_status = models.CharField(max_length=20, blank=True, null=True, verbose_name="Tình trạng hôn nhân")
    
    # Ngày bắt đầu làm việc
    start_date = models.DateField(verbose_name="Ngày bắt đầu làm việc")
    expected_end_date = models.DateField(null=True, blank=True, verbose_name="Ngày kết thúc dự kiến (thử việc)")
    
    # Thông tin hợp đồng
    contract_type = models.CharField(max_length=20, choices=CONTRACT_TYPE, blank=True, null=True,
                                    verbose_name="Loại hợp đồng")
    probation_period_months = models.IntegerField(default=2, verbose_name="Thời gian thử việc (tháng)")
    salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True,
                                verbose_name="Mức lương")
    salary_note = models.TextField(blank=True, verbose_name="Ghi chú về lương")
    
    # Thông tin tài khoản ngân hàng
    bank_name = models.CharField(max_length=255, blank=True, verbose_name="Ngân hàng")
    bank_account = models.CharField(max_length=50, blank=True, verbose_name="Số tài khoản")
    bank_account_holder = models.CharField(max_length=255, blank=True, verbose_name="Tên chủ tài khoản")
    bank_branch = models.CharField(max_length=255, blank=True, verbose_name="Chi nhánh ngân hàng")

    # Thông tin thuế
    tax_code = models.CharField(max_length=20, blank=True, verbose_name="Mã số thuế")
    tax_dependents = models.IntegerField(default=0, verbose_name="Số người phụ thuộc")
    social_insurance_number = models.CharField(max_length=20, blank=True, null=True, verbose_name="Mã số BHXH")

    # Trạng thái quy trình
    status = models.CharField(max_length=20, choices=ONBOARDING_STATUS, default='DRAFT',
                             verbose_name="Trạng thái")
    progress_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=0,
                                             verbose_name="Tiến độ hoàn thành (%)")
    # Người phụ trách HR
    hr_responsible = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                      related_name='hr_onboarding_processes', verbose_name="HR phụ trách")
    
    # File đính kèm
    cv_file = models.FileField(upload_to='onboarding/cv/', blank=True, null=True, verbose_name="CV")
    id_card_front = models.FileField(upload_to='onboarding/id_cards/', blank=True, null=True,
                                     verbose_name="Ảnh CCCD mặt trước")
    id_card_back = models.FileField(upload_to='onboarding/id_cards/', blank=True, null=True,
                                    verbose_name="Ảnh CCCD mặt sau")
    diploma_file = models.FileField(upload_to='onboarding/diplomas/', blank=True, null=True,
                                   verbose_name="Bằng cấp")
    citizen_id_file = models.CharField(max_length=500,  null=True, blank=True, verbose_name="File CCCD/CMND (S3 key)")
    
    # Nhân viên được tạo sau khi onboarding hoàn thành
    employee = models.OneToOneField(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='onboarding_process', verbose_name="Nhân viên")
    
    # Ghi chú
    notes = models.TextField(blank=True, verbose_name="Ghi chú")

    # Fallback storage cho các field chỉ tồn tại trên Employee model
    # (facebook_link, vneid_screenshot S3 key, allowance, ...) — dùng khi
    # NV submit form nhưng start_process() chưa link được Employee. Đảm bảo
    # không mất data nếu employee=None tại thời điểm save.
    extra_info = models.JSONField(default=dict, blank=True, verbose_name="Dữ liệu mở rộng")

    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_onboarding_processes', verbose_name="Người tạo")
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm hoàn thành")
    # Token cho nhân viên tự điền thông tin
    employee_token = models.CharField(
        max_length=100, 
        unique=True, 
        null=True, 
        blank=True,
        verbose_name="Token xác thực nhân viên"
    )
    token_expires_at = models.DateTimeField(
        null=True, 
        blank=True,
        verbose_name="Thời hạn token"
    )
    is_self_update = models.BooleanField(
        default=False,
        verbose_name="Link tự cập nhật hồ sơ",
        help_text="Token hiện tại là link cho NV đang làm tự cập nhật hồ sơ: "
                  "form không được đổi các trường HCNS quản lý (lương, phòng ban, vị trí...).",
    )
    employee_info_completed = models.BooleanField(
        default=False,
        verbose_name="Nhân viên đã điền thông tin"
    )
    employee_info_completed_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Thời điểm điền thông tin"
    )
    def generate_employee_token(self):
        """Tạo token cho nhân viên"""
        import secrets
        self.employee_token = secrets.token_urlsafe(32)
        # Token hết hạn sau 2 ngày
        self.token_expires_at = timezone.now() + timezone.timedelta(days=2)
        self.save()
        return self.employee_token
    
    def is_token_valid(self):
        """Kiểm tra token còn hiệu lực không"""
        if not self.employee_token or not self.token_expires_at:
            return False
        return timezone.now() < self.token_expires_at
    
    def get_employee_form_url(self):
        """Lấy URL form cho nhân viên"""
        from django.conf import settings
        base_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
        return f"{base_url}/onboarding/employee-form/{self.employee_token}"
    
    def __str__(self):
        return f"{self.onboarding_code} - {self.candidate_name}"
    
    class Meta:
        verbose_name = "Quy trình onboarding"
        verbose_name_plural = "Quy trình onboarding"
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['onboarding_code']),
            models.Index(fields=['status']),
            models.Index(fields=['start_date']),
            models.Index(fields=['candidate_email']),
        ]
    
    def save(self, *args, **kwargs):
        """Tự động tạo mã onboarding và áp dụng document templates"""
        is_new = self.pk is None  # ← THÊM: Kiểm tra xem có phải record mới không
        
        if not self.onboarding_code:
            timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
            # Tìm số thứ tự cuối cùng trong ngày
            today = timezone.now().date()
            count = OnboardingProcess.objects.filter(
                created_at__date=today
            ).count()
            self.onboarding_code = f"ONB-{timestamp}-{count + 1:03d}"
        
        # Tính ngày kết thúc thử việc nếu là hợp đồng thử việc
        if self.contract_type in PROBATION_CONTRACT_TYPES and self.start_date and not self.expected_end_date:
            from dateutil.relativedelta import relativedelta
            from datetime import timedelta
            months = probation_months_for(self.contract_type, self.probation_period_months)
            months_end_date = self.start_date + relativedelta(months=months) - timedelta(days=1)
            max_60_days_end_date = self.start_date + timedelta(days=59)
            self.expected_end_date = min(months_end_date, max_60_days_end_date)
        
        super().save(*args, **kwargs)
    
        # Quy trình chỉ để NV đang làm tự cập nhật hồ sơ không phải onboarding thật:
        # không tạo task / tài liệu onboarding.
        if is_new and not self.is_self_update:
            self.create_default_tasks()
            self.apply_document_templates()
    def apply_document_templates(self):
        """
        Tự động áp dụng các document templates cho onboarding này.
        Check duplicate bằng template_source trước khi clone.
        """
        templates = OnboardingDocumentTemplate.objects.filter(is_active=True)
        # Lấy set template IDs đã apply rồi
        existing_template_ids = set(
            self.documents.filter(template_source__isnull=False)
            .values_list('template_source_id', flat=True)
        )

        created_count = 0
        for template in templates:
            if template.id in existing_template_ids:
                continue  # Đã apply rồi, skip
            if template.should_apply_to_onboarding(self):
                template.apply_to_onboarding(self, uploaded_by=template.created_by)
                created_count += 1

        return created_count
    def calculate_progress(self):
        tasks = self.tasks.all()
        if not tasks.exists():
            return 0
        
        completed_tasks = tasks.filter(status='COMPLETED').count()
        total_tasks = tasks.count()
        
        progress = (completed_tasks / total_tasks) * 100 if total_tasks > 0 else 0
        self.progress_percentage = progress

        # Tự động hoàn thành khi đủ task
        if completed_tasks == total_tasks and self.status == 'IN_PROGRESS':
            self.status = 'COMPLETED'
            self.completed_at = timezone.now()

        self.save()
        return progress
    
    def start_process(self):
        """Bắt đầu quy trình onboarding, tạo Employee, và bật tất cả task sang IN_PROGRESS"""
        if self.status == 'DRAFT':
            self.status = 'IN_PROGRESS'
            self.save()

            # Bật tất cả task PENDING → IN_PROGRESS cùng lúc.
            # Admin sẽ bấm "Hoàn thành" trên từng task khi xong.
            pending_tasks = list(self.tasks.filter(status='PENDING').order_by('order'))
            now = timezone.now()
            for t in pending_tasks:
                t.status = 'IN_PROGRESS'
                t.started_at = now
            if pending_tasks:
                OnboardingTask.objects.bulk_update(pending_tasks, ['status', 'started_at'])
            if not self.employee:
                from django.contrib.auth.models import User
                from employee.models import Employee
                import re

                # Generate employee_id trước
                employee_id = Employee.generate_next_employee_id(company_unit=self.company_unit)
                resolved_company_unit = Employee.resolve_company_unit(self.company_unit)

                # Username = employee_id (nv00001, nv00002,...)
                username = employee_id.lower()

                password = branding.default_password(employee_id)

                user = User.objects.create_user(
                    username=username,
                    email=self.candidate_email,
                    password=password,
                    first_name=self.candidate_name.split()[-1] if self.candidate_name else '',
                    last_name=' '.join(self.candidate_name.split()[:-1]) if self.candidate_name else ''
                )

                employee = Employee.objects.create(
                    user=user,
                    employee_id=employee_id,
                    full_name=self.candidate_name,
                    email=self.candidate_email,
                    phone=self.candidate_phone,
                    position=self.position,
                    department=self.department,
                    manager=self.direct_manager,
                    company_unit=resolved_company_unit,
                    date_of_birth=self.date_of_birth,
                    citizen_id=self.citizen_id,
                    permanent_address=self.permanent_address,
                    current_address=self.current_address,
                    bank_name=self.bank_name,
                    bank_account=self.bank_account,
                    bank_branch=self.bank_branch,
                    tax_code=self.tax_code,
                    hire_date=self.start_date,
                )
                self.employee = employee
                self.save()

            return True
        return False
    def create_default_tasks(self):
        """Tạo các task onboarding theo quy trình mới"""
        
        # CRITICAL: Kiểm tra xem đã có tasks chưa - tránh duplicate
        if self.tasks.exists():
            print(f"⚠️ Tasks already exist for {self.onboarding_code}, skipping creation")
            return
        
        tasks = []
        order = 1

        start_date = self.start_date or timezone.now().date()

        def add_task(name, description, task_type, task_code=None, deadline_days=None):
            nonlocal order
            deadline = (
                start_date + timezone.timedelta(days=deadline_days)
                if deadline_days is not None
                else None
            )
            tasks.append(OnboardingTask(
                onboarding_process=self,
                name=name,
                description=description,
                task_type=task_type,
                task_code=task_code,
                order=order,
                deadline=deadline,
                status='PENDING'
            ))
            order += 1

        # 1. Điền thông tin nhân sự
        add_task(
            name="Điền thông tin nhân sự",
            description="Điền đầy đủ thông tin cá nhân vào hệ thống HRM",
            task_type='ORIENTATION',
            task_code='FILL_INFO',
            deadline_days=1
        )

        # 2. Ký hợp đồng thử việc
        contract_description = """- Cam kết bảo mật thông tin\n
                - Hợp đồng thử việc\n
                - Cam kết đọc hiểu nội quy công ty"""

        if self.position and 'điều dưỡng' in self.position.title.lower():
            contract_description += "\n- Cam kết của điều dưỡng"

        add_task(
            name="Ký hợp đồng thử việc",
            description=contract_description,
            task_type='CONTRACT',
            task_code='SIGN_CONTRACT',
            deadline_days=None
        )

        # 3. Đọc nội quy công ty
        add_task(
            name="Đọc nội quy công ty",
            description="Đọc và cam kết tuân thủ nội quy, quy định làm việc của công ty",
            task_type='TRAINING',
            task_code='READ_REGULATION',
            deadline_days=3
        )

        # 4. Chuẩn bị hồ sơ
        add_task(
            name="Chuẩn bị hồ sơ",
            description="Chuẩn bị và nộp đầy đủ hồ sơ giấy tờ theo danh sách",
            task_type='DOCUMENT',
            task_code='SUBMIT_DOCS',
            deadline_days=7
        )

        # Bulk create cho hiệu năng
        if tasks:
            OnboardingTask.objects.bulk_create(tasks)
            print(f"✓ Created {len(tasks)} tasks for {self.onboarding_code}")

            # Thêm checklist cho task "Chuẩn bị hồ sơ" (order=4)
            task4_obj = self.tasks.filter(order=4).first()
            if task4_obj:
                checklist_items = [
                    OnboardingChecklist(task=task4_obj, title="Sơ yếu lý lịch",     order=1, is_required=True),
                    OnboardingChecklist(task=task4_obj, title="Căn cước công dân",   order=2, is_required=True),
                    OnboardingChecklist(task=task4_obj, title="Bằng cấp",            order=3, is_required=False),
                    OnboardingChecklist(task=task4_obj, title="Giấy khám sức khỏe", order=4, is_required=True),
                ]
                OnboardingChecklist.objects.bulk_create(checklist_items)
    
    def complete_process(self):
        """Hoàn thành quy trình onboarding"""
        if self.status == 'IN_PROGRESS':
            # Kiểm tra tất cả task đã hoàn thành
            incomplete_tasks = self.tasks.exclude(status__in=['COMPLETED', 'SKIPPED']).count()
            if incomplete_tasks > 0:
                return {
                    'success': False,
                    'message': f'Còn {incomplete_tasks} task chưa hoàn thành'
                }
            
            self.status = 'COMPLETED'
            self.completed_at = timezone.now()
            self.progress_percentage = 100
            self.save()
            
            return {
                'success': True,
                'message': 'Quy trình onboarding đã hoàn thành'
            }
        return {
            'success': False,
            'message': 'Quy trình không ở trạng thái thích hợp để hoàn thành'
        }


TASK_CODE_CHOICES = [
    ('FILL_INFO',        'Điền thông tin nhân sự'),
    ('SIGN_CONTRACT',    'Ký hợp đồng'),
    ('READ_REGULATION',  'Đọc nội quy công ty'),
    ('SUBMIT_DOCS',      'Chuẩn bị hồ sơ'),
]


class OnboardingTask(models.Model):
    """Các task trong quy trình onboarding"""
    onboarding_process = models.ForeignKey(OnboardingProcess, on_delete=models.CASCADE,
                                          related_name='tasks', verbose_name="Quy trình onboarding")

    # Thông tin task
    name = models.CharField(max_length=255, verbose_name="Tên task")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    task_type = models.CharField(max_length=20, verbose_name="Loại task")
    task_code = models.CharField(
        max_length=50, choices=TASK_CODE_CHOICES,
        null=True, blank=True, db_index=True,
        verbose_name="Mã task",
        help_text="Định danh duy nhất, không phụ thuộc tên hay thứ tự"
    )
    
    # Thứ tự và deadline
    order = models.IntegerField(default=0, verbose_name="Thứ tự")
    deadline = models.DateField(null=True, blank=True, verbose_name="Hạn hoàn thành")
    
    # Trạng thái
    status = models.CharField(max_length=20, choices=ONBOARDING_TASK_STATUS, default='PENDING',
                             verbose_name="Trạng thái")
    
    # Người phụ trách
    assigned_to = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='assigned_onboarding_tasks',
                                   verbose_name="Người phụ trách")
    
    # Kết quả
    completion_note = models.TextField(blank=True, verbose_name="Ghi chú hoàn thành")
    attachment = models.FileField(upload_to='onboarding/tasks/', blank=True, null=True,
                                 verbose_name="File đính kèm")
    
    # Thông tin thời gian
    started_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm bắt đầu")
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm hoàn thành")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"{self.onboarding_process.onboarding_code} - {self.name}"
    
    class Meta:
        verbose_name = "Task onboarding"
        verbose_name_plural = "Task onboarding"
        ordering = ['onboarding_process', 'order']
        indexes = [
            models.Index(fields=['onboarding_process', 'order']),
            models.Index(fields=['status']),
            models.Index(fields=['deadline']),
        ]
    
    def start_task(self):
        """Bắt đầu task"""
        if self.status == 'PENDING':
            self.status = 'IN_PROGRESS'
            self.started_at = timezone.now()
            self.save()
            return True
        return False
    
    def complete_task(self, completion_note='', completed_by=None):
        """Hoàn thành task"""
        if self.status in ['PENDING', 'IN_PROGRESS']:
            # Hoàn thành bước ký HĐ phải đồng thời tạo bản ghi nguồn cho màn
            # hình Bulk Contracts. Dùng get_or_create để request retry/bấm
            # nhiều lần không sinh hợp đồng trùng.
            if self.task_code == 'SIGN_CONTRACT':
                onboarding = self.onboarding_process
                employee = onboarding.employee
                if not employee:
                    return False

                contract_type = (
                    onboarding.contract_type
                    or employee.contract_type
                    or 'PROBATION'
                )
                contract, created = EmployeeContract.objects.get_or_create(
                    onboarding_process=onboarding,
                    employee=employee,
                    contract_type=contract_type,
                    defaults={
                        'company_unit': employee.company_unit,
                        'status': 'SIGNED',
                        'start_date': onboarding.start_date,
                        'end_date': (
                            onboarding.expected_end_date
                            or employee.probation_end_date
                            or employee.contract_end_date
                        ),
                        'notes': 'Tự động tạo khi hoàn thành task ký hợp đồng onboarding.',
                    },
                )
                if not created and contract.status in ('DRAFT', 'PENDING_SIGN'):
                    contract.status = 'SIGNED'
                    contract.save(update_fields=['status', 'updated_at'])

            self.status = 'COMPLETED'
            self.completed_at = timezone.now()
            self.completion_note = completion_note
            self.save()
            
            # Cập nhật tiến độ của quy trình
            self.onboarding_process.calculate_progress()
            
            # Kiểm tra xem có task tiếp theo không và tự động start
            next_task = OnboardingTask.objects.filter(
                onboarding_process=self.onboarding_process,
                order__gt=self.order,
                status='PENDING'
            ).order_by('order').first()
            
            if next_task:
                next_task.start_task()
            
            # ── Kiểm tra task cuối cùng → cập nhật file_status nhân viên ──
            # Lấy order lớn nhất trong quy trình này
            last_order = OnboardingTask.objects.filter(
                onboarding_process=self.onboarding_process
            ).aggregate(max_order=models.Max('order'))['max_order']
            
            if self.order == last_order:
                # Đây là task cuối → cập nhật file_status của Employee
                employee = self.onboarding_process.employee
                if employee and employee.file_status == 'NOT_SUBMITTED':
                    employee.file_status = 'COMPLETE'
                    employee.file_submission_date = timezone.now().date()
                    employee.save(update_fields=['file_status', 'file_submission_date'])
                    
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.info(
                        f"Auto-updated file_status to COMPLETE for employee "
                        f"{employee.employee_id} after completing last onboarding task"
                    )
            
            return True
        return False
    
    def skip_task(self, reason=''):
        """Bỏ qua task"""
        if self.status in ['PENDING', 'IN_PROGRESS']:
            self.status = 'SKIPPED'
            self.completion_note = f"Bỏ qua - Lý do: {reason}"
            self.completed_at = timezone.now()
            self.save()
            
            # Cập nhật tiến độ của quy trình
            self.onboarding_process.calculate_progress()
            
            return True
        return False
    
    @property
    def is_overdue(self):
        """Kiểm tra xem task có quá hạn không"""
        if self.deadline and self.status not in ['COMPLETED', 'SKIPPED']:
            return timezone.now().date() > self.deadline
        return False
    
    @property
    def days_until_deadline(self):
        """Số ngày còn lại đến deadline"""
        if self.deadline and self.status not in ['COMPLETED', 'SKIPPED']:
            delta = self.deadline - timezone.now().date()
            return delta.days
        return None


class OnboardingChecklist(models.Model):
    """Checklist chi tiết cho từng task onboarding"""
    task = models.ForeignKey(OnboardingTask, on_delete=models.CASCADE, related_name='checklist_items',
                            verbose_name="Task")
    
    # Thông tin checklist item
    title = models.CharField(max_length=255, verbose_name="Tiêu đề")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    order = models.IntegerField(default=0, verbose_name="Thứ tự")
    
    # Trạng thái
    is_completed = models.BooleanField(default=False, verbose_name="Đã hoàn thành")
    is_required = models.BooleanField(default=True, verbose_name="Bắt buộc")
    
    # Thông tin hoàn thành
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm hoàn thành")
    completed_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='completed_checklist_items',
                                    verbose_name="Người hoàn thành")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"{self.task.name} - {self.title}"
    
    class Meta:
        verbose_name = "Checklist onboarding"
        verbose_name_plural = "Checklist onboarding"
        ordering = ['task', 'order']
        indexes = [
            models.Index(fields=['task', 'order']),
        ]
    
    def mark_complete(self, completed_by=None):
        """Đánh dấu hoàn thành"""
        if not self.is_completed:
            self.is_completed = True
            self.completed_at = timezone.now()
            self.completed_by = completed_by
            self.save()

            # Auto-complete task nếu tất cả checklist bắt buộc đã xong
            task = self.task
            if task.status not in ['COMPLETED', 'SKIPPED']:
                required_items = task.checklist_items.filter(is_required=True)
                if required_items.exists() and not required_items.filter(is_completed=False).exists():
                    task.complete_task(completion_note='Tự động hoàn thành khi đủ hồ sơ bắt buộc')
            return True
        return False
    
    def mark_incomplete(self):
        """Đánh dấu chưa hoàn thành"""
        if self.is_completed:
            self.is_completed = False
            self.completed_at = None
            self.completed_by = None
            self.save()
            return True
        return False


class OnboardingDocument(models.Model):
    """Tài liệu onboarding cho nhân viên mới"""
    onboarding_process = models.ForeignKey(OnboardingProcess, on_delete=models.CASCADE,
                                          related_name='documents', verbose_name="Quy trình onboarding")
    
    # Thông tin tài liệu
    document_name = models.CharField(max_length=255, verbose_name="Tên tài liệu")
    document_type = models.CharField(max_length=50, choices=[
        ('CONTRACT', 'Hợp đồng'),
        ('REGULATION', 'Nội quy công ty'),
        ('HANDBOOK', 'Sổ tay nhân viên'),
        ('FORM', 'Mẫu biểu'),
        ('TRAINING', 'Tài liệu đào tạo'),
        ('OTHER', 'Khác'),
    ], verbose_name="Loại tài liệu")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    
    # File
    file = models.FileField(upload_to='onboarding/documents/', max_length=500, verbose_name="File tài liệu")
    
    # Yêu cầu
    is_required = models.BooleanField(default=True, verbose_name="Bắt buộc")
    requires_signature = models.BooleanField(default=False, verbose_name="Yêu cầu ký")
    
    # Trạng thái
    is_read = models.BooleanField(default=False, verbose_name="Đã đọc")
    is_signed = models.BooleanField(default=False, verbose_name="Đã ký")
    
    # Thông tin ký
    signed_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm ký")
    signature_file = models.FileField(upload_to='onboarding/signatures/', blank=True, null=True,
                                     verbose_name="File chữ ký")
    
    # Thông tin hệ thống
    uploaded_at = models.DateTimeField(auto_now_add=True)
    uploaded_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='uploaded_onboarding_documents',
                                   verbose_name="Người upload")
    template_source = models.ForeignKey(
        'OnboardingDocumentTemplate',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_documents',
        verbose_name="Template nguồn",
        help_text="Template mà tài liệu này được tạo từ"
    )   
    def __str__(self):
        return f"{self.onboarding_process.onboarding_code} - {self.document_name}"
    
    class Meta:
        verbose_name = "Tài liệu onboarding"
        verbose_name_plural = "Tài liệu onboarding"
        ordering = ['onboarding_process', '-uploaded_at']
        indexes = [
            models.Index(fields=['onboarding_process', 'document_type']),
            models.Index(fields=['is_required', 'is_read', 'is_signed']),
            models.Index(fields=['template_source']),
        ]
    
    def mark_as_read(self):
        """Đánh dấu đã đọc"""
        if not self.is_read:
            self.is_read = True
            self.save()
            return True
        return False
    
    def sign_document(self, signature_file=None):
        """Ký tài liệu"""
        if self.requires_signature and not self.is_signed:
            self.is_signed = True
            self.signed_at = timezone.now()
            if signature_file:
                self.signature_file = signature_file
            self.save()
            return True
        return False
class OnboardingDocumentTemplate(models.Model):
    """
    Template tài liệu onboarding - Upload 1 lần, áp dụng cho nhiều nhân viên
    """
    DOCUMENT_TYPE = [
        ('CONTRACT', 'Hợp đồng'),
        ('REGULATION', 'Nội quy công ty'),
        ('HANDBOOK', 'Sổ tay nhân viên'),
        ('FORM', 'Mẫu biểu'),
        ('TRAINING', 'Tài liệu đào tạo'),
        ('SAFETY', 'An toàn lao động'),
        ('POLICY', 'Chính sách công ty'),
        ('OTHER', 'Khác'),
    ]
    
    # Thông tin template
    template_name = models.CharField(max_length=255, verbose_name="Tên template")
    document_type = models.CharField(max_length=20, choices=DOCUMENT_TYPE, verbose_name="Loại tài liệu")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    file = models.FileField(upload_to='onboarding_templates/', max_length=500, verbose_name="File template")

    # Cấu hình
    is_required = models.BooleanField(default=False, verbose_name="Bắt buộc")
    requires_signature = models.BooleanField(default=False, verbose_name="Yêu cầu ký")
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    
    # Auto-apply rules
    apply_to_all_new_onboarding = models.BooleanField(
        default=True, 
        verbose_name="Tự động áp dụng cho onboarding mới",
        help_text="Tự động tạo tài liệu từ template này khi có onboarding mới"
    )

    # Filter theo vị trí/phòng ban (optional)
    apply_to_positions = models.ManyToManyField(
        'employee.Position',
        blank=True,
        verbose_name="Áp dụng cho vị trí",
        help_text="Để trống = áp dụng cho tất cả vị trí"
    )
    apply_to_departments = models.ManyToManyField(
        'employee.Department',
        blank=True,
        verbose_name="Áp dụng cho phòng ban",
        help_text="Để trống = áp dụng cho tất cả phòng ban"
    )
    
    # Metadata
    created_by = models.ForeignKey(
        'employee.Employee',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_document_templates',
        verbose_name="Người tạo"
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Ngày tạo")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Ngày cập nhật")
    
    # Statistics
    usage_count = models.IntegerField(
        default=0,
        verbose_name="Số lần sử dụng",
        help_text="Số lần template được áp dụng cho onboarding"
    )

    class Meta:
        verbose_name = "Template tài liệu onboarding"
        verbose_name_plural = "Templates tài liệu onboarding"
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['is_active', 'apply_to_all_new_onboarding']),
            models.Index(fields=['document_type']),
        ]
    
    def __str__(self):
        return f"{self.template_name} ({self.get_document_type_display()})"
    
    def should_apply_to_onboarding(self, onboarding_process):
        """
        Kiểm tra xem template này có nên áp dụng cho onboarding process này không
        """
        if not self.is_active:
            return False
        
        if not self.apply_to_all_new_onboarding:
            return False
        
        # Kiểm tra filter theo vị trí
        if self.apply_to_positions.exists():
            if not onboarding_process.position or \
               onboarding_process.position not in self.apply_to_positions.all():
                return False
        
        # Kiểm tra filter theo phòng ban
        if self.apply_to_departments.exists():
            if not onboarding_process.department or \
               onboarding_process.department not in self.apply_to_departments.all():
                return False
        
        return True
    
    def apply_to_onboarding(self, onboarding_process, uploaded_by=None):
        """
        Tạo OnboardingDocument từ template này cho onboarding process
        """
        from django.core.files import File
        from shutil import copyfile
        import os
        
        # Tạo document mới từ template
        document = OnboardingDocument.objects.create(
            onboarding_process=onboarding_process,
            document_name=self.template_name,
            document_type=self.document_type,
            description=self.description,
            file=self.file,  # Dùng chung file (tiết kiệm storage)
            is_required=self.is_required,
            requires_signature=self.requires_signature,
            uploaded_by=uploaded_by,
            template_source=self  # Link back to template
        )
        
        # Tăng usage count
        self.usage_count += 1
        self.save(update_fields=['usage_count'])
        
        return document
    
    def sync_to_active_onboardings(self, user_employee=None):
        """
        Đồng bộ template này tới tất cả onboarding đang active
        """
        from django.db.models import Q
        
        # Lấy tất cả onboarding đang active hoặc in_progress
        active_onboardings = OnboardingProcess.objects.filter(
            Q(status='DRAFT') | Q(status='IN_PROGRESS')
        )
        
        created_count = 0
        for onboarding in active_onboardings:
            if self.should_apply_to_onboarding(onboarding):
                # Kiểm tra đã có document từ template này chưa
                if not onboarding.documents.filter(template_source=self).exists():
                    self.apply_to_onboarding(onboarding, uploaded_by=user_employee)
                    created_count += 1
        
        return created_count

# ======================
# WORK FINALIZATION (CHỐT CÔNG)
# ======================

class WorkFinalization(models.Model):
    """
    Bảng chốt công hàng tháng cho nhân viên.
    Primary key logic: unique_together = (employee, year, month)
    """
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE,
        related_name='work_finalizations',
        verbose_name="Nhân viên"
    )
    year = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")

    # ---- Thông tin nhân viên (snapshot tại thời điểm chốt) ----
    employee_code = models.CharField(max_length=64, verbose_name="Mã NV")
    ho_va_ten = models.CharField(max_length=255, verbose_name="Họ và tên")
    phong_ban = models.CharField(max_length=255, blank=True, null=True, verbose_name="Phòng ban")
    vi_tri = models.CharField(max_length=255, blank=True, null=True, verbose_name="Vị trí")
    bac_si = models.CharField(max_length=255, blank=True, null=True, verbose_name="Bác sĩ")
    ngay_bat_dau_lam_viec = models.DateField(blank=True, null=True, verbose_name="Ngày bắt đầu làm việc")
    ngay_ket_thuc_thu_viec = models.DateField(blank=True, null=True, verbose_name="Ngày kết thúc thử việc")
    ngay_len_chinh_thuc = models.DateField(blank=True, null=True, verbose_name="Ngày lên chính thức")
    on_off = models.CharField(max_length=20, blank=True, null=True, verbose_name="ON/OFF (Trạng thái làm việc)")
    trang_thai_lam_viec = models.CharField(max_length=20, blank=True, null=True, verbose_name="Tình trạng làm việc")
    ngay_nghi_viec = models.DateField(blank=True, null=True, verbose_name="Ngày nghỉ việc")
    hinh_thuc_lam_viec = models.CharField(max_length=50, blank=True, null=True, verbose_name="Hình thức làm việc (Loại hợp đồng)")

    # ---- Kết quả tính công (từ EmployeeState.replay_month) ----
    cong_thu_viec = models.DecimalField(max_digits=5, decimal_places=2, default=0, null=True, blank=True,
                                        verbose_name="Công thử việc")
    cong_chinh_thuc = models.DecimalField(max_digits=5, decimal_places=2, default=0, null=True, blank=True,
                                          verbose_name="Công chính thức")
    co_le = models.DecimalField(max_digits=5, decimal_places=2, default=0, null=True, blank=True,
                                verbose_name="Cỗ lễ (nếu có)")
    cong_thuc_te = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Công thực tế")
    tong_cong = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Tổng công")
    tong_phat = models.DecimalField(max_digits=10, decimal_places=2, default=0, verbose_name="Tổng phạt")
    tang_ca = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Tăng ca")
    lam_toi = models.DecimalField(max_digits=5, decimal_places=2, default=0, null=True, blank=True,
                                   verbose_name="Làm tối")
    truc_toi = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Trực tối")
    lam_them_gio = models.DecimalField(max_digits=5, decimal_places=2, default=0, db_column='them_gio', verbose_name="Làm thêm giờ")
    live = models.IntegerField(default=0, verbose_name="Live")
    phu_cap_gui_xe = models.DecimalField(max_digits=12, decimal_places=2, default=0,
                                         verbose_name="Phụ cấp gửi xe")
    nghi_phep_thang = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Nghỉ phép trong tháng")
    nghi_khong_phep_thang = models.DecimalField(max_digits=5, decimal_places=2, default=0, verbose_name="Nghỉ không phép trong tháng")

    # ---- Dữ liệu gốc từ replay_month (để tra cứu) ----
    raw_state = models.JSONField(default=dict, blank=True, verbose_name="Raw state từ rule engine")

    # ---- Khoá số công đã thống nhất bằng tay ----
    # Máy tính công mặc định cho đủ công khi nhân viên không có bản ghi chấm công
    # nào, nên số công HCNS sửa tay sẽ bị "Chốt công tất cả" ghi đè lại. Khoá bản
    # ghi để mọi đường tính lại (1 người / phòng ban / toàn công ty) bỏ qua nó.
    is_locked = models.BooleanField(
        default=False, verbose_name="Đã khoá số công",
        help_text="Đã khoá thì các thao tác chốt công lại sẽ bỏ qua bản ghi này",
    )
    lock_note = models.TextField(blank=True, default='', verbose_name="Lý do khoá")
    locked_by = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='locked_work_finalizations', verbose_name="Người khoá",
    )
    locked_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm khoá")

    # ---- Thông tin hệ thống ----
    finalized_at = models.DateTimeField(auto_now=True, verbose_name="Thời điểm chốt công")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Chốt công"
        verbose_name_plural = "Chốt công"
        ordering = ['-year', '-month', 'employee__employee_id']
        unique_together = ['employee', 'year', 'month']
        indexes = [
            models.Index(fields=['employee', 'year', 'month']),
            models.Index(fields=['year', 'month']),
            models.Index(fields=['year', 'month', 'is_locked']),
        ]

    def __str__(self):
        emp_id = self.employee.employee_id if self.employee else "N/A"
        return f"Chốt công {emp_id} - {self.month}/{self.year}"


class DepartmentWorkFinalizationApproval(models.Model):
    """
    Bảng phê duyệt chốt công theo phòng ban cho từng tháng.
    PK logic: unique_together = (department_code, year, month)
    Được tạo bởi HR/Admin khi gửi yêu cầu phê duyệt đến Trưởng phòng.
    """

    APPROVAL_STATUS_CHOICES = [
        ('PENDING', 'Chờ phê duyệt'),
        ('APPROVED', 'Đã phê duyệt'),
        ('REJECTED', 'Từ chối'),
    ]

    department = models.ForeignKey(
        'employee.Department',
        on_delete=models.CASCADE,
        related_name='work_finalization_approvals',
        verbose_name="Phòng ban",
    )
    department_code = models.CharField(max_length=64, verbose_name="Mã phòng ban")
    year = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")

    status = models.CharField(
        max_length=20,
        choices=APPROVAL_STATUS_CHOICES,
        default='PENDING',
        verbose_name="Trạng thái phê duyệt",
    )

    # Người gửi yêu cầu phê duyệt (HR/Admin)
    sent_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sent_finalization_approvals',
        verbose_name="Người gửi yêu cầu",
    )
    sent_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời điểm gửi yêu cầu")

    # Người phê duyệt (Trưởng phòng)
    approved_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_finalization_approvals',
        verbose_name="Người phê duyệt",
    )
    approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm phê duyệt")

    note = models.TextField(blank=True, verbose_name="Ghi chú phê duyệt")

    class Meta:
        verbose_name = "Phê duyệt chốt công phòng ban"
        verbose_name_plural = "Phê duyệt chốt công phòng ban"
        unique_together = ['department_code', 'year', 'month']
        ordering = ['-year', '-month', 'department_code']
        indexes = [
            models.Index(fields=['department_code', 'year', 'month']),
            models.Index(fields=['year', 'month']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f"Phê duyệt chốt công {self.department_code} - {self.month}/{self.year} [{self.status}]"


class AttendanceFinalizationApproval(models.Model):
    """
    Bảng phê duyệt chốt công nhân sự theo phòng ban cho từng tháng.
    PK logic: unique_together = (department_code, year, month)
    Được tạo bởi HR/Admin khi gửi yêu cầu phê duyệt đến Trưởng phòng.
    """

    APPROVAL_STATUS_CHOICES = [
        ('PENDING', 'Chờ phê duyệt'),
        ('APPROVED', 'Đã phê duyệt'),
        ('REJECTED', 'Từ chối'),
    ]

    department = models.ForeignKey(
        'employee.Department',
        on_delete=models.CASCADE,
        related_name='attendance_finalization_approvals',
        verbose_name="Phòng ban",
    )
    department_code = models.CharField(max_length=64, verbose_name="Mã phòng ban")
    year = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")

    status = models.CharField(
        max_length=20,
        choices=APPROVAL_STATUS_CHOICES,
        default='PENDING',
        verbose_name="Trạng thái phê duyệt",
    )

    sent_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sent_attendance_finalization_approvals',
        verbose_name="Người gửi yêu cầu",
    )
    sent_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời điểm gửi yêu cầu")

    approved_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_attendance_finalization_approvals',
        verbose_name="Người phê duyệt",
    )
    approved_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm phê duyệt")

    note = models.TextField(blank=True, verbose_name="Ghi chú phê duyệt")

    class Meta:
        verbose_name = "Phê duyệt chốt công nhân sự"
        verbose_name_plural = "Phê duyệt chốt công nhân sự"
        unique_together = ['department_code', 'year', 'month']
        ordering = ['-year', '-month', 'department_code']
        indexes = [
            models.Index(fields=['department_code', 'year', 'month']),
            models.Index(fields=['year', 'month']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f"Phê duyệt chốt công nhân sự {self.department_code} - {self.month}/{self.year} [{self.status}]"


class AttendanceFinalizationApprovalLog(models.Model):
    """
    Lưu vết lịch sử thay đổi trạng thái của đơn phê duyệt chốt công nhân sự.
    """

    ACTION_CHOICES = [
        ('SEND', 'Gửi yêu cầu'),
        ('APPROVE', 'Phê duyệt'),
        ('REJECT', 'Từ chối'),
        ('CANCEL', 'Hủy yêu cầu'),
        ('RESET', 'Gửi lại/Reset'),
    ]

    approval = models.ForeignKey(
        AttendanceFinalizationApproval,
        on_delete=models.CASCADE,
        related_name='logs',
        verbose_name="Đơn phê duyệt",
    )
    action = models.CharField(max_length=20, choices=ACTION_CHOICES, verbose_name="Hành động")
    performed_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        verbose_name="Người thực hiện",
    )
    performed_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời điểm thực hiện")
    note = models.TextField(blank=True, verbose_name="Ghi chú/Lý do")
    from_status = models.CharField(max_length=20, blank=True, null=True)
    to_status = models.CharField(max_length=20, blank=True, null=True)

    class Meta:
        verbose_name = "Log phê duyệt chốt công nhân sự"
        verbose_name_plural = "Log phê duyệt chốt công nhân sự"
        ordering = ['-performed_at']

    def __str__(self):
        return f"{self.approval.department_code} - {self.action} by {self.performed_by}"


class AttendanceFinalizationEmployeeDecision(models.Model):
    """
    Lưu quyết định theo từng nhân sự cho bảng phê duyệt chốt công nhân sự.
    """

    DECISION_CHOICES = [
        ('APPROVED', 'Duyệt'),
        ('REJECTED', 'Từ chối'),
    ]

    approval = models.ForeignKey(
        AttendanceFinalizationApproval,
        on_delete=models.CASCADE,
        related_name='employee_decisions',
        verbose_name="Bảng phê duyệt chốt công nhân sự",
    )
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='attendance_finalization_decisions',
        verbose_name="Nhân sự",
    )
    decision = models.CharField(
        max_length=20,
        choices=DECISION_CHOICES,
        verbose_name="Quyết định",
    )
    note = models.TextField(blank=True, verbose_name="Ghi chú")
    decided_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='decided_attendance_finalization_employees',
        verbose_name="Người quyết định",
    )
    decided_at = models.DateTimeField(auto_now=True, verbose_name="Thời điểm quyết định")
    employee_snapshot = models.JSONField(default=dict, blank=True, verbose_name="Snapshot dữ liệu nhân sự")

    class Meta:
        verbose_name = "Quyết định chốt công nhân sự theo nhân sự"
        verbose_name_plural = "Quyết định chốt công nhân sự theo nhân sự"
        unique_together = ['approval', 'employee']
        ordering = ['-decided_at', 'employee__employee_id']
        indexes = [
            models.Index(fields=['approval', 'employee']),
            models.Index(fields=['decision']),
            models.Index(fields=['decided_at']),
        ]

    def __str__(self):
        return f"{self.approval.department_code}-{self.employee.employee_id}: {self.decision}"


class WorkFinalizationApprovalLog(models.Model):
    """
    Lưu vết lịch sử thay đổi trạng thái của đơn phê duyệt chốt công.
    Giúp truy vết ai đã làm gì (Gửi, Duyệt, Từ chối, Hủy) vào lúc nào.
    """
    ACTION_CHOICES = [
        ('SEND', 'Gửi yêu cầu'),
        ('APPROVE', 'Phê duyệt'),
        ('REJECT', 'Từ chối'),
        ('CANCEL', 'Hủy yêu cầu'),
        ('RESET', 'Gửi lại/Reset'),
    ]

    approval = models.ForeignKey(
        DepartmentWorkFinalizationApproval,
        on_delete=models.CASCADE,
        related_name='logs',
        verbose_name="Đơn phê duyệt"
    )
    action = models.CharField(max_length=20, choices=ACTION_CHOICES, verbose_name="Hành động")
    performed_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        verbose_name="Người thực hiện"
    )
    performed_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời điểm thực hiện")
    note = models.TextField(blank=True, verbose_name="Ghi chú/Lý do")
    
    # Snapshot trạng thái trước và sau
    from_status = models.CharField(max_length=20, blank=True, null=True)
    to_status = models.CharField(max_length=20, blank=True, null=True)

    class Meta:
        verbose_name = "Log phê duyệt chốt công"
        verbose_name_plural = "Log phê duyệt chốt công"
        ordering = ['-performed_at']

    def __str__(self):
        return f"{self.approval.department_code} - {self.action} by {self.performed_by}"


class WorkFinalizationEmployeeDecision(models.Model):
    """
    Lưu quyết định theo từng nhân sự sau khi bảng chốt công phòng ban đã được duyệt.
    Dùng cho mục đích lưu trữ/audit và in phiếu ký.
    """

    DECISION_CHOICES = [
        ('APPROVED', 'Duyệt'),
        ('REJECTED', 'Từ chối'),
    ]

    approval = models.ForeignKey(
        DepartmentWorkFinalizationApproval,
        on_delete=models.CASCADE,
        related_name='employee_decisions',
        verbose_name="Bảng phê duyệt chốt công",
    )
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='work_finalization_decisions',
        verbose_name="Nhân sự",
    )
    decision = models.CharField(
        max_length=20,
        choices=DECISION_CHOICES,
        verbose_name="Quyết định",
    )
    note = models.TextField(blank=True, verbose_name="Ghi chú")

    decided_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='decided_work_finalization_employees',
        verbose_name="Người quyết định",
    )
    decided_at = models.DateTimeField(auto_now=True, verbose_name="Thời điểm quyết định")

    # Snapshot dữ liệu hiển thị tại thời điểm quyết định để phục vụ lưu trữ/in ấn.
    employee_snapshot = models.JSONField(default=dict, blank=True, verbose_name="Snapshot dữ liệu nhân sự")

    class Meta:
        verbose_name = "Quyết định chốt công theo nhân sự"
        verbose_name_plural = "Quyết định chốt công theo nhân sự"
        unique_together = ['approval', 'employee']
        ordering = ['-decided_at', 'employee__employee_id']
        indexes = [
            models.Index(fields=['approval', 'employee']),
            models.Index(fields=['decision']),
            models.Index(fields=['decided_at']),
        ]

    def __str__(self):
        return f"{self.approval.department_code}-{self.employee.employee_id}: {self.decision}"


class WorkFinalizationAccountingExport(models.Model):
    """
    Bảng dữ liệu chuẩn cuối cùng để admin xuất cho kế toán.

    Mỗi dòng là một nhân sự trong một bảng chốt công đã được duyệt,
    kèm snapshot dữ liệu tại thời điểm xuất để đảm bảo ổn định số liệu.
    """

    approval = models.ForeignKey(
        DepartmentWorkFinalizationApproval,
        on_delete=models.CASCADE,
        related_name='accounting_exports',
        verbose_name="Bảng phê duyệt chốt công",
    )
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='work_finalization_accounting_exports',
        verbose_name="Nhân sự",
    )
    year = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng (1-12)")
    department_code = models.CharField(max_length=64, verbose_name="Mã phòng ban")
    department_name = models.CharField(max_length=255, blank=True, null=True, verbose_name="Tên phòng ban")
    employee_code = models.CharField(max_length=64, verbose_name="Mã nhân viên")
    employee_name = models.CharField(max_length=255, verbose_name="Họ và tên")
    decision = models.CharField(max_length=20, verbose_name="Quyết định")
    decision_label = models.CharField(max_length=50, blank=True, null=True, verbose_name="Nhãn quyết định")
    decision_note = models.TextField(blank=True, verbose_name="Lý do/Ghi chú")
    decided_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='accounting_exports_decided',
        verbose_name="Người quyết định",
    )
    decided_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm quyết định")
    exported_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='accounting_exports_created',
        verbose_name="Người xuất",
    )
    exported_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời điểm xuất")
    data_snapshot = models.JSONField(default=dict, blank=True, verbose_name="Snapshot dữ liệu chuẩn")

    class Meta:
        verbose_name = "Dữ liệu xuất kế toán chốt công"
        verbose_name_plural = "Dữ liệu xuất kế toán chốt công"
        unique_together = ['approval', 'employee']
        ordering = ['-year', '-month', 'department_code', 'employee_code']
        indexes = [
            models.Index(fields=['year', 'month']),
            models.Index(fields=['department_code', 'year', 'month']),
            models.Index(fields=['employee_code']),
            models.Index(fields=['decision']),
        ]

    def __str__(self):
        return f"XK chốt công {self.employee_code} - {self.month}/{self.year}"


from django.contrib.auth import get_user_model

User = get_user_model()

class EmailQueue(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Đang chờ'),
        ('PROCESSING', 'Đang xử lý'),
        ('SENT', 'Đã gửi'),
        ('FAILED', 'Thất bại'),
    ]
    
    employee = models.ForeignKey('employee.Employee', on_delete=models.CASCADE, related_name='email_queue')
    email_type = models.CharField(max_length=50, default='ACCOUNT_INFO')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    
    # Thông tin email
    recipient_email = models.EmailField()
    recipient_name = models.CharField(max_length=255)
    
    # Lưu password đã reset
    new_password = models.CharField(max_length=255, null=True, blank=True)

    # Payslip email content (dùng cho email_type='PAYSLIP')
    email_subject = models.CharField(max_length=500, null=True, blank=True)
    email_plain_body = models.TextField(null=True, blank=True)
    email_html_body = models.TextField(null=True, blank=True)

    # Retry mechanism
    retry_count = models.IntegerField(default=0)
    max_retries = models.IntegerField(default=3)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    
    # Error tracking
    error_message = models.TextField(null=True, blank=True)
    
    # Batch tracking
    batch_id = models.CharField(max_length=100, null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    
    class Meta:
        db_table = 'hrm_email_queue'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'created_at']),
            models.Index(fields=['batch_id']),
        ]
    
    def __str__(self):
        return f"{self.email_type} - {self.recipient_email} - {self.status}"


class EmailBatch(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Đang chờ'),
        ('PROCESSING', 'Đang xử lý'),
        ('COMPLETED', 'Hoàn thành'),
        ('FAILED', 'Thất bại'),
    ]
    
    batch_id = models.CharField(max_length=100, unique=True)
    total_emails = models.IntegerField(default=0)
    sent_count = models.IntegerField(default=0)
    failed_count = models.IntegerField(default=0)
    pending_count = models.IntegerField(default=0)
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'hrm_email_batch'
        ordering = ['-created_at']
    
    def __str__(self):
        return f"Batch {self.batch_id} - {self.status}"
    
# ============================================
# CONTRACT MODELS
# ============================================

def contract_template_upload_path(instance, filename):
    return f'contract_templates/{filename}'

def contract_file_upload_path(instance, filename):
    return f'contracts/{instance.onboarding_process.id}/{filename}'

class ContractTemplate(models.Model):
    """Template hợp đồng - HR upload 1 lần, dùng cho nhiều nhân viên"""
    
    CONTRACT_STATUS = [
        ('ACTIVE', 'Đang sử dụng'),
        ('INACTIVE', 'Không sử dụng'),
    ]
    
    name = models.CharField(max_length=255, verbose_name="Tên template")
    contract_type = models.CharField(max_length=20, choices=CONTRACT_DOCUMENT_TYPE, verbose_name="Loại hợp đồng")
    file = models.FileField(upload_to=contract_template_upload_path, verbose_name="File template (docx)")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    status = models.CharField(max_length=20, choices=CONTRACT_STATUS, default='ACTIVE')
    company_unit = models.ForeignKey(
        CompanyUnit, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='contract_templates', verbose_name="Đơn vị áp dụng"
    )
    is_default = models.BooleanField(
        default=False, verbose_name="Mặc định",
        help_text="Template mặc định cho đúng 1 (loại hợp đồng, đơn vị) — dùng để tự động "
                  "gán khi hệ thống tự tạo hợp đồng (VD: hoàn thành onboarding).",
    )
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='created_contract_templates', verbose_name="Người tạo")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.get_contract_type_display()})"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.is_default:
            ContractTemplate.objects.filter(
                contract_type=self.contract_type,
                company_unit=self.company_unit,
                is_default=True,
            ).exclude(pk=self.pk).update(is_default=False)

    class Meta:
        verbose_name = "Template hợp đồng"
        verbose_name_plural = "Templates hợp đồng"


class EmployeeContract(models.Model):
    """Hợp đồng của từng nhân viên trong quy trình onboarding"""
    
    CONTRACT_STATUS = [
        ('DRAFT', 'Bản nháp'),
        ('PENDING_SIGN', 'Chờ ký'),
        ('SIGNED', 'Đã ký'),
        ('EXPIRED', 'Hết hạn'),
        ('CANCELLED', 'Đã hết hiệu lực'),
    ]
    company_unit = models.ForeignKey(
        'employee.CompanyUnit', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='employee_contracts', verbose_name='Đơn vị'
    )
    onboarding_process = models.ForeignKey(
        'OnboardingProcess', on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='contracts', verbose_name="Quy trình onboarding"
    )
    employee = models.ForeignKey(
        'employee.Employee', on_delete=models.CASCADE,
        related_name='contracts', verbose_name="Nhân viên"
    )
    template = models.ForeignKey(
        ContractTemplate, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="Template sử dụng"
    )
    contract_type = models.CharField(max_length=20, choices=CONTRACT_DOCUMENT_TYPE, verbose_name="Loại hợp đồng")
    status = models.CharField(max_length=20, choices=CONTRACT_STATUS, default='DRAFT')
    
    # Files
    generated_file = models.URLField(
        null=True, blank=True, max_length=1000,
        verbose_name="File hợp đồng (S3 path hoặc presigned URL)"
    )
    signed_file = models.FileField(
        upload_to=contract_file_upload_path, null=True, blank=True,
        verbose_name="File hợp đồng đã ký"
    )
    
    # Chữ ký điện tử
    employee_signature = models.TextField(null=True, blank=True, verbose_name="Chữ ký nhân viên (base64)")
    employee_signed_at = models.DateTimeField(null=True, blank=True)
    hr_signature = models.TextField(null=True, blank=True, verbose_name="Chữ ký HR (base64)")
    hr_signed_at = models.DateTimeField(null=True, blank=True)
    
    # Thời hạn
    start_date = models.DateField(null=True, blank=True, verbose_name="Ngày bắt đầu hợp đồng")
    end_date = models.DateField(null=True, blank=True, verbose_name="Ngày kết thúc hợp đồng")
    
    notes = models.TextField(blank=True, verbose_name="Ghi chú")
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='created_contracts'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    contract_number = models.CharField(max_length=50, blank=True, null=True)

    def is_expiring_soon(self, days=7):
        """Kiểm tra hợp đồng sắp hết hạn trong X ngày"""
        if not self.end_date:
            return False
        from django.utils import timezone
        delta = self.end_date - timezone.now().date()
        return 0 <= delta.days <= days

    def __str__(self):
        return f"{self.employee.full_name} - {self.get_contract_type_display()} ({self.status})"

    class Meta:
        verbose_name = "Hợp đồng nhân viên"
        verbose_name_plural = "Hợp đồng nhân viên"
        ordering = ['-created_at']

class ContractCounter(models.Model):
    """Đếm số thứ tự hợp đồng theo từng loại và năm"""
    CONTRACT_GROUPS = [
        ('INTERN', 'HĐ Thực tập'),
        ('PROBATION', 'HĐ Thử việc'),
        ('LABOR', 'HĐ Lao động'),
        ('SERVICE', 'HĐ Dịch vụ'),
        ('COMPANY_RULES', 'Cam kết nội quy'),
    ]
    group = models.CharField(max_length=20, choices=CONTRACT_GROUPS)
    company_unit = models.ForeignKey(
        'employee.CompanyUnit', on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name='Đơn vị'
    )
    year = models.IntegerField()
    last_number = models.IntegerField(default=0)

    class Meta:
        unique_together = ('group', 'company_unit', 'year')

    # Mapping group → contract_type values (đồng bộ với CONTRACT_TYPE_TO_GROUP
    # trong EmployeeContractViewSet — đảo ngược chiều).
    GROUP_TO_CONTRACT_TYPES = {
        'INTERN': ['INTERN', 'COLLABORATOR'],
        'PROBATION': sorted(PROBATION_CONTRACT_TYPES),
        'LABOR': sorted(OFFICIAL_LABOR_CONTRACT_TYPES),
        'SERVICE': ['SERVICE'],
        'COMPANY_RULES': ['COMPANY_RULES'],
    }

    @classmethod
    def _max_number_in_db(cls, group: str, company_unit, year: int, expected_suffix: str = None) -> int:
        """Lấy số HĐ lớn nhất thực tế từ EmployeeContract — phòng counter lệch DB.

        contract_number format hiện tại: 'NNNN/YEAR/PREFIX-UNIT_CODE' (4-digit
        padded) — xem EmployeeContractViewSet._generate_contract_number().
        Scan trong scope (group, company_unit, year) → parse phần đầu → max.

        `expected_suffix` (vd "HĐLĐ-ABC"): CHỈ tính những contract_number
        kết thúc đúng bằng suffix này. Bắt buộc truyền từ mọi call site thực
        tế (views.py luôn có sẵn prefix+unit_code) để bỏ qua các bản ghi
        format CŨ/khác quy ước (vd "0403/2026/XX-HĐLĐ" — hệ thống trước đây)
        vẫn khớp company_unit+type+năm nhưng KHÔNG cùng chuỗi số hiện tại —
        nếu tính lẫn sẽ đẩy số tiếp theo lên sai (bug thực tế: ABC 2026 bị
        đẩy từ 48 lên 403+ vì 1 hợp đồng "XX-HĐLĐ" cũ, phát hiện 2026-09-22).
        Không truyền (None) giữ hành vi cũ, chỉ dùng cho các lời gọi legacy
        không xác định được prefix/unit_code.

        So suffix sau khi chuẩn hoá (NFC, bỏ khoảng trắng, không phân biệt hoa
        thường) — số HĐ HR gõ tay có thể lệch dạng Unicode / thừa dấu cách mà
        vẫn là cùng chuỗi số.
        """
        import unicodedata

        def _norm(value):
            return unicodedata.normalize('NFC', value or '').strip().upper()

        contract_types = cls.GROUP_TO_CONTRACT_TYPES.get(group, [])
        if not contract_types:
            return 0

        qs = EmployeeContract.objects.filter(
            contract_type__in=contract_types,
            company_unit=company_unit,
        ).exclude(contract_number__isnull=True).exclude(contract_number='')

        # Filter theo year qua pattern '/YEAR/'
        qs = qs.filter(contract_number__contains=f'/{year}/')

        suffix = _norm(expected_suffix) if expected_suffix else ''
        max_n = 0
        for cn in qs.values_list('contract_number', flat=True):
            if suffix and not _norm(cn).endswith(suffix):
                continue
            try:
                num_str = cn.split('/', 1)[0]
                n = int(num_str)
                if n > max_n:
                    max_n = n
            except (ValueError, AttributeError, IndexError):
                continue
        return max_n

    @classmethod
    def _base_number(cls, counter_value: int, max_in_db: int, expected_suffix: str = None) -> int:
        """Số đã dùng gần nhất của chuỗi.

        Có `expected_suffix` (mọi call site thực tế): số trên hợp đồng là nguồn sự
        thật, `last_number` KHÔNG được kéo số lên. Counter từng bị kẹt cao hơn thực
        tế theo 2 đường, đều làm số nhảy lên 0404 (bug ABC 2026-10-13):
          - xoá 1 HĐ → destroy() reset counter theo max gồm cả HĐ format cũ
            "0403/2026/XX-HĐLĐ" → counter = 403;
          - hệ thống cấp 0404, HR sửa tay về 0051 → counter vẫn 404 → HĐ sau 0405.
        Counter chỉ còn là dòng để khoá (select_for_update) khi cấp số.
        Không truyền suffix (legacy): giữ hành vi cũ max(counter, DB).
        """
        if expected_suffix:
            return max_in_db
        return max(counter_value, max_in_db)

    @classmethod
    def peek_next(cls, group: str, company_unit, year: int, expected_suffix: str = None) -> int:
        """Xem số tiếp theo mà KHÔNG tăng counter — sync với MAX hiện có trên DB."""
        counter = cls.objects.filter(group=group, company_unit=company_unit, year=year).first()
        counter_value = counter.last_number if counter else 0
        max_in_db = cls._max_number_in_db(group, company_unit, year, expected_suffix)
        return cls._base_number(counter_value, max_in_db, expected_suffix) + 1

    @classmethod
    def next_number(cls, group: str, company_unit, year: int, expected_suffix: str = None) -> int:
        """Lấy số tiếp theo, thread-safe — sync với MAX(contract_number) trên DB.

        Đồng bộ counter với thực tế trước khi increment → đảm bảo:
        - Không trùng số nếu counter lệch (reset, import, manual override).
        - Có expected_suffix: MAX(số HĐ cùng chuỗi) + 1 (xem _base_number);
          không có: max(last_number, max_db) + 1.

        Caller phải lưu số vào hợp đồng TRONG cùng transaction với lời gọi này
        (khoá dòng counter giữ tới lúc commit) — nếu không 2 request đồng thời
        có thể nhận cùng một số.
        """
        from django.db import transaction
        with transaction.atomic():
            counter, _ = cls.objects.select_for_update().get_or_create(
                group=group, company_unit=company_unit, year=year,
                defaults={'last_number': 0}
            )
            max_in_db = cls._max_number_in_db(group, company_unit, year, expected_suffix)
            base = cls._base_number(counter.last_number, max_in_db, expected_suffix)
            counter.last_number = base + 1
            counter.save()
            return counter.last_number


# ======================
# FINALIZATION LOCK (Đóng / Mở chốt công)
# ======================

class FinalizationLock(models.Model):
    """
    Trạng thái đóng/mở chốt công theo từng NỬA THÁNG.
    Tách thành 2 dòng/tháng: FIRST_HALF (1-15) và SECOND_HALF (16-cuối tháng).
    Khi is_locked=True cho 1 period, tạo đơn / phê duyệt / chốt công cho các ngày
    trong period đó bị chặn (Admin/HR có thể bypass tùy mixin).

    Hỗ trợ đặt lịch: lock_start_at → thời điểm tự động khóa.
    Mở khóa luôn thủ công.
    """
    PERIOD_CHOICES = [
        ('FIRST_HALF', 'Nửa đầu (1-15)'),
        ('SECOND_HALF', 'Nửa sau (16-cuối)'),
    ]

    year = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng")
    period = models.CharField(
        max_length=20, choices=PERIOD_CHOICES, default='FIRST_HALF',
        verbose_name="Nửa tháng",
    )
    is_locked = models.BooleanField(default=False, verbose_name="Đã khóa")

    lock_start_at = models.DateTimeField(
        null=True, blank=True,
        verbose_name="Bắt đầu khóa",
        help_text="Thời điểm tự động chuyển sang trạng thái khóa",
    )

    locked_by = models.ForeignKey(
        User, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='finalization_locks_locked',
        verbose_name="Người khóa",
    )
    locked_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm khóa")

    unlocked_by = models.ForeignKey(
        User, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='finalization_locks_unlocked',
        verbose_name="Người mở khóa",
    )
    unlocked_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm mở khóa")

    note = models.TextField(blank=True, default='', verbose_name="Ghi chú")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Khóa chốt công"
        verbose_name_plural = "Khóa chốt công"
        unique_together = [('year', 'month', 'period')]
        ordering = ['-year', '-month', 'period']

    def __str__(self):
        status_text = "Đã khóa" if self.is_locked else "Đang mở"
        return f"Tháng {self.month}/{self.year} {self.get_period_display()} — {status_text}"

    @staticmethod
    def period_for_day(day):
        """Trả về period (FIRST_HALF/SECOND_HALF) cho 1 ngày trong tháng."""
        return 'FIRST_HALF' if int(day) <= 15 else 'SECOND_HALF'

    def check_schedule(self):
        """
        Kiểm tra lịch tự động khóa theo lock_start_at.
        Mở khóa luôn thủ công. Trả về True nếu trạng thái đã thay đổi.
        """
        if not self.is_locked and self.lock_start_at and timezone.now() >= self.lock_start_at:
            self.is_locked = True
            self.locked_at = timezone.now()
            self.save(update_fields=['is_locked', 'locked_at', 'updated_at'])
            return True
        return False


class FinalizationLockLog(models.Model):
    """Audit log: ghi lại mỗi lần ADMIN hoặc HR đóng/mở chốt công."""
    ACTION_CHOICES = [
        ('LOCKED', 'Khóa'),
        ('UNLOCKED', 'Mở khóa'),
    ]

    lock = models.ForeignKey(
        FinalizationLock, on_delete=models.CASCADE,
        related_name='logs',
        verbose_name="Bản ghi khóa",
    )
    action = models.CharField(max_length=10, choices=ACTION_CHOICES, verbose_name="Hành động")
    performed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL,
        null=True, blank=True,
        verbose_name="Người thực hiện",
    )
    performed_by_role = models.CharField(
        max_length=20, blank=True, default='',
        verbose_name="Vai trò",
        help_text="ADMIN hoặc HR",
    )
    note = models.TextField(blank=True, default='', verbose_name="Ghi chú")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Log khóa chốt công"
        verbose_name_plural = "Log khóa chốt công"
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.get_action_display()} — {self.lock} — {self.performed_by}"


class FinalizationLockEmployeeOverride(models.Model):
    """
    Ngoại lệ khóa/mở khóa RIÊNG cho 1 nhân viên trong 1 (year, month, period),
    độc lập với FinalizationLock khóa chung toàn công ty. Dùng khi:
    - Period đang khóa chung nhưng cần MỞ riêng cho 1 vài NV bị sai lệch cần
      giải trình lại (is_unlocked=True).
    - Period đang mở chung nhưng cần KHÓA riêng 1 vài NV (is_unlocked=False).
    """
    year = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng")
    period = models.CharField(
        max_length=20, choices=FinalizationLock.PERIOD_CHOICES,
        verbose_name="Nửa tháng",
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE,
        related_name='finalization_lock_overrides', verbose_name="Nhân viên",
    )
    is_unlocked = models.BooleanField(
        default=True, verbose_name="Trạng thái override",
        help_text="True = Mở khóa riêng cho NV này (bỏ qua khóa chung). "
                  "False = Khóa riêng NV này (dù period đang mở chung).",
    )
    note = models.TextField(blank=True, default='', verbose_name="Ghi chú")
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="Người tạo",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Ngoại lệ khóa chốt công theo NV"
        verbose_name_plural = "Ngoại lệ khóa chốt công theo NV"
        unique_together = [('year', 'month', 'period', 'employee')]
        ordering = ['-updated_at']

    def __str__(self):
        state = "Mở riêng" if self.is_unlocked else "Khóa riêng"
        return f"{self.employee.employee_id} — {self.month}/{self.year} {self.get_period_display()} — {state}"


class MeetingRoom(models.Model):
    name = models.CharField(max_length=120, unique=True, verbose_name="Tên phòng họp")
    code = models.CharField(max_length=40, unique=True, verbose_name="Mã phòng")
    location = models.CharField(max_length=255, blank=True, default='', verbose_name="Vị trí")
    capacity = models.PositiveIntegerField(default=0, verbose_name="Sức chứa")
    description = models.TextField(blank=True, default='', verbose_name="Mô tả")
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='meeting_rooms_created',
        verbose_name="Người tạo",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Phòng họp"
        verbose_name_plural = "Phòng họp"
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.code})"


class MeetingRoomSetting(models.Model):
    min_booking_minutes = models.PositiveIntegerField(default=30, verbose_name="Thời lượng đặt tối thiểu (phút)")
    workday_start_hour = models.PositiveIntegerField(default=8, verbose_name="Giờ bắt đầu trong ngày")
    workday_end_hour = models.PositiveIntegerField(default=22, verbose_name="Giờ kết thúc trong ngày")
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='meeting_room_settings_updated',
        verbose_name="Người cập nhật",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Cấu hình đặt phòng họp"
        verbose_name_plural = "Cấu hình đặt phòng họp"

    def __str__(self):
        return f"Tối thiểu {self.min_booking_minutes} phút"

    def clean(self):
        if self.min_booking_minutes < 5:
            raise ValidationError("Thời lượng đặt tối thiểu phải từ 5 phút")
        if self.workday_start_hour >= self.workday_end_hour:
            raise ValidationError("Giờ bắt đầu phải nhỏ hơn giờ kết thúc")
        if self.workday_start_hour < 0 or self.workday_start_hour > 23:
            raise ValidationError("Giờ bắt đầu không hợp lệ")
        if self.workday_end_hour < 1 or self.workday_end_hour > 24:
            raise ValidationError("Giờ kết thúc không hợp lệ")

    @classmethod
    def get_solo(cls):
        setting = cls.objects.first()
        if setting:
            return setting
        return cls.objects.create()


class MeetingRoomBooking(models.Model):
    BOOKING_SOURCE_CHOICES = [
        ('USER', 'Người dùng'),
        ('AI', 'AI'),
    ]

    room = models.ForeignKey(
        MeetingRoom,
        on_delete=models.CASCADE,
        related_name='bookings',
        verbose_name="Phòng họp",
    )
    title = models.CharField(max_length=255, blank=True, default='', verbose_name="Tiêu đề")
    note = models.TextField(blank=True, default='', verbose_name="Ghi chú")

    booked_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='meeting_room_bookings',
        verbose_name="Nhân viên đặt",
    )
    booked_by_user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='meeting_room_bookings',
        verbose_name="Tài khoản đặt",
    )
    booking_source = models.CharField(
        max_length=10,
        choices=BOOKING_SOURCE_CHOICES,
        default='USER',
        verbose_name="Nguồn đặt",
    )
    ai_agent_name = models.CharField(max_length=120, blank=True, default='', verbose_name="Tên AI")
    contact_name = models.CharField(max_length=120, blank=True, default='', verbose_name="Người liên hệ")
    contact_phone = models.CharField(max_length=30, blank=True, default='', verbose_name="Số điện thoại liên hệ")

    start_time = models.DateTimeField(verbose_name="Thời gian bắt đầu")
    end_time = models.DateTimeField(verbose_name="Thời gian kết thúc")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Lịch đặt phòng họp"
        verbose_name_plural = "Lịch đặt phòng họp"
        ordering = ['start_time']
        indexes = [
            models.Index(fields=['room', 'start_time', 'end_time']),
            models.Index(fields=['booked_by', 'start_time']),
        ]

    def __str__(self):
        return f"{self.room.name}: {self.start_time} - {self.end_time}"

    @property
    def duration_minutes(self):
        return int((self.end_time - self.start_time).total_seconds() / 60)

    def clean(self):
        if self.end_time <= self.start_time:
            raise ValidationError("Giờ kết thúc phải lớn hơn giờ bắt đầu")


class MeetingRoomBookingLog(models.Model):
    ACTION_CHOICES = [
        ('CREATED', 'Đăng ký'),
        ('UPDATED', 'Sửa giờ'),
        ('DELETED', 'Xóa'),
    ]

    booking = models.ForeignKey(
        MeetingRoomBooking,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='logs',
        verbose_name="Booking",
    )
    room = models.ForeignKey(
        MeetingRoom,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='booking_logs',
        verbose_name="Phòng họp",
    )
    action = models.CharField(max_length=10, choices=ACTION_CHOICES, verbose_name="Hành động")
    booking_source = models.CharField(max_length=10, blank=True, default='')

    old_start_time = models.DateTimeField(null=True, blank=True)
    old_end_time = models.DateTimeField(null=True, blank=True)
    new_start_time = models.DateTimeField(null=True, blank=True)
    new_end_time = models.DateTimeField(null=True, blank=True)

    contact_name = models.CharField(max_length=120, blank=True, default='')
    contact_phone = models.CharField(max_length=30, blank=True, default='')
    ai_agent_name = models.CharField(max_length=120, blank=True, default='')

    performed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='meeting_room_booking_logs',
    )
    performed_by_role = models.CharField(max_length=20, blank=True, default='')
    note = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Lịch sử đặt phòng họp"
        verbose_name_plural = "Lịch sử đặt phòng họp"
        ordering = ['-created_at']

    def __str__(self):
        room_name = self.room.name if self.room else 'N/A'
        return f"{self.get_action_display()} - {room_name}"


# ─────────────────────────────────────────────────────────────────────────────
# Các model nằm ở file riêng — import ở ĐÂY để Django chắc chắn nạp được khi
# khởi động (models.py là module duy nhất app tự động import). Nếu chỉ dựa vào
# việc admin.py/views import gián tiếp thì makemigrations có thể không thấy
# model, hoặc thấy không ổn định tuỳ thứ tự import.
# ─────────────────────────────────────────────────────────────────────────────
from .violation_models import BlockedRequestAttempt, ViolationPenaltyOverride  # noqa: E402,F401

from .payment_document_models import PaymentDocument, PaymentDocumentAttachment  # noqa: E402,F401
