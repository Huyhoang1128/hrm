import { ChartBarIcon, ExclamationTriangleIcon, FlagIcon, ArrowTrendingUpIcon } from '@heroicons/react/24/outline';

const cards = [
  {
    title: 'KPI vận hành theo team',
    description: 'Theo dõi các chỉ số lặp lại như doanh thu, SLA, lead time, chất lượng xử lý.',
    icon: ChartBarIcon,
    tone: 'bg-blue-50 text-blue-600 border-blue-100',
  },
  {
    title: 'Chu kỳ đánh giá',
    description: 'Thiết lập KPI theo tháng, quý hoặc chu kỳ tuỳ biến cho từng team.',
    icon: FlagIcon,
    tone: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  },
  {
    title: 'Ngưỡng cảnh báo',
    description: 'Đánh dấu KPI sắp trượt mục tiêu để trưởng nhóm can thiệp sớm.',
    icon: ExclamationTriangleIcon,
    tone: 'bg-amber-50 text-amber-600 border-amber-100',
  },
  {
    title: 'Lịch sử cập nhật',
    description: 'Lưu audit trail mọi lần update số liệu để phục vụ review và đối soát.',
    icon: ArrowTrendingUpIcon,
    tone: 'bg-violet-50 text-violet-600 border-violet-100',
  },
];

export default function KpiDashboard() {
  return (
    <div className="py-6 space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-primary-600">KPI / Team Performance</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Quản trị KPI theo team</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Mỗi team có bộ KPI riêng, đo lường hiệu quả vận hành định kỳ và gắn với owner chịu trách nhiệm cập nhật.
            </p>
          </div>
          <div className="rounded-xl bg-primary-50 px-4 py-3 text-sm text-primary-700">
            Gợi ý: tạo KPI theo tháng, review theo tuần, chốt theo cuối kỳ.
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className={`rounded-2xl border p-5 shadow-sm ${card.tone}`}>
              <div className="mb-4 inline-flex rounded-xl bg-white/80 p-3">
                <Icon className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold text-slate-900">{card.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{card.description}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr,1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Thiết kế dữ liệu KPI</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li>• `PerformanceCycle`: chu kỳ theo tháng / quý / năm.</li>
            <li>• `KPI`: tên chỉ số, target, current value, weight, hướng đo.</li>
            <li>• `KPIUpdate`: log cập nhật số liệu, comment, confidence.</li>
            <li>• Tất cả dữ liệu đều gắn `team` để phân quyền xem đúng team.</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Nguyên tắc vận hành</h2>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <div className="rounded-xl bg-slate-50 p-4">Owner team tạo KPI và giao người phụ trách cập nhật.</div>
            <div className="rounded-xl bg-slate-50 p-4">Member chỉ xem / cập nhật KPI trong team mình tham gia.</div>
            <div className="rounded-xl bg-slate-50 p-4">KPI phản ánh vận hành ổn định, không thay thế cho mục tiêu bứt phá của OKR.</div>
          </div>
        </section>
      </div>
    </div>
  );
}
