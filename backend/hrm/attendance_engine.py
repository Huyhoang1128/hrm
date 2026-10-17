"""
hrm/attendance_engine.py
════════════════════════
Event-driven Attendance Rule Engine (HRM).

Tất cả tham số nghiệp vụ (bảng phạt, phụ cấp, quota…) được nạp từ DB
thông qua AttendancePolicyVersion / PenaltyTierConfig / AttendancePolicyConfig
trong hrm/attendance_models.py.

Fallback về hằng số hard-code nếu chưa có dữ liệu DB.
"""

import uuid
import datetime
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Tuple

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# HARD-CODED DEFAULTS  (dùng khi chưa có DB config)
# ─────────────────────────────────────────────────────────────────────────────

_DEFAULT_PENALTY_TABLE: List[Tuple[Optional[int], int, int, float]] = [
    # (max_minutes, fine_regular, fine_manager, work_deduction)
    (10,   50_000,  50_000, 0.0),
    (30,  100_000, 100_000, 0.0),
    (60,  120_000, 150_000, 0.0),
    (120, 200_000, 250_000, 0.0),
    (None,       0,       0, 0.5),  # > 120 phút → trừ 0.5 công
]

_DEFAULT_POLICY = {
    "max_explanation_quota":          3,
    "penalty_multiplier_threshold":   7,
    "penalty_multiplier_value":       2.0,
    "parking_allowance_per_day":      5_000,
    "live_prime_time_allowance":      100_000,
    "live_prime_start_hour":          21,
    "live_prime_end_hour":            23,
    "max_live_prime_time_pct":        0.20,
    "max_ot_live_pct":                0.20,
    "incomplete_no_expl_deduction":   1.0,
    "incomplete_approved_deduction":  0.0,
    "incomplete_over_quota_deduction": 0.5,
}

EXEMPT_EXPLANATION_TYPES = {"BUSINESS_TRIP", "FIRST_DAY", "LEAVE"}


# ─────────────────────────────────────────────────────────────────────────────
# POLICY LOADER  (nạp config từ DB, cache theo ngày)
# ─────────────────────────────────────────────────────────────────────────────

class PolicyLoader:
    """
    Load AttendancePolicyVersion + PenaltyTierConfig + AttendancePolicyConfig từ DB.
    Kết quả được cache in-memory (dict) để tránh N+1 query trong một request.
    """
    _cache: Dict[str, Any] = {}

    @classmethod
    def _cache_key(cls, date: datetime.date) -> str:
        return date.isoformat()

    @classmethod
    def clear_cache(cls):
        cls._cache.clear()

    @classmethod
    def load(cls, date: datetime.date) -> Dict[str, Any]:
        """
        Trả về dict chứa:
          version_code, policy (dict), penalty_tiers (list of tuples)
        """
        key = cls._cache_key(date)
        if key in cls._cache:
            return cls._cache[key]

        result = {
            "version_code":  "default",
            "version_obj":   None,
            "policy":        dict(_DEFAULT_POLICY),
            "penalty_tiers": list(_DEFAULT_PENALTY_TABLE),
        }

        try:
            from .attendance_models import AttendancePolicyVersion, PenaltyTierConfig, AttendancePolicyConfig

            version = AttendancePolicyVersion.get_for_date(date)
            if not version:
                version = AttendancePolicyVersion.get_active()

            if version:
                result["version_code"] = version.version_code
                result["version_obj"]  = version

                # Load policy config
                try:
                    cfg = version.policy_config
                    result["policy"] = cfg.as_dict()
                except AttendancePolicyConfig.DoesNotExist:
                    pass

                # Load penalty tiers
                tiers = list(
                    PenaltyTierConfig.objects.filter(version=version).order_by("order")
                )
                if tiers:
                    result["penalty_tiers"] = [
                        (t.max_minutes, t.fine_amount_regular,
                         t.fine_amount_manager, float(t.deduct_work_credit))
                        for t in tiers
                    ]

        except Exception as exc:
            logger.warning("PolicyLoader: cannot load from DB (%s), using defaults", exc)

        cls._cache[key] = result
        return result

    @classmethod
    def lookup_penalty(
        cls, minutes: int, is_manager: bool,
        penalty_tiers: List[Tuple]
    ) -> Tuple[float, float]:
        """
        Tra bảng phạt → (fine_vnd, work_deduction).
        Tiers phải được sắp xếp tăng dần theo max_minutes, tier cuối max_minutes=None.
        """
        for (max_min, fine_reg, fine_mgr, work_ded) in penalty_tiers:
            if max_min is None or minutes <= max_min:
                fine = fine_mgr if is_manager else fine_reg
                return float(fine), float(work_ded)
        return 0.0, 0.0


# ─────────────────────────────────────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class RuleResult:
    work_credit: float           = 0.0
    probation_credit: float      = 0.0
    official_credit: float       = 0.0
    holiday_credit: float        = 0.0
    penalty_amount: float        = 0.0   # VNĐ
    penalty_work_deduction: float = 0.0  # công bị trừ
    parking_allowance: float     = 0.0
    live_allowance: float        = 0.0
    overtime_hours: float        = 0.0
    extra_hours: float           = 0.0
    night_shift_sessions: int    = 0
    is_exempt: bool              = False
    # Miễn RIÊNG phần phạt tiền đi muộn/về sớm (penalty_amount) — tách khỏi is_exempt vì
    # is_exempt còn được dùng để tính hạn mức giải trình (running_expl_quota) cho cả trường
    # hợp "Quên chấm công" (chỉ nên miễn phần trừ công do quên chấm công, KHÔNG được miễn
    # phạt tiền đi muộn/về sớm vì đó là lỗi độc lập, không liên quan).
    exempt_money_penalty: bool   = False
    notes: List[str]             = field(default_factory=list)


class EventType:
    CHECKIN              = "CHECKIN"
    CHECKOUT             = "CHECKOUT"
    LATE_ARRIVAL         = "LATE_ARRIVAL"
    EARLY_LEAVE          = "EARLY_LEAVE"
    ABSENT               = "ABSENT"
    INCOMPLETE           = "INCOMPLETE_ATTENDANCE"
    HOLIDAY_WORK         = "HOLIDAY_WORK"
    ONLINE_WORK          = "ONLINE_WORK"
    BUSINESS_TRIP        = "BUSINESS_TRIP"
    FIRST_DAY            = "FIRST_DAY"
    LEAVE_DAY            = "LEAVE_DAY"
    PENALTY_APPLIED      = "PENALTY_APPLIED"
    PENALTY_EXEMPTED     = "PENALTY_EXEMPTED"
    WORK_CREDIT_CALC     = "WORK_CREDIT_CALCULATED"
    ALLOWANCE_CALC       = "ALLOWANCE_CALCULATED"
    REG_OT               = "REGISTRATION_OT"
    REG_EXTRA            = "REGISTRATION_EXTRA_HOURS"
    REG_NIGHT            = "REGISTRATION_NIGHT_SHIFT"
    REG_LIVE             = "REGISTRATION_LIVE"
    MONTHLY_FINALIZED    = "MONTHLY_FINALIZED"


# ─────────────────────────────────────────────────────────────────────────────
# BASE RULE
# ─────────────────────────────────────────────────────────────────────────────

class BaseRule:
    rule_id: str = "base_rule"

    def apply(self, context: Dict[str, Any], policy: Dict[str, Any],
              penalty_tiers: List[Tuple]) -> RuleResult:
        raise NotImplementedError


# ─────────────────────────────────────────────────────────────────────────────
# RULE 1 – PENALTY  (Bảng phạt 08/2024, config từ DB)
# ─────────────────────────────────────────────────────────────────────────────

