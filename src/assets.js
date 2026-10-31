import path from 'node:path';
import {cutMask,compositeRepair,repairGuide,polygon} from './masks.js';
import { mkdir, lstat, readdir, readFile, writeFile, rename, mkdtemp, rm, realpath } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { setTimeout as delay } from 'node:timers/promises';
import { fields, id, requireThat } from './errors.js';
import { atomicJson, hash, json, safeFile } from './files.js';
import { productionBrief, productionPrompt } from './production.js';

/** Validate a model-authored split-sheet brief before spending provider quota. */
export function assetBrief(input) {
  fields(input, ['requestId','character','style','parts','production','referenceAssetIds','purpose','instruction'], ['requestId','character','style','parts']);
  requireThat(input.purpose===undefined||['concept','part','repair'].includes(input.purpose),'INVALID_INPUT','Invalid generation purpose.');
  requireThat(input.instruction===undefined||(typeof input.instruction==='string'&&input.instruction.length<=300),'INVALID_INPUT','Repair instructions must fit 300 characters.');
  requireThat(input.referenceAssetIds===undefined||(Array.isArray(input.referenceAssetIds)&&input.referenceAssetIds.length<=3&&input.referenceAssetIds.every(x=>typeof x==='string')),'INVALID_INPUT','Use up to three project asset references.');
  if(input.production!==undefined)productionBrief(input.production);
  for(const [key,max] of [['requestId',128],['character',300],['style',300]])requireThat(typeof input[key]==='string'&&input[key].length>0&&input[key].length<=max,'INVALID_INPUT',`${key} must contain between 1 and ${max} characters.`);
  requireThat(Array.isArray(input.parts) && input.parts.length >= 1 && input.parts.length <= 9, 'INVALID_INPUT', 'Use one to nine separately rigged parts per sheet.');
  const names = new Set();
  for (const part of input.parts) {
    fields(part, ['id','description','pivot'], ['id','description','pivot']);
    id(part.id); requireThat(typeof part.description==='string'&&part.description.length>0&&part.description.length<=120,'INVALID_INPUT','Each part description must contain between 1 and 120 characters.');
    requireThat(part.id.length <= 40 && !names.has(part.id), 'INVALID_INPUT', 'Part IDs must be unique and at most 40 characters.'); names.add(part.id);
    requireThat(Array.isArray(part.pivot) && part.pivot.length === 2 && part.pivot.every(n => Number.isFinite(n) && n >= 0 && n <= 1), 'INVALID_INPUT', 'Pivot is [x,y] in image coordinates from top-left, normalized to [0,1].');
  }
  return structuredClone(input);
}

export function sheetPrompt(brief) {
  if(brief.purpose==='concept')return `Draw ONE complete original character design for approval before skeletal animation: ${brief.character}. Style: ${brief.style}. Neutral readable pose, all limbs visible, no cropping, consistent proportions and costume, 12% padding, plain background. This is a full-character appearance reference, not a part sheet.`;
  if(brief.parts.length===1)return `Draw exactly ONE isolated cutout body part, not an atlas: ${brief.parts[0].description}. Character appearance: ${brief.character}. Style: ${brief.style}. One object only, no duplicates, no grid or multiple views. Center it with 12% empty padding. Keep hidden joint overlap. Flat pure bright green (#00ff00) background; no green on the part. No text, labels, scenery or shadows.`;
  const columns = Math.ceil(Math.sqrt(brief.parts.length)), rows = Math.ceil(brief.parts.length / columns);
  return `Create a production cutout sprite sheet for ONE original 2D skeletal animation character: ${brief.character}. Style: ${brief.style}. All parts belong to the SAME character, identical palette, outline thickness, orthographic viewing direction and lighting. Exactly ${columns} equal columns and ${rows} equal rows, read left to right then top to bottom. No visible grid, text, labels, watermark, shadows or scenery. Each cell contains ONLY the specified detached body part, centered, complete, with at least 12% empty padding on every side. Extend hidden joint ends for overlap when rigging. Do not draw a complete assembled character. Flat solid pure bright green (#00ff00) background everywhere between parts, no green on the character. Cell assignments: ${brief.parts.map((p,i) => `${i+1}: ${p.description}`).join('; ')}. Unused cells completely green.`;
}

