"""Ghi nhận các lần nhân sự CỐ TẠO đơn nhưng bị hệ thống chặn vì quá hạn.

Lý do tồn tại (yêu cầu HCNS 2026-10-06, chị Dung): cuối tháng cần xuất file
phân loại lỗi vi phạm quanh đơn nghỉ phép tháng / nghỉ không phép, tách rõ
lỗi của NHÂN VIÊN và lỗi của QUẢN LÝ.

Vướng mắc HCNS nêu đúng: từ khi hệ thống chặn chặt hạn tạo đơn, nhân sự
tạo muộn sẽ KHÔNG tạo được đơn nào — nên trong HRM không còn dấu vết gì để
thống kê "lỗi tạo đơn muộn". Hai tình huống rất khác nhau về mức độ:

    (a) nhân sự có vào HRM, cố tạo đơn, nhưng quá hạn nên bị chặn
    (b) nhân sự quên hẳn, không đụng gì tới HRM

lại cho ra cùng một kết quả "không có đơn". Bảng này giữ lại dấu vết của (a)
để phân biệt được với (b).

CỐ Ý tách khỏi EmployeeEventAuditLog: bảng đó gắn FK vào EmployeeEvent (chỉ
ghi được create/update của đơn ĐÃ tồn tại), còn ở đây đơn chưa bao giờ ra đời.
"""
from django.db import models

from employee.models import Employee


class BlockedRequestAttempt(models.Model):
    """1 lần bấm tạo đơn bị từ chối vì quá hạn."""

    # Giữ cùng bộ mã với DeadlineExceptionGrant.request_type để đối chiếu
    # "có được HCNS mở khoá hay không" mà không phải map qua lại.
    class RequestType(models.TextChoices):
        LEAVE = "LEAVE", "Nghỉ phép tháng"
        UNAUTHORIZED_ABSENCE = "UNAUTHORIZED_ABSENCE", "Nghỉ không phép"
        OVERTIME = "OVERTIME", "Tăng ca"
        ONLINE_WORK = "ONLINE_WORK", "Làm việc online"
        BUSINESS_TRIP = "BUSINESS_TRIP", "Công tác"
        LIVE = "LIVE", "Livestream"

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="blocked_request_attempts",
        verbose_name="Nhân viên xin nghỉ/đăng ký",
    )
    # Người BẤM tạo — có thể khác employee khi quản lý/HCNS tạo hộ.
    attempted_by = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="blocked_request_attempts_made", verbose_name="Người thao tác",
    )
    event_date = models.DateField(verbose_name="Ngày xin nghỉ/đăng ký")
    request_type = models.CharField(
        max_length=30, choices=RequestType.choices, verbose_name="Loại đơn",
    )
    # Mốc hạn tại thời điểm bị chặn — snapshot để sau này đổi luật vẫn đọc
    # đúng số liệu cũ (bài học từ đơn nghỉ không phép: không snapshot nên đổi
    # luật ngày 28/09 là mọi báo cáo tháng trước tính lại theo luật mới).
    deadline = models.DateTimeField(null=True, blank=True, verbose_name="Hạn phải tạo")
    attempted_at = models.DateTimeField(auto_now_add=True, verbose_name="Thời điểm bấm tạo")
    error_message = models.TextField(blank=True, verbose_name="Thông báo hệ thống trả về")
    extra = models.JSONField(default=dict, blank=True, verbose_name="Dữ liệu kèm theo")

    class Meta:
        verbose_name = "Lần tạo đơn bị chặn quá hạn"
        verbose_name_plural = "Lần tạo đơn bị chặn quá hạn"
        indexes = [
            models.Index(fields=["employee", "event_date"]),
            models.Index(fields=["attempted_at"]),
        ]

    def __str__(self):
        return f"{self.employee_id} {self.request_type} {self.event_date} bị chặn lúc {self.attempted_at}"


def log_blocked_attempt(*, employee, event_date, request_type, deadline=None,
                        error_message="", attempted_by=None, **extra):
    """Ghi 1 lần bị chặn. KHÔNG được làm hỏng luồng tạo đơn: mọi lỗi ở đây
    đều nuốt, vì đây chỉ là dữ liệu phục vụ báo cáo — không đáng để làm nhân
    sự không tạo được đơn."""
    try:
        if not employee or not event_date:
            return None
        return BlockedRequestAttempt.objects.create(
            employee=employee,
            attempted_by=attempted_by,
            event_date=event_date,
            request_type=request_type,
            deadline=deadline,
            error_message=str(error_message or "")[:2000],
            extra=extra or {},
        )
    except Exception:  # noqa: BLE001 - xem docstring
        import logging
        logging.getLogger(__name__).exception("Không ghi được BlockedRequestAttempt")
        return None


