import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, symlink, unlink } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { fixture } from './helpers.js';
import { LibraryStore } from '../src/store.js';
import { ProjectAssets, assetBrief, splitSheet, decodePng, sheetPrompt } from '../src/assets.js';
import { resolveAssetEdits, authoringSchemas } from '../src/authoring.js';
import { imageProvider } from '../src/image-provider.js';

const brief={requestId:'rabbit-parts-1',character:'Original cheerful white rabbit, front view',style:'Flat illustrated cutout, pink inner ears',parts:[{id:'body',description:'white torso without head or limbs',pivot:[0.5,0.7]},{id:'head',description:'round white head with face, no ears',pivot:[0.5,0.85]}]};
function sheet({empty=false,clipped=false}={}) {
  const png=new PNG({width:128,height:64});
  for(let y=0;y<64;y++)for(let x=0;x<128;x++) {
    const i=(y*128+x)*4,visible=!empty && y>12 && y<50 && (clipped?x<110:(x%64>12 && x%64<50));
    png.data[i]=visible?240:0;png.data[i+1]=visible?180:255;png.data[i+2]=visible?200:0;png.data[i+3]=255;
  }
  return PNG.sync.write(png);
}
async function setup(t,provider) {
  const f=await fixture(t),store=await new LibraryStore(f.destination).init();
  await store.createBlank('rabbit');await store.createBlank('other');
  return {...f,store,assets:new ProjectAssets(store,provider)};
}

test('brief and sheet normalization preserve pivots, transparent padding and part identity',()=>{
  assert.deepEqual(assetBrief(brief),brief);assert.match(sheetPrompt(brief),/2 equal columns and 1 equal rows/);
  const parts=splitSheet(sheet(),brief);
  assert.deepEqual(parts.map(p=>p.id),['body','head']);assert.deepEqual(parts[0].pivot,[0.5,0.7]);
  assert.equal(parts[0].width,64);assert.deepEqual(parts[0].issues,[]);
  const decoded=PNG.sync.read(parts[0].bytes);assert.equal(decoded.data[3],0);assert.equal(decoded.data[(20*64+20)*4+3],255);
  assert.ok(splitSheet(sheet({empty:true}),brief).every(p=>p.issues.includes('empty_part')));
  assert.ok(splitSheet(sheet({clipped:true}),brief)[0].issues.includes('part_touches_cell_edge'));
  assert.throws(()=>assetBrief({...brief,parts:[brief.parts[0],brief.parts[0]]}),/unique/);
  assert.throws(()=>assetBrief({...brief,parts:[{...brief.parts[0],pivot:[-1,0]}]}),/Pivot/);
  assert.throws(()=>assetBrief({...brief,style:'x'.repeat(301)}),/style.*300 characters/);
  const bomb=Buffer.from(sheet());bomb.writeUInt32BE(100000,16);assert.throws(()=>decodePng(bomb),/dimensions/);
});

