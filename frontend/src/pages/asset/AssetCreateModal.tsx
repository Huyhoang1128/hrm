import React, { Fragment, useState, useEffect } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { assetsAPI, departmentsAPI, employeesAPI, positionsAPI, companyUnitsAPI } from '../../utils/api';
import { SelectBox, SelectOption } from '../../components/LandingLayout/SelectBox';
import FeedbackDialog from '../../components/FeedbackDialog';

interface AssetCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const ASSET_TYPES: SelectOption<string>[] = [
  { value: 'LAPTOP', label: 'Laptop' },
  { value: 'DESKTOP', label: 'Máy tính để bàn' },
  { value: 'MONITOR', label: 'Màn hình' },
  { value: 'SIM', label: 'Sim' },
  { value: 'PHONE', label: 'Điện thoại' },
  { value: 'TABLET', label: 'Máy tính bảng' },
  { value: 'PRINTER', label: 'Máy in' },
  { value: 'SCANNER', label: 'Máy scan' },
  { value: 'NETWORK', label: 'Thiết bị mạng' },
  { value: 'SERVER', label: 'Máy chủ' },
  { value: 'FURNITURE', label: 'Nội thất' },
  { value: 'VEHICLE', label: 'Phương tiện' },
  { value: 'OTHER', label: 'Khác' },
];

const ASSET_CONDITIONS: SelectOption<string>[] = [
  { value: 'EXCELLENT', label: 'Mới 100%' },
  { value: 'GOOD', label: 'Cũ (Chất lượng tốt)' },
  { value: 'FAIR', label: 'Cũ (Trầy xước / Cấn móp)' },
  { value: 'POOR', label: 'Cũ (Kém / Lỗi chức năng)' },
  { value: 'BROKEN', label: 'Hỏng (Không hoạt động)' },
];

const NETWORK_PROVIDERS: SelectOption<string>[] = [
  { value: 'VIETTEL', label: 'Viettel' },
  { value: 'VINAPHONE', label: 'Vinaphone' },
  { value: 'MOBIFONE', label: 'Mobifone' },
  { value: 'VIETNAMOBILE', label: 'Vietnamobile' },
];

const SIM_TYPES: SelectOption<string>[] = [
  { value: 'PREPAID', label: 'Trả trước' },
  { value: 'POSTPAID', label: 'Trả sau' },
];

const REGIONS: SelectOption<string>[] = [
  { value: 'MIEN_BAC', label: 'Miền Bắc' },
  { value: 'MIEN_TRUNG', label: 'Miền Trung' },
  { value: 'MIEN_NAM', label: 'Miền Nam' },
];

