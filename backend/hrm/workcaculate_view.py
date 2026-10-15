from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, BasePermission
from rest_framework.pagination import PageNumberPagination
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from django.db import models
from django.utils import timezone
from datetime import timedelta

from employee.models import Employee, Department, Position
from .models import Attendance, LeaveRequest, CompanyConfig
from .event_models import EmployeeEvent


# ======================
# MONTHLY WORK CREDITS CALCULATION VIEW
# ======================

class MonthlyWorkCreditsAPIView(APIView):
    """
    API endpoint for calculating monthly work credits for employees
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        """
        Calculate monthly work credits for employees based on attendance records
        """
        # Get query parameters
        month = request.query_params.get('month')
        year = request.query_params.get('year')
        employee_id = request.query_params.get('employee_id')
        department_id = request.query_params.get('department_id')
        
        # Set default to current month/year if not provided
        from datetime import datetime, timedelta
        today = datetime.now()
        if not month:
            month = today.month
        if not year:
            year = today.year
        
        # Validate month and year
        try:
            month = int(month)
            year = int(year)
            if month < 1 or month > 12:
                return Response(
                    {'error': 'Month must be between 1 and 12'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if year < 2000 or year > 2100:
                return Response(
                    {'error': 'Year must be between 2000 and 2100'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        except ValueError:
            return Response(
                {'error': 'Month and year must be valid integers'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Build date range
        start_date = datetime(year, month, 1).date()
        if month == 12:
            end_date = datetime(year + 1, 1, 1).date() - timedelta(days=1)
        else:
            end_date = datetime(year, month + 1, 1).date() - timedelta(days=1)
        
        # Build filter conditions for attendance
        attendance_filters = {
            'attendance_date__gte': start_date,
            'attendance_date__lte': end_date
        }
        
        # Build filter conditions for employees
        employee_filters = {}
        if employee_id:
            try:
                employee = Employee.objects.get(id=employee_id)
                attendance_filters['employee'] = employee
                employee_filters['id'] = employee_id
            except Employee.DoesNotExist:
                return Response(
                    {'error': f'Employee with ID {employee_id} does not exist'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        if department_id:
            try:
                department = Department.objects.get(id=department_id)
                attendance_filters['employee__department'] = department
                employee_filters['department'] = department
            except Department.DoesNotExist:
                return Response(
                    {'error': f'Department with ID {department_id} does not exist'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        # Get employees based on filters
        employees = Employee.objects.filter(**employee_filters)
        
        # Get attendance records for the month
        attendance_records = Attendance.objects.filter(**attendance_filters)
        
        # Get company config for work hour calculations
        from .models import CompanyConfig
        today_date = today.date()
        company_config = CompanyConfig.objects.filter(
            is_active=True,
            effective_from__lte=today_date
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today_date)
        ).order_by('-effective_from').first()
        
        # If no company config, create a default one
        if not company_config:
            company_config = CompanyConfig.objects.create(
                name='Cấu hình mặc định',
                code='DEFAULT-CONFIG',
                description='Cấu hình mặc định tự động tạo',
                default_working_hours_per_day=8.0,
                default_working_days_per_week=5,
                overtime_multiplier_weekday=1.5,
                overtime_multiplier_weekend=2.0,
                overtime_multiplier_holiday=3.0,
                late_threshold_minutes=15,
                early_leave_threshold_minutes=15,
                half_day_threshold_hours=4.0,
                annual_leave_days_per_year=12,
                sick_leave_days_per_year=5,
                maternity_leave_days=180,
                paternity_leave_days=5,
                max_explanation_count_per_month=3,
                supplement_work_hours_per_month=10.0,
                is_active=True,
                effective_from=today_date,
                created_by=None
            )
        
        # Calculate work credits for each employee
        results = []
        total_summary = {
            'total_employees':          0,
            'total_work_days':          0,
            'total_work_hours':         0.0,
            'total_work_credits':       0.0,
            'total_overtime_hours':     0.0,   # Tăng ca
            'total_extra_hours':        0.0,   # Làm thêm giờ
            'total_night_shifts':       0.0,   # Ca đêm
            'total_live_sessions':      0.0,   # Livestream
            'total_overtime_credits':   0.0,   # Credits từ OT + extra + night + live
            'total_late_minutes':       0,
            'total_early_leave_minutes': 0,
            'total_penalty_credits':    0.0
        }
        
        for employee in employees:
            # Get attendance records for this employee
            employee_attendance = attendance_records.filter(employee=employee)
            
            # Calculate statistics
            # First, get all attendance records
            attendance_list = list(employee_attendance)
            
            # Initialize counters
            total_days          = 0
            total_work_hours    = 0.0
            total_overtime_hrs  = 0.0   # Tăng ca (OVERTIME event)
            total_extra_hrs     = 0.0   # Làm thêm giờ (EXTRA_HOURS event)
            total_night_shifts  = 0.0   # Ca đêm (NIGHT_SHIFT event)
            total_live_sessions = 0.0   # Livestream (LIVESTREAM event)
            total_late_minutes  = 0
            total_early_leave_minutes = 0
            
            # Track which dates have approved explanations – dùng EmployeeEvent
            approved_explanation_dates = set()
            approved_explanation_events = EmployeeEvent.objects.filter(
                employee=employee,
                event_type=EmployeeEvent.EventType.EXPLANATION,
                event_date__gte=start_date,
                event_date__lte=end_date,
                data__status='APPROVED',
            )
            for exp_ev in approved_explanation_events:
                approved_explanation_dates.add(exp_ev.event_date)
            
            # ── Tất cả giờ tăng ca / làm thêm từ EmployeeEvent (chỉ đếm đơn đã duyệt) ──
            # OVERTIME: Tăng ca (số giờ ≥ 1 buổi)
            ot_events = EmployeeEvent.objects.filter(
                employee=employee,
                event_type=EmployeeEvent.EventType.OVERTIME,
                event_date__gte=start_date,
                event_date__lte=end_date,
                data__status='APPROVED',
            )
            for oe in ot_events:
                hrs = None
                if oe.overtime_hours is not None:
                    hrs = float(oe.overtime_hours)
                elif oe.data:
                    hrs = float(oe.data.get('hours', 0) or 0)
                total_overtime_hrs += hrs or 0.0

            # EXTRA_HOURS: Làm thêm giờ
            extra_events = EmployeeEvent.objects.filter(
                employee=employee,
                event_type=EmployeeEvent.EventType.EXTRA_HOURS,
                event_date__gte=start_date,
                event_date__lte=end_date,
                data__status='APPROVED',
            )
            for ee_ev in extra_events:
                hrs = None
                if ee_ev.overtime_hours is not None:
                    hrs = float(ee_ev.overtime_hours)
                elif ee_ev.data:
                    hrs = float(ee_ev.data.get('hours', 0) or 0)
                total_extra_hrs += hrs or 0.0

            # NIGHT_SHIFT: Ca đêm (tính theo buổi)
            ns_events = EmployeeEvent.objects.filter(
                employee=employee,
                event_type=EmployeeEvent.EventType.NIGHT_SHIFT,
                event_date__gte=start_date,
                event_date__lte=end_date,
                data__status='APPROVED',
            )
            for ns in ns_events:
                # Mặc định 1 buổi nếu không có số buổi cụ thể trong sessions
                sessions = (ns.data or {}).get('sessions', 1.0)
                total_night_shifts += float(sessions)

            # LIVE: Livestream (tính theo ca)
            live_events = EmployeeEvent.objects.filter(
                employee=employee,
                event_type=EmployeeEvent.EventType.LIVESTREAM,
                event_date__gte=start_date,
                event_date__lte=end_date,
                data__status='APPROVED',
            )
            for lv in live_events:
                sessions = (lv.data or {}).get('sessions', 1.0)
                total_live_sessions += float(sessions)

            # ── Tất cả giờ chấm công thường từ Attendance ──
            for attendance in attendance_list:
                # Add work hours, overtime, late minutes, early leave minutes
                total_work_hours += float(attendance.working_hours or 0.0)
                # Không cộng overtime từ Attendance nữa – đã tính từ EmployeeEvent
                total_late_minutes += attendance.late_minutes or 0
                total_early_leave_minutes += attendance.early_leave_minutes or 0
                
                # Calculate work days based on status and approved explanations
                attendance_date = attendance.attendance_date
                
                if attendance.status == 'ABSENT':
                    # Check if there's an approved explanation for this date
                    if attendance_date in approved_explanation_dates:
                        # Approved explanation: count as PRESENT (1 day)
                        total_days += 1
                    # Otherwise, ABSENT doesn't count as a work day
                elif attendance.status == 'HALF_DAY':
                    # HALF_DAY counts as 0.5 days
                    total_days += 0.5
                elif attendance.status == 'PRESENT':
                    # PRESENT counts as 1 day
                    total_days += 1
                elif attendance.status == 'LATE' or attendance.status == 'EARLY_LEAVE':
                    # LATE or EARLY_LEAVE still count as PRESENT (1 day)
                    total_days += 1
                # Other statuses don't count as work days
            
            # Round total_days to 2 decimal places
            total_days = round(total_days, 2)
            
            # Tính credits
            work_credits      = total_work_hours

            # Tăng ca: nhân hệ số weekday
            overtime_multiplier = float(company_config.overtime_multiplier_weekday)
            overtime_credits    = total_overtime_hrs * overtime_multiplier

            # Làm thêm giờ: nhân hệ số 1.0 (tuyến tính)
            extra_hours_credits = total_extra_hrs * 1.0

            # Ca đêm và Livestream: Tính credit theo số buổi/ca (tạm thời 1 credit per session)
            night_shift_credits = total_night_shifts * 1.0
            live_session_credits = total_live_sessions * 1.0

            # Tổng giờ ngoài giờ (hiển thị gộp các loại tính theo giờ)
            total_overtime_hours = total_overtime_hrs + total_extra_hrs

            # Calculate penalty credits for late/early leave
            late_hours        = total_late_minutes / 60.0
            early_leave_hours = total_early_leave_minutes / 60.0
            penalty_credits   = (late_hours + early_leave_hours) * 1.0

            # Total credits for the month
            total_credits = (float(work_credits) + float(overtime_credits) + 
                            float(extra_hours_credits) + float(night_shift_credits) + 
                            float(live_session_credits) - float(penalty_credits))
            
            # Get attendance status summary
            status_counts = employee_attendance.values('status').annotate(
                count=models.Count('id')
            )
            status_summary = {item['status']: item['count'] for item in status_counts}
            
            # Sử dụng EmployeeEvent thay vì AttendanceExplanation
            approved_explanations_count = EmployeeEvent.objects.filter(
                employee=employee,
                event_type=EmployeeEvent.EventType.EXPLANATION,
                event_date__gte=start_date,
                event_date__lte=end_date,
                data__status='APPROVED',
            ).count()
            
            # Get approved leave requests for this employee in this month
            approved_leaves = LeaveRequest.objects.filter(
                employee=employee,
                status='APPROVED'
            ).filter(
                models.Q(start_date__lte=end_date, end_date__gte=start_date) |
                models.Q(start_date__gte=start_date, start_date__lte=end_date)
            ).count()
            
            # Calculate attendance rate
            # Total working days in the month (excluding weekends)
            from datetime import timedelta
            working_days_in_month = 0
            current_date = start_date
            while current_date <= end_date:
                # Check if it's a weekend (Saturday=5, Sunday=6)
                if current_date.weekday() < 5:  # Monday to Friday
                    working_days_in_month += 1
                current_date += timedelta(days=1)
            
            if working_days_in_month > 0:
                attendance_rate = (total_days / working_days_in_month) * 100
            else:
                attendance_rate = 0
            
            # Create employee result
            employee_result = {
                'employee': {
                    'id': employee.id,
                    'employee_id': employee.employee_id,
                    'full_name': employee.full_name,
                    'department': employee.department.name if employee.department else None,
                    'position': employee.position.title if employee.position else None
                },
                'month': month,
                'year': year,
                'date_range': {
                    'start_date': start_date,
                    'end_date': end_date
                },
                'attendance_summary': {
                    'total_days':                 total_days,
                    'total_work_hours':           round(float(total_work_hours), 2),
                    'total_overtime_hours':        round(total_overtime_hrs, 2),
                    'total_extra_hours':           round(total_extra_hrs, 2),
                    'total_night_shifts':          round(total_night_shifts, 2),
                    'total_live_sessions':         round(total_live_sessions, 2),
                    'total_combined_extra_hours':  round(total_overtime_hours, 2),
                    'total_late_minutes':          total_late_minutes,
                    'total_early_leave_minutes':   total_early_leave_minutes,
                    'status_summary':              status_summary,
                    'attendance_rate':             round(attendance_rate, 2),
                    'working_days_in_month':       working_days_in_month
                },
                'approved_requests': {
                    'explanations': approved_explanations_count,
                    'leaves':       approved_leaves
                },
                'credit_calculation': {
                    'work_credits':        round(float(work_credits), 2),
                    'overtime_credits':    round(float(overtime_credits), 2),
                    'extra_hours_credits': round(float(extra_hours_credits), 2),
                    'night_shift_credits': round(float(night_shift_credits), 2),
                    'live_session_credits': round(float(live_session_credits), 2),
                    'penalty_credits':     round(float(penalty_credits), 2),
                    'total_credits':       round(float(total_credits), 2),
                    'overtime_multiplier': overtime_multiplier,
                    'formula': (
                        'Tổng = Công thường'
                        f' + Tăng ca × {overtime_multiplier}'
                        ' + Làm thêm giờ × 1'
                        ' + Ca đêm × 1'
                        ' + Livestream × 1'
                        ' - Phạt'
                    ),
                },
                'notes': []
            }
            
            # Add notes based on performance
            if total_credits < 0:
                employee_result['notes'].append('Tổng điểm công âm - cần cải thiện chấm công')
            elif attendance_rate < 80:
                employee_result['notes'].append('Tỷ lệ chấm công thấp (<80%)')
            elif total_overtime_hours > 20:
                employee_result['notes'].append('Làm thêm giờ nhiều (>20 giờ)')
            
            results.append(employee_result)
            
            # Update total summary
            total_summary['total_employees']         += 1
            total_summary['total_work_days']         += float(total_days)
            total_summary['total_work_hours']        += float(total_work_hours)
            total_summary['total_work_credits']      += float(work_credits)
            total_summary['total_overtime_hours']    += total_overtime_hrs
            total_summary['total_extra_hours']       += total_extra_hrs
            total_summary['total_night_shifts']      += total_night_shifts
            total_summary['total_live_sessions']     += total_live_sessions
            total_summary['total_overtime_credits']  += (float(overtime_credits) + 
                                                      float(extra_hours_credits) + 
                                                      float(night_shift_credits) + 
                                                      float(live_session_credits))
            total_summary['total_late_minutes']      += float(total_late_minutes)
            total_summary['total_early_leave_minutes'] += float(total_early_leave_minutes)
            total_summary['total_penalty_credits']   += float(penalty_credits)
        
        # Calculate averages
        if total_summary['total_employees'] > 0:
            total_summary['avg_work_credits'] = round(total_summary['total_work_credits'] / total_summary['total_employees'], 2)
            total_summary['avg_overtime_credits'] = round(total_summary['total_overtime_credits'] / total_summary['total_employees'], 2)
            total_summary['avg_penalty_credits'] = round(total_summary['total_penalty_credits'] / total_summary['total_employees'], 2)
            total_summary['avg_total_credits'] = round(
                (total_summary['total_work_credits'] + total_summary['total_overtime_credits'] - total_summary['total_penalty_credits']) / total_summary['total_employees'], 2
            )
        else:
            total_summary['avg_work_credits'] = 0
            total_summary['avg_overtime_credits'] = 0
            total_summary['avg_penalty_credits'] = 0
            total_summary['avg_total_credits'] = 0
        
        # Round float values
        total_summary['total_work_hours'] = round(total_summary['total_work_hours'], 2)
        total_summary['total_work_credits'] = round(total_summary['total_work_credits'], 2)
        total_summary['total_overtime_hours'] = round(total_summary['total_overtime_hours'], 2)
        total_summary['total_overtime_credits'] = round(total_summary['total_overtime_credits'], 2)
        total_summary['total_penalty_credits'] = round(total_summary['total_penalty_credits'], 2)
        
        return Response({
            'filters': {
                'month': month,
                'year': year,
                'employee_id': employee_id,
                'department_id': department_id
            },
            'company_config': {
                'default_working_hours_per_day': company_config.default_working_hours_per_day,
                'overtime_multiplier_weekday': company_config.overtime_multiplier_weekday,
                'overtime_multiplier_weekend': company_config.overtime_multiplier_weekend,
                'overtime_multiplier_holiday': company_config.overtime_multiplier_holiday
            },
            'results': results,
            'summary': total_summary,
            'calculation_rules': {
                'work_credits':        '1 điểm công cho mỗi giờ làm việc thường',
                'overtime_credits':    f'Tăng ca nhân hệ số {overtime_multiplier} (chỉ giờ đã được duyệt)',
                'extra_hours_credits': 'Làm thêm giờ: 1 điểm/giờ (chỉ giờ đã được duyệt)',
                'penalty_credits':     'Trừ 1 điểm công cho mỗi giờ đi muộn/về sớm',
                'total_credits':       'Tổng điểm = Điểm công + Điểm tăng ca + Điểm làm thêm - Điểm phạt'
            }
        })
