from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


class HospitalAddress(models.Model):
    """Hospital address model for storing hospital locations"""
    
    name = models.CharField(max_length=200, help_text="Tên bệnh viện")
    address = models.TextField(help_text="Địa chỉ cụ thể")
    city = models.CharField(max_length=100, help_text="Thành phố")
    district = models.CharField(max_length=100, help_text="Quận/Huyện")
    phone_number = models.CharField(max_length=20, blank=True, help_text="Số điện thoại bệnh viện")
    email = models.EmailField(blank=True, help_text="Email bệnh viện")
    website = models.URLField(blank=True, help_text="Website bệnh viện")
    
    # Additional information
    description = models.TextField(blank=True, help_text="Mô tả về bệnh viện")
    is_active = models.BooleanField(default=True, help_text="Bệnh viện có đang hoạt động không")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True, help_text="Thời gian xóa (soft delete)")
    
    class Meta:
        ordering = ['name']
        verbose_name = 'Hospital Address'
        verbose_name_plural = 'Hospital Addresses'
    
    def __str__(self):
        return f"{self.name} - {self.city}"


# ============================================================================
# NOTIFICATION SYSTEM MODELS
# ============================================================================

class NotificationTemplate(models.Model):
    """Template cho notification content với placeholder support"""
    
    NOTIFICATION_TYPES = [
        ('reminder_1hour', '1 Hour Reminder'),
        ('reminder_30min', '30 Minute Reminder'),
        ('reminder_5min', '5 Minute Reminder'),
        ('activity_overdue', 'Activity Overdue'),
        ('approval_needed', 'Approval Needed'),
        ('approved', 'Activity Approved'),
        ('rejected', 'Activity Rejected'),
        ('system_announcement', 'System Announcement'),
        ('emergency_alert', 'Emergency Alert'),
        ('welcome', 'Welcome Message'),
        ('journey_start', 'Journey Started'),
        ('activity_completed', 'Activity Completed'),
        ('milestone_reached', 'Milestone Reached'),
    ]
    
    PRIORITY_CHOICES = [
        ('high', 'High'),
        ('normal', 'Normal'),
        ('low', 'Low'),
    ]
    
    # Unique key để identify template
    template_key = models.CharField(
        max_length=100, 
        unique=True,
        help_text="VD: 'medication_reminder_1hour', 'photo_upload_overdue'"
    )
    
    # Template content với placeholders
    title_template = models.CharField(
        max_length=500,
        help_text="VD: '💊 Nhắc nhở uống thuốc {medication_name}'"
    )
    
    content_template = models.TextField(
        help_text="VD: 'Xin chào {customer_name}! Đừng quên uống {medication_name} - {dosage} trong {time_remaining}.'"
    )
    
    # Categorization
    notification_type = models.CharField(
        max_length=50, 
        choices=NOTIFICATION_TYPES,
        help_text="Loại notification"
    )
    
    # Default settings
    default_priority = models.CharField(
        max_length=10, 
        choices=PRIORITY_CHOICES,
        default='normal'
    )
    
    default_ttl = models.IntegerField(
        null=True, blank=True,
        help_text="Default Time To Live (seconds) cho OneSignal"
    )
    
    # Launch URL Template
    launch_url_template = models.CharField(
        max_length=500,
        blank=True,
        help_text="Launch URL template với placeholders: hrm://tabs/today/{activity_id}?type={activity_type}&context={context}"
    )
    # Multi-language support
    language_code = models.CharField(
        max_length=10, 
        default='vi',
        help_text="Language code: vi, en, etc."
    )
    
    # Active/inactive
    is_active = models.BooleanField(
        default=True,
        help_text="Template có đang được sử dụng không"
    )
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, 
        on_delete=models.SET_NULL, 
        null=True, blank=True,
        help_text="User tạo template này"
    )
    
    class Meta:
        unique_together = ['template_key', 'language_code']
        ordering = ['notification_type', 'template_key']
        verbose_name = 'Notification Template'
        verbose_name_plural = 'Notification Templates'
    
    def __str__(self):
        return f"{self.template_key} ({self.language_code})"
    
    def render(self, context):
        """Render template với context data bao gồm launch URLs"""
        try:
            title = self.title_template.format(**context)
            content = self.content_template.format(**context)
            
            # Render launch URL if template exists
            launch_url = None

            if self.launch_url_template:
                launch_url = self.launch_url_template.format(**context)

            return {
                'title': title,
                'content': content,
                'launch_url': launch_url,
                'success': True
            }
        except KeyError as e:
            return {
                'title': self.title_template,
                'content': self.content_template,
                'launch_url': None,
                'error': f"Missing context key: {e}",
                'success': False
            }


