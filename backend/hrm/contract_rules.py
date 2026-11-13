"""Quy định thời hạn hợp đồng — NGUỒN DUY NHẤT cho backend và web (qua system-rules section "hr").

- "Sắp hết hạn": ngày kết thúc trong [hôm nay, hôm nay + CONTRACT_EXPIRING_SOON_DAYS] (gồm 2 đầu mút),
  tức còn <= N ngày. Dùng cho cảnh báo HĐ (expiring-alert, expiring_soon), bộ lọc danh sách nhân viên
  và các nhãn / banner trên web.
- Trang tái ký: mặc định CONTRACT_RENEWAL_WINDOW_DAYS ngày, người dùng truyền ?days= thì kẹp trong
  [RENEWAL_WINDOW_MIN_DAYS, RENEWAL_WINDOW_MAX_DAYS].

Cảnh báo quan trọng (hrm/important_alerts.py, IMPORTANT_ALERT_CONTRACT_DAYS) là khái niệm riêng, không dùng ở đây.
Đọc settings lúc gọi (không cache lúc import) để đổi env / override_settings là có hiệu lực.
"""
from datetime import timedelta

from django.conf import settings

RENEWAL_WINDOW_MIN_DAYS = 1
RENEWAL_WINDOW_MAX_DAYS = 90


def expiring_soon_days():
    return int(settings.CONTRACT_EXPIRING_SOON_DAYS)


def expiring_soon_window(today):
    """(từ ngày, đến ngày) — gồm cả 2 đầu mút."""
    return today, today + timedelta(days=expiring_soon_days())


def renewal_window_default_days():
    return int(settings.CONTRACT_RENEWAL_WINDOW_DAYS)


def resolve_renewal_window_days(raw):
    """Số ngày tái ký từ tham số ?days= (sai / trống -> mặc định), kẹp trong khoảng cho phép."""
    try:
        days = int(raw)
    except (TypeError, ValueError):
        days = renewal_window_default_days()
    return max(RENEWAL_WINDOW_MIN_DAYS, min(days, RENEWAL_WINDOW_MAX_DAYS))
