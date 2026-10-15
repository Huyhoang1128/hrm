"""
Utilities to fill DOCX template with context and convert to PDF using LibreOffice.

LibreOffice (soffice) phải có sẵn trong container.
docxtpl dùng cú pháp Jinja2 để fill placeholder: {{ var }}, {% if x %}.
"""
import os
import shutil
import subprocess
import tempfile
import unicodedata
from typing import Dict, Any

from docxtpl import DocxTemplate


def _normalize_vn(s: str) -> str:
    """Chuẩn hoá text tiếng Việt: NFC + lower case, bỏ dấu cách thừa."""
    if not s:
        return ''
    return unicodedata.normalize('NFC', s).lower()


SOFFICE_BIN = "/usr/bin/soffice"


def _lo_env(profile_dir: str) -> dict:
    """
    Env cho subprocess gọi LibreOffice headless:
    - SAL_USE_VCLPLUGIN=svp ép dùng backend render headless-safe, tránh crash do
      cố dò tìm X11/OpenGL không tồn tại trong container.
    - HOME trỏ vào profile riêng để tránh xung đột quyền ghi ở $HOME mặc định.
    """
    return {**os.environ, 'SAL_USE_VCLPLUGIN': 'svp', 'HOME': profile_dir}


def is_valid_docx(path: str) -> bool:
    """
    Kiểm tra file có phải DOCX chuẩn không bằng cách thử mở với python-docx.
    DOCX thực sự là 1 file ZIP container chứa XML.
    """
    try:
        from docx import Document
        Document(path)
        return True
    except Exception:
        return False


def convert_to_docx(input_path: str, output_dir: str) -> str:
    """
    Convert bất kỳ file Word nào (.doc / .docx / .rtf / .odt) sang DOCX chuẩn
    bằng LibreOffice headless. Trả về đường dẫn file .docx đã convert.
    """
    if not os.path.exists(SOFFICE_BIN):
        raise RuntimeError(f"LibreOffice không tồn tại tại {SOFFICE_BIN}")

    os.makedirs(output_dir, exist_ok=True)
    lo_profile_dir = tempfile.mkdtemp(prefix="lo_profile_")
    try:
        cmd = [
            SOFFICE_BIN,
            "--headless",
            f"-env:UserInstallation=file://{lo_profile_dir}",
            "--convert-to", "docx",
            "--outdir", output_dir,
            input_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=_lo_env(lo_profile_dir))
    finally:
        shutil.rmtree(lo_profile_dir, ignore_errors=True)

    base = os.path.splitext(os.path.basename(input_path))[0]
    docx_path = os.path.join(output_dir, f"{base}.docx")
    # LibreOffice có thể trả về returncode != 0 chỉ vì cảnh báo javaldx (thiếu Java
    # runtime) dù file vẫn được tạo thành công → chỉ coi là lỗi thật khi file không tồn tại.
    if not os.path.exists(docx_path):
        raise RuntimeError(
            f"LibreOffice convert sang DOCX thất bại (return code {result.returncode}): "
            f"{result.stderr or result.stdout}"
        )
    return docx_path


def normalize_docx_upload(file_obj) -> tuple:
    """
    Nhận 1 InMemoryUploadedFile/TemporaryUploadedFile từ Django:
    - Nếu đã là DOCX hợp lệ → giữ nguyên
    - Nếu là .doc / .docx bị lỗi → convert qua LibreOffice
    Trả về (bytes_or_None, was_converted): bytes mới nếu đã convert, None nếu giữ nguyên
    """
    tmpdir = tempfile.mkdtemp(prefix="upload_norm_")
    try:
        # Lưu file upload tạm để check
        original_name = getattr(file_obj, 'name', 'upload.bin')
        original_path = os.path.join(tmpdir, original_name)
        with open(original_path, 'wb') as f:
            for chunk in file_obj.chunks():
                f.write(chunk)
        # Reset file pointer để Django có thể đọc lại nếu cần
        try:
            file_obj.seek(0)
        except Exception:
            pass

        if is_valid_docx(original_path):
            return None, False

        # Không phải DOCX hợp lệ → thử convert
        converted_path = convert_to_docx(original_path, tmpdir)
        with open(converted_path, 'rb') as f:
            return f.read(), True
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def fill_docx(template_path: str, context: Dict[str, Any], output_path: str) -> str:
    """Fill DOCX template với context và lưu ra output_path."""
    doc = DocxTemplate(template_path)
    doc.render(context)
    doc.save(output_path)
    return output_path


