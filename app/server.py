import os, json, time, secrets, hashlib, hmac, subprocess, threading, collections, urllib.parse, resource
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

DATA = Path(os.getenv('DATA_DIR', '/data')); DATA.mkdir(parents=True, exist_ok=True)
PASSWORD = os.environ.get('ADMIN_PASSWORD', '')
DOMAIN = os.environ.get('PUBLIC_DOMAIN', '').strip()
DEMO = os.getenv('DEMO_MODE') == '1'
if not DEMO and (len(PASSWORD) < 16 or not DOMAIN or '/' in DOMAIN or ':' in DOMAIN):
    raise SystemExit('Set ADMIN_PASSWORD (16+ characters) and PUBLIC_DOMAIN (hostname only).')
PASSWORD_HASH = hashlib.scrypt(PASSWORD.encode(), salt=b'darvazeh-admin-v1', n=16384, r=8, p=1)
LOCK = threading.RLock(); SESSIONS = {}; ATTEMPTS = {}; EVENTS = collections.deque(maxlen=150)
START = time.time(); PROC = None

def event(kind, message):
    EVENTS.append({'time': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'kind': kind, 'message': message})

def save(path, value):
    temp = path.with_suffix('.tmp'); temp.write_text(json.dumps(value, indent=2)); temp.chmod(0o600); temp.replace(path)

SETTINGS = DATA / 'settings.json'
if not SETTINGS.exists():
    import uuid
    save(SETTINGS, {'uuid': str(uuid.uuid4()), 'loglevel': 'warning'})
settings = json.loads(SETTINGS.read_text())

def config(s):
    return {'log': {'loglevel': s['loglevel'], 'access': 'none'},
        'inbounds': [{'listen': '127.0.0.1', 'port': 10000, 'protocol': 'vless',
          'settings': {'clients': [{'id': s['uuid']}], 'decryption': 'none'},
          'streamSettings': {'network': 'ws', 'security': 'none', 'wsSettings': {'path': '/connect'}}}],
        'outbounds': [{'protocol': 'freedom', 'tag': 'direct'}, {'protocol': 'blackhole', 'tag': 'blocked'}],
        'routing': {'domainStrategy': 'IPIfNonMatch', 'rules': [{'type': 'field', 'ip': ['geoip:private'], 'outboundTag': 'blocked'}]}}

def stop():
    global PROC
    if PROC and PROC.poll() is None:
        PROC.terminate()
        try: PROC.wait(timeout=5)
        except subprocess.TimeoutExpired: PROC.kill(); PROC.wait()

