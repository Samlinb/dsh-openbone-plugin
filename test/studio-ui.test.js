import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

test('DSH opens the shared browser image workbench with a durable creative session',async t=>{
 const {JSDOM}=await import('jsdom'),React=await import('react'),{act}=React;
 const dom=new JSDOM('<div id="root"></div>',{url:'https://dsh.example.com/'});
 const previous={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=await import('react-dom/client');const slots=new Map(),effects=[];let module;
 vm.runInNewContext(await readFile(new URL('../src/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:entry=>{module=entry.factory(()=>React);}}},document:dom.window.document,localStorage:dom.window.localStorage,URL,URLSearchParams});
 const snapshot={status:'loading'};
 const ctx={effect:fn=>effects.push(fn()),locale:{register:()=>()=>{},bind:()=>key=>key},configForms:{get:()=>({getSnapshot:()=>snapshot,subscribe:()=>()=>{}})},slots:{inject:(name,fn)=>fn(),register:(options,component)=>{slots.set(options.name,{options,component});return()=>{};}},sessions:{create:async()=>'client-session'}};
 module.apply(ctx);const root=createRoot(document.getElementById('root'));
 t.after(async()=>{await act(async()=>root.unmount());effects.forEach(fn=>typeof fn==='function'&&fn());Object.assign(globalThis,previous);dom.window.close();});
 await act(async()=>root.render(React.createElement(slots.get('main').component)));
 const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='打开客户端图片工作台');assert.ok(button);
 await act(async()=>button.click());
 const frame=document.querySelector('iframe');assert.ok(frame);assert.match(frame.src,/client-ui\/client-studio\.html#session=client-session$/);
 assert.equal(dom.window.localStorage.getItem('openbone.client.session.v1'),'client-session');
 assert.equal(slots.get('sidebar.panellist').options.id,'openbone-studio');
});
