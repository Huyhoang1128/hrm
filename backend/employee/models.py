from django.db import models
from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone
from django.core.exceptions import ValidationError
import re

# Create your models here.

ATTENDANCE_STATUS = [
    ('PRESENT', 'Có mặt'),
    ('ABSENT', 'Vắng mặt'),
    ('LEAVE', 'Đang nghỉ'),
    ('OFF', 'Ngày nghỉ'),
    ('ADJUSTED', 'Đã điều chỉnh'),
    ('INCOMPLETE_ATTENDANCE', 'Quên chấm công'),
]

GENDER = [
    ('M', 'Nam'),
    ('F', 'Nữ'),
    ('O', 'Khác'),
]

EMPLOYMENT_STATUS = [
    ('ACTIVE', 'Đang làm việc'),
    ('SUSPENDED', 'Tạm nghỉ'),
    ('PAUSED', 'Tạm dừng'),
    ('MATERNITY_LEAVE', 'Nghỉ thai sản'),
    ('INACTIVE', 'Đã nghỉ'),
]

# Tạm thời không đi làm (vẫn còn là nhân viên): không tính vào "đang làm việc".
TEMPORARILY_OFF_STATUSES = ('SUSPENDED', 'PAUSED', 'MATERNITY_LEAVE')

SOCIAL_INSURANCE_PARTICIPATION_STATUS = [
    ('PARTICIPATING', 'Đang tham gia'),
    ('NOT_PARTICIPATING', 'Không tham gia'),
    ('SUSPENDED', 'Tạm dừng'),
]


def compute_effective_employment_status(stored_status, end_date):
    """
    Tính trạng thái làm việc hiệu lực dựa trên:
    - stored_status: trạng thái admin set thủ công (dùng làm override)
    - end_date: ngày nghỉ việc trên employee

    Rules:
    - SUSPENDED/PAUSED (manual override, vd: tạm nghỉ) → SUSPENDED
    - MATERNITY_LEAVE → MATERNITY_LEAVE (giữ riêng để hiển thị "Nghỉ thai sản")
    - INACTIVE (admin set thủ công) → INACTIVE
    - end_date tồn tại và <= hôm nay → INACTIVE
    - còn lại → ACTIVE
    """
    from datetime import date
    if stored_status == 'MATERNITY_LEAVE':
        return 'MATERNITY_LEAVE'
    if stored_status in ('PAUSED', 'SUSPENDED'):
        return 'SUSPENDED'
    if stored_status == 'INACTIVE':
        return 'INACTIVE'
    if end_date and end_date <= date.today():
        return 'INACTIVE'
    return 'ACTIVE'

# Work form/employment type
WORK_FORM = [
    ('FULL_TIME', 'Toàn thời gian'),
    ('PART_TIME', 'Bán thời gian'),
    ('CONTRACT', 'Hợp đồng'),
    ('INTERN', 'Thực tập'),
    ('COLLABORATOR', 'Cộng tác viên'),
]

# Education level
EDUCATION_LEVEL = [
    ('HIGH_SCHOOL', 'Trung học phổ thông'),
    ('ASSOCIATE', 'Cao đẳng'),
    ('BACHELOR', 'Đại học'),
    ('MASTER', 'Thạc sĩ'),
    ('DOCTORATE', 'Tiến sĩ'),
    ('OTHER', 'Khác'),
]

# Marital status
MARITAL_STATUS = [
    ('SINGLE', 'Độc thân'),
    ('MARRIED', 'Đã kết hôn'),
    ('DIVORCED', 'Ly hôn'),
    ('WIDOWED', 'Góa'),
]

TIME_OFF_TYPE = [
    ('ANNUAL', 'Nghỉ phép năm'),
    ('SICK', 'Nghỉ ốm'),
    ('UNPAID', 'Không lương'),
    ('OTHER', 'Khác'),
]

# Contract types
CONTRACT_TYPE = [
    ('PROBATION', 'Hợp đồng thử việc'),
    ('PROBATION_1M', 'Thử việc 1 tháng'),
    ('PROBATION_2M', 'Thử việc 2 tháng'),
    ('INTERN', 'Hợp đồng thực tập sinh'),
    ('COLLABORATOR', 'Hợp đồng cộng tác viên'),
    ('SIX_MONTH', 'Hợp đồng lao động 6 tháng'),
    ('ONE_YEAR', 'Hợp đồng lao động 12 tháng'),
    ('TWO_YEAR', 'Hợp đồng lao động 24 tháng'),
    ('THREE_YEAR', 'Hợp đồng lao động 36 tháng'),
    ('INDEFINITE', 'Hợp đồng vô thời hạn'),
    ('SERVICE', 'Hợp đồng dịch vụ'),
    ('CONFIDENTIALITY', 'Thoả thuận bảo mật'),
    ('COMPANY_RULES', 'Cam kết đọc hiểu nội quy công ty'),
    ('NURSING_COMMITMENT', 'Cam kết của CBNV Điều dưỡng'),
]

# Nhóm loại hợp đồng — mọi chỗ kiểm tra "thử việc / chưa chính thức" dùng các hằng số
# này thay vì so chuỗi 'PROBATION' (có nhiều mã thử việc).
PROBATION_CONTRACT_TYPES = frozenset({'PROBATION', 'PROBATION_1M', 'PROBATION_2M'})
NON_OFFICIAL_CONTRACT_TYPES = PROBATION_CONTRACT_TYPES | {'INTERN', 'COLLABORATOR'}
FIXED_TERM_CONTRACT_MONTHS = {'SIX_MONTH': 6, 'ONE_YEAR': 12, 'TWO_YEAR': 24, 'THREE_YEAR': 36}
OFFICIAL_LABOR_CONTRACT_TYPES = frozenset(FIXED_TERM_CONTRACT_MONTHS) | {'INDEFINITE'}
# Mã thử việc có sẵn số tháng; 'PROBATION' dùng số tháng nhập riêng.
PROBATION_MONTHS_BY_CONTRACT_TYPE = {'PROBATION_1M': 1, 'PROBATION_2M': 2}


