import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { access, open } from 'node:fs/promises';
import { createServer } from 'node:net';
import { id, requireThat } from './errors.js';
import { atomicJson, json, safeFile } from './files.js';
import { OpenBoneConnection } from './mcp.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stop(entry) {
  if (!entry.child || entry.exited) return;
  entry.child.kill();
  let timer;
  await Promise.race([entry.stopped, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
  clearTimeout(timer);
  if (!entry.exited) { entry.child.kill('SIGKILL'); await entry.stopped; }
}

/** Starts existing isolated OpenBone application services, without rewriting their model or MCP contracts. */
export class HostedProjectPool {
  constructor(config) {
    this.config = config;
    this.entries = new Map();
    this.creations = new Map();
    this.queue = Promise.resolve();
    this.closed = false;
  }
  async checkCreate(store, projectId) {
    id(projectId);
    requireThat(projectId.length <= 64, 'INVALID_ID', 'Hosted project IDs must be at most 64 characters.');
    const projects = await store.projects();
    requireThat(projects.some(p => p.projectId === projectId) || projects.length < this.config.maxProjectsPerUser, 'PROJECT_LIMIT', 'Account project quota reached.', 429);
  }
  create(store, projectId, operation) {
    const work = (this.creations.get(store.root) ?? Promise.resolve()).then(async () => {
      await this.checkCreate(store, projectId);
      return operation();
    });
    this.creations.set(store.root, work.catch(() => {}));
    return work;
  }
  ensure(store, projectId) {
    const key = `${store.root}\0${projectId}`;
    if (this.entries.has(key)) return this.entries.get(key).ready;
    const entry = {};
    entry.ready = this.queue.then(async () => {
      requireThat(!this.closed, 'SERVICE_STOPPING', 'Hosted service is stopping.', 503);
      await this.checkCreate(store, projectId);
      return this.start(store, projectId, entry, key);
    });
    this.queue = entry.ready.catch(() => {});
    this.entries.set(key, entry);
    return entry.ready;
  }
  async start(store, projectId, entry, key) {
    const config = this.config;
    const slotsFile = path.join(config.dataRoot, 'run', 'ports.json');
    let slots;
    try { slots = await json(slotsFile); } catch (error) { if (error.code !== 'ENOENT') throw error; slots = {}; }
    let port = slots[key];
    if (port === undefined) {
      const used = new Set(Object.values(slots));
      port = Array.from({ length: config.mcpPortCount }, (_, i) => config.mcpPortStart + i).find(n => !used.has(n));
      requireThat(port, 'CAPACITY_REACHED', 'Hosted project capacity reached. Contact the operator.', 503);
      slots[key] = port;
      await atomicJson(slotsFile, slots);
    }
    requireThat(Number.isInteger(port) && port >= config.mcpPortStart && port < config.mcpPortStart + config.mcpPortCount, 'INVALID_CONFIG', 'Persisted project port is outside the configured range.');
    // An occupied assigned port is an error. Never connect to another process or silently change ports.
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => probe.close(resolve));
    const receipt = await store.project(projectId);
    const root = path.join(store.root, 'workspaces', projectId);
    let source;
    try { await safeFile(root, 'saved.openbone.json'); source = 'saved.openbone.json'; }
    catch (error) { if (error.code !== 'ENOENT') throw error; source = receipt.project; }
    if (source) await safeFile(root, source);
    const projectsFile = path.join(root, 'hosted-process.json');
    await atomicJson(projectsFile, { projects: [{ id: projectId, root, ...(source ? { source } : {}), tokenEnv: 'HOSTED_PROJECT_TOKEN' }] });
    const token = randomBytes(32).toString('base64url');
    const env = { HOSTED_PROJECT_TOKEN: token };
    for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'JAVA_HOME', 'HOME', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) if (process.env[name]) env[name] = process.env[name];
    await access(config.javaJar);
    const log = await open(path.join(root, 'hosted-java.log'), 'a', 0o600);
    let child;
    try {
      child = spawn(config.javaCommand, [`-Xmx${config.javaHeapMb}m`, '-Djava.awt.headless=true', '-Dopenbone.lang=en', '-jar', config.javaJar, '--headless', '--projects', projectsFile, '--port', String(port)], { env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
      entry.child = child;
      entry.exited = false;
      child.once('error', () => { entry.exited = true; });
      entry.stopped = new Promise(resolve => child.once('close', () => { entry.exited = true; resolve(); }));
    }
    finally { await log.close(); }
    const connection = new OpenBoneConnection({ url: `http://127.0.0.1:${port}/mcp/${projectId}`, token, timeoutMs: config.timeoutMs });
    try {
      const deadline = Date.now() + config.startupTimeoutMs;
      let ready = false;
      while (Date.now() < deadline && !entry.exited) {
        try {
          const result = await connection.call('openbone_get_context', {}, AbortSignal.timeout(Math.max(1, deadline - Date.now())));
          const view = result.structuredContent?.data?.view;
          requireThat(!result.isError && view?.projectId === projectId && path.resolve(view.workspaceRoot) === path.resolve(root), 'ENDPOINT_MISMATCH', 'Hosted project endpoint identity mismatch.');
          ready = true; break;
        } catch { await delay(100); }
      }
      requireThat(ready && !entry.exited, 'PROJECT_START_FAILED', 'OpenBone could not start on its assigned port. Ask the operator to check Java, project files and port availability.', 503);
    } catch (error) { await stop(entry); throw error; }
    entry.connection = connection;
    // A crashed process is never silently restarted with a stale saved snapshot during this service lifetime.
    return {
      call: (...args) => { requireThat(!entry.exited, 'PROJECT_STOPPED', 'Project process stopped. Contact the operator; saved work can be recovered after service restart.', 503); return connection.call(...args); },
      list: (...args) => { requireThat(!entry.exited, 'PROJECT_STOPPED', 'Project process stopped. Contact the operator.', 503); return connection.list(...args); },
    };
  }
  async close() {
    this.closed = true;
    await this.queue;
    let saveFailed = false;
    for (const entry of this.entries.values()) {
      if (!entry.child || entry.exited) continue;
      try {
        if (entry.connection) {
          const context = await entry.connection.call('openbone_get_context', {});
          const data = context.structuredContent?.data;
          const result = await entry.connection.call('openbone_save_project', { path: path.join(data.view.workspaceRoot, 'saved.openbone.json'), portable: true, overwrite: true, expectedRevision: data.revision, requestId: randomUUID() });
          requireThat(!result.isError, 'SAVE_FAILED', 'Could not checkpoint a hosted project.');
        }
      } catch { saveFailed = true; }
      await stop(entry);
    }
    requireThat(!saveFailed, 'SHUTDOWN_SAVE_FAILED', 'One or more projects could not be checkpointed. Inspect saved work before reopening.', 500);
  }
}
