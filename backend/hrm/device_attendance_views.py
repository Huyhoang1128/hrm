"""
hrm/device_attendance_views.py
══════════════════════════════
API nhận dữ liệu chấm công từ máy ZKTeco qua IT support tool.

Xác thực: JWT của một nhân viên HR (Authorization: Bearer <access_token>).
HR login vào sync web app → app lưu JWT →
gọi endpoint này → BE biết HR nào đã trigger sync (audit trên DeviceAPICallLog).

Endpoint:
  POST /api/v1/hrm/attendance-device/push/

Kết quả ghi DB phải tương đương luồng "Upload chấm công" từ file
(hrm/upload_serializers.py) để HCNS có thể bỏ việc upload file ngày 15:
  - EmployeeEvent(attendance)  — nguồn engine tính công đọc khi replay
  - Attendance (bảng cũ)       — vẫn còn vài màn/engine cũ đọc
  - lần chấm DUY NHẤT trong ngày xếp vào giờ vào hay giờ ra theo ca
    (lone_punch_is_checkout), như khi upload file
  - đối soát tăng ca ONSITE (reconcile_onsite_overtime) cho ngày đã trọn vẹn
"""

import logging
import time
from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from employee.models import Employee
from hrm.event_models import EmployeeEvent
from hrm.attendance_models import DeviceAPICallLog
from hrm.models import Attendance, EmployeePermission
from hrm.shift_config_utils import lone_punch_is_checkout

logger = logging.getLogger(__name__)

PUNCH_IN = 0
PUNCH_OUT = 1

# Giới hạn số records để lưu raw payload vào log (tránh DB quá nặng)
MAX_RECORDS_FOR_PAYLOAD_LOGGING = 200

# Hai lần quẹt cách nhau dưới ngưỡng này coi là CÙNG 1 lần chấm (nhân viên bấm
# lại vì máy chưa kêu) — giống "khoảng cách tối thiểu giữa 2 lần chấm" của phần
# mềm chấm công khi xuất file. Không gộp thì 08:00 + 08:02 thành vào 08:00 /
# ra 08:02: thay vì "quên chấm công ra", ngày đó bị tính về sớm cả ngày.
DUPLICATE_PUNCH_WINDOW = timedelta(minutes=5)

DEVICE_IMPORT_SOURCE = "device_push"


def _get_client_ip(request) -> str | None:
    """Lấy IP thực của client (hỗ trợ reverse proxy)."""
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _is_hr_user(user) -> bool:
    """
    Kiểm tra user có phải nhân viên HR không.
    True nếu là superuser/staff, hoặc Employee.is_hr,
    hoặc EmployeePermission.can_manage_attendance / can_import_attendance.
    """
    if not user or not user.is_authenticated:
        return False
    if user.is_staff or user.is_superuser:
        return True
    try:
        employee = Employee.objects.select_related("permissions").get(user=user)
        if employee.is_hr:
            return True
        perm = getattr(employee, "permissions", None)
        if perm and (perm.can_manage_attendance or perm.can_import_attendance):
            return True
    except (Employee.DoesNotExist, EmployeePermission.DoesNotExist):
        pass
    return False