def probation_months_for(contract_type, fallback):
    """Số tháng thử việc: theo mã hợp đồng nếu mã đã có sẵn số tháng, ngược lại dùng fallback."""
    return PROBATION_MONTHS_BY_CONTRACT_TYPE.get(contract_type or '', fallback)


# Employee file status
FILE_STATUS = [
    ('COMPLETE', 'Nộp đủ'),
    ('NEED_SUPPLEMENT', 'Cần bổ sung hồ sơ'),
    ('NOT_SUBMITTED', 'Chưa nộp'),
    ('PENDING_REVIEW', 'Chờ rà soát'),
]

# Allowance types
ALLOWANCE_TYPE = [
    ('PARKING', 'Phụ cấp gửi xe'),
    ('RESPONSIBILITY', 'Phụ cấp trách nhiệm'),
    ('MEAL', 'Phụ cấp ăn ca'),
    ('TRANSPORT_PHONE', 'Phụ cấp xăng xe điện thoại'),
    ('OTHER', 'Phụ cấp khác'),
]

# Probation Rate (Tỉ lệ thử việc)
PROBATION_RATE = [
    ('OPTION_1', 'Tháng đầu 85%, tháng sau 85%'),
    ('OPTION_2', 'Tháng đầu 85%, tháng sau 100%'),
    ('OPTION_3', 'Tháng đầu 100%, tháng sau 100%'),
]

# Work Location
WORK_LOCATION = [
    ('VP_HA_NOI', 'Văn phòng Hà Nội'),
    ('VP_HCM', 'Văn phòng TP. Hồ Chí Minh'),
]
# -----------------------------
# Đơn vị làm việc
# -----------------------------
class CompanyUnit(models.Model):
    """Đơn vị làm việc (VD: Công ty A, Chi nhánh B)"""
    name = models.CharField(max_length=255, verbose_name="Tên đơn vị")
    code = models.CharField(max_length=64, unique=True, verbose_name="Mã đơn vị")
    prefix_code = models.CharField(max_length=10, blank=True, default='', verbose_name="Ký tự mã nhân sự")
    contract_unit_code = models.CharField(
        max_length=20, blank=True, default='',
        verbose_name="Mã đơn vị trên số HĐLĐ",
        help_text="Chỉ dùng để hiển thị trên số hợp đồng (VD: HĐLĐ-ABC). "
                  "Để trống sẽ dùng 'Mã đơn vị' như bình thường. Không ảnh hưởng đến mã nhân viên.",
    )
    description = models.TextField(blank=True, verbose_name="Mô tả")
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        verbose_name = "Đơn vị làm việc"
        verbose_name_plural = "Đơn vị làm việc"
        ordering = ['name']