# ==========================================================================
# SMART FILL cho form đơn không có placeholder Jinja sẵn.
# Nhận diện label phía trước các dấu "........" rồi fill data vào.
# ==========================================================================

# Map: (keywords phải có trong text - lower) -> context key
# Dùng tuple các keyword để match chính xác hơn (vd "mã nv" không trùng "nơi làm việc")
_RESIGNATION_LABELS = [
    (('Họ và tên',), 'full_name'),
    (('Mã NV',), 'employee_id'),
    (('Chức vụ',), 'position'),
    (('Phòng', 'ban', 'bộ phận'), 'department'),
    (('Hình thức làm việc',), 'contract_type'),
    (('Lý do xin nghỉ việc',), 'reason'),
    (('Bắt đầu nghỉ việc từ ngày',), 'expected_full_date'),
]

# Regex bắt các dấu chấm liên tiếp (thường xuất hiện trong form mẫu)
import re as _re
_DOTS_RE = _re.compile(r'[.\s]*\.{3,}[.\s]*$')
_DATE_LINE_RE = _re.compile(r'ngày\s*\.{2,}\s*tháng\s*\.{2,}\s*năm\s*(\d{4})?', _re.IGNORECASE)


def _set_paragraph_text(paragraph, new_text: str):
    """
    Thay toàn bộ text của 1 paragraph mà vẫn giữ format của run đầu tiên.
    Các run sau sẽ bị xoá text.
    """
    if not paragraph.runs:
        paragraph.add_run(new_text)
        return
    paragraph.runs[0].text = new_text
    for r in paragraph.runs[1:]:
        r.text = ''


def _copy_run_font(src_run, dst_run):
    """Copy font properties (name, size, color) từ src_run sang dst_run
    để run mới đồng bộ với format gốc của paragraph."""
    if src_run is None or dst_run is None:
        return
    try:
        if src_run.font.name:
            dst_run.font.name = src_run.font.name
        if src_run.font.size:
            dst_run.font.size = src_run.font.size
        if src_run.font.color and src_run.font.color.rgb:
            dst_run.font.color.rgb = src_run.font.color.rgb
        if src_run.font.italic is not None:
            dst_run.font.italic = src_run.font.italic
    except Exception:
        pass


def _set_paragraph_label_value(paragraph, label_text: str, value_text: str):
    """
    Set paragraph thành 2 phần: label (giữ format gốc) + value (bold + cùng font/size).
    Dùng khi muốn nổi bật giá trị fill so với label.
    """
    # Lưu reference của run đầu để copy format sang value_run sau này
    src_run = paragraph.runs[0] if paragraph.runs else None

    # Clear text của tất cả run cũ
    for r in paragraph.runs:
        r.text = ''
    if paragraph.runs:
        paragraph.runs[0].text = f"{label_text} "
    else:
        paragraph.add_run(f"{label_text} ")
    value_run = paragraph.add_run(str(value_text))
    value_run.bold = True
    # Copy font/size từ run gốc để value không bị to hơn
    _copy_run_font(src_run, value_run)


