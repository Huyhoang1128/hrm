"""
hrm/management/commands/seed_rules.py
══════════════════════════════════════════════════
Management command để khởi tạo dữ liệu rules ban đầu vào DB.

Bao gồm:
  - RuleDefinition: Các rule mẫu cho attendance, leave, overtime, livestream
  - RuleRegistry: Registry để quản lý rules theo version

Cách dùng:
  python manage.py seed_rules
  python manage.py seed_rules --force        # ghi đè nếu đã tồn tại
  python manage.py seed_rules --dry-run      # chỉ in ra, không lưu
  python manage.py seed_rules --deactivate-others  # deactivate các rule khác
"""

import datetime
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone


# ─────────────────────────────────────────────────────────────────────────────
# DATA SEED
# ─────────────────────────────────────────────────────────────────────────────

RULES_DATA = [
    # ======================
    # ATTENDANCE RULES
    # ======================
    {
        "rule_name": "Late Penalty Rule",
        "rule_type": "attendance_penalty",
        "conditions": {
            "late_minutes_threshold": 10,
            "penalty_amount": 50000,
            "penalty_type": "fine",
            "deduct_work_credit": False
        },
        "scope": "COMPANY",
        "identifier": "ALL",
        "priority": 10,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to": None,
        "is_active": True,
        "description": "Phạt muộn: 50.000 VNĐ cho mỗi lần muộn trên 10 phút"
    },
    {
        "rule_name": "Early Leave Penalty Rule",
        "rule_type": "attendance_penalty",
        "conditions": {
            "early_leave_minutes_threshold": 10,
            "penalty_amount": 50000,
            "penalty_type": "fine",
            "deduct_work_credit": False
        },
        "scope": "COMPANY",
        "identifier": "ALL",
        "priority": 10,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to": None,
        "is_active": True,
        "description": "Phạt về sớm: 50.000 VNĐ cho mỗi lần về sớm trên 10 phút"
    },
    {
        "rule_name": "Manager Late Penalty Rule",
        "rule_type": "attendance_penalty",
        "conditions": {
            "late_minutes_threshold": 10,
            "penalty_amount": 75000,
            "penalty_type": "fine",
            "deduct_work_credit": False,
            "apply_to_managers": True
        },
        "scope": "GROUP",
        "identifier": "MANAGERS",
        "priority": 20,  # Higher priority for managers
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to": None,
        "is_active": True,
        "description": "Phạt muộn cho quản lý: 75.000 VNĐ cho mỗi lần muộn trên 10 phút"
    },
    {
        "rule_name": "Overtime Calculation Rule",
        "rule_type": "overtime_calculation",
        "conditions": {
            "overtime_multiplier_weekday": 1.5,
            "overtime_multiplier_weekend": 2.0,
            "overtime_multiplier_holiday": 3.0,
            "min_overtime_hours": 0.5
        },
        "scope": "COMPANY",
        "identifier": "ALL",
        "priority": 5,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to": None,
        "is_active": True,
        "description": "Tính toán làm thêm: x1.5 ngày thường, x2 cuối tuần, x3 ngày lễ"
    },
    
    # ======================
    # LEAVE RULES
    # ======================
    {
        "rule_name": "Paid Leave Rule",
        "rule_type": "LEAVE_RULE_PAID",
        "conditions": {
            "workday": 1.0,
            "annual_leave_days_per_year": 12,
        },
        "scope": "COMPANY",
        "identifier": "ALL",
        "priority": 10,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to": None,
        "is_active": True,
        "description": "Nghỉ phép có lương (phép năm, nghỉ ốm, thai sản, …): tính 1 ngày nghi_phep, không trừ công",
    },
    {
        "rule_name": "Unpaid Leave Rule",
        "rule_type": "LEAVE_RULE_UNPAID",
        "conditions": {
            "workday": 1.0,
            "max_days_per_month": 3,
        },
        "scope": "COMPANY",
        "identifier": "ALL",
        "priority": 10,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to": None,
        "is_active": True,
        "description": "Nghỉ không lương: tính 1 ngày nghi_khong_luong, trừ 1 ngày công (vang_mat)",
    },
    
    # ======================
    # LIVESTREAM RULES
    # ======================
    {
        "rule_name": "Livestream Prime Time Allowance",
        "rule_type": "livestream_allowance",
        "conditions": {
            "prime_time_start_hour": 21,
            "prime_time_end_hour": 23,
            "allowance_amount": 100000,
            "max_prime_time_sessions_per_month": 8
        },
        "scope": "COMPANY",
        "identifier": "ALL",
        "priority": 5,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to": None,
        "is_active": True,
        "description": "Phụ cấp livestream giờ vàng (21h-23h): 100.000 VNĐ/phiên"
    },
    {
        "rule_name": "Livestream Regular Allowance",
        "rule_type": "livestream_allowance",
        "conditions": {
            "allowance_amount": 50000,
            "min_session_duration_hours": 2
        },
        "scope": "COMPANY",
        "identifier": "ALL",
        "priority": 5,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to": None,
        "is_active": True,
        "description": "Phụ cấp livestream thường: 50.000 VNĐ/phiên (tối thiểu 2 giờ)"
    },
    
    # ======================
    # DEPARTMENT SPECIFIC RULES
    # ======================
    {
        "rule_name": "Marketing Department Overtime Rule",
        "rule_type": "overtime_calculation",
        "conditions": {
            "overtime_multiplier_weekday": 1.75,
            "overtime_multiplier_weekend": 2.25,
            "overtime_multiplier_holiday": 3.0,
            "min_overtime_hours": 0.5
        },
        "scope": "DEPARTMENT",
        "identifier": "MARKETING",
        "priority": 15,  # Higher priority than company rule
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to": None,
        "is_active": True,
        "description": "Tính toán làm thêm cho phòng Marketing: x1.75 ngày thường, x2.25 cuối tuần"
    },
    {
        "rule_name": "Sales Department Attendance Rule",
        "rule_type": "attendance_penalty",
        "conditions": {
            "late_minutes_threshold": 15,
            "penalty_amount": 30000,
            "penalty_type": "fine",
            "deduct_work_credit": False
        },
        "scope": "DEPARTMENT",
        "identifier": "SALES",
        "priority": 15,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to": None,
        "is_active": True,
        "description": "Phạt muộn cho phòng Sales: 30.000 VNĐ cho mỗi lần muộn trên 15 phút"
    },
    
    # ======================
    # EXPLANATION APPROVAL RULES
    # ======================
    {
        "rule_name": "HR Explanation Approval Rule",
        "rule_type": "EXPLANATION_APPROVAL_RULE",
        "conditions": {
            "annual_leave_days_per_year": 12,
        },
        "scope": "COMPANY",
        "identifier": "ALL",
        "priority": 10,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to": None,
        "is_active": True,
        "description": (
            "Khi HR duyệt giải trình vắng mặt, tính 1 ngày nghỉ phép có lương "
            "và trừ vào số ngày phép năm còn lại của nhân viên"
        ),
    },

    # ======================
    # INDIVIDUAL RULES (Example for CEO)
    # ======================
    {
        "rule_name": "CEO Flexible Attendance Rule",
        "rule_type": "attendance_policy",
        "conditions": {
            "flexible_hours": True,
            "core_hours_start": "10:00",
            "core_hours_end": "16:00",
            "no_penalty_for_late": True
        },
        "scope": "INDIVIDUAL",
        "identifier": "CEO001",
        "priority": 100,  # Highest priority
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to": None,
        "is_active": True,
        "description": "Chính sách chấm công linh hoạt cho CEO: giờ làm việc linh hoạt, không phạt muộn"
    },
]

