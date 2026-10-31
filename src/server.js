import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Failure, requireThat, fields, id, text, object } from './errors.js';
import { hash, safeFile, json, relativeName } from './files.js';
import { LibraryStore } from './store.js';
import { OpenBoneConnection } from './mcp.js';
import {verifyRuntime} from './runtime.js';
import { ProjectAssets } from './assets.js';
import { imageProvider as createImageProvider } from './image-provider.js';
import { authoringWorkflow, authoringSchemas, resolveAssetEdits } from './authoring.js';
import { previewRenderer } from './capture.js';
import { ProductionFlow } from './production-flow.js';
import {assemblyEdits,checkAssemblyProject} from './assembly.js';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const ALLOWED_TOOLS = new Set(['openbone_get_context','openbone_query_scene','openbone_apply_edits','openbone_undo','openbone_redo','openbone_control_view','openbone_capture_preview','openbone_render_status','openbone_cancel_render']);
const mime = file => file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.png') ? 'image/png' : file.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';

function secret(envName, env) {
  requireThat(typeof envName === 'string' && /^[A-Z][A-Z0-9_]*$/.test(envName), 'INVALID_CONFIG', 'Expected a credential environment variable name.');
  const token = env[envName];
  requireThat(typeof token === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(token), 'INVALID_CREDENTIAL', 'Missing or invalid credential environment variable.');
  return token;
}
function equal(a, b) { const x = Buffer.from(a ?? ''), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function resultData(result) {
  requireThat(result && !result.isError && result.structuredContent?.data, 'MCP_TOOL_ERROR', 'OpenBone operation failed; inspect its returned tool result.', 502);
  return result.structuredContent.data;
}
function clientContext(result) {
  const data = resultData(result);
  return { ...data, view: data.view ? { projectId: data.view.projectId, hostMode: data.view.hostMode } : undefined };
}
function cleanMcpResult(result, toolName) {
  if (toolName === 'openbone_get_context' && !result.isError) {
    const data = clientContext(result);
    return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: { data } };
  }
  if(toolName==='openbone_query_scene' && !result.isError && result.structuredContent?.data) {
    const data=structuredClone(result.structuredContent.data);
    for(const item of data.items??[])if(item.type==='RegionAttachment'&&typeof item.source==='string') {
      const match=/[\\/]generated-assets[\\/]([a-f0-9]{24})[\\/]([a-z0-9-]+)\.png$/.exec(item.source);
      delete item.source;item.hasImage=true;
      if(match)item.assetId=`${match[1]}-${match[2]}`;
    }
    return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:{data}};
  }
  return result;
}

