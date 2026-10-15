"""
OneSignal Push Notification Service

This module provides utilities for sending push notifications via OneSignal API.
"""
import logging
import requests
from datetime import datetime, timedelta
from django.conf import settings
from typing import Dict, List, Optional, Union

logger = logging.getLogger(__name__)


class OneSignalService:
    """Service class for OneSignal push notifications."""
    
    def __init__(self):
        self.app_id = settings.ONESIGNAL_APP_ID
        self.rest_api_key = settings.ONESIGNAL_REST_API_KEY
        self.api_url = settings.ONESIGNAL_API_URL
        
        if not self.rest_api_key:
            logger.warning("OneSignal REST API key not configured. Set ONESIGNAL_REST_API_KEY environment variable.")
    
    def send_notification(
        self,
        message: str,
        heading: str = "HRM Reminder",
        external_user_ids: Optional[List[str]] = None,
        segments: Optional[List[str]] = None,
        data: Optional[Dict] = None,
        scheduled_time: Optional[datetime] = None
        ,
        url: Optional[str] = None,
    ) -> Dict:
        """
        Send push notification via OneSignal API.
        
        Args:
            message: Notification content
            heading: Notification title/heading
            external_user_ids: List of OneSignal external user IDs to target
            segments: List of segments to target (e.g., ['All'] for all users)
            data: Additional data to send with notification
            scheduled_time: When to send notification (UTC datetime)
            url: Optional top-level launch URL to include in the OneSignal payload
        
        Returns:
            Dict with API response or error information
        """
        if not self.rest_api_key:
            return {"success": False, "error": "OneSignal REST API key not configured"}
        
        # Build notification payload
        payload = {
            "app_id": self.app_id,
            "headings": {"en": heading},
            "contents": {"en": message},
        }
        
        # Add targeting - DO NOT default to "All" to prevent mass notifications
        # We only support targeting by external user IDs (system user identifiers)
        if external_user_ids:
            # Use OneSignal API field for external user ids and set channel
            payload["include_external_user_ids"] = external_user_ids
            # Explicitly request push channel for external_user_ids
            payload["channel_for_external_user_ids"] = "push"
        elif segments:
            payload["included_segments"] = segments
        # If no targeting specified, do nothing (will fail safely rather than spam all users)
        
        # Add custom data and optional top-level URL
        # Priority for top-level `url`: explicit `url` parameter -> data['url'] -> data['launch_url']
        if url:
            payload["url"] = url

        if data:
            try:
                # If caller passed 'url' inside data and no explicit url param
                # was provided, use that. Otherwise, fall back to 'launch_url'.
                if not payload.get("url"):
                    data_url = None
                    if isinstance(data, dict):
                        data_url = data.get("url") or data.get("launch_url")
                    if data_url:
                        payload["url"] = data_url
            except Exception:
                logger.debug("Could not read launch_url/url from data; skipping payload['url'] set")

            payload["data"] = data
        
        # Add scheduling
        if scheduled_time:
            # OneSignal expects send_after in UTC timezone
            # Ensure the datetime is timezone-aware and converted to UTC before formatting
            import pytz
            from django.utils import timezone as dj_timezone

            # If naive, assume current timezone and make it aware
            if scheduled_time.tzinfo is None:
                scheduled_time = dj_timezone.make_aware(scheduled_time, dj_timezone.get_current_timezone())

            # Convert to UTC
            utc_time = scheduled_time.astimezone(pytz.UTC)

            # If the scheduled time is in the past (or very close), don't schedule in OneSignal
            now_utc = dj_timezone.now().astimezone(pytz.UTC)
            if utc_time <= now_utc:
                # Send immediately (omit `send_after`) to avoid OneSignal scheduling-in-past errors
                logger.info(f"📅 OneSignal send_after ({utc_time}) is in the past (now={now_utc}), sending immediately")
            else:
                # Format for OneSignal API (must be UTC)
                payload["send_after"] = utc_time.strftime("%Y-%m-%d %H:%M:%S GMT+0000")
                logger.info(f"📅 OneSignal send_after: {payload['send_after']} (UTC)")
        
        # API headers
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"key {self.rest_api_key}"
        }
        
        try:
            response = requests.post(self.api_url, json=payload, headers=headers)
            response_data = response.json()
            
            if response.status_code == 200:
                logger.info(f"✅ OneSignal notification sent successfully. ID: {response_data.get('id')}")
                return {
                    "success": True,
                    "notification_id": response_data.get('id'),
                    "recipients": response_data.get('recipients', 0),
                    "response": response_data
                }
            else:
                logger.error(f"❌ OneSignal API error: {response.status_code} - {response_data}")
                return {
                    "success": False,
                    "error": f"API error {response.status_code}",
                    "details": response_data
                }
        
        except requests.RequestException as e:
            logger.error(f"❌ OneSignal request failed: {str(e)}")
            return {
                "success": False,
                "error": "Network request failed",
                "details": str(e)
            }
        except Exception as e:
            logger.error(f"❌ OneSignal unexpected error: {str(e)}")
            return {
                "success": False,
                "error": "Unexpected error",
                "details": str(e)
            }
    
    def send_appointment_reminder(
        self,
        customer_name: str,
        appointment_date: datetime,
        appointment_type: str = "care activity",
        external_user_ids: Optional[List[str]] = None,
        send_before_minutes: int = 5,
        scheduled_time: Optional[datetime] = None
    ) -> Dict:
        """
        Send appointment reminder notification.
        
        Args:
            customer_name: Name of the customer
            appointment_date: Datetime of appointment
            appointment_type: Type of appointment
            external_user_ids: OneSignal external user IDs to target
            send_before_minutes: Send reminder X minutes before appointment
            scheduled_time: Specific time to send notification (overrides send_before_minutes)
        
        Returns:
            Dict with API response
        """
        # Calculate when to send notification
        if scheduled_time:
            send_time = scheduled_time
        else:
            send_time = appointment_date - timedelta(minutes=send_before_minutes)
        
        # Format appointment time
        time_str = appointment_date.strftime("%H:%M")
        date_str = appointment_date.strftime("%d/%m/%Y")
        
        # Create message
        heading = "🔔 HRM Reminder"
        message = f"Xin chào {customer_name}! Bạn có lịch {appointment_type} vào lúc {time_str} ngày {date_str}. Đừng quên nhé! 💖"
        
        # Additional data
        data = {
            "type": "appointment_reminder",
            "customer_name": customer_name,
            "appointment_date": appointment_date.isoformat(),
            "appointment_type": appointment_type,
        }
        
        return self.send_notification(
            message=message,
            heading=heading,
            external_user_ids=external_user_ids,
            data=data,
            scheduled_time=send_time
        )
    
    def send_care_journey_notification(
        self,
        customer_name: str,
        journey_type: str,
        message_content: str,
        external_user_ids: Optional[List[str]] = None
    ) -> Dict:
        """
        Send care journey related notification.
        
        Args:
            customer_name: Name of the customer
            journey_type: Type of care journey (e.g., "post-surgery", "consultation")
            message_content: Custom message content
            user_ids: OneSignal user IDs to target
        
        Returns:
            Dict with API response
        """
        heading = "💝 HRM Update"
        message = f"Xin chào {customer_name}! {message_content}"
        
        data = {
            "type": "care_journey",
            "customer_name": customer_name,
            "journey_type": journey_type,
        }
        
        return self.send_notification(
            message=message,
            heading=heading,
            external_user_ids=external_user_ids,
            data=data
        )


# Convenience function for easy import
def get_onesignal_service() -> OneSignalService:
    """Get OneSignal service instance."""
    return OneSignalService()


# Quick test function
def test_onesignal_integration() -> Dict:
    """
    Test OneSignal integration with a simple notification.
    Use this for testing the integration.
    """
    service = get_onesignal_service()
    return service.send_notification(
        message="🧪 Test notification from HRM backend!",
        heading="Test Notification",
        segments=["Test Users"]  # Target test users segment
    )

def check_notification_status() -> Dict:
    """
    Check OneSignal configuration status.
    """
    return {
        "onesignal_configured": bool(settings.ONESIGNAL_REST_API_KEY),
        "debug_mode": settings.DEBUG,
        "app_id": settings.ONESIGNAL_APP_ID,
        "message": "OneSignal is " + ("CONFIGURED" if settings.ONESIGNAL_REST_API_KEY else "NOT CONFIGURED")
    }