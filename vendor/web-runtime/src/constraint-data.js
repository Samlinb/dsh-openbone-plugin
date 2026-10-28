import {requireThat, interpolate} from './core.js';
const kinds=['ik','transform','path','physics'];
const mixFields=['mixRotate','mixX','mixY','mixScaleX','mixScaleY','mixShearY'];
const defaults={ik:{mix:1,softness:0,bendPositive:true,compress:false,stretch:false,uniform:false},
  transform:{local:false,relative:false,mixRotate:1,mixX:1,mixY:1,mixScaleX:1,mixScaleY:1,mixShearY:1,rotation:0,x:0,y:0,scaleX:0,scaleY:0,shearY:0},
  path:{positionMode:'percent',spacingMode:'length',rotateMode:'tangent',position:0,spacing:0,rotation:0,mixRotate:1,mixX:1,mixY:1},
  physics:{x:0,y:0,rotate:0,scaleX:0,shearX:0,limit:5000,fps:60,inertia:1,strength:100,damping:1,mass:1,wind:0,gravity:0,mix:1}};
function checkFields(o,allowed,path){requireThat(o&&typeof o==='object'&&!Array.isArray(o),path,'Expected object');for(const k of Object.keys(o))requireThat(allowed.includes(k),`${path}.${k}`,'Unsupported field','UNSUPPORTED_FEATURE');}
export function readConstraints(root,bones,slots){const out=[],names=new Set();
  for(const kind of kinds){requireThat(root[kind]===undefined||Array.isArray(root[kind]),kind,'Expected constraint array');
    for(const source of root[kind]??[]){const p=`$.${kind}.${source.name}`;
      checkFields(source,['name','order','skin','bones','bone','target',...Object.keys(defaults[kind])],p);
      requireThat(typeof source.name==='string'&&source.name.length&&!names.has(source.name),p,'Duplicate or empty constraint name');names.add(source.name);
      const c={...defaults[kind],...source,kind};
      for(const [key,fallback] of Object.entries(defaults[kind]))requireThat(typeof c[key]===typeof fallback,`${p}.${key}`,'Invalid constraint value');
      if(source.mixY===undefined&&kind!=='ik'&&kind!=='physics')c.mixY=c.mixX;
      if(source.mixScaleY===undefined&&kind==='transform')c.mixScaleY=c.mixScaleX;
      const chain=kind==='physics'?[c.bone]:c.bones;
      requireThat(Array.isArray(chain)&&chain.length>0&&(kind!=='ik'||chain.length<=2),p,'Invalid constraint chain');
      c.boneIndices=chain.map(name=>bones.findIndex(b=>b.name===name));
      requireThat(c.boneIndices.every(i=>i>=0)&&new Set(c.boneIndices).size===chain.length,p,'Unknown or repeated constraint bone');
      c.targetIndex=kind==='physics'?-1:(kind==='path'?slots:bones).findIndex(b=>b.name===c.target);
      requireThat(kind==='physics'||c.targetIndex>=0,p,'Unknown target');
      if(kind==='ik'&&chain.length===2)requireThat(bones[c.boneIndices[1]].parent===c.boneIndices[0],p,'IK bones must be parent and child');
      if(kind==='path')requireThat(['fixed','percent'].includes(c.positionMode)&&['length','fixed','percent','proportional'].includes(c.spacingMode)&&['tangent','chain','chainScale'].includes(c.rotateMode),p,'Unknown path mode');
      if(kind==='physics')requireThat(c.fps===60&&c.mass>0&&c.strength>=0&&['x','y','rotate','scaleX','shearX','inertia','damping','mix'].every(k=>c[k]>=0&&c[k]<=1),p,'Physics requires 60Hz and valid parameters');
      requireThat(Number.isInteger(c.order??0)&&(c.order??0)>=0,p,'Invalid constraint order');out.push(c);
    }}
  return out.sort((a,b)=>(a.order??0)-(b.order??0));
}
function groups(c,animation){const t=animation?.[c.kind]?.[c.name];if(!t)return [];
  if(c.kind==='ik')return [[t,['mix','softness','bendPositive','compress','stretch'],[1,0,true,false,false]]];
  if(c.kind==='transform')return [[t,mixFields,[1,1,1,1,1,1]]];
  if(c.kind==='path'){checkFields(t,['position','spacing','mix'],'animation.path');return Object.entries(t).map(([kind,track])=>[track,kind==='mix'?mixFields.slice(0,3):['value'],kind==='mix'?[1,1,1]:[0],kind]);}
  checkFields(t,['inertia','strength','damping','mass','wind','gravity','mix'],'animation.physics');return Object.entries(t).map(([kind,track])=>[track,['value'],[0],kind]);
}
export function validateConstraintTracks(a,constraints,validate){
  for(const kind of kinds)for(const name of Object.keys(a[kind]??{}))requireThat(constraints.some(c=>c.kind===kind&&c.name===name),`animation.${kind}.${name}`,'Unknown constraint');
  for(const c of constraints)for(const [track,fields,defs] of groups(c,a)){
    validate(track,`animation.${c.kind}.${c.name}`);
    for(const key of track){checkFields(key,['time','curve',...fields],'constraint.key');
      fields.forEach((f,i)=>requireThat(key[f]===undefined||typeof key[f]===typeof defs[i],`constraint.${f}`,'Invalid constraint key value'));
      if(Array.isArray(key.curve))requireThat(key.curve.length===4*(c.kind==='ik'?2:fields.length),'constraint.curve','Incorrect curve component count');}
  }
}
export function sampleConstraints(data,a,t,skin,activeBones){const members=data.skinMembers.get(skin);
  return data.constraints.map(source=>{const c={...source};
    c.active=(!c.skin||(members?.[c.kind]??[]).includes(c.name))&&c.boneIndices.every(i=>activeBones.has(i))&&(c.kind==='physics'||activeBones.has(c.kind==='path'?data.slots[c.targetIndex].boneIndex:c.targetIndex));
    for(const [track,fields,defs,group] of groups(c,a))fields.forEach((field,i)=>{
      let v;
      if(typeof defs[i]==='boolean'){const key=track.findLast(k=>(k.time??0)<=t);v=key?key[field]??defs[i]:undefined;}
      else v=interpolate(track,t,k=>k[field]??(i===2&&c.kind!=='ik'?k.mixX??defs[i]:i===4&&c.kind==='transform'?k.mixScaleX??defs[i]:defs[i]),i);
      if(v!==undefined)c[group&&(c.kind==='physics'||group!=='mix')?group:field]=v;
    });
    if(c.kind==='physics')requireThat(c.mass>0&&c.strength>=0&&['inertia','damping','mix'].every(k=>c[k]>=0&&c[k]<=1),'physics','Animated parameter outside model domain');
    return c;});
}
