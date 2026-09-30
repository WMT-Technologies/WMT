import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uid = '11111111-1111-4111-8111-111111111111';
const otherUid = '22222222-2222-4222-8222-222222222222';
const contextA = { userId: uid, workspaceId: 'company-a', role: 'FINANCE' };
const contextB = { ...contextA, workspaceId: 'company-b' };
function approvedUser(role = 'FINANCE') {
  return { id: uid, app_metadata: { wmt: { approval_status: 'approved', workspaces: {
    'company-a': { status: 'active', role },
  } } } };
}
function request(headers = {}, body = {}) {
  return { method: 'POST', headers: { authorization: 'Bearer test-session', 'x-workspace-id': 'company-a', ...headers }, body };
}
function response() {
  return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
}

async function harness() {
  const state = { user: approvedUser(), authStatus: 200, authFailure: false, authCalls: 0,
    rows: [], queries: [], uploads: [], signed: [], removed: [], backend: [], backendStatus: 200, aiCalls: 0,
    aiResult: { type: 'invoice', confidence: 0.95, data: { amount: 100 }, action: 'create_invoice' } };
  const db = {
    from(table) {
      const q = { table, filters: [], operation: 'select' };
      state.queries.push(q);
      const matches = () => state.rows.filter(r => q.filters.every(([key, value]) => r[key] === value));
      const execute = () => {
        if (q.operation === 'insert') {
          const rows = q.insert.map(r => ({ id: randomUUID(), ...r }));
          state.rows.push(...rows); return { data: rows[0], error: null };
        }
        const rows = matches();
        if (q.operation === 'update') rows.forEach(r => Object.assign(r, q.update));
        return { data: rows[0] ?? null, error: null };
      };
      const builder = {
        select() { return this; }, eq(key, value) { q.filters.push([key, value]); return this; },
        insert(rows) { q.operation = 'insert'; q.insert = rows; return this; },
        update(value) { q.operation = 'update'; q.update = value; return this; },
        single: async () => execute(), maybeSingle: async () => execute(),
        then: (ok, fail) => Promise.resolve(execute()).then(ok, fail),
      };
      return builder;
    },
    storage: { from(bucket) { return {
      async upload(path, file) { state.uploads.push({ bucket, path, file }); return { data: { path }, error: null }; },
      async createSignedUrl(path, ttl) { state.signed.push({ path, ttl }); return { data: { signedUrl: 'https://storage.example/signed-preview' }, error: null }; },
      async remove(paths) { state.removed.push(...paths); return { error: null }; },
    }; } },
  };
  const sandbox = createContext({
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key', SUPABASE_SERVICE_ROLE_KEY: 'test-server-key', NEXT_PUBLIC_WMT_API_URL: 'https://wmt.example', WMT_API_KEY: 'test-wmt-key' } },
    AbortSignal, Buffer, Response, setTimeout,
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, options) => {
      if (url === 'https://auth.example/auth/v1/user') {
        state.authCalls++;
        assert.equal(options.headers.Authorization, 'Bearer test-session');
        assert.equal(options.cache, 'no-store');
        if (state.authFailure) throw new Error('offline');
        return new Response(JSON.stringify(state.user), { status: state.authStatus });
      }
      assert.equal(url, 'https://wmt.example/ai-analysis/save');
      state.backend.push(JSON.parse(options.body));
      return new Response(JSON.stringify(state.backendStatus === 200 ? { id: 'saved-record' } : { error: 'backend failed' }), { status: state.backendStatus, statusText: state.backendStatus === 200 ? 'OK' : 'Bad Gateway' });
    },
  });
  const cache = new Map();
  function synthetic(id, exports) {
    if (!cache.has(id)) cache.set(id, new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context: sandbox, identifier: id }));
    return cache.get(id);
  }
  async function load(path) {
    if (cache.has(path)) return cache.get(path);
    const source = await readFile(path, 'utf8');
    const mod = new SourceTextModule(stripTypeScriptTypes(source), { context: sandbox, identifier: path });
    cache.set(path, mod);
    await mod.link(async (specifier, parent) => {
      if (specifier === '@supabase/supabase-js') return synthetic('supabase', { createClient: () => db });
      if (specifier === 'node:crypto') return synthetic('crypto', { randomUUID });
      if (specifier.endsWith('/openai-vision')) return synthetic('ai', { analyzeWithRetry: async () => { state.aiCalls++; return state.aiResult; }, isSupportedAnalysisMimeType: (mime) => ['image/png','image/jpeg','image/gif','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv','application/csv','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mime) });
      return load(resolve(dirname(parent.identifier), specifier + '.ts'));
    });
    return mod;
  }
  async function exports(path) { const mod = await load(resolve(root, path)); if (mod.status !== 'evaluated') await mod.evaluate(); return mod.namespace; }
  return { state, exports };
}

test('both routes reject spoofed x-user-id without a session before side effects', async () => {
  const h = await harness();
  for (const name of ['analyze', 'save-analysis']) {
    const route = await h.exports(`api/${name}.ts`); const res = response();
    await route.default(request({ authorization: undefined, 'x-user-id': otherUid }), res);
    assert.equal(res.statusCode, 401);
  }
  assert.equal(h.state.authCalls, 0); assert.equal(h.state.queries.length, 0); assert.equal(h.state.uploads.length, 0); assert.equal(h.state.aiCalls, 0);
});

test('identity is supplied by verified Auth response, ignoring spoofed headers', async () => {
  const h = await harness(); const auth = await h.exports('lib/auth.ts');
  const ctx = await auth.requireAuth(request({ 'x-user-id': otherUid }));
  assert.equal(ctx.userId, uid); assert.equal(ctx.workspaceId, 'company-a'); assert.equal(ctx.role, 'FINANCE');
});

for (const [name, setup, status] of [
  ['invalid/expired token', s => { s.authStatus = 401; }, 401],
  ['Auth outage', s => { s.authFailure = true; }, 503],
  ['unapproved registration', s => { s.user.app_metadata.wmt.approval_status = 'pending'; }, 403],
  ['suspended membership', s => { s.user.app_metadata.wmt.workspaces['company-a'].status = 'suspended'; }, 403],
  ['missing membership', s => { s.user.app_metadata.wmt.workspaces = {}; }, 403],
  ['unknown role', s => { s.user.app_metadata.wmt.workspaces['company-a'].role = 'SUPER_ADMIN'; }, 403],
  ['user-editable metadata cannot grant access', s => { s.user.user_metadata = s.user.app_metadata; s.user.app_metadata = {}; }, 403],
  ['anonymous account', s => { s.user.is_anonymous = true; }, 401],
]) test(name, async () => {
  const h = await harness(); setup(h.state); const auth = await h.exports('lib/auth.ts');
  await assert.rejects(auth.requireAuth(request()), e => e.status === status);
  assert.equal(h.state.uploads.length + h.state.queries.length, 0);
});

test('ADMIN is not a cross-company bypass', async () => {
  const h = await harness(); h.state.user = approvedUser('ADMIN'); const auth = await h.exports('lib/auth.ts');
  await assert.rejects(auth.requireAuth(request({ 'x-workspace-id': 'company-b' })), e => e.status === 403);
});

test('revocation is checked on next request with the same bearer token', async () => {
  const h = await harness(); const auth = await h.exports('lib/auth.ts');
  await auth.requireAuth(request()); h.state.user.app_metadata.wmt.approval_status = 'revoked';
  await assert.rejects(auth.requireAuth(request()), e => e.status === 403); assert.equal(h.state.authCalls, 2);
});

test('invalid/duplicate workspace and authorization headers are rejected', async () => {
  const h = await harness(); const auth = await h.exports('lib/auth.ts');
  for (const workspace of ['../company-b', ['company-a', 'company-b'], '', undefined]) {
    await assert.rejects(auth.requireAuth(request({ 'x-workspace-id': workspace })), e => e.status === 400);
  }
  await assert.rejects(auth.requireAuth(request({ authorization: ['Bearer test-session'] })), e => e.status === 401);
});

test('repository reads and updates require BOTH company and user; legacy rows stay hidden', async () => {
  const h = await harness(); const repo = await h.exports('lib/supabase-client.ts');
  h.state.rows.push({ id: 'target', user_id: uid, workspace_id: 'company-b', status: 'pending' },
    { id: 'other-user', user_id: otherUid, workspace_id: 'company-a', status: 'pending' },
    { id: 'legacy', user_id: uid, workspace_id: null, status: 'pending' });
  for (const id of ['target', 'other-user', 'legacy']) {
    assert.equal(await repo.getAnalysisResult(id, contextA), null);
    await repo.updateAnalysisStatus(id, 'saved', contextA);
  }
  assert.ok(h.state.rows.every(r => r.status === 'pending'));
  assert.equal((await repo.getAnalysisResult('target', contextB)).id, 'target');
});

test('save route refuses cross-company and other-user analyses without calling WMT', async () => {
  const h = await harness(); const route = await h.exports('api/save-analysis.ts');
  h.state.rows.push({ id: 'foreign', user_id: uid, workspace_id: 'company-b' }, { id: 'foreign-user', user_id: otherUid, workspace_id: 'company-a' });
  for (const id of ['foreign', 'foreign-user']) {
    const res = response(); await route.default(request({ 'x-user-id': otherUid }, { analysisId: id, approvedData: {} }), res); assert.equal(res.statusCode, 404);
  }
  assert.equal(h.state.backend.length, 0);
});

test('valid save carries verified identity and company to WMT', async () => {
  const h = await harness(); const route = await h.exports('api/save-analysis.ts');
  h.state.rows.push({ id: 'owned', user_id: uid, workspace_id: 'company-a', detected_type: 'invoice', suggested_action: 'create_invoice', status: 'pending' });
  const res = response(); await route.default(request({ 'x-user-id': otherUid }, { analysisId: 'owned', userId: otherUid, workspaceId: 'company-b', approvedData: { amount: 100 } }), res);
  assert.equal(res.statusCode, 200); assert.equal(h.state.backend[0].userId, uid); assert.equal(h.state.backend[0].workspaceId, 'company-a');
});

test('workspace role is enforced on save', async () => {
  const h = await harness(); h.state.user = approvedUser('SALES'); const route = await h.exports('api/save-analysis.ts');
  h.state.rows.push({ id: 'invoice', user_id: uid, workspace_id: 'company-a', detected_type: 'invoice', suggested_action: 'create_invoice' });
  const res = response(); await route.default(request({}, { analysisId: 'invoice', approvedData: {} }), res);
  assert.equal(res.statusCode, 403); assert.equal(h.state.backend.length, 0);
});

test('upload stores verified company/user and never persists signed preview credentials', async () => {
  const h = await harness(); const route = await h.exports('api/analyze.ts');
  const req = request({ 'x-user-id': otherUid }); req.files = { file: { name: '../../another-company/private.pdf', size: 10, mimetype: 'image/png', data: Buffer.from('image') } };
  const res = response(); await route.default(req, res);
  assert.equal(res.statusCode, 200); assert.equal(h.state.rows[0].workspace_id, 'company-a'); assert.equal(h.state.rows[0].user_id, uid);
  assert.equal(h.state.rows[0].file_url, ''); assert.match(h.state.uploads[0].path, new RegExp(`^company-a/${uid}/[0-9a-f-]+$`));
  assert.equal(h.state.signed[0].ttl, 60); assert.equal(res.body.analysisMetadata.workspaceId, 'company-a');
});

test('delete and insert reject paths from a different workspace/user or traversal', async () => {
  const h = await harness(); const repo = await h.exports('lib/supabase-client.ts');
  for (const path of [`company-b/${uid}/file`, `company-a/${otherUid}/file`, `company-a/${uid}/../file`]) {
    await assert.rejects(repo.deleteFile(path, contextA), e => e.status === 403);
    await assert.rejects(repo.storeAnalysisResult(contextA, { fileStoragePath: path }), e => e.status === 403);
  }
  assert.equal(h.state.removed.length, 0); assert.equal(h.state.rows.length, 0);
});

test('unauthorized document is not persisted or returned and its upload is removed', async () => {
  const h = await harness(); h.state.user = approvedUser('SALES'); const route = await h.exports('api/analyze.ts');
  const req = request(); req.files = { file: { size: 10, mimetype: 'image/png', data: Buffer.from('image') } };
  const res = response(); await route.default(req, res);
  assert.equal(res.statusCode, 403); assert.equal(h.state.rows.length, 0); assert.equal(h.state.signed.length, 0);
  assert.equal(h.state.removed[0], h.state.uploads[0].path);
});

test('preview URL generation rejects another company before accessing Storage', async () => {
  const h = await harness(); const repo = await h.exports('lib/supabase-client.ts');
  await assert.rejects(repo.getFilePreviewUrl(`company-b/${uid}/file`, contextA), e => e.status === 403);
  assert.equal(h.state.signed.length, 0);
});


test('image PDF and Excel complete analyze then save integration flow', async () => {
  for (const [name, mimetype] of [
    ['receipt.png', 'image/png'],
    ['invoice.pdf', 'application/pdf'],
    ['fleet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ]) {
    const h = await harness();
    const analyzeRoute = await h.exports('api/analyze.ts');
    const saveRoute = await h.exports('api/save-analysis.ts');

    const req = request();
    req.files = { file: { name, size: 128, mimetype, data: Buffer.from(`fixture-${name}`) } };
    const analyzeRes = response();
    await analyzeRoute.default(req, analyzeRes);

    assert.equal(analyzeRes.statusCode, 200, `${name} analyze failed`);
    assert.equal(analyzeRes.body.analysisMetadata.fileMimeType, mimetype);
    assert.equal(h.state.aiCalls, 1);
    assert.equal(h.state.uploads.length, 1);
    assert.ok(Buffer.isBuffer(h.state.uploads[0].file));

    const saveRes = response();
    await saveRoute.default(request({}, {
      analysisId: analyzeRes.body.id,
      approvedData: analyzeRes.body.extractedData,
    }), saveRes);

    assert.equal(saveRes.statusCode, 200, `${name} save failed`);
    assert.equal(saveRes.body.success, true);
    assert.equal(h.state.backend.length, 1);
    assert.equal(h.state.backend[0].workspaceId, 'company-a');
    assert.equal(h.state.backend[0].userId, uid);
  }
});


test('failed WMT save returns an error and leaves analysis pending', async () => {
  const h = await harness();
  h.state.backendStatus = 502;
  const route = await h.exports('api/save-analysis.ts');
  h.state.rows.push({
    id: 'pending-save',
    user_id: uid,
    workspace_id: 'company-a',
    detected_type: 'invoice',
    suggested_action: 'create_invoice',
    status: 'pending',
  });

  const res = response();
  await route.default(request({}, {
    analysisId: 'pending-save',
    approvedData: { amount: 100 },
  }), res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, undefined);
  assert.equal(h.state.rows[0].status, 'pending');
  assert.equal(h.state.backend.length, 1);
});
