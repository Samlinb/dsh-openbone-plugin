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
import { PNG } from 'pngjs';

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
  const config = { legacyServerImages:true, dataRoot: f.root, javaJar: path.resolve(process.env.OPENBONE_TEST_JAR), port, publicUrl: `http://127.0.0.1:${port}`, mcpPortStart, mcpPortCount: 4, maxProjectsPerUser: 2,...(process.env.OPENBONE_TEST_BROWSER?{previewCapture:{executablePath:process.env.OPENBONE_TEST_BROWSER}}:{}) };
  const png=new PNG({width:64,height:64});
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4,part=x>12&&x<50&&y>12&&y<50;png.data[i]=part?240:0;png.data[i+1]=part?180:255;png.data[i+2]=part?200:0;png.data[i+3]=255;}
  const imageProvider={model:'test-fixture-only',submit:async()=> 'test-task',poll:async()=>({status:'succeeded',url:'fixture'}),download:async()=>PNG.sync.write(png)};
  let service = await createHostedService(config,{imageProvider});
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
  const brief={sessionId:'same-chat',requestId:'texture-fixture',character:'technical fixture',style:'test',parts:[{id:'body',description:'technical fixture block',pivot:[0.5,0.5]}]};
  const job=await post('alice','assets-generate',brief);
  const normalized=await post('alice','assets-status',{sessionId:'same-chat',jobId:job.jobId});
  assert.equal(normalized.status,'ready');
  assert.equal((await post('bob','assets-list',{sessionId:'same-chat'})).assets.length,0);
  const schemas=await post('alice','schema',{sessionId:'same-chat'});assert.doesNotMatch(JSON.stringify(schemas),/"pngPath":/);
  const slotId=randomUUID(),attachmentId=randomUUID(),animationId=randomUUID();
  const attached=await call('alice','openbone_apply_edits',{expectedRevision:current.revision,requestId:'attach-asset-and-animate',edits:[
    {op:'create_slot',slotId,name:'body',boneId},
    {op:'create_region',attachmentId,slotId,name:'body',assetId:normalized.parts[0].assetId,width:64,height:64},
    {op:'create_animation',animationId,name:'fixture-bounce'},
    ...[0,0.5,1].map((time,i)=>({op:'put_keyframe',animationId,boneId,channel:'TRANSLATE',time,values:[0,i===1?40:0],curve:'linear'})),
  ]});
  assert.notEqual(attached.isError,true,JSON.stringify(attached));
  const regions=await call('alice','openbone_query_scene',{kind:'attachments'});assert.equal(regions.structuredContent.data.items[0].assetId,normalized.parts[0].assetId);assert.doesNotMatch(JSON.stringify(regions),/generated-assets/);
  current = await context('alice');
  assert.notEqual((await post('alice', 'save', { sessionId: 'same-chat', expectedRevision: current.revision, requestId: 'save' })).isError, true);
  current = await context('alice');
  const preview = await post('alice', 'preview', { sessionId: 'same-chat', expectedRevision: current.revision, requestId: 'preview' });
  assert.ok(preview.viewerUrl.startsWith(`${config.publicUrl}/u/alice/preview/`));
  assert.equal((await fetch(preview.viewerUrl)).status, 200);
  assert.equal((await fetch(preview.viewerUrl.replace('/u/alice/', '/u/bob/'))).status, 404);
  const identity = await (await fetch(new URL('identity.json', preview.viewerUrl))).json();
  assert.equal(identity.sourceRevision, current.revision);
  if(process.env.OPENBONE_TEST_BROWSER) {
    const capture=await post('alice','capture',{sessionId:'same-chat',expectedRevision:current.revision,requestId:'real-webgl-capture',animationName:'fixture-bounce',times:[0,.5]});
    assert.equal(capture.structuredContent.data.actualWebGL,true);assert.equal(capture.structuredContent.data.sourceRevision,current.revision);assert.equal(capture.content.filter(c=>c.type==='image').length,2);
    const images=capture.content.filter(c=>c.type==='image').map(c=>PNG.sync.read(Buffer.from(c.data,'base64')));
    assert.equal(capture.structuredContent.data.background,'light-checkerboard');
    assert.deepEqual([...images[0].data.subarray(0,4)],[248,248,248,255]);
    assert.deepEqual([...images[0].data.subarray(16*4,16*4+4)],[224,224,224,255]);
    const center=image=>{let total=0,ySum=0;for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const i=(y*image.width+x)*4;if(image.data[i]>200&&image.data[i+1]>100&&image.data[i+1]<220&&image.data[i+2]>150){total++;ySum+=y;}}assert.ok(total>100,'Actual textured pixels must render.');return ySum/total;};
    assert.ok(center(images[1])<center(images[0])-5,'A positive world Y translation must move rendered pixels upward with the same fitted camera.');
    let productionVersion=0;
    const production=async(operation,data)=>{const result=await post('alice','production',{sessionId:'same-chat',operation,requestId:'production-'+operation,expectedVersion:productionVersion,data});productionVersion=result.version;return result;};
    await production('plan',{character:'fixture',style:'flat',production:{motion:'bounce',projection:'front',joints:'solid overlap',layering:'body'},parts:[{id:'body',description:'body',pivot:[.5,.5],parent:null,overlap:'solid root coverage',order:0}]});
    await production('reference',{assetId:normalized.parts[0].assetId,notes:'Technical fixture reference.'});
    await production('adopt-part',{partId:'body',assetId:normalized.parts[0].assetId,notes:'Technical fixture selected.'});
    const staticImage=await post('alice','capture',{sessionId:'same-chat',expectedRevision:current.revision,requestId:'production-static',animationName:'fixture-bounce',times:[0]});
    assert.ok(staticImage.structuredContent.data.productionCaptureId);
    await production('review-static',{captureId:staticImage.structuredContent.data.productionCaptureId,checks:{consistency:true,overlap:true,occlusion:true,edges:true,pivots:true},notes:'Fixture pixels verified by test; not artistic acceptance.'});
    const motionImage=await post('alice','capture',{sessionId:'same-chat',expectedRevision:current.revision,requestId:'production-motion',animationName:'fixture-bounce',times:[0,.5,1]});
    assert.equal((await production('review-motion',{captureId:motionImage.structuredContent.data.productionCaptureId,checks:{poses:true,contacts:true,loop:true},notes:'Fixture bounce and exact endpoints checked.'})).stage,'complete');
  }
  const made = await post('alice', 'new', { projectId: 'another' }); assert.equal(made.connected, true);
  assert.equal((await post('alice', 'new', { projectId: 'another' })).replay, true);
  await post('alice','bind',{sessionId:'mask-studio',projectId:'another',expectedProjectId:null});
  const maskRun=async(operation,data={})=>{const s=await post('alice','production',{sessionId:'mask-studio',operation:'status'});return post('alice','production',{sessionId:'mask-studio',operation,data,expectedVersion:s.version,requestId:randomUUID()});};
  await maskRun('plan',{character:'fixture rabbit',style:'flat',production:{motion:'hop',projection:'side',joints:'filled',layering:'body'},parts:[{id:'body',description:'body',pivot:[.5,.5],parent:null,overlap:'solid',order:0}]});
  const maskPng=new PNG({width:64,height:64});maskPng.data.fill(255);
  const maskReference=await maskRun('import-reference',{pngBase64:PNG.sync.write(maskPng).toString('base64')});
  await maskRun('reference',{assetId:maskReference.job.parts[0].assetId,notes:'Fixture original'});
  await maskRun('review-character',{checks:{recognizableSubject:true},subject:'fixture rabbit',notes:'Fixture'});
  const maskParts=await maskRun('split-masks',{parts:[{partId:'body',points:[[10,10],[50,10],[50,50],[10,50]],joint:[30,40]}]});
  const assembly=await maskRun('assemble');assert.ok(assembly.assembly.revision);
  if(process.env.OPENBONE_TEST_BROWSER){const poster=await post('alice','preview',{sessionId:'mask-studio',expectedRevision:assembly.assembly.revision,requestId:randomUUID(),includePoster:true});assert.equal(poster.poster.mimeType,'image/png');assert.ok(PNG.sync.read(Buffer.from(poster.poster.data,'base64')).width>100);}
  const assembled=await post('alice','call',{sessionId:'mask-studio',name:'openbone_query_scene',arguments:{kind:'attachments'}});
  assert.equal(assembled.structuredContent.data.items[0].assetId,maskParts.selected.body.assetId);
  const sameAssembly=await maskRun('assemble');assert.equal(sameAssembly.selected.body.assetId,maskParts.selected.body.assetId);
  const denied = await fetch(`${config.publicUrl}/u/alice/v1/new`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.alice.token}` }, body: '{"projectId":"third"}' }); assert.equal(denied.status, 429);
  await service.close(); service = null;
  service = await createHostedService(config,{imageProvider}); await service.listen();
  assert.equal((await post('alice', 'binding', { sessionId: 'same-chat' })).binding.projectId, 'starter');
  const restored = await context('alice');
  const bones = (await call('alice', 'openbone_query_scene', { kind: 'bones', expectedRevision: restored.revision })).structuredContent.data;
  assert.ok(bones.items.some(b => b.id === boneId && b.name === 'hosted-root'));
  const restoredAnimations=await call('alice','openbone_query_scene',{kind:'animations'});
  assert.ok(restoredAnimations.structuredContent.data.items.some(a=>a.name==='fixture-bounce'&&a.totalKeyCount===3&&a.duration===1));
  assert.equal((await post('alice','assets-list',{sessionId:'same-chat'})).assets[0].assetId,normalized.parts[0].assetId);
  const recoveredParts=await post('alice','call',{sessionId:'mask-studio',name:'openbone_query_scene',arguments:{kind:'attachments'}});
  assert.equal(recoveredParts.structuredContent.data.items[0].assetId,maskParts.selected.body.assetId,'portable saved textures recover their immutable asset identity after restart');
  assert.notEqual(restored.revision, current.revision);
  const bobRestored = await context('bob');
  const bobBones = (await call('bob', 'openbone_query_scene', { kind: 'bones', expectedRevision: bobRestored.revision })).structuredContent.data;
  assert.equal(bobBones.items.length, 0);
});
