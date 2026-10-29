import {parseArgs} from 'node:util';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Failure,requireThat} from '../src/errors.js';
import {json} from '../src/files.js';

const USAGE='Usage: npm run release -- [patch|minor|major|prerelease|x.y.z[-pre]] [--preid=<id>] [--message=<text>] [--publish] [--push] [--allow-dirty] [--skip-gates] [--dry-run]';
const SEMVER=/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const GITHUB_REPO=/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/;
const BUMPS=new Set(['patch','minor','major','prerelease']);

const {values,positionals}=parseArgs({allowPositionals:true,options:{
  preid:{type:'string',default:'beta'},
  message:{type:'string'},
  push:{type:'boolean',default:false},
  publish:{type:'boolean',default:false},
  'allow-dirty':{type:'boolean',default:false},
  'skip-gates':{type:'boolean',default:false},
  'dry-run':{type:'boolean',default:false}}});
const dryRun=values['dry-run'];
const push=values.push||values.publish;

function run(program,args,{env,capture=false}={}){
  const child=spawnSync(program,args,{encoding:'utf8',windowsHide:true,env,...(capture?{}:{stdio:'inherit'})});
  requireThat(child.error===undefined,'COMMAND_FAILED',child.error?.message??'Command could not start.');
  return child;
}
// Git is invoked directly so Windows needs neither cmd.exe nor shell quoting.
function git(args,{quiet=false}={}){
  const child=run('git',args,{capture:true});
  if(quiet&&child.status!==0)return null;
  requireThat(child.status===0,'GIT_FAILED',`git ${args.join(' ')} failed: ${(child.stderr||child.stdout).trim()}`);
  return child.stdout.trim();
}
function parse(version){
  const match=SEMVER.exec(version);
  requireThat(match,'INVALID_VERSION',`Expected a SemVer version, got: ${version}`);
  return {major:+match[1],minor:+match[2],patch:+match[3],pre:match[4]??null};
}
const format=version=>`${version.major}.${version.minor}.${version.patch}${version.pre?`-${version.pre}`:''}`;
function compare(left,right){
  for(const part of ['major','minor','patch'])if(left[part]!==right[part])return left[part]<right[part]?-1:1;
  if(left.pre===right.pre)return 0;
  if(!left.pre)return 1;
  if(!right.pre)return -1;
  const a=left.pre.split('.'),b=right.pre.split('.');
  for(let index=0;index<Math.max(a.length,b.length);index++){
    if(index>=a.length)return -1;
    if(index>=b.length)return 1;
    const numeric=/^\d+$/.test(a[index])&&/^\d+$/.test(b[index]);
    if(numeric){if(+a[index]!==+b[index])return +a[index]<+b[index]?-1:1;}
    else if(/^\d+$/.test(a[index])!==/^\d+$/.test(b[index]))return /^\d+$/.test(a[index])?-1:1;
    else if(a[index]!==b[index])return a[index]<b[index]?-1:1;
  }
  return 0;
}
function plan(current,target,preid){
  requireThat(/^[0-9A-Za-z-]+$/.test(preid),'INVALID_INPUT',`Unsafe prerelease identifier: ${preid}`);
  if(!BUMPS.has(target))return parse(target);
  if(target==='major')return {major:current.major+1,minor:0,patch:0,pre:null};
  if(target==='minor')return {major:current.major,minor:current.minor+1,patch:0,pre:null};
  if(target==='patch')return current.pre?{...current,pre:null}:{...current,patch:current.patch+1};
  const increment=current.pre&&new RegExp(`^${preid}\\.(\\d+)$`).exec(current.pre);
  return increment?{...current,pre:`${preid}.${+increment[1]+1}`}:{...current,patch:current.patch+1,pre:`${preid}.0`};
}
// Only the version value is rewritten so the reviewed package.json layout and encoding survive a release.
function bumpedManifest(raw,version){
  const updated=raw.replace(/("version":\s*")[^"]*(")/,`$1${version}$2`);
  requireThat(updated!==raw,'INVALID_PACKAGE','package.json exposes no "version" field to bump.');
  requireThat(JSON.parse(updated.replace(/^\uFEFF/,'')).version===version,'INVALID_PACKAGE','package.json version could not be rewritten.');
  return updated;
}
function gate(name,env=process.env){
  const script=(pkg.scripts??{})[name];
  requireThat(script,'INVALID_PACKAGE',`package.json is missing the "${name}" release gate.`);
  const parts=script.split(/\s+/).filter(Boolean);
  requireThat(parts[0]==='node','INVALID_PACKAGE',`Release gates must be plain node scripts: ${name}`);
  parts[0]=process.execPath;
  console.error(`--- release gate: npm run ${name}`);
  requireThat(run(parts[0],parts.slice(1),{env}).status===0,'GATE_FAILED',`Release gate failed: npm run ${name}`);
}
const pkg=await json('package.json');
const raw=await readFile('package.json','utf8');
const current=parse(pkg.version);

async function main(){
  requireThat(positionals.length<=1,'INVALID_INPUT',`Expected at most one release target.\n${USAGE}`);
  const next=plan(current,positionals[0]??'patch',values.preid);
  requireThat(compare(next,current)>0,'INVALID_VERSION',`${format(next)} does not advance the current version ${pkg.version}.`);
  const version=format(next),tag=`v${version}`,message=values.message??`chore(release): ${tag}`;
  requireThat(git(['rev-parse','--show-prefix'])==='','INVALID_CWD',`Run the release from the repository root.\n${USAGE}`);
  const branch=git(['rev-parse','--abbrev-ref','HEAD']);
  requireThat(branch!=='HEAD'||dryRun,'GIT_FAILED','Refusing to release from a detached HEAD.');
  const dirty=git(['status','--porcelain']);
  requireThat(!values.publish||dryRun||!values['skip-gates'],'INVALID_INPUT','--publish cannot skip release checks.');
  requireThat(!values.publish||dryRun||dirty==='','GIT_DIRTY','Commit all intended changes before publishing; --allow-dirty is only available for local preparation or dry runs.');
  requireThat(dirty===''||values['allow-dirty'],'GIT_DIRTY',`Commit or stash these changes before releasing (or pass --allow-dirty):\n${dirty}`);
  requireThat(git(['rev-parse','-q','--verify',`refs/tags/${tag}`],{quiet:true})===null,'TAG_EXISTS',`Tag ${tag} already exists locally.`);
  const upstream=git(['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}'],{quiet:true});
  const remote=upstream?upstream.split('/')[0]:'origin';
  if(push&&!dryRun)requireThat(upstream,'GIT_FAILED',`${branch} tracks no upstream; push it once manually before publishing.`);
  const owner=GITHUB_REPO.exec(pkg.repository?.url??'')?.slice(1,3);
  requireThat(owner,'INVALID_PACKAGE','package.json repository.url does not name the owning GitHub repository.');
  const originUrl=git(['remote','get-url',remote],{quiet:true});
  const originOwner=originUrl?GITHUB_REPO.exec(originUrl)?.slice(1,3):null;
  requireThat(!originOwner||originOwner.join('/')===owner.join('/'),'GIT_REMOTE_FORK',`Remote "${remote}" points at ${originOwner?.join('/')} while the package belongs to ${owner.join('/')}.`);
  if(values.publish){
    requireThat(originOwner?.join('/')===owner.join('/'),'GIT_REMOTE_FORK','Publishing requires a GitHub remote matching package.json repository.url.');
    if(!dryRun){
      const auth=run('gh',['auth','status','--hostname','github.com'],{capture:true});
      requireThat(auth.status===0,'GH_AUTH_REQUIRED','Run gh auth login before publishing.');
      const remoteTag=git(['ls-remote','--tags',remote,`refs/tags/${tag}`]);
      requireThat(remoteTag==='','TAG_EXISTS',`Tag ${tag} already exists remotely.`);
    }
  }
  if(!values['skip-gates']){gate('check');gate('test:unit');}
  const releaseArgs=['release','create',tag,'--repo',owner.join('/'),'--verify-tag','--title',tag,'--notes-from-tag',...(next.pre?['--prerelease','--latest=false']:[])];
  const summary={package:pkg.name,previousVersion:pkg.version,version,tag,branch,remote,commitMessage:message,dryRun,pushed:false,gates:!values['skip-gates'],publishRequested:values.publish,distTag:next.pre?'next':'latest',releaseCreated:false,...(values.publish?{releaseCommand:['gh',...releaseArgs],workflowUrl:`https://github.com/${owner.join('/')}/actions/workflows/npm-publish.yml`}:{})};
  if(dryRun){console.log(JSON.stringify(summary,null,2));console.error(`Dry run: package.json, the commit and tag ${tag} were not created.`);return;}
  await writeFile('package.json',bumpedManifest(raw,version));
  let committed=false;
  try{
    // The same guard the publish workflow runs, so the tag cannot be rejected after it exists.
    const guard=run(process.execPath,['tools/verify-release.mjs'],{capture:true,env:{...process.env,GITHUB_EVENT_NAME:'release',GITHUB_REPOSITORY:owner.join('/'),RELEASE_TAG:tag,RELEASE_IS_PRERELEASE:String(next.pre!==null),GITHUB_OUTPUT:''}});
    requireThat(guard.status===0,'RELEASE_GUARD_FAILED',`tools/verify-release.mjs rejected ${tag}: ${(guard.stderr||guard.stdout).trim()}`);
    if(!values['skip-gates']){
      const auditDir=await mkdtemp(path.join(tmpdir(),'openbone-release-'));
      try{gate('pack:release',{...process.env,OPENBONE_RELEASE_DIR:auditDir});}
      finally{await rm(auditDir,{recursive:true,force:true});}
    }
    git(['add','--','package.json']);
    git(['commit','-m',message,'--','package.json']);
    committed=true;
    summary.commit=git(['rev-parse','HEAD']);
    git(['tag','-a',tag,'-m',message]);
    if(push){git(['push','--atomic',remote,`HEAD:refs/heads/${branch}`,`refs/tags/${tag}`]);summary.pushed=true;}
    if(values.publish){
      const release=run('gh',releaseArgs);
      requireThat(release.status===0,'RELEASE_CREATE_FAILED',`Commit and tag ${tag} were pushed. Retry only: gh ${releaseArgs.join(' ')}. Do not bump the version again.`);
      summary.releaseCreated=true;
    }
  }catch(error){
    if(!committed)await writeFile('package.json',raw);
    if(committed)console.error(`Local release ${tag} was committed. Inspect the commit/tag before retrying; do not automatically bump again.`);
    throw error;
  }
  console.log(JSON.stringify(summary,null,2));
  console.error(values.publish?`GitHub Release ${tag} created. npm publication runs in the workflow: ${summary.workflowUrl}`:`Prepared ${tag}. Use --publish to push and create its GitHub Release automatically.`);
}
try{await main();}catch(error){
  console.error(error instanceof Failure?`${error.code}: ${error.message}`:error);
  process.exit(1);
}
