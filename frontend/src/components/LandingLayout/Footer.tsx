import { BRAND } from '@/config/brand';

export default function Footer() {
  return (
    <footer className="bg-blue-900">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
        <div className="xl:grid xl:grid-cols-3 xl:gap-8">
          {/* Brand */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
                <span className="text-blue-900 font-black text-sm tracking-tight">{BRAND.appName.slice(0, 3).toUpperCase()}</span>
              </div>
              <div>
                <div className="text-white font-bold text-sm leading-tight">{BRAND.companyName}</div>
                <div className="text-blue-300 text-xs">Hệ thống Quản lý Nhân sự</div>
              </div>
            </div>
            <p className="text-sm leading-6 text-blue-300">
              Hệ thống Quản lý Hành chính Nhân sự nội bộ của {BRAND.companyName} —
              quản lý nhân sự, chấm công, tính lương và tài sản tập trung.
            </p>
          </div>

          {/* Links */}
          <div className="mt-16 grid grid-cols-2 gap-8 xl:col-span-2 xl:mt-0">
            <div className="md:grid md:grid-cols-2 md:gap-8">
              <div>
                <h3 className="text-sm font-semibold leading-6 text-white">Hệ thống</h3>
                <ul role="list" className="mt-6 space-y-4">
                  <li>
                    <a
                      href="#"
                      className="text-sm leading-6 text-blue-300 hover:text-white transition-colors"
                    >
                      Các phân hệ
                    </a>
                  </li>
                  <li>
                    <a
                      href="#demo"
                      className="text-sm leading-6 text-blue-300 hover:text-white transition-colors"
                    >
                      Demo giao diện
                    </a>
                  </li>
                  <li>
                    <a
                      href="/login"
                      className="text-sm leading-6 text-blue-300 hover:text-white transition-colors"
                    >
                      Đăng nhập
                    </a>
                  </li>
                </ul>
              </div>
              <div className="mt-10 md:mt-0">
                <h3 className="text-sm font-semibold leading-6 text-white">Hỗ trợ</h3>
                <ul role="list" className="mt-6 space-y-4">
                  <li>
                    <a
                      href="#"
                      className="text-sm leading-6 text-blue-300 hover:text-white transition-colors"
                    >
                      Hướng dẫn sử dụng
                    </a>
                  </li>
                  <li>
                    <a
                      href={`mailto:${BRAND.supportEmail}`}
                      className="text-sm leading-6 text-blue-300 hover:text-white transition-colors"
                    >
                      Liên hệ phòng IT
                    </a>
                  </li>
                  <li>
                    <a
                      href="/login"
                      className="text-sm leading-6 text-blue-300 hover:text-white transition-colors"
                    >
                      Quên mật khẩu
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-16 border-t border-blue-800 pt-8 sm:mt-20 lg:mt-24">
          <p className="text-xs leading-5 text-blue-400 text-center">
            &copy; 2026 {BRAND.companyName}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
