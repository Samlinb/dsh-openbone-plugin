import {requireThat} from './core.js';
export const SUPPORTED_VERSIONS=['3.8','4.0','4.1','4.2','4.3'];
export function versionFamily(version){requireThat(typeof version==='string'&&/^(3\.8|4\.[0-3])\.\d+$/.test(version),'skeleton.spine','Expected stable 3.8 or 4.0–4.3 version','UNSUPPORTED_VERSION');return version.split('.').slice(0,2).join('.');}
const entries=o=>Object.entries(o??{});
const rename=(o,a,b)=>{if(Object.hasOwn(o,a)){o[b]=o[a];delete o[a];}};
const mix=(o)=>{for(const [old,targets] of [['rotateMix',['mixRotate']],['translateMix',['mixX','mixY']],['scaleMix',['mixScaleX','mixScaleY']],['shearMix',['mixShearY']]])if(o[old]!==undefined){for(const t of targets)o[t]=o[old];delete o[old];}};
function relative(keys,read,dims,fraction=false){for(let i=0;i<keys.length;i++){const k=keys[i],curve=k.curve,c=[typeof curve==='number'?curve:.25,k.c2??0,k.c3??1,k.c4??1];delete k.c2;delete k.c3;delete k.c4;
    if(curve===undefined||curve==='stepped')continue;requireThat(i+1<keys.length,'curve','Last key has curve');if(Array.isArray(curve)){requireThat(curve.length===4,'curve','Expected four relative controls');c.splice(0,4,...curve);}
    const next=keys[i+1],t=k.time??0,dt=(next.time??0)-t;k.curve=[];
    for(let n=0;n<dims;n++){const a=fraction?0:read(k,n),b=fraction?1:read(next,n);k.curve.push(t+dt*c[0],a+(b-a)*c[1],t+dt*c[2],a+(b-a)*c[3]);}
  }}
export function normalizeJson(root){const family=versionFamily(root.skeleton?.spine);
  if(family==='4.2')return root;
  for(const b of root.bones??[])rename(b,'transform','inherit');
  if(family==='3.8'){
    if(!Array.isArray(root.skins))root.skins=entries(root.skins).map(([name,attachments])=>({name,attachments}));
    for(const c of [...root.transform??[],...root.path??[]])mix(c);
  }
  if(family==='4.3'&&root.constraints){requireThat(!root.ik&&!root.transform&&!root.path&&!root.physics,'constraints','Conflicting constraint layouts');
    root.constraints.forEach((c,order)=>{const kind=c.type;requireThat(['ik','transform','path','physics'].includes(kind),'constraints.type','Unsupported constraint','UNSUPPORTED_FEATURE');delete c.type;c.order=order;
      if(kind==='path')rename(c,'slot','target');
      if(kind==='transform'){
        requireThat(!c.clamp&&(c.localSource??false)===(c.localTarget??false),'constraints.transform','Clamp or mixed local spaces unsupported','UNSUPPORTED_FEATURE');
        const props=c.properties;requireThat(props&&typeof props==='object','constraints.properties','Expected property mappings');
        for(const [key,from] of entries(props)){const to=from.to;requireThat(['rotate','x','y','scaleX','scaleY','shearY'].includes(key)&&(from.offset??0)===0&&to&&Object.keys(to).length===1&&to[key]&&(to[key].offset??0)===0&&(to[key].scale??1)===1,'constraints.properties','Remapped transform unsupported','UNSUPPORTED_FEATURE');}
        for(const p of ['rotate','x','y','scaleX','scaleY','shearY'])if(!Object.hasOwn(props,p))c['mix'+p[0].toUpperCase()+p.slice(1)]=0;
        rename(c,'source','target');rename(c,'additive','relative');c.local=c.localSource??false;delete c.properties;delete c.localSource;delete c.localTarget;delete c.clamp;
      }
      (root[kind]??=[]).push(c);});delete root.constraints;
  }
  for(const a of Object.values(root.animations??{})){
    if(a.deform){a.attachments={};for(const [skin,slots] of entries(a.deform))for(const [slot,atts] of entries(slots))for(const [name,keys] of entries(atts)){
      (((a.attachments[skin]??={})[slot]??={})[name]??={}).deform=keys;
      if(family==='3.8')relative(keys,()=>0,1,true);
    }delete a.deform;}
    if(family==='3.8'){
      for(const tracks of Object.values(a.bones??{}))for(const [kind,keys] of entries(tracks)){
        if(kind==='rotate')for(const k of keys)rename(k,'angle','value');const paired=['translate','scale','shear'].includes(kind),fallback=kind==='scale'?1:0;
        relative(keys,(k,n)=>k[paired?(n?'y':'x'):'value']??fallback,paired?2:1);
      }
      for(const tracks of Object.values(a.slots??{})){rename(tracks,'color','rgba');for(const [kind,keys] of entries(tracks))if(kind==='rgba')relative(keys,(k,n)=>parseInt(k.color.slice(n*2,n*2+2),16)/255,4);}
      for(const [kind,groups] of [['ik',a.ik],['transform',a.transform],['path',a.path]])for(const row of Object.values(groups??{})){
        const groups=kind==='path'?entries(row):[['',row]];
        for(const [group,keys] of groups){for(const k of keys){mix(k);if(group==='position'||group==='spacing')rename(k,group,'value');}const fields=kind==='ik'?['mix','softness']:kind==='transform'?['mixRotate','mixX','mixY','mixScaleX','mixScaleY','mixShearY']:group==='mix'?['mixRotate','mixX','mixY']:['value'];
          relative(keys,(k,n)=>k[fields[n]]??(fields[n]==='softness'||fields[n]==='value'?0:1),fields.length);}
      }
    }
  }
  root.skeleton.spine='4.2.22';return root;
}
