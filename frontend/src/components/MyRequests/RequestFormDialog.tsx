import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { SelectBox } from '../LandingLayout/SelectBox';
import { companyUnitsAPI } from '../../utils/api';
import { CompanyUnit } from '../../utils/api/types';
import genericRequestService, {
  GenericRequest,
  GenericRequestPayload,
  GenericRequestType,
} from '../../services/genericRequest.service';

interface Props {
  open: boolean;
  editing?: GenericRequest | null;
  /**
   * 'creator' — NV tạo/sửa đơn của chính mình (mặc định)
   * 'admin'   — Admin override 3 trường Chức vụ / Phòng ban / Hình thức LV
   *             ở trạng thái PENDING_ADMIN; các trường khác disabled
   */
  editMode?: 'creator' | 'admin';
  onClose: () => void;
  onSaved: () => void;
}

const REQUEST_TYPES: { value: GenericRequestType; label: string }[] = [
  { value: 'PROPOSAL', label: 'Đơn đề xuất' },
  { value: 'CONFIRMATION', label: 'Đơn xác nhận' },
  { value: 'COMPLAINT', label: 'Đơn khiếu nại / phản ánh' },
  { value: 'RESIGNATION', label: 'Đơn xin nghỉ việc' },
  { value: 'OTHER', label: 'Đơn khác' },
];

const TYPE_DEFAULT_TITLE: Record<GenericRequestType, string> = {
  PROPOSAL: 'Đơn đề xuất',
  CONFIRMATION: 'Đơn xác nhận',
  COMPLAINT: 'Đơn khiếu nại',
  RESIGNATION: 'Đơn xin nghỉ việc',
  SALARY_ADVANCE: 'Đơn tạm ứng lương',
  OTHER: 'Đơn khác',
};

