import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { createAssetService } from '../src/server.js';

test('HTTP requires credentials, rejects unknown fields and never exposes assets as a static directory',async t=>{
  const f=await fixture(t),token='test_credential_'.padEnd(40,'x');
  const service=await createAssetService({dataRoot:f.destination,port:0,publicUrl:'http://127.0.0.1',tokenEnv:'TEST_LIBRARY_TOKEN',projects:[]},{env:{TEST_LIBRARY_TOKEN:token}});
  const url=await service.listen();t.after(()=>service.close());
  const post=(action,body,auth=true)=>fetch(`${url}/v1/${action}`,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  assert.equal((await post('search',{},false)).status,401);
  assert.equal((await post('search',{unexpected:true})).status,400);
  const search=await(await post('search',{})).json();assert.equal(search.works[0].status,'rejected');
  const prepared=await(await post('prepare',{sessionId:'one'})).json();
  assert.equal(prepared.binding,null);assert.equal(prepared.referenceCount,1);assert.equal(prepared.imageGeneration.available,false);assert.match(prepared.guide,/assetId/);assert.doesNotMatch(JSON.stringify(prepared),new RegExp(f.destination.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal((await post('assets-generate',{sessionId:'one',requestId:'one',character:'rabbit',style:'flat',parts:[]})).status,409);
  assert.equal(prepared.previewCapture.available,false);
  assert.equal((await post('capture',{sessionId:'one',expectedRevision:'fixture',requestId:'fixture'})).status,409);
  assert.equal((await fetch(`${url}/assets/anything`)).status,404);
  assert.equal((await fetch(`${url}/preview/${'a'.repeat(64)}/viewer.html`)).status,404);
  assert.equal((await post('call',{sessionId:'one',name:'openbone_load_project',arguments:{path:'secret'}})).status,403);
  const created=await(await post('create',{workId:'example-walk',snapshotId:f.snapshotId,projectId:'alice'})).json();
  assert.equal(created.connected,false);assert.ok(!Object.hasOwn(created,'project'));
  assert.equal((await post('bind',{sessionId:'one',projectId:'alice',expectedProjectId:null})).status,409);
  assert.equal((await post('call',{sessionId:'one',name:'openbone_get_context',arguments:{}})).status,409);
  const origin=await fetch(`${url}/v1/search`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,Origin:'https://untrusted.invalid'},body:'{}'});assert.equal(origin.status,403);
});