/** Decode bounded PNGs before normalization; reject decompression-size abuse. */
export function decodePng(bytes) {
  requireThat(bytes.length >= 24 && bytes.length <= 16 * 1024 * 1024 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16) === 'IHDR', 'INVALID_IMAGE', 'Expected a bounded PNG image.');
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
  requireThat(w >= 16 && h >= 16 && w <= 4096 && h <= 4096 && w*h <= 4194304, 'INVALID_IMAGE', 'PNG dimensions exceed the supported sheet limits.');
  return PNG.sync.read(bytes);
}

/** Remove key-colored background; preserve the full cell and its declared pivot. */
export function splitSheet(bytes, brief) {
  const source = decodePng(bytes), columns = Math.ceil(Math.sqrt(brief.parts.length)), rows = Math.ceil(brief.parts.length/columns);
  return brief.parts.map((part, index) => {
    const x0 = Math.floor((index%columns)*source.width/columns), y0 = Math.floor(Math.floor(index/columns)*source.height/rows);
    const width = Math.floor((index%columns+1)*source.width/columns)-x0, height = Math.floor((Math.floor(index/columns)+1)*source.height/rows)-y0;
    const png = new PNG({ width, height });
    let left = width, top = height, right = -1, bottom = -1, visible = 0;
    for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const src=((y0+y)*source.width+x0+x)*4, dst=(y*width+x)*4;
      source.data.copy(png.data,dst,src,src+4);
      const r=png.data[dst],g=png.data[dst+1],b=png.data[dst+2];
      if(g>100 && g>r*1.35 && g>b*1.35 && g-Math.max(r,b)>55) png.data[dst+3]=0;
      if(png.data[dst+3]>20) { visible++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y); }
    }
    const issues=[];
    if(visible < width*height*0.005) issues.push('empty_part');
    if(visible > width*height*0.85) issues.push('background_not_removed');
    if(right>=0 && (left<2||top<2||right>=width-2||bottom>=height-2)) issues.push('part_touches_cell_edge');
    return { id:part.id, description:part.description, pivot:part.pivot, width,height,bounds:right<0?null:{left,top,right,bottom},issues,bytes:PNG.sync.write(png) };
  });
}

function thumbnail(source) {
  const ratio=Math.min(1,768/source.width,768/source.height),png=new PNG({width:Math.floor(source.width*ratio),height:Math.floor(source.height*ratio)});
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const start=(Math.floor(y/ratio)*source.width+Math.floor(x/ratio))*4;source.data.copy(png.data,(y*png.width+x)*4,start,start+4);}
  return {type:'image',mimeType:'image/png',data:PNG.sync.write(png).toString('base64')};
}

