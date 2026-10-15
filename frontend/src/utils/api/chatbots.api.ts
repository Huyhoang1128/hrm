import type { AxiosResponse } from 'axios';
import { managementApi } from './client';
import type {
  Chatbot,
  ChatRequest,
  ChatResponse,
  Document,
  Conversation,
  Message,
  Media,
  Domain,
  DomainKeyword,
  DocumentDomain,
  BotPermission,
} from './types';

// Chatbots API
export const chatbotsAPI = {
  create: async (data: Partial<Chatbot>): Promise<Chatbot> => {
    const response: AxiosResponse<{ success: boolean; data: Chatbot }> =
      await managementApi.post('/chatbots/', data);
    return response.data.data;
  },

  list: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    chatbots: Chatbot[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    const response: AxiosResponse<{
      success: boolean;
      data: {
        chatbots: Chatbot[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    }> = await managementApi.get('/chatbots/', { params });
    return response.data.data;
  },

  getById: async (id: string): Promise<Chatbot> => {
    const response: AxiosResponse<{ success: boolean; data: Chatbot }> =
      await managementApi.get(`/chatbots/${id}/`);
    return response.data.data;
  },

  update: async (id: string, data: Partial<Chatbot>): Promise<Chatbot> => {
    const response: AxiosResponse<{ success: boolean; data: Chatbot }> =
      await managementApi.put(`/chatbots/${id}/`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await managementApi.delete(`/chatbots/${id}/`);
  },

  toggleStatus: async (id: string, isActive: boolean): Promise<Chatbot> => {
    const response: AxiosResponse<{ success: boolean; data: Chatbot }> =
      await managementApi.patch(`/chatbots/${id}/status/`, { isActive });
    return response.data.data;
  },

  sendMessage: async (id: string, data: ChatRequest): Promise<ChatResponse> => {
    const response: AxiosResponse<{ success: boolean; data: ChatResponse }> =
      await managementApi.post(`/chatbots/${id}/chat`, data);
    return response.data.data;
  },

  processDocument: async (id: string, documentId: string): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.post(`/chatbots/${id}/process-document`, {
        documentId,
      });
    return response.data.data;
  },

  vectorSearch: async (
    id: string,
    query: string,
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.post(`/chatbots/${id}/vector-search`, {
        query,
        limit,
        threshold,
      });
    return response.data.data;
  },

  getStatistics: async (id: string): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.get(`/chatbots/${id}/statistics`);
    return response.data.data;
  },

  getListStatistics: async (): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.get('/chatbots/statistics');
    return response.data.data;
  },
};

// Helper function to sanitize filename
const sanitizeFilename = (filename: string): string => {
  // Remove Vietnamese accents and special characters
  return filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace special chars with underscore
    .replace(/_+/g, '_') // Replace multiple underscores with single
    .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
};

