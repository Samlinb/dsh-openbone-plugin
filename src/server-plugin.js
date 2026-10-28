import { createAssetService } from './server.js';
export const name = 'openbone-asset-server';
export async function apply(ctx, config) {
  const service = await createAssetService(config);
  ctx.effect(() => async () => service.close());
  await service.listen();
}
