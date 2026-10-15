from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from employee.models import Employee


class EmployeeEvent(models.Model):
    
    class EventType(models.TextChoices):
        ATTENDANCE = "attendance", "Attendance"
        LEAVE_REQUEST = "leave_request", "Leave Request"
        OVERTIME = "overtime", "Overtime / Tăng ca"
        EXTRA_HOURS = "extra_hours", "Extra Hours / Làm thêm giờ"
        LIVESTREAM = "live", "Live"
        EXPLANATION = "explanation", "Explanation"
        EXPLANATION_APPROVAL = "explanation_approval", "Explanation Approval"
        ONLINE_WORK = "online_work", "Online Work"
        NIGHT_SHIFT = "night_shift", "Night Shift / Ca đêm"
        REQUEST_APPROVAL = "request_approval", "Request Approval"
        OFF_DUTY = "off_duty", "Ra trực"
        UNAUTHORIZED_ABSENCE = "unauthorized_absence", "Đơn nghỉ không phép"
        SHIFT_CHANGE = "shift_change", "Đơn đổi ca"
        # Generic request events (Yêu cầu & Đơn từ tổng hợp)
        RESIGNATION = "resignation", "Đơn xin nghỉ việc"
        PROPOSAL = "proposal", "Đơn đề xuất"
        CONFIRMATION = "confirmation", "Đơn xác nhận"
        COMPLAINT = "complaint", "Đơn khiếu nại"
        OTHER_REQUEST = "other_request", "Đơn khác"


    """Bản ghi chấm công hàng ngày"""
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='employee_events',
                                verbose_name="Nhân viên")
    
    # Thông tin ngày xảy ra sự kiện, có thể khác với ngày tạo bản ghi (ví dụ chấm công cho ngày hôm qua)
    event_date = models.DateField(verbose_name="Ngày xảy ra sự kiện")
    event_type = models.CharField(
        max_length=30,
        choices=EventType.choices,
        db_index=True,
        verbose_name="Loại sự kiện"
    )
    
    data = models.JSONField(blank=True, null=True, verbose_name="Dữ liệu sự kiện")  # Lưu trữ dữ liệu liên quan đến sự kiện, có thể là giờ vào/ra, lý do nghỉ phép, v.v.
    
    # Thời gian chấm công nếu event là attendance, có thể null nếu chưa chấm công hoặc nếu event là loại khác
    check_in = models.TimeField(null=True, blank=True, verbose_name="Giờ vào")
    check_out = models.TimeField(null=True, blank=True, verbose_name="Giờ ra")
    overtime_hours = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True, verbose_name="Số giờ làm thêm")  # Dành cho event overtime
    explanation = models.TextField(blank=True,null=True, verbose_name="Lý do giải trình")  # Dành cho event explanation

    # Ghi chú
    notes = models.TextField(blank=True, verbose_name="Ghi chú")

    # Sự kiện tham chiếu – dùng cho EXPLANATION_APPROVAL để biết nó duyệt cho event nào
    reference_event = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approval_events',
        verbose_name="Sự kiện tham chiếu",
    )

    # GPS checkin location — lưu vị trí khi nhân viên chấm công qua mobile
    checkin_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True, verbose_name="Vĩ độ checkin")
    checkin_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True, verbose_name="Kinh độ checkin")
    checkin_distance_m = models.FloatField(null=True, blank=True, verbose_name="Khoảng cách đến cơ sở (m)")
    checkin_is_valid = models.BooleanField(null=True, blank=True, verbose_name="Vị trí hợp lệ")
    branch_location = models.ForeignKey(
        'hrm.BranchLocation',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='attendance_events',
        verbose_name="Cơ sở check-in"
    )

    # GPS checkout location — cơ sở checkout có thể khác cơ sở check-in
    checkout_branch_location = models.ForeignKey(
        'hrm.BranchLocation',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='checkout_events',
        verbose_name="Cơ sở checkout"
    )
    checkout_distance_m = models.FloatField(null=True, blank=True, verbose_name="Khoảng cách checkout (m)")
    checkout_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True, verbose_name="Vĩ độ checkout")
    checkout_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True, verbose_name="Kinh độ checkout")

    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_employee_events', verbose_name="Người tạo")
    
    def __str__(self):
        return f"Event {self.event_type} - {self.employee.full_name} - {self.event_date}"
    
    class Meta:
        verbose_name = "Employee Event"
        verbose_name_plural = "Employee Events"
        ordering = ['-event_date', 'employee']
        indexes = [
            models.Index(fields=['employee', 'event_date']),
            models.Index(fields=['event_date']),
            models.Index(fields=['event_type']),
            models.Index(fields=['reference_event', 'event_type', 'created_at']),
        ]
        constraints = [
            # C1: Mỗi nhân viên chỉ có 1 mobile checkin/ngày — DB enforce, không phụ thuộc get_or_create
            models.UniqueConstraint(
                fields=['employee', 'event_date', 'event_type'],
                condition=models.Q(checkin_is_valid=True),
                name='unique_mobile_checkin_per_employee_per_day',
            )
        ]


