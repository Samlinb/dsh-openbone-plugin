import { requireThat } from './errors.js';

/** DashScope async image API. Credentials and provider URLs are operator-owned. */
export function imageProvider(raw, env = process.env) {
  if (!raw) return null;
  const { model, api = 'image-synthesis', apiKeyEnv = 'DASHSCOPE_API_KEY', baseUrl = 'https://dashscope.aliyuncs.com/api/v1/', size = 1024, timeoutMs = 30000, maxJobsPerProject = 20, pollIntervalMs = 3000, pollWaitMs = 15000 } = raw;
  requireThat(Object.keys(raw).every(k => ['model', 'api', 'apiKeyEnv', 'baseUrl', 'size', 'timeoutMs', 'maxJobsPerProject', 'pollIntervalMs', 'pollWaitMs'].includes(k)), 'INVALID_CONFIG', 'Unknown image generation setting.');
  requireThat(['image-synthesis', 'image-generation'].includes(api), 'INVALID_CONFIG', 'Select an explicit supported asynchronous image API.');
  const base = new URL(baseUrl);
  requireThat(base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash && base.pathname.endsWith('/') && /(?:^|\.)aliyuncs\.com$/.test(base.hostname), 'INVALID_CONFIG', 'Image generation requires an operator-configured Alibaba HTTPS API.');
  requireThat(typeof model === 'string' && model.length > 0 && /^[A-Z][A-Z0-9_]*$/.test(apiKeyEnv) && env[apiKeyEnv], 'INVALID_CONFIG', 'Configure the image model and its server-side credential.');
  requireThat(Number.isInteger(size) && size >= 512 && size <= 1440 && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, 'INVALID_CONFIG', 'Invalid image generation limits.');
  requireThat(Number.isInteger(maxJobsPerProject) && maxJobsPerProject >= 1 && maxJobsPerProject <= 1000, 'INVALID_CONFIG', 'Invalid project image-job quota.');
  requireThat(Number.isInteger(pollIntervalMs) && pollIntervalMs >= 1000 && pollIntervalMs <= 10000, 'INVALID_CONFIG', 'Invalid image polling interval.');
  requireThat(Number.isInteger(pollWaitMs) && pollWaitMs >= pollIntervalMs && pollWaitMs <= 20000 && timeoutMs + pollWaitMs <= 55000, 'INVALID_CONFIG', 'Image polling must fit within the service request timeout.');
  async function request(route, body, signal) {
    let response;
    try {
      response = await fetch(new URL(route, base), { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]), headers: { Authorization: `Bearer ${env[apiKeyEnv]}`, ...(body ? { 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch {
      requireThat(false, 'IMAGE_TRANSPORT_UNKNOWN', 'Image provider outcome is unknown. Reuse this requestId; do not submit another paid generation automatically.', 502);
    }
    const result = await response.json();
    const providerCode = typeof result.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(result.code) ? result.code : 'request_rejected';
    requireThat(response.ok && !result.code, 'IMAGE_REQUEST_REJECTED', `The image provider rejected the operation (${providerCode}). Check its account, model and quota; do not retry generation automatically.`, 502);
    return result;
  }
  return {
    model, api, maxJobsPerProject, pollIntervalMs, pollWaitMs, supportsReferences: api === 'image-generation' && /^qwen-image-(3\.0|2\.1)/.test(model),
    forJob(job) { return imageProvider({ ...raw, model: job.model, api: job.api ?? 'image-synthesis' }, env); },
    async submit(prompt, signal, images = []) {
      requireThat(images.length === 0 || (api === 'image-generation' && /^qwen-image-(3\.0|2\.1)/.test(model)), 'REFERENCE_UNSUPPORTED', 'Configure a reference-capable Qwen image-generation model before producing referenced parts.', 409);
      const route = api === 'image-generation' ? 'services/aigc/image-generation/generation' : 'services/aigc/text2image/image-synthesis';
      const input = api === 'image-generation' ? { messages: [{ role: 'user', content: [...images.map(image => ({ image })), { text: prompt }] }] } : { prompt };
      const result = await request(route, { model, input, parameters: { size: `${size}*${size}`, n: 1, prompt_extend: false, watermark: false } }, signal);
      const taskId = result.output?.task_id;
      requireThat(typeof taskId === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(taskId), 'IMAGE_PROVIDER_ERROR', 'Image provider did not return a task identity.', 502);
      return taskId;
    },
    async poll(taskId, signal) {
      const result = await request(`tasks/${taskId}`, null, signal);
      const status = result.output?.task_status;
      if (status === 'SUCCEEDED') return { status: 'succeeded', url: result.output.results?.[0]?.url ?? result.output.choices?.[0]?.message?.content?.find(c => typeof c.image === 'string')?.image };
      if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(status)) return { status: 'failed' };
      requireThat(['PENDING', 'RUNNING', 'SUSPENDED'].includes(status), 'IMAGE_PROVIDER_ERROR', 'Unexpected image provider task status.', 502);
      return { status: 'running' };
    },
    async download(address, signal) {
      const url = new URL(address);
      requireThat(url.protocol === 'https:' && !url.username && !url.password && /\.oss[-.][a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname), 'IMAGE_PROVIDER_ERROR', 'Image result must be an Alibaba object-storage HTTPS resource.', 502);
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]) });
      requireThat(response.ok, 'IMAGE_DOWNLOAD_FAILED', 'Could not download the generated image. Poll the same job again.', 502);
      let size = 0; const chunks = [];
      for await (const chunk of response.body) { size += chunk.length; requireThat(size <= 16 * 1024 * 1024, 'IMAGE_TOO_LARGE', 'Image exceeds 16 MiB.'); chunks.push(chunk); }
      return Buffer.concat(chunks);
    },
  };
}
