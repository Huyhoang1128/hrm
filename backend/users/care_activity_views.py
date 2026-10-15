# CRM care activity views removed - HRM project does not need these views
from rest_framework.viewsets import ViewSet
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status


class DailyCareActivityViewSet(ViewSet):
    pass


class CompletionMediaViewSet(ViewSet):
    pass


class CustomerCareDashboardViewSet(ViewSet):
    pass


class ApplyActivityTemplatesToCareJourneyView(APIView):
    def post(self, request):
        return Response({'detail': 'CRM features removed'}, status=status.HTTP_410_GONE)
