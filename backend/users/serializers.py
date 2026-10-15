from rest_framework import serializers
from .models import Notification
from django.contrib.auth.models import User

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email']
        ref_name = "UsersUserSerializer"




class NotificationSerializer(serializers.ModelSerializer):
    """Serializer for Notification model"""
    
    notification_type_display = serializers.CharField(source='get_notification_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    
    class Meta:
        model = Notification
        fields = [
            'id', 'title', 'content', 'notification_type', 'notification_type_display',
            'status', 'status_display', 'priority', 'priority_display',
            'is_read', 'is_send', 'scheduled_date', 'scheduled_time', 'sent_time',
            'created_at', 'data'
        ]
        read_only_fields = ['created_at', 'sent_time']
