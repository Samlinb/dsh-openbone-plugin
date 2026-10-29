import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ReleasePublisher,githubCredential} from '../tools/release-publish.mjs';
import {publishArtifact} from '../tools/npm-publish-artifact.mjs';

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
  assert.equal(summary.releaseRequest.verifyTagCommit,true);
  assert.equal(summary.releaseRequest.tag,'v99.99.99');
  assert.equal(summary.releaseRequest.prerelease,false);
  assert.equal(readFileSync(manifest,'utf8'),before);assert.equal(git('tag'),tags);assert.equal(git('diff','--cached','--raw'),index);
});

test('prerelease publishing plans next without marking the GitHub release latest',()=>{
  const result=planner('99.99.99-rc.1','--publish');assert.equal(result.status,0,result.stderr);
  const summary=JSON.parse(result.stdout);
  assert.equal(summary.distTag,'next');assert.equal(summary.releaseRequest.prerelease,true);
});

test('local release updates only the version, commits it and creates the matching annotated tag',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'openbone-release-test-'));
  const command=(...args)=>{
    const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);return result.stdout.trim();
  };
  try{
    for(const dir of ['tools','src'])mkdirSync(path.join(root,dir));
    for(const file of ['tools/release.mjs','tools/release-publish.mjs','tools/verify-release.mjs','src/errors.js','src/files.js'])copyFileSync(new URL('../'+file,import.meta.url),path.join(root,file));
    const initial=JSON.stringify({...pkg,version:'1.2.3'},null,2)+'\n';
    writeFileSync(path.join(root,'package.json'),initial);
    command('init');command('config','user.name','Release Test');command('config','user.email','release@example.invalid');
    command('remote','add','origin',pkg.repository.url.replace(/^git\+/,''));
    command('add','.');command('commit','-m','fixture');
    const result=spawnSync(process.execPath,['tools/release.mjs','--skip-gates'],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).version,'1.2.4');
    assert.equal(readFileSync(path.join(root,'package.json'),'utf8'),initial.replace('"version": "1.2.3"','"version": "1.2.4"'));
    assert.equal(command('show','--format=','--name-only','HEAD'),'package.json');
    assert.equal(command('cat-file','-t','refs/tags/v1.2.4'),'tag');
    assert.equal(command('rev-parse','v1.2.4^{}'),command('rev-parse','HEAD'));
    assert.equal(command('status','--porcelain'),'');
    const beforeResume=command('rev-parse','HEAD');
    const resume=spawnSync(process.execPath,['tools/release.mjs','--resume','--dry-run','--skip-gates'],{cwd:root,encoding:'utf8'});
    assert.equal(resume.status,0,resume.stderr);
    assert.equal(JSON.parse(resume.stdout).version,'1.2.4');
    assert.equal(JSON.parse(resume.stdout).resume,true);
    writeFileSync(path.join(root,'.git','openbone-release-state.json'),JSON.stringify({version:'1.2.4',tag:'v1.2.4',complete:false}));
    const pending=spawnSync(process.execPath,['tools/release.mjs','--publish'],{cwd:root,encoding:'utf8'});
    assert.notEqual(pending.status,0);assert.match(pending.stderr,/RELEASE_PENDING/);
    assert.equal(command('rev-parse','HEAD'),beforeResume);
    assert.equal(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version,'1.2.4');
    assert.equal(command('tag'),'v1.2.4');
    writeFileSync(path.join(root,'uncommitted.txt'),'pending work');
    const rejected=spawnSync(process.execPath,['tools/release.mjs','--publish','--allow-dirty'],{cwd:root,encoding:'utf8'});
    assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/GIT_DIRTY/);
    assert.equal(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version,'1.2.4');
    assert.equal(command('tag'),'v1.2.4');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('GitHub authentication uses existing Git credentials when gh is unavailable without exposing secrets',()=>{
  const calls=[];
  const token=githubCredential({},(program,args,options)=>{
    calls.push({program,args});
    if(program==='gh')return {status:null,error:new Error('not installed')};
    assert.equal(options.input,'protocol=https\nhost=github.com\n\n');
    assert.equal(options.env.GIT_TERMINAL_PROMPT,'0');
    return {status:0,stdout:'protocol=https\nhost=github.com\nusername=fixture\npassword=fixture-secret\n'};
  });
  assert.equal(token,'fixture-secret');assert.equal(calls.length,2);
  assert.equal(githubCredential({GH_TOKEN:'explicit'},()=>assert.fail('No subprocess needed')),'explicit');
  assert.throws(()=>githubCredential({},()=>({status:1,stdout:''})),{code:'GH_AUTH_REQUIRED'});
});

