import path from 'node:path';
import { parseArgs } from 'node:util';
import { realpath, access } from 'node:fs/promises';
import { json, writeJsonNew } from '../src/files.js';
import { requireThat } from '../src/errors.js';
import { createHostedService, hostedConfig, recoverHostedLock } from '../src/hosted.js';
import { initializeHost, manageAccount, publishCredentials, accountIds, readAccount } from '../src/hosted-accounts.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { config: { type: 'string' }, root: { type: 'string' }, jar: { type: 'string' }, 'public-url': { type: 'string' }, port: { type: 'string', default: '39872' }, user: { type: 'string' }, output: { type: 'string' } } });
const [command] = positionals;
try {
  requireThat(values.config, 'USAGE', 'Use: node tools/hosted.mjs init|serve|add-user|rotate-key|disable-user|enable-user|status --config <private hosted.json>.');
  const configFile = path.resolve(values.config);
  if (command === 'init') {
    requireThat(values.root && values.jar && values['public-url'], 'USAGE', 'init requires --root <new private data directory> --jar <OpenBone.jar> --public-url <origin> [--port 39872].');
    const config = hostedConfig({ dataRoot: path.resolve(values.root), javaJar: await realpath(values.jar), publicUrl: values['public-url'], port: Number(values.port) });
    try { await access(configFile); throw new Error('Configuration already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await initializeHost(config.dataRoot);
    await writeJsonNew(configFile, config);
    console.log('Hosted configuration initialized. No accounts or private reference assets were imported.');
  } else {
    const config = hostedConfig(await json(configFile));
    if (command === 'serve') {
      const service = await createHostedService(config);
      await service.listen();
      console.log(`OpenBone hosted service ready: ${config.publicUrl}`);
      let stopping = false;
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
        if (stopping) return; stopping = true;
        try { await service.close(); } catch { console.error('Hosted shutdown failed to checkpoint every project. Inspect saved work.'); process.exitCode = 1; }
      });
    } else if (command === 'recover-lock') {
      console.log(JSON.stringify({ recovered: await recoverHostedLock(config.dataRoot) }));
    } else if (command === 'status') {
      const users = [];
      for (const userId of await accountIds(config.dataRoot)) { const a = await readAccount(config.dataRoot, userId); users.push({ userId, enabled: a.enabled }); }
      console.log(JSON.stringify({ publicUrl: config.publicUrl, users }, null, 2));
    } else {
      const operations = { 'add-user': 'add', 'rotate-key': 'rotate', 'disable-user': 'disable', 'enable-user': 'enable' };
      requireThat(operations[command] && values.user, 'USAGE', 'Specify an account operation and --user <id>. add-user and rotate-key also require --output <new private credentials.json>.');
      if (['add-user', 'rotate-key'].includes(command)) {
        requireThat(values.output, 'USAGE', 'Specify --output <new private credentials.json>. Credentials are never printed.');
        try { await access(values.output); throw new Error('Credential output already exists. Choose a new file.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const receipt = await manageAccount(config.dataRoot, values.user, operations[command]);
      if (receipt.token) await publishCredentials(path.resolve(values.output), config.publicUrl, receipt);
      console.log(JSON.stringify({ userId: receipt.userId, operation: command, ...(receipt.token ? { credentialsFile: path.resolve(values.output) } : { enabled: receipt.enabled }) }));
    }
  }
} catch (error) { console.error(`${error.code ?? 'HOSTED_OPERATION_FAILED'}: ${error.message}`); process.exitCode = 1; }
