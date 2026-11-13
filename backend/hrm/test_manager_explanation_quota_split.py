"""Rổ gộp hạn mức giải trình tách Quên chấm công (CompanyConfig.manager_incomplete_explanation_quota).

Nhân viên trong ManagerExplanationQuotaConfig, chế độ PER_TYPE:
- manager_incomplete_explanation_quota trống: như trước — mọi loại chung 1 rổ manager_combined.
- có số: Đi muộn + Về sớm (+ Đi muộn/Về sớm) chung rổ manager_combined, Quên chấm công rổ riêng.
Cùng 1 rule ở: trạng thái hạn mức (groups), duyệt lẻ, duyệt nhanh (kể cả dry_run), 2 engine.
"""
from datetime import date

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from employee.models import Employee
from hrm.attendance_engine import ExemptionRule
from hrm.event import Event
from hrm.event_models import EmployeeEvent
from hrm.explanation_quota import explanation_quota_status, quota_rules
from hrm.main_api import EmployeeState
from hrm.models import CompanyConfig, ManagerExplanationQuotaConfig

MONTH = date(2026, 8, 1)
URL = '/api-hrm/attendance-explanations/'


class ManagerQuotaSplitTests(APITestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(username='ms_admin', is_staff=True)
        Employee.objects.create(user=self.admin_user, employee_id='NV00531', full_name='Admin duyệt')
        self.tp = Employee.objects.create(user=User.objects.create_user(username='ms_tp'),
                                          employee_id='NV00532', full_name='Trưởng phòng')
        ManagerExplanationQuotaConfig.get_solo().eligible_employees.add(self.tp)
        CompanyConfig.objects.filter(is_active=True).update(is_active=False)
        self.cfg = CompanyConfig.objects.create(
            name='Cấu hình test', code='MS-TEST', is_active=True, effective_from=date(2026, 1, 1),
            max_explanation_count_per_month=3, explanation_quota_mode='PER_TYPE',
            max_late_explanation_per_month=1, max_early_leave_explanation_per_month=1,
            max_incomplete_attendance_explanation_per_month=1, manager_combined_explanation_quota=5,
            manager_incomplete_explanation_quota=1)
        self.client.force_authenticate(self.admin_user)

    def _ev(self, explanation_type, day, approved=False):
        return EmployeeEvent.objects.create(
            employee=self.tp, event_date=MONTH.replace(day=day), event_type=EmployeeEvent.EventType.EXPLANATION,
            data={'explanation_type': explanation_type, 'status': 'APPROVED' if approved else 'PENDING'})

    def test_status_has_two_pools(self):
        for day, t in ((1, 'LATE'), (2, 'EARLY_LEAVE'), (3, 'LATE_EARLY'), (4, 'INCOMPLETE_ATTENDANCE')):
            self._ev(t, day, approved=True)
        status = explanation_quota_status(self.tp, MONTH)
        self.assertFalse(status['shared'])
        self.assertTrue(status['is_manager_combined_quota'])
        self.assertEqual([(g['key'], g['label'], g['used'], g['max']) for g in status['groups']],
                         [('LATE_EARLY', 'Đi muộn/Về sớm', 3, 5), ('INCOMPLETE_ATTENDANCE', 'Quên chấm công', 1, 1)])
        self.assertEqual(status['by_type']['LATE'], status['by_type']['EARLY_LEAVE'])  # cùng rổ
        self.assertEqual(status['combined'], {'used': 4, 'max': 6, 'remaining': 2})

    def test_blank_incomplete_keeps_single_pool(self):
        self.cfg.manager_incomplete_explanation_quota = None
        self.cfg.save()
        self._ev('INCOMPLETE_ATTENDANCE', 1, approved=True)
        status = explanation_quota_status(self.tp, MONTH)
        self.assertTrue(status['shared'])
        self.assertEqual([(g['key'], g['used'], g['max']) for g in status['groups']], [('ALL', 1, 5)])
        self.assertEqual(quota_rules(self.tp.pk)['combined_max'], 5)

    def test_approve_blocked_when_late_early_pool_full(self):
        for day, t in ((1, 'LATE'), (2, 'EARLY_LEAVE'), (3, 'LATE'), (4, 'EARLY_LEAVE'), (5, 'LATE')):
            self._ev(t, day, approved=True)
        self._ev('INCOMPLETE_ATTENDANCE', 6, approved=True)  # rổ riêng, không chiếm rổ muộn/sớm
        res = self.client.post(f'{URL}{self._ev("EARLY_LEAVE", 7).id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('5/5 lượt giải trình đi muộn/về sớm', res.data['error'])
        self.assertEqual(res.data['quota_type'], 'LATE_EARLY')

    def test_smart_bulk_approve_by_pool_with_dry_run(self):
        late_early = [self._ev(t, d) for d, t in (
            (1, 'LATE'), (2, 'EARLY_LEAVE'), (3, 'LATE'), (4, 'LATE_EARLY'), (5, 'EARLY_LEAVE'), (6, 'LATE'))]
        forgot = [self._ev('INCOMPLETE_ATTENDANCE', d) for d in (7, 8)]
        ids = [e.id for e in late_early + forgot]

        preview = self.client.post(f'{URL}smart_bulk_approve/', {'ids': ids, 'dry_run': True}, format='json').data
        self.assertTrue(preview['dry_run'])
        self.assertEqual(len(preview['rejected']), 1)     # 6 đơn muộn/sớm, rổ 5
        self.assertEqual(len(preview['approved']), 7)     # 5 muộn/sớm + 2 quên chấm công (luôn duyệt)
        self.assertEqual(len(preview['over_quota']), 1)   # quên chấm công thứ 2 vượt rổ 1
        self.assertFalse(EmployeeEvent.objects.filter(id__in=ids).exclude(data__status='PENDING').exists())

        res = self.client.post(f'{URL}smart_bulk_approve/', {'ids': ids}, format='json').data
        self.assertEqual(sorted(res['approved']), sorted(preview['approved']))
        self.assertEqual(res['rejected'], [r['id'] for r in preview['rejected']])

    def test_duyet_don_items_carry_pool(self):
        self.admin_user.is_superuser = True  # duyet-don: superuser xem mọi đơn
        self.admin_user.save()
        self._ev('LATE', 1)
        self._ev('INCOMPLETE_ATTENDANCE', 2)
        rows = self.client.get('/api-hrm/duyet-don/', {'page_size': 50}).json()
        rows = rows.get('results', rows)
        quota = {r['explanation_type']: r for r in rows if r.get('explanation_type')}
        self.assertEqual(quota['LATE']['explanation_quota']['label'], 'Đi muộn/Về sớm')
        self.assertEqual(quota['LATE']['max_explanation_quota'], 5)
        self.assertEqual(quota['INCOMPLETE_ATTENDANCE']['explanation_quota']['max'], 1)
        self.assertEqual([g['key'] for g in quota['LATE']['explanation_quota_groups']],
                         ['LATE_EARLY', 'INCOMPLETE_ATTENDANCE'])

    def test_replay_engine_forgot_uses_own_pool(self):
        def approval():
            return Event('explanation_approval', {
                'action': 'APPROVE', 'approval_level': 'HR', 'explanation_type': 'INCOMPLETE_ATTENDANCE',
                'date': '2026-08-10', 'expected_status': 'PRESENT', 'forgot_punch_type': 'checkout',
                'forgot_checkin_time': '', 'forgot_checkout_time': '17:30:00',
                'actual_check_in': '08:00:00', 'actual_check_out': '',
            })

        def state(late, early, incomplete):
            s = EmployeeState('NV00532')
            s._quota_rules_cache = quota_rules(self.tp.pk)
            s.explanation_quota_used = late + early + incomplete
            s.explanation_quota_used_late, s.explanation_quota_used_early_leave = late, early
            s.explanation_quota_used_incomplete = incomplete
            s.calendar_result = [{'date': '2026-08-10', 'event_type': 'attendance', 'check_in': '08:00',
                                  'check_out': None, 'rules_applied': [], 'effects': {'quen_cham_cong': 1},
                                  'delta': {'quen_cham_cong': 1}}]
            return s

        # 4 lượt đi muộn / về sớm không đẩy Quên chấm công vào diện vượt hạn mức.
        self.assertEqual(state(2, 2, 0)._evaluate_explanation_approval_rule(approval(), {}).get('nua_ngay_cong'), 1.0)
        self.assertEqual(state(0, 0, 1)._evaluate_explanation_approval_rule(approval(), {}).get('nua_ngay_cong'), 0.5)

    def test_exemption_rule_reads_pool_max(self):
        ctx = {'explanation_status': 'APPROVED', 'explanation_type': 'LATE', 'violation_type': 'LATE',
               'explanation_quota_used': 4, 'explanation_quota_max': 5}
        self.assertTrue(ExemptionRule().apply(ctx, {'max_explanation_quota': 3}, []).is_exempt)
