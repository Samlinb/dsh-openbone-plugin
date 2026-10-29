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
