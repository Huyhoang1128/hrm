import { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Domain, domainsAPI } from '@/utils/api';

interface DomainFormProps {
  chatbotId: string;
  domain?: Domain | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (domain: Domain) => void;
}

export default function DomainForm({
  chatbotId,
  domain,
  isOpen,
  onClose,
  onSuccess,
}: DomainFormProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    priority: 5,
    isActive: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (domain) {
      setFormData({
        name: domain.name,
        description: domain.description || '',
        priority: domain.priority,
        isActive: domain.isActive,
      });
    } else {
      setFormData({
        name: '',
        description: '',
        priority: 5,
        isActive: true,
      });
    }
    setError('');
  }, [domain, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let result: Domain;

      if (domain) {
        // Update existing domain
        result = await domainsAPI.update(domain.id, formData);
      } else {
        // Create new domain
        result = await domainsAPI.create({
          ...formData,
          chatbotId,
        });
      }

      onSuccess(result);
      onClose();
    } catch (error: any) {
      console.error('Failed to save domain:', error);
      setError(
        error.response?.data?.message ||
          `Failed to ${domain ? 'update' : 'create'} domain`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        type === 'checkbox'
          ? (e.target as HTMLInputElement).checked
          : type === 'number'
            ? parseInt(value, 10)
            : value,
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          {/* Header */}
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                {domain ? 'Edit Domain' : 'Create New Domain'}
              </h3>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-gray-700"
                >
                  Domain Name *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="e.g., HR, Technical, Marketing"
                />
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="description"
                  className="block text-sm font-medium text-gray-700"
                >
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  value={formData.description}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Describe what this domain covers..."
                />
              </div>

              {/* Priority */}
              <div>
                <label
                  htmlFor="priority"
                  className="block text-sm font-medium text-gray-700"
                >
                  Priority Level
                </label>
                <select
                  id="priority"
                  name="priority"
                  value={formData.priority}
                  onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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
                <p className="mt-1 text-xs text-gray-500">
                  Higher priority domains will be preferred in search results
                </p>
              </div>

              {/* Active Status */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isActive"
                  name="isActive"
                  checked={formData.isActive}
                  onChange={handleInputChange}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label
                  htmlFor="isActive"
                  className="ml-2 block text-sm text-gray-900"
                >
                  Active domain
                </label>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
            </form>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-2">
            <button
              type="submit"
              disabled={loading || !formData.name.trim()}
              onClick={handleSubmit}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? 'Saving...'
                : domain
                  ? 'Update Domain'
                  : 'Create Domain'}
            </button>
            <button
              type="button"
              disabled={loading}
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
