import asyncio, concurrent.futures, json, os, runpy, sqlite3, sys, tempfile, time, unittest, uuid
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from telemetry import Store, Relay
from test_advanced import frame
from test_startup import running

class LedgerTest(unittest.TestCase):
    def test_atomic_shared_budget_and_restart(self):
        with tempfile.TemporaryDirectory() as root:
            store=Store(root); key=store.open('phone','10.0.0.1',None,'unknown',None)
            policy={'enabled':True,'quota_bytes':100,'duration_days':10}
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
                allowed=list(pool.map(lambda _:store.charge('phone',30,policy),range(20)))
            self.assertEqual(sum(allowed),100); self.assertEqual(store.entitlement('phone',policy)['reason'],'exhausted')
            first=store.usage('phone')['first_seen'];store.update(key,50,50,True);store.purge()
            self.assertEqual(store.usage('phone')['used_bytes'],100)
            store.db.close();store=Store(root)
            self.assertEqual(store.usage('phone')['used_bytes'],100); self.assertEqual(store.usage('phone')['first_seen'],first)
            self.assertEqual(store.charge('phone',10,policy),0);store.db.close()
    def test_days_are_calendar_days_from_first_seen(self):
        with tempfile.TemporaryDirectory() as root:
            store=Store(root); policy={'enabled':True,'duration_days':10,'quota_bytes':0}
            self.assertIsNone(store.entitlement('new',policy)['expires_at'])
            store.open('new',None,None,'unknown',None); first=store.usage('new')['first_seen']
            self.assertIsNone(store.entitlement('new',policy,now=first+10*86400-1)['reason'])
            self.assertEqual(store.entitlement('new',policy,now=first+10*86400)['reason'],'expired');store.db.close()
    def test_migrate_v1_once_keep_seven_day_deletion_separate(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'history.sqlite3'
            with sqlite3.connect(path) as db:
                db.executescript('''CREATE TABLE connections(id TEXT PRIMARY KEY,device_id TEXT,peer_ip TEXT,client_ip TEXT,country TEXT,ip_source TEXT,started REAL,last_seen REAL,ended REAL,state TEXT,up INTEGER,down INTEGER); PRAGMA user_version=1;''')
                db.execute('INSERT INTO connections VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',('old','legacy',None,None,None,'unknown',1,2,2,'closed',400,600))
            store=Store(root)
            self.assertTrue((Path(root)/'history-before-quota-v2.sqlite3').exists())
            self.assertEqual(store.usage('legacy')['used_bytes'],1000)
            self.assertEqual(store.usage('legacy')['basis'],'retained-history')
            self.assertEqual(store.history(),[]) # retention deletes old record but never balance
            store.db.close();store=Store(root);self.assertEqual(store.usage('legacy')['used_bytes'],1000);store.db.close()

class QuotaAPITest(unittest.TestCase):
    def test_limits_roundtrip_and_rekey_does_not_refill(self):
        with running({'DEMO_MODE':'1'}) as (req,data):
            _,body,h=req('/api/login',{'password':'private-test-secret-123456'});cookie=h['Set-Cookie'].split(';')[0];csrf=json.loads(body)['csrf']
            self.assertEqual(req('/api/devices',{'name':'phone','quota_bytes':5_000_000_000,'duration_days':10},cookie,csrf)[0],200)
            d=json.loads(req('/api/devices',cookie=cookie)[1])['devices'][1]
            self.assertEqual(d['duration_days'],10);self.assertIsNone(d['expires_at']);self.assertEqual(d['quota_bytes'],5_000_000_000)
            with sqlite3.connect(data/'history.sqlite3') as db: db.execute('INSERT INTO usage VALUES (?,?,?,?)',(d['id'],time.time(),123,'metered'))
            self.assertEqual(req('/api/device',{'id':d['id'],'operation':'rotate'},cookie,csrf)[0],200)
            self.assertEqual(req('/api/history/purge',{'confirm':'DELETE_HISTORY'},cookie,csrf)[0],200)
            new=json.loads(req('/api/devices',cookie=cookie)[1])['devices'][1];self.assertEqual(new['used_bytes'],123)
            self.assertEqual(req('/api/device',{'id':d['id'],'operation':'edit','name':'phone2','quota_bytes':100,'duration_days':10},cookie,csrf)[0],200)
            self.assertEqual(req('/api/link?device='+d['id'],cookie=cookie)[0],409)
            for bad in (-1,True,'5000',1.5,10**16):
                self.assertEqual(req('/api/devices',{'name':'bad','quota_bytes':bad},cookie,csrf)[0],400)
    def test_bypass_mode_refuses_limits_and_core_excludes_them(self):
        with running({'DEMO_MODE':'1','MONITOR_ENABLED':'0'}) as (req,data):
            _,body,h=req('/api/login',{'password':'private-test-secret-123456'});cookie=h['Set-Cookie'].split(';')[0];csrf=json.loads(body)['csrf']
            self.assertEqual(req('/api/devices',{'name':'bad','quota_bytes':100},cookie,csrf)[0],409)
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ,{'DATA_DIR':tmp,'MONITOR_ENABLED':'0','ADMIN_PASSWORD':'test-password-123456','PUBLIC_DOMAIN':'example.test'}):
            ns=runpy.run_path('app/server.py',run_name='config_test')
            base={'uuid':str(uuid.uuid4()),'loglevel':'warning','devices':[{'id':'phone','uuid':str(uuid.uuid4()),'name':'phone','enabled':True,'quota_bytes':100}]}
            clients=ns['config'](base)['inbounds'][0]['settings']['clients']
            self.assertEqual(len(clients),1);self.assertEqual(clients[0]['id'],base['uuid'])

class QuotaRelayTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=Store(self.tmp.name);self.keys={str(uuid.uuid4()):'capped',str(uuid.uuid4()):'unlimited'}
        self.rules={'capped':{'enabled':True,'quota_bytes':200,'duration_days':10},'unlimited':{'enabled':True,'quota_bytes':0,'duration_days':0}}
        self.backend_writers=set();self.received=0
        async def backend(reader,writer):
            self.backend_writers.add(writer)
            try:
                await reader.readuntil(b'\r\n\r\n');writer.write(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');await writer.drain()
                while True:
                    b=await reader.read(65536)
                    if not b: break
                    self.received+=len(b)
            finally: writer.close();await writer.wait_closed();self.backend_writers.discard(writer)
        self.backend=await asyncio.start_server(backend,'127.0.0.1',0)
        self.relay=Relay(self.store,lambda:self.keys,policies=lambda:self.rules,target=self.backend.sockets[0].getsockname()[1])
        self.proxy=await asyncio.start_server(self.relay.handle,'127.0.0.1',0)
        self.clients=[]
    async def asyncTearDown(self):
        for r,w in self.clients:w.close()
        self.proxy.close();await self.proxy.wait_closed()
        for w in list(self.backend_writers):w.close()
        self.backend.close();await self.backend.wait_closed()
        for _ in range(50):
            if not self.relay.connections:break
            await asyncio.sleep(.02)
        self.store.db.close();self.tmp.cleanup()
    async def connect(self,device,early=False):
        r,w=await asyncio.open_connection('127.0.0.1',self.proxy.sockets[0].getsockname()[1]);self.clients.append((r,w))
        header=b'GET /connect HTTP/1.1\r\nHost: example.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
        if early:header+=b'Sec-WebSocket-Protocol: abcdef\r\n'
        w.write(header+b'\r\n');await w.drain();reply=await r.readuntil(b'\r\n\r\n')
        if early:return r,w,reply
        key=next(k for k,v in self.keys.items() if v==device)
        w.write(frame(b'\x00'+uuid.UUID(key).bytes+b'\x00'));await w.drain()
        for _ in range(50):
            if self.store.usage(device)['used_bytes']>0:break
            await asyncio.sleep(.01)
        return r,w,reply
    async def test_live_volume_cutoff_and_other_device_survives(self):
        r,w,_=await self.connect('capped');r2,w2,_=await self.connect('capped');other,ow,_=await self.connect('unlimited')
        w.write(frame(b'x'*500));await w.drain()
        self.assertEqual(await asyncio.wait_for(r.read(),3),b'');self.assertEqual(await asyncio.wait_for(r2.read(),3),b'')
        self.assertEqual(self.store.usage('capped')['used_bytes'],200)
        with self.assertRaises(asyncio.TimeoutError):await asyncio.wait_for(other.read(1),.1)
        again,aw,_=await self.connect('capped');self.assertEqual(await asyncio.wait_for(again.read(),2),b'')
    async def test_idle_expiry_closes_socket(self):
        r,w,_=await self.connect('capped')
        with self.store.lock,self.store.db:self.store.db.execute('UPDATE usage SET first_seen=? WHERE device_id=?',(time.time()-11*86400,'capped'))
        self.assertEqual(await asyncio.wait_for(r.read(),3),b'')
    async def test_meter_failure_is_closed_for_limited(self):
        r,w,_=await self.connect('capped')
        with self.store.lock,self.store.db:self.store.db.execute('DROP TABLE usage')
        self.assertEqual(await asyncio.wait_for(r.read(),3),b'');self.assertTrue(self.relay.persistence_error)
    async def test_early_data_cannot_bypass_quota(self):
        r,w,reply=await self.connect('capped',early=True);self.assertIn(b'400',reply)
        self.assertEqual(await asyncio.wait_for(r.read(),2),b'');self.assertEqual(self.received,0)
    async def test_unknown_or_malformed_prefix_not_forwarded(self):
        r,w=await asyncio.open_connection('127.0.0.1',self.proxy.sockets[0].getsockname()[1]);self.clients.append((r,w))
        w.write(b'GET /connect HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');await w.drain();await r.readuntil(b'\r\n\r\n')
        w.write(frame(b'\x00'+uuid.uuid4().bytes+b'secret'));await w.drain();self.assertEqual(await asyncio.wait_for(r.read(),2),b'');self.assertEqual(self.received,0)

if __name__=='__main__': unittest.main()
