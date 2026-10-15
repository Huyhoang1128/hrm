"""Reusable Excel export logic for Asset rows.

Tách ra từ ``scripts/export_assets_to_excel.py`` để dùng chung với DRF
view ``AssetViewSet.export_excel`` (FE bấm "Xuất Excel").

Public API:

- ``build_workbook(queryset)``: nhận Asset queryset, trả về openpyxl
  ``Workbook`` đã build sẵn (header + rows + dropdown data validation).

Schema cột khớp 100% với ``hrm.asset_import`` để round-trip:
export → user sửa → import lại sẽ upsert đúng.
"""
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from employee.models import CompanyUnit, Department, Employee, Position
from .models import Asset


SHEET_NAME = "Tài sản"


# ======== Schema cột (khớp với hrm.asset_import) ========

COLUMNS = [
    ("Mã thiết bị",          "IDENTITY"),
    ("Phân loại",            "IDENTITY"),
    ("Model",                "COMMON"),
    ("Tình trạng vật lý",    "COMMON"),
    ("Trạng thái vận hành",  "COMMON"),
    ("CPU",                  "DESKTOP"),
    ("Main",                 "DESKTOP"),
    ("RAM",                  "DESKTOP"),
    ("Ổ cứng",               "DESKTOP"),
    ("VGA",                  "DESKTOP"),
    ("Nguồn",                "DESKTOP"),
    ("Số lượng",             "MONITOR"),
    ("Số điện thoại",        "SIM"),
    ("Nhà mạng",             "SIM"),
    ("Loại Sim",             "SIM"),
    ("Bác sĩ",               "SIM"),
    ("Vùng miền",            "SIM"),
    ("Vị trí",               "SIM"),
    ("Công ty",              "SIM"),
    ("Ngày báo huỷ",         "SIM"),
    ("Tên loại chi tiết",    "OTHER"),
    ("Ngày mua",             "COMMON"),
    ("Bảo hành (tháng)",     "COMMON"),
    ("Nhà cung cấp",         "COMMON"),
    ("Phòng ban quản lý",    "COMMON"),
    ("Mã NQL (Kho)",         "COMMON"),
    ("Tên NQL (Kho)",        "COMMON"),
    ("Mã người bàn giao",    "HANDOVER"),
    ("Tên người bàn giao",   "HANDOVER"),
    ("Ngày bàn giao",        "HANDOVER"),
    ("Ghi chú bàn giao",     "HANDOVER"),
    ("Số lượng bàn giao",    "HANDOVER"),
    ("Mô tả / Ghi chú",      "COMMON"),
]

GROUP_FILL = {
    "IDENTITY": PatternFill("solid", fgColor="4F46E5"),
    "COMMON":   PatternFill("solid", fgColor="64748B"),
    "DESKTOP":  PatternFill("solid", fgColor="2563EB"),
    "MONITOR":  PatternFill("solid", fgColor="7C3AED"),
    "SIM":      PatternFill("solid", fgColor="059669"),
    "OTHER":    PatternFill("solid", fgColor="D97706"),
    "HANDOVER": PatternFill("solid", fgColor="0891B2"),
}

HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
HEADER_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)


# Dropdown data validation — cùng option list với template, để file export
# vẫn editable và round-trip được khi user sửa.
DROPDOWN_OPTIONS = {
    "Phân loại": [
        "Laptop", "Máy tính để bàn", "Màn hình", "Sim", "Điện thoại",
        "Máy tính bảng", "Máy in", "Máy scan", "Thiết bị mạng", "Máy chủ",
        "Nội thất", "Phương tiện", "Khác",
    ],
    "Tình trạng vật lý": [
        "Mới 100%", "Cũ (Chất lượng tốt)", "Cũ (Trầy xước / Cấn móp)",
        "Cũ (Kém / Lỗi chức năng)", "Hỏng (Không hoạt động)",
    ],
    "Trạng thái vận hành": [
        "Sẵn dùng (Mới 100%)", "Sẵn dùng (Trong kho)", "Đang sử dụng",
        "Đang sửa chữa / Bảo hành", "Lỗi / Chờ thanh lý", "Đã thanh lý",
        "Đã cắt", "Bị mất",
        "Mới (Chưa kích hoạt)", "Tạm khóa", "Mất / Hỏng",
    ],
    "Nhà mạng": ["Viettel", "Vinaphone", "Mobifone", "Vietnamobile"],
    "Loại Sim": ["Trả trước", "Trả sau"],
    "Vùng miền": ["Miền Bắc", "Miền Trung", "Miền Nam"],
}