class DeviceAttendancePushView(APIView):
    """
    POST /api/v1/hrm/attendance-device/push/

    Request body:
    {
        "records": [
            {
                "device_user_id": "NV00001",
                "punch_time": "2026-04-21T08:05:30",
                "punch": 0,
                "device_name": "MCC00001"
            }
        ]
    }
    device_user_id: mã nhân viên HRM (tool sync đã dịch từ mã chấm công trên máy).
    punch: 0 = check_in, 1 = check_out — chỉ lưu lại, KHÔNG dùng để chia vào/ra
    (xem _derive_check_times).

    Response: {processed, skipped, days_updated, errors, details}

    Authentication: JWT (Authorization: Bearer <access_token>) của nhân viên HR
    hoặc tài khoản có quyền import chấm công (job tự động dùng tài khoản riêng).
    Mọi gọi đều được audit qua DeviceAPICallLog (kể cả 401/403).
    """

    permission_classes = [IsAuthenticated]

    def _collect_device_names(self, records: list) -> str:
        """Lấy tên thiết bị đại diện từ danh sách records."""
        names = {
            str(r.get("device_name", "")).strip()
            for r in records
            if isinstance(r, dict) and r.get("device_name")
        }
        return ", ".join(sorted(names))[:100]

    def post(self, request):
        start_ts = time.monotonic()
        caller_ip = _get_client_ip(request)

        # JWT đã pass IsAuthenticated → user.is_authenticated == True.
        # Tiếp tục check user có phải nhân viên HR không.
        if not _is_hr_user(request.user):
            duration_ms = int((time.monotonic() - start_ts) * 1000)
            records_preview = request.data.get("records", []) if isinstance(request.data, dict) else []
            _save_call_log(
                device_name=self._collect_device_names(records_preview if isinstance(records_preview, list) else []),
                caller_ip=caller_ip,
                user_agent=request.META.get("HTTP_USER_AGENT", ""),
                api_endpoint=request.path,
                http_method=request.method,
                secret_used=str(request.user),
                auth_success=False,
                total_records=len(records_preview) if isinstance(records_preview, list) else 0,
                processed=0,
                skipped=0,
                error_count=0,
                response_status=403,
                duration_ms=duration_ms,
                request_payload=None,
                errors_detail=None,
            )
            logger.warning(
                "[DeviceAttendancePush] Non-HR user %s tried to push attendance from ip=%s",
                request.user, caller_ip,
            )
            return Response(
                {"error": "Chỉ nhân viên HR mới được sync chấm công."},
                status=403,
            )

        records = request.data.get("records", [])
        if not isinstance(records, list):
            return Response({"error": "records phải là danh sách"}, status=400)

        errors = []
        today = timezone.localdate()

        # Gom theo (nhân viên, ngày): giờ vào/ra là kết quả của CẢ NGÀY, tính
        # 1 lần cho mỗi ngày thay vì 1 lần cho mỗi lượt quẹt.
        employee_cache: dict[str, Employee | None] = {}
        day_groups: dict[tuple, dict] = {}

        for idx, record in enumerate(records):
            if not isinstance(record, dict):
                errors.append({"index": idx, "device_user_id": None, "error": "Record phải là object"})
                continue
            device_user_id = str(record.get("device_user_id", "")).strip()
            punch_time_str = str(record.get("punch_time", "") or "").strip()
            punch = record.get("punch")
            device_name = str(record.get("device_name") or "unknown").strip()

            if not device_user_id or not punch_time_str or punch is None:
                errors.append({
                    "index": idx,
                    "device_user_id": device_user_id,
                    "error": "Thiếu device_user_id, punch_time hoặc punch",
                })
                continue

            try:
                punch_dt = _parse_punch_time(punch_time_str)
            except ValueError:
                errors.append({
                    "index": idx,
                    "device_user_id": device_user_id,
                    "error": f"punch_time không đúng định dạng ISO: {punch_time_str}",
                })
                continue

            # Đồng hồ máy chấm công bị lệch (sau mất điện có máy nhảy sang năm
            # sau) — ghi vào sẽ tạo ngày công ma, nên từ chối và báo lỗi.
            if punch_dt.date() > today:
                errors.append({
                    "index": idx,
                    "device_user_id": device_user_id,
                    "error": f"punch_time {punch_time_str} ở tương lai — kiểm tra đồng hồ máy {device_name}",
                })
                continue

            if device_user_id not in employee_cache:
                employee_cache[device_user_id] = (
                    Employee.objects.filter(employee_id=device_user_id).first()
                )
            employee = employee_cache[device_user_id]
            if employee is None:
                errors.append({
                    "index": idx,
                    "device_user_id": device_user_id,
                    "error": f"Không tìm thấy nhân viên với mã '{device_user_id}'",
                })
                continue

            group = day_groups.setdefault(
                (employee.id, punch_dt.date()),
                {"employee": employee, "date": punch_dt.date(), "punches": []},
            )
            group["punches"].append({
                "index": idx,
                "punch_time": punch_time_str,
                "punch_dt": punch_dt,
                "punch": punch,
                "device": device_name,
            })

        created_by = _employee_of(request.user)
        lone_punch_caches = ({}, {}, {})
        processed = 0
        skipped = 0
        days_updated = 0
        details = []
        reconcile_pairs = []

        for group in day_groups.values():
            employee = group["employee"]
            try:
                outcome = _apply_day_punches(
                    employee=employee,
                    event_date=group["date"],
                    punches=group["punches"],
                    created_by=created_by,
                    lone_punch_caches=lone_punch_caches,
                )
            except Exception:
                logger.exception(
                    "[DeviceAttendancePush] Lỗi ghi chấm công NV=%s ngày=%s",
                    employee.employee_id, group["date"],
                )
                for p in group["punches"]:
                    errors.append({
                        "index": p["index"],
                        "device_user_id": employee.employee_id,
                        "error": "Lỗi xử lý dữ liệu, vui lòng kiểm tra log hệ thống",
                    })
                continue

            if outcome["changed"]:
                days_updated += 1
                # Đối soát tăng ca chỉ chạy khi ngày đã trọn vẹn: đẩy giữa ngày
                # mới có lượt vào, đối soát lúc đó sẽ báo sai "về sớm hơn đăng ký".
                if group["date"] < today:
                    reconcile_pairs.append((employee, group["date"]))

            for p in group["punches"]:
                is_new = p["index"] in outcome["new_indexes"]
                if is_new:
                    processed += 1
                else:
                    skipped += 1
                details.append({
                    "employee_id":   employee.employee_id,
                    "employee_name": employee.full_name,
                    "date":          str(group["date"]),
                    "time":          str(p["punch_dt"].time()),
                    "punch":         "IN" if p["punch"] == PUNCH_IN else "OUT",
                    "device":        p["device"],
                    "status":        "saved" if is_new else "skipped",
                })

        if reconcile_pairs:
            # Giống luồng upload: best-effort, lỗi ở đây không được làm hỏng
            # kết quả đẩy chấm công đã ghi xong ở trên.
            try:
                from .overtime_reconciliation import reconcile_onsite_overtime
                flagged = reconcile_onsite_overtime(reconcile_pairs)
                if flagged:
                    logger.info(
                        "[overtime_reconciliation] %d đơn tăng ca ONSITE cần xem sau khi đẩy chấm công từ máy",
                        len(flagged),
                    )
            except Exception:
                logger.exception("[overtime_reconciliation] Lỗi đối soát sau khi đẩy chấm công từ máy -> bỏ qua")

        duration_ms = int((time.monotonic() - start_ts) * 1000)

        logger.info(
            "DeviceAttendancePush: processed=%d skipped=%d days_updated=%d errors=%d duration=%dms",
            processed, skipped, days_updated, len(errors), duration_ms,
        )

        _save_call_log(
            device_name=self._collect_device_names(records),
            caller_ip=caller_ip,
            user_agent=request.META.get("HTTP_USER_AGENT", ""),
            api_endpoint=request.path,
            http_method=request.method,
            # Audit: tên HR đã trigger sync (qua JWT subject)
            secret_used=str(request.user),
            auth_success=True,
            total_records=len(records),
            processed=processed,
            skipped=skipped,
            error_count=len(errors),
            response_status=200,
            duration_ms=duration_ms,
            request_payload=request.data if len(records) <= MAX_RECORDS_FOR_PAYLOAD_LOGGING else None,
            errors_detail=errors or None,
        )

        return Response({
            "processed":    processed,
            "skipped":      skipped,
            "days_updated": days_updated,
            "errors":       errors,
            "details":      details,
        })


