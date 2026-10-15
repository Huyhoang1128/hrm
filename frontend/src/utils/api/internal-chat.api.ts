import { managementApi } from './client';

export interface InternalChatUser {
  id: number;
  username: string;
  display_name: string;
  email: string;
  avatar_url?: string | null;
  status: number;
  employee_code?: string | null;
  department_name?: string | null;
  position_title?: string | null;
}

export interface InternalReactionType {
  id: number;
  type: number;
  code: string;
  asset_url?: string;
  is_active: boolean;
  sort_order: number;
}

export interface InternalChatMessage {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_username: string;
  sender: InternalChatUser | null;
  content: { text?: string } | string;
  type: number;
  parent_message_id?: number | null;
  parent_message?: { id: number; sender_id: number; sender_name: string; text: string } | null;
  created_at: string;
  reactions: Array<{
    reaction_type_id: number;
    code: string;
    asset_url?: string;
    total: number;
    reacted_by_me: boolean;
    users: InternalChatUser[];
  }>;
  attachments: Array<{ id: number; file_url: string; file_type: string }>;
}

export interface InternalConversation {
  id: number;
  type: number;
  name: string;
  created_by_id: number;
  members: InternalChatUser[];
  is_member: boolean;
  last_message?: InternalChatMessage | null;
  unread: boolean;
  created_at: string;
  is_pinned: boolean;
  pinned_by_id?: number | null;
  pinned_at?: string | null;
  is_muted: boolean;
  muted_until?: string | null;
}

export interface ChatBootstrap {
  chat_user_id: number;
  org_id: number;
  username: string;
  display_name: string;
  can_delete_messages: boolean;
  can_manage_channels: boolean;
}

export const internalChatAPI = {
  bootstrap: async () => (await managementApi.post<ChatBootstrap>('/api/chat/bootstrap/')).data,
  unreadCount: async () => (await managementApi.get<{ unread_count: number }>('/api/chat/unread-count/')).data.unread_count,
  users: async (q = '') => (await managementApi.get<{ results: InternalChatUser[] }>('/api/chat/users/', { params: { q } })).data.results,
  conversations: async () => (await managementApi.get<{ results: InternalConversation[] }>('/api/chat/conversations/')).data.results,
  createConversation: async (memberIds: number[], name = '', type?: number) => (
    await managementApi.post<InternalConversation>('/api/chat/conversations/', {
      member_ids: memberIds,
      type: type || (memberIds.length === 1 && !name ? 3 : 4),
      name,
    })
  ).data,
  renameConversation: async (conversationId: number, name: string) => (
    await managementApi.patch<InternalConversation>(`/api/chat/conversations/${conversationId}/`, { name })
  ).data,
  addMembers: async (conversationId: number, memberIds: number[]) => (
    await managementApi.post<{ created_count: number; conversation: InternalConversation }>(
      `/api/chat/conversations/${conversationId}/members/`,
      { member_ids: memberIds },
    )
  ).data,
  removeMember: async (conversationId: number, userId: number) => managementApi.delete(
    `/api/chat/conversations/${conversationId}/members/${userId}/`,
  ),
  pinConversation: async (conversationId: number, isPinned: boolean) => (
    await managementApi.post<InternalConversation>(`/api/chat/conversations/${conversationId}/pin/`, { is_pinned: isPinned })
  ).data,
  muteConversation: async (conversationId: number, duration: '15m' | '1h' | '8h' | '24h' | 'forever' | null) => (
    await managementApi.post<InternalConversation>(`/api/chat/conversations/${conversationId}/mute/`, { duration })
  ).data,
  messages: async (conversationId: number, afterId?: number) => (
    await managementApi.get<{ results: InternalChatMessage[] }>(`/api/chat/conversations/${conversationId}/messages/`, {
      params: { limit: 100, ...(afterId ? { after_id: afterId } : {}) },
    })
  ).data.results,
  send: async (conversationId: number, text: string, parentMessageId?: number, attachments: Array<{ file_url: string; file_type: string }> = []) => (
    await managementApi.post<InternalChatMessage>(`/api/chat/conversations/${conversationId}/messages/`, {
      content: { text },
      type: attachments.length ? 2 : 1,
      parent_message_id: parentMessageId || null,
      attachments,
    })
  ).data,
  uploadImage: async (image: File) => {
    const data = new FormData();
    data.append('image', image);
    return (await managementApi.post<{ file_url: string; file_type: string }>('/api/chat/images/', data)).data;
  },
  deleteMessage: async (messageId: number) => managementApi.delete(`/api/chat/messages/${messageId}/`),
  addReaction: async (messageId: number, code: string, reactionTypeId?: number) => managementApi.post(
    `/api/chat/messages/${messageId}/reactions/`,
    reactionTypeId ? { reaction_type_id: reactionTypeId } : { code, type: 1 },
  ),
  removeReaction: async (messageId: number, reactionTypeId: number) => managementApi.delete(
    `/api/chat/messages/${messageId}/reactions/`,
    { data: { reaction_type_id: reactionTypeId } },
  ),
  markRead: async (conversationId: number, lastMessageId?: number) => managementApi.post(
    `/api/chat/conversations/${conversationId}/read/`,
    lastMessageId ? { last_read_message_id: lastMessageId } : {},
  ),
  reactionTypes: async (includeInactive = false) => (
    await managementApi.get<{ results: InternalReactionType[] }>('/api/chat/reaction-types/', {
      params: includeInactive ? { include_inactive: 1 } : {},
    })
  ).data.results,
  createReactionType: async (code: string, image: File, sortOrder: number) => {
    const data = new FormData();
    data.append('code', code);
    data.append('image', image);
    data.append('sort_order', String(sortOrder));
    return (await managementApi.post<InternalReactionType>('/api/chat/reaction-types/', data)).data;
  },
  updateReactionType: async (id: number, data: Partial<Pick<InternalReactionType, 'code' | 'is_active' | 'sort_order'>>) => (
    await managementApi.patch<InternalReactionType>(`/api/chat/reaction-types/${id}/`, data)
  ).data,
};
