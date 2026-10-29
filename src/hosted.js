import { createServer } from 'node:http';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { realpath, open, unlink, readFile } from 'node:fs/promises';
import { fields, requireThat, Failure } from './errors.js';
import { hash } from './files.js';
import { readAccount, provisionAccount } from './hosted-accounts.js';
import { createAssetService } from './server.js';
import { HostedProjectPool } from './hosted-projects.js';

export function hostedConfig(raw) {
  fields(raw, ['dataRoot', 'javaJar', 'javaCommand', 'javaHeapMb', 'port', 'publicUrl', 'mcpPortStart', 'mcpPortCount', 'maxProjectsPerUser', 'timeoutMs', 'startupTimeoutMs', 'previewTtlMs', 'maxBodyBytes', 'controlTokenEnv'], ['dataRoot', 'javaJar', 'port', 'publicUrl']);
  const config = { javaCommand: 'java', javaHeapMb: 256, mcpPortStart: 39900, mcpPortCount: 32, maxProjectsPerUser: 4, timeoutMs: 60000, startupTimeoutMs: 30000, previewTtlMs: 600000, maxBodyBytes: 2097152, ...raw };
  const url = new URL(config.publicUrl);
  requireThat(url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))), 'INVALID_CONFIG', 'Hosted publicUrl must be an HTTPS or loopback HTTP origin.');
  config.publicUrl = url.href;
  for (const name of ['dataRoot', 'javaJar', 'javaCommand']) requireThat(typeof config[name] === 'string' && config[name].length > 0, 'INVALID_CONFIG', 'Missing hosted server path.');
  for (const name of ['port', 'javaHeapMb', 'mcpPortStart', 'mcpPortCount', 'maxProjectsPerUser', 'timeoutMs', 'startupTimeoutMs', 'previewTtlMs', 'maxBodyBytes']) requireThat(Number.isInteger(config[name]) && config[name] >= 1 && config[name] <= 2147483647, 'INVALID_CONFIG', 'Invalid hosted server limit.');
  requireThat(config.port <= 65535 && config.mcpPortStart + config.mcpPortCount <= 65536 && !(config.port >= config.mcpPortStart && config.port < config.mcpPortStart + config.mcpPortCount), 'INVALID_CONFIG', 'Invalid or overlapping service port range.');
  return config;
}