class NotificationPreferences(models.Model):
    """User preferences cho notifications"""
    
    NOTIFICATION_TYPES = [
        ('reminder_1hour', '1 Hour Reminder'),
        ('reminder_30min', '30 Minute Reminder'), 
        ('reminder_5min', '5 Minute Reminder'),
        ('activity_overdue', 'Activity Overdue'),
        ('approval_needed', 'Approval Needed'),
        ('system_announcement', 'System Announcement'),
    ]
    
    PROVIDER_CHOICES = [
        ('onesignal', 'OneSignal'),
        ('email', 'Email'),
        ('sms', 'SMS'),
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notification_preferences')
    notification_type = models.CharField(max_length=50, choices=NOTIFICATION_TYPES)
    
    # Preferences
    is_enabled = models.BooleanField(default=True)
    preferred_time_offset = models.IntegerField(
        default=0,
        help_text="Minutes before/after default time"
    )
    preferred_provider = models.CharField(
        max_length=20, 
        choices=PROVIDER_CHOICES,
        default='onesignal'
    )
    
    # Quiet hours
    quiet_hours_start = models.TimeField(
        null=True, blank=True,
        help_text="Start of quiet hours (e.g., 22:00)"
    )
    quiet_hours_end = models.TimeField(
        null=True, blank=True,
        help_text="End of quiet hours (e.g., 07:00)"
    )
    
    # Timezone
    timezone = models.CharField(
        max_length=50,
        default='Asia/Ho_Chi_Minh',
        help_text="User timezone"
    )
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        unique_together = ['user', 'notification_type']
        verbose_name = 'Notification Preference'
        verbose_name_plural = 'Notification Preferences'
    
    def __str__(self):
        return f"{self.user.get_full_name()} - {self.notification_type}"


class Notification(models.Model):
    """Main notification model với simplified design"""
    
    NOTIFICATION_TYPES = [
        ('reminder_1hour', '1 Hour Reminder'),
        ('reminder_30min', '30 Minute Reminder'),
        ('reminder_5min', '5 Minute Reminder'),
        ('activity_overdue', 'Activity Overdue'),
        ('approval_needed', 'Approval Needed'),
        ('approved', 'Activity Approved'),
        ('rejected', 'Activity Rejected'),
        ('system_announcement', 'System Announcement'),
        ('emergency_alert', 'Emergency Alert'),
        ('welcome', 'Welcome Message'),
        ('journey_start', 'Journey Started'),
        ('activity_completed', 'Activity Completed'),
        ('milestone_reached', 'Milestone Reached'),
    ]
    
    STATUS_CHOICES = [
        ('scheduled', 'Scheduled'),
        ('sent', 'Sent'),
        ('failed', 'Failed'),
        ('cancelled', 'Cancelled'),
        ('expired', 'Expired'),
    ]
    
    PROVIDER_CHOICES = [
        ('onesignal', 'OneSignal'),
        ('email', 'Email'),
        ('sms', 'SMS'),
    ]
    
    PRIORITY_CHOICES = [
        ('high', 'High'),
        ('normal', 'Normal'), 
        ('low', 'Low'),
    ]
    
    # SIMPLE APPROACH - Store reference info in data field, no FK constraints
    # Business logic sẽ handle relationships trong code, không cần DB constraints
    
    # Optional template link
    template = models.ForeignKey(
        'NotificationTemplate',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='notifications'
    )
    
    # Link to a specific user (optional) - useful for per-user inbox
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='notifications',
        help_text="Optional direct link to a user for fast lookup"
    )

    # Read and send status flags
    is_read = models.BooleanField(default=False, help_text="Whether the user has read the notification")
    is_send = models.BooleanField(default=False, help_text="Whether the notification has been sent")
    
    # Reference to a related activity (optional)
    activity_id = models.IntegerField(null=True, blank=True, help_text="Optional related DailyCareActivity id")
    
    # Content
    title = models.CharField(max_length=200)
    content = models.TextField()
    notification_type = models.CharField(max_length=50, choices=NOTIFICATION_TYPES)
    
    # Timing & Expiration
    scheduled_time = models.TimeField(null=True, blank=True, help_text="Giờ thực hiện dự kiến")
    scheduled_date = models.DateField(help_text="Khi nào gửi notification", null=True, blank=True)
    sent_time = models.DateTimeField(null=True, blank=True, help_text="Khi đã gửi thực tế")
    expired_time = models.DateTimeField(help_text="Thời gian hết hạn (mặc định scheduled_time + 24h)", null=True)
    
    # Status & Tracking
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='scheduled', null=True)
    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES, default='onesignal', null=True)
    provider_message_id = models.CharField(max_length=100, blank=True, null=True)
    error_message = models.TextField(blank=True, null=True)
    retry_count = models.IntegerField(default=0)
    max_retry_count = models.IntegerField(default=3)
    
    
    # Advanced Settings
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='normal', null=True, blank=True)
    time_to_live = models.IntegerField(null=True, blank=True, help_text="TTL in seconds for OneSignal")
    collapse_key = models.CharField(max_length=100, blank=True, null=True, help_text="OneSignal collapse_id for grouping")
    
    # Targeting & Recipients  
    target_user_ids = models.JSONField(default=list, null=True, blank=True, help_text="List of specific user IDs")
    target_external_ids = models.JSONField(default=list, null=True, blank=True, help_text="List of OneSignal external_ids")
    target_segments = models.JSONField(default=list, null=True, blank=True, help_text="OneSignal segments ['All', 'Customers']")
    target_tags = models.JSONField(default=dict, null=True, blank=True, help_text="OneSignal tags {'surgery_type': 'nang_nguc'}")
    target_care_team = models.BooleanField(default=False, help_text="Target entire care team")
    
    # Business Context
    related_surgery_id = models.IntegerField(null=True, blank=True, help_text="Link to specific surgery")
    related_hospital_id = models.IntegerField(null=True, blank=True, help_text="Hospital/branch specific")
    related_doctor_id = models.IntegerField(null=True, blank=True, help_text="Doctor specific")
    
    # User Interaction Tracking
    opened_at = models.DateTimeField(null=True, blank=True)
    dismissed_at = models.DateTimeField(null=True, blank=True) 
    clicked_at = models.DateTimeField(null=True, blank=True)
    
    # Extra Data & Launch URLs
    data = models.JSONField(
        default=dict, 
        blank=True, 
        null=True,
        help_text="Extra data including launch_url, activity_type, customer_id, etc."
    )
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, null=True)
    
    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Notification'
        verbose_name_plural = 'Notifications'
        indexes = [
            models.Index(fields=['scheduled_time']),
            models.Index(fields=['expired_time']),
            models.Index(fields=['status']),
            models.Index(fields=['provider']),
            # Critical index for 5-minute polling performance
            models.Index(
                fields=['status', 'scheduled_time', 'sent_time', 'expired_time'],
                name='notifications_polling_idx',
                condition=models.Q(status='scheduled', sent_time__isnull=True)
            ),
        ]
    
    def __str__(self):
        # Use source info from data field instead of FK
        source_info = self.get_source_info()
        source_name = f"{source_info['type']}_{source_info['id']}" if source_info else 'System'
        return f"{source_name} - {self.notification_type} - {self.status}"
    
 
    @property
    def is_expired(self):
        """Check if notification has expired"""
        if self.expired_time is not None:
            return timezone.now() > self.expired_time
        else:
            return False
    
    @property 
    def can_retry(self):
        """Check if notification can be retried"""
        return self.retry_count < self.max_retry_count and not self.is_expired
    
    def mark_expired(self):
        """Mark notification as expired"""
        self.status = 'expired'
        self.save()
    
    def increment_retry(self):
        """Increment retry count"""
        self.retry_count += 1
        self.save()
    
    def get_source_info(self):
        """Get source information from data field"""
        if not self.data:
            return None
            
        # Extract source info from stored data
        source_type = self.data.get('source_type')  # 'activity', 'appointment', 'surgery'
        source_id = self.data.get('source_id')
        
        return {'type': source_type, 'id': source_id} if source_type and source_id else None
    
    def get_related_customer(self):
        """Get customer from stored source info. CRM models have been removed."""
        return None
    
    def get_related_context(self):
        """Get context information using if/else logic, no DB relationships needed"""
        # Get basic customer info
        customer = self.get_related_customer()
        if not customer:
            return {'customer_name': 'Khách hàng'}
            
        # Use data stored in notification record
        return self.data or {}
    
    def get_target_external_ids(self):
        """Generate OneSignal external_ids based on targeting settings"""
        external_ids = []
        
        # Direct external_ids
        if self.target_external_ids:
            external_ids.extend(self.target_external_ids)
            
        # Convert user_ids to external_ids (simple format)
        if self.target_user_ids:
            external_ids.extend([str(uid) for uid in self.target_user_ids])
                
        return list(set(external_ids))  # Remove duplicates
    
    def get_onesignal_payload(self):
        """Generate OneSignal API payload"""
        from django.conf import settings
        
        payload = {
            "app_id": settings.ONESIGNAL_APP_ID,
            "headings": {"en": self.title},
            "contents": {"en": self.content},
            "target_channel": "push",  # Required when using external user IDs
            "data": {
                "notification_id": self.id,
                "notification_type": self.notification_type,
                # Include source info from data field
                **{k: v for k, v in (self.data or {}).items() if k in ['source_type', 'source_id', 'customer_id']}
            }
        }
        
        # Targeting - MUST have at least one targeting method
        external_ids = self.get_target_external_ids()
        has_targeting = False
        
        if external_ids:
            # Use OneSignal API format for external user IDs (consistent with service)
            payload["include_external_user_ids"] = external_ids
            payload["channel_for_external_user_ids"] = "push"
            has_targeting = True
            
        if self.target_segments:
            payload["included_segments"] = self.target_segments
            has_targeting = True
            
        if self.target_tags:
            payload["filters"] = [{"field": "tag", "key": k, "relation": "=", "value": v} 
                                 for k, v in self.target_tags.items()]
            has_targeting = True
        
        # SAFETY CHECK: Refuse to send if no specific targeting
        if not has_targeting:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"🚫 REFUSING to send notification {self.id} - no targeting specified! This prevents mass notifications.")
            # Return empty payload to prevent sending
            return None
            
        # SAFETY CHECK: Must have external_ids for scheduled notifications
        if not external_ids:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"🚫 REFUSING to send notification {self.id} - no external_ids specified!")
            return None
        
        # Advanced settings
        if self.time_to_live:
            payload["ttl"] = self.time_to_live
        if self.collapse_key:
            payload["collapse_id"] = self.collapse_key
        if self.priority == 'high':
            payload["priority"] = 10
            
        # Launch URL support
        if self.data and self.data.get('launch_url'):
            # Primary method: Use 'url' for Launch URL (opens app or fallback to browser)
            payload["url"] = self.data['launch_url']
            
            # Secondary method: Include in data for programmatic handling
            payload["data"]["launch_url"] = self.data['launch_url']
            
            # Mobile app specific URLs (if different from web)
            if self.data.get('app_url'):
                payload["app_url"] = self.data['app_url']  # Deep link URL for mobile apps
            
        return payload
