"""
hrm/management/commands/diagnose_manager_scope.py
══════════════════════════════════════════════════
Chẩn đoán vì sao 1 trưởng phòng (position.is_management=True) không thấy
được nhân sự thuộc quyền ở trang "Quản lý nhân viên" / "Chốt công".

Logic scoping hiện tại (EmployeeViewSet.get_queryset, WorkFinalizationListView)
chỉ cho xem nhân viên đang có mình là "quản lý trực tiếp" (Employee.manager),
chỉ tính cấp dưới TRỰC TIẾP, không đệ quy xuống cấp dưới của cấp dưới.

LỊCH SỬ: bản đầu tiên của tính năng này lọc theo Department.manager
("Trưởng phòng ban"), nhưng dữ liệu thực tế cho thấy Department.manager
hầu như không được gán — cấu trúc báo cáo thật nằm ở Employee.manager, nên
đã đổi sang dùng field này (xem comment ở EmployeeViewSet.get_queryset).

Nếu 1 nhân viên có position.is_management=True nhưng KHÔNG có nhân viên
nào đang chọn họ làm "quản lý trực tiếp", họ sẽ luôn thấy danh sách RỖNG
(đúng như thiết kế an toàn — không lộ dữ liệu người khác) — CHỨ KHÔNG
PHẢI bug ở code lọc.

CHỈ ĐỌC, KHÔNG sửa bất kỳ dữ liệu nào.

Cách dùng:
  python manage.py diagnose_manager_scope
  python manage.py diagnose_manager_scope --employee-code=NV02974
"""

from django.core.management.base import BaseCommand

from employee.models import Employee


class Command(BaseCommand):
    help = (
        'Chẩn đoán (chỉ đọc) vì sao trưởng phòng không thấy được nhân sự thuộc '
        'quyền ở trang Quản lý nhân viên / Chốt công.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--employee-code', type=str, default=None,
            help='Kiểm tra riêng 1 mã NV cụ thể, VD: NV02974',
        )

    def handle(self, *args, **options):
        employee_code = options['employee_code']

        if employee_code:
            self._diagnose_one(employee_code)
        else:
            self._diagnose_all()

    # ------------------------------------------------------------------
    def _diagnose_one(self, employee_code):
        try:
            emp = Employee.objects.select_related('position', 'department').get(employee_id=employee_code)
        except Employee.DoesNotExist:
            self.stdout.write(self.style.ERROR(f'Không tìm thấy nhân viên với mã "{employee_code}".'))
            return

        self.stdout.write(f'NV: {emp.employee_id} — {emp.full_name}')
        self.stdout.write(f'  is_hr: {emp.is_hr}')
        self.stdout.write(f'  Chức vụ: {emp.position.title if emp.position else "(chưa gán)"}')
        self.stdout.write(f'  Chức vụ.is_management: {emp.position.is_management if emp.position else None}')
        self.stdout.write(f'  Phòng ban của bản thân: {emp.department.name if emp.department else "(chưa gán)"}')

        if emp.position and not emp.position.is_management:
            self.stdout.write(self.style.WARNING(
                '  -> Chức vụ của NV này KHÔNG đánh dấu is_management=True -> KHÔNG được '
                'coi là trưởng phòng ở trang Quản lý nhân viên/Chốt công, bất kể có cấp '
                'dưới hay không.'
            ))
            return

        direct_reports = list(Employee.objects.filter(manager=emp).select_related('department'))
        if direct_reports:
            depts = sorted({e.department.name for e in direct_reports if e.department})
            self.stdout.write(self.style.SUCCESS(
                f'  -> Đang là "quản lý trực tiếp" của {len(direct_reports)} nhân viên '
                f'(thuộc phòng ban: {", ".join(depts) if depts else "(chưa gán phòng ban)"}) '
                f'-> sẽ thấy đúng {len(direct_reports)} NV này ở trang Quản lý nhân viên/Chốt công.'
            ))
        else:
            self.stdout.write(self.style.WARNING(
                '  -> KHÔNG có nhân viên nào đang chọn NV này làm "quản lý trực tiếp" '
                '-> đây là lý do trang Quản lý nhân viên/Chốt công hiện DANH SÁCH RỖNG '
                'cho tài khoản này (không phải lỗi code — cần vào hồ sơ nhân viên cấp '
                'dưới, đặt "Quản lý trực tiếp" = nhân viên này).'
            ))

    # ------------------------------------------------------------------
    def _diagnose_all(self):
        managers_by_position = Employee.objects.filter(
            position__is_management=True, is_active=True
        ).select_related('position', 'department')
        total_managers = managers_by_position.count()

        manager_ids_with_reports = set(
            Employee.objects.exclude(manager__isnull=True).values_list('manager_id', flat=True)
        )

        orphans = [e for e in managers_by_position if e.id not in manager_ids_with_reports]

        self.stdout.write(f'Tổng số NV đang active có chức danh quản lý (position.is_management=True): {total_managers}')
        self.stdout.write(self.style.WARNING(
            f'  -> Trong đó, {len(orphans)} NV KHÔNG có ai chọn họ làm "quản lý trực tiếp" '
            f'-> các NV này sẽ thấy danh sách RỖNG ở trang Quản lý nhân viên/Chốt công:'
        ))
        for e in orphans[:50]:
            dept_name = e.department.name if e.department else '(chưa gán phòng ban)'
            self.stdout.write(f'    - {e.employee_id} — {e.full_name} (phòng ban bản thân: {dept_name})')
        if len(orphans) > 50:
            self.stdout.write(f'    ... và {len(orphans) - 50} NV khác.')

        if not orphans:
            self.stdout.write(self.style.SUCCESS('  Không có NV nào bị rơi vào tình huống này.'))