function publicationFixture({steps,publicInitially=false,corrupt=false,tagCommit='abc123',lostCreateResponse=false}={}){
  const bytes=Buffer.from('audited fixture package'),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
  const state={release:null,public:publicInitially,calls:[],logs:[],clock:0,polls:0,reruns:0,dispatches:0};
  const response=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status});
  const fetchImpl=async(address,options={})=>{
    const url=new URL(address),endpoint=url.pathname,method=options.method??'GET';
    state.calls.push({method,path:endpoint});
    if(url.hostname==='registry.npmjs.org'){
      assert.equal(options.headers?.Authorization,undefined,'GitHub credential must never reach npm');
      if(endpoint.endsWith('.tgz'))return new Response(corrupt?Buffer.from('corrupt'):bytes);
      return state.public?response({name:'fixture-plugin',version:'1.2.4',dist:{integrity,tarball:'https://registry.npmjs.org/fixture-plugin/-/fixture-plugin-1.2.4.tgz'}}):response({},404);
    }
    assert.equal(options.headers.Authorization,'Bearer fixture-secret');
    const route=endpoint.replace('/repos/owner/plugin','');
    if(route==='')return response({permissions:{push:true},archived:false});
    if(route==='/actions/workflows/npm-publish.yml')return response({state:'active'});
    if(route==='/git/ref/tags/v1.2.4')return response({object:{type:'tag',sha:'annotated'}});
    if(route==='/git/tags/annotated')return response({object:{type:'commit',sha:tagCommit}});
    if(route==='/releases/tags/v1.2.4')return state.release?response(state.release):response({},404);
    if(route==='/releases'&&method==='POST'){
      const body=JSON.parse(options.body);
      state.release={id:42,html_url:'https://github.com/owner/plugin/releases/tag/v1.2.4',...body};
      if(lostCreateResponse)throw new Error('response lost after creation');
      return response(state.release,201);
    }
    if(route==='/actions/workflows/npm-publish.yml/runs'){
      const step=steps?steps(state):state.polls++===0?{status:'in_progress'}:{status:'completed',conclusion:'success'};
      if(step?.conclusion==='success')state.public=true;
      return response({workflow_runs:step?[{id:7,head_sha:'abc123',event:'release',run_attempt:state.reruns+1,html_url:'https://github.com/owner/plugin/actions/runs/7',...step}]:[]});
    }
    if(route==='/actions/runs/7/rerun-failed-jobs'&&method==='POST'){state.reruns++;return response({},201);}
    if(route==='/actions/workflows/npm-publish.yml/dispatches'&&method==='POST'){
      assert.deepEqual(JSON.parse(options.body),{ref:'v1.2.4',inputs:{release_tag:'v1.2.4'}});state.dispatches++;return response({},204);
    }
    assert.fail(`Unexpected request: ${method} ${route}`);
  };
  const publisher=new ReleasePublisher({repo:'owner/plugin',token:'fixture-secret',fetchImpl,now:()=>state.clock,sleep:async ms=>{state.clock+=ms;},timeoutMs:100,pollMs:10,log:message=>state.logs.push(message)});
  const release={tag:'v1.2.4',commit:'abc123',name:'fixture-plugin',version:'1.2.4',prerelease:false,notes:'fixture release'};
  return {publisher,state,release,fetchImpl,bytes,integrity};
}

