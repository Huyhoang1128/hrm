import { useState, useEffect } from 'react';
import {
  PlusIcon,
  DocumentTextIcon,
  DocumentIcon,
  DocumentMagnifyingGlassIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  TagIcon,
  Cog6ToothIcon,
  EllipsisVerticalIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import {
  Document,
  Domain,
  DocumentDomain,
  documentsAPI,
  domainsAPI,
} from '@/utils/api';
import DocumentDomainAssignment from './DocumentDomainAssignment';
import BulkDomainAssignment from './BulkDomainAssignment';

interface DocumentWithDomains extends Document {
  documentDomains?: DocumentDomain[];
  errorMessage?: string;
}

interface DocumentListWithDomainsProps {
  chatbotId: string;
  onUploadClick?: () => void;
}

export default function DocumentListWithDomains({
  chatbotId,
  onUploadClick,
}: DocumentListWithDomainsProps) {
  const [documents, setDocuments] = useState<DocumentWithDomains[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(
    null
  );
  const [showDomainAssignment, setShowDomainAssignment] = useState(false);
  const [showBulkAssignment, setShowBulkAssignment] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [indexingStatus, setIndexingStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchData();
  }, [chatbotId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');

      console.log('Fetching data for chatbotId:', chatbotId);

      // First try to fetch documents and domains separately to isolate issues
      let documentsResponse, domainsResponse;

      try {
        documentsResponse = await documentsAPI.list({ chatbotId });
        console.log('Documents fetched:', documentsResponse.documents);
      } catch (docError) {
        console.error('Failed to fetch documents:', docError);
        throw new Error('Failed to fetch documents');
      }

      try {
        domainsResponse = await domainsAPI.list({ chatbotId });
        console.log('Domains fetched:', domainsResponse.domains.length);
      } catch (domainError: any) {
        console.error('Failed to fetch domains:', domainError);

        // Check if it's a 404 (API not implemented) or other error
        if (domainError.response?.status === 404) {
          console.warn(
            'Domain API not implemented yet, running in fallback mode'
          );
          setError(
            'Domain management features are not available yet. Please ensure the backend domain APIs are implemented.'
          );
        }

        // Continue without domains if domain API fails
        domainsResponse = { domains: [] };
      }

      // Fetch domain assignments for each document (optional, continue if fails)
      const documentsWithDomains = await Promise.all(
        documentsResponse.documents.map(async (doc) => {
          try {
            const docDetails = await documentsAPI.getById(doc.id);
            return {
              ...doc,
              documentDomains: docDetails.documentDomains || [],
            };
          } catch (error) {
            console.warn(
              `Failed to fetch domains for document ${doc.id}:`,
              error
            );
            return {
              ...doc,
              documentDomains: [],
            };
          }
        })
      );

      setDocuments(documentsWithDomains);
      setDomains(domainsResponse.domains);
    } catch (error: any) {
      console.error('Failed to fetch documents:', error);
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        'Failed to load documents';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) {
      return;
    }

    try {
      await documentsAPI.delete(documentId);
      await fetchData(); // Refresh the list
    } catch (error) {
      console.error('Failed to delete document:', error);
      setError('Failed to delete document');
    }
  };

  const handleDownload = async (documentId: string) => {
    try {
      setDownloadingId(documentId);
      await documentsAPI.download(documentId);
    } catch (error) {
      console.error('Failed to download document:', error);
      setError('Failed to download document');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleAssignDomains = (document: Document) => {
    setSelectedDocument(document);
    setShowDomainAssignment(true);
    setActiveDropdown(null);
  };

  const handleIndex = async (documentId: string) => {
    if (!confirm('Are you sure you want to index this document? This will process the document for chatbot use.')) {
      return;
    }

    try {
      setIndexingId(documentId);
      setIndexingStatus(prev => ({ ...prev, [documentId]: 'Indexing...' }));
      
      // Call the indexing API
      const result = await documentsAPI.index(documentId, chatbotId);
      
      setIndexingStatus(prev => ({ ...prev, [documentId]: 'Indexing queued successfully!' }));
      
      // Show success message
      alert('Document indexing command sent successfully! The document will be processed asynchronously.');
      
      // Refresh data after a short delay to show updated status
      setTimeout(() => {
        fetchData();
      }, 2000);
      
    } catch (error: any) {
      console.error('Failed to index document:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Failed to index document';
      setIndexingStatus(prev => ({ ...prev, [documentId]: `Error: ${errorMessage}` }));
      setError(`Failed to index document: ${errorMessage}`);
    } finally {
      setIndexingId(null);
    }
  };

  const getFileIcon = (fileType: string) => {
    switch (fileType?.toLowerCase()) {
      case 'pdf':
        return <DocumentIcon className="h-6 w-6 text-red-500" />;
      case 'docx':
        return <DocumentTextIcon className="h-6 w-6 text-blue-500" />;
      case 'txt':
        return (
          <DocumentMagnifyingGlassIcon className="h-6 w-6 text-gray-500" />
        );
      case 'xlsx':
        return <DocumentIcon className="h-6 w-6 text-green-500" />;
      default:
        return <DocumentIcon className="h-6 w-6 text-gray-500" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'processed':
        return 'bg-green-100 text-green-800';
      case 'processing':
        return 'bg-yellow-100 text-yellow-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      case 'uploaded':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getDomainBadges = (documentDomains: DocumentDomain[]) => {
    console.log('getDomainBadges called with:', documentDomains);
    console.log('Available domains:', domains);

    if (!documentDomains || documentDomains.length === 0) {
      return (
        <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
          No domains
        </span>
      );
    }

    const activeDomains = documentDomains.filter((dd) => dd.isActive);
    console.log('Active domains for document:', activeDomains);

    if (activeDomains.length === 0) {
      return (
        <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
          No active domains
        </span>
      );
    }

    return (
      <div className="flex flex-wrap gap-1">
        {activeDomains.slice(0, 3).map((dd) => {
          const domain = domains.find((d) => d.id === dd.domainId);
          if (!domain) return null;

          const priorityColor =
            dd.priority >= 8
              ? 'bg-red-100 text-red-800'
              : dd.priority >= 5
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-green-100 text-green-800';

          return (
            <span
              key={dd.id}
              className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${priorityColor}`}
              title={`${domain.name} (Priority: ${dd.priority})`}
            >
              <TagIcon className="w-3 h-3 mr-1" />
              {domain.name}
            </span>
          );
        })}
        {activeDomains.length > 3 && (
          <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
            +{activeDomains.length - 3} more
          </span>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage documents and their domain assignments
          </p>
        </div>
        <div className="mt-4 sm:mt-0 flex space-x-3">
          <button
            onClick={() => setShowBulkAssignment(true)}
            className="btn-secondary inline-flex items-center"
          >
            <TagIcon className="h-5 w-5 mr-2" />
            Bulk Assign Domains
          </button>
          {onUploadClick && (
            <button
              onClick={onUploadClick}
              className="btn-primary inline-flex items-center"
            >
              <PlusIcon className="h-5 w-5 mr-2" />
              Upload Document
            </button>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div
          className={`border rounded-md p-4 ${
            error.includes('not available yet')
              ? 'bg-yellow-50 border-yellow-200'
              : 'bg-red-50 border-red-200'
          }`}
        >
          <p
            className={`text-sm ${
              error.includes('not available yet')
                ? 'text-yellow-800'
                : 'text-red-600'
            }`}
          >
            {error}
          </p>
          {error.includes('not available yet') && (
            <div className="mt-2 text-xs text-yellow-700">
              <p>To enable domain management:</p>
              <ul className="list-disc list-inside mt-1">
                <li>Ensure domain database tables are created</li>
                <li>Implement domain API endpoints in the backend</li>
                <li>Run database migrations for domain features</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Documents Table */}
      <div className="card overflow-hidden shadow-none rounded-none">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-header">Document</th>
                <th className="table-header">Type</th>
                <th className="table-header">Size</th>
                <th className="table-header">Status</th>
                <th className="table-header">Domains</th>
                <th className="table-header">Uploaded</th>
                <th className="table-header">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {documents.map((document) => (
                <tr key={document.id} className="hover:bg-gray-50">
                  <td className="table-cell">
                    <div className="flex items-center">
                      {getFileIcon(document.mime_type)}
                      <div className="ml-3">
                        <div className="font-medium text-gray-900">
                          {document.name}
                        </div>
                        {document.metadata?.error_message && (
                          <div className="text-sm text-red-500">
                            {document.metadata.error_message}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="table-cell text-sm text-gray-500">
                        {document.mime_type?.toUpperCase()}
                  </td>
                  <td className="table-cell text-sm text-gray-500">
                    {formatFileSize(document.file_size)}
                  </td>
                  <td className="table-cell">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                        document.status?.toLowerCase()
                      )}`}
                    >
                      {document.status?.toLowerCase() === 'processed'
                        ? 'Completed'
                        : document.status?.toLowerCase() ===
                            'processing'
                          ? 'Processing'
                          : document.status?.toLowerCase() ===
                              'error'
                            ? 'Failed'
                            : document.status?.toLowerCase() ===
                                'uploaded'
                              ? 'Uploaded'
                              : document.status}
                    </span>
                  </td>
                  <td className="table-cell">
                    {getDomainBadges(document.documentDomains || [])}
                  </td>
                  <td className="table-cell text-sm text-gray-500">
                    {new Date(document.created_at).toLocaleDateString()}
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleAssignDomains(document)}
                        className="text-blue-600 hover:text-blue-900"
                        title="Assign to domains"
                      >
                        <TagIcon className="h-5 w-5" />
                      </button>

                      <button
                        onClick={() => handleDownload(document.id)}
                        className="text-primary-600 hover:text-primary-900"
                        title="Download document"
                        disabled={downloadingId === document.id}
                      >
                        {downloadingId === document.id ? (
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600"></div>
                        ) : (
                          <ArrowDownTrayIcon className="h-5 w-5" />
                        )}
                      </button>

                      <button
                        onClick={() => handleIndex(document.id)}
                        className="text-green-600 hover:text-green-900"
                        title="Index document for chatbot"
                        disabled={indexingId === document.id}
                      >
                        {indexingId === document.id ? (
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-600"></div>
                        ) : (
                          <ArrowPathIcon className="h-5 w-5" />
                        )}
                      </button>

                      <div className="relative">
                        <button
                          onClick={() =>
                            setActiveDropdown(
                              activeDropdown === document.id
                                ? null
                                : document.id
                            )
                          }
                          className="text-gray-600 hover:text-gray-900"
                          title="More actions"
                        >
                          <EllipsisVerticalIcon className="h-5 w-5" />
                        </button>

                        {activeDropdown === document.id && (
                          <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-10 border border-gray-200">
                            <div className="py-1">
                              <button
                                onClick={() => handleAssignDomains(document)}
                                className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                              >
                                <Cog6ToothIcon className="h-4 w-4 mr-2" />
                                Manage Domains
                              </button>
                              <button
                                onClick={() => handleIndex(document.id)}
                                className="flex items-center w-full px-4 py-2 text-sm text-green-700 hover:bg-green-50"
                              >
                                <ArrowPathIcon className="h-4 w-4 mr-2" />
                                Index Document
                              </button>
                              <button
                                onClick={() => handleDelete(document.id)}
                                className="flex items-center w-full px-4 py-2 text-sm text-red-700 hover:bg-red-50"
                              >
                                <TrashIcon className="h-4 w-4 mr-2" />
                                Delete Document
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    {indexingStatus[document.id] && (
                      <div className="mt-1 text-xs text-gray-500">
                        {indexingStatus[document.id]}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {documents.length === 0 && (
        <div className="text-center py-12">
          <DocumentIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">
            No documents
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Get started by uploading a document.
          </p>
          {onUploadClick && (
            <div className="mt-6">
              <button
                onClick={onUploadClick}
                className="btn-primary inline-flex items-center"
              >
                <PlusIcon className="h-5 w-5 mr-2" />
                Upload Document
              </button>
            </div>
          )}
        </div>
      )}

      {/* Domain Assignment Modal */}
      <DocumentDomainAssignment
        chatbotId={chatbotId}
        document={selectedDocument}
        isOpen={showDomainAssignment}
        onClose={() => {
          setShowDomainAssignment(false);
          setSelectedDocument(null);
        }}
        onUpdate={fetchData}
      />

      {/* Bulk Assignment Modal */}
      <BulkDomainAssignment
        chatbotId={chatbotId}
        isOpen={showBulkAssignment}
        onClose={() => setShowBulkAssignment(false)}
        onUpdate={fetchData}
      />

      {/* Click outside to close dropdown */}
      {activeDropdown && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setActiveDropdown(null)}
        />
      )}
    </div>
  );
}