def _parse_punch_time(value: str) -> datetime:
    """ISO -> datetime giờ địa phương, không tz (máy ZKTeco trả giờ địa phương).
    Nếu bên gửi kèm múi giờ thì quy về giờ Việt Nam trước khi bỏ tz."""
    dt = datetime.fromisoformat(value)
    if timezone.is_aware(dt):
        dt = timezone.make_naive(dt, timezone.get_current_timezone())
    return dt


def _employee_of(user):
    try:
        return user.employee
    except Exception:
        return None


def _derive_check_times(employee, event_date, raw_records, lone_punch_caches):
    """Giờ vào/ra của ngày từ TẤT CẢ lượt quẹt đã lưu.

    Máy ZKTeco nhiều khi không phân biệt mã vào/ra (mọi lượt đều punch=0), nên
    KHÔNG dựa vào field `punch` — giống phần mềm xuất file:
      - lượt sớm nhất = giờ vào, lượt muộn nhất = giờ ra;
      - các lượt sát nhau (< DUPLICATE_PUNCH_WINDOW) gộp làm 1;
      - còn đúng 1 lượt: gần giờ tan ca hơn thì là giờ RA (quên chấm lúc đến),
        y hệt khi upload file (shift_config_utils.lone_punch_is_checkout).
    """
    times = []
    for r in raw_records:
        try:
            dt = _parse_punch_time(r["punch_time"])
        except (ValueError, KeyError, TypeError):
            continue
        if dt.date() == event_date:
            times.append(dt)
    times.sort()

    distinct = []
    for dt in times:
        if distinct and dt - distinct[-1] < DUPLICATE_PUNCH_WINDOW:
            continue
        distinct.append(dt)

    if not distinct:
        return None, None
    if len(distinct) >= 2:
        return distinct[0].time(), distinct[-1].time()

    only = distinct[0].time()
    try:
        if lone_punch_is_checkout(employee, event_date, only, *lone_punch_caches):
            return None, only
    except Exception:
        logger.exception("[LonePunch] Không phân loại được NV=%s ngày=%s -> coi là giờ vào",
                         employee.employee_id, event_date)
    return only, None


