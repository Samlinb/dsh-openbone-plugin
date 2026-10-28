import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readFile,mkdir,writeFile,rename,rm,mkdtemp,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {json,hash,inventory,safeFile,inside,encode} from '../src/files.js';
import {requireThat} from '../src/errors.js';
import {verifyRuntime,bundledRuntimeRoot} from '../src/runtime.js';

const {values}=parseArgs({options:{source:{type:'string'},replace:{type:'boolean'}}});
requireThat(values.source,'INVALID_INPUT','Usage: node tools/bundle-runtime.mjs --source <OpenBone web-runtime directory> [--replace]');
const source=await realpath(values.source),pkg=await json(await safeFile(source,'package.json'));
const names=[...(await inventory(path.join(source,'src'))).filter(f=>/\.(?:js|d\.ts)$/.test(f.path)).map(f=>`src/${f.path}`),
  'package.json','README.md','README.zh-CN.md','CAPABILITIES.md','official/adapter.js','official/source.js','official/README.md','official/README.zh-CN.md',
  'official/dist/spine42.js','official/dist/spine43.js','official/dist/spine42-LICENSE.txt','official/dist/spine43-LICENSE.txt','official/dist/upstream.json'].sort();
const payload=new Map();for(const name of names)payload.set(name,await readFile(await safeFile(source,name)));
const upstream=JSON.parse(payload.get('official/dist/upstream.json'));
for(const key of ['spine42','spine43'])requireThat(hash(payload.get(`official/dist/${key}.js`))===upstream.files[key].sha256,'RUNTIME_INTEGRITY_FAILED','Official build differs from upstream receipt.');
const manifest={schemaVersion:1,module:pkg.name,version:pkg.version,source:'OpenBone/web-runtime',official:upstream,files:Object.fromEntries([...payload].map(([name,bytes])=>[name,hash(bytes)]))};
const target=path.resolve(bundledRuntimeRoot),parent=path.dirname(target);await mkdir(parent,{recursive:true});
const existing=(await readdir(parent)).includes(path.basename(target));
if(existing){
  const pinned=await verifyRuntime(target);
  if(encode(pinned.manifest)===encode(manifest)){console.log(JSON.stringify({version:pkg.version,files:payload.size,unchanged:true}));process.exit(0);}
  requireThat(values.replace,'RUNTIME_UPDATE_REQUIRES_REVIEW','Pinned runtime differs. Review the upstream change, then explicitly use --replace.');
}
const stage=await mkdtemp(path.join(parent,'.runtime-stage-'));let previous;
try{
  for(const [name,bytes]of payload){const output=path.join(stage,...name.split('/'));await mkdir(path.dirname(output),{recursive:true});await writeFile(output,bytes,{flag:'wx'});}
  await writeFile(path.join(stage,'BUNDLE.json'),encode(manifest),{flag:'wx'});await verifyRuntime(stage);
  for(const [name,bytes]of payload)requireThat(hash(await readFile(await safeFile(source,name)))===hash(bytes),'SOURCE_CHANGED','Runtime changed during bundling; no snapshot published.');
  if(existing){previous=`${stage}-previous`;await rename(target,previous);}
  try{await rename(stage,target);}catch(error){if(previous){await rename(previous,target);previous=null;}throw error;}
  console.log(JSON.stringify({version:pkg.version,files:payload.size,unchanged:false,manifestSHA256:hash(encode(manifest))}));
}finally{
  for(const directory of [stage,previous].filter(Boolean)){requireThat(inside(parent,path.resolve(directory))&&path.basename(directory).startsWith('.runtime-stage-'),'UNSAFE_PATH','Refused Runtime cleanup outside the vendor directory.');await rm(directory,{recursive:true,force:true});}
}
