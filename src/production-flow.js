import path from 'node:path';
import {atomicJson,json,safeFile,hash} from './files.js';
import {fields,requireThat,id} from './errors.js';
import {assetBrief} from './assets.js';
import {productionBrief} from './production.js';
import {receiveClientAssets} from './client-assets.js';

const fail=(condition,message)=>requireThat(condition,'PRODUCTION_GATE',message,409);
/** Project-scoped durable workflow. Accepted selections never mutate source pixels. */
export class ProductionFlow {
 constructor(assets){this.assets=assets;this.queue=Promise.resolve();}
 exclusive(fn){const next=this.queue.then(fn);this.queue=next.catch(()=>{});return next;}
 async read(projectId){const root=await this.assets.root(projectId);try{return await json(await safeFile(root,'production.json'));}catch(e){if(e.code!=='ENOENT')throw e;return {version:0,stage:'unplanned',selected:{},history:[],captures:[],receipts:{}};}}
 async write(projectId,state){await atomicJson(path.join(await this.assets.root(projectId),'production.json'),state);}
 public(state){const {receipts,captures,...view}=state;const step=['unplanned','concept'].includes(state.stage)?1:['parts','assembly'].includes(state.stage)?2:3;return {...view,history:state.history.slice(-8),step,stepName:['character','assembly','motion'][step-1],captures:captures.map(({id,revision,times,animationName,manifestSHA256})=>({id,revision,times,animationName,manifestSHA256})),userApproval:false};}
 async execute(projectId,input,context,signal){return this.exclusive(async()=>{
  fields(input,['operation','requestId','expectedVersion','data'],['operation']);
  let s=await this.read(projectId);
  if(input.operation==='status')return this.public(s);
  fail(typeof input.requestId==='string'&&input.requestId.length>0&&input.requestId.length<=128,'Supply a stable requestId.');
  const fingerprint=hash(JSON.stringify(input)),old=Object.hasOwn(s.receipts,input.requestId)?s.receipts[input.requestId]:null;
  if(old){fail(old.fingerprint===fingerprint,'Request identity conflicts with another operation.');return {...old.result,replay:true};}
  fail(input.expectedVersion===s.version,'Production version changed; read status first.');
  context=typeof context==='function'?await context():context;
  const d=input.data??{};let result;
  const invalidate=()=>{s.staticReview=null;s.motionReview=null;s.assemblyConfirmation=null;};
  const resolve=assetId=>this.assets.resolve(projectId,assetId);
  if(input.operation==='client-import'){
   fail(context.ui===true,'Import reviewed parts through the client workbench.');
   fields(d,['bundle'],['bundle']);
   const job=await receiveClientAssets(this.assets,projectId,input.requestId,d.bundle);
   s.history.push(...Object.entries(s.selected).map(([partId,previous])=>({partId,previous,version:s.version+1})));
   s.plan=structuredClone(d.bundle.plan);s.planHash=hash(JSON.stringify(s.plan));s.reference=null;
   s.clientManaged=true;s.uiControlled=true;s.clientSource=job.source;
   s.conceptReview={sourceSHA256:job.source.sha256,reviewer:'client-ui'};
   s.characterReview={accepted:true,subject:s.plan.character,reviewer:'client-ui',notes:'The user selected and confirmed the source in the client workbench.'};
   s.selected=Object.fromEntries(job.parts.map(p=>[p.id,{assetId:p.assetId,notes:'Client-cut pixels; user reviewed before upload.'}]));
   invalidate();s.stage='assembly';result={jobId:job.jobId};
  }else if(input.operation==='enable-ui'){
   fail(context.ui===true,'Use the Studio page.');s.uiControlled=true;
  }else if(input.operation==='confirm-character'){
   fail(context.ui===true&&s.uiControlled,'Use the Studio page.');fields(d,['assetId'],['assetId']);await resolve(d.assetId);fail(s.plan,'Describe the character first.');
   if(s.reference!==d.assetId){s.selected={};s.characterReview=null;}
   s.reference=d.assetId;s.conceptReview={assetId:d.assetId,reviewer:'user',planHash:s.planHash};invalidate();s.stage='parts';
  }else if(input.operation==='confirm-assembly'){
   fail(context.ui===true&&s.uiControlled,'Use the Studio page.');fields(d,['captureId']);
   fail(s.staticReview?.accepted&&s.staticReview.revision===context.revision,'Inspect the current assembly preview before confirming.');
   fail(!s.clientManaged||d.captureId===s.staticReview.captureId,'Confirm the exact assembly image displayed in the client.');
   s.assemblyConfirmation={captureId:s.staticReview.captureId,revision:context.revision,reviewer:'user'};s.stage='animation';
  }else if(input.operation==='character'){
   fields(d,['character','style','production'],['character','style','production']);productionBrief(d.production);
   assetBrief({requestId:'validate',character:d.character,style:d.style,parts:[{id:'concept',description:'character reference',pivot:[.5,.5]}]});
   s.plan={...structuredClone(d),parts:[]};s.planHash=hash(JSON.stringify(s.plan));s.reference=null;s.conceptReview=null;s.characterReview=null;s.selected={};invalidate();s.stage='concept';
  }else if(input.operation==='revisit'){
   fields(d,['step'],['step']);fail(s.plan&&[1,2,3].includes(d.step),'Choose an existing production step (1, 2, 3).');
   if(d.step===1){s.conceptReview=null;s.characterReview=null;invalidate();s.stage='concept';}
   if(d.step===2){fail(s.conceptReview,'Confirm the character before assembling parts.');invalidate();s.stage='assembly';}
   if(d.step===3){fail(s.staticReview?.accepted&&(!s.uiControlled||s.assemblyConfirmation),'Confirm the actual assembly before motion.');s.motionReview=null;s.stage='animation';}
  }else if(input.operation==='plan'){
   fields(d,['character','style','production','parts'],['character','style','production','parts']);productionBrief(d.production);
   fail(Array.isArray(d.parts)&&d.parts.length>0&&d.parts.length<=32,'Plan 1–32 individually named parts.');
   const names=new Set();const orders=new Set();
   for(const p of d.parts){fields(p,['id','description','pivot','parent','overlap','order'],['id','description','pivot','parent','overlap','order']);id(p.id);fail(p.id!=='constructor'&&!names.has(p.id),'Duplicate part ID.');names.add(p.id);fail(Number.isInteger(p.order)&&!orders.has(p.order),'Draw orders must be distinct integers.');orders.add(p.order);fail(typeof p.overlap==='string'&&p.overlap.trim().length>0&&p.overlap.length<=200,'Describe joint overlap and hidden contour requirements.');assetBrief({requestId:'validate',character:d.character,style:d.style,parts:[{id:p.id,description:p.description,pivot:p.pivot}]});}
   for(const p of d.parts){fail(p.parent===null||names.has(p.parent),'Parent must be another planned part or null.');const seen=new Set([p.id]);let parent=p.parent;while(parent!==null){fail(!seen.has(parent),'Part hierarchy contains a cycle.');seen.add(parent);parent=d.parts.find(x=>x.id===parent).parent;}}
   fail(!s.uiControlled||s.characterReview?.accepted,'Check character suitability before splitting.');
   const sameCharacter=s.plan?.character===d.character&&s.plan?.style===d.style&&s.plan?.production?.projection===d.production.projection;
   s.plan=structuredClone(d);s.planHash=hash(JSON.stringify(d));
   if(!sameCharacter){s.reference=null;s.conceptReview=null;s.characterReview=null;s.selected={};}
   else{s.selected=Object.fromEntries(Object.entries(s.selected).filter(([partId])=>names.has(partId)));if(s.conceptReview)s.conceptReview={...s.conceptReview,planHash:s.planHash};}
   invalidate();s.stage=s.conceptReview?(d.parts.every(p=>s.selected[p.id])?'assembly':'parts'):'concept';
  }else{
   fail(s.plan,'Create the production plan before generating images.');
   if(input.operation==='import-reference'){
    fields(d,['pngBase64'],['pngBase64']);result=await this.assets.importReference(projectId,{requestId:input.requestId,pngBase64:d.pngBase64});
   }else if(input.operation==='concept'){
    fields(d,[]);result=await this.assets.generate(projectId,{requestId:input.requestId,character:s.plan.character,style:s.plan.style,production:s.plan.production,purpose:'concept',parts:[{id:'concept',description:'complete character appearance reference',pivot:[.5,.5]}]},signal);
   }else if(input.operation==='review-character'){
    fields(d,['assetId','checks','subject','repairs','notes'],['checks','subject','notes']);fail(d.assetId===undefined||d.assetId===s.reference,'Review the currently selected reference.');fail(s.conceptReview,'Confirm the character first.');
    const keys=['recognizableSubject'];fields(d.checks,keys,keys);
    fail(keys.every(k=>typeof d.checks[k]==='boolean')&&typeof d.notes==='string'&&d.notes.trim().length>0,'Record suitability findings.');
    fail(typeof d.subject==='string'&&d.subject.length<=300&&(!d.checks.recognizableSubject||d.subject.trim().length>0),'Name the selected recognizable subject, including which one when multiple characters appear.');
    fail(d.repairs===undefined||Array.isArray(d.repairs)&&d.repairs.length<=8&&d.repairs.every(r=>typeof r==='string'&&r.trim().length>0&&r.length<=120),'Repairs must be up to 8 concise production tasks.');
    s.characterReview={assetId:s.reference,checks:d.checks,subject:d.subject,repairs:d.repairs??[],notes:d.notes,accepted:d.checks.recognizableSubject,reviewer:'assistant'};invalidate();s.stage='parts';
   }else if(input.operation==='reference'){
    fail(!s.uiControlled,'The user must confirm the character in Studio.');
    fields(d,['assetId','notes'],['assetId','notes']);await resolve(d.assetId);fail(typeof d.notes==='string'&&d.notes.trim().length>0,'Record appearance review findings.');if(s.reference!==d.assetId)s.selected={};s.reference=d.assetId;s.conceptReview={assetId:d.assetId,notes:d.notes,reviewer:'assistant',planHash:s.planHash};invalidate();s.stage='parts';
   }else if(input.operation==='split-masks'){
    fields(d,['parts'],['parts']);fail(s.reference&&s.conceptReview&&s.characterReview?.accepted,'Confirm and recognize the character first.');
    fail(Array.isArray(d.parts)&&d.parts.length>0&&d.parts.length<=32,'Supply up to 32 part masks.');
    const seen=new Set();for(const mask of d.parts){fields(mask,['partId','points','joint'],['partId','points','joint']);fail(!seen.has(mask.partId)&&s.plan.parts.some(p=>p.id===mask.partId),'Each mask must name a distinct planned part.');seen.add(mask.partId);}
    const prepared=[];for(const mask of d.parts){const selected=s.selected[mask.partId];if(selected){const {part}=await resolve(selected.assetId),g=part.geometry;if(g?.sourceAssetId===s.reference&&JSON.stringify(g.polygon)===JSON.stringify(mask.points)&&JSON.stringify(g.joint)===JSON.stringify(mask.joint)){prepared.push({mask,part});continue;}}const job=await this.assets.masked(projectId,{requestId:'mask-'+hash(JSON.stringify([s.reference,mask])).slice(0,48),assetId:s.reference,...mask});prepared.push({mask,part:job.parts[0]});}
    for(const {mask,part} of prepared){if(s.selected[mask.partId]?.assetId===part.assetId)continue;s.history.push({partId:mask.partId,previous:s.selected[mask.partId]??null,next:part.assetId,notes:'Source contour extraction',version:s.version+1});s.selected[mask.partId]={assetId:part.assetId,notes:'Contour extracted; inspect actual assembly and joints.'};}
    invalidate();s.stage=s.plan.parts.every(p=>s.selected[p.id])?'assembly':'parts';
   }else if(input.operation==='repair-local'){
    fields(d,['partId','points','instruction'],['partId','points','instruction']);const selected=s.selected[d.partId];fail(selected,'Choose an existing selected part.');
    fail(!s.pendingRepair,'Finish or reject the previous repair first.');
    result=await this.assets.localRepair(projectId,{requestId:input.requestId,assetId:selected.assetId,points:d.points,instruction:d.instruction},signal);
    s.pendingRepair={partId:d.partId,jobId:result.jobId,previous:selected.assetId};
   }else if(input.operation==='finish-repair'){
    fields(d,[]);fail(s.pendingRepair,'No repair is pending.');const repair=s.pendingRepair,job=await this.assets.status(projectId,repair.jobId,signal);
    result=job;if(job.status==='ready'){fail(s.selected[repair.partId]?.assetId===repair.previous,'Part selection changed while repair was running.');s.history.push({partId:repair.partId,previous:s.selected[repair.partId],next:job.parts[0].assetId,notes:'Mask-restricted local repair; outside pixels preserved.',version:s.version+1});s.selected[repair.partId]={assetId:job.parts[0].assetId,notes:'Local repair candidate; inspect assembly.'};s.pendingRepair=null;invalidate();s.stage='assembly';}else if(job.status==='failed'){s.pendingRepair=null;}
   }else if(input.operation==='assemble'){
    fields(d,[]);fail(s.plan.parts.length&&s.plan.parts.every(p=>s.selected[p.id]),'Split every planned part first.');fail(typeof context.assemble==='function','Automatic assembly is unavailable.');
    const receipt=await context.assemble(s,input.requestId);s.assembly={revision:receipt.revision,selectionHash:hash(JSON.stringify(s.selected)),...receipt};invalidate();s.stage='assembly';
   }else if(input.operation==='generate-part'){
    fields(d,['partId','instruction'],['partId','instruction']);fail(s.reference&&s.conceptReview,'Review and select a character reference first.');
    const p=s.plan.parts.find(p=>p.id===d.partId);fail(p,'Choose a planned part.');
    const attempts=s.history.filter(h=>h.partId===p.id&&h.accepted===false);fail(attempts.length<2,'Two generated candidates already tried for this part. Use contour splitting and a masked local repair instead.');
    const previous=s.selected[p.id]?.assetId;
    result=await this.assets.generate(projectId,{requestId:input.requestId,character:s.characterReview?.subject||s.plan.character,style:s.plan.style,production:{...s.plan.production,joints:p.overlap},purpose:previous?'repair':'part',referenceAssetIds:[...(previous?[previous]:[]),s.reference],instruction:d.instruction,parts:[{id:p.id,description:p.description,pivot:p.pivot}]},signal);
   }else if(input.operation==='reject-part'){
    fields(d,['partId','assetId','notes'],['partId','assetId','notes']);fail(s.plan.parts.some(p=>p.id===d.partId),'Unknown planned part.');fail((await this.assets.list(projectId)).jobs.some(j=>j.parts?.some(p=>p.assetId===d.assetId)),'Unknown candidate asset.');fail(typeof d.notes==='string'&&d.notes.trim().length>0,'Record the observed defect.');s.history.push({partId:d.partId,candidate:d.assetId,accepted:false,notes:d.notes,version:s.version+1});
   }else if(input.operation==='adopt-part'){
    fields(d,['partId','assetId','notes'],['partId','assetId','notes']);fail(s.reference&&s.conceptReview,'Select a reviewed character reference first.');fail(s.plan.parts.some(p=>p.id===d.partId),'Unknown planned part.');await resolve(d.assetId);fail(typeof d.notes==='string'&&d.notes.trim().length>0,'Record consistency, edge, pivot and overlap findings before adoption.');
    s.history.push({partId:d.partId,previous:s.selected[d.partId]??null,next:d.assetId,notes:d.notes,version:s.version+1});s.selected[d.partId]={assetId:d.assetId,notes:d.notes};invalidate();s.stage=s.plan.parts.every(p=>s.selected[p.id])?'assembly':'parts';
   }else if(['review-static','review-motion'].includes(input.operation)){
    fields(d,['captureId','checks','notes'],['captureId','checks','notes']);fail(s.conceptReview&&s.plan.parts.length>0&&s.plan.parts.every(p=>s.selected[p.id]),'Confirm the character and adopt all planned parts first.');
    const capture=s.captures.find(c=>c.id===d.captureId);fail(capture&&capture.revision===context.revision&&capture.selectionHash===hash(JSON.stringify(s.selected)),'Review requires a current server capture of the selected parts.');
    fail(capture.assembled===true,'Capture must contain every selected part in the actual scene.');
    const keys=input.operation==='review-static'?['consistency','overlap','occlusion','edges','pivots']:['poses','contacts','loop'];fields(d.checks,keys,keys);fail(keys.every(k=>typeof d.checks[k]==='boolean')&&typeof d.notes==='string'&&d.notes.trim().length>0,'Record each check and explicit findings.');
    const accepted=keys.every(k=>d.checks[k]);const review={captureId:d.captureId,revision:context.revision,checks:d.checks,notes:d.notes,accepted,reviewer:'assistant'};
    if(input.operation==='review-static'){fail(capture.times.length===1&&capture.times[0]===0,'Static review needs a time-zero capture.');s.staticReview=review;s.motionReview=null;s.assemblyConfirmation=null;s.stage=accepted&&!s.uiControlled?'animation':'assembly';}
    else{fail(s.staticReview?.accepted,'Pass static assembly review first.');fail(capture.times.includes(0)&&capture.times.some(t=>Math.abs(t-capture.duration)<1e-5)&&capture.times.length>=3,'Capture first/last loop frames and an intermediate pose.');s.motionReview=review;s.stage=accepted?'complete':'animation';}
   }else fail(false,'Unknown production operation.');
  }
  s.version++;result={...this.public(s),...(result?{job:result}:{})};s.receipts[input.requestId]={fingerprint,result};await this.write(projectId,s);return result;
 });}
 async capture(projectId,data,captured,sceneAssets=[]){return this.exclusive(async()=>{const s=await this.read(projectId);if(!s.plan)return null;const receipt={id:hash(JSON.stringify(data)).slice(0,24),revision:data.sourceRevision,manifestSHA256:data.manifestSHA256,selectionHash:hash(JSON.stringify(s.selected)),assembled:s.plan.parts.every(p=>sceneAssets.includes(s.selected[p.id]?.assetId)),times:captured.frames.map(f=>f.time),animationName:captured.frames[0]?.animation,duration:captured.duration};s.captures.push(receipt);s.captures=s.captures.slice(-40);await this.write(projectId,s);return receipt.id;});}
 async beforeEdit(projectId,name,args){const s=await this.read(projectId);if(!s.plan)return;const edits=args.edits??[];if(name==='openbone_apply_edits'&&s.uiControlled)fail(s.conceptReview&&s.characterReview?.accepted,'Confirm and validate the character in Studio before editing the rig.');if(name==='openbone_apply_edits')for(const e of edits){if(['create_animation','put_keyframe'].includes(e.op))fail(s.staticReview?.accepted&&(!s.uiControlled||s.assemblyConfirmation?.captureId===s.staticReview.captureId),'Pass static assembly review and confirm it in Studio before authoring motion.');if(e.assetId)fail(Object.values(s.selected).some(p=>p.assetId===e.assetId),'Use reviewed selected parts; adopt the candidate first.');}}
 async runEdit(projectId,name,args,call){return this.exclusive(async()=>{await this.beforeEdit(projectId,name,args);const result=await call();await this.afterEdit(projectId,name,args,result,true);return result;});}
 async afterEdit(projectId,name,args,result,locked=false){if(result.isError||!['openbone_apply_edits','openbone_undo','openbone_redo'].includes(name))return;const work=async()=>{const s=await this.read(projectId);if(!s.plan)return;const motionOnly=name==='openbone_apply_edits'&&(args.edits??[]).every(e=>['create_animation','put_keyframe','delete_keyframe','delete_animation'].includes(e.op));if(!motionOnly){s.staticReview=null;s.assemblyConfirmation=null;}s.motionReview=null;s.stage=motionOnly&&s.staticReview?.accepted?'animation':'assembly';s.version++;await this.write(projectId,s);};return locked?work():this.exclusive(work);}
}