/** For a stopped service under a single supervisor. Never removes a live owner's lock. */
export async function recoverHostedLock(root) {
  const file = path.join(root, 'run', 'host.lock');
  let bytes;
  try { bytes = await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  const { pid } = JSON.parse(bytes);
  requireThat(Number.isSafeInteger(pid) && pid > 0, 'INVALID_LOCK', 'Invalid service lock; inspect it manually.');
  try { process.kill(pid, 0); throw new Failure('SERVICE_RUNNING', 'The service lock belongs to a running process. Stop it before recovery.', 409); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  requireThat(await readFile(file, 'utf8') === bytes, 'LOCK_CHANGED', 'Service lock changed during recovery.');
  await unlink(file);
  return true;
}

export async function createHostedService(raw, { env = process.env } = {}) {
  const config = hostedConfig(raw);
  const controlToken = config.controlTokenEnv ? env[config.controlTokenEnv] : undefined;
  if (config.controlTokenEnv) requireThat(/^[A-Z][A-Z0-9_]*$/.test(config.controlTokenEnv) && typeof controlToken === 'string' && /^[a-f0-9]{64}$/.test(controlToken), 'INVALID_CONFIG', 'Configure the private control-plane credential environment variable.');
  config.dataRoot = await realpath(config.dataRoot);
  config.javaJar = await realpath(config.javaJar);
  const lockFile = path.join(config.dataRoot, 'run', 'host.lock');
  const lock = await open(lockFile, 'wx', 0o600);
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  const pool = new HostedProjectPool(config), services = new Map();
  let closing = false;
  let controlQueue = Promise.resolve();
  const publicUrl = new URL(config.publicUrl);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      requireThat(!closing, 'SERVICE_STOPPING', 'Hosted service is stopping.', 503);
      const localHost = `127.0.0.1:${config.port}`;
      requireThat(req.headers.host === publicUrl.host || req.headers.host === localHost || req.headers.host === `localhost:${config.port}`, 'INVALID_HOST', 'Untrusted request host.', 403);
      if (req.url === '/healthz' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json'); res.end('{"ready":true}'); return;
      }
      if (req.url === '/internal/v1/accounts' && req.method === 'POST') {
        const supplied = req.headers.authorization ?? '', expected = `Bearer ${controlToken}`;
        requireThat(!req.headers.origin, 'INVALID_ORIGIN', 'Control provisioning accepts server-to-server requests only.', 403);
        requireThat(controlToken && /^Bearer [a-f0-9]{64}$/.test(supplied) && supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)), 'UNAUTHORIZED', 'Private control-plane authentication required.', 401);
        requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 'INVALID_REQUEST', 'Expected JSON.', 400);
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; requireThat(size <= 4096, 'TOO_LARGE', 'Provision request exceeds limit.', 413); chunks.push(chunk); }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks)); } catch { throw new Failure('INVALID_JSON', 'Malformed JSON.'); }
        const provisioning = controlQueue.then(() => provisionAccount(config.dataRoot, body));
        controlQueue = provisioning.catch(() => {});
        const receipt = await provisioning;
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(receipt)); return;
      }
      const match = /^\/u\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(v1\/|preview\/)/.exec(req.url);
      requireThat(match, 'NOT_FOUND', 'Unknown service route.', 404);
      let account;
      try { account = await readAccount(config.dataRoot, match[1]); }
      catch (error) { if (error.code !== 'ENOENT') throw error; throw new Failure('UNAUTHORIZED', 'Account or credential is unavailable.', 401); }
      requireThat(account.enabled && (!account.expiresAt || Date.parse(account.expiresAt) > Date.now()), 'UNAUTHORIZED', 'Account or credential is unavailable.', 401);
      if (match[2] === 'v1/') {
        const token = /^Bearer ([A-Za-z0-9_|-]{32,256})$/.exec(req.headers.authorization ?? '')?.[1];
        requireThat(token && timingSafeEqual(Buffer.from(hash(token)), Buffer.from(account.tokenHash)), 'UNAUTHORIZED', 'Account or credential is unavailable.', 401);
      }
      if (!services.has(account.userId)) {
        const internalToken = randomBytes(32).toString('base64url');
        const provisioner = {
          ensure: (store, projectId) => pool.ensure(store, projectId),
          create: (store, projectId, operation) => pool.create(store, projectId, async () => {
            const latest = await readAccount(config.dataRoot, account.userId), projects = await store.projects();
            requireThat(projects.some(p => p.projectId === projectId) || projects.length < (latest.maxProjects ?? config.maxProjectsPerUser), 'PROJECT_LIMIT', 'Account project quota reached.', 429);
            return operation();
          }),
        };
        const creating = createAssetService({ dataRoot: path.join(config.dataRoot, 'tenants', account.userId), port: config.port, publicUrl: new URL(`u/${account.userId}/`, publicUrl).href, tokenEnv: 'HOSTED_INTERNAL_TOKEN', projects: [], timeoutMs: config.timeoutMs, previewTtlMs: config.previewTtlMs, maxBodyBytes: config.maxBodyBytes }, { env: { HOSTED_INTERNAL_TOKEN: internalToken }, provisioner }).then(service => ({ service, internalToken }));
        services.set(account.userId, creating);
        creating.catch(() => { if (services.get(account.userId) === creating) services.delete(account.userId); });
      }
      const { service, internalToken } = await services.get(account.userId);
      req.headers.authorization = `Bearer ${internalToken}`;
      // The gateway already validated the actual Host. The embedded handler uses its advertised base URL.
      req.headers.host = publicUrl.host;
      await service.handle(req, res);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      res.statusCode = error instanceof Failure ? error.status : 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { code: error instanceof Failure ? error.code : 'INTERNAL_ERROR', message: error instanceof Failure ? error.message : 'Hosted service failed. Contact the operator.' } }));
    }
  });
  server.requestTimeout = config.timeoutMs;
  server.headersTimeout = Math.min(config.timeoutMs, 30000);
  return {
    config,
    async listen() {
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve); }); }
      catch (error) { await lock.close(); await unlink(lockFile); throw error; }
      return `http://127.0.0.1:${config.port}`;
    },
    async close() {
      if (closing) return;
      closing = true;
      try {
        if (server.listening) await new Promise(resolve => server.close(resolve));
        const tenants = await Promise.allSettled([...services.values()].map(async promise => { const { service } = await promise; await service.close(); }));
        // A broken tenant must never prevent other users' JVMs from being checkpointed and stopped.
        await pool.close();
        requireThat(tenants.every(result => result.status === 'fulfilled'), 'TENANT_CLOSE_FAILED', 'A tenant service failed to close. Inspect its private configuration.', 500);
      } finally { await lock.close(); await unlink(lockFile); }
    },
  };
}
