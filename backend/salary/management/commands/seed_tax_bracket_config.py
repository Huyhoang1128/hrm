from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from salary.salary_data_models import TaxBracketConfig, TaxBracket


DEFAULT_CONFIG_NAME = "Bảng thuế TNCN 2026 (5 bậc)"
DEFAULT_EFFECTIVE_FROM = date(2026, 1, 1)
DEFAULT_PERSONAL_DEDUCTION = Decimal("15500000")
DEFAULT_DEPENDENT_DEDUCTION = Decimal("6200000")

DEFAULT_BRACKETS = [
    {"order": 1, "min_income": Decimal("0"), "max_income": Decimal("10000000"), "rate": Decimal("0.05")},
    {"order": 2, "min_income": Decimal("10000000"), "max_income": Decimal("30000000"), "rate": Decimal("0.10")},
    {"order": 3, "min_income": Decimal("30000000"), "max_income": Decimal("60000000"), "rate": Decimal("0.20")},
    {"order": 4, "min_income": Decimal("60000000"), "max_income": Decimal("100000000"), "rate": Decimal("0.30")},
    {"order": 5, "min_income": Decimal("100000000"), "max_income": None, "rate": Decimal("0.35")},
]


class Command(BaseCommand):
    help = "Seed TaxBracketConfig + TaxBracket theo biểu thuế 5 bậc (áp dụng 2026)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--name",
            type=str,
            default=DEFAULT_CONFIG_NAME,
            help="Tên TaxBracketConfig (mặc định: Bảng thuế TNCN 2026 (5 bậc)).",
        )
        parser.add_argument(
            "--effective-from",
            type=str,
            default=str(DEFAULT_EFFECTIVE_FROM),
            help="Ngày hiệu lực dạng YYYY-MM-DD (mặc định: 2026-01-01).",
        )
        parser.add_argument(
            "--personal-deduction",
            type=str,
            default=str(DEFAULT_PERSONAL_DEDUCTION),
            help="Giảm trừ bản thân/tháng (mặc định: 15500000).",
        )
        parser.add_argument(
            "--dependent-deduction",
            type=str,
            default=str(DEFAULT_DEPENDENT_DEDUCTION),
            help="Giảm trừ mỗi người phụ thuộc/tháng (mặc định: 6200000).",
        )
        parser.add_argument(
            "--set-active",
            action="store_true",
            help="Đặt config vừa seed thành is_active=True.",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Nếu config đã tồn tại thì ghi đè personal/dependent deduction và toàn bộ bậc thuế.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        name = options["name"].strip()
        effective_from = date.fromisoformat(options["effective_from"])
        personal_deduction = Decimal(str(options["personal_deduction"]))
        dependent_deduction = Decimal(str(options["dependent_deduction"]))
        set_active = bool(options["set_active"])
        force = bool(options["force"])

        config, created = TaxBracketConfig.objects.get_or_create(
            name=name,
            effective_from=effective_from,
            defaults={
                "effective_to": None,
                "is_active": set_active,
                "personal_deduction": personal_deduction,
                "dependent_deduction": dependent_deduction,
            },
        )

        if created:
            TaxBracket.objects.bulk_create(
                [
                    TaxBracket(
                        config=config,
                        order=b["order"],
                        min_income=b["min_income"],
                        max_income=b["max_income"],
                        rate=b["rate"],
                    )
                    for b in DEFAULT_BRACKETS
                ]
            )
            self.stdout.write(self.style.SUCCESS(f"Đã tạo TaxBracketConfig mới: {config.name} ({config.effective_from})"))
            self.stdout.write(self.style.SUCCESS("Đã tạo 5 bậc thuế mặc định."))
        else:
            if force:
                config.personal_deduction = personal_deduction
                config.dependent_deduction = dependent_deduction
                if set_active:
                    config.is_active = True
                config.save()

                config.brackets.all().delete()
                TaxBracket.objects.bulk_create(
                    [
                        TaxBracket(
                            config=config,
                            order=b["order"],
                            min_income=b["min_income"],
                            max_income=b["max_income"],
                            rate=b["rate"],
                        )
                        for b in DEFAULT_BRACKETS
                    ]
                )
                self.stdout.write(self.style.WARNING(f"Config đã tồn tại, đã ghi đè theo --force: {config.name}"))
            else:
                if set_active and not config.is_active:
                    config.is_active = True
                    config.save(update_fields=["is_active", "updated_at"])
                    self.stdout.write(self.style.SUCCESS(f"Đã set active cho config: {config.name}"))
                self.stdout.write(
                    self.style.WARNING(
                        "Config đã tồn tại. Không thay đổi dữ liệu. Dùng --force để cập nhật lại deduction và bậc thuế."
                    )
                )

        self.stdout.write("\nCách chạy:")
        self.stdout.write("  python manage.py seed_tax_bracket_config --set-active")
        self.stdout.write("  python manage.py seed_tax_bracket_config --force --set-active")
