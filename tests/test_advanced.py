import asyncio, base64, hashlib, json, os, sqlite3, struct, sys, tempfile, time, unittest, uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from telemetry import Store, Prefix, Relay, address_info
from test_startup import running

def frame(payload, opcode=2, final=True):
    mask=b'abcd'; length=len(payload)
    head=bytes([(128 if final else 0)|opcode])
    if length<126: head+=bytes([128|length])
    elif length<65536: head+=bytes([128|126])+struct.pack('!H',length)
    else: head+=bytes([128|127])+struct.pack('!Q',length)
    return head+mask+bytes(b^mask[i%4] for i,b in enumerate(payload))

class PrefixTest(unittest.TestCase):
    def test_chunked_and_fragmented(self):
        key=uuid.uuid4(); p=Prefix(); payload=b'\x00'+key.bytes+b'secret-destination-not-retained'
        raw=frame(payload[:8],final=False)+frame(b'ping',9)+frame(payload[8:],0)
        answer=None
        for b in raw:
            result=p.feed(bytes([b]))
            if result: answer=result
        self.assertEqual(answer,str(key)); self.assertEqual(len(p.data),17)
        self.assertNotIn(b'secret',bytes(p.data))
    def test_lengths(self):
        for n in (17,126,70000):
            key=uuid.uuid4(); p=Prefix()
            self.assertEqual(p.feed(frame(b'\x00'+key.bytes+b'x'*(n-17))),str(key))
    def test_invalid(self):
        self.assertIsNone(Prefix().feed(b'\x82\x11'+b'x'*17))
        self.assertIsNone(Prefix().feed(frame(b'\x01'+uuid.uuid4().bytes)))

class IPTest(unittest.TestCase):
    def test_spoof_not_trusted(self):
        self.assertEqual(address_info('10.0.0.2','8.8.8.8','')[1],None)
    def test_rightmost_untrusted(self):
        peer,client,source=address_info('10.0.0.2','1.1.1.1, 9.9.9.9, 10.0.0.3','10.0.0.0/24')
        self.assertEqual(client,'9.9.9.9')
        self.assertEqual(source,'trusted-proxy-chain')
    def test_malformed_and_private(self):
        self.assertIsNone(address_info('10.0.0.2','evil','10.0.0.0/24')[1])
        self.assertIsNone(address_info('10.0.0.2','192.168.1.2','10.0.0.0/24')[1])

class StoreTest(unittest.TestCase):
    def test_persistence_retention_purge(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp); key=store.open('legacy','10.0.0.2',None,'proxy-unverified',None)
            store.update(key,100,200); store.db.close()
            store=Store(tmp); row=store.history()[0]
            self.assertEqual(row['state'],'interrupted'); self.assertEqual(row['up'],100)
            self.assertIsNone(row['client_ip']); self.assertEqual(row['ended'],row['last_seen'])
            active=store.open('phone','10.0.0.2',None,'proxy-unverified',None)
            store.db.execute('UPDATE connections SET last_seen=? WHERE id=?',(time.time()-8*86400,key)); store.db.commit()
            store.cleanup(); self.assertEqual(len(store.history()),1)
            store.purge(); self.assertEqual(store.history()[0]['id'],active)
            store.update(active,1,2,True); store.purge(); self.assertEqual(store.history(),[])
            store.db.close()
    def test_unknown_schema_not_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'history.sqlite3'
            with sqlite3.connect(path) as db: db.execute('PRAGMA user_version=999')
            with self.assertRaises(ValueError): Store(tmp)
            with sqlite3.connect(path) as db: self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],999)

