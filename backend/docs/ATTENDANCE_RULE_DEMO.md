# Demo: Cách rule chấm công được áp dụng cho từng employee

## 1. Tổng quan

Tài liệu này minh họa cách hệ thống chấm công áp dụng các rule cho từng nhân viên cụ thể, dựa trên:
- Department (phòng ban)
- Position (vị trí)
- Employee cụ thể
- Thời gian hiệu lực

## 2. Cấu trúc dữ liệu mẫu

### 2.1. Departments
```python
departments = {
    1: {"name": "Hành chính", "code": "HC"},
    2: {"name": "Kinh doanh", "code": "KD"},
    3: {"name": "CSKH", "code": "CSKH"},
    4: {"name": "ADS", "code": "ADS"}
}
```

### 2.2. Positions
```python
positions = {
    1: {"title": "Nhân viên hành chính", "code": "NVHC"},
    2: {"title": "Nhân viên kinh doanh", "code": "NVKD"},
    3: {"title": "Nhân viên CSKH", "code": "NVCSKH"},
    4: {"title": "Nhân viên ADS", "code": "NVADS"},
    5: {"title": "Trưởng phòng", "code": "TP"}
}
```

### 2.3. Employees
```python
employees = [
    {
        "id": 1,
        "employee_id": "NV001",
        "full_name": "Nguyễn Văn A",
        "department_id": 1,  # Hành chính
        "position_id": 1     # Nhân viên hành chính
    },
    {
        "id": 2,
        "employee_id": "NV002",
        "full_name": "Trần Thị B",
        "department_id": 2,  # Kinh doanh
        "position_id": 2     # Nhân viên kinh doanh
    },
    {
        "id": 3,
        "employee_id": "NV003",
        "full_name": "Lê Văn C",
        "department_id": 4,  # ADS
        "position_id": 4     # Nhân viên ADS
    },
    {
        "id": 4,
        "employee_id": "NV004",
        "full_name": "Phạm Thị D",
        "department_id": 3,  # CSKH
        "position_id": 3     # Nhân viên CSKH
    },
    {
        "id": 5,
        "employee_id": "NV005",
        "full_name": "Hoàng Văn E",
        "department_id": 1,  # Hành chính
        "position_id": 5     # Trưởng phòng
    }
]
```

## 3. Các rule chấm công mẫu

### 3.1. Rule 1: Ca hành chính đầy đủ
```json
{
  "code": "HANH_CHINH_FULL",
  "name": "Ca hành chính đầy đủ",
  "rule_type": "SHIFT_RULE",
  "configuration": {
    "start_time": "08:30",
    "end_time": "17:30",
    "break_start": "12:00",
    "break_end": "13:00",
    "work_hours": 8.0,
    "work_coefficient": 1.0
  },
  "apply_to_departments": [1],  # Hành chính
  "effective_from": "2024-01-01",
  "is_active": true
}
```

### 3.2. Rule 2: Ca kinh doanh
```json
{
  "code": "KINH_DOANH_FULL",
  "name": "Ca kinh doanh đầy đủ",
  "rule_type": "SHIFT_RULE",
  "configuration": {
    "start_time": "13:00",
    "end_time": "21:00",
    "work_hours": 8.0,
    "work_coefficient": 1.0
  },
  "apply_to_departments": [2],  # Kinh doanh
  "effective_from": "2024-01-01",
  "is_active": true
}
```

### 3.3. Rule 3: Ca ADS
```json
{
  "code": "ADS_FULL",
  "name": "Ca ADS đầy đủ",
  "rule_type": "SHIFT_RULE",
  "configuration": {
    "start_time": "09:00",
    "end_time": "17:30",
    "break_start": "12:00",
    "break_end": "13:00",
    "work_hours": 7.5,
    "work_coefficient": 1.0
  },
  "apply_to_positions": [4],  # Nhân viên ADS
  "effective_from": "2024-01-01",
  "is_active": true
}
```

### 3.4. Rule 4: Ca CSKH MB
```json
{
  "code": "CSKH_MB_FULL",
  "name": "Ca CSKH MB đầy đủ",
  "rule_type": "SHIFT_RULE",
  "configuration": {
    "start_time": "08:00",
    "end_time": "17:00",
    "break_start": "12:00",
    "break_end": "13:00",
    "work_hours": 8.0,
    "work_coefficient": 1.0
  },
  "apply_to_departments": [3],  # CSKH
  "effective_from": "2024-01-01",
  "is_active": true
}
```

