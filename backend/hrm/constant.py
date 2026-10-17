class ExplanationType:
    LATE = 'LATE'
    EARLY_LEAVE = 'EARLY_LEAVE'
    LATE_EARLY = 'LATE_EARLY'
    INCOMPLETE_ATTENDANCE = 'INCOMPLETE_ATTENDANCE'
    # Lỗi máy chấm công: NV có chấm nhưng máy không ghi nhận giờ vào/ra. Duyệt xong
    # tính công như Quên chấm công, nhưng không giới hạn số lần, không tính lượt
    # giải trình và bắt buộc ghi lý do.
    MACHINE_ERROR = 'MACHINE_ERROR'
    LEAVE = 'LEAVE'
    BUSINESS_TRIP = 'BUSINESS_TRIP'
    FIRST_DAY = 'FIRST_DAY'

    DISPLAY = {
        LATE: 'Đi muộn',
        EARLY_LEAVE: 'Về sớm',
        LATE_EARLY: 'Đi muộn/Về sớm',
        INCOMPLETE_ATTENDANCE: 'Quên chấm công',
        MACHINE_ERROR: 'Lỗi máy chấm công',
        LEAVE: 'Nghỉ phép tháng',
        BUSINESS_TRIP: 'Công tác',
        FIRST_DAY: 'Ngày đầu làm việc',
    }


EVENT_RULE_CATEGORY_MAP = {
    "attendance":           ["SHIFT_RULE_MORNING", "SHIFT_RULE_AFTERNOON"],
    "leave_request":        ["LEAVE_RULE_PAID", "LEAVE_RULE_UNPAID"],
    "overtime":             ["OVERTIME_RULE"],
    "extra_hours":          ["OVERTIME_RULE"],
    "night_shift":          ["OVERTIME_RULE"],
    "live":                 ["LIVESTREAM_RULE"],
    "explanation":          ["EXPLANATION_RULE"],
    "explanation_approval": ["EXPLANATION_APPROVAL_RULE"],
    "online_work":          ["ONLINE_WORK_RULE"],
    "off_duty":             ["OVERTIME_RULE"],
}
