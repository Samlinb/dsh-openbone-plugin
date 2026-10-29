import z from '@deepseek-ai/schemastery';
import { requireThat } from './errors.js';
import { validAccessToken } from './trial.js';

export const setupHelp = 'Open Plugins → OpenBone Studio → Configure. Enter the service address supplied by your administrator and save. For a trial, use the service root and enable Automatic trial. Then ask: Check my OpenBone connection and list available projects.';

// A live root keeps the native DSH configuration page available before connection.
export const Config = z.object({
  serviceUrl: z.string().default('').description('Service address supplied by your administrator. Leave blank until you have one.').volatile(),
  accessToken: z.string().role('secret').description('Manual account access key. Leave empty for automatic trials or an environment credential.').volatile(),
  autoTrial: z.boolean().default(true).description('Automatically activate a trial on the first connection. Requires the service root address.').volatile(),
  tokenEnv: z.string().default('OPENBONE_LIBRARY_TOKEN').description('Advanced: environment variable containing a manual account access key on the DSH server.').volatile(),
  timeoutMs: z.number().step(1).min(1).max(2147483647).default(60000).description('Advanced: request timeout in milliseconds.').volatile(),
});

const valueOf = value => value && typeof value.get === 'function' ? value.get() : value;
export function connectionConfig(raw = {}, env = process.env) {
  const config = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, valueOf(value)]));
  const address = (config.serviceUrl || env.OPENBONE_LIBRARY_URL || '').trim();
  requireThat(address, 'SETUP_REQUIRED', setupHelp);
  let url;
  try { url = new URL(address); } catch { requireThat(false, 'INVALID_CONFIG', `The service address is invalid. Enter a complete address such as https://animation.example.com/. ${setupHelp}`); }
  requireThat((url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) && /^\/(?:[a-z0-9-]+\/)*$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password, 'INVALID_CONFIG', 'Use an HTTPS service address (HTTP is allowed on localhost), without a query, fragment or embedded credentials. Preserve the account path and end it with /.');
  const tokenEnv = config.tokenEnv ?? 'OPENBONE_LIBRARY_TOKEN';
  requireThat(/^[A-Z][A-Z0-9_]*$/.test(tokenEnv), 'INVALID_CONFIG', 'Enter a valid credential environment variable name in Advanced settings.');
  const token = config.accessToken || env[tokenEnv] || undefined;
  requireThat(token === undefined || validAccessToken(token), 'INVALID_CONFIG', 'The manual access key is invalid. Check the key in OpenBone Studio settings.');
  requireThat(token || config.autoTrial !== false, 'INVALID_CONFIG', 'Enter your manual account access key or enable Automatic trial in OpenBone Studio settings.');
  requireThat(token || url.pathname === '/', 'INVALID_CONFIG', 'Automatic trial requires the service root address. For an account address, enter its manual access key.');
  const timeoutMs = config.timeoutMs ?? 60000;
  requireThat(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2147483647, 'INVALID_CONFIG', 'Enter a positive request timeout in Advanced settings.');
  return { url, token, timeoutMs };
}
