"""Cấp bậc (rank) lưu MÃ thay vì nhãn.

Form nhận việc trước đây lưu nhãn ('Nhân viên', 'Leader'...) vào Employee.rank / OnboardingProcess.rank,
còn trang sửa hồ sơ lưu mã (STAFF, LEADER...). Migration đổi các nhãn đã biết sang mã; giá trị lạ GIỮ
NGUYÊN và in ra để HCNS rà soát. Không đảo ngược được (không biết bản ghi nào vốn là nhãn) -> reverse no-op.

Bảng ánh xạ chép cứng (bản chụp employee.models.RANK_CHOICES + RANK_LEGACY_LABELS lúc viết migration).
"""
import unicodedata
from collections import Counter

from django.db import migrations

RANK_CHOICES = [
    ('CHAIRMAN', 'Chủ tịch'),
    ('DIRECTOR', 'Giám đốc'),
    ('DEPUTY_DIRECTOR', 'Phó Giám đốc'),
    ('LEADER', 'Leader'),
    ('SUPERVISOR', 'Quản lý'),
    ('MANAGER', 'Trưởng phòng'),
    ('MANAGER_TRAINEE', 'Trưởng phòng tập sự'),
    ('DEPUTY_MANAGER', 'Phó phòng'),
    ('STAFF', 'Nhân viên'),
    ('INTERN', 'Thực tập sinh'),
]
LEGACY_LABELS = {'Trưởng nhóm': 'LEADER'}


def _key(value):
    return unicodedata.normalize('NFC', str(value)).strip().casefold()


LOOKUP = {}
for _code, _label in RANK_CHOICES:
    LOOKUP[_key(_code)] = _code
    LOOKUP[_key(_label)] = _code
for _label, _code in LEGACY_LABELS.items():
    LOOKUP[_key(_label)] = _code


def _convert(model, label):
    unknown = Counter()
    changed = 0
    for pk, rank in model.objects.exclude(rank__isnull=True).exclude(rank='').values_list('pk', 'rank'):
        code = LOOKUP.get(_key(rank))
        if code is None:
            unknown[rank] += 1
        elif code != rank:
            model.objects.filter(pk=pk).update(rank=code)
            changed += 1
    if changed or unknown:
        print(f'\n  [{label}.rank] đổi nhãn -> mã: {changed} bản ghi')
    if unknown:
        listing = ', '.join(f'{value!r} x{count}' for value, count in unknown.most_common())
        print(f'  [{label}.rank] giữ nguyên giá trị không nhận ra (cần rà soát): {listing}')


def forwards(apps, schema_editor):
    _convert(apps.get_model('employee', 'Employee'), 'Employee')
    _convert(apps.get_model('hrm', 'OnboardingProcess'), 'OnboardingProcess')


class Migration(migrations.Migration):

    dependencies = [
        ('employee', '0004_social_insurance_period'),
        ('hrm', '0018_manager_incomplete_explanation_quota'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
