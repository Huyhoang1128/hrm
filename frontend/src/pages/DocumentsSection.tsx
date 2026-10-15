import React from 'react';
import {
  DocumentTextIcon,
  CheckCircleIcon,
  PencilSquareIcon,
  EyeIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

// ============================================
// TYPE DEFINITIONS
// ============================================

type OnboardingDocument = {
  id: number;
  document_name: string;
  document_type: 'CONTRACT' | 'REGULATION' | 'HANDBOOK' | 'FORM' | 'TRAINING' | 'SAFETY' | 'POLICY' | 'OTHER';
  description: string;
  file: string;
  file_url?: string;
  is_required: boolean;
  requires_signature: boolean;
  is_read: boolean;
  is_signed: boolean;
  signed_at: string | null;
  signature_file: string | null;
  signature_file_url?: string;
  uploaded_at: string;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  template_source?: number | null;
  template_source_name?: string | null;
};

type DocumentsSectionProps = {
  documents: OnboardingDocument[];
  onboardingId: number;
  onUpdate: () => void;
  isReadOnly?: boolean;
};

// ============================================
// HELPER FUNCTIONS
// ============================================

const showError = (msg: string) => window.alert(msg);

const getDocumentTypeLabel = (type: string) => {
  const types: Record<string, string> = {
    CONTRACT: 'Hợp đồng',
    REGULATION: 'Nội quy công ty',
    HANDBOOK: 'Sổ tay nhân viên',
    FORM: 'Mẫu biểu',
    TRAINING: 'Tài liệu đào tạo',
    SAFETY: 'An toàn lao động',
    POLICY: 'Chính sách công ty',
    OTHER: 'Khác',
  };
  return types[type] || type;
};

const getDocumentTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    CONTRACT: 'bg-blue-50 text-blue-700 border-blue-200',
    REGULATION: 'bg-purple-50 text-purple-700 border-purple-200',
    HANDBOOK: 'bg-green-50 text-green-700 border-green-200',
    FORM: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    TRAINING: 'bg-orange-50 text-orange-700 border-orange-200',
    SAFETY: 'bg-red-50 text-red-700 border-red-200',
    POLICY: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    OTHER: 'bg-gray-50 text-gray-700 border-gray-200',
  };
  return colors[type] || colors.OTHER;
};

// ============================================
// MAIN COMPONENT
// ============================================

const DocumentsSection: React.FC<DocumentsSectionProps> = ({
  documents,
}) => {

  const handleViewDocument = (doc: OnboardingDocument) => {
    const url = doc.file_url || doc.file;
    if (!url) {
      showError('Không có file để xem');
      return;
    }
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <DocumentTextIcon className="w-6 h-6 text-blue-600" />
          Tài liệu Onboarding
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Tài liệu được tự động áp dụng từ thư viện template
        </p>
      </div>

      {/* Documents List */}
      {documents && documents.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="group bg-white border border-gray-200 rounded-xl p-5 hover:shadow-lg hover:border-blue-300 transition-all duration-200"
            >
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-1">
                      <DocumentTextIcon className="w-8 h-8 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 text-lg mb-2 flex items-center gap-2">
                        {doc.document_name}
                        {doc.is_required && (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                            Bắt buộc
                          </span>
                        )}
                      </h4>

                      {/* Badges */}
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium border ${getDocumentTypeColor(doc.document_type)}`}
                        >
                          {getDocumentTypeLabel(doc.document_type)}
                        </span>

                        {doc.template_source && (
                          <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                            <SparklesIcon className="w-3 h-3" />
                            Template
                          </span>
                        )}

                        {doc.is_read && (
                          <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                            <CheckCircleIcon className="w-3 h-3" />
                            Đã đọc
                          </span>
                        )}

                        {doc.is_signed && (
                          <span className="flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-2 py-1 rounded-full">
                            <PencilSquareIcon className="w-3 h-3" />
                            Đã ký
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      {doc.description && (
                        <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                          {doc.description}
                        </p>
                      )}

                      {/* Metadata */}
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>
                          Tải lên bởi:{' '}
                          <span className="font-medium text-gray-700">
                            {doc.uploaded_by_name || 'N/A'}
                          </span>
                        </span>
                        <span>•</span>
                        <span>
                          {new Date(doc.uploaded_at).toLocaleDateString('vi-VN', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </span>
                      </div>

                      {/* Signed info */}
                      {doc.is_signed && doc.signed_at && (
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <p className="text-xs text-gray-500">
                            Đã ký vào lúc:{' '}
                            {new Date(doc.signed_at).toLocaleString('vi-VN')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleViewDocument(doc)}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
                  >
                    <EyeIcon className="w-4 h-4" />
                    Xem
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-gradient-to-br from-gray-50 to-blue-50 border-2 border-dashed border-gray-300 rounded-xl">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <DocumentTextIcon className="w-8 h-8 text-blue-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Chưa có tài liệu nào
          </h3>
          <p className="text-gray-600">
            Tài liệu sẽ được tự động áp dụng từ Template tài liệu khi bắt đầu quy trình onboarding.
          </p>
        </div>
      )}
    </div>
  );
};

export default DocumentsSection;