# Phòng ban
# -----------------------------
class Department(models.Model):
    """Phòng ban trong tổ chức, có thể có cấu trúc phân cấp"""
    name = models.CharField(max_length=255, verbose_name="Tên phòng ban")
    code = models.CharField(max_length=64, unique=True, verbose_name="Mã phòng ban")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    parent_department = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, 
                                         related_name='child_departments', verbose_name="Phòng ban cha")
    manager = models.ForeignKey('Employee', on_delete=models.SET_NULL, null=True, blank=True,
                               related_name='managed_departments', verbose_name="Trưởng phòng")
    is_section = models.BooleanField(default=False, verbose_name="Là bộ phận?",
                                     help_text="True = bộ phận (con của phòng ban), False = phòng ban")
    saturday_afternoon_always_workday = models.BooleanField(
        default=False,
        verbose_name="Làm việc chiều thứ 7 mọi tuần",
        help_text=(
            "Mặc định thứ 7 của tuần thứ 2 và thứ 4 trong tháng chỉ làm nửa ngày "
            "(buổi chiều không tự động tính công, phải làm đơn tăng ca). Bật cờ này "
            "nếu phòng ban vẫn đi làm chiều thứ 7 ở TẤT CẢ các tuần (tương tự việc "
            "1 số phòng ban vẫn đi làm Chủ nhật)."
        ),
    )
    # Phòng ban CÓ đi làm Chủ nhật — đây là NGOẠI LỆ, mặc định mọi phòng nghỉ
    # Chủ nhật. Cố ý diễn tả theo chiều ngoại lệ (giống
    # saturday_afternoon_always_workday ngay dưới) vì toàn hệ thống đã mặc định
    # Chủ nhật không phải ngày làm việc (deadline_utils.is_working_day).
    #
    # Trước 2026-10-10 không có trường nào cho việc này: báo cáo đối soát phải
    # TỰ SUY từ chấm công (phòng nào >= 50% bản ghi Chủ nhật có quẹt thẻ thì coi
    # là đi làm). Cách đó sai ngay khi HCNS đổi chính sách — tháng 9/2026 nó xếp
    # 4 phòng KD/CSKH là có làm Chủ nhật nên 29/30 dòng vi phạm Chủ nhật rơi vào
    # đúng các phòng đó, kể cả 2 dòng của chính trưởng phòng. HCNS 2026-10-10
    # cho khối Kinh doanh/CSKH nghỉ Chủ nhật giống khối VP.
    #
    # LƯU Ý khi sửa: đừng đảo thành "sunday_off". Đã thử và sai — mặc định sẽ
    # thành "Chủ nhật là ngày làm việc", làm mọi phòng chưa bật cờ bị gắn lỗi
    # mọi Chủ nhật (tháng 9 nhảy từ 210 lên 1.038 dòng = 483 triệu tiền phạt ảo).
    #
    # CHỈ ảnh hưởng báo cáo đối soát vi phạm. KHÔNG đụng công/lương: engine tính
    # theo event, ngày không có bản ghi chấm công thì vốn không sinh công lẫn vắng.
    works_on_sunday = models.BooleanField(
        default=False,
        verbose_name="Có đi làm Chủ nhật",
        help_text=(
            "Mặc định TẮT: phòng ban nghỉ Chủ nhật, nên Chủ nhật không bị tính "
            "là 'nghỉ không tạo đơn' trong báo cáo đối soát vi phạm. Chỉ bật cho "
            "phòng ban thực sự đi làm Chủ nhật — khi đó nhân viên vắng Chủ nhật "
            "phải có đơn nghỉ như ngày thường."
        ),
    )
    # Chính sách riêng (vd Kế toán, chốt 2026-10-02): được làm online các buổi
    # chiều thứ 7 tuần 2/4 và các ngày Chủ nhật KHÔNG giới hạn do đặc thù công
    # việc — những đơn này không tính vào hạn mức online/tháng (CompanyConfig.
    # max_online_work_count_per_month). Vẫn phải đăng ký trước 2 tiếng.
    online_weekend_unlimited = models.BooleanField(
        default=False,
        verbose_name="Làm online chiều T7 tuần 2/4 & Chủ nhật không giới hạn",
        help_text=(
            "Bật thì đơn làm việc online vào buổi chiều thứ 7 tuần 2, tuần 4 và các "
            "ngày Chủ nhật KHÔNG tính vào hạn mức online/tháng. Đơn online ngày "
            "thường vẫn theo hạn mức chung. Vẫn phải đăng ký trước 2 tiếng."
        ),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Soft delete — trước đây "Xoá" ở trang Quản lý phòng ban/Quản lý bộ phận là xoá
    # cứng thẳng vào DB, không lưu lại ai xoá lúc nào (HR từng báo mất bộ phận không
    # rõ nguyên nhân mà không có cách nào tra lại). Xoá cứng còn âm thầm gỡ luôn
    # `Employee.department` (on_delete=SET_NULL) của mọi NV đang thuộc phòng/bộ phận
    # đó. Chuyển sang soft-delete để vừa có audit trail, vừa tránh mất dữ liệu liên
    # đới ngoài ý muốn.
    is_deleted = models.BooleanField(default=False, verbose_name="Đã xoá")
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm xoá")
    deleted_by = models.ForeignKey(
        'Employee', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='deleted_departments', verbose_name="Người xoá",
    )

    def __str__(self):
        return f"{self.code} - {self.name}"

    class Meta:
        verbose_name = "Phòng ban"
        verbose_name_plural = "Phòng ban"
        ordering = ['code']

    def clean(self):
        """Ngăn chặn vòng lặp trong cấu trúc phân cấp"""
        if self.parent_department and self.parent_department.id == self.id:
            raise ValidationError("Phòng ban không thể là cha của chính nó")
        
        # Kiểm tra vòng lặp đệ quy
        parent = self.parent_department
        while parent:
            if parent.id == self.id:
                raise ValidationError("Phát hiện vòng lặp trong cấu trúc phòng ban")
            parent = parent.parent_department


class DepartmentScheduleChange(models.Model):
    """Đổi lịch làm việc của phòng ban TỪ MỘT NGÀY (HCNS 2026-10-15: team Giám sát
    chất lượng chuyển sang lịch Kinh doanh từ 15/10/2026).

    3 cờ lịch trên Department không có ngày hiệu lực: bật/tắt là áp cho mọi ngày,
    kể cả nửa đầu tháng khi tính lại công. Dòng ở đây ghi giá trị MỚI của cả 3 cờ
    kể từ `effective_from`; cờ trên Department là LỊCH GỐC, áp cho các ngày trước
    lần đổi đầu tiên. Tra theo ngày: employee/schedule.py.
    """
    department = models.ForeignKey(
        Department, on_delete=models.CASCADE, related_name='schedule_changes', verbose_name="Phòng ban",
    )
    effective_from = models.DateField(verbose_name="Áp dụng từ ngày")
    works_on_sunday = models.BooleanField(default=False, verbose_name="Có đi làm Chủ nhật")
    saturday_afternoon_always_workday = models.BooleanField(
        default=False, verbose_name="Làm việc chiều thứ 7 mọi tuần",
    )
    online_weekend_unlimited = models.BooleanField(
        default=False, verbose_name="Làm online chiều T7 tuần 2/4 & Chủ nhật không giới hạn",
    )
    note = models.CharField(max_length=255, blank=True, default='', verbose_name="Ghi chú")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Đổi lịch làm việc phòng ban"
        verbose_name_plural = "Đổi lịch làm việc phòng ban"
        ordering = ['department', 'effective_from']
        constraints = [
            models.UniqueConstraint(
                fields=['department', 'effective_from'], name='uniq_department_schedule_change_date',
            ),
        ]

    def __str__(self):
        return f"{self.department.code} từ {self.effective_from:%d/%m/%Y}"


# -----------------------------
# Vị trí công việc
# -----------------------------
class Position(models.Model):
    """Vị trí công việc trong tổ chức, có thể có cấp bậc"""
    title = models.CharField(max_length=255, verbose_name="Chức danh")
    code = models.CharField(max_length=64, unique=True, verbose_name="Mã vị trí")
    description = models.TextField(blank=True, verbose_name="Mô tả công việc")
    department = models.ManyToManyField(
        Department,
        blank=True,
        related_name='positions',
        verbose_name="Phòng ban",
    )
    level = models.IntegerField(default=1, verbose_name="Cấp bậc",
                               help_text="Cấp bậc càng cao thì vị trí càng quan trọng")
    parent_position = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name='child_positions', verbose_name="Vị trí cấp trên")
    is_management = models.BooleanField(default=False, verbose_name="Vị trí quản lý")
    overtime_grace_deadline_enabled = models.BooleanField(
        default=False,
        verbose_name="Tăng ca được gia hạn tới 10h sáng hôm sau",
        help_text=(
            "Bật cho các vị trí có thể phát sinh tăng ca kéo dài quá giờ ngoài kế "
            "hoạch vì lý do bất khả kháng (vd ca mổ không thể dừng đúng giờ). Khi bật, "
            "hạn TẠO và DUYỆT đơn tăng ca của vị trí này nới tới 10h00 sáng ngày làm "
            "việc kế tiếp, thay vì phải xong trước 2 giờ so với giờ bắt đầu tăng ca. "
            "Cần mở cho đúng 1 nhân viên mà cả vị trí không được hưởng thì dùng cờ "
            "tương ứng ở trang Nhân viên."
        ),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.code} - {self.title}"

    class Meta:
        verbose_name = "Vị trí"
        verbose_name_plural = "Vị trí"
        ordering = ['level', 'code']

    def clean(self):
        """Ngăn chặn vòng lặp trong cấu trúc phân cấp"""
        if self.parent_position and self.parent_position.id == self.id:
            raise ValidationError("Vị trí không thể là cha của chính nó")
        
        # Kiểm tra vòng lặp đệ quy
        parent = self.parent_position
        while parent:
            if parent.id == self.id:
                raise ValidationError("Phát hiện vòng lặp trong cấu trúc vị trí")
            parent = parent.parent_position


