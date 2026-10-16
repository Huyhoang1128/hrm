import React, { Fragment, useState, useEffect } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { assetsAPI, departmentsAPI, employeesAPI, Asset, positionsAPI, companyUnitsAPI } from '../../utils/api';
import { SelectBox, SelectOption } from '../../components/LandingLayout/SelectBox';
import FeedbackDialog from '../../components/FeedbackDialog';
import AssetTypeInput from './AssetTypeInput';
import { isMultiHolderType, normalizeAssetType } from './assetTypes';

interface AssetEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  asset: Asset | null;
}


const DEPRECIATION_METHODS: SelectOption<string>[] = [
  { value: 'STRAIGHT_LINE', label: 'Đường thẳng' },
];

const ASSET_CONDITIONS: SelectOption<string>[] = [
  { value: 'EXCELLENT', label: 'Mới 100%' },
  { value: 'GOOD', label: 'Cũ (Chất lượng tốt)' },
  { value: 'FAIR', label: 'Cũ (Trầy xước / Cấn móp)' },
  { value: 'POOR', label: 'Cũ (Kém / Lỗi chức năng)' },
  { value: 'BROKEN', label: 'Hỏng (Không hoạt động)' },
];

const ASSET_STATUSES: SelectOption<string>[] = [
  { value: 'NEW', label: 'Sẵn dùng (Mới 100%)' },
  { value: 'IDLE', label: 'Sẵn dùng (Trong kho)' },
  { value: 'IN_USE', label: 'Đang sử dụng' },
  { value: 'UNDER_MAINTENANCE', label: 'Đang sửa chữa / Bảo hành' },
  { value: 'DAMAGED', label: 'Lỗi / Chờ thanh lý' },
  { value: 'RETIRED', label: 'Đã thanh lý' },
  { value: 'TERMINATED', label: 'Đã cắt' },
  { value: 'LOST', label: 'Bị mất' },
];

