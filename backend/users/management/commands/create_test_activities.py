# CRM management command removed - test activities were for CRM features
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'CRM command removed'

    def handle(self, *args, **options):
        self.stdout.write('This command has been removed (CRM features removed).')
