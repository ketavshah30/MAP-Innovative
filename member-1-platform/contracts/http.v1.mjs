// Authored HTTP v1 contracts for the implemented local APIs. No service code imports.
import { readFileSync } from 'node:fs';
export const services = JSON.parse(readFileSync(new URL('./services.json', import.meta.url))).services;
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const object = (properties, required = Object.keys(properties), extra = false) => ({ type: 'object', properties, required, additionalProperties: extra });
const str = { type: 'string' }, integer = { type: 'integer' }, date = { type: 'string', format: 'date-time' };
const array = items => ({ type: 'array', items });
const items = name => object({ items: array(ref(name)) });
export const schemas = {
  Problem: object({ type: str, title: str, status: integer }, ['title', 'status'], true),
  Health: object({ status: str, service: str }, ['status']),
  Account: object({ id: str, profileCount: integer, version: integer }),
  ProfileInput: object({ name: { type: 'string', minLength: 1, maxLength: 80 }, maturity: { type: 'integer', minimum: 0, maximum: 18 } }),
  Profile: object({ id: str, accountId: str, name: str, maturity: integer, version: integer, deleted: { type: 'boolean' } }, ['id', 'name', 'maturity', 'version'], true),
  ProfileToken: object({ token: str, expiresIn: integer }),
  Context: object({ accountId: str, profileId: str, maturity: integer, region: str, policyVersion: integer }),
  TitleInput: object({ name: { type: 'string', minLength: 1, maxLength: 200 }, genres: { ...array(str), maxItems: 20 }, maturity: { type: 'integer', minimum: 0, maximum: 18 }, regions: { ...array({ type: 'string', pattern: '^[A-Z]{2}$' }), minItems: 1 }, licenseStart: date, licenseEnd: date, assetPath: { type: 'string', pattern: '^[A-Za-z0-9_-]+/master\\.m3u8$' }, durationSeconds: { type: 'integer', minimum: 1, maximum: 86400 }, maxQuality: { type: 'string', enum: ['SD', 'HD', 'UHD'] } }),
  TitleId: object({ titleId: { type: 'string', minLength: 1 } }),
  TitleIds: object({ ids: { ...array(str), maxItems: 100 } }),
  Rights: object({ titleId: str, assetPath: str, durationSeconds: integer, allowedUntil: date, maxQuality: str, version: integer }),
  WatchlistEntry: object({ titleId: str, profileId: str, accountId: str, addedAt: date }),
  Plan: object({ id: str, amount: integer, currency: str, maxStreams: integer, maxQuality: str }),
  SubscribeInput: object({ planId: { type: 'string', enum: ['basic', 'premium'] }, simulateTimeout: { type: 'boolean', default: false }, decline: { type: 'boolean', default: false } }, ['planId']),
  BillingRecord: object({ id: str, accountId: str, kind: str, planId: str, status: str, version: integer, paymentId: str, subscriptionId: str, amount: integer, currency: str, maxStreams: integer, maxQuality: str, validUntil: date, createdAt: date, simulateTimeout: { type: 'boolean' }, decline: { type: 'boolean' } }),
  Entitlement: object({ active: { type: 'boolean' }, maxStreams: integer, maxQuality: str, validUntil: date, version: integer }),
  SetupSession: object({ id: str, accountId: str, sandbox: { type: 'boolean' }, message: str }),
  Session: object({ sessionId: str, accountId: str, profileId: str, titleId: str, assetPath: str, durationSeconds: integer, positionSeconds: integer, sequence: integer, status: str, expiresAt: integer, allowedUntil: date, endedAt: str }, ['sessionId', 'titleId', 'status'], true),
  Playback: object({ session: ref('Session'), url: { type: 'string', format: 'uri' } }),
  Heartbeat: object({ sequence: { type: 'integer', minimum: 1 }, positionSeconds: { type: 'integer', minimum: 0 } }),
  Ended: object({ sessionId: str, status: { type: 'string', enum: ['ENDED'] } }),
  HistoryEntry: object({ titleId: str, sessionId: str, positionSeconds: integer, durationSeconds: integer, endedAt: date }),
  History: object({ items: array(ref('HistoryEntry')), month: str }),
  Recommendations: object({ items: array(ref('Title')), source: { type: 'string', enum: ['graph', 'cache', 'empty'] }, degraded: { type: 'boolean' }, generatedAt: date }),
  JobInput: object({ region: { type: 'string', default: 'IN' } }, []),
  Job: object({ id: str, status: str, result: str }, ['id', 'status']),
  Deletion: object({ status: str }),
};
schemas.Title = object({ ...schemas.TitleInput.properties, id: str, version: integer, published: { type: 'boolean' }, deleted: { type: 'boolean' } });
const exampleTitle = { name: 'Local demo', genres: ['drama'], maturity: 12, regions: ['IN'], licenseStart: '2020-01-01T00:00:00Z', licenseEnd: '2099-01-01T00:00:00Z', assetPath: 'demo/master.m3u8', durationSeconds: 10, maxQuality: 'HD' };
const param = (name, location, schema, required = false, description = '') => ({ name, in: location, required, schema, description });
const pagination = [param('limit', 'query', { type: 'integer', default: 20, minimum: 1, maximum: 100 }), param('offset', 'query', { type: 'integer', default: 0, minimum: 0, maximum: 10000 })];
const idem = param('Idempotency-Key', 'header', { type: 'string', minLength: 1, maxLength: 128 }, true, 'Keep the same key and body when retrying. Use a new key for a new operation.');
const etag = param('If-Match', 'header', { type: 'string', example: '"1"' }, true, 'Quoted current version from the title response/ETag. Missing: 428; stale: 412.');
export const operations = [];
function add(service, method, path, summary, auth, output, options = {}) {
  operations.push({ service, method, path, summary, auth, output, ...options });
}
for (const s of services) {
  add(s.name, 'get', '/health/live', 'Process liveness', 'none', 'Health', { internal: true, description: 'Private service address. Liveness does not prove dependencies are ready.' });
  add(s.name, 'get', '/health/ready', 'Dependency readiness', 'none', 'Health', { internal: true, description: 'Checks the dependency implemented by this service; not an end-to-end guarantee.' });
}
for (const service of ['reco-engine', 'reco-api']) add(service, 'get', '/openapi.json', 'FastAPI generated framework schema', 'none', { type: 'object', additionalProperties: true }, { internal: true, description: 'Default FastAPI schema endpoint. Interactive framework docs are disabled. API documentation is member-1-platform/API_REFERENCE.md.' });
for (const service of ['catalog-write', 'catalog-read']) {
  for (const path of ['/actuator/health', '/actuator/health/liveness', '/actuator/health/readiness']) add(service, 'get', path, 'Spring Actuator health probe', 'none', { type: 'object', additionalProperties: true }, { internal: true });
  add(service, 'get', '/actuator/info', 'Spring Actuator application information', 'account', { type: 'object', additionalProperties: true }, { internal: true });
  add(service, 'get', '/actuator', 'Spring Actuator discovery links', 'account', { type: 'object', additionalProperties: true }, { internal: true });
}
add('profile', 'get', '/accounts/me', 'Get or bootstrap current account', 'account', 'Account');
add('profile', 'delete', '/accounts/me', 'Disable account and request deletion', 'account', 'Deletion', { status: 202, description: 'Disables the local account and deletes all its profiles. Privacy acknowledgments remain unfinished.' });
add('profile', 'get', '/profiles', 'List account profiles', 'account', items('Profile'));
add('profile', 'post', '/profiles', 'Create profile (maximum five)', 'account', 'Profile', { status: 201, input: 'ProfileInput', example: { name: 'Demo viewer', maturity: 18 } });
add('profile', 'get', '/profiles/{id}', 'Get owned profile', 'account', 'Profile');
add('profile', 'patch', '/profiles/{id}', 'Update complete profile name and maturity', 'account', 'Profile', { input: 'ProfileInput', example: { name: 'Demo viewer', maturity: 12 }, description: 'Both fields are required despite PATCH. Raising maturity requires amr containing mfa. Reselect the profile after changing policy.' });
add('profile', 'delete', '/profiles/{id}', 'Delete owned profile', 'account', null, { status: 204 });
add('profile', 'post', '/profiles/{id}/select', 'Select profile and issue a five-minute PCT', 'account', 'ProfileToken', { description: 'Local adult selection uses the account credential. Region is deployment policy IN.' });
add('profile', 'get', '/internal/context', 'Validate current profile policy', 'workload-profile', 'Context', { internal: true });
add('profile', 'get', '/internal/account', 'Validate account state', 'workload-account', object({ accountId: str }), { internal: true });
add('watchlist', 'get', '/watchlist', 'List profile watchlist', 'profile', items('WatchlistEntry'), { parameters: pagination });
add('watchlist', 'put', '/watchlist/titles/{id}', 'Add eligible title idempotently', 'profile', null, { status: 204 });
add('watchlist', 'delete', '/watchlist/titles/{id}', 'Remove title idempotently', 'profile', null, { status: 204 });
add('watchlist', 'head', '/watchlist/titles/{id}', 'Check watchlist membership (200 or 404)', 'profile', null);
for (const kind of ['home', 'similar', 'trending']) add('reco-api', 'get', `/recommendations/${kind}`, `${kind} recommendations`, 'profile', 'Recommendations', { parameters: [param('limit', 'query', { type: 'integer', default: 20, minimum: 1, maximum: 100 }), ...(kind === 'similar' ? [param('titleId', 'query', str, true)] : [])], description: 'Eligibility is rechecked. Inspect degraded and source; an empty degraded result is not proof of healthy ranking.' });
add('reco-engine', 'post', '/internal/jobs', 'Recompute and persist trending snapshot', 'workload', 'Job', { status: 201, internal: true, input: 'JobInput', example: { region: 'IN' } });
add('reco-engine', 'get', '/internal/jobs/{job_id}', 'Get retained recompute job', 'workload', 'Job', { internal: true });
add('catalog-write', 'post', '/admin/catalog/titles', 'Create unpublished title', 'admin', 'Title', { status: 201, input: 'TitleInput', example: exampleTitle, description: 'Requires catalog-admin realm role. License bounds use [start,end). Returns ETag.' });
add('catalog-write', 'get', '/admin/catalog/titles/{id}', 'Get authoritative title and ETag', 'admin', 'Title');
add('catalog-write', 'put', '/admin/catalog/titles/{id}', 'Replace all editable title fields', 'admin', 'Title', { input: 'TitleInput', example: exampleTitle, parameters: [etag] });
for (const action of ['publish', 'unpublish']) add('catalog-write', 'post', `/admin/catalog/titles/{id}/${action}`, `${action} title`, 'admin', 'Title', { parameters: [etag], description: 'Read-side propagation is asynchronous through Kafka.' });
add('catalog-write', 'delete', '/admin/catalog/titles/{id}', 'Archive title', 'admin', 'Title', { parameters: [etag] });
add('catalog-write', 'post', '/internal/authorize', 'Authoritative playback eligibility', 'workload-profile', 'Rights', { internal: true, input: 'TitleId', example: { titleId: 'replace-title-id' } });
for (const path of ['/catalog/titles', '/catalog/search']) add('catalog-read', 'get', path, 'Browse eligible titles with name search', 'profile', items('Title'), { parameters: [...pagination, param('q', 'query', { type: 'string', maxLength: 200, default: '' })] });
add('catalog-read', 'get', '/catalog/titles/{id}', 'Get eligible title (otherwise 404)', 'profile', 'Title');
add('catalog-read', 'post', '/internal/titles', 'Batch eligible title metadata (maximum 100)', 'workload-profile', items('Title'), { internal: true, input: 'TitleIds', example: { ids: ['replace-title-id'] } });
add('subscription', 'get', '/plans', 'List public sandbox plans (integer minor units)', 'none', items('Plan'));
add('subscription', 'post', '/subscriptions', 'Start asynchronous sandbox subscription', 'account', 'BillingRecord', { status: 202, input: 'SubscribeInput', example: { planId: 'premium', simulateTimeout: false, decline: false }, parameters: [idem], description: 'No real money. Poll /subscriptions/current until ACTIVE or inspect /subscriptions for FAILED. One live subscription per account. Accepted Location is not an implemented detail route.' });
add('subscription', 'get', '/subscriptions', 'List account subscriptions', 'account', items('BillingRecord'));
add('subscription', 'get', '/subscriptions/current', 'Get active/pending subscription or null', 'account', { anyOf: [ref('BillingRecord'), { type: 'null' }] });
add('subscription', 'post', '/subscriptions/{id}/cancel', 'Cancel owned sandbox subscription immediately', 'account', 'BillingRecord', { description: 'No ordinary prorated refund in this demo. Late successful pending charges trigger compensation.' });
add('subscription', 'get', '/internal/entitlement', 'Get current account entitlement', 'workload-account', 'Entitlement', { internal: true });
add('payment', 'get', '/payments', 'List account sandbox payment records', 'account', items('BillingRecord'));
add('payment', 'post', '/payments/setup-sessions', 'Create local setup placeholder (no cards)', 'account', 'SetupSession');
add('invoice', 'get', '/invoices', 'List account invoices and credits', 'account', items('BillingRecord'));
add('invoice', 'get', '/invoices/{id}', 'Get owned invoice', 'account', 'BillingRecord', { description: 'URL-encode identifiers, including colons.' });
add('invoice', 'get', '/invoices/{id}/pdf', 'Download sandbox invoice PDF', 'account', null, { media: 'application/pdf', description: 'Sandbox document only; immutable financial records remain after cancellation.' });
add('playback-session', 'post', '/sessions', 'Admit playback and issue signed HLS URL', 'profile', 'Playback', { status: 201, input: 'TitleId', example: { titleId: 'replace-title-id' }, parameters: [idem], description: 'Requires ACTIVE subscription and eligible published title. Account stream limit enforced. Session expires after 90 seconds without heartbeat.' });
add('playback-session', 'get', '/sessions', 'List active sessions for selected profile', 'profile', items('Session'));
add('playback-session', 'post', '/sessions/{id}/heartbeat', 'Checkpoint playback and renew session', 'profile', 'Session', { input: 'Heartbeat', example: { sequence: 1, positionSeconds: 4 }, description: 'Sequence must strictly increase. Position must not exceed title duration. Stale sequence: 409.' });
add('playback-session', 'post', '/sessions/{id}/stop', 'Stop playback and publish final history event', 'profile', 'Ended', { description: 'History consumption is asynchronous. Repeat stop is supported.' });
add('playback-session', 'post', '/sessions/{id}/refresh', 'Revalidate rights and refresh media URL', 'profile', 'Playback');
add('playback-session', 'get', '/media/{asset}/{file}', 'Read signed local HLS manifest or segment', 'signed', null, { media: 'application/octet-stream', parameters: [param('expires', 'query', integer, true), param('signature', 'query', str, true)], description: 'Use the exact URL returned by playback. Signature covers path and expiry. Simple relative HLS files only; manifest content type is application/vnd.apple.mpegurl.' });
add('watch-history', 'get', '/history', 'List profile history for a UTC month', 'profile', 'History', { parameters: [param('month', 'query', { type: 'string', pattern: '^\\d{4}-\\d{2}$' }, false, 'YYYY-MM; defaults to current UTC month.'), pagination[0]] });
add('watch-history', 'get', '/history/continue', 'List unfinished progress (maximum 100)', 'profile', items('HistoryEntry'));
add('watch-history', 'delete', '/history', 'Clear selected profile history', 'profile', null, { status: 204 });
add('watch-history', 'delete', '/history/titles/{id}', 'Hide title history and remove progress', 'profile', null, { status: 204 });

