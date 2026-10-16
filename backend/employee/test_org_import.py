import io

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from openpyxl import Workbook
from rest_framework.test import APIClient

from employee.models import Department, Employee, Position


def _xlsx(headers, rows, name='data.xlsx'):
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return SimpleUploadedFile(name, buf.getvalue(),
                              content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


class OrgImportTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser('org-admin', 'a@example.com', 'x')
        self.manager = Employee.objects.create(
            user=User.objects.create_user('org-mgr'), employee_id='NV93001', full_name='Trưởng phòng')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _import(self, kind, upload):
        return self.client.post(f'/api-hrm/{kind}/import/', {'file': upload}, format='multipart')

    def test_departments_created_then_updated(self):
        res = self._import('departments', _xlsx(
            ['Mã phòng ban', 'Tên phòng ban', 'Mã phòng ban cha', 'Mã trưởng phòng'],
            [['KD', 'Kinh doanh', None, 'NV93001'], ['KD1', 'Kinh doanh 1', 'KD', None]]))
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['summary']['created'], 2)
        kd1 = Department.objects.get(code='KD1')
        self.assertEqual(kd1.parent_department.code, 'KD')
        self.assertEqual(Department.objects.get(code='KD').manager, self.manager)

        res = self._import('departments', _xlsx(['Mã phòng ban', 'Tên phòng ban'], [['KD1', 'Kinh doanh miền Bắc']]))
        self.assertEqual(res.data['summary']['updated'], 1)
        kd1.refresh_from_db()
        self.assertEqual(kd1.name, 'Kinh doanh miền Bắc')
        self.assertEqual(kd1.parent_department.code, 'KD')  # để trống thì giữ nguyên

    def test_reimporting_soft_deleted_department_restores_it(self):
        Department.objects.create(code='OLD', name='Cũ', is_deleted=True)
        res = self._import('departments', _xlsx(['Mã phòng ban', 'Tên phòng ban'], [['OLD', 'Mở lại']]))
        self.assertEqual(res.data['summary']['updated'], 1)
        dept = Department.objects.get(code='OLD')
        self.assertFalse(dept.is_deleted)
        self.assertTrue(any('khôi phục' in w for e in res.data['errors'] for w in e.get('warnings', [])))

    def test_positions_link_only_active_departments(self):
        Department.objects.create(code='A', name='A')
        Department.objects.create(code='GONE', name='Đã xoá', is_deleted=True)
        res = self._import('positions', _xlsx(
            ['Mã vị trí', 'Chức danh', 'Mã phòng ban', 'Cấp bậc', 'Vị trí quản lý'],
            [['TP', 'Trưởng phòng', 'A, GONE', 3, 'Có']]))
        self.assertIn(res.status_code, (200, 207), res.data)
        pos = Position.objects.get(code='TP')
        self.assertEqual(sorted(pos.department.values_list('code', flat=True)), ['A'])
        self.assertEqual(pos.level, 3)

    def test_template_headers_with_hints_are_recognised(self):
        """Tiêu đề trong file mẫu FE có chú thích trong ngoặc."""
        Department.objects.create(code='P', name='P')
        res = self._import('departments', _xlsx(
            ['Mã phòng ban', 'Tên phòng ban', 'Phòng ban cha (mã)', 'Trưởng phòng (mã NV)', 'Mô tả'],
            [['C', 'Con', 'P', 'NV93001', '']]))
        self.assertEqual(res.status_code, 200, res.data)
        child = Department.objects.get(code='C')
        self.assertEqual(child.parent_department.code, 'P')
        self.assertEqual(child.manager, self.manager)
        res = self._import('positions', _xlsx(
            ['Mã vị trí', 'Chức danh', 'Phòng ban (mã, cách nhau bởi dấu phẩy)', 'Cấp bậc',
             'Vị trí quản lý (x = có)', 'Vị trí cấp trên (mã)', 'Mô tả'],
            [['GD', 'Giám đốc', 'P', 5, 'x', None, ''], ['PGD', 'Phó giám đốc', 'P', 4, None, 'GD', '']]))
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(Position.objects.get(code='GD').is_management)
        self.assertEqual(Position.objects.get(code='PGD').parent_position.code, 'GD')

    def test_missing_required_columns(self):
        res = self._import('departments', _xlsx(['Tên phòng ban'], [['X']]))
        self.assertEqual(res.status_code, 400)

    def test_staff_cannot_import(self):
        self.client.force_authenticate(self.manager.user)
        res = self._import('departments', _xlsx(['Mã phòng ban', 'Tên phòng ban'], [['X', 'X']]))
        self.assertEqual(res.status_code, 403)
