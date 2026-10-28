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
  return result;
}

export async function createAssetService(raw, { env = process.env } = {}) {
  fields(raw, ['dataRoot','runtimeRoot','port','publicUrl','tokenEnv','timeoutMs','previewTtlMs','maxBodyBytes','exportVersion','projects'], ['dataRoot','port','publicUrl','tokenEnv','projects']);
  const config = { timeoutMs: 60000, previewTtlMs: 600000, maxBodyBytes: 2097152, exportVersion: '4.2.22', ...raw };
  requireThat(typeof config.exportVersion === 'string' && /^\d+\.\d+\.\d+$/.test(config.exportVersion), 'INVALID_CONFIG', 'Configure the preview export format version.');
  requireThat(Number.isInteger(config.port) && config.port >= 0 && config.port <= 65535, 'INVALID_CONFIG', 'Invalid listen port.');
  for (const key of ['timeoutMs','previewTtlMs','maxBodyBytes']) requireThat(Number.isInteger(config[key]) && config[key] >= 1 && config[key] <= 2147483647, 'INVALID_CONFIG', 'Invalid service limit.');
  const publicUrl = new URL(config.publicUrl);
  requireThat((publicUrl.protocol === 'https:' || (publicUrl.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(publicUrl.hostname))) && publicUrl.pathname === '/' && !publicUrl.search && !publicUrl.hash && !publicUrl.username && !publicUrl.password, 'INVALID_CONFIG', 'publicUrl must be an HTTPS origin or loopback HTTP origin.');
  const token = secret(config.tokenEnv, env);
  const store = await new LibraryStore(config.dataRoot).init();
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
  async function bound(sessionId, signal) {
    const binding = await store.binding(sessionId);
    requireThat(binding && projects.has(binding.projectId), 'PROJECT_NOT_CONNECTED', 'Bind a provisioned OpenBone project before editing.', 409);
    const connection = projects.get(binding.projectId);
    const context = await connection.call('openbone_get_context', {}, signal);
    const view = resultData(context).view;
    requireThat(view?.projectId === binding.projectId && typeof view.workspaceRoot === 'string' && await realpath(view.workspaceRoot) === await realpath(path.join(store.root, 'workspaces', binding.projectId)), 'ENDPOINT_MISMATCH', 'OpenBone endpoint does not own the configured project workspace.', 409);
    return { projectId: binding.projectId, connection, context };
  }
  async function dispatch(action, body, signal) {
    switch (action) {
      case 'search': fields(body, ['query','offset','limit','status']); return store.search(body);
      case 'read': fields(body, ['workId','snapshotId'], ['workId']); return store.read(body.workId, body.snapshotId);
      case 'lessons': fields(body, []); return store.lessons();
      case 'lesson': fields(body, ['name'], ['name']); return store.lesson(body.name);
      case 'create': {
        fields(body, ['workId','snapshotId','projectId'], ['workId','snapshotId','projectId']);
        const receipt = await store.create(body);
        return { projectId: receipt.projectId, workId: receipt.workId, snapshotId: receipt.snapshotId, userApproval: receipt.userApproval, replay: receipt.replay, connected: projects.has(receipt.projectId) };
      }
      case 'binding': {
        fields(body, ['sessionId'], ['sessionId']);
        const binding = await store.binding(body.sessionId);
        return { binding, availableProjects: [...projects.keys()] };
      }
      case 'bind': {
        fields(body, ['sessionId','projectId','expectedProjectId'], ['sessionId','projectId','expectedProjectId']);
        requireThat(projects.has(body.projectId), 'PROJECT_NOT_CONNECTED', 'Project copy exists only after provisioning; ask the operator to configure its endpoint.', 409);
        const receipt = await store.bind(body.sessionId, body.projectId, body.expectedProjectId);
        return { binding: receipt };
      }
      case 'schema': {
        fields(body, ['sessionId'], ['sessionId']);
        const { connection } = await bound(body.sessionId, signal);
        const result = await connection.list(signal);
        return { tools: result.tools.filter(t => ALLOWED_TOOLS.has(t.name)) };
      }
      case 'call': {
        fields(body, ['sessionId','name','arguments'], ['sessionId','name','arguments']);
        requireThat(ALLOWED_TOOLS.has(body.name), 'TOOL_DENIED', 'Use a permitted bound-project tool; file operations are service-owned.', 403);
        object(body.arguments);
        const { connection, context } = await bound(body.sessionId, signal);
        return cleanMcpResult(body.name === 'openbone_get_context' ? context : await connection.call(body.name, body.arguments, signal), body.name);
      }
      case 'save': {
        fields(body, ['sessionId','expectedRevision','requestId'], ['sessionId','expectedRevision','requestId']);
        const { connection, projectId } = await bound(body.sessionId, signal);
        const result = await connection.call('openbone_save_project', { path: path.join(store.root, 'workspaces', projectId, 'saved.openbone.json'), portable: true, overwrite: true, expectedRevision: text(body.expectedRevision, 256), requestId: text(body.requestId, 128) }, signal);
        if (result.isError) return result;
        const data = resultData(result);
        return { content: [{ type: 'text', text: 'Saved the bound project as saved.openbone.json. Configure this file as source when restarting OpenBone.' }], structuredContent: { data: { saved: true, revision: data.revision ?? body.expectedRevision } } };
      }
      case 'preview': {
        fields(body, ['sessionId','expectedRevision','requestId'], ['sessionId','expectedRevision','requestId']);
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
        return { projectId, sourceRevision: revision, manifestSHA256: pointer.manifestSHA256, expiresAt, viewerUrl: `${publicUrl.origin}/preview/${capability}/viewer.html` };
      }
      default: throw new Failure('NOT_FOUND', 'Unknown API action.', 404);
    }
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const host = req.headers.host;
      requireThat(host === `127.0.0.1:${server.address()?.port}` || host === `localhost:${server.address()?.port}` || host === publicUrl.host, 'INVALID_HOST', 'Untrusted request host.', 403);
      requireThat(!req.headers.origin || req.headers.origin === publicUrl.origin || req.headers.origin === `http://${host}`, 'INVALID_ORIGIN', 'Cross-origin requests are not permitted.', 403);
      const url = new URL(req.url, 'http://localhost');
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
        if (name.endsWith('.html')) res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self' http://127.0.0.1:* http://localhost:*");
        res.setHeader('Content-Type', mime(name)); res.end(bytes);
      }
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const known = error instanceof Failure;
      res.statusCode = known ? error.status : error.code === 'ENOENT' ? 404 : 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { code: known ? error.code : error.code === 'ENOENT' ? 'NOT_FOUND' : 'INTERNAL_ERROR', message: known ? error.message : 'Operation failed. Check the server configuration and asset integrity.' } }));
    }
  });
  return {
    store, dispatch,
    async listen() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve); });
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() { previews.clear(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
