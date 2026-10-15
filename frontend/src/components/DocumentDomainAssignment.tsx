import { useState, useEffect } from 'react';
import { XMarkIcon, TagIcon, CheckIcon } from '@heroicons/react/24/outline';
import {
  Domain,
  Document,
  DocumentDomain,
  domainsAPI,
  documentsAPI,
} from '@/utils/api';

interface DocumentDomainAssignmentProps {
  chatbotId: string;
  document?: Document | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export default function DocumentDomainAssignment({
  chatbotId,
  document,
  isOpen,
  onClose,
  onUpdate,
}: DocumentDomainAssignmentProps) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [documentDomains, setDocumentDomains] = useState<DocumentDomain[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(
    new Set()
  );
  const [priority, setPriority] = useState(5);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (isOpen && chatbotId) {
      fetchData();
    }
  }, [isOpen, chatbotId, document]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');

      console.log('Fetching domains for chatbotId:', chatbotId);

      // Fetch available domains (only active ones)
      const domainsResponse = await domainsAPI.list({
        chatbotId,
        // Remove isActive filter for now to avoid backend validation issues
        // isActive: true,
      });

      console.log('Domains response:', domainsResponse);
      // Filter active domains on client side
      const activeDomains = domainsResponse.domains.filter(
        (domain) => domain.isActive
      );
      setDomains(activeDomains);

      // If we have a specific document, fetch its current domain assignments
      if (document) {
        console.log('Fetching document details for:', document.id);

        try {
          const documentDetails = await documentsAPI.getById(document.id);
          console.log('Document details:', documentDetails);

          // Handle different possible response structures
          const documentDomains = documentDetails.documentDomains || [];

          console.log('Document domains from API:', documentDomains);
          setDocumentDomains(documentDomains);

          // Pre-select currently assigned domains
          const assignedDomainIds = new Set<string>(
            documentDomains.map((dd: DocumentDomain) => dd.domainId)
          );
          console.log('Pre-selected domain IDs:', assignedDomainIds);
          setSelectedDomains(assignedDomainIds);
        } catch (docError) {
          console.warn(
            'Failed to fetch document details, continuing without assignments:',
            docError
          );
          setDocumentDomains([]);
          setSelectedDomains(new Set());
        }
      } else {
        setDocumentDomains([]);
        setSelectedDomains(new Set());
      }
    } catch (error: any) {
      console.error('Failed to fetch data:', error);
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        'Failed to load domains and assignments';
      setError(errorMessage);
    } finally {
      setLoading(false);
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

  const handleAssignDomains = async () => {
    if (!document) return;

    try {
      setAssigning(true);
      setError('');

      // Get currently assigned domains
      const currentlyAssigned = new Set(
        documentDomains.map((dd) => dd.domainId)
      );

      // Domains to add
      const toAdd = Array.from(selectedDomains).filter(
        (id) => !currentlyAssigned.has(id)
      );

      // Domains to remove (allow removing all domains)
      const toRemove = documentDomains.filter(
        (dd) => !selectedDomains.has(dd.domainId)
      );

      // Domains to update priority for (existing domains that remain selected)
      const toUpdate = documentDomains.filter(
        (dd) => selectedDomains.has(dd.domainId) && dd.priority !== priority
      );

      // Add new domain assignments
      for (const domainId of toAdd) {
        await domainsAPI.assignDocument(domainId, {
          documentId: document.id,
          priority,
          isActive: true,
        });
      }

      // Update existing domain assignments if priority changed
      for (const dd of toUpdate) {
        await domainsAPI.updateDocumentAssociation(dd.id, {
          priority,
          isActive: true,
        });
      }

      // Remove domain assignments
      for (const dd of toRemove) {
        await domainsAPI.removeDocumentAssociation(dd.id);
      }

      onUpdate();
      onClose();
    } catch (error: any) {
      console.error('Failed to assign domains:', error);
      setError(
        error.response?.data?.message || 'Failed to update domain assignments'
      );
    } finally {
      setAssigning(false);
    }
  };

  // Bulk assign function for future use
  // const handleBulkAssign = async (domainIds: string[]) => {
  //   if (!document) return;

  //   try {
  //     setAssigning(true);
  //     setError('');

  //     // Use bulk assignment API if available
  //     await domainsAPI.bulkAssignDocuments(domainIds[0], {
  //       documentIds: [document.id],
  //       priority,
  //       isActive: true,
  //     });

  //     onUpdate();
  //     await fetchData(); // Refresh data
  //   } catch (error: any) {
  //     console.error('Failed to bulk assign domains:', error);
  //     setError(
  //       error.response?.data?.message || 'Failed to bulk assign domains'
  //     );
  //   } finally {
  //     setAssigning(false);
  //   }
  // };

  const isAssigned = (domainId: string) => {
    return documentDomains.some((dd) => dd.domainId === domainId);
  };

  const getAssignmentPriority = (domainId: string) => {
    const assignment = documentDomains.find((dd) => dd.domainId === domainId);
    return assignment?.priority || 5;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
          {/* Header */}
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Assign Document to Domains
                </h3>
                {document && (
                  <p className="text-sm text-gray-500 mt-1">
                    Document: {document.name}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            {/* Priority Setting */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <label
                htmlFor="priority"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Assignment Priority
              </label>
              <select
                id="priority"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value, 10))}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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

            {/* Error Message */}
            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Domains List */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">
                Available Domains ({domains.length})
              </h4>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                </div>
              ) : domains.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-lg">
                  <TagIcon className="mx-auto h-8 w-8 text-gray-400" />
                  <p className="mt-2 text-sm text-gray-500">
                    No domains available. Create domains first.
                  </p>
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {domains.map((domain) => {
                    const isCurrentlyAssigned = isAssigned(domain.id);
                    const isSelected = selectedDomains.has(domain.id);
                    const currentPriority = getAssignmentPriority(domain.id);

                    return (
                      <div
                        key={domain.id}
                        className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => handleDomainToggle(domain.id)}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="flex-shrink-0">
                            {isSelected ? (
                              <div className="w-5 h-5 bg-primary-600 rounded flex items-center justify-center">
                                <CheckIcon className="w-3 h-3 text-white" />
                              </div>
                            ) : (
                              <div className="w-5 h-5 border-2 border-gray-300 rounded"></div>
                            )}
                          </div>
                          <div>
                            <h5 className="font-medium text-gray-900">
                              {domain.name}
                            </h5>
                            {domain.description && (
                              <p className="text-sm text-gray-500">
                                {domain.description}
                              </p>
                            )}
                            {isCurrentlyAssigned && (
                              <p className="text-xs text-green-600">
                                Currently assigned (Priority: {currentPriority})
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              domain.priority >= 8
                                ? 'bg-red-100 text-red-800'
                                : domain.priority >= 5
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-green-100 text-green-800'
                            }`}
                          >
                            Priority {domain.priority}
                          </span>
                          <span className="text-xs text-gray-500">
                            {domain._count?.documentDomains || 0} docs
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-2">
            <button
              type="button"
              disabled={assigning || selectedDomains.size === 0}
              onClick={handleAssignDomains}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {assigning
                ? 'Updating...'
                : `Update Assignments (${selectedDomains.size})`}
            </button>
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
