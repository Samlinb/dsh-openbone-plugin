import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,rm,mkdtemp,readdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {json,inside} from '../src/files.js';

// Run npm's JS entry directly so Windows needs neither cmd.exe nor shell quoting.
const npmCli=process.env.npm_execpath;
assert.ok(npmCli,'Run through npm run pack:release.');
const pkg=await json('package.json');
const destination=path.resolve(process.env.OPENBONE_RELEASE_DIR??'release');await mkdir(destination,{recursive:true});
assert.deepEqual(await readdir(destination),[],'release/ must be empty before preparing a release.');
async function run(program,args){
  const child=spawn(program,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert.equal(code,0,stderr);return stdout;
}
const report=JSON.parse(await run(process.execPath,[npmCli,'pack','--json','--pack-destination',destination]));
assert.equal(report.length,1);const item=report[0];
assert.equal(item.name,pkg.name);assert.equal(item.version,pkg.version);
const allowed=/^(?:src\/[a-z0-9-]+\.js|public\/(?:client-(?:studio\.(?:html|css|js)|pixels\.js|provider\.js)|viewer\.html|viewer\.js|engines\.js|authoring\.md|welcome(?:\.zh-CN)?\.md)|tools\/(?:serve|hosted)\.mjs|vendor\/web-runtime\/.+|locale\/(?:en|zh)\.json|examples\/server\.json|package\.json|cordis\.patch\.yml|README(?:\.zh-CN)?\.md)$/;
for(const file of item.files){
  assert.match(file.path,allowed,`Unapproved package file: ${file.path}`);
  assert.ok(!/(?:^|\/)(?:node_modules|evidence|workspaces|records|assets|\.env|\.npmrc)(?:\/|$)/.test(file.path),`Private data in package: ${file.path}`);
}
const extracted=await mkdtemp(path.join(tmpdir(),'openbone-package-audit-'));
try{
  await run('tar',['-xzf',path.join(destination,item.filename),'-C',extracted]);
  const root=path.join(extracted,'package');
  const {verifyRuntime}=await import(pathToFileURL(path.join(root,'src','runtime.js')).href);
  const runtime=await verifyRuntime();assert.ok(inside(await realpath(extracted),runtime.root));
  const extractedInfo=await json(path.join(root,'package.json'));assert.deepEqual(extractedInfo.dsh,pkg.dsh);
  await writeFile(path.join(destination,'audit.json'),JSON.stringify({package:pkg.name,version:pkg.version,filename:item.filename,integrity:item.integrity,files:item.files.map(f=>f.path),runtimeVersion:runtime.manifest.version,privateDataExcluded:true},null,2)+'\n');
  console.log(JSON.stringify({filename:item.filename,bytes:item.size,files:item.entryCount,runtimeVersion:runtime.manifest.version,privateDataExcluded:true}));
}finally{
  assert.ok(inside(path.resolve(tmpdir()),path.resolve(extracted))&&path.basename(extracted).startsWith('openbone-package-audit-'));
  await rm(extracted,{recursive:true,force:true});
}
