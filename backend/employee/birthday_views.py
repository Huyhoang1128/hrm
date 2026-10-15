import django_filters
from rest_framework import generics, permissions, filters, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend

from .models import BirthdayWish
from .serializers import BirthdayWishSerializer, BirthdayWishCreateSerializer


class BirthdayWishPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class BirthdayWishFilter(django_filters.FilterSet):
    """FilterSet hỗ trợ lọc theo mã nhân viên (employee_id) thay vì PK"""
    recipient = django_filters.CharFilter(field_name='recipient__employee_id', lookup_expr='exact')
    sender = django_filters.CharFilter(field_name='sender__employee_id', lookup_expr='exact')
    year = django_filters.NumberFilter(field_name='year')

    class Meta:
        model = BirthdayWish
        fields = ['recipient', 'sender', 'year']


class BirthdayWishListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/employee/birthday-wishes/      - Lấy danh sách lời chúc (hỗ trợ filter theo recipient, sender, year)
    POST /api/employee/birthday-wishes/      - Thêm lời chúc sinh nhật mới
    """
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = BirthdayWishPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = BirthdayWishFilter
    ordering_fields = ['created_at', 'year']
    ordering = ['-created_at']

    def get_queryset(self):
        return BirthdayWish.objects.select_related(
            'recipient', 'sender'
        ).all()

    def get_serializer_class(self):
        if self.request.method == 'POST':
            return BirthdayWishCreateSerializer
        return BirthdayWishSerializer


class BirthdayWishDetailView(generics.RetrieveDestroyAPIView):
    """
    GET    /api/employee/birthday-wishes/<id>/  - Chi tiết lời chúc
    DELETE /api/employee/birthday-wishes/<id>/  - Xóa lời chúc
    """
    permission_classes = [permissions.IsAuthenticated]
    queryset = BirthdayWish.objects.select_related('recipient', 'sender').all()
    serializer_class = BirthdayWishSerializer


class BirthdayWishLikeView(APIView):
    """
    POST /api/employee/birthday-wishes/<id>/like/  - Người nhận like lời chúc
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        try:
            wish = BirthdayWish.objects.select_related('recipient').get(pk=pk)
        except BirthdayWish.DoesNotExist:
            return Response({'detail': 'Không tìm thấy lời chúc.'}, status=status.HTTP_404_NOT_FOUND)

        employee = getattr(request.user, 'employee', None)
        if employee is None or wish.recipient_id != employee.id:
            return Response(
                {'detail': 'Chỉ người nhận lời chúc mới có thể like.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        wish.is_liked = True
        wish.save(update_fields=['is_liked', 'updated_at'])
        return Response(BirthdayWishSerializer(wish, context={'request': request}).data)
