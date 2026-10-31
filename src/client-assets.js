import path from 'node:path';
import { mkdir, writeFile, readFile, rename, mkdtemp, rm } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { fields, id, requireThat } from './errors.js';
import { hash, json, safeFile, atomicJson } from './files.js';
import { productionBrief } from './production.js';

const check = (value, message) => requireThat(value, 'INVALID_CLIENT_ASSETS', message);
const pair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
/** Admission validates format and geometry; it never cuts, mattes, resizes or reviews pixels. */
export async function receiveClientAssets(assets, projectId, requestId, bundle) {
  fields(bundle, ['schemaVersion','source','plan','parts'], ['schemaVersion','source','plan','parts']);
  check(bundle.schemaVersion === 1, 'Unsupported client asset format.');
  fields(bundle.source, ['sha256','width','height'], ['sha256','width','height']);
  const source = bundle.source;
  check(/^[a-f0-9]{64}$/.test(source.sha256) && [source.width,source.height].every(n => Number.isInteger(n) && n >= 1 && n <= 4096), 'Invalid source identity or size.');
  const plan = bundle.plan;
  fields(plan, ['character','style','production','parts'], ['character','style','production','parts']);
  check([plan.character,plan.style].every(s => typeof s === 'string' && s.trim().length && s.length <= 300), 'Describe character and style.');
  productionBrief(plan.production);
  check(Array.isArray(plan.parts) && plan.parts.length >= 1 && plan.parts.length <= 32, 'Use 1–32 parts.');
  check(Array.isArray(bundle.parts) && bundle.parts.length === plan.parts.length, 'Upload exactly the planned parts.');
  const names = new Set(), orders = new Set();
  for (const part of plan.parts) {
    fields(part, ['id','description','parent','overlap','order','pivot'], ['id','description','parent','overlap','order','pivot']); id(part.id);
    check(part.id !== 'constructor' && !names.has(part.id) && !orders.has(part.order) && Number.isInteger(part.order), 'Part IDs and draw orders must be unique.');
    check([part.description,part.overlap].every(s => typeof s === 'string' && s.trim().length && s.length <= 200), 'Describe each part and joint coverage.');
    check(pair(part.pivot), 'Invalid part pivot.'); names.add(part.id); orders.add(part.order);
  }
  for (const part of plan.parts) {
    let parent = part.parent; const seen = new Set([part.id]);
    while (parent !== null) { check(names.has(parent) && !seen.has(parent), 'Invalid or cyclic part parent.'); seen.add(parent); parent = plan.parts.find(p => p.id === parent).parent; }
  }
  let total = 0, pixels = 0; const uploaded = new Set();
  const jobId = hash('client:' + requestId).slice(0,24);
  const parts = bundle.parts.map(input => {
    fields(input, ['id','pngBase64','sha256','geometry'], ['id','pngBase64','sha256','geometry']);
    check(names.has(input.id) && !uploaded.has(input.id), 'Unknown or duplicate uploaded part.'); uploaded.add(input.id);
    check(typeof input.pngBase64 === 'string' && input.pngBase64.length <= 2800000 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.pngBase64), 'Invalid or oversized PNG.');
    const bytes = Buffer.from(input.pngBase64,'base64'); total += bytes.length;
    check(total <= 12 * 1024 * 1024 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.length >= 24, 'Invalid PNG or asset bundle too large.');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20); pixels += width * height;
    check(width >= 1 && height >= 1 && width <= 4096 && height <= 4096 && pixels <= 32 * 1024 * 1024, 'PNG dimensions exceed limits.');
    check(hash(bytes) === input.sha256, 'PNG hash mismatch.');
    try { PNG.sync.read(bytes, { checkCRC:true }); } catch { check(false, 'PNG decoding failed.'); }
    const g = input.geometry;
    fields(g, ['origin','joint','sourceSize','polygon'], ['origin','joint','sourceSize','polygon']);
    check(pair(g.origin) && g.origin.every(Number.isInteger) && g.origin[0] >= 0 && g.origin[1] >= 0 && g.origin[0]+width <= source.width && g.origin[1]+height <= source.height, 'Crop exceeds source image.');
    check(pair(g.joint) && g.joint[0] >= 0 && g.joint[0] <= source.width && g.joint[1] >= 0 && g.joint[1] <= source.height && JSON.stringify(g.sourceSize) === JSON.stringify([source.width,source.height]), 'Invalid source joint or dimensions.');
    check(Array.isArray(g.polygon) && g.polygon.length >= 3 && g.polygon.length <= 256 && g.polygon.every(p => pair(p) && p[0] >= 0 && p[0] <= source.width && p[1] >= 0 && p[1] <= source.height), 'Invalid source contour.');
    const pivot = [(g.joint[0]-g.origin[0])/width,(g.joint[1]-g.origin[1])/height];
    const planned = plan.parts.find(p => p.id === input.id);
    check(pivot.every((n,i) => Math.abs(n-planned.pivot[i]) < 1e-6), 'Plan pivot must match uploaded crop and joint.');
    return { id:input.id,description:planned.description,width,height,pivot,geometry:{...g,sourceSHA256:source.sha256},assetId:`${jobId}-${input.id}`,sha256:input.sha256,issues:[],bytes };
  });
  const root = await assets.root(projectId), filename = path.join(root,`job-${jobId}.json`), fingerprint = hash(JSON.stringify(bundle));
  try { const old = await json(await safeFile(root,`job-${jobId}.json`)); check(old.fingerprint === fingerprint, 'Upload request conflicts.'); return old; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const stage = await mkdtemp(path.join(root,'.client-upload-'));
  const job = {jobId,fingerprint,origin:'client-upload',status:'ready',source,parts:parts.map(({bytes,...part}) => part),issues:[],createdAt:new Date().toISOString()};
  try {
    for (const part of parts) await writeFile(path.join(stage,`${part.id}.png`),part.bytes,{flag:'wx'});
    await atomicJson(path.join(stage,'manifest.json'),job.parts);
    try { await rename(stage,path.join(root,jobId)); } catch (e) { if (!['EEXIST','ENOTEMPTY','EPERM'].includes(e.code)) throw e; check(JSON.stringify(await json(path.join(root,jobId,'manifest.json'))) === JSON.stringify(job.parts), 'Immutable asset conflict.'); }
    await atomicJson(filename,job);
    return job;
  } finally { await rm(stage,{recursive:true,force:true}); }
}
