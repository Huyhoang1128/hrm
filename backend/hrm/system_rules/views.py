"""GET /api-hrm/system-rules/[?sections=a,b] — quy định hệ thống cho web (xem __init__.py)."""
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import build_rules


class SystemRulesView(APIView):
    # Chưa đăng nhập vẫn gọi được: chỉ nhận các section public (form nhận việc, mật khẩu, thương hiệu).
    permission_classes = [AllowAny]

    def get(self, request):
        raw = (request.query_params.get('sections') or '').strip()
        sections = {s.strip() for s in raw.split(',') if s.strip()} or None
        return Response(build_rules(request, sections))
