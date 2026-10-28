import {SkeletonData, requireThat, RuntimeError} from './core.js';
import {TextureAtlas} from './atlas.js';
import {decodeBinary} from './binary.js';
import {sequencePath} from './attachments.js';
export function relativeUrl(base, path) {
  requireThat(typeof path === 'string' && path.length > 0 && !/[\\?#:%]/.test(path) && !path.startsWith('/') && path.split('/').every(p => p && p !== '.' && p !== '..'),'url','Expected contained relative asset path');
  return new URL(path,base).href;
}
const decoder = new TextDecoder('utf-8',{fatal:true});
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v => v.toString(16).padStart(2,'0')).join('');
async function bytesAt(url, signal, limit = 64*1024*1024) {
  const response = await fetch(url,{signal});
  requireThat(response.ok,url,`HTTP ${response.status}`,'LOAD_FAILED');
  requireThat(response.url === url,url,'Asset redirects are unsupported','LOAD_FAILED');
  requireThat(Number(response.headers.get('content-length') ?? 0) <= limit,url,'Asset is too large','LOAD_FAILED');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.length; requireThat(size <= limit,url,'Asset is too large','LOAD_FAILED'); chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk,offset); offset += chunk.length; } return result;
}
function parse(bytes, path) {
  try { return JSON.parse(decoder.decode(bytes)); }
  catch (e) { throw new RuntimeError('INVALID_DATA',path,`Invalid JSON: ${e.message}`); }
}
// Resolves the immutable package generation once and verifies every manifest byte.
// No editor connection, filesystem permissions, or JVM is needed at playback time.
export async function load(url, {atlasUrl, signal, decodeImages = true} = {}) {
  const entryUrl = new URL(url,globalThis.location?.href).href;
  requireThat(['http:','https:'].includes(new URL(entryUrl).protocol),'url','Serve assets over HTTP(S)');
  const binaryUrl=/\.skel(?:\.bytes)?(?:$|\?)/i.test(entryUrl);
  const firstBytes = await bytesAt(entryUrl,signal,64*1024*1024), binary=binaryUrl?decodeBinary(firstBytes):null, first = binary?binary.json:parse(firstBytes,entryUrl);
  let sourceVersion=binary?.version;
  let skeletonUrl = entryUrl, root = first, atlasBytes, verified = new Map(), manifest = null;
  if (first.format === 'openbone-export-1') {
    requireThat(/^generation-[0-9a-f-]{36}$/.test(first.generation),'entry','Invalid generation');
    const skeletonPath=first.json??first.skel;
    requireThat(skeletonPath === `${first.generation}/skeleton.${first.json?'json':'skel'}` && first.atlas === `${first.generation}/skeleton.atlas`,'entry','Invalid generation filenames');
    skeletonUrl = relativeUrl(entryUrl,skeletonPath); atlasUrl = relativeUrl(entryUrl,first.atlas);
    const manifestUrl = relativeUrl(skeletonUrl,'manifest.json'), manifestBytes = await bytesAt(manifestUrl,signal,16*1024*1024);
    requireThat(await digest(manifestBytes) === first.manifestSHA256,'manifest','SHA-256 mismatch','INTEGRITY_FAILED');
    manifest = parse(manifestBytes,manifestUrl);
    requireThat(manifest.format === 'openbone-export-generation-1' && manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files),'manifest','Invalid manifest');
    requireThat(Object.hasOwn(manifest.files,first.json?'skeleton.json':'skeleton.skel') && Object.hasOwn(manifest.files,'skeleton.atlas'),'manifest','Incomplete manifest');
    requireThat(Object.keys(manifest.files).length <= 10000,'manifest','Too many files');
    let total = 0;
    for (const [path,hash] of Object.entries(manifest.files)) {
      requireThat(/^[a-f0-9]{64}$/.test(hash),'manifest','Invalid SHA-256');
      const resourceUrl = relativeUrl(skeletonUrl,path), bytes = await bytesAt(resourceUrl,signal);
      total += bytes.length; requireThat(total <= 256*1024*1024,'manifest','Package exceeds 256 MiB');
      requireThat(await digest(bytes) === hash,path,'SHA-256 mismatch','INTEGRITY_FAILED'); verified.set(resourceUrl,bytes);
    }
    const decoded=first.json?null:decodeBinary(verified.get(skeletonUrl));
    root = decoded?decoded.json:parse(verified.get(skeletonUrl),skeletonUrl);sourceVersion=decoded?.version??root.skeleton?.spine; atlasBytes = verified.get(atlasUrl);
    requireThat(sourceVersion === manifest.spine,'manifest.spine','Skeleton version mismatch');
  } else {
    atlasUrl = atlasUrl ? new URL(atlasUrl,entryUrl).href : entryUrl.replace(/\.(?:json|skel(?:\.bytes)?)$/i,'.atlas');
    requireThat(atlasUrl !== entryUrl,'atlasUrl','Specify an atlas URL for this skeleton');
    atlasBytes = await bytesAt(atlasUrl,signal,16*1024*1024);
  }
  const data = new SkeletonData(root), atlas = new TextureAtlas(decoder.decode(atlasBytes)), images = new Map();
  data.sourceVersion=sourceVersion??data.sourceVersion;
  for (const skin of data.skins.values()) for (const row of skin.values()) for (const att of row.values()) if(['region','mesh'].includes(att.type)) for(let i=0;i<(att.sequence?.count??1);i++)requireThat(atlas.regions.has(sequencePath(att,i)),'atlas',`Missing region: ${sequencePath(att,i)}`);
  try {
    for (const page of atlas.pages.values()) {
      const pageUrl = relativeUrl(atlasUrl,page.name);
      if (manifest) requireThat(verified.has(pageUrl),'manifest',`Unverified atlas page: ${page.name}`);
      if (!decodeImages) continue;
      const bytes = verified.get(pageUrl) ?? await bytesAt(pageUrl,signal);
      const image = await createImageBitmap(new Blob([bytes],{type:'image/png'}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
      if (image.width !== page.width || image.height !== page.height) { image.close(); throw new RuntimeError('INVALID_DATA',page.name,'Texture dimensions differ from atlas'); }
      images.set(page.name,image);
    }
  } catch (e) { for (const image of images.values()) image.close(); throw e; }
  let disposed = false;
  return {data,atlas,images,source:{entryUrl,skeletonUrl,version:data.sourceVersion,manifestSHA256:first.manifestSHA256 ?? null},
    dispose() { if (!disposed) { disposed = true; for (const image of images.values()) image.close(); images.clear(); } }};
}
