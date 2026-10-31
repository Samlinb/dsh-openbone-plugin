import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Config, connectionConfig, defaultServiceUrl } from '../src/config.js';

test('fresh installation uses the built-in service and exposes editable settings', () => {
  const config = Config({});
  assert.equal(config.serviceUrl.get(), defaultServiceUrl);
  assert.equal(config.autoTrial.get(), true);
  assert.equal(Config.dict.accessToken.meta.role, 'secret');
  for (const field of Object.values(Config.dict)) assert.equal(field.meta.volatile, true);
  for (const raw of [config, {}, { serviceUrl: '' }]) assert.equal(connectionConfig(raw, {}).url.href, 'https://openbone.dsh.roorobot.com/');
  assert.throws(() => connectionConfig({ serviceUrl: 'missing-address' }, {}), error => error.code === 'INVALID_CONFIG' && !error.message.includes('Invalid URL'));
});

test('connection settings support environment migration, live references, manual keys and strict endpoint boundaries', () => {
  const token = 'test_manual_key_'.padEnd(40, 'x');
  assert.equal(connectionConfig(Config({}), { OPENBONE_LIBRARY_URL: 'https://override.example.com/' }).url.href, 'https://override.example.com/');
  assert.equal(connectionConfig({ serviceUrl: 'https://custom.example.com/' }, { OPENBONE_LIBRARY_URL: 'https://override.example.com/' }).url.href, 'https://custom.example.com/');
  assert.equal(connectionConfig(Config({}), { OPENBONE_LIBRARY_URL: 'https://animation.example.com/', OPENBONE_LIBRARY_TOKEN: token }).token, token);
  const raw = Config({ serviceUrl: 'https://animation.example.com/u/alice/', accessToken: token, autoTrial: false });
  assert.equal(connectionConfig(raw, {}).url.pathname, '/u/alice/');
  let address = 'https://one.example.com/';
  const live = { serviceUrl: { get: () => address } };
  assert.equal(connectionConfig(live, {}).url.hostname, 'one.example.com');
  address = 'https://two.example.com/';
  assert.equal(connectionConfig(live, {}).url.hostname, 'two.example.com');
  for (const serviceUrl of ['http://remote.example.com/', 'https://key@animation.example.com/', 'https://animation.example.com/?key=private', 'https://animation.example.com/u/alice', 'https://animation.example.com/u/alice/']) {
    assert.throws(() => connectionConfig({ serviceUrl }, {}), { code: 'INVALID_CONFIG' });
  }
});

test('native setup page saves with its read revision, protects secret retention, discards and guides first use in both languages', async t => {
  const { JSDOM } = await import('jsdom');
  const React = await import('react');
  const { act } = React;
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dsh.example.com/' });
  const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const slots = new Map(), dictionaries = {}, effects = [], writes = [];
  let language = 'en', copied, module, checkRequests = 0;
  let snapshot = { status: 'ready', writable: true, revision: 7, value: { serviceUrl: '', autoTrial: true, tokenEnv: 'OPENBONE_LIBRARY_TOKEN', timeoutMs: 60000 } };
  const form = { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: async (ops, revision) => { writes.push({ ops, revision }); snapshot = { ...snapshot, revision: snapshot.revision + 1, value: { ...snapshot.value, ...Object.fromEntries(ops.filter(op => op.op === 'set').map(op => [op.path[0], op.value])) } }; return true; } };
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), { document: dom.window.document, window: { __ModuleLoader__: { load: entry => { module = entry.factory(name => { assert.equal(name, 'react'); return React; }); } } }, URL, AbortController, fetch: async (url, init) => { assert.equal(url.href, 'https://dsh.example.com/api/openbone-studio/check'); assert.equal(init.method, 'POST'); checkRequests++; return Response.json({ connected: true, projectCount: 2 }); }, navigator: { clipboard: { writeText: async text => { copied = text; } } } });
  module.apply({ effect: fn => { effects.push(fn()); }, locale: { register: (ns, values) => { dictionaries[ns] = values; return () => {}; }, bind: ns => key => dictionaries[ns][language][key] }, configForms: { get: ns => { assert.equal(ns, 'openbone'); return form; } }, slots: { inject: (name, fn) => fn(), register: (options, component) => { slots.set(options.name, component); return () => {}; } } });
  const Page = slots.get('plugins.bundle.config');
  const root = createRoot(dom.window.document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); for (const dispose of effects) dispose?.(); Object.assign(globalThis, previous); dom.window.close(); });
  const click = async label => { const button = [...document.querySelectorAll('button')].find(node => node.textContent === label); assert.ok(button, label); await act(async () => button.click()); };
  const input = async (selector, value) => {
    const node = document.querySelector(selector); assert.ok(node);
    // React listens to input changes; use its native setter to emulate typing.
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new dom.window.Event('input', { bubbles: true })); node.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  };
  await act(async () => root.render(React.createElement(Page)));
  assert.match(document.body.textContent, /Setup needed/);
  await click('Save connection'); assert.match(document.body.textContent, /Enter the service address/); assert.equal(writes.length, 0);
  await input('input[type="url"]', 'https://animation.example.com/');
  await click('Save connection');
  assert.equal(writes.length, 1); assert.equal(writes[0].revision, 7);
  assert.equal(writes[0].ops.find(op => op.path[0] === 'serviceUrl').value, 'https://animation.example.com/');
  assert.ok(!writes[0].ops.some(op => op.path[0] === 'accessToken'));
  await click('Check connection'); assert.equal(checkRequests, 1); assert.match(document.body.textContent, /Connected · available projects: 2/);
  await click('Copy connection check'); assert.match(copied, /Check my OpenBone connection/);
  await input('input[type="url"]', 'https://changed.example.com/'); assert.doesNotMatch(document.body.textContent, /Connected · available projects: 2/); await click('Discard changes'); assert.equal(document.querySelector('input[type="url"]').value, 'https://animation.example.com/');
  language = 'zh'; await act(async () => root.render(React.createElement(Page)));
  assert.match(document.body.textContent, /连接创作空间/);
  assert.deepEqual(Object.keys(dictionaries['openbone.setup'].en), Object.keys(dictionaries['openbone.setup'].zh));
});
