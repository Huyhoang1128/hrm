#!/usr/bin/env python
"""Chặn migration xung đột trước khi merge.

Vì sao cần: khi deploy, `python manage.py migrate` chạy trước khi app khởi động.
Hai nhánh cùng thêm migration cho một app (hai "nhánh lá") làm migrate thất bại,
app không lên được. Bước này phát hiện sớm ngay từ lúc mở PR.

Dùng chính MigrationLoader của Django chứ không tự đọc file: nó hiểu cả
migration squash (`replaces`) và `run_before`, tự parse bằng tay sẽ báo nhầm.

Không cần database — MigrationLoader(None) chỉ đọc file trên đĩa.
"""
import os
import sys
from pathlib import Path

# Chạy bằng `python scripts/check_migrations.py` thì sys.path[0] là thư mục
# scripts/, không phải thư mục backend — thêm vào trước khi gọi django.setup().
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import django  # noqa: E402

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.db.migrations.loader import MigrationLoader  # noqa: E402


def main() -> int:
    loader = MigrationLoader(None, ignore_no_migrations=True)
    conflicts = loader.detect_conflicts()
    if not conflicts:
        print("OK — mỗi app chỉ có một nhánh lá, migrate sẽ chạy được.")
        return 0

    print("LỖI — có app nhiều hơn một nhánh lá, migrate sẽ thất bại.\n")
    for app, leaves in sorted(conflicts.items()):
        print(f"  app '{app}' có {len(leaves)} nhánh lá:")
        for leaf in sorted(leaves):
            print(f"      - {leaf}")
    print(
        "\nCách sửa: chạy `python manage.py makemigrations --merge` rồi commit "
        "file merge sinh ra."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
