import { parseArgs } from 'node:util';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { LibraryStore } from '../src/store.js';
import { safeFile, writeJsonNew } from '../src/files.js';
import { requireThat } from '../src/errors.js';
const {values}=parseArgs({options:{'data-root':{type:'string'},project:{type:'string',multiple:true},output:{type:'string'},'mcp-port':{type:'string',default:'39873'},saved:{type:'boolean'}}});
requireThat(values['data-root']&&values.project?.length&&values.output,'INVALID_INPUT','Required: --data-root <replica> --project <projectId:TOKEN_ENV> (repeatable) --output <new projects.json> [--mcp-port 39873] [--saved]');
const port=Number(values['mcp-port']);requireThat(Number.isInteger(port)&&port>0&&port<=65535,'INVALID_INPUT','Invalid MCP port.');
const store=await new LibraryStore(values['data-root']).init(),projects=[],connections=[];
for(const pair of values.project){
  const [projectId,tokenEnv,...extra]=pair.split(':');requireThat(!extra.length&&/^[A-Z][A-Z0-9_]*$/.test(tokenEnv),'INVALID_INPUT','Expected projectId:TOKEN_ENV.');
  requireThat(!projects.some(p=>p.id===projectId),'INVALID_INPUT','Duplicate project.');
  const receipt=await store.project(projectId),root=await realpath(path.join(store.root,'workspaces',projectId));
  const source=values.saved?'saved.openbone.json':receipt.project;await safeFile(root,source);
  projects.push({id:projectId,root,source,tokenEnv});
  connections.push({projectId,url:`http://127.0.0.1:${port}/mcp/${projectId}`,tokenEnv});
}
await writeJsonNew(path.resolve(values.output),{projects});
console.log(JSON.stringify({projects:projects.map(p=>p.id),mcpPort:port,assetServiceProjects:connections},null,2));