# -----------------------------
# Nhân sự
# -----------------------------
class Employee(models.Model):
    EMPLOYEE_ID_FALLBACK_PREFIX = getattr(settings, 'EMPLOYEE_ID_FALLBACK_PREFIX', 'NV') or 'NV'
    EMPLOYEE_ID_MIN_DIGITS = 3

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='employee')
    employee_id = models.CharField(max_length=64, unique=True, verbose_name="Mã nhân viên")
    position = models.ForeignKey(Position, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Vị trí")
    department = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='employees', verbose_name="Phòng ban")
    manager = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True,
                               related_name='subordinates', verbose_name="Quản lý trực tiếp")
    company_unit = models.ForeignKey(CompanyUnit, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name='employees', verbose_name="Đơn vị")
    
    # Thông tin cá nhân
    full_name = models.CharField(max_length=255, verbose_name="Họ và tên")
    gender = models.CharField(max_length=1, choices=GENDER, blank=True, null=True, verbose_name="Giới tính")
    date_of_birth = models.DateField(null=True, blank=True, verbose_name="Ngày sinh")
    phone_number = models.CharField(max_length=20, blank=True, verbose_name="Số điện thoại")
    personal_email = models.EmailField(blank=True, verbose_name="Email cá nhân")
    facebook_link = models.URLField(blank=True, null=True, verbose_name="Link Facebook")
    
    # Thông tin tổ chức
    region = models.CharField(max_length=100, blank=True, null=True, verbose_name="Vùng/Miền")
    block = models.CharField(max_length=100, blank=True, null=True, verbose_name="Khối")
    subsidiary_legal_entity = models.CharField(max_length=255, blank=True, null=True, verbose_name="Pháp nhân con")
    section = models.CharField(max_length=100, blank=True, null=True, verbose_name="Bộ phận")
    rank = models.CharField(max_length=100, blank=True, null=True, verbose_name="Cấp bậc")
    work_location = models.CharField(max_length=255, blank=True, null=True, verbose_name="Địa điểm làm việc")
    doctor_team = models.CharField(max_length=100, blank=True, null=True, verbose_name="Team Bác sĩ")
    
    # Quản lý gián tiếp
    manager_level_2 = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name='subordinates_level_2', 
                                       verbose_name="Quản lý cấp 2 (Gián tiếp 1)")
    manager_level_3 = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name='subordinates_level_3',
                                       verbose_name="Quản lý cấp 3 (Gián tiếp 2)")
    
    # Thông tin hợp đồng và công việc
    work_form = models.CharField(max_length=20, blank=True, null=True,
                                verbose_name="Hình thức làm việc")
    education_level = models.CharField(max_length=20, blank=True, null=True,
                                      verbose_name="Trình độ học vấn")
    
    # Thông tin ngân hàng
    bank_name = models.CharField(max_length=255, blank=True, verbose_name="Tên ngân hàng")
    bank_account = models.CharField(max_length=64, blank=True, verbose_name="Số tài khoản")
    bank_account_holder = models.CharField(max_length=255, blank=True, verbose_name="Chủ tài khoản")
    bank_branch = models.CharField(max_length=255, blank=True, verbose_name="Chi nhánh ngân hàng")
    
    # Thông tin BHXH và thuế
    social_insurance_number = models.CharField(max_length=20, blank=True, null=True, 
                                              verbose_name="Mã số BHXH")
    tax_code = models.CharField(max_length=20, blank=True, null=True, verbose_name="Mã số thuế TNCN")
    household_code = models.CharField(max_length=50, blank=True, null=True, verbose_name="Mã hộ gia đình")
    insurance_participation = models.CharField(max_length=255, blank=True, null=True,
                                              verbose_name="Đang tham gia đóng tại Công ty")
    insurance_increase_time = models.CharField(max_length=50, blank=True, null=True,
                                              verbose_name="Thời điểm báo tăng")
    social_insurance_contribution_level = models.IntegerField(
        default=0,
        null=True,
        blank=True,
        verbose_name="Mức đóng BHXH"
    )
    social_insurance_participation_status = models.CharField(
        max_length=20,
        choices=SOCIAL_INSURANCE_PARTICIPATION_STATUS,
        blank=True,
        null=True,
        verbose_name="Trạng thái tham gia BHXH"
    )
    social_insurance_start_date = models.DateField(
        null=True,
        blank=True,
        verbose_name="Ngày bắt đầu đóng BHXH"
    )
    social_insurance_end_date = models.DateField(
        null=True,
        blank=True,
        verbose_name="Ngày kết thúc đóng BHXH"
    )
    
    # Trạng thái hoạt động
    is_active = models.BooleanField(default=True, verbose_name="Đang hoạt động",
                                    help_text="Nhân viên đang hoạt động trong hệ thống")

    # Trạng thái làm việc
    employment_status = models.CharField(max_length=20, choices=EMPLOYMENT_STATUS, default='ACTIVE', verbose_name="Trạng thái làm việc")
    employment_status_notes = models.TextField(blank=True, null=True, verbose_name="Ghi chú trạng thái làm việc")
    start_date = models.DateField(null=True, blank=True, verbose_name="Ngày bắt đầu làm việc")
    end_date = models.DateField(null=True, blank=True, verbose_name="Ngày kết thúc làm việc")
    termination_reason = models.TextField(blank=True, null=True, verbose_name="Lý do nghỉ việc")
    total_work_months = models.IntegerField(null=True, blank=True, 
                                           verbose_name="Tổng thời gian đã làm việc (tháng)")
    
    # Avatar (S3 key)
    avatar = models.CharField(max_length=500, blank=True, null=True,
                              verbose_name="Ảnh đại diện",
                              help_text="S3 key của ảnh đại diện nhân viên")

    # QR Code
    qr_code = models.ImageField(upload_to='qr_codes/', blank=True, null=True, verbose_name="Mã QR")
    
    # Thông tin bổ sung
    extra_info = models.JSONField(default=dict, blank=True, verbose_name="Thông tin bổ sung")
    
    # Quan hệ báo cáo
    reporting_path = models.TextField(blank=True, verbose_name="Đường dẫn báo cáo",
                                     help_text="Chuỗi ID của các cấp quản lý từ cao nhất đến thấp nhất, phân cách bằng dấu phẩy")
    
    # ====== NEW FIELDS FOR ONBOARDING AND HR ======
    
    # HR flag
    is_hr = models.BooleanField(default=False, verbose_name="Là nhân viên HR",
                               help_text="Đánh dấu nhân viên thuộc bộ phận nhân sự")

    # Ghi đè riêng cho từng nhân viên cờ Department.saturday_afternoon_always_workday —
    # dùng cho trường hợp cả phòng ban KHÔNG làm chiều thứ 7 mọi tuần, nhưng riêng 1-2
    # nhân viên trong phòng ban đó vẫn đi làm chiều thứ 7 mọi tuần (hoặc ngược lại: phòng
    # ban có bật cờ nhưng riêng nhân viên đó lại theo rule mặc định thứ 7 tuần 2/4 nửa
    # ngày). None (mặc định) = không ghi đè, dùng đúng cờ của phòng ban.
    saturday_afternoon_always_workday = models.BooleanField(
        null=True, blank=True, default=None,
        verbose_name="Ghi đè: Làm việc chiều thứ 7 mọi tuần",
        help_text=(
            "Để trống = áp dụng theo cờ của phòng ban. Chọn 'Có'/'Không' để ghi đè "
            "riêng cho nhân viên này, bất kể phòng ban đang bật/tắt cờ gì."
        ),
    )

    # Ngoại lệ LẺ cho hạn đơn tăng ca: cùng chính sách với
    # Position.overtime_grace_deadline_enabled nhưng bật cho ĐÚNG 1 người, dùng khi
    # cả vị trí KHÔNG được gia hạn mà riêng nhân viên này được HCNS xét. Hiện chưa
    # bật cho ai — để sẵn vì kiểu yêu cầu "riêng bạn X" phát sinh liên tục (lần gần
    # nhất 2026-09-24 hoá ra người được nêu đã thuộc vị trí TLHA được gia hạn sẵn).
    # Khớp 1 trong 2 cờ là được gia hạn —
    # xem hrm/deadline_utils.py::is_overtime_extended_deadline_eligible.
    overtime_extended_deadline_enabled = models.BooleanField(
        default=False,
        verbose_name="Ngoại lệ: Tăng ca được gia hạn tới 10h sáng hôm sau",
        help_text=(
            "Bật cho nhân viên được HCNS xét riêng: hạn TẠO và DUYỆT đơn tăng ca "
            "nới tới 10h00 sáng ngày làm việc kế tiếp, thay vì phải xong trước 2 "
            "giờ so với giờ bắt đầu tăng ca. Chỉ cần bật khi VỊ TRÍ của nhân viên "
            "không được gia hạn sẵn (xem cờ tương ứng ở trang Vị trí)."
        ),
    )

    # Salary information
    basic_salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, 
                                      verbose_name="Lương cơ bản", help_text="Lương cơ bản hàng tháng")
    allowance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True,
                                   verbose_name="Phụ cấp", help_text="Phụ cấp hàng tháng")
    # Thu nhập cố định khác nhận hàng tháng (ngoài lương cơ bản và phụ cấp)
    other_fixed_monthly_income = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Thu nhập cố định khác",
        help_text="Khoản thu nhập cố định hàng tháng ngoài lương cơ bản và phụ cấp"
    )
    
    # Contract information
    contract_type = models.CharField(max_length=20, null=True, blank=True,
                                    verbose_name="Loại hợp đồng")
    probation_end_date = models.DateField(null=True, blank=True, verbose_name="Ngày kết thúc thử việc")
    official_start_date = models.DateField(null=True, blank=True, verbose_name="Ngày lên chính thức",
                                           help_text="Ngày nhân viên chính thức (sau khi kết thúc thử việc)")
    probation_months = models.IntegerField(null=True, blank=True, verbose_name="Tháng thử việc",
                                          help_text="Số tháng thử việc (1, 2, 3... tùy vị trí)")
    
    # Employee file status
    file_status = models.CharField(max_length=20, choices=FILE_STATUS, default='NOT_SUBMITTED',
                                  verbose_name="Trạng thái hồ sơ")
    file_submission_deadline = models.DateField(null=True, blank=True, 
                                               verbose_name="Hạn nộp hồ sơ",
                                               help_text="Hạn nộp hồ sơ đầy đủ (7 ngày sau ngày bắt đầu làm việc)")
    file_submission_date = models.DateField(null=True, blank=True, verbose_name="Ngày nộp hồ sơ")
    file_review_notes = models.TextField(blank=True, verbose_name="Ghi chú rà soát hồ sơ")

    # Checklist hồ sơ
    doc_resume = models.BooleanField(default=False, verbose_name="Sơ yếu lý lịch")
    doc_cccd = models.BooleanField(default=False, verbose_name="Căn cước công dân")
    doc_degree = models.BooleanField(default=False, verbose_name="Bằng cấp")
    doc_health = models.BooleanField(default=False, verbose_name="Giấy khám sức khỏe")

    # Training integration
    training_presentation_viewed = models.BooleanField(default=False, verbose_name="Đã xem bài thuyết trình đào tạo hội nhập")
    training_presentation_viewed_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm xem bài thuyết trình")
    
    # VNEID/CCCD information
    vneid_screenshot = models.FileField(upload_to='vneid_screenshots/', null=True, blank=True,
                                       verbose_name="Ảnh chụp màn hình thông tin VNEID")
    cccd_number = models.CharField(max_length=20, blank=True, verbose_name="Số CCCD")
    old_id_number = models.CharField(max_length=20, blank=True, null=True, verbose_name="Số CMND cũ")
    cccd_issue_date = models.DateField(null=True, blank=True, verbose_name="Ngày cấp CCCD")
    cccd_issue_place = models.CharField(max_length=255, blank=True, verbose_name="Nơi cấp CCCD")
    link_cccd = models.CharField(max_length=500, blank=True, verbose_name="Link CCCD/CMT")
    birth_place = models.CharField(max_length=255, blank=True, verbose_name="Nơi khai sinh")
    permanent_residence = models.CharField(max_length=500, blank=True, verbose_name="Nơi thường trú")
    current_address = models.CharField(max_length=500, blank=True, null=True, 
                                      verbose_name="Địa chỉ hiện tại")
    marital_status = models.CharField(max_length=20, blank=True, null=True,
                                     verbose_name="Tình trạng hôn nhân")
    ethnicity = models.CharField(max_length=100, blank=True, null=True,
                                verbose_name="Dân tộc")
    nationality = models.CharField(max_length=100, blank=True, null=True,
                                  verbose_name="Quốc tịch")
    
    # Thông tin người liên hệ khẩn cấp
    emergency_contact_name = models.CharField(max_length=255, blank=True, null=True,
                                             verbose_name="Người liên hệ khẩn cấp")
    emergency_contact_relationship = models.CharField(max_length=100, blank=True, null=True,
                                                     verbose_name="Mối quan hệ")
    emergency_contact_phone = models.CharField(max_length=20, blank=True, null=True,
                                              verbose_name="Số điện thoại người thân")
    emergency_contact_dob = models.DateField(null=True, blank=True, 
                                            verbose_name="Ngày sinh người thân")
    emergency_contact_occupation = models.CharField(max_length=255, blank=True, null=True,
                                                   verbose_name="Nghề nghiệp người thân")
    emergency_contact_address = models.CharField(max_length=500, blank=True, null=True,
                                                verbose_name="Địa chỉ người liên hệ")
    
    # Ghi chú và thông tin bổ sung
    notes = models.TextField(blank=True, null=True, verbose_name="Ghi chú")
    salary_notes = models.TextField(blank=True, null=True, verbose_name="Ghi chú lương")
    allowance_notes = models.TextField(blank=True, null=True, verbose_name="Ghi chú phụ cấp")
    probation_rate = models.CharField(max_length=20, blank=True, null=True,
                                     verbose_name="Tỉ lệ thử việc")

    # Tỷ lệ hưởng doanh số và lợi nhuận
    revenue_percentage = models.CharField(max_length=100, blank=True, null=True,
                                          verbose_name="Tỷ lệ % doanh số hưởng")
    profit_percentage = models.CharField(max_length=100, blank=True, null=True,
                                         verbose_name="Tỷ lệ % lợi nhuận hưởng")

    # Ngày hợp đồng
    contract_start_date = models.DateField(null=True, blank=True, verbose_name="Ngày bắt đầu hợp đồng")
    contract_end_date = models.DateField(null=True, blank=True, verbose_name="Ngày kết thúc hợp đồng")
    
    # Lưu trữ thông tin điều chỉnh lương và hợp đồng dưới dạng JSON
    salary_adjustments = models.JSONField(default=dict, blank=True, 
                                         verbose_name="Lịch sử điều chỉnh lương",
                                         help_text="Lưu trữ các lần điều chỉnh lương theo thời gian, và thông tinh mức đóng bảo hiểm xã hội")
    contracts_info = models.JSONField(default=dict, blank=True,
                                     verbose_name="Thông tin hợp đồng",
                                     help_text="Lưu trữ thông tin HĐ DV, HĐLĐ và Cam kết BMTT")

    # Số ngày nghỉ phép năm còn lại
    annual_leave_balance = models.DecimalField(
        max_digits=7, decimal_places=2, default=12.0,
        verbose_name="Số ngày nghỉ phép còn lại",
        help_text="Số ngày nghỉ phép năm còn lại của nhân viên trong năm hiện tại"
    )
    annual_leave_balance_year = models.IntegerField(
        null=True, blank=True,
        verbose_name="Năm của số dư phép",
        help_text="Năm tương ứng với giá trị annual_leave_balance"
    )

    # Tài khoản Nurse App (cskh-app-backend)
    nurse_app_username = models.CharField(
        max_length=150,
        blank=True,
        null=True,
        unique=True,
        verbose_name="Tên đăng nhập Nurse App",
        help_text="Username đăng nhập vào ứng dụng chăm sóc khách hàng (cskh-app)"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.employee_id} - {self.full_name}"

    class Meta:
        verbose_name = "Nhân viên"
        verbose_name_plural = "Nhân viên"
        ordering = ['employee_id']

    @staticmethod
    def normalize_employee_id_prefix(raw_prefix):
        if raw_prefix is None:
            return ''
        normalized = re.sub(r'[^A-Za-z0-9]', '', str(raw_prefix).strip().upper())
        return normalized

    @classmethod
    def resolve_company_unit(cls, company_unit):
        if isinstance(company_unit, CompanyUnit):
            return company_unit

        if company_unit is None:
            return None

        raw_value = str(company_unit).strip()
        if not raw_value:
            return None

        if raw_value.isdigit():
            found = CompanyUnit.objects.filter(id=int(raw_value)).first()
            if found:
                return found

        return (
            CompanyUnit.objects.filter(code__iexact=raw_value).first()
            or CompanyUnit.objects.filter(prefix_code__iexact=raw_value).first()
            or CompanyUnit.objects.filter(name__iexact=raw_value).first()
        )

    @classmethod
    def get_employee_id_prefix(cls, company_unit=None):
        resolved_unit = cls.resolve_company_unit(company_unit)

        if resolved_unit:
            configured_prefix = cls.normalize_employee_id_prefix(resolved_unit.prefix_code)
            if configured_prefix:
                return configured_prefix, resolved_unit

            fallback_from_unit_code = cls.normalize_employee_id_prefix(resolved_unit.code)
            if fallback_from_unit_code:
                return fallback_from_unit_code, resolved_unit

        return cls.EMPLOYEE_ID_FALLBACK_PREFIX, resolved_unit

    @classmethod
    def generate_next_employee_id(cls, company_unit=None, prefix=None, min_digits=None):
        prefix_value = cls.normalize_employee_id_prefix(prefix)
        resolved_unit = None
        if not prefix_value:
            prefix_value, resolved_unit = cls.get_employee_id_prefix(company_unit)

        if not prefix_value:
            prefix_value = cls.EMPLOYEE_ID_FALLBACK_PREFIX

        min_digits_value = min_digits if min_digits is not None else cls.EMPLOYEE_ID_MIN_DIGITS
        pattern = rf'^{re.escape(prefix_value)}\d+$'
        parse_pattern = re.compile(rf'^{re.escape(prefix_value)}(\d+)$', re.IGNORECASE)

        numbers = []
        widths = []

        for emp_id in cls.objects.filter(employee_id__iregex=pattern).values_list('employee_id', flat=True):
            match = parse_pattern.search(str(emp_id))
            if match:
                number_part = match.group(1)
                numbers.append(int(number_part))
                widths.append(len(number_part))

        for username in User.objects.filter(username__iregex=pattern).values_list('username', flat=True):
            match = parse_pattern.search(str(username))
            if match:
                number_part = match.group(1)
                numbers.append(int(number_part))
                widths.append(len(number_part))

        max_number = max(numbers) if numbers else 0
        next_number = max_number + 1
        width = max(max(widths) if widths else min_digits_value, min_digits_value)

        return f"{prefix_value}{next_number:0{width}d}"

    def save(self, *args, **kwargs):
        """Tự động cập nhật đường dẫn báo cáo khi lưu; ghi nhật ký khi đổi trạng thái."""
        self.update_reporting_path()
        is_new = self.pk is None
        old_status = None
        if not is_new:
            old_status = Employee.objects.filter(pk=self.pk).values_list('employment_status', flat=True).first()
        super().save(*args, **kwargs)
        if is_new or (old_status is not None and old_status != self.employment_status):
            # Người thao tác do view gắn tạm vào instance (`_changed_by`), nếu có.
            EmployeeStatusHistory.objects.create(
                employee=self,
                from_status=None if is_new else old_status,
                to_status=self.employment_status,
                changed_at=timezone.localdate(),
                changed_by=getattr(self, '_changed_by', None),
            )

    def update_reporting_path(self):
        """Cập nhật đường dẫn báo cáo dựa trên cấu trúc quản lý"""
        if not self.manager:
            self.reporting_path = str(self.id)
            return
        
        # Xây dựng đường dẫn từ manager lên trên
        path_parts = [str(self.id)]
        current = self.manager
        
        # Giới hạn độ sâu để tránh vòng lặp vô hạn
        max_depth = 20
        depth = 0
        
        while current and depth < max_depth:
            path_parts.append(str(current.id))
            if current.manager and current.manager.id != current.id:
                current = current.manager
            else:
                break
            depth += 1
        
        # Đảo ngược để có thứ tự từ cao nhất đến thấp nhất
        path_parts.reverse()
        self.reporting_path = ','.join(path_parts)

    def get_managers_chain(self):
        """Trả về danh sách tất cả quản lý trong chuỗi báo cáo"""
        if not self.reporting_path:
            return []
        
        try:
            employee_ids = [int(id_str) for id_str in self.reporting_path.split(',') if id_str]
            # Loại bỏ ID của chính nhân viên này
            employee_ids = [eid for eid in employee_ids if eid != self.id]
            
            # Lấy các employee từ database
            from django.db.models import Case, When
            preserved = Case(*[When(pk=pk, then=pos) for pos, pk in enumerate(employee_ids)])
            return Employee.objects.filter(id__in=employee_ids).order_by(preserved)
        except (ValueError, AttributeError):
            return []

    def get_direct_subordinates(self):
        """Trả về danh sách nhân viên cấp dưới trực tiếp"""
        return self.subordinates.all()

    def get_all_subordinates(self, include_self=False):
        """Trả về tất cả nhân viên cấp dưới (đệ quy)"""
        subordinates = set()
        
        def collect_subordinates(emp):
            for sub in emp.get_direct_subordinates():
                subordinates.add(sub)
                collect_subordinates(sub)
        
        collect_subordinates(self)
        
        if include_self:
            subordinates.add(self)
        
        return list(subordinates)

    def is_manager_of(self, employee):
        """Kiểm tra xem nhân viên này có phải là quản lý của employee khác không"""
        if not employee.reporting_path:
            return False
        return str(self.id) in employee.reporting_path.split(',')

    def get_organization_tree(self, max_depth=3):
        """Trả về cây tổ chức từ vị trí của nhân viên này"""
        tree = {
            'employee': self,
            'subordinates': [],
            'depth': 0
        }
        
        def build_tree(node, current_depth):
            if current_depth >= max_depth:
                return
            
            for sub in node.get_direct_subordinates():
                sub_node = {
                    'employee': sub,
                    'subordinates': [],
                    'depth': current_depth + 1
                }
                build_tree(sub, current_depth + 1)
                node['subordinates'].append(sub_node)
        
        build_tree(tree, 0)
        return tree


