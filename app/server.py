import os, json, time, secrets, hashlib, hmac, subprocess, threading, collections, urllib.parse, resource
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from telemetry import Store, Relay

DATA = Path(os.getenv('DATA_DIR', '/data'))
PASSWORD = os.environ.get('ADMIN_PASSWORD', '')
DOMAIN = os.environ.get('PUBLIC_DOMAIN', '').strip()
DEMO = os.getenv('DEMO_MODE') == '1'
VERSION = '0.2.0-preview.1'
ENV_ERRORS = []
if not PASSWORD:
    ENV_ERRORS.append('ADMIN_PASSWORD_MISSING')
elif len(PASSWORD) < 16:
    ENV_ERRORS.append('ADMIN_PASSWORD_TOO_SHORT')
if not DOMAIN:
    ENV_ERRORS.append('PUBLIC_DOMAIN_MISSING')
elif '/' in DOMAIN or ':' in DOMAIN or any(c.isspace() for c in DOMAIN) or any(c in DOMAIN for c in '[]()='):
    ENV_ERRORS.append('PUBLIC_DOMAIN_INVALID')
PASSWORD_HASH = None
if not any(e.startswith('ADMIN_PASSWORD') for e in ENV_ERRORS):
    try:
        PASSWORD_HASH = hashlib.scrypt(PASSWORD.encode(), salt=b'darvazeh-admin-v1', n=16384, r=8, p=1)
    except (ValueError, MemoryError):
        ENV_ERRORS.append('AUTH_INITIALIZATION_FAILED')
STORAGE_ERROR = None
CORE_ERROR = None
INITIALIZING = True
HISTORY = None
HISTORY_ERROR = None
RELAY = None
MONITOR_ENABLED = os.getenv('MONITOR_ENABLED', '1') == '1'
LOCK = threading.RLock(); SESSIONS = {}; ATTEMPTS = {}; EVENTS = collections.deque(maxlen=150)
START = time.time(); PROC = None

def event(kind, message):
    EVENTS.append({'time': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'kind': kind, 'message': message})

def save(path, value):
    temp = path.with_suffix('.tmp'); temp.write_text(json.dumps(value, indent=2)); temp.chmod(0o600); temp.replace(path)

SETTINGS = DATA / 'settings.json'
settings = None

def load_settings():
    global settings, STORAGE_ERROR
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        if SETTINGS.exists():
            value = json.loads(SETTINGS.read_text())
            import uuid
            uuid.UUID(value['uuid'])
            if value['loglevel'] not in ('warning', 'error', 'none'):
                raise ValueError('Invalid log level')
            validate_devices(value)
            settings = value
        elif not ENV_ERRORS:
            import uuid
            value = {'uuid': str(uuid.uuid4()), 'loglevel': 'warning'}
            save(SETTINGS, value)
            settings = value
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        STORAGE_ERROR = 'STORAGE_UNAVAILABLE_OR_INVALID'
        event('error', 'خواندن فضای داده ناموفق است؛ فایل موجود تغییر نکرد. Volume و مجوزها را بررسی کنید.')

def bootstrap():
    # Only non-secret setup codes are public. Never echo environment values.
    return {'version': VERSION, 'login_enabled': PASSWORD_HASH is not None,
            'errors': list(ENV_ERRORS), 'initializing': INITIALIZING}

def record_core_error(exc):
    global CORE_ERROR
    if isinstance(exc, FileNotFoundError): CORE_ERROR = 'XRAY_NOT_FOUND'
    elif isinstance(exc, subprocess.TimeoutExpired): CORE_ERROR = 'XRAY_VALIDATION_TIMEOUT'
    elif isinstance(exc, subprocess.CalledProcessError): CORE_ERROR = 'XRAY_CONFIG_REJECTED'
    elif isinstance(exc, OSError): CORE_ERROR = 'CORE_IO_ERROR'
    else: CORE_ERROR = 'XRAY_START_FAILED'
    event('error', CORE_ERROR)

def device_records(value=None):
    value = settings if value is None else value
    if value is None: return []
    return [{'id':'legacy', 'name':value.get('legacy_name','اتصال قبلی'),
             'uuid':value['uuid'], 'enabled':value.get('legacy_enabled',True), 'legacy':True}] + value.get('devices',[])

def validate_devices(value):
    import uuid
    entries = device_records(value)
    if len(entries)>50: raise ValueError('حداکثر ۵۰ دستگاه')
    seen_ids=set(); seen_keys=set()
    for d in entries:
        if not isinstance(d['id'],str) or not isinstance(d['name'],str) or not 1<=len(d['name'])<=80 or type(d['enabled']) is not bool:
            raise ValueError('دستگاه نامعتبر')
        key=str(uuid.UUID(d['uuid']))
        if d['id'] in seen_ids or key in seen_keys: raise ValueError('شناسه تکراری')
        seen_ids.add(d['id']); seen_keys.add(key)

