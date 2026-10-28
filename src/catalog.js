import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {id,requireThat} from './errors.js';
import {json,safeFile,hash} from './files.js';

export function catalogRow(record,reviews){
  id(record.id);
  requireThat(record.schema_version===1 && typeof record.title==='string' && Array.isArray(record.tags) && record.tags.every(t=>typeof t==='string') && /^[a-f0-9]{64}$/.test(record.snapshot_sha256), 'INVALID_RECORD', 'Unsupported knowledge record.');
  const sorted=[...reviews].sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at)||a.id.localeCompare(b.id));
  const latest=sorted.filter(r=>r.status).at(-1);
  return {workId:record.id,snapshotId:record.snapshot_sha256,title:record.title,tags:record.tags,derivedFrom:record.derived_from,status:latest?.status??'pending',scope:latest?.scope??'No user decision recorded.'};
}
/** Rebuild only derived metadata; never infer approval or rewrite authoritative records. */
export async function rebuildCatalog(root){
  const works=[];
  for(const workId of (await readdir(path.join(root,'records'))).sort()){
    id(workId);
    for(const snapshot of (await readdir(path.join(root,'records',workId))).sort()){
      requireThat(/^[a-f0-9]{64}$/.test(snapshot),'INVALID_RECORD','Invalid snapshot directory.');
      const base=path.join(root,'records',workId,snapshot),record=await json(await safeFile(base,'record.json'));
      requireThat(record.id===workId && record.snapshot_sha256===snapshot && hash(await readFile(await safeFile(base,'manifest.json')))===snapshot,'INTEGRITY_FAILED','Record and manifest identity differ.');
      const reviews=[];
      if((await readdir(base)).includes('reviews'))for(const name of (await readdir(path.join(base,'reviews'))).filter(n=>n.endsWith('.json'))){
        const review=await json(await safeFile(base,`reviews/${name}`));requireThat(review.snapshot_sha256===snapshot,'INTEGRITY_FAILED','Review snapshot differs.');reviews.push(review);
      }
      works.push(catalogRow(record,reviews));
    }
  }
  return {schemaVersion:1,works};
}
