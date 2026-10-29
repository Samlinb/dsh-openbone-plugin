import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

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
const git=(...args)=>spawnSync('git',args,{encoding:'utf8'}).stdout;
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

test('publishing dry run plans the verified GitHub release and stable npm tag without mutation',()=>{
  const before=readFileSync(manifest,'utf8'),tags=git('tag'),index=git('diff','--cached','--raw');
  const result=planner('99.99.99','--publish');assert.equal(result.status,0,result.stderr);
  const summary=JSON.parse(result.stdout);
  assert.equal(summary.publishRequested,true);assert.equal(summary.releaseCreated,false);
  assert.equal(summary.distTag,'latest');assert.equal(summary.pushed,false);
  assert.ok(summary.releaseCommand.includes('--verify-tag'));
  assert.ok(summary.releaseCommand.includes('--notes-from-tag'));
  assert.ok(!summary.releaseCommand.includes('--prerelease'));
  assert.equal(readFileSync(manifest,'utf8'),before);assert.equal(git('tag'),tags);assert.equal(git('diff','--cached','--raw'),index);
});

test('prerelease publishing plans next without marking the GitHub release latest',()=>{
  const result=planner('99.99.99-rc.1','--publish');assert.equal(result.status,0,result.stderr);
  const summary=JSON.parse(result.stdout);
  assert.equal(summary.distTag,'next');assert.ok(summary.releaseCommand.includes('--prerelease'));
  assert.ok(summary.releaseCommand.includes('--latest=false'));
});

test('local release updates only the version, commits it and creates the matching annotated tag',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'openbone-release-test-'));
  const command=(...args)=>{
    const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);return result.stdout.trim();
  };
  try{
    for(const dir of ['tools','src'])mkdirSync(path.join(root,dir));
    for(const file of ['tools/release.mjs','tools/verify-release.mjs','src/errors.js','src/files.js'])copyFileSync(new URL('../'+file,import.meta.url),path.join(root,file));
    const initial=JSON.stringify({...pkg,version:'1.2.3'},null,2)+'\n';
    writeFileSync(path.join(root,'package.json'),initial);
    command('init');command('config','user.name','Release Test');command('config','user.email','release@example.invalid');
    command('add','.');command('commit','-m','fixture');
    const result=spawnSync(process.execPath,['tools/release.mjs','--skip-gates'],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).version,'1.2.4');
    assert.equal(readFileSync(path.join(root,'package.json'),'utf8'),initial.replace('"version": "1.2.3"','"version": "1.2.4"'));
    assert.equal(command('show','--format=','--name-only','HEAD'),'package.json');
    assert.equal(command('cat-file','-t','refs/tags/v1.2.4'),'tag');
    assert.equal(command('rev-parse','v1.2.4^{}'),command('rev-parse','HEAD'));
    assert.equal(command('status','--porcelain'),'');
    writeFileSync(path.join(root,'uncommitted.txt'),'pending work');
    const rejected=spawnSync(process.execPath,['tools/release.mjs','--publish','--allow-dirty'],{cwd:root,encoding:'utf8'});
    assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/GIT_DIRTY/);
    assert.equal(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version,'1.2.4');
    assert.equal(command('tag'),'v1.2.4');
  }finally{rmSync(root,{recursive:true,force:true});}
});
