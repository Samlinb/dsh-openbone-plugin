import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.js';
import { createAssetService } from '../src/server.js';
import { callTool, listTools } from '../src/codex-mcp.js';

test('Codex adapter uses real authenticated service and separates named workspaces', async t => {
  const f=await fixture(t), token='test_codex_credential_'.padEnd(40,'x');
  const service=await createAssetService({dataRoot:f.destination,port:0,publicUrl:'http://127.0.0.1/u/test/',tokenEnv:'TEST_SERVICE_TOKEN',projects:[]},{env:{TEST_SERVICE_TOKEN:token}});
  const url=await service.listen();t.after(()=>service.close());
  const env={OPENBONE_LIBRARY_URL:`${url}/u/test/`,OPENBONE_LIBRARY_TOKEN:token};
  assert.equal(listTools().length,17);
  const configFile=path.join(f.root,'codex.json');
  await writeFile(configFile,JSON.stringify({serviceUrl:env.OPENBONE_LIBRARY_URL,accessToken:token}));
  assert.equal((await callTool('openbone_project_binding',{workspace:'from-file'},{env:{},configFile})).structuredContent.data.binding,null);
  await assert.rejects(callTool('openbone_project_binding',{workspace:'task-a'},{env:{OPENBONE_LIBRARY_URL:env.OPENBONE_LIBRARY_URL},configFile}),/both/);
  const a=await callTool('openbone_project_binding',{workspace:'task-a'},{env});
  assert.equal(a.structuredContent.data.binding,null);
  await callTool('openbone_project_create',{workId:'example-walk',snapshotId:f.snapshotId,projectId:'fixture-project'},{env});
  await service.store.bind('codex-task-a','fixture-project',null);
  assert.equal((await callTool('openbone_project_binding',{workspace:'task-a'},{env})).structuredContent.data.binding.projectId,'fixture-project');
  const b=await callTool('openbone_project_binding',{workspace:'task-b'},{env});
  assert.equal(b.structuredContent.data.binding,null);
  assert.equal((await service.store.binding('codex-task-a')).projectId,'fixture-project');
  await assert.rejects(callTool('openbone_project_binding',{workspace:'../bad'},{env}),/Workspace/);
  await assert.rejects(callTool('openbone_project_binding',{workspace:'task-a',sessionId:'task-b'},{env}),/unknown fields/);
  await assert.rejects(callTool('openbone_knowledge_search',{}, {env:{...env,OPENBONE_LIBRARY_TOKEN:'wrong'}}),/access key/);
});

test('stdio MCP initializes, discovers tools and returns safe configuration error', async t => {
  const child=spawn(process.execPath,['src/codex-mcp.js'],{stdio:['pipe','pipe','pipe'],env:{...process.env,OPENBONE_LIBRARY_URL:'invalid',OPENBONE_LIBRARY_TOKEN:'x'.repeat(40)}});
  t.after(()=>child.kill());
  const lines=readline.createInterface({input:child.stdout});const pending=new Map();
  lines.on('line',line=>{const msg=JSON.parse(line);pending.get(msg.id)?.(msg);pending.delete(msg.id);});
  const request=(id,method,params={})=>new Promise(resolve=>{pending.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  assert.equal((await request(1,'initialize',{protocolVersion:'2025-06-18'})).result.protocolVersion,'2025-06-18');
  const tools=(await request(2,'tools/list')).result.tools;
  assert.equal(tools.length,17);assert.ok(tools.find(x=>x.name==='openbone_project_binding').inputSchema.required.includes('workspace'));
  const result=(await request(3,'tools/call',{name:'openbone_project_binding',arguments:{workspace:'task-a'}})).result;
  assert.equal(result.isError,true);assert.match(result.content[0].text,/OPENBONE_LIBRARY_URL/);
});