def actor_employee(request):
    """Employee tương ứng user đang bấm — None nếu không tra được."""
    try:
        user = getattr(request, "user", None)
        if user is not None and getattr(user, "is_authenticated", False):
            return Employee.objects.filter(user=user).first()
    except Exception:  # noqa: BLE001
        pass
    return None


class ViolationPenaltyOverride(models.Model):
    """HCNS tự quyết áp phạt / gỡ phạt cho MỘT dòng vi phạm cụ thể.

    Vì sao cần (HCNS 2026-10-12):
    - Trang cảnh báo (tạo đơn quá hạn, mở khoá quá mốc 3 giờ) không tự ra tiền,
      nhưng có ca HCNS xem xong thấy đáng phạt -> cần nút "Áp phạt".
    - Ngược lại, dòng hệ thống tự tính ra tiền cũng có ca oan -> cần nút "Gỡ
      phạt". Cả hai đều BẮT BUỘC nhập lý do và lưu lại ai bấm, lúc nào.

    Khoá dòng là (employee, event_date, violation_code) — đúng khoá mà
    LeaveViolationReportView dùng để gộp dòng, nên map 1-1 với dòng trên màn.
    Bản ghi còn hiệu lực MỚI NHẤT của một khoá là bản có tác dụng; bấm nhầm thì
    thu hồi (revoked_at) chứ không xoá, để còn tra lại.
    """

    class Action(models.TextChoices):
        APPLY = "apply", "Áp phạt"
        WAIVE = "waive", "Gỡ phạt"

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE,
        related_name="violation_penalty_overrides", verbose_name="Nhân viên",
    )
    event_date = models.DateField(verbose_name="Ngày vi phạm")
    violation_code = models.CharField(max_length=30, verbose_name="Loại lỗi")
    action = models.CharField(max_length=10, choices=Action.choices, verbose_name="Quyết định")
    reason = models.TextField(verbose_name="Lý do")
    created_by = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", verbose_name="Người quyết định",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True, verbose_name="Thu hồi lúc")
    revoked_by = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", verbose_name="Người thu hồi",
    )

    class Meta:
        verbose_name = "Áp/gỡ phạt thủ công"
        verbose_name_plural = "Áp/gỡ phạt thủ công"
        ordering = ["-created_at"]
        indexes = [
            # Tên tường minh, khớp migration 0153 — để trống thì Django tự sinh
            # tên khác và makemigrations sẽ đẻ ra migration đổi tên vô nghĩa.
            models.Index(fields=["employee", "event_date"], name="hrm_vpo_emp_date_idx"),
            models.Index(fields=["event_date", "violation_code"], name="hrm_vpo_date_code_idx"),
        ]

    def __str__(self):
        return f"{self.get_action_display()} {self.employee_id} {self.event_date} {self.violation_code}"


def load_penalty_overrides(first, last, employee_ids=None):
    """Nạp 1 lần các quyết định tay trong khoảng ngày -> tránh N+1.

    Trả dict {(employee_id, 'YYYY-MM-DD', violation_code): override} chỉ gồm bản
    CÒN HIỆU LỰC MỚI NHẤT của mỗi khoá.
    """
    qs = (ViolationPenaltyOverride.objects
          .filter(event_date__gte=first, event_date__lte=last, revoked_at__isnull=True)
          .select_related("created_by")
          .order_by("created_at"))      # bản sau ghi đè bản trước
    if employee_ids is not None:
        qs = qs.filter(employee_id__in=employee_ids)
    out = {}
    for o in qs:
        out[(o.employee_id, o.event_date.isoformat(), o.violation_code)] = o
    return out


