"""
recruitment/email_templates.py – Email template definitions for recruitment workflows.
"""

# Email templates for recruitment notifications
RECRUITMENT_EMAIL_TEMPLATES = {
    'interview_scheduled': {
        'code': 'INTERVIEW_SCHEDULED',
        'subject': 'Lịch phỏng vấn: {candidate_name} - {job_title}',
        'body_html': '''
<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
    <h2>Lịch Phỏng Vấn</h2>
    <p>Xin chào <strong>{candidate_name}</strong>,</p>
    <p>Chúng tôi vui mừng thông báo rằng bạn đã được mời tham gia phỏng vấn cho vị trí <strong>{job_title}</strong>.</p>
    
    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Thông tin phỏng vấn:</strong></p>
        <p>📅 <strong>Ngày giờ:</strong> {scheduled_at_formatted}</p>
        <p>⏱️ <strong>Thời lượng:</strong> {duration_minutes} phút</p>
        <p>📍 <strong>Địa điểm:</strong> {location}</p>
        <p>👤 <strong>Người phỏng vấn:</strong> {interviewer_names}</p>
    </div>
    
    <p>Vui lòng chuẩn bị kỹ lưỡng và có mặt 10 phút trước giờ hẹn. Nếu bạn không thể tham gia, vui lòng liên hệ với chúng tôi soonest possible.</p>
    
    <p>Chúc bạn phỏng vấn tốt!</p>
    <p>---<br/>
    Phòng Nhân Sự<br/>
    {company_name}</p>
</div>
        ''',
        'text_body': '''
Lịch Phỏng Vấn

Xin chào {candidate_name},

Chúng tôi vui mừng thông báo rằng bạn đã được mời tham gia phỏng vấn cho vị trí {job_title}.

Thông tin phỏng vấn:
- Ngày giờ: {scheduled_at_formatted}
- Thời lượng: {duration_minutes} phút
- Địa điểm: {location}
- Người phỏng vấn: {interviewer_names}

Vui lòng chuẩn bị kỹ lưỡng và có mặt 10 phút trước giờ hẹn.

Chúc bạn phỏng vấn tốt!

---
Phòng Nhân Sự
{company_name}
        ''',
        'variables': [
            'candidate_name', 'job_title', 'scheduled_at_formatted', 
            'duration_minutes', 'location', 'interviewer_names', 'company_name'
        ]
    },
    
    'offer_letter': {
        'code': 'OFFER_LETTER',
        'subject': 'Thư Đề Nghị Việc Làm - {job_title}',
        'body_html': '''
<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
    <h2>Thư Đề Nghị Việc Làm</h2>
    <p>Xin chào <strong>{candidate_name}</strong>,</p>
    <p>Chúng tôi vui mừng gửi tới bạn thư đề nghị việc làm cho vị trí <strong>{job_title}</strong> tại {company_name}.</p>
    
    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Chi tiết Offer:</strong></p>
        <p>💼 <strong>Vị trí:</strong> {job_title}</p>
        <p>💰 <strong>Lương đề xuất:</strong> {proposed_salary:,.0f} VND/tháng</p>
        <p>📌 <strong>Phụ cấp:</strong> {allowances:,.0f} VND/tháng</p>
        <p>📅 <strong>Ngày nhận việc dự kiến:</strong> {expected_onboard_date}</p>
        <p>⏰ <strong>Thời gian thử việc:</strong> {probation_months} tháng</p>
    </div>
    
    <p>Vui lòng xác nhận việc chấp nhận offer này trong vòng <strong>3 ngày làm việc</strong> kể từ ngày nhận được thư này.</p>
    
    <p style="margin-top: 30px;">Để chấp nhận hoặc từ chối offer, vui lòng truy cập: <a href="{offer_link}" style="color: #007bff; text-decoration: none;">{offer_link}</a></p>
    
    <p>Nếu bạn có bất kỳ câu hỏi nào, vui lòng liên hệ với Phòng Nhân Sự.</p>
    
    <p>---<br/>
    Phòng Nhân Sự<br/>
    {company_name}</p>
</div>
        ''',
        'text_body': '''
Thư Đề Nghị Việc Làm

Xin chào {candidate_name},

Chúng tôi vui mừng gửi tới bạn thư đề nghị việc làm cho vị trí {job_title} tại {company_name}.

Chi tiết Offer:
- Vị trí: {job_title}
- Lương đề xuất: {proposed_salary:,.0f} VND/tháng
- Phụ cấp: {allowances:,.0f} VND/tháng
- Ngày nhận việc dự kiến: {expected_onboard_date}
- Thời gian thử việc: {probation_months} tháng

Vui lòng xác nhận việc chấp nhận offer này trong vòng 3 ngày làm việc.

Để chấp nhận hoặc từ chối offer, vui lòng truy cập: {offer_link}

---
Phòng Nhân Sự
{company_name}
        ''',
        'variables': [
            'candidate_name', 'job_title', 'company_name', 'proposed_salary',
            'allowances', 'expected_onboard_date', 'probation_months', 'offer_link'
        ]
    },
    
    'joining_letter': {
        'code': 'JOINING_LETTER',
        'subject': 'Thư Nhận Việc - {job_title}',
        'body_html': '''
<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
    <h2>Thư Xác Nhận Nhận Việc</h2>
    <p>Xin chào <strong>{candidate_name}</strong>,</p>
    <p>Chúc mừng! Chúng tôi được xác nhận rằng bạn đã chấp nhận đề nghị việc làm cho vị trí <strong>{job_title}</strong>.</p>
    
    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Thông tin nhận việc:</strong></p>
        <p>💼 <strong>Vị trí:</strong> {job_title}</p>
        <p>📅 <strong>Ngày nhận việc:</strong> {confirmed_onboard_date}</p>
        <p>⏰ <strong>Giờ báo danh:</strong> {onboard_time} tại {office_location}</p>
        <p>👤 <strong>Người phụ trách onboarding:</strong> {hr_contact_name}</p>
        <p>📞 <strong>Liên hệ:</strong> {hr_contact_phone}</p>
    </div>
    
    <p><strong>Tài liệu cần chuẩn bị:</strong></p>
    <ul>
        <li>Giấy tờ tùy thân (CCCD/Hộ chiếu)</li>
        <li>Bằng cấp chứng chỉ có liên quan</li>
        <li>Giấy khám sức khỏe (nếu cần)</li>
        <li>Sổ bảo hiểm xã hội (nếu có)</li>
    </ul>
    
    <p>Vui lòng chuẩn bị kỹ lưỡng và có mặt đúng giờ. Nếu bạn có bất kỳ câu hỏi nào, vui lòng liên hệ trước ngày nhận việc.</p>
    
    <p>Chúng tôi mong chờ được làm việc cùng bạn!</p>
    
    <p>---<br/>
    Phòng Nhân Sự<br/>
    {company_name}</p>
</div>
        ''',
        'text_body': '''
Thư Xác Nhận Nhận Việc

Xin chào {candidate_name},

Chúc mừng! Bạn đã chấp nhận đề nghị việc làm cho vị trí {job_title}.

Thông tin nhận việc:
- Vị trí: {job_title}
- Ngày nhận việc: {confirmed_onboard_date}
- Giờ báo danh: {onboard_time} tại {office_location}
- Người phụ trách onboarding: {hr_contact_name}
- Liên hệ: {hr_contact_phone}

Tài liệu cần chuẩn bị:
- Giấy tờ tùy thân (CCCD/Hộ chiếu)
- Bằng cấp chứng chỉ
- Giấy khám sức khỏe (nếu cần)
- Sổ bảo hiểm xã hội (nếu có)

Vui lòng chuẩn bị kỹ lưỡng và có mặt đúng giờ.

---
Phòng Nhân Sự
{company_name}
        ''',
        'variables': [
            'candidate_name', 'job_title', 'confirmed_onboard_date', 
            'onboard_time', 'office_location', 'hr_contact_name', 
            'hr_contact_phone', 'company_name'
        ]
    },
    
    'referral_notification': {
        'code': 'REFERRAL_NOTIFICATION',
        'subject': 'Cảm ơn bạn đã giới thiệu - {candidate_name} vào vị trí {job_title}',
        'body_html': '''
<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
    <h2>Cảm Ơn Bạn Đã Giới Thiệu Ứng Viên</h2>
    <p>Xin chào <strong>{referrer_name}</strong>,</p>
    <p>Cảm ơn bạn vì đã giới thiệu <strong>{candidate_name}</strong> cho vị trí <strong>{job_title}</strong>.</p>
    
    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Cập nhật trạng thái:</strong></p>
        <p>👤 <strong>Ứng viên:</strong> {candidate_name}</p>
        <p>💼 <strong>Vị trí:</strong> {job_title}</p>
        <p>📊 <strong>Trạng thái hiện tại:</strong> {current_stage_display}</p>
        <p>📅 <strong>Cập nhật lần cuối:</strong> {updated_at_formatted}</p>
    </div>
    
    <p>Bạn có thể xem chi tiết quá trình tuyển dụng của ứng viên này tại: <a href="{tracking_link}" style="color: #007bff; text-decoration: none;">{tracking_link}</a></p>
    
    <p>Chúng tôi sẽ tiếp tục cập nhật diễn biến trong quá trình tuyển dụng.</p>
    
    <p>---<br/>
    Phòng Nhân Sự<br/>
    {company_name}</p>
</div>
        ''',
        'variables': [
            'referrer_name', 'candidate_name', 'job_title', 
            'current_stage_display', 'updated_at_formatted', 'tracking_link', 'company_name'
        ]
    }
}


def get_email_template(template_code: str) -> dict:
    """Get email template by code."""
    return RECRUITMENT_EMAIL_TEMPLATES.get(template_code)


def get_all_templates() -> dict:
    """Get all email templates."""
    return RECRUITMENT_EMAIL_TEMPLATES


def render_email_template(template_code: str, context: dict) -> dict:
    """
    Render email template with context variables.
    Returns {'subject': str, 'body_html': str, 'body_text': str}
    """
    template = get_email_template(template_code)
    if not template:
        raise ValueError(f"Template {template_code} not found")
    
    subject = template['subject'].format(**context)
    body_html = template['body_html'].format(**context)
    body_text = template['text_body'].format(**context)
    
    return {
        'subject': subject,
        'body_html': body_html,
        'body_text': body_text,
        'variables_used': template['variables']
    }