const RequestFormDialog: React.FC<Props> = ({
  open,
  editing,
  editMode = 'creator',
  onClose,
  onSaved,
}) => {
  const isAdminMode = editMode === 'admin';
  const [requestType, setRequestType] = useState<GenericRequestType>('RESIGNATION');
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [extraData, setExtraData] = useState<Record<string, any>>({});
  const [companyUnitId, setCompanyUnitId] = useState<number | ''>('');
  const [companyUnits, setCompanyUnits] = useState<CompanyUnit[]>([]);
  // Admin override fields
  const [positionOverride, setPositionOverride] = useState('');
  const [departmentOverride, setDepartmentOverride] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');

  // Load danh sách đơn vị một lần khi mở dialog
  useEffect(() => {
    if (!open) return;
    if (companyUnits.length > 0) return;
    companyUnitsAPI.list({ active_only: true, page_size: 100 })
      .then((res: any) => {
        const list = Array.isArray(res) ? res : (res?.results || []);
        setCompanyUnits(list);
      })
      .catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setRequestType(editing.request_type);
      setTitle(editing.title || '');
      setReason(editing.reason || '');
      setExpectedDate(editing.expected_date || '');
      setExtraData(editing.extra_data || {});
      setCompanyUnitId(editing.extra_data?.company_unit_id || '');
      setPositionOverride(editing.extra_data?.position_override || '');
      setDepartmentOverride(editing.extra_data?.department_override || '');
    } else {
      setRequestType('PROPOSAL');
      setTitle(TYPE_DEFAULT_TITLE.PROPOSAL);
      setReason('');
      setExpectedDate('');
      setExtraData({});
      setCompanyUnitId('');
      setPositionOverride('');
      setDepartmentOverride('');
    }
    setError('');
  }, [open, editing]);

  const handleTypeChange = (val: GenericRequestType) => {
    setRequestType(val);
    if (!editing) setTitle(TYPE_DEFAULT_TITLE[val]);
    setExtraData({});
  };

  const validate = (): string => {
    // Admin mode: chỉ validate các trường editable (work_form)
    if (isAdminMode) {
      if (requestType === 'RESIGNATION' && !extraData.work_form) {
        return 'Vui lòng chọn hình thức làm việc';
      }
      return '';
    }
    // Creator mode: validate toàn bộ
    if (requestType !== 'RESIGNATION' && !title.trim()) return 'Vui lòng nhập tiêu đề';
    if (!reason.trim()) return 'Vui lòng nhập lý do';
    if (requestType === 'RESIGNATION' && !expectedDate) {
      return 'Vui lòng chọn ngày nghỉ việc dự kiến';
    }
    if (requestType === 'RESIGNATION' && !companyUnitId) {
      return 'Vui lòng chọn đơn vị làm việc';
    }
    if (requestType === 'RESIGNATION' && !extraData.work_form) {
      return 'Vui lòng chọn hình thức làm việc';
    }
    return '';
  };

  const buildPayload = (): GenericRequestPayload => {
    const selectedUnit = companyUnits.find((u) => u.id === companyUnitId);
    // RESIGNATION: auto fill title theo mẫu cố định (form Word đã có header sẵn)
    const finalTitle = requestType === 'RESIGNATION'
      ? `Đơn xin nghỉ việc${selectedUnit ? ' - ' + selectedUnit.name : ''}`
      : title.trim();

    const mergedExtraData: Record<string, any> = {
      ...extraData,
      ...(companyUnitId
        ? {
          company_unit_id: companyUnitId,
          company_unit_code: selectedUnit?.code,
          company_unit_name: selectedUnit?.name,
        }
        : {}),
      // Admin override 2 trường Chức vụ / Phòng ban (chỉ khi admin mode)
      ...(isAdminMode
        ? {
          position_override: positionOverride.trim(),
          department_override: departmentOverride.trim(),
        }
        : {}),
    };

    return {
      request_type: requestType,
      title: finalTitle,
      reason: reason.trim(),
      expected_date: expectedDate || null,
      extra_data: mergedExtraData,
    };
  };

  const handleSave = async (submitAfter: boolean) => {
    const errMsg = validate();
    if (errMsg) {
      setError(errMsg);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      let saved: GenericRequest;
      if (editing) {
        // Admin mode: chỉ gửi extra_data (BE cũng whitelist thêm 1 lớp nữa)
        const payload = isAdminMode
          ? ({ extra_data: buildPayload().extra_data } as Partial<GenericRequestPayload>)
          : buildPayload();
        saved = await genericRequestService.update(editing.id, payload);
      } else {
        saved = await genericRequestService.create(buildPayload());
      }
      if (submitAfter && saved.status === 'DRAFT') {
        await genericRequestService.submit(saved.id);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.detail
        || (typeof e?.response?.data === 'object' ? JSON.stringify(e.response.data) : '')
        || e?.message
        || 'Có lỗi xảy ra';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-auto flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">
            {isAdminMode
              ? 'Admin chỉnh sửa đơn'
              : editing
                ? 'Chỉnh sửa đơn'
                : 'Tạo đơn mới'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 px-6 py-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
              {error}
            </div>
          )}

          {isAdminMode && (
            <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded">
              Chế độ <strong>Admin</strong> — bạn chỉ có thể chỉnh <strong>Chức vụ</strong>,
              {' '}<strong>Phòng ban/bộ phận</strong> và <strong>Hình thức làm việc</strong>.
              Các trường khác hiển thị để đối chiếu và không thể thay đổi.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Loại đơn <span className="text-red-500">*</span>
            </label>
            {editing || isAdminMode ? (
              <div className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-100 text-sm text-gray-700">
                {REQUEST_TYPES.find((t) => t.value === requestType)?.label}
              </div>
            ) : (
              <SelectBox<GenericRequestType>
                label=""
                value={requestType}
                options={REQUEST_TYPES}
                onChange={(v) => handleTypeChange(v)}
              />
            )}
          </div>

          {/* 2026-09-25: case thực tế NV02757 tạo "Đơn công tác"/"Đơn nghỉ phép" qua
              "Đơn khác" — đơn loại này KHÔNG tích hợp với hệ thống chấm công, dù được
              duyệt cũng không có tác dụng gì với bảng công/lương, khiến NV tưởng đã
              xin phép thành công nhưng thực ra không. Cảnh báo ngay khi chọn "Đơn khác"
              để tránh nhầm lẫn tương tự. */}
          {requestType === 'OTHER' && !editing && (
            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg">
              <strong>Lưu ý:</strong> "Đơn khác" không được tính vào chấm công/lương, kể cả khi được duyệt.
              Nếu bạn muốn <strong>đi công tác</strong> hoặc <strong>xin nghỉ phép</strong>, hãy vào trang{' '}
              <strong>Chấm công</strong>, chọn đúng ngày và tạo đơn "Đi công tác" / "Nghỉ phép tháng" ở đó
              — đơn tạo ở đây sẽ không ảnh hưởng đến bảng công của bạn.
            </div>
          )}

          {requestType !== 'RESIGNATION' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tiêu đề <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                disabled={isAdminMode}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: Đơn đề xuất mua thiết bị"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-600 disabled:cursor-not-allowed"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {requestType === 'RESIGNATION' ? 'Ngày nghỉ việc dự kiến' : 'Ngày dự kiến'}
              {requestType === 'RESIGNATION' && <span className="text-red-500"> *</span>}
            </label>
            <input
              type="date"
              value={expectedDate}
              disabled={isAdminMode}
              onChange={(e) => setExpectedDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-600 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lý do <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={4}
              value={reason}
              disabled={isAdminMode}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Mô tả chi tiết lý do làm đơn..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-600 disabled:cursor-not-allowed"
            />
          </div>

          {requestType === 'RESIGNATION' && (
            <div>
              {isAdminMode ? (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Đơn vị làm việc <span className="text-red-500">*</span>
                  </label>
                  <div className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-100 text-sm text-gray-700">
                    {companyUnits.find((u) => u.id === companyUnitId)?.name
                      || editing?.extra_data?.company_unit_name
                      || '—'}
                  </div>
                </>
              ) : (
                <>
                  <SelectBox<number | ''>
                    label="Đơn vị làm việc *"
                    value={companyUnitId}
                    options={companyUnits.map((u) => ({ value: u.id as number | '', label: u.name }))}
                    onChange={(v) => setCompanyUnitId(v)}
                    placeholder="-- Chọn đơn vị --"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Hệ thống sẽ tự động lấy mẫu đơn theo đơn vị bạn chọn
                  </p>
                </>
              )}
            </div>
          )}

          {requestType === 'RESIGNATION' && (
            <div>
              <SelectBox<string>
                label="Hình thức làm việc *"
                value={extraData.work_form || ''}
                options={[
                  { value: 'PROBATION', label: 'Thử việc' },
                  { value: 'OFFICIAL', label: 'Chính thức' },
                ]}
                onChange={(v) => setExtraData({ ...extraData, work_form: v })}
                placeholder="-- Chọn hình thức --"
              />
            </div>
          )}

          {/* Admin override: Chức vụ + Phòng ban — chỉ hiện ở admin mode */}
          {isAdminMode && requestType === 'RESIGNATION' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Chức vụ
                </label>
                <input
                  type="text"
                  value={positionOverride}
                  onChange={(e) => setPositionOverride(e.target.value)}
                  placeholder={editing?.employee_position || 'VD: Nhân viên kinh doanh'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Mặc định từ hồ sơ:{' '}
                  <span className="font-medium text-gray-700">
                    {editing?.employee_position || '(trống)'}
                  </span>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phòng ban/bộ phận
                </label>
                <input
                  type="text"
                  value={departmentOverride}
                  onChange={(e) => setDepartmentOverride(e.target.value)}
                  placeholder={editing?.employee_department || 'VD: Phòng Kinh doanh'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Mặc định từ hồ sơ:{' '}
                  <span className="font-medium text-gray-700">
                    {editing?.employee_department || '(trống)'}
                  </span>
                </p>
              </div>
            </>
          )}

          {/* {requestType === 'RESIGNATION' && (
            <div className="space-y-3 p-3 bg-blue-50 rounded-lg">
              <h4 className="text-sm font-semibold text-blue-900">Thông tin bàn giao</h4>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Người tiếp nhận bàn giao</label>
                <input
                  type="text"
                  value={extraData.handover_to || ''}
                  onChange={(e) => setExtraData({ ...extraData, handover_to: e.target.value })}
                  placeholder="Họ tên người được bàn giao"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Góp ý / Phản hồi</label>
                <textarea
                  rows={2}
                  value={extraData.feedback || ''}
                  onChange={(e) => setExtraData({ ...extraData, feedback: e.target.value })}
                  placeholder="Phản hồi cho công ty (nếu có)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>
          )} */}

          {requestType === 'PROPOSAL' && (
            <div className="space-y-3 p-3 bg-green-50 rounded-lg">
              <h4 className="text-sm font-semibold text-green-900">Chi tiết đề xuất</h4>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Phân loại</label>
                <input
                  type="text"
                  value={extraData.category || ''}
                  onChange={(e) => setExtraData({ ...extraData, category: e.target.value })}
                  placeholder="VD: Mua thiết bị, cải tiến quy trình..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Chi phí ước tính (VNĐ)</label>
                <input
                  type="number"
                  value={extraData.estimated_cost || ''}
                  onChange={(e) => setExtraData({ ...extraData, estimated_cost: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {(() => {
          const validationError = validate();
          const canSubmit = !validationError && !submitting;
          return (
            <div className="px-6 py-4 border-t flex justify-end gap-2 bg-gray-50">
              <button
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Huỷ
              </button>
              {isAdminMode ? (
                <button
                  onClick={() => handleSave(false)}
                  disabled={!canSubmit}
                  title={validationError || 'Lưu thay đổi'}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Đang lưu...' : 'Lưu'}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleSave(false)}
                    disabled={submitting}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Lưu nháp
                  </button>
                  <button
                    onClick={() => handleSave(true)}
                    disabled={!canSubmit}
                    title={validationError || 'Gửi đơn để duyệt'}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Đang lưu...' : 'Gửi duyệt'}
                  </button>
                </>
              )}
            </div>
          );
        })()}
      </div>
    </div>,
    document.body
  );
};

export default RequestFormDialog;
