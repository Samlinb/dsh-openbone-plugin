import {requireThat} from './core.js';
export const sequenceModes=['hold','once','loop','pingpong','onceReverse','loopReverse','pingpongReverse'];
export function resolveLinkedMeshes(root){const all=new Map(),sources=new Map(),pending=new Set(),bindings=[];
  const key=(skin,slot,name)=>JSON.stringify([skin,slot,name]);
  for(const skin of root.skins??[])for(const [slot,row] of Object.entries(skin.attachments??{}))for(const [name,a] of Object.entries(row))all.set(key(skin.name,slot,name),a);
  const visit=k=>{if(sources.has(k))return sources.get(k);const a=all.get(k);requireThat(a,'linkedmesh','Missing linked parent');
    if(a.type!=='linkedmesh'){requireThat(a.type==='mesh','linkedmesh','Parent must be mesh');sources.set(k,k);return k;}
    requireThat(!pending.has(k),'linkedmesh','Linked mesh cycle');pending.add(k);const [,slot]=JSON.parse(k),pk=key(a.skin??'default',slot,a.parent),source=visit(pk),p=all.get(pk);
    const inherit=a.deform??true;for(const field of ['vertices','uvs','triangles','hull','edges'])if(p[field]!==undefined)a[field]=structuredClone(p[field]);
    a.type='mesh';delete a.skin;delete a.parent;delete a.deform;const resolved=inherit?source:k;sources.set(k,resolved);pending.delete(k);if(inherit)bindings.push([k,resolved]);return resolved;};
  for(const [k,a] of all)if(a.type==='linkedmesh')visit(k);
  for(const a of Object.values(root.animations??{}))for(const [target,source] of bindings){const [ss,sl,sn]=JSON.parse(source),[ts,tl,tn]=JSON.parse(target),deform=a.attachments?.[ss]?.[sl]?.[sn]?.deform;
    if(deform){a.attachments??={};const entry=(((a.attachments[ts]??={})[tl]??={})[tn]??={});entry.deform??=structuredClone(deform);}}
}
export function validateSequence(sequence,path){if(sequence===undefined)return;
  requireThat(sequence&&typeof sequence==='object'&&!Array.isArray(sequence),path,'Expected sequence object');
  for(const k of Object.keys(sequence))requireThat(['count','start','digits','setup'].includes(k),path+'.'+k,'Unknown sequence field');
  requireThat(Number.isInteger(sequence.count)&&sequence.count>0&&sequence.count<=10000,path,'Invalid sequence count');
  for(const k of ['start','digits','setup'])requireThat(Number.isInteger(sequence[k]??0)&&(sequence[k]??0)>=0,path,'Invalid sequence parameter');
  requireThat((sequence.digits??0)<=16&&(sequence.setup??0)<sequence.count,path,'Invalid sequence setup/digits');
}
export function sequencePath(a,index){const s=a.sequence;if(!s)return a.path;return a.path+String((s.start??1)+index).padStart(s.digits??0,'0');}
export function sequenceIndex(s,keys,time){const k=keys?.findLast(k=>(k.time??0)<=time);if(!k)return s.setup??0;
  const mode=k.mode??'hold',base=k.index??0;if(mode==='hold')return Math.max(0,Math.min(s.count-1,base));
  const i=base+Math.floor((time-(k.time??0))/(k.delay??0)),count=s.count;let frame;
  if(mode==='once'||mode==='onceReverse')frame=Math.min(count-1,i);
  else if(mode==='loop'||mode==='loopReverse')frame=((i%count)+count)%count;
  else{const period=count*2-2;if(period===0)frame=0;else{const p=((i%period)+period)%period;frame=p<count?p:period-p;}}
  return mode.endsWith('Reverse')?count-1-frame:frame;
}