class PenaltyRule(BaseRule):
    rule_id = "penalty_rule"

    def apply(self, context: Dict, policy: Dict, penalty_tiers: List[Tuple]) -> RuleResult:
        result = RuleResult()
        late_min  = context.get("late_minutes", 0) or 0
        early_min = context.get("early_leave_minutes", 0) or 0
        minutes   = max(late_min, early_min)

        if minutes <= 0:
            return result

        is_manager      = context.get("is_manager", False)
        violation_count = context.get("violation_count_month", 1)
        threshold       = policy.get("penalty_multiplier_threshold", 7)
        multiplier_val  = float(policy.get("penalty_multiplier_value", 2.0))

        fine, work_ded = PolicyLoader.lookup_penalty(minutes, is_manager, penalty_tiers)

        if work_ded > 0:
            # Tier "vô hạn": trừ công thay vì phạt tiền
            result.penalty_work_deduction = work_ded
            result.notes.append(
                f"Muộn/sớm {minutes}p (>prev tier): trừ {work_ded} công thực tế"
            )
        else:
            multiplier = multiplier_val if violation_count >= threshold else 1.0
            result.penalty_amount = fine * multiplier
            if multiplier > 1:
                result.notes.append(
                    f"Phạt {fine:,.0f} x{multiplier:.0f} (vi phạm lần {violation_count}) "
                    f"= {result.penalty_amount:,.0f} VNĐ"
                )
            else:
                result.notes.append(
                    f"Phạt {result.penalty_amount:,.0f} VNĐ (muộn/sớm {minutes}p)"
                )
        return result


# ─────────────────────────────────────────────────────────────────────────────
# RULE 2 – EXEMPTION  (Giải trình & miễn trừ phạt)
# ─────────────────────────────────────────────────────────────────────────────

class ExemptionRule(BaseRule):
    rule_id = "exemption_rule"

    def apply(self, context: Dict, policy: Dict, penalty_tiers: List[Tuple]) -> RuleResult:
        result           = RuleResult()
        expl_status      = context.get("explanation_status")
        expl_type        = context.get("explanation_type")
        quota_used       = context.get("explanation_quota_used", 0)
        violation_type   = context.get("violation_type")
        quota_max        = policy.get("max_explanation_quota", 3)
        no_expl_ded      = float(policy.get("incomplete_no_expl_deduction", 1.0))
        approved_ded     = float(policy.get("incomplete_approved_deduction", 0.5))
        over_quota_ded   = float(policy.get("incomplete_over_quota_deduction", 0.5))

        if not expl_status:
            if violation_type == "INCOMPLETE":
                result.penalty_work_deduction = no_expl_ded
                result.notes.append(f"Quên chấm công không giải trình: trừ {no_expl_ded} công")
            return result

        # BUSINESS_TRIP / FIRST_DAY: miễn hoàn toàn, không tính quota
        # Bao gồm cả lỗi ĐI MUỘN / VỀ SỚM khi đã duyệt công tác
        if expl_type in EXEMPT_EXPLANATION_TYPES:
            result.is_exempt = True
            result.exempt_money_penalty = True
            result.notes.append(f"Giải trình {expl_type}: miễn phạt (không tính hạn mức)")
            return result

        if expl_status == "APPROVED":
            if violation_type == "INCOMPLETE":
                # Mặc định duyệt Quên chấm công thì phạt 0.5 công
                deduction = approved_ded

                # Nếu ĐÃ hết hạn mức 3 lần trước đó, thì đơn này bị phạt thêm 0.5 công nữa
                if quota_used >= quota_max:
                    deduction += over_quota_ded
                    result.notes.append(
                        f"Quên chấm công (vượt hạn mức {quota_max} lần): "
                        f"Trừ thêm {over_quota_ded} công (Tổng trừ: {deduction})"
                    )
                else:
                    result.notes.append(f"Quên chấm công – giải trình duyệt: phạt {deduction} công")

                result.penalty_work_deduction = deduction
                # Chỉ miễn phần trừ công do quên chấm công — is_exempt vẫn True để tính đúng
                # hạn mức giải trình (running_expl_quota), nhưng KHÔNG set exempt_money_penalty
                # nên phạt tiền đi muộn/về sớm (nếu có, lỗi độc lập) vẫn được PenaltyRule giữ
                # nguyên thay vì bị xóa theo.
                result.is_exempt = True
            elif quota_used < quota_max:
                result.is_exempt = True
                result.exempt_money_penalty = True
                result.notes.append(
                    f"Giải trình duyệt (lần {quota_used+1}/{quota_max}): miễn phạt"
                )
            else:
                result.notes.append(
                    f"Hết hạn mức giải trình ({quota_max} lần/tháng): vẫn bị phạt"
                )
        elif expl_status in ("REJECTED", "PENDING", "DRAFT"):
            if violation_type == "INCOMPLETE":
                # Không giải trình hoặc chưa duyệt thì trừ 1.0 công
                deduction = no_expl_ded
                
                # Nếu đã hết hạn mức, loại này vẫn bị trừ 1.0 công (hoặc có thể tăng thêm nếu muốn)
                if quota_used >= quota_max:
                    # Tùy chọn: có thể trừ thêm nếu chưa duyệt mà đã hết hạn mức
                    # deduction += over_quota_ded 
                    pass
                
                result.penalty_work_deduction = deduction
                result.notes.append(f"Quên chấm công – giải trình chưa duyệt: trừ {deduction} công")

        return result


# ─────────────────────────────────────────────────────────────────────────────
# RULE 3 – WORK CREDIT  (Chốt công)
# ─────────────────────────────────────────────────────────────────────────────

class WorkCreditRule(BaseRule):
    rule_id = "work_credit_rule"

    def apply(self, context: Dict, policy: Dict, penalty_tiers: List[Tuple]) -> RuleResult:
        result             = RuleResult()
        att_date           = context.get("attendance_date")
        is_office_day      = context.get("is_office_day", False)
        is_online_work     = context.get("is_online_work", False)
        is_holiday         = context.get("is_holiday", False)
        holiday_creditable = context.get("holiday_creditable", is_holiday)
        is_business_trip   = context.get("is_business_trip", False)
        is_first_day       = context.get("is_first_day", False)
        is_leave_day       = context.get("is_leave_day", False)
        is_unpaid_leave    = context.get("is_unpaid_leave", False)
        is_absent          = context.get("is_absent", False)
        is_incomplete      = context.get("is_incomplete", False)
        expl_status        = context.get("explanation_status")
        penalty_work_ded   = context.get("penalty_work_deduction", 0.0)
        probation_end_date = context.get("probation_end_date")

        # Ngày lễ
        if is_holiday:
            if holiday_creditable:
                result.holiday_credit = 1.0
                result.notes.append("Ngày lễ: tính 1.0 công lễ")
            else:
                result.notes.append("Ngày lễ ngoài thời gian làm việc (trước ngày vào/từ ngày nghỉ việc): không tính công lễ")
            return result

        if is_unpaid_leave:
            result.notes.append("Nghỉ không lương: 0 công")
            return result

        if is_absent and not (is_business_trip or is_first_day or is_leave_day):
            result.notes.append("Vắng mặt: 0 công")
            return result

        # Xác định base credit (Cơ sở ban đầu trước khi trừ phạt)
        base = 0.0
        if is_office_day or is_incomplete:
            # Nếu là nửa ngày (HALF_DAY) -> tính 0.5 cơ sở
            if context.get("is_half_day"):
                base = 0.5
                result.notes.append("Làm việc nửa ngày (HALF_DAY): tính 0.5 công")
            else:
                base = 1.0
                result.notes.append("Làm việc đủ ca: tính 1.0 công")
        elif is_online_work:
            if context.get("is_half_day"):
                base = 0.5
                result.notes.append("Làm việc online nửa ngày: tính 0.5 công")
            else:
                base = 1.0
                result.notes.append("Làm việc online: tính 1.0 công")
        elif is_leave_day:
            if context.get("is_half_day"):
                base = 0.5
                result.notes.append("Nghỉ phép nửa ngày: tính 0.5 công")
            else:
                base = 1.0
                result.notes.append("Nghỉ phép hưởng lương: tính 1.0 công")
        elif (is_business_trip or is_first_day) and expl_status == "APPROVED":
            base = 1.0

        effective = max(0.0, base - penalty_work_ded)
        result.work_credit = effective

        # Phân bổ thử việc / chính thức
        if att_date and base > 0:
            if probation_end_date and att_date <= probation_end_date:
                result.probation_credit = effective
                result.notes.append(f"Công thử việc: {effective}")
            else:
                result.official_credit = effective
                result.notes.append(f"Công chính thức: {effective}")

        return result


# ─────────────────────────────────────────────────────────────────────────────
# RULE 4 – PARKING ALLOWANCE
# ─────────────────────────────────────────────────────────────────────────────