class EmployeeEventAuditLog(models.Model):
    class Action(models.TextChoices):
        CREATE = "create", "Tạo mới"
        UPDATE = "update", "Cập nhật"
        # Huỷ đơn (soft-cancel) — thêm 2026-10-09 theo yêu cầu "nhớ lưu đủ log"
        # của HCNS khi siết quyền xoá đơn nghỉ. Trước đó việc huỷ đơn chỉ
        # để lại dấu trong EmployeeEvent.data (is_deleted/deleted_by_*), không
        # query được, nên không đối soát được ai đã huỷ đơn nào.
        CANCEL = "cancel", "Huỷ đơn"

    event = models.ForeignKey(
        EmployeeEvent,
        on_delete=models.CASCADE,
        related_name="audit_logs",
        verbose_name="Sự kiện chấm công",
    )
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name="employee_event_audit_logs",
        verbose_name="Nhân viên được sửa",
    )
    action = models.CharField(
        max_length=20,
        choices=Action.choices,
        verbose_name="Hành động",
    )
    old_values = models.JSONField(blank=True, null=True, verbose_name="Dữ liệu trước khi sửa")
    new_values = models.JSONField(blank=True, null=True, verbose_name="Dữ liệu sau khi sửa")
    changed_fields = models.JSONField(default=list, blank=True, verbose_name="Trường thay đổi")
    performed_by_user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="performed_employee_event_audit_logs",
        verbose_name="User thực hiện",
    )
    performed_by_employee = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="performed_employee_event_audit_logs",
        verbose_name="Nhân viên thực hiện",
    )
    performed_by_role = models.CharField(
        max_length=30,
        blank=True,
        verbose_name="Vai trò thực hiện",
    )
    request_payload = models.JSONField(blank=True, null=True, verbose_name="Payload yêu cầu")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời điểm ghi log")

    def __str__(self):
        return f"{self.get_action_display()} {self.event_id} bởi {self.performed_by_user_id or 'system'}"

    class Meta:
        verbose_name = "Audit log sửa Employee Event"
        verbose_name_plural = "Audit log sửa Employee Event"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["event", "-created_at"]),
            models.Index(fields=["employee", "-created_at"]),
            models.Index(fields=["performed_by_user", "-created_at"]),
            models.Index(fields=["action", "-created_at"]),
        ]


# ======================
# RULE MODELS
# ======================

class RuleScope(models.TextChoices):
    """Enum for rule scope types"""
    INDIVIDUAL = "INDIVIDUAL", "Cá nhân"      # Áp dụng cho một người cụ thể
    POSITION = "POSITION", "Vị trí"           # Áp dụng cho một vị trí/chức vụ
    GROUP = "GROUP", "Nhóm"                   # Áp dụng cho một nhóm người
    DEPARTMENT = "DEPARTMENT", "Phòng ban"    # Áp dụng cho một phòng ban
    COMPANY = "COMPANY", "Công ty"            # Áp dụng cho toàn công ty


