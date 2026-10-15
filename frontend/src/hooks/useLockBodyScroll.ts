import { useEffect } from 'react';

export const useLockBodyScroll = (lock: boolean) => {
  useEffect(() => {
    if (lock) {
      // Lưu lại style ban đầu
      const originalStyle = window.getComputedStyle(document.body).overflow;
      // Chặn scroll
      document.body.style.overflow = 'hidden';
      
      // Cleanup: Trả lại style ban đầu khi component unmount hoặc lock thay đổi
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [lock]);
};