def _attendance_status(check_in, check_out) -> str:
    if check_in and check_out:
        return "PRESENT"
    if check_in or check_out:
        return "HALF_DAY"
    return "ABSENT"


def _working_hours(event_date, check_in, check_out) -> float:
    if not (check_in and check_out):
        return 0
    start = datetime.combine(event_date, check_in)
    end = datetime.combine(event_date, check_out)
    if check_out <= check_in:
        end += timedelta(days=1)
    return (end - start).total_seconds() / 3600


def _sync_legacy_attendance(employee, event_date, check_in, check_out, device_label, created_by):
    """Ghi bảng Attendance cũ giống hệt cách upload file làm (vẫn còn vài màn cũ
    và HRMAttendanceEngine đọc bảng này).

    Đã có bản ghi (từ upload file/app mobile) thì chỉ ghi đè phần giờ máy có —
    phần máy không có giữ nguyên, đúng quy tắc gộp của upload.

    Ghi bằng bulk_create/bulk_update như upload, KHÔNG qua Attendance.save():
    save() chạy rule engine cũ cho từng bản ghi (chậm, và ra trạng thái khác
    với dữ liệu upload — vd INCOMPLETE_ATTENDANCE thay vì HALF_DAY)."""
    att = (
        Attendance.objects.select_for_update()
        .filter(employee=employee, attendance_date=event_date)
        .order_by("id")
        .first()
    )
    if att is None:
        att = Attendance(
            attendance_code=f"ATT-DEV-{employee.employee_id}-{event_date.isoformat()}",
            employee=employee,
            attendance_date=event_date,
            check_in=check_in,
            check_out=check_out,
            status=_attendance_status(check_in, check_out),
            shift_type="FULL_DAY",
            working_hours=_working_hours(event_date, check_in, check_out),
            imported_from_file=device_label,
            import_batch=DEVICE_IMPORT_SOURCE,
            created_by=created_by,
        )
        Attendance.objects.bulk_create([att])
        if att.pk is None:  # DB không trả id sau bulk_create
            att = Attendance.objects.get(attendance_code=att.attendance_code)
        return att

    new_in = check_in or att.check_in
    new_out = check_out or att.check_out
    # Lần trước lượt quẹt duy nhất bị lưu nhầm vào giờ vào, nay đã xếp lại
    # thành giờ ra: đừng ghép lại giờ vào cũ trùng chính lượt quẹt đó.
    if check_in is None and check_out is not None and new_in == check_out:
        new_in = None
    att.check_in = new_in
    att.check_out = new_out
    att.status = _attendance_status(new_in, new_out)
    att.working_hours = _working_hours(event_date, new_in, new_out)
    att.imported_from_file = device_label
    att.import_batch = DEVICE_IMPORT_SOURCE
    att.updated_at = timezone.now()
    Attendance.objects.bulk_update([att], [
        "check_in", "check_out", "status", "working_hours",
        "imported_from_file", "import_batch", "updated_at",
    ])
    return att


