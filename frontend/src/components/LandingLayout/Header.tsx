import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bars3Icon, XMarkIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import { BRAND } from '@/config/brand';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="bg-blue-900">
      <nav
        className="mx-auto flex max-w-7xl items-center justify-between px-6 lg:px-8 h-16"
        aria-label="Global"
      >
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3">
          <span className="sr-only">{BRAND.companyName}</span>
          <div className="h-9 w-9 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
            <span className="text-blue-900 font-black text-sm tracking-tight">{BRAND.appName.slice(0, 3).toUpperCase()}</span>
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-tight">{BRAND.companyName}</div>
            <div className="text-blue-300 text-xs">Hệ thống Quản lý Nhân sự</div>
          </div>
        </Link>

        {/* Mobile hamburger */}
        <div className="flex lg:hidden">
          <button
            type="button"
            className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-white"
            onClick={() => setMobileMenuOpen(true)}
          >
            <span className="sr-only">Mở menu</span>
            <Bars3Icon className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {/* Desktop: Đăng nhập */}
        <div className="hidden lg:flex">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-5 py-2 bg-white text-blue-900 text-sm font-semibold rounded-lg hover:bg-blue-50 transition-colors"
          >
            Đăng nhập
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden">
          <div className="fixed inset-0 z-50" onClick={() => setMobileMenuOpen(false)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-blue-900 px-6 py-6 sm:max-w-sm sm:ring-1 sm:ring-blue-800">
            <div className="flex items-center justify-between">
              <Link to="/" className="flex items-center gap-3" onClick={() => setMobileMenuOpen(false)}>
                <span className="sr-only">{BRAND.companyName}</span>
                <div className="h-9 w-9 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-900 font-black text-sm tracking-tight">{BRAND.appName.slice(0, 3).toUpperCase()}</span>
                </div>
                <div className="text-white font-bold text-sm">{BRAND.companyName}</div>
              </Link>
              <button
                type="button"
                className="-m-2.5 rounded-md p-2.5 text-white"
                onClick={() => setMobileMenuOpen(false)}
              >
                <span className="sr-only">Đóng menu</span>
                <XMarkIcon className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-8">
              <Link
                to="/login"
                className="block w-full text-center px-5 py-3 bg-white text-blue-900 text-sm font-semibold rounded-lg hover:bg-blue-50 transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Đăng nhập vào hệ thống
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
