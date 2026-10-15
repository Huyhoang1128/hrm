import { ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUturnLeftIcon,
  AdjustmentsHorizontalIcon,
  BellIcon,
  BellSlashIcon,
  BookmarkIcon,
  ChatBubbleLeftRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FaceSmileIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  PhotoIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  UserGroupIcon,
  UserPlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import {
  internalChatAPI,
  InternalChatMessage,
  InternalChatUser,
  InternalConversation,
  InternalReactionType,
} from '@/utils/api';

const textOf = (message?: InternalChatMessage | null) => {
  if (!message) return '';
  const text = typeof message.content === 'string' ? message.content : message.content?.text || '';
  return text || (message.attachments?.length ? 'Đã gửi một ảnh' : '');
};

function Avatar({ user, className = 'h-10 w-10' }: { user?: InternalChatUser | null; className?: string }) {
  const name = user?.display_name || user?.username || '?';
  return user?.avatar_url ? (
    <img src={user.avatar_url} alt={name} className={`${className} rounded-full object-cover bg-gray-100 flex-shrink-0`} />
  ) : (
    <div className={`${className} rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-white flex items-center justify-center font-semibold flex-shrink-0`}>
      {name.trim().charAt(0).toUpperCase()}
    </div>
  );
}

function ChannelAvatar({ conversation, user, className = 'h-10 w-10' }: { conversation: InternalConversation; user?: InternalChatUser | null; className?: string }) {
  if (conversation.type === 1) {
    return <div className={`${className} rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0`}><UserGroupIcon className="h-5 w-5" /></div>;
  }
  return <Avatar user={user} className={className} />;
}

function ReactionIcon({ code, assetUrl, className = 'h-5 w-5' }: { code: string; assetUrl?: string | null; className?: string }) {
  return assetUrl ? <img src={assetUrl} alt={code} className={`${className} object-contain`} /> : <span>{code}</span>;
}

export default function InternalChat() {
  const { user: authUser } = useAuth();
  const [meId, setMeId] = useState<number>();
  const [canDeleteMessages, setCanDeleteMessages] = useState(false);
  const [canManageChannels, setCanManageChannels] = useState(false);
  const [conversations, setConversations] = useState<InternalConversation[]>([]);
  const [activeId, setActiveId] = useState<number>();
  const [messages, setMessages] = useState<InternalChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [threadRootId, setThreadRootId] = useState<number>();
  const [threadInput, setThreadInput] = useState('');
  const [threadSending, setThreadSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [showPeople, setShowPeople] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [reactionPickerId, setReactionPickerId] = useState<number>();
  const [reactionDetails, setReactionDetails] = useState<InternalChatMessage | null>(null);
  const [profileUser, setProfileUser] = useState<InternalChatUser | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<{ id: number; file_url: string } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mutePickerOpen, setMutePickerOpen] = useState(false);
  const [reactionTypes, setReactionTypes] = useState<InternalReactionType[]>([]);
  const [showReactionManager, setShowReactionManager] = useState(false);
  const [reactionLabel, setReactionLabel] = useState('');
  const [reactionFile, setReactionFile] = useState<File | null>(null);
  const [savingReaction, setSavingReaction] = useState(false);
  const [people, setPeople] = useState<InternalChatUser[]>([]);
  const [search, setSearch] = useState('');
  const [modalMode, setModalMode] = useState<'dm' | 'channel' | 'add'>('dm');
  const [channelName, setChannelName] = useState('');
  const [publicChannel, setPublicChannel] = useState(false);
  const [selectedPeople, setSelectedPeople] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const mutePickerRef = useRef<HTMLDivElement>(null);

  const active = conversations.find((item) => item.id === activeId);
  const otherMembers = useMemo(() => active?.members?.filter((member) => member.id !== meId) || [], [active, meId]);
  const title = active?.name || otherMembers.map((member) => member.display_name || member.username).join(', ') || 'Cuộc trò chuyện';
  const isActiveMember = active ? (active.is_member ?? active.members?.some((member) => member.id === meId) ?? false) : false;
  const rootMessages = useMemo(() => messages.filter((message) => !message.parent_message_id), [messages]);
  const threadRoot = messages.find((message) => message.id === threadRootId);
  const threadReplies = useMemo(
    () => messages.filter((message) => message.parent_message_id === threadRootId),
    [messages, threadRootId],
  );

  const loadConversations = async (preferredId?: number) => {
    const data = await internalChatAPI.conversations();
    setConversations(data);
    setActiveId((current) => preferredId || current || data[0]?.id);
  };

  useEffect(() => {
    (async () => {
      try {
        const bootstrap = await internalChatAPI.bootstrap();
        setMeId(bootstrap.chat_user_id);
        setCanDeleteMessages(bootstrap.can_delete_messages);
        setCanManageChannels(bootstrap.can_manage_channels);
        await Promise.all([
          loadConversations(),
          internalChatAPI.reactionTypes().then(setReactionTypes),
        ]);
      } catch {
        setError('Không thể tải dữ liệu chat. Vui lòng thử lại.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const data = await internalChatAPI.messages(activeId);
        if (!cancelled) {
          setMessages(data);
          const conversation = conversations.find((item) => item.id === activeId);
          const isMember = conversation?.is_member ?? conversation?.members?.some((member) => member.id === meId);
          if (data.length && isMember) await internalChatAPI.markRead(activeId, data[data.length - 1].id);
        }
      } catch {
        if (!cancelled) setError('Không thể tải tin nhắn.');
      }
    };
    load();
    const timer = window.setInterval(load, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeId, meId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => { setMutePickerOpen(false); }, [activeId]);

  useEffect(() => {
    if (!mutePickerOpen) return;
    const handler = (event: MouseEvent) => {
      if (mutePickerRef.current && !mutePickerRef.current.contains(event.target as Node)) setMutePickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mutePickerOpen]);

  const openPeople = async (mode: 'dm' | 'channel' | 'add' = 'dm') => {
    setModalMode(mode);
    setSelectedPeople(new Set());
    setChannelName('');
    setPublicChannel(false);
    setShowPeople(true);
    try { setPeople(await internalChatAPI.users()); } catch { setError('Không thể tải danh sách nhân viên.'); }
  };

  useEffect(() => {
    if (!showPeople) return;
    const timer = window.setTimeout(async () => {
      try { setPeople(await internalChatAPI.users(search)); } catch { /* keep previous results */ }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, showPeople]);

  const startChat = async (person: InternalChatUser) => {
    const existing = conversations.find((conversation) =>
      conversation.type === 3 && conversation.is_member && conversation.members?.some((member) => member.id === person.id),
    );
    if (existing) {
      setActiveId(existing.id);
    } else {
      const created = await internalChatAPI.createConversation([person.id]);
      await loadConversations(created.id);
    }
    setShowPeople(false);
    setSearch('');
  };

  const togglePerson = (personId: number) => {
    setSelectedPeople((current) => {
      const next = new Set(current);
      if (next.has(personId)) next.delete(personId); else next.add(personId);
      return next;
    });
  };

  const createChannel = async () => {
    if (!channelName.trim()) { setError('Vui lòng nhập tên kênh.'); return; }
    try {
      const created = await internalChatAPI.createConversation(
        Array.from(selectedPeople),
        channelName.trim(),
        publicChannel ? 1 : 4,
      );
      await loadConversations(created.id);
      setShowPeople(false);
    } catch {
      setError('Không thể tạo kênh.');
    }
  };

  const addMembers = async () => {
    if (!activeId || selectedPeople.size === 0) return;
    try {
      await internalChatAPI.addMembers(activeId, Array.from(selectedPeople));
      await loadConversations(activeId);
      setShowPeople(false);
    } catch {
      setError('Bạn không có quyền thêm thành viên vào kênh này.');
    }
  };

  const removeMember = async (member: InternalChatUser) => {
    if (!active || active.created_by_id !== meId) return;
    if (!window.confirm(`Xoá ${member.display_name || member.username} khỏi kênh này?`)) return;
    try {
      await internalChatAPI.removeMember(active.id, member.id);
      await loadConversations(active.id);
    } catch {
      setError('Không thể xoá thành viên khỏi kênh.');
    }
  };

  const renameChannel = async () => {
    if (!active || !canManageChannels) return;
    const name = window.prompt('Tên mới của kênh', active.name || title)?.trim();
    if (!name) return;
    try {
      await internalChatAPI.renameConversation(active.id, name);
      await loadConversations(active.id);
    } catch {
      setError('Không thể đổi tên kênh.');
    }
  };

  const togglePin = async () => {
    if (!active || !canDeleteMessages) return;
    try {
      await internalChatAPI.pinConversation(active.id, !active.is_pinned);
      await loadConversations(active.id);
    } catch {
      setError('Không thể thay đổi trạng thái ghim. Chỉ Admin hoặc HR có quyền thực hiện.');
    }
  };

  const muteConversation = async (duration: '15m' | '1h' | '8h' | '24h' | 'forever' | null) => {
    if (!active) return;
    try {
      await internalChatAPI.muteConversation(active.id, duration);
      setMutePickerOpen(false);
      await loadConversations(active.id);
    } catch {
      setError('Không thể thay đổi trạng thái tắt thông báo.');
    }
  };

  const toggleReaction = async (message: InternalChatMessage, option: InternalReactionType) => {
    const current = (message.reactions || []).find((reaction) => reaction.reaction_type_id === option.id);
    try {
      if (current?.reacted_by_me) {
        await internalChatAPI.removeReaction(message.id, current.reaction_type_id);
      } else {
        await internalChatAPI.addReaction(message.id, option.code, option.id);
      }
      if (activeId) setMessages(await internalChatAPI.messages(activeId));
      setReactionPickerId(undefined);
    } catch {
      setError('Không thể cập nhật reaction.');
    }
  };

  const openReactionManager = async () => {
    setShowReactionManager(true);
    try { setReactionTypes(await internalChatAPI.reactionTypes(true)); } catch { setError('Không thể tải danh sách reaction.'); }
  };

  const uploadReaction = async () => {
    if (!reactionFile || !reactionLabel.trim()) return;
    setSavingReaction(true);
    try {
      await internalChatAPI.createReactionType(reactionLabel.trim(), reactionFile, reactionTypes.length + 10);
      setReactionTypes(await internalChatAPI.reactionTypes(true));
      setReactionLabel('');
      setReactionFile(null);
    } catch {
      setError('Không thể xử lý icon reaction. Ảnh gốc cần nhỏ hơn 15MB.');
    } finally {
      setSavingReaction(false);
    }
  };

  const toggleReactionTypeActive = async (option: InternalReactionType) => {
    await internalChatAPI.updateReactionType(option.id, { is_active: !option.is_active });
    const all = await internalChatAPI.reactionTypes(true);
    setReactionTypes(all);
  };

  const updateReactionOrder = async (option: InternalReactionType, sortOrder: number) => {
    await internalChatAPI.updateReactionType(option.id, { sort_order: Math.max(0, sortOrder) });
    setReactionTypes(await internalChatAPI.reactionTypes(true));
  };

  const closeReactionManager = async () => {
    setShowReactionManager(false);
    try { setReactionTypes(await internalChatAPI.reactionTypes()); } catch { /* keep current list */ }
  };

  const send = async () => {
    const content = input.trim();
    if ((!content && !imageFile) || !activeId || sending) return;
    setSending(true);
    setInput('');
    try {
      const attachments = imageFile ? [await internalChatAPI.uploadImage(imageFile)] : [];
      const message = await internalChatAPI.send(activeId, content, undefined, attachments);
      setMessages((current) => [...current, message]);
      setImageFile(null);
      await loadConversations(activeId);
    } catch {
      setInput(content);
      setError('Gửi tin nhắn hoặc tải ảnh thất bại.');
    } finally {
      setSending(false);
    }
  };

  const sendThreadReply = async () => {
    const content = threadInput.trim();
    if (!content || !activeId || !threadRoot || threadSending || !isActiveMember) return;
    setThreadSending(true);
    setThreadInput('');
    try {
      const message = await internalChatAPI.send(activeId, content, threadRoot.id);
      setMessages((current) => [...current, message]);
      await loadConversations(activeId);
    } catch {
      setThreadInput(content);
      setError('Gửi trả lời thất bại.');
    } finally {
      setThreadSending(false);
    }
  };

  const deleteMessage = async (message: InternalChatMessage) => {
    if (!canDeleteMessages || !window.confirm('Bạn có chắc muốn xoá tin nhắn này?')) return;
    try {
      await internalChatAPI.deleteMessage(message.id);
      setMessages((current) => current.filter((item) => item.id !== message.id));
      if (activeId) await loadConversations(activeId);
    } catch {
      setError('Không thể xoá tin nhắn. Chỉ Admin hoặc HR có quyền thực hiện.');
    }
  };

  const onSubmit = (event: FormEvent) => { event.preventDefault(); send(); };

  const selectImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Vui lòng chọn một file ảnh.'); return; }
    if (file.size > 500 * 1024) { setError('Kích thước ảnh tối đa là 500 KB.'); return; }
    setImageFile(file);
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'));
    const image = imageItem?.getAsFile()
      || Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'));
    if (!image) return;
    event.preventDefault();
    selectImage(image);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
  };

  if (loading) return <div className="mx-auto h-[calc(100vh-8rem)] w-full max-w-[1800px] rounded-2xl bg-white animate-pulse" />;

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] min-h-[520px] w-full max-w-[1800px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <aside className={`relative ${activeId ? 'hidden md:flex' : 'flex'} w-full ${sidebarCollapsed ? 'md:w-[76px]' : 'md:w-80 xl:w-96'} flex-shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] duration-200`}>
        <button
          onClick={() => setSidebarCollapsed((current) => !current)}
          className="absolute -right-3.5 top-5 z-10 hidden h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-50 hover:text-primary-600 md:flex"
          title={sidebarCollapsed ? 'Mở rộng danh sách' : 'Thu gọn danh sách'}
        >
          {sidebarCollapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronLeftIcon className="h-4 w-4" />}
        </button>
        <div className="border-b border-gray-100 p-4">
          <div className={`flex items-center ${sidebarCollapsed ? 'md:flex-col md:gap-2' : 'justify-between'}`}>
            <div className={sidebarCollapsed ? 'md:hidden' : ''}><h1 className="text-xl font-bold text-gray-900">Chat</h1><p className="text-xs text-gray-500">Trao đổi nội bộ</p></div>
            <button onClick={() => openPeople('dm')} className="rounded-xl bg-primary-600 p-2.5 text-white hover:bg-primary-700" title="Cuộc trò chuyện mới"><PlusIcon className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <button onClick={() => openPeople('dm')} className={`m-4 rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 ${sidebarCollapsed ? 'md:hidden' : ''}`}>Chưa có cuộc trò chuyện.<br />Bắt đầu chat với đồng nghiệp.</button>
          ) : conversations.map((conversation) => {
            const others = conversation.members?.filter((member) => member.id !== meId) || [];
            const label = conversation.name || others.map((member) => member.display_name || member.username).join(', ');
            return (
              <button key={conversation.id} onClick={() => setActiveId(conversation.id)} title={sidebarCollapsed ? label || 'Cuộc trò chuyện' : undefined} className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left ${sidebarCollapsed ? 'md:justify-center' : ''} ${activeId === conversation.id ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                <div className="relative flex-shrink-0">
                  <ChannelAvatar conversation={conversation} user={others[0]} />
                  {sidebarCollapsed && conversation.unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-primary-600 md:block hidden" />}
                </div>
                <div className={`min-w-0 flex-1 ${sidebarCollapsed ? 'md:hidden' : ''}`}><div className="flex items-center gap-2">{conversation.is_pinned && <BookmarkIcon className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />}{conversation.is_muted && <BellSlashIcon className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" title="Đã tắt thông báo" />}<p className="truncate text-sm font-semibold text-gray-900">{label || 'Cuộc trò chuyện'}</p>{!conversation.is_member && <EyeIcon className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" title="Chỉ xem" />}{conversation.unread && <span className="h-2 w-2 rounded-full bg-primary-600" />}</div><p className="truncate text-xs text-gray-500">{textOf(conversation.last_message) || 'Bắt đầu cuộc trò chuyện'}</p></div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className={`${activeId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col bg-gray-50`}>
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center text-gray-500"><ChatBubbleLeftRightIcon className="mb-3 h-14 w-14 text-gray-300" /><p className="font-medium">Chọn một cuộc trò chuyện</p></div>
        ) : <>
          <header className="flex h-16 items-center gap-3 border-b border-gray-200 bg-white px-4">
            <button onClick={() => setActiveId(undefined)} className="md:hidden text-gray-500"><ArrowUturnLeftIcon className="h-5 w-5" /></button>
            <ChannelAvatar conversation={active} user={otherMembers[0]} className="h-9 w-9" />
            <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-gray-900">{title}</h2><p className={`text-xs ${isActiveMember ? 'text-emerald-600' : 'text-amber-600'}`}>{isActiveMember ? (active.type === 1 ? 'Kênh công khai · Toàn công ty' : 'Nội bộ công ty') : 'Chế độ chỉ xem · Bạn không phải thành viên'}</p></div>
            {canDeleteMessages && <button onClick={togglePin} className={`rounded-lg p-2 hover:bg-amber-50 ${active.is_pinned ? 'text-amber-500' : 'text-gray-500 hover:text-amber-600'}`} title={active.is_pinned ? 'Bỏ ghim kênh' : 'Ghim kênh cho mọi người'}><BookmarkIcon className="h-5 w-5" /></button>}
            <div className="relative" ref={mutePickerRef}>
              <button
                onClick={() => setMutePickerOpen((open) => !open)}
                className={`rounded-lg p-2 hover:bg-gray-100 ${active.is_muted ? 'text-gray-400' : 'text-gray-500 hover:text-primary-600'}`}
                title={active.is_muted ? 'Đã tắt thông báo' : 'Tắt thông báo'}
              >
                {active.is_muted ? <BellSlashIcon className="h-5 w-5" /> : <BellIcon className="h-5 w-5" />}
              </button>
              {mutePickerOpen && (
                <div className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
                  {active.is_muted ? (
                    <button onClick={() => muteConversation(null)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-primary-600 hover:bg-gray-50"><BellIcon className="h-4 w-4" /> Bật lại thông báo</button>
                  ) : (
                    <>
                      <p className="px-4 pb-1 pt-2 text-xs font-medium text-gray-400">Tắt thông báo trong</p>
                      <button onClick={() => muteConversation('15m')} className="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">15 phút</button>
                      <button onClick={() => muteConversation('1h')} className="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">1 giờ</button>
                      <button onClick={() => muteConversation('8h')} className="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">8 giờ</button>
                      <button onClick={() => muteConversation('24h')} className="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">24 giờ</button>
                      <button onClick={() => muteConversation('forever')} className="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">Đến khi tôi bật lại</button>
                    </>
                  )}
                </div>
              )}
            </div>
            {canDeleteMessages && <button onClick={openReactionManager} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-primary-600" title="Quản lý reaction"><AdjustmentsHorizontalIcon className="h-5 w-5" /></button>}
            <button onClick={() => setShowMembers(true)} className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-primary-600" title="Xem thành viên"><UserGroupIcon className="h-5 w-5" /><span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-gray-200 px-1 text-center text-[10px] font-semibold text-gray-600">{active.members?.length || 0}</span></button>
            {active.type !== 3 && (active.created_by_id === meId || canManageChannels) && <button onClick={() => openPeople('add')} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-primary-600" title="Thêm thành viên"><UserPlusIcon className="h-5 w-5" /></button>}
            {active.type !== 3 && canManageChannels && <button onClick={renameChannel} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-primary-600" title="Đổi tên kênh"><PencilSquareIcon className="h-5 w-5" /></button>}
          </header>
          {error && <div className="bg-red-50 px-4 py-2 text-center text-xs text-red-600">{error}<button onClick={() => setError('')} className="ml-2 underline">Đóng</button></div>}
          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <div className={`mx-auto space-y-4 transition-[max-width] duration-200 ${sidebarCollapsed ? 'max-w-none' : 'max-w-4xl 2xl:max-w-5xl'}`}>
              {rootMessages.map((message) => {
                const mine = message.sender_id === meId;
                const senderProfile = message.sender || (mine ? {
                  id: meId!,
                  username: authUser?.username || '',
                  display_name: authUser?.hrm_user?.full_name || authUser?.username || '',
                  email: authUser?.email || '',
                  avatar_url: authUser?.hrm_user?.avatar_url,
                  status: 1,
                  employee_code: authUser?.hrm_user?.employee_id || authUser?.employee_profile?.employee_id,
                  department_name: authUser?.hrm_user?.department || authUser?.employee_profile?.department,
                  position_title: authUser?.hrm_user?.position || authUser?.employee_profile?.position,
                } : null);
                return (
                  <div key={message.id} className={`group flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                    <button onClick={() => senderProfile && setProfileUser(senderProfile)} className="flex-shrink-0 rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2" title="Xem thông tin nhân viên"><Avatar user={senderProfile} className="h-8 w-8" /></button>
                    <div className={`max-w-[75%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                      {!mine && <span className="mb-1 px-1 text-xs text-gray-500">{message.sender?.display_name || message.sender_username}</span>}
                      <div className={`rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${mine ? 'rounded-br-sm bg-primary-600 text-white' : 'rounded-bl-sm border border-gray-100 bg-white text-gray-800'}`}>
                        {message.parent_message && <div className={`mb-2 border-l-2 pl-2 text-xs ${mine ? 'border-white/50 text-white/75' : 'border-primary-400 text-gray-500'}`}><p className="font-medium">{message.parent_message.sender_name}</p><p className="line-clamp-1">{message.parent_message.text}</p></div>}
                        {(message.attachments || []).map((attachment) => <button key={attachment.id} type="button" onClick={() => setPreviewAttachment(attachment)} className="block"><img src={attachment.file_url} alt="Ảnh trong tin nhắn" className="mb-1 max-h-80 max-w-full rounded-lg object-contain" /></button>)}
                        {textOf(message) && <p className="whitespace-pre-wrap break-words">{textOf(message)}</p>}
                      </div>
                      <span className="mt-1 px-1 text-[10px] text-gray-400">{new Date(message.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                      {(message.reactions || []).length > 0 && <div className={`mt-1.5 flex max-w-full flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>{message.reactions.map((reaction) => <button key={reaction.reaction_type_id} onClick={() => setReactionDetails(message)} className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-sm transition-colors ${reaction.reacted_by_me ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}><ReactionIcon code={reaction.code} assetUrl={reaction.asset_url} className="h-4 w-4" /><span className="text-xs font-medium">{reaction.total}</span></button>)}</div>}
                      {messages.filter((reply) => reply.parent_message_id === message.id).length > 0 && <button onClick={() => setThreadRootId(message.id)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"><ChatBubbleLeftRightIcon className="h-4 w-4" />{messages.filter((reply) => reply.parent_message_id === message.id).length} phản hồi</button>}
                    </div>
                    {isActiveMember && <div className="relative mb-5 flex opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                      <button onClick={() => setThreadRootId(message.id)} className="rounded-full p-1.5 text-gray-400 hover:bg-white hover:text-primary-600" title="Mở thread"><ArrowUturnLeftIcon className="h-4 w-4" /></button>
                      <button onClick={() => setReactionPickerId((current) => current === message.id ? undefined : message.id)} className="rounded-full p-1.5 text-gray-400 hover:bg-white hover:text-primary-600" title="Thả reaction"><FaceSmileIcon className="h-4 w-4" /></button>
                      {canDeleteMessages && <button onClick={() => deleteMessage(message)} className="rounded-full p-1.5 text-gray-400 hover:bg-white hover:text-red-600" title="Xoá tin nhắn"><TrashIcon className="h-4 w-4" /></button>}
                      {reactionPickerId === message.id && <div className={`absolute bottom-9 z-20 flex max-w-[min(90vw,520px)] overflow-x-auto whitespace-nowrap rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${mine ? 'right-0' : 'left-0'}`}>{reactionTypes.filter((option) => option.is_active).map((option) => <button key={option.id} onClick={() => toggleReaction(message, option)} className={`flex h-10 w-11 flex-shrink-0 items-center justify-center rounded-lg text-xl hover:bg-gray-100 ${(message.reactions || []).some((reaction) => reaction.reaction_type_id === option.id && reaction.reacted_by_me) ? 'bg-primary-50' : ''}`} title={option.code}><ReactionIcon code={option.code} assetUrl={option.asset_url} className="h-7 w-7" /></button>)}</div>}
                    </div>}
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          </div>
          {isActiveMember ? <form onSubmit={onSubmit} className="border-t border-gray-200 bg-white p-3 sm:px-5">
            {imageFile && <div className={`mx-auto mb-2 flex items-center justify-between rounded-lg bg-primary-50 px-3 py-2 text-xs text-primary-700 transition-[max-width] duration-200 ${sidebarCollapsed ? 'max-w-none' : 'max-w-4xl 2xl:max-w-5xl'}`}><span className="truncate">{imageFile.name} ({Math.ceil(imageFile.size / 1024)} KB)</span><button type="button" onClick={() => setImageFile(null)} className="ml-2 font-semibold">Bỏ ảnh</button></div>}
            <div className={`mx-auto flex items-end gap-2 transition-[max-width] duration-200 ${sidebarCollapsed ? 'max-w-none' : 'max-w-4xl 2xl:max-w-5xl'}`}><input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(event) => { selectImage(event.target.files?.[0]); event.target.value = ''; }} /><button type="button" onClick={() => imageInputRef.current?.click()} disabled={sending} title="Gửi ảnh (tối đa 500 KB)" className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-40"><PhotoIcon className="h-5 w-5" /></button><textarea value={input} onChange={(event) => setInput(event.target.value)} onPaste={onPaste} onKeyDown={onKeyDown} rows={1} placeholder="Nhập tin nhắn hoặc dán ảnh..." className="max-h-28 min-h-[44px] flex-1 resize-none rounded-xl border-gray-300 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary-500 focus:ring-primary-500" /><button type="submit" disabled={(!input.trim() && !imageFile) || sending} className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40"><PaperAirplaneIcon className="h-5 w-5" /></button></div>
          </form> : <div className="flex items-center justify-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-4 text-sm font-medium text-amber-700"><EyeIcon className="h-5 w-5" />Bạn chỉ có thể xem nội dung vì không phải thành viên của conversation này.</div>}
        </>}
      </section>

      {threadRoot && (
        <aside className="fixed inset-0 z-40 flex w-full flex-col border-l border-gray-200 bg-white lg:static lg:z-auto lg:w-[380px] xl:w-[420px] lg:flex-shrink-0">
          <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4">
            <div><h2 className="font-semibold text-gray-900">Thread</h2><p className="text-xs text-gray-500">{threadReplies.length} phản hồi</p></div>
            <button onClick={() => setThreadRootId(undefined)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><XMarkIcon className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="border-b border-gray-200 pb-4">
              <div className="flex gap-2.5"><button onClick={() => threadRoot.sender && setProfileUser(threadRoot.sender)} className="self-start rounded-full"><Avatar user={threadRoot.sender} className="h-9 w-9" /></button><div className="min-w-0 flex-1"><div className="flex items-baseline gap-2"><span className="truncate text-sm font-semibold text-gray-900">{threadRoot.sender?.display_name || threadRoot.sender_username}</span><span className="text-[10px] text-gray-400">{new Date(threadRoot.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span></div><p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">{textOf(threadRoot)}</p></div></div>
            </div>
            <div className="mt-4 space-y-5">
              {threadReplies.map((reply) => <div key={reply.id} className="flex gap-2.5"><button onClick={() => reply.sender && setProfileUser(reply.sender)} className="self-start rounded-full"><Avatar user={reply.sender} className="h-8 w-8" /></button><div className="min-w-0 flex-1"><div className="flex items-baseline gap-2"><span className="truncate text-sm font-semibold text-gray-900">{reply.sender?.display_name || reply.sender_username}</span><span className="text-[10px] text-gray-400">{new Date(reply.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span></div><p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">{textOf(reply)}</p>{(reply.reactions || []).length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{reply.reactions.map((reaction) => <button key={reaction.reaction_type_id} onClick={() => setReactionDetails(reply)} className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-sm ${reaction.reacted_by_me ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'}`}><ReactionIcon code={reaction.code} assetUrl={reaction.asset_url} className="h-4 w-4" /><span className="text-xs">{reaction.total}</span></button>)}</div>}</div></div>)}
              {threadReplies.length === 0 && <p className="py-8 text-center text-sm text-gray-400">Chưa có phản hồi nào.</p>}
            </div>
          </div>
          {isActiveMember ? <div className="border-t border-gray-200 p-3"><div className="flex items-end gap-2"><textarea value={threadInput} onChange={(event) => setThreadInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendThreadReply(); } }} rows={2} placeholder="Trả lời trong thread..." className="max-h-28 flex-1 resize-none rounded-xl border-gray-300 bg-gray-50 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500" /><button onClick={sendThreadReply} disabled={!threadInput.trim() || threadSending} className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white disabled:opacity-40"><PaperAirplaneIcon className="h-5 w-5" /></button></div></div> : <div className="border-t border-amber-200 bg-amber-50 p-3 text-center text-xs font-medium text-amber-700">Chỉ thành viên mới có thể trả lời thread.</div>}
        </aside>
      )}

      {showPeople && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4" onMouseDown={() => setShowPeople(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="font-semibold text-gray-900">{modalMode === 'add' ? 'Thêm thành viên' : modalMode === 'channel' ? 'Tạo kênh mới' : 'Cuộc trò chuyện mới'}</h2>
              <button onClick={() => setShowPeople(false)}><XMarkIcon className="h-5 w-5 text-gray-500" /></button>
            </div>
            {modalMode !== 'add' && <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1.5"><button onClick={() => { setModalMode('dm'); setSelectedPeople(new Set()); }} className={`rounded-lg py-2 text-sm font-medium ${modalMode === 'dm' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500'}`}>Nhắn riêng</button><button onClick={() => { setModalMode('channel'); setSelectedPeople(new Set()); }} className={`rounded-lg py-2 text-sm font-medium ${modalMode === 'channel' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500'}`}>Tạo kênh</button></div>}
            {modalMode === 'channel' && <div className="space-y-3 border-b p-4"><input value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="Tên kênh" className="w-full rounded-xl border-gray-300 text-sm focus:border-primary-500 focus:ring-primary-500" />{canManageChannels && <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={publicChannel} onChange={(event) => setPublicChannel(event.target.checked)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />Kênh công khai</label>}</div>}
            <div className="p-3"><div className="relative"><MagnifyingGlassIcon className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} autoFocus placeholder="Tìm tên, mã NV, phòng ban, vị trí..." className="w-full rounded-xl border-gray-300 py-2.5 pl-9 text-sm focus:border-primary-500 focus:ring-primary-500" /></div></div>
            <div className="max-h-72 overflow-y-auto px-2 pb-3">{people.filter((person) => !active?.members?.some((member) => modalMode === 'add' && member.id === person.id)).map((person) => <button key={person.id} onClick={() => modalMode === 'dm' ? startChat(person) : togglePerson(person.id)} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-gray-50"><Avatar user={person} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-gray-900">{person.display_name || person.username}</p>{person.employee_code && <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">{person.employee_code}</span>}</div><p className="truncate text-xs text-gray-500">{[person.position_title, person.department_name].filter(Boolean).join(' · ') || `@${person.username}`}</p></div>{modalMode !== 'dm' && <input type="checkbox" readOnly checked={selectedPeople.has(person.id)} className="rounded border-gray-300 text-primary-600" />}</button>)}{people.length === 0 && <p className="p-6 text-center text-sm text-gray-500">Không tìm thấy nhân viên.</p>}</div>
            {modalMode !== 'dm' && <div className="border-t p-4"><button onClick={modalMode === 'channel' ? createChannel : addMembers} disabled={(modalMode === 'channel' && !channelName.trim()) || (modalMode === 'add' && selectedPeople.size === 0)} className="w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-40">{modalMode === 'channel' ? 'Tạo kênh' : `Thêm ${selectedPeople.size} thành viên`}</button></div>}
          </div>
        </div>
      )}
      {showMembers && active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4" onMouseDown={() => setShowMembers(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4">
              <div><h2 className="font-semibold text-gray-900">Thành viên</h2><p className="text-xs text-gray-500">{active.members?.length || 0} người trong {title}</p></div>
              <button onClick={() => setShowMembers(false)} className="rounded-lg p-1 hover:bg-gray-100"><XMarkIcon className="h-5 w-5 text-gray-500" /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {(active.members || []).map((member) => (
                <div key={member.id} className="flex items-center gap-3 rounded-xl p-3 hover:bg-gray-50">
                  <Avatar user={member} />
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-gray-900">{member.display_name || member.username}</p>{member.id === meId && <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-medium text-primary-700">Bạn</span>}{member.id === active.created_by_id && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Chủ kênh</span>}</div><p className="truncate text-xs text-gray-500">@{member.username}{member.email ? ` · ${member.email}` : ''}</p></div>
                  {active.created_by_id === meId && member.id !== meId && active.type !== 1 && active.type !== 3 && <button onClick={() => removeMember(member)} className="flex-shrink-0 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100">Xoá</button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {reactionDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4" onMouseDown={() => setReactionDetails(null)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold text-gray-900">Reaction</h2><p className="max-w-xs truncate text-xs text-gray-500">{textOf(reactionDetails)}</p></div><button onClick={() => setReactionDetails(null)} className="rounded-lg p-1 hover:bg-gray-100"><XMarkIcon className="h-5 w-5 text-gray-500" /></button></div>
            <div className="max-h-[60vh] overflow-y-auto p-3">{(reactionDetails.reactions || []).map((reaction) => <div key={reaction.reaction_type_id} className="mb-3"><div className="mb-1.5 flex items-center gap-2 px-1"><ReactionIcon code={reaction.code} assetUrl={reaction.asset_url} className="h-7 w-7" /><span className="text-sm font-semibold text-gray-700">{reaction.total} người</span></div>{reaction.users.map((person) => <div key={`${reaction.reaction_type_id}-${person.id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-gray-50"><Avatar user={person} className="h-9 w-9" /><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-900">{person.display_name || person.username}</p><p className="text-xs text-gray-500">@{person.username}</p></div></div>)}</div>)}</div>
          </div>
        </div>
      )}
      {showReactionManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4" onMouseDown={closeReactionManager}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold text-gray-900">Quản lý reaction</h2><p className="text-xs text-gray-500">Dành cho HR và Admin</p></div><button onClick={closeReactionManager} className="rounded-lg p-1 hover:bg-gray-100"><XMarkIcon className="h-5 w-5 text-gray-500" /></button></div>
            <div className="space-y-3 border-b bg-gray-50 p-4"><p className="text-sm font-medium text-gray-700">Thêm icon bằng ảnh</p><div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input value={reactionLabel} onChange={(event) => setReactionLabel(event.target.value)} placeholder="Tên reaction" className="rounded-xl border-gray-300 text-sm focus:border-primary-500 focus:ring-primary-500" /><input type="file" accept="image/*" onChange={(event) => setReactionFile(event.target.files?.[0] || null)} className="min-w-0 rounded-xl border border-gray-300 bg-white p-2 text-xs" /><button onClick={uploadReaction} disabled={!reactionLabel.trim() || !reactionFile || savingReaction} className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{savingReaction ? 'Đang xử lý' : 'Thêm'}</button></div><p className="text-xs text-gray-400">Ảnh tối đa 15MB; hệ thống tự resize, căn giữa và nén thành WebP 96×96.</p></div>
            <div className="max-h-[55vh] overflow-y-auto p-3">{reactionTypes.map((option) => <div key={option.id} className={`flex items-center gap-3 rounded-xl p-3 ${option.is_active ? 'hover:bg-gray-50' : 'bg-gray-50 opacity-60'}`}><div className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-xl"><ReactionIcon code={option.code} assetUrl={option.asset_url} className="h-8 w-8" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-gray-900">{option.code}</p><p className="text-xs text-gray-500">{option.asset_url ? 'Icon ảnh' : 'Emoji'}</p></div><label className="flex items-center gap-1 text-xs text-gray-500">Thứ tự<input type="number" min="0" defaultValue={option.sort_order} onBlur={(event) => updateReactionOrder(option, Number(event.target.value) || 0)} className="w-16 rounded-lg border-gray-300 px-2 py-1 text-xs" /></label><button onClick={() => toggleReactionTypeActive(option)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${option.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>{option.is_active ? 'Ẩn' : 'Hiện'}</button></div>)}</div>
          </div>
        </div>
      )}
      {profileUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/30 p-4" onMouseDown={() => setProfileUser(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between"><div className="flex min-w-0 items-center gap-3"><Avatar user={profileUser} className="h-14 w-14" /><div className="min-w-0"><h3 className="truncate font-semibold text-gray-900">{profileUser.display_name || profileUser.username}</h3><p className="truncate text-sm text-gray-500">@{profileUser.username}</p></div></div><button onClick={() => setProfileUser(null)} className="rounded-lg p-1 hover:bg-gray-100"><XMarkIcon className="h-5 w-5 text-gray-400" /></button></div>
            <div className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-100 bg-gray-50 px-4"><div className="flex justify-between gap-4 py-3 text-sm"><span className="text-gray-500">Mã nhân viên</span><span className="text-right font-medium text-gray-900">{profileUser.employee_code || 'Chưa cập nhật'}</span></div><div className="flex justify-between gap-4 py-3 text-sm"><span className="text-gray-500">Phòng ban</span><span className="text-right font-medium text-gray-900">{profileUser.department_name || 'Chưa cập nhật'}</span></div><div className="flex justify-between gap-4 py-3 text-sm"><span className="text-gray-500">Vị trí</span><span className="text-right font-medium text-gray-900">{profileUser.position_title || 'Chưa cập nhật'}</span></div></div>
          </div>
        </div>
      )}
      {previewAttachment && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onMouseDown={() => setPreviewAttachment(null)}>
          <button onClick={() => setPreviewAttachment(null)} className="absolute right-4 top-4 rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"><XMarkIcon className="h-6 w-6" /></button>
          <img src={previewAttachment.file_url} alt="Ảnh trong tin nhắn" className="max-h-full max-w-full rounded-lg object-contain" onMouseDown={(event) => event.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