// Documents API
export const documentsAPI = {
  upload: async (
    file: File,
    chatbotId?: string,
    metadata?: Record<string, any>
  ): Promise<Document> => {
    const formData = new FormData();

    // Create a new File object with sanitized filename
    const sanitizedName = sanitizeFilename(file.name);
    const sanitizedFile = new File([file], sanitizedName, { type: file.type });

    formData.append('file', sanitizedFile);
    if (chatbotId) formData.append('chatbot_id', chatbotId);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));

    const response: AxiosResponse<{ success: boolean; data: Document }> =
      await managementApi.post('/documents/upload/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
    return response.data.data;
  },

  list: async (params?: {
    page?: number;
    limit?: number;
    chatbotId?: string;
    processingStatus?: string;
  }): Promise<{
    documents: Document[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    const response: AxiosResponse<{
      success: boolean;
      data: {
        documents: Document[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    }> = await managementApi.get('/documents/', { params });
    return response.data.data;
  },

  getById: async (id: string): Promise<Document> => {
    const response: AxiosResponse<{ success: boolean; data: Document }> =
      await managementApi.get(`/documents/${id}/`);
    return response.data.data;
  },

  update: async (id: string, data: Partial<Document>): Promise<Document> => {
    const response: AxiosResponse<{ success: boolean; data: Document }> =
      await managementApi.put(`/documents/${id}/`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await managementApi.delete(`/documents/${id}/`);
  },

  updateProcessingStatus: async (
    id: string,
    status: string
  ): Promise<Document> => {
    const response: AxiosResponse<{ success: boolean; data: Document }> =
      await managementApi.patch(`/documents/${id}/status/`, { status });
    return response.data.data;
  },

  attachToChatbot: async (
    documentId: string,
    chatbotId: string
  ): Promise<void> => {
    await managementApi.post(`/documents/${documentId}/attach/`, { chatbotId });
  },

  detachFromChatbot: async (documentId: string): Promise<void> => {
    await managementApi.post(`/documents/${documentId}/detach/`);
  },

  download: async (id: string): Promise<void> => {
    const response = await managementApi.get(`/documents/${id}/download/`, {
      responseType: 'blob',
    });

    // Create download link
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;

    // Get filename from response headers
    const contentDisposition = response.headers['content-disposition'];
    let filename = 'document';
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="(.+)"/);
      if (filenameMatch) {
        filename = filenameMatch[1];
      }
    }

    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  // Index document via Redis stream
  index: async (documentId: string, chatbotId: string): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.post('/documents/index/', {
        document_id: documentId,
        chatbot_id: chatbotId,
      });
    return response.data.data;
  },
};

// Conversations API
export const conversationsAPI = {
  create: async (data: {
    title?: string;
    chatbotId?: string;
  }): Promise<Conversation> => {
    const response: AxiosResponse<{ success: boolean; data: Conversation }> =
      await managementApi.post('/conversations/', data);
    return response.data.data;
  },

  list: async (params?: {
    page?: number;
    limit?: number;
    chatbotId?: string;
    search?: string;
  }): Promise<{
    conversations: Conversation[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    const response: AxiosResponse<{
      success: boolean;
      data: {
        conversations: Conversation[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    }> = await managementApi.get('/conversations/', { params });
    return response.data.data;
  },

  getById: async (id: string): Promise<Conversation> => {
    const response: AxiosResponse<{ success: boolean; data: Conversation }> =
      await managementApi.get(`/conversations/${id}`);
    return response.data.data;
  },

  update: async (
    id: string,
    data: Partial<Conversation>
  ): Promise<Conversation> => {
    const response: AxiosResponse<{ success: boolean; data: Conversation }> =
      await managementApi.put(`/conversations/${id}`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await managementApi.delete(`/conversations/${id}`);
  },

  bulkDelete: async (
    conversationIds: string[]
  ): Promise<{
    deletedCount: number;
    failedCount: number;
    errors: string[];
  }> => {
    const response: AxiosResponse<{
      success: boolean;
      data: {
        deletedCount: number;
        failedCount: number;
        errors: string[];
      };
    }> = await managementApi.post('/conversations/bulk-delete', {
      conversationIds,
    });
    return response.data.data;
  },

  getMessages: async (
    id: string,
    limit?: number,
    offset?: number
  ): Promise<Message[]> => {
    const response: AxiosResponse<{ success: boolean; data: Message[] }> =
      await managementApi.get(`/conversations/${id}/messages`, {
        params: { limit, offset },
      });
    return response.data.data;
  },

  addMessage: async (
    id: string,
    data: { role: 'USER' | 'ASSISTANT'; content: string; metadata?: any }
  ): Promise<Message> => {
    const response: AxiosResponse<{ success: boolean; data: Message }> =
      await managementApi.post(`/conversations/${id}/messages`, data);
    return response.data.data;
  },

  toggleAutoReply: async (id: string): Promise<Conversation> => {
    const response: AxiosResponse<{ success: boolean; data: Conversation }> =
      await managementApi.patch(`/conversations/${id}/toggle-auto-reply`);
    return response.data.data;
  },
};

// Media API
export const mediaAPI = {
  upload: async (
    file: File,
    chatbotId: string,
    tags?: string[],
    description?: string,
    isPublic?: boolean
  ): Promise<Media> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('chatbotId', chatbotId);
    if (tags) formData.append('tags', JSON.stringify(tags));
    if (description) formData.append('description', description);
    if (isPublic !== undefined)
      formData.append('isPublic', isPublic.toString());

    const response: AxiosResponse<{ success: boolean; data: Media }> =
      await managementApi.post('/media/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
    return response.data.data;
  },

  list: async (params: {
    page?: number;
    limit?: number;
    chatbotId: string;
    tags?: string[];
    isPublic?: boolean;
    search?: string;
  }): Promise<{
    media: Media[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    const response: AxiosResponse<{
      success: boolean;
      data: {
        media: Media[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    }> = await managementApi.get('/media', { params });
    return response.data.data;
  },

  getById: async (id: string): Promise<Media> => {
    const response: AxiosResponse<{ success: boolean; data: Media }> =
      await managementApi.get(`/media/${id}`);
    return response.data.data;
  },

  update: async (id: string, data: Partial<Media>): Promise<Media> => {
    const response: AxiosResponse<{ success: boolean; data: Media }> =
      await managementApi.put(`/media/${id}`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await managementApi.delete(`/media/${id}`);
  },

  getChatbotMedia: async (chatbotId: string): Promise<Media[]> => {
    const response: AxiosResponse<{ success: boolean; data: Media[] }> =
      await managementApi.get(`/media/chatbot/${chatbotId}`);
    return response.data.data;
  },
};

// Domains API
export const domainsAPI = {
  create: async (data: {
    name: string;
    description?: string;
    chatbotId: string;
    isActive?: boolean;
    priority?: number;
  }): Promise<Domain> => {
    const response: AxiosResponse<{ success: boolean; data: Domain }> =
      await managementApi.post('/domains', data);
    return response.data.data;
  },

  list: async (params?: {
    chatbotId?: string;
    isActive?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    domains: Domain[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    // Clean up parameters to avoid type conversion issues
    const processedParams: any = {};
    if (params) {
      if (params.chatbotId) processedParams.chatbotId = params.chatbotId;
      if (params.search) processedParams.search = params.search;
      if (params.page !== undefined) processedParams.page = params.page;
      if (params.limit !== undefined) processedParams.limit = params.limit;
      // Skip isActive parameter for now due to backend validation issues
      // Client-side filtering will be used instead
    }

    const response: AxiosResponse<{
      success: boolean;
      data: {
        domains: Domain[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    }> = await managementApi.get('/domains', { params: processedParams });
    return response.data.data;
  },

  getById: async (id: string): Promise<Domain> => {
    const response: AxiosResponse<{ success: boolean; data: Domain }> =
      await managementApi.get(`/domains/${id}`);
    return response.data.data;
  },

  update: async (id: string, data: Partial<Domain>): Promise<Domain> => {
    const response: AxiosResponse<{ success: boolean; data: Domain }> =
      await managementApi.put(`/domains/${id}`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await managementApi.delete(`/domains/${id}`);
  },

  addKeywords: async (
    domainId: string,
    data: {
      keywords: string[];
      keywordType?: 'primary' | 'secondary' | 'synonym';
      weight?: number;
    }
  ): Promise<DomainKeyword[]> => {
    const response: AxiosResponse<{ success: boolean; data: DomainKeyword[] }> =
      await managementApi.post(`/domains/${domainId}/keywords`, data);
    return response.data.data;
  },

  removeKeyword: async (keywordId: string): Promise<void> => {
    await managementApi.delete(`/domains/keywords/${keywordId}`);
  },

  assignDocument: async (
    domainId: string,
    data: {
      documentId: string;
      priority?: number;
      isActive?: boolean;
    }
  ): Promise<DocumentDomain> => {
    const response: AxiosResponse<{ success: boolean; data: DocumentDomain }> =
      await managementApi.post(`/domains/${domainId}/documents`, data);
    return response.data.data;
  },

  bulkAssignDocuments: async (
    domainId: string,
    data: {
      documentIds: string[];
      priority?: number;
      isActive?: boolean;
    }
  ): Promise<{
    successful: DocumentDomain[];
    failed: any[];
    successCount: number;
    failedCount: number;
  }> => {
    const response: AxiosResponse<{
      success: boolean;
      data: {
        successful: DocumentDomain[];
        failed: any[];
        successCount: number;
        failedCount: number;
      };
    }> = await managementApi.post(`/domains/${domainId}/documents/bulk`, data);
    return response.data.data;
  },

  removeDocumentAssociation: async (associationId: string): Promise<void> => {
    await managementApi.delete(`/domains/associations/${associationId}`);
  },

  updateDocumentAssociation: async (
    associationId: string,
    data: {
      priority?: number;
      isActive?: boolean;
    }
  ): Promise<DocumentDomain> => {
    const response: AxiosResponse<{ success: boolean; data: DocumentDomain }> =
      await managementApi.put(`/domains/associations/${associationId}`, data);
    return response.data.data;
  },

  getStatistics: async (domainId: string): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.get(`/domains/${domainId}/statistics`);
    return response.data.data;
  },
};

// Bot Permissions API
export const botPermissionsAPI = {
  create: async (data: {
    userId: string;
    chatbotId: string;
    permission: 'read' | 'write' | 'admin';
    expiresAt?: string;
  }): Promise<BotPermission> => {
    const response: AxiosResponse<{ success: boolean; data: BotPermission }> =
      await managementApi.post('/bot-permissions', data);
    return response.data.data;
  },

  list: async (params?: {
    userId?: string;
    chatbotId?: string;
    permission?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{
    permissions: BotPermission[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    const response: AxiosResponse<{
      success: boolean;
      data: {
        permissions: BotPermission[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    }> = await managementApi.get('/bot-permissions', { params });
    return response.data.data;
  },

  getUserAccessibleChatbots: async (userId?: string): Promise<Chatbot[]> => {
    const url = userId
      ? `/bot-permissions/user/${userId}/chatbots`
      : '/bot-permissions/user/chatbots';
    const response: AxiosResponse<{ success: boolean; data: Chatbot[] }> =
      await managementApi.get(url);
    return response.data.data;
  },

  checkPermission: async (
    userId: string,
    chatbotId: string,
    permission: 'read' | 'write' | 'admin' = 'read'
  ): Promise<{
    hasPermission: boolean;
    userId: string;
    chatbotId: string;
    permission: string;
  }> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.get(`/bot-permissions/check/${userId}/${chatbotId}`, {
        params: { permission },
      });
    return response.data.data;
  },

  update: async (
    id: string,
    data: {
      permission?: 'read' | 'write' | 'admin';
      isActive?: boolean;
      expiresAt?: string;
    }
  ): Promise<BotPermission> => {
    const response: AxiosResponse<{ success: boolean; data: BotPermission }> =
      await managementApi.put(`/bot-permissions/${id}`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await managementApi.delete(`/bot-permissions/${id}`);
  },

  getChatbotUsers: async (chatbotId: string): Promise<BotPermission[]> => {
    const response: AxiosResponse<{ success: boolean; data: BotPermission[] }> =
      await managementApi.get(`/bot-permissions/chatbot/${chatbotId}/users`);
    return response.data.data;
  },

  getById: async (id: string): Promise<BotPermission> => {
    const response: AxiosResponse<{ success: boolean; data: BotPermission }> =
      await managementApi.get(`/bot-permissions/${id}`);
    return response.data.data;
  },

  createBulk: async (data: {
    userId: string;
    chatbotIds: string[];
    permission: 'read' | 'write' | 'admin';
    expiresAt?: string;
  }): Promise<{
    created: number;
    updated: number;
    failed: number;
    errors: string[];
    permissions: BotPermission[];
  }> => {
    const response: AxiosResponse<{
      success: boolean;
      data: {
        created: number;
        updated: number;
        failed: number;
        errors: string[];
        permissions: BotPermission[];
      };
      message: string;
    }> = await managementApi.post('/bot-permissions/bulk', data);
    return response.data.data;
  },
};
