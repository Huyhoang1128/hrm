import time
import logging
from django.core.management.base import BaseCommand
from django.utils import timezone
from django.db import transaction
from hrm.models import EmailQueue, EmailBatch
from hrm.serializers import send_account_info_email

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = 'Process pending emails from the queue'

    def add_arguments(self, parser):
        parser.add_argument(
            '--batch-size',
            type=int,
            default=10,
            help='Number of emails to process in one run (default: 10)'
        )
        parser.add_argument(
            '--delay',
            type=float,
            default=2.0,
            help='Delay between emails in seconds (default: 2.0)'
        )

    def handle(self, *args, **options):
        batch_size = options['batch_size']
        delay = options['delay']
        
        self.stdout.write(self.style.SUCCESS(f'Starting email queue processor (batch_size={batch_size}, delay={delay}s)'))
        
        # Lấy các email PENDING, sắp xếp theo thời gian tạo
        pending_emails = EmailQueue.objects.filter(
            status='PENDING'
        ).select_related('employee', 'employee__user').order_by('created_at')[:batch_size]
        
        if not pending_emails.exists():
            self.stdout.write(self.style.WARNING('No pending emails in queue'))
            return
        
        total_emails = pending_emails.count()
        self.stdout.write(self.style.SUCCESS(f'Found {total_emails} pending emails'))
        
        success_count = 0
        failed_count = 0
        
        for email_queue in pending_emails:
            try:
                # Đánh dấu đang xử lý
                with transaction.atomic():
                    email_queue.status = 'PROCESSING'
                    email_queue.save(update_fields=['status'])
                
                # Gửi email
                employee = email_queue.employee
                if email_queue.email_type == 'PAYSLIP':
                    from hrm.utils import send_email_via_gmail
                    result = send_email_via_gmail(
                        to=email_queue.recipient_email,
                        subject=email_queue.email_subject or '',
                        body=email_queue.email_plain_body or '',
                        html_body=email_queue.email_html_body or '',
                    )
                else:
                    result = send_account_info_email(
                        employee.user,
                        employee,
                        new_password=email_queue.new_password,
                    )
                
                if result:
                    # Thành công
                    with transaction.atomic():
                        email_queue.status = 'SENT'
                        email_queue.processed_at = timezone.now()
                        email_queue.save(update_fields=['status', 'processed_at'])
                    
                    success_count += 1
                    self.stdout.write(self.style.SUCCESS(f'✅ Sent to {email_queue.recipient_email}'))
                else:
                    # Thất bại nhưng chưa hết retry
                    self._handle_failure(email_queue, 'Email sending returned False')
                    failed_count += 1
                
            except Exception as e:
                # Lỗi exception
                error_msg = str(e)
                self._handle_failure(email_queue, error_msg)
                failed_count += 1
                self.stdout.write(self.style.ERROR(f'❌ Failed to send to {email_queue.recipient_email}: {error_msg}'))
            
            # Delay giữa mỗi email để tránh rate limit
            if delay > 0:
                time.sleep(delay)
        
        # Cập nhật batch status
        self._update_batch_status()
        
        self.stdout.write(self.style.SUCCESS(
            f'Completed: {success_count} sent, {failed_count} failed out of {total_emails} emails'
        ))
    
    def _handle_failure(self, email_queue, error_msg):
        """Xử lý khi email thất bại"""
        with transaction.atomic():
            email_queue.retry_count += 1
            email_queue.error_message = error_msg
            
            if email_queue.retry_count >= email_queue.max_retries:
                # Hết retry -> đánh dấu FAILED
                email_queue.status = 'FAILED'
                email_queue.processed_at = timezone.now()
                self.stdout.write(self.style.ERROR(f'⚠️  Max retries reached for {email_queue.recipient_email}'))
            else:
                # Còn retry -> đánh dấu PENDING để retry lần sau
                email_queue.status = 'PENDING'
                self.stdout.write(self.style.WARNING(
                    f'🔄 Retry {email_queue.retry_count}/{email_queue.max_retries} for {email_queue.recipient_email}'
                ))
            
            email_queue.save()
    
    def _update_batch_status(self):
        """Cập nhật status của tất cả các batch"""
        batches = EmailBatch.objects.filter(status__in=['PENDING', 'PROCESSING'])
        
        for batch in batches:
            batch_emails = EmailQueue.objects.filter(batch_id=batch.batch_id)
            
            sent_count = batch_emails.filter(status='SENT').count()
            failed_count = batch_emails.filter(status='FAILED').count()
            pending_count = batch_emails.filter(status='PENDING').count()
            processing_count = batch_emails.filter(status='PROCESSING').count()
            
            batch.sent_count = sent_count
            batch.failed_count = failed_count
            batch.pending_count = pending_count
            
            # Xác định status của batch
            if pending_count == 0 and processing_count == 0:
                if sent_count > 0:
                    batch.status = 'COMPLETED'
                elif failed_count > 0:
                    batch.status = 'FAILED'
                else:
                    batch.status = 'COMPLETED'
                if batch.completed_at is None:
                    batch.completed_at = timezone.now()
            else:
                batch.status = 'PROCESSING'
            
            batch.save()