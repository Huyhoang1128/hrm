"""
Notification Service Module

This module provides services for managing notifications, templates, and preferences.
CRM-specific notification features (activity reminders, care team alerts) have been removed.
"""
import logging
from datetime import datetime
from django.utils import timezone
from typing import Dict, List, Optional, Any

from .models import (
    Notification, NotificationTemplate, NotificationPreferences,
)

logger = logging.getLogger(__name__)


class NotificationTemplateService:
    """Service to manage notification templates"""

    @classmethod
    def get_template(cls, template_key: str, language: str = 'vi') -> Optional[NotificationTemplate]:
        """Get template by key and language"""
        try:
            return NotificationTemplate.objects.get(
                template_key=template_key,
                language_code=language,
                is_active=True
            )
        except NotificationTemplate.DoesNotExist:
            if language != 'vi':
                return cls.get_template(template_key, 'vi')
            logger.warning(f"Template not found: {template_key}")
            return None

    @classmethod
    def render_notification(cls, template_key: str, context: Dict[str, Any], language: str = 'vi') -> Dict[str, Any]:
        """Render notification from template"""
        template = cls.get_template(template_key, language)
        if not template:
            return {
                'success': False,
                'error': f"Template not found: {template_key}"
            }
        return template.render(context)

    @classmethod
    def bulk_create_templates(cls, templates_data: List[Dict[str, Any]]) -> List[NotificationTemplate]:
        """Bulk create notification templates"""
        templates = []
        for template_data in templates_data:
            template, created = NotificationTemplate.objects.get_or_create(
                template_key=template_data['template_key'],
                language_code=template_data.get('language_code', 'vi'),
                defaults=template_data
            )
            if created:
                logger.info(f"Created template: {template.template_key}")
            templates.append(template)
        return templates


class NotificationService:
    """Service to manage notifications"""

    @classmethod
    def create_notification(
        cls,
        title: str,
        content: str,
        notification_type: str,
        target_user_ids: List[int] = None,
        target_external_ids: List[str] = None,
        scheduled_date=None,
        scheduled_time=None,
        priority: str = 'normal',
        data: Dict[str, Any] = None,
    ) -> Optional[Notification]:
        """Create a generic notification"""
        try:
            now = timezone.now()
            return Notification.objects.create(
                title=title,
                content=content,
                notification_type=notification_type,
                target_user_ids=target_user_ids or [],
                target_external_ids=target_external_ids or [],
                scheduled_date=scheduled_date or now.date(),
                scheduled_time=scheduled_time or now.time(),
                expired_time=now + timezone.timedelta(hours=24),
                priority=priority,
                data=data or {},
            )
        except Exception as e:
            logger.error(f"Failed to create notification: {e}", exc_info=True)
            return None


class NotificationPreferencesService:
    """Service to manage user notification preferences"""

    @classmethod
    def get_user_preferences(cls, user, notification_type: str) -> Optional[NotificationPreferences]:
        try:
            return NotificationPreferences.objects.get(
                user=user,
                notification_type=notification_type
            )
        except NotificationPreferences.DoesNotExist:
            return None

    @classmethod
    def is_notification_enabled(cls, user, notification_type: str) -> bool:
        prefs = cls.get_user_preferences(user, notification_type)
        return prefs.is_enabled if prefs else True

    @classmethod
    def get_preferred_time_offset(cls, user, notification_type: str) -> int:
        prefs = cls.get_user_preferences(user, notification_type)
        return prefs.preferred_time_offset if prefs else 0

    @classmethod
    def is_in_quiet_hours(cls, user, check_time: datetime) -> bool:
        prefs = NotificationPreferences.objects.filter(
            user=user,
            quiet_hours_start__isnull=False,
            quiet_hours_end__isnull=False
        ).first()

        if not prefs:
            return False

        current_time = check_time.time()
        start_time = prefs.quiet_hours_start
        end_time = prefs.quiet_hours_end

        if start_time > end_time:
            return current_time >= start_time or current_time <= end_time
        else:
            return start_time <= current_time <= end_time

    @classmethod
    def create_default_preferences(cls, user) -> List[NotificationPreferences]:
        """Create default notification preferences for new user"""
        default_types = [
            'reminder_1hour',
            'reminder_30min',
            'activity_overdue',
            'approval_needed',
        ]
        preferences = []
        for notification_type in default_types:
            pref, _ = NotificationPreferences.objects.get_or_create(
                user=user,
                notification_type=notification_type,
                defaults={
                    'is_enabled': True,
                    'preferred_provider': 'onesignal',
                }
            )
            preferences.append(pref)
        return preferences
