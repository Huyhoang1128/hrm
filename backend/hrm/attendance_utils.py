import datetime
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.db.models import Q

from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import JSONParser, MultiPartParser

from hrm.event_models import EmployeeEvent


def add_event(employee_id, event_type, event_date, data):
    """Hàm tiện ích để thêm một sự kiện cho nhân viên"""
    event = EmployeeEvent.objects.create(
        employee_id=employee_id,
        event_type=event_type,
        event_date=event_date,
        data=data
    )
    return event 

class EventAPIView(APIView):
    """GET list / POST create AttendancePolicyVersion"""
    permission_classes = [IsAuthenticated]
