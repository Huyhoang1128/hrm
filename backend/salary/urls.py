"""
salary/urls.py – URL routing cho Payroll module.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    DisciplinaryPenaltyViewSet,
    EmployeeKPIRecordViewSet,
    OtherAllowanceViewSet,
    ParkingAllowanceOverrideViewSet,
    LunchAllowanceOverrideViewSet,
    MissingWorkdayPenaltyViewSet,
    EmployeeMonthlySalaryInputViewSet,
    OvertimeRateConfigViewSet,
    SalaryAdvanceViewSet,
    SalesCommissionViewSet,
    EmployeeSalaryHistoryViewSet,
    MonthlySalaryRecordViewSet,
    SalaryComponentOverrideViewSet,
    SalaryComponentViewSet,
    SalaryFormulaViewSet,
    TaxBracketConfigViewSet,
)

router = DefaultRouter()
router.register(r'formulas', SalaryFormulaViewSet, basename='salary-formula')
router.register(r'components', SalaryComponentViewSet, basename='salary-component')
router.register(r'records', MonthlySalaryRecordViewSet, basename='salary-record')
router.register(r'overrides', SalaryComponentOverrideViewSet, basename='salary-override')
router.register(r'salary-history', EmployeeSalaryHistoryViewSet, basename='salary-history')
router.register(r'kpi-records', EmployeeKPIRecordViewSet, basename='salary-kpi')
router.register(r'tax-configs', TaxBracketConfigViewSet, basename='salary-tax-config')
router.register(r'penalties', DisciplinaryPenaltyViewSet, basename='salary-penalty')
router.register(r'commissions', SalesCommissionViewSet, basename='salary-commission')
router.register(r'overtime-rates', OvertimeRateConfigViewSet, basename='salary-overtime-rate')
router.register(r'advances', SalaryAdvanceViewSet, basename='salary-advance')
router.register(r'other-allowances', OtherAllowanceViewSet, basename='salary-other-allowance')
router.register(r'parking-allowance-overrides', ParkingAllowanceOverrideViewSet, basename='salary-parking-allowance-override')
router.register(r'lunch-allowance-overrides', LunchAllowanceOverrideViewSet, basename='salary-lunch-allowance-override')
router.register(r'missing-workday-penalties', MissingWorkdayPenaltyViewSet, basename='salary-missing-workday-penalty')
router.register(r'monthly-inputs', EmployeeMonthlySalaryInputViewSet, basename='salary-monthly-input')

urlpatterns = [
    path('', include(router.urls)),
]