# ─────────────────────────────────────────────────────────────────────────────
# LƯU VẾT BẢNG ĐỐI SOÁT
#
# HCNS 2026-10-12: "cái bảng này cần được lưu chứ. Với áp phạt, xóa phạt
# đều phải lưu vết hết" — và khi hỏi chốt sổ lúc nào thì chọn "phải cho tự save
# khi có thay đổi bất kì" (không dùng nút "Chốt tháng").
#
# Vì sao cần: báo cáo vốn TÍNH LẠI mỗi lần mở trang, không lưu gì. Nên một thay
# đổi cấu hình là số liệu tháng cũ đổi theo mà không ai biết — đã xảy ra thật:
# đảo cờ Chủ nhật làm tháng 9/2026 nhảy từ 210 lên 1.038 dòng (483 triệu tiền
# phạt ảo). Bảng có tiền gắn vào thì phải trả lời được "ngày X hệ thống kết
# luận gì", chứ không thể chỉ trả lời "hôm nay nó đang nghĩ gì".
# ─────────────────────────────────────────────────────────────────────────────

class ViolationLedgerRun(models.Model):
    """Một lần chạy lưu vết. Để truy "vì sao hôm nay khác hôm qua"."""

    class Source(models.TextChoices):
        IMPORT = "import", "Sau khi nạp chấm công"
        MANUAL = "manual", "Chạy tay"
        OVERRIDE = "override", "Sau khi HCNS áp/gỡ phạt"

    year = models.IntegerField(verbose_name="Năm")
    month = models.IntegerField(verbose_name="Tháng")
    source = models.CharField(max_length=20, choices=Source.choices, verbose_name="Nguồn chạy")
    # Chuỗi tham chiếu để KHỎI import hrm.models (vòng import).
    import_log = models.ForeignKey(
        "hrm.AttendanceImportLog", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="violation_ledger_runs", verbose_name="Đợt nạp chấm công",
    )
    triggered_by = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", verbose_name="Người kích hoạt",
    )
    total_rows = models.IntegerField(default=0, verbose_name="Tổng số dòng")
    new_rows = models.IntegerField(default=0, verbose_name="Dòng mới")
    changed_rows = models.IntegerField(default=0, verbose_name="Dòng đổi nội dung")
    closed_rows = models.IntegerField(default=0, verbose_name="Dòng không còn")
    total_penalty = models.BigIntegerField(default=0, verbose_name="Tổng tiền phạt")
    note = models.TextField(blank=True, verbose_name="Ghi chú")
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Lần lưu vết đối soát vi phạm"
        verbose_name_plural = "Lần lưu vết đối soát vi phạm"
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["year", "month", "-started_at"],
                                name="hrm_vlrun_ym_started_idx")]

    def __str__(self):
        return (f"{self.month:02d}/{self.year} ({self.get_source_display()}) "
                f"{self.total_rows} dòng, +{self.new_rows}/~{self.changed_rows}")