class AdvancedAPI(unittest.TestCase):
    def test_devices_preserve_legacy_and_secure_history(self):
        with running({'DEMO_MODE':'1'}) as (req,data):
            legacy=json.loads((data/'settings.json').read_text())['uuid']
            self.assertEqual(req('/api/history')[0],401)
            self.assertEqual(req('/api/devices')[0],401)
            _,body,h=req('/api/login',{'password':'private-test-secret-123456'})
            cookie=h['Set-Cookie'].split(';')[0]; csrf=json.loads(body)['csrf']
            self.assertEqual(req('/api/devices',{'name':'my phone'},cookie)[0],403)
            self.assertEqual(req('/api/devices',{'name':'my phone'},cookie,csrf)[0],200)
            value=json.loads((data/'settings.json').read_text()); self.assertEqual(value['uuid'],legacy)
            self.assertEqual(json.loads((data/'backups/settings-before-0.3.0.json').read_text())['uuid'],legacy)
            new=value['devices'][0]; self.assertNotEqual(new['uuid'],legacy)
            public=req('/api/devices',cookie=cookie)[1]; self.assertNotIn(new['uuid'],public); self.assertNotIn(legacy,public)
            link=req('/api/link?device='+new['id'],cookie=cookie); self.assertIn(new['uuid'],link[1])
            self.assertEqual(req('/api/device',{'id':new['id'],'operation':'disable'},cookie,csrf)[0],200)
            self.assertEqual(req('/api/link?device='+new['id'],cookie=cookie)[0],404)
            self.assertEqual(req('/api/link',cookie=cookie)[0],200)
            self.assertEqual(req('/api/history/purge',{'confirm':'no'},cookie,csrf)[0],400)
            self.assertEqual(req('/api/trial',{'network':'MCI','client':'v2rayN','profile':'ws-baseline','result':'working','latency_ms':1502},cookie,csrf)[0],200)
            hist=json.loads(req('/api/history',cookie=cookie)[1]); self.assertEqual(len(hist['trials']),1)
            self.assertEqual(hist['connections'],[]) # demo never fabricates connections
            report=req('/api/report',cookie=cookie)[1]
            for private in (new['uuid'],legacy,'my phone','private-test-secret'): self.assertNotIn(private,report)
            self.assertEqual(req('/api/history/purge',{'confirm':'DELETE_HISTORY'},cookie,csrf)[0],200)
            self.assertEqual(len(json.loads((data/'settings.json').read_text())['devices']),1)
    def test_invalid_name(self):
        with running({'DEMO_MODE':'1'}) as (req,_):
            _,body,h=req('/api/login',{'password':'private-test-secret-123456'})
            cookie=h['Set-Cookie'].split(';')[0]; csrf=json.loads(body)['csrf']
            for name in ('', 'a'*81, 'bad\nname'):
                self.assertEqual(req('/api/devices',{'name':name},cookie,csrf)[0],400)

class RelayTest(unittest.IsolatedAsyncioTestCase):
    async def test_real_sockets_transparency_and_counters(self):
        # Controlled WS peer, NOT an Xray or internet success claim.
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp); device_key=str(uuid.uuid4()); seen_headers=[]
            response=b'\x82\x04pong'
            async def backend(reader,writer):
                try:
                    h=await reader.readuntil(b'\r\n\r\n'); seen_headers.append(h)
                    writer.write(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'); await writer.drain()
                    raw=await reader.readexactly(len(packet)); self.assertEqual(raw,packet)
                    writer.write(response); await writer.drain()
                    await reader.read()
                finally: writer.close(); await writer.wait_closed()
            upstream=await asyncio.start_server(backend,'127.0.0.1',0)
            target=upstream.sockets[0].getsockname()[1]
            relay=Relay(store,lambda:{device_key:'phone'},target=target)
            proxy=await asyncio.start_server(relay.handle,'127.0.0.1',0)
            packet=frame(b'\x00'+uuid.UUID(device_key).bytes+b'\x00\x01secret-destination')
            try:
                reader,writer=await asyncio.open_connection('127.0.0.1',proxy.sockets[0].getsockname()[1])
                writer.write(b'GET /connect HTTP/1.1\r\nHost: test.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Forwarded-For: 8.8.8.8\r\nX-Darvazeh-Peer: 10.0.0.2\r\nX-Darvazeh-Forwarded: 8.8.8.8\r\n\r\n'); await writer.drain()
                self.assertIn(b'101',await reader.readuntil(b'\r\n\r\n'))
                writer.write(packet[:3]); await writer.drain(); writer.write(packet[3:]); await writer.drain()
                self.assertEqual(await reader.readexactly(len(response)),response)
                writer.close(); await writer.wait_closed()
                for _ in range(40):
                    rows=store.history()
                    if rows and rows[0]['state']=='closed': break
                    await asyncio.sleep(.02)
                row=store.history()[0]
                self.assertEqual(row['state'],'closed'); self.assertEqual(row['device_id'],'phone')
                self.assertEqual(row['up'],len(packet)); self.assertEqual(row['down'],len(response))
                self.assertIsNone(row['client_ip']); self.assertIsNone(row['country'])
                self.assertNotIn(b'X-Forwarded-For',seen_headers[0])
                self.assertNotIn(device_key,json.dumps(row)); self.assertNotIn('destination',json.dumps(row))
            finally:
                proxy.close(); upstream.close(); await proxy.wait_closed(); await upstream.wait_closed(); store.db.close()