// Nhãn riêng cho SIM (cùng enum ASSET_STATUS nhưng ngữ cảnh khác)
const SIM_STATUSES: SelectOption<string>[] = [
  { value: 'NEW', label: 'Mới (Chưa kích hoạt)' },
  { value: 'IN_USE', label: 'Đang sử dụng' },
  { value: 'UNDER_MAINTENANCE', label: 'Tạm khóa' },
  { value: 'TERMINATED', label: 'Đã cắt' },
  { value: 'LOST', label: 'Mất / Hỏng' },
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

export default function AssetEditModal({ isOpen, onClose, onSuccess, asset }: AssetEditModalProps) {
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<SelectOption<string>[]>([]);
  const [employees, setEmployees] = useState<SelectOption<string>[]>([]);
  const [positions, setPositions] = useState<SelectOption<string>[]>([]);
  const [companyUnits, setCompanyUnits] = useState<SelectOption<string>[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [handoverEmployeeId, setHandoverEmployeeId] = useState<number | null>(null);
  const [handoverEmployeeName, setHandoverEmployeeName] = useState('');
  const [isUpdatingSimRecipient, setIsUpdatingSimRecipient] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    asset_type: 'LAPTOP',
    model: '',
    status: 'NEW',
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
    // MONITOR specific fields
    monitor_quantity: '',
    // SIM specific fields
    phone_number: '',
    network_provider: '',
    doctor: '',
    region: '',
    position_id: '',
    sim_type: 'PREPAID',
    sim_company: '',
    cancellation_report_date: '',
    // OTHER specific fields
    other_type_name: '',
    dimensions: '',
    usage_area: '',
    usage_department: '',
    facility_code: '',
    purchase_price: '',
    depreciation_period_months: '',
    depreciation_method: 'STRAIGHT_LINE',
  });
  // Mã loại chuẩn (SIM, DESKTOP...) suy ra từ ô Phân loại gõ tự do
  const typeCode = normalizeAssetType(formData.asset_type);
  // Ảnh: URL ảnh hiện có + file mới chọn + cờ xoá ảnh
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const [purchaseImageUrl, setPurchaseImageUrl] = useState<string | null>(null);
  const [currentImageFile, setCurrentImageFile] = useState<File | null>(null);
  const [purchaseImageFile, setPurchaseImageFile] = useState<File | null>(null);
  const [clearCurrentImage, setClearCurrentImage] = useState(false);
  const [clearPurchaseImage, setClearPurchaseImage] = useState(false);
  // Giá trị hiện tại/Mức khấu hao — server tính động, chỉ hiển thị tham khảo
  const [computedDepreciation, setComputedDepreciation] = useState<{ monthly: number | null; current: number | null }>({ monthly: null, current: null });

  /**
   * Khởi chạy khi Modal được mở, gán dữ liệu từ prop asset vào form
   */
  useEffect(() => {
    if (isOpen && asset) {
      setLoading(true);
      setHandoverEmployeeId(null);
      setHandoverEmployeeName('');
      assetsAPI.getById(asset.id)
        .then((fullAsset) => {
          const specs = fullAsset.specifications || {};
          const recipientId = fullAsset.assigned_to || fullAsset.pending_assignment?.assigned_to || null;
          const recipientName = fullAsset.assigned_to_name || fullAsset.pending_assignment?.assigned_to_name || '';
          setHandoverEmployeeId(recipientId);
          setHandoverEmployeeName(recipientName);
          setCurrentImageUrl(fullAsset.current_image_url || null);
          setPurchaseImageUrl(fullAsset.purchase_image_url || null);
          setCurrentImageFile(null);
          setPurchaseImageFile(null);
          setClearCurrentImage(false);
          setClearPurchaseImage(false);
          setComputedDepreciation({
            monthly: fullAsset.monthly_depreciation ?? null,
            current: fullAsset.current_value ?? null,
          });
          setFormData({
            name: fullAsset.name || '',
            asset_type: fullAsset.asset_type_display || fullAsset.asset_type || 'Laptop',
            model: fullAsset.model || '',
            status: fullAsset.status || 'NEW',
            condition: fullAsset.condition || 'EXCELLENT',
            purchase_date: fullAsset.purchase_date || '',
            warranty_period: fullAsset.warranty_period ? String(fullAsset.warranty_period) : '12',
            supplier: fullAsset.supplier || '',
            department: fullAsset.department ? String(fullAsset.department) : '',
            managed_by: fullAsset.managed_by ? String(fullAsset.managed_by) : '',
            description: fullAsset.description || '',
            // Specs fields
            cpu: specs.cpu || '',
            mainboard: specs.mainboard || '',
            ram: specs.ram || '',
            storage: specs.storage || '',
            vga: specs.vga || '',
            power_supply: specs.power_supply || '',
            monitor_quantity: String((specs as any).quantity || ''),
            phone_number: (specs as any).phone_number || '',
            network_provider: (specs as any).network_provider || '',
            doctor: (specs as any).doctor || '',
            region: (specs as any).region || '',
            position_id: (specs as any).position_id ? String((specs as any).position_id) : '',
            sim_type: (specs as any).sim_type || 'PREPAID',
            sim_company: (specs as any).sim_company ? String((specs as any).sim_company) : '',
            cancellation_report_date: (specs as any).cancellation_report_date || '',
            other_type_name: (specs as any).type_name || '',
            dimensions: fullAsset.dimensions || '',
            usage_area: fullAsset.usage_area || '',
            usage_department: fullAsset.usage_department ? String(fullAsset.usage_department) : '',
            facility_code: fullAsset.facility_code || '',
            purchase_price: fullAsset.purchase_price != null ? String(fullAsset.purchase_price) : '',
            depreciation_period_months: fullAsset.depreciation_period_months != null ? String(fullAsset.depreciation_period_months) : '',
            depreciation_method: fullAsset.depreciation_method || 'STRAIGHT_LINE',
          });
        })
        .catch((error) => {
          console.error('Error fetching asset details:', error);
          const specs = asset.specifications || {};
          const recipientId = asset.assigned_to || asset.pending_assignment?.assigned_to || null;
          const recipientName = asset.assigned_to_name || asset.pending_assignment?.assigned_to_name || '';
          setHandoverEmployeeId(recipientId);
          setHandoverEmployeeName(recipientName);
          setFormData({
            name: asset.name || '',
            asset_type: asset.asset_type_display || asset.asset_type || 'Laptop',
            model: asset.model || '',
            status: asset.status || 'NEW',
            condition: asset.condition || 'EXCELLENT',
            purchase_date: asset.purchase_date || '',
            warranty_period: (asset as any).warranty_period ? String((asset as any).warranty_period) : '12',
            supplier: asset.supplier || '',
            department: '',
            managed_by: '',
            description: asset.description || '',
            cpu: specs.cpu || '',
            mainboard: specs.mainboard || '',
            ram: specs.ram || '',
            storage: specs.storage || '',
            vga: specs.vga || '',
            power_supply: specs.power_supply || '',
            monitor_quantity: String((specs as any).quantity || ''),
            phone_number: (specs as any).phone_number || '',
            network_provider: (specs as any).network_provider || '',
            doctor: (specs as any).doctor || '',
            region: (specs as any).region || '',
            position_id: (specs as any).position_id ? String((specs as any).position_id) : '',
            sim_type: (specs as any).sim_type || 'PREPAID',
            sim_company: (specs as any).sim_company ? String((specs as any).sim_company) : '',
            cancellation_report_date: (specs as any).cancellation_report_date || '',
            other_type_name: (specs as any).type_name || '',
            dimensions: (asset as any).dimensions || '',
            usage_area: (asset as any).usage_area || '',
            usage_department: (asset as any).usage_department ? String((asset as any).usage_department) : '',
            facility_code: (asset as any).facility_code || '',
            purchase_price: (asset as any).purchase_price != null ? String((asset as any).purchase_price) : '',
            depreciation_period_months: (asset as any).depreciation_period_months != null ? String((asset as any).depreciation_period_months) : '',
            depreciation_method: (asset as any).depreciation_method || 'STRAIGHT_LINE',
          });
        })
        .finally(() => {
          setLoading(false);
        });
      
      fetchDepartments();
      fetchPositions();
      fetchCompanyUnits();
    }
  }, [isOpen, asset]);

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

  /**
   * Tự động lọc danh sách Nhân viên mỗi khi Phòng ban quản lý thay đổi
   */
  useEffect(() => {
    if (isOpen && formData.department) {
      fetchEmployees(formData.department);
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
    } catch (error) {
      console.error('Error fetching departments:', error);
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const isFormValid = () => {
    let isValid = formData.name && formData.name.trim() !== '';
    
    if (typeCode === 'SIM') {
      const phone = (formData as any).phone_number || '';
      isValid = isValid && /^\d{10}$/.test(phone.trim());
    }
    
    return isValid;
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  /**
   * Đồng bộ thông tin SIM từ hồ sơ của người đang được bàn giao SIM.
   * Người quản lý vẫn cần bấm "Lưu thay đổi" để ghi các giá trị này.
   */
  const handleUpdateSimFromRecipient = async () => {
    if (!handoverEmployeeId) return;

    setIsUpdatingSimRecipient(true);
    try {
      const employee = await employeesAPI.getById(handoverEmployeeId);
      setFormData((prev) => ({
        ...prev,
        doctor: employee.full_name || '',
        position_id: employee.position?.id ? String(employee.position.id) : '',
        sim_company: employee.company_unit?.id ? String(employee.company_unit.id) : '',
      }));
    } catch (error: any) {
      console.error('Error loading handover recipient:', error);
      setErrorMessage(
        error.response?.data?.error ||
        'Không thể lấy thông tin của người được bàn giao. Vui lòng thử lại.'
      );
    } finally {
      setIsUpdatingSimRecipient(false);
    }
  };

  /**
   * Gửi dữ liệu cập nhật lên Server
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!asset) return;
    
    setLoading(true);
    try {
      const { cpu, mainboard, ram, storage, vga, power_supply, monitor_quantity, phone_number, network_provider, doctor, region, position_id, sim_type, sim_company, cancellation_report_date, other_type_name, warranty_period, purchase_price, depreciation_period_months, depreciation_method, usage_department, ...baseData } = formData;

      let specifications = {};
      if (typeCode === 'DESKTOP') {
        specifications = { cpu, mainboard, ram, storage, vga, power_supply };
      } else if (typeCode === 'MONITOR') {
        specifications = { quantity: parseInt(monitor_quantity) || 0 };
      } else if (typeCode === 'SIM') {
        const positionTitle = positions.find(p => p.value === formData.position_id)?.label || '';
        const simCompanyName = companyUnits.find(c => c.value === sim_company)?.label || '';
        specifications = { phone_number, network_provider, doctor, region, position_id, position_title: positionTitle, sim_type, sim_company, sim_company_name: simCompanyName, cancellation_report_date };
      } else if (typeCode === 'OTHER') {
        specifications = { type_name: other_type_name, quantity: parseInt(monitor_quantity) || 0 };
      } else if (isMultiHolderType(typeCode)) {
        // Phân loại gõ tự do: giống "Khác" — có Số lượng
        specifications = { quantity: parseInt(monitor_quantity) || 0 };
      }

      const payload = {
        ...baseData,
        purchase_date: formData.purchase_date || null,
        warranty_period: warranty_period ? parseInt(warranty_period) : null,
        department_id: formData.department ? parseInt(formData.department) : null,
        managed_by_id: formData.managed_by ? parseInt(formData.managed_by) : null,
        purchase_price: purchase_price ? parseFloat(purchase_price) : null,
        depreciation_period_months: depreciation_period_months ? parseInt(depreciation_period_months) : null,
        depreciation_method,
        usage_department_id: usage_department ? parseInt(usage_department) : 0,
        specifications
      };
      
      console.log('--- Cập nhật tài sản ---');
      console.log('Payload:', JSON.stringify(payload, null, 2));
      
      const response = await assetsAPI.update(asset.id, payload as any);

      // Ảnh: thay ảnh mới hoặc xoá ảnh cũ
      try {
        if (currentImageFile) {
          await assetsAPI.uploadImage(asset.id, 'current', currentImageFile);
        } else if (clearCurrentImage) {
          await assetsAPI.clearImage(asset.id, 'current');
        }
        if (purchaseImageFile) {
          await assetsAPI.uploadImage(asset.id, 'purchase', purchaseImageFile);
        } else if (clearPurchaseImage) {
          await assetsAPI.clearImage(asset.id, 'purchase');
        }
      } catch (imgError) {
        console.error('Error uploading asset images:', imgError);
      }
      
      console.log('--- Phản hồi từ Server ---');
      console.log('Data:', response);
      
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error updating asset:', error);
      setErrorMessage(error.response?.data?.error || error.message || 'Có lỗi xảy ra khi cập nhật tài sản. Vui lòng kiểm tra lại.');
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
              <DialogPanel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                  <DialogTitle as="h3" className="text-base font-bold text-gray-900">
                    Chỉnh sửa tài sản
                  </DialogTitle>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
                <div className="px-6 py-5">
                  <div className="w-full">
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                        <div className="sm:col-span-1">
                          <label className="block text-sm font-medium text-gray-500">Mã</label>
                          <div className="mt-1 block w-full px-3 py-2 bg-gray-100 rounded-xl text-gray-700 text-sm border border-gray-200">
                            {asset?.asset_code}
                          </div>
                        </div>

                        <div className="sm:col-span-1">
                          <label htmlFor="name" className="block text-sm font-medium text-gray-700">Mã thiết bị (Dán nhãn)</label>
                          <input type="text" name="name" id="name" value={formData.name} onChange={handleChange} className="input-field mt-1" placeholder="Nhập mã thiết bị (VD: NV0123...)" />
                        </div>

                        {/* Phân loại asset */}
                        <div>
                          <label htmlFor="asset_type" className="block text-sm font-medium text-gray-700">
                            Phân loại
                          </label>
                          <AssetTypeInput value={formData.asset_type} onChange={handleChange} />
                        </div>

                        {/* Tình trạng (Vật lý) — SIM dùng chung choices với asset khác */}
                        <SelectBox
                          label="Tình trạng (Vật lý)"
                          value={formData.condition}
                          options={ASSET_CONDITIONS}
                          onChange={(val) => handleSelectChange('condition', val)}
                        />

                        {/* Trạng thái — chỉ hiện ở outer grid khi KHÔNG phải SIM (SIM có trạng thái riêng trong SIM section) */}
                        {typeCode !== 'SIM' && (
                          <SelectBox
                            label="Trạng thái (Vận hành)"
                            value={formData.status}
                            options={ASSET_STATUSES}
                            onChange={(val) => handleSelectChange('status', val)}
                          />
                        )}

                        {/* Desktop Specific Fields (CPU, MAIN, RAM, Ổ CỨNG, VGA, NGUỒN) */}
                        {typeCode === 'DESKTOP' && (
                          <div className="sm:col-span-2 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 bg-primary-50/50 p-4 rounded-xl border border-primary-100 mb-4">
                            <div className="sm:col-span-2">
                              <h4 className="text-sm font-semibold text-primary-900 flex items-center gap-2">
                                <div className="w-2 h-2 bg-primary-500 rounded-full"></div>
                                Cấu hình chi tiết (Máy tính để bàn)
                              </h4>
                            </div>
                            
                            {/* CPU */}
                            <div>
                              <label htmlFor="cpu" className="block text-sm font-medium text-gray-700">Cpu</label>
                              <input type="text" name="cpu" id="cpu" value={formData.cpu} onChange={handleChange} className="input-field mt-1" placeholder="VD: Core i7-13700K" />
                            </div>

                            {/* Mainboard */}
                            <div>
                              <label htmlFor="mainboard" className="block text-sm font-medium text-gray-700">Main</label>
                              <input type="text" name="mainboard" id="mainboard" value={formData.mainboard} onChange={handleChange} className="input-field mt-1" placeholder="VD: ASUS Z790-P" />
                            </div>

                            {/* RAM */}
                            <div>
                              <label htmlFor="ram" className="block text-sm font-medium text-gray-700">Ram</label>
                              <input type="text" name="ram" id="ram" value={formData.ram} onChange={handleChange} className="input-field mt-1" placeholder="VD: 32GB (16GBx2) DDR5" />
                            </div>

                            {/* Storage */}
                            <div>
                              <label htmlFor="storage" className="block text-sm font-medium text-gray-700">Ổ cứng</label>
                              <input type="text" name="storage" id="storage" value={formData.storage} onChange={handleChange} className="input-field mt-1" placeholder="VD: SSD 1TB Samsung 980 Pro" />
                            </div>

                            {/* VGA */}
                            <div>
                              <label htmlFor="vga" className="block text-sm font-medium text-gray-700">Vga</label>
                              <input type="text" name="vga" id="vga" value={formData.vga} onChange={handleChange} className="input-field mt-1" placeholder="VD: RTX 4070 Ti 12GB" />
                            </div>

                            {/* Power Supply */}
                            <div>
                              <label htmlFor="power_supply" className="block text-sm font-medium text-gray-700">Nguồn</label>
                              <input type="text" name="power_supply" id="power_supply" value={formData.power_supply} onChange={handleChange} className="input-field mt-1" placeholder="VD: Corsair RM850e 850W" />
                            </div>
                          </div>
                        )}

                        {/* MONITOR Specific Fields (Số lượng) */}
                        {isMultiHolderType(typeCode) && (
                          <div className="sm:col-span-2 bg-violet-50/60 p-4 rounded-xl border border-violet-100 mb-4">
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-violet-500 mb-3 flex items-center gap-1.5">
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

                        {/* SIM Specific Fields (Số điện thoại, Nhà mạng) */}
                        {typeCode === 'SIM' && (
                          <div className="sm:col-span-2 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 mb-4">
                            <div className="sm:col-span-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <h4 className="text-sm font-semibold text-emerald-900 flex items-center gap-2">
                                  <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                                  Thông tin Sim
                                </h4>
                                {handoverEmployeeId && (
                                  <button
                                    type="button"
                                    onClick={handleUpdateSimFromRecipient}
                                    disabled={isUpdatingSimRecipient}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    <ArrowPathIcon className={`h-3.5 w-3.5 ${isUpdatingSimRecipient ? 'animate-spin' : ''}`} />
                                    {isUpdatingSimRecipient ? 'Đang cập nhật...' : 'Cập nhật theo người được bàn giao'}
                                  </button>
                                )}
                              </div>
                              {handoverEmployeeId && handoverEmployeeName && (
                                <p className="mt-1 text-xs text-emerald-700">
                                  Lấy thông tin từ: {handoverEmployeeName}
                                </p>
                              )}
                            </div>

                            {/* Trạng thái Sim — đặt vào đây để tạo cặp với Số điện thoại */}
                            <SelectBox
                              label="Trạng thái Sim"
                              value={formData.status}
                              options={SIM_STATUSES}
                              onChange={(val) => handleSelectChange('status', val)}
                            />

                            <div>
                              <label htmlFor="phone_number" className="block text-sm font-medium text-gray-700">Số điện thoại</label>
                              <input type="text" name="phone_number" id="phone_number" value={(formData as any).phone_number} onChange={handleChange} className="input-field mt-1" placeholder="VD: 0912345678" />
                              {(formData as any).phone_number && !/^\d{10}$/.test(((formData as any).phone_number || '').trim()) && (
                                <p className="mt-1 text-xs text-red-500">Số điện thoại phải gồm đúng 10 chữ số.</p>
                              )}
                            </div>

                            <SelectBox
                              label="Nhà mạng"
                              value={(formData as any).network_provider}
                              options={NETWORK_PROVIDERS}
                              onChange={(val) => handleSelectChange('network_provider', val)}
                            />

                            <SelectBox
                              label="Phân loại Sim"
                              value={(formData as any).sim_type}
                              options={SIM_TYPES}
                              onChange={(val) => handleSelectChange('sim_type', val)}
                            />

                            <div>
                              <label htmlFor="doctor" className="block text-sm font-medium text-gray-700">Bác sĩ</label>
                              <input type="text" name="doctor" id="doctor" value={(formData as any).doctor} onChange={handleChange} className="input-field mt-1" placeholder="VD: Nguyễn Văn A" />
                            </div>

                            <SelectBox
                              label="Vùng miền"
                              value={(formData as any).region}
                              options={REGIONS}
                              onChange={(val) => handleSelectChange('region', val)}
                              placeholder="-- Chọn vùng miền --"
                            />

                            <SelectBox
                              label="Vị trí"
                              value={(formData as any).position_id}
                              options={positions}
                              onChange={(val) => handleSelectChange('position_id', val)}
                              placeholder="-- Chọn vị trí --"
                              searchable
                            />

                            <SelectBox
                              label="Công ty"
                              value={(formData as any).sim_company}
                              options={companyUnits}
                              onChange={(val) => handleSelectChange('sim_company', val)}
                              placeholder="-- Chọn công ty --"
                              searchable
                            />

                            <div>
                              <label htmlFor="cancellation_report_date" className="block text-sm font-medium text-gray-700">Ngày báo huỷ</label>
                              <input type="date" name="cancellation_report_date" id="cancellation_report_date" value={(formData as any).cancellation_report_date} onChange={handleChange} className="input-field mt-1" />
                            </div>
                          </div>
                        )}

                        {/* OTHER Specific Fields (Tên loại chi tiết) */}
                        {typeCode === 'OTHER' && (
                          <div className="sm:col-span-2 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 bg-gray-50/50 p-4 rounded-xl border border-gray-200 mb-4">
                            <div className="sm:col-span-2">
                              <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-1">
                                <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                                Tên loại tài sản (Khác)
                              </h4>
                            </div>
                            <div className="sm:col-span-2">
                              <input
                                type="text"
                                name="other_type_name"
                                id="other_type_name"
                                value={(formData as any).other_type_name}
                                onChange={handleChange}
                                className="input-field mt-1"
                                placeholder="Ví dụ: Máy chiếu, Camera, Bàn làm việc..."
                              />
                            </div>
                          </div>
                        )}


                        {/* Model */}
                        {!['SIM', 'FURNITURE'].includes(typeCode) && (
                          <div>
                            <label htmlFor="model" className="block text-sm font-medium text-gray-700">Model</label>
                            <input type="text" name="model" id="model" value={formData.model} onChange={handleChange} className="input-field mt-1" />
                          </div>
                        )}

                        {/* Nhà cung cấp */}
                        <div>
                          <label htmlFor="supplier" className="block text-sm font-medium text-gray-700">Nhà cung cấp</label>
                          <input type="text" name="supplier" id="supplier" value={formData.supplier} onChange={handleChange} className="input-field mt-1" />
                        </div>

                        {/* Ngày mua */}
                        <div>
                          <label htmlFor="purchase_date" className="block text-sm font-medium text-gray-700">Ngày mua</label>
                          <input type="date" name="purchase_date" id="purchase_date" value={formData.purchase_date} onChange={handleChange} className="input-field mt-1" />
                        </div>

                        {/* Thời hạn bảo hành */}
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

                        {/* Phòng ban quản lý */}
                        <SelectBox label="Phòng ban quản lý" value={formData.department} options={departments} onChange={(val) => handleSelectChange('department', val)} placeholder="-- Chọn phòng ban --" />

                        {/* Người quản lý (Kho) */}
                        {formData.department && (
                          <SelectBox label="Người quản lý (Kho)" value={formData.managed_by} options={employees} onChange={(val) => handleSelectChange('managed_by', val)} placeholder="-- Chọn người quản lý --" />
                        )}

                        {/* Thông tin sử dụng thực tế — khác Phòng ban quản lý (kho) ở trên */}
                        <div className="sm:col-span-2 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 bg-sky-50/60 p-4 rounded-xl border border-sky-100">
                          <div className="sm:col-span-2">
                            <h4 className="text-[11px] font-semibold text-sky-600 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 bg-sky-500 rounded-full"></div>
                              Thông tin sử dụng thực tế
                            </h4>
                          </div>
                          <div>
                            <label htmlFor="dimensions" className="block text-sm font-medium text-gray-700">Kích thước</label>
                            <input type="text" name="dimensions" id="dimensions" value={formData.dimensions} onChange={handleChange} className="input-field mt-1" placeholder="VD: 120x60x75cm" />
                          </div>
                          <div>
                            <label htmlFor="usage_area" className="block text-sm font-medium text-gray-700">Khu vực sử dụng</label>
                            <input type="text" name="usage_area" id="usage_area" value={formData.usage_area} onChange={handleChange} className="input-field mt-1" placeholder="VD: Tầng 2 - Phòng khám" />
                          </div>
                          <SelectBox
                            label="Phòng ban sử dụng"
                            value={formData.usage_department}
                            options={departments}
                            onChange={(val) => handleSelectChange('usage_department', val)}
                            placeholder="-- Chọn phòng ban sử dụng --"
                            searchable
                          />
                          <div>
                            <label htmlFor="facility_code" className="block text-sm font-medium text-gray-700">Mã cơ sở</label>
                            <input type="text" name="facility_code" id="facility_code" value={formData.facility_code} onChange={handleChange} className="input-field mt-1" placeholder="VD: CS01" />
                          </div>
                        </div>

                        {/* Khấu hao tài sản */}
                        <div className="sm:col-span-2 bg-amber-50/60 p-4 rounded-xl border border-amber-100">
                          <h4 className="text-[11px] font-semibold text-amber-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 bg-amber-500 rounded-full"></div>
                            Khấu hao tài sản
                          </h4>
                          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                            <div>
                              <label htmlFor="purchase_price" className="block text-sm font-medium text-gray-700">Giá trị khi mua</label>
                              <input type="number" name="purchase_price" id="purchase_price" min="0" step="1000"
                                value={formData.purchase_price} onChange={handleChange}
                                className="input-field mt-1" placeholder="VD: 24000000" />
                            </div>
                            <div>
                              <label htmlFor="depreciation_period_months" className="block text-sm font-medium text-gray-700">Thời gian khấu hao (tháng)</label>
                              <input type="number" name="depreciation_period_months" id="depreciation_period_months" min="0" step="1"
                                value={formData.depreciation_period_months} onChange={handleChange}
                                className="input-field mt-1" placeholder="VD: 36" />
                            </div>
                            <SelectBox
                              label="Phương pháp khấu hao"
                              value={formData.depreciation_method}
                              options={DEPRECIATION_METHODS}
                              onChange={(val) => handleSelectChange('depreciation_method', val)}
                            />
                            {(computedDepreciation.monthly != null || computedDepreciation.current != null) && (
                              <div className="flex flex-col justify-center text-xs text-gray-500 gap-0.5">
                                {computedDepreciation.monthly != null && (
                                  <span>Mức khấu hao/tháng: <span className="font-medium text-gray-700">{Number(computedDepreciation.monthly).toLocaleString('vi-VN')} đ</span></span>
                                )}
                                {computedDepreciation.current != null && (
                                  <span>Giá trị hiện tại: <span className="font-medium text-gray-700">{Number(computedDepreciation.current).toLocaleString('vi-VN')} đ</span></span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Hình ảnh tài sản */}
                        <div className="sm:col-span-2 bg-gray-50/60 p-4 rounded-xl border border-gray-200">
                          <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 bg-gray-500 rounded-full"></div>
                            Hình ảnh tài sản
                          </h4>
                          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                            <div>
                              <label htmlFor="purchase_image" className="block text-sm font-medium text-gray-700">Hình ảnh tài sản mới mua</label>
                              {purchaseImageUrl && !clearPurchaseImage && !purchaseImageFile && (
                                <div className="mt-1 flex items-center gap-2">
                                  <img src={purchaseImageUrl} alt="Ảnh mới mua" className="h-14 w-14 object-cover rounded-lg border border-gray-200" />
                                  <button type="button" onClick={() => setClearPurchaseImage(true)} className="text-xs text-red-600 hover:underline">Xoá ảnh</button>
                                </div>
                              )}
                              <input type="file" accept="image/*" name="purchase_image" id="purchase_image"
                                onChange={(e) => { setPurchaseImageFile(e.target.files?.[0] || null); setClearPurchaseImage(false); }}
                                className="input-field mt-1 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100" />
                              {purchaseImageFile && <p className="mt-1 text-xs text-gray-500 truncate">{purchaseImageFile.name}</p>}
                            </div>
                            <div>
                              <label htmlFor="current_image" className="block text-sm font-medium text-gray-700">Hình ảnh tài sản hiện tại</label>
                              {currentImageUrl && !clearCurrentImage && !currentImageFile && (
                                <div className="mt-1 flex items-center gap-2">
                                  <img src={currentImageUrl} alt="Ảnh hiện tại" className="h-14 w-14 object-cover rounded-lg border border-gray-200" />
                                  <button type="button" onClick={() => setClearCurrentImage(true)} className="text-xs text-red-600 hover:underline">Xoá ảnh</button>
                                </div>
                              )}
                              <input type="file" accept="image/*" name="current_image" id="current_image"
                                onChange={(e) => { setCurrentImageFile(e.target.files?.[0] || null); setClearCurrentImage(false); }}
                                className="input-field mt-1 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100" />
                              {currentImageFile && <p className="mt-1 text-xs text-gray-500 truncate">{currentImageFile.name}</p>}
                            </div>
                          </div>
                        </div>

                        {/* Mô tả / Ghi chú */}
                        <div className="sm:col-span-2">
                          <label htmlFor="description" className="block text-sm font-medium text-gray-700">Mô tả / Ghi chú</label>
                          <textarea id="description" name="description" rows={3} value={formData.description} onChange={handleChange} className="input-field mt-1" />
                        </div>
                      </div>

                    </form>
                  </div>
                </div>
                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
                  <button type="button" className="btn-secondary" onClick={onClose}>Hủy</button>
                  <button
                    type="submit"
                    form="asset-edit-form"
                    disabled={loading || !isFormValid()}
                    onClick={handleSubmit as any}
                    className={`btn-primary disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {loading ? 'Đang lưu...' : 'Lưu thay đổi'}
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
        title="Không thể cập nhật tài sản"
        message={errorMessage || ''}
        onClose={() => setErrorMessage(null)}
      />
    </Transition>
  );
}