def smart_fill_resignation_form(template_path: str, context: Dict[str, Any], output_path: str) -> str:
    """
    Fill form đơn nghỉ việc chuẩn (không có placeholder Jinja).
    Logic:
    - Với mỗi paragraph trong docx, kiểm tra text có chứa label quen thuộc
    - Nếu có → thay dấu "........" sau label bằng giá trị thực
    - Xử lý đặc biệt cho dòng ngày "Hà Nội, ngày ... tháng ... năm 2026"
    """
    from docx import Document

    doc = Document(template_path)

    # Chuẩn hoá keyword labels 1 lần để so sánh chính xác
    normalized_labels = [
        (tuple(_normalize_vn(kw) for kw in keywords), key)
        for keywords, key in _RESIGNATION_LABELS
    ]

    # Track index của paragraph "Lý do xin nghỉ việc" để cleanup các dòng "...."
    # ngay sau đó (chúng là tab-leader paragraph, text rỗng nhưng render ra dấu chấm)
    reason_para_idx = None

    for idx, para in enumerate(doc.paragraphs):
        text = para.text
        if not text.strip():
            continue
        text_lower = _normalize_vn(text)

        # 1. Xử lý dòng "ngày ... tháng ... năm YYYY"
        if _DATE_LINE_RE.search(text_lower):
            day = context.get('today_day', '')
            month = context.get('today_month', '')
            year = context.get('today_year', '')
            # Giữ phần đầu (vd "Hà Nội ,") nếu có
            prefix_match = _re.match(r'^(.*?)(ngày)', text, _re.IGNORECASE)
            prefix = prefix_match.group(1) if prefix_match else ''
            value = f"ngày {day} tháng {month} năm {year}"
            _set_paragraph_label_value(para, prefix.rstrip(), value)
            continue

        # 2. Xử lý các label chuẩn
        matched = False
        for keywords, key in normalized_labels:
            if all(kw in text_lower for kw in keywords):
                value = context.get(key, '')
                # Tìm vị trí dấu ":" để giữ label phía trước
                colon_idx = text.find(':')
                if colon_idx >= 0:
                    label = text[:colon_idx + 1]
                    # Bỏ phần "(Thử việc/Chính thức)" hoặc bất kỳ ghi chú
                    # gợi ý nào trong ngoặc tròn ngay trước dấu ":"
                    label = _re.sub(r'\s*\([^)]*\)\s*:', ':', label)
                    _set_paragraph_label_value(para, label, value)
                    matched = True
                    # Đánh dấu paragraph "Lý do xin nghỉ việc" để cleanup
                    # các dòng tab-leader (rỗng nhưng render dấu chấm) phía sau
                    if 'lý do xin nghỉ việc' in text_lower:
                        reason_para_idx = idx
                    break
        if matched:
            continue

        # 3. Xử lý dòng "Bắt đầu nghỉ việc từ ngày: .../.../......."
        if 'bắt đầu nghỉ việc từ ngày' in _normalize_vn(text):
            exp_day = context.get('expected_day', '')
            exp_month = context.get('expected_month', '')
            exp_year = context.get('expected_year', '')
            value = f"{exp_day}/{exp_month}/{exp_year}"
            _set_paragraph_label_value(para, 'Bắt đầu nghỉ việc từ ngày:', value)
            continue

        # 4. "Người làm đơn" - block căn giữa ở nửa phải trang, bold label + tên
        if 'người làm đơn' in text_lower:
            full_name = context.get('full_name', '')
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            from docx.shared import Cm
            # Form gốc dùng leading spaces để đẩy text sang phải.
            # Cách hiển thị mong muốn: "Người làm đơn" và tên căn giữa với nhau,
            # nằm ở nửa phải của trang.
            # → set alignment CENTER + left_indent ~8cm để đẩy "block centered"
            #   sang phía phải. Trên A4 (21cm, lề 2cm) → vùng còn lại 11cm,
            #   center axis ở khoảng x = 2 + 8 + 11/2 ≈ 15.5cm.
            stripped = text.lstrip()
            src_run = para.runs[0] if para.runs else None
            for r in para.runs:
                r.text = ''
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            para.paragraph_format.left_indent = Cm(8)
            label_run = para.add_run(stripped)
            label_run.bold = True
            _copy_run_font(src_run, label_run)
            if full_name:
                # 4 line break để chừa chỗ ký tươi
                spacer_run = para.add_run()
                for _ in range(4):
                    spacer_run.add_break()
                _copy_run_font(src_run, spacer_run)
                name_run = para.add_run(full_name)
                name_run.bold = True
                # Tên người ký dùng cùng font/size với label "Người làm đơn"
                # (không tăng size) — giữ nhất quán cho khối chữ ký
                _copy_run_font(src_run, name_run)
            continue

    # Cleanup pass 1: xoá các paragraph chỉ chứa dấu chấm thuần text "............"
    dots_only_re = _re.compile(r'^[\s.•·]{3,}$')
    for para in doc.paragraphs:
        if para.text.strip() and dots_only_re.match(para.text.strip()):
            for r in para.runs:
                r.text = ''

    # Cleanup pass 2: xoá hẳn các paragraph rỗng ngay sau "Lý do xin nghỉ việc:"
    # Đây là các paragraph có tab-leader (Word tự render dấu chấm) → text rỗng
    # nhưng vẫn hiển thị dòng "............." trong PDF.
    # Stop khi gặp paragraph có nội dung (vd "Bắt đầu nghỉ việc từ ngày").
    if reason_para_idx is not None:
        all_paras = list(doc.paragraphs)
        i = reason_para_idx + 1
        while i < len(all_paras):
            p = all_paras[i]
            if p.text.strip():
                break
            # Xoá hẳn paragraph (không chỉ clear text) để loại bỏ tab leader
            p_element = p._element
            parent = p_element.getparent()
            if parent is not None:
                parent.remove(p_element)
            i += 1

    doc.save(output_path)
    return output_path


