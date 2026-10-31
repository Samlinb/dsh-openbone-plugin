import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {cutMask,compositeRepair} from '../src/masks.js';
import {assemblyEdits} from '../src/assembly.js';
import {fixture} from './helpers.js';
import {LibraryStore} from '../src/store.js';
import {ProjectAssets} from '../src/assets.js';
import {ProductionFlow} from '../src/production-flow.js';

test('contours isolate connected parts; local repair protects every pixel outside mask',()=>{
 const png=new PNG({width:64,height:64});png.data.fill(255);
 const points=[[10,10],[50,10],[30,50]],cut=cutMask(png,points,[30,40]);
 assert.equal(cut.png.data[3],0);assert.equal(cut.png.data[((20-6)*cut.png.width+30-6)*4+3],255);assert.deepEqual(cut.geometry.origin,[6,6]);
 const generated=new PNG({width:128,height:128});generated.data.fill(20);
 const repaired=compositeRepair(png,generated,[[20,20],[40,20],[40,40],[20,40]]);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4;assert.equal(repaired.data[i],x>=20&&x<40&&y>=20&&y<40?20:255);}
 assert.throws(()=>cutMask(png,[[0,0],[80,0],[0,20]],[1,1]),/points/);
 assert.throws(()=>cutMask(png,[[0,0],[10,0],[20,0]],[1,1]),/area/);
});

test('batch split replay, automatic coordinates, immutable part reuse and restricted paid repair',async t=>{
 const f=await fixture(t),store=await new LibraryStore(f.destination).init();await store.createBlank('rabbit');
 const png=new PNG({width:64,height:64});png.data.fill(255);let calls=0;
 const provider={model:'fixture',supportsReferences:true,submit:async()=>{calls++;return 'task';},poll:async()=>({status:'succeeded',url:'fixture'}),download:async()=>PNG.sync.write(png)};
 const assets=new ProjectAssets(store,provider),flow=new ProductionFlow(assets);let n=0;
 const run=async(operation,data={})=>flow.execute('rabbit',{operation,data,expectedVersion:(await flow.read('rabbit')).version,requestId:'r'+(++n)},{revision:'r1',assemble:async s=>({revision:'r2',count:Object.keys(s.selected).length})});
 const plan={character:'rabbit',style:'flat',production:{motion:'hop',projection:'side',joints:'overlap',layering:'body then ear'},parts:[{id:'body',description:'body',pivot:[.5,.5],parent:null,overlap:'solid',order:1},{id:'ear',description:'ear',pivot:[.5,.9],parent:'body',overlap:'root overlaps head',order:0}]};
 await run('plan',plan);const imported=await run('import-reference',{pngBase64:PNG.sync.write(png).toString('base64')});await run('reference',{assetId:imported.job.parts[0].assetId,notes:'original'});await run('review-character',{checks:{recognizableSubject:true},subject:'rabbit',notes:'fixture'});
 const masks={parts:[{partId:'body',points:[[10,20],[50,20],[50,60],[10,60]],joint:[30,40]},{partId:'ear',points:[[20,5],[30,5],[35,30],[25,30]],joint:[30,27]}]};
 const split=await run('split-masks',masks);const again=await run('split-masks',masks);assert.deepEqual(again.selected,split.selected);assert.equal(calls,0);
 const edits=await assemblyEdits(assets,'rabbit',await flow.read('rabbit'),{bones:[],slots:[],attachments:[]});assert.equal(edits.filter(e=>e.op==='create_region').length,2);assert.equal(edits.filter(e=>e.op==='create_bone').length,3);
 const earBone=edits.find(e=>e.op==='create_bone'&&e.name==='ear');assert.equal(earBone.setup.x,0);assert.equal(earBone.setup.y,13);
 assert.equal((await run('assemble')).assembly.count,2);
 const repair=await run('repair-local',{partId:'ear',points:[[5,5],[10,5],[10,10],[5,10]],instruction:'Remove root outline'});assert.equal(repair.job.status,'running');assert.equal(calls,1);
 const finished=await run('finish-repair');assert.equal(finished.selected.body.assetId,split.selected.body.assetId);assert.notEqual(finished.selected.ear.assetId,split.selected.ear.assetId);assert.equal(finished.staticReview,null);assert.equal(finished.pendingRepair,null);
 const original=await assets.resolve('rabbit',split.selected.ear.assetId);const repaired=await assets.resolve('rabbit',finished.selected.ear.assetId);assert.deepEqual(repaired.part.geometry,original.part.geometry);assert.equal(repaired.part.width,original.part.width);
 assert.equal((await run('split-masks',masks)).selected.ear.assetId,finished.selected.ear.assetId,'repeating masks must reuse the repaired version, not revert it');
});
