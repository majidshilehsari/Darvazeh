"""Private, bounded transport observations. No destinations or payloads stored."""
import asyncio, contextlib, ipaddress, sqlite3, threading, time, uuid
from pathlib import Path

class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.lock = threading.RLock()
        path = self.root / 'history.sqlite3'
        existed = path.exists()
        self.db = sqlite3.connect(path, check_same_thread=False, timeout=5)
        self.db.row_factory = sqlite3.Row
        schema = self.db.execute('PRAGMA user_version').fetchone()[0]
        if schema not in (0, 1, 2):
            self.db.close(); raise ValueError('Unsupported history schema')
        if existed and schema < 2:
            backup = self.root / 'history-before-quota-v2.sqlite3'
            if not backup.exists():
                with sqlite3.connect(backup) as dest: self.db.backup(dest)
                backup.chmod(0o600)
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS connections (
                id TEXT PRIMARY KEY, device_id TEXT NOT NULL, peer_ip TEXT,
                client_ip TEXT, country TEXT, ip_source TEXT NOT NULL,
                started REAL NOT NULL, last_seen REAL NOT NULL, ended REAL,
                state TEXT NOT NULL, up INTEGER NOT NULL DEFAULT 0,
                down INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS conn_time ON connections(started);
            CREATE INDEX IF NOT EXISTS conn_device ON connections(device_id);
            CREATE TABLE IF NOT EXISTS trials (
                id TEXT PRIMARY KEY, created REAL NOT NULL, network TEXT NOT NULL,
                client TEXT NOT NULL, profile TEXT NOT NULL, result TEXT NOT NULL,
                latency_ms INTEGER);
            CREATE TABLE IF NOT EXISTS usage (
                device_id TEXT PRIMARY KEY, first_seen REAL, used_bytes INTEGER NOT NULL DEFAULT 0,
                basis TEXT NOT NULL DEFAULT 'metered');

        ''')
        if schema < 2:
            with self.db:
                self.db.execute('''INSERT OR IGNORE INTO usage(device_id,first_seen,used_bytes,basis)
                    SELECT device_id,MIN(started),SUM(up+down),'retained-history' FROM connections GROUP BY device_id''')
                self.db.execute('PRAGMA user_version=2')
        path.chmod(0o600)
        # A crash does not prove the actual disconnect time. last_seen is a lower bound.
        self.db.execute("UPDATE connections SET state='interrupted', ended=last_seen WHERE state='active'")
        self.db.commit()
        self.cleanup()

    def cleanup(self):
        with self.lock, self.db:
            cutoff = time.time() - 7*86400
            self.db.execute("DELETE FROM connections WHERE state!='active' AND last_seen < ?", (cutoff,))
            self.db.execute('DELETE FROM trials WHERE created < ?', (cutoff,))
            for name in ('history-before-upgrade.sqlite3','history-before-quota-v2.sqlite3'):
                snapshot = self.root / name
                if snapshot.exists() and snapshot.stat().st_mtime < cutoff: snapshot.unlink()
            self.db.execute('DELETE FROM connections WHERE id IN (SELECT id FROM connections WHERE state!=\'active\' ORDER BY started DESC LIMIT -1 OFFSET 50000)')

    def open(self, device_id, peer, client, source, country):
        key = uuid.uuid4().hex; now = time.time()
        with self.lock, self.db:
            self.db.execute('INSERT OR IGNORE INTO usage(device_id,first_seen) VALUES (?,?)',(device_id,now))
            self.db.execute('UPDATE usage SET first_seen=COALESCE(first_seen,?) WHERE device_id=?',(now,device_id))
            self.db.execute('INSERT INTO connections VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                            (key, device_id, peer, client, country, source, now, now, None, 'active', 0, 0))
        return key

    def update(self, key, up, down, closed=False):
        now = time.time()
        with self.lock, self.db:
            self.db.execute('UPDATE connections SET last_seen=?, ended=?, state=?, up=?, down=? WHERE id=?',
                            (now, now if closed else None, 'closed' if closed else 'active', up, down, key))

    def usage(self, device_id):
        with self.lock:
            row=self.db.execute('SELECT first_seen,used_bytes,basis FROM usage WHERE device_id=?',(device_id,)).fetchone()
            return dict(row) if row else {'first_seen':None,'used_bytes':0,'basis':'metered'}

    def entitlement(self, device_id, policy, now=None):
        usage=self.usage(device_id)
        limit=policy.get('quota_bytes',0); days=policy.get('duration_days',0)
        expires=usage['first_seen']+days*86400 if usage['first_seen'] is not None and days else None
        now=time.time() if now is None else now
        reason='disabled' if not policy.get('enabled',True) else (
            'expired' if expires is not None and now>=expires else (
            'exhausted' if limit and usage['used_bytes']>=limit else None))
        return {**usage,'quota_bytes':limit,'duration_days':days,'expires_at':expires,
                'remaining_bytes':max(0,limit-usage['used_bytes']) if limit else None,'reason':reason}

    def charge(self, device_id, amount, policy):
        """Durable reservation BEFORE forwarding. Serialized across all sockets.
        If a process dies between debit and send, at most that reserved chunk is
        overcounted. History deletion/restart can never refill this balance.
        """
        if type(amount) is not int or amount<0: raise ValueError('Invalid charge')
        with self.lock, self.db:
            state=self.entitlement(device_id,policy)
            if state['reason']: return 0
            limit=state['remaining_bytes']
            allowed=amount if limit is None else min(amount,limit)
            self.db.execute('INSERT OR IGNORE INTO usage(device_id) VALUES (?)',(device_id,))
            self.db.execute('UPDATE usage SET used_bytes=used_bytes+? WHERE device_id=?',(allowed,device_id))
            return allowed

    def history(self, device='', state=''):
        if state not in ('', 'active', 'closed', 'interrupted'): raise ValueError('Invalid state')
        with self.lock:
            rows = self.db.execute('SELECT * FROM connections WHERE (?="" OR device_id=?) AND (?="" OR state=?) ORDER BY started DESC LIMIT 200', (device, device, state, state)).fetchall()
            return [dict(r, duration_seconds=max(0, int((r['ended'] or r['last_seen'])-r['started']))) for r in rows]

    def summary(self):
        with self.lock:
            return [dict(r) for r in self.db.execute('''SELECT device_id, COUNT(*) connections,
                SUM(CASE WHEN state='active' THEN 1 ELSE 0 END) active_connections,
                SUM(up) upload_wire_bytes, SUM(down) download_wire_bytes,
                MAX(last_seen) last_seen FROM connections GROUP BY device_id''')]

    def purge(self):
        # Keep live counters; delete completed observations only, not settings/devices.
        with self.lock, self.db:
            self.db.execute("DELETE FROM connections WHERE state!='active'")
            self.db.execute('DELETE FROM trials')

    def trial(self, value):
        network = value.get('network', '')
        client = value.get('client', '')
        profile = value.get('profile', '')
        result = value.get('result', '')
        latency = value.get('latency_ms')
        if not all(isinstance(v,str) and 1 <= len(v) <= 80 for v in (network,client)):
            raise ValueError('نام شبکه و کلاینت باید بین ۱ و ۸۰ کاراکتر باشد')
        if profile not in ('ws-baseline','ws-client-tuning','xhttp-research') or result not in ('working','failed','unstable'):
            raise ValueError('پروفایل یا نتیجه نامعتبر')
        if latency is not None and (type(latency) is not int or not 0 <= latency <= 600000):
            raise ValueError('تاخیر نامعتبر')
        with self.lock, self.db:
            self.db.execute('INSERT INTO trials VALUES (?,?,?,?,?,?,?)',
                            (uuid.uuid4().hex,time.time(),network,client,profile,result,latency))
            self.db.execute('DELETE FROM trials WHERE id IN (SELECT id FROM trials ORDER BY created DESC LIMIT -1 OFFSET 1000)')

    def trials(self):
        with self.lock: return [dict(r) for r in self.db.execute('SELECT * FROM trials ORDER BY created DESC LIMIT 100')]


def address_info(peer, forwarded, trusted):
    """Only trust explicitly configured proxy CIDRs, walk XFF from the right."""
    try: current = ipaddress.ip_address(peer)
    except ValueError: return None, None, 'unavailable'
    networks = [ipaddress.ip_network(n.strip()) for n in trusted.split(',') if n.strip()]
    def known(ip): return any(ip in n for n in networks)
    if not known(current): return str(current), None, 'proxy-unverified'
    parts = forwarded.split(',') if forwarded else []
    if len(parts) > 20: return str(current), None, 'invalid-chain'
    try: chain = [ipaddress.ip_address(p.strip()) for p in parts]
    except ValueError: return str(current), None, 'invalid-chain'
    if not chain: return str(current), None, 'missing-forwarded'
    for ip in reversed(chain):
        if not known(current): break
        current = ip
    if known(current) or not current.is_global: return peer, None, 'unresolved-chain'
    return peer, str(current), 'trusted-proxy-chain'

class Country:
    def __init__(self, path):
        self.reader = None
        if Path(path).is_file():
            try:
                import maxminddb
                self.reader = maxminddb.open_database(str(path))
            except Exception: pass
    def lookup(self, ip):
        if not self.reader or not ip: return None
        try: return (self.reader.get(ip) or {}).get('country',{}).get('iso_code')
        except Exception: return None

class Prefix:
    """Inspect only the first 17 VLESS bytes across masked WS frames/chunks.
    Never retain addresses or application payload. No early-data support in monitor.
    """
    def __init__(self):
        self.header=bytearray(); self.need=2; self.remaining=None; self.mask=None
        self.offset=0; self.data=bytearray(); self.binary=False; self.done=False; self.opcode=0
    def feed(self, raw):
        if self.done: return None
        pos=0
        while pos < len(raw):
            if self.remaining is None:
                take=min(self.need-len(self.header),len(raw)-pos)
                self.header.extend(raw[pos:pos+take]); pos+=take
                if len(self.header)<self.need: break
                if self.need==2:
                    self.opcode=self.header[0]&15
                    if self.header[0]&0x70 or not self.header[1]&0x80 or self.opcode not in (0,2,8,9,10):
                        self.done=True; return None
                    n=self.header[1]&127
                    self.need=2+(2 if n==126 else 8 if n==127 else 0)+4
                    continue
                n=self.header[1]&127
                size=n if n<126 else int.from_bytes(self.header[2:4 if n==126 else 10],'big')
                if size > 16*1024*1024: self.done=True; return None
                self.mask=bytes(self.header[-4:]); self.remaining=size; self.offset=0
                if self.opcode==2: self.binary=True
                if self.opcode==8: self.done=True; return None
            take=min(self.remaining,len(raw)-pos)
            if self.binary and self.opcode in (0,2):
                for i in range(min(take,17-len(self.data))):
                    self.data.append(raw[pos+i]^self.mask[(self.offset+i)%4])
                if len(self.data)==17:
                    self.done=True
                    return str(uuid.UUID(bytes=bytes(self.data[1:]))) if self.data[0]==0 else None
            self.offset+=take; self.remaining-=take; pos+=take
            if self.remaining==0:
                self.remaining=None; self.header.clear(); self.need=2
        return None

class Relay:
    def __init__(self, store, devices, trusted='', country_path='/data/GeoLite2-Country.mmdb', port=10001, target=10000, policies=None):
        # Invalid CIDRs must not silently enable trust.
        for n in trusted.split(','):
            if n.strip(): ipaddress.ip_network(n.strip())
        self.store=store; self.devices=devices; self.trusted=trusted
        self.policies=policies or (lambda: {})
        self.country=Country(country_path); self.port=port; self.target=target
        self.ready=False; self.error=None; self.connections=0; self.persistence_error=False
        self.loop=None; self.active={}; self.server=None

    def disconnect(self, device_id=None):
        if self.loop:
            def close():
                for writer, device in list(self.active.items()):
                    if device_id is None or device==device_id: writer.close()
            self.loop.call_soon_threadsafe(close)

    async def handle(self, reader, writer):
        if self.connections>=256:
            writer.close(); return
        self.connections+=1
        upstream=None; tasks=[]; key=None; device=None; counts=[0,0]
        try:
            header=await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'),15)
            if len(header)>16384: return
            lines=header.decode('latin1').split('\r\n'); first=lines[0].split()
            if len(first)!=3 or first[0]!='GET' or first[1].split('?')[0]!='/connect': return
            headers={}
            for line in lines[1:]:
                if ':' in line:
                    k,v=line.split(':',1); k=k.lower()
                    if k in headers: return
                    headers[k]=v.strip()
            if headers.get('upgrade','').lower()!='websocket': return
            guarded=any(p.get('quota_bytes',0) or p.get('duration_days',0) for p in self.policies().values())
            if guarded and headers.get('sec-websocket-protocol'):
                writer.write(b'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
                await writer.drain(); return
            peer,client,source=address_info(headers.get('x-darvazeh-peer',''),headers.get('x-darvazeh-forwarded',''),self.trusted)
            # Strip XFF so untrusted client headers cannot influence Xray source identity.
            clean=[lines[0]]+[line for line in lines[1:] if line and line.split(':',1)[0].lower() not in ('x-forwarded-for','x-darvazeh-peer','x-darvazeh-forwarded')]
            if client: clean.append('X-Forwarded-For: '+client)
            ur,upstream=await asyncio.wait_for(asyncio.open_connection('127.0.0.1',self.target),10)
            upstream.write(('\r\n'.join(clean)+'\r\n\r\n').encode('latin1')); await upstream.drain()
            reply=await asyncio.wait_for(ur.readuntil(b'\r\n\r\n'),15)
            writer.write(reply); await writer.drain()
            if not reply.split(b'\r\n',1)[0].startswith(b'HTTP/1.1 101'): return
            prefix=Prefix()
            early_untracked=bool(headers.get('sec-websocket-protocol'))
            pending=bytearray()
            started=time.monotonic()
            def policy():
                return self.policies().get(device,{'enabled':True})
            def limited():
                p=policy(); return bool(p.get('quota_bytes',0) or p.get('duration_days',0))
            def close_device():
                for w,d in list(self.active.items()):
                    if d==device: w.close()
            async def pump(src,dst,direction):
                nonlocal key,device
                while True:
                    chunk=await asyncio.wait_for(src.read(65536),15 if device is None and not early_untracked else 3600)
                    if not chunk: return
                    if direction==0 and device is None and not early_untracked:
                        pending.extend(chunk)
                        credential=prefix.feed(chunk)
                        if not credential:
                            if prefix.done or len(pending)>65536: return
                            continue
                        device=self.devices().get(credential)
                        if device is None: return
                        self.active[writer]=device
                        try:
                            if self.store.entitlement(device,policy())['reason']: close_device(); return
                            key=await asyncio.to_thread(self.store.open,device,peer,client,source,self.country.lookup(client))
                        except Exception:
                            self.persistence_error=True
                            if limited(): close_device(); return
                        chunk=bytes(pending); pending.clear()
                    allowed=len(chunk)
                    if device is not None:
                        try: allowed=await asyncio.to_thread(self.store.charge,device,len(chunk),policy())
                        except Exception:
                            self.persistence_error=True
                            if limited(): close_device(); return
                    if allowed:
                        counts[direction]+=allowed
                        dst.write(chunk[:allowed]); await dst.drain()
                    if allowed<len(chunk): close_device(); return
                    if time.monotonic()-started>86400: return
            async def heartbeat():
                tick=0
                while True:
                    await asyncio.sleep(1); tick+=1
                    if device is not None:
                        try:
                            if self.store.entitlement(device,policy())['reason']: close_device(); return
                        except Exception:
                            self.persistence_error=True
                            if limited(): close_device(); return
                    if key and tick%15==0:
                        try: await asyncio.to_thread(self.store.update,key,*counts)
                        except Exception: self.persistence_error=True
            tasks=[asyncio.create_task(pump(reader,upstream,0)),asyncio.create_task(pump(ur,writer,1)),asyncio.create_task(heartbeat())]
            await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
        except (OSError, ValueError, asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError): pass
        finally:
            for t in tasks: t.cancel()
            if tasks: await asyncio.gather(*tasks,return_exceptions=True)
            if key:
                try: await asyncio.to_thread(self.store.update,key,*counts,True)
                except Exception: self.persistence_error=True
            self.active.pop(writer,None); self.connections-=1
            if upstream: upstream.close()
            writer.close()
            with contextlib.suppress(Exception): await writer.wait_closed()

    async def serve(self):
        self.loop=asyncio.get_running_loop()
        self.server=await asyncio.start_server(self.handle,'127.0.0.1',self.port,limit=16384)
        self.ready=True
        async with self.server: await self.server.serve_forever()
    def start(self):
        def run():
            try: asyncio.run(self.serve())
            except Exception: self.error='MONITOR_RELAY_UNAVAILABLE'; self.ready=False
        threading.Thread(target=run,daemon=True).start()
