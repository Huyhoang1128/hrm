import React, { useState, useRef, useCallback, useEffect } from 'react';
import { TagIcon } from '@heroicons/react/24/outline';
import { Document, Domain, domainsAPI, documentsAPI } from '@/utils/api';

interface DocumentUploadWithDomainsProps {
  chatbotId: string;
  onUploadSuccess?: (document: Document) => void;
  onUploadError?: (error: string) => void;
  preSelectedDomains?: string[];
}

const DocumentUploadWithDomains: React.FC<DocumentUploadWithDomainsProps> = ({
  chatbotId,
  onUploadSuccess,
  onUploadError,
  preSelectedDomains = [],
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [description, setDescription] = useState('');
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(
    new Set(preSelectedDomains)
  );
  const [domainPriority, setDomainPriority] = useState(5);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchDomains();
  }, [chatbotId]);

  const fetchDomains = async () => {
    try {
      setLoadingDomains(true);
      const response = await domainsAPI.list({
        chatbotId,
      });
      // Filter active domains on client side
      const activeDomains = response.domains.filter(
        (domain) => domain.isActive
      );
      setDomains(activeDomains);
    } catch (error) {
      console.error('Failed to fetch domains:', error);
      onUploadError?.('Failed to load domains');
    } finally {
      setLoadingDomains(false);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
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

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/csv',
      'application/csv',
      'text/comma-separated-values',
      'application/json',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    // Also check file extension for CSV files since macOS may report CSV as text/plain
    const fileExtension = file.name.toLowerCase().split('.').pop();
    const isCSVByExtension = fileExtension === 'csv';
    const isCSVByType = file.type.includes('csv') || file.type.includes('comma-separated-values');
    const isCSV = isCSVByExtension || isCSVByType;
    
    // Allow CSV files even if MIME type is text/plain
    if (!allowedTypes.includes(file.type) && !isCSV) {
      console.log('File validation failed:', {
        name: file.name,
        type: file.type,
        extension: fileExtension,
        isCSVByExtension,
        isCSVByType,
        allowedTypes
      });
      onUploadError?.(
        'Invalid file format. Please upload PDF, TXT, MD, DOC, DOCX, CSV, XLS, XLSX, or JSON files.'
      );
      return;
    }
    
    console.log('File validation passed:', {
      name: file.name,
      type: file.type,
      extension: fileExtension,
      isCSV
    });

    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      onUploadError?.(
        'File size too large. Please upload files smaller than 10MB.'
      );
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      // Prepare metadata
      const metadata: Record<string, any> = {};
      if (description) {
        metadata.description = description;
      }

      // Upload document
      const document = await documentsAPI.upload(file, chatbotId, metadata);

      clearInterval(progressInterval);
      setUploadProgress(100);

      // Assign to selected domains
      if (selectedDomains.size > 0) {
        const domainAssignments = Array.from(selectedDomains).map((domainId) =>
          domainsAPI.assignDocument(domainId, {
            documentId: document.id,
            priority: domainPriority,
            isActive: true,
          })
        );

        await Promise.all(domainAssignments);
      }

      // Reset form
      setDescription('');
      setSelectedDomains(new Set(preSelectedDomains));
      setDomainPriority(5);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      onUploadSuccess?.(document);

      // Reset progress after a delay
      setTimeout(() => {
        setUploadProgress(0);
        setIsUploading(false);
      }, 1000);
    } catch (error) {
      console.error('Upload failed:', error);
      onUploadError?.('Failed to upload document. Please try again.');
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
        } ${isUploading ? 'pointer-events-none opacity-75' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isUploading ? (
          <div className="space-y-4">
            <div className="w-16 h-16 mx-auto bg-blue-100 rounded-full flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                Uploading...
              </h3>
              <p className="text-sm text-gray-500">
                Please wait while we process your document
              </p>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-500">{uploadProgress}% complete</p>
          </div>
        ) : (
          <>
            <div className="w-16 h-16 mx-auto bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Upload Document
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Drag and drop your file here, or{' '}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-blue-500 hover:text-blue-600 font-medium"
              >
                browse from computer
              </button>
            </p>
            <p className="text-xs text-gray-400">
              Supported formats: PDF, TXT, MD, DOC, DOCX, CSV, XLS, XLSX, JSON
              (Max 10MB)
            </p>
          </>
        )}
      </div>

      {/* Document Details */}
      {!isUploading && (
        <div className="space-y-4">
          {/* Description Input */}
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Description (optional)
            </label>
            <input
              type="text"
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description for this document..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Domain Assignment */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                Assign to Domains (optional)
              </label>
              <span className="text-xs text-gray-500">
                {selectedDomains.size} selected
              </span>
            </div>

            {loadingDomains ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              </div>
            ) : domains.length === 0 ? (
              <div className="text-center py-4 bg-gray-50 rounded-lg">
                <TagIcon className="mx-auto h-8 w-8 text-gray-400" />
                <p className="mt-2 text-sm text-gray-500">
                  No domains available. Create domains first.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                  {domains.map((domain) => (
                    <label
                      key={domain.id}
                      className={`flex items-center p-2 border rounded cursor-pointer transition-colors ${
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
                      <div className="ml-2 flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {domain.name}
                        </span>
                        {domain.description && (
                          <p className="text-xs text-gray-500 truncate">
                            {domain.description}
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>

                {/* Priority Setting */}
                {selectedDomains.size > 0 && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                    <label
                      htmlFor="domainPriority"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      Assignment Priority
                    </label>
                    <select
                      id="domainPriority"
                      value={domainPriority}
                      onChange={(e) =>
                        setDomainPriority(parseInt(e.target.value, 10))
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
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        accept=".pdf,.txt,.md,.doc,.docx,.csv,.xlsx,.xls,.json,text/csv,application/csv,text/comma-separated-values"
        className="hidden"
      />

      {/* Upload Tips */}
      {!isUploading && (
        <div className="bg-blue-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-900 mb-2">
            Upload Tips:
          </h4>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Ensure your document is clear and well-formatted</li>
            <li>• For best results, use text-based documents</li>
            <li>• Large documents may take longer to process</li>
            <li>• Assigning domains helps improve search relevance</li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default DocumentUploadWithDomains;
