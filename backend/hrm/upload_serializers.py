from rest_framework import serializers
from django.utils import timezone
from employee.models import Employee
from .models import Attendance, AttendanceImportLog
from .event_models import EmployeeEvent
import pandas as pd
import io
import traceback
import logging
from .shift_config_utils import lone_punch_is_checkout

logger = logging.getLogger(__name__)

# Các tên cột có thể dùng để nhận diện đúng dòng header thật trong file chấm công —
# dùng chung với các possible_*_columns bên dưới để dò dòng header, vì file mẫu HR
# đưa lên không thống nhất: có file có 1-2 dòng tiêu đề/banner phía trên dòng header
# thật, có file header nằm ngay dòng đầu tiên (không có banner nào).
_ATTENDANCE_HEADER_HINTS = [
    'mã nhân viên', 'mã nv', 'employee code', 'mã n.viên',
]


def _detect_attendance_header_row(file, file_ext: str, max_rows_to_scan: int = 5) -> int:
    """Dò dòng nào trong vài dòng đầu file là dòng header thật (chứa 1 trong các
    tên cột ở _ATTENDANCE_HEADER_HINTS), trả về index (0-based) để truyền vào
    pd.read_excel/read_csv(header=...). Trả về 1 (hành vi mặc định cũ) nếu không
    dò được, để không phá các file mẫu đang hoạt động đúng.
    """
    try:
        if file_ext == 'csv':
            raw = pd.read_csv(file, header=None, nrows=max_rows_to_scan)
        else:
            raw = pd.read_excel(file, header=None, nrows=max_rows_to_scan)
    except Exception:
        return 1
    finally:
        try:
            file.seek(0)
        except Exception:
            pass

    for row_idx in range(len(raw)):
        row_values = [str(v).strip().lower() for v in raw.iloc[row_idx].tolist()]
        if any(hint in cell for cell in row_values for hint in _ATTENDANCE_HEADER_HINTS):
            return row_idx
    return 1