/** Durable project-scoped assets and paid image jobs; no server paths in public results. */
export class ProjectAssets {
  constructor(store, provider) { this.store=store;this.provider=provider;this.queue=Promise.resolve(); }
  exclusive(fn) { const work=this.queue.then(fn);this.queue=work.catch(()=>{});return work; }
  async root(projectId) {
    await this.store.project(projectId);
    const workspace=await realpath(path.join(this.store.root,'workspaces',id(projectId)));
    const directory=path.join(workspace,'generated-assets');
    await mkdir(directory,{recursive:true});
    requireThat(!(await lstat(directory)).isSymbolicLink() && await realpath(directory)===directory, 'LINK_DENIED','Asset directories must not traverse links.');
    return directory;
  }
  publicJob(job) {
    return { jobId:job.jobId,status:job.status,purpose:job.purpose??job.brief?.purpose??null,model:job.model,origin:job.origin??'generation',sheet:{width:job.sheetWidth,height:job.sheetHeight},source:job.source,pollCursor:job.pollCursor??0,parts:job.parts??[],issues:job.issues??[],reviewRequired:true,next:job.status==='running'?'Call openbone_assets_status with this jobId and afterPoll equal to the returned pollCursor. It handles bounded waiting. Update afterPoll on each next poll; do not use shell sleep or submit another generation.':job.status==='ready'?'Inspect the sheet and every part. Check shared view, anatomy, padding and joint pivots before rigging.':job.status==='unknown'?'Submission outcome is unknown; operator reconciliation is required before any new paid request.':job.status==='needs_revision'?'Inspect the sheet. Use production split-masks to isolate connected anatomy by its contour. Rectangular extraction cannot separate connected parts; do not retry rectangles. These uncorrected parts cannot be attached.':'Check the provider configuration and error before generating again.' };
  }
  async list(projectId) {
    const root=await this.root(projectId), jobs=[];
    for(const file of (await readdir(root)).filter(f=>/^job-[a-f0-9]{24}\.json$/.test(f))) jobs.push(this.publicJob(await json(await safeFile(root,file))));
    return { jobs, assets:jobs.filter(j=>j.status==='ready').flatMap(j=>j.parts) };
  }
  async importReference(projectId,{requestId,pngBase64}) {
    requireThat(typeof requestId==='string'&&requestId.length>0&&requestId.length<=128&&typeof pngBase64==='string'&&pngBase64.length<=1500000&&/^[A-Za-z0-9+/]+={0,2}$/.test(pngBase64),'INVALID_INPUT','Supply a bounded PNG as Base64 and a stable requestId.');
    const source=decodePng(Buffer.from(pngBase64,'base64')),bytes=PNG.sync.write(source),fingerprint=hash(bytes),jobId=hash(requestId).slice(0,24);
    return this.exclusive(async()=>{
      const root=await this.root(projectId),file=path.join(root,`job-${jobId}.json`);
      try{const old=await json(await safeFile(root,`job-${jobId}.json`));requireThat(old.fingerprint===fingerprint&&old.origin==='reference-import','REQUEST_CONFLICT','Import request identity conflicts.',409);return this.publicJob(old);}catch(e){if(e.code!=='ENOENT')throw e;}
      const part={id:'reference',assetId:`${jobId}-reference`,width:source.width,height:source.height,pivot:[.5,.5],sha256:fingerprint,issues:[]};
      const stage=await mkdtemp(path.join(root,'.stage-'));
      const job={jobId,fingerprint,origin:'reference-import',status:'ready',sheetSHA256:fingerprint,sheetWidth:source.width,sheetHeight:source.height,parts:[part],issues:[],createdAt:new Date().toISOString()};
      try{await writeFile(path.join(stage,'sheet.png'),bytes);await writeFile(path.join(stage,'reference.png'),bytes);await writeFile(path.join(stage,'manifest.json'),JSON.stringify([part]));try{await rename(stage,path.join(root,jobId));}catch(e){if(!['EEXIST','ENOTEMPTY','EPERM'].includes(e.code))throw e;const prior=await json(await safeFile(root,`${jobId}/manifest.json`));requireThat(JSON.stringify(prior)===JSON.stringify([part]),'ASSET_CONFLICT','Imported reference conflicts.',409);}await atomicJson(file,job);}finally{await rm(stage,{recursive:true,force:true});}
      return this.publicJob(job);
    });
  }
  async generate(projectId,input,signal) {
    requireThat(this.provider,'IMAGE_GENERATION_UNAVAILABLE','Image generation is not configured. Ask the operator to configure an image model; do not inspect host files or guess server paths.',409);
    const brief=assetBrief(input);
    const conditioning=brief.referenceAssetIds?.length?(brief.purpose==='repair'?' EDIT IMAGE 1 ONLY: it is the isolated target part. Image 2 is character identity reference ONLY, NEVER reproduce its full character or other limbs. Preserve image 1 composition, part count, scale and orientation. Return ONLY the repaired isolated part.':' Extract ONLY the requested detached part from image 1, with painted hidden joint coverage. NEVER return the full character. Match its palette, anatomy, costume and projection.') : '';
    const prompt=conditioning+sheetPrompt(brief)+productionPrompt(brief.production)+(brief.instruction?` Repair: ${brief.instruction}`:'');
    const images=[];
    for(const assetId of brief.referenceAssetIds??[]){const {file}=await this.resolve(projectId,assetId);images.push('data:image/png;base64,'+(await readFile(file)).toString('base64'));}
    requireThat(!images.length||this.provider.supportsReferences,'REFERENCE_UNSUPPORTED','The configured provider cannot condition generation on reference images.',409);
    requireThat(prompt.length<=2000,'INVALID_INPUT','Shorten the character, style and part descriptions; the complete image prompt must fit 2000 characters.');
    return this.exclusive(async()=>{
      const root=await this.root(projectId),jobId=hash(brief.requestId).slice(0,24),file=path.join(root,`job-${jobId}.json`),fingerprint=hash(JSON.stringify(brief));
      try { const old=await json(await safeFile(root,`job-${jobId}.json`));requireThat(old.fingerprint===fingerprint,'REQUEST_CONFLICT','This requestId belongs to a different generation brief.',409);return this.publicJob(old); }
      catch(error) { if(error.code!=='ENOENT')throw error; }
      const previous=await this.list(projectId);
      requireThat(previous.jobs.filter(j=>j.origin==='generation').length<(this.provider.maxJobsPerProject??20),'IMAGE_JOB_LIMIT','This project reached its image-job limit. Ask the operator to review usage before generating more.',429);
      requireThat(!previous.jobs.some(j=>['running','unknown'].includes(j.status)),'IMAGE_JOB_ACTIVE','Poll or reconcile this project’s existing image job before submitting another.',409);
      const job={jobId,fingerprint,brief,model:this.provider.model,api:this.provider.api,pollCursor:0,status:'unknown',createdAt:new Date().toISOString()};
      // Write before submission. An interrupted POST must never spend again on replay.
      await atomicJson(file,job);
      try { job.taskId=await this.provider.submit(prompt,signal,images);job.status='running';await atomicJson(file,job); }
      catch(error) { job.status=error.code==='IMAGE_REQUEST_REJECTED'?'failed':'unknown';job.issues=[error.code??'IMAGE_SUBMIT_FAILED'];await atomicJson(file,job);throw error; }
      return this.publicJob(job);
    });
  }
  async status(projectId,jobId,signal,afterPoll) {
    requireThat(typeof jobId==='string'&&/^[a-f0-9]{24}$/.test(jobId),'INVALID_INPUT','Expected a generation jobId.');
    requireThat(afterPoll===undefined||(Number.isSafeInteger(afterPoll)&&afterPoll>=0),'INVALID_INPUT','afterPoll must be the last observed nonnegative pollCursor.');
    return this.exclusive(async()=>{
      const root=await this.root(projectId),file=await safeFile(root,`job-${jobId}.json`),job=await json(file);
      if(job.status!=='running')return this.publicJob(job);
      requireThat(afterPoll===undefined||afterPoll<=(job.pollCursor??0),'POLL_CURSOR_CONFLICT','Read assets_list to obtain the current pollCursor.',409);
      if(afterPoll!==undefined&&afterPoll<(job.pollCursor??0))return this.publicJob(job);
      const provider=this.provider?.forJob?this.provider.forJob(job):this.provider;
      requireThat(provider && provider.model===job.model,'IMAGE_GENERATION_UNAVAILABLE','Restore this job’s image provider configuration before polling.',409);
      const deadline=Date.now()+(provider.pollWaitMs??0);
      let result;
      do {
        if(provider.pollIntervalMs)await delay(provider.pollIntervalMs,undefined,{signal});
        result=await provider.poll(job.taskId,signal);
      } while(result.status==='running'&&Date.now()<deadline);
      job.pollCursor=(job.pollCursor??0)+1;
      if(result.status==='running'){await atomicJson(file,job);return this.publicJob(job);}
      if(result.status==='failed') {job.status='failed';job.issues=['provider_failed'];await atomicJson(file,job);return this.publicJob(job);}
      let bytes=await provider.download(result.url,signal);
      let parts;
      try {if(job.purpose==='local-repair'){const {file}=await this.resolve(projectId,job.source.assetId);const original=decodePng(await readFile(file));const repaired=compositeRepair(original,decodePng(bytes),job.source.points);parts=[{...job.source.part,bytes:PNG.sync.write(repaired),issues:[]}];}else if(job.brief.purpose==='concept'){const image=decodePng(bytes);parts=[{...job.brief.parts[0],width:image.width,height:image.height,bounds:null,issues:[],bytes}];}else parts=splitSheet(bytes,job.brief);} catch(error) {job.status='failed';job.issues=[error.code??'INVALID_IMAGE'];await atomicJson(file,job);throw error;}
      if(job.purpose==='local-repair')bytes=parts[0].bytes;
      const folder=path.join(root,jobId),stage=await mkdtemp(path.join(root,'.stage-'));
      try {
        await writeFile(path.join(stage,'sheet.png'),bytes,{flag:'wx'});job.sheetSHA256=hash(bytes);job.sheetWidth=bytes.readUInt32BE(16);job.sheetHeight=bytes.readUInt32BE(20);
        job.parts=parts.map(({bytes,...part})=>({...part,assetId:`${jobId}-${part.id}`,sha256:hash(bytes)}));
        for(const part of parts)await writeFile(path.join(stage,`${part.id}.png`),part.bytes,{flag:'wx'});
        await writeFile(path.join(stage,'manifest.json'),JSON.stringify(job.parts));
        try { await rename(stage,folder); } catch(error) { if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code))throw error;const previous=await json(await safeFile(folder,'manifest.json'));requireThat(JSON.stringify(previous)===JSON.stringify(job.parts),'ASSET_CONFLICT','Generated asset receipt differs from an existing result.',409); }
        job.issues=job.parts.flatMap(p=>p.issues.map(issue=>`${p.id}:${issue}`));
        job.status=job.issues.length?'needs_revision':'ready';await atomicJson(file,job);
      } finally {await rm(stage,{recursive:true,force:true});}
      return this.publicJob(job);
    });
  }
  async resolve(projectId,assetId) {
    requireThat(typeof assetId==='string'&&/^[a-f0-9]{24}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assetId),'INVALID_INPUT','Expected a project assetId.');
    const root=await this.root(projectId),jobId=assetId.slice(0,24),partId=assetId.slice(25),job=await json(await safeFile(root,`job-${jobId}.json`));
    requireThat(job.status==='ready','ASSET_NOT_READY','Asset must pass normalization checks before attachment.',409);
    const part=job.parts.find(p=>p.id===partId);requireThat(part,'ASSET_NOT_FOUND','Unknown project asset.',404);
    const file=await safeFile(root,`${jobId}/${partId}.png`);
    requireThat(hash(await readFile(file))===part.sha256,'INTEGRITY_FAILED','Generated asset changed.');
    return {file,part};
  }
  async masked(projectId,{requestId,assetId,partId,points,joint}) {
    id(partId);const {file}=await this.resolve(projectId,assetId),source=decodePng(await readFile(file));
    const cut=cutMask(source,points,joint);
    return this.storeMasked(projectId,requestId,partId,PNG.sync.write(cut.png),{...cut.geometry,sourceAssetId:assetId},cut.pivot);
  }
  async storeMasked(projectId,requestId,partId,bytes,geometry,pivot) {
    return this.exclusive(async()=>{
      requireThat(typeof requestId==='string'&&requestId.length>0&&requestId.length<=128,'INVALID_INPUT','Supply a stable mask requestId.');
      const root=await this.root(projectId),jobId=hash(requestId).slice(0,24),file=path.join(root,`job-${jobId}.json`),fingerprint=hash(Buffer.concat([bytes,Buffer.from(JSON.stringify(geometry))]));
      try{const old=await json(file);requireThat(old.fingerprint===fingerprint,'REQUEST_CONFLICT','Mask request conflicts.');return this.publicJob(old);}catch(e){if(e.code!=='ENOENT')throw e;}
      const png=decodePng(bytes),part={id:partId,description:'Source pixels with contour mask',pivot,width:png.width,height:png.height,geometry,issues:[],assetId:`${jobId}-${partId}`,sha256:hash(bytes)};
      const job={jobId,fingerprint,origin:'mask',status:'ready',parts:[part],issues:[],sheetWidth:png.width,sheetHeight:png.height,sheetSHA256:hash(bytes)};
      const folder=path.join(root,jobId),stage=await mkdtemp(path.join(root,'.stage-'));
      try{await writeFile(path.join(stage,'sheet.png'),bytes);await writeFile(path.join(stage,`${partId}.png`),bytes);await atomicJson(path.join(stage,'manifest.json'),[part]);try{await rename(stage,folder);}catch(e){if(!['EEXIST','ENOTEMPTY','EPERM'].includes(e.code))throw e;const prior=await json(await safeFile(folder,'manifest.json'));requireThat(JSON.stringify(prior)===JSON.stringify([part]),'ASSET_CONFLICT','Mask output differs from an existing immutable asset.',409);}await atomicJson(file,job);}finally{await rm(stage,{recursive:true,force:true});}return this.publicJob(job);
    });
  }
  async localRepair(projectId,{requestId,assetId,points,instruction},signal){
    requireThat(this.provider?.supportsReferences,'REFERENCE_UNSUPPORTED','Configure reference image editing.');
    requireThat(typeof instruction==='string'&&instruction.length>0&&instruction.length<=500,'INVALID_INPUT','Describe the local repair in 1–500 characters.');
    const {file,part}=await this.resolve(projectId,assetId),original=decodePng(await readFile(file));polygon(points,original.width,original.height);
    return this.exclusive(async()=>{
      const root=await this.root(projectId),jobId=hash(requestId).slice(0,24),filename=path.join(root,`job-${jobId}.json`),fingerprint=hash(JSON.stringify({assetId,points,instruction}));
      try{const old=await json(filename);requireThat(old.fingerprint===fingerprint,'REQUEST_CONFLICT','Repair request conflicts.');return this.publicJob(old);}catch(e){if(e.code!=='ENOENT')throw e;}
      const previous=await this.list(projectId);requireThat(!previous.jobs.some(j=>['running','unknown'].includes(j.status)),'IMAGE_JOB_ACTIVE','Wait for the existing image job.');
      requireThat(previous.jobs.filter(j=>j.origin==='generation').length<(this.provider.maxJobsPerProject??20),'IMAGE_JOB_LIMIT','Image job limit reached.');
      const attempts=previous.jobs.filter(j=>j.source?.assetId===assetId&&j.purpose==='local-repair').length;requireThat(attempts<2,'REPAIR_LIMIT','Two repairs tried for this asset; inspect or adjust its mask before continuing.');
      const job={jobId,fingerprint,origin:'generation',purpose:'local-repair',source:{assetId,points,part},brief:{purpose:'repair',parts:[{id:part.id,pivot:part.pivot}]},model:this.provider.model,api:this.provider.api,pollCursor:0,status:'unknown',createdAt:new Date().toISOString()};await atomicJson(filename,job);
      const canvas=new PNG({width:original.width,height:original.height});for(let i=0;i<canvas.data.length;i+=4){const a=original.data[i+3]/255;for(let c=0;c<3;c++)canvas.data[i+c]=Math.round(original.data[i+c]*a+(c===1?255:0)*(1-a));canvas.data[i+3]=255;}
      try{job.taskId=await this.provider.submit(`Edit image 1 in place. Image 2 is a binary editing mask: WHITE is editable, BLACK must stay unchanged. Keep the exact canvas, position, scale and orientation. ${instruction} Output only image 1 with the repair; no labels, masks or diagrams. Keep pure green background outside the part.`,signal,[PNG.sync.write(canvas),repairGuide(original,points)].map(b=>'data:image/png;base64,'+b.toString('base64')));job.status='running';await atomicJson(filename,job);}catch(e){job.status=e.code==='IMAGE_REQUEST_REJECTED'?'failed':'unknown';await atomicJson(filename,job);throw e;}
      return this.publicJob(job);
    });
  }
  async extract(projectId,input) {
    fields(input,['requestId','jobId','partId','rect','pivot'],['requestId','jobId','partId','rect','pivot']);
    const brief=assetBrief({requestId:input.requestId,character:'Extract original pixels',style:'Preserve original appearance',parts:[{id:input.partId,description:'Extracted source part',pivot:input.pivot}]});
    requireThat(typeof input.jobId==='string'&&/^[a-f0-9]{24}$/.test(input.jobId),'INVALID_INPUT','Expected a source jobId.');
    fields(input.rect,['x','y','width','height'],['x','y','width','height']);
    const rect=input.rect;requireThat(Object.values(rect).every(Number.isSafeInteger)&&rect.x>=0&&rect.y>=0&&rect.width>=16&&rect.height>=16,'INVALID_INPUT','Use an integer source-pixel rectangle with nonnegative origin and size at least 16.');
    return this.exclusive(async()=>{
      const root=await this.root(projectId),jobId=hash(input.requestId).slice(0,24),fingerprint=hash(JSON.stringify({kind:'extract',...input})),filename=`job-${jobId}.json`;
      try {const previous=await json(await safeFile(root,filename));requireThat(previous.fingerprint===fingerprint,'REQUEST_CONFLICT','This requestId belongs to another asset operation.',409);return this.publicJob(previous);}catch(error){if(error.code!=='ENOENT')throw error;}
      const prior=(await this.list(projectId)).jobs.filter(j=>j.origin==='extraction'&&j.source?.jobId===input.jobId&&j.parts?.some(p=>p.id===input.partId));requireThat(prior.length<2,'CONTOUR_REQUIRED','Two rectangular extracts already tried. Use production split-masks with a contour; connected anatomy cannot be separated by enlarging a rectangle.',409);
      const sourceJob=await json(await safeFile(root,`job-${input.jobId}.json`));
      requireThat(['ready','needs_revision'].includes(sourceJob.status),'ASSET_NOT_READY','Inspect a completed source sheet before extracting.',409);
      const sourceBytes=await readFile(await safeFile(root,`${input.jobId}/sheet.png`));requireThat(hash(sourceBytes)===sourceJob.sheetSHA256,'INTEGRITY_FAILED','Source sheet changed.');
      const source=decodePng(sourceBytes);requireThat(rect.x+rect.width<=source.width&&rect.y+rect.height<=source.height,'INVALID_INPUT','Extraction rectangle exceeds the original sheet dimensions.');
      const crop=new PNG({width:rect.width,height:rect.height});
      for(let y=0;y<rect.height;y++){const start=((rect.y+y)*source.width+rect.x)*4;source.data.copy(crop.data,y*rect.width*4,start,start+rect.width*4);}
      const bytes=PNG.sync.write(crop),[part]=splitSheet(bytes,brief),job={jobId,fingerprint,brief,model:sourceJob.model,origin:'extraction',source:{jobId:input.jobId,sheetSHA256:sourceJob.sheetSHA256,rect},status:part.issues.length?'needs_revision':'ready',pollCursor:0,createdAt:new Date().toISOString(),sheetWidth:rect.width,sheetHeight:rect.height,sheetSHA256:hash(bytes),issues:part.issues.map(issue=>`${part.id}:${issue}`),parts:[{...part,bytes:undefined,assetId:`${jobId}-${part.id}`,sha256:hash(part.bytes)}]};
      const stage=await mkdtemp(path.join(root,'.stage-'));
      try {
        await writeFile(path.join(stage,'sheet.png'),bytes,{flag:'wx'});await writeFile(path.join(stage,`${part.id}.png`),part.bytes,{flag:'wx'});await writeFile(path.join(stage,'manifest.json'),JSON.stringify(job.parts));
        try{await rename(stage,path.join(root,jobId));}catch(error){if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code))throw error;const previous=await json(await safeFile(root,`${jobId}/manifest.json`));requireThat(JSON.stringify(previous)===JSON.stringify(job.parts),'ASSET_CONFLICT','Extraction result differs from an existing output.',409);}
        await atomicJson(path.join(root,filename),job);
      }finally{await rm(stage,{recursive:true,force:true});}
      return this.publicJob(job);
    });
  }
  async inspect(projectId,jobId) {
    requireThat(typeof jobId==='string'&&/^[a-f0-9]{24}$/.test(jobId),'INVALID_INPUT','Expected a generation jobId.');
    const root=await this.root(projectId),job=await json(await safeFile(root,`job-${jobId}.json`));
    requireThat(['ready','needs_revision'].includes(job.status),'ASSET_NOT_READY','Poll the existing job until the image is available.',409);
    const bytes=await readFile(await safeFile(root,`${jobId}/sheet.png`));requireThat(hash(bytes)===job.sheetSHA256,'INTEGRITY_FAILED','Generated sheet changed.');
    const source=decodePng(bytes),normalized=new PNG({width:source.width,height:source.height}),columns=Math.ceil(Math.sqrt(job.parts.length)),rows=Math.ceil(job.parts.length/columns);
    for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){const i=(y*source.width+x)*4,shade=(Math.floor(x/16)+Math.floor(y/16))%2?72:96;normalized.data[i]=shade;normalized.data[i+1]=shade;normalized.data[i+2]=shade;normalized.data[i+3]=255;}
    for(const [index,part] of job.parts.entries()) {
      const partBytes=await readFile(await safeFile(root,`${jobId}/${part.id}.png`));requireThat(hash(partBytes)===part.sha256,'INTEGRITY_FAILED','Normalized part changed.');
      const image=decodePng(partBytes),x0=Math.floor((index%columns)*source.width/columns),y0=Math.floor(Math.floor(index/columns)*source.height/rows);
      for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const src=(y*image.width+x)*4,dst=((y0+y)*normalized.width+x0+x)*4,a=image.data[src+3]/255;for(let c=0;c<3;c++)normalized.data[dst+c]=Math.round(image.data[src+c]*a+normalized.data[dst+c]*(1-a));}
    }
    const data={...this.publicJob(job),sheet:{width:source.width,height:source.height},imageOrder:['original provider sheet','normalized parts on a checkerboard; verify matte edges and retained anatomy']};
    return {content:[{type:'text',text:JSON.stringify(data)},thumbnail(source),thumbnail(normalized)],structuredContent:{data}};
  }
}
