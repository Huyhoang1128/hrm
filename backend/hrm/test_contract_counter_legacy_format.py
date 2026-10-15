"""Bug thực tế (2026-09-22): ContractCounter bị
đẩy số tiếp theo lên sai vì _max_number_in_db() quét MỌI EmployeeContract
khớp company_unit + contract_type + năm, không phân biệt định dạng số HĐ —
1 hợp đồng ABC cũ dùng format "NNNN/YEAR/XX-HĐLĐ" (trước khi đổi sang
"NNNN/YEAR/HĐLĐ-ABC") có số 403 khiến counter nhảy từ 48 lên 404+ dù
chuỗi HĐ đúng format hiện tại chỉ mới đến 48.

Fix: next_number()/peek_next()/_max_number_in_db() nhận thêm `expected_suffix`
— chỉ tính những contract_number kết thúc đúng bằng suffix hiện tại (vd
"HĐLĐ-ABC"), bỏ qua bản ghi format cũ dù khớp company_unit/type/năm.
"""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from employee.models import CompanyUnit, Employee, Department, Position
from hrm.models import ContractCounter, EmployeeContract


class ContractCounterLegacyFormatTests(TestCase):
    def setUp(self):
        self.company_unit = CompanyUnit.objects.create(name="ABC", code="ABC")
        self.dept = Department.objects.create(name="HCNS", code="HCNS-T")
        self.position = Position.objects.create(title="NV", code="NV-T")
        self.user = User.objects.create_user(username="tester")
        self.employees = [
            Employee.objects.create(
                user=User.objects.create_user(username=f"nv{i}"),
                employee_id=f"E{i:03d}", full_name=f"Nhan vien {i}",
                department=self.dept, position=self.position,
            )
            for i in range(3)
        ]

    def _make_contract(self, employee, contract_number, contract_type="ONE_YEAR"):
        return EmployeeContract.objects.create(
            employee=employee,
            company_unit=self.company_unit,
            contract_type=contract_type,
            contract_number=contract_number,
            created_by=self.user,
        )

    def test_legacy_format_contract_does_not_inflate_next_number(self):
        # Chuỗi HĐ hiện tại: đến 0048.
        self._make_contract(self.employees[0], "0048/2026/HĐLĐ-ABC")
        # Hợp đồng cũ format khác (trước đổi quy ước) — cùng company_unit,
        # cùng contract_type, cùng năm nhưng KHÔNG cùng suffix.
        self._make_contract(self.employees[1], "0403/2026/XX-HĐLĐ")

        next_n = ContractCounter.peek_next(
            "LABOR", self.company_unit, 2026, expected_suffix="HĐLĐ-ABC"
        )
        self.assertEqual(next_n, 49)

    def test_without_expected_suffix_keeps_old_buggy_behavior(self):
        """Chốt lại hành vi CŨ khi không truyền expected_suffix (backward compat
        cho call site nào chưa cập nhật) — vẫn bị legacy record làm lệch,
        đúng như bug gốc đã xác nhận trên production."""
        self._make_contract(self.employees[0], "0048/2026/HĐLĐ-ABC")
        self._make_contract(self.employees[1], "0403/2026/XX-HĐLĐ")

        next_n = ContractCounter.peek_next("LABOR", self.company_unit, 2026)
        self.assertEqual(next_n, 404)

    def test_next_number_increments_counter_with_suffix_filter(self):
        self._make_contract(self.employees[0], "0048/2026/HĐLĐ-ABC")
        self._make_contract(self.employees[1], "0403/2026/XX-HĐLĐ")

        n = ContractCounter.next_number(
            "LABOR", self.company_unit, 2026, expected_suffix="HĐLĐ-ABC"
        )
        self.assertEqual(n, 49)
        counter = ContractCounter.objects.get(group="LABOR", company_unit=self.company_unit, year=2026)
        self.assertEqual(counter.last_number, 49)

    def test_stale_counter_does_not_inflate_next_number(self):
        """Bug ABC 2026-10-13: số HĐLĐ đang đến 0051 nhưng hệ thống cấp 0404.
        Counter bị kẹt ở 403 (destroy() cũ reset theo max gồm cả HĐ format cũ
        "0403/2026/XX-HĐLĐ") — có suffix thì số trên hợp đồng là nguồn sự thật,
        counter kẹt cao không được kéo số lên."""
        self._make_contract(self.employees[0], "0050/2026/HĐLĐ-ABC")
        self._make_contract(self.employees[1], "0403/2026/XX-HĐLĐ")
        ContractCounter.objects.create(
            group="LABOR", company_unit=self.company_unit, year=2026, last_number=403,
        )
        self.assertEqual(
            ContractCounter.peek_next("LABOR", self.company_unit, 2026, expected_suffix="HĐLĐ-ABC"),
            51,
        )
        n = ContractCounter.next_number("LABOR", self.company_unit, 2026, expected_suffix="HĐLĐ-ABC")
        self.assertEqual(n, 51)
        counter = ContractCounter.objects.get(group="LABOR", company_unit=self.company_unit, year=2026)
        self.assertEqual(counter.last_number, 51)

    def test_hr_manual_fix_downward_is_followed(self):
        """Hệ thống lỡ cấp 0404, HR sửa tay về 0051 → HĐ kế tiếp phải là 0052,
        không phải 0405 (counter vẫn đang 404)."""
        self._make_contract(self.employees[0], "0050/2026/HĐLĐ-ABC")
        ContractCounter.objects.create(
            group="LABOR", company_unit=self.company_unit, year=2026, last_number=403,
        )
        n = ContractCounter.next_number("LABOR", self.company_unit, 2026, expected_suffix="HĐLĐ-ABC")
        self.assertEqual(n, 51)
        wrong = self._make_contract(self.employees[1], "0404/2026/HĐLĐ-ABC")
        wrong.contract_number = "0051/2026/HĐLĐ-ABC"
        wrong.save()

        n = ContractCounter.next_number("LABOR", self.company_unit, 2026, expected_suffix="HĐLĐ-ABC")
        self.assertEqual(n, 52)

    def test_hand_typed_number_with_stray_whitespace_counts(self):
        """Số HR gõ tay thừa dấu cách / khác hoa thường vẫn thuộc cùng chuỗi."""
        self._make_contract(self.employees[0], "0050/2026/HĐLĐ-ABC")
        self._make_contract(self.employees[1], "0051/2026/HĐLĐ-ABC ")
        self.assertEqual(
            ContractCounter.peek_next("LABOR", self.company_unit, 2026, expected_suffix="HĐLĐ-ABC"),
            52,
        )

    def test_destroy_resets_counter_ignoring_legacy_format(self):
        """Xoá 1 HĐ: counter reset về số lớn nhất CÙNG chuỗi hiện tại, không bị HĐ
        "0403/2026/XX-HĐLĐ" kéo lên 403 như trước."""
        admin = User.objects.create_superuser(username="hr-admin", password="x")
        self._make_contract(self.employees[0], "0050/2026/HĐLĐ-ABC")
        self._make_contract(self.employees[1], "0403/2026/XX-HĐLĐ")
        to_delete = self._make_contract(self.employees[2], "0051/2026/HĐLĐ-ABC")
        ContractCounter.objects.create(
            group="LABOR", company_unit=self.company_unit, year=2026, last_number=51,
        )
        client = APIClient()
        client.force_authenticate(admin)
        resp = client.delete(f"/api-hrm/employee-contracts/{to_delete.pk}/")
        self.assertEqual(resp.status_code, 204, getattr(resp, "data", resp.content))

        counter = ContractCounter.objects.get(group="LABOR", company_unit=self.company_unit, year=2026)
        self.assertEqual(counter.last_number, 50)
        self.assertEqual(
            ContractCounter.peek_next("LABOR", self.company_unit, 2026, expected_suffix="HĐLĐ-ABC"),
            51,
        )

    def test_legacy_call_without_suffix_still_respects_counter(self):
        """Lời gọi không truyền suffix (legacy) giữ hành vi cũ max(counter, DB)."""
        self._make_contract(self.employees[0], "0099/2026/HĐLĐ-ABC")
        ContractCounter.objects.create(
            group="LABOR", company_unit=self.company_unit, year=2026, last_number=101,
        )
        self.assertEqual(ContractCounter.peek_next("LABOR", self.company_unit, 2026), 102)