class AttendanceUploadSerializer(serializers.Serializer):
    """Serializer for attendance file upload"""
    file = serializers.FileField(required=True, help_text="Excel file containing attendance data")
    
    def validate_file(self, value):
        """Validate the uploaded file"""
        # Check file extension
        allowed_extensions = ['.xlsx', '.xls', '.csv']
        import os
        ext = os.path.splitext(value.name)[1].lower()
        if ext not in allowed_extensions:
            raise serializers.ValidationError(
                f"File type not supported. Allowed types: {', '.join(allowed_extensions)}"
            )
        
        # Check file size (max 10MB)
        max_size = 10 * 1024 * 1024  # 10MB
        if value.size > max_size:
            raise serializers.ValidationError(f"File size exceeds {max_size/1024/1024}MB limit")
        
        return value
    
    def create(self, validated_data):
        """Process the uploaded file and create attendance records"""
        request = self.context.get('request')
        file = validated_data['file']
        
        # Create import log
        import_log = AttendanceImportLog.objects.create(
            file_name=file.name,
            file_size=file.size,
            imported_by=request.user.employee if hasattr(request.user, 'employee') else None
        )
        
        try:
            # Process the file
            result = self.process_attendance_file(file, import_log)
            
            # Update import log with results
            import_log.total_records = result['total_records']
            import_log.imported_records = result['imported_records']
            import_log.failed_records = result['failed_records']
            import_log.duplicate_records = result['duplicate_records']
            import_log.import_result = result['import_result']
            import_log.completed_at = timezone.now()
            import_log.save()

            # Nạp xong chấm công -> chạy lại đối soát vi phạm, LƯU VẾT và báo
            # HCNS. HCNS 2026-10-12: "Phải làm sao để khi nạp chấm công
            # xong nó tự động chạy lại".
            #
            # Trước đó loại lỗi "Nghỉ không tạo đơn" chỉ suy được từ chấm công,
            # mà chấm công vào theo đợt đầu tháng sau — nên giữa tháng báo cáo
            # trông sạch dù chưa có dữ liệu, và sau khi nạp thì KHÔNG AI ĐƯỢC
            # BÁO. Best-effort: lỗi ở đây tuyệt đối không được làm hỏng đợt nạp.
            self._record_violations_after_import(import_log, result)
            
            return {
                'success': True,
                'import_log_id': import_log.id,
                'import_code': import_log.import_code,
                'message': f"Successfully imported {result['imported_records']} attendance records",
                'details': result
            }
            
        except Exception as e:
            # Log error
            error_message = str(e)
            error_traceback = traceback.format_exc()
            logger.error(f"Attendance import failed: {error_message}\n{error_traceback}")
            
            # Update import log with error
            import_log.error_log = f"{error_message}\n\n{error_traceback}"
            import_log.failed_records = import_log.total_records
            import_log.save()
            
            return {
                'success': False,
                'import_log_id': import_log.id,
                'import_code': import_log.import_code,
                'message': f"Import failed: {error_message}",
                'error_details': error_traceback
            }
    
    def _record_violations_after_import(self, import_log, result):
        """Lưu vết đối soát vi phạm cho các tháng mà đợt nạp vừa chạm vào.

        Bọc try/except toàn bộ: nạp chấm công quan trọng hơn báo cáo, hỏng báo
        cáo thì log rồi thôi — KHÔNG để đợt nạp thất bại theo.
        """
        import datetime as _dt
        try:
            rng = (result or {}).get('touched_date_range')
            if not rng:
                return
            first = _dt.date.fromisoformat(rng[0])
            last = _dt.date.fromisoformat(rng[1])

            from .violation_ledger import record_violation_snapshot, months_in_range
            from .violation_models import ViolationLedgerRun

            runs = []
            for year, month in months_in_range(first, last):
                runs.append(record_violation_snapshot(
                    year, month,
                    source=ViolationLedgerRun.Source.IMPORT,
                    import_log=import_log,
                    triggered_by=import_log.imported_by,
                    note=f"Tự chạy sau đợt nạp {import_log.import_code}",
                ))
            self._notify_hr_after_import(import_log, runs)
        except Exception:
            logger.exception(
                "[violation_ledger] Lỗi lưu vết đối soát sau đợt nạp %s -> bỏ qua, "
                "không ảnh hưởng kết quả nạp chấm công", getattr(import_log, 'import_code', '?'))

    def _notify_hr_after_import(self, import_log, runs):
        """Báo HCNS/Admin rằng số liệu đối soát vừa đổi."""
        if not runs:
            return
        try:
            from django.db.models import Q
            from employee.models import Employee
            from users.notification_service import NotificationService
            from .models import _is_hr_or_admin_broad

            # Lọc ở TẦNG DB trước rồi mới chạy vị từ đầy đủ. Duyệt cả 2.962
            # nhân viên ở Python sẽ bắn ngần ấy query ngay trong lượt upload
            # chấm công — không chấp nhận được. Điều kiện dưới phủ đúng các
            # nhánh của _is_hr_or_admin_broad (is_staff/is_superuser, is_hr,
            # tên chức danh/phòng ban chứa HR hoặc "nhân sự").
            candidates = (
                Employee.objects
                .filter(user__isnull=False)
                .filter(Q(user__is_staff=True) | Q(user__is_superuser=True)
                        | Q(is_hr=True)
                        | Q(position__title__icontains='HR')
                        | Q(position__title__icontains='nhân sự')
                        | Q(department__name__icontains='HR')
                        | Q(department__name__icontains='nhân sự'))
                .select_related('user', 'position', 'department')[:300]
            )
            targets = [e.user_id for e in candidates if _is_hr_or_admin_broad(e.user, e)]
            if not targets:
                return
            lines = [
                f"{r.month:02d}/{r.year}: {r.total_rows} dòng "
                f"({r.new_rows} mới, {r.changed_rows} đổi), "
                f"tổng {r.total_penalty:,.0f} đ".replace(",", ".")
                for r in runs
            ]
            NotificationService.create_notification(
                title="Đối soát vi phạm đơn từ đã cập nhật",
                content=(f"Đã nạp chấm công {import_log.import_code}. " + " · ".join(lines)),
                notification_type="violation_report",
                target_user_ids=targets,
                data={"import_code": import_log.import_code,
                      "run_ids": [r.id for r in runs]},
            )
        except Exception:
            logger.exception("[violation_ledger] Không gửi được thông báo cho HCNS")

    def process_attendance_file(self, file, import_log):
        """Process the attendance Excel/CSV file with optimized performance"""
        from django.db import transaction
        from datetime import datetime, timedelta
        import time
        
        start_time = time.time()
        
        # Check file size and warn if too large
        file_size_mb = file.size / (1024 * 1024)
        if file_size_mb > 5:  # Warn for files larger than 5MB
            logger.warning(f"Large file detected: {file_size_mb:.2f}MB. Processing may take longer.")
        
        # Read the file with chunking for very large files
        file_ext = file.name.split('.')[-1].lower()
        
        # For very large files, we might need to read in chunks
        # But for now, read the whole file since we need to process all rows
        if file_ext in ['xlsx', 'xls']:
            # Dò đúng dòng header thật thay vì mặc định cứng header=1 — file mẫu
            # HR đưa lên không thống nhất: có file có dòng tiêu đề/banner phía
            # trên dòng header thật, có file header nằm ngay dòng đầu tiên. Trước
            # đây hardcode header=1 khiến file "header ở dòng đầu" bị đọc sai
            # (dòng dữ liệu đầu tiên bị hiểu nhầm thành header) -> mọi dòng đều
            # fail "Employee code not found" mà không báo lỗi rõ cho HR.
            header_row = _detect_attendance_header_row(file, file_ext)
            try:
                df = pd.read_excel(file, header=header_row)
            except Exception as e:
                # Try without header parameter
                df = pd.read_excel(file)

            # kiểm tra header hiện tại có chứa "đến ngày" không (file có 2 dòng
            # banner phía trên header thật)
            if any("đến ngày" in str(col).lower() for col in df.columns):
                # lấy dòng đầu tiên làm header mới
                df.columns = df.iloc[0]
                # bỏ dòng header cũ
                df = df.iloc[1:].reset_index(drop=True)

        elif file_ext == 'csv':
            header_row = _detect_attendance_header_row(file, file_ext)
            df = pd.read_csv(file, header=header_row)
        else:
            raise ValueError(f"Unsupported file format: {file_ext}")
        
        # Clean column names
        df.columns = [str(col).strip() for col in df.columns]
        
        # Log the columns for debugging
        logger.info(f"File columns: {list(df.columns)}")
        logger.info(f"Total rows to process: {len(df)}")
        
        # Warn if too many rows
        if len(df) > 10000:
            logger.warning(f"Large number of rows: {len(df)}. Processing may take significant time.")
        
        # Initialize results
        results = {
            'total_records': len(df),
            'imported_records': 0,
            'failed_records': 0,
            'duplicate_records': 0,
            'import_result': {
                'successful': [],
                'failed': [],
                'duplicates': []
            }
        }
        
        # Helper function to convert date objects to strings for JSON serialization
        def convert_date_to_string(obj):
            """Recursively convert date objects to ISO format strings"""
            if isinstance(obj, dict):
                return {k: convert_date_to_string(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_date_to_string(item) for item in obj]
            elif hasattr(obj, 'isoformat'):  # Check if it's a date/datetime object
                return obj.isoformat()
            else:
                return obj
        
        # Phase 1: Collect all employee codes and dates for batch processing
        employee_codes = set()
        rows_data = []
        
        for index, row in df.iterrows():
            try:
                # Extract employee code
                employee_code = None
                possible_code_columns = ['Mã nhân viên', 'Mã NV', 'Employee Code', 'Code', 'Mã', 'Mã N.Viên']
                for col in possible_code_columns:
                    if col in df.columns:
                        employee_code = str(row[col]).strip()
                        if pd.notna(employee_code) and employee_code != 'nan':
                            break
                
                if not employee_code or employee_code == 'nan':
                    results['failed_records'] += 1
                    results['import_result']['failed'].append({
                        'row': index + 2,
                        'employee_code': None,
                        'error': 'Employee code not found'
                    })
                    continue
                
                # Extract attendance date
                attendance_date = None
                possible_date_columns = ['Ngày', 'Date', 'Ngày Thứ', 'Attendance Date']
                for col in possible_date_columns:
                    if col in df.columns:
                        date_val = row[col]
                        if pd.notna(date_val):
                            try:
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
                                    break
                            except:
                                continue
                
                if not attendance_date:
                    results['failed_records'] += 1
                    results['import_result']['failed'].append({
                        'row': index + 2,
                        'employee_code': employee_code,
                        'error': 'Could not parse attendance date'
                    })
                    continue
                
                # Extract check-in and check-out times
                check_in = None
                check_out = None
                
                # Try different column names for check-in
                possible_checkin_columns = ['Giờ vào', 'Check In', 'In Time', 'Giờ vào thực tế', 'Vào', 'Vào 1']
                for col in possible_checkin_columns:
                    if col in df.columns:
                        checkin_val = row[col]
                        if pd.notna(checkin_val):
                            try:
                                if isinstance(checkin_val, str):
                                    checkin_val = checkin_val.strip()
                                    for fmt in ['%H:%M:%S', '%H:%M', '%H.%M', '%H,%M']:
                                        try:
                                            check_in = pd.to_datetime(checkin_val, format=fmt).time()
                                            break
                                        except:
                                            continue
                                    if not check_in:
                                        try:
                                            check_in = pd.to_datetime(checkin_val).time()
                                        except:
                                            pass
                                else:
                                    check_in = pd.to_datetime(checkin_val).time()
                                
                                if check_in:
                                    break
                            except:
                                continue
                
                # Try different column names for check-out
                possible_checkout_columns = ['Giờ ra', 'Check Out', 'Out Time', 'Giờ ra thực tế', 'Ra', 'Ra 1']
                for col in possible_checkout_columns:
                    if col in df.columns:
                        checkout_val = row[col]
                        if pd.notna(checkout_val):
                            try:
                                if isinstance(checkout_val, str):
                                    checkout_val = checkout_val.strip()
                                    for fmt in ['%H:%M:%S', '%H:%M', '%H.%M', '%H,%M']:
                                        try:
                                            check_out = pd.to_datetime(checkout_val, format=fmt).time()
                                            break
                                        except:
                                            continue
                                    if not check_out:
                                        try:
                                            check_out = pd.to_datetime(checkout_val).time()
                                        except:
                                            pass
                                else:
                                    check_out = pd.to_datetime(checkout_val).time()
                                
                                if check_out:
                                    break
                            except:
                                continue
                
                # Store row data for processing
                employee_codes.add(employee_code)
                rows_data.append({
                    'index': index,
                    'row_num': index + 2,
                    'employee_code': employee_code,
                    'attendance_date': attendance_date,
                    'check_in': check_in,
                    'check_out': check_out,
                    'original_row': row
                })
                
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Error extracting data from row {index}: {error_msg}")
                results['failed_records'] += 1
                results['import_result']['failed'].append({
                    'row': index + 2,
                    'employee_code': None,
                    'error': f'Data extraction error: {error_msg}'
                })
        
        logger.info(f"Phase 1 completed: {len(rows_data)} valid rows extracted, {len(employee_codes)} unique employee codes")
        
        # Phase 2: Batch fetch employees
        employees_by_code = {}
        if employee_codes:
            employees = Employee.objects.filter(employee_id__in=list(employee_codes))
            employees_by_code = {emp.employee_id: emp for emp in employees}
            logger.info(f"Fetched {len(employees_by_code)} employees from database")
        
        # Phase 3: Process rows in batches
        from django.db.models import Q
        batch_size = 100
        attendance_to_create = []
        attendance_to_update = []
        employee_events_to_create = []
        employee_events_to_update = []

        # Track existing attendances and events for batch lookup
        existing_attendances_map = {}
        existing_events_map = {}
        # Keys already queued across ALL batches — prevents duplicate CREATE
        # when the same (employee, date) appears in multiple rows of the file
        processed_attendance_keys = set()
        processed_event_keys = set()

        # Process in batches to avoid memory issues
        for i in range(0, len(rows_data), batch_size):
            batch = rows_data[i:i + batch_size]

            # Batch fetch existing attendances for this batch using exact pairs (not cross-product)
            employee_date_pairs = []
            for row_data in batch:
                employee = employees_by_code.get(row_data['employee_code'])
                if employee:
                    pair = (employee.id, row_data['attendance_date'])
                    if pair not in employee_date_pairs:
                        employee_date_pairs.append(pair)

            if employee_date_pairs:
                att_filter = Q()
                for emp_id, att_date in employee_date_pairs:
                    att_filter |= Q(employee_id=emp_id, attendance_date=att_date)

                existing_attendances = Attendance.objects.filter(att_filter).select_related('employee')
                for att in existing_attendances:
                    key = (att.employee_id, att.attendance_date)
                    existing_attendances_map[key] = att

                event_filter = Q()
                for emp_id, att_date in employee_date_pairs:
                    event_filter |= Q(
                        employee_id=emp_id,
                        event_date=att_date,
                        event_type=EmployeeEvent.EventType.ATTENDANCE
                    )
                for event in EmployeeEvent.objects.filter(event_filter):
                    key = (event.employee_id, event.event_date, EmployeeEvent.EventType.ATTENDANCE)
                    existing_events_map[key] = event

            # Cache cho lone_punch_is_checkout() — gọi tối đa 1 lần/dòng file.
            _lp_shift_cache, _lp_reg_cache, _lp_cand_cache = {}, {}, {}

            # Process each row in the batch
            for row_data in batch:
                try:
                    employee = employees_by_code.get(row_data['employee_code'])
                    if not employee:
                        # Employee not found - already counted as failed in phase 1
                        continue

                    attendance_date = row_data['attendance_date']
                    file_check_in = row_data['check_in']
                    file_check_out = row_data['check_out']

                    # File chỉ có ĐÚNG 1 lần chấm (luôn nằm ở cột "Vào"): xác định
                    # lại theo ca của chính nhân viên ngày đó — gần giờ tan ca hơn
                    # thì đó là giờ RA (quên chấm lúc đến, chỉ chấm lúc về). Xem
                    # shift_config_utils.lone_punch_is_checkout().
                    lone_punch_moved = False
                    if file_check_in and not file_check_out and attendance_date:
                        try:
                            if lone_punch_is_checkout(employee, attendance_date, file_check_in,
                                                      _lp_shift_cache, _lp_reg_cache, _lp_cand_cache):
                                file_check_in, file_check_out = None, file_check_in
                                lone_punch_moved = True
                        except Exception:
                            logger.exception("[LonePunch] Không phân loại được NV=%s ngày=%s -> giữ nguyên",
                                             employee.employee_id, attendance_date)

                    # Check for existing attendance in DB map OR already queued in this session
                    attendance_key = (employee.id, attendance_date)
                    existing_attendance = existing_attendances_map.get(attendance_key)

                    if existing_attendance:
                        check_in = file_check_in or existing_attendance.check_in
                        check_out = file_check_out or existing_attendance.check_out
                        # Tải lại đúng file cũ (lần trước đã lưu nhầm giờ ra vào cột
                        # giờ vào): đừng ghép lại giờ vào cũ trùng chính lần chấm này.
                        if lone_punch_moved and check_in == check_out:
                            check_in = None
                    else:
                        check_in = file_check_in
                        check_out = file_check_out

                    # Determine status từ giá trị đã merge (không phải giá trị thô của file)
                    if check_in and check_out:
                        status = 'PRESENT'
                    elif check_in or check_out:
                        status = 'HALF_DAY'
                    else:
                        status = 'ABSENT'

                    # File không đóng góp dữ liệu mới nào cho ngày này (không có giờ vào lẫn
                    # giờ ra) trong khi đã có bản ghi thật — giữ nguyên, không tạo thay đổi rỗng.
                    if existing_attendance and not file_check_in and not file_check_out:
                        results['duplicate_records'] += 1
                        results['import_result']['duplicates'].append({
                            'row': row_data['row_num'],
                            'employee_code': row_data['employee_code'],
                            'attendance_date': attendance_date,
                            'existing_id': existing_attendance.id,
                            'action': 'kept_existing_no_device_data'
                        })
                        continue

                    # Prepare attendance data
                    attendance_data = {
                        'employee': employee,
                        'attendance_date': attendance_date,
                        'check_in': check_in,
                        'check_out': check_out,
                        'status': status,
                        'shift_type': 'FULL_DAY',
                        'imported_from_file': file.name,
                        'import_batch': import_log.import_code,
                        'created_by': import_log.imported_by
                    }

                    if existing_attendance:
                        # Update existing attendance record from DB
                        for field, value in attendance_data.items():
                            if field not in ['employee', 'attendance_date']:
                                setattr(existing_attendance, field, value)

                        if check_in and check_out:
                            check_in_dt = datetime.combine(attendance_date, check_in)
                            check_out_dt = datetime.combine(attendance_date, check_out)
                            if check_out <= check_in:
                                check_out_dt = datetime.combine(attendance_date + timedelta(days=1), check_out)
                            existing_attendance.working_hours = (check_out_dt - check_in_dt).total_seconds() / 3600

                        # Only append once — avoid duplicate updates from repeated rows in file
                        if attendance_key not in processed_attendance_keys:
                            attendance_to_update.append(existing_attendance)
                        processed_attendance_keys.add(attendance_key)
                        attendance = existing_attendance
                        is_duplicate = True
                    elif attendance_key in processed_attendance_keys:
                        # Row is a within-file duplicate of a row already queued for CREATE.
                        # Skip to avoid unique constraint violation on bulk_create.
                        results['duplicate_records'] += 1
                        results['import_result']['duplicates'].append({
                            'row': row_data['row_num'],
                            'employee_code': row_data['employee_code'],
                            'attendance_date': attendance_date,
                            'existing_id': None,
                            'action': 'skipped_within_file_duplicate'
                        })
                        continue
                    else:
                        # Create new attendance
                        attendance = Attendance(**attendance_data)

                        if check_in and check_out:
                            check_in_dt = datetime.combine(attendance_date, check_in)
                            check_out_dt = datetime.combine(attendance_date, check_out)
                            if check_out <= check_in:
                                check_out_dt = datetime.combine(attendance_date + timedelta(days=1), check_out)
                            attendance.working_hours = (check_out_dt - check_in_dt).total_seconds() / 3600

                        attendance_to_create.append(attendance)
                        processed_attendance_keys.add(attendance_key)
                        is_duplicate = False

                    # Prepare EmployeeEvent data
                    event_key = (employee.id, attendance_date, EmployeeEvent.EventType.ATTENDANCE)
                    existing_event = existing_events_map.get(event_key)

                    event_data = {
                        'employee': employee,
                        'event_date': attendance_date,
                        'event_type': EmployeeEvent.EventType.ATTENDANCE,
                        'check_in': check_in,
                        'check_out': check_out,
                        'created_by': import_log.imported_by,
                        'data': {
                            'attendance_id': attendance.id if hasattr(attendance, 'id') else None,
                            'status': status,
                            'import_source': 'attendance_upload'
                        }
                    }

                    if existing_event:
                        for field, value in event_data.items():
                            if field not in ['employee', 'event_date', 'event_type']:
                                setattr(existing_event, field, value)
                        if event_key not in processed_event_keys:
                            employee_events_to_update.append(existing_event)
                        processed_event_keys.add(event_key)
                    elif event_key not in processed_event_keys:
                        event = EmployeeEvent(**event_data)
                        employee_events_to_create.append(event)
                        processed_event_keys.add(event_key)

                    # Update results
                    if is_duplicate:
                        results['duplicate_records'] += 1
                        results['import_result']['duplicates'].append({
                            'row': row_data['row_num'],
                            'employee_code': row_data['employee_code'],
                            'attendance_date': attendance_date,
                            'existing_id': existing_attendance.id if existing_attendance else None,
                            'action': 'updated'
                        })
                    else:
                        results['imported_records'] += 1
                        results['import_result']['successful'].append({
                            'row': row_data['row_num'],
                            'employee_code': row_data['employee_code'],
                            'attendance_date': attendance_date,
                            'attendance_id': None,
                            'check_in': str(check_in) if check_in else None,
                            'check_out': str(check_out) if check_out else None,
                            'status': status,
                            'action': 'created'
                        })

                except Exception as e:
                    error_msg = str(e)
                    logger.error(f"Error processing row {row_data['row_num']}: {error_msg}")
                    results['failed_records'] += 1
                    results['import_result']['failed'].append({
                        'row': row_data['row_num'],
                        'employee_code': row_data['employee_code'],
                        'error': error_msg
                    })

            # Clear per-batch maps; processed_attendance_keys persists across all batches
            existing_attendances_map.clear()
            existing_events_map.clear()
        
        logger.info(f"Phase 3 completed: Processed {len(rows_data)} rows")
        
        # Phase 4: Generate attendance codes for all records
        import uuid
        from django.utils import timezone as django_timezone
        
        # Generate unique attendance codes for new records
        # We need to ensure each code is unique, so we'll use a counter
        base_timestamp = django_timezone.now().strftime('%Y%m%d%H%M%S')
        base_microsecond = django_timezone.now().microsecond
        
        # First, handle new records
        for i, attendance in enumerate(attendance_to_create):
            if not attendance.attendance_code or attendance.attendance_code == '':
                # Use index to ensure uniqueness even if timestamps are the same
                unique_suffix = f"{base_microsecond:06d}-{i:06d}-{str(uuid.uuid4())[:8]}"
                attendance.attendance_code = f"ATT-{base_timestamp}-{unique_suffix}"
        
        # Also check existing records that are being updated
        # They might have empty attendance_code too
        for i, attendance in enumerate(attendance_to_update):
            if not attendance.attendance_code or attendance.attendance_code == '':
                # Generate a unique code for this existing record too
                unique_suffix = f"{base_microsecond:06d}-U{i:06d}-{str(uuid.uuid4())[:8]}"
                attendance.attendance_code = f"ATT-{base_timestamp}-{unique_suffix}"
        
        # Phase 5: Save all data in transactions
        try:
            with transaction.atomic():
                # Bulk create new attendances
                if attendance_to_create:
                    created_attendances = Attendance.objects.bulk_create(
                        attendance_to_create, ignore_conflicts=True
                    )
                    logger.info(f"Created {len(created_attendances)} new attendance records")
                    
                    # Update attendance IDs in successful results
                    attendance_id_map = {}
                    for att in created_attendances:
                        key = (att.employee_id, att.attendance_date)
                        attendance_id_map[key] = att.id
                    
                    # Also need to update attendance IDs in employee events
                    for event in employee_events_to_create:
                        key = (event.employee_id, event.event_date)
                        if key in attendance_id_map:
                            if 'data' in event.__dict__:
                                event.data['attendance_id'] = attendance_id_map[key]
                    
                    # Update successful results with attendance IDs
                    for success in results['import_result']['successful']:
                        employee = employees_by_code.get(success['employee_code'])
                        if employee:
                            key = (employee.id, success['attendance_date'])
                            if key in attendance_id_map:
                                success['attendance_id'] = attendance_id_map[key]
                
                # Bulk update existing attendances
                if attendance_to_update:
                    fields_to_update = ['check_in', 'check_out', 'status', 'shift_type', 
                                      'imported_from_file', 'import_batch', 'created_by', 'working_hours', 'attendance_code']
                    Attendance.objects.bulk_update(attendance_to_update, fields_to_update)
                    logger.info(f"Updated {len(attendance_to_update)} existing attendance records")
                
                # Bulk create new employee events
                if employee_events_to_create:
                    EmployeeEvent.objects.bulk_create(
                        employee_events_to_create, ignore_conflicts=True
                    )
                    logger.info(f"Created {len(employee_events_to_create)} new employee events")
                
                # Bulk update existing employee events
                if employee_events_to_update:
                    fields_to_update = ['check_in', 'check_out', 'created_by', 'data']
                    EmployeeEvent.objects.bulk_update(employee_events_to_update, fields_to_update)
                    logger.info(f"Updated {len(employee_events_to_update)} existing employee events")
                
        except Exception as e:
            logger.error(f"Error saving batch data: {str(e)}")
            raise

        # Đối soát tăng ca ONSITE với giờ chấm công vừa upload (yêu cầu HCNS
        # 2026-09-18: "sau khi máy chấm công up data lên thì auto đối chiếu
        # giờ out lại đối với giờ out của đơn tăng ca"). Chạy SAU KHI đã
        # commit xong dữ liệu chấm công (ngoài transaction.atomic() ở trên)
        # và KHÔNG được để lỗi ở đây làm hỏng cả lượt upload chấm công chính
        # — best-effort, chỉ log cảnh báo nếu có lỗi.
        try:
            touched_pairs = {
                (event.employee_id, event.event_date)
                for event in (employee_events_to_create + employee_events_to_update)
            }
            if touched_pairs:
                touched_employee_ids = {emp_id for emp_id, _ in touched_pairs}
                employees_by_id = {
                    e.id: e for e in Employee.objects.filter(id__in=touched_employee_ids)
                }
                pairs_with_employee = [
                    (employees_by_id.get(emp_id), event_date)
                    for emp_id, event_date in touched_pairs
                    if employees_by_id.get(emp_id)
                ]
                from .overtime_reconciliation import reconcile_onsite_overtime
                flagged = reconcile_onsite_overtime(pairs_with_employee)
                if flagged:
                    logger.info(
                        "[overtime_reconciliation] %d đơn tăng ca ONSITE có phát hiện cần xem sau khi upload chấm công",
                        len(flagged),
                    )
        except Exception:
            logger.exception("[overtime_reconciliation] Lỗi đối soát tăng ca sau khi upload chấm công -> bỏ qua, không ảnh hưởng kết quả upload")

        # Khoảng ngày mà đợt nạp này CHẠM VÀO — dùng để biết phải chạy lại
        # đối soát vi phạm cho những tháng nào (xem create()). Lấy từ chính
        # các event vừa ghi, không đoán theo tên file.
        try:
            touched = sorted({
                event.event_date
                for event in (employee_events_to_create + employee_events_to_update)
                if event.event_date
            })
            results['touched_date_range'] = (
                [touched[0].isoformat(), touched[-1].isoformat()] if touched else None
            )
        except Exception:
            logger.exception("[violation_ledger] Không xác định được khoảng ngày của đợt nạp")
            results['touched_date_range'] = None

        # Phase 5: Finalize results
        end_time = time.time()
        processing_time = end_time - start_time
        
        logger.info(f"Attendance import completed in {processing_time:.2f} seconds")
        logger.info(f"Results: {results['imported_records']} imported, {results['duplicate_records']} duplicates, {results['failed_records']} failed")
        
        # Convert date objects to strings for JSON serialization
        results['import_result'] = convert_date_to_string(results['import_result'])
        
        return results
    
    def create_or_update_employee_event(self, employee, attendance_date, check_in, check_out, status, 
                                       attendance_id, created_by):
        """
        Create or update EmployeeEvent record for attendance
        (Kept for backward compatibility, but bulk operations are preferred)
        """
        try:
            # Check if EmployeeEvent already exists for this employee and date
            existing_event = EmployeeEvent.objects.filter(
                employee=employee,
                event_date=attendance_date,
                event_type=EmployeeEvent.EventType.ATTENDANCE
            ).first()
            
            # Prepare data for EmployeeEvent
            event_data = {
                'employee': employee,
                'event_date': attendance_date,
                'event_type': EmployeeEvent.EventType.ATTENDANCE,
                'check_in': check_in,
                'check_out': check_out,
                'created_by': created_by,
                'data': {
                    'attendance_id': attendance_id,
                    'status': status,
                    'import_source': 'attendance_upload'
                }
            }
            
            if existing_event:
                # Update existing EmployeeEvent
                for field, value in event_data.items():
                    if field != 'employee' and field != 'event_date' and field != 'event_type':
                        setattr(existing_event, field, value)
                existing_event.save()
                logger.info(f"Updated EmployeeEvent for employee {employee.employee_id} on {attendance_date}")
                return existing_event
            else:
                # Create new EmployeeEvent
                event = EmployeeEvent.objects.create(**event_data)
                logger.info(f"Created EmployeeEvent for employee {employee.employee_id} on {attendance_date}")
                return event
                
        except Exception as e:
            logger.error(f"Error creating/updating EmployeeEvent: {str(e)}")
            # Don't raise exception to avoid breaking attendance import
            return None


class AttendanceUploadResponseSerializer(serializers.Serializer):
    """Serializer for attendance upload response"""
    success = serializers.BooleanField()
    import_log_id = serializers.IntegerField()
    import_code = serializers.CharField()
    message = serializers.CharField()
    details = serializers.DictField(required=False)
    error_details = serializers.CharField(required=False)