def apply(s):
    global PROC, settings
    with LOCK:
        if not DEMO:
            candidate = DATA / 'candidate.json'; save(candidate, config(s))
            subprocess.run(['xray', 'run', '-test', '-config', str(candidate)], check=True, timeout=15,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            previous = settings.copy()
            stop()
            candidate.replace(DATA / 'xray.json')
            PROC = subprocess.Popen(['xray', 'run', '-config', str(DATA / 'xray.json')],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(.4)
            if PROC.poll() is not None:
                save(DATA / 'xray.json', config(previous))
                PROC = subprocess.Popen(['xray', 'run', '-config', str(DATA / 'xray.json')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                raise RuntimeError('Core failed to start; previous configuration restored')
        settings = s; save(SETTINGS, s); event('configuration', 'تنظیمات هسته اعمال شد' if not DEMO else 'تنظیمات نمایشی ذخیره شد')

def status():
    alive = bool(PROC and PROC.poll() is None)
    return {'mode': 'demo' if DEMO else 'live', 'core_running': alive, 'uptime_seconds': int(time.time()-START),
        'domain': DOMAIN, 'transport': 'VLESS / WebSocket', 'path': '/connect',
        'tls': 'Hostim edge → HTTP داخلی', 'loglevel': settings['loglevel'],
        'panel_memory_mb': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024, 1),
        'events': list(EVENTS), 'limits': ['این گزارش دسترسی از همراه اول یا ایرانسل را آزمایش نمی‌کند.',
        'تعداد کاربران آنلاین و حجم ترافیک در این نسخه اندازه‌گیری نمی‌شود.', 'محتوای ترافیک، مقصدها و UUID در گزارش ثبت نمی‌شوند.']}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def reply(self, code, value, headers=None):
        raw = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store'); self.send_header('X-Content-Type-Options', 'nosniff')
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(raw)
    def session(self):
        from http.cookies import SimpleCookie
        try:
            c = SimpleCookie(self.headers.get('Cookie','')); sid = c['session'].value
            s = SESSIONS.get(sid)
            return (sid,s) if s and s['expires'] > time.time() else (None,None)
        except Exception: return None,None
    def do_GET(self):
        if self.path == '/healthz': return self.reply(200, {'panel': 'ok'})
        if self.path == '/':
            raw = Path(__file__).with_name('index.html').read_bytes()
            self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Cache-Control','no-store'); self.send_header('X-Frame-Options','DENY')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers(); self.wfile.write(raw); return
        sid,s = self.session()
        if not s: return self.reply(401, {'error':'ابتدا وارد شوید'})
        if self.path in ('/api/status','/api/report'):
            result = status()
            if self.path == '/api/status': result['csrf'] = s['csrf']
            return self.reply(200,result, {'Content-Disposition':'attachment; filename="darvazeh-report.json"'} if self.path.endswith('report') else {})
        if self.path == '/api/link':
            q = urllib.parse.urlencode({'encryption':'none','security':'tls','sni':DOMAIN,'type':'ws','host':DOMAIN,'path':'/connect','fp':'chrome'})
            return self.reply(200, {'link': f"vless://{settings['uuid']}@{DOMAIN}:443?{q}#Darvazeh"})
        return self.reply(404, {'error':'یافت نشد'})
    def do_POST(self):
        # Browser writes must originate from this host (and authenticated writes need CSRF).
        origin = self.headers.get('Origin')
        if origin and urllib.parse.urlsplit(origin).netloc != self.headers.get('Host'):
            return self.reply(403, {'error':'Origin rejected'})
        try:
            length = int(self.headers.get('Content-Length','0'))
            if not 0 <= length <= 4096: raise ValueError()
            body = json.loads(self.rfile.read(length) or '{}')
            if not isinstance(body,dict): raise ValueError()
        except Exception: return self.reply(400, {'error':'درخواست نامعتبر'})
        if self.path == '/api/login':
            # Nginx is the only production peer. A global limiter avoids trusting spoofable headers.
            now = time.time()
            with LOCK:
                hits = [t for t in ATTEMPTS.get('login',[]) if now-t < 60]
                if len(hits) >= 10: return self.reply(429, {'error':'یک دقیقه صبر کنید'})
                hits.append(now); ATTEMPTS['login'] = hits
            password = body.get('password','')
            if not isinstance(password,str): return self.reply(400, {'error':'درخواست نامعتبر'})
            digest = hashlib.scrypt(password.encode(), salt=b'darvazeh-admin-v1', n=16384, r=8, p=1)
            if not hmac.compare_digest(digest, PASSWORD_HASH): return self.reply(401, {'error':'رمز اشتباه است'})
            sid = secrets.token_urlsafe(32); csrf = secrets.token_urlsafe(24)
            with LOCK:
                for key in list(SESSIONS):
                    if SESSIONS[key]['expires'] < now: del SESSIONS[key]
                SESSIONS[sid] = {'csrf':csrf,'expires':now+28800}
            event('auth','ورود مدیر')
            return self.reply(200, {'csrf':csrf}, {'Set-Cookie':f'session={sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800' + ('' if DEMO else '; Secure')})
        sid,s = self.session()
        if not s: return self.reply(401, {'error':'ابتدا وارد شوید'})
        if not hmac.compare_digest(self.headers.get('X-CSRF-Token',''),s['csrf']): return self.reply(403, {'error':'CSRF rejected'})
        if self.path == '/api/logout':
            SESSIONS.pop(sid,None); return self.reply(200,{}, {'Set-Cookie':'session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict'})
        try:
            with LOCK:
                if self.path == '/api/settings':
                    level = body.get('loglevel')
                    if level not in ('warning','error','none'): return self.reply(400, {'error':'سطح لاگ نامعتبر'})
                    apply({**settings, 'loglevel':level})
                elif self.path == '/api/restart': apply(settings.copy())
                elif self.path == '/api/rotate':
                    import uuid
                    apply({**settings,'uuid':str(uuid.uuid4())})
                else: return self.reply(404, {'error':'یافت نشد'})
            return self.reply(200, {'ok':True})
        except Exception:
            event('error','اعمال تنظیمات ناموفق بود؛ وضعیت هسته را بررسی کنید')
            return self.reply(500, {'error':'عملیات ناموفق بود؛ تنظیم قبلی تا حد امکان حفظ شد'})

if __name__ == '__main__':
    try: apply(settings.copy())
    except Exception: event('error','راه‌اندازی اولیه هسته ناموفق بود')
    def watch():
        previous = None
        while True:
            alive = bool(PROC and PROC.poll() is None)
            if not DEMO and alive != previous:
                event('core', 'هسته در حال اجراست' if alive else 'هسته متوقف است؛ راه‌اندازی مجدد را بررسی کنید')
            previous = alive; time.sleep(5)
    threading.Thread(target=watch,daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0' if DEMO else '127.0.0.1', int(os.getenv('PORT','8081'))), Handler).serve_forever()
