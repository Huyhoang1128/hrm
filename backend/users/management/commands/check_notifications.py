"""
Management command to check OneSignal notification status
"""
from django.core.management.base import BaseCommand
from django.conf import settings
from users.onesignal_service import check_notification_status, test_onesignal_integration


class Command(BaseCommand):
    help = 'Check OneSignal notification configuration and status'

    def add_arguments(self, parser):
        parser.add_argument(
            '--test',
            action='store_true',
            help='Send a test notification (only works if notifications are enabled)',
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('=== OneSignal Configuration ==='))
        
        # Check status
        status = check_notification_status()
        
        if status['onesignal_configured']:
            self.stdout.write(self.style.SUCCESS(f"✅ {status['message']}"))
        else:
            self.stdout.write(self.style.ERROR(f"❌ {status['message']}"))
        
        self.stdout.write(f"Debug Mode: {status['debug_mode']}")
        self.stdout.write(f"App ID: {status['app_id']}")
        self.stdout.write(f"API Key: {'✅ Configured' if settings.ONESIGNAL_REST_API_KEY else '❌ Missing'}")
        
        # Test notification if requested
        if options['test']:
            if status['onesignal_configured']:
                self.stdout.write(self.style.SUCCESS('\n=== Testing Notification ==='))
                result = test_onesignal_integration()
                if result['success']:
                    self.stdout.write(self.style.SUCCESS(f"✅ Test notification sent! ID: {result.get('notification_id')}"))
                else:
                    self.stdout.write(self.style.ERROR(f"❌ Test failed: {result.get('error')}"))
            else:
                self.stdout.write(self.style.ERROR('❌ Cannot send test - OneSignal not configured'))
                
        # Instructions
        self.stdout.write(self.style.SUCCESS('\n=== Safety Features ==='))
        self.stdout.write('✅ Only scheduled notifications (no immediate sends)')
        self.stdout.write('✅ Must have specific external_ids (no mass notifications)')
        self.stdout.write('✅ Automatic validation of user IDs')
        self.stdout.write('\n💡 Use Notification model with proper external_id targeting for safe notifications')