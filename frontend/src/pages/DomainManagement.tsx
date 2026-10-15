import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  PlusIcon,
  ChartBarIcon,
  DocumentTextIcon,
  TagIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import { Domain, domainsAPI } from '@/utils/api';
import DomainList from '@/components/DomainList';
import DomainForm from '@/components/DomainForm';
import DomainKeywordManager from '@/components/DomainKeywordManager';
import DocumentListWithDomains from '@/components/DocumentListWithDomains';
import DocumentUploadWithDomains from '@/components/DocumentUploadWithDomains';
import DomainAnalyticsDashboard from '@/components/DomainAnalyticsDashboard';

type TabType = 'domains' | 'documents' | 'analytics';

interface DomainManagementProps {
  hideHeader?: boolean;
  chatbotId?: string;
}

export default function DomainManagement({
  hideHeader = false,
  chatbotId: propChatbotId,
}: DomainManagementProps) {
  const { id: paramId } = useParams<{ id: string }>();
  const chatbotId = propChatbotId || paramId;
  const [activeTab, setActiveTab] = useState<TabType>('domains');
  const [showDomainForm, setShowDomainForm] = useState(false);
  const [showKeywordManager, setShowKeywordManager] = useState(false);
  const [showDocumentUpload, setShowDocumentUpload] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [editingDomain, setEditingDomain] = useState<Domain | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (!chatbotId) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Invalid chatbot ID</p>
      </div>
    );
  }

  const handleDomainSuccess = () => {
    setRefreshKey((prev) => prev + 1);
    setShowDomainForm(false);
    setEditingDomain(null);
  };

  const handleCreateDomain = () => {
    setEditingDomain(null);
    setShowDomainForm(true);
  };

  const handleEditDomain = (domain: Domain) => {
    setEditingDomain(domain);
    setShowDomainForm(true);
  };

  const handleDomainSelect = (domain: Domain) => {
    setSelectedDomain(domain);
  };

  const handleManageKeywords = (domain: Domain) => {
    setSelectedDomain(domain);
    setShowKeywordManager(true);
  };

  const handleKeywordUpdate = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const handleUploadSuccess = () => {
    setRefreshKey((prev) => prev + 1);
    setShowDocumentUpload(false);
  };

  const tabs = [
    {
      id: 'domains' as TabType,
      name: 'Domains',
      icon: TagIcon,
      description: 'Manage domain categories and keywords',
    },
    {
      id: 'documents' as TabType,
      name: 'Documents',
      icon: DocumentTextIcon,
      description: 'Manage documents and domain assignments',
    },
    {
      id: 'analytics' as TabType,
      name: 'Analytics',
      icon: ChartBarIcon,
      description: 'View domain performance and search analytics',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      {!hideHeader && (
        <div className="border-b border-gray-200 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Domain Management
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Organize documents into domains for better search relevance
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {activeTab === 'domains' && (
                <>
                  {selectedDomain && (
                    <button
                      onClick={() => handleManageKeywords(selectedDomain)}
                      className="btn-secondary inline-flex items-center"
                    >
                      <Cog6ToothIcon className="h-5 w-5 mr-2" />
                      Manage Keywords
                    </button>
                  )}
                  <button
                    onClick={handleCreateDomain}
                    className="btn-primary inline-flex items-center"
                  >
                    <PlusIcon className="h-5 w-5 mr-2" />
                    Add Domain
                  </button>
                </>
              )}
              {activeTab === 'documents' && (
                <button
                  onClick={() => setShowDocumentUpload(true)}
                  className="btn-primary inline-flex items-center"
                >
                  <PlusIcon className="h-5 w-5 mr-2" />
                  Upload Document
                </button>
              )}
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="mt-6">
            <nav className="flex space-x-8">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                      activeTab === tab.id
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span>{tab.name}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Action Buttons - Show even when hiding main header */}
      <div className="flex flex-wrap justify-end gap-3">
        {activeTab === 'domains' && (
          <>
            {selectedDomain && (
              <button
                onClick={() => handleManageKeywords(selectedDomain)}
                className="btn-secondary inline-flex items-center"
              >
                <Cog6ToothIcon className="h-5 w-5 mr-2" />
                Manage Keywords
              </button>
            )}
            <button
              onClick={handleCreateDomain}
              className="btn-primary inline-flex items-center"
            >
              <PlusIcon className="h-5 w-5 mr-2" />
              Add Domain
            </button>
          </>
        )}
        {activeTab === 'documents' && (
          <button
            onClick={() => setShowDocumentUpload(true)}
            className="btn-primary inline-flex items-center"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Upload Document
          </button>
        )}
      </div>

      {/* Tab Navigation when header is hidden */}
      {hideHeader && (
        <div className="border-b border-gray-200 pb-4">
          <nav className="flex space-x-8">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{tab.name}</span>
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === 'domains' && (
          <div className="space-y-6">
            <DomainList
              key={refreshKey}
              chatbotId={chatbotId}
              onDomainSelect={handleDomainSelect}
              onCreateDomain={handleCreateDomain}
              onEditDomain={handleEditDomain}
            />

            {selectedDomain && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-blue-900">
                      Selected Domain: {selectedDomain.name}
                    </h3>
                    <p className="text-sm text-blue-700">
                      {selectedDomain.description || 'No description'}
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleManageKeywords(selectedDomain)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Manage Keywords
                    </button>
                    <button
                      onClick={() => handleEditDomain(selectedDomain)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit Domain
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'documents' && (
          <DocumentListWithDomains
            key={refreshKey}
            chatbotId={chatbotId}
            onUploadClick={() => setShowDocumentUpload(true)}
          />
        )}

        {activeTab === 'analytics' && (
          <DomainAnalyticsDashboard chatbotId={chatbotId} />
        )}
      </div>

      {/* Modals */}
      <DomainForm
        chatbotId={chatbotId}
        domain={editingDomain}
        isOpen={showDomainForm}
        onClose={() => {
          setShowDomainForm(false);
          setEditingDomain(null);
        }}
        onSuccess={handleDomainSuccess}
      />

      {selectedDomain && (
        <DomainKeywordManager
          domain={selectedDomain}
          isOpen={showKeywordManager}
          onClose={() => setShowKeywordManager(false)}
          onUpdate={handleKeywordUpdate}
        />
      )}

      {showDocumentUpload && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">
                    Upload Document with Domain Assignment
                  </h3>
                  <button
                    onClick={() => setShowDocumentUpload(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <span className="sr-only">Close</span>
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                <DocumentUploadWithDomains
                  chatbotId={chatbotId}
                  onUploadSuccess={handleUploadSuccess}
                  onUploadError={(error) =>
                    console.error('Upload error:', error)
                  }
                />
              </div>

              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => setShowDocumentUpload(false)}
                  className="btn-secondary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