const authSecurity = {
  none: [], signed: [], account: [{ AccessToken: [] }], admin: [{ AccessToken: [] }],
  profile: [{ AccessToken: [], ProfileToken: [] }], workload: [{ ServiceKey: [] }],
  'workload-account': [{ AccessToken: [], ServiceKey: [] }], 'workload-profile': [{ AccessToken: [], ProfileToken: [], ServiceKey: [] }],
};
export function openapi(service = 'public') {
  if (service !== 'public' && !services.some(s => s.name === service)) return null;
  const paths = {};
  for (const op of operations.filter(o => service === 'public' ? !o.internal : o.service === service)) {
    const parameters = [...op.path.matchAll(/\{([^}]+)\}/g)].map(m => param(m[1], 'path', str, true));
    const content = op.media ? { [op.media]: { schema: { type: 'string', format: 'binary' } } } : op.output ? { 'application/json': { schema: typeof op.output === 'string' ? ref(op.output) : op.output } } : undefined;
    const success = { description: op.status === 204 ? 'No content' : 'Success', ...(content ? { content } : {}) };
    if (op.service === 'catalog-write' && !op.internal) success.headers = { ETag: { description: 'Quoted title version', schema: str } };
    const operation = {
      operationId: `${op.service}_${op.method}_${op.path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      tags: [op.service], summary: op.summary, description: op.description || op.summary,
      'x-service': op.service, 'x-internal': Boolean(op.internal), 'x-auth': op.auth,
      security: authSecurity[op.auth], parameters: [...parameters, ...(op.parameters || [])],
      responses: { [op.status || 200]: success, default: { description: 'Validation, authorization, conflict or dependency error. Error envelopes vary across frameworks.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } } },
    };
    if (op.input) operation.requestBody = { required: true, content: { 'application/json': { schema: ref(op.input), example: op.example } } };
    if (op.internal) operation.servers = [{ url: `http://${op.service}:${services.find(s => s.name === op.service).port}`, description: 'Private Compose network; not published through Kong' }];
    (paths[op.path] ||= {})[op.method] = operation;
  }
  return {
    openapi: '3.1.0', info: { title: `Streaming local API — ${service}`, version: '1.0.0', description: 'Implemented local HTTP endpoints. Sandbox billing. Internal operations require the private Compose network. These contracts do not establish production qualification.' },
    servers: [{ url: 'http://localhost:8080', description: 'Public Kong gateway' }], paths,
    components: { securitySchemes: { AccessToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, ProfileToken: { type: 'apiKey', in: 'header', name: 'X-Profile-Token' }, ServiceKey: { type: 'apiKey', in: 'header', name: 'X-Service-Key', description: 'Local development workload key; never send through the browser UI.' } }, schemas },
  };
}
