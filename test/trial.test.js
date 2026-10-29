import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { trialConnection } from '../src/trial.js';

async function fixture(t, response) {
  const records = new Map(); let queue = Promise.resolve(); const requests = [];
  const credentials = {
    modifyRecord(key, mutate) {
      const work = queue.then(async () => { const value = await mutate(records.get(key)); if (value !== undefined) records.set(key, value); return records.get(key); });
      queue = work.catch(() => {}); return work;
    },
  };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks)));
    const result = response?.(requests.length) ?? { status: 200 };
    res.setHeader('Content-Type', 'application/json'); res.statusCode = result.status;
    res.end(JSON.stringify(result.body ?? { serviceUrl: `${base}/u/trial-${'a'.repeat(24)}/`, accessToken: '1|' + 'b'.repeat(40), account: { expiresAt: new Date(Date.now() + 60000).toISOString() } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const make = () => trialConnection({ get: () => credentials }, new URL(base), { timeoutMs: 2000, lifetime: new AbortController().signal });
  return { records, requests, make, base };
}

test('automatic trial enrollment is single-flight and durable credentials are reused without another account', async t => {
  const f = await fixture(t), resolve = f.make();
  const results = await Promise.all([resolve(), resolve(), resolve()]);
  assert.equal(f.requests.length, 1);
  assert.ok(results.every(r => r.url.pathname === '/u/trial-' + 'a'.repeat(24) + '/'));
  assert.equal((await f.make()()).url.href, results[0].url.href);
  assert.equal(f.requests.length, 1);
  const stored = [...f.records.values()][0];
  assert.equal(stored.kind, 'grant'); assert.ok(stored.payload.token);
});

test('uncertain enrollment retries the saved installation identity instead of creating another one', async t => {
  const f = await fixture(t, n => ({ status: n === 1 ? 503 : 200 })), resolve = f.make();
  await assert.rejects(resolve(), /Trial enrollment failed/);
  await resolve();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].installation_id, f.requests[1].installation_id);
  assert.ok(f.requests[0].installation_secret === f.requests[1].installation_secret);
});

test('a trial endpoint cannot redirect the saved credential to another origin', async t => {
  const f = await fixture(t, () => ({ status: 200, body: { serviceUrl: 'https://untrusted.invalid/u/trial-' + 'a'.repeat(24) + '/', accessToken: '1|' + 'b'.repeat(40), account: { expiresAt: new Date(Date.now() + 60000).toISOString() } } }));
  await assert.rejects(f.make()(), /invalid trial connection/);
  assert.equal([...f.records.values()][0].payload.token, undefined);
});

test('expired trial grants do not silently enroll a replacement account', async t => {
  const f = await fixture(t); await f.make()();
  [...f.records.values()][0].payload.expiresAt = '2000-01-01T00:00:00Z';
  await assert.rejects(f.make()(), /trial has expired/);
  assert.equal(f.requests.length, 1);
});
