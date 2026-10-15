import { useState, useEffect } from 'react';
import {
  XMarkIcon,
  DocumentTextIcon,
  TagIcon,
  CheckIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline';
import { Domain, Document, domainsAPI, documentsAPI } from '@/utils/api';

interface BulkDomainAssignmentProps {
  chatbotId: string;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export default function BulkDomainAssignment({
  chatbotId,
  isOpen,
  onClose,
  onUpdate,
}: BulkDomainAssignmentProps) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(
    new Set()
  );
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(
    new Set()
  );
  const [priority, setPriority] = useState(5);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'documents' | 'domains' | 'confirm'>(
    'documents'
  );

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, chatbotId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');

      const [domainsResponse, documentsResponse] = await Promise.all([
        domainsAPI.list({ chatbotId }),
        documentsAPI.list({ chatbotId, processingStatus: 'completed' }),
      ]);

      // Filter active domains on client side
      const activeDomains = domainsResponse.domains.filter(
        (domain) => domain.isActive
      );
      setDomains(activeDomains);
      setDocuments(documentsResponse.documents);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleDocumentToggle = (documentId: string) => {
    const newSelected = new Set(selectedDocuments);
    if (newSelected.has(documentId)) {
      newSelected.delete(documentId);
    } else {
      newSelected.add(documentId);
    }
    setSelectedDocuments(newSelected);
  };

  const handleDomainToggle = (domainId: string) => {
    const newSelected = new Set(selectedDomains);
    if (newSelected.has(domainId)) {
      newSelected.delete(domainId);
    } else {
      newSelected.add(domainId);
    }
    setSelectedDomains(newSelected);
  };

  const handleSelectAllDocuments = () => {
    if (selectedDocuments.size === documents.length) {
      setSelectedDocuments(new Set());
    } else {
      setSelectedDocuments(new Set(documents.map((doc) => doc.id)));
    }
  };

  const handleSelectAllDomains = () => {
    if (selectedDomains.size === domains.length) {
      setSelectedDomains(new Set());
    } else {
      setSelectedDomains(new Set(domains.map((domain) => domain.id)));
    }
  };

  const handleBulkAssign = async () => {
    if (selectedDocuments.size === 0 || selectedDomains.size === 0) return;

    try {
      setAssigning(true);
      setError('');

      const assignments = [];
      for (const domainId of selectedDomains) {
        const result = await domainsAPI.bulkAssignDocuments(domainId, {
          documentIds: Array.from(selectedDocuments),
          priority,
          isActive: true,
        });
        assignments.push(result);
      }

      onUpdate();
      onClose();

      // Reset state
      setSelectedDocuments(new Set());
      setSelectedDomains(new Set());
      setStep('documents');
      setPriority(5);
    } catch (error: any) {
      console.error('Failed to bulk assign domains:', error);
      setError(error.response?.data?.message || 'Failed to assign domains');
    } finally {
      setAssigning(false);
    }
  };

  const getFileIcon = (mimeType: string) => {
    return <DocumentTextIcon className="h-5 w-5 text-gray-500" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const canProceedToNext = () => {
    switch (step) {
      case 'documents':
        return selectedDocuments.size > 0;
      case 'domains':
        return selectedDomains.size > 0;
      case 'confirm':
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    switch (step) {
      case 'documents':
        setStep('domains');
        break;
      case 'domains':
        setStep('confirm');
        break;
      case 'confirm':
        handleBulkAssign();
        break;
    }
  };

  const handleBack = () => {
    switch (step) {
      case 'domains':
        setStep('documents');
        break;
      case 'confirm':
        setStep('domains');
        break;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
          {/* Header */}
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Bulk Domain Assignment
                </h3>
                <p className="text-sm text-gray-500">
                  Step{' '}
                  {step === 'documents' ? '1' : step === 'domains' ? '2' : '3'}{' '}
                  of 3:
                  {step === 'documents' && ' Select Documents'}
                  {step === 'domains' && ' Select Domains'}
                  {step === 'confirm' && ' Confirm Assignment'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            {/* Progress Indicator */}
            <div className="mb-6">
              <div className="flex items-center">
                <div
                  className={`flex items-center ${step === 'documents' ? 'text-blue-600' : 'text-green-600'}`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      step === 'documents' ? 'bg-blue-100' : 'bg-green-100'
                    }`}
                  >
                    {step === 'documents' ? (
                      '1'
                    ) : (
                      <CheckIcon className="w-5 h-5" />
                    )}
                  </div>
                  <span className="ml-2 text-sm font-medium">Documents</span>
                </div>
                <ArrowRightIcon className="w-4 h-4 mx-4 text-gray-400" />
                <div
                  className={`flex items-center ${
                    step === 'documents'
                      ? 'text-gray-400'
                      : step === 'domains'
                        ? 'text-blue-600'
                        : 'text-green-600'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      step === 'documents'
                        ? 'bg-gray-100'
                        : step === 'domains'
                          ? 'bg-blue-100'
                          : 'bg-green-100'
                    }`}
                  >
                    {step === 'documents' ? (
                      '2'
                    ) : step === 'domains' ? (
                      '2'
                    ) : (
                      <CheckIcon className="w-5 h-5" />
                    )}
                  </div>
                  <span className="ml-2 text-sm font-medium">Domains</span>
                </div>
                <ArrowRightIcon className="w-4 h-4 mx-4 text-gray-400" />
                <div
                  className={`flex items-center ${
                    step === 'confirm' ? 'text-blue-600' : 'text-gray-400'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      step === 'confirm' ? 'bg-blue-100' : 'bg-gray-100'
                    }`}
                  >
                    3
                  </div>
                  <span className="ml-2 text-sm font-medium">Confirm</span>
                </div>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Content */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                {/* Step 1: Select Documents */}
                {step === 'documents' && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-medium text-gray-900">
                        Select Documents ({documents.length} available)
                      </h4>
                      <button
                        onClick={handleSelectAllDocuments}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        {selectedDocuments.size === documents.length
                          ? 'Deselect All'
                          : 'Select All'}
                      </button>
                    </div>

                    {documents.length === 0 ? (
                      <div className="text-center py-8 bg-gray-50 rounded-lg">
                        <DocumentTextIcon className="mx-auto h-8 w-8 text-gray-400" />
                        <p className="mt-2 text-sm text-gray-500">
                          No documents available
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {documents.map((document) => (
                          <label
                            key={document.id}
                            className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${
                              selectedDocuments.has(document.id)
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedDocuments.has(document.id)}
                              onChange={() => handleDocumentToggle(document.id)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            <div className="ml-3 flex items-center space-x-3 flex-1">
                              {getFileIcon(document.mime_type)}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {document.name}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {formatFileSize(document.file_size)}{' '}
                                  • {document.mime_type}
                                </p>
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 2: Select Domains */}
                {step === 'domains' && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-medium text-gray-900">
                        Select Domains ({domains.length} available)
                      </h4>
                      <button
                        onClick={handleSelectAllDomains}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        {selectedDomains.size === domains.length
                          ? 'Deselect All'
                          : 'Select All'}
                      </button>
                    </div>

                    {domains.length === 0 ? (
                      <div className="text-center py-8 bg-gray-50 rounded-lg">
                        <TagIcon className="mx-auto h-8 w-8 text-gray-400" />
                        <p className="mt-2 text-sm text-gray-500">
                          No domains available
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {domains.map((domain) => (
                          <label
                            key={domain.id}
                            className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${
                              selectedDomains.has(domain.id)
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedDomains.has(domain.id)}
                              onChange={() => handleDomainToggle(domain.id)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            <div className="ml-3 flex-1">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-medium text-gray-900">
                                    {domain.name}
                                  </p>
                                  {domain.description && (
                                    <p className="text-xs text-gray-500">
                                      {domain.description}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center space-x-2">
                                  <span className="text-xs text-gray-500">
                                    Priority {domain.priority}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    {domain._count?.documentDomains || 0} docs
                                  </span>
                                </div>
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}

                    {/* Priority Setting */}
                    {selectedDomains.size > 0 && (
                      <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                        <label
                          htmlFor="priority"
                          className="block text-sm font-medium text-gray-700 mb-2"
                        >
                          Assignment Priority
                        </label>
                        <select
                          id="priority"
                          value={priority}
                          onChange={(e) =>
                            setPriority(parseInt(e.target.value, 10))
                          }
                          className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value={1}>1 - Lowest</option>
                          <option value={2}>2 - Very Low</option>
                          <option value={3}>3 - Low</option>
                          <option value={4}>4 - Below Average</option>
                          <option value={5}>5 - Average</option>
                          <option value={6}>6 - Above Average</option>
                          <option value={7}>7 - High</option>
                          <option value={8}>8 - Very High</option>
                          <option value={9}>9 - Critical</option>
                          <option value={10}>10 - Highest</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 3: Confirm Assignment */}
                {step === 'confirm' && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-medium text-gray-900">
                      Confirm Bulk Assignment
                    </h4>

                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <div>
                        <span className="text-sm font-medium text-gray-700">
                          Documents:
                        </span>
                        <span className="ml-2 text-sm text-gray-900">
                          {selectedDocuments.size} selected
                        </span>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-gray-700">
                          Domains:
                        </span>
                        <span className="ml-2 text-sm text-gray-900">
                          {Array.from(selectedDomains)
                            .map((domainId) => {
                              const domain = domains.find(
                                (d) => d.id === domainId
                              );
                              return domain?.name;
                            })
                            .join(', ')}
                        </span>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-gray-700">
                          Priority:
                        </span>
                        <span className="ml-2 text-sm text-gray-900">
                          {priority}
                        </span>
                      </div>
                    </div>

                    <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                      <p className="text-sm text-yellow-800">
                        This will assign {selectedDocuments.size} documents to{' '}
                        {selectedDomains.size} domains with priority {priority}.
                        This action cannot be undone.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-2">
            <button
              type="button"
              disabled={!canProceedToNext() || assigning}
              onClick={handleNext}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {assigning
                ? 'Assigning...'
                : step === 'confirm'
                  ? 'Assign Domains'
                  : 'Next'}
            </button>
            {step !== 'documents' && (
              <button
                type="button"
                disabled={assigning}
                onClick={handleBack}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Back
              </button>
            )}
            <button
              type="button"
              disabled={assigning}
              onClick={onClose}
              className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
