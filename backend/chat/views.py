import json
import time
import uuid
from datetime import timedelta
from io import BytesIO

from django.contrib.auth.models import AnonymousUser, User
from django.db import transaction
from django.db.models import Count, F, Q
from django.http import JsonResponse, StreamingHttpResponse
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views import View
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework_simplejwt.authentication import JWTAuthentication

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
from .serializers import (
	ChatNotificationSerializer,
	ChatUserSerializer,
	ConversationSerializer,
	MessageSerializer,
	ReactionTypeSerializer,
)
from hrm.utils import upload_file_to_cloudfly


CHAT_IMAGE_MAX_SIZE = 500 * 1024
CHAT_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}


def _ensure_chat_user(auth_user):
	org, _ = Organization.objects.get_or_create(name='Default Organization')
	employee = getattr(auth_user, 'employee', None)
	display_name = (employee.full_name if employee else '') or auth_user.get_full_name() or auth_user.username
	chat_user, created = ChatUser.objects.get_or_create(
		auth_user=auth_user,
		defaults={
			'org': org,
			'username': auth_user.username,
			'display_name': display_name,
			'email': auth_user.email or '',
			'status': ChatUser.Status.ACTIVE,
		},
	)
	if created:
		UsernameHistory.objects.create(user=chat_user, username=chat_user.username)
	elif chat_user.display_name != display_name or chat_user.email != (auth_user.email or ''):
		chat_user.display_name = display_name
		chat_user.email = auth_user.email or ''
		chat_user.save(update_fields=['display_name', 'email'])
	return chat_user


def _sync_company_public_channel(current_user):
	"""Create the company channel once and keep all active accounts as members."""
	existing_auth_ids = set(
		ChatUser.objects.filter(auth_user_id__isnull=False).values_list('auth_user_id', flat=True)
	)
	for auth_user in User.objects.filter(is_active=True).exclude(id__in=existing_auth_ids).iterator():
		_ensure_chat_user(auth_user)

	# There is no database uniqueness constraint for public channel names. Lock
	# the organization row so concurrent bootstrap requests cannot create more
	# duplicates, and tolerate duplicates that may already exist.
	with transaction.atomic():
		Organization.objects.select_for_update().get(pk=current_user.org_id)
		conversation = Conversation.objects.filter(
			org=current_user.org,
			type=Conversation.Type.PUBLIC,
			name='Kênh chung công ty',
		).order_by('id').first()
		if conversation is None:
			conversation = Conversation.objects.create(
				org=current_user.org,
				type=Conversation.Type.PUBLIC,
				name='Kênh chung công ty',
				created_by=current_user,
			)
	member_user_ids = set(
		ConversationMember.objects.filter(conversation=conversation, left_at__isnull=True)
		.values_list('user_id', flat=True)
	)
	missing_members = ChatUser.objects.filter(
		org=current_user.org,
		status=ChatUser.Status.ACTIVE,
	).exclude(id__in=member_user_ids)
	ConversationMember.objects.bulk_create([
		ConversationMember(
			conversation=conversation,
			user=member,
			role=ConversationMember.Role.MEMBER,
		)
		for member in missing_members
	], ignore_conflicts=True)
	return conversation


def _get_active_membership(conversation_id, chat_user):
	return get_object_or_404(
		ConversationMember,
		conversation_id=conversation_id,
		user=chat_user,
		left_at__isnull=True,
	)


def _can_moderate_messages(auth_user):
	if auth_user.is_staff or auth_user.is_superuser:
		return True
	employee = getattr(auth_user, 'employee', None)
	return bool(employee and employee.is_hr)


def _can_manage_channels(auth_user):
	return bool(auth_user.is_staff or auth_user.is_superuser)


class ChatBootstrapView(APIView):
	permission_classes = [IsAuthenticated]

	def post(self, request):
		chat_user = _ensure_chat_user(request.user)
		_sync_company_public_channel(chat_user)
		return Response(
			{
				'chat_user_id': chat_user.id,
				'org_id': chat_user.org_id,
				'username': chat_user.username,
				'display_name': chat_user.display_name,
				'can_delete_messages': _can_moderate_messages(request.user),
				'can_manage_channels': _can_manage_channels(request.user),
			},
			status=status.HTTP_200_OK,
		)


