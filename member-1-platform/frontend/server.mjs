import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openapi, operations, services } from '../contracts/http.v1.mjs';

const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/artwork.svg': ['artwork.svg', 'image/svg+xml'] };
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const publicRoutes = operations.filter(o => !o.internal).map(o => ({ method: o.method.toUpperCase(), pattern: new RegExp('^' + o.path.split(/(\{[^}]+\})/).map(p => p.startsWith('{') ? '[^/]+' : escapeRegex(p)).join('') + '$') }));
export function allowedRequest(method, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  if (decoded.includes('\\') || decoded.split('/').some(p => p === '.' || p === '..')) return false;
  return publicRoutes.some(r => r.method === method && r.pattern.test(decoded));
}
async function bodyOf(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error('Request exceeds 1 MiB'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function createDevServer({ gateway = process.env.API_GATEWAY || 'http://localhost:8080', identity = process.env.IDENTITY_URL || 'http://localhost:8081', inDocker = process.env.IN_DOCKER === 'true', upstreamFetch = fetch } = {}) {
  return http.createServer(async (req, res) => {
    const send = (status, payload, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self' http://localhost:8080 http://127.0.0.1:8080; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
    };
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return send(403, { title: 'Local host required' });
      const url = new URL(req.url, `http://${host}`);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return send(403, { title: 'Same-origin request required' });
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== `http://${host}`) return send(403, { title: 'Same-origin request required' });
      if (req.method === 'GET' && staticFiles[url.pathname]) {
        const [filename, type] = staticFiles[url.pathname];
        return send(200, await readFile(new URL(filename, import.meta.url)), `${type}; charset=utf-8`);
      }
      if (req.method === 'GET' && url.pathname === '/services') return send(200, services);
      if (req.method === 'GET' && /^\/openapi\/[a-z-]+\.json$/.test(url.pathname)) {
        const spec = openapi(url.pathname.slice(9, -5));
        return send(spec ? 200 : 404, spec || { title: 'Unknown service' });
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        const checks = await Promise.all(services.map(async s => {
          try {
            const response = await upstreamFetch(`http://${inDocker ? s.name : '127.0.0.1'}:${s.port}/health/ready`, { signal: AbortSignal.timeout(2500), redirect: 'manual' });
            return { name: s.name, ready: response.ok, status: response.status };
          } catch { return { name: s.name, ready: false, status: 'unreachable' }; }
        }));
        return send(200, { checks, note: inDocker ? 'Service dependency probes; run smoke.py for the cross-service journey.' : 'Host mode probes localhost service ports. The standard Compose stack keeps those ports private: use the Compose frontend for readiness of all eleven services.' });
      }
      let target, body, headers = {};
      if (req.method === 'POST' && url.pathname === '/auth/token') {
        const input = JSON.parse((await bodyOf(req)).toString());
        if (!['alice', 'bob', 'admin'].includes(input.username) || typeof input.password !== 'string') return send(400, { title: 'Use alice, bob or admin with the local DEV_PASSWORD' });
        target = `${identity}/realms/streaming/protocol/openid-connect/token`;
        body = new URLSearchParams({ grant_type: 'password', client_id: 'streaming', username: input.username, password: input.password });
        headers['content-type'] = 'application/x-www-form-urlencoded';
      } else if (url.pathname.startsWith('/api/')) {
        const pathname = url.pathname.slice(4);
        if (!allowedRequest(req.method, pathname)) return send(404, { title: 'Method/path is not a documented public API' });
        target = gateway.replace(/\/$/, '') + pathname + url.search;
        for (const key of ['authorization', 'x-profile-token', 'content-type', 'if-match', 'idempotency-key']) if (req.headers[key]) headers[key] = req.headers[key];
        if (!['GET', 'HEAD'].includes(req.method)) body = await bodyOf(req);
      } else return send(404, { title: 'Not found' });
      const response = await upstreamFetch(target, { method: req.method, headers, body, signal: AbortSignal.timeout(url.pathname === '/auth/token' ? 45000 : 15000), redirect: 'manual' });
      for (const key of ['etag', 'content-disposition']) if (response.headers.has(key)) res.setHeader(key, response.headers.get(key));
      return send(response.status, Buffer.from(await response.arrayBuffer()), response.headers.get('content-type') || 'application/octet-stream');
    } catch (error) {
      return send(error.status || (error instanceof SyntaxError ? 400 : 502), { title: error.status ? error.message : error instanceof SyntaxError ? 'Invalid JSON body' : 'Upstream unavailable. Check Docker services and local startup instructions.' });
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8090);
  createDevServer().listen(port, process.env.IN_DOCKER === 'true' ? '0.0.0.0' : '127.0.0.1', () => console.log(`Streaming frontend: http://localhost:${port}\nAPI documentation: member-1-platform/API_REFERENCE.md`));
}
