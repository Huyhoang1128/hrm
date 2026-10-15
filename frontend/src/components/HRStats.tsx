import React, { useState, useEffect } from 'react';
import { dashboardAPI } from '../utils/api';
import { usePieAnimation } from '../hooks/usePieAnimation';
import { AnimatedNum } from './AnimatedNum';
import { DonutCenter } from './DonutCenter';

const formatNumber = (n: number) =>
  n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
import {
  BuildingOffice2Icon,
  EllipsisHorizontalIcon,
  ChevronRightIcon,
  UserGroupIcon,
  ArrowUpIcon,
  MinusIcon,
} from '@heroicons/react/24/outline';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Label } from 'recharts';

interface HRStatsData {
  employee_stats: {
    total: number;
    active: number;
    probation: number;
    inactive: number;
    new_last_30_days: number;
    recent_hires: number;
    gender_distribution: { male: number; female: number; other: number };
  };
  department_stats: Array<{ id: number; name: string; code: string; employee_count: number }>;
  asset_stats: {
    total: number; in_use: number; idle: number; under_maintenance: number;
    total_value: number; current_assignments: number; upcoming_maintenance: number;
    type_distribution: Array<{ type: string; display_name: string; count: number }>;
  };
  recent_activities: { asset_assignments: number; asset_returns: number; maintenance: number };
  trends: { employee_growth: number; asset_growth: number };
}

// Bảng màu chuẩn từ design system /hrm-ui
const CHART_COLORS = [
  '#1B65B8', // primary-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#84cc16', // lime-500
];

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="bg-gray-900/95 backdrop-blur rounded-xl px-3 py-2 shadow-xl text-xs">
      <p className="text-white/60 mb-0.5">{p.name}</p>
      <p className="text-white font-bold text-sm">{formatNumber(p.value ?? 0)} người</p>
    </div>
  );
};

const DeptMiniCard = ({
  dept, idx, active,
}: {
  dept: { id: number; name: string; employee_count: number };
  idx: number;
  active: number;
}) => {
  const p = active > 0 ? (dept.employee_count / active) * 100 : 0;
  const isTop = idx === 0;
  const isGood = p >= 2;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4" style={{ borderLeft: '4px solid #1B65B8' }}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-[11px] font-semibold text-gray-600 truncate max-w-[90px]">{dept.name}</span>
        <div className="flex gap-0.5 flex-shrink-0">
          {[0,1,2].map(i => (
            <span key={i} className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: '#1B65B8', opacity: 0.3 + i * 0.2 }} />
          ))}
        </div>
      </div>
      <p className="text-3xl font-extrabold text-gray-800 tracking-tight leading-none mb-1">
        <AnimatedNum value={dept.employee_count} />
      </p>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-gray-400">Nhân viên</span>
        {isTop ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600">
            <ArrowUpIcon className="h-2.5 w-2.5" />{p.toFixed(1)}%
          </span>
        ) : isGood ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-primary-600">
            <ArrowUpIcon className="h-2.5 w-2.5" />{p.toFixed(1)}%
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
            <MinusIcon className="h-2.5 w-2.5" />{p.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
};

