import {chromium} from 'playwright-core';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const root='evidence/studio-beta13';await mkdir(root,{recursive:true});
// Authentication stays in memory and the ignored browser profile, never stdout.
const log=execFileSync('ssh',['honor','journalctl --user -u openbone-creation-dsh -n 30 --no-pager'],{encoding:'utf8',windowsHide:true});
const urls=[...log.matchAll(/http:\/\/192\.168\.31\.131:3084\/\?[^\s]+/g)];
if(!urls.length)throw new Error('No current browser authentication URL.');
const context=await chromium.launchPersistentContext(root+'/private-browser',{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1440,height:1000}});
try{
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(urls.at(-1)[0],{waitUntil:'domcontentloaded',timeout:20000});
 const button=page.getByRole('button',{name:'OpenBone',exact:true});
 if(await button.count())await button.click();
 else console.log('OpenBone entry not found.');
 await page.getByRole('heading',{name:'OpenBone',exact:true}).waitFor({timeout:15000});
 if(process.argv.includes('--quota'))console.log(await page.evaluate(async()=>{const r=await fetch('/api/openbone-studio/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prepare',body:{sessionId:localStorage.getItem('openbone.studio.session.v1')}})});const d=await r.json();return {account:d.account,projects:d.availableProjects};}));
 if(process.argv.includes('--start')){const start=page.getByRole('button',{name:'开始创作',exact:true});if(await start.count())await start.click();else {const restore=page.getByRole('button',{name:'恢复创作',exact:true});if(await restore.count())await restore.click();}await page.getByText('角色描述',{exact:true}).waitFor({timeout:30000});}
 if(process.argv.includes('--upload')){await page.locator('input[type=file]').setInputFiles('evidence/production-beta11/ear-candidate.png');await page.getByAltText('当前角色候选图').waitFor({timeout:30000});}
 if(process.argv.includes('--confirm-invalid')){await page.getByRole('button',{name:'确认角色，下一步',exact:true}).click();await page.getByText(/角色需要修改：/).waitFor({timeout:60000});}
 if(process.argv.includes('--chat')){await page.getByRole('button',{name:'打开创作对话',exact:true}).click();await page.getByText('本会话',{exact:false}).first().waitFor({timeout:3000}).catch(()=>{});}
 if(process.argv.includes('--trace')){await page.getByText('轨迹',{exact:true}).click();}
 if(process.argv.includes('--stop')){const stop=page.getByRole('button',{name:'停止生成',exact:true});if(await stop.count())await stop.click();}
 if(process.argv.includes('--chat'))console.log(await page.locator('button').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,aria:n.getAttribute('aria-label'),title:n.getAttribute('title')})).filter(n=>n.aria||n.title).slice(-25)));
 if(process.argv.includes('--recheck')){await page.getByRole('button',{name:'重新检查并组装',exact:true}).click();await page.getByText(/角色需要修改：/).waitFor({timeout:60000});}
 if(process.argv.includes('--settled'))await page.getByText(/角色需要修改：/).waitFor({timeout:15000});
 await page.screenshot({path:root+'/workshop.png',fullPage:true});
 console.log((await page.locator('body').innerText()).slice(-4500));console.log('Browser errors:',errors);
 await writeFile(root+'/browser-receipt.json',JSON.stringify({errors,sidebarVisible:await button.count()>0,upload:process.argv.includes('--upload')}));
}catch(e){console.log((await context.pages().at(-1).locator('body').innerText()).slice(-3000));console.error(String(e.message).replace(/https?:\/\/[^\s]+/g,'[URL omitted]'));process.exitCode=1;}finally{await context.close();}
