import { useState, useEffect } from 'react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import SimpleTooltip from './SimpleTooltip';

interface ResponsiveContextSummaryProps {
  contextSummary?: string;
  className?: string;
  showIcon?: boolean;
  breakpoint?: 'sm' | 'md' | 'lg';
}

export default function ResponsiveContextSummary({
  contextSummary,
  className = '',
  showIcon = true,
  breakpoint = 'md',
}: ResponsiveContextSummaryProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      switch (breakpoint) {
        case 'sm':
          setIsMobile(width < 640);
          break;
        case 'md':
          setIsMobile(width < 768);
          break;
        case 'lg':
          setIsMobile(width < 1024);
          break;
        default:
          setIsMobile(width < 768);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [breakpoint]);

  if (!contextSummary || contextSummary.trim() === '') {
    return (
      <div className={`flex items-center space-x-2 text-gray-400 ${className}`}>
        {showIcon && <DocumentTextIcon className="h-3 w-3 flex-shrink-0" />}
        <span className="text-xs italic">Chưa có ngữ cảnh</span>
      </div>
    );
  }

  // Mobile: Show truncated text with tooltip
  if (isMobile) {
    return (
      <SimpleTooltip
        content={contextSummary}
        position="top"
        maxWidth="max-w-xs"
      >
        <div
          className={`flex items-center space-x-2 text-gray-600 cursor-help ${className}`}
        >
          {showIcon && (
            <DocumentTextIcon className="h-3 w-3 text-blue-500 flex-shrink-0" />
          )}
          <span className="text-xs table-cell-context-mobile">
            {contextSummary}
          </span>
        </div>
      </SimpleTooltip>
    );
  }

  // Desktop: Show with hover effects
  return (
    <SimpleTooltip content={contextSummary} position="top" maxWidth="max-w-md">
      <div
        className={`group relative flex items-center space-x-2 text-gray-600 cursor-help transition-colors duration-200 ${className}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {showIcon && (
          <DocumentTextIcon
            className={`h-3 w-3 flex-shrink-0 transition-colors duration-200 ${
              isHovered ? 'text-blue-600' : 'text-blue-500'
            }`}
          />
        )}
        <div className="min-w-0 flex-1">
          <span
            className={`text-xs block table-cell-context leading-relaxed transition-colors duration-200 ${
              isHovered ? 'text-blue-700' : 'text-gray-600'
            }`}
          >
            {contextSummary}
          </span>
        </div>
      </div>
    </SimpleTooltip>
  );
}
