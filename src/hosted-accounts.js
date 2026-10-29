import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, rmdir, readdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { fields, id, requireThat } from './errors.js';
import { json, safeFile, hash, writeJsonNew, atomicJson } from './files.js';
import { LibraryStore } from './store.js';

export async function initializeHost(root) {
  await mkdir(root, { mode: 0o700 });
  for (const name of ['accounts', 'tenants', 'run']) await mkdir(path.join(root, name), { mode: 0o700 });
}

export async function readAccount(root, userId) {
  id(userId);
  const account = await json(await safeFile(path.join(root, 'accounts'), `${userId}.json`));
  fields(account, ['userId', 'tokenHash', 'enabled', 'createdAt', 'expiresAt', 'maxProjects'], ['userId', 'tokenHash', 'enabled', 'createdAt']);
  requireThat(account.userId === userId && /^[a-f0-9]{64}$/.test(account.tokenHash) && typeof account.enabled === 'boolean', 'INVALID_ACCOUNT', 'Invalid hosted account.');
  requireThat(account.expiresAt === undefined || (typeof account.expiresAt === 'string' && Number.isFinite(Date.parse(account.expiresAt))), 'INVALID_ACCOUNT', 'Invalid account expiration.');
  requireThat(account.maxProjects === undefined || (Number.isInteger(account.maxProjects) && account.maxProjects >= 1 && account.maxProjects <= 4), 'INVALID_ACCOUNT', 'Invalid account project quota.');
  return account;
}

/** Private control-plane provisioning. The PHP application supplies a hash, never a plaintext user token. */
export async function provisionAccount(root, input) {
  fields(input, ['userId', 'tokenHash', 'expiresAt', 'maxProjects'], ['userId', 'tokenHash', 'expiresAt', 'maxProjects']);
  id(input.userId);
  requireThat(/^[a-f0-9]{64}$/.test(input.tokenHash) && typeof input.expiresAt === 'string' && Number.isFinite(Date.parse(input.expiresAt)) && Date.parse(input.expiresAt) > Date.now() && Number.isInteger(input.maxProjects) && input.maxProjects >= 1 && input.maxProjects <= 4, 'INVALID_ACCOUNT', 'Invalid trial account provisioning.');
  const lock = path.join(root, 'run', 'accounts.lock');
  await mkdir(lock);
  try {
    const file = path.join(root, 'accounts', `${input.userId}.json`);
    try {
      const current = await readAccount(root, input.userId);
      requireThat(current.tokenHash === input.tokenHash && current.expiresAt === input.expiresAt && current.maxProjects === input.maxProjects, 'ACCOUNT_CONFLICT', 'Account provisioning conflicts with an existing account.', 409);
      return { userId: input.userId, replay: true };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.join(root, 'tenants'), tenant = path.join(parent, input.userId);
    if (!(await readdir(parent)).includes(input.userId)) {
      const stage = await mkdtemp(path.join(parent, '.tenant-'));
      try {
        for (const name of ['records', 'assets', 'workspaces', 'bindings', 'knowledge/lessons']) await mkdir(path.join(stage, name), { recursive: true, mode: 0o700 });
        await writeJsonNew(path.join(stage, 'catalog.json'), { schemaVersion: 1, works: [] });
        await (await new LibraryStore(stage).init()).createBlank('starter');
        await writeJsonNew(path.join(stage, 'account-provision.json'), input);
        await rename(stage, tenant);
      } finally { await rm(stage, { recursive: true, force: true }); }
    }
    const receipt = await json(await safeFile(tenant, 'account-provision.json'));
    requireThat(Object.keys(input).every(key => receipt[key] === input[key]), 'ACCOUNT_CONFLICT', 'Unpublished account workspace belongs to another provisioning request.', 409);
    await writeJsonNew(file, { ...input, enabled: true, createdAt: new Date().toISOString() });
    return { userId: input.userId, replay: false };
  } finally { await rmdir(lock); }
}

export async function accountIds(root) {
  return (await readdir(path.join(root, 'accounts'))).filter(n => n.endsWith('.json')).map(n => id(n.slice(0, -5)));
}

/** Offline operator operation. The plaintext credential is returned once, never stored in the account. */
export async function manageAccount(root, userId, operation) {
  id(userId);
  requireThat(['add', 'rotate', 'disable', 'enable'].includes(operation), 'INVALID_INPUT', 'Unknown account operation.');
  const lock = path.join(root, 'run', 'accounts.lock');
  await mkdir(lock);
  try {
    const file = path.join(root, 'accounts', `${userId}.json`);
    if (operation === 'add') {
      const tenant = path.join(root, 'tenants', userId);
      // Refuse existing directories, including incomplete onboarding. Preserve them for operator recovery.
      await mkdir(tenant, { mode: 0o700 });
      for (const name of ['records', 'assets', 'workspaces', 'bindings', 'knowledge/lessons']) await mkdir(path.join(tenant, name), { recursive: true, mode: 0o700 });
      await writeJsonNew(path.join(tenant, 'catalog.json'), { schemaVersion: 1, works: [] });
      await (await new LibraryStore(tenant).init()).createBlank('starter');
      const token = randomBytes(32).toString('base64url');
      await writeJsonNew(file, { userId, tokenHash: hash(token), enabled: true, createdAt: new Date().toISOString() });
      return { userId, token };
    }
    const account = await readAccount(root, userId);
    const token = operation === 'rotate' ? randomBytes(32).toString('base64url') : undefined;
    if (token) account.tokenHash = hash(token);
    if (operation === 'disable' || operation === 'enable') account.enabled = operation === 'enable';
    await atomicJson(file, account);
    return { userId, ...(token ? { token } : { enabled: account.enabled }) };
  } finally { await rmdir(lock); }
}

export async function publishCredentials(file, baseUrl, receipt) {
  requireThat(receipt.token, 'INVALID_INPUT', 'This operation did not issue a credential.');
  await writeJsonNew(file, {
    OPENBONE_LIBRARY_URL: new URL(`u/${receipt.userId}/`, baseUrl).href,
    OPENBONE_LIBRARY_TOKEN: receipt.token,
  });
}
