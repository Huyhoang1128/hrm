import { useState, useEffect } from 'react';
import { TrashIcon, TagIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Domain, DomainKeyword, domainsAPI } from '@/utils/api';

interface DomainKeywordManagerProps {
  domain: Domain;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export default function DomainKeywordManager({
  domain,
  isOpen,
  onClose,
  onUpdate,
}: DomainKeywordManagerProps) {
  const [keywords, setKeywords] = useState<DomainKeyword[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [keywordType, setKeywordType] = useState<
    'primary' | 'secondary' | 'synonym'
  >('primary');
  const [weight, setWeight] = useState(1.0);
  const [addingKeywords, setAddingKeywords] = useState(false);

  useEffect(() => {
    if (isOpen && domain) {
      fetchDomainDetails();
    }
  }, [isOpen, domain]);

  const fetchDomainDetails = async () => {
    try {
      setLoading(true);
      const domainDetails = await domainsAPI.getById(domain.id);
      setKeywords(domainDetails.keywords || []);
    } catch (error) {
      console.error('Failed to fetch domain details:', error);
      setError('Failed to load domain keywords');
    } finally {
      setLoading(false);
    }
  };

  const handleAddKeywords = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newKeywords.trim()) return;

    const keywordList = newKeywords
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (keywordList.length === 0) return;

    try {
      setAddingKeywords(true);
      setError('');

      await domainsAPI.addKeywords(domain.id, {
        keywords: keywordList,
        keywordType,
        weight,
      });

      setNewKeywords('');
      await fetchDomainDetails();
      onUpdate();
    } catch (error: any) {
      console.error('Failed to add keywords:', error);
      setError(error.response?.data?.message || 'Failed to add keywords');
    } finally {
      setAddingKeywords(false);
    }
  };

  const handleRemoveKeyword = async (keywordId: string) => {
    try {
      await domainsAPI.removeKeyword(keywordId);
      await fetchDomainDetails();
      onUpdate();
    } catch (error: any) {
      console.error('Failed to remove keyword:', error);
      setError(error.response?.data?.message || 'Failed to remove keyword');
    }
  };

  const getKeywordTypeColor = (type: string) => {
    switch (type) {
      case 'primary':
        return 'bg-blue-100 text-blue-800';
      case 'secondary':
        return 'bg-green-100 text-green-800';
      case 'synonym':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getWeightColor = (weight: number) => {
    if (weight >= 2) return 'text-red-600';
    if (weight >= 1.5) return 'text-yellow-600';
    return 'text-green-600';
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
                  Manage Keywords
                </h3>
                <p className="text-sm text-gray-500">Domain: {domain.name}</p>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            {/* Add Keywords Form */}
            <form
              onSubmit={handleAddKeywords}
              className="mb-6 p-4 bg-gray-50 rounded-lg"
            >
              <h4 className="text-sm font-medium text-gray-900 mb-3">
                Add New Keywords
              </h4>

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="keywords"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Keywords (comma-separated)
                  </label>
                  <input
                    type="text"
                    id="keywords"
                    value={newKeywords}
                    onChange={(e) => setNewKeywords(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="e.g., policy, procedure, guidelines"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="keywordType"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Type
                    </label>
                    <select
                      id="keywordType"
                      value={keywordType}
                      onChange={(e) => setKeywordType(e.target.value as any)}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value="primary">Primary</option>
                      <option value="secondary">Secondary</option>
                      <option value="synonym">Synonym</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="weight"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Weight
                    </label>
                    <input
                      type="number"
                      id="weight"
                      min="0.1"
                      max="10"
                      step="0.1"
                      value={weight}
                      onChange={(e) => setWeight(parseFloat(e.target.value))}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={addingKeywords || !newKeywords.trim()}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addingKeywords ? 'Adding...' : 'Add Keywords'}
                </button>
              </div>
            </form>

            {/* Error Message */}
            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Keywords List */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">
                Current Keywords ({keywords.length})
              </h4>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                </div>
              ) : keywords.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-lg">
                  <TagIcon className="mx-auto h-8 w-8 text-gray-400" />
                  <p className="mt-2 text-sm text-gray-500">
                    No keywords added yet
                  </p>
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {keywords.map((keyword) => (
                    <div
                      key={keyword.id}
                      className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg"
                    >
                      <div className="flex items-center space-x-3">
                        <span className="font-medium text-gray-900">
                          {keyword.keyword}
                        </span>
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getKeywordTypeColor(
                            keyword.keywordType
                          )}`}
                        >
                          {keyword.keywordType}
                        </span>
                        <span
                          className={`text-sm font-medium ${getWeightColor(keyword.weight)}`}
                        >
                          {keyword.weight}x
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemoveKeyword(keyword.id)}
                        className="text-red-600 hover:text-red-900 p-1"
                        title="Remove keyword"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button type="button" onClick={onClose} className="btn-secondary">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
