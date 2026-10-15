import { useState, useEffect, useCallback } from 'react';
import { chatbotsAPI } from '../utils/api';
import { Chatbot } from '../utils/api';

interface UseChatbotsOptions {
  initialLoad?: boolean;
  pageSize?: number;
}

interface UseChatbotsReturn {
  chatbots: Chatbot[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  total: number;
  currentPage: number;
  searchTerm: string;
  loadChatbots: (page?: number, search?: string) => Promise<void>;
  searchChatbots: (search: string) => Promise<void>;
  loadMore: () => Promise<void>;
  clearError: () => void;
}

export const useChatbots = (
  options: UseChatbotsOptions = {}
): UseChatbotsReturn => {
  const { initialLoad = true, pageSize = 20 } = options;

  const [chatbots, setChatbots] = useState<Chatbot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  const loadChatbots = useCallback(
    async (page: number = 1, search: string = '') => {
      try {
        setLoading(true);
        setError(null);

        const response = await chatbotsAPI.list({
          page,
          limit: pageSize,
          search: search.trim() || undefined,
        });

        if (page === 1) {
          // First page or new search - replace all chatbots
          setChatbots(response.chatbots);
        } else {
          // Load more - append to existing chatbots
          setChatbots((prev) => [...prev, ...response.chatbots]);
        }

        setTotal(response.total);
        setCurrentPage(response.page);
        setHasMore(response.page < response.totalPages);
        setSearchTerm(search);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Có lỗi xảy ra khi tải danh sách trợ lý AI'
        );
        console.error('Failed to load chatbots:', err);
      } finally {
        setLoading(false);
      }
    },
    [pageSize]
  );

  const searchChatbots = useCallback(
    async (search: string) => {
      await loadChatbots(1, search);
    },
    [loadChatbots]
  );

  const loadMore = useCallback(async () => {
    if (!loading && hasMore) {
      await loadChatbots(currentPage + 1, searchTerm);
    }
  }, [loadChatbots, currentPage, searchTerm, loading, hasMore]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Initial load
  useEffect(() => {
    if (initialLoad) {
      loadChatbots();
    }
  }, [initialLoad, loadChatbots]);

  return {
    chatbots,
    loading,
    error,
    hasMore,
    total,
    currentPage,
    searchTerm,
    loadChatbots,
    searchChatbots,
    loadMore,
    clearError,
  };
};
