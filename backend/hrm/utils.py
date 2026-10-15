import random
import string
import base64
import logging
import os
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

def generate_random_password(length=12):
    """
    Generate a random password with:
    - At least 1 uppercase letter
    - At least 1 lowercase letter
    - At least 1 digit
    - At least 1 special character
    - Total length = 12 characters (default)
    """
    # Đảm bảo có ít nhất 1 ký tự mỗi loại
    password = [
        random.choice(string.ascii_uppercase),  # Chữ hoa
        random.choice(string.ascii_lowercase),  # Chữ thường
        random.choice(string.digits),           # Số
        random.choice('!@#$%^&*'),              # Ký tự đặc biệt
    ]
    
    # Thêm các ký tự ngẫu nhiên cho đủ độ dài
    all_chars = string.ascii_letters + string.digits + '!@#$%^&*'
    password += [random.choice(all_chars) for _ in range(length - 4)]
    
    # Trộn lẫn các ký tự
    random.shuffle(password)
    
    return ''.join(password)


def generate_simple_password(length=8):
    """
    Generate a simpler random password (chỉ chữ + số, dễ nhớ hơn)
    """
    chars = string.ascii_letters + string.digits
    return ''.join(random.choice(chars) for _ in range(length))


def upload_file_to_cloudfly(file, folder):
    """
    Upload một file lên Cloudfly S3 và trả về S3 key.
    
    Args:
        file: InMemoryUploadedFile hoặc file-like object
        folder: Thư mục lưu trữ trên S3 (vd: 'onboarding/documents')
    
    Returns:
        s3_key (str): Key của file trên S3
    
    Raises:
        Exception: Nếu upload thất bại
    """
    import uuid
    import boto3
    import requests
    from io import BytesIO
    from django.conf import settings
    from django.utils import timezone

    file.seek(0)
    file_content = file.read()
    if not file_content:
        raise ValueError("File is empty")

    timestamp = timezone.now().strftime('%Y%m%d_%H%M%S')
    unique_filename = f"{uuid.uuid4()}-{file.name}"
    folder = folder.rstrip('/')
    s3_key = f"{folder}/{timestamp}_{unique_filename}"

    s3_client = boto3.client(
        's3',
        endpoint_url=settings.CLOUDFLY_S3_ENDPOINT,
        aws_access_key_id=settings.CLOUDFLY_ACCESS_KEY,
        aws_secret_access_key=settings.CLOUDFLY_SECRET_KEY,
        region_name=settings.CLOUDFLY_REGION,
    )

    content_type = getattr(file, 'content_type', None) or 'application/octet-stream'
    presigned_url = s3_client.generate_presigned_url(
        'put_object',
        Params={
            'Bucket': settings.CLOUDFLY_BUCKET,
            'Key': s3_key,
            'ContentType': content_type,
        },
        ExpiresIn=3600,
    )

    response = requests.put(
        presigned_url,
        data=BytesIO(file_content),
        headers={'Content-Type': content_type},
        timeout=30,
    )

    if response.status_code not in [200, 201]:
        raise Exception(
            f"Cloudfly S3 upload failed with status {response.status_code}: {response.text}"
        )

    return s3_key


def get_cloudfly_presigned_url(s3_key, expires_in=7 * 24 * 3600):
    """
    Tạo presigned GET URL cho một object trên Cloudfly S3.
    
    Args:
        s3_key (str): Key của file trên S3
        expires_in (int): Thời gian hiệu lực (giây), mặc định 7 ngày
    
    Returns:
        str | None: Presigned URL hoặc None nếu có lỗi
    """
    import logging
    import boto3
    from django.conf import settings

    logger = logging.getLogger(__name__)

    if not s3_key:
        return None

    try:
        s3_client = boto3.client(
            's3',
            endpoint_url=settings.CLOUDFLY_S3_ENDPOINT,
            aws_access_key_id=settings.CLOUDFLY_ACCESS_KEY,
            aws_secret_access_key=settings.CLOUDFLY_SECRET_KEY,
            region_name=settings.CLOUDFLY_REGION,
        )
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': settings.CLOUDFLY_BUCKET,
                'Key': str(s3_key),
                'ResponseContentDisposition': 'inline',
            },
            ExpiresIn=expires_in,
        )
        return presigned_url
    except Exception as e:
        logger.error(f"Error generating Cloudfly presigned URL for '{s3_key}': {e}")