class ParkingAllowanceRule(BaseRule):
    rule_id = "parking_allowance_rule"

    def apply(self, context: Dict, policy: Dict, penalty_tiers: List[Tuple]) -> RuleResult:
        result            = RuleResult()
        is_office_day     = context.get("is_office_day", False)
        is_first_day      = context.get("is_first_day", False)
        expl_status       = context.get("explanation_status")
        is_online         = context.get("is_online_work", False)
        is_trip           = context.get("is_business_trip", False)
        is_leave          = context.get("is_leave_day", False)
        is_absent         = context.get("is_absent", False)
        amount            = policy.get("parking_allowance_per_day", 5_000)

        if is_online or is_trip or is_leave or is_absent:
            return result

        if is_office_day:
            result.parking_allowance = amount
            result.notes.append(f"Gửi xe: {amount:,} VNĐ (văn phòng)")
        elif is_first_day and expl_status == "APPROVED":
            result.parking_allowance = amount
            result.notes.append(f"Gửi xe: {amount:,} VNĐ (ngày đầu)")

        return result


# ─────────────────────────────────────────────────────────────────────────────
# RULE 5 – REGISTRATION INTEGRATION  (OT, EXTRA_HOURS, NIGHT_SHIFT)
# ─────────────────────────────────────────────────────────────────────────────

class RegistrationIntegrationRule(BaseRule):
    rule_id = "registration_integration_rule"

    def apply(self, context: Dict, policy: Dict, penalty_tiers: List[Tuple]) -> RuleResult:
        result = RuleResult()
        for reg in context.get("registration_requests", []):
            if reg.get("status") != "APPROVED":
                continue
            rtype = reg.get("request_type", "")
            hours = float(reg.get("total_hours", 0) or 0)

            if rtype == "OVERTIME":
                result.overtime_hours += hours
                result.notes.append(f"OT {hours:.1f}h (#{reg.get('id', '-')})")
            elif rtype == "EXTRA_HOURS":
                result.extra_hours += hours
                result.notes.append(f"Làm thêm {hours:.1f}h (#{reg.get('id', '-')})")
            elif rtype == "NIGHT_SHIFT":
                result.night_shift_sessions += 1
                result.notes.append(f"Trực tối (#{reg.get('id', '-')})")
            elif rtype == "OFF_DUTY":
                result.work_credit += 1.0
                att_date = context.get("attendance_date")
                probation_end_date = context.get("probation_end_date")
                if att_date and probation_end_date and att_date <= probation_end_date:
                    result.probation_credit += 1.0
                else:
                    result.official_credit += 1.0
                result.notes.append(f"Ra trực (#{reg.get('id', '-')})")

        return result


# ─────────────────────────────────────────────────────────────────────────────
# RULE 6 – LIVESTREAM  (Prime-time 21h-23h + quota + OT hỗ trợ)
# ─────────────────────────────────────────────────────────────────────────────

class LivestreamRule(BaseRule):
    rule_id = "livestream_rule"

    def apply(self, context: Dict, policy: Dict, penalty_tiers: List[Tuple]) -> RuleResult:
        result = RuleResult()

        registrations         = context.get("registration_requests", [])
        total_team_live       = context.get("total_team_live_sessions_month", 0)
        current_prime         = context.get("current_prime_time_sessions_month", 0)
        emp_total_ot          = context.get("employee_total_ot_hours_month", 0.0)
        emp_live_ot           = context.get("employee_live_ot_hours_month", 0.0)
        live_role             = context.get("live_role", "")
        is_support            = live_role in ("MANAGER", "TIKTOK_OPERATOR")

        prime_start = datetime.time(policy.get("live_prime_start_hour", 21), 0)
        prime_end   = datetime.time(policy.get("live_prime_end_hour",   23), 0)
        allowance   = policy.get("live_prime_time_allowance", 100_000)
        prime_pct   = float(policy.get("max_live_prime_time_pct", 0.20))
        ot_pct      = float(policy.get("max_ot_live_pct", 0.20))

        for reg in registrations:
            if reg.get("status") != "APPROVED":
                continue
            if reg.get("request_type", "") != "LIVE":
                continue

            hours     = float(reg.get("total_hours", 0) or 0)
            st_str    = str(reg.get("start_time", "") or "")
            try:
                h, m  = map(int, st_str.split(":")[:2])
                st    = datetime.time(h, m)
            except (ValueError, AttributeError):
                st    = datetime.time(0, 0)

            is_prime = prime_start <= st < prime_end

            if is_prime:
                max_prime_allowed = max(1, int(total_team_live * prime_pct)) if total_team_live else 0
                if max_prime_allowed == 0 or current_prime < max_prime_allowed:
                    result.live_allowance += allowance
                    result.notes.append(
                        f"Live 21h-23h: phụ cấp {allowance:,} VNĐ (#{reg.get('id', '-')})"
                    )
                else:
                    result.notes.append(
                        f"Live 21h-23h vượt quota {prime_pct*100:.0f}% "
                        f"({current_prime}/{max_prime_allowed}): không phụ cấp"
                    )

                # OT cho nhân sự hỗ trợ (tối đa 1 nhân sự/phiên)
                if is_support and hours > 0:
                    max_live_ot  = emp_total_ot * ot_pct if emp_total_ot > 0 else hours
                    remaining    = max(0.0, max_live_ot - emp_live_ot)
                    actual_ot    = min(hours, remaining)
                    if actual_ot > 0:
                        result.overtime_hours += actual_ot
                        result.notes.append(
                            f"OT hỗ trợ live 21h-23h: {actual_ot:.1f}h ({live_role})"
                        )
                    if hours > remaining and emp_total_ot > 0:
                        result.notes.append(
                            f"OT live vượt {ot_pct*100:.0f}% "
                            f"({emp_live_ot:.1f}/{max_live_ot:.1f}h): "
                            f"Trưởng phòng cần đề xuất nộp HCNS trước ngày 02"
                        )
            else:
                # Ngoài 21h-23h → OT bình thường, không phụ cấp
                if hours > 0:
                    result.overtime_hours += hours
                    result.notes.append(
                        f"Live ngoài 21h-23h: {hours:.1f}h OT (không phụ cấp)"
                    )

        return result


# ─────────────────────────────────────────────────────────────────────────────
# RULE REGISTRY
# ─────────────────────────────────────────────────────────────────────────────

class RuleRegistry:
    _rules: List[BaseRule] = [
        ExemptionRule(),              # 1 – phải chạy trước
        PenaltyRule(),                # 2
        WorkCreditRule(),             # 3
        ParkingAllowanceRule(),       # 4
        RegistrationIntegrationRule(), # 5
        LivestreamRule(),             # 6
    ]

    @classmethod
    def get_all(cls) -> List[BaseRule]:
        return list(cls._rules)

    @classmethod
    def replace(cls, rule: BaseRule):
        """Thay thế một rule (cho phép extend / override ở nơi khác)"""
        cls._rules = [r for r in cls._rules if r.rule_id != rule.rule_id]
        cls._rules.append(rule)
        # Giữ thứ tự chuẩn
        order = ["exemption_rule", "penalty_rule", "work_credit_rule",
                 "parking_allowance_rule", "registration_integration_rule", "livestream_rule"]
        cls._rules.sort(key=lambda r: order.index(r.rule_id) if r.rule_id in order else 99)


# ─────────────────────────────────────────────────────────────────────────────
# DB-BACKED EVENT STORE
# ─────────────────────────────────────────────────────────────────────────────

