import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, mkdir, writeFile, rename, realpath } from 'node:fs/promises';
import path from 'node:path';
import { requireThat } from './errors.js';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
export const encode = value => `${JSON.stringify(value, null, 2)}\n`;
export function relativeName(name) {
  requireThat(typeof name === 'string' && name.length > 0 && !/[\\:\x00-\x1f]/.test(name) && name.split('/').every(p => p !== '' && p !== '.' && p !== '..' && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)), 'UNSAFE_PATH', 'Invalid relative asset path.');
  return name;
}
export function inside(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
export async function safeFile(root, name) {
  relativeName(name);
  const base = await realpath(root);
  let current = base;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    const info = await lstat(current);
    requireThat(!info.isSymbolicLink(), 'LINK_DENIED', 'Linked assets are not allowed.');
  }
  requireThat(inside(base, await realpath(current)) && (await lstat(current)).isFile(), 'UNSAFE_PATH', 'Expected a regular file within the asset root.');
  return current;
}
export async function inventory(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    relativeName(name);
    const file = path.join(root, entry.name), stat = await lstat(file);
    requireThat(!stat.isSymbolicLink(), 'LINK_DENIED', 'Linked paths cannot be archived.');
    if (stat.isDirectory()) result.push(...await inventory(file, name));
    else {
      requireThat(stat.isFile(), 'UNSAFE_PATH', 'Only regular files can be archived.');
      const bytes = await readFile(file);
      result.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
export async function writeJsonNew(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, encode(value), { flag: 'wx', mode: 0o600 });
}
export async function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeJsonNew(temp, value);
  await rename(temp, file);
}