def _apply_day_punches(employee, event_date, punches, created_by, lone_punch_caches) -> dict:
    """Ghi các lượt quẹt của 1 nhân viên trong 1 ngày.

    Chỉ dùng event từ máy chấm công/upload (checkin_is_valid=None); event chấm
    công qua app mobile (checkin_is_valid=True) không bao giờ bị ghi đè.
    Dedup theo (punch_time, device) trong raw_records nên gửi lại cùng dữ liệu
    nhiều lần (job hằng ngày quét lại vài ngày gần nhất) là an toàn.

    Trả {"changed": bool, "new_indexes": set(index record mới được thêm)}.
    """
    with transaction.atomic():
        event = (
            EmployeeEvent.objects.select_for_update()
            .filter(
                employee=employee,
                event_date=event_date,
                event_type=EmployeeEvent.EventType.ATTENDANCE,
                checkin_is_valid__isnull=True,
            )
            .order_by("id")
            .first()
        )
        devices = sorted({p["device"] for p in punches})
        created = event is None
        if created:
            event = EmployeeEvent(
                employee=employee,
                event_date=event_date,
                event_type=EmployeeEvent.EventType.ATTENDANCE,
                data={},
                notes=f"Auto từ máy {', '.join(devices)}",
                created_by=created_by,
            )

        data = dict(event.data or {})
        raw_records = list(data.get("raw_records") or [])
        seen = {(r.get("punch_time"), r.get("device")) for r in raw_records}
        new_indexes = set()
        for p in punches:
            key = (p["punch_time"], p["device"])
            if key in seen:
                continue
            seen.add(key)
            raw_records.append({"punch_time": p["punch_time"], "punch": p["punch"], "device": p["device"]})
            new_indexes.add(p["index"])

        # LUÔN tính lại từ toàn bộ raw_records, kể cả khi toàn bản trùng — để
        # gửi lại là chữa được dữ liệu cũ (vd event do upload file tạo).
        check_in, check_out = _derive_check_times(employee, event_date, raw_records, lone_punch_caches)
        status = _attendance_status(check_in, check_out)

        changed = (
            created
            or bool(new_indexes)
            or event.check_in != check_in
            or event.check_out != check_out
            or data.get("import_source") != DEVICE_IMPORT_SOURCE
        )
        if not changed:
            return {"changed": False, "new_indexes": new_indexes}

        attendance = _sync_legacy_attendance(
            employee, event_date, check_in, check_out,
            device_label=f"Máy chấm công {', '.join(devices)}",
            created_by=created_by,
        )

        event.check_in = check_in
        event.check_out = check_out
        data.update({
            "raw_records": raw_records,
            "attendance_id": attendance.id,
            "status": status,
            "import_source": DEVICE_IMPORT_SOURCE,
        })
        event.data = data
        event.save()
        return {"changed": True, "new_indexes": new_indexes}


def _save_call_log(**kwargs) -> None:
    """Lưu DeviceAPICallLog, bắt lỗi để không ảnh hưởng response chính."""
    try:
        DeviceAPICallLog.objects.create(**kwargs)
    except Exception:
        logger.exception("Không thể lưu DeviceAPICallLog")

