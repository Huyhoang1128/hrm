"""
hrm/test_department_section_soft_delete.py
════════════════════════════════════════════
Bug thực tế: HR báo bị mất một số "Bộ phận" ở trang Quản lý bộ phận, không rõ ai xoá.
Nguyên nhân: SectionViewSet/DepartmentViewSet (hrm/views.py) dùng chung model
Department (employee/models.py, phân biệt qua is_section) và là ModelViewSet chuẩn —
nút "Xoá" gọi thẳng .delete() (xoá cứng), KHÔNG lưu lại ai xoá/lúc nào, và còn âm
thầm gỡ Employee.department (on_delete=SET_NULL) của mọi NV thuộc phòng/bộ phận đó.

Fix: thêm is_deleted/deleted_at/deleted_by trên Department, override perform_destroy
ở cả 2 ViewSet để soft-delete thay vì xoá cứng — có audit trail (ai xoá, lúc nào) và
dữ liệu vẫn khôi phục được qua Django Admin (bỏ tick is_deleted).

Không cần DB thật: mock Instance.save() để xác nhận đúng field nào được set, không
thực sự UPDATE — SimpleTestCase, không chạm DB.
"""
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from hrm.views import DepartmentViewSet, SectionViewSet


def _fake_request(employee=None):
    request = MagicMock()
    request.user = MagicMock()
    request.user.employee = employee
    return request


class DepartmentSoftDeleteTests(SimpleTestCase):
    def test_department_viewset_perform_destroy_soft_deletes_with_actor(self):
        """Xoá 1 phòng ban -> instance KHÔNG bị .delete() thật, chỉ đánh dấu
        is_deleted=True + ghi đúng người xoá (employee của request.user)."""
        view = DepartmentViewSet()
        fake_employee = MagicMock(name="acting_employee")
        view.request = _fake_request(employee=fake_employee)

        instance = MagicMock()
        instance.delete = MagicMock(side_effect=AssertionError("KHÔNG được gọi .delete() — phải soft-delete"))

        view.perform_destroy(instance)

        instance.delete.assert_not_called()
        self.assertTrue(instance.is_deleted)
        self.assertIsNotNone(instance.deleted_at)
        self.assertIs(instance.deleted_by, fake_employee)
        instance.save.assert_called_once_with(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])

    def test_section_viewset_perform_destroy_soft_deletes_with_actor(self):
        """Y hệt DepartmentViewSet — SectionViewSet dùng chung model/hành vi xoá."""
        view = SectionViewSet()
        fake_employee = MagicMock(name="acting_employee")
        view.request = _fake_request(employee=fake_employee)

        instance = MagicMock()
        instance.delete = MagicMock(side_effect=AssertionError("KHÔNG được gọi .delete() — phải soft-delete"))

        view.perform_destroy(instance)

        instance.delete.assert_not_called()
        self.assertTrue(instance.is_deleted)
        self.assertIsNotNone(instance.deleted_at)
        self.assertIs(instance.deleted_by, fake_employee)
        instance.save.assert_called_once_with(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])

    def test_perform_destroy_handles_missing_employee_profile_gracefully(self):
        """User không có hồ sơ Employee (vd. superuser thuần) -> deleted_by=None,
        không crash — khớp pattern getattr(..., 'employee', None) đã dùng nơi khác
        (AssetViewSet.perform_create)."""
        view = DepartmentViewSet()
        request = MagicMock()
        request.user = MagicMock(spec=[])  # không có attribute 'employee'
        view.request = request

        instance = MagicMock()
        view.perform_destroy(instance)

        self.assertTrue(instance.is_deleted)
        self.assertIsNone(instance.deleted_by)

    def test_department_queryset_excludes_soft_deleted(self):
        """Queryset mặc định của cả 2 ViewSet phải lọc is_deleted=False — nếu quên
        filter này, bản ghi soft-delete vẫn hiện trong danh sách như chưa từng xoá."""
        dept_query = str(DepartmentViewSet.queryset.query)
        section_query = str(SectionViewSet.queryset.query)
        self.assertIn('is_deleted', dept_query)
        self.assertIn('is_deleted', section_query)
