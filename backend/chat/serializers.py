from django.utils import timezone
from rest_framework import serializers

from hrm.utils import get_cloudfly_presigned_url

from .models import ChatNotification, ChatUser, Conversation, ConversationMember, Message, ReactionType


class ReactionTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReactionType
        fields = ['id', 'type', 'code', 'asset_url', 'is_active', 'sort_order', 'created_by_id', 'created_at']


class ChatUserSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()
    employee_code = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()
    position_title = serializers.SerializerMethodField()

    class Meta:
        model = ChatUser
        fields = [
            'id', 'username', 'display_name', 'email', 'avatar_url', 'status',
            'employee_code', 'department_name', 'position_title',
        ]

    def get_employee(self, obj):
        return getattr(obj.auth_user, 'employee', None) if obj.auth_user else None

    def get_avatar_url(self, obj):
        if obj.avatar_url:
            return obj.avatar_url
        employee = getattr(obj.auth_user, 'employee', None) if obj.auth_user else None
        if employee and employee.avatar:
            return get_cloudfly_presigned_url(str(employee.avatar))
        return None

    def get_employee_code(self, obj):
        employee = self.get_employee(obj)
        return employee.employee_id if employee else None

    def get_department_name(self, obj):
        employee = self.get_employee(obj)
        return employee.department.name if employee and employee.department else None

    def get_position_title(self, obj):
        employee = self.get_employee(obj)
        return employee.position.title if employee and employee.position else None


class MessageSerializer(serializers.ModelSerializer):
    sender_id = serializers.IntegerField(source='sender.id', read_only=True)
    sender_username = serializers.CharField(source='sender.username', read_only=True)
    sender = ChatUserSerializer(read_only=True)
    parent_message = serializers.SerializerMethodField()
    reactions = serializers.SerializerMethodField()
    attachments = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            'id',
            'conversation_id',
            'sender_id',
            'sender_username',
            'sender',
            'content',
            'type',
            'parent_message_id',
            'parent_message',
            'reactions',
            'attachments',
            'created_at',
            'edited_at',
            'deleted_at',
        ]

    def get_attachments(self, obj):
        return [
            {
                'id': attachment.id,
                'file_url': get_cloudfly_presigned_url(attachment.file_url) or attachment.file_url,
                'file_type': attachment.file_type,
            }
            for attachment in obj.attachments.all()
        ]

    def get_parent_message(self, obj):
        parent = obj.parent_message
        if not parent:
            return None
        return {
            'id': parent.id,
            'sender_id': parent.sender_id,
            'sender_name': parent.sender.display_name if parent.sender else '',
            'text': parent.content.get('text', '') if isinstance(parent.content, dict) else str(parent.content),
        }

    def get_reactions(self, obj):
        current_user = self.context.get('chat_user')
        grouped = {}
        for reaction in obj.reactions.all():
            reaction_type = reaction.reaction_type
            group = grouped.setdefault(reaction_type_id := reaction_type.id, {
                'reaction_type_id': reaction_type_id,
                'code': reaction_type.code,
                'asset_url': reaction_type.asset_url,
                'total': 0,
                'reacted_by_me': False,
                'users': [],
            })
            group['total'] += 1
            group['reacted_by_me'] = group['reacted_by_me'] or bool(current_user and reaction.user_id == current_user.id)
            group['users'].append(ChatUserSerializer(reaction.user).data)
        return list(grouped.values())


class ConversationSerializer(serializers.ModelSerializer):
    last_message = MessageSerializer(read_only=True)
    unread = serializers.SerializerMethodField()
    members = serializers.SerializerMethodField()
    is_member = serializers.SerializerMethodField()
    is_muted = serializers.SerializerMethodField()
    muted_until = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            'id',
            'org_id',
            'type',
            'name',
            'created_by_id',
            'last_message_id',
            'last_message',
            'created_at',
            'archived_at',
            'unread',
            'members',
            'is_member',
            'is_pinned',
            'pinned_by_id',
            'pinned_at',
            'is_muted',
            'muted_until',
        ]

    def get_members(self, obj):
        memberships = obj.members.select_related(
            'user', 'user__auth_user', 'user__auth_user__employee',
            'user__auth_user__employee__department', 'user__auth_user__employee__position',
        ).filter(left_at__isnull=True)
        return ChatUserSerializer([membership.user for membership in memberships], many=True).data

    def get_is_member(self, obj):
        chat_user = self.context.get('chat_user')
        return bool(chat_user and obj.members.filter(user=chat_user, left_at__isnull=True).exists())

    def _get_membership(self, obj):
        chat_user = self.context.get('chat_user')
        if not chat_user:
            return None
        return ConversationMember.objects.filter(conversation=obj, user=chat_user, left_at__isnull=True).first()

    def get_unread(self, obj):
        member = self._get_membership(obj)
        if not member:
            return False
        if not obj.last_message_id:
            return False
        if not member.last_read_message_id:
            return True
        return obj.last_message_id > member.last_read_message_id

    def get_is_muted(self, obj):
        member = self._get_membership(obj)
        return bool(member and member.muted_until and member.muted_until > timezone.now())

    def get_muted_until(self, obj):
        member = self._get_membership(obj)
        if member and member.muted_until and member.muted_until > timezone.now():
            return member.muted_until
        return None


class ChatNotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatNotification
        fields = ['id', 'type', 'entity_id', 'is_read', 'created_at']
