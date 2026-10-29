// Operator acceptance against an isolated test account, using the installed DSH plugin and real Java MCP.
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { json, encode } from '../src/files.js';

export const name = 'openbone-hosted-acceptance';
export const inject = ['tools', 'appReady', 'agents'];
export function apply(ctx, values) {
  let pending;
  const dispose = ctx.appReady.onReady(() => {
    pending = verify(ctx, values).catch(async error => { await writeFile(values.output, encode({ failed: true, message: error.message }), { mode: 0o600 }); });
  });
  ctx.effect(() => async () => { dispose(); await pending; });
}

async function verify(ctx, values) {
for (const name of ['config', 'credentials', 'output', 'pluginRoot']) assert.ok(values[name], `Missing ${name}`);
const connection = await json(values.credentials), config = await json(values.config);
const serviceUrl = new URL(connection.OPENBONE_LIBRARY_URL), userId = serviceUrl.pathname.split('/')[2];
assert.match(userId, /^acceptance-[a-z0-9-]+$/, 'Only isolated acceptance accounts may be edited by this script.');
{
  const handle = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: process.cwd() } });
  const agent = handle.agent;
  ctx.effect(() => () => handle.dispose());
  const run = async (name, args = {}) => {
    const batch = await ctx.tools.execute({ agent, signal: new AbortController().signal, calls: [{ type: 'tool-call', id: randomUUID(), name, arguments: JSON.stringify(args) }] });
    const result = batch.results[0].result;
    assert.equal(result.isError, false, JSON.stringify(result));
    return result.value.structuredContent.data;
  };
  const call = async (name, args = {}) => run('openbone_project_call', { name, arguments: args });
  const binding = await run('openbone_project_binding');
  const projectId = 'acceptance-smoke';
  await run('openbone_project_new', { projectId });
  await run('openbone_project_bind', { projectId, expectedProjectId: binding.binding?.projectId ?? null });
  const schemas = await run('openbone_project_tools');
  assert.ok(schemas.tools.some(t => t.name === 'openbone_apply_edits'));
  let context = await call('openbone_get_context');
  const animations = await call('openbone_query_scene', { kind: 'animations', expectedRevision: context.revision });
  const bones = await call('openbone_query_scene', { kind: 'bones', expectedRevision: context.revision });
  const animationId = animations.items[0].id, boneId = randomUUID(), slotId = randomUUID(), attachmentId = randomUUID();
  // A tiny solid rectangle is a test fixture, not private library content or simulated preview output.
  const crc32 = bytes => { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; };
  const chunk = (name, bytes) => { const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([type, bytes]))); return Buffer.concat([size, type, bytes, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const pngPath = path.join(config.dataRoot, 'tenants', userId, 'workspaces', projectId, 'acceptance.png');
  await writeFile(pngPath, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 65, 170, 230, 255]))), chunk('IEND', Buffer.alloc(0))]));
  const setup = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const edited = await call('openbone_apply_edits', { expectedRevision: context.revision, requestId: randomUUID(), edits: [
    { op: 'create_bone', boneId, name: `acceptance-${boneId.slice(0, 8)}`, parentId: bones.items[0]?.id ?? null, setup, length: 100 },
    { op: 'create_slot', slotId, name: `slot-${slotId.slice(0, 8)}`, boneId },
    { op: 'create_region', attachmentId, slotId, name: `region-${attachmentId.slice(0, 8)}`, pngPath, width: 120, height: 40, makeActive: true },
    ...[0, 0.5, 1].map((time, i) => ({ op: 'put_keyframe', animationId, boneId, channel: 'ROTATE', time, values: [i === 1 ? 35 : 0] })),
  ] });
  assert.ok(edited);
  context = await call('openbone_get_context');
  await run('openbone_project_save', { expectedRevision: context.revision, requestId: randomUUID() });
  context = await call('openbone_get_context');
  const preview = await run('openbone_project_preview', { expectedRevision: context.revision, requestId: randomUUID() });
  assert.equal((await fetch(preview.viewerUrl)).status, 200);
  const receipt = { checkedAt: new Date().toISOString(), userId, sessionId: agent.id, installedPluginVersion: (await json(path.join(values.pluginRoot, 'package.json'))).version, realDshProfile: true, realDshNativeExecutor: true, realJavaEditing: true, portableSave: true, browserRenderingVerified: false, boneId, animationId, preview };
  await writeFile(values.output, encode(receipt), { mode: 0o600 });
  console.log(JSON.stringify({ userId, realDshNativeExecutor: true, realJavaEditing: true, portableSave: true, receiptFile: values.output }));
}
}
