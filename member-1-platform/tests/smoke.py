"""Exercise the local stack. Creates and removes only synthetic local test records."""
import json
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
API = 'http://localhost:8080'


def call(method, path, body=None, headers=None, expected=(200,), raw=False):
    data = None if body is None else json.dumps(body).encode()
    req = Request(API + path, data=data, headers={'Content-Type':'application/json', **(headers or {})}, method=method)
    try:
        with urlopen(req, timeout=10) as response:
            status, payload = response.status, response.read()
    except HTTPError as error:
        status, payload = error.code, error.read()
    assert status in expected, f'{method} {path}: expected {expected}, got {status}: {payload[:250]!r}'
    return payload if raw else json.loads(payload) if payload else None


def token(username, password):
    body = urlencode({'grant_type':'password','client_id':'streaming','username':username,'password':password}).encode()
    with urlopen(Request('http://localhost:8081/realms/streaming/protocol/openid-connect/token',data=body),timeout=10) as response:
        return json.load(response)['access_token']


def eventually(fn, predicate=lambda value: bool(value), seconds=45):
    deadline = time.monotonic()+seconds
    last = None
    while time.monotonic()<deadline:
        try:
            last=fn()
            if predicate(last):
                return last
        except (AssertionError, URLError, TimeoutError) as error:
            last=str(error)
        time.sleep(1)
    raise AssertionError(f'Condition did not converge: {last}')


def main():
    env = dict(line.split('=',1) for line in (ROOT/'.local/dev.env').read_text().splitlines() if '=' in line)
    password = env['DEV_PASSWORD']
    eventually(lambda: call('GET','/plans'),seconds=180)
    alice={'Authorization':'Bearer '+token('alice',password)}
    bob={'Authorization':'Bearer '+token('bob',password)}
    admin={'Authorization':'Bearer '+token('admin',password)}
    profile=None
    title=None
    subscription=None
    try:
        profile=call('POST','/profiles',{'name':'Smoke '+uuid4().hex[:8],'maturity':18},alice,(201,))
        call('GET','/profiles/'+profile['id'],headers=bob,expected=(404,))
        pct=call('POST','/profiles/'+profile['id']+'/select',{},alice)['token']
        scoped={**alice,'X-Profile-Token':pct}
        call('GET','/catalog/titles',headers={**bob,'X-Profile-Token':pct},expected=(401,403))
        body={'name':'Synthetic smoke title','genres':['drama'],'maturity':12,'regions':['IN'],'licenseStart':'2020-01-01T00:00:00Z','licenseEnd':'2099-01-01T00:00:00Z','assetPath':'demo/master.m3u8','durationSeconds':10,'maxQuality':'HD'}
        call('POST','/admin/catalog/titles',body,alice,(403,))
        title=call('POST','/admin/catalog/titles',body,admin,(201,))
        title=call('POST',f"/admin/catalog/titles/{title['id']}/publish",{}, {**admin,'If-Match':'"1"'})
        call('PUT',f"/admin/catalog/titles/{title['id']}",body,{**admin,'If-Match':'"1"'},(412,))
        eventually(lambda:call('GET',f"/catalog/titles/{title['id']}",headers=scoped))
        call('PUT',f"/watchlist/titles/{title['id']}",{},scoped,(204,))
        call('PUT',f"/watchlist/titles/{title['id']}",{},scoped,(204,))
        entries=call('GET','/watchlist',headers=scoped)['items']
        assert sum(e['titleId']==title['id'] for e in entries)==1
        for old in call('GET','/subscriptions',headers=alice)['items']:
            if old['status'] in ('ACTIVE','PENDING'):
                call('POST',f"/subscriptions/{old['id']}/cancel",{},alice)
        idem={**alice,'Idempotency-Key':str(uuid4())}
        request={'planId':'premium','simulateTimeout':True}
        subscription=call('POST','/subscriptions',request,idem,(202,))
        repeated=call('POST','/subscriptions',request,idem,(202,))
        assert repeated['id']==subscription['id']
        call('POST','/subscriptions',{'planId':'basic'},idem,(409,))
        eventually(lambda:call('GET','/subscriptions/current',headers=alice),lambda s:s and s['status']=='ACTIVE')
        admission={**scoped,'Idempotency-Key':str(uuid4())}
        playback=call('POST','/sessions',{'titleId':title['id']},admission,(201,))
        session_id=playback['session']['sessionId']
        assert call('POST','/sessions',{'titleId':title['id']},admission,(201,))['session']['sessionId']==session_id
        call('POST',f'/sessions/{session_id}/heartbeat',{'sequence':1,'positionSeconds':4},scoped)
        call('POST',f'/sessions/{session_id}/heartbeat',{'sequence':1,'positionSeconds':4},scoped,(409,))
        call('POST',f'/sessions/{session_id}/stop',{},scoped)
        call('POST',f'/sessions/{session_id}/stop',{},scoped)
        history=eventually(lambda:call('GET','/history',headers=scoped),lambda h:any(e['sessionId']==session_id for e in h['items']))
        assert sum(e['sessionId']==session_id for e in history['items'])==1
        recommendations=call('GET','/recommendations/home',headers=scoped)
        assert 'degraded' in recommendations
        invoices=eventually(lambda:call('GET','/invoices',headers=alice),lambda v:any(i['paymentId']==subscription['paymentId'] for i in v['items']))
        invoice=next(i for i in invoices['items'] if i['paymentId']==subscription['paymentId'])
        pdf=call('GET','/invoices/'+quote(invoice['id'],safe='')+'/pdf',headers=alice,raw=True)
        assert pdf.startswith(b'%PDF-')
        call('GET','/invoices/'+quote(invoice['id'],safe=''),headers=bob,expected=(404,))
        call('GET','/internal/entitlement',headers=alice,expected=(404,))
        print('PASS: ownership, catalog CDC adapter, watchlist dedupe, payment reconciliation, admission, heartbeat ordering, history, recommendations, invoice PDF and gateway isolation.')
    finally:
        if subscription:
            call('POST',f"/subscriptions/{subscription['id']}/cancel",{},alice)
        if title:
            call('DELETE',f"/admin/catalog/titles/{title['id']}",headers={**admin,'If-Match':f'"{title["version"]}"'})
        if profile:
            call('DELETE','/profiles/'+profile['id'],headers=alice,expected=(204,))


if __name__=='__main__':
    main()
