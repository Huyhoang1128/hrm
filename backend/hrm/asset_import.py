"""Reusable Excel import logic for Asset rows.

Tách ra từ ``scripts/import_assets_from_excel.py`` để có thể dùng chung
giữa CLI standalone (chạy trong docker) và DRF endpoint (FE upload trong
``AssetViewSet.bulk_import_excel``).

Public API:

- ``import_workbook(workbook)``: nhận openpyxl ``Workbook``, parse sheet
  "Tài sản" (hoặc sheet đầu), upsert Asset + handover, trả về dict tổng kết.
- ``import_file(path)``: convenience cho CLI — load workbook rồi gọi
  ``import_workbook``.

Không in trực tiếp; trả về structured result để caller xử lý
(CLI in ra console, DRF trả về JSON).
"""
import re
from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from django.db import transaction
from django.utils import timezone
from openpyxl import load_workbook

from employee.models import CompanyUnit, Department, Employee, Position
from .models import Asset, AssetAssignmentHistory


SHEET_NAME = "Tài sản"


# ======== Mapping ngược: nhãn tiếng Việt → enum ========

PHYSICAL_CONDITION_LOOKUP = {
    "mới 100%": "EXCELLENT",
    "mới": "EXCELLENT",
    "cũ (chất lượng tốt)": "GOOD",
    "cũ (trầy xước / cấn móp)": "FAIR",
    "cũ (kém / lỗi chức năng)": "POOR",
    "hỏng (không hoạt động)": "BROKEN",
}

# SIM "Trạng thái vận hành" → field `status`. Xem AssetEditModal SIM_STATUSES.
SIM_STATUS_LOOKUP = {
    "mới (chưa kích hoạt)": "NEW",
    "chưa kích hoạt": "NEW",
    "đang sử dụng": "IN_USE",
    "tạm khóa": "UNDER_MAINTENANCE",
    "đã cắt": "TERMINATED",
    "mất / hỏng": "LOST",
    "mất": "LOST",
}

# "Trạng thái vận hành" không phải SIM → ASSET_STATUSES enum. Label từ AssetEditModal.
ASSET_STATUS_LOOKUP = {
    "sẵn dùng (mới 100%)": "NEW",
    "sẵn dùng (trong kho)": "IDLE",
    "đang sử dụng": "IN_USE",
    "đang sửa chữa / bảo hành": "UNDER_MAINTENANCE",
    "đang bảo hành": "UNDER_MAINTENANCE",
    "đang sửa chữa": "UNDER_MAINTENANCE",
    "lỗi / chờ thanh lý": "DAMAGED",
    "hư hỏng": "DAMAGED",
    "đã thanh lý": "RETIRED",
    "đã cắt": "TERMINATED",
    "bị mất": "LOST",
}

NETWORK_PROVIDER_LOOKUP = {
    "viettel": "VIETTEL",
    "vinaphone": "VINAPHONE",
    "mobifone": "MOBIFONE",
    "vietnamobile": "VIETNAMOBILE",
}

SIM_TYPE_LOOKUP = {
    "trả trước": "PREPAID",
    "trả sau": "POSTPAID",
}

REGION_LOOKUP = {
    "miền bắc": "MIEN_BAC",
    "miền trung": "MIEN_TRUNG",
    "miền nam": "MIEN_NAM",
}

ASSET_TYPE_LOOKUP = {
    # Chỉ giữ nhãn tiếng Việt — English code đã match qua .upper() + VALID_ASSET_TYPES
    "máy tính xách tay": "LAPTOP",
    "máy tính để bàn": "DESKTOP",
    "màn hình": "MONITOR",
    "điện thoại": "PHONE",
    "máy tính bảng": "TABLET",
    "máy in": "PRINTER",
    "máy scan": "SCANNER",
    "thiết bị mạng": "NETWORK",
    "máy chủ": "SERVER",
    "nội thất": "FURNITURE",
    "phương tiện": "VEHICLE",
    "khác": "OTHER",
}

VALID_ASSET_TYPES = {
    "LAPTOP", "DESKTOP", "MONITOR", "SIM", "PHONE", "TABLET",
    "PRINTER", "SCANNER", "NETWORK", "SERVER", "FURNITURE", "VEHICLE", "OTHER",
}


# ======== Helpers ========

def norm(val: Any) -> str:
    if val is None:
        return ""
    return str(val).strip()


