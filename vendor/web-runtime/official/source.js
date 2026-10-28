// Integrity and containment checks before the official runtime parses any skeleton data.
import {requireThat,RuntimeError} from '../src/core.js';
import {relativeUrl} from '../src/loader.js';
const utf8=new TextDecoder('utf-8',{fatal:true});
const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function bytes(url,signal,limit=64*1024*1024){const r=await fetch(url,{signal});requireThat(r.ok&&r.url===url,url,`HTTP ${r.status} or redirect`,'LOAD_FAILED');const reader=r.body.getReader(),chunks=[];let n=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;n+=value.length;requireThat(n<=limit,url,'Resource too large');chunks.push(value);}}finally{await reader.cancel();}
  const out=new Uint8Array(n);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out;}
function json(b,path){try{return JSON.parse(utf8.decode(b));}catch(e){throw new RuntimeError('INVALID_DATA',path,e.message);}}
export function binaryVersion(b){const textAt=start=>{let n=0,shift=0,i=start;while(shift<35){requireThat(i<b.length,'binary.header','Truncated header');const v=b[i++];n|=(v&127)<<shift;if(!(v&128))break;shift+=7;}requireThat(n>=1&&n<1000&&i+n-1<=b.length,'binary.header','Invalid version header');return [utf8.decode(b.subarray(i,i+n-1)),i+n-1];};
  try{const [v]=textAt(8);if(/^4\.\d+\./.test(v))return v;}catch{}const [,i]=textAt(0);return textAt(i)[0];}
export async function openSource(url,{atlasUrl,signal}={}){const entryUrl=new URL(url,globalThis.location?.href).href;requireThat(['http:','https:'].includes(new URL(entryUrl).protocol),'url','Serve assets over HTTP(S)');
  let skeletonUrl=entryUrl,skeletonBytes=await bytes(entryUrl,signal),isBinary=/\.skel(?:\.bytes)?$/i.test(new URL(entryUrl).pathname),root=isBinary?null:json(skeletonBytes,entryUrl),verified=new Map(),manifestSHA256=null;
  if(root?.format==='openbone-export-1'){
    const p=root;requireThat(/^generation-[0-9a-f-]{36}$/.test(p.generation)&&p.json===p.generation+'/skeleton.json'&&p.atlas===p.generation+'/skeleton.atlas','package','Invalid generation pointer');manifestSHA256=p.manifestSHA256;
    skeletonUrl=relativeUrl(entryUrl,p.json);atlasUrl=relativeUrl(entryUrl,p.atlas);const mb=await bytes(relativeUrl(skeletonUrl,'manifest.json'),signal,16*1024*1024);requireThat(await hash(mb)===p.manifestSHA256,'manifest','Hash mismatch','INTEGRITY_FAILED');
    const m=json(mb,'manifest');requireThat(m.format==='openbone-export-generation-1'&&m.files&&typeof m.files==='object'&&!Array.isArray(m.files)&&Object.keys(m.files).length<=10000&&Object.hasOwn(m.files,'skeleton.json')&&Object.hasOwn(m.files,'skeleton.atlas'),'manifest','Invalid manifest');let total=0;
    for(const [path,h] of Object.entries(m.files)){requireThat(/^[a-f0-9]{64}$/.test(h),'manifest','Invalid resource hash');const u=relativeUrl(skeletonUrl,path),b=await bytes(u,signal);total+=b.length;requireThat(total<=256*1024*1024,'manifest','Package exceeds limit');requireThat(await hash(b)===h,path,'Hash mismatch','INTEGRITY_FAILED');verified.set(u,b);}
    skeletonBytes=verified.get(skeletonUrl);root=json(skeletonBytes,skeletonUrl);requireThat(root.skeleton?.spine===m.spine,'manifest.spine','Version mismatch');
  }
  const version=isBinary?binaryVersion(skeletonBytes):root?.skeleton?.spine;requireThat(typeof version==='string','skeleton.spine','Missing version');
  atlasUrl=atlasUrl?new URL(atlasUrl,entryUrl).href:entryUrl.replace(/\.(?:json|skel(?:\.bytes)?)$/i,'.atlas');requireThat(atlasUrl!==entryUrl,'atlasUrl','Specify matching atlas');
  const atlasBytes=verified.get(atlasUrl)??await bytes(atlasUrl,signal,16*1024*1024);
  return {entryUrl,skeletonUrl,version,isBinary,root,skeletonBytes,atlasText:utf8.decode(atlasBytes),manifestSHA256,
    async page(name){const u=relativeUrl(atlasUrl,name);if(manifestSHA256)requireThat(verified.has(u),'manifest','Unverified texture page');return verified.get(u)??bytes(u,signal);}};
}