### 3.5. Rule 5: Rule mặc định
```json
{
  "code": "DEFAULT_SHIFT",
  "name": "Ca làm việc mặc định",
  "rule_type": "SHIFT_RULE",
  "configuration": {
    "start_time": "09:00",
    "end_time": "18:00",
    "break_start": "12:00",
    "break_end": "13:00",
    "work_hours": 8.0,
    "work_coefficient": 1.0
  },
  "apply_to_all": true,
  "effective_from": "2024-01-01",
  "is_active": true
}
```

### 3.6. Rule 6: Rule đặc biệt cho NV005
```json
{
  "code": "SPECIAL_TP",
  "name": "Ca đặc biệt cho Trưởng phòng",
  "rule_type": "SHIFT_RULE",
  "configuration": {
    "start_time": "08:00",
    "end_time": "17:00",
    "break_start": "12:00",
    "break_end": "13:00",
    "work_hours": 8.0,
    "work_coefficient": 1.0,
    "flexible_hours": true
  },
  "apply_to_employees": [5],  # NV005
  "effective_from": "2024-06-01",
  "is_active": true
}
```

## 4. Demo: Áp dụng rule cho từng employee

### 4.1. Ngày áp dụng: 2024-07-01

#### Employee 1: Nguyễn Văn A (NV001)
- **Department**: Hành chính (1)
- **Position**: Nhân viên hành chính (1)
- **Các rule áp dụng**:
  1. Rule 1: `HANH_CHINH_FULL` (apply_to_departments=1) ✓
  2. Rule 5: `DEFAULT_SHIFT` (apply_to_all=true) ✓
- **Rule được chọn**: Rule 1 (cụ thể hơn)
- **Lý do**: Rule 1 áp dụng cụ thể cho department Hành chính

#### Employee 2: Trần Thị B (NV002)
- **Department**: Kinh doanh (2)
- **Position**: Nhân viên kinh doanh (2)
- **Các rule áp dụng**:
  1. Rule 2: `KINH_DOANH_FULL` (apply_to_departments=2) ✓
  2. Rule 5: `DEFAULT_SHIFT` (apply_to_all=true) ✓
- **Rule được chọn**: Rule 2
- **Lý do**: Rule 2 áp dụng cụ thể cho department Kinh doanh

#### Employee 3: Lê Văn C (NV003)
- **Department**: ADS (4)
- **Position**: Nhân viên ADS (4)
- **Các rule áp dụng**:
  1. Rule 3: `ADS_FULL` (apply_to_positions=4) ✓
  2. Rule 5: `DEFAULT_SHIFT` (apply_to_all=true) ✓
- **Rule được chọn**: Rule 3
- **Lý do**: Rule 3 áp dụng cụ thể cho position Nhân viên ADS

#### Employee 4: Phạm Thị D (NV004)
- **Department**: CSKH (3)
- **Position**: Nhân viên CSKH (3)
- **Các rule áp dụng**:
  1. Rule 4: `CSKH_MB_FULL` (apply_to_departments=3) ✓
  2. Rule 5: `DEFAULT_SHIFT` (apply_to_all=true) ✓
- **Rule được chọn**: Rule 4
- **Lý do**: Rule 4 áp dụng cụ thể cho department CSKH

#### Employee 5: Hoàng Văn E (NV005)
- **Department**: Hành chính (1)
- **Position**: Trưởng phòng (5)
- **Các rule áp dụng**:
  1. Rule 6: `SPECIAL_TP` (apply_to_employees=5) ✓
  2. Rule 1: `HANH_CHINH_FULL` (apply_to_departments=1) ✓
  3. Rule 5: `DEFAULT_SHIFT` (apply_to_all=true) ✓
- **Rule được chọn**: Rule 6
- **Lý do**: Rule 6 áp dụng cụ thể cho employee NV005 (ưu tiên cao nhất)

### 4.2. Ngày áp dụng: 2024-05-15 (trước khi Rule 6 có hiệu lực)

