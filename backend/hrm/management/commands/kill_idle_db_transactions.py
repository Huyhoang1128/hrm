"""
hrm/management/commands/kill_idle_db_transactions.py
═════════════════════════════════════════════════════
Huỷ các phiên Postgres đang "idle in transaction" quá lâu — phiên kiểu này
KHÔNG chạy gì cả nhưng vẫn giữ nguyên mọi lock nó đã lấy, nên chặn đứng
ALTER TABLE của `manage.py migrate`.

VÌ SAO CẦN COMMAND NÀY dù Postgres đã có `idle_in_transaction_session_timeout`:
server đang đặt 2 phút (toàn cục) và 10 phút (cấp database), NHƯNG bất kỳ
client nào cũng tự `SET idle_in_transaction_session_timeout = 0` cho phiên của
mình để vô hiệu hoá — và không có cách nào cấm ở phía server. Sự cố
2026-09-24: một phiên công cụ GUI xem DB (query `EXECUTE getColumnACLs`) treo
5 giờ 16 phút, chặn migration 0060 chạy lúc container khởi động; deploy vẫn
báo thành công nên code mới lên prod trong khi cột chưa được tạo — mọi truy
vấn Employee lỗi `column ... does not exist` cho tới khi phiên treo được gỡ.

An toàn: chỉ đụng tới phiên ở trạng thái 'idle in transaction' (đang MỞ
transaction nhưng không làm gì), KHÔNG đụng phiên đang chạy query thật, cũng
không đụng phiên 'idle' bình thường (không mở transaction — vô hại). Việc huỷ
tương đương rollback transaction dở dang đó.

Cách dùng:
  python manage.py kill_idle_db_transactions --dry-run        # chỉ liệt kê
  python manage.py kill_idle_db_transactions                  # huỷ phiên treo > 10 phút
  python manage.py kill_idle_db_transactions --minutes 30     # đổi ngưỡng

Chạy định kỳ bằng cron trên server (xem docs/), hoặc qua GitHub Actions
workflow "Run manage.py command" khi cần gỡ gấp.
"""
from django.core.management.base import BaseCommand
from django.db import connection

DEFAULT_MINUTES = 10


class Command(BaseCommand):
    help = "Huỷ các phiên Postgres 'idle in transaction' quá ngưỡng (mặc định 10 phút)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--minutes", type=int, default=DEFAULT_MINUTES,
            help=f"Ngưỡng tuổi transaction, tính bằng phút (mặc định {DEFAULT_MINUTES}).",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Chỉ liệt kê, không huỷ phiên nào.",
        )

    def handle(self, *args, **options):
        minutes = options["minutes"]
        dry_run = options["dry_run"]

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT pid, usename, application_name, client_addr,
                       now() - xact_start AS xact_age,
                       left(query, 120)
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND pid <> pg_backend_pid()
                  AND state = 'idle in transaction'
                  AND xact_start IS NOT NULL
                  AND now() - xact_start > make_interval(mins => %s)
                ORDER BY xact_start
                """,
                [minutes],
            )
            rows = cursor.fetchall()

            if not rows:
                self.stdout.write(f"Không có phiên nào 'idle in transaction' quá {minutes} phút.")
                return

            self.stdout.write(
                self.style.WARNING(f"Tìm thấy {len(rows)} phiên treo quá {minutes} phút:")
            )
            for pid, usename, app, addr, age, query in rows:
                self.stdout.write(
                    f"  pid={pid} user={usename} app={app!r} client={addr} treo={age}\n"
                    f"      query: {query}"
                )

            if dry_run:
                self.stdout.write(self.style.WARNING("[DRY-RUN] Không huỷ phiên nào."))
                return

            killed = 0
            for pid, *_ in rows:
                cursor.execute("SELECT pg_terminate_backend(%s)", [pid])
                if cursor.fetchone()[0]:
                    killed += 1
            self.stdout.write(self.style.SUCCESS(f"Đã huỷ {killed}/{len(rows)} phiên treo."))