class EmployeeAssignmentHistory(models.Model):
    """Phòng ban / vị trí / Team bác sĩ / hình thức làm việc / ca cá nhân CŨ của
    nhân viên, áp cho các ngày TRƯỚC `changed_from` (yêu cầu 2026-10-15: điều
    chuyển không được làm đổi công các tháng trước — case NV80028 T9 part-time,
    T10 lên full-time, mở lại công T9 thấy 2 công lễ thay vì 1).

    Tự ghi khi HR đổi các thông tin trên (employee/signals.py), changed_from mặc
    định là ngày lưu — HR sửa được trong admin nếu nhập muộn. Tra theo ngày:
    employee/assignment.py.
    """
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name='assignment_history', verbose_name="Nhân viên",
    )
    changed_from = models.DateField(
        verbose_name="Dữ liệu mới áp dụng từ ngày",
        help_text="Các ngày TRƯỚC ngày này tính công theo phòng ban/vị trí/ca/hình thức ở dòng này.",
    )
    department = models.ForeignKey(
        Department, on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
        verbose_name="Phòng ban cũ",
    )
    position = models.ForeignKey(
        Position, on_delete=models.SET_NULL, null=True, blank=True, related_name='+', verbose_name="Vị trí cũ",
    )
    doctor_team = models.CharField(max_length=100, blank=True, null=True, verbose_name="Team Bác sĩ cũ")
    work_form = models.CharField(max_length=20, blank=True, null=True, choices=WORK_FORM,
                                 verbose_name="Hình thức làm việc cũ")
    personal_shift_ids = models.JSONField(
        null=True, blank=True, verbose_name="Ca cá nhân cũ (id ShiftConfig)",
        help_text="Để trống = dùng ca cá nhân hiện tại.",
    )
    note = models.CharField(max_length=255, blank=True, default='', verbose_name="Ghi chú")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Lịch sử điều chuyển"
        verbose_name_plural = "Lịch sử điều chuyển"
        ordering = ['employee', 'changed_from', 'id']
        indexes = [models.Index(fields=['employee', 'changed_from'], name='emp_assign_hist_emp_date')]

    def __str__(self):
        return f"{self.employee_id} trước {self.changed_from:%d/%m/%Y}"


