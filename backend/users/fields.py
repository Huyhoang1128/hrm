"""Field DRF dùng chung cho thông tin người dùng."""
from rest_framework import serializers

from .utils import get_user_display_name


class UserDisplayNameField(serializers.Field):
    """Họ tên hiển thị (read-only) của 1 User, xem get_user_display_name.

    Dùng thay cho CharField(source='x.get_full_name'): User lưu tên Việt Nam
    tách đôi nên get_full_name() ra tên bị đảo.
    """

    def __init__(self, **kwargs):
        kwargs['read_only'] = True
        super().__init__(**kwargs)

    def to_representation(self, user):
        return get_user_display_name(user)
