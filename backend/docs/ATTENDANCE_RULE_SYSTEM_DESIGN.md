# Thiết kế hệ thống chấm công linh hoạt

## 1. Tổng quan

Hệ thống chấm công cần được thiết kế linh hoạt để dễ dàng thay đổi quy định theo thời gian. Hệ thống hiện tại đã có cơ sở hạ tầng cơ bản với các thành phần:

### 1.1. Backend (Django)
- **AttendanceRuleConfig**: Cấu hình quy tắc chấm công
- **LeavePolicyConfig**: Cấu hình chính sách nghỉ phép
- **AttendanceRuleEngine**: Engine tính toán chấm công tự động

### 1.2. Frontend (React + TypeScript)
- **AttendanceRuleList**: Danh sách quy tắc chấm công
- **AttendanceRuleCreate**: Tạo quy tắc chấm công mới
- **LeavePolicyList**: Danh sách chính sách nghỉ phép
- **LeavePolicyCreate**: Tạo chính sách nghỉ phép mới

## 2. Quy định chấm công hiện tại

### 2.1. Các ca làm việc

#### Ca hành chính:
- **Ca đầy đủ**: 8h30 - 17h30 → Tính 01 công
- **Ca sáng**: 8h30 - 12h00 → Tính 0.5 công
- **Ca chiều**: 13h00 - 17h30 → Tính 0.5 công

#### Ca ADS (Nhân viên ADS):
- **Ca đầy đủ**: 9h00 - 17h30 → Tính 01 công
- **Ca sáng**: 9h00 - 12h00 → Tính 0.5 công
- **Ca chiều**: 13h00 - 17h30 → Tính 0.5 công

#### Ca CSKH MB:
- **Ca đầy đủ**: 8h00 - 17h00 → Tính 01 công
- **Ca sáng**: 8h00 - 12h00 → Tính 0.5 công
- **Ca chiều**: 13h00 - 17h00 → Tính 0.5 công

#### Ca kinh doanh:
- **Ca đầy đủ**: 13h00 - 21h00 → Tính 01 công
- **Ca gãy**: 8h30 - 12h00 (văn phòng) + Trực tối tại nhà → Tính 01 công
- **Ca tối**: 17h30 - 21h00 → Tính 0.5 công

### 2.2. Quy trình xin nghỉ phép

#### Thời gian báo trước:
1. **Nghỉ dưới 01 ngày**: 04 giờ làm việc
2. **Nghỉ từ 01-03 ngày**: 01 ngày làm việc
3. **Nghỉ từ 04-07 ngày**: 05 ngày làm việc
4. **Nghỉ từ 08 ngày trở lên**: 10 ngày làm việc

#### Trường hợp khẩn cấp:
- Ốm đau hoặc việc cấp bách: Báo trước 02 giờ trước ca làm việc
- Sau khi đi làm lại: Bổ sung đơn xin nghỉ ngay

## 3. Thiết kế cấu trúc dữ liệu

### 3.1. AttendanceRuleConfig (Quy tắc chấm công)

```python
class AttendanceRuleConfig(models.Model):
    # Thông tin cơ bản
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    
    # Loại quy tắc
    rule_type = models.CharField(max_length=50, choices=ATTENDANCE_RULE_TYPE)
    
    # Cấu hình chi tiết (JSON)
    configuration = models.JSONField(default=dict)
    
    # Phạm vi áp dụng
    apply_to_all = models.BooleanField(default=True)
    apply_to_departments = models.ManyToManyField(Department, blank=True)
    apply_to_positions = models.ManyToManyField(Position, blank=True)
    apply_to_employees = models.ManyToManyField(Employee, blank=True)
    
    # Thời gian hiệu lực
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    
    # Trạng thái
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)
```

### 3.2. LeavePolicyConfig (Chính sách nghỉ phép)

```python
class LeavePolicyConfig(models.Model):
    # Thông tin cơ bản
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    
    # Loại nghỉ phép
    leave_type = models.CharField(max_length=50, choices=LEAVE_TYPE)
    
    # Quy định số ngày
    max_days_per_year = models.IntegerField(default=0)
    max_consecutive_days = models.IntegerField(default=0)
    
    # Thời gian báo trước
    advance_notice_days = models.IntegerField(default=0)
    emergency_notice_hours = models.IntegerField(default=0)
    
    # Yêu cầu
    requires_approval = models.BooleanField(default=True)
    requires_medical_certificate = models.BooleanField(default=False)
    medical_certificate_days_threshold = models.IntegerField(default=3)
    
    # Tính linh hoạt
    allow_half_day = models.BooleanField(default=True)
    allow_carry_over = models.BooleanField(default=True)
    max_carry_over_days = models.IntegerField(default=5)
    
    # Phạm vi áp dụng
    apply_to_all = models.BooleanField(default=True)
    apply_to_departments = models.ManyToManyField(Department, blank=True)
    apply_to_positions = models.ManyToManyField(Position, blank=True)
    apply_to_employees = models.ManyToManyField(Employee, blank=True)
    
    # Thời gian hiệu lực
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    
    # Trạng thái
    is_active = models.BooleanField(default=True)
```

