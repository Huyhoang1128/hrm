import React, { useState, useMemo } from 'react';
import {
  ArrowPathIcon,
  ExclamationCircleIcon,
  SparklesIcon,
  CurrencyDollarIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { salaryService } from '../services/salary.service';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import type { Department } from '../utils/api';

const BONUS_SCHEMES = [
  { value: 'fixed_3m_basic', label: 'PA1: < 1 năm = mức cố định, ≥ 1 năm = 1 tháng lương' },
  { value: 'prorated', label: 'PA2: < 1 năm = (lương/12)×số tháng đến cuối năm tài chính, ≥ 1 năm = 1 tháng lương' },
  { value: 'custom', label: 'PA3: Tuỳ chỉnh - nhập số tiền thưởng' },
];

const formatStartDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
};

interface BonusPredictionTabProps {
  departments: Department[];
}

export const BonusPredictionTab: React.FC<BonusPredictionTabProps> = ({ departments }) => {
  const [scheme, setScheme] = useState<'fixed_3m_basic' | 'prorated' | 'custom'>('fixed_3m_basic');
  const [fixedAmount, setFixedAmount] = useState<number>(0);
  const [underOneYearAmount, setUnderOneYearAmount] = useState<number>(3000000);
  const [bonusMonths, setBonusMonths] = useState<number>(1);
  const [selectedDept, setSelectedDept] = useState<string>('');
  const [selectedLegalEntity, setSelectedLegalEntity] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [predictionResult, setPredictionResult] = useState<any>(null);

  const handlePredict = async () => {
    setLoading(true);
    setError(null);
    setPredictionResult(null);

    try {
      const result = await salaryService.predictBonus({
        scheme: scheme as any,
        fixed_amount: scheme === 'custom' && fixedAmount > 0 ? fixedAmount : undefined,
        under_one_year_amount: scheme === 'fixed_3m_basic' ? underOneYearAmount : undefined,
        bonus_months: bonusMonths,
        department_id: selectedDept ? parseInt(selectedDept, 10) : undefined,
        legal_entity: selectedLegalEntity || undefined,
      });

      setPredictionResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi khi dự đoán thưởng');
    } finally {
      setLoading(false);
    }
  };

  const totalBonus = predictionResult?.total_bonus || 0;
  const employeeCount = predictionResult?.total_employee_count || 0;
  const avgBonusPerEmployee = employeeCount > 0 ? totalBonus / employeeCount : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dự đoán Chi Phí Thưởng</h1>
        <p className="text-gray-600 mt-0.5 text-sm">
          Tính toán chi phí thưởng cho toàn công ty hoặc phòng ban với các phương án thưởng khác nhau.
        </p>
      </div>

      {/* Configuration Panel */}
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Phương Án Thưởng</label>
          <SelectBox<string>
            label=""
            value={scheme}
            options={BONUS_SCHEMES}
            onChange={(val) => setScheme(val as any)}
          />
          <p className="mt-2 text-xs text-gray-500">
            {scheme === 'fixed_3m_basic' && 'Nhân sự dưới 1 năm được thưởng mức cố định bên dưới, từ 1 năm trở lên được thưởng lương cơ bản.'}
            {scheme === 'prorated' && 'Nhân sự dưới 1 năm được thưởng (lương cơ bản/12) × số tháng làm việc dự phóng đến cuối năm tài chính, từ 1 năm trở lên được thưởng lương cơ bản.'}
            {scheme === 'custom' && 'Nhập số tiền thưởng cố định mà bạn muốn'}
          </p>
        </div>

        {scheme === 'fixed_3m_basic' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Mức thưởng cho nhân sự dưới 1 năm (VND)</label>
            <input
              type="number"
              value={underOneYearAmount}
              onChange={(e) => setUnderOneYearAmount(Math.max(0, Number(e.target.value)))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {scheme === 'custom' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Số Tiền Thưởng (VND)</label>
            <input
              type="number"
              value={fixedAmount}
              onChange={(e) => setFixedAmount(Math.max(0, Number(e.target.value)))}
              placeholder="Nhập số tiền thưởng"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Số Tháng Thưởng</label>
            <input
              type="number"
              min="1"
              value={bonusMonths}
              onChange={(e) => setBonusMonths(Math.max(1, Number(e.target.value)))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Phòng Ban (Tuỳ chọn)</label>
            <SelectBox<string>
              label=""
              value={selectedDept}
              options={[
                { value: '', label: 'Tất cả phòng ban' },
                ...departments.map((d) => ({ value: String(d.id), label: d.name })),
              ]}
              onChange={setSelectedDept}
            />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
            <ExclamationCircleIcon className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <button
          onClick={handlePredict}
          disabled={loading || (scheme === 'custom' && fixedAmount <= 0)}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <>
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              Đang tính toán...
            </>
          ) : (
            <>
              <SparklesIcon className="h-4 w-4" />
              Dự Đoán Chi Phí Thưởng
            </>
          )}
        </button>
      </div>

      {/* Results Summary */}
      {predictionResult && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Total Bonus */}
          <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-lg shadow p-6 border border-indigo-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-indigo-900">Tổng Chi Phí Thưởng</h3>
              <CurrencyDollarIcon className="h-5 w-5 text-indigo-600" />
            </div>
            <p className="text-3xl font-bold text-indigo-700">
              {(totalBonus / 1000000).toFixed(2)}M
            </p>
            <p className="text-xs text-indigo-600 mt-1">{new Intl.NumberFormat('vi-VN').format(Math.round(totalBonus))} VND</p>
          </div>

          {/* Employee Count */}
          <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-lg shadow p-6 border border-emerald-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-emerald-900">Số Nhân Viên</h3>
              <UserGroupIcon className="h-5 w-5 text-emerald-600" />
            </div>
            <p className="text-3xl font-bold text-emerald-700">{employeeCount}</p>
            <p className="text-xs text-emerald-600 mt-1">Người nhân dân</p>
          </div>

          {/* Average Bonus per Employee */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg shadow p-6 border border-amber-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-amber-900">Thưởng TB / Người</h3>
              <SparklesIcon className="h-5 w-5 text-amber-600" />
            </div>
            <p className="text-3xl font-bold text-amber-700">
              {(avgBonusPerEmployee / 1000000).toFixed(2)}M
            </p>
            <p className="text-xs text-amber-600 mt-1">{new Intl.NumberFormat('vi-VN').format(Math.round(avgBonusPerEmployee))} VND</p>
          </div>
        </div>
      )}

      {/* Department Breakdown */}
      {predictionResult && predictionResult.departments && predictionResult.departments.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Chi Tiết Theo Phòng Ban</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phòng Ban
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Số Nhân Viên
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tổng Thưởng
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Thưởng TB
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {predictionResult.departments.map((dept: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {dept.department_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-700">
                      {dept.employee_count}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-indigo-600 font-semibold">
                      {new Intl.NumberFormat('vi-VN').format(Math.round(dept.total_bonus))} VND
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">
                      {new Intl.NumberFormat('vi-VN').format(Math.round(dept.total_bonus / dept.employee_count))} VND
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Employees List */}
      {predictionResult && predictionResult.employees && predictionResult.employees.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Chi Tiết Nhân Viên</h2>
            <p className="text-sm text-gray-500 mt-1">
              Tổng {predictionResult.employees.length} nhân viên
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Mã NV
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Họ Tên
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phòng Ban
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Ngày bắt đầu làm việc
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Lương CB
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Thời Gian
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Thưởng
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Lý Do
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {predictionResult.employees.map((emp: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700 font-mono">{emp.employee_code}</td>
                    <td className="px-4 py-3 text-gray-900 font-medium">{emp.employee_name}</td>
                    <td className="px-4 py-3 text-gray-700">{emp.department}</td>
                    <td className="px-4 py-3 text-center text-gray-700 whitespace-nowrap">
                      {formatStartDate(emp.start_date)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {new Intl.NumberFormat('vi-VN').format(Math.round(emp.basic_salary))} VND
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          emp.is_over_1_year
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {emp.months_worked} tháng
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-indigo-600 font-semibold">
                      {new Intl.NumberFormat('vi-VN').format(Math.round(emp.bonus_amount))} VND
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{emp.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!predictionResult && !loading && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <SparklesIcon className="h-12 w-12 mb-4" />
          <p className="text-sm">Điều chỉnh các thông số trên và nhấn "Dự Đoán Chi Phí Thưởng" để xem kết quả</p>
        </div>
      )}
    </div>
  );
};

export default BonusPredictionTab;
