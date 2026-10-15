from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from django.utils import timezone
from django.db import models
import logging

from .upload_serializers import AttendanceUploadSerializer, AttendanceUploadResponseSerializer
from .models import AttendanceImportLog, Attendance
from employee.models import Employee

logger = logging.getLogger(__name__)


class AttendanceUploadView(APIView):
    """
    API endpoint for uploading attendance Excel/CSV files
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        """
        Upload and process attendance file
        """
        serializer = AttendanceUploadSerializer(data=request.data, context={'request': request})
        
        if serializer.is_valid():
            try:
                # Process the file
                result = serializer.save()
                
                # Return response
                response_serializer = AttendanceUploadResponseSerializer(result)
                return Response(response_serializer.data, status=status.HTTP_200_OK)
                
            except Exception as e:
                logger.error(f"Attendance upload failed: {str(e)}")
                return Response(
                    {
                        'success': False,
                        'message': f'Upload failed: {str(e)}',
                        'error': str(e)
                    },
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
        else:
                return Response(
                {
                    'success': False,
                    'message': 'Invalid file upload',
                    'errors': serializer.errors
                },
                status=status.HTTP_400_BAD_REQUEST
            )


class AttendanceImportLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for viewing attendance import logs
    """
    queryset = AttendanceImportLog.objects.all().order_by('-created_at')
    serializer_class = AttendanceUploadResponseSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        """
        Optionally filter by date range or import status
        """
        queryset = super().get_queryset()
        
        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        if start_date and end_date:
            queryset = queryset.filter(
                created_at__date__gte=start_date,
                created_at__date__lte=end_date
            )
        elif start_date:
            queryset = queryset.filter(created_at__date__gte=start_date)
        elif end_date:
            queryset = queryset.filter(created_at__date__lte=end_date)
        
        # Filter by import status
        status_filter = self.request.query_params.get('status')
        if status_filter == 'success':
            queryset = queryset.filter(completed_at__isnull=False, error_log__isnull=True)
        elif status_filter == 'failed':
            queryset = queryset.filter(error_log__isnull=False)
        elif status_filter == 'pending':
            queryset = queryset.filter(completed_at__isnull=True, error_log__isnull=True)
        
        # Filter by imported_by
        imported_by = self.request.query_params.get('imported_by')
        if imported_by:
            queryset = queryset.filter(imported_by_id=imported_by)
        
        return queryset
    
    @action(detail=True, methods=['get'])
    def details(self, request, pk=None):
        """
        Get detailed import results
        """
        import_log = self.get_object()
        
        # Get import result details
        import_result = import_log.import_result or {}
        
        # Get successful records
        successful_records = []
        for record in import_result.get('successful', []):
            try:
                employee = Employee.objects.get(employee_id=record.get('employee_code'))
                successful_records.append({
                    'row': record.get('row'),
                    'employee': {
                        'id': employee.id,
                        'employee_id': employee.employee_id,
                        'full_name': employee.full_name
                    },
                    'attendance_date': record.get('attendance_date'),
                    'check_in': record.get('check_in'),
                    'check_out': record.get('check_out'),
                    'status': record.get('status')
                })
            except Employee.DoesNotExist:
                successful_records.append(record)
        
        # Get failed records
        failed_records = import_result.get('failed', [])
        
        # Get duplicate records
        duplicate_records = []
        for record in import_result.get('duplicates', []):
            try:
                employee = Employee.objects.get(employee_id=record.get('employee_code'))
                duplicate_records.append({
                    'row': record.get('row'),
                    'employee': {
                        'id': employee.id,
                        'employee_id': employee.employee_id,
                        'full_name': employee.full_name
                    },
                    'attendance_date': record.get('attendance_date'),
                    'existing_attendance_id': record.get('existing_id')
                })
            except Employee.DoesNotExist:
                duplicate_records.append(record)
        
        return Response({
            'import_log': {
                'id': import_log.id,
                'import_code': import_log.import_code,
                'file_name': import_log.file_name,
                'file_size': import_log.file_size,
                'imported_by': import_log.imported_by.full_name if import_log.imported_by else None,
                'created_at': import_log.created_at,
                'completed_at': import_log.completed_at,
                'total_records': import_log.total_records,
                'imported_records': import_log.imported_records,
                'failed_records': import_log.failed_records,
                'duplicate_records': import_log.duplicate_records,
                'has_error': import_log.error_log is not None
            },
            'details': {
                'successful': successful_records,
                'failed': failed_records,
                'duplicates': duplicate_records
            }
        })
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get import statistics
        """
        # Total imports
        total_imports = AttendanceImportLog.objects.count()
        
        # Successful imports (completed without error)
        successful_imports = AttendanceImportLog.objects.filter(
            completed_at__isnull=False,
            error_log__isnull=True
        ).count()
        
        # Failed imports (with error)
        failed_imports = AttendanceImportLog.objects.filter(
            error_log__isnull=False
        ).count()
        
        # Pending imports
        pending_imports = AttendanceImportLog.objects.filter(
            completed_at__isnull=True,
            error_log__isnull=True
        ).count()
        
        # Total records imported
        total_records = AttendanceImportLog.objects.aggregate(
            total=models.Sum('imported_records')
        )['total'] or 0
        
        # Total records failed
        total_failed = AttendanceImportLog.objects.aggregate(
            total=models.Sum('failed_records')
        )['total'] or 0
        
        # Recent imports (last 7 days)
        seven_days_ago = timezone.now() - timezone.timedelta(days=7)
        recent_imports = AttendanceImportLog.objects.filter(
            created_at__gte=seven_days_ago
        ).count()
        
        # Average success rate
        if total_imports > 0:
            avg_success_rate = (successful_imports / total_imports) * 100
        else:
            avg_success_rate = 0
        
        # Top importers
        top_importers = AttendanceImportLog.objects.values(
            'imported_by__full_name'
        ).annotate(
            count=models.Count('id'),
            total_records=models.Sum('imported_records')
        ).order_by('-count')[:5]
        
        return Response({
            'total_imports': total_imports,
            'successful_imports': successful_imports,
            'failed_imports': failed_imports,
            'pending_imports': pending_imports,
            'total_records_imported': total_records,
            'total_records_failed': total_failed,
            'recent_imports': recent_imports,
            'avg_success_rate': round(avg_success_rate, 2),
            'top_importers': list(top_importers)
        })
    
    @action(detail=False, methods=['get'])
    def recent(self, request):
        """
        Get recent import logs
        """
        recent_logs = AttendanceImportLog.objects.all().order_by('-created_at')[:10]
        
        logs_data = []
        for log in recent_logs:
            logs_data.append({
                'id': log.id,
                'import_code': log.import_code,
                'file_name': log.file_name,
                'imported_by': log.imported_by.full_name if log.imported_by else None,
                'created_at': log.created_at,
                'completed_at': log.completed_at,
                'total_records': log.total_records,
                'imported_records': log.imported_records,
                'failed_records': log.failed_records,
                'status': 'success' if log.completed_at and not log.error_log else 
                         'failed' if log.error_log else 'pending'
            })
        
        return Response(logs_data)


class AttendanceUploadTemplateView(APIView):
    """
    API endpoint for downloading attendance upload template
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        """
        Download Excel template for attendance upload
        """
        import pandas as pd
        from django.http import HttpResponse
        import io
        
        # Create sample data for template
        sample_data = {
            'STT': [1, 2, 3],
            'Mã nhân viên': ['NV02311', 'NV02312', 'NV02313'],
            'Tên nhân viên': ['Lê Văn C', 'Nguyễn Văn A', 'Trần Thị B'],
            'Phòng Ban': ['HR', 'IT', 'Sales'],
            'Ngày': ['2025-12-16', '2025-12-17', '2025-12-18'],
            'Thứ': ['Ba', 'Tư', 'Năm'],
            'Giờ vào': ['08:00', '08:15', '08:30'],
            'Giờ ra': ['17:00', '17:30', '18:00'],
            'Trễ': [0, 15, 0],
            'Sớm': [0, 0, 15],
            'Công': [1, 1, 1],
            'Tổng giờ': [8, 8.5, 9],
            'Tăng ca': [0, 1, 2],
            'Tổng toàn bộ': [8, 9.5, 11],
            'Ca': ['***', '***', '***']
        }
        
        # Create DataFrame
        df = pd.DataFrame(sample_data)
        
        # Create Excel file in memory
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            # Write template sheet
            df.to_excel(writer, sheet_name='Template', index=False)
            
            # Write instructions sheet
            instructions = pd.DataFrame({
                'Hướng dẫn': [
                    '1. File phải có định dạng Excel (.xlsx hoặc .xls)',
                    '2. Dòng đầu tiên là tiêu đề, dữ liệu bắt đầu từ dòng thứ 2',
                    '3. Cột bắt buộc: Mã nhân viên, Ngày',
                    '4. Định dạng ngày: YYYY-MM-DD hoặc DD/MM/YYYY',
                    '5. Định dạng giờ: HH:MM hoặc HH:MM:SS',
                    '6. Mã nhân viên phải tồn tại trong hệ thống',
                    '7. Nếu nhân viên không tồn tại, bản ghi sẽ bị bỏ qua',
                    '8. Bản ghi trùng lặp (cùng nhân viên, cùng ngày) sẽ bị bỏ qua',
                    '9. Kích thước file tối đa: 10MB'
                ]
            })
            instructions.to_excel(writer, sheet_name='Hướng dẫn', index=False)
            
            # Write column descriptions
            columns_desc = pd.DataFrame({
                'Cột': list(sample_data.keys()),
                'Mô tả': [
                    'Số thứ tự',
                    'Mã nhân viên (bắt buộc)',
                    'Tên nhân viên',
                    'Phòng ban',
                    'Ngày chấm công (bắt buộc)',
                    'Thứ trong tuần',
                    'Giờ vào làm',
                    'Giờ ra về',
                    'Số phút đi trễ',
                    'Số phút về sớm',
                    'Số công',
                    'Tổng giờ làm',
                    'Số giờ tăng ca',
                    'Tổng giờ toàn bộ',
                    'Ca làm việc'
                ]
            })
            columns_desc.to_excel(writer, sheet_name='Mô tả cột', index=False)
        
        # Prepare HTTP response
        output.seek(0)
        response = HttpResponse(
            output.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response['Content-Disposition'] = 'attachment; filename="attendance_upload_template.xlsx"'
        
        return response


class AttendanceUploadValidationView(APIView):
    """
    API endpoint for validating attendance data before import
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        """
        Validate attendance data without importing
        """
        serializer = AttendanceUploadSerializer(data=request.data, context={'request': request})
        
        if serializer.is_valid():
            try:
                # Get the file
                file = serializer.validated_data['file']
                
                # Read and validate the file
                import pandas as pd
                import io
                
                file_ext = file.name.split('.')[-1].lower()
                
                if file_ext in ['xlsx', 'xls']:
                    df = pd.read_excel(file, header=1)
                elif file_ext == 'csv':
                    df = pd.read_csv(file, header=1)
                else:
                    return Response(
                        {'success': False, 'message': f'Unsupported file format: {file_ext}'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                
                # Clean column names
                df.columns = [str(col).strip() for col in df.columns]
                
                # Validation results
                validation_results = {
                    'total_rows': len(df),
                    'valid_rows': 0,
                    'invalid_rows': 0,
                    'missing_employee_codes': 0,
                    'invalid_dates': 0,
                    'duplicate_records': 0,
                    'employee_not_found': 0,
                    'details': {
                        'valid': [],
                        'invalid': []
                    }
                }
                
                # Check for required columns
                required_columns = ['Mã nhân viên', 'Ngày']
                missing_columns = [col for col in required_columns if col not in df.columns]
                
                if missing_columns:
                    return Response({
                        'success': False,
                        'message': f'Missing required columns: {", ".join(missing_columns)}',
                        'missing_columns': missing_columns
                    }, status=status.HTTP_400_BAD_REQUEST)
                
                # Validate each row
                for index, row in df.iterrows():
                    row_num = index + 2  # +2 because header=1
                    errors = []
                    
                    # Check employee code
                    employee_code = str(row['Mã nhân viên']).strip() if pd.notna(row['Mã nhân viên']) else None
                    if not employee_code or employee_code == 'nan':
                        errors.append('Missing employee code')
                        validation_results['missing_employee_codes'] += 1
                    else:
                        # Check if employee exists
                        try:
                            employee = Employee.objects.get(employee_id=employee_code)
                        except Employee.DoesNotExist:
                            errors.append(f'Employee with code {employee_code} not found')
                            validation_results['employee_not_found'] += 1
                    
                    # Check date
                    date_val = row['Ngày']
                    if pd.notna(date_val):
                        try:
                            # Try to parse the date
                            if isinstance(date_val, str):
                                # Try different date formats
                                date_parsed = False
                                for fmt in ['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%Y/%m/%d']:
                                    try:
                                        pd.to_datetime(date_val, format=fmt).date()
                                        date_parsed = True
                                        break
                                    except:
                                        continue
                                if not date_parsed:
                                    errors.append(f'Invalid date format: {date_val}')
                                    validation_results['invalid_dates'] += 1
                            else:
                                pd.to_datetime(date_val).date()
                        except:
                            errors.append(f'Invalid date: {date_val}')
                            validation_results['invalid_dates'] += 1
                    else:
                        errors.append('Missing date')
                    
                    # Check for duplicates (if employee exists and date is valid)
                    if not errors and employee_code and pd.notna(date_val):
                        try:
                            # Parse date for duplicate check
                            attendance_date = None
                            if isinstance(date_val, str):
                                for fmt in ['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%Y/%m/%d']:
                                    try:
                                        attendance_date = pd.to_datetime(date_val, format=fmt).date()
                                        break
                                    except:
                                        continue
                            else:
                                attendance_date = pd.to_datetime(date_val).date()

                            if attendance_date:
                                # Check for existing attendance
                                existing = Attendance.objects.filter(
                                    employee__employee_id=employee_code,
                                    attendance_date=attendance_date
                                ).exists()

                                if existing:
                                    errors.append('Duplicate attendance record')
                                    validation_results['duplicate_records'] += 1
                        except:
                            # If date parsing fails, it's already caught in date validation
                            pass
                    
                    # Update validation results
                    if errors:
                        validation_results['invalid_rows'] += 1
                        validation_results['details']['invalid'].append({
                            'row': row_num,
                            'employee_code': employee_code,
                            'errors': errors
                        })
                    else:
                        validation_results['valid_rows'] += 1
                        validation_results['details']['valid'].append({
                            'row': row_num,
                            'employee_code': employee_code,
                            'date': date_val
                        })
                
                return Response({
                    'success': True,
                    'message': 'Validation completed',
                    'validation_results': validation_results
                }, status=status.HTTP_200_OK)
                
            except Exception as e:
                logger.error(f"Attendance validation failed: {str(e)}")
                return Response(
                    {
                        'success': False,
                        'message': f'Validation failed: {str(e)}',
                        'error': str(e)
                    },
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
        else:
            return Response(
                {
                    'success': False,
                    'message': 'Invalid file upload',
                    'errors': serializer.errors
                },
                status=status.HTTP_400_BAD_REQUEST
            )