class RuleDefinition(models.Model):
    """
    Model lưu trữ định nghĩa rule theo kiến trúc của rule/rules.py
    """
    rule_name = models.CharField(max_length=255, verbose_name="Tên rule")
    rule_type = models.CharField(max_length=100, verbose_name="Loại rule")
    
    # Điều kiện rule (JSON field để linh hoạt)
    conditions = models.JSONField(default=dict, verbose_name="Điều kiện")
    
    # Phạm vi áp dụng
    scope = models.CharField(
        max_length=20, 
        choices=RuleScope.choices, 
        default=RuleScope.COMPANY,
        verbose_name="Phạm vi áp dụng"
    )
    identifier = models.CharField(
        max_length=100, 
        blank=True, 
        null=True,
        verbose_name="Mã định danh phạm vi"
    )
    
    # Ưu tiên (rule có priority cao hơn sẽ override rule có priority thấp hơn)
    priority = models.IntegerField(default=0, verbose_name="Ưu tiên")
    
    # Hiệu lực
    effective_from = models.DateField(default=timezone.now, verbose_name="Có hiệu lực từ")
    effective_to = models.DateField(null=True, blank=True, verbose_name="Có hiệu lực đến")
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    
    # Mô tả
    description = models.TextField(blank=True, verbose_name="Mô tả")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        Employee, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True,
        related_name='created_rules',
        verbose_name="Người tạo"
    )
    
    def __str__(self):
        return f"{self.rule_name} ({self.rule_type}) - {self.get_scope_display()}"
    
    class Meta:
        verbose_name = "Định nghĩa rule"
        verbose_name_plural = "Định nghĩa rules"
        ordering = ['-priority', 'rule_type', 'rule_name']
        indexes = [
            models.Index(fields=['rule_type']),
            models.Index(fields=['scope', 'identifier']),
            models.Index(fields=['is_active']),
            models.Index(fields=['effective_from', 'effective_to']),
        ]
    
    def clean(self):
        """Validate rule configuration"""
        from django.core.exceptions import ValidationError
        
        # Nếu scope là COMPANY, identifier phải là "ALL" hoặc để trống
        if self.scope == RuleScope.COMPANY:
            if self.identifier and self.identifier != "ALL":
                raise ValidationError("Với scope COMPANY, identifier phải là 'ALL' hoặc để trống")
        
        # Nếu scope không phải COMPANY, identifier không được để trống
        elif self.scope != RuleScope.COMPANY and not self.identifier:
            raise ValidationError(f"Với scope {self.get_scope_display()}, identifier không được để trống")
    
    def save(self, *args, **kwargs):
        """Tự động xử lý identifier cho scope COMPANY"""
        if self.scope == RuleScope.COMPANY and not self.identifier:
            self.identifier = "ALL"
        
        # Gọi clean để validate
        self.clean()
        
        super().save(*args, **kwargs)
    
    @property
    def is_current(self):
        """Kiểm tra xem rule có đang hiệu lực không"""
        today = timezone.now().date()
        if self.is_active and self.effective_from <= today:
            if not self.effective_to or self.effective_to >= today:
                return True
        return False
    
    def matches_employee(self, employee, employee_info=None):
        """
        Kiểm tra xem rule có áp dụng cho nhân viên không
        
        Args:
            employee: Employee object
            employee_info: Optional dictionary với thông tin bổ sung về nhân viên
                {
                    "department_id": "MARKETING",
                    "group_ids": ["MANAGERS", "SENIOR_STAFF"],
                    "position": "Manager"
                }
        """
        if not self.is_current:
            return False
        
        if self.scope == RuleScope.COMPANY:
            return True
        
        elif self.scope == RuleScope.DEPARTMENT:
            # Kiểm tra phòng ban của nhân viên
            if employee_info and "department_id" in employee_info:
                return employee_info.get("department_id") == self.identifier
            elif employee.department:
                return employee.department.code == self.identifier or str(employee.department.id) == self.identifier
            return False
        
        elif self.scope == RuleScope.POSITION:
            # Kiểm tra vị trí/chức vụ của nhân viên
            if employee_info and "position_id" in employee_info:
                return str(employee_info.get("position_id")) == str(self.identifier)
            elif employee.position:
                return str(employee.position.id) == str(self.identifier)
            return False

        elif self.scope == RuleScope.GROUP:
            # Kiểm tra nhóm của nhân viên
            if employee_info and "group_ids" in employee_info:
                return self.identifier in employee_info.get("group_ids", [])
            # Có thể cần thêm logic kiểm tra group từ model Employee
            return False
        
        elif self.scope == RuleScope.INDIVIDUAL:
            # Kiểm tra mã nhân viên
            return employee.employee_code == self.identifier or str(employee.id) == self.identifier
        
        return False
    
    def to_dict(self):
        """Chuyển đổi thành dictionary format tương thích với rule/rules.py"""
        return {
            "rule_name": self.rule_name,
            "rule_type": self.rule_type,
            "conditions": self.conditions,
            "targets": [{
                "scope": self.scope,
                "identifier": self.identifier
            }],
            "priority": self.priority,
            "effective_from": self.effective_from.isoformat() if self.effective_from else None,
            "effective_to": self.effective_to.isoformat() if self.effective_to else None,
            "is_active": self.is_active,
            "description": self.description
        }


