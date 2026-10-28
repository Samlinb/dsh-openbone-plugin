import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.js';
import { importLibrary } from '../src/import.js';
import { LibraryStore } from '../src/store.js';
import { inventory, safeFile } from '../src/files.js';
import { rebuildCatalog } from '../src/catalog.js';

test('separation preserves source, exact feedback, metadata and verified assets; catalog has no private source path',async t=>{
  const f=await fixture(t),before=await inventory(f.source),store=await new LibraryStore(f.destination).init();
  const search=store.search({query:'行走'});assert.equal(search.total,1);assert.equal(search.works[0].status,'rejected');
  const work=await store.read('example-walk',f.snapshotId);assert.equal(work.reviews[0].feedback,'原始评价');
  assert.ok(!JSON.stringify(search).includes('PRIVATE_OPERATOR_PATH'));assert.ok(!Object.hasOwn(work,'origin'));
  assert.equal((await store.lessons()).lessons.length,1);assert.match((await store.lesson('walk.md')).text,/contact/);
  await store.verify(store.work('example-walk'));assert.deepEqual(await inventory(f.source),before);
  await assert.rejects(importLibrary(f.source,f.destination),{code:'ALREADY_EXISTS'});
});
test('tampered archives fail before publication and leave the source untouched',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.work,'source','project.json'),'changed');const before=await inventory(f.source);
  await assert.rejects(importLibrary(f.source,path.join(f.root,'bad-replica')),{code:'INTEGRITY_FAILED'});
  assert.deepEqual(await inventory(f.source),before);
});
test('project copies are isolated; concurrent identical creation and restart retry return one durable identity',async t=>{
  const f=await fixture(t),store=await new LibraryStore(f.destination).init();
  const request={workId:'example-walk',snapshotId:f.snapshotId,projectId:'alice'};
  const [a,b]=await Promise.all([store.create(request),store.create(request)]);assert.equal(a.replay,false);assert.equal(b.replay,true);
  await store.create({...request,projectId:'bob'});
  await writeFile(path.join(f.destination,'workspaces','alice','project.json'),'edited');
  assert.equal(await readFile(path.join(f.destination,'workspaces','bob','project.json'),'utf8'),'{"fixture":true}\n');
  await store.verify(store.work('example-walk'));
  const restarted=await new LibraryStore(f.destination).init();assert.equal((await restarted.create(request)).replay,true);
  assert.equal((await restarted.read('example-walk')).status,'rejected');
});
test('bindings compare before changing and remain independent across restart',async t=>{
  const f=await fixture(t),s=await new LibraryStore(f.destination).init();
  for(const projectId of ['alice','bob'])await s.create({workId:'example-walk',snapshotId:f.snapshotId,projectId});
  await s.bind('chat-a','alice');await s.bind('chat-b','bob');
  await assert.rejects(s.bind('chat-a','bob',null),{code:'BINDING_CONFLICT'});
  const restarted=await new LibraryStore(f.destination).init();assert.equal((await restarted.binding('chat-a')).projectId,'alice');assert.equal((await restarted.binding('chat-b')).projectId,'bob');
});
test('traversal and linked input cannot escape the archive or reveal files',async t=>{
  const f=await fixture(t),s=await new LibraryStore(f.destination).init();
  await assert.rejects(s.lesson('../../private.md'),{code:'UNSAFE_PATH'});
  await assert.rejects(s.create({workId:'example-walk',snapshotId:f.snapshotId,projectId:'../escape'}),{code:'INVALID_ID'});
  await symlink(f.source,path.join(f.work,'source','linked'),'junction');
  await assert.rejects(importLibrary(f.source,path.join(f.root,'linked-replica')),{code:'LINK_DENIED'});
  await assert.rejects(safeFile(f.work,'source/linked/lessons/walk.md'),{code:'LINK_DENIED'});
});
test('deleted derived index rebuilds from authoritative records without losing rejected feedback',async t=>{
  const f=await fixture(t),original=JSON.parse(await readFile(path.join(f.destination,'catalog.json'),'utf8'));
  await rm(path.join(f.destination,'catalog.json'));
  assert.deepEqual(await rebuildCatalog(f.destination),original);
  assert.equal((await rebuildCatalog(f.destination)).works[0].status,'rejected');
});
