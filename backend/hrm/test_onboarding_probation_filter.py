from datetime import date, timedelta
from unittest import mock

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from hrm.models import OnboardingProcess

TODAY = date(2026, 10, 15)


@mock.patch('django.utils.timezone.localdate', return_value=TODAY)
class OnboardingProbationEndingFilterTests(APITestCase):
    url = '/api-hrm/onboardings/'

    def setUp(self):
        self.client.force_authenticate(User.objects.create_superuser('onb-admin', 'a@example.com', 'x'))
        self._onb('ONB-T-1', TODAY + timedelta(days=3), months=1)
        self._onb('ONB-T-2', TODAY, months=2)
        self._onb('ONB-T-3', TODAY + timedelta(days=20), months=2)        # còn xa
        self._onb('ONB-T-4', TODAY - timedelta(days=1), months=1)         # đã hết
        self._onb('ONB-T-5', TODAY + timedelta(days=2), contract_type='ONE_YEAR')

    def _onb(self, code, end, months=2, contract_type='PROBATION'):
        OnboardingProcess.objects.create(
            onboarding_code=code, candidate_name=code, candidate_email=f'{code.lower()}@example.com',
            start_date=end - timedelta(days=30), expected_end_date=end, contract_type=contract_type,
            probation_period_months=months, status='IN_PROGRESS')

    def _codes(self, **params):
        res = self.client.get(self.url, params)
        self.assertEqual(res.status_code, 200, res.data)
        rows = res.data['results'] if isinstance(res.data, dict) else res.data
        return {row['onboarding_code'] for row in rows}

    def test_ending_within_days(self, _today):
        self.assertEqual(self._codes(probation_ending_within=7), {'ONB-T-1', 'ONB-T-2'})
        self.assertEqual(self._codes(probation_ending_within=30), {'ONB-T-1', 'ONB-T-2', 'ONB-T-3'})

    def test_probation_months_uses_default_window(self, _today):
        self.assertEqual(self._codes(probation_months=1), {'ONB-T-1'})

    def test_invalid_params(self, _today):
        self.assertEqual(self.client.get(self.url, {'probation_ending_within': 'x'}).status_code, 400)
        self.assertEqual(self.client.get(self.url, {'probation_ending_within': -1}).status_code, 400)