# ======== Mapping ngược enum → nhãn tiếng Việt ========

PHYSICAL_CONDITION_LABELS = {
    "EXCELLENT": "Mới 100%",
    "GOOD": "Cũ (Chất lượng tốt)",
    "FAIR": "Cũ (Trầy xước / Cấn móp)",
    "POOR": "Cũ (Kém / Lỗi chức năng)",
    "BROKEN": "Hỏng (Không hoạt động)",
}

# SIM dùng enum ASSET_STATUS nhưng hiển thị với nhãn riêng trong cột "Tình trạng"
SIM_STATUS_LABELS = {
    "NEW": "Mới (Chưa kích hoạt)",
    "IN_USE": "Đang sử dụng",
    "UNDER_MAINTENANCE": "Tạm khóa",
    "RETIRED": "Đã cắt",
    "LOST": "Mất / Hỏng",
}

NETWORK_PROVIDER_LABELS = {
    "VIETTEL": "Viettel",
    "VINAPHONE": "Vinaphone",
    "MOBIFONE": "Mobifone",
    "VIETNAMOBILE": "Vietnamobile",
}

SIM_TYPE_LABELS = {
    "PREPAID": "Trả trước",
    "POSTPAID": "Trả sau",
}

REGION_LABELS = {
    "MIEN_BAC": "Miền Bắc",
    "MIEN_TRUNG": "Miền Trung",
    "MIEN_NAM": "Miền Nam",
}

ASSET_TYPE_LABELS = {
    "LAPTOP": "Laptop",
    "DESKTOP": "Máy tính để bàn",
    "MONITOR": "Màn hình",
    "SIM": "Sim",
    "PHONE": "Điện thoại",
    "TABLET": "Máy tính bảng",
    "PRINTER": "Máy in",
    "SCANNER": "Máy scan",
    "NETWORK": "Thiết bị mạng",
    "SERVER": "Máy chủ",
    "FURNITURE": "Nội thất",
    "VEHICLE": "Phương tiện",
    "OTHER": "Khác",
}


def physical_condition_label(asset: Asset) -> str:
    """Cột 'Tình trạng vật lý' — physical condition cho mọi loại asset."""
    raw = (asset.condition or "").strip()
    if not raw:
        return ""
    return PHYSICAL_CONDITION_LABELS.get(raw, raw)


# Nhãn chung cho ASSET_STATUSES (non-SIM), khớp với AssetEditModal.tsx
_STATUS_LABELS_NON_SIM = {
    "NEW": "Sẵn dùng (Mới 100%)",
    "IDLE": "Sẵn dùng (Trong kho)",
    "IN_USE": "Đang sử dụng",
    "UNDER_MAINTENANCE": "Đang sửa chữa / Bảo hành",
    "DAMAGED": "Lỗi / Chờ thanh lý",
    "RETIRED": "Đã thanh lý",
    "TERMINATED": "Đã cắt",
    "LOST": "Bị mất",
}


def operational_status_label(asset: Asset) -> str:
    """Cột 'Trạng thái vận hành' — dùng SIM labels cho SIM, còn lại dùng labels chung."""
    raw = (asset.status or "").strip().upper()
    if not raw:
        return ""
    if asset.asset_type == "SIM" and raw in SIM_STATUS_LABELS:
        return SIM_STATUS_LABELS[raw]
    return _STATUS_LABELS_NON_SIM.get(raw, raw)


def network_label(val: str) -> str:
    if not val:
        return ""
    key = str(val).strip().upper()
    return NETWORK_PROVIDER_LABELS.get(key, val)


def sim_type_label(val: str) -> str:
    if not val:
        return ""
    key = str(val).strip().upper()
    return SIM_TYPE_LABELS.get(key, val)


def region_label(val: str) -> str:
    if not val:
        return ""
    key = str(val).strip().upper()
    return REGION_LABELS.get(key, val)


def position_label(position_id) -> str:
    if not position_id:
        return ""
    try:
        pos = Position.objects.filter(id=int(position_id)).first()
    except (TypeError, ValueError):
        return str(position_id)
    return pos.title if pos else str(position_id)


