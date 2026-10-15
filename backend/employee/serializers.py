from rest_framework import serializers
from django.utils import timezone
from .models import BirthdayWish, Employee


class EmployeeBriefSerializer(serializers.ModelSerializer):
    """Thông tin tóm tắt nhân viên dùng trong lời chúc sinh nhật"""
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = ['id', 'employee_id', 'full_name', 'avatar_url']

    def get_avatar_url(self, obj):
        if obj.avatar:
            try:
                from hrm.utils import get_cloudfly_presigned_url
                return get_cloudfly_presigned_url(str(obj.avatar))
            except Exception:
                return None
        return None


class BirthdayWishSerializer(serializers.ModelSerializer):
    """Serializer đọc lời chúc sinh nhật"""
    recipient = EmployeeBriefSerializer(read_only=True)
    sender = EmployeeBriefSerializer(read_only=True)

    class Meta:
        model = BirthdayWish
        fields = ['id', 'recipient', 'sender', 'message', 'year', 'is_liked', 'created_at', 'updated_at']
        read_only_fields = ['id', 'is_liked', 'created_at', 'updated_at']


class EmployeeCodeRelatedField(serializers.Field):
    """Field nhận mã nhân viên (employee_id string) và trả về Employee instance"""

    def to_internal_value(self, data):
        try:
            return Employee.objects.get(employee_id=data)
        except Employee.DoesNotExist:
            pass
        # Fallback: thử tìm theo PK (id số nguyên)
        if str(data).isdigit():
            try:
                return Employee.objects.get(pk=int(data))
            except Employee.DoesNotExist:
                pass
        raise serializers.ValidationError(f"Không tìm thấy nhân viên với mã '{data}'.")

    def to_representation(self, value):
        return value.employee_id


class BirthdayWishCreateSerializer(serializers.ModelSerializer):
    """Serializer tạo lời chúc sinh nhật"""
    recipient = EmployeeCodeRelatedField(
        write_only=True,
    )
    sender = EmployeeCodeRelatedField(
        write_only=True,
    )

    class Meta:
        model = BirthdayWish
        fields = ['id', 'recipient', 'sender', 'message', 'year', 'created_at']
        read_only_fields = ['id', 'created_at']

    def validate(self, attrs):
        recipient = attrs.get('recipient')
        sender = attrs.get('sender')
        year = attrs.get('year', timezone.now().year)

        if recipient == sender:
            raise serializers.ValidationError("Không thể gửi lời chúc cho chính mình.")

        attrs['year'] = year
        return attrs

    def to_representation(self, instance):
        return BirthdayWishSerializer(instance, context=self.context).data