def device_map():
    import uuid
    return {str(uuid.UUID(d['uuid'])):d['id'] for d in device_records() if d['enabled']}

def public_devices():
    return [{k:v for k,v in d.items() if k!='uuid'} for d in device_records()]

def make_link(d):
    q=urllib.parse.urlencode({'encryption':'none','security':'tls','sni':DOMAIN,'type':'ws','host':DOMAIN,'path':'/connect','fp':'chrome'})
    return f"vless://{d['uuid']}@{DOMAIN}:443?{q}#"+urllib.parse.quote(d['name'])

def history_status():
    return {'enabled': MONITOR_ENABLED and not DEMO,
            'ready': bool(RELAY and RELAY.ready), 'error': HISTORY_ERROR or (RELAY.error if RELAY else None),
            'persistence_error': bool(RELAY and RELAY.persistence_error),
            'geo_available': bool(RELAY and RELAY.country.reader),
            'trusted_proxy_configured': bool(os.getenv('TRUSTED_PROXY_CIDRS','').strip()),
            'retention_days':7, 'max_connections':256, 'max_devices':50,
            'measurement':'WebSocket wire bytes (includes framing; not ISP billing or Xray user counters)'}

def profiles():
    return {'reviewed':'2026-09-08', 'items':[
        {'id':'ws-baseline','name':'مسیر فعلی · VLESS / WS / TLS','state':'available',
         'description':'لینک فعلی حفظ می‌شود. TLS روی Hostim، مسیر /connect. موفقیت روی هر اپراتور باید جدا آزمایش شود.'},
        {'id':'ws-client-tuning','name':'آزمایش تنظیمات کلاینت','state':'manual',
         'description':'یک کپی از پروفایل فعلی بگیرید؛ در هر آزمایش فقط یک مورد مانند Fragment، Mux یا DNS را تغییر دهید. این پنل آن‌ها را روی کلاینت اعمال نمی‌کند و مقدار جادویی پیشنهاد نمی‌دهد.'},
        {'id':'xhttp-research','name':'XHTTP · گزینهٔ بررسی‌شده در مستندات','state':'not-deployed',
         'description':'مستندات Xray مهاجرت از WS را پیشنهاد می‌کنند، اما سازگاری مسیر Hostim و کلاینت شما هنوز آزموده نشده. این گزینه فقط برای ثبت آزمایش مستقل است؛ لینک یا ورودی XHTTP در این نسخه فعال نیست.'}],
        'sources':['https://xtls.github.io/en/config/transports/websocket.html',
                   'https://github.com/XTLS/Xray-core/discussions/4113']}


def config(s):
    return {'log': {'loglevel': s['loglevel'], 'access': 'none'},
        'inbounds': [{'listen': '127.0.0.1', 'port': 10000, 'protocol': 'vless',
          'settings': {'clients': [{'id': d['uuid'], 'email': d['id']+'@darvazeh.local'} for d in device_records(s) if d['enabled']], 'decryption': 'none'},
          'streamSettings': {'network': 'ws', 'security': 'none', 'wsSettings': {'path': '/connect'}}}],
        'outbounds': [{'protocol': 'freedom', 'tag': 'direct'}, {'protocol': 'blackhole', 'tag': 'blocked'}],
        'routing': {'domainStrategy': 'IPIfNonMatch', 'rules': [{'type': 'field', 'ip': ['geoip:private'], 'outboundTag': 'blocked'}]}}

def stop():
    global PROC
    if RELAY: RELAY.disconnect()
    if PROC and PROC.poll() is None:
        PROC.terminate()
        try: PROC.wait(timeout=5)
        except subprocess.TimeoutExpired: PROC.kill(); PROC.wait()