def company_label(company_id) -> str:
    if not company_id:
        return ""
    try:
        unit = CompanyUnit.objects.filter(id=int(company_id)).first()
    except (TypeError, ValueError):
        return str(company_id)
    return unit.name if unit else str(company_id)


def department_label(dept) -> str:
    if not dept:
        return ""
    return dept.name or dept.code or ""


def employee_label(emp) -> str:
    if not emp:
        return ""
    return emp.full_name or emp.employee_id or ""


def employee_code(emp) -> str:
    if not emp:
        return ""
    return emp.employee_id or ""


def format_date(val) -> str:
    if not val:
        return ""
    try:
        return val.strftime("%Y-%m-%d")
    except AttributeError:
        return str(val)


# ======== Build row(s) ========

def _build_base_fields(asset: Asset) -> dict:
    """Các field base của asset (không phụ thuộc handover)."""
    specs = asset.specifications or {}
    t = asset.asset_type

    cpu = specs.get("cpu", "") if t in ("DESKTOP", "LAPTOP") else ""
    mainboard = specs.get("mainboard", "") if t in ("DESKTOP", "LAPTOP") else ""
    ram = specs.get("ram", "") if t in ("DESKTOP", "LAPTOP") else ""
    storage = specs.get("storage", "") if t in ("DESKTOP", "LAPTOP") else ""
    vga = specs.get("vga", "") if t in ("DESKTOP", "LAPTOP") else ""
    power_supply = specs.get("power_supply", "") if t in ("DESKTOP", "LAPTOP") else ""

    quantity = specs.get("quantity", "") if t in Asset.MULTI_HOLDER_TYPES else ""

    if t == "SIM":
        phone_number = specs.get("phone_number", "")
        network_provider = network_label(specs.get("network_provider", ""))
        sim_type = sim_type_label(specs.get("sim_type", ""))
        doctor = specs.get("doctor", "")
        region = region_label(specs.get("region", ""))
        vi_tri = position_label(specs.get("position_id"))
        cong_ty = company_label(specs.get("sim_company"))
        ngay_bao_huy = specs.get("cancellation_report_date", "") or ""
    else:
        phone_number = network_provider = sim_type = doctor = region = vi_tri = cong_ty = ""
        ngay_bao_huy = ""

    type_name = specs.get("type_name", "") if t == "OTHER" else ""

    return {
        'name': asset.name or "",
        'asset_type': ASSET_TYPE_LABELS.get(t, t or ""),
        'model': asset.model or "",
        'condition': physical_condition_label(asset),
        'status': operational_status_label(asset),
        'cpu': cpu, 'mainboard': mainboard, 'ram': ram,
        'storage': storage, 'vga': vga, 'power_supply': power_supply,
        'quantity': quantity,
        'phone_number': phone_number, 'network_provider': network_provider,
        'sim_type': sim_type, 'doctor': doctor, 'region': region,
        'vi_tri': vi_tri, 'cong_ty': cong_ty, 'ngay_bao_huy': ngay_bao_huy,
        'type_name': type_name,
        'purchase_date': format_date(asset.purchase_date),
        'warranty_period': asset.warranty_period or 0,
        'supplier': asset.supplier or "",
        'department': department_label(asset.department),
        'managed_by_code': employee_code(asset.managed_by),
        'managed_by_name': employee_label(asset.managed_by),
        'description': asset.description or "",
    }


def _row_from_base(base: dict, nguoi_nhan_code: str, nguoi_nhan_name: str,
                   ngay_ban_giao: str, ghi_chu_ban_giao: str, handover_quantity) -> list:
    return [
        base['name'], base['asset_type'], base['model'], base['condition'], base['status'],
        base['cpu'], base['mainboard'], base['ram'], base['storage'], base['vga'], base['power_supply'],
        base['quantity'],
        base['phone_number'], base['network_provider'], base['sim_type'],
        base['doctor'], base['region'], base['vi_tri'], base['cong_ty'],
        base['ngay_bao_huy'],
        base['type_name'],
        base['purchase_date'], base['warranty_period'], base['supplier'],
        base['department'], base['managed_by_code'], base['managed_by_name'],
        nguoi_nhan_code, nguoi_nhan_name, ngay_ban_giao, ghi_chu_ban_giao, handover_quantity,
        base['description'],
    ]



