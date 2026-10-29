// Loaded as an acceptance plugin through the supported DSH profile launcher, never as a second application.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

export const name = 'openbone-trial-acceptance';
export const inject = ['tools', 'appReady', 'agents', 'credentials'];
export function apply(ctx, values) {
  let pending;
  const dispose = ctx.appReady.onReady(() => {
    pending = verify(ctx, values).catch(async error => { await writeFile(values.output, JSON.stringify({ failed: true, message: error.message }), { mode: 0o600 }); });
  });
  ctx.effect(() => async () => { dispose(); await pending; });
}

async function verify(ctx, values) {
  const config = JSON.parse(await readFile(values.config, 'utf8'));
  const handle = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: process.cwd() } });
  ctx.effect(() => () => handle.dispose());
  const outputs = [];
  const execute = async (name, args = {}) => {
    const batch = await ctx.tools.execute({ agent: handle.agent, signal: new AbortController().signal, calls: [{ type: 'tool-call', id: randomUUID(), name, arguments: JSON.stringify(args) }] });
    return batch.results[0].result;
  };
  const run = async (name, args = {}) => {
    const result = await execute(name, args); assert.equal(result.isError, false, 'DSH tool failed: ' + name);
    const data = result.value.structuredContent.data; outputs.push(data); return data;
  };
  const call = (name, args = {}) => run('openbone_project_call', { name, arguments: args });
  await run('openbone_knowledge_search', { query: '' });
  const binding = await run('openbone_project_binding');
  const accountId = binding.account?.id;
  assert.match(accountId, /^trial-[a-f0-9]{24}$/);
  assert.equal(binding.account.plan, 'trial'); assert.equal(binding.account.limits.projects, 2);
  await run('openbone_project_bind', { projectId: 'starter', expectedProjectId: binding.binding?.projectId ?? null });
  const tools = await run('openbone_project_tools'); assert.ok(tools.tools.some(t => t.name === 'openbone_apply_edits'));
  let context = await call('openbone_get_context');
  const bones = await call('openbone_query_scene', { kind: 'bones', expectedRevision: context.revision });
  const animations = await call('openbone_query_scene', { kind: 'animations', expectedRevision: context.revision });
  let boneId, animationId = animations.items[0].id;
  if (values.resumeReceipt) {
    const previous = JSON.parse(await readFile(values.resumeReceipt, 'utf8'));
    assert.equal(accountId, previous.accountId);
    assert.ok(bones.items.some(b => b.id === previous.boneId)); boneId = previous.boneId;
  } else {
    boneId = randomUUID(); const slotId = randomUUID(), attachmentId = randomUUID();
    const crc32 = bytes => { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; };
    const chunk = (name, bytes) => { const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([type, bytes]))); return Buffer.concat([size, type, bytes, crc]); };
    const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
    const pngPath = path.join(config.dataRoot, 'tenants', accountId, 'workspaces', 'starter', 'trial-acceptance.png');
    await writeFile(pngPath, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 65, 170, 230, 255]))), chunk('IEND', Buffer.alloc(0))]));
    const setup = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
    await call('openbone_apply_edits', { expectedRevision: context.revision, requestId: randomUUID(), edits: [
      { op: 'create_bone', boneId, name: `trial-${boneId.slice(0, 8)}`, parentId: bones.items[0]?.id ?? null, setup, length: 100 },
      { op: 'create_slot', slotId, name: `slot-${slotId.slice(0, 8)}`, boneId },
      { op: 'create_region', attachmentId, slotId, name: `region-${attachmentId.slice(0, 8)}`, pngPath, width: 120, height: 40, makeActive: true },
      ...[0, 0.5, 1].map((time, i) => ({ op: 'put_keyframe', animationId, boneId, channel: 'ROTATE', time, values: [i === 1 ? 35 : 0] })),
    ] });
    context = await call('openbone_get_context');
    await run('openbone_project_save', { expectedRevision: context.revision, requestId: randomUUID() });
    const second = await run('openbone_project_new', { projectId: 'second-project' }); assert.equal(second.connected, true);
    const rejected = await execute('openbone_project_new', { projectId: 'exceeds-trial-quota' }); assert.equal(rejected.isError, true);
    assert.equal(/quota/i.test(JSON.stringify(rejected.content)), true);
  }
  context = await call('openbone_get_context');
  const preview = await run('openbone_project_preview', { expectedRevision: context.revision, requestId: randomUUID() });
  assert.ok(preview.viewerUrl.startsWith(new URL(values.serviceUrl).origin + '/u/' + accountId + '/preview/'));
  assert.equal((await fetch(preview.viewerUrl)).status, 200);
  const key = 'openbone-studio/trial-' + createHash('sha256').update(new URL(values.serviceUrl).href).digest('hex').slice(0, 32);
  const stored = await ctx.credentials.readRecord(key);
  assert.equal(stored?.kind, 'grant');
  const modelData = JSON.stringify(outputs);
  assert.equal(modelData.includes(stored.payload.token), false);
  assert.equal(modelData.includes(stored.payload.installationSecret), false);
  const receipt = { checkedAt: new Date().toISOString(), accountId, sessionId: handle.agent.id, boneId, animationId, automaticTrial: true,
    persistedCredentials: true, existingAccountReused: !!values.resumeReceipt, realDshProfile: true, realJavaEditing: true,
    modelOutputContainsCredential: false, account: binding.account, preview, browserRenderingVerified: false };
  await writeFile(values.output, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
}
