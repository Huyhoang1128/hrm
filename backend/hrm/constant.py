class ExplanationType:
    LATE = 'LATE'
    EARLY_LEAVE = 'EARLY_LEAVE'
    LATE_EARLY = 'LATE_EARLY'
    INCOMPLETE_ATTENDANCE = 'INCOMPLETE_ATTENDANCE'
    LEAVE = 'LEAVE'
    BUSINESS_TRIP = 'BUSINESS_TRIP'
    FIRST_DAY = 'FIRST_DAY'

    DISPLAY = {
        LATE: 'Đi muộn',
        EARLY_LEAVE: 'Về sớm',
        LATE_EARLY: 'Đi muộn/Về sớm',
        INCOMPLETE_ATTENDANCE: 'Quên chấm công',
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