def apply(s):
    global PROC, settings, CORE_ERROR
    with LOCK:
        if ENV_ERRORS or STORAGE_ERROR or settings is None:
            raise RuntimeError('Setup not ready')
        validate_devices(s)
        previous = json.loads(json.dumps(settings))
        # Additive backup: never replace an existing pre-upgrade snapshot.
        backup = DATA / 'backups' / 'settings-before-0.2.0.json'
        if SETTINGS.exists() and not backup.exists():
            backup.parent.mkdir(mode=0o700,exist_ok=True)
            with backup.open('x') as f:
                os.chmod(backup,0o600); f.write(SETTINGS.read_text())
        if not DEMO:
            candidate = DATA / 'candidate.json'; save(candidate, config(s))
            subprocess.run(['xray','run','-test','-config',str(candidate)],check=True,timeout=15,
                           stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            stop()
            try:
                candidate.replace(DATA / 'xray.json')
                PROC = subprocess.Popen(['xray','run','-config',str(DATA / 'xray.json')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                time.sleep(.4)
                if PROC.poll() is not None: raise RuntimeError('Core start failed')
                save(SETTINGS,s)
            except Exception:
                stop()
                save(DATA / 'xray.json',config(previous))
                PROC = subprocess.Popen(['xray','run','-config',str(DATA / 'xray.json')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                raise
        else: save(SETTINGS,s)
        settings=s; CORE_ERROR=None
        event('configuration','تنظیمات هسته اعمال شد' if not DEMO else 'تنظیمات نمایشی ذخیره شد')

def status():
    alive = bool(PROC and PROC.poll() is None)
    return {'mode': 'demo' if DEMO else 'live', 'core_running': alive, 'uptime_seconds': int(time.time()-START),
        'domain': DOMAIN, 'transport': 'VLESS / WebSocket', 'path': '/connect',
        'tls': 'Hostim edge → HTTP داخلی', 'loglevel': settings['loglevel'] if settings else 'warning',
        'version': VERSION, 'initializing': INITIALIZING,
        'setup_errors': list(ENV_ERRORS) + ([STORAGE_ERROR] if STORAGE_ERROR else []) + ([CORE_ERROR] if CORE_ERROR else []),
        'panel_memory_mb': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024, 1),
        'events': list(EVENTS), 'limits': ['این گزارش دسترسی از همراه اول یا ایرانسل را آزمایش نمی‌کند.',
        'تاریخچه مربوط به اتصال‌های WS مشاهده‌شده است، نه حضور قطعی شخص. آمار شامل سربار انتقال است.', 'محتوای ترافیک، مقصدها و UUID در گزارش ثبت نمی‌شوند.']}

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
        if self.path == '/api/bootstrap': return self.reply(200, bootstrap())
        if self.path == '/healthz': return self.reply(200, {'panel': 'ok'})
        if self.path == '/':
            raw = Path(__file__).with_name('index.html').read_bytes()
            self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Cache-Control','no-store'); self.send_header('X-Frame-Options','DENY')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers(); self.wfile.write(raw); return
        sid,s = self.session()
        if not s: return self.reply(401, {'error':'ابتدا وارد شوید'})
        route=urllib.parse.urlsplit(self.path)
        query=urllib.parse.parse_qs(route.query)
        if route.path == '/api/devices': return self.reply(200, {'devices':public_devices()})
        if route.path == '/api/profiles': return self.reply(200,profiles())
        if route.path == '/api/history':
            if not HISTORY: return self.reply(503, {'error':'تاریخچه آماده نیست؛ وضعیت پایش را بررسی کنید'})
            try:
                HISTORY.cleanup()
                return self.reply(200, {'connections':HISTORY.history(query.get('device',[''])[0],query.get('state',[''])[0]),
                    'summary':HISTORY.summary(), 'trials':HISTORY.trials(), 'monitor':history_status()})
            except Exception: return self.reply(503, {'error':'خواندن تاریخچه ناموفق بود'})
        if self.path in ('/api/status','/api/report'):
            result = status()
            result['monitor'] = history_status()
            # Default report intentionally excludes device names, IPs and private history.
            if self.path == '/api/status': result['csrf'] = s['csrf']
            return self.reply(200,result, {'Content-Disposition':'attachment; filename="darvazeh-report.json"'} if self.path.endswith('report') else {})
        if route.path == '/api/link':
            if INITIALIZING or ENV_ERRORS or STORAGE_ERROR or settings is None or (not DEMO and not (PROC and PROC.poll() is None)):
                return self.reply(503, {'error':'لینک آماده نیست؛ خطاهای راه‌اندازی پنل را بررسی کنید'})
            if MONITOR_ENABLED and not DEMO and not (RELAY and RELAY.ready):
                return self.reply(503, {'error':'واسط پایش آماده نیست؛ وضعیت پایش یا MONITOR_ENABLED را بررسی کنید'})
            chosen=next((d for d in device_records() if d['id']==query.get('device',['legacy'])[0]),None)
            if not chosen or not chosen['enabled']: return self.reply(404, {'error':'دستگاه فعال پیدا نشد'})
            return self.reply(200, {'link':make_link(chosen)})
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
            if PASSWORD_HASH is None:
                return self.reply(503, {'error':'ورود امن آماده نیست؛ ADMIN_PASSWORD را در Hostim اصلاح و اپ را Restart کنید'})
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
        if self.path != '/api/logout' and (INITIALIZING or ENV_ERRORS or STORAGE_ERROR or settings is None):
            return self.reply(503, {'error':'ابتدا خطاهای راه‌اندازی را برطرف کنید؛ داده‌ها تغییر نکردند'})
        try:
            with LOCK:
                if self.path == '/api/devices':
                    name=body.get('name','')
                    if not isinstance(name,str) or not 1<=len(name.strip())<=80 or any(ord(c)<32 for c in name):
                        return self.reply(400, {'error':'نام دستگاه باید بین ۱ تا ۸۰ کاراکتر باشد'})
                    if len(device_records())>=50: return self.reply(400, {'error':'حداکثر ۵۰ دستگاه مجاز است'})
                    import uuid
                    new=json.loads(json.dumps(settings))
                    new.setdefault('devices',[]).append({'id':uuid.uuid4().hex,'uuid':str(uuid.uuid4()),'name':name.strip(),'enabled':True})
                    apply(new)
                elif self.path == '/api/device':
                    ident=body.get('id'); operation=body.get('operation')
                    new=json.loads(json.dumps(settings))
                    d=next((d for d in device_records(new) if d['id']==ident),None)
                    if not d or operation not in ('enable','disable','rename','rotate'):
                        return self.reply(400, {'error':'عملیات یا دستگاه نامعتبر'})
                    if operation=='rename':
                        name=body.get('name','')
                        if not isinstance(name,str) or not 1<=len(name.strip())<=80 or any(ord(c)<32 for c in name):
                            return self.reply(400, {'error':'نام نامعتبر'})
                        d['name']=name.strip()
                    elif operation=='rotate':
                        import uuid
                        d['uuid']=str(uuid.uuid4())
                    else: d['enabled']=operation=='enable'
                    if ident=='legacy':
                        new.update(uuid=d['uuid'],legacy_name=d['name'],legacy_enabled=d['enabled'])
                    else:
                        new['devices']=[d if item['id']==ident else item for item in new['devices']]
                    apply(new)
                elif self.path == '/api/history/purge':
                    if not HISTORY: return self.reply(503, {'error':'تاریخچه آماده نیست'})
                    if body.get('confirm')!='DELETE_HISTORY': return self.reply(400, {'error':'تأیید پاک‌سازی لازم است'})
                    HISTORY.purge(); event('history','تاریخچهٔ بسته‌شده پاک شد؛ دستگاه‌ها حفظ شدند')
                elif self.path == '/api/trial':
                    if not HISTORY: return self.reply(503, {'error':'تاریخچه آماده نیست'})
                    try: HISTORY.trial(body)
                    except ValueError as exc: return self.reply(400, {'error':str(exc)})
                elif self.path == '/api/settings':
                    level = body.get('loglevel')
                    if level not in ('warning','error','none'): return self.reply(400, {'error':'سطح لاگ نامعتبر'})
                    apply({**settings, 'loglevel':level})
                elif self.path == '/api/restart': apply(settings.copy())
                elif self.path == '/api/rotate':
                    import uuid
                    apply({**settings,'uuid':str(uuid.uuid4())})
                else: return self.reply(404, {'error':'یافت نشد'})
            return self.reply(200, {'ok':True})
        except Exception as exc:
            record_core_error(exc)
            return self.reply(500, {'error':'عملیات ناموفق بود؛ تنظیم قبلی تا حد امکان حفظ شد'})

if __name__ == '__main__':
    def initialize():
        global INITIALIZING, HISTORY, HISTORY_ERROR, RELAY
        try:
            for code in ENV_ERRORS:
                print('Setup:', code, flush=True)
                event('setup', code)
            load_settings()
            if not ENV_ERRORS and not STORAGE_ERROR and settings is not None:
                try: HISTORY=Store(DATA)
                except Exception: HISTORY_ERROR='HISTORY_STORAGE_FAILED'; event('error',HISTORY_ERROR)
                if not DEMO and MONITOR_ENABLED:
                    try:
                        RELAY=Relay(HISTORY,device_map,os.getenv('TRUSTED_PROXY_CIDRS',''),str(DATA/'GeoLite2-Country.mmdb'))
                        RELAY.start()
                    except Exception: HISTORY_ERROR='MONITOR_TRUST_CONFIG_INVALID'; event('error',HISTORY_ERROR)
                try: apply(settings.copy())
                except Exception as exc: record_core_error(exc)
        finally:
            INITIALIZING = False
    threading.Thread(target=initialize, daemon=True).start()
    def watch():
        previous = None
        while True:
            alive = bool(PROC and PROC.poll() is None)
            if not DEMO and alive != previous:
                event('core', 'هسته در حال اجراست' if alive else 'هسته متوقف است؛ راه‌اندازی مجدد را بررسی کنید')
            previous = alive
            if HISTORY:
                try: HISTORY.cleanup()
                except Exception: pass
            time.sleep(30)
    threading.Thread(target=watch,daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0' if DEMO else '127.0.0.1', int(os.getenv('PORT','8081'))), Handler).serve_forever()
