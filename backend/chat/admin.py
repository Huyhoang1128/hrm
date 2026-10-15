from django.contrib import admin

from .models import (
    ChatNotification,
    ChatUser,
    Conversation,
    ConversationMember,
    Message,
    MessageAttachment,
    MessageMention,
    MessageReaction,
    Organization,
    ReactionSummaryCache,
    ReactionType,
    UserReactionUsage,
    UsernameHistory,
)


class ConversationMemberInline(admin.TabularInline):
    model = ConversationMember
    extra = 0
    raw_id_fields = ('user', 'last_read_message')
    fields = ('user', 'role', 'notification_level', 'last_read_message', 'joined_at', 'left_at')
    readonly_fields = ('joined_at',)
    show_change_link = True


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'created_at')
    search_fields = ('name',)
    readonly_fields = ('created_at',)


@admin.register(ChatUser)
class ChatUserAdmin(admin.ModelAdmin):
    list_display = ('id', 'display_name', 'username', 'email', 'org', 'status', 'created_at')
    list_filter = ('status', 'org')
    search_fields = ('display_name', 'username', 'email', 'auth_user__username')
    raw_id_fields = ('auth_user',)
    readonly_fields = ('created_at',)


@admin.register(UsernameHistory)
class UsernameHistoryAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'username', 'created_at')
    search_fields = ('username', 'user__username', 'user__display_name')
    raw_id_fields = ('user',)
    readonly_fields = ('created_at',)


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    """Quản lý kênh chat và thành viên trực tiếp trong Django Admin."""

    list_display = (
        'id',
        'name',
        'type_label',
        'org',
        'created_by',
        'member_count',
        'is_pinned',
        'pinned_by',
        'last_message',
        'created_at',
        'archived_at',
    )
    list_filter = ('type', 'is_pinned', 'org', 'created_at', 'archived_at')
    search_fields = ('name', 'created_by__username', 'created_by__display_name')
    raw_id_fields = ('created_by', 'last_message', 'pinned_by')
    readonly_fields = ('created_at',)
    inlines = (ConversationMemberInline,)
    date_hierarchy = 'created_at'

    @admin.display(description='Loại kênh', ordering='type')
    def type_label(self, obj):
        return obj.get_type_display()

    @admin.display(description='Thành viên')
    def member_count(self, obj):
        return obj.members.filter(left_at__isnull=True).count()


@admin.register(ConversationMember)
class ConversationMemberAdmin(admin.ModelAdmin):
    list_display = ('id', 'conversation', 'user', 'role', 'notification_level', 'joined_at', 'left_at')
    list_filter = ('role', 'notification_level', 'joined_at', 'left_at')
    search_fields = ('conversation__name', 'user__username', 'user__display_name')
    raw_id_fields = ('conversation', 'user', 'last_read_message')
    readonly_fields = ('joined_at',)


class MessageAttachmentInline(admin.TabularInline):
    model = MessageAttachment
    extra = 0
    fields = ('file_url', 'file_type', 'created_at')
    readonly_fields = ('created_at',)


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'conversation', 'sender', 'type', 'content_preview', 'parent_message', 'created_at', 'deleted_at')
    list_filter = ('type', 'created_at', 'edited_at', 'deleted_at')
    search_fields = ('conversation__name', 'sender__username', 'sender__display_name')
    raw_id_fields = ('conversation', 'sender', 'parent_message')
    readonly_fields = ('created_at',)
    inlines = (MessageAttachmentInline,)
    date_hierarchy = 'created_at'

    @admin.display(description='Nội dung')
    def content_preview(self, obj):
        text = obj.content.get('text', '') if isinstance(obj.content, dict) else str(obj.content)
        return text[:80] + ('…' if len(text) > 80 else '')


@admin.register(MessageMention)
class MessageMentionAdmin(admin.ModelAdmin):
    list_display = ('id', 'message', 'user', 'type')
    list_filter = ('type',)
    search_fields = ('user__username', 'user__display_name')
    raw_id_fields = ('message', 'user')


@admin.register(ReactionType)
class ReactionTypeAdmin(admin.ModelAdmin):
    list_display = ('id', 'code', 'type', 'is_active', 'sort_order', 'created_by', 'created_at')
    list_filter = ('type', 'is_active')
    list_editable = ('is_active', 'sort_order')
    search_fields = ('code',)
    raw_id_fields = ('created_by',)
    readonly_fields = ('created_at',)


@admin.register(MessageReaction)
class MessageReactionAdmin(admin.ModelAdmin):
    list_display = ('id', 'message', 'user', 'reaction_type', 'created_at')
    list_filter = ('reaction_type', 'created_at')
    search_fields = ('user__username', 'reaction_type__code')
    raw_id_fields = ('message', 'user', 'reaction_type')
    readonly_fields = ('created_at',)


@admin.register(MessageAttachment)
class MessageAttachmentAdmin(admin.ModelAdmin):
    list_display = ('id', 'message', 'file_type', 'file_url', 'created_at')
    list_filter = ('file_type', 'created_at')
    search_fields = ('file_url', 'file_type')
    raw_id_fields = ('message',)
    readonly_fields = ('created_at',)


@admin.register(ChatNotification)
class ChatNotificationAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'type', 'entity_id', 'is_read', 'created_at')
    list_filter = ('type', 'is_read', 'created_at')
    search_fields = ('user__username', 'user__display_name')
    raw_id_fields = ('user',)
    readonly_fields = ('created_at',)


@admin.register(ReactionSummaryCache)
class ReactionSummaryCacheAdmin(admin.ModelAdmin):
    list_display = ('id', 'message', 'reaction_type', 'total')
    list_filter = ('reaction_type',)
    raw_id_fields = ('message', 'reaction_type')


@admin.register(UserReactionUsage)
class UserReactionUsageAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'reaction_type', 'count')
    list_filter = ('reaction_type',)
    search_fields = ('user__username', 'user__display_name')
    raw_id_fields = ('user', 'reaction_type')