test('paid jobs replay across restart, normalize once, and resolve only project-scoped intact assets',async t=>{
  let submissions=0,downloads=0;
  const provider={model:'fixture',submit:async()=>{submissions++;return 'task-1';},poll:async()=>({status:'succeeded',url:'fixture'}),download:async()=>{downloads++;return sheet();}};
  const f=await setup(t,provider),submitted=await f.assets.generate('rabbit',brief);
  assert.equal(submitted.status,'running');
  assert.equal((await new ProjectAssets(f.store,provider).generate('rabbit',brief)).jobId,submitted.jobId);assert.equal(submissions,1);
  await assert.rejects(f.assets.generate('rabbit',{...brief,character:'changed'}),e=>e.code==='REQUEST_CONFLICT');
  await assert.rejects(f.assets.generate('rabbit',{...brief,requestId:'second'}),e=>e.code==='IMAGE_JOB_ACTIVE');
  const [ready,again]=await Promise.all([f.assets.status('rabbit',submitted.jobId),f.assets.status('rabbit',submitted.jobId)]);
  assert.equal(ready.status,'ready');assert.deepEqual(ready,again);assert.equal(downloads,1);
  const assetId=ready.parts[0].assetId;
  assert.equal((await f.assets.list('rabbit')).assets.length,2);assert.equal((await f.assets.list('other')).assets.length,0);
  await assert.rejects(f.assets.resolve('other',assetId),e=>e.code==='ENOENT');
  const {file}=await f.assets.resolve('rabbit',assetId);assert.ok((await readFile(file)).length>0);
  const edit=await resolveAssetEdits(f.assets,'rabbit',{edits:[{op:'create_region',assetId,name:'body'}]});
  assert.equal(edit.edits[0].pngPath,file);assert.equal(edit.edits[0].assetId,undefined);
  await assert.rejects(resolveAssetEdits(f.assets,'rabbit',{edits:[{op:'create_region',pngPath:file}]}),/assetId/);
  await assert.rejects(resolveAssetEdits(f.assets,'rabbit',{edits:[{op:'create_region'}]}),e=>e.code==='ASSET_REQUIRED');
  const inspection=await f.assets.inspect('rabbit',submitted.jobId);assert.equal(inspection.content[1].type,'image');assert.equal(inspection.structuredContent.data.reviewRequired,true);
  const matte=PNG.sync.read(Buffer.from(inspection.content[2].data,'base64'));assert.deepEqual([...matte.data.subarray(0,4)],[96,96,96,255]);
  assert.ok(!JSON.stringify(inspection).includes(f.destination));
  const restarted=new ProjectAssets(f.store,provider);assert.equal((await restarted.resolve('rabbit',assetId)).file,file);
});

test('unknown submission is durable and never silently charged a second time',async t=>{
  let attempts=0;const provider={model:'fixture',submit:async()=>{attempts++;throw Object.assign(new Error('transport lost'),{code:'IMAGE_TRANSPORT_UNKNOWN'});}};
  const f=await setup(t,provider);await assert.rejects(f.assets.generate('rabbit',brief),/transport lost/);
  const restarted=new ProjectAssets(f.store,provider),replayed=await restarted.generate('rabbit',brief);
  assert.equal(replayed.status,'unknown');assert.equal(attempts,1);
  await assert.rejects(restarted.generate('rabbit',{...brief,requestId:'retry-with-new-id'}),e=>e.code==='IMAGE_JOB_ACTIVE');
});

test('unavailable generation reports capability before attempting to interpret artwork fields',async t=>{
  const f=await setup(t,null);
  await assert.rejects(f.assets.generate('rabbit',{parts:[{id:'ear_left',description:'x'.repeat(121)}]}),e=>e.code==='IMAGE_GENERATION_UNAVAILABLE');
  assert.equal((await f.assets.list('rabbit')).jobs.length,0);
});

test('polling waits inside the asset service and aborted polling does not submit or corrupt the job',async t=>{
  let polls=0;
  const provider={model:'fixture',pollIntervalMs:10,pollWaitMs:50,submit:async()=> 'task-1',poll:async()=>{polls++;return polls===1?{status:'running'}:{status:'succeeded',url:'fixture'};},download:async()=>sheet()};
  const f=await setup(t,provider),job=await f.assets.generate('rabbit',brief),abort=new AbortController();abort.abort();
  await assert.rejects(f.assets.status('rabbit',job.jobId,abort.signal),e=>e.name==='AbortError');
  assert.equal(polls,0);assert.equal((await f.assets.list('rabbit')).jobs[0].status,'running');
  assert.equal((await f.assets.status('rabbit',job.jobId)).status,'ready');assert.equal(polls,2);
});