const HRStats: React.FC = () => {
  const [stats, setStats] = useState<HRStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const { endAngle, startAngle, animationDuration } = usePieAnimation(!loading && !!stats);

  useEffect(() => { loadStats(); }, []);

  const loadStats = async () => {
    try {
      setStats(await dashboardAPI.getHRMStats());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 animate-pulse space-y-4">
        {/* header skeleton */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-gray-100 rounded-xl" />
            <div className="space-y-1.5">
              <div className="h-4 w-56 bg-gray-100 rounded" />
              <div className="h-3 w-36 bg-gray-100 rounded" />
            </div>
          </div>
          <div className="h-7 w-16 bg-gray-100 rounded-lg" />
        </div>
        {/* main grid skeleton */}
        <div className="grid grid-cols-5 gap-4">
          <div className="col-span-3 h-72 bg-gray-100 rounded-2xl" />
          <div className="col-span-2 h-72 bg-gray-100 rounded-2xl" />
        </div>
        {/* bottom cards skeleton */}
        <div className="flex gap-3">
          {[1,2,3,4,5].map(i => <div key={i} className="h-28 w-36 flex-shrink-0 bg-gray-100 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const sorted = [...stats.department_stats].sort((a, b) => b.employee_count - a.employee_count);
  const top8 = sorted.slice(0, 8);
  const othersCount = sorted.slice(8).reduce((s, d) => s + d.employee_count, 0);

  const donutData = [
    ...top8.map((d, i) => ({ name: d.name, value: d.employee_count, color: CHART_COLORS[i] })),
    ...(othersCount > 0 ? [{ name: 'Khác', value: othersCount, color: '#9ca3af' }] : []),
  ];

  const listDepts = sorted.slice(0, 7);
  const cardDepts = sorted.slice(0, 5);
  const active = stats.employee_stats.active;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-4 h-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <BuildingOffice2Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Phân bố nhân sự theo phòng ban</h3>
            <p className="text-xs text-gray-600 mt-0.5">Nhân viên đang làm việc tại các phòng ban</p>
          </div>
        </div>
        <span className="text-[11px] font-semibold text-gray-500 bg-white border border-gray-100 rounded-lg px-3 py-1.5">
          {new Date().getFullYear()}
        </span>
      </div>

      {/* ── Main: Donut + Danh sách ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 flex-1 min-h-0">

        {/* Cột trái: Donut lớn */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 p-5 flex flex-col">
          <p className="text-[11px] font-medium text-gray-900 uppercase tracking-wide mb-1">
            Tổng nhân viên
          </p>
          <ResponsiveContainer width="100%" height="100%" minHeight={280}>
            <PieChart key={active}>
              <Pie
                data={donutData}
                cx="50%" cy="50%"
                innerRadius={82}
                outerRadius={118}
                paddingAngle={2.5}
                dataKey="value"
                strokeWidth={0}
                startAngle={startAngle}
                endAngle={endAngle}
                isAnimationActive={true}
                animationBegin={0}
                animationDuration={animationDuration}
                animationEasing="ease-out"
              >
                {donutData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
                <Label
                  content={({ viewBox }) => {
                    const { cx, cy } = viewBox as any;
                    return <DonutCenter value={active} label="Nhân viên" subtitle="đang làm việc" cx={cx} cy={cy} fontSize={34} />;
                  }}
                  position="center"
                />
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Cột phải: Danh sách phòng ban */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold text-gray-900">Phòng ban nổi bật</h4>
            <button className="text-gray-400 hover:text-gray-600 transition-colors">
              <EllipsisHorizontalIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto">
            {listDepts.map((dept, idx) => {
              const color = CHART_COLORS[idx] ?? '#9ca3af';
              const p = active > 0 ? (dept.employee_count / active) * 100 : 0;
              return (
                <div key={dept.id} className="flex items-center gap-2.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="flex-1 text-sm text-gray-700 truncate min-w-0">{dept.name}</span>
                  <span className="text-sm font-extrabold text-gray-900 flex-shrink-0">
                    <AnimatedNum value={dept.employee_count} />
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0 w-10 text-right tabular-nums">
                    {p.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-t border-gray-200/70">
            <button
              onClick={() => setShowAll(v => !v)}
              className="flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-800 transition-colors"
            >
              {showAll ? 'Thu gọn' : 'Xem tất cả phòng ban'}
              <ChevronRightIcon className={`h-3.5 w-3.5 transition-transform ${showAll ? 'rotate-90' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Mở rộng: tất cả phòng ban ── */}
      {showAll && (
        <div className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-primary-500 p-5">
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-4">
            Tất cả phòng ban ({sorted.length})
          </p>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-2.5 max-h-64 overflow-y-auto pr-1">
            {sorted.map((dept, idx) => {
              const color = CHART_COLORS[idx % CHART_COLORS.length];
              const p = active > 0 ? (dept.employee_count / active) * 100 : 0;
              return (
                <div key={dept.id}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-[11px] text-gray-700 truncate">{dept.name}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className="text-[11px] font-bold text-gray-900 tabular-nums">
                        <AnimatedNum value={dept.employee_count} />
                      </span>
                      <span className="text-[10px] text-gray-400 w-9 text-right tabular-nums">
                        {p.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${p}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Bottom: Mini cards phòng ban ── */}
      <div>
        <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-3">
          Top phòng ban
        </p>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {cardDepts.map((dept, idx) => (
            <DeptMiniCard key={dept.id} dept={dept} idx={idx} active={active} />
          ))}

          {/* Card tổng hợp */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col justify-between" style={{ borderLeft: `4px solid #1B65B8` }}>
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center mb-2">
              <UserGroupIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-3xl font-extrabold text-primary-800 tracking-tight leading-none mb-1">
                <AnimatedNum value={sorted.length} />
              </p>
              <p className="text-[11px] text-primary-500">Tổng phòng ban</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HRStats;
