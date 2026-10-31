import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {requireThat,fields} from './errors.js';

export const clientFiles=['client-studio.html','client-studio.css','client-studio.js','client-pixels.js','client-provider.js'];
export const clientActions=new Set(['client-state','client-assets','binding','bind','new','production','studio','preview','capture','save']);
export function validateClientAction(action,body){
 requireThat(clientActions.has(action),'INVALID_INPUT','Unsupported client action.');
 if(action==='production')requireThat(['status','assemble','review-static'].includes(body.operation),'INVALID_INPUT','Use the client image workflow.');
 if(action==='studio')requireThat(body.operation==='confirm-assembly','INVALID_INPUT','Unsupported client confirmation.');
}
export async function clientFile(name){requireThat(clientFiles.includes(name),'NOT_FOUND','Unknown client file.',404);return readFile(new URL(`../public/${name}`,import.meta.url));}
export const clientMime=name=>name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8';
/** Local HTTP transport only. All pixel/model operations are executed by the browser. */
export async function createClientWorkbench(request){
 const sessions=new Map();
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const host=`127.0.0.1:${server.address().port}`;
   requireThat(req.headers.host===host&&(!req.headers.origin||req.headers.origin===`http://${host}`),'FORBIDDEN','Untrusted client origin.',403);
   const match=/^\/([a-f0-9]{48})\/([a-z.-]+)$/.exec(new URL(req.url,`http://${host}`).pathname),session=match&&sessions.get(match[1]);
   requireThat(session,'NOT_FOUND','Client workbench link expired. Open it again from the plugin.',404);
   if(match[2]==='api'){
    requireThat(req.method==='POST'&&req.headers['content-type']?.split(';')[0]==='application/json','INVALID_INPUT','Expected JSON POST.');
    const chunks=[];let size=0;for await(const c of req){size+=c.length;requireThat(size<=24*1024*1024,'TOO_LARGE','Upload too large.',413);chunks.push(c);}
    const input=JSON.parse(Buffer.concat(chunks));fields(input,['action','body'],['action','body']);validateClientAction(input.action,input.body);
    fields(input.body,Object.keys(input.body));requireThat(!Object.hasOwn(input.body,'sessionId'),'INVALID_INPUT','Session is owned by the workbench.');
    const abort=new AbortController();res.on('close',()=>{if(!res.writableFinished)abort.abort();});
    const body={...input.body,...(input.action==='new'?{}:{sessionId:`codex-${session.workspace}`})};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await request(input.action,body,abort.signal)));
   }else{
    requireThat(req.method==='GET','INVALID_INPUT','Expected GET.');
    res.setHeader('Content-Type',clientMime(match[2]));
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https: http://127.0.0.1:* http://localhost:* data: blob:; base-uri 'none'; frame-ancestors 'none'");
    res.end(await clientFile(match[2]));
   }
  }catch(e){res.statusCode=e.status??400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:{code:e.code??'CLIENT_ERROR',message:e.message}}));}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});server.unref();
 return {open(workspace){const token=randomBytes(24).toString('hex');sessions.set(token,{workspace});return {workspace,url:`http://127.0.0.1:${server.address().port}/${token}/client-studio.html#workspace=${encodeURIComponent(workspace)}`,imageProcessing:'browser',message:'Open this client workbench to select a local PNG, cut parts, upload, assemble and save. Provider requests run directly in the browser.'};},close(){sessions.clear();server.closeAllConnections();return new Promise(resolve=>server.close(resolve));}};
}
