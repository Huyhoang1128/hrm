import { ReactNode } from 'react';
import Header from './Header';
import Footer from './Footer';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main>
        <div className="mx-auto">{children}</div>
      </main>

      <Footer />
    </div>
  );
}
