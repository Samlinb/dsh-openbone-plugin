import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {verifyRuntime,bundledRuntimeRoot} from '../src/runtime.js';
import {createAssetService} from '../src/server.js';
import {fixture} from './helpers.js';

test('built-in Runtime pins independent and official modules, types and license notices',async()=>{
  const runtime=await verifyRuntime();assert.equal(runtime.root,path.resolve(bundledRuntimeRoot));assert.equal(runtime.manifest.version,'0.2.0');
  for(const name of ['src/index.d.ts','official/dist/spine42-LICENSE.txt','official/dist/spine43-LICENSE.txt'])assert.ok(runtime.manifest.files[name]);
  assert.ok(!Object.keys(runtime.manifest.files).some(name=>/node_modules|demo|\.png$|test\//.test(name)));
});
test('runtime tampering is rejected before opening an asset-service listener',async t=>{
  const f=await fixture(t),copy=path.join(f.root,'runtime');await cp(bundledRuntimeRoot,copy,{recursive:true});
  await writeFile(path.join(copy,'src','index.js'),'throw new Error("tampered");');
  await assert.rejects(createAssetService({dataRoot:f.destination,runtimeRoot:copy,port:0,publicUrl:'http://127.0.0.1',tokenEnv:'TEST_TOKEN',projects:[]},{env:{TEST_TOKEN:'t'.repeat(40)}}),{code:'RUNTIME_INTEGRITY_FAILED'});
});
