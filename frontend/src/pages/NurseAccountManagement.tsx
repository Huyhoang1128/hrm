import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PlusIcon,
  XMarkIcon,
  ShieldCheckIcon,
  UserGroupIcon,
  MagnifyingGlassIcon,
  LinkIcon,
} from '@heroicons/react/24/outline';
import { employeesAPI, type Employee } from '../utils/api';
import { SelectBox, type SelectOption } from '../components/LandingLayout/SelectBox';
import {
  nurseAccountAPI,
  doctorAppAPI,
  type NurseAccountListItem,
  type DoctorInfo,
} from '../utils/api/nurseAppClient';

const NURSE_STATUS_LABELS: Record<string, string> = {
  active: 'Đang làm việc',
  inactive: 'Ngừng làm việc',
  on_leave: 'Đang nghỉ phép',
  vacation: 'Nghỉ dưỡng',
};

const getApiError = (error: any) => {
  const data = error?.response?.data;
  if (!data) return 'Có lỗi xảy ra. Vui lòng thử lại.';
  if (typeof data === 'string') return data;
  const first = Object.values(data)[0];
  return Array.isArray(first) ? String(first[0]) : String(first || data.detail || 'Dữ liệu không hợp lệ.');
};

const nurseFullName = (n: NurseAccountListItem) =>
  `${n.user.last_name} ${n.user.first_name}`.trim() || n.user.username;

const doctorFullName = (d: NurseAccountListItem['assigned_doctor']) =>
  d ? `${d.user.last_name} ${d.user.first_name}`.trim() || d.user.username : null;

