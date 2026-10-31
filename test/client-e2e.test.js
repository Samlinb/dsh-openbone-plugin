import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {createServer as httpServer} from 'node:http';
import {PNG} from 'pngjs';
import {initializeHost,manageAccount} from '../src/hosted-accounts.js';
import {createHostedService} from '../src/hosted.js';
import {createClientWorkbench} from '../src/client-workbench.js';
import {requestService} from '../src/codex-mcp.js';
import {Context} from '@deepseek-ai/cordis';
import * as Plugin from '../src/plugin.js';

async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}

for(const host of ['codex','dsh'])test(`${host} browser local PNG -> client cut -> upload -> real Java assembly/save -> service restart recovery`, {skip:!process.env.OPENBONE_TEST_JAR||!process.env.OPENBONE_TEST_BROWSER,timeout:120000},async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'openbone-client-live-'));let service,workbench,browser,dshContext;const providers=[];
 t.after(async()=>{await browser?.close();await workbench?.close();await dshContext?.fiber.dispose();await service?.close();for(const p of providers)await new Promise(r=>p.close(r));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
 const dataRoot=path.join(root,'host');await initializeHost(dataRoot);const account=await manageAccount(dataRoot,'alice','add');
 const port=await freePort(),mcpPortStart=await freePort();
 const config={dataRoot,javaJar:path.resolve(process.env.OPENBONE_TEST_JAR),port,publicUrl:`http://127.0.0.1:${port}`,mcpPortStart,mcpPortCount:4,previewCapture:{executablePath:process.env.OPENBONE_TEST_BROWSER}};
 service=await createHostedService(config);await service.listen();
 const env={OPENBONE_LIBRARY_URL:`${config.publicUrl}/u/alice/`,OPENBONE_LIBRARY_TOKEN:account.token};
 const send=(action,body,signal)=>requestService(action,body,{env,signal});
 let opened;
 if(host==='codex'){workbench=await createClientWorkbench(send);opened=workbench.open('client-e2e');}
 else{
  const {pathToFileURL}=await import('node:url');const routes=new Map();
  const checkout=process.env.DSH_CHECKOUT??path.resolve('../dsh');
  const [{default:SystemPrompt},{default:Tools}]=await Promise.all([import(pathToFileURL(path.join(checkout,'packages/core/system-prompt/lib/index.js')).href),import(pathToFileURL(path.join(checkout,'packages/core/tools/lib/index.js')).href)]);
  dshContext=new Context();await dshContext.plugin(SystemPrompt);await dshContext.plugin(Tools);
  dshContext.provide('connection',{fetch:{register:route=>{routes.set(route.path,route);return()=>routes.delete(route.path);}}});
  await dshContext.plugin(Plugin,{serviceUrl:env.OPENBONE_LIBRARY_URL,accessToken:account.token});
  const gateway=httpServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;const route=routes.get(new URL(req.url,'http://localhost').pathname);if(!route){res.statusCode=404;res.end();return;}const result=await route.fetch(new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,...(body?{body}:{})}));res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));}catch(e){res.statusCode=500;res.end(JSON.stringify({error:{message:e.message}}));}});
  providers.push(gateway);await new Promise(r=>gateway.listen(0,'127.0.0.1',r));opened={url:`http://127.0.0.1:${gateway.address().port}/api/openbone-studio/client-ui/client-studio.html#session=codex-client-e2e`};
 }

 const {chromium}=await import('playwright-core');browser=await chromium.launch({executablePath:process.env.OPENBONE_TEST_BROWSER,headless:true});const page=await browser.newPage({viewport:{width:1100,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(opened.url);await page.waitForFunction(()=>document.querySelector('#projects option'));await page.getByRole('button',{name:'连接工程',exact:true}).click();await page.waitForFunction(()=>document.getElementById('project-state').textContent.includes('可用于')||document.getElementById('notice').dataset.error==='true');assert.notEqual(await page.locator('#notice').getAttribute('data-error'),'true',await page.locator('#notice').textContent());
 const png=new PNG({width:64,height:64});for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4;png.data.set([220,120,80,x>5&&x<58&&y>5&&y<58?255:0],i);}const bytes=PNG.sync.write(png);
 await page.locator('#file').setInputFiles({name:'technical-fixture.png',mimeType:'image/png',buffer:bytes});await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('尚未上传'));
 await page.locator('#source').scrollIntoViewIfNeeded();const rect=await page.locator('#source').boundingBox();
 for(const [x,y]of [[8,8],[56,8],[56,56],[8,56]])await page.mouse.click(rect.x+x/64*rect.width,rect.y+y/64*rect.height);
 await page.keyboard.down('Shift');await page.mouse.click(rect.x+30/64*rect.width,rect.y+40/64*rect.height);await page.keyboard.up('Shift');
 await page.locator('#cut').click();assert.notEqual(await page.locator('#notice').getAttribute('data-error'),'true',await page.locator('#notice').textContent());await page.waitForFunction(()=>document.querySelector('#parts img')?.naturalWidth>0);await page.locator('#confirmed').check();await page.locator('#upload').click();
 await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('分件已上传'));
 const s=await send('client-state',{sessionId:'codex-client-e2e'});const selected=s.production.selected.body.assetId;
 const file=path.join(dataRoot,'tenants','alice','workspaces','starter','generated-assets',selected.slice(0,24),'body.png');const admitted=await readFile(file);
 assert.deepEqual(admitted,Buffer.from(await page.locator('#parts img').evaluate(img=>img.src.split(',')[1]),'base64'));
 await page.locator('#assemble').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('已组装并保存'));
 await page.locator('#preview').click();await page.waitForFunction(()=>document.querySelector('#captures img')?.naturalWidth>0,{},{timeout:30000});
 await page.locator('#assembly-ok').check();await page.locator('#confirm-assembly').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('已确认当前组装'));
 await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('当前工程已保存'));
 const shot=process.env.OPENBONE_CLIENT_SCREENSHOT;if(shot)await page.screenshot({path:shot,fullPage:true});
 await service.close();service=await createHostedService(config);await service.listen();await page.reload();await page.locator('#restore').click();await page.waitForFunction(()=>document.querySelector('#parts img')?.naturalWidth>0);
 const restored=await send('call',{sessionId:'codex-client-e2e',name:'openbone_query_scene',arguments:{kind:'attachments'}});assert.equal(restored.structuredContent.data.items[0].assetId,selected);
 const restoredState=await send('client-state',{sessionId:'codex-client-e2e'});assert.equal(restoredState.production.clientManaged,true);assert.equal(restoredState.context.dirty,false);
 const denied=await fetch(new URL('v1/assets-inspect',env.OPENBONE_LIBRARY_URL),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${account.token}`},body:JSON.stringify({sessionId:'codex-client-e2e',jobId:selected.slice(0,24)})});assert.equal(denied.status,409);
 // Browser talks to a separate CORS-enabled model fixture, never to an OpenBone model proxy.
 const modelCalls=[];const provider=httpServer(async(req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');if(req.method==='OPTIONS'){res.end();return;}let body='';for await(const chunk of req)body+=chunk;modelCalls.push({url:req.url,body:JSON.parse(body)});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/images'?{data:[{b64_json:bytes.toString('base64')}]}:{choices:[{message:{content:'Technical fixture image inspected in the client.'}}]}));});providers.push(provider);await new Promise(r=>provider.listen(0,'127.0.0.1',r));const modelURL=`http://127.0.0.1:${provider.address().port}`;
 await page.locator('summary').filter({hasText:'客户端生图'}).click();await page.locator('#gen-endpoint').fill(modelURL+'/images');await page.locator('#gen-model').fill('fixture');await page.locator('#prompt').fill('technical fixture');await page.locator('#generate').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('客户端生成完成'));
 await page.locator('#vision-endpoint').fill(modelURL+'/vision');await page.locator('#vision-model').fill('fixture');await page.locator('#review').click();await page.waitForFunction(()=>document.getElementById('vision-result').textContent.includes('inspected in the client'));
 assert.deepEqual(modelCalls.map(c=>c.url),['/images','/vision']);assert.ok(modelCalls[1].body.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,'));assert.deepEqual(errors,[]);
});