class RuleExecutionLog(models.Model):
    """
    Lịch sử thực thi rule
    """
    rule = models.ForeignKey(
        RuleDefinition, 
        on_delete=models.CASCADE, 
        related_name='execution_logs',
        verbose_name="Rule"
    )
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='rule_execution_logs',
        verbose_name="Nhân viên"
    )
    event = models.ForeignKey(
        EmployeeEvent,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='rule_execution_logs',
        verbose_name="Sự kiện"
    )
    
    # Thông tin thực thi
    execution_result = models.JSONField(default=dict, verbose_name="Kết quả thực thi")
    execution_context = models.JSONField(default=dict, verbose_name="Ngữ cảnh thực thi")
    
    # Thông tin hệ thống
    executed_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời điểm thực thi")
    executed_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='executed_rules',
        verbose_name="Người thực thi"
    )
    
    def __str__(self):
        return f"Rule {self.rule.rule_name} - {self.employee.full_name} - {self.executed_at}"
    
    class Meta:
        verbose_name = "Lịch sử thực thi rule"
        verbose_name_plural = "Lịch sử thực thi rules"
        ordering = ['-executed_at']
        indexes = [
            models.Index(fields=['rule', 'employee']),
            models.Index(fields=['executed_at']),
            models.Index(fields=['employee', 'executed_at']),
        ]
    
    @classmethod
    def create_log(cls, rule, employee, event=None, execution_result=None, execution_context=None, executed_by=None):
        """Tạo bản ghi lịch sử thực thi rule"""
        return cls.objects.create(
            rule=rule,
            employee=employee,
            event=event,
            execution_result=execution_result or {},
            execution_context=execution_context or {},
            executed_by=executed_by
        )


class RuleRegistry(models.Model):
    """
    Registry để quản lý rules với các scope khác nhau
    (Có thể được sử dụng để cache rules)
    """
    name = models.CharField(max_length=255, verbose_name="Tên registry")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    
    # Cấu hình registry
    rules_data = models.JSONField(default=list, verbose_name="Dữ liệu rules")
    version = models.CharField(max_length=50, verbose_name="Phiên bản")
    
    # Thông tin hệ thống
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_rule_registries',
        verbose_name="Người tạo"
    )
    
    def __str__(self):
        return f"{self.name} (v{self.version})"
    
    class Meta:
        verbose_name = "Rule registry"
        verbose_name_plural = "Rule registries"
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['name', 'version']),
        ]
    
    def get_rules_for_employee(self, employee_code, employee_info=None):
        """
        Lấy tất cả rules áp dụng cho một nhân viên cụ thể
        Tương thích với rule/rules.py
        """
        from collections import defaultdict

        # Lấy tất cả rules từ RuleDefinition
        all_rules = RuleDefinition.objects.filter(is_active=True)

        # Collect all rules that apply to this employee
        collected_rules = []

        # Check rules from most specific to least specific scope:
        # INDIVIDUAL(4) > POSITION(3) > GROUP(~3) > DEPARTMENT(2) > COMPANY(1)
        scopes_to_check = [
            (RuleScope.INDIVIDUAL, employee_code),
            (RuleScope.POSITION, None),   # Will check position of this employee
            (RuleScope.GROUP, None),      # Will check all groups
            (RuleScope.DEPARTMENT, None), # Will check all departments
            (RuleScope.COMPANY, "ALL")
        ]

        for scope, identifier in scopes_to_check:
            if scope in (RuleScope.POSITION, RuleScope.GROUP, RuleScope.DEPARTMENT):
                keys_to_check = []
                if scope == RuleScope.POSITION and employee_info and "position_id" in employee_info:
                    keys_to_check.append((scope, str(employee_info["position_id"])))
                elif scope == RuleScope.GROUP and employee_info and "group_ids" in employee_info:
                    for group_id in employee_info.get("group_ids", []):
                        keys_to_check.append((scope, group_id))
                elif scope == RuleScope.DEPARTMENT and employee_info and "department_id" in employee_info:
                    keys_to_check.append((scope, employee_info.get("department_id")))

                for key in keys_to_check:
                    scope_rules = all_rules.filter(scope=key[0], identifier=key[1])
                    collected_rules.extend(scope_rules)
            else:
                # For individual and company scopes
                scope_rules = all_rules.filter(scope=scope, identifier=identifier)
                collected_rules.extend(scope_rules)

        # Group rules by rule_type
        rules_by_type = defaultdict(list)
        for rule in collected_rules:
            rules_by_type[rule.rule_type].append(rule)

        # For each rule_type, select the rule with highest priority
        # Convention: INDIVIDUAL=4, POSITION=3, DEPARTMENT=2, COMPANY=1
        final_rules = []
        for rule_type, rules in rules_by_type.items():
            highest_priority_rule = max(rules, key=lambda r: r.priority)
            final_rules.append(highest_priority_rule.to_dict())

        # Sort by priority (higher priority first) for consistent ordering
        final_rules.sort(key=lambda x: x.get("priority", 0), reverse=True)
        return final_rules
