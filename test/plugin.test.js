import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import * as Plugin from '../src/plugin.js';
import { fixture } from './helpers.js';
import { createAssetService } from '../src/server.js';

const checkout=process.env.DSH_CHECKOUT??path.resolve('../dsh');
const moduleAt=relative=>import(pathToFileURL(path.join(checkout,relative)).href);
test('real Cordis registry/native executor expose canonical MCP results, validate input and dispose tools',async t=>{
  const f=await fixture(t),token='test_dsh_credential_'.padEnd(40,'x');
  const service=await createAssetService({dataRoot:f.destination,port:0,publicUrl:'http://127.0.0.1',tokenEnv:'TEST_SERVICE_TOKEN',projects:[]},{env:{TEST_SERVICE_TOKEN:token}});
  const url=await service.listen();t.after(()=>service.close());
  const [{default:SystemPrompt},{default:Tools},Native]=await Promise.all([moduleAt('packages/core/system-prompt/lib/index.js'),moduleAt('packages/core/tools/lib/index.js'),moduleAt('packages/core/tool-executor-native/lib/index.js')]);
  const ctx=new Context();t.after(()=>ctx.fiber.dispose());await ctx.plugin(SystemPrompt);await ctx.plugin(Tools);await ctx.plugin(Native);
  process.env.TEST_PLUGIN_TOKEN=token;t.after(()=>delete process.env.TEST_PLUGIN_TOKEN);
  const fork=ctx.plugin(Plugin,{serviceUrl:url,tokenEnv:'TEST_PLUGIN_TOKEN',timeoutMs:2000});await fork;
  assert.equal(ctx.tools.schemas().length,11);assert.equal((await ctx.systemPrompt.assemble()).tools.length,11);
  const run=async(name,args,agent)=>{const batch=await ctx.tools.execute({signal:new AbortController().signal,...(agent?{agent}:{}),calls:[{type:'tool-call',id:'test-call',name,arguments:JSON.stringify(args)}]});return batch.results[0].result;};
  const result=await run('openbone_knowledge_search',{query:'walk'});assert.equal(result.isError,false);assert.equal(result.value.structuredContent.data.works[0].status,'rejected');
  const invalid=await run('openbone_knowledge_search',{limit:101});assert.equal(invalid.isError,true);
  const forbidden=await run('openbone_project_binding',{});assert.equal(forbidden.isError,true);assert.match(JSON.stringify(forbidden.content),/owning DSH chat/);
  const owner={id:'chat-a',ctx};const bound=await run('openbone_project_binding',{},owner);assert.equal(bound.isError,false);assert.equal(bound.value.structuredContent.data.binding,null);
  const injection=await run('openbone_project_binding',{sessionId:'chat-b'},owner);assert.equal(injection.isError,true);
  await fork.dispose();assert.equal(ctx.tools.schemas().length,0);
});
