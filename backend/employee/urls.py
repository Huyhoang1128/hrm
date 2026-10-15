from django.urls import path
from .birthday_views import BirthdayWishListCreateView, BirthdayWishDetailView, BirthdayWishLikeView
from .import_views import EmployeeImportView, EmployeeSocialInsuranceImportView

urlpatterns = [
    path('birthday-wishes/', BirthdayWishListCreateView.as_view(), name='birthday-wish-list'),
    path('birthday-wishes/<int:pk>/', BirthdayWishDetailView.as_view(), name='birthday-wish-detail'),
    path('birthday-wishes/<int:pk>/like/', BirthdayWishLikeView.as_view(), name='birthday-wish-like'),
    path('import/', EmployeeImportView.as_view(), name='employee-import'),
    path('social-insurance/import/', EmployeeSocialInsuranceImportView.as_view(), name='employee-social-insurance-import'),
]
