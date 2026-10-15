from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from employee.models import Employee

from .models import ChatUser, Conversation, ConversationMember, Organization, UsernameHistory


def add_user_to_public_channels(auth_user_id):
    User = get_user_model()
    auth_user = User.objects.filter(id=auth_user_id, is_active=True).first()
    if not auth_user:
        return

    org, _ = Organization.objects.get_or_create(name='Default Organization')
    employee = getattr(auth_user, 'employee', None)
    display_name = (employee.full_name if employee else '') or auth_user.get_full_name() or auth_user.username

    chat_user = ChatUser.objects.filter(auth_user=auth_user).first()
    if chat_user is None:
        # Reuse legacy chat profiles that were created before auth_user was linked.
        chat_user = ChatUser.objects.filter(username=auth_user.username, auth_user__isnull=True).first()
        if chat_user:
            chat_user.auth_user = auth_user
            chat_user.org = org
            chat_user.display_name = display_name
            chat_user.email = auth_user.email or ''
            chat_user.status = ChatUser.Status.ACTIVE
            chat_user.save(update_fields=['auth_user', 'org', 'display_name', 'email', 'status'])
        else:
            chat_user = ChatUser.objects.create(
                auth_user=auth_user,
                org=org,
                username=auth_user.username,
                display_name=display_name,
                email=auth_user.email or '',
                status=ChatUser.Status.ACTIVE,
            )
            UsernameHistory.objects.create(user=chat_user, username=chat_user.username)

    public_channels = Conversation.objects.filter(
        org=chat_user.org,
        type=Conversation.Type.PUBLIC,
        archived_at__isnull=True,
    )
    for channel in public_channels:
        membership, created = ConversationMember.objects.get_or_create(
            conversation=channel,
            user=chat_user,
            defaults={'role': ConversationMember.Role.MEMBER},
        )
        if not created and membership.left_at is not None:
            membership.left_at = None
            membership.save(update_fields=['left_at'])


@receiver(post_save, sender=get_user_model(), dispatch_uid='chat_add_user_to_public_channels')
def sync_new_user_to_public_channels(sender, instance, **kwargs):
    if instance.is_active:
        # Onboarding may create/update related records in the same transaction.
        transaction.on_commit(lambda: add_user_to_public_channels(instance.id))


@receiver(post_save, sender=Employee, dispatch_uid='chat_add_new_employee_to_public_channels')
def sync_new_employee_to_public_channels(sender, instance, created, **kwargs):
    """Onboarding hook: add a newly-created employee to every public channel."""
    if created and instance.user_id and instance.user.is_active:
        transaction.on_commit(lambda: add_user_to_public_channels(instance.user_id))