class ChatUnreadCountView(APIView):
	permission_classes = [IsAuthenticated]

	def get(self, request):
		chat_user = _ensure_chat_user(request.user)
		unread_count = ConversationMember.objects.filter(
			user=chat_user,
			left_at__isnull=True,
			conversation__archived_at__isnull=True,
			conversation__last_message_id__isnull=False,
		).filter(
			Q(last_read_message_id__isnull=True)
			| Q(conversation__last_message_id__gt=F('last_read_message_id'))
		).filter(
			Q(muted_until__isnull=True) | Q(muted_until__lt=timezone.now())
		).count()
		return Response({'unread_count': unread_count})


class ChatUserListView(APIView):
	permission_classes = [IsAuthenticated]

	def get(self, request):
		chat_user = _ensure_chat_user(request.user)
		# This also synchronizes active HRM accounts into the chat directory.
		_sync_company_public_channel(chat_user)
		query = (request.query_params.get('q') or '').strip()
		users = ChatUser.objects.select_related(
			'auth_user', 'auth_user__employee', 'auth_user__employee__department', 'auth_user__employee__position',
		).filter(
			org=chat_user.org,
			status=ChatUser.Status.ACTIVE,
		).exclude(id=chat_user.id)
		if query:
			users = users.filter(
				Q(username__icontains=query)
				| Q(display_name__icontains=query)
				| Q(auth_user__employee__employee_id__icontains=query)
				| Q(auth_user__employee__department__name__icontains=query)
				| Q(auth_user__employee__position__title__icontains=query)
			).distinct()
		return Response({'results': ChatUserSerializer(users.order_by('display_name')[:100], many=True).data})


