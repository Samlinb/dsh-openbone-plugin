// Runs only in the user's browser. Provider credentials never reach OpenBone.
function endpoint(value){const u=new URL(value);if(!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))||u.username||u.password||u.hash)throw new Error('Use an HTTPS model endpoint (localhost HTTP is allowed).');return u.href;}
async function request(config,body,signal,fetcher){
 const response=await fetcher(endpoint(config.endpoint),{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json',...(config.key?{Authorization:`Bearer ${config.key}`}:{})},body:JSON.stringify(body),signal});
 if(!response.ok)throw new Error(`Client model request failed: HTTP ${response.status}.`);
 return response.json();
}
export async function generateClientImage(config,prompt,{signal,fetcher=fetch}={}){
 if(!config.model||!prompt.trim())throw new Error('Set a model and describe the image.');
 const result=await request(config,{model:config.model,prompt,n:1,size:'1024x1024'},signal,fetcher);
 const base64=result.data?.[0]?.b64_json;
 if(typeof base64!=='string'||base64.length>12000000)throw new Error('The model must return a bounded PNG in data[0].b64_json. Import the downloaded image if it returns a URL.');
 return `data:image/png;base64,${base64}`;
}
export async function reviewClientImage(config,image,question,{signal,fetcher=fetch}={}){
 if(!config.model||!image.startsWith('data:image/'))throw new Error('Set a vision model and load an image.');
 const result=await request(config,{model:config.model,messages:[{role:'user',content:[{type:'text',text:question||'Inspect this character for extra or missing anatomy, view consistency and suitability for skeletal animation. Report defects; do not claim user approval.'},{type:'image_url',image_url:{url:image}}]}]},signal,fetcher);
 const text=result.choices?.[0]?.message?.content;if(typeof text!=='string')throw new Error('The vision model returned no text.');return text;
}
