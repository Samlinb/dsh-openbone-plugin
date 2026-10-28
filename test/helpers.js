import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hash, encode } from '../src/files.js';
import { importLibrary } from '../src/import.js';
export async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'openbone-plugin-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'library'), destination = path.join(root, 'data');
  const work = path.join(source, 'works', 'example-walk');
  await mkdir(path.join(work, 'source'), {recursive:true});await mkdir(path.join(work, 'reviews'));
  await mkdir(path.join(source,'lessons'));await writeFile(path.join(source,'lessons','walk.md'),'Keep feet in contact.\n');
  const project=Buffer.from('{"fixture":true}\n'), texture=Buffer.from('texture bytes');
  await writeFile(path.join(work,'source','project.json'),project);await writeFile(path.join(work,'source','image.png'),texture);
  const manifest=[{path:'source/project.json',bytes:project.length,sha256:hash(project)},{path:'source/image.png',bytes:texture.length,sha256:hash(texture)}];
  const snapshotId=hash(encode(manifest));
  await writeFile(path.join(work,'manifest.json'),encode(manifest));
  await writeFile(path.join(work,'record.json'),encode({schema_version:1,id:'example-walk',title:'Example walk',project:'project.json',tags:['walk','行走'],snapshot_sha256:snapshotId,derived_from:[],origin:{source:'PRIVATE_OPERATOR_PATH'}}));
  await writeFile(path.join(work,'analysis.md'),'An example walk. This is reference data.\n');
  await writeFile(path.join(work,'reviews','review.json'),encode({id:'one',recorded_at:'2026-10-28',status:'rejected',scope:'Feet slide',feedback:'原始评价',provenance:'direct_user',snapshot_sha256:snapshotId}));
  await importLibrary(source,destination);
  return {root,source,destination,work,snapshotId};
}
