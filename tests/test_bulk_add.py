import unittest, subprocess, os, tempfile, time, urllib.request, urllib.error, json, socket, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'app'))


class CoreErrorClassification(unittest.TestCase):
    """A dropped client connection must never be reported as a core/filesystem fault."""

    def setUp(self):
        import server
        self.server = server
        self.previous = server.CORE_ERROR
        server.CORE_ERROR = None

    def tearDown(self):
        self.server.CORE_ERROR = self.previous

    def test_client_disconnect_is_not_a_core_error(self):
        for exc in (BrokenPipeError(), ConnectionResetError(), ConnectionAbortedError()):
            self.server.CORE_ERROR = None
            self.server.record_core_error(exc)
            self.assertIsNone(self.server.CORE_ERROR, f'{type(exc).__name__} misreported as core error')

    def test_real_io_error_is_still_reported(self):
        self.server.record_core_error(PermissionError(13, 'denied'))
        self.assertEqual(self.server.CORE_ERROR, 'CORE_IO_ERROR')

    def test_missing_binary_is_still_reported(self):
        self.server.record_core_error(FileNotFoundError(2, 'no xray'))
        self.assertEqual(self.server.CORE_ERROR, 'XRAY_NOT_FOUND')


class BulkAndImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        with socket.socket() as s: s.bind(('127.0.0.1', 0)); cls.port = s.getsockname()[1]
        cls.base = f'http://127.0.0.1:{cls.port}'
        cls.proc = subprocess.Popen(['python3', 'app/server.py'], env={
            **os.environ, 'DEMO_MODE': '1', 'ADMIN_PASSWORD': 'test-password-long-enough',
            'PUBLIC_DOMAIN': 'test.example', 'DATA_DIR': cls.tmp.name, 'PORT': str(cls.port)},
            stdout=subprocess.DEVNULL)
        for _ in range(50):
            try: urllib.request.urlopen(cls.base + '/healthz'); break
            except OSError: time.sleep(.1)
        else: raise RuntimeError('Panel did not start')
        # One login only: the panel rate-limits logins to 10 per minute globally.
        r = urllib.request.Request(cls.base + '/api/login',
                                   data=json.dumps({'password': 'test-password-long-enough'}).encode(),
                                   headers={'Content-Type': 'application/json'})
        resp = urllib.request.urlopen(r)
        cls.cookie = resp.headers['Set-Cookie'].split(';')[0]
        cls.csrf = json.loads(resp.read())['csrf']

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate(); cls.proc.wait(); cls.tmp.cleanup()

    def req(self, path, body=None, cookie=None, csrf=None):
        cookie = self.cookie if cookie is None else cookie
        csrf = self.csrf if csrf is None else csrf
        headers = {'Cookie': cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json'}
        r = urllib.request.Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try: resp = urllib.request.urlopen(r)
        except urllib.error.HTTPError as e: resp = e
        return resp.status, json.loads(resp.read())

    def list_devices(self):
        r = urllib.request.Request(self.base + '/api/devices', headers={'Cookie': self.cookie})
        return json.loads(urllib.request.urlopen(r).read())['devices']

    def import_names(self, names, quota=0, days=0):
        return self.req('/api/devices/import',
                        {'devices': [{'name': n, 'quota_bytes': quota, 'duration_days': days} for n in names]})

    def test_import_creates_devices_with_defaults(self):
        GB = 1_000_000_000
        status, data = self.req('/api/devices/import', {'devices': [
            {'name': 'خانواده-مادر', 'quota_bytes': 50 * GB, 'duration_days': 30},
            {'name': 'خانواده-پدر', 'quota_bytes': 50 * GB, 'duration_days': 30},
        ]})
        self.assertEqual(status, 200); self.assertEqual(data['created'], 2)
        names = [d['name'] for d in self.list_devices()]
        self.assertIn('خانواده-مادر', names); self.assertIn('خانواده-پدر', names)

    def test_import_rejects_bad_rows_atomically(self):
        before = len(self.list_devices())
        cases = [
            ([{'name': '', 'quota_bytes': 0, 'duration_days': 0}], 'empty name'),
            ([{'name': '   ', 'quota_bytes': 0, 'duration_days': 0}], 'whitespace name'),
            ([{'name': 'x' * 81, 'quota_bytes': 0, 'duration_days': 0}], 'long name'),
            ([{'name': 'ok', 'quota_bytes': -5, 'duration_days': 0}], 'negative quota'),
            ([{'name': 'ok', 'quota_bytes': 0, 'duration_days': 99999}], 'absurd duration'),
            ([{'name': 'ok', 'quota_bytes': '50', 'duration_days': 0}], 'string quota'),
            ([{'name': 'ctrl\x01char', 'quota_bytes': 0, 'duration_days': 0}], 'control char'),
            ([{'name': 'a'}, {'name': ''}], 'one bad row in batch'),
            ([], 'empty list'),
        ]
        for payload, label in cases:
            status, _ = self.req('/api/devices/import', {'devices': payload})
            self.assertEqual(status, 400, label)
        self.assertEqual(len(self.list_devices()), before, 'a rejected batch must not partially apply')

    def test_import_enforces_total_capacity(self):
        free = 50 - len(self.list_devices())
        status, _ = self.import_names([f'overflow-{i}' for i in range(free + 1)])
        self.assertEqual(status, 400)

    def test_bulk_disable_then_enable(self):
        self.import_names([f'bulk-{i}' for i in range(3)])
        created = [d['id'] for d in self.list_devices() if d['name'].startswith('bulk-')]
        self.assertGreaterEqual(len(created), 3)
        status, data = self.req('/api/devices/bulk', {'ids': created, 'operation': 'disable'})
        self.assertEqual(status, 200); self.assertEqual(data['affected'], len(created))
        self.assertTrue(all(not d['enabled'] for d in self.list_devices() if d['id'] in created))
        status, _ = self.req('/api/devices/bulk', {'ids': created, 'operation': 'enable'})
        self.assertEqual(status, 200)
        self.assertTrue(all(d['enabled'] for d in self.list_devices() if d['id'] in created))

    def test_bulk_delete_removes_only_selected(self):
        self.import_names(['keep-me', 'drop-me'])
        doomed = [d['id'] for d in self.list_devices() if d['name'] == 'drop-me']
        self.assertEqual(len(doomed), 1)
        status, data = self.req('/api/devices/bulk', {'ids': doomed, 'operation': 'delete'})
        self.assertEqual(status, 200); self.assertEqual(data['affected'], 1)
        names = [d['name'] for d in self.list_devices()]
        self.assertNotIn('drop-me', names); self.assertIn('keep-me', names)

    def test_bulk_delete_refuses_legacy(self):
        status, _ = self.req('/api/devices/bulk', {'ids': ['legacy'], 'operation': 'delete'})
        self.assertEqual(status, 400)
        self.assertIn('legacy', [d['id'] for d in self.list_devices()])

    def test_single_delete_and_legacy_protection(self):
        self.import_names(['single-drop'])
        target = [d['id'] for d in self.list_devices() if d['name'] == 'single-drop'][0]
        status, _ = self.req('/api/device', {'id': target, 'operation': 'delete'})
        self.assertEqual(status, 200)
        self.assertNotIn('single-drop', [d['name'] for d in self.list_devices()])
        status, _ = self.req('/api/device', {'id': 'legacy', 'operation': 'delete'})
        self.assertEqual(status, 400)

    def test_bulk_rejects_unknown_empty_and_bad_op(self):
        self.assertEqual(self.req('/api/devices/bulk', {'ids': [], 'operation': 'delete'})[0], 400)
        self.assertEqual(self.req('/api/devices/bulk', {'ids': ['nope'], 'operation': 'delete'})[0], 400)
        self.assertEqual(self.req('/api/devices/bulk', {'ids': ['legacy'], 'operation': 'nuke'})[0], 400)
        self.assertEqual(self.req('/api/devices/bulk', {'ids': 'legacy', 'operation': 'delete'})[0], 400)
        self.assertEqual(self.req('/api/devices/bulk', {'ids': [1, 2], 'operation': 'delete'})[0], 400)

    def test_mutations_require_csrf(self):
        self.assertEqual(self.req('/api/devices/bulk', {'ids': ['legacy'], 'operation': 'disable'}, csrf='')[0], 403)
        self.assertEqual(self.req('/api/devices/import', {'devices': [{'name': 'x'}]}, csrf='')[0], 403)

    def test_links_survive_bulk_disable(self):
        self.import_names(['stable-link'])
        device = [d for d in self.list_devices() if d['name'] == 'stable-link'][0]
        _, before = self.req('/api/link?device=' + device['id'])
        self.req('/api/devices/bulk', {'ids': [device['id']], 'operation': 'disable'})
        self.req('/api/devices/bulk', {'ids': [device['id']], 'operation': 'enable'})
        _, after = self.req('/api/link?device=' + device['id'])
        self.assertEqual(before['link'], after['link'], 'disable/enable must not rotate the key')

    def test_imported_quota_and_duration_persist(self):
        GB = 1_000_000_000
        self.req('/api/devices/import', {'devices': [{'name': 'quota-check', 'quota_bytes': 50 * GB, 'duration_days': 30}]})
        device = [d for d in self.list_devices() if d['name'] == 'quota-check'][0]
        self.assertEqual(device['quota_bytes'], 50 * GB)
        self.assertEqual(device['duration_days'], 30)


if __name__ == '__main__':
    unittest.main()
