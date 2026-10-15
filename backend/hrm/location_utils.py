import math
from django.core.cache import cache

_BRANCH_CACHE_KEY = 'active_branch_locations_v2'
_BRANCH_CACHE_TTL = 300  # 5 phút


def haversine_distance(lat1, lon1, lat2, lon2):
    """Tính khoảng cách (mét) giữa 2 toạ độ GPS theo công thức Haversine."""
    R = 6371000
    phi1 = math.radians(float(lat1))
    phi2 = math.radians(float(lat2))
    dphi = math.radians(float(lat2) - float(lat1))
    dlambda = math.radians(float(lon2) - float(lon1))
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def validate_checkin_location(employee, latitude, longitude):
    """Giữ lại để tương thích — dùng validate_attendance_location thay thế."""
    return validate_attendance_location(latitude, longitude)


def validate_checkout_location(latitude, longitude):
    """Alias — cả check-in lẫn checkout đều dùng chung logic."""
    return validate_attendance_location(latitude, longitude)


def validate_attendance_location(latitude, longitude):
    """
    Chọn branch để chấm công.

    QUAN TRỌNG: không chỉ xét branch gần nhất tuyệt đối rồi so với bán kính của
    riêng branch đó — nếu 2 cơ sở đứng gần nhau (vd: 500m), sai số GPS/tọa độ
    đăng ký vài trăm mét là đủ khiến branch "gần nhất" tính ra lại KHÁC branch
    mà nhân viên thực sự đang đứng trong bán kính hợp lệ, dẫn tới bị từ chối
    chấm công dù đang đứng đúng chỗ (báo "cách cơ sở khác Xm" một cách khó hiểu).
    Thay vào đó: xét TẤT CẢ branch active, ưu tiên branch gần nhất trong số các
    branch mà nhân viên đang nằm trong bán kính; chỉ khi không có branch nào
    hợp lệ mới fallback về branch gần nhất tuyệt đối (để thông báo lỗi có ý nghĩa).
    """
    try:
        branches = cache.get(_BRANCH_CACHE_KEY)
    except Exception:
        branches = None

    if branches is None:
        branches = _load_branches_from_db()
        try:
            cache.set(_BRANCH_CACHE_KEY, branches, _BRANCH_CACHE_TTL)
        except Exception:
            pass

    if not branches:
        return None, None, False

    nearest = None
    min_dist = None
    best_in_range = None
    best_in_range_dist = None
    for b in branches:
        d = haversine_distance(latitude, longitude, b['latitude'], b['longitude'])
        if min_dist is None or d < min_dist:
            min_dist = d
            nearest = b
        if d <= b['radius_meters'] and (best_in_range_dist is None or d < best_in_range_dist):
            best_in_range_dist = d
            best_in_range = b

    if best_in_range:
        return best_in_range, best_in_range_dist, True
    return nearest, min_dist, False


def _load_branches_from_db():
    """Load branches từ DB và trả về list of dicts (W3: không pickle ORM object)."""
    from .attendance_models import BranchLocation
    return list(
        BranchLocation.objects.filter(is_active=True).values(
            'id', 'name', 'latitude', 'longitude', 'radius_meters'
        )
    )


def find_nearest_branch(latitude, longitude):
    """
    Tìm BranchLocation active gần tọa độ nhất.
    Cache 5 phút dưới dạng list of dicts (không pickle ORM).
    Fallback về DB nếu Redis down.

    Returns:
        (branch_dict, distance_meters) hoặc (None, None)
    """
    # W2: Fallback về DB nếu Redis down
    try:
        branches = cache.get(_BRANCH_CACHE_KEY)
    except Exception:
        branches = None

    if branches is None:
        branches = _load_branches_from_db()
        try:
            cache.set(_BRANCH_CACHE_KEY, branches, _BRANCH_CACHE_TTL)
        except Exception:
            pass  # Redis down — dùng data vừa load, không crash

    if not branches:
        return None, None

    nearest = None
    min_dist = None
    for b in branches:
        d = haversine_distance(latitude, longitude, b['latitude'], b['longitude'])
        if min_dist is None or d < min_dist:
            min_dist = d
            nearest = b
    return nearest, min_dist


def invalidate_branch_cache():
    """Xóa cache branches — gọi sau khi thêm/sửa/xóa BranchLocation."""
    try:
        cache.delete(_BRANCH_CACHE_KEY)
    except Exception:
        pass
