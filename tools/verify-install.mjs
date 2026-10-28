import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {json} from '../src/files.js';
const checkout=path.resolve(process.env.DSH_CHECKOUT??path.resolve('../dsh'));
const yaml=createRequire(path.join(checkout,'package.json'))('js-yaml');
const yamlSchema=yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:value=>value})]);
const taskHome=await mkdtemp(path.join(tmpdir(),'openbone-plugin-install-'));
const env={...process.env,DSH_HOME:taskHome,OPENBONE_LIBRARY_URL:'http://127.0.0.1:39872'};
const packageInfo=await json('package.json');
const pack=path.resolve(`dsh-openbone-plugin-${packageInfo.version}.tgz`);
async function cli(args){
  const child=spawn(process.execPath,['--import','tsx/esm','apps/cli/src/bin.ts',...args],{cwd:checkout,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{errors+=b;});
  const code=await new Promise((r,j)=>{child.once('error',j);child.once('exit',r);});
  assert.equal(code,0,`DSH ${args[0]} failed: ${errors}\n${output}`);return output;
}
try{
  const extracted=path.join(taskHome,'extracted');await mkdir(extracted);
  const unpack=spawn('tar',['-xzf',pack,'-C',extracted],{windowsHide:true,stdio:'ignore'});
  const unpacked=await new Promise((r,j)=>{unpack.once('error',j);unpack.once('exit',r);});assert.equal(unpacked,0);
  const {verifyRuntime}=await import(pathToFileURL(path.join(extracted,'package','src','runtime.js')).href);
  const runtime=await verifyRuntime();assert.ok(runtime.root.startsWith(extracted));
  await cli(['--profile','openbone-acceptance','--from-default-profile','web','--dump-config']);
  await cli(['plugin','--profile','openbone-acceptance','add',pack,'--ignore-scripts']);
  const profile=await json(path.join(taskHome,'profiles','openbone-acceptance','package.json'));
  assert.ok(profile.dsh.profile.bundles.includes('dsh-openbone-plugin'));
  const dump=await cli(['--profile','openbone-acceptance','--dump-config']);
  const rows=yaml.load(dump,{schema:yamlSchema});
  assert.ok(rows.some(row=>row.name==='dsh-openbone-plugin'));
  assert.equal(rows.find(row=>row.id==='session-log-deepseek').config.enabled,false);
  assert.equal(rows.find(row=>row.id==='session-telemetry-otel').config.mode,'DISABLED');
  await mkdir('evidence',{recursive:true});
  const receipt={checkedAt:new Date().toISOString(),pluginVersion:packageInfo.version,bundledRuntimeVersion:runtime.manifest.version,extractedRuntimeVerified:true,supportedCliInstall:true,webProfileComposition:true,pluginBundlePresent:true,sessionLogUploadDisabled:true,sessionOtelDisabled:true,usedTemporaryDshHome:true};
  await writeFile('evidence/install-receipt.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
}finally{
  const resolved=path.resolve(taskHome);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('openbone-plugin-install-'));await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
