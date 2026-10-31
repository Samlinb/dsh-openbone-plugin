import { mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const staging = await mkdtemp(path.join(tmpdir(), 'openbone-codex-pack-'));
const target = path.resolve(process.argv[2] ?? 'release-codex');
try {
  const root = path.join(staging, 'openbone-studio');
  await cp('codex', root, { recursive: true });
  await mkdir(path.join(root, 'server'));
  await mkdir(path.join(root, 'public'));
  for (const file of ['client-studio.html','client-studio.css','client-studio.js','client-pixels.js','client-provider.js']) await cp(path.join('public',file),path.join(root,'public',file));
  for (const file of ['codex-mcp.js', 'tool-definitions.js', 'production.js', 'errors.js', 'trial.js', 'client-workbench.js']) await cp(path.join('src', file), path.join(root, 'server', file));
  await writeFile(path.join(root, 'server', 'package.json'), '{"type":"module","engines":{"node":">=24.9.0"}}\n');
  await mkdir(target, { recursive: true });
  const marketplace = path.join(target, 'marketplace-v2');
  await mkdir(path.join(marketplace, '.agents', 'plugins'), { recursive:true });
  await mkdir(path.join(marketplace, 'plugins'), { recursive:true });
  await cp(root, path.join(marketplace, 'plugins', 'openbone-studio'), { recursive:true });
  await writeFile(path.join(marketplace, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({name:'openbone-local',plugins:[{name:'openbone-studio',source:{source:'local',path:'./plugins/openbone-studio'}}]}, null, 2)+'\n');
  const archive = path.join(target, 'openbone-studio-codex-0.1.0.tar.gz');
  const result = spawnSync('tar', ['-czf', archive, '-C', staging, 'openbone-studio'], { encoding:'utf8', windowsHide:true });
  if (result.status !== 0) throw new Error(result.stderr || 'tar failed');
  console.log(archive);
} finally { await rm(staging, { recursive:true, force:true }); }
