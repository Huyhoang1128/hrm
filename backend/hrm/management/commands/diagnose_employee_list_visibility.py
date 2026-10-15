from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from employee.models import Employee


class Command(BaseCommand):
    """
    Debug: user báo dropdown "Nhân viên nhận bàn giao" (trang Quản lý tài
    sản, gọi GET /api-hrm/employees/) không hiển thị đủ danh sách nhân viên
    đang hoạt động, KỂ CẢ khi đăng nhập bằng tài khoản admin. Lệnh READ-ONLY:
    mô phỏng lại CHÍNH XÁC logic phân quyền trong EmployeeViewSet.get_queryset()
    (hrm/views.py) cho 1 user cụ thể, để xác nhận:

      1. is_admin_or_hr có thực sự = True cho user này không (dựa vào
         User.is_staff/is_superuser HOẶC Employee.is_hr — KHÔNG phải "role"
         hiển thị trên UI).
      2. Nếu is_admin_or_hr = False và position.is_management = True -> họ
         bị giới hạn chỉ thấy cấp dưới trực tiếp (Employee.manager_id).
      3. Số lượng nhân viên active thực tế công ty có, so với page_size mà
         FE đang gọi (500) — nếu công ty có > 500 NV active, những NV có
         employee_id sắp xếp SAU vị trí 500 sẽ KHÔNG BAO GIỜ được fetch về
         (order_by('employee_id') ở EmployeeViewSet.queryset), nên tìm kiếm
         ở FE (chỉ lọc trong số đã fetch) không bao giờ ra kết quả — khác
         với giới hạn hiển thị 100/lần của SelectBox (đã fix ở FE, chỉ ảnh
         hưởng khi CHƯA gõ tìm kiếm).
      4. (Tuỳ chọn) truyền thêm mã NV thứ 2 -> kiểm tra is_active + thứ hạng
         của đúng NV đó trong danh sách sắp theo employee_id, xem có lọt
         trong 500 NV đầu tiên được fetch hay không.

    Usage:
      python manage.py diagnose_employee_list_visibility <username_hoặc_employee_id_người_xem>
      python manage.py diagnose_employee_list_visibility <username_người_xem> <employee_id_NV_bị_thiếu>
    """
    help = "Debug: xác nhận vì sao 1 tài khoản không thấy đủ danh sách nhân viên qua /api-hrm/employees/ (read-only)"

    def add_arguments(self, parser):
        parser.add_argument('identifier', type=str, help='username (đăng nhập) hoặc employee_id (mã NV) của người xem')
        parser.add_argument('target_employee_id', type=str, nargs='?', default=None,
                             help='(tuỳ chọn) mã NV cụ thể đang bị thiếu trong dropdown, để kiểm tra riêng')

    def handle(self, *args, **options):
        identifier = options['identifier']
        target_employee_id = options.get('target_employee_id')

        total_active = Employee.objects.filter(is_active=True).count()
        self.stdout.write(
            f"Tổng nhân viên đang hoạt động (is_active=True) trong toàn công ty: {total_active} "
            f"(FE đang fetch page_size=500 -> {'CÓ THỂ THIẾU, vượt 500' if total_active > 500 else 'đủ, không bị cắt bởi page_size'})"
        )

        if target_employee_id:
            self.stdout.write(f"\n=== Kiểm tra riêng NV bị thiếu: {target_employee_id} ===")
            target = Employee.objects.filter(employee_id=target_employee_id).first()
            if not target:
                self.stdout.write(self.style.ERROR(f"Không tìm thấy Employee nào có employee_id='{target_employee_id}'"))
            else:
                self.stdout.write(f"  full_name={target.full_name} | is_active={target.is_active}")
                if not target.is_active:
                    self.stdout.write(self.style.ERROR(
                        "  -> is_active=False -> BỊ LOẠI bởi filter is_active=True mặc định của "
                        "/api-hrm/employees/ list -> KHÔNG hiện trong dropdown (dù bạn nghĩ NV này "
                        "đang hoạt động, dữ liệu DB đang ghi is_active=False)."
                    ))
                else:
                    rank = Employee.objects.filter(
                        is_active=True, employee_id__lte=target.employee_id
                    ).count()
                    self.stdout.write(f"  Thứ hạng theo employee_id (trong số NV active): {rank}/{total_active}")
                    if rank > 500:
                        self.stdout.write(self.style.ERROR(
                            f"  -> Thứ hạng {rank} > 500 (page_size FE đang fetch) -> NV này KHÔNG "
                            f"NẰM TRONG dữ liệu được fetch về -> tìm kiếm ở FE (chỉ lọc trong số đã "
                            f"fetch, không gọi lại API) không bao giờ ra kết quả. ĐÂY LÀ NGUYÊN NHÂN."
                        ))
                    else:
                        self.stdout.write(self.style.SUCCESS(
                            f"  -> Thứ hạng {rank} <= 500 -> NV này PHẢI nằm trong dữ liệu fetch về, "
                            f"is_active=True hợp lệ -> không phải do is_active hay page_size. Nếu vẫn "
                            f"không thấy, khả năng cao do lỗi khác (cache trình duyệt cũ, hoặc lỗi FE)."
                        ))

        self.stdout.write(f"\n=== Kiểm tra người xem: {identifier} ===")
        user = User.objects.filter(username=identifier).first()
        employee = None
        if user:
            employee = Employee.objects.select_related('position', 'department').filter(user=user).first()
        else:
            employee = Employee.objects.select_related('user', 'position', 'department').filter(
                employee_id=identifier
            ).first()
            if employee:
                user = employee.user

        if not user and not employee:
            self.stdout.write(self.style.ERROR(
                f"Không tìm thấy User (username='{identifier}') hoặc Employee (employee_id='{identifier}')"
            ))
            return

        self.stdout.write(f"=== User: {user.username if user else '(không có)'} (id={user.id if user else '-'}) ===")
        if user:
            self.stdout.write(f"  is_staff={user.is_staff} | is_superuser={user.is_superuser}")
        else:
            self.stdout.write(self.style.WARNING(
                "  Employee này KHÔNG liên kết với User nào -> không đăng nhập được bằng employee_id này trực tiếp"
            ))

        if not employee:
            self.stdout.write(self.style.WARNING(
                "  User này KHÔNG có Employee record liên kết (request.user.employee không tồn tại)"
            ))
            self.stdout.write("\n=== Kết luận ===")
            self.stdout.write(
                "get_queryset(): request_employee = None -> khối giới hạn theo manager_id "
                "KHÔNG áp dụng (điều kiện 'request_employee and ...' False) -> KHÔNG bị giới hạn "
                "cấp dưới. Nếu vẫn thiếu NV trong dropdown thì KHÔNG phải do khối này."
            )
            return

        self.stdout.write(
            f"\n=== Employee: {employee.employee_id} - {employee.full_name} (id={employee.id}) ==="
        )
        self.stdout.write(f"  is_hr={employee.is_hr} | is_active={employee.is_active}")
        pos = employee.position
        self.stdout.write(
            f"  position={pos.title if pos else '(không có)'} | "
            f"position.is_management={pos.is_management if pos else '(N/A)'}"
        )

        # ── Y hệt logic is_admin_or_hr trong EmployeeViewSet.get_queryset() ──
        is_admin_or_hr = bool(user and (user.is_staff or user.is_superuser))
        if employee.is_hr:
            is_admin_or_hr = True

        self.stdout.write(f"\n=== is_admin_or_hr (logic thật trong get_queryset) = {is_admin_or_hr} ===")

        subordinate_count = Employee.objects.filter(is_active=True, manager_id=employee.id).count()

        if is_admin_or_hr:
            self.stdout.write(self.style.SUCCESS(
                f"-> Được coi là admin/HR thật -> KHÔNG bị giới hạn theo manager_id. "
                f"Dropdown phải thấy đủ {total_active} nhân viên đang hoạt động (trừ khi bị chặn "
                f"bởi nguyên nhân KHÁC, không phải khối is_admin_or_hr này)."
            ))
        elif pos and pos.is_management:
            self.stdout.write(self.style.ERROR(
                f"-> KHÔNG được coi là admin/HR (is_staff/is_superuser/Employee.is_hr đều False) "
                f"NHƯNG position.is_management=True -> BỊ GIỚI HẠN chỉ thấy nhân viên có "
                f"employee.manager_id = {employee.id} -> chỉ thấy {subordinate_count}/{total_active} "
                f"nhân viên đang hoạt động. ĐÂY LÀ NGUYÊN NHÂN nếu tài khoản này đang được dùng để "
                f"thao tác trang Quản lý tài sản."
            ))
        else:
            self.stdout.write(
                f"-> Không phải admin/HR, position không phải quản lý (is_management=False) "
                f"-> khối giới hạn theo manager_id không áp dụng (điều kiện position.is_management "
                f"False) -> KHÔNG bị giới hạn bởi khối này. Nếu vẫn thiếu NV, nguyên nhân nằm ở chỗ "
                f"khác (vd: is_active thật của DB, hoặc phân trang FE)."
            )