def lookup_enum(value: Any, vn_map: dict, enum_values: set) -> str:
    raw = norm(value)
    if not raw:
        return ""
    upper = raw.upper()
    if upper in enum_values:
        return upper
    return vn_map.get(raw.lower(), "")


def lookup_condition(value: Any, asset_type: str) -> str:
    """Chỉ xử lý physical condition (LAPTOP/DESKTOP/... và cả SIM card vật lý).

    Giá trị SIM operational (Đang sử dụng, Tạm khóa...) thuộc field `status`,
    xem ``lookup_sim_status``.
    """
    raw = norm(value)
    if not raw:
        return ""
    upper = raw.upper()
    valid = {"EXCELLENT", "GOOD", "FAIR", "POOR", "BROKEN"}
    if upper in valid:
        return upper
    return PHYSICAL_CONDITION_LOOKUP.get(raw.lower(), "")


VALID_ASSET_STATUSES = {
    "NEW", "IDLE", "IN_USE", "UNDER_MAINTENANCE", "DAMAGED",
    "RETIRED", "TERMINATED", "LOST",
}


def lookup_status(value: Any, asset_type: str) -> str:
    """Map nhãn "Trạng thái vận hành" → enum ASSET_STATUS.

    SIM dùng nhãn riêng (Mới chưa kích hoạt, Tạm khóa, Đã cắt...).
    Non-SIM dùng nhãn chung (Sẵn dùng, Đang sử dụng, Đã thanh lý...).
    Cả 2 đều chấp nhận cả enum code (vd NEW, IN_USE) lẫn label tiếng Việt.
    """
    raw = norm(value)
    if not raw:
        return ""
    upper = raw.upper()
    if upper in VALID_ASSET_STATUSES:
        return upper
    lower = raw.lower()
    if asset_type == "SIM":
        return SIM_STATUS_LOOKUP.get(lower, "")
    return ASSET_STATUS_LOOKUP.get(lower, "")


def resolve_department(value):
    raw = norm(value)
    if not raw:
        return None, ""
    dept = Department.objects.filter(code__iexact=raw).first()
    if dept:
        return dept, ""
    dept = Department.objects.filter(name__iexact=raw).first()
    if dept:
        return dept, ""
    return None, f"Không tìm thấy phòng ban: {raw}"


def resolve_employee(value):
    raw = norm(value)
    if not raw:
        return None, ""
    emp = Employee.objects.filter(employee_id__iexact=raw).first()
    if emp:
        return emp, ""
    emp = Employee.objects.filter(full_name__iexact=raw).first()
    if emp:
        return emp, ""
    return None, f"Không tìm thấy nhân viên: {raw}"


def resolve_position(value):
    raw = norm(value)
    if not raw:
        return None, ""
    pos = Position.objects.filter(code__iexact=raw).first()
    if pos:
        return pos, ""
    pos = Position.objects.filter(title__iexact=raw).first()
    if pos:
        return pos, ""
    return None, f"Không tìm thấy vị trí: {raw}"


def resolve_company(value):
    raw = norm(value)
    if not raw:
        return None, ""
    unit = CompanyUnit.objects.filter(code__iexact=raw).first()
    if unit:
        return unit, ""
    unit = CompanyUnit.objects.filter(name__iexact=raw).first()
    if unit:
        return unit, ""
    return None, f"Không tìm thấy công ty: {raw}"


def parse_recipients(raw_value) -> list[tuple[str, int | None]]:
    """Parse cột 'Người được bàn giao' — hỗ trợ cả format đơn lẫn gộp từ export.

    - Đơn: ``"Nguyễn Văn A"`` → ``[("Nguyễn Văn A", None)]``
    - Gộp:  ``"Nguyễn Văn A (1), User_2520 (1)"`` → ``[("Nguyễn Văn A", 1), ("User_2520", 1)]``
    """
    raw = norm(raw_value)
    if not raw:
        return []
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    results: list[tuple[str, int | None]] = []
    for part in parts:
        m = re.match(r'^(.+?)\s*\((\d+)\)\s*$', part)
        if m:
            results.append((m.group(1).strip(), int(m.group(2))))
        else:
            results.append((part.strip(), None))
    return results