## 4. Cách rule được áp dụng cho từng employee

### 4.1. Cơ chế áp dụng rule

Hệ thống sử dụng cơ chế **priority-based rule application** để xác định rule nào áp dụng cho từng employee. Logic này được triển khai trong `AttendanceRuleEngine`:

```python
class AttendanceRuleEngine:
    @staticmethod
    def get_applicable_rules_for_employee(employee, date=None):
        """
        Lấy tất cả rule áp dụng cho một employee vào ngày cụ thể
        """
        if date is None:
            date = timezone.now().date()
        
        # Get all active rules effective on the date
        rules = AttendanceRuleConfig.objects.filter(
            is_active=True,
            effective_from__lte=date
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=date)
        )
        
        applicable_rules = []
        for rule in rules:
            if rule.should_apply_to_employee(employee):
                applicable_rules.append(rule)
        
        # Sort by priority: specific rules first, then general rules
        # Priority order: employee-specific > position-specific > department-specific > general
        applicable_rules.sort(key=lambda x: AttendanceRuleEngine._get_rule_priority(x, employee), reverse=True)
        
        return applicable_rules
    
    @staticmethod
    def _get_rule_priority(rule, employee):
        """
        Calculate priority score for a rule (higher = more specific)
        
        Priority levels:
        4: Rule applies specifically to this employee
        3: Rule applies to employee's position
        2: Rule applies to employee's department
        1: Rule applies to all (general rule)
        0: Rule doesn't apply (shouldn't happen)
        """
        if rule.apply_to_employees.filter(id=employee.id).exists():
            return 4
        
        if employee.position and rule.apply_to_positions.filter(id=employee.position.id).exists():
            return 3
        
        if employee.department and rule.apply_to_departments.filter(id=employee.department.id).exists():
            return 2
        
        if rule.apply_to_all:
            return 1
        
        return 0
```

### 4.2. Logic should_apply_to_employee

Logic này được triển khai trong model `AttendanceRuleConfig`:

```python
def should_apply_to_employee(self, employee):
    """
    Kiểm tra rule có áp dụng cho employee không
    """
    if not self.is_active:
        return False
    
    if self.apply_to_all:
        return True
    
    # Kiểm tra apply_to_employees
    if self.apply_to_employees.filter(id=employee.id).exists():
        return True
    
    # Kiểm tra apply_to_departments
    if employee.department and self.apply_to_departments.filter(id=employee.department.id).exists():
        return True
    
    # Kiểm tra apply_to_positions
    if employee.position and self.apply_to_positions.filter(id=employee.position.id).exists():
        return True
    
    return False
```

### 4.3. Thứ tự ưu tiên áp dụng

Khi có nhiều rule áp dụng cho cùng một employee, hệ thống sử dụng thứ tự ưu tiên:

1. **Rule cụ thể nhất** (apply_to_employees) → Priority 4
2. **Rule theo position** (apply_to_positions) → Priority 3
3. **Rule theo department** (apply_to_departments) → Priority 2
4. **Rule chung** (apply_to_all) → Priority 1

### 4.4. Ví dụ thực tế

**Scenario**: Nhân viên Nguyễn Văn A (Employee ID: NV001)
- Department: Hành chính
- Position: Nhân viên hành chính

**Các rule hiện có**:
1. Rule 1: `HANH_CHINH_FULL` (apply_to_departments=Hành chính) → Priority 2
2. Rule 2: `ADS_FULL` (apply_to_positions=Nhân viên ADS) → Priority 0 (không áp dụng)
3. Rule 3: `DEFAULT_SHIFT` (apply_to_all=True) → Priority 1
4. Rule 4: `NV001_SPECIAL` (apply_to_employees=NV001) → Priority 4

**Kết quả**: Employee NV001 sẽ áp dụng Rule 4 (NV001_SPECIAL) vì:
- Rule 4 có priority cao nhất (4)
- Rule 1 có priority 2
- Rule 3 có priority 1
- Rule 2 không áp dụng (priority 0)

### 4.5. Department Rule Manager