RULE_REGISTRIES = [
    {
        "name": "Default Rule Registry",
        "description": "Registry mặc định chứa tất cả các rule cơ bản",
        "version": "v1.0.0",
        "rules_data": []  # Will be populated from RuleDefinition
    },
    {
        "name": "Attendance Rules Registry",
        "description": "Registry chuyên cho các rule về chấm công",
        "version": "v1.0.0",
        "rules_data": []  # Will be populated with attendance rules
    },
    {
        "name": "Leave Rules Registry",
        "description": "Registry chuyên cho các rule về nghỉ phép",
        "version": "v1.0.0",
        "rules_data": []  # Will be populated with leave rules
    },
]


class Command(BaseCommand):
    help = (
        "Khởi tạo dữ liệu rules (RuleDefinition, RuleRegistry) vào DB."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            default=False,
            help="Ghi đè (update) nếu rule đã tồn tại trong DB.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Chỉ in ra những gì sẽ được tạo, không lưu vào DB.",
        )
        parser.add_argument(
            "--deactivate-others",
            action="store_true",
            default=False,
            help="Deactivate tất cả các rule khác trước khi seed.",
        )
        parser.add_argument(
            "--rule-type",
            type=str,
            default=None,
            help="Chỉ seed rules của một loại cụ thể (để trống = seed tất cả).",
        )
        parser.add_argument(
            "--scope",
            type=str,
            default=None,
            help="Chỉ seed rules của một scope cụ thể (COMPANY, DEPARTMENT, GROUP, INDIVIDUAL).",
        )

    # ─────────────────────────────────────────────────────────────────────────

    def handle(self, *args, **options):
        from hrm.event_models import RuleDefinition, RuleRegistry
        from employee.models import Employee

        force            = options["force"]
        dry_run          = options["dry_run"]
        deactivate_others = options["deactivate_others"]
        rule_type_filter = options["rule_type"]
        scope_filter     = options["scope"]

        self.stdout.write(self.style.MIGRATE_HEADING(
            "\n══════════════════════════════════════════════\n"
            "  HRM Rule Seeder\n"
            "══════════════════════════════════════════════"
        ))

        if dry_run:
            self.stdout.write(self.style.WARNING("  ⚡ DRY-RUN mode – không lưu vào DB\n"))

        # Filter rules based on options
        rules_to_seed = RULES_DATA
        if rule_type_filter:
            rules_to_seed = [r for r in RULES_DATA if r["rule_type"] == rule_type_filter]
            if not rules_to_seed:
                raise CommandError(
                    f"Không tìm thấy rule_type='{rule_type_filter}' trong danh sách seed."
                )
        
        if scope_filter:
            rules_to_seed = [r for r in rules_to_seed if r["scope"] == scope_filter]
            if not rules_to_seed:
                raise CommandError(
                    f"Không tìm thấy scope='{scope_filter}' trong danh sách seed."
                )

        if not dry_run and deactivate_others:
            deactivated = RuleDefinition.objects.filter(is_active=True).exclude(
                rule_name__in=[r["rule_name"] for r in rules_to_seed]
            ).update(is_active=False)
            if deactivated:
                self.stdout.write(
                    self.style.WARNING(f"  ⚠  Đã deactivate {deactivated} rule cũ.")
                )

        total_created = 0
        total_updated = 0

        # Try to get a default employee for created_by field
        default_employee = None
        if not dry_run:
            try:
                default_employee = Employee.objects.first()
            except Exception:
                self.stdout.write(
                    self.style.WARNING("  ⚠  Không tìm thấy employee nào cho created_by field.")
                )

        for rdata in rules_to_seed:
            rule_name = rdata["rule_name"]
            self.stdout.write(f"\n  📋 Rule: {self.style.SUCCESS(rule_name)}")
            self.stdout.write(f"     Loại: {rdata['rule_type']}")
            self.stdout.write(f"     Phạm vi: {rdata['scope']} - {rdata.get('identifier', 'N/A')}")
            self.stdout.write(f"     Ưu tiên: {rdata['priority']}")
            self.stdout.write(f"     Active: {rdata['is_active']}")

            if dry_run:
                self.stdout.write(f"     Điều kiện: {rdata['conditions']}")
                self.stdout.write(f"     → [DRY-RUN] Bỏ qua, không lưu.")
                continue

            with transaction.atomic():
                # ── RuleDefinition ──────────────────────────────────────────
                existing = RuleDefinition.objects.filter(rule_name=rule_name).first()

                if existing and not force:
                    self.stdout.write(
                        self.style.WARNING(
                            f"     ⚠  rule_name='{rule_name}' đã tồn tại. "
                            f"Dùng --force để ghi đè."
                        )
                    )
                    continue

                if existing and force:
                    existing.rule_type      = rdata["rule_type"]
                    existing.conditions     = rdata["conditions"]
                    existing.scope          = rdata["scope"]
                    existing.identifier     = rdata["identifier"]
                    existing.priority       = rdata["priority"]
                    existing.effective_from = rdata["effective_from"]
                    existing.effective_to   = rdata["effective_to"]
                    existing.is_active      = rdata["is_active"]
                    existing.description    = rdata["description"]
                    existing.created_by     = default_employee
                    existing.save()
                    rule_obj = existing
                    self.stdout.write(f"     ✏  Đã cập nhật RuleDefinition '{rule_name}'.")
                    total_updated += 1
                else:
                    rule_obj = RuleDefinition.objects.create(
                        rule_name      = rule_name,
                        rule_type      = rdata["rule_type"],
                        conditions     = rdata["conditions"],
                        scope          = rdata["scope"],
                        identifier     = rdata["identifier"],
                        priority       = rdata["priority"],
                        effective_from = rdata["effective_from"],
                        effective_to   = rdata["effective_to"],
                        is_active      = rdata["is_active"],
                        description    = rdata["description"],
                        created_by     = default_employee,
                    )
                    self.stdout.write(
                        f"     {self.style.SUCCESS('✔')}  Đã tạo RuleDefinition '{rule_name}' (id={rule_obj.id})."
                    )
                    total_created += 1

        # ── RuleRegistry ────────────────────────────────────────────────────
        self.stdout.write(f"\n  📚 Tạo RuleRegistry:")
        
        registry_created = 0
        registry_updated = 0
        
        for rdata in RULE_REGISTRIES:
            registry_name = rdata["name"]
            self.stdout.write(f"\n  📋 Registry: {self.style.SUCCESS(registry_name)}")
            self.stdout.write(f"     Version: {rdata['version']}")
            
            if dry_run:
                self.stdout.write(f"     → [DRY-RUN] Bỏ qua, không lưu.")
                continue
            
            with transaction.atomic():
                # Populate rules_data based on registry type
                rules_data = []
                if registry_name == "Attendance Rules Registry":
                    # Get all attendance-related rules
                    attendance_rules = RuleDefinition.objects.filter(
                        rule_type__in=["attendance_penalty", "attendance_policy", "overtime_calculation"]
                    )
                    for rule in attendance_rules:
                        rules_data.append(rule.to_dict())
                elif registry_name == "Leave Rules Registry":
                    # Get all leave-related rules
                    leave_rules = RuleDefinition.objects.filter(
                        rule_type__in=["leave_accrual", "leave_policy"]
                    )
                    for rule in leave_rules:
                        rules_data.append(rule.to_dict())
                else:  # Default Rule Registry
                    # Get all rules
                    all_rules = RuleDefinition.objects.all()
                    for rule in all_rules:
                        rules_data.append(rule.to_dict())
                
                # Create or update registry
                existing_registry = RuleRegistry.objects.filter(name=registry_name).first()
                
                if existing_registry and not force:
                    self.stdout.write(
                        self.style.WARNING(
                            f"     ⚠  registry '{registry_name}' đã tồn tại. "
                            f"Dùng --force để ghi đè."
                        )
                    )
                    continue
                
                if existing_registry and force:
                    existing_registry.description = rdata["description"]
                    existing_registry.version = rdata["version"]
                    existing_registry.rules_data = rules_data
                    existing_registry.created_by = default_employee
                    existing_registry.save()
                    registry_updated += 1
                    self.stdout.write(f"     ✏  Đã cập nhật RuleRegistry '{registry_name}'.")
                else:
                    RuleRegistry.objects.create(
                        name = registry_name,
                        description = rdata["description"],
                        version = rdata["version"],
                        rules_data = rules_data,
                        created_by = default_employee,
                    )
                    registry_created += 1
                    self.stdout.write(
                        f"     {self.style.SUCCESS('✔')}  Đã tạo RuleRegistry '{registry_name}'."
                    )
        
        # ── Summary ──────────────────────────────────────────────────────────
        self.stdout.write(self.style.MIGRATE_HEADING(
            "\n══════════════════════════════════════════════"
        ))
        if dry_run:
            self.stdout.write(
                self.style.WARNING("  ✔ DRY-RUN hoàn thành – không có gì được lưu vào DB.")
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"  ✔ Hoàn thành! "
                    f"Tạo mới: {total_created} rule, {registry_created} registry  |  "
                    f"Cập nhật: {total_updated} rule, {registry_updated} registry"
                )
            )
            self.stdout.write(
                "\n  Bước tiếp theo:\n"
                "    python manage.py makemigrations hrm\n"
                "    python manage.py migrate\n"
                "    python manage.py seed_rules  # để seed dữ liệu mẫu\n"
            )
        self.stdout.write("")
