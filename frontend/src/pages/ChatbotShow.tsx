import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Chatbot, Conversation, Document, Domain } from '../utils/api';
import { chatbotsAPI, documentsAPI } from '../utils/api';
import DomainList from '../components/DomainList';
import DomainForm from '../components/DomainForm';
import DomainKeywordManager from '../components/DomainKeywordManager';
import DomainAnalyticsDashboard from '../components/DomainAnalyticsDashboard';
import DocumentListWithDomains from '../components/DocumentListWithDomains';

export default function ChatbotShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [chatbot, setChatbot] = useState<Chatbot | null>(null);
  const [conversation, setConversation] = useState<Conversation | undefined>(
    undefined
  );
  const [documents, setDocuments] = useState<Document[]>([]);
  const [activeTab, setActiveTab] = useState<
    'chat' | 'documents' | 'domains' | 'analytics' | 'settings'
  >('chat');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Domain management states
  const [showDomainForm, setShowDomainForm] = useState(false);
  const [showKeywordManager, setShowKeywordManager] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [editingDomain, setEditingDomain] = useState<Domain | null>(null);

  useEffect(() => {
    if (id) {
      loadChatbot();
      loadDocuments();
    }
  }, [id]);

  const loadChatbot = async () => {
    try {
      setLoading(true);
      const data = await chatbotsAPI.getById(id!);
      setChatbot(data);
    } catch (err) {
      setError('Failed to load chatbot');
      console.error('Error loading chatbot:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDocuments = async () => {
    try {
      const data = await documentsAPI.list({ chatbotId: id });
      setDocuments(data.documents);
    } catch (err) {
      console.error('Error loading documents:', err);
    }
  };

  const handleDocumentUploadSuccess = (document: Document) => {
    setDocuments((prev) => [document, ...prev]);
    // Show success message
  };

  const handleDocumentUploadError = (error: string) => {
    // Show error message
    console.error('Upload error:', error);
  };

  const handleConversationUpdate = (newConversation: Conversation) => {
    setConversation(newConversation);
  };

  // Domain management handlers
  const handleDomainSelect = (domain: Domain) => {
    setSelectedDomain(domain);
  };

  const handleCreateDomain = () => {
    setEditingDomain(null);
    setShowDomainForm(true);
  };

  const handleEditDomain = (domain: Domain) => {
    setEditingDomain(domain);
    setShowDomainForm(true);
  };

  const handleDomainSuccess = () => {
    setShowDomainForm(false);
    setEditingDomain(null);
    // Refresh domain list if needed
  };

  const handleManageKeywords = (domain: Domain) => {
    setSelectedDomain(domain);
    setShowKeywordManager(true);
  };

  const handleKeywordUpdate = () => {
    // Refresh domain list if needed
  };

  const handleToggleStatus = async () => {
    if (!chatbot) return;

    try {
      const updatedChatbot = await chatbotsAPI.toggleStatus(
        chatbot.id,
        !chatbot.isActive
      );
      setChatbot(updatedChatbot);
    } catch (err) {
      console.error('Error toggling status:', err);
    }
  };

  const handleDeleteChatbot = async () => {
    if (!chatbot || !confirm('Are you sure you want to delete this chatbot?'))
      return;

    try {
      await chatbotsAPI.delete(chatbot.id);
      navigate('/dashboard/chatbots');
    } catch (err) {
      console.error('Error deleting chatbot:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error || !chatbot) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Lỗi</h2>
        <p className="text-gray-600">{error || 'Trợ lý AI không tồn tại'}</p>
        <button
          onClick={() => navigate('/dashboard/chatbots')}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
        >
          Quay lại danh sách trợ lý AI
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{chatbot.name}</h1>
          <p className="mt-1 text-sm text-gray-500">{chatbot.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleToggleStatus}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              chatbot.isActive
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            }`}
          >
            {chatbot.isActive ? 'Tạm dừng' : 'Kích hoạt'}
          </button>
          <button
            onClick={() => navigate(`/dashboard/chatbots/${chatbot.id}/edit`)}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 text-sm"
          >
            Chỉnh sửa
          </button>
          <button
            onClick={handleDeleteChatbot}
            className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 text-sm"
          >
            Xóa
          </button>
        </div>
      </div>

      {/* Status Badge */}
      <div className="flex items-center space-x-2">
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            chatbot.isActive
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          {chatbot.isActive ? 'Hoạt động' : 'Không hoạt động'}
        </span>
        <span className="text-sm text-gray-500">
          Ngày tạo: {new Date(chatbot.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('chat')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'chat'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setActiveTab('documents')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'documents'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Documents ({documents.length})
          </button>
          <button
            onClick={() => setActiveTab('domains')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'domains'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Domains
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'analytics'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Analytics
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'settings'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Settings
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[600px]">
        {activeTab === 'chat' && (
          <div className="h-[600px] flex items-center justify-center bg-gray-50 rounded-lg">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">
                Chat Interface
              </h3>
              <p className="text-gray-600 max-w-md">
                The chat interface has been removed. This feature is no longer available.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'documents' && (
          <div>
            <DocumentListWithDomains
              chatbotId={id!}
              onUploadClick={() => console.log('Upload document')}
            />
          </div>
        )}

        {activeTab === 'domains' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-lg font-medium text-gray-900">Domains</h3>
                <p className="text-sm text-gray-500">
                  Manage document domains for better search relevance
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {selectedDomain && (
                  <button
                    onClick={() => handleManageKeywords(selectedDomain)}
                    className="btn-secondary inline-flex items-center"
                  >
                    Manage Keywords
                  </button>
                )}
                <button
                  onClick={handleCreateDomain}
                  className="btn-primary inline-flex items-center"
                >
                  Add Domain
                </button>
              </div>
            </div>

            <DomainList
              chatbotId={id!}
              onDomainSelect={handleDomainSelect}
              onCreateDomain={handleCreateDomain}
              onEditDomain={handleEditDomain}
            />
          </div>
        )}

        {activeTab === 'analytics' && (
          <div>
            <DomainAnalyticsDashboard chatbotId={id!} />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Cài đặt trợ lý AI
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Mô tả
                  </label>
                  <p className="mt-1 text-sm text-gray-900">
                    {chatbot.description || 'Không có mô tả'}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    URL ảnh đại diện
                  </label>
                  <p className="mt-1 text-sm text-gray-900">
                    {chatbot.avatarUrl || 'Không có ảnh đại diện'}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Trạng thái
                  </label>
                  <p className="mt-1 text-sm text-gray-900">
                    {chatbot.isActive ? 'Hoạt động' : 'Không hoạt động'}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Hướng dẫn
              </h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {chatbot.instructions || 'Không có hướng dẫn'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Domain Management Modals */}
      <DomainForm
        chatbotId={id!}
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
    </div>
  );
}