class ViolationLedgerEntry(models.Model):
    """Một dòng vi phạm TẠI MỘT THỜI ĐIỂM.

    Ghi theo kiểu append-only: mỗi lần chạy so `content_hash` với bản đang hiệu
    lực của cùng khoá; GIỐNG thì chỉ đẩy `last_seen_at`, KHÁC thì đóng bản cũ
    (`superseded_at`) rồi ghi bản mới. Nhờ vậy bảng không phình khi chạy lại
    nhiều lần mà vẫn giữ đủ lịch sử thay đổi.

    Khoá dòng = (employee, event_date, violation_code, fault_side) — trùng khoá
    mà LeaveViolationReportView dùng để gộp, nên map 1-1 với dòng trên màn.
    """

    run = models.ForeignKey(
        ViolationLedgerRun, on_delete=models.CASCADE, related_name="entries",
        verbose_name="Sinh ra ở lần chạy",
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="violation_ledger_entries",
        verbose_name="Nhân viên nghỉ",
    )
    event_date = models.DateField(verbose_name="Ngày vi phạm")
    violation_code = models.CharField(max_length=30, verbose_name="Loại lỗi")
    fault_side = models.CharField(max_length=10, verbose_name="Bên chịu lỗi")
    responsible = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", verbose_name="Người chịu trách nhiệm",
    )
    request_code = models.CharField(max_length=64, blank=True, verbose_name="Mã đơn")
    penalty_amount = models.IntegerField(default=0, verbose_name="Tiền phạt")
    penalty_reason = models.CharField(max_length=40, blank=True, verbose_name="Lý do mức phạt")
    detail = models.TextField(blank=True, verbose_name="Diễn giải")
    # Toàn bộ dòng như lúc tính ra — để sau này đối chiếu được cả những trường
    # chưa nghĩ tới lúc thiết kế bảng này.
    payload = models.JSONField(default=dict, blank=True, verbose_name="Dòng gốc")
    content_hash = models.CharField(max_length=64, db_index=True, verbose_name="Mã nội dung")

    first_seen_at = models.DateTimeField(auto_now_add=True, verbose_name="Lần đầu thấy")
    last_seen_at = models.DateTimeField(verbose_name="Lần cuối còn thấy")
    # null = ĐANG hiệu lực. Có giá trị = nội dung đã đổi hoặc dòng không còn.
    superseded_at = models.DateTimeField(null=True, blank=True, db_index=True,
                                         verbose_name="Hết hiệu lực lúc")

    class Meta:
        verbose_name = "Dòng đối soát đã lưu"
        verbose_name_plural = "Dòng đối soát đã lưu"
        ordering = ["event_date", "employee_id"]
        indexes = [
            models.Index(fields=["event_date", "violation_code"],
                         name="hrm_vlentry_date_code_idx"),
            models.Index(fields=["employee", "event_date"],
                         name="hrm_vlentry_emp_date_idx"),
        ]
        constraints = [
            # Mỗi khoá chỉ có ĐÚNG MỘT bản đang hiệu lực. Ràng buộc có điều
            # kiện chứ không unique_together, vì các bản cũ cố ý nằm lại.
            models.UniqueConstraint(
                fields=["employee", "event_date", "violation_code", "fault_side"],
                condition=models.Q(superseded_at__isnull=True),
                name="uniq_live_violation_ledger_entry",
            ),
        ]

    def __str__(self):
        return f"{self.event_date} {self.employee_id} {self.violation_code} ({self.penalty_amount})"


class ViolationPenaltyIssue(models.Model):
    """Một dòng vi phạm ĐÃ ĐƯỢC CHỐT thành biên bản phạt bên bảng lương.

    Vì sao cần bảng trung gian thay vì dò ngược trong salary.DisciplinaryPenalty:
    bảng kia không có chỗ nào ghi "sinh ra từ dòng vi phạm nào", mà biên bản
    phạt còn được HCNS tạo tay cho đủ thứ lý do khác. Không có bảng này thì bấm
    "Chốt tháng" lần hai sẽ tạo trùng toàn bộ — nhân đôi tiền trừ lương của
    người thật.

    HCNS chốt 2026-10-12: chốt lại thì **chỉ thêm cái thiếu, không đụng cái
    cũ**. Ràng buộc unique bên dưới là thứ bảo đảm điều đó ở tầng CSDL, không
    phụ thuộc vào code nhớ kiểm tra.
    """

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="violation_penalty_issues",
        verbose_name="Nhân viên nghỉ",
    )
    event_date = models.DateField(verbose_name="Ngày vi phạm")
    violation_code = models.CharField(max_length=30, verbose_name="Loại lỗi")
    fault_side = models.CharField(max_length=10, verbose_name="Bên chịu lỗi")
    # Người THỰC SỰ bị trừ tiền — với lỗi quản lý thì đây là quản lý, không
    # phải người xin nghỉ.
    responsible = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="violation_penalties_charged",
        verbose_name="Người bị phạt",
    )
    year = models.IntegerField(verbose_name="Năm tính lương")
    month = models.IntegerField(verbose_name="Tháng tính lương")
    amount = models.IntegerField(default=0, verbose_name="Số tiền")
    # SET_NULL: HCNS xoá biên bản bên bảng lương thì vẫn còn dấu vết là đã chốt.
    disciplinary_penalty = models.ForeignKey(
        "salary.DisciplinaryPenalty", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="violation_issues", verbose_name="Biên bản phạt",
    )
    created_by = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+", verbose_name="Người chốt",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Dòng vi phạm đã chốt thành biên bản"
        verbose_name_plural = "Dòng vi phạm đã chốt thành biên bản"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["year", "month"], name="hrm_vpi_year_month_idx"),
            models.Index(fields=["responsible", "year", "month"], name="hrm_vpi_resp_ym_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "event_date", "violation_code", "fault_side"],
                name="uniq_violation_penalty_issue",
            ),
        ]

    def __str__(self):
        return (f"{self.event_date} {self.violation_code} -> "
                f"{self.responsible_id} ({self.amount})")
