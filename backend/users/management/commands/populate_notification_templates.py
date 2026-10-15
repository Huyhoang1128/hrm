"""
Management command to populate notification templates.
"""
from django.core.management.base import BaseCommand
from users.models import NotificationTemplate


class Command(BaseCommand):
    help = 'Populate basic notification templates'

    def handle(self, *args, **options):
        self.stdout.write('🔄 Creating basic notification templates...')
        
        templates = [
            {
                'template_key': 'medication_reminder_1hour',
                'title_template': '💊 Nhắc nhở uống thuốc',
                'content_template': 'Xin chào {customer_name}! Còn 1 giờ nữa đến lúc uống thuốc. Hãy chuẩn bị sẵn nhé! 🕐',
                'notification_type': 'reminder_1hour',
                'default_priority': 'normal',
                'default_ttl': 3600,
                'language_code': 'vi',
                'is_active': True
            },
            {
                'template_key': 'medication_reminder_30min',
                'title_template': '💊 Đến giờ uống thuốc!',
                'content_template': 'Xin chào {customer_name}! Còn 30 phút nữa đến lúc uống thuốc. Đừng quên nhé! ⏰',
                'notification_type': 'reminder_30min',
                'default_priority': 'high',
                'default_ttl': 1800,
                'language_code': 'vi',
                'is_active': True
            },
            {
                'template_key': 'activity_approved',
                'title_template': '✅ Hoạt động được duyệt',
                'content_template': 'Chúc mừng {customer_name}! Hoạt động của bạn đã được duyệt. 🎉',
                'notification_type': 'approved',
                'default_priority': 'normal',
                'default_ttl': 86400,
                'language_code': 'vi',
                'is_active': True
            },
            {
                'template_key': 'activity_overdue',
                'title_template': '⏰ Hoạt động quá hạn',
                'content_template': 'Xin chào {customer_name}! Bạn có hoạt động đã quá hạn. Vui lòng hoàn thành sớm! ⚠️',
                'notification_type': 'activity_overdue',
                'default_priority': 'high',
                'default_ttl': 86400,
                'language_code': 'vi',
                'is_active': True
            },
            {
                'template_key': 'welcome_message',
                'title_template': '🎉 Chào mừng đến với HRM!',
                'content_template': 'Xin chào {customer_name}! Chào mừng bạn đến với HRM. 💪',
                'notification_type': 'welcome',
                'default_priority': 'low',
                'default_ttl': 604800,
                'language_code': 'vi',
                'is_active': True
            }
        ]
        
        created_count = 0
        for template_data in templates:
            template, created = NotificationTemplate.objects.get_or_create(
                template_key=template_data['template_key'],
                language_code=template_data['language_code'],
                defaults=template_data
            )
            if created:
                created_count += 1
                self.stdout.write(f"✅ Created: {template_data['template_key']}")
            else:
                self.stdout.write(f"⏭️ Exists: {template_data['template_key']}")
        
        self.stdout.write(
            self.style.SUCCESS(f'✅ Created {created_count} templates!')
        )