test('invalid provider image is a durable failed job rather than an endless polling loop',async t=>{
  let downloads=0;
  const provider={model:'fixture',submit:async()=> 'task-1',poll:async()=>({status:'succeeded',url:'fixture'}),download:async()=>{downloads++;return Buffer.from('invalid image');}};
  const f=await setup(t,provider),job=await f.assets.generate('rabbit',brief);
  await assert.rejects(f.assets.status('rabbit',job.jobId),e=>e.code==='INVALID_IMAGE');
  const failed=await f.assets.status('rabbit',job.jobId);assert.equal(failed.status,'failed');assert.deepEqual(failed.issues,['INVALID_IMAGE']);assert.equal(downloads,1);
});

test('poll cursors replay observed state and old jobs remain pollable after a model switch',async t=>{
  let polls=0;
  const old={model:'old-model',submit:async()=> 'task-1',poll:async()=>{polls++;return {status:'running'};}};
  const f=await setup(t,old),job=await f.assets.generate('rabbit',brief);
  const one=await f.assets.status('rabbit',job.jobId,undefined,0);assert.equal(one.pollCursor,1);
  const changed=new ProjectAssets(f.store,{model:'new-model',forJob:record=>{assert.equal(record.model,'old-model');return old;}});
  assert.equal((await changed.status('rabbit',job.jobId,undefined,0)).pollCursor,1);assert.equal(polls,1);
  assert.equal((await changed.status('rabbit',job.jobId,undefined,1)).pollCursor,2);assert.equal(polls,2);
  await assert.rejects(changed.status('rabbit',job.jobId,undefined,20),e=>e.code==='POLL_CURSOR_CONFLICT');
});

test('a definite provider rejection is failed while transport uncertainty remains separately blocked',async t=>{
  const provider={model:'fixture',submit:async()=>{throw Object.assign(new Error('invalid model'),{code:'IMAGE_REQUEST_REJECTED'});}};
  const f=await setup(t,provider);await assert.rejects(f.assets.generate('rabbit',brief),/invalid model/);
  assert.equal((await f.assets.list('rabbit')).jobs[0].status,'failed');
});

test('Qwen image-generation API uses messages and accepts choice image outputs',async t=>{
  let submitted;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url).endsWith('/image-generation/generation')){submitted=JSON.parse(options.body);return Response.json({output:{task_id:'qwen-task'}});}
    return Response.json({output:{task_status:'SUCCEEDED',choices:[{message:{content:[{image:'https://example.oss-cn-beijing.aliyuncs.com/qwen.png'}]}}]}});
  });
  const provider=imageProvider({model:'qwen-image-3.0',api:'image-generation'},{DASHSCOPE_API_KEY:'fixture-key'});
  const task=await provider.submit('detached body parts');assert.equal(submitted.input.messages[0].content[0].text,'detached body parts');assert.equal(submitted.parameters.n,1);
  assert.equal((await provider.poll(task)).url,'https://example.oss-cn-beijing.aliyuncs.com/qwen.png');
  await provider.submit('repair only ear',undefined,['data:image/png;base64,AAAA','data:image/png;base64,BBBB']);
  assert.deepEqual(submitted.input.messages[0].content,[{image:'data:image/png;base64,AAAA'},{image:'data:image/png;base64,BBBB'},{text:'repair only ear'}]);
  const resumed=provider.forJob({model:'wan2.2-t2i-flash'});assert.equal(resumed.api,'image-synthesis');assert.equal(resumed.model,'wan2.2-t2i-flash');
});