Hệ thống cũng cung cấp `DepartmentRuleManager` để quản lý rule ở cấp độ phòng ban:

```python
class DepartmentRuleManager:
    @staticmethod
    def get_department_rules_summary(department, date=None):
        """
        Get summary of rules for all employees in a department
        """
        employees = Employee.objects.filter(department=department, employment_status='ACTIVE')
        
        summary = {
            'department_id': department.id,
            'department_name': department.name,
            'date': date,
            'total_employees': employees.count(),
            'employee_rules': [],
            'rule_statistics': {
                'total_rules_applied': 0,
                'rules_by_type': {},
                'employees_with_rules': 0
            }
        }
        
        # Tính toán rule cho từng employee trong phòng ban
        for employee in employees:
            rules = AttendanceRuleEngine.get_applicable_rules_for_employee(employee, date)
            leave_policies = LeavePolicyEngine.get_applicable_policies_for_employee(employee, date)
            
            # Thêm vào summary...
        
        return summary
```

### 4.6. API Endpoints cho Rule Engine

Hệ thống cung cấp các API endpoints để tương tác với rule engine:

1. **GET /api/hrm/rule-engine/employees/{employee_id}/** - Lấy rule áp dụng cho employee
2. **POST /api/hrm/rule-engine/employees/{employee_id}/** - Áp dụng rule cho employee
3. **GET /api/hrm/rule-engine/departments/{department_id}/** - Lấy rule summary cho department
4. **POST /api/hrm/rule-engine/departments/{department_id}/** - Áp dụng rule batch cho department
5. **GET /api/hrm/rule-engine/departments/{department_id}/compliance/** - Báo cáo compliance
6. **POST /api/hrm/rule-engine/leave-validation/** - Validate leave request
7. **POST /api/hrm/rule-engine/attendance/{attendance_id}/apply-rules/** - Áp dụng rule cho attendance cụ thể
8. **POST /api/hrm/rule-engine/test/** - Test rule application

### 4.7. Compliance Reporting

Hệ thống có thể tạo báo cáo compliance cho từng phòng ban:

```python
def get_department_rule_compliance_report(department, start_date, end_date):
    """
    Generate compliance report for department rules
    """
    report = {
        'department_id': department.id,
        'department_name': department.name,
        'report_period': {
            'start_date': start_date,
            'end_date': end_date
        },
        'total_employees': employees.count(),
        'compliance_summary': {
            'total_attendances': 0,
            'compliant_attendances': 0,
            'non_compliant_attendances': 0,
            'compliance_rate': 0.0
        },
        'rule_violations': {},
        'employee_compliance': []
    }
    
    # Tính toán compliance cho từng attendance record
    # ...
    
    return report
```

### 4.8. Batch Processing

Hệ thống hỗ trợ batch processing để áp dụng rule cho nhiều attendance records cùng lúc:

```python
def apply_rules_to_department_attendance(department_id, start_date, end_date):
    """
    Apply rules to all attendance records in a department for a date range
    """
    department = Department.objects.get(id=department_id)
    
    results = {
        'department_id': department.id,
        'department_name': department.name,
        'date_range': {
            'start_date': start_date,
            'end_date': end_date
        },
        'total_employees': employees.count(),
        'processed_attendances': 0,
        'successful_applications': 0,
        'failed_applications': 0,
        'employee_results': []
    }
    
    # Process all attendance records in batch
    # ...
    
    return results
```

## 5. Thiết kế rule engine

### 5.1. Các loại rule

1. **SHIFT_RULE**: Quy tắc ca làm việc
2. **LATE_EARLY_RULE**: Quy tắc đi muộn/về sớm
3. **WORK_HOUR_CALCULATION**: Tính toán giờ làm
4. **OVERTIME_RULE**: Quy tắc làm thêm giờ
5. **BREAK_TIME_RULE**: Quy tắc giờ nghỉ

### 5.2. Cấu trúc configuration

```json
{
  "shift_rule": {
    "shift_code": "HANH_CHINH_FULL",
    "start_time": "08:30",
    "end_time": "17:30",
    "break_start": "12:00",
    "break_end": "13:00",
    "work_hours": 8.0,
    "work_coefficient": 1.0,
    "half_day_threshold": 4.0
  },
  "late_early_rule": {
    "late_threshold_minutes": 15,
    "early_leave_threshold_minutes": 15,
    "late_penalty_per_minute": 0.01,
    "early_leave_penalty_per_minute": 0.01
  },
  "overtime_rule": {
    "overtime_start_after_hours": 8.0,
    "weekday_multiplier": 1.5,
    "weekend_multiplier": 2.0,
    "holiday_multiplier": 3.0
  }
}
```

## 6. Triển khai frontend

### 6.1. Các trang đã triển khai

1. **AttendanceRuleList** (`/dashboard/attendance-rules`)
   - Danh sách quy tắc chấm công
   - Tìm kiếm, lọc theo loại, trạng thái
   - Nút "Thêm quy tắc mới"

2. **AttendanceRuleCreate** (`/dashboard/attendance-rules/create`)
   - Form tạo quy tắc chấm công mới
   - Chọn loại quy tắc
   - Cấu hình chi tiết
   - Phạm vi áp dụng

3. **LeavePolicyList** (`/dashboard/leave-policies`)
   - Danh sách chính sách nghỉ phép
   - Tìm kiếm, lọc theo loại, trạng thái
   - Nút "Thêm chính sách mới"

4. **LeavePolicyCreate** (`/dashboard/leave-policies/create`)
   - Form tạo chính sách nghỉ phép mới
   - Chọn loại nghỉ phép
   - Cấu hình quy định
   - Phạm vi áp dụng

### 6.2. Tính năng đã triển khai

✅ **Backend API**:
- CRUD cho AttendanceRuleConfig
- CRUD cho LeavePolicyConfig
- Rule engine tính toán tự động
- Filter theo employee/department/position

✅ **Frontend UI**:
- Danh sách với pagination
- Tìm kiếm và filter
- Form tạo mới với validation
- Responsive design
- Navigation với breadcrumb

✅ **Tích hợp**:
- API call với authentication
- Error handling
- Loading states
- Success/error notifications

## 7. Hướng dẫn sử dụng

### 7.1. Tạo quy tắc chấm công mới

1. Đăng nhập vào hệ thống
2. Truy cập **Quản lý HRM** → **Quy tắc chấm công**
3. Click **Thêm quy tắc mới**
4. Điền thông tin:
   - Mã quy tắc (VD: `HANH_CHINH_FULL`)
   - Tên quy tắc (VD: "Ca hành chính đầy đủ")
   - Loại quy tắc (Chọn "SHIFT_RULE")
   - Cấu hình chi tiết (thời gian, hệ số, ...)
   - Phạm vi áp dụng
   - Thời gian hiệu lực
5. Click **Tạo quy tắc**

### 7.2. Tạo chính sách nghỉ phép mới

1. Truy cập **Quản lý HRM** → **Chính sách nghỉ phép**
2. Click **Thêm chính sách mới**
3. Điền thông tin:
   - Mã chính sách (VD: `ANNUAL_LEAVE_01`)
   - Tên chính sách (VD: "Nghỉ phép năm")
   - Loại nghỉ phép (Chọn "ANNUAL_LEAVE")
   - Số ngày tối đa/năm
   - Thời gian báo trước
   - Yêu cầu phê duyệt
   - Phạm vi áp dụng
   - Thời gian hiệu lực
4. Click **Tạo chính sách**

## 8. Tính linh hoạt và mở rộng

### 8.1. Dễ dàng thay đổi quy định

1. **Thêm quy tắc mới**: Tạo rule config mới với effective_from trong tương lai
2. **Sửa quy tắc hiện tại**: Tạo bản mới, cập nhật effective_to của bản cũ
3. **Áp dụng cho nhóm cụ thể**: Dùng apply_to_departments/positions/employees
4. **A/B testing**: Chạy song song nhiều rule, đánh giá hiệu quả

### 8.2. Mở rộng tính năng

1. **Rule versioning**: Lưu lịch sử thay đổi
2. **Rule testing**: Sandbox test trước khi áp dụng
3. **Rule analytics**: Thống kê hiệu quả rule
4. **Rule templates**: Mẫu rule cho các scenario phổ biến
5. **Rule import/export**: Xuất nhập rule từ file

## 9. Kết luận

Hệ thống chấm công đã được thiết kế với kiến trúc linh hoạt, cho phép:

1. **Dễ dàng thay đổi** quy định mà không cần sửa code
2. **Áp dụng linh hoạt** cho từng nhóm nhân viên
3. **Quản lý hiệu lực** theo thời gian
4. **Mở rộng dễ dàng** với rule engine
5. **Giao diện trực quan** cho người quản lý

Với thiết kế này, công ty có thể dễ dàng điều chỉnh quy định chấm công theo nhu cầu thực tế mà không cần can thiệp kỹ thuật phức tạp.

---

**Ngày cập nhật**: 09/01/2026  
**Phiên bản**: 1.0  
**Tác giả**: HRM System Team
