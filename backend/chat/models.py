from django.contrib.auth.models import User
from django.db import models


class Organization(models.Model):
	name = models.TextField()
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		db_table = 'chat_organizations'
		ordering = ['id']

	def __str__(self):
		return self.name


class ChatUser(models.Model):
	class Status(models.IntegerChoices):
		INACTIVE = 0, 'inactive'
		ACTIVE = 1, 'active'

	auth_user = models.OneToOneField(
		User,
		on_delete=models.CASCADE,
		related_name='chat_profile',
		null=True,
		blank=True,
	)
	org = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='users')
	username = models.TextField(unique=True)
	display_name = models.TextField(blank=True)
	email = models.TextField(blank=True)
	avatar_url = models.TextField(blank=True)
	status = models.SmallIntegerField(choices=Status.choices, default=Status.ACTIVE)
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		db_table = 'chat_users'
		ordering = ['id']
		indexes = [models.Index(fields=['org', 'username'], name='chat_user_org_un_idx')]

	def __str__(self):
		return self.username


class UsernameHistory(models.Model):
	user = models.ForeignKey(ChatUser, on_delete=models.CASCADE, related_name='username_history')
	username = models.TextField()
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		db_table = 'chat_username_history'
		ordering = ['-created_at']
		indexes = [models.Index(fields=['user', '-created_at'], name='chat_usr_hist_idx')]


class Conversation(models.Model):
	class Type(models.IntegerChoices):
		PUBLIC = 1, 'public'
		PRIVATE = 2, 'private'
		DM = 3, 'dm'
		GROUP_DM = 4, 'group_dm'

	org = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='conversations')
	type = models.SmallIntegerField(choices=Type.choices)
	name = models.TextField(blank=True)
	created_by = models.ForeignKey(ChatUser, on_delete=models.SET_NULL, null=True, related_name='created_conversations')
	last_message = models.ForeignKey(
		'Message',
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='+',
	)
	created_at = models.DateTimeField(auto_now_add=True)
	archived_at = models.DateTimeField(null=True, blank=True)
	is_pinned = models.BooleanField(default=False)
	pinned_by = models.ForeignKey(
		ChatUser,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='pinned_conversations',
	)
	pinned_at = models.DateTimeField(null=True, blank=True)

	class Meta:
		db_table = 'chat_conversations'
		ordering = ['-id']
		indexes = [models.Index(fields=['org', 'type'], name='chat_conv_org_type_idx')]


class ConversationMember(models.Model):
	class Role(models.IntegerChoices):
		OWNER = 1, 'owner'
		ADMIN = 2, 'admin'
		MEMBER = 3, 'member'
		GUEST = 4, 'guest'

	class NotificationLevel(models.IntegerChoices):
		ALL = 1, 'all'
		MENTION = 2, 'mention'
		MUTE = 3, 'mute'

	conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='members')
	user = models.ForeignKey(ChatUser, on_delete=models.CASCADE, related_name='conversation_memberships')
	role = models.SmallIntegerField(choices=Role.choices, default=Role.MEMBER)
	last_read_message = models.ForeignKey(
		'Message',
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='+',
	)
	notification_level = models.SmallIntegerField(
		choices=NotificationLevel.choices,
		default=NotificationLevel.ALL,
	)
	muted_until = models.DateTimeField(null=True, blank=True)
	joined_at = models.DateTimeField(auto_now_add=True)
	left_at = models.DateTimeField(null=True, blank=True)

	class Meta:
		db_table = 'chat_conversation_members'
		unique_together = [('conversation', 'user')]
		indexes = [
			models.Index(fields=['user'], name='chat_cm_user_idx'),
			models.Index(fields=['conversation', 'last_read_message'], name='chat_cm_seen_idx'),
		]


