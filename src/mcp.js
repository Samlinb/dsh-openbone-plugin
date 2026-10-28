import { requireThat } from './errors.js';

/** Narrow adapter for OpenBone's JSON Streamable HTTP endpoint, not a generic MCP implementation. */
export class OpenBoneConnection {
  constructor({ url, token, timeoutMs }) {
    const endpoint = new URL(url);
    requireThat(!endpoint.username && !endpoint.password && !endpoint.hash && !endpoint.search && (endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))), 'INVALID_CONFIG', 'MCP requires HTTPS or a loopback HTTP endpoint.');
    this.url = endpoint.href; this.token = token; this.timeoutMs = timeoutMs; this.next = 0;
  }
  async request(method, params, signal, notification = false) {
    const response = await fetch(this.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])]),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${this.token}`, ...(this.protocol ? { 'MCP-Protocol-Version': this.protocol } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: ++this.next }), method, params }),
    });
    requireThat(response.ok, 'MCP_HTTP_ERROR', `OpenBone returned HTTP ${response.status}.`, 502);
    if (notification) { await response.arrayBuffer(); return; }
    requireThat(response.headers.get('content-type')?.includes('application/json'), 'MCP_PROTOCOL_ERROR', 'Expected OpenBone JSON transport.', 502);
    const envelope = await response.json();
    requireThat(envelope.jsonrpc === '2.0' && envelope.result && !envelope.error, 'MCP_PROTOCOL_ERROR', 'OpenBone rejected the protocol request.', 502);
    return envelope.result;
  }
  async ready(signal) {
    if (this.initializing) { await this.initializing; return; }
    if (this.protocol) return;
    if (!this.initializing) this.initializing = (async () => {
      const init = await this.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'dsh-openbone-plugin', version: '0.1.0' } }, signal);
      requireThat(typeof init.protocolVersion === 'string', 'MCP_PROTOCOL_ERROR', 'Missing negotiated protocol.', 502);
      this.protocol = init.protocolVersion;
      try { await this.request('notifications/initialized', {}, signal, true); }
      catch (error) { this.protocol = null; throw error; }
    })().finally(() => { this.initializing = null; });
    await this.initializing;
  }
  async list(signal) { await this.ready(signal); return this.request('tools/list', {}, signal); }
  async call(name, args, signal) { await this.ready(signal); return this.request('tools/call', { name, arguments: args }, signal); }
}