class DBEventStore:
    """Ghi event vào AttendanceEventLog, hỗ trợ replay."""

    def append(self, employee, event_type: str, event_date: datetime.date,
               context: dict, result_dict: dict, policy_version=None,
               attendance_id=None, registration_id=None, explanation_id=None):
        try:
            from .attendance_models import AttendanceEventLog
            AttendanceEventLog.log(
                event_type       = event_type,
                employee         = employee,
                event_date       = event_date,
                context          = self._sanitize(context),
                result           = result_dict,
                policy_version   = policy_version,
                attendance_id    = attendance_id,
                registration_id  = registration_id,
                explanation_id   = explanation_id,
            )
        except Exception as exc:
            logger.warning("DBEventStore.append failed: %s", exc)

    @staticmethod
    def _sanitize(d: dict) -> dict:
        """Chuyển datetime.date → str để JSON serializable"""
        out = {}
        for k, v in d.items():
            if isinstance(v, datetime.date):
                out[k] = v.isoformat()
            elif isinstance(v, list):
                out[k] = [str(i) if isinstance(i, datetime.date) else i for i in v]
            else:
                out[k] = v
        return out

    def replay(self, employee_id: int, start_date: datetime.date,
               end_date: datetime.date) -> List[dict]:
        try:
            from .attendance_models import AttendanceEventLog
            from employee.models import Employee
            emp = Employee.objects.get(id=employee_id)
            events = AttendanceEventLog.objects.filter(
                employee=emp,
                event_date__gte=start_date,
                event_date__lte=end_date,
            ).order_by("event_date", "event_timestamp")
            engine = HRMAttendanceEngine()
            results = []
            for ev in events:
                ctx    = dict(ev.context_snapshot)
                cfg    = PolicyLoader.load(ev.event_date)
                policy = cfg["policy"]
                tiers  = cfg["penalty_tiers"]
                r      = engine._apply_rules(ctx, policy, tiers)
                results.append({
                    "event_id":   str(ev.event_id),
                    "event_type": ev.event_type,
                    "date":       ev.event_date.isoformat(),
                    "replayed_result": {
                        "work_credit":            r.work_credit,
                        "penalty_amount":         r.penalty_amount,
                        "penalty_work_deduction": r.penalty_work_deduction,
                        "parking_allowance":      r.parking_allowance,
                        "overtime_hours":         r.overtime_hours,
                        "notes":                  r.notes,
                    },
                })
            return results
        except Exception as exc:
            logger.error("DBEventStore.replay error: %s", exc)
            return []


# ─────────────────────────────────────────────────────────────────────────────
# MAIN ENGINE
# ─────────────────────────────────────────────────────────────────────────────