# -----------------------------
# Lời chúc sinh nhật
# -----------------------------
class BirthdayWish(models.Model):
    """Lời chúc sinh nhật hàng năm gửi cho nhân viên"""
    recipient = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='received_birthday_wishes',
        verbose_name="Người nhận",
    )
    sender = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='sent_birthday_wishes',
        verbose_name="Người gửi",
    )
    message = models.TextField(verbose_name="Lời chúc")
    year = models.IntegerField(verbose_name="Năm", help_text="Năm gửi lời chúc")
    is_liked = models.BooleanField(default=False, verbose_name="Đã được like")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.sender.full_name} → {self.recipient.full_name} ({self.year})"

    class Meta:
        verbose_name = "Lời chúc sinh nhật"
        verbose_name_plural = "Lời chúc sinh nhật"
        ordering = ['-created_at']


# -----------------------------
# Người phụ thuộc (giảm trừ gia cảnh)
# -----------------------------
DEPENDENT_RELATIONSHIP = [
    ('CHILD', 'Con'),
    ('SPOUSE', 'Vợ/Chồng'),
    ('PARENT', 'Cha/Mẹ'),
    ('SIBLING', 'Anh/Chị/Em'),
    ('GRANDPARENT', 'Ông/Bà'),
    ('OTHER', 'Khác'),
]


