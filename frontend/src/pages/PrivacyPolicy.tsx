import { BRAND } from '@/config/brand';

const sections: { title: string; items: string[] }[] = [
  {
    title: '1. Thông tin chúng tôi thu thập',
    items: [
      'Thông tin hồ sơ nhân sự: họ tên, ngày sinh, giấy tờ tuỳ thân, liên hệ, thông tin hợp đồng và tài khoản ngân hàng nhận lương.',
      'Dữ liệu chấm công, đơn từ, phê duyệt và lịch sử thao tác trên hệ thống.',
      'Thông tin kỹ thuật cần thiết để vận hành: địa chỉ IP, loại thiết bị, thời điểm đăng nhập.',
    ],
  },
  {
    title: '2. Mục đích sử dụng',
    items: [
      'Quản lý nhân sự, chấm công, tính lương và thực hiện nghĩa vụ bảo hiểm, thuế theo quy định.',
      'Gửi thông báo liên quan đến công việc (đơn từ, phê duyệt, phiếu lương).',
      'Bảo đảm an toàn hệ thống và điều tra sự cố khi cần.',
    ],
  },
  {
    title: '3. Chia sẻ thông tin',
    items: [
      'Dữ liệu chỉ được truy cập bởi người có thẩm quyền theo phân quyền trong hệ thống.',
      'Không bán hoặc chia sẻ dữ liệu cho bên thứ ba, trừ cơ quan nhà nước có thẩm quyền theo quy định pháp luật.',
    ],
  },
  {
    title: '4. Lưu trữ và bảo mật',
    items: [
      'Dữ liệu được lưu trữ trong thời gian cần thiết cho mục đích quản lý nhân sự hoặc theo thời hạn pháp luật yêu cầu.',
      'Áp dụng các biện pháp kỹ thuật hợp lý để bảo vệ dữ liệu khỏi truy cập trái phép.',
    ],
  },
  {
    title: '5. Quyền của bạn',
    items: [
      'Xem và yêu cầu cập nhật thông tin cá nhân của mình.',
      'Yêu cầu giải thích về việc xử lý dữ liệu cá nhân của mình.',
    ],
  },
];

export default function PrivacyPolicy() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="prose prose-lg max-w-none">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Chính sách quyền riêng tư</h1>
        <p className="mb-8 text-gray-900">
          Chính sách này mô tả cách hệ thống {BRAND.appName} của {BRAND.companyName} thu thập, sử dụng và
          bảo vệ thông tin của người dùng.
        </p>

        {sections.map((section) => (
          <section key={section.title} className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">{section.title}</h2>
            <ul className="list-disc pl-6 space-y-2 text-gray-900">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Liên hệ</h2>
          <p className="text-gray-900">
            Mọi câu hỏi về chính sách này, vui lòng liên hệ {BRAND.hrDepartmentLabel}
            {BRAND.supportEmail ? ` qua email ${BRAND.supportEmail}` : ''}.
          </p>
        </section>
      </div>
    </div>
  );
}
