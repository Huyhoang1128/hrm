from rest_framework.permissions import BasePermission


class IsSuperUser(BasePermission):
    """Chỉ cho phép superuser truy cập."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


class IsAdminOrHR(BasePermission):
    """Chỉ Admin hoặc HCNS (theo vai trò của get_user_role)."""
    message = 'Chỉ Admin hoặc HCNS được thực hiện thao tác này.'

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        from users.utils import get_user_role
        return get_user_role(user) in ('admin', 'hr')
