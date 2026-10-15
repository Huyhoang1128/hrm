import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  TrophyIcon,
  ArrowPathIcon,
  UserIcon,
  ClockIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { attendanceService, AttendanceRankingEntry } from '../services/attendance.service';
import { SelectBox } from '../components/LandingLayout/SelectBox';

const MONTH_NAMES = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4',
  'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8',
  'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];

type SortField = 'rank_early' | 'rank_on_time' | 'early_ratio' | 'early_days' | 'total_early_minutes' | 'avg_early_minutes' | 'on_time_days' | 'total_working_days';

const AttendanceRanking: React.FC = () => {
  const { user } = useAuth();
  const now = new Date();

  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [rankType, setRankType] = useState<'early' | 'on_time'>('early');
  const [top, setTop] = useState<number>(10);
  const [rankings, setRankings] = useState<AttendanceRankingEntry[]>([]);
  const [myRanking, setMyRanking] = useState<AttendanceRankingEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [computeMessage, setComputeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [sortField, setSortField] = useState<SortField>('rank_early');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const userRole = user?.role?.toUpperCase() ?? 'USER';
  const isSuperAdmin = user?.is_super_admin || (user as any)?.is_superuser || false;
  const isHR = isSuperAdmin || userRole === 'ADMIN' || userRole === 'HR';
  const employeeId: number | undefined = (user as any)?.employee_profile?.id ?? (user as any)?.hrm_user?.id;

  const fetchRankings = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, myData] = await Promise.all([
        attendanceService.getRanking({ year, month, type: rankType, top: top > 0 ? top : undefined }),
        employeeId
          ? attendanceService.getRanking({ year, month, type: rankType, employee_id: employeeId })
          : Promise.resolve([] as AttendanceRankingEntry[]),
      ]);
      setRankings(data);
      setMyRanking(myData.length > 0 ? myData[0] : null);
    } catch {
      setError('Không thể tải dữ liệu bảng xếp hạng. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRankings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, rankType, top, employeeId]);

  const handleCompute = async () => {
    setComputing(true);
    setComputeMessage(null);
    try {
      await attendanceService.computeRanking(year, month);
      setComputeMessage({ type: 'success', text: `Đã tính xếp hạng cho tháng ${month}/${year} thành công!` });
      await fetchRankings();
    } catch {
      setComputeMessage({ type: 'error', text: 'Tính xếp hạng thất bại. Vui lòng thử lại.' });
    } finally {
      setComputing(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortedRankings = [...rankings].sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const getRankDisplay = (rank: number | null | undefined) => {
    if (rank === null || rank === undefined) return '—';
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const SortIcon: React.FC<{ field: SortField }> = ({ field }) => {
    if (sortField !== field) return <ChevronUpIcon className="h-3 w-3 text-gray-300 inline ml-1" />;
    return sortDir === 'asc'
      ? <ChevronUpIcon className="h-3 w-3 text-primary-500 inline ml-1" />
      : <ChevronDownIcon className="h-3 w-3 text-primary-500 inline ml-1" />;
  };

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Bảng xếp hạng chấm công</h1>
          <p className="text-sm text-gray-900 mt-0.5">Thống kê nhân viên đi sớm và đúng giờ theo tháng</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="w-24">
            <SelectBox<number>
              label="Năm"
              value={year}
              options={yearOptions.map(y => ({ value: y, label: String(y) }))}
              onChange={setYear}
            />
          </div>
          <div className="w-32">
            <SelectBox<number>
              label="Tháng"
              value={month}
              options={MONTH_NAMES.map((name, idx) => ({ value: idx + 1, label: name }))}
              onChange={setMonth}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              <ClockIcon className="h-3.5 w-3.5 inline mr-1" />Loại xếp hạng
            </label>
            <div className="flex rounded-xl border border-gray-200 overflow-hidden">
              <button
                onClick={() => setRankType('early')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${rankType === 'early' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
              >
                🌅 Đi sớm
              </button>
              <button
                onClick={() => setRankType('on_time')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${rankType === 'on_time' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
              >
                ✅ Đúng giờ
              </button>
            </div>
          </div>
          <div className="w-28">
            <SelectBox<number>
              label="Top N"
              value={top}
              options={[
                { value: 5, label: 'Top 5' },
                { value: 10, label: 'Top 10' },
                { value: 20, label: 'Top 20' },
                { value: 50, label: 'Top 50' },
                { value: 0, label: 'Tất cả' },
              ]}
              onChange={setTop}
            />
          </div>
          <button
            onClick={fetchRankings}
            disabled={loading}
            className="btn-secondary flex items-center gap-1.5 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
          {isHR && (
            <button
              onClick={handleCompute}
              disabled={computing || loading}
              className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
            >
              <TrophyIcon className={`h-4 w-4 ${computing ? 'animate-pulse' : ''}`} />
              {computing ? 'Đang tính...' : 'Tính xếp hạng'}
            </button>
          )}
        </div>

        {computeMessage && (
          <div className={`mt-3 px-4 py-2 rounded-2xl text-sm font-medium ${
            computeMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {computeMessage.text}
          </div>
        )}
      </div>

      {/* My ranking card */}
      {myRanking && (
        <div className="bg-primary-50 rounded-2xl border border-primary-100 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
            <div className="h-7 w-7 bg-primary-100 text-primary-600 rounded-lg flex items-center justify-center">
              <UserIcon className="h-4 w-4" />
            </div>
            Xếp hạng của bạn — {MONTH_NAMES[month - 1]} {year}
          </h2>
          <div className="flex flex-wrap gap-6">
            {[
              { label: 'Hạng đi sớm', value: getRankDisplay(myRanking.rank_early), big: true },
              { label: 'Hạng đúng giờ', value: getRankDisplay(myRanking.rank_on_time), big: true },
              { label: 'GT còn lại', value: myRanking.remaining_explanations ?? '—' },
              { label: 'Tỷ lệ đi sớm', value: `${myRanking.early_ratio?.toFixed(1) ?? '0'}%` },
              { label: 'Ngày đi sớm', value: myRanking.early_days },
              { label: 'Phút đi sớm', value: myRanking.total_early_minutes },
              { label: 'Ngày đúng giờ', value: myRanking.on_time_days },
              { label: 'Tổng ngày làm', value: myRanking.total_working_days },
            ].map(({ label, value, big }) => (
              <div key={label} className="text-center">
                <div className={`font-extrabold tracking-tight text-primary-700 ${big ? 'text-2xl' : 'text-lg text-gray-800'}`}>
                  {value}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rankings table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900">
            {rankType === 'early' ? '🌅 Bảng xếp hạng đi sớm' : '✅ Bảng xếp hạng đúng giờ'} — {MONTH_NAMES[month - 1]} {year}
          </h2>
          <span className="text-xs text-gray-400">{rankings.length} nhân viên</span>
        </div>

        {error && (
          <div className="px-5 py-4 text-sm text-red-700 bg-red-50 border-b border-red-100">{error}</div>
        )}

        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-gray-400">
            <ArrowPathIcon className="h-6 w-6 animate-spin mx-auto mb-2 text-primary-400" />
            Đang tải dữ liệu...
          </div>
        ) : rankings.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="h-12 w-12 bg-amber-100 text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <TrophyIcon className="h-6 w-6" />
            </div>
            <p className="text-sm font-bold text-gray-900">Chưa có dữ liệu xếp hạng cho tháng này</p>
            {isHR && (
              <p className="mt-1 text-xs text-gray-400">Nhấn <strong>Tính xếp hạng</strong> để tạo dữ liệu.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    className="table-header cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort(rankType === 'early' ? 'rank_early' : 'rank_on_time')}
                  >
                    Hạng <SortIcon field={rankType === 'early' ? 'rank_early' : 'rank_on_time'} />
                  </th>
                  <th className="table-header">Nhân viên</th>
                  <th className="table-header">Phòng ban</th>
                  <th className="table-header text-right">GT còn lại</th>
                  {rankType === 'early' ? (
                    <>
                      <th className="table-header text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('early_ratio')}>
                        Tỷ lệ đi sớm <SortIcon field="early_ratio" />
                      </th>
                      <th className="table-header text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('early_days')}>
                        Ngày đi sớm <SortIcon field="early_days" />
                      </th>
                      <th className="table-header text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('total_early_minutes')}>
                        Tổng phút sớm <SortIcon field="total_early_minutes" />
                      </th>
                      <th className="table-header text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('avg_early_minutes')}>
                        TB phút/ngày <SortIcon field="avg_early_minutes" />
                      </th>
                    </>
                  ) : (
                    <>
                      <th className="table-header text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('on_time_days')}>
                        Ngày đúng giờ <SortIcon field="on_time_days" />
                      </th>
                      <th className="table-header text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('total_working_days')}>
                        Tổng ngày làm <SortIcon field="total_working_days" />
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {sortedRankings.map((entry, idx) => {
                  const rank = rankType === 'early' ? entry.rank_early : entry.rank_on_time;
                  const isTopThree = rank !== null && rank !== undefined && rank <= 3;
                  return (
                    <tr
                      key={`${entry.employee_id}-${entry.year}-${entry.month}`}
                      className={`${isTopThree ? 'bg-amber-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-gray-50 transition-colors`}
                    >
                      <td className="table-cell font-semibold">
                        <span className={`text-lg ${isTopThree ? '' : 'text-gray-500'}`}>
                          {getRankDisplay(rank)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">{entry.full_name}</div>
                        <div className="text-xs text-gray-400">{entry.employee_code}</div>
                      </td>
                      <td className="table-cell text-gray-500">{entry.department ?? '—'}</td>
                      <td className="px-6 py-4 text-right text-sm font-medium text-primary-700">
                        {entry.remaining_explanations ?? '—'}
                        {entry.max_explanations_per_month ? (
                          <span className="ml-1 text-xs font-normal text-gray-400">
                            /{entry.max_explanations_per_month}
                          </span>
                        ) : null}
                      </td>
                      {rankType === 'early' ? (
                        <>
                          <td className="px-6 py-4 text-right text-sm font-bold text-primary-700">
                            {entry.early_ratio?.toFixed(1) ?? '0'}%
                          </td>
                          <td className="px-6 py-4 text-right text-sm font-medium text-primary-700">
                            {entry.early_days} ngày
                          </td>
                          <td className="px-6 py-4 text-right text-sm font-medium text-violet-700">
                            {entry.total_early_minutes} phút
                          </td>
                          <td className="px-6 py-4 text-right text-sm text-gray-500">
                            {entry.avg_early_minutes?.toFixed(1) ?? '—'} phút
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-6 py-4 text-right text-sm font-medium text-emerald-700">
                            {entry.on_time_days} ngày
                          </td>
                          <td className="px-6 py-4 text-right text-sm text-gray-500">
                            {entry.total_working_days} ngày
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AttendanceRanking;
