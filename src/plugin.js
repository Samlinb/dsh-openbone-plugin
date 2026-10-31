import { clientTools as tools, scoped } from './tool-definitions.js';
import {clientFiles,clientFile,clientMime,validateClientAction} from './client-workbench.js';
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client';
import { fields, requireThat } from './errors.js';
import { trialConnection } from './trial.js';
import { connectionConfig } from './config.js';
import { randomUUID } from 'node:crypto';
export { Config } from './config.js';

export const name = 'openbone-studio';
export const inject = ['tools'];


/** Installs tools through DSH's existing MCP result/image adapter and scoped tool registry. */
export async function apply(ctx, raw) {
  const lifetime = new AbortController(), pending = new Set();
  let lastConnection;
  function currentConnection() {
    const config = connectionConfig(raw);
    if (!lastConnection || lastConnection.url.href !== config.url.href || lastConnection.token !== config.token || lastConnection.timeoutMs !== config.timeoutMs) {
      lastConnection = { ...config, enroll: trialConnection(ctx, config.url, { timeoutMs: config.timeoutMs, lifetime: lifetime.signal }) };
    }
    return lastConnection;
  }
  async function request(action, body, signal) {
    const { url, token, timeoutMs, enroll } = currentConnection();
    const connection = token ? { url, token } : await enroll();
    let response;
    try {
      response = await fetch(new URL(`v1/${action}`, connection.url), {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` },
        body: JSON.stringify(body), signal: AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch {
      requireThat(false, 'CONNECTION_FAILED', 'Cannot reach the OpenBone service. Check the saved service address and that it is reachable from the DSH server. Retry after the service is running; check Advanced settings if the request times out.');
    }
    let result;
    try { result = await response.json(); } catch {
      requireThat(false, 'INVALID_SERVICE_RESPONSE', 'This address did not return an OpenBone service response. Check the full service/account address with your administrator.');
    }
    requireThat(response.status !== 401 && response.status !== 403, 'ACCESS_DENIED', 'OpenBone access was denied. Check the account address and access key in OpenBone Studio settings. If your trial expired or access was revoked, contact your administrator.');
    requireThat(response.ok, result.error?.code ?? 'SERVICE_ERROR', result.error?.message ?? 'Private asset service request failed.');
    return result;
  }
  // Connection owns browser authentication, Host/Origin checks and owner access.
  // No endpoint or credential is accepted from the browser or returned to it.
  ctx.inject(['connection'], scope => {
    if (!scope.connection.fetch?.register) return;
    scope.effect(() => scope.connection.fetch.register({
      path: '/api/openbone-studio/check', methods: ['POST'], requestBody: 'buffered',
      async fetch(incoming) {
        const work = request('binding', { sessionId: `setup-${randomUUID()}` }, incoming.signal);
        pending.add(work);
        try {
          const result = await work;
          return Response.json({ connected: true, projectCount: result.availableProjects?.length ?? 0 });
        } catch (error) {
          return Response.json({ connected: false, code: error.code ?? 'SERVICE_ERROR' }, { status: 400 });
        } finally { pending.delete(work); }
      },
    }));
  });
  ctx.inject(['connection'],scope=>{
    if(!scope.connection.fetch?.register)return;
    for(const filename of clientFiles)scope.effect(()=>scope.connection.fetch.register({path:`/api/openbone-studio/client-ui/${filename}`,methods:['GET'],async fetch(){return new Response(await clientFile(filename),{headers:{'Content-Type':clientMime(filename),'Cache-Control':'no-store'}});}}));
    scope.effect(()=>scope.connection.fetch.register({path:'/api/openbone-studio/client-action',methods:['POST'],requestBody:'buffered',async fetch(incoming){
      const work=(async()=>{const raw=await incoming.text();requireThat(raw.length<=24*1024*1024,'TOO_LARGE','Client upload too large.');const input=JSON.parse(raw);fields(input,['action','body'],['action','body']);validateClientAction(input.action,input.body);return request(input.action,input.body,incoming.signal);})();pending.add(work);
      try{return Response.json(await work);}catch(error){return Response.json({error:{code:error.code??'CLIENT_ERROR',message:error.message}},{status:400});}finally{pending.delete(work);}
    }}));
  });
  ctx.inject(['connection'], scope => {
    if (!scope.connection.fetch?.register) return;
    scope.effect(() => scope.connection.fetch.register({path:'/api/openbone-studio/action',methods:['POST'],requestBody:'buffered',async fetch(incoming){
      const work=(async()=>{
        const raw=await incoming.text();requireThat(raw.length<=1600000,'INVALID_INPUT','Image or request too large.');
        const input=JSON.parse(raw);fields(input,['action','body'],['action','body']);
        requireThat(['new','bind','prepare','production','studio','assets-status','assets-inspect','preview'].includes(input.action),'INVALID_INPUT','Unsupported Studio action.');
        return request(input.action,input.body,incoming.signal);
      })();pending.add(work);
      try{return Response.json(await work);}catch(error){return Response.json({error:{code:error.code??'INVALID_INPUT',message:error.message}},{status:400});}finally{pending.delete(work);}
    }}));
  });
  ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled([...pending]); });
  for (const [name, action, description, inputSchema] of tools) {
    const definition = createMcpToolDefinition(ctx, {
      name, rawName: name, description, inputSchema,
      async call(args, execution) {
        fields(args, Object.keys(inputSchema.properties), inputSchema.required);
        const body = { ...args };
        if (scoped.has(action)) {
          requireThat(execution.agent?.id, 'AGENT_REQUIRED', 'This operation requires an owning DSH chat.');
          body.sessionId = execution.agent.id;
        }
        const work = (async () => {
          const result = action==='client-studio'?{clientUIPath:`/api/openbone-studio/client-ui/client-studio.html#session=${encodeURIComponent(body.sessionId)}`,message:'Open this browser workbench or the OpenBone sidebar. Images are processed in the browser.'}:await request(action==='prepare'?'client-state':action, body, execution.signal);
          return Array.isArray(result.content) ? result : { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { data: result } };
        })();
        pending.add(work);
        try { return await work; } finally { pending.delete(work); }
      },
    });
    ctx.effect(() => ctx.tools.register(definition));
  }
}



