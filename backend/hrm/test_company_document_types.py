"""Lọc tài liệu công ty theo loại — đúng mã COMPANY_DOCUMENT_TYPE mà các trang Nội quy / Mẫu
giấy tờ / Quy trình làm việc / Đào tạo gửi lên (frontend company-document.service.ts)."""
import datetime as dt
import shutil
import tempfile

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from hrm.models import CompanyDocument

URL = '/api-hrm/company-documents/'
MEDIA = tempfile.mkdtemp(prefix='company-doc-test-')


@override_settings(CLOUDFLY_ENABLED=False, MEDIA_ROOT=MEDIA)
class CompanyDocumentTypeFilterTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.client.force_authenticate(User.objects.create_superuser('cd-admin', 'a@example.com', 'x'))
        for code, doc_type in [('CD-REG', 'REGULATION'), ('CD-FORM', 'FORM'), ('CD-PROC', 'PROCEDURE')]:
            CompanyDocument.objects.create(
                document_code=code, title=code, document_type=doc_type, status='PUBLISHED',
                file=SimpleUploadedFile(f'{code}.pdf', b'%PDF-1.4'), file_name=f'{code}.pdf', file_size=8,
                file_type='pdf', effective_from=dt.date(2026, 1, 1))

    def _codes(self, doc_type):
        res = self.client.get(URL, {'document_type': doc_type, 'status': 'PUBLISHED'})
        return res.status_code, [d['document_code'] for d in res.data.get('results', [])] if res.status_code == 200 else []

    def test_page_codes_match_backend_choices(self):
        self.assertEqual(self._codes('REGULATION'), (200, ['CD-REG']))
        self.assertEqual(self._codes('FORM'), (200, ['CD-FORM']))
        self.assertEqual(self._codes('PROCEDURE'), (200, ['CD-PROC']))

    def test_unknown_code_is_rejected(self):
        # Mã cũ của các trang (trước khi sửa) — backend không nhận
        for legacy in ('LABOR_RULE', 'INTERNAL_FORM', 'WORK_PROCEDURE'):
            self.assertEqual(self._codes(legacy)[0], 400, legacy)
