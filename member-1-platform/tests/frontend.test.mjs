import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createDevServer } from '../frontend/server.mjs';
import { openapi, operations, services } from '../contracts/http.v1.mjs';

async function withServer(options, action) {
  const server = createDevServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await action(origin); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('all eleven service documents contain valid references, path parameters and health probes', () => {
  for (const s of services) {
    const spec = openapi(s.name);
    assert.equal(spec.openapi, '3.1.0');
    for (const p of ['/health/live', '/health/ready']) assert.ok(spec.paths[p].get);
    for (const match of JSON.stringify(spec).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)) assert.ok(spec.components.schemas[match[1]], match[1]);
    for (const [path, methods] of Object.entries(spec.paths)) for (const op of Object.values(methods)) {
      assert.equal(op['x-service'], s.name);
      for (const m of path.matchAll(/\{([^}]+)\}/g)) assert.ok(op.parameters.some(p => p.in === 'path' && p.name === m[1] && p.required));
      if (op['x-internal']) assert.equal(op.servers[0].url, `http://${s.name}:${s.port}`);
    }
  }
  assert.equal(openapi('missing'), null);
  for (const methods of Object.values(openapi().paths)) for (const op of Object.values(methods)) assert.equal(op['x-internal'], false);
});
test('route coverage follows actual declarations across all four language stacks', () => {
  const source = filename => readFileSync(new URL(`../../${filename}`, import.meta.url), 'utf8');
  const declared = new Set(operations.map(o => `${o.method} ${o.path}`));
  const check = (method, path) => assert.ok(declared.has(`${method.toLowerCase()} ${path.replace(/:id\b/g, '{id}')}`), `Undocumented route: ${method} ${path}`);
  const nodeSource = source('member-2-personalization/src/main.ts');
  for (const m of nodeSource.matchAll(/app\.(get|post|put|patch|delete|head)\("([^"]+)"/g)) check(m[1], m[2]);
  for (const m of source('member-2-personalization/recommendation/main.py').matchAll(/@app\.(get|post)\("([^"]+)"/g)) {
    for (const path of m[2].includes('{kind}') ? ['home', 'similar', 'trending'].map(k => m[2].replace('{kind}', k)) : [m[2]]) check(m[1], path);
  }
  for (const m of source('member-4-billing/Program.cs').matchAll(/app\.Map(Get|Post|Put|Patch|Delete)\("([^"]+)"/g)) check(m[1], m[2]);
  for (const filename of ['cmd/server/main.go', 'internal/platform/playback.go', 'internal/platform/history.go']) {
    for (const m of source(`member-5-playback/${filename}`).matchAll(/mux\.HandleFunc\("(GET|POST|PUT|DELETE) ([^"]+)"/g)) check(m[1], m[2] === '/media/' ? '/media/{asset}/{file}' : m[2]);
  }
  for (const m of source('member-3-catalog/src/main/java/local/streaming/catalog/Catalog.java').matchAll(/@(Get|Post|Put|Patch|Delete)Mapping\(([^)]+)\)/g)) {
    for (const quoted of m[2].matchAll(/"([^"]+)"/g)) {
      for (const path of quoted[1].includes('{action}') ? ['publish', 'unpublish'].map(a => quoted[1].replace('{action}', a)) : [quoted[1]]) check(m[1], path);
    }
  }
});
test('Markdown API reference covers every implemented service path', () => {
  const reference = readFileSync(new URL('../API_REFERENCE.md', import.meta.url), 'utf8');
  for (const operation of operations) assert.ok(reference.includes('`' + operation.path + '`'), 'Missing Markdown route: ' + operation.path);
  for (const service of services) assert.ok(reference.includes(service.name + ':' + service.port), 'Missing service address: ' + service.name);
});
test('frontend serves browser assets and every machine-readable service document', async () => {
  await withServer({}, async origin => {
    for (const path of ['/', '/app.js', '/style.css', '/artwork.svg', '/services', '/openapi/public.json', ...services.map(s => `/openapi/${s.name}.json`)]) {
      const response = await fetch(origin + path); assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      await response.arrayBuffer();
    }
    assert.equal((await fetch(origin + '/openapi/missing.json')).status, 404);
    assert.equal((await fetch(origin + '/docs')).status, 404);
  });
});
test('proxy forwards auth, ETags, encoded invoice IDs and PDFs without forwarding workload keys', async () => {
  const seen = [];
  await withServer({ gateway: 'http://gateway:8000', upstreamFetch: async (url, options) => { seen.push({ url, options }); return new Response('%PDF-test', { headers: { 'content-type': 'application/pdf', etag: '"7"', 'content-disposition': 'attachment; filename=invoice.pdf' } }); } }, async origin => {
    const response = await fetch(origin + '/api/invoices/invoice%3Apay%3A123/pdf', { headers: { Authorization: 'Bearer demo', 'X-Profile-Token': 'profile-demo', 'X-Service-Key': 'must-not-forward' } });
    assert.equal(await response.text(), '%PDF-test'); assert.equal(response.headers.get('etag'), '"7"');
    assert.equal(seen[0].url, 'http://gateway:8000/invoices/invoice%3Apay%3A123/pdf');
    assert.equal(seen[0].options.headers.authorization, 'Bearer demo'); assert.equal(seen[0].options.headers['x-profile-token'], 'profile-demo');
    assert.equal(seen[0].options.headers['x-service-key'], undefined);
    assert.equal(seen[0].options.redirect, 'manual');
  });
});
test('internal endpoints, unknown methods, CSRF and untrusted hosts cannot reach the proxy', async () => {
  let calls = 0;
  await withServer({ upstreamFetch: async () => { calls++; return Response.json({}); } }, async origin => {
    for (const p of ['/api/internal/jobs', '/api/internal/entitlement', '/api/health/ready', '/api/catalog%2ftitles%2f..%2finternal', '/api/profiles%5c..%5cinternal', '/api/profiles%zz']) assert.equal((await fetch(origin + p)).status, 404, p);
    assert.equal((await fetch(origin + '/api/plans', { method: 'DELETE', headers: { Origin: origin } })).status, 404);
    assert.equal((await fetch(origin + '/api/profiles', { method: 'POST', headers: { Origin: 'http://untrusted.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(origin + '/api/profiles', { method: 'POST', body: '{}' })).status, 403);
    const untrustedHostStatus = await new Promise((resolve, reject) => {
      http.get(origin + '/api/plans', { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(untrustedHostStatus, 403);
    assert.equal(calls, 0);
  });
});
test('local login uses only the fixed Keycloak client and never consumes credentials from files', async () => {
  const seen = [];
  await withServer({ identity: 'http://keycloak:8080', upstreamFetch: async (url, options) => { seen.push({ url, options }); return Response.json({ access_token: 'demo' }); } }, async origin => {
    const response = await fetch(origin + '/auth/token', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'local-only', client_id: 'other' }) });
    assert.equal(response.status, 200); assert.equal(seen[0].url, 'http://keycloak:8080/realms/streaming/protocol/openid-connect/token');
    assert.equal(seen[0].options.body.get('client_id'), 'streaming'); assert.equal(seen[0].options.body.get('grant_type'), 'password');
    assert.equal(seen[0].options.body.get('password'), 'local-only');
    const invalid = await fetch(origin + '/auth/token', { method: 'POST', headers: { Origin: origin }, body: 'invalid json' }); assert.equal(invalid.status, 400);
  });
});
test('readiness reports per-service failures instead of treating frontend startup as stack health', async () => {
  await withServer({ inDocker: true, upstreamFetch: async url => { if (url.includes('watch-history:')) throw new Error('offline'); return Response.json({ status: 'ok' }); } }, async origin => {
    const result = await (await fetch(origin + '/status')).json(); assert.equal(result.checks.length, 11);
    assert.equal(result.checks.filter(s => s.ready).length, 10); assert.equal(result.checks.find(s => s.name === 'watch-history').status, 'unreachable');
  });
});
test('upstream outages return useful errors and oversized requests never reach services', async () => {
  let calls = 0;
  await withServer({ upstreamFetch: async () => { calls++; throw new Error('offline'); } }, async origin => {
    const offline = await fetch(origin + '/api/plans'); assert.equal(offline.status, 502); assert.match((await offline.json()).title, /Upstream unavailable/);
    const large = await fetch(origin + '/api/profiles', { method: 'POST', headers: { Origin: origin }, body: 'x'.repeat(1024 * 1024 + 1) }); assert.equal(large.status, 413); assert.equal(calls, 1);
  });
});
