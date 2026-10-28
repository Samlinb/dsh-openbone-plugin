import {parseArgs} from 'node:util';
import {realpath} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {LibraryStore} from '../src/store.js';
import {rebuildCatalog} from '../src/catalog.js';
import {json,inventory,hash,safeFile} from '../src/files.js';
import {readFile} from 'node:fs/promises';
const {values}=parseArgs({options:{'data-root':{type:'string'},source:{type:'string'}}});
if(!values['data-root'])throw new Error('Usage: node tools/verify-replica.mjs --data-root <replica> [--source <unchanged original library>]');
const store=await new LibraryStore(values['data-root']).init(),receipt=await json(await safeFile(store.root,'import-receipt.json'));
for(const row of store.catalog.works)await store.verify(row);
for(const item of receipt.originalFiles){
  const parts=item.path.split('/');let root,name;
  if(parts[0]==='works'){
    const row=store.work(parts[1]),section=['source','evidence'].includes(parts[2])?'assets':'records';
    root=path.join(store.root,section,row.workId,row.snapshotId);name=parts.slice(2).join('/');
  }else{root=path.join(store.root,'knowledge');name=item.path;}
  const bytes=await readFile(await safeFile(root,name));assert.equal(bytes.length,item.bytes,item.path);assert.equal(hash(bytes),item.sha256,item.path);
}
assert.deepEqual(await rebuildCatalog(store.root),store.catalog);
if(values.source)assert.deepEqual(await inventory(await realpath(values.source)),receipt.originalFiles,'Original library changed since import; do not overwrite either copy.');
console.log(JSON.stringify({works:store.catalog.works.length,files:receipt.originalFiles.length,replicaVerified:true,catalogRebuildMatches:true,originalUnchanged:!!values.source}));
