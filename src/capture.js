import { chromium } from 'playwright-core';
import path from 'node:path';
import { PNG } from 'pngjs';
import { Failure, fields, requireThat } from './errors.js';

/** Sandboxed WebGL capture of service-minted snapshots, never arbitrary pages. */
export function previewRenderer(raw) {
  if(!raw)return null;
  fields(raw,['executablePath','width','height','timeoutMs'],['executablePath']);
  const config={width:900,height:1000,timeoutMs:30000,...raw};
  requireThat(typeof config.executablePath==='string'&&path.isAbsolute(config.executablePath),'INVALID_CONFIG','Configure an absolute installed Chromium executable.');
  requireThat([config.width,config.height].every(n=>Number.isInteger(n)&&n>=320&&n<=1600)&&Number.isInteger(config.timeoutMs)&&config.timeoutMs>=1000&&config.timeoutMs<=30000,'INVALID_CONFIG','Invalid browser capture limits.');
  let browserPromise,queue=Promise.resolve();
  async function browser() {
    if(!browserPromise)browserPromise=chromium.launch({executablePath:config.executablePath,headless:true,chromiumSandbox:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}).catch(error=>{browserPromise=null;throw error;});
    return browserPromise;
  }
  return {
    capture(snapshot,{animationName,times=[0]},signal) {
      requireThat(Array.isArray(times)&&times.length>=1&&times.length<=6&&times.every(t=>Number.isFinite(t)&&t>=0&&t<=600),'INVALID_INPUT','Capture one to six times in seconds between 0 and 600.');
      requireThat(animationName===undefined||(typeof animationName==='string'&&animationName.length>=1&&animationName.length<=256),'INVALID_INPUT','Expected an animation name.');
      const work=queue.then(async()=>{
        let context;
        const abort=()=>{context?.close().catch(()=>{});};
        try {
          signal?.throwIfAborted();
          context=await (await browser()).newContext({viewport:{width:config.width,height:config.height},deviceScaleFactor:1,serviceWorkers:'block',acceptDownloads:false});
          signal?.addEventListener('abort',abort,{once:true});signal?.throwIfAborted();
          const root=new URL('.',snapshot.viewerUrl).href;
          await context.route('**/*',route=>route.request().url().startsWith(root)?route.continue():route.abort());
          const page=await context.newPage();page.setDefaultTimeout(config.timeoutMs);
          await page.goto(snapshot.viewerUrl,{waitUntil:'domcontentloaded',timeout:config.timeoutMs});
          await page.waitForFunction(()=>!!window.openbonePreview,{timeout:config.timeoutMs});
          const identity=await page.evaluate(()=>window.openbonePreview.identity);
          requireThat(identity.sourceRevision===snapshot.sourceRevision&&identity.manifestSHA256===snapshot.manifestSHA256,'PREVIEW_MISMATCH','Rendered snapshot identity does not match the requested revision.',409);
          const animations=await page.locator('#animation option').evaluateAll(items=>items.map(item=>item.value));
          if(animationName!==undefined){requireThat(animations.includes(animationName),'INVALID_ANIMATION','Choose an animation name from the queried project.');await page.locator('#animation').selectOption(animationName);}
          const duration=await page.locator('#seek').evaluate(input=>Number(input.max));
          requireThat(times.every(time=>time<=duration+1e-6),'INVALID_INPUT','Capture times must be inside the selected animation duration.');
          const frames=[];
          for(const time of times) {
            signal?.throwIfAborted();
            await page.locator('#seek').evaluate((input,time)=>{input.value=String(time);input.dispatchEvent(new Event('input',{bubbles:true}));},time);
            const frame=await page.evaluate(()=>window.openbonePreview.capture());
            requireThat(typeof frame.png==='string'&&frame.png.startsWith('data:image/png;base64,'),'RENDER_FAILED','The WebGL canvas did not return a PNG.',502);
            // Transparent tool images may be displayed on black by the host,
            // hiding joint gaps. Composite only the inspection copy; exported
            // textures and the original WebGL snapshot remain unchanged.
            const png=PNG.sync.read(Buffer.from(frame.png.slice('data:image/png;base64,'.length),'base64'));
            for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
              const i=(y*png.width+x)*4,a=png.data[i+3]/255,bg=(Math.floor(x/16)+Math.floor(y/16))%2?224:248;
              for(let c=0;c<3;c++)png.data[i+c]=Math.round(png.data[i+c]*a+bg*(1-a));
              png.data[i+3]=255;
            }
            frames.push({animation:frame.animation,time:frame.time,png:PNG.sync.write(png).toString('base64')});
          }
          return {identity,engine:'independent',background:'light-checkerboard',animations,duration,frames};
        } catch(error) {
          if(error instanceof Failure)throw error;
          requireThat(false,'RENDER_FAILED','Could not capture the sandboxed WebGL preview. Check the installed browser, its sandbox dependencies and renderer compatibility.',502);
        } finally {signal?.removeEventListener('abort',abort);await context?.close().catch(()=>{});}
      });
      queue=work.catch(()=>{});return work;
    },
    async close(){await queue;if(browserPromise)await (await browserPromise).close();browserPromise=null;},
  };
}
