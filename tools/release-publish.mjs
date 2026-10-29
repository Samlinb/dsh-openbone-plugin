import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Failure,requireThat} from '../src/errors.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function githubCredential(env=process.env,execute=spawnSync){
  if(env.GH_TOKEN||env.GITHUB_TOKEN)return env.GH_TOKEN||env.GITHUB_TOKEN;
  const cli=execute('gh',['auth','token','--hostname','github.com'],{encoding:'utf8',windowsHide:true,timeout:15000,env});
  if(cli.status===0&&cli.stdout?.trim())return cli.stdout.trim();
  const credential=execute('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,timeout:30000,
    env:{...env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
  const password=credential.status===0?credential.stdout?.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice(9):null;
  requireThat(password,'GH_AUTH_REQUIRED','Sign in with gh auth login or configure Git Credential Manager for github.com before publishing.');
  return password;
}

export class ReleasePublisher{
  constructor({repo,token,fetchImpl=fetch,now=Date.now,sleep=pause,timeoutMs=1200000,pollMs=10000,log=console.error}){
    requireThat(/^[\w.-]+\/[\w.-]+$/.test(repo),'INVALID_PACKAGE','Invalid GitHub repository.');
    Object.assign(this,{repo,token,fetchImpl,now,sleep,timeoutMs,pollMs,log});
    this.base=`https://api.github.com/repos/${repo}`;
  }
  async api(method,endpoint,body){
    let response;
    try{response=await this.fetchImpl(this.base+endpoint,{method,headers:{Authorization:`Bearer ${this.token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'openbone-release'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000),redirect:'error'});}
    catch{throw new Failure('GITHUB_UNAVAILABLE',`GitHub ${method} ${endpoint} could not complete. Retry the same version with --resume.`);}
    if(response.status===404&&method==='GET')return null;
    requireThat(response.ok,'GITHUB_API_FAILED',`GitHub ${method} ${endpoint}: HTTP ${response.status}. Check repository permissions and retry with --resume.`);
    return response.status===204?{}:response.json();
  }
  async preflight(){
    const repository=await this.api('GET','');
    requireThat(repository&&!repository.archived&&repository.permissions?.push,'GH_AUTH_REQUIRED','GitHub credentials must have write access to the package repository.');
    const workflow=await this.api('GET','/actions/workflows/npm-publish.yml');
    requireThat(workflow?.state==='active','WORKFLOW_DISABLED','Enable npm-publish.yml before publishing.');
  }
  async verifyTag(tag,commit){
    let ref=await this.api('GET',`/git/ref/tags/${encodeURIComponent(tag)}`);
    requireThat(ref,'TAG_MISSING',`Push ${tag} before creating its Release.`);
    let object=ref.object;
    for(let depth=0;object?.type==='tag'&&depth<5;depth++)object=(await this.api('GET',`/git/tags/${object.sha}`))?.object;
    requireThat(object?.type==='commit'&&object.sha===commit,'TAG_COMMIT_MISMATCH',`${tag} does not point to the inspected release commit. No release was created.`);
  }
  async ensureRelease({tag,commit,prerelease,notes}){
    await this.verifyTag(tag,commit);
    let release=await this.api('GET',`/releases/tags/${encodeURIComponent(tag)}`);
    if(!release){
      try{release=await this.api('POST','/releases',{tag_name:tag,name:tag,body:notes,draft:false,prerelease,make_latest:prerelease?'false':'true'});}
      catch(error){
        // A lost response or a concurrent retry may have already created it.
        release=await this.api('GET',`/releases/tags/${encodeURIComponent(tag)}`);
        if(!release)throw error;
      }
    }
    requireThat(release.tag_name===tag&&release.prerelease===prerelease,'RELEASE_MISMATCH','Existing GitHub Release does not match the requested version type.');
    if(release.draft)release=await this.api('PATCH',`/releases/${release.id}`,{draft:false});
    return release;
  }
  async registryVersion(name,version){
    const response=await this.fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}?verification=${this.now()}`,{signal:AbortSignal.timeout(15000)});
    if(response.status===404)return null;
    requireThat(response.ok,'NPM_REGISTRY_FAILED',`npm version metadata HTTP ${response.status}.`);
    const published=await response.json();
    requireThat(published.name===name&&published.version===version&&published.dist?.integrity&&
      typeof published.dist.tarball==='string'&&published.dist.tarball.startsWith('https://registry.npmjs.org/'),'NPM_IDENTITY_MISMATCH','Public npm version identity or artifact URL does not match.');
    return published;
  }
  async verifyPublic(name,version){
    const published=await this.registryVersion(name,version);
    if(!published)return null;
    const response=await this.fetchImpl(published.dist.tarball,{signal:AbortSignal.timeout(30000)});
    requireThat(response.ok,'NPM_ARTIFACT_FAILED',`Public npm tarball HTTP ${response.status}.`);
    const integrity='sha512-'+createHash('sha512').update(Buffer.from(await response.arrayBuffer())).digest('base64');
    requireThat(integrity===published.dist.integrity,'NPM_INTEGRITY_FAILED','Public npm tarball integrity does not match registry metadata.');
    return {version,integrity,tarball:published.dist.tarball};
  }
  async finish({tag,commit,name,version,prerelease,notes,resume=false}){
    const release=await this.ensureRelease({tag,commit,prerelease,notes});
    this.log(`GitHub Release: ${release.html_url}`);
    // A completed publication can be resumed without uploading or moving dist-tags again.
    if(resume){
      const published=await this.verifyPublic(name,version);
      if(published)return {releaseUrl:release.html_url,npm:published,alreadyPublished:true};
    }
    const started=this.now(),deadline=started+this.timeoutMs;
    let retried=false,retriedAttempt,dispatched=false,runUrl,lastStatus='Waiting for npm workflow';
    while(this.now()<deadline){
      const result=await this.api('GET',`/actions/workflows/npm-publish.yml/runs?head_sha=${commit}&per_page=100`);
      const runs=(result?.workflow_runs??[]).filter(run=>run.head_sha===commit&&['release','workflow_dispatch'].includes(run.event));
      const run=runs[0];
      if(run){
        runUrl=run.html_url;
        const status=`npm workflow ${run.id}, attempt ${run.run_attempt??1}: ${run.status}${run.conclusion?` (${run.conclusion})`:''}`;
        if(status!==lastStatus){this.log(status);lastStatus=status;}
        if(run.status==='completed'){
          if(run.conclusion==='success'){
            const published=await this.verifyPublic(name,version);
            if(published)return {releaseUrl:release.html_url,workflowUrl:runUrl,npm:published};
          }else if(resume&&!retried){
            // A failed upload may in fact be public already; never republish it.
            const published=await this.verifyPublic(name,version);
            if(published)return {releaseUrl:release.html_url,workflowUrl:runUrl,npm:published,alreadyPublished:true};
            await this.api('POST',`/actions/runs/${run.id}/${run.conclusion==='failure'?'rerun-failed-jobs':'rerun'}`,{});
            retried=true;
            retriedAttempt=run.run_attempt??1;
          }else if(!retried||(run.run_attempt??1)>retriedAttempt){throw new Failure('NPM_WORKFLOW_FAILED',`npm publication failed: ${runUrl}. Retry the same version with --resume.`);}
        }
      }else if(!dispatched&&(resume||this.now()-started>=30000)){
        await this.api('POST','/actions/workflows/npm-publish.yml/dispatches',{ref:tag,inputs:{release_tag:tag}});
        dispatched=true;
      }
      await this.sleep(this.pollMs);
    }
    throw new Failure('NPM_PUBLISH_TIMEOUT',`Publication is not confirmed yet. ${runUrl??release.html_url}. Retry the same version with --resume.`);
  }
}