class HRMAttendanceEngine:

    def __init__(self):
        self.event_store = DBEventStore()
        self.rules       = RuleRegistry.get_all()

    # ── Apply all rules ───────────────────────────────────────────────────────

    def _apply_rules(self, context: Dict, policy: Dict, penalty_tiers: List[Tuple]) -> RuleResult:
        aggregate = RuleResult()

        for rule in self.rules:
            try:
                r = rule.apply(context, policy, penalty_tiers)
            except Exception as exc:
                logger.error("Rule %s failed: %s", rule.rule_id, exc)
                continue

            if isinstance(rule, ExemptionRule):
                aggregate.is_exempt                = r.is_exempt
                aggregate.exempt_money_penalty     = r.exempt_money_penalty
                aggregate.penalty_work_deduction  += r.penalty_work_deduction
                aggregate.notes.extend(r.notes)
                context["penalty_work_deduction"]  = aggregate.penalty_work_deduction

            elif isinstance(rule, PenaltyRule):
                if aggregate.exempt_money_penalty:
                    aggregate.penalty_amount = 0.0
                else:
                    aggregate.penalty_amount         += r.penalty_amount
                    aggregate.penalty_work_deduction += r.penalty_work_deduction
                    aggregate.notes.extend(r.notes)
                context["penalty_work_deduction"] = aggregate.penalty_work_deduction

            elif isinstance(rule, WorkCreditRule):
                aggregate.work_credit      = r.work_credit
                aggregate.probation_credit = r.probation_credit
                aggregate.official_credit  = r.official_credit
                aggregate.holiday_credit   = r.holiday_credit
                aggregate.notes.extend(r.notes)

            elif isinstance(rule, ParkingAllowanceRule):
                aggregate.parking_allowance += r.parking_allowance
                aggregate.notes.extend(r.notes)

            elif isinstance(rule, RegistrationIntegrationRule):
                aggregate.work_credit          += r.work_credit
                aggregate.probation_credit     += r.probation_credit
                aggregate.official_credit      += r.official_credit
                aggregate.overtime_hours       += r.overtime_hours
                aggregate.extra_hours          += r.extra_hours
                aggregate.night_shift_sessions += r.night_shift_sessions
                aggregate.notes.extend(r.notes)

            elif isinstance(rule, LivestreamRule):
                aggregate.live_allowance  += r.live_allowance
                aggregate.overtime_hours  += r.overtime_hours
                aggregate.notes.extend(r.notes)

        return aggregate

    # ── Context builder ───────────────────────────────────────────────────────

    @staticmethod
    def _normalize_event(e) -> Dict:
        """
        Chuẩn hóa mọi loại event (EmployeeEvent, legacy models, hoặc dict) về dict chuẩn.
        """
        if e is None: return None
        if isinstance(e, dict): return e
        
        # ── Nếu là EmployeeEvent (Thế hệ mới) ──
        if hasattr(e, 'event_type') and hasattr(e, 'data'):
            d = e.data or {}
            etype = e.event_type
            
            # Map request_type từ model cho engine
            from .event_models import EmployeeEvent as _EE
            _etype_map = {
                _EE.EventType.OVERTIME:    "OVERTIME",
                _EE.EventType.LIVESTREAM:  "LIVE",
                _EE.EventType.ONLINE_WORK: "ONLINE_WORK",
                _EE.EventType.NIGHT_SHIFT: "NIGHT_SHIFT",
                _EE.EventType.EXTRA_HOURS: "EXTRA_HOURS",
                _EE.EventType.OFF_DUTY:    "OFF_DUTY",
            }
            
            res = {
                "id":           e.id,
                "event_type":   etype,
                "request_type": d.get("registration_type") or _etype_map.get(etype, ""),
                "event_date":   e.event_date,
                "status":       d.get("status", "PENDING"),
                "notes":        getattr(e, "notes", ""),
            }
            
            # Data trích xuất (Ưu tiên field thực của model, fallback về JSON data)
            res["total_hours"] = float(getattr(e, "overtime_hours", 0) or d.get("total_hours", 0) or 0)
            res["start_time"]  = str(getattr(e, "check_in", "") or d.get("start_time", "") or "")
            res["end_time"]    = str(getattr(e, "check_out", "") or d.get("end_time", "") or "")
            res["live_role"]   = d.get("live_role", "")
            res["registration_date"] = e.event_date
            res["work_date"]         = e.event_date
            
            # Giải trình
            res["expected_status"]   = d.get("expected_status", "")
            res["explanation_type"]  = d.get("explanation_type", res["expected_status"])
            res["reason"]            = getattr(e, "explanation", "") or d.get("reason", "")
            res["attendance_date"]   = e.event_date
            
            # Nghỉ phép
            res["start_date"] = e.event_date
            try:
                # Thử parse end_date từ data nếu có
                res["end_date"] = d.get("end_date") and datetime.date.fromisoformat(d["end_date"]) or e.event_date
            except Exception:
                res["end_date"] = e.event_date
            res["leave_type"] = d.get("leave_type", "ANNUAL")
            
            return res
            
        # ── Legacy Models (Hoặc proxy object khác) ──
        return {
            "id":                getattr(e, "id", None),
            "status":            getattr(e, "status", "PENDING"),
            "event_date":        getattr(e, "event_date", getattr(e, "registration_date", None)),
            "request_type":      getattr(e, "request_type", ""),
            "total_hours":       float(getattr(e, "total_hours", 0) or 0),
            "start_time":        str(getattr(e, "start_time", "") or ""),
            "end_time":          str(getattr(e, "end_time", "") or ""),
            "live_role":         getattr(e, "live_role", "") or "",
            "registration_date": getattr(e, "registration_date", None),
            "work_date":         getattr(e, "work_date", None),
            "attendance_date":   getattr(e, "attendance_date", None),
            "start_date":        getattr(e, "start_date", None),
            "end_date":          getattr(e, "end_date", None),
            "explanation_type":  getattr(e, "explanation_type", getattr(e, "expected_status", "")),
            "reason":            getattr(e, "reason", getattr(e, "explanation", "") or ""),
            "leave_type":        getattr(e, "leave_type", "ANNUAL"),
        }

    @staticmethod
    def _get_applicable_shifts(employee, first_day: datetime.date, last_day: datetime.date) -> list:
        """
        Pre-fetch tất cả ShiftConfig áp dụng cho employee trong khoảng [first_day, last_day].
        Trả về list đã sort theo start_time (ưu tiên: cá nhân > vị trí > phòng ban > chung).
        Gọi một lần mỗi tháng để tránh N+1 query trong vòng lặp ngày.
        """
        try:
            from .models import ShiftConfig
            from django.db.models import Q

            q_emp  = Q(apply_to_employees=employee)
            q_pos  = Q(apply_to_positions=employee.position) if getattr(employee, "position", None) else Q(pk__in=[])
            q_dept = Q(apply_to_departments=employee.department) if getattr(employee, "department", None) else Q(pk__in=[])
            q_all  = Q(apply_to_all=True)

            return list(
                ShiftConfig.objects.filter(is_active=True)
                .filter(Q(effective_from__isnull=True) | Q(effective_from__lte=last_day))
                .filter(Q(effective_to__isnull=True)   | Q(effective_to__gte=first_day))
                .filter(q_emp | q_pos | q_dept | q_all)
                .distinct()
                .order_by("start_time")
            )
        except Exception as exc:
            logger.warning("_get_applicable_shifts failed: %s", exc)
            return []

    @staticmethod
    def _resolve_shift_for_attendance(attendance, attendance_date: datetime.date, shift_configs: list):
        """
        Tìm ShiftConfig phù hợp nhất cho một bản ghi Attendance.

        Ưu tiên:
          1. ShiftConfig có shift_type khớp với attendance.shift_type
          2. ShiftConfig is_default = True
          3. ShiftConfig đầu tiên trong danh sách (sort theo start_time)

        Ngoài ra lọc theo hiệu lực ngày: effective_from ≤ attendance_date ≤ effective_to.
        """
        if not shift_configs:
            return None

        active = [
            s for s in shift_configs
            if (s.effective_from is None or s.effective_from <= attendance_date)
            and (s.effective_to   is None or s.effective_to   >= attendance_date)
        ]
        if not active:
            return None

        shift_type = getattr(attendance, "shift_type", None)
        if shift_type:
            typed = [s for s in active if s.shift_type == shift_type]
            if typed:
                return typed[0]

        default = next((s for s in active if s.is_default), None)
        return default or active[0]

    @staticmethod
    def _calc_late_early(attendance, shift) -> Tuple[int, int]:
        """
        Tính (late_minutes, early_leave_minutes) dựa trên ShiftConfig.

        late_minutes       = max(0, check_in  - shift.start_time)  [phút]
        early_leave_minutes= max(0, shift.end_time - check_out)     [phút]

        Trả về (0, 0) nếu không có đủ thông tin.
        """
        late_min  = 0
        early_min = 0

        if shift is None or attendance is None:
            return late_min, early_min

        check_in  = getattr(attendance, "check_in",  None)
        check_out = getattr(attendance, "check_out", None)

        if check_in and shift.start_time:
            diff = (check_in.hour * 60 + check_in.minute) - \
                   (shift.start_time.hour * 60 + shift.start_time.minute)
            late_min = max(0, diff)

        if check_out and shift.end_time:
            diff = (shift.end_time.hour * 60 + shift.end_time.minute) - \
                   (check_out.hour * 60 + check_out.minute)
            early_min = max(0, diff)

        return late_min, early_min

    def _build_daily_context(
        self,
        employee,
        attendance_date: datetime.date,
        attendance=None,
        explanations: list = None,
        registrations: list = None,
        leave_requests: list = None,
        holiday_configs: list = None,
        violation_count_month: int = 1,
        explanation_quota_used: int = 0,
        total_team_live: int = 0,
        prime_sessions: int = 0,
        running_ot: float = 0.0,
        running_live_ot: float = 0.0,
        shift_configs: list = None,   # ← pre-fetched ShiftConfig list (optional)
        locked_periods: set = None,   # ← nửa tháng đã khóa chốt công (FIRST_HALF/SECOND_HALF)
    ) -> Dict:

        # ── Holiday ────────────────────────────────────────────────────
        from .employee_work_utils import is_holiday_creditable
        is_holiday = False
        if holiday_configs:
            for h in holiday_configs:
                match = (h.holiday_date == attendance_date) or (
                    getattr(h, "is_recurring", False)
                    and h.holiday_date.month == attendance_date.month
                    and h.holiday_date.day   == attendance_date.day
                )
                if match:
                    try:
                        is_holiday = h.should_apply_to_employee(employee)
                    except Exception:
                        is_holiday = True
                    if is_holiday:
                        break

        # ── Explanation ─────────────────────────────────────────────────
        day_expl = None
        if explanations:
            day_expl = next(
                (e for e in explanations
                 if e.get("attendance_date") == attendance_date and e.get("status") == "APPROVED"),
                None,
            )

        expl_status = day_expl.get("status") if day_expl else None
        expl_type   = None
        if day_expl:
            # Ưu tiên lấy trực tiếp từ field explanation_type trong data
            expl_type = (day_expl.get("explanation_type") or "").upper()
            
            # Nếu field đó trống, thử map từ expected_status (tương thích ngược)
            if not expl_type or expl_type not in (list(EXEMPT_EXPLANATION_TYPES) + ["LEAVE", "LATE", "EARLY_LEAVE", "INCOMPLETE_ATTENDANCE", "MACHINE_ERROR"]):
                exp = (day_expl.get("expected_status") or "").upper()
                if exp in EXEMPT_EXPLANATION_TYPES:
                    expl_type = exp
                elif "BUSINESS" in exp:
                    expl_type = "BUSINESS_TRIP"
                elif "FIRST" in exp:
                    expl_type = "FIRST_DAY"
                elif "LEAVE" in exp:
                    expl_type = "LEAVE"
        # ── Attendance record ───────────────────────────────────────────
        is_absent     = False
        is_incomplete = False
        is_office_day = False
        late_min      = 0
        early_min     = 0

        is_half_day   = False
        if attendance:
            s = (attendance.status or "").upper()
            is_absent     = s == "ABSENT"
            is_incomplete = s == "INCOMPLETE_ATTENDANCE"
            is_half_day   = s == "HALF_DAY"
            is_office_day = s not in ("ABSENT", "INCOMPLETE_ATTENDANCE", "LEAVE", "OFF")

            # ── Kiểm tra khóa chốt công: nếu nửa tháng đã khóa, KHÔNG tính lại
            # live từ ShiftConfig hiện tại (vì shift assignment có thể đã thay
            # đổi sau khi khóa — vd NV lên leader và đổi ca). Dùng giá trị đã
            # lưu trong model Attendance để giữ nguyên số liệu tháng đã khóa.
            period_of_day = 'FIRST_HALF' if attendance_date.day <= 15 else 'SECOND_HALF'
            is_locked_day = bool(locked_periods and period_of_day in locked_periods)

            # ── Tính late/early từ ShiftConfig (ưu tiên) ─────────────────
            # Ưu tiên:
            #   1. Nếu ngày đã khóa → dùng giá trị đã lưu (frozen snapshot)
            #   2. Nếu có shift_configs và tìm được ShiftConfig → tính live từ start_time/end_time
            #   3. Nếu không tìm được ShiftConfig (danh sách rỗng hoặc None) → fallback
            #      về giá trị đã lưu trong model Attendance (attendance.late_minutes)
            shift_used = None
            if is_locked_day:
                # Frozen — giữ nguyên late/early đã tính khi tháng còn mở
                late_min  = attendance.late_minutes or 0
                early_min = attendance.early_leave_minutes or 0
            elif shift_configs is not None:
                shift_used = self._resolve_shift_for_attendance(
                    attendance, attendance_date, shift_configs
                )
                if shift_used is not None:
                    late_min, early_min = self._calc_late_early(attendance, shift_used)
                    # shift found → use computed values
                else:
                    # Không tìm được ShiftConfig phù hợp → dùng giá trị model
                    late_min  = attendance.late_minutes or 0
                    early_min = attendance.early_leave_minutes or 0
            else:
                late_min  = attendance.late_minutes or 0
                early_min = attendance.early_leave_minutes or 0
        else:
            is_absent  = True
            shift_used = None

        # ── Leave ───────────────────────────────────────────────────────
        is_leave_day    = (expl_type == "LEAVE")
        is_half_day     = (day_expl.get("expected_status") == "HALF_DAY") if day_expl else False
        is_unpaid_leave = False
        if leave_requests:
            for lr in leave_requests:
                start = lr.get("start_date")
                end   = lr.get("end_date") or start
                if lr.get("status") == "APPROVED" and start <= attendance_date <= end:
                    if lr.get("leave_type", "") == "UNPAID":
                        is_unpaid_leave = True
                    else:
                        is_leave_day = True
                    break

        # ── Registrations for this day ──────────────────────────────────
        day_regs = []
        if registrations:
            day_regs = [
                r for r in registrations
                if r.get("registration_date") == attendance_date
                or r.get("work_date") == attendance_date
            ]

        # Đơn đi công tác đã được HR duyệt → miễn phạt (như giải trình công tác)
        if not expl_status or expl_type not in EXEMPT_EXPLANATION_TYPES:
            approved_bt = next(
                (r for r in day_regs
                 if r.get("request_type") == "BUSINESS_TRIP" and r.get("status") == "APPROVED"),
                None,
            )
            if approved_bt:
                expl_type   = "BUSINESS_TRIP"
                expl_status = "APPROVED"

        is_manager = bool(
            getattr(employee, "position", None)
            and employee.position
            and employee.position.is_management
        )

        online_reg = next(
            (r for r in day_regs 
             if r.get("request_type") == "ONLINE_WORK" and r.get("status") == "APPROVED"),
            None
        )
        is_online_work = online_reg is not None
        if is_online_work:
            reason = (online_reg.get("reason") or online_reg.get("work_plan") or "").lower()
            if "checkpage" in reason:
                is_half_day = False  # Checkpage is always 1 credit
            elif online_reg.get("expected_status") == "HALF_DAY":
                is_half_day = True

        violation_type = None
        # Lỗi máy chấm công (máy không ghi nhận giờ) xử lý như Quên chấm công
        if is_incomplete or (not attendance and expl_type in ("INCOMPLETE_ATTENDANCE", "MACHINE_ERROR")):
            is_incomplete = True
            is_absent = False
            violation_type = "INCOMPLETE"
        elif late_min > 0:
            violation_type = "LATE"
        elif early_min > 0:
            violation_type = "EARLY_LEAVE"

        live_role = ""
        for r in day_regs:
            if r.get("request_type") == "LIVE" and r.get("status") == "APPROVED":
                live_role = r.get("live_role", "") or ""
                break

        # ── Shift metadata (for audit / daily_details) ────────────────
        shift_meta = None
        if shift_used is not None:
            shift_meta = {
                "id":         shift_used.id,
                "name":       getattr(shift_used, "name", ""),
                "shift_type": getattr(shift_used, "shift_type", ""),
                "start_time": str(shift_used.start_time) if shift_used.start_time else None,
                "end_time":   str(shift_used.end_time)   if shift_used.end_time   else None,
                "source":     "shift_config",   # tính từ ShiftConfig
            }
        elif attendance and (attendance.late_minutes or attendance.early_leave_minutes):
            shift_meta = {"source": "attendance_model"}  # fallback về model

        return {
            "employee_id":                     employee.id,
            "employee_name":                   employee.full_name,
            "attendance_date":                 attendance_date,
            "is_office_day":                   is_office_day and not is_online_work,
            "is_online_work":                  is_online_work,
            "is_holiday":                      is_holiday,
            "holiday_creditable":              is_holiday and is_holiday_creditable(employee, attendance_date),
            "is_business_trip":                expl_type == "BUSINESS_TRIP",
            "is_first_day":                    expl_type == "FIRST_DAY",
            "is_leave_day":                    is_leave_day,
            "is_half_day":                     is_half_day,
            "is_unpaid_leave":                 is_unpaid_leave,
            "is_absent":                       is_absent,
            "is_incomplete":                   is_incomplete,
            # ── late/early – nguồn từ ShiftConfig (nếu có) hoặc model Attendance ──
            "late_minutes":                    late_min,
            "early_leave_minutes":             early_min,
            "shift_used":                      shift_meta,  # audit: ca nào được dùng
            "explanation_status":              expl_status,
            "explanation_type":                expl_type,
            "violation_type":                  violation_type,
            "violation_count_month":           violation_count_month,
            "explanation_quota_used":          explanation_quota_used,
            "is_manager":                      is_manager,
            "probation_end_date":              getattr(employee, "probation_end_date", None),
            "registration_requests":           day_regs,
            "live_role":                       live_role,
            "total_team_live_sessions_month":  total_team_live,
            "current_prime_time_sessions_month": prime_sessions,
            "employee_total_ot_hours_month":   running_ot,
            "employee_live_ot_hours_month":    running_live_ot,
            "penalty_work_deduction":          0.0,
        }

    # ── Monthly calculation ────────────────────────────────────────────────────

    def calculate_monthly_summary(
        self,
        employee,
        year: int,
        month: int,
        registrations=None,
        online_requests=None,
        persist_events: bool = True,
    ) -> Dict:
        import calendar
        from .models import Attendance, HolidayConfig
        from .event_models import EmployeeEvent

        first_day = datetime.date(year, month, 1)
        last_day  = datetime.date(year, month, calendar.monthrange(year, month)[1])

        # Load policy for the first day of the month
        cfg          = PolicyLoader.load(first_day)
        policy       = cfg["policy"]
        tiers        = cfg["penalty_tiers"]
        policy_ver   = cfg["version_obj"]

        # Fetch DB records
        attendances  = {
            a.attendance_date: a
            for a in Attendance.objects.filter(
                employee=employee,
                attendance_date__gte=first_day,
                attendance_date__lte=last_day,
            )
        }

        # ── Explanations: dùng EmployeeEvent thay vì AttendanceExplanation ──
        explanation_events = list(EmployeeEvent.objects.filter(
            employee=employee,
            event_type=EmployeeEvent.EventType.EXPLANATION,
            event_date__gte=first_day,
            event_date__lte=last_day,
        ))
        explanations = [self._normalize_event(e) for e in explanation_events]

        # ── Leave requests: đọc từ EmployeeEvent loại LEAVE_REQUEST ──
        leave_events = list(EmployeeEvent.objects.filter(
            employee=employee,
            event_type=EmployeeEvent.EventType.LEAVE_REQUEST,
            event_date__gte=first_day,
            event_date__lte=last_day,
        ).filter(data__status="APPROVED"))

        leaves   = [self._normalize_event(e) for e in leave_events]
        holidays = list(HolidayConfig.objects.filter(is_active=True))

        # ── Pre-fetch ShiftConfigs (once per month, avoids N+1 in daily loop) ──
        shift_configs = self._get_applicable_shifts(employee, first_day, last_day)

        # ── Pre-fetch FinalizationLock cho tháng này (once, tránh N+1) ──
        # Nếu 1 nửa tháng đã khóa, engine sẽ dùng late/early đã lưu trong
        # Attendance record thay vì recompute từ ShiftConfig hiện tại — tránh
        # bảng chốt công tháng cũ bị lệch khi HR đổi ca cho NV lên leader.
        from .models import FinalizationLock as _FinalizationLock
        locked_periods = set(
            _FinalizationLock.objects.filter(
                year=year, month=month, is_locked=True
            ).values_list('period', flat=True)
        )

        # ── Registrations: ưu tiên param, fallback về EmployeeEvent ──
        if registrations is not None:
            reg_list = list(registrations)
        else:
            reg_events = EmployeeEvent.objects.filter(
                employee=employee,
                event_type__in=[
                    EmployeeEvent.EventType.OVERTIME,
                    EmployeeEvent.EventType.LIVESTREAM,
                ],
                event_date__gte=first_day,
                event_date__lte=last_day,
            )
            reg_list = [self._normalize_event(e) for e in reg_events]

        # ── Online work: ưu tiên param, fallback về EmployeeEvent ──
        if online_requests is not None:
            online_list = list(online_requests)
        else:
            online_events = EmployeeEvent.objects.filter(
                employee=employee,
                event_type=EmployeeEvent.EventType.ONLINE_WORK,
                event_date__gte=first_day,
                event_date__lte=last_day,
            )
            online_list = [self._normalize_event(e) for e in online_events]

        # Inject online requests into reg_list as ONLINE_WORK dicts
        for ow in online_list:
            ow_status = ow.get("status", "") if isinstance(ow, dict) else getattr(ow, "status", "")
            if ow_status == "APPROVED":
                ow_date = ow.get("work_date") if isinstance(ow, dict) else getattr(ow, "work_date", None)
                reg_list.append({
                    "request_type": "ONLINE_WORK",
                    "status":       "APPROVED",
                    "registration_date": ow_date,
                    "work_date":         ow_date,
                    "total_hours":       8,
                    "expected_status":  ow.get("expected_status"),
                    "reason":           ow.get("reason", ""),
                    "start_time":        "08:00",
                    "end_time":          "17:00",
                    "live_role":         "",
                    "id":                ow.get("id") if isinstance(ow, dict) else getattr(ow, "id", None),
                })

        total_team_live = sum(
            1 for r in reg_list
            if r.get("request_type") == "LIVE"
            and r.get("status") == "APPROVED"
        )

        # Running counters
        running_violations = 0
        running_expl_quota = 0
        running_ot         = 0.0
        running_live_ot    = 0.0
        prime_sessions     = 0

        summary = self._empty_summary(employee, year, month, policy)

        all_dates = [
            first_day + datetime.timedelta(days=i)
            for i in range((last_day - first_day).days + 1)
        ]

        for current_date in all_dates:
            att = attendances.get(current_date)

            ctx = self._build_daily_context(
                employee               = employee,
                attendance_date        = current_date,
                attendance             = att,
                explanations           = explanations,
                registrations          = reg_list,
                leave_requests         = leaves,
                holiday_configs        = holidays,
                violation_count_month  = running_violations + 1,
                explanation_quota_used = running_expl_quota,
                total_team_live        = total_team_live,
                prime_sessions         = prime_sessions,
                running_ot             = running_ot,
                running_live_ot        = running_live_ot,
                shift_configs          = shift_configs,
                locked_periods         = locked_periods,
            )

            result = self._apply_rules(ctx, policy, tiers)

            # Persist event to DB
            if persist_events:
                self.event_store.append(
                    employee         = employee,
                    event_type       = EventType.WORK_CREDIT_CALC,
                    event_date       = current_date,
                    context          = ctx,
                    result_dict      = {
                        "work_credit":    result.work_credit,
                        "holiday_credit": result.holiday_credit,
                        "penalty_amount": result.penalty_amount,
                        "penalty_work":   result.penalty_work_deduction,
                        "parking":        result.parking_allowance,
                        "live_allowance": result.live_allowance,
                        "ot_hours":       result.overtime_hours,
                    },
                    policy_version   = policy_ver,
                    attendance_id    = getattr(att, "id", None),
                )

            # Update running counters
            if ctx["late_minutes"] > 0 or ctx["early_leave_minutes"] > 0:
                running_violations += 1
            # Lỗi máy chấm công không tính lượt giải trình
            if (result.is_exempt and ctx.get("explanation_type") not in EXEMPT_EXPLANATION_TYPES
                    and ctx.get("explanation_type") != "MACHINE_ERROR"):
                running_expl_quota += 1
            running_ot      += result.overtime_hours
            running_live_ot += result.overtime_hours  # approx; ideally filter LIVE OT only

            # Prime sessions
            for r in reg_list:
                if r.get("registration_date") != current_date:
                    continue
                if r.get("request_type") == "LIVE" and r.get("status") == "APPROVED":
                    st_str = str(r.get("start_time", "") or "")
                    try:
                        h, m = map(int, st_str.split(":")[:2])
                        if datetime.time(
                            policy.get("live_prime_start_hour", 21), 0
                        ) <= datetime.time(h, m) < datetime.time(
                            policy.get("live_prime_end_hour", 23), 0
                        ):
                            prime_sessions += 1
                    except (ValueError, AttributeError):
                        pass

            # Accumulate totals
            self._accumulate(summary, ctx, result)

        # Final roll-up
        summary["total_violations"]           = summary["late_count"] + summary["early_leave_count"]
        summary["explanation_quota_used"]     = running_expl_quota
        summary["explanation_quota_remaining"] = max(
            0, policy.get("max_explanation_quota", 3) - running_expl_quota
        )
        summary["col14_actual_work_credit"]   = max(
            0.0,
            summary["total_work_credit"]
        )
        summary["financial_summary"] = {
            "total_penalty_vnd":        summary["total_penalty_vnd"],
            "total_penalty_work_ded":   summary["total_penalty_work_ded"],
            "total_parking_allowance":  summary["total_parking_allowance"],
            "total_live_allowance":     summary["total_live_allowance"],
        }
        if total_team_live > 0:
            max_prime = max(1, int(total_team_live * float(policy.get("max_live_prime_time_pct", 0.2))))
            summary["live_prime_quota"] = {
                "current":       prime_sessions,
                "max_allowed":   max_prime,
                "total_team":    total_team_live,
                "over_quota":    prime_sessions > max_prime,
            }
        summary["policy_version"] = cfg["version_code"]
        return summary

    # ── Helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _empty_summary(employee, year, month, policy) -> Dict:
        return {
            "employee_id":         employee.id,
            "employee_name":       employee.full_name,
            "employee_code":       employee.employee_id,
            "year":                year,
            "month":               month,
            "probation_end_date":  (str(employee.probation_end_date)
                                    if getattr(employee, "probation_end_date", None) else None),
            "total_work_credit":   0.0,
            "probation_credit":    0.0,
            "official_credit":     0.0,
            "holiday_credit":      0.0,
            "office_days":         0,
            "online_days":         0,
            "holiday_days":        0,
            "business_trip_days":  0,
            "leave_days":          0,
            "unpaid_leave_days":   0,
            "absent_days":         0,
            "incomplete_days":     0,
            "first_day_count":     0,
            "late_count":          0,
            "early_leave_count":   0,
            "total_violations":    0,
            "total_penalty_vnd":       0.0,
            "total_penalty_work_ded":  0.0,
            "total_parking_allowance": 0.0,
            "total_live_allowance":    0.0,
            "total_overtime_hours":    0.0,
            "total_extra_hours":       0.0,
            "total_night_shift_sessions": 0,
            "total_live_sessions":     0,
            "live_prime_time_sessions": 0,
            "explanation_quota_used":   0,
            "explanation_quota_remaining": policy.get("max_explanation_quota", 3),
            "daily_details":           [],
        }

    @staticmethod
    def _accumulate(summary: Dict, ctx: Dict, result: RuleResult):
        summary["total_work_credit"]       += result.work_credit + result.holiday_credit
        summary["probation_credit"]        += result.probation_credit
        summary["official_credit"]         += result.official_credit
        summary["holiday_credit"]          += result.holiday_credit
        summary["total_penalty_vnd"]       += result.penalty_amount
        summary["total_penalty_work_ded"]  += result.penalty_work_deduction
        summary["total_parking_allowance"] += result.parking_allowance
        summary["total_live_allowance"]    += result.live_allowance
        summary["total_overtime_hours"]    += result.overtime_hours
        summary["total_extra_hours"]       += result.extra_hours
        summary["total_night_shift_sessions"] += result.night_shift_sessions

        if ctx["is_holiday"]:            summary["holiday_days"]       += 1
        elif ctx["is_online_work"]:      summary["online_days"]        += 1
        elif ctx["is_business_trip"]:    summary["business_trip_days"] += 1
        elif ctx["is_first_day"]:        summary["first_day_count"]    += 1
        elif ctx["is_leave_day"]:        summary["leave_days"]         += 1
        elif ctx["is_unpaid_leave"]:     summary["unpaid_leave_days"]  += 1
        elif ctx["is_absent"]:           summary["absent_days"]        += 1
        elif ctx["is_incomplete"]:       summary["incomplete_days"]    += 1
        elif ctx["is_office_day"]:       summary["office_days"]        += 1

        if ctx["late_minutes"] > 0:        summary["late_count"]        += 1
        if ctx["early_leave_minutes"] > 0: summary["early_leave_count"] += 1

        summary["daily_details"].append({
            "date":                   str(ctx["attendance_date"]),
            "is_office_day":          ctx["is_office_day"],
            "is_online_work":         ctx["is_online_work"],
            "is_half_day":            ctx.get("is_half_day", False), # Added is_half_day
            "is_holiday":             ctx["is_holiday"],
            "is_business_trip":       ctx["is_business_trip"],
            "is_first_day":           ctx["is_first_day"],
            "is_leave_day":           ctx["is_leave_day"],
            "is_unpaid_leave":        ctx["is_unpaid_leave"],
            "is_absent":              ctx["is_absent"],
            "is_incomplete":          ctx["is_incomplete"],
            # ── Muộn/sớm (tính từ ShiftConfig hoặc model Attendance) ─────────
            "late_minutes":           ctx["late_minutes"],
            "early_leave_minutes":    ctx["early_leave_minutes"],
            # shift_used: ca làm việc được dùng để tính muộn/sớm
            # source="shift_config"    → tính từ ShiftConfig.start_time/end_time
            # source="attendance_model"→ fallback từ Attendance.late_minutes lưu sẵn
            # None                     → không có bản ghi chấm công
            "shift_used":             ctx.get("shift_used"),
            # ── Penalty (tra PenaltyTierConfig từ AttendancePolicyVersion) ────
            "penalty_vnd":            result.penalty_amount,
            "penalty_work_ded":       result.penalty_work_deduction,
            "penalty_exempted":       result.is_exempt,
            # ── Work credit / allowances ──────────────────────────────────────
            "work_credit":            result.work_credit + result.holiday_credit,
            "probation_credit":       result.probation_credit,
            "official_credit":        result.official_credit,
            "holiday_credit":         result.holiday_credit,
            "parking_allowance":      result.parking_allowance,
            "live_allowance":         result.live_allowance,
            "overtime_hours":         result.overtime_hours,
            "extra_hours":            result.extra_hours,
            "night_shift_sessions":   result.night_shift_sessions,
            "notes":                  result.notes,
        })

    # ── Save to DB ────────────────────────────────────────────────────────────

    def save_monthly_work_credit(self, employee, year: int, month: int,
                                  summary: Dict, created_by=None):
        from .models import MonthlyWorkCredit
        from django.utils import timezone

        obj, _ = MonthlyWorkCredit.objects.get_or_create(
            employee=employee, year=year, month=month,
            defaults={"credit_code": f"CREDIT-{year}{month:02d}-{employee.employee_id}"}
        )
        obj.total_work_days           = summary.get("office_days", 0) + summary.get("online_days", 0)
        obj.total_work_hours          = obj.total_work_days * 8
        obj.total_overtime_hours      = summary.get("total_overtime_hours", 0)
        obj.work_coefficient          = summary.get("col14_actual_work_credit", 0)
        obj.annual_leave_days         = summary.get("leave_days", 0)
        obj.unpaid_leave_days         = summary.get("unpaid_leave_days", 0)
        obj.calculation_details       = summary
        obj.applied_rules             = list(RuleRegistry._rules.__class__.__name__
                                             for _ in [1])  # placeholder
        obj.applied_rules             = [r.rule_id for r in RuleRegistry.get_all()]
        obj.status                    = "CALCULATED"
        obj.calculated_at             = timezone.now()
        if created_by:
            obj.created_by            = created_by
        obj.save()

        # Persist MONTHLY_FINALIZED event
        self.event_store.append(
            employee     = employee,
            event_type   = EventType.MONTHLY_FINALIZED,
            event_date   = datetime.date(year, month, 1),
            context      = {"year": year, "month": month},
            result_dict  = {
                "col14":         summary.get("col14_actual_work_credit"),
                "total_penalty": summary.get("total_penalty_vnd"),
            },
        )
        return obj


