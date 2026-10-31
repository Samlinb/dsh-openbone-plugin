import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';
import {fixture} from './helpers.js';
import {LibraryStore} from '../src/store.js';
import {ProjectAssets} from '../src/assets.js';
import {ProductionFlow} from '../src/production-flow.js';
import {hash} from '../src/files.js';
import {receiveClientAssets} from '../src/client-assets.js';
import {cutPixels,inspectPixels} from '../public/client-pixels.js';
import {generateClientImage,reviewClientImage} from '../public/client-provider.js';
import {createAssetService} from '../src/server.js';

export function clientBundle(){
 const source=new PNG({width:64,height:64});
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4;source.data.set([220,120,80,x>5&&x<58&&y>5&&y<58?255:0],i);}
 const cut=cutPixels(source,[[8,8],[56,8],[56,56],[8,56]],[30,40]);
 const bytes=PNG.sync.write({width:cut.width,height:cut.height,data:Buffer.from(cut.data)});
 return {schemaVersion:1,source:{sha256:hash(PNG.sync.write(source)),width:64,height:64},plan:{character:'technical fixture',style:'flat',production:{motion:'hop',projection:'side',joints:'opaque overlap',layering:'body'},parts:[{id:'body',description:'body',parent:null,overlap:'filled joint',order:0,pivot:cut.pivot}]},parts:[{id:'body',pngBase64:bytes.toString('base64'),sha256:hash(bytes),geometry:cut.geometry}]};
}

test('client cuts preserve source coordinates; server stores exact bytes and recovers the immutable selection',async t=>{
 const f=await fixture(t),store=await new LibraryStore(f.destination).init();await store.createBlank('client');await store.createBlank('other');const assets=new ProjectAssets(store,null),bundle=clientBundle();
 const flow=new ProductionFlow(assets),input={operation:'client-import',requestId:'upload-1',expectedVersion:0,data:{bundle}};
 await assert.rejects(flow.execute('client',input,{}),/workbench/);
 const result=await flow.execute('client',input,{ui:true});
 assert.equal(result.clientManaged,true);assert.equal(result.uiControlled,true);assert.equal((await flow.execute('client',input,{ui:true})).replay,true);
 const assetId=result.selected.body.assetId,stored=await assets.resolve('client',assetId);
 assert.deepEqual(await readFile(stored.file),Buffer.from(bundle.parts[0].pngBase64,'base64'));
 assert.deepEqual(stored.part.geometry.joint,[30,40]);
 await assert.rejects(assets.resolve('other',assetId));
 const bad=structuredClone(bundle);bad.parts[0].sha256='0'.repeat(64);await assert.rejects(receiveClientAssets(assets,'client','bad',bad),/hash mismatch/);
 const conflict=structuredClone(bundle);conflict.plan.character='different';await assert.rejects(receiveClientAssets(assets,'client','upload-1',conflict),/conflicts/);
 assert.equal((await new ProductionFlow(assets).read('client')).selected.body.assetId,assetId);
 assert.equal(inspectPixels({width:2,height:2,data:new Uint8ClampedArray(16)}).issues[0],'empty_image');
});

test('service rejects old server image processing by default before calling any provider',async t=>{
 const f=await fixture(t),token='x'.repeat(40);let calls=0;
 const service=await createAssetService({dataRoot:f.destination,port:0,publicUrl:'http://127.0.0.1/',tokenEnv:'TEST_TOKEN',projects:[]},{env:{TEST_TOKEN:token},imageProvider:{submit:()=>{calls++;}}});
 const url=await service.listen();t.after(()=>service.close());
 for(const action of ['assets-generate','assets-inspect','assets-extract']){const r=await fetch(`${url}/v1/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:'{}'});assert.equal(r.status,409);assert.equal((await r.json()).error.code,'CLIENT_IMAGES_REQUIRED');}
 assert.equal(calls,0);
});

test('client provider adapters send pixels directly to configured model and keep the result distinct from approval',async()=>{
 const requests=[],fetcher=async(url,init)=>{requests.push({url,body:JSON.parse(init.body),key:init.headers.Authorization});return Response.json(url.includes('images')?{data:[{b64_json:'fixture'}]}:{choices:[{message:{content:'Extra ear detected.'}}]});};
 assert.equal(await generateClientImage({endpoint:'https://model.example/images',model:'fixture',key:'private'},'rabbit',{fetcher}),'data:image/png;base64,fixture');
 assert.equal(await reviewClientImage({endpoint:'https://model.example/vision',model:'fixture',key:'private'},'data:image/png;base64,fixture','',{fetcher}),'Extra ear detected.');
 assert.equal(requests[1].body.messages[0].content[1].image_url.url,'data:image/png;base64,fixture');
 assert.ok(requests.every(r=>r.url.startsWith('https://model.example/')&&r.key==='Bearer private'));
});