#### Employee 5: Hoàng Văn E (NV005)
- **Department**: Hành chính (1)
- **Position**: Trưởng phòng (5)
- **Các rule áp dụng**:
  1. Rule 1: `HANH_CHINH_FULL` (apply_to_departments=1) ✓
  2. Rule 5: `DEFAULT_SHIFT` (apply_to_all=true) ✓
- **Rule được chọn**: Rule 1
- **Lý do**: Rule 6 chưa có hiệu lực (effective_from: 2024-06-01)

## 5. Code demo Python

```python
from datetime import date
from typing import List, Dict

class Employee:
    def __init__(self, id: int, employee_id: str, full_name: str, 
                 department_id: int, position_id: int):
        self.id = id
        self.employee_id = employee_id
        self.full_name = full_name
        self.department_id = department_id
        self.position_id = position_id

class AttendanceRule:
    def __init__(self, code: str, name: str, rule_type: str,
                 apply_to_all: bool = False,
                 apply_to_departments: List[int] = None,
                 apply_to_positions: List[int] = None,
                 apply_to_employees: List[int] = None,
                 effective_from: date = None,
                 effective_to: date = None,
                 is_active: bool = True):
        self.code = code
        self.name = name
        self.rule_type = rule_type
        self.apply_to_all = apply_to_all
        self.apply_to_departments = apply_to_departments or []
        self.apply_to_positions = apply_to_positions or []
        self.apply_to_employees = apply_to_employees or []
        self.effective_from = effective_from
        self.effective_to = effective_to
        self.is_active = is_active
    
    def should_apply_to_employee(self, employee: Employee, target_date: date) -> bool:
        """Kiểm tra rule có áp dụng cho employee vào ngày target_date không"""
        # Kiểm tra active và hiệu lực thời gian
        if not self.is_active:
            return False
        
        if self.effective_from and target_date < self.effective_from:
            return False
        
        if self.effective_to and target_date > self.effective_to:
            return False
        
        # Kiểm tra phạm vi áp dụng
        if self.apply_to_all:
            return True
        
        if employee.id in self.apply_to_employees:
            return True
        
        if employee.department_id in self.apply_to_departments:
            return True
        
        if employee.position_id in self.apply_to_positions:
            return True
        
        return False
    
    def get_priority(self) -> int:
        """Tính priority của rule (số càng nhỏ = ưu tiên càng cao)"""
        if self.apply_to_employees:
            return 1  # Ưu tiên cao nhất
        elif self.apply_to_positions:
            return 2
        elif self.apply_to_departments:
            return 3
        elif self.apply_to_all:
            return 4  # Ưu tiên thấp nhất
        return 5

def get_applicable_rules_for_employee(
    employee: Employee, 
    rules: List[AttendanceRule], 
    target_date: date
) -> List[AttendanceRule]:
    """Lấy tất cả rule áp dụng cho employee vào ngày target_date"""
    applicable_rules = []
    
    for rule in rules:
        if rule.should_apply_to_employee(employee, target_date):
            applicable_rules.append(rule)
    
    # Sắp xếp theo priority (ưu tiên cao nhất trước)
    applicable_rules.sort(key=lambda r: (r.get_priority(), r.effective_from or date.min))
    
    return applicable_rules

def get_applied_rule_for_employee(
    employee: Employee, 
    rules: List[AttendanceRule], 
    target_date: date
) -> AttendanceRule:
    """Lấy rule được áp dụng cho employee (rule có priority cao nhất)"""
    applicable_rules = get_applicable_rules_for_employee(employee, rules, target_date)
    
    if applicable_rules:
        return applicable_rules[0]  # Rule có priority cao nhất
    
    return None

# Demo sử dụng
if __name__ == "__main__":
    # Tạo employees
    employees = [
        Employee(1, "NV001", "Nguyễn Văn A", 1, 1),
        Employee(2, "NV002", "Trần Thị B", 2, 2),
        Employee(3, "NV003", "Lê Văn C", 4, 4),
        Employee(4, "NV004", "Phạm Thị D", 3, 3),
        Employee(5, "NV005", "Hoàng Văn E", 1, 5)
    ]
    
    # Tạo rules
    rules = [
        AttendanceRule(
