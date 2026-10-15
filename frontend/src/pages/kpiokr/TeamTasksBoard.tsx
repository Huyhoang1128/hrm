import { ClipboardDocumentListIcon, ClockIcon, TrophyIcon, UserGroupIcon } from '@heroicons/react/24/outline';

const workflow = ['Backlog', 'Todo', 'In Progress', 'Blocked', 'In Review', 'Done'];
const metrics = [
  { name: 'Tiến độ', weight: '25%' },
  { name: 'Chất lượng đầu ra', weight: '30%' },
  { name: 'Tác động tới KR', weight: '25%' },
  { name: 'Phối hợp', weight: '10%' },
  { name: 'Chủ động', weight: '10%' },
];

export default function TeamTasksBoard() {
  return (
    <div className="py-6 space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-primary-600">Weekly Tasks / Scrum-like Execution</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Quản lý task hàng tuần theo team</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Task được tổ chức theo sprint tuần, phân công theo thành viên team và có thể liên kết trực tiếp tới `Key Result` để đo mức đóng góp.
            </p>
          </div>
          <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-700">
            Mô hình phù hợp cho Agile / Scrum nội bộ theo tuần.
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: 'Sprint tuần', icon: ClockIcon, text: 'Mỗi tuần là một sprint có goal, timeframe và review riêng.' },
          { title: 'Task theo team', icon: UserGroupIcon, text: 'Người dùng chỉ thấy task của team mình là thành viên.' },
          { title: 'Đóng góp vào KR', icon: TrophyIcon, text: 'Task có thể map vào KR để đo tác động thực thi.' },
          { title: 'Đánh giá cuối tuần', icon: ClipboardDocumentListIcon, text: 'Reviewer chấm điểm task bằng bộ metric chuẩn.' },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 inline-flex rounded-xl bg-slate-100 p-3 text-primary-600">
                <Icon className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold text-slate-900">{card.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{card.text}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Trạng thái task đề xuất</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {workflow.map((status) => (
              <span key={status} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
                {status}
              </span>
            ))}
          </div>
          <p className="mt-4 text-sm text-slate-600">
            Mỗi task nên có assignee, reviewer, due date, story point, estimate hours, actual hours và completion percent.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Metric đánh giá task</h2>
          <div className="mt-4 space-y-3">
            {metrics.map((metric) => (
              <div key={metric.name} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <span className="font-medium text-slate-800">{metric.name}</span>
                <span className="text-primary-600">{metric.weight}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
