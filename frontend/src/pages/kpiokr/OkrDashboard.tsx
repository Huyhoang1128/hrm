import { FlagIcon, RocketLaunchIcon, PresentationChartLineIcon, CheckBadgeIcon } from '@heroicons/react/24/outline';

const objectiveRules = [
  'Mỗi team nên có 3-5 Objective trong 1 quý.',
  'Mỗi Objective nên có 2-5 Key Result định lượng rõ ràng.',
  'Task tuần phải liên kết với KR để đo mức đóng góp thực thi.',
  'Review OKR theo tuần, chốt mức đạt cuối chu kỳ.',
];

const keyResultExamples = [
  {
    name: 'Tăng tỷ lệ chốt lịch hẹn',
    metric: 'Từ 18% lên 26%',
  },
  {
    name: 'Giảm thời gian xử lý ticket nội bộ',
    metric: 'Từ 14 giờ xuống 6 giờ',
  },
  {
    name: 'Nâng chất lượng onboarding',
    metric: 'Điểm hài lòng từ 7.2 lên 8.5/10',
  },
];

export default function OkrDashboard() {
  return (
    <div className="py-6 space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-primary-600">OKR / Strategic Execution</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Quản trị Objective & Key Result</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              OKR tập trung vào tăng trưởng, đổi mới và thay đổi lớn. Task tuần được dùng như lớp thực thi cho từng KR.
            </p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Khuyến nghị: thiết lập OKR theo quý cho từng team.
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: 'Objective theo quý', icon: FlagIcon, text: 'Mục tiêu định hướng lớn của team.', tone: 'bg-blue-50 text-blue-600 border-blue-100' },
          { title: 'Key Result đo được', icon: PresentationChartLineIcon, text: 'KR phải đo được bằng số liệu cụ thể.', tone: 'bg-violet-50 text-violet-600 border-violet-100' },
          { title: 'Task đóng góp vào KR', icon: RocketLaunchIcon, text: 'Task tuần là công việc thực thi giúp KR tăng tiến độ.', tone: 'bg-amber-50 text-amber-600 border-amber-100' },
          { title: 'Check-in định kỳ', icon: CheckBadgeIcon, text: 'Cập nhật confidence và current value hàng tuần.', tone: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className={`rounded-2xl border p-5 shadow-sm ${item.tone}`}>
              <div className="mb-4 inline-flex rounded-xl bg-white/80 p-3">
                <Icon className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold text-slate-900">{item.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{item.text}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Nguyên tắc thiết kế OKR</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            {objectiveRules.map((rule) => (
              <li key={rule} className="rounded-xl bg-slate-50 p-4">{rule}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Ví dụ Key Result</h2>
          <div className="mt-4 space-y-3">
            {keyResultExamples.map((item) => (
              <div key={item.name} className="rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                <p className="mt-1 text-sm text-slate-600">Mục tiêu đo lường: {item.metric}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