# ─────────────────────────────────────────────────────────────────────────────
# DEPARTMENT BATCH ENGINE
# ─────────────────────────────────────────────────────────────────────────────

class DepartmentAttendanceBatchEngine:

    def __init__(self):
        self.engine = HRMAttendanceEngine()

    def process_department_month(self, department, year: int, month: int,
                                  created_by=None) -> Dict:
        from employee.models import Employee as Emp
        from .event_models import EmployeeEvent

        employees = list(Emp.objects.filter(
            department=department, employment_status="ACTIVE"
        ))
        results = {
            "department_id":   department.id,
            "department_name": department.name,
            "year":            year,
            "month":           month,
            "total_employees": len(employees),
            "processed":       0,
            "errors":          0,
            "employee_results": [],
        }
        import datetime as _dt
        first_day = _dt.date(year, month, 1)
        import calendar as _cal
        last_day  = _dt.date(year, month, _cal.monthrange(year, month)[1])

        for emp in employees:
            try:
                # ── Registrations từ EmployeeEvent ──
                reg_events = EmployeeEvent.objects.filter(
                    employee=emp,
                    event_type__in=[
                        EmployeeEvent.EventType.OVERTIME,
                        EmployeeEvent.EventType.LIVESTREAM,
                    ],
                    event_date__gte=first_day,
                    event_date__lte=last_day,
                )
                regs = [self._normalize_event(e) for e in reg_events]

                # ── Online work từ EmployeeEvent ──
                online_events = EmployeeEvent.objects.filter(
                    employee=emp,
                    event_type=EmployeeEvent.EventType.ONLINE_WORK,
                    event_date__gte=first_day,
                    event_date__lte=last_day,
                )
                online = [self._normalize_event(e) for e in online_events]

                summary = self.engine.calculate_monthly_summary(
                    employee=emp, year=year, month=month,
                    registrations=regs, online_requests=online,
                )
                wc = self.engine.save_monthly_work_credit(
                    employee=emp, year=year, month=month,
                    summary=summary, created_by=created_by,
                )
                results["employee_results"].append({
                    "employee_id":    emp.id,
                    "employee_name":  emp.full_name,
                    "success":        True,
                    "work_credit_id": wc.id,
                    "col14":          summary.get("col14_actual_work_credit"),
                    "total_penalty":  summary.get("total_penalty_vnd"),
                })
                results["processed"] += 1
            except Exception as exc:
                results["errors"] += 1
                results["employee_results"].append({
                    "employee_id":   emp.id,
                    "employee_name": getattr(emp, "full_name", "?"),
                    "success":       False,
                    "error":         str(exc),
                })
        return results


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def get_engine() -> HRMAttendanceEngine:
    return HRMAttendanceEngine()


