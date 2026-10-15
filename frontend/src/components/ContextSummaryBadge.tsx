import { useState } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';

interface ContextSummaryBadgeProps {
  contextSummary?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
}

export default function ContextSummaryBadge({
  contextSummary,
  className = '',
  size = 'sm',
  showIcon = true,
}: ContextSummaryBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!contextSummary || contextSummary.trim() === '') {
    return null;
  }

  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1.5',
    lg: 'text-base px-4 py-2',
  };

  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };

  const maxLength = size === 'sm' ? 50 : size === 'md' ? 80 : 120;
  const shouldTruncate = contextSummary.length > maxLength;
  const displayText =
    isExpanded || !shouldTruncate
      ? contextSummary
      : contextSummary.substring(0, maxLength) + '...';

  return (
    <div className={`inline-flex items-start space-x-2 ${className}`}>
      {showIcon && (
        <DocumentTextIcon
          className={`${iconSizes[size]} text-blue-500 flex-shrink-0 mt-0.5`}
        />
      )}

      <div className="flex-1 min-w-0">
        <div
          className={`${sizeClasses[size]} bg-blue-50 text-blue-800 rounded-lg border border-blue-200`}
        >
          <span className="block leading-relaxed">{displayText}</span>

          {shouldTruncate && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-1 flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-medium transition-colors"
            >
              <span className="text-xs">
                {isExpanded ? 'Thu gọn' : 'Xem thêm'}
              </span>
              {isExpanded ? (
                <ChevronUpIcon className="h-3 w-3" />
              ) : (
                <ChevronDownIcon className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