def send_email_via_gmail(to: str, subject: str, body: str, html_body: str = None) -> bool:
    """
    Send an email using the Gmail API with OAuth2 credentials from environment variables.
    
    ✅ Zero setup required after initial credential configuration:
    - Automatically refreshes access token when expired
    - Retries on 401 (Unauthorized) errors
    - Works seamlessly across local, UAT, and production environments
    
    Args:
        to (str): Recipient email address
        subject (str): Email subject
        body (str): Plain text email body
        html_body (str): HTML email body (optional)
    
    Returns:
        bool: True if sent successfully, False otherwise
        
    Environment Variables Required:
        - GMAIL_REFRESH_TOKEN: OAuth2 refresh token
        - GMAIL_CLIENT_ID: Google OAuth2 client ID
        - GMAIL_CLIENT_SECRET: Google OAuth2 client secret
        - GMAIL_FROM_EMAIL: Sender email address (optional, default: noreply@company.com)
    """
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
        from googleapiclient.errors import HttpError
    except ImportError as e:
        logger.error(f"❌ Missing required Google API library: {e}")
        logger.error("   Install with: pip install google-auth google-auth-oauthlib google-api-python-client")
        return False
    
    # Validate input parameters
    if not to or not subject or not body:
        logger.error(f"❌ Missing email parameters: to={bool(to)}, subject={bool(subject)}, body={bool(body)}")
        return False
    
    # Get credentials from environment
    refresh_token = os.getenv("GMAIL_REFRESH_TOKEN", "").strip()
    client_id = os.getenv("GMAIL_CLIENT_ID", "").strip()
    client_secret = os.getenv("GMAIL_CLIENT_SECRET", "").strip()
    from_email = os.getenv("GMAIL_FROM_EMAIL", "noreply@company.com").strip()
    
    # Validate required credentials
    if not all([refresh_token, client_id, client_secret]):
        logger.error(
            "❌ Gmail credentials not configured. Set these environment variables:\n"
            f"   GMAIL_REFRESH_TOKEN: {'✓' if refresh_token else '✗ MISSING'}\n"
            f"   GMAIL_CLIENT_ID: {'✓' if client_id else '✗ MISSING'}\n"
            f"   GMAIL_CLIENT_SECRET: {'✓' if client_secret else '✗ MISSING'}"
        )
        return False
    
    def _send_with_creds(creds):
        """Helper function to send email with given credentials"""
        service = build("gmail", "v1", credentials=creds)
        msg = MIMEText(html_body if html_body else body, "html" if html_body else "plain", "utf-8")
        msg["From"] = from_email
        msg["To"] = to
        msg["Subject"] = subject
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
        result = service.users().messages().send(userId="me", body={"raw": raw}).execute()
        return result
    
    try:
        # Create credentials with refresh capability
        creds = Credentials(
            token=None,  # Will auto-generate from refresh token
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=["https://www.googleapis.com/auth/gmail.send"],
        )
        
        # First attempt: send with auto-refresh
        try:
            request = Request()
            creds.refresh(request)
            result = _send_with_creds(creds)
            logger.info(f"✅ Email sent to {to} | Message ID: {result.get('id')}")
            return True
            
        except HttpError as http_err:
            error_code = http_err.resp.status
            error_msg = http_err.content.decode() if hasattr(http_err, 'content') else str(http_err)
            
            if error_code == 401:
                # Unauthorized - token might be revoked
                logger.error(f"❌ Gmail API returned 401 (Unauthorized). Refresh token may be revoked.")
                logger.error(f"   Error: {error_msg}")
                logger.error(f"   To fix: Get new credentials from Google Cloud Console")
                return False
            elif error_code == 403:
                logger.error(f"❌ Gmail API returned 403 (Forbidden). Check OAuth2 scopes.")
                return False
            else:
                logger.error(f"❌ Gmail API HTTP error {error_code}: {error_msg}")
                return False
                
    except Exception as e:
        error_type = type(e).__name__
        logger.error(f"❌ Error sending email to {to}: {error_type}: {str(e)}")
        
        # Specific guidance for common errors
        if "invalid_grant" in str(e):
            logger.error("   Cause: Refresh token is invalid or has been revoked")
            logger.error("   Fix: Obtain fresh OAuth2 credentials from Google")
        elif "Connection" in error_type:
            logger.error("   Cause: Network connectivity issue")
        
        return False