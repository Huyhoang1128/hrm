"""
hrm/employee_search_views.py
════════════════════════════
Endpoint search Employee read-only — dùng cho autocomplete picker trong
sync tool (mapping mã chấm công ↔ nhân viên).

Tách riêng vì:
  - Là read-only / lightweight, không thuộc luồng đăng ký/lương/...
  - Chỉ HR (đã auth qua JWT) mới gọi được
"""

from __future__ import annotations

from django.db.models import Q
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from employee.models import Employee
from hrm.device_attendance_views import _is_hr_user


class EmployeeSearchView(APIView):
    """
    GET /api/v1/hrm/employees-search/?q=<query>&limit=<n>

    Trả {"items": [{"id":..,"employee_id":"NV001","full_name":"..."}, ...]}.
    Match q vào employee_id hoặc full_name (icontains). limit mặc định 20, max 100.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _is_hr_user(request.user):
            return Response({"error": "Chỉ HR mới được tra cứu nhân viên."}, status=403)

        q = (request.query_params.get("q") or "").strip()
        try:
            limit = max(1, min(int(request.query_params.get("limit", "20")), 100))
        except ValueError:
            limit = 20

        qs = Employee.objects.only("id", "employee_id", "full_name")
        if q:
            qs = qs.filter(
                Q(employee_id__icontains=q) | Q(full_name__icontains=q)
            )
        qs = qs.order_by("employee_id")[:limit]

        items = [
            {"id": e.id, "employee_id": e.employee_id, "full_name": e.full_name}
            for e in qs
        ]
        return Response({"items": items})
