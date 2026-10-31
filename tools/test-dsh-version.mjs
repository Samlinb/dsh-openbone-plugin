import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

// Exercise the published host packages without touching a user's DSH profile or local peers.
const version=process.argv[2]??'0.2.1-rc.3';
assert.ok(['0.2.1-rc.3','0.2.2-alpha.2'].includes(version),'Select a verified DSH version.');
const npmCli=process.env.npm_execpath;
assert.ok(npmCli,'Run through npm run test:dsh:version -- <version>.');
const root=await mkdtemp(path.join(tmpdir(),'openbone-dsh-compat-'));
async function run(args,env=process.env){
  const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(code,0,`Compatibility command failed for DSH ${version}.`);
}
try{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const cordis=version==='0.2.1-rc.3'?'4.0.5':'4.0.6-alpha.1';
  const dependencies=Object.fromEntries(['mcp-client','tools','system-prompt',...(version==='0.2.1-rc.3'?[]:['tool-executor-native'])].map(name=>[`@deepseek-ai/dsh-${name}`,version]));
  dependencies['@deepseek-ai/cordis']=cordis;
  dependencies.semver='7.7.2';
  Object.assign(dependencies, pkg.dependencies);
  await writeFile(path.join(root,'package.json'),JSON.stringify({private:true,type:'module',dependencies}));
  for(const dir of ['src','test','vendor','public'])await cp(new URL(`../${dir}/`,import.meta.url),path.join(root,dir),{recursive:true});
  await run([npmCli,'install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false']);
  const require=createRequire(path.join(root,'package.json'));
  const semver=require('semver');
  assert.ok(semver.satisfies(version,pkg.engines.dsh,{includePrerelease:true}));
  assert.ok(semver.satisfies(version,pkg.peerDependencies['@deepseek-ai/dsh-mcp-client']));
  assert.ok(semver.satisfies(cordis,pkg.peerDependencies['@deepseek-ai/cordis']));
  for(const rejected of ['0.2.1-rc.2','0.3.0'])assert.ok(!semver.satisfies(rejected,pkg.engines.dsh,{includePrerelease:true}));
  await run(['--test','test/plugin.test.js'],{...process.env,OPENBONE_DSH_PACKAGES:'1',OPENBONE_DSH_VERSION:version});
  console.log(`DSH ${version}: compatibility metadata and real host integration passed.`);
}finally{
  assert.equal(path.dirname(root),path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith('openbone-dsh-compat-'));
  await rm(root,{recursive:true,force:true});
}