export default function AssetCreateModal({ isOpen, onClose, onSuccess }: AssetCreateModalProps) {
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<SelectOption<string>[]>([]);
  const [employees, setEmployees] = useState<SelectOption<string>[]>([]);
  const [positions, setPositions] = useState<SelectOption<string>[]>([]);
  const [companyUnits, setCompanyUnits] = useState<SelectOption<string>[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    asset_type: 'LAPTOP',
    model: '',
    condition: 'EXCELLENT',
    purchase_date: '',
    warranty_period: '12',
    supplier: '',
    department: '',
    managed_by: '',
    description: '',
    // Desktop specific fields
    cpu: '',
    mainboard: '',
    ram: '',
    storage: '',
    vga: '',
    power_supply: '',
    // SIM specific fields
    phone_number: '',
    network_provider: '',
    doctor: '',
    region: '',
    position_id: '',
    sim_type: 'PREPAID',
    sim_company: '',
    cancellation_report_date: '',
    // MONITOR specific fields
    monitor_quantity: '',
    // OTHER specific fields
    other_type_name: '',
  });

  /**
   * Khởi chạy khi Modal được mở, thực hiện lấy danh sách Phòng ban và Vị trí (Chức vụ)
   */
  useEffect(() => {
    if (isOpen) {
      fetchDepartments();
      fetchPositions();
      fetchCompanyUnits();
    }
  }, [isOpen]);

  /**
   * Tự động lọc danh sách Nhân viên mỗi khi Phòng ban quản lý thay đổi
   */
  useEffect(() => {
    if (isOpen && formData.department) {
      fetchEmployees(formData.department);
      setFormData(prev => ({ ...prev, assigned_to: '' }));
    } else if (isOpen && !formData.department) {
      setEmployees([]);
    }
  }, [formData.department, isOpen]);

  /**
   * Lấy danh sách Phòng ban từ API
   */
  const fetchDepartments = async () => {
    try {
      const data = await departmentsAPI.list({ page_size: 100 });
      const options = (data.results || []).map(dept => ({
        value: String(dept.id),
        label: dept.name
      }));
      setDepartments(options);

      // Set default department to HCNS if found
      const hcnsDept = options.find(opt =>
        opt.label.toUpperCase().includes('HCNS')
      );
      if (hcnsDept && !formData.department) {
        setFormData(prev => ({ ...prev, department: hcnsDept.value }));
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const fetchCompanyUnits = async () => {
    try {
      const data: any = await companyUnitsAPI.list({ page_size: 200, active_only: true });
      const list = Array.isArray(data) ? data : (data?.results || []);
      const options = list.map((unit: any) => ({
        value: String(unit.id),
        label: unit.name,
      }));
      setCompanyUnits(options);
    } catch (error) {
      console.error('Error fetching company units:', error);
    }
  };

  const fetchPositions = async () => {
    try {
      const data = await positionsAPI.list({ page_size: 100 });
      const options = (data.results || []).map(pos => ({
        value: String(pos.id),
        label: pos.title
      }));
      setPositions(options);
    } catch (error) {
      console.error('Error fetching positions:', error);
    }
  };

  /**
   * Lấy danh sách Nhân viên, hỗ trợ lọc theo phòng ban
   * @param departmentId ID của phòng ban cần lọc
   */
  const fetchEmployees = async (departmentId?: string) => {
    try {
      const params: any = { page_size: 200, is_active: true };
      if (departmentId) {
        params.department = parseInt(departmentId);
      }

      const data = await employeesAPI.list(params);
      const options = (data.results || []).map(emp => ({
        value: String(emp.id),
        label: `${emp.full_name} (${emp.employee_id})`
      }));
      setEmployees(options);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  /**
   * Xử lý thay đổi dữ liệu trong các ô Input văn bản
   */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  /**
   * Kiểm tra xem các trường bắt buộc đã được điền đầy đủ chưa
   * Hiện tại chỉ yêu cầu Mã tài sản (asset_code)
   */
  const isFormValid = () => {
    let isValid = formData.name.trim() !== '';

    if (formData.asset_type === 'SIM') {
      const phone = formData.phone_number || '';
      isValid = isValid && /^\d{10}$/.test(phone.trim());
    }

    return isValid;
  };

  /**
   * Xử lý thay đổi dữ liệu cho các ô SelectBox tùy chỉnh
   */
  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  /**
   * Gửi dữ liệu form lên Server để tạo tài sản mới
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // ── Check trùng mã thiết bị (tên) trước khi gọi API tạo ───────────
      const trimmedName = formData.name.trim();
      if (trimmedName) {
        try {
          const existing = await assetsAPI.list({ search: trimmedName, page_size: 50 });
          const normalized = trimmedName.toLowerCase();
          const duplicate = (existing.results || []).find(
            (a) => (a.name || '').trim().toLowerCase() === normalized,
          );
          if (duplicate) {
            setErrorMessage(
              `Mã thiết bị "${trimmedName}" đã tồn tại (mã tài sản: ${duplicate.asset_code}). Vui lòng nhập mã khác.`,
            );
            setLoading(false);
            return;
          }
        } catch (checkErr) {
          console.warn('Không check được trùng mã, tiếp tục tạo:', checkErr);
        }
      }

      // Split technical specs into a separate object if it's a Desktop
      const { cpu, mainboard, ram, storage, vga, power_supply, monitor_quantity, phone_number, network_provider, doctor, region, position_id, sim_type, sim_company, cancellation_report_date, other_type_name, warranty_period, ...baseData } = formData;

      let specifications = {};
      if (formData.asset_type === 'DESKTOP') {
        specifications = { cpu, mainboard, ram, storage, vga, power_supply };
      } else if (formData.asset_type === 'MONITOR') {
        specifications = { quantity: parseInt(monitor_quantity) || 0 };
      } else if (formData.asset_type === 'SIM') {
        const positionTitle = positions.find(p => p.value === formData.position_id)?.label || '';
        const simCompanyName = companyUnits.find(c => c.value === sim_company)?.label || '';
        specifications = { phone_number, network_provider, doctor, region, position_id, position_title: positionTitle, sim_type, sim_company, sim_company_name: simCompanyName, cancellation_report_date };
      } else if (formData.asset_type === 'OTHER') {
        specifications = { type_name: other_type_name, quantity: parseInt(monitor_quantity) || 0 };
      }

      const payload = {
        ...baseData,
        purchase_date: formData.purchase_date || null,
        warranty_period: warranty_period ? parseInt(warranty_period) : null,
        department_id: formData.department ? parseInt(formData.department) : null,
        managed_by_id: formData.managed_by ? parseInt(formData.managed_by) : null,
        specifications
      };

      console.log('--- Gửi yêu cầu tạo tài sản mới ---');
      console.log('Payload:', JSON.stringify(payload, null, 2));

      const response = await assetsAPI.create(payload as any);

      console.log('--- Phản hồi từ Server ---');
      console.log('Data:', response);

      onSuccess();
      onClose();
      // Reset form
      setFormData({
        name: '',
        asset_type: 'LAPTOP',
        model: '',
        condition: 'EXCELLENT',
        purchase_date: '',
        warranty_period: '12',
        supplier: '',
        department: '',
        managed_by: '',
        description: '',
        cpu: '',
        mainboard: '',
        ram: '',
        storage: '',
        vga: '',
        power_supply: '',
        monitor_quantity: '',
        phone_number: '',
        network_provider: '',
        doctor: '',
        region: '',
        position_id: '',
        sim_type: 'PREPAID',
        sim_company: '',
        cancellation_report_date: '',
        other_type_name: '',
      });
    } catch (error: any) {
      console.error('Error creating asset:', error);
      const respData = error.response?.data;
      // DRF field errors: { name: ["..."], asset_code: ["..."] } → lấy dòng đầu tiên
      let fieldError: string | null = null;
      if (respData && typeof respData === 'object') {
        for (const val of Object.values(respData)) {
          if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') {
            fieldError = val[0];
            break;
          }
        }
      }
      setErrorMessage(
        respData?.error || fieldError || error.message ||
        'Có lỗi xảy ra khi thêm tài sản. Vui lòng kiểm tra lại.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </TransitionChild>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <DialogPanel className="relative transform rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Modal Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                  <DialogTitle as="h3" className="text-lg font-semibold leading-6 text-gray-900">
                    Thêm tài sản mới
                  </DialogTitle>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-500 transition-colors"
                    onClick={onClose}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                {/* Modal Body */}
                <div className="overflow-y-auto flex-1 px-6 py-5">
                  <form onSubmit={handleSubmit} className="space-y-5">

                    {/* ── Section 1: Thông tin thiết bị ── */}
                    <section>
                      <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Thông tin thiết bị</h4>
                      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                            Mã thiết bị (Dán nhãn) <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            name="name"
                            id="name"
                            value={formData.name}
                            onChange={handleChange}
                            className="input-field mt-1"
                            placeholder="VD: TA0123131..."
                          />
                        </div>

                        <SelectBox
                          label="Phân loại"
                          value={formData.asset_type}
                          options={ASSET_TYPES}
                          onChange={(val) => handleSelectChange('asset_type', val)}
                        />

                        <SelectBox
                          label="Tình trạng"
                          value={formData.condition}
                          options={ASSET_CONDITIONS}
                          onChange={(val) => handleSelectChange('condition', val)}
                        />

                        {/* Màn hình / Khác: Số lượng */}
                        {['MONITOR', 'OTHER'].includes(formData.asset_type) && (
                          <div className="sm:col-span-2 bg-violet-50/60 p-4 rounded-xl border border-violet-100">
                            <h4 className="text-[11px] font-semibold text-violet-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 bg-violet-500 rounded-full"></div>
                              Số lượng tài sản
                            </h4>
                            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                              <div>
                                <label htmlFor="monitor_quantity" className="block text-sm font-medium text-gray-700">Số lượng</label>
                                <input type="number" name="monitor_quantity" id="monitor_quantity" min="1" step="1"
                                  value={formData.monitor_quantity} onChange={handleChange}
                                  className="input-field mt-1"
                                  placeholder="VD: 1, 2, 3..." />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* SIM: Thông tin chi tiết */}
                        {formData.asset_type === 'SIM' && (
                          <div className="sm:col-span-2 bg-emerald-50/60 p-4 rounded-xl border border-emerald-100">
                            <h4 className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                              Thông tin Sim
                            </h4>
                            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                              <div>
                                <label htmlFor="phone_number" className="block text-sm font-medium text-gray-700">Số điện thoại</label>
                                <input type="text" name="phone_number" id="phone_number" value={formData.phone_number} onChange={handleChange}
                                  className="input-field mt-1"
                                  placeholder="VD: 0912345678" />
                                {formData.phone_number && !/^\d{10}$/.test(formData.phone_number.trim()) && (
                                  <p className="mt-1 text-xs text-red-500">Số điện thoại phải gồm đúng 10 chữ số.</p>
                                )}
                              </div>
                              <SelectBox
                                label="Nhà mạng"
                                value={formData.network_provider}
                                options={NETWORK_PROVIDERS}
                                onChange={(val) => handleSelectChange('network_provider', val)}
                              />
                              <SelectBox
                                label="Phân loại Sim"
                                value={formData.sim_type}
                                options={SIM_TYPES}
                                onChange={(val) => handleSelectChange('sim_type', val)}
                              />
                              <div>
                                <label htmlFor="doctor" className="block text-sm font-medium text-gray-700">Bác sĩ</label>
                                <input type="text" name="doctor" id="doctor" value={formData.doctor} onChange={handleChange}
                                  className="input-field mt-1"
                                  placeholder="VD: Nguyễn Văn A..." />
                              </div>
                              <SelectBox
                                label="Vùng miền"
                                value={formData.region}
                                options={REGIONS}
                                onChange={(val) => handleSelectChange('region', val)}
                                placeholder="-- Chọn vùng miền --"
                              />
                              <SelectBox
                                label="Vị trí"
                                value={formData.position_id}
                                options={positions}
                                onChange={(val) => handleSelectChange('position_id', val)}
                                placeholder="-- Chọn vị trí --"
                                searchable
                              />
                              <SelectBox
                                label="Công ty"
                                value={formData.sim_company}
                                options={companyUnits}
                                onChange={(val) => handleSelectChange('sim_company', val)}
                                placeholder="-- Chọn công ty --"
                                searchable
                              />
                              <div>
                                <label htmlFor="cancellation_report_date" className="block text-sm font-medium text-gray-700">Ngày báo huỷ</label>
                                <input type="date" name="cancellation_report_date" id="cancellation_report_date" value={formData.cancellation_report_date} onChange={handleChange}
                                  className="input-field mt-1" />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* OTHER: Thông tin chi tiết */}
                        {formData.asset_type === 'OTHER' && (
                          <div className="sm:col-span-2 bg-gray-50/60 p-4 rounded-xl border border-gray-200">
                            <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 bg-gray-500 rounded-full"></div>
                              Thông tin loại khác
                            </h4>
                            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                              <div>
                                <label htmlFor="other_type_name" className="block text-sm font-medium text-gray-700">Tên loại chi tiết</label>
                                <input type="text" name="other_type_name" id="other_type_name" value={formData.other_type_name} onChange={handleChange}
                                  className="input-field mt-1"
                                  placeholder="VD: Máy chiếu, Camera..." />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Desktop: Cấu hình chi tiết inline */}
                        {formData.asset_type === 'DESKTOP' && (
                          <div className="sm:col-span-2 bg-primary-50/60 p-4 rounded-xl border border-primary-100">
                            <h4 className="text-[11px] font-semibold text-primary-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 bg-primary-500 rounded-full"></div>
                              Cấu hình chi tiết
                            </h4>
                            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
                              <div>
                                <label htmlFor="cpu" className="block text-sm font-medium text-gray-700">CPU</label>
                                <input type="text" name="cpu" id="cpu" value={formData.cpu} onChange={handleChange}
                                  className="input-field mt-1"
                                  placeholder="Core i7-13700K" />
                              </div>
                              <div>
                                <label htmlFor="mainboard" className="block text-sm font-medium text-gray-700">Main</label>
                                <input type="text" name="mainboard" id="mainboard" value={formData.mainboard} onChange={handleChange}
                                  className="input-field mt-1"
                                  placeholder="ASUS Z790-P" />
                              </div>
                              <div>
                                <label htmlFor="ram" className="block text-sm font-medium text-gray-700">RAM</label>
                                <input type="text" name="ram" id="ram" value={formData.ram} onChange={handleChange}
                                  className="input-field mt-1"
                                  placeholder="32GB DDR5" />
                              </div>
                              <div>
                                <label htmlFor="storage" className="block text-sm font-medium text-gray-700">Ổ cứng</label>
                                <input type="text" name="storage" id="storage" value={formData.storage} onChange={handleChange}
                                  className="input-field mt-1"
                                  placeholder="SSD 1TB NVMe" />
                              </div>
                              <div>
                                <label htmlFor="vga" className="block text-sm font-medium text-gray-700">VGA</label>
                                <input type="text" name="vga" id="vga" value={formData.vga} onChange={handleChange}
                                  className="input-field mt-1"
                                  placeholder="RTX 4070 Ti" />
                              </div>
                              <div>
                                <label htmlFor="power_supply" className="block text-sm font-medium text-gray-700">Nguồn</label>
                                <input type="text" name="power_supply" id="power_supply" value={formData.power_supply} onChange={handleChange}
                                  className="input-field mt-1"
                                  placeholder="Corsair 850W" />
                              </div>
                            </div>
                          </div>
                        )}

                        {!['SIM', 'FURNITURE'].includes(formData.asset_type) && (
                          <div>
                            <label htmlFor="model" className="block text-sm font-medium text-gray-700">
                              Model
                            </label>
                            <input
                              type="text"
                              name="model"
                              id="model"
                              value={formData.model}
                              onChange={handleChange}
                              className="input-field mt-1"
                              placeholder="VD: M2 Pro, XPS 15..."
                            />
                          </div>
                        )}
                      </div>
                    </section>

                    <hr className="border-gray-100" />

                    {/* ── Section 2: Mua sắm & Quản lý ── */}
                    <section>
                      <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Mua sắm & Quản lý</h4>
                      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor="supplier" className="block text-sm font-medium text-gray-700">Nhà cung cấp</label>
                          <input type="text" name="supplier" id="supplier" value={formData.supplier} onChange={handleChange}
                            className="input-field mt-1"
                            placeholder="Tên đơn vị cung cấp" />
                        </div>

                        <div>
                          <label htmlFor="purchase_date" className="block text-sm font-medium text-gray-700">Ngày mua</label>
                          <input type="date" name="purchase_date" id="purchase_date" value={formData.purchase_date} onChange={handleChange}
                            className="input-field mt-1" />
                        </div>

                        <div>
                          <label htmlFor="warranty_period" className="block text-sm font-medium text-gray-700">Bảo hành (tháng)</label>
                          <input
                            type="number"
                            name="warranty_period"
                            id="warranty_period"
                            min="0"
                            step="1"
                            value={formData.warranty_period}
                            onChange={handleChange}
                            className="input-field mt-1"
                            placeholder="VD: 12"
                          />
                        </div>

                        <SelectBox
                          label="Phòng ban quản lý"
                          value={formData.department}
                          options={departments}
                          onChange={(val) => handleSelectChange('department', val)}
                          placeholder="-- Chọn phòng ban --"
                          searchable
                        />

                        {formData.department && (
                          <SelectBox
                            label="Người quản lý (Kho)"
                            value={formData.managed_by}
                            options={employees}
                            onChange={(val) => handleSelectChange('managed_by', val)}
                            placeholder="-- Chọn người quản lý --"
                            searchable
                          />
                        )}
                      </div>
                    </section>

                    <hr className="border-gray-100" />

                    {/* ── Section 3: Ghi chú ── */}
                    <section>
                      <label htmlFor="description" className="block text-sm font-medium text-gray-700">Mô tả / Ghi chú</label>
                      <textarea
                        id="description"
                        name="description"
                        rows={2}
                        value={formData.description}
                        onChange={handleChange}
                        className="input-field mt-1"
                        placeholder="Thông tin bổ sung hoặc lưu ý..."
                      />
                    </section>
                  </form>
                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex items-center justify-end gap-3 shrink-0">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={onClose}
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    form="asset-create-form"
                    disabled={loading || !isFormValid()}
                    onClick={handleSubmit}
                    className={`btn-primary inline-flex items-center gap-2 ${!isFormValid() ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={!isFormValid() ? 'Vui lòng điền Mã thiết bị' : ''}
                  >
                    {loading && (
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    )}
                    {loading ? 'Đang thêm...' : 'Thêm tài sản'}
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>

      <FeedbackDialog
        open={!!errorMessage}
        variant="error"
        title="Không thể thêm tài sản"
        message={errorMessage || ''}
        onClose={() => setErrorMessage(null)}
      />
    </Transition>
  );
}