class EmployeeStatusHistory(models.Model):
    """Nhật ký thay đổi trạng thái làm việc (employment_status) của nhân viên.

    Ghi tự động trong Employee.save() — bản ghi đầu tiên khi tạo hồ sơ có
    from_status rỗng. Dùng để thống kê nhân sự theo từng tháng trong quá khứ.
    """
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name='status_history', verbose_name="Nhân viên",
    )
    from_status = models.CharField(max_length=20, null=True, blank=True, verbose_name="Trạng thái trước")
    to_status = models.CharField(max_length=20, verbose_name="Trạng thái sau")
    changed_at = models.DateField(verbose_name="Ngày thay đổi")
    changed_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, verbose_name="Người thay đổi",
    )
    note = models.TextField(blank=True, verbose_name="Ghi chú")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Nhật ký trạng thái nhân viên"
        verbose_name_plural = "Nhật ký trạng thái nhân viên"
        # Cùng ngày có thể đổi nhiều lần → luôn phá hoà bằng id để lấy bản mới nhất.
        ordering = ['-changed_at', '-id']
        indexes = [models.Index(fields=['employee', 'changed_at'])]

    def __str__(self):
        return f"{self.employee.employee_id}: {self.from_status} → {self.to_status} ({self.changed_at})"


class EmployeeDependent(models.Model):
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='dependents',
        verbose_name="Nhân viên",
    )
    full_name = models.CharField(max_length=255, verbose_name="Họ và tên")
    date_of_birth = models.DateField(null=True, blank=True, verbose_name="Ngày sinh")
    relationship = models.CharField(max_length=20, choices=DEPENDENT_RELATIONSHIP,
                                    blank=True, null=True, verbose_name="Mối quan hệ")
    personal_identification_number = models.CharField(max_length=20, blank=True, null=True,
                                                      verbose_name="Số CCCD/Mã định danh")
    tax_code = models.CharField(max_length=20, blank=True, null=True, verbose_name="Mã số thuế")
    nationality = models.CharField(max_length=100, blank=True, null=True, verbose_name="Quốc tịch")
    dependent_from = models.DateField(null=True, blank=True, verbose_name="Giảm trừ từ tháng")
    dependent_to = models.DateField(null=True, blank=True, verbose_name="Giảm trừ đến tháng")
    is_active = models.BooleanField(default=True, verbose_name="Đang hiệu lực")
    notes = models.TextField(blank=True, verbose_name="Ghi chú")

    # Xoá mềm: hồ sơ người phụ thuộc là căn cứ giảm trừ thuế nên không xoá cứng.
    # `is_active` khác `is_deleted`: ngừng hiệu lực vẫn giữ để tính lại kỳ cũ,
    # còn đã xoá thì loại khỏi mọi kỳ.
    is_deleted = models.BooleanField(default=False, verbose_name="Đã xoá")
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="Thời điểm xoá")
    deleted_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='deleted_employee_dependents', verbose_name="Người xoá")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'employee_dependents'
        verbose_name = "Người phụ thuộc"
        verbose_name_plural = "Người phụ thuộc"
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['employee', 'is_active']),
            models.Index(fields=['employee', 'is_deleted']),
            models.Index(fields=['personal_identification_number']),
        ]

    def __str__(self):
        return f"{self.full_name} ({self.employee.employee_id})"
