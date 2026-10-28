import { mkdtemp, mkdir, cp, rename, rm, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { id, requireThat } from './errors.js';
import { inventory, hash, json, writeJsonNew, inside, safeFile } from './files.js';
import {catalogRow} from './catalog.js';

async function validateWork(entry) {
  const record = await json(await safeFile(entry, 'record.json'));
  const manifestBytes = await readFile(await safeFile(entry, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  id(record.id);
  requireThat(hash(manifestBytes) === record.snapshot_sha256 && /^[a-f0-9]{64}$/.test(record.snapshot_sha256), 'INTEGRITY_FAILED', 'Archive manifest hash differs from its recorded snapshot.');
  const actual = [];
  for (const section of ['source', 'evidence']) {
    if ((await readdir(entry)).includes(section)) for (const item of await inventory(path.join(entry, section))) actual.push({ ...item, path: `${section}/${item.path}` });
  }
  const sort = rows => [...rows].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const expected = sort(manifest);
  requireThat(expected.length === actual.length && sort(actual).every((item, i) => item.path === expected[i].path && item.bytes === expected[i].bytes && item.sha256 === expected[i].sha256), 'INTEGRITY_FAILED', 'Archive files differ from the inventory.');
  await safeFile(entry, `source/${record.project}`);
  const reviewNames = (await readdir(entry)).includes('reviews') ? (await readdir(path.join(entry, 'reviews'))).filter(n => n.endsWith('.json')) : [];
  const reviews = [];
  for (const name of reviewNames) {
    const review = await json(await safeFile(entry, `reviews/${name}`));
    requireThat(review.snapshot_sha256 === record.snapshot_sha256, 'INTEGRITY_FAILED', 'Review refers to a different archive snapshot.');
    reviews.push(review);
  }
  return { record, catalog: catalogRow(record,reviews) };
}

/** Explicit operator copy. Publishes only a complete verified replica; never modifies input. */
export async function importLibrary(source, destination, { dryRun = false } = {}) {
  const sourceRoot = await realpath(source), dest = path.resolve(destination);
  await mkdir(path.dirname(dest), { recursive: true });
  const realParent = await realpath(path.dirname(dest));
  const final = path.join(realParent, path.basename(dest));
  requireThat(final !== sourceRoot && !inside(sourceRoot, final) && !inside(final, sourceRoot), 'OVERLAPPING_ROOTS', 'Replica must be outside the source library.');
  requireThat(!(await readdir(realParent)).some(n => n.toLowerCase() === path.basename(final).toLowerCase()), 'ALREADY_EXISTS', 'Destination already exists; replacement is forbidden.');
  const before = await inventory(sourceRoot);
  const catalog = [];
  for (const entry of await readdir(path.join(sourceRoot, 'works'), { withFileTypes: true })) {
    requireThat(entry.isDirectory() && !entry.isSymbolicLink(), 'INVALID_ARCHIVE', 'Expected ordinary work directories.');
    const result = await validateWork(path.join(sourceRoot, 'works', entry.name));
    requireThat(entry.name === result.record.id, 'INVALID_ARCHIVE', 'Work directory and ID differ.');
    catalog.push(result.catalog);
  }
  requireThat(catalog.length > 0, 'EMPTY_LIBRARY', 'No works found.');
  if (dryRun) return { dryRun: true, works: catalog.length, files: before.length, bytes: before.reduce((s, f) => s + f.bytes, 0) };
  const stage = await mkdtemp(path.join(realParent, '.openbone-import-'));
  try {
    for (const item of before) {
      const parts = item.path.split('/');
      let output;
      if (parts[0] === 'works') {
        const work = catalog.find(row => row.workId === parts[1]);
        const section = ['source', 'evidence'].includes(parts[2]) ? 'assets' : 'records';
        output = path.join(stage, section, work.workId, work.snapshotId, ...parts.slice(2));
      } else output = path.join(stage, 'knowledge', ...parts);
      await mkdir(path.dirname(output), { recursive: true });
      await cp(await safeFile(sourceRoot, item.path), output, { errorOnExist: true, force: false });
      const bytes = await readFile(output);
      requireThat(hash(bytes) === item.sha256 && bytes.length === item.bytes, 'INTEGRITY_FAILED', 'Copy verification failed.');
    }
    requireThat(JSON.stringify(await inventory(sourceRoot)) === JSON.stringify(before), 'SOURCE_CHANGED', 'Source changed during import. No replica published.');
    await writeJsonNew(path.join(stage, 'catalog.json'), { schemaVersion: 1, works: catalog });
    await writeJsonNew(path.join(stage, 'import-receipt.json'), { schemaVersion: 1, importedAt: new Date().toISOString(), originalFiles: before, works: catalog.length, sourceUnchanged: true });
    await mkdir(path.join(stage, 'workspaces'));
    await mkdir(path.join(stage, 'bindings'));
    await rename(stage, final);
    return { dryRun: false, works: catalog.length, files: before.length, bytes: before.reduce((s, f) => s + f.bytes, 0), sourceUnchanged: true };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
