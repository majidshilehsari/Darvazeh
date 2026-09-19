"""Real HTTP startup tests, including production-mode failure paths (no Xray mock)."""
import contextlib, json, os, socket, subprocess, sys, tempfile, time, unittest
import urllib.request, urllib.error
from pathlib import Path

@contextlib.contextmanager
def running(overrides=None, contents=None, unusable=False):
    with tempfile.TemporaryDirectory() as tmp:
        data=Path(tmp)/'data'
        if unusable: data.write_text('must remain untouched')
        else:
            data.mkdir()
            if contents is not None: (data/'settings.json').write_text(contents)
        with socket.socket() as sock: sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
        env={**os.environ,'PATH':tmp,'DEMO_MODE':'0','DATA_DIR':str(data),'PORT':str(port),
             'ADMIN_PASSWORD':'private-test-secret-123456','PUBLIC_DOMAIN':'private.example'}
        env.update(overrides or {})
        p=subprocess.Popen([sys.executable,'app/server.py'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        def request(path,body=None,cookie='',csrf=''):
            req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,
                data=json.dumps(body).encode() if body is not None else None,
                headers={'Content-Type':'application/json','Cookie':cookie,'X-CSRF-Token':csrf})
            try: r=urllib.request.urlopen(req,timeout=2)
            except urllib.error.HTTPError as e: r=e
            return r.status,r.read().decode(),r.headers
        try:
            for _ in range(80):
                if p.poll() is not None: raise AssertionError('Panel exited: '+p.stderr.read().decode())
                try:
                    result=request('/api/bootstrap')
                    if not json.loads(result[1])['initializing']: break
                except OSError: pass
                time.sleep(.05)
            else: raise AssertionError('Startup timed out')
            yield request,data
        finally:
            p.terminate(); p.communicate(timeout=5)

class StartupTest(unittest.TestCase):
    def test_missing_password_page_survives_and_no_bypass(self):
        with running({'ADMIN_PASSWORD':''}) as (req,data):
            self.assertEqual(req('/')[0],200)
            b=json.loads(req('/api/bootstrap')[1]); self.assertFalse(b['login_enabled'])
            self.assertIn('ADMIN_PASSWORD_MISSING',b['errors'])
            self.assertEqual(req('/api/login',{'password':''})[0],503)
            for path in ('/api/status','/api/report','/api/link'): self.assertEqual(req(path)[0],401)
            self.assertEqual(req('/api/rotate',{})[0],401)
            self.assertFalse((data/'settings.json').exists())
    def test_short_password(self):
        with running({'ADMIN_PASSWORD':'short'}) as (req,_):
            self.assertEqual(req('/healthz')[0],200)
            self.assertIn('ADMIN_PASSWORD_TOO_SHORT',req('/api/bootstrap')[1])
            self.assertEqual(req('/api/login',{'password':'short'})[0],503)
    def test_domain_errors_allow_secure_login_not_mutation(self):
        for domain,code in [('', 'PUBLIC_DOMAIN_MISSING'),('https://private.example','PUBLIC_DOMAIN_INVALID')]:
            with self.subTest(domain=domain), running({'PUBLIC_DOMAIN':domain}) as (req,_):
                b=req('/api/bootstrap')[1]; self.assertIn(code,b)
                self.assertNotIn('private.example',b); self.assertNotIn('private-test-secret',b)
                status,body,h=req('/api/login',{'password':'private-test-secret-123456'})
                self.assertEqual(status,200); self.assertIn('Secure',h['Set-Cookie'])
                cookie=h['Set-Cookie'].split(';')[0]; csrf=json.loads(body)['csrf']
                self.assertEqual(req('/api/status',cookie=cookie)[0],200)
                self.assertEqual(req('/api/link',cookie=cookie)[0],503)
                self.assertEqual(req('/api/rotate',{},cookie,csrf)[0],503)
    def test_missing_xray_is_visible_only_after_login(self):
        with running() as (req,_):
            self.assertEqual(req('/')[0],200)
            self.assertNotIn('XRAY_NOT_FOUND',req('/api/bootstrap')[1])
            _,body,h=req('/api/login',{'password':'private-test-secret-123456'})
            cookie=h['Set-Cookie'].split(';')[0]
            self.assertIn('XRAY_NOT_FOUND',req('/api/status',cookie=cookie)[1])
            self.assertEqual(req('/api/link',cookie=cookie)[0],503)
    def test_corrupt_settings_not_overwritten(self):
        original='broken private settings'
        with running(contents=original) as (req,data):
            self.assertEqual(req('/')[0],200)
            _,_,h=req('/api/login',{'password':'private-test-secret-123456'})
            report=req('/api/report',cookie=h['Set-Cookie'].split(';')[0])[1]
            self.assertIn('STORAGE_UNAVAILABLE_OR_INVALID',report)
            self.assertNotIn(original,report)
            self.assertEqual((data/'settings.json').read_text(),original)
    def test_storage_unusable_panel_survives(self):
        with running(unusable=True) as (req,data):
            self.assertEqual(req('/')[0],200)
            self.assertEqual(data.read_text(),'must remain untouched')

if __name__=='__main__': unittest.main()
