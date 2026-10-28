import path from 'node:path';
import { mkdir, mkdtemp, rename, rm, cp, readFile, readdir, realpath } from 'node:fs/promises';
import { id, text, requireThat } from './errors.js';
import { json, hash, encode, safeFile, inventory, writeJsonNew, atomicJson } from './files.js';

export class LibraryStore {
  constructor(root) { this.root = path.resolve(root); this.queue = Promise.resolve(); }
  async init() {
    this.root = await realpath(this.root);
    this.catalog = await json(await safeFile(this.root, 'catalog.json'));
    requireThat(this.catalog.schemaVersion === 1 && Array.isArray(this.catalog.works), 'INVALID_CATALOG', 'Unsupported catalog.');
    for (const row of this.catalog.works) { id(row.workId); requireThat(/^[a-f0-9]{64}$/.test(row.snapshotId), 'INVALID_CATALOG', 'Invalid snapshot identity.'); }
    return this;
  }
  exclusive(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {}); // Keep the writer queue usable after an individually reported failure.
    return next;
  }
  search({ query = '', offset = 0, limit = 20, status } = {}) {
    requireThat(typeof query === 'string' && query.length <= 500 && Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 100 && (status === undefined || ['pending','approved','needs_revision','rejected'].includes(status)), 'INVALID_INPUT', 'Invalid search filters.');
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const rows = this.catalog.works.filter(r => (!status || r.status === status) && words.every(w => `${r.title} ${r.tags.join(' ')} ${r.scope}`.toLocaleLowerCase().includes(w)));
    return { total: rows.length, offset, hasMore: offset + limit < rows.length, works: rows.slice(offset, offset + limit) };
  }
  work(workId, snapshotId) {
    id(workId);
    const row = this.catalog.works.find(r => r.workId === workId && (snapshotId === undefined || r.snapshotId === snapshotId));
    requireThat(row, 'WORK_NOT_FOUND', 'Unknown work or snapshot.', 404);
    return row;
  }
  async read(workId, snapshotId) {
    const row = this.work(workId, snapshotId), base = path.join(this.root, 'records', row.workId, row.snapshotId);
    const record = await json(await safeFile(base, 'record.json'));
    const reviews = [];
    const names = await readdir(base);
    if (names.includes('reviews')) for (const name of (await readdir(path.join(base, 'reviews'))).filter(n => n.endsWith('.json')).sort()) reviews.push(await json(await safeFile(base, `reviews/${name}`)));
    const analysis = await readFile(await safeFile(base, 'analysis.md'), 'utf8');
    return { ...row, derivedFrom: record.derived_from, analysis, reviews };
  }
  async lessons() {
    const base = path.join(this.root, 'knowledge', 'lessons');
    return { lessons: (await inventory(base)).filter(f => f.path.endsWith('.md')).map(({path: name, sha256}) => ({ name, sha256 })) };
  }
  async lesson(name) {
    requireThat(typeof name === 'string' && name.endsWith('.md'), 'INVALID_INPUT', 'Expected a lesson name.');
    return { name, text: await readFile(await safeFile(path.join(this.root, 'knowledge', 'lessons'), name), 'utf8') };
  }
  async verify(row) {
    const recordsRoot = path.join(this.root, 'records', row.workId, row.snapshotId);
    const manifestBytes = await readFile(await safeFile(recordsRoot, 'manifest.json'));
    requireThat(hash(manifestBytes) === row.snapshotId, 'INTEGRITY_FAILED', 'Snapshot manifest changed.');
    const expected = JSON.parse(manifestBytes);
    const actual = await inventory(path.join(this.root, 'assets', row.workId, row.snapshotId));
    requireThat(expected.length === actual.length && actual.every(item => expected.some(e => e.path === item.path && e.bytes === item.bytes && e.sha256 === item.sha256)), 'INTEGRITY_FAILED', 'Archived assets changed.');
  }
  async create({ workId, snapshotId, projectId }) {
    id(projectId);
    const row = this.work(workId, snapshotId);
    return this.exclusive(async () => {
      const parent = await realpath(path.join(this.root, 'workspaces'));
      const directory = path.join(parent, projectId);
      if ((await readdir(parent)).includes(projectId)) {
        const receipt = await json(await safeFile(directory, 'project-receipt.json'));
        requireThat(receipt.workId === row.workId && receipt.snapshotId === row.snapshotId, 'PROJECT_CONFLICT', 'Project ID is already used for another reference.', 409);
        return { ...receipt, replay: true };
      }
      await this.verify(row);
      const record = await json(await safeFile(path.join(this.root, 'records', row.workId, row.snapshotId), 'record.json'));
      const stage = await mkdtemp(path.join(parent, '.project-'));
      try {
        const source = path.join(this.root, 'assets', row.workId, row.snapshotId, 'source');
        const before = await inventory(source);
        for (const item of before) {
          const output = path.join(stage, ...item.path.split('/'));
          await mkdir(path.dirname(output), { recursive: true });
          await cp(await safeFile(source, item.path), output, { force: false, errorOnExist: true });
          requireThat(hash(await readFile(output)) === item.sha256, 'INTEGRITY_FAILED', 'Project copy failed verification.');
        }
        await this.verify(row);
        const receipt = { schemaVersion: 1, projectId, workId: row.workId, snapshotId: row.snapshotId, project: record.project, createdAt: new Date().toISOString(), userApproval: 'pending' };
        await writeJsonNew(path.join(stage, 'project-receipt.json'), receipt);
        await rename(stage, directory);
        return { ...receipt, replay: false };
      } finally { await rm(stage, { recursive: true, force: true }); }
    });
  }
  async project(projectId) {
    id(projectId);
    return json(await safeFile(path.join(this.root, 'workspaces', projectId), 'project-receipt.json'));
  }
  bindingFile(sessionId) { return path.join(this.root, 'bindings', `${hash(text(sessionId, 256))}.json`); }
  async binding(sessionId) {
    try { return await json(this.bindingFile(sessionId)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async bind(sessionId, projectId, expectedProjectId = null) {
    await this.project(projectId);
    return this.exclusive(async () => {
      const current = await this.binding(sessionId);
      requireThat((current?.projectId ?? null) === expectedProjectId, 'BINDING_CONFLICT', 'Binding changed; read the current binding before retrying.', 409);
      const receipt = { projectId, updatedAt: new Date().toISOString() };
      await atomicJson(this.bindingFile(sessionId), receipt);
      return receipt;
    });
  }
}
