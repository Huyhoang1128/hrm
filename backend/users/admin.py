from django.contrib import admin
from django.contrib.auth.models import User
from django.contrib.auth.admin import UserAdmin
from .models import (
    HospitalAddress, NotificationTemplate, NotificationPreferences, Notification
)


admin.site.register(HospitalAddress)
admin.site.register(NotificationTemplate)
admin.site.register(NotificationPreferences)
admin.site.register(Notification)
