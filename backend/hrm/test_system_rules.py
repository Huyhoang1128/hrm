"""API quy định dùng chung GET /api-hrm/system-rules/ (hrm/system_rules)."""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from hrm import system_rules
from hrm.system_rules import build_rules, rule_section

URL = '/api-hrm/system-rules/'


class SystemRulesRegistryTests(TestCase):
    def setUp(self):
        self._saved = dict(system_rules._SECTIONS)
        rule_section('zz_public', public=True)(lambda request: {'a': 1})
        rule_section('zz_private')(lambda request: {'b': 2})

    def tearDown(self):
        system_rules._SECTIONS.clear()
        system_rules._SECTIONS.update(self._saved)

    def test_anonymous_gets_only_public_sections(self):
        rules = build_rules(None)
        self.assertEqual(rules['zz_public'], {'a': 1})
        self.assertNotIn('zz_private', rules)

    def test_authenticated_gets_all_and_can_filter(self):
        user = get_user_model().objects.create_user(username='rules_user', password='x-Pass-12345')
        client = APIClient()
        client.force_authenticate(user)
        data = client.get(URL).json()
        self.assertEqual(data['zz_private'], {'b': 2})
        self.assertEqual(data['zz_public'], {'a': 1})
        only = client.get(URL, {'sections': 'zz_private'}).json()
        self.assertEqual(set(only), {'zz_private'})

    def test_anonymous_http(self):
        data = APIClient().get(URL).json()
        self.assertIn('zz_public', data)
        self.assertNotIn('zz_private', data)

    def test_every_registered_section_builds(self):
        """Mọi section thật phải chạy được với request None (chưa đăng nhập) và trả dict."""
        for name, (fn, _public) in self._saved.items():
            self.assertIsInstance(fn(None), dict, name)