class ConversationListCreateView(APIView):
	permission_classes = [IsAuthenticated]

	def get(self, request):
		chat_user = _ensure_chat_user(request.user)
		if _can_moderate_messages(request.user):
			conversations = Conversation.objects.filter(
				org=chat_user.org,
				archived_at__isnull=True,
			).select_related('last_message').order_by(
				'-is_pinned', '-pinned_at', '-last_message_id', '-id',
			)
		else:
			memberships = (
				ConversationMember.objects.select_related('conversation', 'conversation__last_message')
				.filter(user=chat_user, left_at__isnull=True, conversation__archived_at__isnull=True)
				.order_by('-conversation__is_pinned', '-conversation__pinned_at', '-conversation__last_message_id', '-conversation_id')
			)
			conversations = [member.conversation for member in memberships]
		data = ConversationSerializer(conversations, many=True, context={'chat_user': chat_user}).data
		return Response({'results': data}, status=status.HTTP_200_OK)

	def post(self, request):
		chat_user = _ensure_chat_user(request.user)
		member_ids = list({int(member_id) for member_id in request.data.get('member_ids', []) if str(member_id).isdigit()})
		conversation_type = int(request.data.get('type', Conversation.Type.GROUP_DM))
		name = str(request.data.get('name', '')).strip()
		if conversation_type == Conversation.Type.PUBLIC and not _can_manage_channels(request.user):
			return Response({'detail': 'Chỉ Admin được tạo kênh công khai.'}, status=status.HTTP_403_FORBIDDEN)
		if conversation_type in (Conversation.Type.PUBLIC, Conversation.Type.PRIVATE, Conversation.Type.GROUP_DM) and not name:
			return Response({'detail': 'Tên kênh là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)

		with transaction.atomic():
			# Serialize DM creation per organization, then reuse an existing direct
			# conversation containing exactly these two active members.
			Organization.objects.select_for_update().get(pk=chat_user.org_id)
			if conversation_type == Conversation.Type.DM:
				target_ids = [member_id for member_id in member_ids if member_id != chat_user.id]
				if len(target_ids) != 1:
					return Response(
						{'detail': 'Chat riêng cần đúng một người nhận.'},
						status=status.HTTP_400_BAD_REQUEST,
					)
				target_id = target_ids[0]
				if not ChatUser.objects.filter(id=target_id, org=chat_user.org, status=ChatUser.Status.ACTIVE).exists():
					return Response({'detail': 'Người nhận không tồn tại.'}, status=status.HTTP_400_BAD_REQUEST)
				existing = (
					Conversation.objects.filter(
						org=chat_user.org,
						type=Conversation.Type.DM,
						archived_at__isnull=True,
						members__user=chat_user,
						members__left_at__isnull=True,
					)
					.filter(members__user_id=target_id, members__left_at__isnull=True)
					.annotate(
						active_member_count=Count(
							'members',
							filter=Q(members__left_at__isnull=True),
							distinct=True,
						)
					)
					.filter(active_member_count=2)
					.order_by('id')
					.first()
				)
				if existing:
					return Response(
						ConversationSerializer(existing, context={'chat_user': chat_user}).data,
						status=status.HTTP_200_OK,
					)

			conversation = Conversation.objects.create(
				org=chat_user.org,
				type=conversation_type,
				name=name,
				created_by=chat_user,
			)
			ConversationMember.objects.create(
				conversation=conversation,
				user=chat_user,
				role=ConversationMember.Role.OWNER,
			)
			if conversation_type == Conversation.Type.PUBLIC:
				users = ChatUser.objects.filter(org=chat_user.org, status=ChatUser.Status.ACTIVE).exclude(id=chat_user.id)
			elif member_ids:
				users = ChatUser.objects.filter(id__in=member_ids, org=chat_user.org).exclude(id=chat_user.id)
			else:
				users = ChatUser.objects.none()
			if users.exists():
				for member in users:
					ConversationMember.objects.get_or_create(
						conversation=conversation,
						user=member,
						defaults={'role': ConversationMember.Role.MEMBER},
					)

		return Response(ConversationSerializer(conversation, context={'chat_user': chat_user}).data, status=status.HTTP_201_CREATED)


class ConversationDetailView(APIView):
	permission_classes = [IsAuthenticated]

	def patch(self, request, conversation_id):
		chat_user = _ensure_chat_user(request.user)
		if not _can_manage_channels(request.user):
			return Response({'detail': 'Chỉ Admin được đổi tên kênh.'}, status=status.HTTP_403_FORBIDDEN)
		conversation = get_object_or_404(Conversation, id=conversation_id, org=chat_user.org, archived_at__isnull=True)
		name = str(request.data.get('name', '')).strip()
		if not name:
			return Response({'detail': 'Tên kênh là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)
		conversation.name = name
		conversation.save(update_fields=['name'])
		return Response(ConversationSerializer(conversation, context={'chat_user': chat_user}).data)


class ConversationMemberListView(APIView):
	permission_classes = [IsAuthenticated]

	def post(self, request, conversation_id):
		chat_user = _ensure_chat_user(request.user)
		conversation = get_object_or_404(Conversation, id=conversation_id, org=chat_user.org, archived_at__isnull=True)
		membership = ConversationMember.objects.filter(conversation=conversation, user=chat_user, left_at__isnull=True).first()
		is_owner = conversation.created_by_id == chat_user.id or bool(membership and membership.role == ConversationMember.Role.OWNER)
		if not is_owner and not _can_manage_channels(request.user):
			return Response({'detail': 'Bạn không có quyền thêm thành viên vào kênh này.'}, status=status.HTTP_403_FORBIDDEN)
		member_ids = request.data.get('member_ids', [])
		users = ChatUser.objects.filter(id__in=member_ids, org=chat_user.org, status=ChatUser.Status.ACTIVE)
		created_count = 0
		for member in users:
			_, created = ConversationMember.objects.get_or_create(
				conversation=conversation,
				user=member,
				defaults={'role': ConversationMember.Role.MEMBER},
			)
			if created:
				created_count += 1
		return Response({
			'created_count': created_count,
			'conversation': ConversationSerializer(conversation, context={'chat_user': chat_user}).data,
		})


class ConversationMemberDetailView(APIView):
	permission_classes = [IsAuthenticated]

	def delete(self, request, conversation_id, user_id):
		chat_user = _ensure_chat_user(request.user)
		conversation = get_object_or_404(
			Conversation,
			id=conversation_id,
			org=chat_user.org,
			archived_at__isnull=True,
		)
		owner_membership = ConversationMember.objects.filter(
			conversation=conversation,
			user=chat_user,
			role=ConversationMember.Role.OWNER,
			left_at__isnull=True,
		).exists()
		if conversation.created_by_id != chat_user.id and not owner_membership:
			return Response({'detail': 'Chỉ chủ kênh được xoá thành viên.'}, status=status.HTTP_403_FORBIDDEN)
		if conversation.type in (Conversation.Type.PUBLIC, Conversation.Type.DM):
			return Response(
				{'detail': 'Không thể xoá thành viên khỏi kênh công khai hoặc chat riêng.'},
				status=status.HTTP_400_BAD_REQUEST,
			)
		if int(user_id) == chat_user.id or int(user_id) == conversation.created_by_id:
			return Response({'detail': 'Chủ kênh không thể tự xoá mình.'}, status=status.HTTP_400_BAD_REQUEST)

		membership = get_object_or_404(
			ConversationMember,
			conversation=conversation,
			user_id=user_id,
			left_at__isnull=True,
		)
		membership.left_at = timezone.now()
		membership.save(update_fields=['left_at'])
		return Response(status=status.HTTP_204_NO_CONTENT)


class ConversationPinView(APIView):
	permission_classes = [IsAuthenticated]

	def post(self, request, conversation_id):
		chat_user = _ensure_chat_user(request.user)
		if not _can_moderate_messages(request.user):
			return Response({'detail': 'Chỉ Admin hoặc HR được ghim kênh.'}, status=status.HTTP_403_FORBIDDEN)
		conversation = get_object_or_404(Conversation, id=conversation_id, org=chat_user.org, archived_at__isnull=True)
		should_pin = bool(request.data.get('is_pinned', not conversation.is_pinned))
		conversation.is_pinned = should_pin
		conversation.pinned_by = chat_user if should_pin else None
		conversation.pinned_at = timezone.now() if should_pin else None
		conversation.save(update_fields=['is_pinned', 'pinned_by', 'pinned_at'])
		return Response(ConversationSerializer(conversation, context={'chat_user': chat_user}).data)


class ConversationMuteView(APIView):
	permission_classes = [IsAuthenticated]

	DURATION_MINUTES = {'15m': 15, '1h': 60, '8h': 8 * 60, '24h': 24 * 60}

	def post(self, request, conversation_id):
		chat_user = _ensure_chat_user(request.user)
		membership = _get_active_membership(conversation_id, chat_user)
		duration = request.data.get('duration')
		if duration is None:
			membership.muted_until = None
		elif duration == 'forever':
			membership.muted_until = timezone.now() + timedelta(days=365 * 100)
		elif duration in self.DURATION_MINUTES:
			membership.muted_until = timezone.now() + timedelta(minutes=self.DURATION_MINUTES[duration])
		else:
			return Response({'detail': 'Giá trị duration không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
		membership.save(update_fields=['muted_until'])
		return Response(ConversationSerializer(membership.conversation, context={'chat_user': chat_user}).data)


class MessageListCreateView(APIView):
	permission_classes = [IsAuthenticated]

	def get(self, request, conversation_id):
		chat_user = _ensure_chat_user(request.user)
		conversation = get_object_or_404(Conversation, id=conversation_id, org=chat_user.org, archived_at__isnull=True)
		if not _can_moderate_messages(request.user):
			_get_active_membership(conversation.id, chat_user)

		after_id = request.query_params.get('after_id')
		before_id = request.query_params.get('before_id')
		limit = min(int(request.query_params.get('limit', 50)), 200)

		queryset = Message.objects.select_related(
			'sender', 'sender__auth_user', 'sender__auth_user__employee',
			'sender__auth_user__employee__department', 'sender__auth_user__employee__position',
			'parent_message', 'parent_message__sender',
		).prefetch_related(
			'attachments',
			'reactions__reaction_type',
			'reactions__user',
			'reactions__user__auth_user',
			'reactions__user__auth_user__employee',
			'reactions__user__auth_user__employee__department',
			'reactions__user__auth_user__employee__position',
		).filter(conversation_id=conversation_id, deleted_at__isnull=True)
		if after_id:
			queryset = queryset.filter(id__gt=int(after_id))
		if before_id:
			queryset = queryset.filter(id__lt=int(before_id))

		messages = list(queryset.order_by('-id')[:limit])
		messages.reverse()
		return Response(
			{
				'results': MessageSerializer(messages, many=True, context={'chat_user': chat_user}).data,
				'has_more': len(messages) == limit,
			},
			status=status.HTTP_200_OK,
		)

	def post(self, request, conversation_id):
		chat_user = _ensure_chat_user(request.user)
		membership = _get_active_membership(conversation_id, chat_user)
		conversation = membership.conversation

		raw_content = request.data.get('content', '')
		content = raw_content if isinstance(raw_content, dict) else {'text': str(raw_content)}
		message_type = int(request.data.get('type', Message.Type.TEXT))
		parent_message_id = request.data.get('parent_message_id')
		mention_user_ids = request.data.get('mention_user_ids', [])
		attachments = request.data.get('attachments', [])
		if not isinstance(attachments, list) or any(
			not isinstance(attachment, dict)
			or not str(attachment.get('file_url', '')).startswith('chat/images/')
			or attachment.get('file_type') not in CHAT_IMAGE_TYPES
			for attachment in attachments
		):
			return Response({'detail': 'Ảnh đính kèm không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

		with transaction.atomic():
			message = Message.objects.create(
				conversation=conversation,
				sender=chat_user,
				content=content,
				type=message_type,
				parent_message_id=parent_message_id,
			)

			conversation.last_message = message
			conversation.save(update_fields=['last_message'])

			membership.last_read_message = message
			membership.save(update_fields=['last_read_message'])

			mention_users = ChatUser.objects.filter(id__in=mention_user_ids, org=chat_user.org)
			for mentioned in mention_users:
				MessageMention.objects.get_or_create(
					message=message,
					user=mentioned,
					defaults={'type': MessageMention.Type.USER},
				)
				if mentioned.id != chat_user.id:
					ChatNotification.objects.create(
						user=mentioned,
						type=ChatNotification.Type.MENTION,
						entity_id=message.id,
					)

			for attachment in attachments:
				MessageAttachment.objects.create(
					message=message,
					file_url=attachment.get('file_url', ''),
					file_type=attachment.get('file_type', ''),
				)

			recipients = ConversationMember.objects.select_related('user').filter(
				conversation=conversation,
				left_at__isnull=True,
			).exclude(user=chat_user)
			for recipient in recipients:
				ChatNotification.objects.create(
					user=recipient.user,
					type=ChatNotification.Type.MESSAGE,
					entity_id=message.id,
				)

		return Response(MessageSerializer(message, context={'chat_user': chat_user}).data, status=status.HTTP_201_CREATED)


class ChatImageUploadView(APIView):
	permission_classes = [IsAuthenticated]

	def post(self, request):
		image = request.FILES.get('image')
		if not image:
			return Response({'detail': 'Vui lòng chọn ảnh.'}, status=status.HTTP_400_BAD_REQUEST)
		if image.size > CHAT_IMAGE_MAX_SIZE:
			return Response({'detail': 'Kích thước ảnh tối đa là 500 KB.'}, status=status.HTTP_400_BAD_REQUEST)
		if image.content_type not in CHAT_IMAGE_TYPES:
			return Response({'detail': 'Chỉ hỗ trợ ảnh JPEG, PNG, GIF hoặc WebP.'}, status=status.HTTP_400_BAD_REQUEST)

		try:
			image.seek(0)
			with Image.open(image) as opened_image:
				opened_image.verify()
			image.seek(0)
		except (UnidentifiedImageError, OSError):
			return Response({'detail': 'File tải lên không phải ảnh hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

		try:
			s3_key = upload_file_to_cloudfly(image, 'chat/images')
		except Exception:
			return Response({'detail': 'Không thể tải ảnh lên S3.'}, status=status.HTTP_502_BAD_GATEWAY)

		return Response({'file_url': s3_key, 'file_type': image.content_type}, status=status.HTTP_201_CREATED)


class MessageDetailView(APIView):
	permission_classes = [IsAuthenticated]

	def delete(self, request, message_id):
		if not _can_moderate_messages(request.user):
			return Response(
				{'detail': 'Chỉ Admin hoặc HR được phép xoá tin nhắn.'},
				status=status.HTTP_403_FORBIDDEN,
			)

		chat_user = _ensure_chat_user(request.user)
		message = get_object_or_404(Message, id=message_id, deleted_at__isnull=True)
		if message.conversation.org_id != chat_user.org_id:
			return Response({'detail': 'Không có quyền truy cập.'}, status=status.HTTP_403_FORBIDDEN)

		with transaction.atomic():
			message.deleted_at = timezone.now()
			message.save(update_fields=['deleted_at'])
			conversation = message.conversation
			if conversation.last_message_id == message.id:
				conversation.last_message = Message.objects.filter(
					conversation=conversation,
					deleted_at__isnull=True,
				).exclude(id=message.id).order_by('-id').first()
				conversation.save(update_fields=['last_message'])

		return Response(status=status.HTTP_204_NO_CONTENT)


class MarkConversationReadView(APIView):
	permission_classes = [IsAuthenticated]

	def post(self, request, conversation_id):
		chat_user = _ensure_chat_user(request.user)
		membership = _get_active_membership(conversation_id, chat_user)
		last_read_message_id = request.data.get('last_read_message_id')

		if not last_read_message_id:
			last_message_id = (
				Message.objects.filter(conversation_id=conversation_id, deleted_at__isnull=True)
				.order_by('-id')
				.values_list('id', flat=True)
				.first()
			)
			last_read_message_id = last_message_id

		if last_read_message_id:
			membership.last_read_message_id = int(last_read_message_id)
			membership.save(update_fields=['last_read_message'])

		return Response({'last_read_message_id': membership.last_read_message_id}, status=status.HTTP_200_OK)


class MessageSeenByView(APIView):
	permission_classes = [IsAuthenticated]

	def get(self, request, message_id):
		chat_user = _ensure_chat_user(request.user)
		message = get_object_or_404(Message, id=message_id, deleted_at__isnull=True)
		_get_active_membership(message.conversation_id, chat_user)

		limit = min(int(request.query_params.get('limit', 5)), 20)
		seen_members = ConversationMember.objects.select_related('user').filter(
			conversation_id=message.conversation_id,
			left_at__isnull=True,
			last_read_message_id__gte=message.id,
		)
		total_seen = seen_members.count()
		recent = seen_members.order_by('-last_read_message_id')[:limit]

		return Response(
			{
				'message_id': message.id,
				'total_seen': total_seen,
				'recent_seen_users': [
					{
						'user_id': member.user_id,
						'username': member.user.username,
						'display_name': member.user.display_name,
						'avatar_url': member.user.avatar_url,
					}
					for member in recent
				],
			},
			status=status.HTTP_200_OK,
		)


class MessageReactionView(APIView):
	permission_classes = [IsAuthenticated]

	def post(self, request, message_id):
		chat_user = _ensure_chat_user(request.user)
		message = get_object_or_404(Message, id=message_id, deleted_at__isnull=True)
		_get_active_membership(message.conversation_id, chat_user)

		reaction_type_id = request.data.get('reaction_type_id')
		code = request.data.get('code')
		reaction_kind = int(request.data.get('type', ReactionType.Type.EMOJI))

		if reaction_type_id:
			reaction_type = get_object_or_404(ReactionType, id=reaction_type_id, is_active=True)
		elif code:
			reaction_type = ReactionType.objects.filter(type=reaction_kind, code=code, is_active=True).order_by('id').first()
			if not reaction_type:
				reaction_type = ReactionType.objects.create(type=reaction_kind, code=code, created_by=chat_user)
		else:
			return Response({'detail': 'reaction_type_id hoặc code là bắt buộc'}, status=status.HTTP_400_BAD_REQUEST)

		reaction, created = MessageReaction.objects.get_or_create(
			message=message,
			user=chat_user,
			reaction_type=reaction_type,
		)

		if created:
			summary, _ = ReactionSummaryCache.objects.get_or_create(message=message, reaction_type=reaction_type)
			summary.total = F('total') + 1
			summary.save(update_fields=['total'])

			usage, _ = UserReactionUsage.objects.get_or_create(user=chat_user, reaction_type=reaction_type)
			usage.count = F('count') + 1
			usage.save(update_fields=['count'])

			if message.sender_id and message.sender_id != chat_user.id:
				ChatNotification.objects.create(
					user=message.sender,
					type=ChatNotification.Type.REACTION,
					entity_id=reaction.id,
				)

		return Response({'created': created, 'reaction_id': reaction.id}, status=status.HTTP_200_OK)

	def delete(self, request, message_id):
		chat_user = _ensure_chat_user(request.user)
		message = get_object_or_404(Message, id=message_id, deleted_at__isnull=True)
		_get_active_membership(message.conversation_id, chat_user)

		reaction_type_id = request.data.get('reaction_type_id')
		if not reaction_type_id:
			return Response({'detail': 'reaction_type_id là bắt buộc'}, status=status.HTTP_400_BAD_REQUEST)

		reaction = MessageReaction.objects.filter(
			message=message,
			user=chat_user,
			reaction_type_id=reaction_type_id,
		).first()
		if not reaction:
			return Response({'detail': 'Reaction không tồn tại'}, status=status.HTTP_404_NOT_FOUND)

		reaction.delete()
		ReactionSummaryCache.objects.filter(message=message, reaction_type_id=reaction_type_id, total__gt=0).update(total=F('total') - 1)
		return Response(status=status.HTTP_204_NO_CONTENT)


DEFAULT_REACTIONS = ['👍', '👏', '👌', '❤️', '😂', '🎉']


def _optimize_reaction_image(uploaded_file):
	"""Normalize a reaction asset to a tiny, transparent 96x96 WebP."""
	if uploaded_file.size > 15 * 1024 * 1024:
		raise ValueError('Ảnh gốc không được vượt quá 15MB.')
	try:
		image = Image.open(uploaded_file)
		image = ImageOps.exif_transpose(image)
		image.seek(0)
		if image.width * image.height > 25_000_000:
			raise ValueError('Kích thước ảnh quá lớn.')
		image = image.convert('RGBA')
		image.thumbnail((96, 96), Image.Resampling.LANCZOS)
		canvas = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
		canvas.alpha_composite(image, ((96 - image.width) // 2, (96 - image.height) // 2))
		output = BytesIO()
		canvas.save(output, format='WEBP', quality=80, method=6)
		return ContentFile(output.getvalue(), name=f'{uuid.uuid4().hex}.webp')
	except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
		raise ValueError('File tải lên không phải ảnh hợp lệ.') from exc


class ReactionTypeListCreateView(APIView):
	permission_classes = [IsAuthenticated]

	def get(self, request):
		chat_user = _ensure_chat_user(request.user)
		for index, code in enumerate(DEFAULT_REACTIONS):
			if not ReactionType.objects.filter(type=ReactionType.Type.EMOJI, code=code).exists():
				ReactionType.objects.create(type=ReactionType.Type.EMOJI, code=code, created_by=chat_user, sort_order=index)
		queryset = ReactionType.objects.all()
		if not (_can_moderate_messages(request.user) and request.query_params.get('include_inactive') == '1'):
			queryset = queryset.filter(is_active=True)
		return Response({'results': ReactionTypeSerializer(queryset.order_by('sort_order', 'id'), many=True).data})

	def post(self, request):
		if not _can_moderate_messages(request.user):
			return Response({'detail': 'Chỉ Admin hoặc HR được quản lý reaction.'}, status=status.HTTP_403_FORBIDDEN)
		chat_user = _ensure_chat_user(request.user)
		image = request.FILES.get('image')
		if not image:
			return Response({'detail': 'Vui lòng chọn ảnh icon.'}, status=status.HTTP_400_BAD_REQUEST)
		if not str(image.content_type).startswith('image/'):
			return Response({'detail': 'File tải lên phải là ảnh.'}, status=status.HTTP_400_BAD_REQUEST)
		try:
			optimized_image = _optimize_reaction_image(image)
		except ValueError as exc:
			return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
		path = default_storage.save(f'chat/reactions/{optimized_image.name}', optimized_image)
		asset_url = request.build_absolute_uri(default_storage.url(path))
		code = str(request.data.get('code') or 'Custom reaction')[:50]
		reaction = ReactionType.objects.create(
			type=ReactionType.Type.STICKER,
			code=code,
			asset_url=asset_url,
			is_active=True,
			sort_order=int(request.data.get('sort_order') or 100),
			created_by=chat_user,
		)
		return Response(ReactionTypeSerializer(reaction).data, status=status.HTTP_201_CREATED)


class ReactionTypeDetailView(APIView):
	permission_classes = [IsAuthenticated]

	def patch(self, request, reaction_type_id):
		if not _can_moderate_messages(request.user):
			return Response({'detail': 'Chỉ Admin hoặc HR được quản lý reaction.'}, status=status.HTTP_403_FORBIDDEN)
		reaction = get_object_or_404(ReactionType, id=reaction_type_id)
		if 'is_active' in request.data:
			reaction.is_active = str(request.data['is_active']).lower() in ('true', '1')
		if 'sort_order' in request.data:
			reaction.sort_order = max(0, int(request.data['sort_order']))
		if 'code' in request.data:
			reaction.code = str(request.data['code'])[:50]
		reaction.save(update_fields=['is_active', 'sort_order', 'code'])
		return Response(ReactionTypeSerializer(reaction).data)

	def delete(self, request, reaction_type_id):
		if not _can_moderate_messages(request.user):
			return Response({'detail': 'Chỉ Admin hoặc HR được quản lý reaction.'}, status=status.HTTP_403_FORBIDDEN)
		reaction = get_object_or_404(ReactionType, id=reaction_type_id)
		reaction.is_active = False
		reaction.save(update_fields=['is_active'])
		return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationPollView(APIView):
	permission_classes = [IsAuthenticated]

	def get(self, request):
		chat_user = _ensure_chat_user(request.user)
		since_id = int(request.query_params.get('since_id', 0))
		notifications = ChatNotification.objects.filter(user=chat_user, id__gt=since_id).order_by('id')[:200]
		payload = ChatNotificationSerializer(notifications, many=True).data
		latest_id = payload[-1]['id'] if payload else since_id
		return Response({'results': payload, 'latest_id': latest_id}, status=status.HTTP_200_OK)


def _authenticate_sse_request(request):
	jwt_auth = JWTAuthentication()
	token = request.GET.get('token')
	if token:
		try:
			validated = jwt_auth.get_validated_token(token)
			return jwt_auth.get_user(validated)
		except Exception:
			return AnonymousUser()

	auth_result = jwt_auth.authenticate(request)
	if not auth_result:
		return AnonymousUser()
	return auth_result[0]


class ChatEventsSSEView(View):
	def get(self, request):
		user = _authenticate_sse_request(request)
		if not user or not user.is_authenticated:
			return JsonResponse({'detail': 'Unauthorized'}, status=401)

		chat_user = _ensure_chat_user(user)
		try:
			last_event_id = int(request.headers.get('Last-Event-ID') or request.GET.get('last_event_id') or 0)
		except ValueError:
			last_event_id = 0

		def stream():
			current_last_id = last_event_id
			while True:
				events = list(
					ChatNotification.objects.filter(user=chat_user, id__gt=current_last_id)
					.order_by('id')[:100]
				)

				if events:
					for event in events:
						current_last_id = event.id
						payload = {
							'id': event.id,
							'type': event.type,
							'entity_id': event.entity_id,
							'created_at': event.created_at.isoformat(),
							'should_poll_messages': event.type == ChatNotification.Type.MESSAGE,
						}
						yield f"id: {event.id}\n"
						yield 'event: notification\n'
						yield f"data: {json.dumps(payload)}\n\n"
				else:
					heartbeat = {'ts': timezone.now().isoformat(), 'type': 'heartbeat'}
					yield 'event: heartbeat\n'
					yield f"data: {json.dumps(heartbeat)}\n\n"

				time.sleep(2)

		response = StreamingHttpResponse(stream(), content_type='text/event-stream')
		response['Cache-Control'] = 'no-cache'
		response['X-Accel-Buffering'] = 'no'
		response['Connection'] = 'keep-alive'
		return response
