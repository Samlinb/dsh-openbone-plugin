import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,realpath} from 'node:fs/promises';
import {json,hash,safeFile,relativeName,inventory} from './files.js';
import {requireThat} from './errors.js';

export const bundledRuntimeRoot=fileURLToPath(new URL('../vendor/web-runtime/',import.meta.url));
/** Verify the pinned runtime distribution before serving any of its executable modules. */
export async function verifyRuntime(directory=bundledRuntimeRoot){
  const root=await realpath(directory),manifest=await json(await safeFile(root,'BUNDLE.json'));
  requireThat(manifest.schemaVersion===1 && typeof manifest.version==='string' && manifest.files && typeof manifest.files==='object' && !Array.isArray(manifest.files),'INVALID_RUNTIME','Unsupported Runtime distribution manifest.');
  for(const required of ['src/index.js','src/index.d.ts','official/adapter.js','official/source.js','official/dist/spine42.js','official/dist/spine43.js','official/dist/spine42-LICENSE.txt','official/dist/spine43-LICENSE.txt','official/dist/upstream.json'])requireThat(Object.hasOwn(manifest.files,required),'INVALID_RUNTIME','Runtime distribution is incomplete.');
  for(const [name,sha]of Object.entries(manifest.files)){
    relativeName(name);requireThat(/^[a-f0-9]{64}$/.test(sha),'INVALID_RUNTIME','Invalid Runtime checksum.');
    requireThat(hash(await readFile(await safeFile(root,name)))===sha,'RUNTIME_INTEGRITY_FAILED','Runtime distribution differs from its pinned checksum.');
  }
  const pkg=await json(await safeFile(root,'package.json'));
  requireThat(pkg.version===manifest.version,'INVALID_RUNTIME','Runtime version identity differs.');
  const actual=await inventory(root);
  requireThat(actual.length===Object.keys(manifest.files).length+1 && actual.every(f=>f.path==='BUNDLE.json'||Object.hasOwn(manifest.files,f.path)),'INVALID_RUNTIME','Runtime distribution contains unlisted files.');
  return {root,manifest};
}
