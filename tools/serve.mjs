import { json } from '../src/files.js';
import { createAssetService } from '../src/server.js';
if (process.argv.length !== 3) throw new Error('Usage: node tools/serve.mjs <private server config.json>');
const service = await createAssetService(await json(process.argv[2]));
console.log(`OpenBone private asset service: ${await service.listen()}`);
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await service.close(); process.exitCode = 0; });
