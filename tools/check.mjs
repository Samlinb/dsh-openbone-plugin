import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { json } from '../src/files.js';
import {verifyRuntime} from '../src/runtime.js';
const pkg=await json('package.json');
assert.equal(pkg.type,'module');assert.ok(pkg.dsh.bundle.patch);assert.ok(!pkg.bin);
async function check(dir){for(const item of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())await check(file);else if(/\.(?:js|mjs)$/.test(file)){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}}}
for(const dir of ['src','public','test','tools'])await check(dir);
const runtime=await verifyRuntime();
const en=await json('locale/en.json'),zh=await json('locale/zh.json');assert.deepEqual(Object.keys(en.meta),Object.keys(zh.meta));
console.error(`Package metadata, ESM syntax, locale keys and bundled Runtime ${runtime.manifest.version} integrity passed.`);
