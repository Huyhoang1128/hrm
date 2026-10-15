"""
Notification processing functions.
CRM-specific notification functions have been removed.
These functions remain for HRM notification support.
"""
from django.utils import timezone
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)


def send_notification_via_onesignal(notification_id: int):
    """
    Send individual notification via OneSignal.
    """
    try:
        from .models import Notification
        import requests
        from django.conf import settings

        notification = Notification.objects.get(id=notification_id)

        if notification.status != 'scheduled':
            logger.warning(f"Notification {notification_id} status is {notification.status}, skipping")
            return False

        actual_external_ids = notification.get_target_external_ids()
        if not actual_external_ids:
            logger.error(f"Notification {notification_id} has no target external_ids! Refusing to send.")
            notification.status = 'failed'
            notification.error_message = 'No target external_ids specified'
            notification.save()
            return False

        payload = notification.get_onesignal_payload()
        if not payload:
            logger.error(f"Notification {notification_id} payload is empty, refusing to send.")
            notification.status = 'failed'
            notification.error_message = 'Empty payload'
            notification.save()
            return False

        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Basic {settings.ONESIGNAL_REST_API_KEY}',
        }
        response = requests.post(
            'https://onesignal.com/api/v1/notifications',
            json=payload,
            headers=headers,
            timeout=30
        )

        if response.status_code == 200:
            response_data = response.json()
            notification.status = 'sent'
            notification.sent_time = timezone.now()
            notification.provider_message_id = response_data.get('id', '')
            notification.save()
            return True
        else:
            notification.status = 'failed'
            notification.error_message = f"HTTP {response.status_code}: {response.text}"
            notification.retry_count += 1
            notification.save()
            return False

    except Exception as e:
        logger.error(f"Error sending notification {notification_id}: {str(e)}", exc_info=True)
        return False


def process_scheduled_notifications():
    """
    Process all scheduled notifications that are due.
    """
    from .models import Notification

    now = timezone.now()
    due_notifications = Notification.objects.filter(
        status='scheduled',
        sent_time__isnull=True,
    ).filter(
        scheduled_date__lte=now.date(),
    )

    sent_count = 0
    for notification in due_notifications:
        if send_notification_via_onesignal(notification.id):
            sent_count += 1

    logger.info(f"Processed {due_notifications.count()} notifications, sent {sent_count}")
    return sent_count
