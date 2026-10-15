#!/usr/bin/env python3
"""CLI wrapper cho ``hrm.asset_import.import_file``.

Run inside docker:
    docker compose exec web python /app/scripts/import_assets_from_excel.py \
        /app/docs/asset-import-sample-data.xlsx

Logic chính nằm ở ``backend/hrm/asset_import.py`` để dùng chung
với DRF endpoint ``AssetViewSet.bulk_import_excel`` (FE upload qua UI).
"""
import argparse
import os
import sys
from pathlib import Path

# Django setup
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, "/app")

import django  # noqa: E402

django.setup()

from hrm.asset_import import import_file  # noqa: E402


DEFAULT_INPUT = Path("/app/docs/asset-import-sample-data.xlsx")


def print_result(result: dict) -> None:
    print(f"Sheet: {result['sheet']}  ({result['data_rows']} data rows)")
    for d in result["details"]:
        action_icon = "✓" if d["action"] == "created" else "⟳"
        handover = f"  → bàn giao {d['handover_to']}" if d.get("handover_to") else ""
        warns = f"  ⚠ {'; '.join(d['warnings'])}" if d.get("warnings") else ""
        print(
            f"  row {d['row']:>3}: {action_icon} [{d['asset_code']}] {d['name']} "
            f"({d['asset_type']}){handover}{warns}"
        )
    for f in result["failed"]:
        print(f"  row {f['row']:>3}: ❌ {'; '.join(f['messages'])}")
    print()
    print("=" * 60)
    print(
        f"Total: {result['created']} created, {result['updated']} updated, "
        f"{result['failed_count']} failed"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", default=str(DEFAULT_INPUT))
    args = parser.parse_args()
    try:
        result = import_file(args.path)
    except FileNotFoundError as e:
        print(f"[ERROR] {e}")
        sys.exit(1)
    print_result(result)


if __name__ == "__main__":
    main()
