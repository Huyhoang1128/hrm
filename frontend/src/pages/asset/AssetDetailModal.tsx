import React, { Fragment, useState, useEffect } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { XMarkIcon, ComputerDesktopIcon, CalendarIcon, UserIcon, BuildingOfficeIcon, ShieldCheckIcon, ShoppingBagIcon, CpuChipIcon, ServerStackIcon, Square3Stack3DIcon, CircleStackIcon, DeviceTabletIcon, BoltIcon, ArrowUturnLeftIcon, IdentificationIcon, TagIcon, BuildingStorefrontIcon, SparklesIcon, ClockIcon, UserPlusIcon, XCircleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { Asset, AssetAssignmentHistory, positionsAPI, assetsAPI } from '../../utils/api';
import AssetReturnModal from './AssetReturnModal';

interface AssetDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
  onAfterReturn?: () => void;
  viewMode?: 'manager' | 'employee';
}

export default function AssetDetailModal({ isOpen, onClose, asset, onAfterReturn, viewMode = 'manager' }: AssetDetailModalProps) {
  if (!asset) return null;

  const [positionName, setPositionName] = useState<string>('');
  const [history, setHistory] = useState<AssetAssignmentHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [returnTarget, setReturnTarget] = useState<{ historyId: number; holderName: string; assignedQuantity: number } | null>(null);
  const MULTI_HOLDER_TYPES = ['MONITOR', 'OTHER'];
  const isMultiHolder = MULTI_HOLDER_TYPES.includes(asset.asset_type) && (asset.total_quantity ?? 1) > 1;
  const holders = asset.holders || [];
  const isManager = viewMode === 'manager';
  const isEmployee = viewMode === 'employee';

  useEffect(() => {
    const posId = (asset?.specifications as any)?.position_id;
    if (isOpen && asset?.asset_type === 'SIM' && posId) {
      positionsAPI.list({ page_size: 200 })
        .then(data => {
          const found = (data.results || []).find((p: any) => String(p.id) === String(posId));
          setPositionName(found?.title || String(posId));
        })
        .catch(() => setPositionName(String(posId)));
    } else {
      setPositionName('');
    }
  }, [isOpen, asset]);

  useEffect(() => {
    if (isOpen && asset?.id) {
      setHistoryLoading(true);
      assetsAPI.assignmentHistory(asset.id, { page_size: 50 })
        .then((data: any) => {
          const list = Array.isArray(data) ? data : (data?.results || []);
          const sorted = [...list].sort((a, b) => {
            const da = new Date(a.assigned_date || a.created_at || 0).getTime();
            const db = new Date(b.assigned_date || b.created_at || 0).getTime();
            return db - da;
          });
          setHistory(sorted);
        })
        .catch((err) => {
          console.error('Error fetching assignment history:', err);
          setHistory([]);
        })
        .finally(() => setHistoryLoading(false));
    } else {
      setHistory([]);
    }
  }, [isOpen, asset?.id]);

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('vi-VN');
  };

  // Label chung cho mọi loại tài sản
  const receivedDateLabel = (_assetType?: string) => 'Nhận tài sản ngày';

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'IN_USE':
        return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
      case 'IDLE':
        return 'bg-amber-100 text-amber-800 border border-amber-200';
      case 'UNDER_MAINTENANCE':
        return 'bg-primary-100 text-primary-800 border border-primary-200';
      case 'DAMAGED':
        return 'bg-red-100 text-red-800 border border-red-200';
      case 'RETIRED':
        return 'bg-gray-100 text-gray-800 border border-gray-200';
      case 'NEW':
        return 'bg-violet-100 text-violet-800 border border-violet-200';
      default:
        return 'bg-gray-100 text-gray-800 border border-gray-200';
    }
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'EXCELLENT':
        return 'bg-violet-100 text-violet-800 border border-violet-200';
      case 'GOOD':
        return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
      case 'FAIR':
        return 'bg-amber-100 text-amber-800 border border-amber-200';
      case 'POOR':
        return 'bg-amber-100 text-amber-800 border border-amber-200';
      case 'BROKEN':
        return 'bg-red-100 text-red-800 border border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border border-gray-200';
    }
  };

  return (
    <>
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
              <DialogPanel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-3xl">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
                      <ComputerDesktopIcon className="h-5 w-5" />
                    </div>
                    <DialogTitle as="h3" className="text-lg font-bold leading-6 text-gray-900">
                      Chi tiết tài sản: {asset.asset_code}
                    </DialogTitle>
                  </div>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors outline-none text-gray-500"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="px-6 py-6 overflow-y-auto max-h-[80vh]">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                    {/* General Info Section */}
                    {/* Header Identity Section - High prominence for the Asset Code */}
                     <div className="md:col-span-2 bg-gradient-to-r from-primary-50 to-white p-5 rounded-2xl border border-primary-100 flex items-center justify-between shadow-sm">
                      <div className="flex items-center space-x-4">
                        <div className="bg-primary-600 p-3 rounded-xl shadow-lg shadow-primary-200">
                          <IdentificationIcon className="h-7 w-7 text-white" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-primary-500 uppercase tracking-[0.2em] mb-0.5">Mã thiết bị dán nhãn</p>
                          <h2 className="text-2xl font-black text-gray-900 tracking-tight">{asset.name}</h2>
                        </div>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">ID Hệ thống</p>
                        <code className="text-xs font-mono bg-white px-2 py-1 rounded border border-gray-100 text-gray-500">{asset.asset_code}</code>
                      </div>
                    </div>

                    {/* General Specifications Grid */}
                    <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* Loại tài sản */}
                      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center space-x-3 mb-2">
                          <TagIcon className="h-4 w-4 text-primary-500" />
                          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Loại tài sản</span>
                        </div>
                        <p className="text-sm font-bold text-gray-900">{asset.asset_type_display}</p>
                      </div>

                      {/* Thương hiệu */}
                      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center space-x-3 mb-2">
                          <BuildingStorefrontIcon className="h-4 w-4 text-primary-500" />
                          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Thương hiệu</span>
                        </div>
                        <p className="text-sm font-bold text-gray-900">{asset.brand || ''}</p>
                      </div>

                      {/* Model */}
                      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center space-x-3 mb-2">
                          <ComputerDesktopIcon className="h-4 w-4 text-primary-500" />
                          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Model thiết bị</span>
                        </div>
                        <p className="text-sm font-bold text-gray-900">{asset.model || ''}</p>
                      </div>

                      {/* Tình trạng vật lý */}
                      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center space-x-3 mb-2">
                          <SparklesIcon className="h-4 w-4 text-amber-500" />
                          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Tình trạng vật lý</span>
                        </div>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${getConditionColor(asset.condition)} uppercase tracking-tight`}>
                          {asset.condition_display}
                        </span>
                      </div>
                    </div>

                    {/* Usage & Management Section */}
                    <div className="space-y-4 md:col-span-2">
                      <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest border-b pb-2">
                        {isEmployee ? 'Thông tin tài sản đang giữ' : 'Nhân sự phụ trách'}
                      </h4>

                      {/* MONITOR multi-holder: Manager view — full holder list + Thu hồi buttons */}
                      {isMultiHolder && isManager && (
                        <div className="bg-emerald-50/50 rounded-xl p-4 border border-emerald-100">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                              Đã bàn giao: {asset.assigned_quantity_total ?? 0}/{asset.total_quantity ?? 1}                            </p>
                            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                              Còn {asset.remaining_quantity ?? 0}
                            </span>
                          </div>
                          {holders.length === 0 ? (
                            <p className="text-sm italic text-gray-500">Chưa bàn giao cho nhân viên nào</p>
                          ) : (
                            <div className="space-y-2">
                              {holders.map((h) => (
                                <div
                                  key={h.history_id}
                                  className="bg-white rounded-lg border border-emerald-200 p-3 flex items-start justify-between gap-3"
                                >
                                  <div className="flex items-start gap-3 flex-1">
                                    <div className="bg-emerald-100 p-2 rounded-lg">
                                      <UserIcon className="h-5 w-5 text-emerald-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <p className="text-sm font-bold text-gray-900 truncate">{h.name}</p>
                                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full">
                                          {h.assigned_quantity}                                        </span>
                                      </div>
                                      {h.employee_code && (
                                        <p className="text-xs text-emerald-600 font-mono">{h.employee_code}</p>
                                      )}
                                      {h.department_name && (
                                        <p className="text-xs text-emerald-700 truncate">{h.department_name}</p>
                                      )}
                                      <div className="mt-1 flex items-center text-[11px] text-emerald-600">
                                        <CalendarIcon className="h-3 w-3 mr-1" />
                                        {formatDate(h.assigned_date)}
                                      </div>
                                      {h.assignment_notes && (
                                        <p className="mt-1 text-[11px] italic text-emerald-800 line-clamp-2">
                                          "{h.assignment_notes}"
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setReturnTarget({ historyId: h.history_id, holderName: h.name, assignedQuantity: h.assigned_quantity })}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-[11px] font-semibold whitespace-nowrap"
                                  >
                                    <ArrowUturnLeftIcon className="h-3 w-3" />
                                    Thu hồi
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Manager multi-holder: quản lý kho full-width ngang hàng với holder section */}
                      {isMultiHolder && isManager && (
                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex items-center space-x-4">
                          <div className="bg-slate-200 p-2.5 rounded-lg">
                            <ShieldCheckIcon className="h-6 w-6 text-slate-600" />
                          </div>
                          <div className="flex-1 flex items-center justify-between flex-wrap gap-2">
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Đơn vị quản lý kho</p>
                              <p className="text-base font-bold text-gray-900">{asset.managed_by_name || 'Hệ thống tự động'}</p>
                              {asset.managed_by_employee_id && (
                                <p className="text-xs text-slate-500 font-mono">{asset.managed_by_employee_id}</p>
                              )}
                              <p className="text-sm text-slate-600">{asset.department_name || 'Bộ phận: Chưa xác định'}</p>
                            </div>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusColor(asset.status)} uppercase tracking-tight`}>
                              {asset.status_display}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Non-multi-holder / Employee: 2-column grid */}
                      {!(isMultiHolder && isManager) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Card trái: Người sử dụng / Số lượng đang giữ */}
                        <div className="bg-emerald-50/50 rounded-xl p-4 border border-emerald-100 flex items-start space-x-4">
                          <div className="bg-emerald-100 p-2.5 rounded-lg">
                            <UserIcon className="h-6 w-6 text-emerald-600" />
                          </div>
                          <div className="flex-1">
                            {isMultiHolder && isEmployee ? (
                              <>
                                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Số lượng đang giữ</p>
                                <p className="text-base font-bold text-gray-900">{(asset as any).my_assigned_quantity ?? 1}</p>
                                <div className="mt-2 flex items-center text-xs text-emerald-600 font-medium">
                                  <CalendarIcon className="h-3 w-3 mr-1" />
                                  {receivedDateLabel(asset.asset_type)}: {formatDate(asset.assigned_date)}
                                </div>
                                {(asset as any).assignment_notes && (
                                  <div className="mt-2 rounded-lg bg-white/70 border border-emerald-100 px-2 py-1.5">
                                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-0.5">Ghi chú bàn giao</p>
                                    <p className="text-xs italic text-emerald-900 leading-relaxed">{(asset as any).assignment_notes}</p>
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Người đang sử dụng</p>
                                {asset.assigned_to_name ? (
                                  <>
                                    <p className="text-base font-bold text-gray-900">{asset.assigned_to_name}</p>
                                    {asset.assigned_to_employee_id && (
                                      <p className="text-xs text-emerald-600 font-mono">{asset.assigned_to_employee_id}</p>
                                    )}
                                    <p className="text-sm text-emerald-700">{asset.assigned_to_department_name || 'Phòng ban: -'}</p>
                                    <div className="mt-2 flex items-center text-xs text-emerald-600 font-medium">
                                      <CalendarIcon className="h-3 w-3 mr-1" />
                                      {receivedDateLabel(asset.asset_type)}: {formatDate(asset.assigned_date)}
                                    </div>
                                    {(() => {
                                      const currentHandover = history.find(
                                        (h) => h.status === 'CONFIRMED' && h.assigned_to_name === asset.assigned_to_name,
                                      );
                                      return currentHandover?.assignment_notes ? (
                                        <div className="mt-2 rounded-lg bg-white/70 border border-emerald-100 px-2 py-1.5">
                                          <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-0.5">Ghi chú bàn giao</p>
                                          <p className="text-xs italic text-emerald-900 leading-relaxed">{currentHandover.assignment_notes}</p>
                                        </div>
                                      ) : null;
                                    })()}
                                  </>
                                ) : (
                                  <p className="text-sm font-medium text-gray-500 italic">Chưa bàn giao cho nhân viên</p>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Card phải: Đơn vị quản lý kho */}
                        {isManager ? (
                          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex items-start space-x-4">
                            <div className="bg-slate-200 p-2.5 rounded-lg">
                              <ShieldCheckIcon className="h-6 w-6 text-slate-600" />
                            </div>
                            <div className="flex-1">
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Đơn vị quản lý kho</p>
                              <p className="text-base font-bold text-gray-900">{asset.managed_by_name || 'Hệ thống tự động'}</p>
                              {asset.managed_by_employee_id && (
                                <p className="text-xs text-slate-500 font-mono">{asset.managed_by_employee_id}</p>
                              )}
                              <p className="text-sm text-slate-600">{asset.department_name || 'Bộ phận: Chưa xác định'}</p>
                              <div className="mt-2 flex items-center">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusColor(asset.status)} uppercase tracking-tight`}>
                                  {asset.status_display}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          (asset.managed_by_name || asset.department_name) && (
                            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex items-start space-x-4">
                              <div className="bg-slate-200 p-2.5 rounded-lg">
                                <ShieldCheckIcon className="h-6 w-6 text-slate-600" />
                              </div>
                              <div className="flex-1">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Đơn vị quản lý kho</p>
                                <p className="text-base font-bold text-gray-900">{asset.managed_by_name || 'Hệ thống'}</p>
                                {asset.managed_by_employee_id && (
                                  <p className="text-xs text-slate-500 font-mono">{asset.managed_by_employee_id}</p>
                                )}
                                <p className="text-sm text-slate-600">{asset.department_name || 'Bộ phận: Chưa xác định'}</p>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                      )}

                      {/* Notes Section - Full width within this block */}
                      <div className="flex flex-col gap-4">
                        {asset.description && (
                          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                            <div className="flex items-center space-x-2 mb-2">
                              <SparklesIcon className="h-4 w-4 text-slate-500" />
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Lịch sử & Tình trạng vật tư</p>
                            </div>
                            <p className="text-sm text-gray-700 leading-relaxed italic bg-white/60 p-3 rounded-lg border border-white shadow-sm">
                              {asset.description}
                            </p>
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {(asset as any).assignment_notes && (
                            <div className="bg-emerald-50/30 p-3 rounded-xl border border-emerald-100">
                               <div className="flex items-center space-x-2 mb-1.5">
                                 <ShieldCheckIcon className="h-4 w-4 text-emerald-500" />
                                 <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-tight">Ghi chú bàn giao hiện tại</p>
                               </div>
                               <p className="text-sm text-emerald-800 font-medium ml-6">"{(asset as any).assignment_notes}"</p>
                            </div>
                          )}
                          {(asset as any).return_notes && (
                            <div className="bg-amber-50/30 p-3 rounded-xl border border-amber-100">
                               <div className="flex items-center space-x-2 mb-1.5">
                                 <ArrowUturnLeftIcon className="h-4 w-4 text-amber-500" />
                                 <p className="text-[10px] font-bold text-amber-600 uppercase tracking-tight">Ghi chú thu hồi gần nhất</p>
                               </div>
                               <p className="text-sm text-amber-800 italic font-medium ml-6">"{(asset as any).return_notes}"</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Desktop Configuration - Full width if applicable */}
                    {asset.asset_type === 'DESKTOP' && asset.specifications && (
                      <div className="md:col-span-2 space-y-4">
                        <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest border-b pb-2">Cấu hình máy tính</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {/* CPU */}
                          <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-slate-100 hover:border-primary-200 transition-colors">
                            <div className="bg-primary-100 p-2 rounded-lg">
                              <CpuChipIcon className="h-5 w-5 text-primary-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">CPU</p>
                              <p className="text-sm font-bold text-gray-900 truncate" title={asset.specifications.cpu}>{asset.specifications.cpu || '-'}</p>
                            </div>
                          </div>

                          {/* Mainboard */}
                          <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-slate-100 hover:border-primary-200 transition-colors">
                            <div className="bg-emerald-100 p-2 rounded-lg">
                              <ServerStackIcon className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Mainboard</p>
                              <p className="text-sm font-bold text-gray-900 truncate" title={asset.specifications.mainboard}>{asset.specifications.mainboard || '-'}</p>
                            </div>
                          </div>

                          {/* RAM */}
                          <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-slate-100 hover:border-primary-200 transition-colors">
                            <div className="bg-amber-100 p-2 rounded-lg">
                              <Square3Stack3DIcon className="h-5 w-5 text-amber-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">RAM Capacity</p>
                              <p className="text-sm font-bold text-gray-900 truncate" title={asset.specifications.ram}>{asset.specifications.ram || '-'}</p>
                            </div>
                          </div>

                          {/* Storage */}
                          <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-slate-100 hover:border-primary-200 transition-colors">
                            <div className="bg-primary-100 p-2 rounded-lg">
                              <CircleStackIcon className="h-5 w-5 text-primary-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Ổ cứng</p>
                              <p className="text-sm font-bold text-gray-900 truncate" title={asset.specifications.storage}>{asset.specifications.storage || '-'}</p>
                            </div>
                          </div>

                          {/* VGA */}
                          <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-slate-100 hover:border-primary-200 transition-colors">
                            <div className="bg-rose-100 p-2 rounded-lg">
                              <DeviceTabletIcon className="h-5 w-5 text-rose-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">VGA</p>
                              <p className="text-sm font-bold text-gray-900 truncate" title={asset.specifications.vga}>{asset.specifications.vga || '-'}</p>
                            </div>
                          </div>

                          {/* Power */}
                          <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-slate-100 hover:border-primary-200 transition-colors">
                            <div className="bg-amber-100 p-2 rounded-lg">
                              <BoltIcon className="h-5 w-5 text-amber-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Nguồn</p>
                              <p className="text-sm font-bold text-gray-900 truncate" title={asset.specifications.power_supply}>{asset.specifications.power_supply || '-'}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Multi-holder quantity Information */}
                    {MULTI_HOLDER_TYPES.includes(asset.asset_type) && asset.specifications && isManager && (
                      <div className="md:col-span-2 space-y-4">
                        <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest border-b pb-2">Thông tin số lượng</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="flex items-center space-x-3 bg-violet-50 p-3 rounded-xl border border-violet-100">
                            <div className="bg-violet-100 p-2 rounded-lg">
                              <Square3Stack3DIcon className="h-5 w-5 text-violet-600" />
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">
                                {isEmployee ? 'Số lượng đang giữ' : 'Số lượng'}
                              </p>
                              <p className="text-sm font-bold text-gray-900">
                                {isEmployee
                                  ? `${(asset as any).my_assigned_quantity ?? 1} / ${asset.total_quantity ?? asset.specifications.quantity ?? '-'}`
                                  : `${asset.assigned_quantity_total ?? 0}/${asset.total_quantity ?? asset.specifications.quantity ?? '-'}`
                                }
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SIM Information */}
                    {asset.asset_type === 'SIM' && asset.specifications && (
                      <div className="md:col-span-2 space-y-4">
                        <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest border-b pb-2">Thông tin SIM</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {/* Số điện thoại */}
                          <div className="flex items-center space-x-3 bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                            <div className="bg-emerald-100 p-2 rounded-lg">
                              <BoltIcon className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Số điện thoại</p>
                              <p className="text-sm font-bold text-gray-900">{(asset.specifications as any).phone_number || '-'}</p>
                            </div>
                          </div>
                          {/* Nhà mạng */}
                          <div className="flex items-center space-x-3 bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                            <div className="bg-emerald-100 p-2 rounded-lg">
                              <BuildingOfficeIcon className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Nhà mạng</p>
                              <p className="text-sm font-bold text-gray-900">{(asset.specifications as any).network_provider || '-'}</p>
                            </div>
                          </div>
                          {/* Phân loại Sim */}
                          <div className="flex items-center space-x-3 bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                            <div className="bg-emerald-100 p-2 rounded-lg">
                              <TagIcon className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Phân loại Sim</p>
                              <p className="text-sm font-bold text-gray-900">
                                {(asset.specifications as any).sim_type === 'PREPAID' ? 'Trả trước'
                                  : (asset.specifications as any).sim_type === 'POSTPAID' ? 'Trả sau'
                                  : '-'}
                              </p>
                            </div>
                          </div>
                          {/* Bác sĩ */}
                          <div className="flex items-center space-x-3 bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                            <div className="bg-emerald-100 p-2 rounded-lg">
                              <UserIcon className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Bác sĩ</p>
                              <p className="text-sm font-bold text-gray-900">{(asset.specifications as any).doctor || '-'}</p>
                            </div>
                          </div>
                          {/* Vùng miền */}
                          <div className="flex items-center space-x-3 bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                            <div className="bg-emerald-100 p-2 rounded-lg">
                              <BuildingOfficeIcon className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Vùng miền</p>
                              <p className="text-sm font-bold text-gray-900">
                                {(asset.specifications as any).region === 'MIEN_BAC' ? 'Miền Bắc'
                                  : (asset.specifications as any).region === 'MIEN_TRUNG' ? 'Miền Trung'
                                  : (asset.specifications as any).region === 'MIEN_NAM' ? 'Miền Nam'
                                  : (asset.specifications as any).region || '-'}
                              </p>
                            </div>
                          </div>
                          {/* Vị trí (Chức vụ) */}
                          {(asset.specifications as any).position_id && (
                            <div className="flex items-center space-x-3 bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                              <div className="bg-emerald-100 p-2 rounded-lg">
                                <IdentificationIcon className="h-5 w-5 text-emerald-600" />
                              </div>
                              <div>
                                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Vị trí (Chức vụ)</p>
                                <p className="text-sm font-bold text-gray-900">
                                  {positionName || (asset.specifications as any).position_id}
                                </p>
                              </div>
                            </div>
                          )}
                          {/* Công ty (Đơn vị làm việc) */}
                          {((asset.specifications as any).sim_company_name || (asset.specifications as any).sim_company) && (
                            <div className="flex items-center space-x-3 bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                              <div className="bg-emerald-100 p-2 rounded-lg">
                                <BuildingOfficeIcon className="h-5 w-5 text-emerald-600" />
                              </div>
                              <div>
                                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Công ty</p>
                                <p className="text-sm font-bold text-gray-900">
                                  {(asset.specifications as any).sim_company_name || (asset.specifications as any).sim_company}
                                </p>
                              </div>
                            </div>
                          )}
                          {/* Ngày báo huỷ */}
                          {(asset.specifications as any).cancellation_report_date && (
                            <div className="flex items-center space-x-3 bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                              <div className="bg-emerald-100 p-2 rounded-lg">
                                <ClockIcon className="h-5 w-5 text-emerald-600" />
                              </div>
                              <div>
                                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Ngày báo huỷ</p>
                                <p className="text-sm font-bold text-gray-900">
                                  {formatDate((asset.specifications as any).cancellation_report_date)}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Purchase Info Section — manager only */}
                    {isManager && (
                    <div className="md:col-span-2 space-y-4 mt-2">
                      <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest border-b pb-2">Thông tin mua hàng & Bảo hành</h4>
                      <div className="space-y-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <div className="flex items-start space-x-3">
                          <ShoppingBagIcon className="h-5 w-5 text-amber-500 mt-0.5" />
                          <div>
                            <p className="text-xs text-gray-500">Nhà cung cấp</p>
                            <p className="text-sm font-bold text-gray-900">{asset.supplier || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-start space-x-3">
                          <CalendarIcon className="h-5 w-5 text-primary-500 mt-0.5" />
                          <div>
                            <p className="text-xs text-gray-500">Ngày mua</p>
                            <p className="text-sm font-bold text-gray-900">{formatDate(asset.purchase_date)}</p>
                          </div>
                        </div>

                        {(asset as any).warranty_period && (
                          <div className="flex items-start space-x-3">
                            <ShieldCheckIcon className="h-5 w-5 text-emerald-500 mt-0.5" />
                            <div>
                              <p className="text-xs text-gray-500">Thời hạn bảo hành</p>
                              <p className="text-sm font-bold text-gray-900">{(asset as any).warranty_period} tháng</p>
                            </div>
                          </div>
                        )}

                        <div className="flex items-start space-x-3">
                          <ShieldCheckIcon className="h-5 w-5 text-red-500 mt-0.5" />
                          <div>
                            <p className="text-xs text-gray-500">Hết hạn bảo hành</p>
                            <p className="text-sm font-bold text-gray-900">{formatDate(asset.warranty_expiry)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Assignment History Section — manager only */}
                    {isManager && (
                    <div className="md:col-span-2 space-y-4 mt-2">
                      <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest border-b pb-2 flex items-center gap-2">
                        Lịch sử bàn giao & thu hồi
                        {!historyLoading && history.length > 0 && (
                          <span className="ml-auto text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            {history.length} bản ghi
                          </span>
                        )}
                      </h4>

                      {historyLoading ? (
                        <div className="text-center py-6 text-sm text-gray-500">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto mb-2"></div>
                          Đang tải lịch sử...
                        </div>
                      ) : history.length === 0 ? (
                        <div className="text-center py-6 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                          <ClockIcon className="h-8 w-8 text-gray-300 mx-auto mb-1" />
                          <p className="text-sm text-gray-500 italic">Chưa có lịch sử bàn giao</p>
                        </div>
                      ) : (
                        <ol className="relative border-l-2 border-primary-100 ml-3 space-y-5">
                          {history.map((h) => {
                            const statusConfig = (() => {
                              switch (h.status) {
                                case 'PENDING':
                                  return {
                                    label: 'Chờ xác nhận',
                                    dotBg: 'bg-amber-500',
                                    panelBg: 'bg-amber-50/50 border-amber-100',
                                    badge: 'bg-amber-100 text-amber-800',
                                    iconColor: 'text-amber-600',
                                    Icon: ClockIcon,
                                  };
                                case 'REJECTED':
                                  return {
                                    label: 'Từ chối nhận',
                                    dotBg: 'bg-red-500',
                                    panelBg: 'bg-red-50/50 border-red-100',
                                    badge: 'bg-red-100 text-red-800',
                                    iconColor: 'text-red-600',
                                    Icon: XCircleIcon,
                                  };
                                case 'CANCELLED':
                                  return {
                                    label: 'Đã hủy',
                                    dotBg: 'bg-gray-400',
                                    panelBg: 'bg-gray-50/70 border-gray-200',
                                    badge: 'bg-gray-200 text-gray-700',
                                    iconColor: 'text-gray-500',
                                    Icon: XCircleIcon,
                                  };
                                case 'RETURNED':
                                  return {
                                    label: 'Đã thu hồi',
                                    dotBg: 'bg-amber-500',
                                    panelBg: 'bg-amber-50/50 border-amber-100',
                                    badge: 'bg-amber-100 text-amber-700',
                                    iconColor: 'text-amber-600',
                                    Icon: ArrowUturnLeftIcon,
                                  };
                                case 'CONFIRMED':
                                default:
                                  return {
                                    label: h.status === 'CONFIRMED' ? 'Đã nhận' : (h.status_display || 'Đang giữ'),
                                    dotBg: 'bg-emerald-500',
                                    panelBg: 'bg-emerald-50/50 border-emerald-100',
                                    badge: 'bg-emerald-100 text-emerald-700',
                                    iconColor: 'text-emerald-600',
                                    Icon: h.status === 'CONFIRMED' ? CheckCircleIcon : UserPlusIcon,
                                  };
                              }
                            })();
                            const { Icon, label, dotBg, panelBg, badge, iconColor } = statusConfig;
                            const formatDateTime = (iso?: string | null) => {
                              if (!iso) return 'N/A';
                              return new Date(iso).toLocaleString('vi-VN');
                            };
                            return (
                              <li key={h.id} className="ml-5">
                                <span className={`absolute -left-[11px] flex items-center justify-center w-5 h-5 rounded-full ring-4 ring-white ${dotBg}`}>
                                  <Icon className="h-3 w-3 text-white" />
                                </span>
                                <div className={`p-3 rounded-xl border ${panelBg}`}>
                                  <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <UserIcon className={`h-4 w-4 ${iconColor}`} />
                                      <span className="text-sm font-bold text-gray-900">
                                        {h.assigned_to_name || `NV #${h.assigned_to}`}
                                      </span>
                                      {h.assigned_to_employee_id && (
                                        <span className="text-xs font-mono text-gray-500">({h.assigned_to_employee_id})</span>
                                      )}
                                    </div>
                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${badge}`}>
                                      {label}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 ml-6">
                                    <div className="flex items-center gap-1.5">
                                      <CalendarIcon className="h-3 w-3 text-gray-400" />
                                      <span className="text-gray-500">Bàn giao:</span>
                                      <span className="font-semibold text-gray-800">{formatDate(h.assigned_date)}</span>
                                    </div>
                                    {h.confirmed_at && (
                                      <div className="flex items-center gap-1.5">
                                        <CheckCircleIcon className="h-3 w-3 text-gray-400" />
                                        <span className="text-gray-500">Xác nhận:</span>
                                        <span className="font-semibold text-gray-800">{formatDateTime(h.confirmed_at)}</span>
                                      </div>
                                    )}
                                    {h.rejected_at && (
                                      <div className="flex items-center gap-1.5">
                                        <XCircleIcon className="h-3 w-3 text-gray-400" />
                                        <span className="text-gray-500">Từ chối:</span>
                                        <span className="font-semibold text-gray-800">{formatDateTime(h.rejected_at)}</span>
                                      </div>
                                    )}
                                    {h.status === 'RETURNED' && (
                                      <div className="flex items-center gap-1.5">
                                        <ArrowUturnLeftIcon className="h-3 w-3 text-gray-400" />
                                        <span className="text-gray-500">Thu hồi:</span>
                                        <span className="font-semibold text-gray-800">{formatDate(h.returned_date)}</span>
                                      </div>
                                    )}
                                    {h.assigned_by_name && (
                                      <div className="flex items-center gap-1.5">
                                        <ShieldCheckIcon className="h-3 w-3 text-gray-400" />
                                        <span className="text-gray-500">Người bàn giao:</span>
                                        <span className="font-semibold text-gray-800">{h.assigned_by_name}</span>
                                      </div>
                                    )}
                                    {MULTI_HOLDER_TYPES.includes(asset.asset_type) && h.assigned_quantity != null && (
                                      <div className="flex items-center gap-1.5">
                                        <Square3Stack3DIcon className="h-3 w-3 text-gray-400" />
                                        <span className="text-gray-500">Số lượng:</span>
                                        <span className="font-semibold text-gray-800">{h.assigned_quantity}</span>
                                      </div>
                                    )}
                                    {h.status === 'RETURNED' && h.return_condition_display && (
                                      <div className="flex items-center gap-1.5">
                                        <SparklesIcon className="h-3 w-3 text-gray-400" />
                                        <span className="text-gray-500">Tình trạng trả:</span>
                                        <span className="font-semibold text-gray-800">{h.return_condition_display}</span>
                                      </div>
                                    )}
                                  </div>
                                  {h.assignment_notes && (
                                    <p className="mt-2 ml-6 text-xs italic text-emerald-800 bg-white/70 px-2 py-1 rounded border border-emerald-100">
                                      📝 {h.assignment_notes}
                                    </p>
                                  )}
                                  {h.return_notes && (
                                    <p className="mt-1 ml-6 text-xs italic text-amber-800 bg-white/70 px-2 py-1 rounded border border-amber-100">
                                      ↩ {h.return_notes}
                                    </p>
                                  )}
                                  {h.status === 'REJECTED' && h.rejection_reason && (
                                    <p className="mt-2 ml-6 text-xs italic text-red-800 bg-white/70 px-2 py-1 rounded border border-red-100">
                                      ✖ Lý do từ chối: {h.rejection_reason}
                                    </p>
                                  )}
                                  {h.status === 'CANCELLED' && h.rejection_reason && (
                                    <p className="mt-2 ml-6 text-xs italic text-gray-700 bg-white/70 px-2 py-1 rounded border border-gray-200">
                                      ✖ {h.rejection_reason}
                                    </p>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                    )}

                  </div>
                </div>

                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    className="btn-primary inline-flex w-full justify-center sm:ml-3 sm:w-auto"
                    onClick={onClose}
                  >
                    Đóng
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
    {returnTarget && (
      <AssetReturnModal
        isOpen={!!returnTarget}
        onClose={() => setReturnTarget(null)}
        onSuccess={() => {
          setReturnTarget(null);
          onAfterReturn?.();
        }}
        asset={asset}
        historyId={returnTarget.historyId}
        holderName={returnTarget.holderName}
        holderQuantity={returnTarget.assignedQuantity}
      />
    )}
    </>
  );
}
