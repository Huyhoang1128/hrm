from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from django.shortcuts import get_object_or_404
from django.db.models import Q

from .models import OnboardingProcess
from .serializers import (
    OnboardingProcessDetailSerializer,
    OnboardingProcessUpdateSerializer,
    EmployeeSerializer,
)
from .permissions import IsSuperUser
from employee.models import Employee


class SuperAdminOnboardingView(APIView):
    """
    API chỉ dành cho superuser – đọc và cập nhật OnboardingProcess.

    GET  /super-admin/onboarding/?id=<id>
    GET  /super-admin/onboarding/?code=<onboarding_code>
    PATCH /super-admin/onboarding/?id=<id>
    PATCH /super-admin/onboarding/?code=<onboarding_code>

    Bắt buộc phải truyền một trong hai tham số: `id` hoặc `code`.
    """

    permission_classes = [IsAuthenticated, IsSuperUser]

    def _get_onboarding(self, request):
        onboarding_id = request.query_params.get("id")
        onboarding_code = request.query_params.get("code")
        employee_id = request.query_params.get("employee_id")

        if not onboarding_id and not onboarding_code and not employee_id:
            return None, Response(
                {"detail": "Vui lòng truyền tham số 'id', 'code' hoặc 'employee_id'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        lookup = Q()
        if onboarding_id:
            lookup |= Q(id=onboarding_id)
        if onboarding_code:
            lookup |= Q(onboarding_code=onboarding_code)
        if employee_id:
            lookup |= Q(employee__employee_id=employee_id)

        onboarding = get_object_or_404(
            OnboardingProcess.objects.select_related(
                "position", "department", "direct_manager",
                "hr_responsible", "employee", "created_by",
            ).prefetch_related("tasks", "documents"),
            lookup,
        )
        return onboarding, None

    def get(self, request):
        onboarding, error = self._get_onboarding(request)
        if error:
            return error

        serializer = OnboardingProcessDetailSerializer(onboarding)
        return Response(serializer.data)

    def patch(self, request):
        onboarding, error = self._get_onboarding(request)
        if error:
            return error

        serializer = OnboardingProcessUpdateSerializer(
            onboarding, data=request.data, partial=True
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save()
        onboarding.refresh_from_db()
        detail_serializer = OnboardingProcessDetailSerializer(onboarding)
        return Response(detail_serializer.data)


class SuperAdminEmployeeView(APIView):
    """
    API chỉ dành cho superuser – đọc và cập nhật Employee.

    GET   /super-admin/employee/?employee_id=<employee_id>
    PATCH /super-admin/employee/?employee_id=<employee_id>

    Bắt buộc phải truyền tham số `employee_id`.
    """

    permission_classes = [IsAuthenticated, IsSuperUser]

    def _get_employee(self, request):
        employee_id = request.query_params.get("employee_id")

        if not employee_id:
            return None, Response(
                {"detail": "Vui lòng truyền tham số 'employee_id'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        employee = get_object_or_404(Employee, employee_id=employee_id)
        return employee, None

    def get(self, request):
        employee, error = self._get_employee(request)
        if error:
            return error

        serializer = EmployeeSerializer(employee, context={"request": request})
        return Response(serializer.data)

    def patch(self, request):
        employee, error = self._get_employee(request)
        if error:
            return error

        # Upload vneid_screenshot lên Cloudfly trước khi serializer xử lý
        data = request.data.copy()
        vneid_file = request.FILES.get('vneid_screenshot')
        if vneid_file:
            try:
                from .utils import upload_file_to_cloudfly
                s3_key = upload_file_to_cloudfly(vneid_file, 'vneid_screenshots')
                data['vneid_screenshot'] = s3_key
            except Exception as e:
                return Response(
                    {'vneid_screenshot': f'Không thể upload ảnh VNeID: {str(e)}'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        serializer = EmployeeSerializer(
            employee, data=data, partial=True, context={"request": request}
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save()
        return Response(serializer.data)

