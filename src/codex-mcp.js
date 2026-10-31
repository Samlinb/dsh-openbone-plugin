import readline from 'node:readline';
import { lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { clientTools as tools, scoped } from './tool-definitions.js';
import {createClientWorkbench} from './client-workbench.js';
import { fields, requireThat } from './errors.js';
import { validAccessToken } from './trial.js';

const byName = new Map(tools.map(([name, action, description, inputSchema]) => [name, { name, action, description, inputSchema }]));
const workspaceSchema = { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', minLength: 1, maxLength: 80, description: 'Stable user-chosen workspace ID. Use a distinct ID for each independent Codex task; reuse it to resume.' };
export function listTools() {
  return tools.map(([name, action, description, schema]) => ({
    name,
    description: description.replaceAll('this chat’s', 'the selected workspace’s').replaceAll('this chat', 'the selected workspace').replaceAll('DSH tools', 'tools').replaceAll('DSH and cannot be selected by the model', 'the workspace argument; separate workspaces are not access-control boundaries'),
    inputSchema: scoped.has(action) ? { ...schema, properties: { workspace: workspaceSchema, ...schema.properties }, required: ['workspace', ...schema.required] } : schema,
  }));
}
function connection(env, configFile = path.join(homedir(), '.openbone', 'codex.json')) {
  let address = env.OPENBONE_LIBRARY_URL, token = env.OPENBONE_LIBRARY_TOKEN;
  requireThat(Boolean(address) === Boolean(token), 'INVALID_CONFIG', 'Set both OpenBone environment values or neither.');
  if (!address) {
    const file = configFile;
    try {
      const stat = lstatSync(file);
      requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16384, 'INVALID_CONFIG', 'The OpenBone account configuration must be a regular file under 16 KiB.');
      const config = JSON.parse(readFileSync(file, 'utf8'));
      fields(config, ['serviceUrl', 'accessToken'], ['serviceUrl', 'accessToken']);
      address = config.serviceUrl; token = config.accessToken;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Cannot read the OpenBone account configuration. Check ~/.openbone/codex.json.');
    }
  }
  let url;
  try { url = new URL(address || ''); } catch { throw new Error('Configure the OpenBone account URL in ~/.openbone/codex.json or OPENBONE_LIBRARY_URL.'); }
  requireThat((url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) && /^\/(?:[a-z0-9-]+\/)*$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password, 'INVALID_CONFIG', 'Use an HTTPS account URL ending in / (HTTP only for localhost), without embedded credentials.');
  requireThat(validAccessToken(token), 'INVALID_CONFIG', 'Set OPENBONE_LIBRARY_TOKEN to the administrator-provided access key.');
  return { url, token };
}
export async function callTool(name, args, { env = process.env, signal, configFile } = {}) {
  const def = byName.get(name);
  requireThat(def, 'UNKNOWN_TOOL', 'Unknown OpenBone tool.');
  const isScoped = scoped.has(def.action);
  fields(args, [...Object.keys(def.inputSchema.properties), ...(isScoped ? ['workspace'] : [])], [...def.inputSchema.required, ...(isScoped ? ['workspace'] : [])]);
  const { workspace, ...body } = args;
  if (isScoped) {
    requireThat(typeof workspace === 'string' && workspace.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspace), 'INVALID_WORKSPACE', 'Workspace must be 1–80 lowercase letters, digits and single hyphens.');
    body.sessionId = `codex-${workspace}`;
  }
  if(def.action==='client-studio'){
    workbench??=await createClientWorkbench((action,body,signal)=>requestService(action,body,{env,signal,configFile}));
    const result=workbench.open(workspace);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:{data:result}};
  }
  const result=await requestService(def.action==='prepare'?'client-state':def.action,body,{env,signal,configFile});
  return Array.isArray(result.content) ? result : { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { data: result } };
}
let workbench;
export async function closeClientWorkbench(){if(workbench){await workbench.close();workbench=undefined;}}
export async function requestService(action,body,{env=process.env,signal,configFile}={}){
  const { url, token } = connection(env, configFile);
  let response;
  try {
    response = await fetch(new URL(`v1/${action}`, url), { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]) });
  } catch { throw new Error('Cannot reach OpenBone. Check the configured account URL and network connection.'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('OpenBone returned an invalid response.'); }
  requireThat(response.ok, result.error?.code ?? 'SERVICE_ERROR', response.status === 401 || response.status === 403 ? 'OpenBone access denied. Check the account URL and access key.' : (result.error?.message ?? 'OpenBone service request failed.'));
  return result;
}
export function start(input = process.stdin, output = process.stdout) {
  const requests = new Map();
  const send = message => output.write(`${JSON.stringify(message)}\n`);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { send({ jsonrpc:'2.0', id:null, error:{ code:-32700, message:'Parse error' } }); return; }
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') { send({ jsonrpc:'2.0', id:message?.id ?? null, error:{ code:-32600, message:'Invalid request' } }); return; }
    if (message.method === 'notifications/cancelled') { requests.get(message.params?.requestId)?.abort(); return; }
    if (!Object.hasOwn(message, 'id')) return;
    const { id, method, params } = message;
    const controller = new AbortController(); requests.set(id, controller);
    (async () => {
      if (method === 'initialize') return { protocolVersion: ['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(params?.protocolVersion) ? params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name:'openbone-codex', version:'0.1.0' } };
      if (method === 'ping') return {};
      if (method === 'tools/list') return { tools: listTools() };
      if (method === 'tools/call') {
        try { return await callTool(params?.name, params?.arguments ?? {}, { signal: controller.signal }); }
        catch (error) { return { isError:true, content:[{ type:'text', text: `${error.code ?? 'OPENBONE_ERROR'}: ${error.message}` }] }; }
      }
      throw Object.assign(new Error('Method not found'), { rpcCode:-32601 });
    })().then(result => send({ jsonrpc:'2.0', id, result }), error => send({ jsonrpc:'2.0', id, error:{ code:error.rpcCode ?? -32603, message:error.message } })).finally(() => requests.delete(id));
  });
  lines.on('close', () => { for (const controller of requests.values()) controller.abort();void closeClientWorkbench(); });
  return lines;
}
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) start();
