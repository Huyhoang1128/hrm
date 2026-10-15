import { useState } from 'react';
import {
  InformationCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentTextIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

interface ContextSummaryProps {
  contextSummary?: string;
  className?: string;
  variant?: 'compact' | 'expanded' | 'card';
  showHeader?: boolean;
  maxLength?: number;
}

export default function ContextSummary({
  contextSummary,
  className = '',
  variant = 'compact',
  showHeader = true,
  maxLength = 150,
}: ContextSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!contextSummary || contextSummary.trim() === '') {
    return (
      <div className={`flex items-center space-x-2 text-gray-400 ${className}`}>
        <DocumentTextIcon className="h-4 w-4" />
        <span className="text-sm">Chưa có tóm tắt ngữ cảnh</span>
      </div>
    );
  }

  const shouldTruncate = contextSummary.length > maxLength;
  const displayText =
    isExpanded || !shouldTruncate
      ? contextSummary
      : contextSummary.substring(0, maxLength) + '...';

  const renderCompact = () => (
    <div className={`group ${className}`}>
      {showHeader && (
        <div className="flex items-center space-x-2 mb-2">
          <InformationCircleIcon className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium text-gray-700">Ngữ cảnh</span>
        </div>
      )}

      <div className="relative">
        <p className="text-sm text-gray-600 leading-relaxed">{displayText}</p>

        {shouldTruncate && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="mt-1 flex items-center space-x-1 text-blue-600 hover:text-blue-800 text-xs font-medium transition-colors"
          >
            <span>{isExpanded ? 'Thu gọn' : 'Xem thêm'}</span>
            {isExpanded ? (
              <ChevronUpIcon className="h-3 w-3" />
            ) : (
              <ChevronDownIcon className="h-3 w-3" />
            )}
          </button>
        )}
      </div>
    </div>
  );

  const renderExpanded = () => (
    <div className={`bg-gray-50 rounded-lg p-4 ${className}`}>
      {showHeader && (
        <div className="flex items-center space-x-2 mb-3">
          <DocumentTextIcon className="h-5 w-5 text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900">
            Tóm tắt ngữ cảnh cuộc trò chuyện
          </h3>
        </div>
      )}

      <div className="prose prose-sm max-w-none">
        <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
          {contextSummary}
        </p>
      </div>
    </div>
  );

  const renderCard = () => (
    <div className={`bg-white p-4 ${className}`}>
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
            <DocumentTextIcon className="h-4 w-4 text-blue-600" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-900">
              Ngữ cảnh cuộc trò chuyện
            </h4>
            <div className="flex items-center space-x-1 text-xs text-gray-500">
              <ClockIcon className="h-3 w-3" />
              <span>Cập nhật gần đây</span>
            </div>
          </div>

          <div className="relative">
            <p className="text-sm text-gray-600 leading-relaxed">
              {displayText}
            </p>

            {shouldTruncate && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="mt-2 flex items-center space-x-1 text-blue-600 hover:text-blue-800 text-xs font-medium transition-colors"
              >
                <span>{isExpanded ? 'Thu gọn' : 'Xem thêm'}</span>
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
    </div>
  );

  switch (variant) {
    case 'expanded':
      return renderExpanded();
    case 'card':
      return renderCard();
    case 'compact':
    default:
      return renderCompact();
  }
}