export default function NurseAccountManagement() {
  const [allNurses, setAllNurses] = useState<NurseAccountListItem[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [toggleLoadingId, setToggleLoadingId] = useState<number | null>(null);
  const [resetLoadingId, setResetLoadingId] = useState<number | null>(null);
  const [resetPasswordResult, setResetPasswordResult] = useState<{ name: string; password: string } | null>(null);

  const [doctors, setDoctors] = useState<DoctorInfo[]>([]);
  const doctorOptions = useMemo<SelectOption<string>[]>(
    () =>
      doctors.map((d) => {
        const name = `${d.user.last_name} ${d.user.first_name}`.trim() || d.user.username;
        const label = d.specialization_display ? `${name} (${d.specialization_display})` : name;
        return { value: String(d.id), label };
      }),
    [doctors]
  );

  const employeeMap = useMemo(() => {
    const map: Record<string, Employee> = {};
    employees.forEach((e) => { map[e.employee_id] = e; });
    return map;
  }, [employees]);

  const nurses = useMemo(() => allNurses.filter((n) => !!n.hrm_employee_id), [allNurses]);

  const linkedEmployeeIds = useMemo(
    () => new Set(nurses.map((n) => n.hrm_employee_id).filter(Boolean) as string[]),
    [nurses]
  );

  const employeeOptions = useMemo<SelectOption<number>[]>(
    () =>
      employees
        .filter((e) => e.employment_status === 'ACTIVE' && !linkedEmployeeIds.has(e.employee_id))
        .map((e) => ({ value: e.id, label: `${e.full_name} (${e.employee_id})` })),
    [employees, linkedEmployeeIds]
  );

  // ── Modal thêm tài khoản ──
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [createForm, setCreateForm] = useState({ username: '' });
  const [createDoctorId, setCreateDoctorId] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  // ── Modal sửa tài khoản ──
  const [editing, setEditing] = useState<NurseAccountListItem | null>(null);
  const [editForm, setEditForm] = useState({ username: '' });
  const [editEmployeeId, setEditEmployeeId] = useState<number | null>(null);
  const [editDoctorId, setEditDoctorId] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  // Chọn nhân viên khi sửa: cho phép giữ nguyên nhân viên đang liên kết, hoặc đổi sang
  // nhân viên ACTIVE khác chưa liên kết tài khoản nào (loại trừ chính tài khoản đang sửa).
  const editEmployeeOptions = useMemo<SelectOption<number>[]>(
    () =>
      employees
        .filter(
          (e) =>
            e.employment_status === 'ACTIVE' &&
            (!linkedEmployeeIds.has(e.employee_id) || e.employee_id === editing?.hrm_employee_id)
        )
        .map((e) => ({ value: e.id, label: `${e.full_name} (${e.employee_id})` })),
    [employees, linkedEmployeeIds, editing]
  );

  // ── Modal ghép nối tài khoản có sẵn ──
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [matchUsername, setMatchUsername] = useState('');
  const [matchEmployeeId, setMatchEmployeeId] = useState<number | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [nurseRes, employeeRes] = await Promise.all([
        nurseAccountAPI.list(),
        employeesAPI.list({ page_size: 1000, ordering: 'full_name' } as any),
      ]);
      setAllNurses(nurseRes.data);
      setEmployees(employeeRes.results);
    } catch (err) {
      setError(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const loadDoctors = async () => {
    if (doctors.length > 0) return;
    try {
      const res = await doctorAppAPI.listAvailable();
      setDoctors(Array.isArray(res.data) ? res.data : []);
    } catch {
      // ignore — dropdown sẽ trống
    }
  };

  const filteredNurses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return nurses;
    return nurses.filter((n) => {
      const employee = n.hrm_employee_id ? employeeMap[n.hrm_employee_id] : undefined;
      return (
        nurseFullName(n).toLowerCase().includes(q) ||
        n.user.username.toLowerCase().includes(q) ||
        (employee?.full_name || '').toLowerCase().includes(q) ||
        (n.hrm_employee_id || '').toLowerCase().includes(q)
      );
    });
  }, [nurses, employeeMap, search]);

  const openCreateModal = () => {
    setSelectedEmployeeId(null);
    setCreateForm({ username: '' });
    setCreateDoctorId(null);
    setCreateError(null);
    setShowCreateModal(true);
    loadDoctors();
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setCreateError(null);
  };

  const handleCreate = async () => {
    const employee = employees.find((e) => e.id === selectedEmployeeId);
    if (!employee) {
      setCreateError('Vui lòng chọn nhân viên');
      return;
    }
    if (!createForm.username.trim()) {
      setCreateError('Tên đăng nhập không được để trống');
      return;
    }
    setCreateError(null);
    setCreateLoading(true);
    try {
      const createPayload: Parameters<typeof nurseAccountAPI.create>[0] = {
        username: createForm.username.trim(),
        hrm_employee_id: employee.employee_id,
        first_name: employee.full_name?.split(' ').pop() ?? '',
        last_name: employee.full_name?.split(' ').slice(0, -1).join(' ') ?? '',
        assigned_doctor_id: createDoctorId,
      };
      if (employee.personal_email) createPayload.email = employee.personal_email;
      if (employee.phone_number) createPayload.phone_number = employee.phone_number;
      const res = await nurseAccountAPI.create(createPayload);
      // Đồng bộ username về backend
      await employeesAPI.partialUpdate(employee.id, { nurse_app_username: createForm.username.trim() } as any);
      closeCreateModal();
      setCreatedPassword(res.data?.generated_password ?? null);
      await loadData();
    } catch (err: any) {
      setCreateError(getApiError(err));
    } finally {
      setCreateLoading(false);
    }
  };

  const openEditModal = (nurse: NurseAccountListItem) => {
    setEditing(nurse);
    setEditForm({ username: nurse.user.username });
    const linkedEmployee = nurse.hrm_employee_id
      ? employees.find((e) => e.employee_id === nurse.hrm_employee_id)
      : undefined;
    setEditEmployeeId(linkedEmployee?.id ?? null);
    setEditDoctorId(nurse.assigned_doctor?.id ?? null);
    setEditError(null);
    loadDoctors();
  };

  const handleEdit = async () => {
    if (!editing) return;
    if (!editForm.username.trim()) {
      setEditError('Tên đăng nhập không được để trống');
      return;
    }
    const newEmployee = employees.find((e) => e.id === editEmployeeId);
    if (!newEmployee) {
      setEditError('Vui lòng chọn nhân viên');
      return;
    }
    setEditError(null);
    setEditLoading(true);
    try {
      const oldEmployee = editing.hrm_employee_id ? employeeMap[editing.hrm_employee_id] : undefined;
      const employeeChanged = oldEmployee?.employee_id !== newEmployee.employee_id;
      const editPayload: Parameters<typeof nurseAccountAPI.update>[1] = {
        username: editForm.username.trim(),
        assigned_doctor_id: editDoctorId,
        hrm_employee_id: newEmployee.employee_id,
      };
      if (newEmployee.personal_email) editPayload.email = newEmployee.personal_email;
      if (newEmployee.phone_number) editPayload.phone_number = newEmployee.phone_number;
      if (employeeChanged) {
        editPayload.first_name = newEmployee.full_name?.split(' ').pop() ?? '';
        editPayload.last_name = newEmployee.full_name?.split(' ').slice(0, -1).join(' ') ?? '';
      }
      await nurseAccountAPI.update(editing.id, editPayload);
      // Đồng bộ username về backend: gỡ khỏi nhân viên cũ (nếu đổi nhân viên), gán cho nhân viên mới
      if (employeeChanged && oldEmployee) {
        await employeesAPI.partialUpdate(oldEmployee.id, { nurse_app_username: '' } as any);
      }
      await employeesAPI.partialUpdate(newEmployee.id, { nurse_app_username: editForm.username.trim() } as any);
      setEditing(null);
      await loadData();
    } catch (err: any) {
      setEditError(getApiError(err));
    } finally {
      setEditLoading(false);
    }
  };

  const handleToggle = async (nurse: NurseAccountListItem) => {
    setToggleLoadingId(nurse.id);
    try {
      if (nurse.is_active) await nurseAccountAPI.deactivate(nurse.id);
      else await nurseAccountAPI.activate(nurse.id);
      await loadData();
    } catch (err) {
      setError(getApiError(err));
    } finally {
      setToggleLoadingId(null);
    }
  };

  const handleResetPassword = async (nurse: NurseAccountListItem) => {
    const employee = nurse.hrm_employee_id ? employeeMap[nurse.hrm_employee_id] : undefined;
    const name = employee?.full_name || nurseFullName(nurse);
    if (!window.confirm(`Reset mật khẩu tài khoản "${nurse.user.username}" (${name})? Mật khẩu cũ sẽ không còn dùng được.`)) {
      return;
    }
    setResetLoadingId(nurse.id);
    try {
      const res = await nurseAccountAPI.resetPassword(nurse.id);
      setResetPasswordResult({ name, password: res.data.data.new_password });
    } catch (err) {
      setError(getApiError(err));
    } finally {
      setResetLoadingId(null);
    }
  };

  const openMatchModal = () => {
    setMatchUsername('');
    setMatchEmployeeId(null);
    setMatchError(null);
    setShowMatchModal(true);
  };

  const closeMatchModal = () => {
    setShowMatchModal(false);
    setMatchError(null);
  };

  const handleMatch = async () => {
    const usernameInput = matchUsername.trim();
    if (!usernameInput) {
      setMatchError('Vui lòng nhập tên đăng nhập tài khoản');
      return;
    }
    const employee = employees.find((e) => e.id === matchEmployeeId);
    if (!employee) {
      setMatchError('Vui lòng chọn nhân viên');
      return;
    }
    setMatchError(null);
    setMatchLoading(true);
    try {
      // Tra cứu username mới nhất từ server (tránh dữ liệu cũ trên client)
      const res = await nurseAccountAPI.list();
      const nurse = res.data.find(
        (n) => n.user.username.toLowerCase() === usernameInput.toLowerCase()
      );
      if (!nurse) {
        setMatchError(`Không tìm thấy tài khoản với tên đăng nhập "${usernameInput}"`);
        return;
      }
      if (nurse.hrm_employee_id) {
        const linkedEmployee = employeeMap[nurse.hrm_employee_id];
        setMatchError(
          `Tài khoản "${usernameInput}" đã được ghép nối với nhân viên ${
            linkedEmployee?.full_name || nurse.hrm_employee_id
          } (${nurse.hrm_employee_id})`
        );
        return;
      }
      await nurseAccountAPI.update(nurse.id, { hrm_employee_id: employee.employee_id });
      // Đồng bộ username về backend
      await employeesAPI.partialUpdate(employee.id, { nurse_app_username: nurse.user.username } as any);
      closeMatchModal();
      await loadData();
    } catch (err: any) {
      setMatchError(getApiError(err));
    } finally {
      setMatchLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Chấm công app</h1>
          <p className="mt-1 text-sm text-gray-500">
            Quản lý tài khoản đăng nhập app Chấm công (cskh-app) của nhân viên.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openMatchModal}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50"
          >
            <LinkIcon className="h-5 w-5" /> Ghép nối tài khoản có sẵn
          </button>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
          >
            <PlusIcon className="h-5 w-5" /> Thêm tài khoản
          </button>
        </div>
      </div>

      <div className="relative max-w-md">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo tên, tên đăng nhập, mã nhân viên..."
          className="w-full rounded-xl border-gray-300 pl-9 text-sm"
        />
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-500">Đang tải dữ liệu...</div>
        ) : filteredNurses.length === 0 ? (
          <div className="py-16 text-center">
            <UserGroupIcon className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">
              {nurses.length === 0 ? 'Chưa có nhân viên nào có tài khoản.' : 'Không tìm thấy kết quả phù hợp.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3">Nhân viên</th>
                  <th className="px-5 py-3">Tên đăng nhập</th>
                  <th className="px-5 py-3">SĐT</th>
                  <th className="px-5 py-3">Trạng thái làm việc</th>
                  <th className="px-5 py-3">Trạng thái tài khoản</th>
                  <th className="px-5 py-3">Bác sĩ quản lý</th>
                  <th className="px-5 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredNurses.map((nurse) => {
                  const employee = nurse.hrm_employee_id ? employeeMap[nurse.hrm_employee_id] : undefined;
                  return (
                    <tr
                      key={nurse.id}
                      onClick={() => openEditModal(nurse)}
                      className="cursor-pointer hover:bg-gray-50"
                    >
                      <td className="px-5 py-4">
                        <p className="font-semibold text-gray-900">{employee?.full_name || nurseFullName(nurse)}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {nurse.hrm_employee_id}{employee?.department?.name ? ` · ${employee.department.name}` : ''}
                        </p>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-gray-700">{nurse.user.username}</td>
                      <td className="px-5 py-4 text-gray-700">{nurse.phone_number || employee?.phone_number || '—'}</td>
                      <td className="px-5 py-4 text-gray-700">
                        {nurse.status ? NURSE_STATUS_LABELS[nurse.status] || nurse.status : '—'}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            nurse.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {nurse.is_active ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-gray-700">{doctorFullName(nurse.assigned_doctor) || '—'}</td>
                      <td className="px-5 py-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleResetPassword(nurse); }}
                            disabled={resetLoadingId === nurse.id}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                          >
                            {resetLoadingId === nurse.id ? 'Đang reset...' : 'Reset mật khẩu'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleToggle(nurse); }}
                            disabled={toggleLoadingId === nurse.id}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                              nurse.is_active
                                ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                            }`}
                          >
                            {toggleLoadingId === nurse.id ? 'Đang xử lý...' : nurse.is_active ? 'Vô hiệu hóa' : 'Kích hoạt'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modal thêm tài khoản ── */}
      {showCreateModal && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900">Thêm tài khoản</h3>
              <button onClick={closeCreateModal} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <SelectBox<number>
                label="Nhân viên"
                value={selectedEmployeeId ?? 0}
                options={employeeOptions}
                onChange={(v) => setSelectedEmployeeId(v || null)}
                placeholder="Tìm và chọn nhân viên..."
                searchable
                portal
              />
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Tên đăng nhập <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={createForm.username}
                  onChange={(e) => setCreateForm({ username: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                  placeholder="VD: ac02763"
                  autoComplete="off"
                />
              </div>
              <div>
                <SelectBox
                  label="Bác sĩ quản lý"
                  value={createDoctorId ? String(createDoctorId) : ''}
                  options={doctorOptions}
                  onChange={(v) => setCreateDoctorId(v ? Number(v) : null)}
                  placeholder="Tìm và chọn bác sĩ quản lý..."
                  searchable
                  portal
                />
              </div>
              <p className="text-xs text-gray-400">Mật khẩu sẽ được tạo tự động và hiển thị 1 lần sau khi tạo thành công.</p>
              {createError && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{createError}</p>}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={closeCreateModal}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                onClick={handleCreate}
                disabled={createLoading}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
              >
                {createLoading ? 'Đang tạo...' : 'Tạo tài khoản'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Dialog mật khẩu 1 lần ── */}
      {createdPassword && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <div className="flex flex-col items-center gap-3 mb-5">
              <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <ShieldCheckIcon className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-sm font-bold text-gray-900">Tài khoản đã được tạo</h3>
              <p className="text-xs text-gray-500 text-center">
                Mật khẩu chỉ hiển thị <span className="font-semibold text-red-500">một lần duy nhất</span>. Hãy sao chép và giao cho nhân viên ngay.
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-5">
              <p className="text-xs text-gray-400 mb-1">Mật khẩu</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-mono font-bold text-gray-900 tracking-widest select-all">{createdPassword}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(createdPassword)}
                  className="shrink-0 text-xs px-2 py-1 bg-primary-50 text-primary-700 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors"
                >
                  Sao chép
                </button>
              </div>
            </div>
            <button
              onClick={() => setCreatedPassword(null)}
              className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700"
            >
              Đã lưu mật khẩu, đóng lại
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* ── Dialog mật khẩu sau khi reset ── */}
      {resetPasswordResult && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <div className="flex flex-col items-center gap-3 mb-5">
              <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <ShieldCheckIcon className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-sm font-bold text-gray-900">Đã reset mật khẩu cho {resetPasswordResult.name}</h3>
              <p className="text-xs text-gray-500 text-center">
                Mật khẩu chỉ hiển thị <span className="font-semibold text-red-500">một lần duy nhất</span>. Hãy sao chép và giao cho nhân viên ngay.
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-5">
              <p className="text-xs text-gray-400 mb-1">Mật khẩu mới</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-mono font-bold text-gray-900 tracking-widest select-all">{resetPasswordResult.password}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(resetPasswordResult.password)}
                  className="shrink-0 text-xs px-2 py-1 bg-primary-50 text-primary-700 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors"
                >
                  Sao chép
                </button>
              </div>
            </div>
            <button
              onClick={() => setResetPasswordResult(null)}
              className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700"
            >
              Đã lưu mật khẩu, đóng lại
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modal sửa tài khoản ── */}
      {editing && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900">Sửa tài khoản</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Tên đăng nhập <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editForm.username}
                  onChange={(e) => setEditForm({ username: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <SelectBox<number>
                  label="Nhân viên liên kết"
                  value={editEmployeeId ?? 0}
                  options={editEmployeeOptions}
                  onChange={(v) => setEditEmployeeId(v || null)}
                  placeholder="Tìm và chọn nhân viên..."
                  searchable
                  portal
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Đổi nhân viên liên kết nếu tài khoản này đang gắn nhầm hồ sơ.
                </p>
              </div>
              <div>
                <SelectBox
                  label="Bác sĩ quản lý"
                  value={editDoctorId ? String(editDoctorId) : ''}
                  options={doctorOptions}
                  onChange={(v) => setEditDoctorId(v ? Number(v) : null)}
                  placeholder="Tìm và chọn bác sĩ quản lý..."
                  searchable
                  portal
                />
              </div>
              {editError && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{editError}</p>}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                onClick={handleEdit}
                disabled={editLoading}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
              >
                {editLoading ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modal ghép nối tài khoản có sẵn ── */}
      {showMatchModal && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900">Ghép nối tài khoản có sẵn</h3>
              <button onClick={closeMatchModal} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Dùng khi nhân viên đã có sẵn tài khoản trên app Chấm công (tạo trước đây, chưa gắn với hồ sơ HRM) — nhập đúng tên đăng nhập của tài khoản đó và chọn nhân viên HRM tương ứng để liên kết.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Tên đăng nhập tài khoản <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={matchUsername}
                  onChange={(e) => setMatchUsername(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                  placeholder="VD: ac02763"
                  autoComplete="off"
                />
              </div>
              <SelectBox<number>
                label="Nhân viên HRM"
                value={matchEmployeeId ?? 0}
                options={employeeOptions}
                onChange={(v) => setMatchEmployeeId(v || null)}
                placeholder="Tìm và chọn nhân viên..."
                searchable
                portal
              />
              {matchError && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{matchError}</p>}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={closeMatchModal}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                onClick={handleMatch}
                disabled={matchLoading}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
              >
                {matchLoading ? 'Đang ghép nối...' : 'Ghép nối'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