def _row_continuation(asset_name: str, nguoi_nhan_code: str, nguoi_nhan_name: str,
                      ngay_ban_giao: str, ghi_chu_ban_giao: str, handover_quantity) -> list:
    """Row thứ 2..N của cùng 1 asset multi-holder — chỉ có Mã thiết bị + handover."""
    empty_count = 26  # cột 2..27 trống (đã tính thêm "Ngày báo huỷ"), col 28=Mã người bàn giao
    return (
        [asset_name] + [""] * empty_count
        + [nguoi_nhan_code, nguoi_nhan_name, ngay_ban_giao, ghi_chu_ban_giao, handover_quantity]
        + [""]  # Mô tả / Ghi chú
    )


def build_rows(asset: Asset) -> list:
    """Trả về list các row cho asset.

    - 0 hoặc 1 holder: 1 row đầy đủ.
    - Multi-holder: N row — dòng đầu đầy đủ base, các dòng sau chỉ có
      Mã thiết bị + cột handover (continuation rows).
    """
    base = _build_base_fields(asset)

    # Lấy danh sách CONFIRMED holders
    holders = list(
        asset.assignment_history
        .filter(status="CONFIRMED")
        .select_related('assigned_to')
        .order_by('assigned_date', 'id')
    )

    if not holders:
        return [_row_from_base(base, "", "", "", "", "")]

    if len(holders) == 1:
        h = holders[0]
        return [_row_from_base(
            base,
            employee_code(h.assigned_to),
            employee_label(h.assigned_to),
            format_date(h.assigned_date),
            h.assignment_notes or "",
            h.assigned_quantity or 1,
        )]

    # Multi-holder: 1 row đầy đủ + N-1 continuation rows
    rows = []
    first = holders[0]
    rows.append(_row_from_base(
        base,
        employee_code(first.assigned_to),
        employee_label(first.assigned_to),
        format_date(first.assigned_date),
        first.assignment_notes or "",
        first.assigned_quantity or 1,
    ))
    for h in holders[1:]:
        rows.append(_row_continuation(
            asset.name or "",
            employee_code(h.assigned_to),
            employee_label(h.assigned_to),
            format_date(h.assigned_date),
            h.assignment_notes or "",
            h.assigned_quantity or 1,
        ))
    return rows


# Backwards compat alias — các caller cũ dùng build_row trả về 1 row.
def build_row(asset: Asset) -> list:
    rows = build_rows(asset)
    return rows[0] if rows else []


def _apply_dropdowns(ws, headers, last_row: int = 500) -> None:
    options_by_header = dict(DROPDOWN_OPTIONS)
    company_codes = [c for c in CompanyUnit.objects.order_by('code').values_list('code', flat=True) if c]
    if company_codes:
        options_by_header["Công ty"] = company_codes
    for header_name, options in options_by_header.items():
        if header_name not in headers:
            continue
        col_idx = headers.index(header_name) + 1
        letter = get_column_letter(col_idx)
        formula = '"' + ",".join(options) + '"'
        dv = DataValidation(
            type="list",
            formula1=formula,
            allow_blank=True,
            showErrorMessage=True,
            errorTitle="Giá trị không hợp lệ",
            error=f"Chọn một giá trị từ danh sách:\n{', '.join(options)}",
            errorStyle="stop",
            showInputMessage=True,
            promptTitle=header_name,
            prompt="Bấm mũi tên ▼ để chọn từ danh sách",
        )
        ws.add_data_validation(dv)
        dv.add(f"{letter}2:{letter}{last_row}")


def build_workbook(queryset) -> Workbook:
    """Build openpyxl Workbook từ Asset queryset."""
    wb = Workbook()
    wb.remove(wb.active)
    ws = wb.create_sheet(SHEET_NAME)

    headers = [h for h, _ in COLUMNS]
    ws.append(headers)

    for col_idx, (header, group) in enumerate(COLUMNS, start=1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = HEADER_FONT
        cell.fill = GROUP_FILL[group]
        cell.alignment = HEADER_ALIGN
        letter = get_column_letter(col_idx)
        ws.column_dimensions[letter].width = max(16, min(40, len(header) + 4))
    ws.row_dimensions[1].height = 30

    row_count = 0
    for asset in queryset:
        for row in build_rows(asset):
            ws.append(row)
            row_count += 1

    # Apply dropdown — last_row = max(row_count + 1, 500) để user thêm dòng
    last_row = max(row_count + 100, 500)
    _apply_dropdowns(ws, headers, last_row=last_row)

    ws.freeze_panes = "C2"
    return wb
