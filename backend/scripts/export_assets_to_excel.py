#!/usr/bin/env python3
"""CLI wrapper cho ``hrm.asset_export.build_workbook``.

Run inside docker:
    docker compose exec web python /app/scripts/export_assets_to_excel.py

Output: /app/docs/asset-export-current.xlsx
        (host: backend/docs/asset-export-current.xlsx)

Logic chính nằm ở ``backend/hrm/asset_export.py`` để dùng chung
với DRF endpoint ``AssetViewSet.export_excel`` (FE bấm "Xuất Excel").
"""
import os
import sys
from pathlib import Path

# Django setup
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, "/app")

import django  # noqa: E402

django.setup()

from hrm.asset_export import build_workbook  # noqa: E402
from hrm.models import Asset  # noqa: E402


OUTPUT = Path("/app/docs/asset-export-current.xlsx")


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    qs = (
        Asset.objects.filter(is_deleted=False)
        .select_related("department", "managed_by", "assigned_to")
        .order_by("asset_type", "id")
    )
    count = qs.count()
    wb = build_workbook(qs)
    wb.save(OUTPUT)
    print(f"[OK] Exported {count} assets -> {OUTPUT}")


if __name__ == "__main__":
    main()
