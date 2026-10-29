import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { requireThat } from './errors.js';

export function validAccessToken(value) { return typeof value === 'string' && /^[A-Za-z0-9_|-]{32,256}$/.test(value); }

/** Automatic grants stay in DSH's credential provider, never in tool arguments or model-visible results. */
export function trialConnection(ctx, baseUrl, { timeoutMs, lifetime }) {
  const key = `openbone-studio/trial-${createHash('sha256').update(baseUrl.href).digest('hex').slice(0, 32)}`;
  let pending;
  return async () => {
    if (pending) return pending;
    pending = (async () => {
      requireThat(baseUrl.pathname === '/', 'INVALID_CONFIG', 'Automatic trial enrollment requires the service root URL.');
      const credentials = ctx.get('credentials');
      requireThat(credentials && typeof credentials.modifyRecord === 'function', 'CREDENTIAL_STORE_REQUIRED', 'Automatic trials require DSH credential-record storage. Use a compatible DSH version or configure a manual access key.');
      const grant = await credentials.modifyRecord(key, async current => current ?? { kind: 'grant', payload: { version: 1, origin: baseUrl.origin, installationId: randomUUID(), installationSecret: randomBytes(32).toString('hex') } });
      const data = grant?.kind === 'grant' ? grant.payload : null;
      requireThat(data?.version === 1 && data.origin === baseUrl.origin && typeof data.installationId === 'string' && /^[a-f0-9-]{36}$/.test(data.installationId) && /^[a-f0-9]{64}$/.test(data.installationSecret), 'INVALID_CREDENTIAL_RECORD', 'Stored OpenBone trial grant is invalid.');
      if (data.token) {
        requireThat(validAccessToken(data.token) && typeof data.serviceUrl === 'string', 'INVALID_CREDENTIAL_RECORD', 'Stored OpenBone trial connection is invalid.');
        requireThat(Date.parse(data.expiresAt) > Date.now(), 'TRIAL_EXPIRED', 'The OpenBone trial has expired. Contact the service administrator to continue.');
        const url = new URL(data.serviceUrl);
        requireThat(url.origin === baseUrl.origin && /^\/u\/trial-[a-f0-9]{24}\/$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password, 'INVALID_CREDENTIAL_RECORD', 'Stored OpenBone service address is invalid.');
        return { url, token: data.token };
      }
      const response = await fetch(new URL('api/v1/trial', baseUrl), {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ installation_id: data.installationId, installation_secret: data.installationSecret }),
        signal: AbortSignal.any([lifetime, AbortSignal.timeout(timeoutMs)]),
      });
      const result = await response.json();
      requireThat(response.ok, result.error?.code ?? 'TRIAL_ENROLLMENT_FAILED', 'Trial enrollment failed. Check service availability, trial limits and account status.');
      const url = new URL(result.serviceUrl);
      requireThat(url.origin === baseUrl.origin && /^\/u\/trial-[a-f0-9]{24}\/$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password && validAccessToken(result.accessToken) && Date.parse(result.account?.expiresAt) > Date.now(), 'INVALID_TRIAL_RESPONSE', 'The service returned an invalid trial connection.');
      await credentials.modifyRecord(key, async current => {
        requireThat(current?.kind === 'grant' && current.payload?.installationId === data.installationId && current.payload?.installationSecret === data.installationSecret, 'CREDENTIAL_CONFLICT', 'Trial credentials changed during enrollment. Retry the request.');
        return { kind: 'grant', payload: { ...data, serviceUrl: url.href, token: result.accessToken, expiresAt: result.account.expiresAt } };
      });
      return { url, token: result.accessToken };
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
