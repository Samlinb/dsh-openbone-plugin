import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {requireThat} from '../src/errors.js';

export async function publishArtifact({name,version,archive,distTag,fetchImpl=fetch,execute=spawnSync,env=process.env}){
  requireThat(['latest','next'].includes(distTag),'INVALID_DIST_TAG','Expected latest or next.');
  const integrity='sha512-'+createHash('sha512').update(await readFile(archive)).digest('base64');
  async function exists(){
    const response=await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}?verification=${Date.now()}`,{signal:AbortSignal.timeout(15000)});
    if(response.ok){
      const published=await response.json();
      requireThat(published.name===name&&published.version===version&&published.dist?.integrity===integrity,'NPM_ARTIFACT_MISMATCH','This npm version already exists with different package bytes. Refusing to overwrite or retag it.');
      return true;
    }
    requireThat(response.status===404,'NPM_REGISTRY_FAILED',`Cannot inspect npm version: HTTP ${response.status}. No upload attempted.`);
    return false;
  }
  if(await exists())return {alreadyPublished:true,integrity};
  requireThat(env.npm_execpath,'INVALID_INPUT','Run this tool through npm run publish:artifact.');
  const result=execute(process.execPath,[env.npm_execpath,'publish',path.resolve(archive),'--access','public','--registry=https://registry.npmjs.org/','--tag',distTag],{stdio:'inherit',env,windowsHide:true});
  if(result.error||result.status!==0){
    if(await exists())return {alreadyPublished:true,integrity};
    requireThat(false,'NPM_PUBLISH_FAILED','npm upload failed. Retry the existing release after inspecting the workflow.');
  }
  return {alreadyPublished:false,integrity};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const pkg=JSON.parse(await readFile('package.json','utf8'));
    const files=(await readdir('release')).filter(name=>name.endsWith('.tgz'));
    requireThat(files.length===1,'INVALID_PACKAGE','Expected exactly one validated npm tarball.');
    console.log(JSON.stringify(await publishArtifact({name:pkg.name,version:pkg.version,archive:path.join('release',files[0]),distTag:process.env.NPM_DIST_TAG})));
  }catch(error){console.error(`${error.code??'NPM_PUBLISH_FAILED'}: ${error.message}`);process.exitCode=1;}
}