def calculate_penalty_preview(late_minutes: int, early_minutes: int,
                               violation_count_month: int, is_manager: bool = False,
                               date: datetime.date = None) -> Dict:
    """Quick penalty preview without needing a full employee object."""
    d      = date or datetime.date.today()
    cfg    = PolicyLoader.load(d)
    policy = cfg["policy"]
    tiers  = cfg["penalty_tiers"]
    ctx    = {
        "late_minutes":          late_minutes,
        "early_leave_minutes":   early_minutes,
        "violation_count_month": violation_count_month,
        "is_manager":            is_manager,
    }
    r = PenaltyRule().apply(ctx, policy, tiers)
    return {
        "policy_version":        cfg["version_code"],
        "penalty_amount_vnd":    r.penalty_amount,
        "penalty_work_deduction": r.penalty_work_deduction,
        "notes":                 r.notes,
    }


def check_live_session_eligibility(start_time_str: str, session_hours: float,
                                    current_prime_sessions: int, total_team_live: int,
                                    date: datetime.date = None) -> Dict:
    """Quick check for a live session's allowance eligibility."""
    d      = date or datetime.date.today()
    cfg    = PolicyLoader.load(d)
    policy = cfg["policy"]

    prime_start = datetime.time(policy.get("live_prime_start_hour", 21), 0)
    prime_end   = datetime.time(policy.get("live_prime_end_hour", 23), 0)
    allowance   = policy.get("live_prime_time_allowance", 100_000)
    prime_pct   = float(policy.get("max_live_prime_time_pct", 0.20))

    try:
        h, m = map(int, start_time_str.split(":")[:2])
        t = datetime.time(h, m)
    except (ValueError, AttributeError):
        return {"error": "Invalid time format"}

    is_prime      = prime_start <= t < prime_end
    max_prime     = max(1, int(total_team_live * prime_pct)) if total_team_live else 0
    eligible      = is_prime and (max_prime == 0 or current_prime_sessions < max_prime)

    return {
        "policy_version":   cfg["version_code"],
        "is_prime_time":    is_prime,
        "eligible":         eligible,
        "allowance_vnd":    allowance if eligible else 0,
        "prime_quota":      {
            "current":     current_prime_sessions,
            "max_allowed": max_prime,
            "total_team":  total_team_live,
            "pct":         f"{prime_pct*100:.0f}%",
        },
        "ot_hours_if_not_prime": session_hours if not is_prime else 0,
        "note": (
            f"Prime-time: phụ cấp {allowance:,} VNĐ" if eligible
            else ("Vượt quota 20%" if is_prime else "Ngoài khung: tính OT")
        ),
    }