def convert_docx_to_pdf(docx_path: str, output_dir: str) -> str:
    """
    Convert .docx -> .pdf bằng LibreOffice headless.
    Trả về đường dẫn file PDF được tạo.
    """
    if not os.path.exists(SOFFICE_BIN):
        raise RuntimeError(f"LibreOffice không tồn tại tại {SOFFICE_BIN}")

    os.makedirs(output_dir, exist_ok=True)

    lo_profile_dir = tempfile.mkdtemp(prefix="lo_profile_")
    try:
        cmd = [
            SOFFICE_BIN,
            "--headless",
            f"-env:UserInstallation=file://{lo_profile_dir}",
            "--convert-to", "pdf",
            "--outdir", output_dir,
            docx_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=_lo_env(lo_profile_dir))
    finally:
        shutil.rmtree(lo_profile_dir, ignore_errors=True)

    base = os.path.splitext(os.path.basename(docx_path))[0]
    pdf_path = os.path.join(output_dir, f"{base}.pdf")
    # LibreOffice có thể trả về returncode != 0 chỉ vì cảnh báo javaldx (thiếu Java
    # runtime) dù file vẫn được tạo thành công → chỉ coi là lỗi thật khi file không tồn tại.
    if not os.path.exists(pdf_path):
        raise RuntimeError(
            f"LibreOffice convert thất bại (return code {result.returncode}): "
            f"{result.stderr or result.stdout}"
        )
    return pdf_path


def _has_jinja_placeholder(template_path: str) -> bool:
    """Kiểm tra file DOCX có placeholder Jinja {{ }} hay không."""
    try:
        from docx import Document
        doc = Document(template_path)
        for para in doc.paragraphs:
            if '{{' in para.text or '{%' in para.text:
                return True
        # Check trong tables nữa
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    for para in cell.paragraphs:
                        if '{{' in para.text or '{%' in para.text:
                            return True
    except Exception:
        return False
    return False


def render_template_to_pdf(template_path: str, context: Dict[str, Any]) -> bytes:
    """
    Fill template với context, convert sang PDF và trả về bytes.

    Logic:
    - Nếu template có placeholder Jinja `{{ var }}` → dùng docxtpl (chuẩn)
    - Nếu không → dùng smart_fill_resignation_form (nhận diện label trong form mẫu)

    Tự dọn dẹp temp files.
    """
    # Bổ sung biến tổng hợp cho smart-fill
    if context.get('expected_day') and context.get('expected_month') and context.get('expected_year'):
        context.setdefault(
            'expected_full_date',
            f"{context['expected_day']}/{context['expected_month']}/{context['expected_year']}"
        )

    tmpdir = tempfile.mkdtemp(prefix="reqtpl_")
    try:
        filled_docx = os.path.join(tmpdir, "filled.docx")
        if _has_jinja_placeholder(template_path):
            fill_docx(template_path, context, filled_docx)
        else:
            smart_fill_resignation_form(template_path, context, filled_docx)
        pdf_path = convert_docx_to_pdf(filled_docx, tmpdir)
        with open(pdf_path, "rb") as f:
            return f.read()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def render_raw_template_to_pdf(template_path: str) -> bytes:
    """
    Convert template gốc (chưa fill) sang PDF để admin xem template trông thế nào.
    Vẫn cần fill empty context để docxtpl không crash với placeholder.
    """
    tmpdir = tempfile.mkdtemp(prefix="reqtpl_raw_")
    try:
        # Fill với placeholder hiển thị nguyên (jinja undefined sẽ render rỗng)
        # → ta dùng docxtpl với context rỗng + jinja_env strict_undefined=False
        from jinja2 import Environment
        doc = DocxTemplate(template_path)
        env = Environment()
        env.undefined = type('SilentUndefined', (env.undefined,), {
            '__str__': lambda self: '',
            '__html__': lambda self: '',
        })
        try:
            doc.render({}, jinja_env=env)
        except Exception:
            # Fallback: copy thẳng file gốc
            shutil.copy(template_path, os.path.join(tmpdir, "raw.docx"))
            pdf_path = convert_docx_to_pdf(os.path.join(tmpdir, "raw.docx"), tmpdir)
            with open(pdf_path, "rb") as f:
                return f.read()

        filled_docx = os.path.join(tmpdir, "raw.docx")
        doc.save(filled_docx)
        pdf_path = convert_docx_to_pdf(filled_docx, tmpdir)
        with open(pdf_path, "rb") as f:
            return f.read()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
