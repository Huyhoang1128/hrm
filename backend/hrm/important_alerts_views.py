from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .important_alerts import build_important_alerts
from .permissions import IsAdminOrHR


class ImportantAlertsView(APIView):
    """GET /api-hrm/important-alerts/ — HĐ sắp/đã hết hạn và đến hạn đóng BHXH (Admin/HCNS)."""
    permission_classes = [IsAuthenticated, IsAdminOrHR]

    def get(self, request):
        return Response(build_important_alerts())
