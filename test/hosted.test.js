import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { initializeHost, manageAccount, readAccount } from '../src/hosted-accounts.js';
import { createHostedService, recoverHostedLock } from '../src/hosted.js';
import { HostedProjectPool } from '../src/hosted-projects.js';
import { hostedConfig } from '../src/hosted.js';
import { LibraryStore } from '../src/store.js';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function fixture(t) {
  const parent = await mkdtemp(path.join(tmpdir(), 'openbone-hosted-test-'));
  const cleanups = [];
  t.after(async () => { for (const cleanup of cleanups) await cleanup(); await rm(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });
  const root = path.join(parent, 'host');
  await initializeHost(root);
  const alice = await manageAccount(root, 'alice', 'add'), bob = await manageAccount(root, 'bob', 'add');
  return { parent, root, alice, bob, cleanups };
}

test('operator accounts issue independent credentials, preserve work, rotate and disable without storing plaintext', async t => {
  const f = await fixture(t);
  assert.notEqual(f.alice.token, f.bob.token);
  const accountFile = path.join(f.root, 'accounts', 'alice.json');
  assert.ok(!(await readFile(accountFile, 'utf8')).includes(f.alice.token));
  const store = await new LibraryStore(path.join(f.root, 'tenants', 'alice')).init();
  assert.deepEqual((await store.projects()).map(p => p.projectId), ['starter']);
  assert.equal((await store.createBlank('starter')).replay, true);
  await store.bind('same-chat', 'starter', null);
  await assert.rejects(manageAccount(f.root, 'alice', 'add'));
  const rotated = await manageAccount(f.root, 'alice', 'rotate');
  assert.notEqual(rotated.token, f.alice.token);
  assert.equal((await store.binding('same-chat')).projectId, 'starter');
  await manageAccount(f.root, 'alice', 'disable');
  assert.equal((await readAccount(f.root, 'alice')).enabled, false);
  await manageAccount(f.root, 'alice', 'enable');
  assert.equal((await readAccount(f.root, 'alice')).enabled, true);
  await assert.rejects(manageAccount(f.root, '../outside', 'add'));
});

test('hosted HTTP rejects cross-account credentials and observes rotation/revocation immediately', async t => {
  const f = await fixture(t), port = await freePort();
  const jar = path.join(f.parent, 'dummy.jar'); await writeFile(jar, 'not started by this test');
  const config = { dataRoot: f.root, javaJar: jar, port, publicUrl: `http://127.0.0.1:${port}` };
  const service = await createHostedService(config); f.cleanups.push(() => service.close());
  const base = await service.listen();
  const post = (user, token, action = 'binding', body = { sessionId: 'same-chat' }) => fetch(`${base}/u/${user}/v1/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await post('alice', f.bob.token)).status, 401);
  assert.equal((await post('alice', f.alice.token, 'search', {})).status, 200);
  assert.deepEqual((await (await post('alice', f.alice.token)).json()).availableProjects, ['starter']);
  const aliceStore = await new LibraryStore(path.join(f.root, 'tenants', 'alice')).init();
  await aliceStore.bind('same-chat', 'starter', null);
  assert.equal((await (await post('bob', f.bob.token)).json()).binding, null);
  assert.equal((await post('missing', f.alice.token)).status, 401);
  const rotated = await manageAccount(f.root, 'alice', 'rotate');
  assert.equal((await post('alice', f.alice.token)).status, 401);
  assert.equal((await post('alice', rotated.token)).status, 200);
  await manageAccount(f.root, 'alice', 'disable');
  assert.equal((await post('alice', rotated.token)).status, 401);
  assert.equal((await post('bob', f.bob.token)).status, 200);
  await manageAccount(f.root, 'charlie', 'add');
  const catalogFile = path.join(f.root, 'tenants', 'charlie', 'catalog.json');
  await writeFile(catalogFile, 'broken catalog');
  assert.equal((await post('charlie', (await manageAccount(f.root, 'charlie', 'rotate')).token)).status, 500);
  assert.equal((await post('bob', f.bob.token)).status, 200);
  await assert.rejects(createHostedService(config), /EEXIST/);
  await assert.rejects(recoverHostedLock(f.root), /running process/);
});

test('failed project spawn reports a bounded error and occupied assigned ports are not bypassed', async t => {
  const f = await fixture(t), port = await freePort(), mcpPortStart = await freePort();
  const jar = path.join(f.parent, 'dummy.jar'); await writeFile(jar, 'not a Java archive');
  const config = hostedConfig({ dataRoot: f.root, javaJar: jar, port, publicUrl: `http://127.0.0.1:${port}`, mcpPortStart, mcpPortCount: 1, javaCommand: 'openbone-nonexistent-java-command', startupTimeoutMs: 1000 });
  const pool = new HostedProjectPool(config); f.cleanups.push(() => pool.close());
  const store = await new LibraryStore(path.join(f.root, 'tenants', 'alice')).init();
  await assert.rejects(pool.ensure(store, 'starter'), /could not start/);
  const occupied = createServer(); await new Promise(resolve => occupied.listen(mcpPortStart, '127.0.0.1', resolve));
  const other = new HostedProjectPool(config);
  try { await assert.rejects(other.ensure(store, 'starter'), error => error.code === 'EADDRINUSE'); }
  finally { await new Promise(resolve => occupied.close(resolve)); await other.close(); }
});

test('private control provisioning is authenticated, idempotent and enforces trial expiry and account quota', async t => {
  const f = await fixture(t), port = await freePort();
  const jar = path.join(f.parent, 'dummy.jar'); await writeFile(jar, 'not started by this test');
  const control = 'a'.repeat(64), token = '4|' + 'b'.repeat(40), userId = 'trial-' + 'c'.repeat(24);
  const service = await createHostedService({ dataRoot: f.root, javaJar: jar, port, publicUrl: `http://127.0.0.1:${port}`, controlTokenEnv: 'TEST_CONTROL_TOKEN' }, { env: { TEST_CONTROL_TOKEN: control } });
  f.cleanups.push(() => service.close()); const base = await service.listen();
  const send = (url, body, bearer) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
  const input = { userId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60000).toISOString(), maxProjects: 1 };
  assert.equal((await send('/internal/v1/accounts', input, token)).status, 401);
  assert.equal((await send('/internal/v1/accounts', { ...input, rawToken: token }, control)).status, 400);
  assert.equal((await send('/internal/v1/accounts', input, control)).status, 200);
  assert.equal((await (await send('/internal/v1/accounts', input, control)).json()).replay, true);
  assert.equal((await send('/internal/v1/accounts', { ...input, tokenHash: 'd'.repeat(64) }, control)).status, 409);
  const pathPrefix = `/u/${userId}/v1/`;
  const binding = await send(pathPrefix + 'binding', { sessionId: 'trial-chat' }, token);
  assert.equal(binding.status, 200); assert.deepEqual((await binding.json()).availableProjects, ['starter']);
  assert.equal((await send(pathPrefix + 'new', { projectId: 'exceeds-quota' }, token)).status, 429);
  const accountFile = path.join(f.root, 'accounts', userId + '.json');
  const account = JSON.parse(await readFile(accountFile, 'utf8')); account.expiresAt = '2000-01-01T00:00:00Z';
  await writeFile(accountFile, JSON.stringify(account));
  assert.equal((await send(pathPrefix + 'binding', { sessionId: 'trial-chat' }, token)).status, 401);
});

test('real hosted Java projects create, edit, undo, export, save and restore with tenant isolation', { skip: !process.env.OPENBONE_TEST_JAR, timeout: 120000 }, async t => {
  const f = await fixture(t), port = await freePort(), mcpPortStart = await freePort();
  const config = { dataRoot: f.root, javaJar: path.resolve(process.env.OPENBONE_TEST_JAR), port, publicUrl: `http://127.0.0.1:${port}`, mcpPortStart, mcpPortCount: 4, maxProjectsPerUser: 2 };
  let service = await createHostedService(config);
  f.cleanups.push(async () => { if (service) await service.close(); });
  await service.listen();
  const post = async (user, action, body) => {
    const response = await fetch(`${config.publicUrl}/u/${user}/v1/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f[user].token}` }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.ok, true, JSON.stringify(result)); return result;
  };
  const call = (user, name, args = {}) => post(user, 'call', { sessionId: 'same-chat', name, arguments: args });
  const context = async user => (await call(user, 'openbone_get_context')).structuredContent.data;
  for (const user of ['alice', 'bob']) await post(user, 'bind', { sessionId: 'same-chat', projectId: 'starter', expectedProjectId: null });
  const before = await context('alice'), bob = await context('bob');
  const boneId = randomUUID();
  const edit = { expectedRevision: before.revision, requestId: 'create-root', edits: [{ op: 'create_bone', boneId, name: 'hosted-root', parentId: null, setup: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, length: 100 }] };
  const edited = await call('alice', 'openbone_apply_edits', edit);
  assert.notEqual(edited.isError, true, JSON.stringify(edited));
  assert.deepEqual(await call('alice', 'openbone_apply_edits', edit), edited);
  assert.deepEqual(await context('bob'), bob);
  assert.equal((await call('alice', 'openbone_apply_edits', { ...edit, requestId: 'stale' })).isError, true);
  let current = await context('alice');
  const invalid = await call('alice', 'openbone_apply_edits', { expectedRevision: current.revision, requestId: 'bad', edits: [{ op: 'invalid' }] });
  assert.equal(invalid.isError, true); assert.deepEqual(await context('alice'), current);
  assert.notEqual((await call('alice', 'openbone_undo', { expectedRevision: current.revision, requestId: 'undo' })).isError, true);
  current = await context('alice');
  assert.notEqual((await call('alice', 'openbone_redo', { expectedRevision: current.revision, requestId: 'redo' })).isError, true);
  current = await context('alice');
  assert.notEqual((await post('alice', 'save', { sessionId: 'same-chat', expectedRevision: current.revision, requestId: 'save' })).isError, true);
  current = await context('alice');
  const preview = await post('alice', 'preview', { sessionId: 'same-chat', expectedRevision: current.revision, requestId: 'preview' });
  assert.ok(preview.viewerUrl.startsWith(`${config.publicUrl}/u/alice/preview/`));
  assert.equal((await fetch(preview.viewerUrl)).status, 200);
  assert.equal((await fetch(preview.viewerUrl.replace('/u/alice/', '/u/bob/'))).status, 404);
  const identity = await (await fetch(new URL('identity.json', preview.viewerUrl))).json();
  assert.equal(identity.sourceRevision, current.revision);
  const made = await post('alice', 'new', { projectId: 'another' }); assert.equal(made.connected, true);
  assert.equal((await post('alice', 'new', { projectId: 'another' })).replay, true);
  const denied = await fetch(`${config.publicUrl}/u/alice/v1/new`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.alice.token}` }, body: '{"projectId":"third"}' }); assert.equal(denied.status, 429);
  await service.close(); service = null;
  service = await createHostedService(config); await service.listen();
  assert.equal((await post('alice', 'binding', { sessionId: 'same-chat' })).binding.projectId, 'starter');
  const restored = await context('alice');
  const bones = (await call('alice', 'openbone_query_scene', { kind: 'bones', expectedRevision: restored.revision })).structuredContent.data;
  assert.ok(bones.items.some(b => b.id === boneId && b.name === 'hosted-root'));
  assert.notEqual(restored.revision, current.revision);
  const bobRestored = await context('bob');
  const bobBones = (await call('bob', 'openbone_query_scene', { kind: 'bones', expectedRevision: bobRestored.revision })).structuredContent.data;
  assert.equal(bobBones.items.length, 0);
});
