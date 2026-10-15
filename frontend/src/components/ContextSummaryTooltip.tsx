import { useState, useRef, useEffect } from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';

interface ContextSummaryTooltipProps {
  contextSummary?: string;
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export default function ContextSummaryTooltip({
  contextSummary,
  children,
  className = '',
  maxWidth = 'max-w-sm',
  position = 'top',
}: ContextSummaryTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible && triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const scrollTop =
        window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft =
        window.pageXOffset || document.documentElement.scrollLeft;

      let top = 0;
      let left = 0;

      switch (position) {
        case 'top':
          top = triggerRect.top + scrollTop - tooltipRect.height - 8;
          left =
            triggerRect.left +
            scrollLeft +
            (triggerRect.width - tooltipRect.width) / 2;
          break;
        case 'bottom':
          top = triggerRect.bottom + scrollTop + 8;
          left =
            triggerRect.left +
            scrollLeft +
            (triggerRect.width - tooltipRect.width) / 2;
          break;
        case 'left':
          top =
            triggerRect.top +
            scrollTop +
            (triggerRect.height - tooltipRect.height) / 2;
          left = triggerRect.left + scrollLeft - tooltipRect.width - 8;
          break;
        case 'right':
          top =
            triggerRect.top +
            scrollTop +
            (triggerRect.height - tooltipRect.height) / 2;
          left = triggerRect.right + scrollLeft + 8;
          break;
      }

      // Ensure tooltip stays within viewport
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (left < 8) left = 8;
      if (left + tooltipRect.width > viewportWidth - 8) {
        left = viewportWidth - tooltipRect.width - 8;
      }
      if (top < 8) top = 8;
      if (top + tooltipRect.height > viewportHeight - 8) {
        top = viewportHeight - tooltipRect.height - 8;
      }

      setTooltipPosition({ top, left });
    }
  }, [isVisible, position]);

  if (!contextSummary || contextSummary.trim() === '') {
    return <div className={className}>{children}</div>;
  }

  const getArrowClasses = () => {
    switch (position) {
      case 'top':
        return 'bottom-[-4px] left-1/2 transform -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-gray-800';
      case 'bottom':
        return 'top-[-4px] left-1/2 transform -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-gray-800';
      case 'left':
        return 'right-[-4px] top-1/2 transform -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-gray-800';
      case 'right':
        return 'left-[-4px] top-1/2 transform -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-gray-800';
      default:
        return '';
    }
  };

  return (
    <>
      <div
        ref={triggerRef}
        className={`inline-block ${className}`}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        {children}
      </div>

      {isVisible && (
        <div
          ref={tooltipRef}
          className={`fixed z-50 ${maxWidth} bg-gray-800 text-white text-sm rounded-lg shadow-lg p-3 pointer-events-none`}
          style={{
            top: tooltipPosition.top,
            left: tooltipPosition.left,
          }}
        >
          <div className="flex items-start space-x-2">
            <InformationCircleIcon className="h-4 w-4 text-blue-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-blue-200 mb-1">
                Ngữ cảnh cuộc trò chuyện
              </div>
              <div className="text-gray-200 leading-relaxed whitespace-pre-wrap">
                {contextSummary}
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div className={`absolute w-0 h-0 border-4 ${getArrowClasses()}`} />
        </div>
      )}
    </>
  );
}
