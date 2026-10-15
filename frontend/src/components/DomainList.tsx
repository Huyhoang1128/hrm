import { useState, useEffect } from 'react';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  TagIcon,
  DocumentTextIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline';
import { Domain, domainsAPI } from '@/utils/api';

interface DomainListProps {
  chatbotId: string;
  onDomainSelect?: (domain: Domain) => void;
  onCreateDomain?: () => void;
  onEditDomain?: (domain: Domain) => void;
}

export default function DomainList({
  chatbotId,
  onDomainSelect,
  onCreateDomain,
  onEditDomain,
}: DomainListProps) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);

  useEffect(() => {
    fetchDomains();
  }, [chatbotId]);

  const fetchDomains = async () => {
    try {
      setLoading(true);
      const response = await domainsAPI.list({ chatbotId });
      setDomains(response.domains);
    } catch (error: any) {
      console.error('Failed to fetch domains:', error);

      if (error.response?.status === 404) {
        setError(
          'Domain management features are not available yet. Please ensure the backend domain APIs are implemented.'
        );
      } else {
        const errorMessage =
          error.response?.data?.message ||
          error.message ||
          'Failed to load domains';
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (domain: Domain) => {
    try {
      await domainsAPI.update(domain.id, { isActive: !domain.isActive });
      await fetchDomains();
    } catch (error) {
      console.error('Failed to toggle domain status:', error);
      setError('Failed to update domain status');
    }
  };

  const handleDeleteDomain = async (domain: Domain) => {
    if (
      !confirm(`Are you sure you want to delete the domain "${domain.name}"?`)
    ) {
      return;
    }

    try {
      await domainsAPI.delete(domain.id);
      await fetchDomains();
    } catch (error) {
      console.error('Failed to delete domain:', error);
      setError('Failed to delete domain');
    }
  };

  const handleDomainClick = (domain: Domain) => {
    setSelectedDomain(domain);
    onDomainSelect?.(domain);
  };

  const getPriorityColor = (priority: number) => {
    if (priority >= 8) return 'bg-red-100 text-red-800';
    if (priority >= 5) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
  };

  const getPriorityLabel = (priority: number) => {
    if (priority >= 8) return 'High';
    if (priority >= 5) return 'Medium';
    return 'Low';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Domains Grid */}
      {domains.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <TagIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No domains</h3>
          <p className="mt-1 text-sm text-gray-500">
            Get started by creating your first domain.
          </p>
          {onCreateDomain && (
            <div className="mt-6">
              <button
                onClick={onCreateDomain}
                className="btn-primary inline-flex items-center"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                Add Domain
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {domains.map((domain) => (
            <div
              key={domain.id}
              className={`bg-white border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer ${
                selectedDomain?.id === domain.id
                  ? 'border-primary-500 ring-2 ring-primary-200'
                  : 'border-gray-200'
              }`}
              onClick={() => handleDomainClick(domain)}
            >
              {/* Domain Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-gray-900 truncate">
                    {domain.name}
                  </h4>
                  {domain.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {domain.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center space-x-1 ml-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleStatus(domain);
                    }}
                    className={`p-1 rounded ${
                      domain.isActive
                        ? 'text-green-600 hover:text-green-900'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                    title={domain.isActive ? 'Deactivate' : 'Activate'}
                  >
                    {domain.isActive ? (
                      <EyeIcon className="h-4 w-4" />
                    ) : (
                      <EyeSlashIcon className="h-4 w-4" />
                    )}
                  </button>
                  {onEditDomain && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditDomain(domain);
                      }}
                      className="p-1 text-primary-600 hover:text-primary-900"
                      title="Edit domain"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteDomain(domain);
                    }}
                    className="p-1 text-red-600 hover:text-red-900"
                    title="Delete domain"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Domain Stats */}
              <div className="flex items-center justify-between text-xs text-gray-500">
                <div className="flex items-center space-x-3">
                  <span className="flex items-center">
                    <TagIcon className="h-3 w-3 mr-1" />
                    {domain._count?.keywords || 0} keywords
                  </span>
                  <span className="flex items-center">
                    <DocumentTextIcon className="h-3 w-3 mr-1" />
                    {domain._count?.documentDomains || 0} docs
                  </span>
                </div>
                <span
                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPriorityColor(
                    domain.priority
                  )}`}
                >
                  {getPriorityLabel(domain.priority)}
                </span>
              </div>

              {/* Status Indicator */}
              <div className="mt-3 flex items-center justify-between">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    domain.isActive
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {domain.isActive ? 'Active' : 'Inactive'}
                </span>
                <span className="text-xs text-gray-400">
                  Created {new Date(domain.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
