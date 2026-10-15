"""
Management command to audit and clean up unsafe notifications
"""
from django.core.management.base import BaseCommand
from users.models import Notification
from django.utils import timezone


class Command(BaseCommand):
    help = 'Audit notifications for safety issues and clean up problematic ones'

    def add_arguments(self, parser):
        parser.add_argument(
            '--fix',
            action='store_true',
            help='Actually fix/cancel unsafe notifications (dry-run by default)',
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('=== Notification Safety Audit ==='))
        
        # Check all pending/scheduled notifications
        pending_notifications = Notification.objects.filter(
            status__in=['pending', 'scheduled'],
            sent_at__isnull=True,
            failed_at__isnull=True,
            is_cancelled=False
        )
        
        unsafe_count = 0
        no_target_count = 0
        no_schedule_count = 0
        safe_count = 0
        
        for notification in pending_notifications:
            issues = []
            
            # Check 1: Must have target external_ids
            external_ids = notification.get_target_external_ids()
            if not external_ids:
                issues.append("No target external_ids")
                no_target_count += 1
                
            # Check 2: Must be scheduled (not immediate)
            if not notification.scheduled_time or notification.scheduled_time <= timezone.now():
                issues.append("Not properly scheduled for future")
                no_schedule_count += 1
                
            if issues:
                unsafe_count += 1
                self.stdout.write(
                    self.style.ERROR(f"🚫 UNSAFE: Notification {notification.id} - {', '.join(issues)}")
                )
                
                if options['fix']:
                    notification.is_cancelled = True
                    notification.error_message = f"Cancelled for safety: {', '.join(issues)}"
                    notification.save()
                    self.stdout.write(f"   ✅ Cancelled notification {notification.id}")
            else:
                safe_count += 1
                self.stdout.write(
                    self.style.SUCCESS(f"✅ SAFE: Notification {notification.id} -> {len(external_ids)} users at {notification.scheduled_time}")
                )
        
        # Summary
        self.stdout.write(self.style.SUCCESS(f'\n=== Summary ==='))
        self.stdout.write(f"Total pending notifications: {pending_notifications.count()}")
        self.stdout.write(self.style.SUCCESS(f"✅ Safe notifications: {safe_count}"))
        self.stdout.write(self.style.ERROR(f"🚫 Unsafe notifications: {unsafe_count}"))
        self.stdout.write(f"   - Missing targets: {no_target_count}")
        self.stdout.write(f"   - Not scheduled: {no_schedule_count}")
        
        if unsafe_count > 0 and not options['fix']:
            self.stdout.write(self.style.WARNING(f'\n⚠️  Run with --fix to cancel unsafe notifications'))
        elif unsafe_count > 0 and options['fix']:
            self.stdout.write(self.style.SUCCESS(f'\n✅ Fixed {unsafe_count} unsafe notifications'))
        else:
            self.stdout.write(self.style.SUCCESS(f'\n🎉 All notifications are SAFE!'))