def parse_date(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def parse_int(value, default=None):
    if value is None or value == "":
        return default
    try:
        return int(float(str(value).replace(",", "")))
    except (ValueError, TypeError):
        return default


def parse_decimal(value, default=Decimal("0")) -> Decimal:
    if value is None or value == "":
        return default
    try:
        return Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return default


# ======== Row parsing ========

def parse_row(row_cells: list, headers: dict[str, int]) -> tuple[dict | None, list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    def pick(key: str):
        idx = headers.get(key.lower())
        if idx is None:
            return None
        return row_cells[idx - 1] if idx - 1 < len(row_cells) else None

    def pick_any(*keys: str):
        """Thử lần lượt nhiều alias, trả về value đầu tiên non-empty.

        Cần thiết vì các cột lookup có thể có nhiều tên (VD: FE modal
        dùng "Người quản lý (Kho)" còn template cũ dùng "Quản lý kho").
        """
        for k in keys:
            v = pick(k)
            if v not in (None, ""):
                return v
        return None

    name = norm(pick_any("Mã thiết bị", "Tên tài sản"))
    asset_type_raw = norm(pick("Phân loại"))
    asset_type = ""
    if asset_type_raw:
        upper = asset_type_raw.upper()
        if upper in VALID_ASSET_TYPES:
            asset_type = upper
        else:
            asset_type = ASSET_TYPE_LOOKUP.get(asset_type_raw.lower(), "")
    if not name:
        errors.append("Thiếu Mã thiết bị")
        return None, errors

    # Continuation row: có Mã thiết bị nhưng thiếu Phân loại → chỉ parse handover
    if not asset_type:
        # Ưu tiên "Mã người bàn giao" (khớp employee_id, tránh nhầm do trùng
        # tên — xem resolve_employee) trước khi fallback "Tên người bàn
        # giao"; 3 alias cuối giữ cho file cũ trước khi export tách cột
        # Mã/Tên (ff2f9aa) — file export hiện tại KHÔNG có cột "Người được
        # bàn giao" gộp nữa, chỉ có "Mã/Tên người bàn giao" tách riêng, nên
        # thiếu 2 alias này khiến import không đọc được recipient nào cả dù
        # cột trong file có dữ liệu (bug thực tế, HCNS báo 2026-09-23).
        recipient_raw = pick_any(
            "Mã người bàn giao", "Tên người bàn giao",
            "Người được bàn giao", "Người nhận", "Bàn giao cho",
        )
        if not norm(recipient_raw):
            errors.append(f"Loại không hợp lệ: {asset_type_raw or '(trống)'}")
            return None, errors
        parsed_recipients = parse_recipients(recipient_raw)
        handover_date = parse_date(pick_any("Ngày bàn giao", "Ngày bàn giao cho NV"))
        handover_notes = norm(pick_any("Ghi chú bàn giao", "Ghi chú"))
        handover_quantity_default = parse_int(
            pick_any("Số lượng bàn giao", "SL bàn giao", "Quantity handover"),
            default=1,
        ) or 1
        recipients_list: list[dict] = []
        for rec_name, rec_qty in parsed_recipients:
            rec_emp, rec_err = resolve_employee(rec_name)
            if rec_name and rec_err:
                warnings.append(rec_err)
            if rec_emp:
                recipients_list.append({
                    "employee": rec_emp,
                    "quantity": rec_qty if rec_qty is not None else handover_quantity_default,
                    "notes": handover_notes,
                })
        return {
            "name": name,
            "_continuation": True,
            "_handover_recipients": recipients_list,
            "_handover_date": handover_date,
        }, warnings

    # Tách 2 cột riêng biệt:
    #   - "Tình trạng vật lý" → field condition (physical)
    #   - "Trạng thái vận hành" → field status (operational)
    # Backward compat: file cũ chỉ có "Tình trạng" — nếu value match physical
    # condition thì treat là condition, còn nếu match operational label thì
    # treat là status (đặc biệt cho SIM với labels "Đang sử dụng" / "Tạm khóa"...).
    vat_ly_raw = pick("Tình trạng vật lý")
    van_hanh_raw = pick_any("Trạng thái vận hành", "Trạng thái (Vận hành)", "Trạng thái")
    legacy_tinh_trang = pick("Tình trạng")  # file cũ

    condition = ""
    status_override = ""

    if vat_ly_raw:
        condition = lookup_condition(vat_ly_raw, asset_type)
        if not condition:
            warnings.append(f"Tình trạng vật lý không map được: {vat_ly_raw!r}")
    if van_hanh_raw:
        status_override = lookup_status(van_hanh_raw, asset_type)
        if not status_override:
            warnings.append(f"Trạng thái vận hành không map được: {van_hanh_raw!r}")

    # Fallback: file cũ chỉ có "Tình trạng" — đoán thuộc condition hay status
    if legacy_tinh_trang and not condition and not status_override:
        maybe_cond = lookup_condition(legacy_tinh_trang, asset_type)
        maybe_status = lookup_status(legacy_tinh_trang, asset_type)
        if maybe_cond:
            condition = maybe_cond
        elif maybe_status:
            status_override = maybe_status
        else:
            warnings.append(f"Tình trạng không map được: {legacy_tinh_trang!r}")

    if not condition:
        condition = "EXCELLENT"

    specs: dict = {}
    if asset_type in ("LAPTOP", "DESKTOP"):
        specs = {
            "cpu": norm(pick("CPU")),
            "mainboard": norm(pick("Main")),
            "ram": norm(pick("RAM")),
            "storage": norm(pick("Ổ cứng")),
            "vga": norm(pick("VGA")),
            "power_supply": norm(pick("Nguồn")),
        }
    elif asset_type == "MONITOR":
        qty = parse_int(pick("Số lượng"), default=0) or 0
        specs = {"quantity": qty}
    elif asset_type == "SIM":
        phone_number = norm(pick("Số điện thoại"))
        if not phone_number:
            errors.append("SIM thiếu Số điện thoại")
        elif not phone_number.isdigit() or len(phone_number) != 10:
            errors.append(f"Số điện thoại SIM không hợp lệ (phải 10 chữ số): {phone_number}")
        if errors:
            return None, errors

        pos, pos_err = resolve_position(pick("Vị trí"))
        if pos_err:
            warnings.append(pos_err)
        company, cmp_err = resolve_company(pick("Công ty"))
        if cmp_err:
            warnings.append(cmp_err)

        network = lookup_enum(
            pick("Nhà mạng"),
            NETWORK_PROVIDER_LOOKUP,
            {"VIETTEL", "VINAPHONE", "MOBIFONE", "VIETNAMOBILE"},
        )
        sim_type = lookup_enum(
            pick("Loại Sim"),
            SIM_TYPE_LOOKUP,
            {"PREPAID", "POSTPAID"},
        )
        region = lookup_enum(
            pick("Vùng miền"),
            REGION_LOOKUP,
            {"MIEN_BAC", "MIEN_TRUNG", "MIEN_NAM"},
        )

        cancellation_report_date = parse_date(pick("Ngày báo huỷ"))

        specs = {
            "phone_number": phone_number,
            "network_provider": network,
            "sim_type": sim_type or "PREPAID",
            "doctor": norm(pick("Bác sĩ")),
            "region": region,
            "position_id": pos.id if pos else None,
            "position_title": pos.title if pos else "",
            "sim_company": company.id if company else None,
            "sim_company_name": company.name if company else "",
            "cancellation_report_date": cancellation_report_date.isoformat() if cancellation_report_date else "",
        }
    elif asset_type == "OTHER":
        qty = parse_int(pick("Số lượng"), default=0) or 0
        specs = {"type_name": norm(pick("Tên loại chi tiết")), "quantity": qty}

    dept, dept_err = resolve_department(
        pick_any("Phòng ban quản lý", "Phòng ban", "Phòng ban ID")
    )
    if dept_err:
        warnings.append(dept_err)
    emp, emp_err = resolve_employee(
        pick_any(
            "Mã NQL (Kho)", "Tên NQL (Kho)",
            "Người quản lý (Kho)", "Người quản lý kho", "Quản lý kho", "Quản lý kho ID",
        )
    )
    if emp_err:
        warnings.append(emp_err)

    # Parse recipients — hỗ trợ cả format đơn "Tên" lẫn gộp "Tên (qty), Tên (qty)".
    # Ưu tiên cột "Mã người bàn giao" (khớp employee_id, tránh nhầm do trùng
    # tên — xem resolve_employee) trước khi fallback "Tên người bàn giao";
    # 3 alias cuối giữ cho file cũ trước khi export tách cột Mã/Tên (ff2f9aa).
    recipient_raw = pick_any(
        "Mã người bàn giao", "Tên người bàn giao",
        "Người được bàn giao", "Người nhận", "Bàn giao cho",
    )
    parsed_recipients = parse_recipients(recipient_raw)

    handover_date = parse_date(pick_any("Ngày bàn giao", "Ngày bàn giao cho NV"))
    handover_notes = norm(pick_any("Ghi chú bàn giao", "Ghi chú"))
    handover_quantity_default = parse_int(
        pick_any("Số lượng bàn giao", "SL bàn giao", "Quantity handover"),
        default=1,
    ) or 1

    # Resolve từng recipient
    recipients_list: list[dict] = []
    for rec_name, rec_qty in parsed_recipients:
        rec_emp, rec_err = resolve_employee(rec_name)
        if rec_name and rec_err:
            warnings.append(rec_err)
        if rec_emp:
            recipients_list.append({
                "employee": rec_emp,
                "quantity": rec_qty if rec_qty is not None else handover_quantity_default,
                "notes": handover_notes,
            })

    if not condition:
        condition = "EXCELLENT"

    # Status: ưu tiên giá trị user điền ở cột "Trạng thái vận hành".
    # Nếu không có → mặc định IDLE (trong kho), sau đó handover sẽ tự set IN_USE.
    initial_status = status_override if status_override else "IDLE"

    payload = {
        "name": name,
        "asset_type": asset_type,
        "model": norm(pick("Model")),
        "condition": condition,
        "status": initial_status,
        "purchase_date": parse_date(pick("Ngày mua")),
        "purchase_price": parse_decimal(pick("Giá mua"), Decimal("0")),
        "warranty_period": parse_int(pick("Bảo hành (tháng)"), default=0) or 0,
        "supplier": norm(pick("Nhà cung cấp")),
        "description": norm(pick_any("Mô tả / Ghi chú", "Mô tả")),
        "department": dept,
        "managed_by": emp,
        "specifications": specs,
        "_handover_recipients": recipients_list,
        "_handover_date": handover_date,
    }
    return payload, warnings


# ======== Main entry point ========

def import_workbook(workbook) -> dict:
    """Parse và upsert Asset từ openpyxl Workbook.

    Trả về dict::

        {
            "sheet": "Tài sản",
            "data_rows": 21,
            "created": 0,
            "updated": 21,
            "failed": [{"row": 23, "messages": ["..."]}],
            "details": [{"row": 2, "action": "created"|"updated", "asset_code": "...", "name": "...", "asset_type": "...", "handover_to": "...|None", "warnings": [...]}],
        }
    """
    sheet = workbook[SHEET_NAME] if SHEET_NAME in workbook.sheetnames else workbook.worksheets[0]

    headers: dict[str, int] = {}
    for col_idx, cell in enumerate(sheet[1], start=1):
        key = norm(cell.value).lower()
        if key:
            headers[key] = col_idx

    created = 0
    updated = 0
    failed: list[dict] = []
    details: list[dict] = []

    # Cache asset đã xử lý trong session — key = (name, asset_type).
    # Cùng mã + cùng loại → UPDATE. Cùng mã + khác loại → CREATE mới.
    seen_assets: dict[tuple[str, str], 'Asset'] = {}

    for r in range(2, sheet.max_row + 1):
        cells = [sheet.cell(r, c).value for c in range(1, sheet.max_column + 1)]
        if all(v is None or v == "" for v in cells):
            continue
        payload, msgs = parse_row(cells, headers)
        if payload is None:
            failed.append({"row": r, "messages": msgs})
            continue

        is_continuation = payload.pop("_continuation", False)
        recipients = payload.pop("_handover_recipients", [])
        handover_date = payload.pop("_handover_date", None)

        try:
            with transaction.atomic():
                asset_name = payload["name"]
                asset_type = payload.get("asset_type", "")
                cache_key = (asset_name, asset_type)

                if is_continuation:
                    # Continuation row: không có asset_type → tìm bằng name trong cache/DB
                    matched = [v for k, v in seen_assets.items() if k[0] == asset_name]
                    if matched:
                        asset = matched[-1]  # lấy asset gần nhất cùng tên
                    else:
                        asset = Asset.objects.filter(name=asset_name, is_deleted=False).order_by('-id').first()
                        if not asset:
                            failed.append({"row": r, "messages": [f"Không tìm thấy tài sản: {asset_name}"]})
                            continue
                        seen_assets[(asset_name, asset.asset_type)] = asset
                    action = "updated"
                elif cache_key in seen_assets:
                    # Cùng name + cùng type trong session → chỉ add handover
                    asset = seen_assets[cache_key]
                    action = "updated"
                else:
                    # Lookup DB bằng name + asset_type
                    existing = Asset.objects.filter(
                        name=asset_name, asset_type=asset_type, is_deleted=False
                    ).first()
                    if existing:
                        for field, value in payload.items():
                            setattr(existing, field, value)
                        existing.save()
                        asset = existing
                        action = "updated"
                        updated += 1
                    else:
                        asset = Asset.objects.create(**payload)
                        action = "created"
                        created += 1
                    seen_assets[cache_key] = asset

                handover_names = []
                for rec in recipients:
                    recipient = rec["employee"]
                    handover_quantity = rec["quantity"]
                    handover_notes = rec["notes"]

                    # Validate quantity theo scope multi-holder
                    if asset.asset_type not in Asset.MULTI_HOLDER_TYPES and handover_quantity != 1:
                        failed.append({
                            "row": r,
                            "messages": [
                                f"Loại {asset.asset_type} không hỗ trợ Số lượng bàn giao > 1 "
                                f"(giá trị {handover_quantity})"
                            ],
                        })
                        raise ValueError(
                            f"NOT_MULTI_HOLDER_TYPE: quantity={handover_quantity}"
                        )

                    if handover_quantity < 1:
                        failed.append({
                            "row": r,
                            "messages": [f"Số lượng bàn giao phải >= 1 (nhận {handover_quantity})"],
                        })
                        raise ValueError("QUANTITY_MISSING")

                    # refresh để tính chính xác remaining sau các handover trước đó trong cùng file
                    asset.refresh_from_db()
                    remaining = asset.remaining_quantity
                    if handover_quantity > remaining:
                        failed.append({
                            "row": r,
                            "messages": [
                                f"SL bàn giao {handover_quantity} vượt quá còn lại "
                                f"{remaining}/{asset.total_quantity}"
                            ],
                        })
                        raise ValueError("QUANTITY_OVER_LIMIT")

                    assigned_date = handover_date or timezone.now().date()

                    # Non-multi-holder: auto-return holder cũ nếu khác người (single-holder).
                    if asset.asset_type not in Asset.MULTI_HOLDER_TYPES:
                        if asset.assigned_to and asset.assigned_to_id != recipient.id:
                            AssetAssignmentHistory.objects.filter(
                                asset=asset,
                                assigned_to=asset.assigned_to,
                                status="CONFIRMED",
                            ).update(
                                status="RETURNED",
                                returned_date=timezone.now().date(),
                                return_notes="Tự động thu hồi khi import lại bàn giao cho người mới",
                            )

                    asset.assigned_to = recipient
                    asset.assigned_date = assigned_date
                    _INACTIVE = {"TERMINATED", "RETIRED", "LOST", "DAMAGED", "UNDER_MAINTENANCE"}
                    if asset.status not in _INACTIVE:
                        asset.status = "IN_USE"
                    asset.save()

                    handover_initiator = asset.managed_by
                    hist = AssetAssignmentHistory.objects.filter(
                        asset=asset, assigned_to=recipient, status="CONFIRMED",
                    ).first()
                    if hist:
                        hist.assigned_date = assigned_date
                        hist.assignment_notes = handover_notes or hist.assignment_notes or "Bàn giao qua import Excel"
                        hist.assigned_quantity = handover_quantity
                        if handover_initiator and not hist.assigned_by:
                            hist.assigned_by = handover_initiator
                        hist.save()
                    else:
                        AssetAssignmentHistory.objects.create(
                            asset=asset,
                            assigned_to=recipient,
                            assigned_date=assigned_date,
                            assignment_notes=handover_notes or "Bàn giao qua import Excel",
                            status="CONFIRMED",
                            confirmed_at=timezone.now(),
                            assigned_by=handover_initiator,
                            assigned_quantity=handover_quantity,
                        )
                    handover_names.append(recipient.full_name)

                details.append({
                    "row": r,
                    "action": action,
                    "asset_code": asset.asset_code,
                    "name": asset.name,
                    "asset_type": asset.asset_type,
                    "handover_to": ", ".join(handover_names) if handover_names else None,
                    "handover_quantity": sum(rec["quantity"] for rec in recipients) if recipients else None,
                    "warnings": msgs,
                })
        except ValueError:
            # Validation error đã push vào failed[] ở trên, transaction auto rollback
            pass
        except Exception as e:
            failed.append({"row": r, "messages": [str(e)]})

    return {
        "sheet": sheet.title,
        "data_rows": sheet.max_row - 1,
        "created": created,
        "updated": updated,
        "failed_count": len(failed),
        "failed": failed,
        "details": details,
    }


def import_file(path) -> dict:
    """Convenience cho CLI: load file rồi delegate."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {p}")
    wb = load_workbook(p, data_only=True)
    return import_workbook(wb)