test('extraction corrects sheet boundaries without provider calls, preserves source and recovers publication',async t=>{
  let paid=0;const provider={model:'fixture',submit:async()=>{paid++;return 'task-1';},poll:async()=>({status:'succeeded',url:'fixture'}),download:async()=>sheet()};
  const f=await setup(t,provider),source=await f.assets.generate('rabbit',brief);await f.assets.status('rabbit',source.jobId);
  const root=path.join(f.destination,'workspaces','rabbit','generated-assets'),before=await readFile(path.join(root,source.jobId,'sheet.png'));
  const input={requestId:'extract-body',jobId:source.jobId,partId:'corrected-body',rect:{x:4,y:4,width:56,height:56},pivot:[0.5,0.7]};
  const extracted=await f.assets.extract('rabbit',input);assert.equal(extracted.status,'ready');assert.equal(extracted.origin,'extraction');assert.equal(extracted.parts[0].width,56);assert.equal(paid,1);
  assert.deepEqual(await readFile(path.join(root,source.jobId,'sheet.png')),before);assert.equal(extracted.source.jobId,source.jobId);
  assert.equal((await new ProjectAssets(f.store,null).extract('rabbit',input)).jobId,extracted.jobId);
  await unlink(path.join(root,`job-${extracted.jobId}.json`));assert.equal((await f.assets.extract('rabbit',input)).jobId,extracted.jobId);
  await assert.rejects(f.assets.extract('rabbit',{...input,rect:{...input.rect,width:50}}),e=>e.code==='REQUEST_CONFLICT');
  await assert.rejects(f.assets.extract('rabbit',{...input,requestId:'outside',rect:{x:0,y:0,width:500,height:500}}),/exceeds/);
  await assert.rejects(f.assets.extract('other',input),e=>e.code==='ENOENT');
});

test('failed cell checks block attachment and linked asset roots are refused',async t=>{
  const provider={model:'fixture',submit:async()=> 'task-1',poll:async()=>({status:'succeeded',url:'fixture'}),download:async()=>sheet({empty:true})};
  const f=await setup(t,provider),job=await f.assets.generate('rabbit',brief),failed=await f.assets.status('rabbit',job.jobId);
  assert.equal(failed.status,'needs_revision');await assert.rejects(f.assets.resolve('rabbit',failed.parts[0].assetId),e=>e.code==='ASSET_NOT_READY');
  const target=path.join(f.destination,'workspaces','other','generated-assets');
  await symlink(path.dirname(target),target,'junction');
  await assert.rejects(f.assets.list('other'),e=>e.code==='LINK_DENIED');
});

test('hosted schema replaces local paths without mutating Java schemas',()=>{
  const original={name:'openbone_apply_edits',description:'All file paths must be absolute and inside its workspaceRoot (see context).',inputSchema:{properties:{edits:{items:{oneOf:[{properties:{pngPath:{type:'string'}},required:['pngPath']}]}}}}};
  const result=authoringSchemas([original])[0];assert.equal(result.inputSchema.properties.edits.items.oneOf[0].required[0],'assetId');
  assert.equal(result.inputSchema.properties.edits.items.oneOf[0].properties.pngPath,undefined);assert.ok(original.inputSchema.properties.edits.items.oneOf[0].properties.pngPath);
  assert.ok(!result.description.includes('workspaceRoot'));
});

test('provider adapter submits one bounded async sheet and never forwards credentials to image storage',async t=>{
  const requests=[];t.mock.method(globalThis,'fetch',async(url,options)=>{
    requests.push({url:String(url),options});
    if(String(url).includes('image-synthesis'))return Response.json({output:{task_id:'task-1'}});
    if(String(url).includes('/tasks/'))return Response.json({output:{task_status:'SUCCEEDED',results:[{url:'https://example.oss-cn-beijing.aliyuncs.com/image.png'}]}});
    return new Response(sheet());
  });
  const provider=imageProvider({model:'wan2.2-t2i-flash'},{DASHSCOPE_API_KEY:'test-only-key'});
  const task=await provider.submit(sheetPrompt(brief)),result=await provider.poll(task);await provider.download(result.url);
  assert.equal(JSON.parse(requests[0].options.body).parameters.n,1);assert.equal(requests[0].options.headers.Authorization,'Bearer test-only-key');assert.equal(requests[2].options.headers,undefined);
  await assert.rejects(provider.download('http://127.0.0.1/secret'),e=>e.code==='IMAGE_PROVIDER_ERROR');
});
