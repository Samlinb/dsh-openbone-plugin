import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
function guard(overrides={}){
  const env={...process.env,GITHUB_EVENT_NAME:'release',GITHUB_REPOSITORY:'Samlinb/dsh-openbone-plugin',RELEASE_TAG:`v${pkg.version}`,RELEASE_IS_PRERELEASE:String(pkg.version.includes('-')),...overrides};
  delete env.GITHUB_OUTPUT;
  return spawnSync(process.execPath,['tools/verify-release.mjs'],{encoding:'utf8',env});
}
test('release guard admits exactly the matching package tag in the owning repository',()=>{
  const result=guard();assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).publish,true);
});
test('release guard rejects a mismatched release tag',()=>{
  assert.notEqual(guard({RELEASE_TAG:'v999.0.0'}).status,0);
});
test('release guard rejects publishing a release from a fork',()=>{
  assert.notEqual(guard({GITHUB_REPOSITORY:'someone/fork'}).status,0);
});
test('release guard rejects a mismatched prerelease flag',()=>{
  assert.notEqual(guard({RELEASE_IS_PRERELEASE:String(!pkg.version.includes('-'))}).status,0);
});
test('manual validation never marks the package for publication',()=>{
  const result=guard({GITHUB_EVENT_NAME:'workflow_dispatch'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).publish,false);
});
function planner(target,...flags){
  const env={...process.env};delete env.GITHUB_OUTPUT;delete env.npm_execpath;
  return spawnSync(process.execPath,['tools/release.mjs',target,'--dry-run','--skip-gates','--allow-dirty',...flags],{encoding:'utf8',env});
}
const git=command=>spawnSync('git',[command],{encoding:'utf8'}).stdout;
const manifest=new URL('../package.json',import.meta.url);
const [major,minor,patch]=pkg.version.split('-')[0].split('.').map(Number);
const pre=pkg.version.includes('-')?pkg.version.slice(pkg.version.indexOf('-')+1):null;
const expected={
  major:`${major+1}.0.0`,
  minor:`${major}.${minor+1}.0`,
  patch:pre?`${major}.${minor}.${patch}`:`${major}.${minor}.${patch+1}`,
  prerelease:pre&&/^beta\.\d+$/.test(pre)?`${major}.${minor}.${patch}-beta.${+pre.slice(5)+1}`:`${major}.${minor}.${patch+1}-beta.0`,
};
test('release planner resolves every bump target to the matching tag',()=>{
  for(const [target,version] of Object.entries(expected)){
    const result=planner(target);assert.equal(result.status,0,`${target}: ${result.stderr}`);
    const summary=JSON.parse(result.stdout);
    assert.equal(summary.version,version);assert.equal(summary.tag,`v${version}`);
    assert.equal(summary.previousVersion,pkg.version);assert.equal(summary.dryRun,true);assert.equal(summary.pushed,false);
  }
});
test('release planner refuses a target that does not advance the package',()=>{
  for(const target of [pkg.version,'0.0.1','v1.2.3','not-a-version'])assert.notEqual(planner(target).status,0,target);
});
test('a dry run leaves the manifest, the tags and the index untouched',()=>{
  const before=readFileSync(manifest,'utf8'),tags=git('tag');
  const result=planner('99.99.99');assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).tag,'v99.99.99');
  assert.equal(readFileSync(manifest,'utf8'),before);assert.equal(git('tag'),tags);
});
test('an explicit prerelease identifier is carried into the tag',()=>{
  const result=planner('1.2.3-rc.1');assert.equal(result.status,0,result.stderr);
  const summary=JSON.parse(result.stdout);
  assert.equal(summary.version,'1.2.3-rc.1');assert.equal(summary.tag,'v1.2.3-rc.1');
});
