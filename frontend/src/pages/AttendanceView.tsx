import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { SelectBox, SelectOption } from '../components/LandingLayout/SelectBox';
import { UserIcon, BuildingOfficeIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { Employee, employeesAPI, departmentsAPI } from '../utils/api';
import EmployeeMonthAttendance from '../components/EmployeeMonthAttendance';

interface Department {
  id: number;
  name: string;
  code: string;
}

// Trang này mimic lại đúng bộ KPI + lịch chấm công của tab "Bản thân"
// (AttendanceManagement.tsx) nhưng ở chế độ CHỈ XEM (không có nút tạo/duyệt
// đơn nào) cho MỘT nhân viên khác được chọn. Chọn theo 2 bước: Phòng ban
// trước, rồi Nhân viên trong phòng ban đó — backend tự giới hạn đúng phạm
// vi (chính mình/cấp dưới trực tiếp/admin-HR) ở mọi API bên dưới nên FE chỉ
// cần lo đúng luồng chọn, không cần tự kiểm tra quyền lần nữa.
//
// Phần "chọn nhân viên xong thì xem KPI/lịch/chi tiết ngày" đã tách ra
// EmployeeMonthAttendance (dùng chung với trang "Chốt công") — theo yêu
// cầu HCNS 2026-09-21 "đang có tình trạng lặp lại khá nhiều giữa chấm công
// tab nhân viên và chốt công" — trang này chỉ còn lo phần chọn nhân viên.
/** Đã nghỉ việc hay chưa — xét theo `end_date`, KHÔNG dùng
 *  `employment_status`/`is_active`. Hai cờ đó không được cập nhật khi nhân sự
 *  nghỉ: đo 2026-10-12 trên dữ liệu thật có 318 người đã nghỉ theo end_date mà
 *  150 người trong số đó vẫn mang employment_status='ACTIVE' và
 *  is_active=true. Lọc theo cờ là để lọt gần một nửa. */
const todayYMD = (() => {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

const hasResigned = (emp: Employee): boolean => {
  const end = (emp as any)?.end_date;
  return !!end && String(end).slice(0, 10) <= todayYMD;
};

/** dd/mm/yyyy từ chuỗi date-only. Cắt chuỗi thay vì new Date() vì JS hiểu
 *  '2026-07-07' là UTC rồi lùi 1 ngày ở múi giờ Việt Nam. */
const fmtDate = (v?: string): string => {
  if (!v) return '';
  const [y, m, d] = String(v).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : String(v);
};

const AttendanceView: React.FC = () => {
  const { user } = useAuth();
  const userRoleUpper = (user?.role || '').toUpperCase();
  const isAdminOrHR = userRoleUpper === 'ADMIN' || userRoleUpper === 'HR' || !!(user as any)?.is_super_admin;

  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  // Giữ nguyên bản ghi nhân viên (không map thẳng sang option) để còn lọc
  // theo ngày nghỉ việc bên dưới.
  const [employeeList, setEmployeeList] = useState<Employee[]>([]);
  // Mặc định ẨN người đã nghỉ (HCNS 2026-10-12). Dữ liệu thật: phòng
  // BS_DAT_TTTH_01 có 24/34 người đã nghỉ, toàn công ty 318 người — không ẩn
  // thì danh sách chọn gần như vô dụng.
  const [showResigned, setShowResigned] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<number | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  // 1. Biết chính mình (để xác định phòng ban của mình cho trường hợp không
  // phải Admin/HR — khoá cứng đúng 1 phòng ban đó, không cho chọn phòng khác).
  useEffect(() => {
    employeesAPI.me().then(setCurrentEmployee).catch(() => setCurrentEmployee(null));
  }, []);

  // 2. Danh sách phòng ban để chọn: Admin/HR thấy toàn bộ; người khác (Trưởng
  // phòng) chỉ thấy đúng 1 phòng ban của chính mình — mặc định chọn luôn,
  // không cho đổi.
  useEffect(() => {
    if (isAdminOrHR) {
      departmentsAPI.list({ page_size: 500 }).then((res) => {
        setDepartments(res.results || []);
      }).catch(() => setDepartments([]));
    } else if (currentEmployee?.department) {
      setDepartments([currentEmployee.department]);
      setSelectedDepartment(currentEmployee.department.id);
    }
  }, [isAdminOrHR, currentEmployee]);

  // 3. Chọn phòng ban xong mới tải danh sách nhân viên TRONG phòng ban đó —
  // backend tự giới hạn: Admin/HR thấy cả phòng, Trưởng phòng chỉ thấy đúng
  // cấp dưới trực tiếp của mình dù trong phòng ban đó có bao nhiêu người
  // (EmployeeViewSet.get_queryset), nên gọi chung 1 API là an toàn cho cả 2.
  // LƯU Ý: filter đó chỉ trả cấp dưới, KHÔNG bao gồm chính Trưởng phòng —
  // theo yêu cầu HCNS 2026-09-21 "chỉ xem được data ... của bản thân và
  // nhân viên thuộc mình", tự thêm currentEmployee vào danh sách cho NV
  // không phải Admin/HR để họ xem được cả công của chính mình ở đây.
  useEffect(() => {
    setSelectedEmployeeId(null);
    if (!selectedDepartment) {
      setEmployeeList([]);
      return;
    }
    setLoadingEmployees(true);
    employeesAPI.list({ department: selectedDepartment, page_size: 5000, ordering: 'full_name' })
      .then((res) => setEmployeeList(res.results || []))
      .catch(() => setEmployeeList([]))
      .finally(() => setLoadingEmployees(false));
  }, [selectedDepartment]);

  const employeeOptions = useMemo<SelectOption<number>[]>(() => {
    const visible = employeeList.filter(
      // Người đang được chọn thì LUÔN giữ trong danh sách, kể cả khi bỏ tick —
      // không thì ô chọn hoá rỗng và trang trông như hỏng.
      (emp) => showResigned || !hasResigned(emp) || emp.id === selectedEmployeeId,
    );
    const options = visible.map((emp) => ({
      value: emp.id,
      label: hasResigned(emp)
        ? `${emp.employee_id} - ${emp.full_name} (đã nghỉ ${fmtDate(emp.end_date)})`
        : `${emp.employee_id} - ${emp.full_name}`,
    }));
    if (!isAdminOrHR && currentEmployee && !options.some((o) => o.value === currentEmployee.id)) {
      options.unshift({
        value: currentEmployee.id,
        label: `${currentEmployee.employee_id} - ${currentEmployee.full_name} (Tôi)`,
      });
    }
    return options;
  }, [employeeList, showResigned, selectedEmployeeId, isAdminOrHR, currentEmployee]);

  const resignedCount = useMemo(
    () => employeeList.filter(hasResigned).length, [employeeList]);

  return (
    <div>
      {/* Bộ chọn: Phòng ban trước, rồi Nhân viên trong phòng ban đó */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="flex items-center text-xs font-semibold text-gray-500 mb-1">
              <BuildingOfficeIcon className="h-4 w-4 mr-1" />
              Phòng ban
            </label>
            {isAdminOrHR ? (
              <SelectBox<number | null>
                label=""
                value={selectedDepartment}
                options={departments.map((d) => ({ value: d.id, label: `${d.code} - ${d.name}` }))}
                onChange={setSelectedDepartment}
                placeholder="-- Chọn phòng ban --"
                searchable
                portal
                maxResults={500}
              />
            ) : (
              <div className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-sm text-gray-700">
                {currentEmployee?.department
                  ? `${currentEmployee.department.code} - ${currentEmployee.department.name}`
                  : 'Chưa xác định'}
              </div>
            )}
            {!isAdminOrHR && (
              <p className="text-[11px] text-gray-400 mt-1">Bạn chỉ xem được nhân viên trong phòng ban của mình.</p>
            )}
          </div>

          <div>
            <label className="flex items-center text-xs font-semibold text-gray-500 mb-1">
              <UserIcon className="h-4 w-4 mr-1" />
              Nhân viên
            </label>
            <SelectBox<number | null>
              label=""
              value={selectedEmployeeId}
              options={employeeOptions}
              onChange={setSelectedEmployeeId}
              placeholder={!selectedDepartment ? 'Chọn phòng ban trước' : loadingEmployees ? 'Đang tải...' : 'Tìm theo tên hoặc mã nhân viên...'}
              searchable
              portal
              maxResults={5000}
            />
            {selectedDepartment && !loadingEmployees && employeeOptions.length === 0 && (
              <p className="text-[11px] text-gray-400 mt-1">Không có nhân viên nào để hiển thị.</p>
            )}
            {selectedDepartment && !loadingEmployees && resignedCount > 0 && (
              <label className="mt-2 inline-flex items-center gap-2 text-[12px] text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showResigned}
                  onChange={(e) => setShowResigned(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                Hiện cả nhân viên đã nghỉ việc
                <span className="font-semibold text-gray-500">({resignedCount})</span>
              </label>
            )}
          </div>
        </div>
      </div>

      {!selectedEmployeeId ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
          <CalendarIcon className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-gray-900 mb-1">Chưa chọn nhân viên</h3>
          <p className="text-sm text-gray-500">Chọn phòng ban rồi chọn nhân viên để xem chấm công.</p>
        </div>
      ) : (
        <EmployeeMonthAttendance
          employeeId={selectedEmployeeId}
          year={year}
          month={month}
          onMonthChange={(y, m) => { setYear(y); setMonth(m); }}
          showKpiCards
        />
      )}
    </div>
  );
};

export default AttendanceView;
