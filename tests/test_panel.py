import unittest, subprocess, os, tempfile, time, urllib.request, urllib.error, json, socket
from pathlib import Path

class PanelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        with socket.socket() as s: s.bind(('127.0.0.1',0)); cls.port=s.getsockname()[1]
        cls.base=f'http://127.0.0.1:{cls.port}'
        cls.proc=subprocess.Popen(['python3','app/server.py'],env={**os.environ,'DEMO_MODE':'1','ADMIN_PASSWORD':'test-password-long-enough','PUBLIC_DOMAIN':'test.example','DATA_DIR':cls.tmp.name,'PORT':str(cls.port)},stdout=subprocess.DEVNULL)
        for _ in range(50):
            try: urllib.request.urlopen(cls.base+'/healthz'); break
            except OSError: time.sleep(.1)
        else: raise RuntimeError('Panel did not start')
    @classmethod
    def tearDownClass(cls): cls.proc.terminate(); cls.proc.wait(); cls.tmp.cleanup()
    def req(self,path,body=None,cookie='',csrf='',origin=None):
        headers={'Cookie':cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'}
        if origin: headers['Origin']=origin
        req=urllib.request.Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
        try: r=urllib.request.urlopen(req)
        except urllib.error.HTTPError as e: r=e
        return r.status,json.loads(r.read()),r.headers
    def login(self):
        code,data,h=self.req('/api/login',{'password':'test-password-long-enough'})
        self.assertEqual(code,200)
        return h['Set-Cookie'].split(';')[0],data['csrf']
    def test_auth_required(self): self.assertEqual(self.req('/api/status')[0],401)
    def test_wrong_password(self): self.assertEqual(self.req('/api/login',{'password':'wrong'})[0],401)
    def test_origin(self): self.assertEqual(self.req('/api/login',{},origin='https://evil.example')[0],403)
    def test_csrf(self):
        cookie,csrf=self.login(); self.assertEqual(self.req('/api/restart',{},cookie)[0],403)
    def test_rotation_and_report(self):
        cookie,csrf=self.login()
        _,old,_=self.req('/api/link',cookie=cookie)
        self.assertEqual(self.req('/api/rotate',{},cookie,csrf)[0],200)
        _,new,_=self.req('/api/link',cookie=cookie)
        self.assertNotEqual(old,new)
        _,report,_=self.req('/api/report',cookie=cookie)
        self.assertNotIn('csrf',report)
        self.assertNotIn(new['link'].split('@')[0][8:],json.dumps(report))
        self.assertFalse(report['core_running']); self.assertEqual(report['mode'],'demo')
    def test_settings_validation(self):
        cookie,csrf=self.login()
        self.assertEqual(self.req('/api/settings',{'loglevel':'debug'},cookie,csrf)[0],400)
        self.assertEqual(self.req('/api/settings',{'loglevel':'error'},cookie,csrf)[0],200)
        self.assertEqual(self.req('/api/status',cookie=cookie)[1]['loglevel'],'error')
    def test_logout(self):
        cookie,csrf=self.login(); self.req('/api/logout',{},cookie,csrf)
        self.assertEqual(self.req('/api/status',cookie=cookie)[0],401)

if __name__=='__main__': unittest.main()