export async function createAssetService(raw, { env = process.env, provisioner, imageProvider, captureRenderer } = {}) {
  fields(raw, ['dataRoot','runtimeRoot','port','publicUrl','tokenEnv','timeoutMs','previewTtlMs','maxBodyBytes','exportVersion','projects','imageGeneration','previewCapture','previewFrameOrigins','legacyServerImages'], ['dataRoot','port','publicUrl','tokenEnv','projects']);
  const config = { timeoutMs: 60000, previewTtlMs: 600000, maxBodyBytes: 24*1024*1024, exportVersion: '4.2.22', ...raw };
  requireThat(typeof config.exportVersion === 'string' && /^\d+\.\d+\.\d+$/.test(config.exportVersion), 'INVALID_CONFIG', 'Configure the preview export format version.');
  requireThat(Number.isInteger(config.port) && config.port >= 0 && config.port <= 65535, 'INVALID_CONFIG', 'Invalid listen port.');
  for (const key of ['timeoutMs','previewTtlMs','maxBodyBytes']) requireThat(Number.isInteger(config[key]) && config[key] >= 1 && config[key] <= 2147483647, 'INVALID_CONFIG', 'Invalid service limit.');
  const publicUrl = new URL(config.publicUrl);
  const frameOrigins=config.previewFrameOrigins??[];
  requireThat(Array.isArray(frameOrigins)&&frameOrigins.length<=8&&frameOrigins.every(value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&u.origin===value;}catch{return false;}}),'INVALID_CONFIG','Preview frame origins must be explicit HTTP(S) origins.');
  requireThat((publicUrl.protocol === 'https:' || (publicUrl.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(publicUrl.hostname))) && /^\/(?:[a-z0-9-]+\/)*$/.test(publicUrl.pathname) && !publicUrl.search && !publicUrl.hash && !publicUrl.username && !publicUrl.password, 'INVALID_CONFIG', 'publicUrl must be an HTTPS or loopback HTTP base URL ending in /.');
  const token = secret(config.tokenEnv, env);
  const store = await new LibraryStore(config.dataRoot).init();
  requireThat(config.legacyServerImages===undefined||typeof config.legacyServerImages==='boolean','INVALID_CONFIG','legacyServerImages must be boolean.');
  const provider = config.legacyServerImages ? imageProvider ?? createImageProvider(config.imageGeneration, env) : null;
  const assets = new ProjectAssets(store, provider);
  async function cleanProjectResult(result,name,projectId){
    if(name==='openbone_query_scene'&&!result.isError){
      const items=result.structuredContent?.data?.items??[],portable=items.filter(item=>item.type==='RegionAttachment'&&typeof item.source==='string'&&/saved\.openbone\.json\.assets[\\/][a-f0-9]{64}\.png$/.test(item.source));
      if(portable.length){const known=(await assets.list(projectId)).jobs.filter(j=>j.status==='ready').flatMap(j=>j.parts),root=path.join(store.root,'workspaces',projectId),state=await production.read(projectId),selected=new Set(Object.values(state.selected).map(p=>p.assetId));
        for(const item of portable){const file=await safeFile(root,path.relative(root,path.resolve(root,item.source)).split(path.sep).join('/')),digest=hash(await readFile(file)),matches=known.filter(p=>p.sha256===digest);const part=matches.find(p=>selected.has(p.assetId)&&p.id===item.name)??matches.find(p=>selected.has(p.assetId))??matches[0];if(part)item.assetId=part.assetId;}
      }
    }
    return cleanMcpResult(result,name);
  }
  const production = new ProductionFlow(assets);
  const renderer=captureRenderer??previewRenderer(config.previewCapture);
  const runtime = await verifyRuntime(config.runtimeRoot);
  const runtimeRoot = runtime.root;
  const projects = new Map(), previews = new Map();
  requireThat(Array.isArray(config.projects), 'INVALID_CONFIG', 'Expected project endpoint mappings.');
  for (const row of config.projects) {
    fields(row, ['projectId','url','tokenEnv'], ['projectId','url','tokenEnv']); id(row.projectId);
    requireThat(!projects.has(row.projectId), 'INVALID_CONFIG', 'Duplicate project endpoint.');
    await store.project(row.projectId);
    projects.set(row.projectId, new OpenBoneConnection({ url: row.url, token: secret(row.tokenEnv, env), timeoutMs: config.timeoutMs }));
  }
  async function connectionFor(projectId) {
    await store.project(projectId);
    if (provisioner) return provisioner.ensure(store, projectId);
    requireThat(projects.has(projectId), 'PROJECT_NOT_CONNECTED', 'Ask the operator to provision this project endpoint.', 409);
    return projects.get(projectId);
  }
  async function bound(sessionId, signal) {
    const binding = await store.binding(sessionId);
    requireThat(binding, 'PROJECT_NOT_CONNECTED', 'Bind an OpenBone project before editing.', 409);
    const connection = await connectionFor(binding.projectId);
    const context = await connection.call('openbone_get_context', {}, signal);
    const view = resultData(context).view;
    requireThat(view?.projectId === binding.projectId && typeof view.workspaceRoot === 'string' && await realpath(view.workspaceRoot) === await realpath(path.join(store.root, 'workspaces', binding.projectId)), 'ENDPOINT_MISMATCH', 'OpenBone endpoint does not own the configured project workspace.', 409);
    return { projectId: binding.projectId, connection, context };
  }
  async function dispatch(action, body, signal) {
    const imageOperation=['assets-generate','assets-status','assets-inspect','assets-extract'].includes(action)||action==='production'&&['concept','import-reference','split-masks','repair-local','finish-repair','generate-part'].includes(body.operation);
    if(imageOperation){
      requireThat(config.legacyServerImages,'CLIENT_IMAGES_REQUIRED','Generate, inspect and cut images in the client workbench.',409);
      const binding=body.sessionId&&await store.binding(body.sessionId);
      requireThat(!binding||!(await production.read(binding.projectId)).clientManaged,'CLIENT_IMAGES_REQUIRED','This project uses client-side image processing.',409);
    }
    switch (action) {
      case 'client-state': {
        fields(body,['sessionId'],['sessionId']);
        const binding=await store.binding(body.sessionId),availableProjects=(await store.projects()).map(p=>p.projectId);
        const clientWorkflow={imageProcessing:'client',instructions:'Open openbone_client_studio. Select a blank project before generating images. Load/import a local PNG, inspect it in the browser, mark contours and joints, review final parts, upload, assemble and save. Review actual static capture and confirm assembly in the client before animation. Source images and drafts remain client-side; server receives reviewed parts only. Never call legacy server image generation, inspection, extraction or repair.'};
        if(!binding)return {binding:null,availableProjects,...clientWorkflow,canAssemble:false};
        const {connection,context,projectId}=await bound(body.sessionId,signal),state=await production.read(projectId);
        const bones=resultData(await connection.call('openbone_query_scene',{kind:'bones',limit:200,expectedRevision:resultData(context).revision},signal)).items;
        let conflict=null;try{checkAssemblyProject(projectId,state,bones);}catch(e){conflict={code:e.code,message:e.message};}
        return {binding,availableProjects,...clientWorkflow,canAssemble:!conflict,conflict,context:clientContext(context),production:production.public(state)};
      }
      case 'client-assets': {
        fields(body,['sessionId','requestId','expectedVersion','bundle'],['sessionId','requestId','expectedVersion','bundle']);
        const state=await dispatch('client-state',{sessionId:body.sessionId},signal);
        requireThat(state.binding&&state.canAssemble,'ASSEMBLY_CONFLICT',state.conflict?.message??'Bind a blank project before processing images.',409);
        return production.execute(state.binding.projectId,{operation:'client-import',requestId:body.requestId,expectedVersion:body.expectedVersion,data:{bundle:body.bundle}},{ui:true},signal);
      }
      case 'studio': {
        fields(body,['sessionId','operation','requestId','expectedVersion','data'],['sessionId','operation']);
        requireThat(['enable-ui','confirm-character','confirm-assembly'].includes(body.operation),'INVALID_INPUT','Unknown Studio operation.');
        const {projectId,connection}=await bound(body.sessionId,signal);const {sessionId,...input}=body;
        return production.execute(projectId,input,async()=>({...resultData(await connection.call('openbone_get_context',{},signal)),ui:true}),signal);
      }
      case 'production': {
        fields(body,['sessionId','operation','requestId','expectedVersion','data'],['sessionId','operation']);
        const {projectId,connection}=await bound(body.sessionId,signal);
        const {sessionId,...input}=body;
        return production.execute(projectId,input,async()=>({...resultData(await connection.call('openbone_get_context',{},signal)),assemble:async(state,requestId)=>{
          const context=resultData(await connection.call('openbone_get_context',{},signal)),scene={};
          for(const kind of ['bones','slots','attachments'])scene[kind]=resultData(await connection.call('openbone_query_scene',{kind,limit:200,expectedRevision:context.revision},signal)).items;
          const edits=await assemblyEdits(assets,projectId,state,scene);
          const args=await resolveAssetEdits(assets,projectId,{expectedRevision:context.revision,requestId:'assembly-'+hash(requestId).slice(0,32),edits});
          resultData(await connection.call('openbone_apply_edits',args,signal));
          const current=resultData(await connection.call('openbone_get_context',{},signal));
          resultData(await connection.call('openbone_save_project',{path:path.join(store.root,'workspaces',projectId,'saved.openbone.json'),portable:true,overwrite:true,expectedRevision:current.revision,requestId:'assembly-save-'+hash(requestId).slice(0,32)},signal));
          return {revision:current.revision};
        }}),signal);
      }
      case 'capture': {
        fields(body,['sessionId','expectedRevision','requestId','animationName','times'],['sessionId','expectedRevision','requestId']);
        requireThat(renderer,'CAPTURE_UNAVAILABLE','Server WebGL capture is not configured. Ask the operator to configure previewCapture; do not install or run browser commands from the creative chat.',409);
        const snapshot=await dispatch('preview',{sessionId:body.sessionId,expectedRevision:body.expectedRevision,requestId:`capture-${hash(text(body.requestId,128)).slice(0,32)}`},signal);
        if(snapshot.isError)return snapshot;
        const captured=await renderer.capture(snapshot,{animationName:body.animationName,times:body.times},signal);
        const data={projectId:snapshot.projectId,sourceRevision:snapshot.sourceRevision,manifestSHA256:snapshot.manifestSHA256,engine:captured.engine,background:captured.background,animations:captured.animations,duration:captured.duration,frames:captured.frames.map(({animation,time})=>({animation,time})),actualWebGL:true};
        let sceneAssets=[];
        if((await production.read(snapshot.projectId)).plan){const {connection}=await bound(body.sessionId,signal);const scene=await cleanProjectResult(await connection.call('openbone_query_scene',{kind:'attachments',expectedRevision:snapshot.sourceRevision,limit:200},signal),'openbone_query_scene',snapshot.projectId);sceneAssets=(resultData(scene).items??[]).map(p=>p.assetId);}
        data.productionCaptureId=await production.capture(snapshot.projectId,data,captured,sceneAssets);
        data.productionVersion=(await production.read(snapshot.projectId)).version;
        return {content:[{type:'text',text:JSON.stringify(data)},...captured.frames.map(frame=>({type:'image',mimeType:'image/png',data:frame.png}))],structuredContent:{data}};
      }
      case 'prepare': {
        fields(body,['sessionId'],['sessionId']);
        const binding=await store.binding(body.sessionId),projects=await store.projects();
        const state=binding?await bound(body.sessionId,signal):null;
        if(binding&&config.legacyServerImages){const pending=await production.read(binding.projectId);if(pending.pendingRepair&&!pending.clientManaged){const job=(await assets.list(binding.projectId)).jobs.find(j=>j.jobId===pending.pendingRepair.jobId);await production.execute(binding.projectId,{operation:'finish-repair',data:{},expectedVersion:pending.version,requestId:'repair-pump-'+pending.pendingRepair.jobId+'-'+(job?.pollCursor??0)},{} ,signal);}}
        const library=store.search({limit:1}),lessons=await store.lessons();
        return {binding,availableProjects:projects.map(p=>p.projectId),context:state?clientContext(state.context):null,assets:binding?await assets.list(binding.projectId):null,production:binding?production.public(await production.read(binding.projectId)):null,imageGeneration:{available:!!provider,model:provider?.model??null,supportsReferences:!!provider?.supportsReferences},previewCapture:{available:!!renderer},referenceCount:library.total,lessons:lessons.lessons,workflow:authoringWorkflow,guide:await readFile(path.join(publicRoot,'authoring.md'),'utf8'),next:!binding?'Bind an existing project, then prepare again to inspect its existing images.':!provider?'If suitable images already exist, continue editing them. Otherwise STOP new-character creation and report that the operator must configure imageGeneration. Do not probe assets_generate, search host files or build an invisible placeholder rig.':'Use existing assets or generate the missing character parts. Do not guess server paths.'};
      }
      case 'assets-generate': case 'assets-status': case 'assets-list': case 'assets-inspect': case 'assets-extract': {
        const extra=action==='assets-generate'?['requestId','character','style','parts','production']:action==='assets-extract'?['requestId','jobId','partId','rect','pivot']:action==='assets-list'?[]:['jobId'];
        fields(body,['sessionId',...extra,...(action==='assets-status'?['afterPoll']:[])],['sessionId',...extra.filter(k=>k!=='production')]);
        const binding=await store.binding(body.sessionId);requireThat(binding,'PROJECT_NOT_CONNECTED','Bind a project before preparing assets.',409);
        const {sessionId,...input}=body;
        if(action==='assets-generate')return assets.generate(binding.projectId,input,signal);
        if(action==='assets-extract')return assets.extract(binding.projectId,input);
        if(action==='assets-status')return assets.status(binding.projectId,body.jobId,signal,body.afterPoll);
        if(action==='assets-inspect')return assets.inspect(binding.projectId,body.jobId);
        return assets.list(binding.projectId);
      }
      case 'search': fields(body, ['query','offset','limit','status']); return store.search(body);
      case 'read': fields(body, ['workId','snapshotId'], ['workId']); return store.read(body.workId, body.snapshotId);
      case 'lessons': fields(body, []); return store.lessons();
      case 'lesson': fields(body, ['name'], ['name']); return store.lesson(body.name);
      case 'create': {
        fields(body, ['workId','snapshotId','projectId'], ['workId','snapshotId','projectId']);
        const receipt = provisioner ? await provisioner.create(store, body.projectId, () => store.create(body)) : await store.create(body);
        if (provisioner) await connectionFor(receipt.projectId);
        return { projectId: receipt.projectId, workId: receipt.workId, snapshotId: receipt.snapshotId, userApproval: receipt.userApproval, replay: receipt.replay, connected: !!provisioner || projects.has(receipt.projectId) };
      }
      case 'new': {
        fields(body, ['projectId'], ['projectId']);
        requireThat(provisioner, 'PROVISIONING_UNAVAILABLE', 'Blank projects require the hosted service.', 409);
        const receipt = await provisioner.create(store, body.projectId, () => store.createBlank(body.projectId));
        await connectionFor(receipt.projectId);
        return { projectId: receipt.projectId, replay: receipt.replay, connected: true };
      }
      case 'binding': {
        fields(body, ['sessionId'], ['sessionId']);
        const binding = await store.binding(body.sessionId);
        return { binding, availableProjects: provisioner ? (await store.projects()).map(p => p.projectId) : [...projects.keys()] };
      }
      case 'bind': {
        fields(body, ['sessionId','projectId','expectedProjectId'], ['sessionId','projectId','expectedProjectId']);
        await connectionFor(body.projectId);
        const receipt = await store.bind(body.sessionId, body.projectId, body.expectedProjectId);
        return { binding: receipt };
      }
      case 'schema': {
        fields(body, ['sessionId'], ['sessionId']);
        const { connection } = await bound(body.sessionId, signal);
        const result = await connection.list(signal);
        return { tools: authoringSchemas(result.tools.filter(t => ALLOWED_TOOLS.has(t.name))), workflow:authoringWorkflow };
      }
      case 'call': {
        fields(body, ['sessionId','name','arguments'], ['sessionId','name','arguments']);
        requireThat(ALLOWED_TOOLS.has(body.name), 'TOOL_DENIED', 'Use a permitted bound-project tool; file operations are service-owned.', 403);
        object(body.arguments);
        const { connection, context, projectId } = await bound(body.sessionId, signal);
        const args=body.name==='openbone_apply_edits'?await resolveAssetEdits(assets,projectId,body.arguments):body.arguments;
        const result=await production.runEdit(projectId,body.name,body.arguments,()=>body.name==='openbone_get_context'?context:connection.call(body.name,args,signal));
        return cleanProjectResult(result,body.name,projectId);
      }
      case 'save': {
        fields(body, ['sessionId','expectedRevision','requestId'], ['sessionId','expectedRevision','requestId']);
        const { connection, projectId } = await bound(body.sessionId, signal);
        const result = await connection.call('openbone_save_project', { path: path.join(store.root, 'workspaces', projectId, 'saved.openbone.json'), portable: true, overwrite: true, expectedRevision: text(body.expectedRevision, 256), requestId: text(body.requestId, 128) }, signal);
        if (result.isError) return result;
        const data = resultData(result);
        return { content: [{ type: 'text', text: provisioner ? 'Saved the bound project. The hosted service restores this saved version after restart.' : 'Saved the bound project as saved.openbone.json. Configure this file as source when restarting OpenBone.' }], structuredContent: { data: { saved: true, revision: data.revision ?? body.expectedRevision } } };
      }
      case 'preview': {
        fields(body, ['sessionId','expectedRevision','requestId','includePoster'], ['sessionId','expectedRevision','requestId']);
        const { projectId, connection } = await bound(body.sessionId, signal);
        const revision = text(body.expectedRevision, 256), requestId = text(body.requestId, 128);
        const folder = path.join(store.root, 'workspaces', projectId, 'previews', hash(`${revision}\0${requestId}`));
        const exported = await connection.call('openbone_export_spine', { directory: folder, version: config.exportVersion, format: 'JSON', expectedRevision: revision, requestId }, signal);
        if (exported.isError) return exported;
        const data = resultData(exported);
        requireThat(data.sourceRevision === revision, 'PREVIEW_MISMATCH', 'Export returned another source revision.', 409);
        const pointerBytes = await readFile(await safeFile(folder, 'current.json'));
        const pointer = JSON.parse(pointerBytes);
        relativeName(pointer.generation);
        const manifestBytes = await readFile(await safeFile(folder, `${pointer.generation}/manifest.json`));
        requireThat(hash(manifestBytes) === pointer.manifestSHA256, 'INTEGRITY_FAILED', 'Export manifest hash mismatch.');
        const manifest = JSON.parse(manifestBytes);
        const files = new Map([['current.json', hash(pointerBytes)], [`${pointer.generation}/manifest.json`, hash(manifestBytes)]]);
        for (const [name, sha] of Object.entries(manifest.files)) {
          relativeName(name);
          const rel = `${pointer.generation}/${name}`;
          requireThat(hash(await readFile(await safeFile(folder, rel))) === sha, 'INTEGRITY_FAILED', 'Export resource hash mismatch.'); files.set(rel, sha);
        }
        for (const [key, value] of previews) if (value.expiresAt <= Date.now()) previews.delete(key);
        requireThat(previews.size < 1000, 'PREVIEW_LIMIT', 'Too many unexpired previews; wait for expiration.', 429);
        const capability = randomBytes(32).toString('hex'), expiresAt = Date.now() + config.previewTtlMs;
        previews.set(hash(capability), { folder, files, revision, projectId, snapshot: pointer.manifestSHA256, expiresAt });
        const result={ projectId, sourceRevision: revision, manifestSHA256: pointer.manifestSHA256, expiresAt, viewerUrl: `${publicUrl.href}preview/${capability}/viewer.html` };
        if(body.includePoster===true&&renderer){const captured=await renderer.capture(result,{times:[0]},signal);result.poster={mimeType:'image/png',data:captured.frames[0].png};}
        return result;
      }
      default: throw new Failure('NOT_FOUND', 'Unknown API action.', 404);
    }
  }
  const handle = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const host = req.headers.host;
      requireThat(host === `127.0.0.1:${server.address()?.port}` || host === `localhost:${server.address()?.port}` || host === publicUrl.host, 'INVALID_HOST', 'Untrusted request host.', 403);
      requireThat(!req.headers.origin || req.headers.origin === publicUrl.origin || req.headers.origin === `http://${host}`, 'INVALID_ORIGIN', 'Cross-origin requests are not permitted.', 403);
      const url = new URL(req.url, 'http://localhost');
      requireThat(url.pathname.startsWith(publicUrl.pathname), 'NOT_FOUND', 'Unknown service route.', 404);
      url.pathname = '/' + url.pathname.slice(publicUrl.pathname.length);
      if (url.pathname.startsWith('/v1/')) {
        requireThat(equal(req.headers.authorization, `Bearer ${token}`), 'UNAUTHORIZED', 'Authentication required.', 401);
        requireThat(req.method === 'POST' && req.headers['content-type']?.split(';')[0] === 'application/json', 'INVALID_REQUEST', 'Expected JSON POST.', 405);
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; requireThat(size <= config.maxBodyBytes, 'TOO_LARGE', 'Request exceeds configured limit.', 413); chunks.push(chunk); }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks)); } catch { throw new Failure('INVALID_JSON', 'Malformed JSON.'); }
        const abort = new AbortController();
        res.on('close', () => { if (!res.writableFinished) abort.abort(); });
        const result = await dispatch(url.pathname.slice(4), body, abort.signal);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
      } else {
        requireThat(req.method === 'GET', 'METHOD_DENIED', 'Only GET previews are supported.', 405);
        const match = /^\/preview\/([a-f0-9]{64})\/(.+)$/.exec(url.pathname);
        const preview = match && previews.get(hash(match[1]));
        requireThat(preview && preview.expiresAt > Date.now(), 'PREVIEW_EXPIRED', 'Preview is unavailable or expired; request a new preview.', 404);
        const name = decodeURIComponent(match[2]); relativeName(name);
        let bytes;
        if (name === 'identity.json') bytes = Buffer.from(JSON.stringify({ projectId: preview.projectId, sourceRevision: preview.revision, manifestSHA256: preview.snapshot, expiresAt: preview.expiresAt, runtimeVersion:runtime.manifest.version }));
        else if (['viewer.html','viewer.js','engines.js'].includes(name)) bytes = await readFile(await safeFile(publicRoot, name));
        else if (name.startsWith('runtime/')) {
          const moduleName=name.slice(8);
          requireThat(Object.hasOwn(runtime.manifest.files,moduleName),'NOT_FOUND','Module is outside the pinned Runtime distribution.',404);
          bytes=await readFile(await safeFile(runtimeRoot,moduleName));
          requireThat(hash(bytes)===runtime.manifest.files[moduleName],'RUNTIME_INTEGRITY_FAILED','Runtime module changed after service startup.',409);
        }
        else {
          requireThat(name.startsWith('assets/') && preview.files.has(name.slice(7)), 'NOT_FOUND', 'Resource is outside the selected snapshot.', 404);
          bytes = await readFile(await safeFile(preview.folder, name.slice(7)));
          requireThat(hash(bytes) === preview.files.get(name.slice(7)), 'INTEGRITY_FAILED', 'Preview resource changed after publication.', 409);
        }
        if (name.endsWith('.html')) res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self' http://127.0.0.1:* http://localhost:* "+frameOrigins.join(' '));
        res.setHeader('Content-Type', mime(name)); res.end(bytes);
      }
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const known = error instanceof Failure;
      res.statusCode = known ? error.status : error.code === 'ENOENT' ? 404 : 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { code: known ? error.code : error.code === 'ENOENT' ? 'NOT_FOUND' : 'INTERNAL_ERROR', message: known ? error.message : 'Operation failed. Check the server configuration and asset integrity.' } }));
    }
  };
  const server = createServer(handle);
  return {
    store, dispatch, handle,
    async listen() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve); });
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() { if(!captureRenderer)await renderer?.close();previews.clear(); if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}

