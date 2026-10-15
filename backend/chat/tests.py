from io import BytesIO
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image
from rest_framework.test import APIRequestFactory, force_authenticate

from .views import ChatImageUploadView


class ChatImageUploadViewTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='chat-image-user')
        self.factory = APIRequestFactory()

    def post_image(self, image):
        request = self.factory.post('/api/chat/images/', {'image': image}, format='multipart')
        force_authenticate(request, user=self.user)
        return ChatImageUploadView.as_view()(request)

    def test_rejects_image_larger_than_500_kb(self):
        image = SimpleUploadedFile('large.png', b'x' * (500 * 1024 + 1), content_type='image/png')
        response = self.post_image(image)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['detail'], 'Kích thước ảnh tối đa là 500 KB.')

    def test_rejects_invalid_image_content(self):
        image = SimpleUploadedFile('fake.png', b'not-an-image', content_type='image/png')
        response = self.post_image(image)
        self.assertEqual(response.status_code, 400)

    @patch('chat.views.upload_file_to_cloudfly', return_value='chat/images/test.png')
    def test_uploads_valid_image_to_s3(self, upload_mock):
        buffer = BytesIO()
        Image.new('RGB', (2, 2), 'red').save(buffer, format='PNG')
        image = SimpleUploadedFile('valid.png', buffer.getvalue(), content_type='image/png')
        response = self.post_image(image)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['file_url'], 'chat/images/test.png')
        upload_mock.assert_called_once()