test('publication creates a verified Release, waits for workflow success and checks actual public tarball bytes',async()=>{
  const {publisher,state,release}=publicationFixture();
  await publisher.preflight();
  const result=await publisher.finish(release);
  assert.equal(result.npm.version,'1.2.4');assert(result.workflowUrl);
  assert.equal(state.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/releases')).length,1);
  assert(!state.logs.join().includes('fixture-secret'));
});

test('tag mismatch prevents Release creation and npm publication',async()=>{
  const {publisher,state,release}=publicationFixture({tagCommit:'different'});
  await assert.rejects(publisher.finish(release),{code:'TAG_COMMIT_MISMATCH'});
  assert.equal(state.calls.filter(c=>c.method==='POST').length,0);
});

test('lost Release creation response is recovered without duplicate creation',async()=>{
  const {publisher,state,release}=publicationFixture({lostCreateResponse:true});
  assert.equal((await publisher.finish(release)).npm.version,'1.2.4');
  assert.equal(state.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/releases')).length,1);
});

test('same-version resume retries a failed workflow and reuses the existing Release',async()=>{
  const {publisher,state,release}=publicationFixture({steps:s=>s.reruns?{status:'completed',conclusion:'success'}:{status:'completed',conclusion:'failure'}});
  await assert.rejects(publisher.finish(release),{code:'NPM_WORKFLOW_FAILED'});
  const result=await publisher.finish({...release,resume:true});
  assert.equal(result.npm.version,'1.2.4');assert.equal(state.reruns,1);
  assert.equal(state.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/releases')).length,1);
});

test('a failed retry reports failure instead of waiting until timeout or republishing again',async()=>{
  const {publisher,state,release}=publicationFixture({steps:()=>({status:'completed',conclusion:'failure'})});
  await assert.rejects(publisher.finish({...release,resume:true}),{code:'NPM_WORKFLOW_FAILED'});
  assert.equal(state.reruns,1);
});

test('already public resume verifies bytes without dispatch, upload or dist-tag changes',async()=>{
  const {publisher,state,release}=publicationFixture({publicInitially:true});
  const result=await publisher.finish({...release,resume:true});
  assert.equal(result.alreadyPublished,true);
  assert(!state.calls.some(c=>c.path.includes('/actions/')));
  assert.equal(state.dispatches,0);
});

test('resume dispatches a missing publication workflow for the exact existing tag',async()=>{
  const {publisher,state,release}=publicationFixture({steps:s=>s.dispatches?{status:'completed',conclusion:'success'}:null});
  assert.equal((await publisher.finish({...release,resume:true})).npm.version,'1.2.4');
  assert.equal(state.dispatches,1);
});

test('public integrity mismatch cannot be reported as successful publication',async()=>{
  const {publisher,release}=publicationFixture({corrupt:true});
  await assert.rejects(publisher.finish(release),{code:'NPM_INTEGRITY_FAILED'});
});

test('timed-out workflow returns a same-version recovery error',async()=>{
  const {publisher,release}=publicationFixture({steps:()=>({status:'in_progress'})});
  await assert.rejects(publisher.finish(release),{code:'NPM_PUBLISH_TIMEOUT'});
});

test('artifact retry skips identical published bytes but refuses different bytes and registry errors',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'npm-artifact-test-'));
  try{
    const {fetchImpl,bytes,integrity}=publicationFixture({publicInitially:true});
    const archive=path.join(root,'fixture.tgz');writeFileSync(archive,bytes);
    const config={name:'fixture-plugin',version:'1.2.4',archive,distTag:'latest',fetchImpl,execute:()=>assert.fail('Must not upload existing version')};
    assert.deepEqual(await publishArtifact(config),{alreadyPublished:true,integrity});
    writeFileSync(archive,'different bytes');
    await assert.rejects(publishArtifact(config),{code:'NPM_ARTIFACT_MISMATCH'});
    await assert.rejects(publishArtifact({...config,fetchImpl:async()=>new Response('',{status:503})}),{code:'NPM_REGISTRY_FAILED'});
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('new artifact publication uploads only after an authoritative version-not-found response',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'npm-artifact-upload-'));
  try{
    const archive=path.join(root,'fixture.tgz');writeFileSync(archive,'validated package');
    let uploads=0;
    const result=await publishArtifact({name:'fixture-plugin',version:'1.2.4',archive,distTag:'next',env:{npm_execpath:'fixture-npm-cli.js'},
      fetchImpl:async()=>new Response('',{status:404}),execute:(program,args,options)=>{
        uploads++;
        assert.equal(program,process.execPath);
        assert.deepEqual(args,['fixture-npm-cli.js','publish',archive,'--access','public','--registry=https://registry.npmjs.org/','--tag','next']);
        assert.equal(options.stdio,'inherit');return {status:0};
      }});
    assert.equal(result.alreadyPublished,false);assert.equal(uploads,1);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('GitHub preflight rejects missing write permissions or a disabled workflow without mutations',async()=>{
  for(const disabled of [false,true]){
    const calls=[];
    const publisher=new ReleasePublisher({repo:'owner/plugin',token:'fixture',fetchImpl:async(url,options)=>{
      calls.push(options.method);
      return new Response(JSON.stringify(url.endsWith('/npm-publish.yml')?{state:'disabled_manually'}:{permissions:{push:disabled}}));
    }});
    await assert.rejects(publisher.preflight(),{code:disabled?'WORKFLOW_DISABLED':'GH_AUTH_REQUIRED'});
    assert(calls.every(method=>method==='GET'));
  }
});

test('upload response failure can recover an identical concurrent publication without uploading twice',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'npm-artifact-race-'));
  try{
    const archive=path.join(root,'fixture.tgz'),bytes=Buffer.from('fixture upload');writeFileSync(archive,bytes);
    const integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
    let reads=0,uploads=0;
    const result=await publishArtifact({name:'fixture-plugin',version:'1.2.4',archive,distTag:'latest',env:{npm_execpath:'fixture-cli.js'},
      fetchImpl:async()=>++reads===1?new Response('',{status:404}):new Response(JSON.stringify({name:'fixture-plugin',version:'1.2.4',dist:{integrity}})),
      execute:()=>{uploads++;return {status:1};}});
    assert.equal(result.alreadyPublished,true);assert.equal(uploads,1);assert.equal(reads,2);
  }finally{rmSync(root,{recursive:true,force:true});}
});
