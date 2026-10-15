import { BRAND } from '@/config/brand';

const sections: { title: string; items: string[] }[] = [
  {
    title: '1. Phạm vi áp dụng',
    items: [
      `Điều khoản này áp dụng cho mọi người dùng được cấp tài khoản trên hệ thống ${BRAND.appName}.`,
      'Bằng việc đăng nhập và sử dụng hệ thống, bạn đồng ý tuân thủ các điều khoản dưới đây.',
    ],
  },
  {
    title: '2. Tài khoản',
    items: [
      'Tài khoản do bộ phận nhân sự cấp, chỉ dùng cho mục đích công việc.',
      'Bạn có trách nhiệm giữ bí mật mật khẩu và đổi mật khẩu sau lần đăng nhập đầu tiên.',
      'Thông báo ngay cho bộ phận nhân sự nếu phát hiện tài khoản bị sử dụng trái phép.',
    ],
  },
  {
    title: '3. Sử dụng hợp lệ',
    items: [
      'Cung cấp thông tin trung thực khi tạo đơn, giải trình, chấm công.',
      'Không truy cập, chỉnh sửa hoặc tiết lộ dữ liệu ngoài phạm vi được phân quyền.',
      'Không sử dụng hệ thống để gây hại, phát tán mã độc hoặc can thiệp trái phép.',
    ],
  },
  {
    title: '4. Giới hạn trách nhiệm',
    items: [
      'Hệ thống được cung cấp theo hiện trạng; chúng tôi nỗ lực bảo đảm hoạt động ổn định nhưng không cam kết không gián đoạn.',
      'Số liệu chấm công, lương hiển thị trên hệ thống có giá trị tham khảo cho đến khi được bộ phận nhân sự chốt.',
    ],
  },
  {
    title: '5. Thay đổi điều khoản',
    items: ['Điều khoản có thể được cập nhật; phiên bản mới có hiệu lực kể từ khi đăng trên hệ thống.'],
  },
];

export default function TermsOfService() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="prose prose-lg max-w-none">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Điều khoản sử dụng</h1>

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
            {BRAND.companyName} — {BRAND.hrDepartmentLabel}
            {BRAND.supportEmail ? ` · ${BRAND.supportEmail}` : ''}
          </p>
        </section>
      </div>
    </div>
  );
}