class Message(models.Model):
	class Type(models.IntegerChoices):
		TEXT = 1, 'text'
		IMAGE = 2, 'image'
		FILE = 3, 'file'
		SYSTEM = 4, 'system'

	conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
	sender = models.ForeignKey(ChatUser, on_delete=models.SET_NULL, null=True, related_name='sent_messages')
	content = models.JSONField(default=dict, blank=True)
	type = models.SmallIntegerField(choices=Type.choices, default=Type.TEXT)
	parent_message = models.ForeignKey(
		'self',
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='thread_replies',
	)
	created_at = models.DateTimeField(auto_now_add=True)
	edited_at = models.DateTimeField(null=True, blank=True)
	deleted_at = models.DateTimeField(null=True, blank=True)

	class Meta:
		db_table = 'chat_messages'
		ordering = ['id']
		indexes = [
			models.Index(fields=['conversation', '-id'], name='chat_msg_conv_desc_idx'),
		]


class MessageMention(models.Model):
	class Type(models.IntegerChoices):
		USER = 1, 'user'
		ALL = 2, 'all'
		ROLE = 3, 'role'

	message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='mentions')
	user = models.ForeignKey(ChatUser, on_delete=models.CASCADE, related_name='message_mentions')
	type = models.SmallIntegerField(choices=Type.choices, default=Type.USER)

	class Meta:
		db_table = 'chat_message_mentions'
		unique_together = [('message', 'user')]
		indexes = [models.Index(fields=['user'], name='chat_mention_user_idx')]


class ReactionType(models.Model):
	class Type(models.IntegerChoices):
		EMOJI = 1, 'emoji'
		STICKER = 2, 'sticker'

	type = models.SmallIntegerField(choices=Type.choices, default=Type.EMOJI)
	code = models.TextField()
	asset_url = models.TextField(blank=True)
	is_active = models.BooleanField(default=True)
	sort_order = models.PositiveIntegerField(default=0)
	created_by = models.ForeignKey(
		ChatUser,
		on_delete=models.SET_NULL,
		null=True,
		blank=True,
		related_name='created_reaction_types',
	)
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		db_table = 'chat_reaction_types'
		indexes = [models.Index(fields=['type', 'code'], name='chat_re_type_code_idx')]


class MessageReaction(models.Model):
	message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='reactions')
	user = models.ForeignKey(ChatUser, on_delete=models.CASCADE, related_name='message_reactions')
	reaction_type = models.ForeignKey(ReactionType, on_delete=models.CASCADE, related_name='message_reactions')
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		db_table = 'chat_message_reactions'
		unique_together = [('message', 'user', 'reaction_type')]


class MessageAttachment(models.Model):
	message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='attachments')
	file_url = models.TextField()
	file_type = models.TextField(blank=True)
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		db_table = 'chat_message_attachments'
		ordering = ['id']


class ChatNotification(models.Model):
	class Type(models.IntegerChoices):
		MENTION = 1, 'mention'
		REACTION = 2, 'reaction'
		MESSAGE = 3, 'message'

	user = models.ForeignKey(ChatUser, on_delete=models.CASCADE, related_name='notifications')
	type = models.SmallIntegerField(choices=Type.choices)
	entity_id = models.BigIntegerField()
	is_read = models.BooleanField(default=False)
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		db_table = 'chat_notifications'
		ordering = ['-id']
		indexes = [models.Index(fields=['user', 'is_read', '-id'], name='chat_notif_user_idx')]


class ReactionSummaryCache(models.Model):
	message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='reaction_summary')
	reaction_type = models.ForeignKey(ReactionType, on_delete=models.CASCADE, related_name='reaction_summary')
	total = models.IntegerField(default=0)

	class Meta:
		db_table = 'chat_reaction_summary_cache'
		unique_together = [('message', 'reaction_type')]


class UserReactionUsage(models.Model):
	user = models.ForeignKey(ChatUser, on_delete=models.CASCADE, related_name='reaction_usage')
	reaction_type = models.ForeignKey(ReactionType, on_delete=models.CASCADE, related_name='user_usage')
	count = models.IntegerField(default=0)

	class Meta:
		db_table = 'chat_user_reaction_usage'
		unique_together = [('user', 'reaction_type')]
