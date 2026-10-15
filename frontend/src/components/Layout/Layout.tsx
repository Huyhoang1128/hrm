import { ReactNode, useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import NotificationDrawer from './NotificationDrawer';
import FeedbackNotices from './FeedbackNotices';
import { NotificationDrawerProvider, useNotificationDrawer } from '@/contexts/NotificationDrawerContext';
import { FeedbackNoticeProvider } from '@/contexts/FeedbackNoticeContext';

function LayoutInner({ children }: { children: ReactNode }) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { drawerOpen, drawerInitialItem, unreadIds, markRead, closeDrawer } = useNotificationDrawer();

  return (
    <div className="h-full flex flex-col bg-primary-100">
      <Sidebar onCollapseChange={setIsSidebarCollapsed} />

      <div className={`flex flex-col flex-1 min-h-0 transition-all duration-300 ${isSidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64'}`}>
        <Header />

        <main className="flex flex-col flex-1 min-h-0 overflow-y-auto py-6">
          <div className="flex flex-col flex-1 min-h-0 w-full px-4 sm:px-6">{children}</div>
        </main>
      </div>

      <NotificationDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        initialItem={drawerInitialItem}
        unreadIds={unreadIds}
        onMarkRead={markRead}
      />
      <FeedbackNotices />
    </div>
  );
}

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <NotificationDrawerProvider>
      <FeedbackNoticeProvider>
        <LayoutInner>{children}</LayoutInner>
      </FeedbackNoticeProvider>
    </NotificationDrawerProvider>
  );
}
