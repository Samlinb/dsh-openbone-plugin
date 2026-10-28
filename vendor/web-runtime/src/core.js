// Independent implementation of OpenBone's exported animation contract.
// Coordinates: X right, Y up, degrees CCW. Time is in seconds.
import {solve, vertexPoints} from './constraints.js';
import {triangulate, clipGeometry} from './geometry.js';
import {readConstraints, validateConstraintTracks, sampleConstraints} from './constraint-data.js';
import {normalizeJson} from './versions.js';
import {resolveLinkedMeshes,validateSequence,sequencePath,sequenceIndex,sequenceModes} from './attachments.js';
export class RuntimeError extends Error {
  constructor(code, path, message) {
    super(`${path}: ${message}`); this.name = 'RuntimeError'; this.code = code; this.path = path;
  }
}
export function requireThat(ok, path, message, code = 'INVALID_DATA') {
  if (!ok) throw new RuntimeError(code, path, message);
}
const own = (o, k) => Object.hasOwn(o, k);
const entries = o => Object.entries(o ?? {});
const value = (o, k, fallback = 0) => o[k] ?? fallback;
const transformFields = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'];
function transform(o) { return Object.fromEntries(transformFields.map(k => [k, value(o, k, k.startsWith('scale') ? 1 : 0)])); }
export function matrix(t) {
  const x = ((t.rotation % 360 + t.shearX % 360) % 360) * Math.PI / 180;
  const y = ((t.rotation % 360 + t.shearY % 360) % 360) * Math.PI / 180;
  return [Math.cos(x) * t.scaleX, -Math.sin(y) * t.scaleY, Math.sin(x) * t.scaleX, Math.cos(y) * t.scaleY, t.x, t.y];
}
export function multiply(p, q) {
  return [p[0]*q[0]+p[1]*q[2], p[0]*q[1]+p[1]*q[3], p[2]*q[0]+p[3]*q[2], p[2]*q[1]+p[3]*q[3],
    p[0]*q[4]+p[1]*q[5]+p[4], p[2]*q[4]+p[3]*q[5]+p[5]];
}
export function point(m, x, y) { return [m[0]*x+m[1]*y+m[4], m[2]*x+m[3]*y+m[5]]; }
export function color(hex = 'ffffffff') {
  requireThat(typeof hex === 'string' && /^[0-9a-f]{8}$/i.test(hex), 'color', 'Expected RRGGBBAA');
  return [0, 2, 4, 6].map(i => parseInt(hex.slice(i, i+2), 16) / 255);
}
function finiteTree(o, path = '$', depth = 0) {
  requireThat(depth < 64, path, 'Data nesting is too deep');
  if (typeof o === 'number') requireThat(Number.isFinite(o) && Math.abs(o) <= 3.4028234663852886e38, path, 'Expected finite float32 range');
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) finiteTree(v, `${path}.${k}`, depth+1);
}
function fields(o, allowed, path) {
  requireThat(o && typeof o === 'object' && !Array.isArray(o), path, 'Expected object');
  for (const k of Object.keys(o)) requireThat(allowed.includes(k), `${path}.${k}`, 'Unsupported field', 'UNSUPPORTED_FEATURE');
}
function named(list, path) {
  requireThat(Array.isArray(list), path, 'Expected array');
  const map = new Map();
  for (const o of list) {
    requireThat(o && typeof o.name === 'string' && o.name.length && !map.has(o.name), path, 'Names must be nonempty and unique');
    map.set(o.name, o);
  }
  return map;
}
function keys(track, path, equal = false) {
  requireThat(Array.isArray(track) && track.length > 0, path, 'Expected nonempty key array');
  let previous = -1;
  for (let i = 0; i < track.length; i++) {
    const key = track[i], time = key.time ?? 0;
    requireThat(typeof time === 'number' && time >= 0 && (equal ? time >= previous : time > previous), `${path}[${i}].time`, 'Keys must be ordered nonnegative seconds');
    if (key.curve !== undefined) {
      requireThat(i+1 < track.length, path, 'Last key cannot have an outgoing curve');
      requireThat(key.curve === 'stepped' || Array.isArray(key.curve) && key.curve.length > 0 && key.curve.length % 4 === 0 && key.curve.every(Number.isFinite), path, 'Invalid curve');
    }
    previous = time;
  }
}
function last(track, t) {
  if (!track || t < (track[0].time ?? 0)) return -1;
  let lo = 0, hi = track.length;
  while (lo+1 < hi) { const mid = (lo+hi) >>> 1; if ((track[mid].time ?? 0) <= t) lo = mid; else hi = mid; }
  return lo;
}
// Ten chords, as in OpenBone Curve.progress; handles in exported 4.2 are absolute.
export function interpolate(track, t, read, component = 0, fraction = false) {
  const i = last(track, t); if (i < 0) return undefined;
  const a = track[i], b = track[i+1], va = read(a);
  if (!b || a.curve === 'stepped') return va;
  const vb = read(b), start = a.time ?? 0, end = b.time ?? 0;
  if (!Array.isArray(a.curve)) return va + (vb-va)*(t-start)/(end-start);
  const c = a.curve.slice(component*4, component*4+4);
  requireThat(c.length === 4, 'curve', 'Missing component controls');
  let px = start, py = fraction ? 0 : va;
  for (let j = 1; j <= 10; j++) {
    const u = j/10, v = 1-u;
    const x = j === 10 ? end : v*v*v*start + 3*v*v*u*c[0] + 3*v*u*u*c[2] + u*u*u*end;
    const y = j === 10 ? (fraction ? 1 : vb) : v*v*v*(fraction ? 0 : va) + 3*v*v*u*c[1] + 3*v*u*u*c[3] + u*u*u*(fraction ? 1 : vb);
    if (t <= x) { const result = py + (y-py)*(t-px)/(x-px); return fraction ? va+(vb-va)*result : result; }
    px = x; py = y;
  }
  return vb;
}
const boneTracks = {
  rotate: [['rotation', 'value', 0, false]],
  translate: [['x', 'x', 0, false], ['y', 'y', 0, false]],
  translatex: [['x', 'value', 0, false]], translatey: [['y', 'value', 0, false]],
  scale: [['scaleX', 'x', 1, true], ['scaleY', 'y', 1, true]],
  scalex: [['scaleX', 'value', 1, true]], scaley: [['scaleY', 'value', 1, true]],
  shear: [['shearX', 'x', 0, false], ['shearY', 'y', 0, false]],
  shearx: [['shearX', 'value', 0, false]], sheary: [['shearY', 'value', 0, false]]
};
function mesh(a, boneCount, path, warnings) {
  const count=a.type==='mesh'?a.uvs?.length/2:a.vertexCount;
  requireThat(Number.isInteger(count)&&count>=3&&count<=65535,path,'Invalid vertex count');
  if(a.type==='mesh') {
    requireThat(Array.isArray(a.uvs) && a.uvs.length >= 6 && a.uvs.length % 2 === 0 && a.uvs.every(Number.isFinite), path, 'Invalid mesh UVs');
    requireThat(Array.isArray(a.triangles) && a.triangles.length > 0 && a.triangles.length % 3 === 0 && a.triangles.every(i => Number.isInteger(i) && i >= 0 && i < count), path, 'Invalid triangles');
  }
  requireThat(Array.isArray(a.vertices) && a.vertices.every(Number.isFinite), path, 'Invalid vertices');
  a.weighted = a.vertices.length !== count*2;
  a.rows = []; a.deformSize = a.vertices.length;
  if (a.weighted) {
    let cursor = 0, size = 0;
    for (let i = 0; i < count; i++) {
      const count = a.vertices[cursor++], row = [], seen = new Set();
      requireThat(Number.isInteger(count) && count >= 1 && count <= boneCount, path, 'Invalid influence count');
      for (let j = 0; j < count; j++) {
        const bi = a.vertices[cursor++], x = a.vertices[cursor++], y = a.vertices[cursor++], weight = a.vertices[cursor++];
        requireThat(Number.isInteger(bi) && bi >= 0 && bi < boneCount && !seen.has(bi) && [x,y,weight].every(Number.isFinite), path, 'Invalid influence');
        seen.add(bi); row.push({bi,x,y,weight}); size += 2;
      }
      const total=row.reduce((v,i)=>v+i.weight,0);requireThat(total>0&&Math.abs(total-1)<=.001,path,'Influence weights must sum to one');
      if(Math.abs(total-1)>1e-12){const max=Math.max(...row.map(i=>Math.abs(i.weight))),sum=row.reduce((v,i)=>v+i.weight/max,0);row.forEach(i=>i.weight=(i.weight/max)/sum);warnings.push({code:'NORMALIZED_WEIGHTS',path});}
      a.rows.push(row);
    }
    requireThat(cursor === a.vertices.length, path, 'Trailing or incomplete influences'); a.deformSize = size;
  }
}
function drawOrder(slots, key) {
  const result = new Array(slots.length), moved = new Set(); let previous = -1;
  for (const o of key.offsets ?? []) {
    const i = slots.findIndex(s => s.name === o.slot), target = i + o.offset;
    requireThat(i > previous && Number.isInteger(target) && target >= 0 && target < slots.length && result[target] === undefined, 'drawOrder', 'Invalid offsets');
    previous = i; moved.add(i); result[target] = i;
  }
  const unchanged = slots.map((_, i) => i).filter(i => !moved.has(i)); let c = 0;
  for (let i = 0; i < result.length; i++) if (result[i] === undefined) result[i] = unchanged[c++];
  return result;
}
function slotColors(slot,tracks,t){const tint=[...slot.color],dark=[...slot.dark];
  for(const kind of ['rgba','rgb','alpha'])if(tracks?.[kind]){const size=kind==='rgba'?4:kind==='rgb'?3:1;for(let i=0;i<size;i++){const v=interpolate(tracks[kind],t,k=>kind==='alpha'?value(k,'value'):color(kind==='rgb'?k.color+'ff':k.color)[i],i);if(v!==undefined)tint[kind==='alpha'?3:i]=Math.max(0,Math.min(1,v));}}
  for(const kind of ['rgba2','rgb2'])if(tracks?.[kind]){const lights=kind==='rgba2'?4:3;for(let i=0;i<lights+3;i++){const v=interpolate(tracks[kind],t,k=>i<lights?color(lights===4?k.light:k.light+'ff')[i]:color(k.dark+'ff')[i-lights],i);if(v!==undefined)(i<lights?tint:dark)[i<lights?i:i-lights]=Math.max(0,Math.min(1,v));}}
  return {color:tint,dark};
}
function phase(time,a,loop){return loop&&a?.duration>0?time%a.duration:Math.min(time,a?.duration??0);}
function blendSamples(base,over,alpha,data,mask,additive=false){const lerp=(a,b)=>a+(b-a)*alpha;
  const locals=base.locals.map((b,i)=>{const out={...b},name=data.bones[i].name,tracks=mask?.bones?.[name];
    const props=mask?new Set(Object.keys(tracks??{}).flatMap(k=>boneTracks[k].map(v=>v[0]))):new Set(transformFields);
    for(const p of props)out[p]=additive?b[p]+(over.locals[i][p]-data.bones[i].setup[p])*alpha:lerp(b[p],over.locals[i][p]);return out;});
  const slots=base.slots.map((b,i)=>{const o=over.slots[i],tracks=mask?.slots?.[b.name],hasDeform=!mask||mask.attachments;
    const out={...(alpha>=.5&&(!mask||tracks?.attachment)?o:b)};
    if(!mask||tracks&&Object.keys(tracks).some(k=>k!=='attachment')){out.color=b.color.map((v,j)=>lerp(v,o.color[j]));out.dark=b.dark.map((v,j)=>lerp(v,o.dark[j]));}
    if(hasDeform&&b.attachment===o.attachment)out.offset=j=>lerp(b.offset(j),o.offset(j));return out;});
  const constraints=base.constraints.map((b,i)=>{const o=over.constraints[i],out={...b};if(mask&&!mask[b.kind]?.[b.name])return out;
    for(const k of Object.keys(o))if(typeof o[k]==='number'&&!['order','targetIndex'].includes(k))out[k]=lerp(b[k],o[k]);else if(typeof o[k]==='boolean'&&alpha>=.5)out[k]=o[k];return out;});
  return {locals,slots,constraints,order:alpha>=.5&&(!mask||mask.drawOrder)?over.order:base.order};
}
export class SkeletonData {
  constructor(input) {
    requireThat(input&&typeof input==='object'&&!Array.isArray(input),'$','Expected skeleton object');this.warnings=[];
    const root = structuredClone(input); finiteTree(root);
    this.sourceVersion=root.skeleton?.spine;normalizeJson(root);
    requireThat((root.skeleton.referenceScale??100)===100,'skeleton.referenceScale','OpenBone physics uses referenceScale 100','UNSUPPORTED_FEATURE');
    resolveLinkedMeshes(root);
    fields(root, ['skeleton','bones','slots','skins','animations','events','ik','transform','path','physics'], '$');
    requireThat(/^4\.2\./.test(root.skeleton?.spine), '$.skeleton.spine', 'Only OpenBone 4.2 JSON exports are supported', 'UNSUPPORTED_VERSION');
    const bones = named(root.bones, '$.bones'), slots = named(root.slots ?? [], '$.slots');
    requireThat(bones.size > 0 && root.bones.filter(b => !b.parent).length === 1, '$.bones', 'Exactly one root is required');
    this.bones = root.bones.map((b, i) => {
      fields(b, ['name','parent',...transformFields,'length','inherit','color','skin','icon','visible'], `$.bones.${b.name}`);
      requireThat(['normal','onlyTranslation','noRotationOrReflection','noScale','noScaleOrReflection'].includes(b.inherit??'normal'), `$.bones.${b.name}.inherit`, 'Unknown inheritance mode');
      const parent = b.parent === undefined ? -1 : root.bones.findIndex(p => p.name === b.parent);
      requireThat(b.parent === undefined || parent >= 0 && parent < i, `$.bones.${b.name}.parent`, 'Parent must precede child');
      for (const k of transformFields) requireThat(typeof value(b,k,k.startsWith('scale')?1:0) === 'number', `$.bones.${b.name}.${k}`, 'Expected number');
      return {...b, setup: transform(b), parent};
    });
    this.slots = [...slots.values()].map(s => {
      fields(s, ['name','bone','attachment','color','blend','dark'], `$.slots.${s.name}`);
      requireThat(bones.has(s.bone), `$.slots.${s.name}.bone`, 'Unknown bone');
      requireThat(['normal','additive','multiply','screen'].includes(s.blend ?? 'normal'), `$.slots.${s.name}`, 'Unsupported blend', 'UNSUPPORTED_FEATURE');
      return {...s, boneIndex: root.bones.findIndex(b => b.name === s.bone), color: color(s.color),dark:s.dark?color(s.dark+'ff').slice(0,3):[0,0,0]};
    });
    this.constraints=readConstraints(root,this.bones,this.slots);
    this.skins = new Map(); named(root.skins ?? [], '$.skins');
    this.skinMembers=new Map();
    for (const s of root.skins ?? []) {
      fields(s, ['name','attachments','bones','ik','transform','path','physics','color'], `$.skins.${s.name}`);
      for(const name of s.bones??[]) requireThat(bones.has(name),`skin.${s.name}.bones`,'Unknown bone');
      for(const kind of ['ik','transform','path','physics']) for(const name of s[kind]??[]) requireThat(this.constraints.some(c=>c.kind===kind&&c.name===name),`skin.${s.name}.${kind}`,'Unknown constraint');
      this.skinMembers.set(s.name,s);
      const skin = new Map();
      for (const [slot, attachments] of entries(s.attachments)) {
        requireThat(slots.has(slot), `$.skins.${s.name}.${slot}`, 'Unknown slot'); const row = new Map();
        for (const [name, source] of entries(attachments)) {
          const path = `$.skins.${s.name}.${slot}.${name}`, a = {...source, type: source.type ?? 'region'};
          requireThat(['region','mesh','path','clipping','boundingbox'].includes(a.type), path, `Unsupported attachment type: ${a.type}`, 'UNSUPPORTED_FEATURE');
          fields(source, a.type === 'region' ? ['type','name','path',...transformFields,'width','height','color','sequence'] : a.type==='mesh'?['type','name','path','uvs','triangles','vertices','hull','edges','width','height','color','sequence']:['type','name','vertexCount','vertices','closed','constantSpeed','lengths','end','color'], path);
          a.name = name; a.path = a.path ?? source.name ?? name; a.color = color(a.color);
          validateSequence(a.sequence,path+'.sequence');
          if (a.type !== 'region') {
            mesh(a, bones.size, path,this.warnings);
            if(a.type==='clipping')requireThat(a.end==null||slots.has(a.end),path,'Unknown clipping end slot');
            if(a.type==='path'){
              a.closed=a.closed??false;a.constantSpeed=a.constantSpeed??true;
              requireThat(a.vertexCount%3===0&&a.vertexCount>=(a.closed?3:6)&&Array.isArray(a.lengths)&&a.lengths.length===a.vertexCount/3,path,'Invalid path control layout');
            }
          }
          else {
            a.local = transform(a);
            requireThat(Object.values(a.local).every(Number.isFinite),path,'Expected numeric attachment transform');
            requireThat(typeof a.width === 'number' && a.width > 0 && typeof a.height === 'number' && a.height > 0, path, 'Region needs positive width and height');
          }
          row.set(name, a);
        }
        skin.set(slot, row);
      }
      this.skins.set(s.name, skin);
    }
    this.animations = new Map(); this.events = root.events ?? {};
    for (const [name, a] of entries(root.animations)) {
      fields(a, ['bones','slots','attachments','drawOrder','events','ik','transform','path','physics'], `$.animations.${name}`);
      let duration = 0;
      const track = (k,p,e=false) => { keys(k,p,e); duration = Math.max(duration, k.at(-1).time ?? 0); };
      validateConstraintTracks(a,this.constraints,track);
      for (const [bone, tracks] of entries(a.bones)) {
        requireThat(bones.has(bone), `animation.${name}.${bone}`, 'Unknown bone');
        fields(tracks, Object.keys(boneTracks), `animation.${name}.${bone}`);
        const properties = new Set();
        for (const [kind, k] of entries(tracks)) {
          track(k, `animation.${name}.${bone}.${kind}`);
          for (const key of k) fields(key,['time','curve',...boneTracks[kind].map(c=>c[1])],`animation.${name}.${bone}.${kind}`);
          for (const [property, field, fallback] of boneTracks[kind]) {
            requireThat(!properties.has(property), kind, 'Overlapping bone channels'); properties.add(property);
            for (const key of k) requireThat(typeof value(key,field,fallback) === 'number', kind, 'Expected numeric key');
          }
          for (const key of k) if (Array.isArray(key.curve)) requireThat(key.curve.length === boneTracks[kind].length*4,kind,'Incorrect curve component count');
        }
      }
      for (const [slot, tracks] of entries(a.slots)) {
        requireThat(slots.has(slot), `animation.${name}.${slot}`, 'Unknown slot'); fields(tracks,['attachment','rgba','rgb','alpha','rgba2','rgb2'],slot);
        requireThat(!(tracks.rgba && (tracks.rgb || tracks.alpha)), slot, 'Overlapping color channels');
        for (const [kind,k] of entries(tracks)) {
          track(k,slot);
          for (const key of k) {
            fields(key,['time','curve',...(kind.endsWith('2')?['light','dark']:[kind === 'attachment' ? 'name' : kind === 'alpha' ? 'value' : 'color'])],`animation.${name}.${slot}.${kind}`);
            if (kind === 'attachment') requireThat(key.name == null || typeof key.name === 'string',slot,'Invalid attachment name');
            else if (kind === 'alpha') requireThat(typeof value(key,'value') === 'number',slot,'Invalid alpha');
            else if(kind.endsWith('2')){color(kind==='rgb2'?key.light+'ff':key.light);color(key.dark+'ff');}
            else color(kind === 'rgb' ? `${key.color}ff` : key.color);
            const components = kind==='rgba2'?7:kind==='rgb2'?6:kind === 'rgba' ? 4 : kind === 'rgb' ? 3 : 1;
            if (Array.isArray(key.curve)) requireThat(key.curve.length === components*4,slot,'Incorrect curve component count');
          }
        }
      }
      for (const [skin, rows] of entries(a.attachments)) for (const [slot, row] of entries(rows)) for (const [attachment, tracks] of entries(row)) {
        const att = this.skins.get(skin)?.get(slot)?.get(attachment);
        requireThat(att, 'attachments', 'Unknown attachment'); fields(tracks,['deform','sequence'],'attachments');
        if(tracks.sequence){requireThat(att.sequence,'sequence','Attachment has no sequence');track(tracks.sequence,'sequence');for(const k of tracks.sequence){fields(k,['time','mode','index','delay'],'sequence');requireThat(sequenceModes.includes(k.mode??'hold')&&Number.isInteger(k.index??0)&&(k.index??0)>=0&&((k.mode??'hold')==='hold'||typeof k.delay==='number'&&k.delay>0),'sequence','Invalid sequence key');}}
        if (tracks.deform) {
          requireThat(['mesh','path','clipping'].includes(att.type),'deform','Attachment cannot deform');
          track(tracks.deform,'deform');
          for (const key of tracks.deform) {
            fields(key,['time','curve','offset','vertices'],'deform');
            const offset = key.offset ?? 0;
            requireThat(Number.isInteger(offset) && offset >= 0 && Array.isArray(key.vertices ?? []) && (key.vertices ?? []).every(Number.isFinite) && offset+(key.vertices?.length ?? 0) <= att.deformSize, 'deform', 'Invalid sparse deform');
            if (Array.isArray(key.curve)) requireThat(key.curve.length === 4,'deform','Expected one percentage curve');
          }
        }
      }
      if (a.drawOrder) { track(a.drawOrder,'drawOrder'); for (const k of a.drawOrder) k.order = drawOrder(this.slots,k); }
      if (a.events) { track(a.events,'events',true); for (const k of a.events) requireThat(own(this.events,k.name),'events','Unknown event'); }
      this.animations.set(name, {...a, duration:duration===0&&this.constraints.some(c=>c.kind==='physics')?5:duration});
    }
  }
  createSkeleton() { return new Skeleton(this); }
}
export class Skeleton {
  constructor(data) {
    this.data = data; this.skin = data.skins.has('default') ? 'default' : data.skins.keys().next().value;
    this.animation = null; this.time = 0; this.loop = true;
    this.tracks=new Map();this._generation=0;
    // Java PhysicsPlayer.step uses setup slots and no attachment deforms for its
    // integration transaction; the final POSE uses animated/resolved geometry.
    this._integrationSlots=data.slots.map(s=>({...s,attachment:data.skins.get('default')?.get(s.name)?.get(s.attachment),offset:()=>0}));
  }
  setSkin(name) { requireThat(this.data.skins.has(name),'skin',`Unknown skin: ${name}`); this.skin = name; return this; }
  setAnimation(name, loop = true) { requireThat(this.data.animations.has(name),'animation',`Unknown animation: ${name}`); this.animation = name; this.loop = loop; this.time = 0; this._transition=null;this._physics=null;this._generation++;return this; }
  mixTo(name,duration,loop=true){requireThat(this.data.animations.has(name),'animation',`Unknown animation: ${name}`);requireThat(Number.isFinite(duration)&&duration>=0,'mixDuration','Expected nonnegative seconds');
    const previous=this._transition?{snapshot:this._compose(phase(this.time,this.data.animations.get(this.animation),this.loop))}:{animation:this.animation,time:this.time,loop:this.loop};
    this.setAnimation(name,loop);if(duration>0)this._transition={...previous,duration};return this;}
  setTrack(index,name,{alpha=1,additive=false,loop=true,time=0}={}){requireThat(Number.isInteger(index)&&index>0&&index<=64,'track','Expected track index 1–64');requireThat(this.data.animations.has(name),'animation',`Unknown animation: ${name}`);requireThat(Number.isFinite(alpha)&&alpha>=0&&alpha<=1&&Number.isFinite(time)&&time>=0,'track','Invalid track alpha/time');this.tracks.set(index,{animation:name,alpha,additive,loop,time});this._generation++;this._physics=null;return this;}
  clearTrack(index){this.tracks.delete(index);this._generation++;this._physics=null;return this;}
  resetPhysics(){this._physics=null;return this;}
  seek(time) { requireThat(Number.isFinite(time) && time >= 0,'time','Expected nonnegative finite seconds'); this.time = time; return this; }
  update(delta) {
    requireThat(Number.isFinite(delta) && delta >= 0,'delta','Expected nonnegative finite seconds');
    const start = this.time, end = start+delta;
    requireThat(Number.isFinite(end),'time','Playback time overflow');
    const a = this.data.animations.get(this.animation);
    const events = [];
    const collect=(a,loop,offset,track)=>{if(!a?.events)return;const from=start+offset,to=end+offset;
      if(loop&&a.duration>0)requireThat(Math.floor(to/a.duration)-Math.floor(from/a.duration)<=1000,'delta','Too many event loops in one update');
      const add=(k,absolute)=>{if(absolute>from&&absolute<=to)events.push({...this.data.events[k.name],...k,absoluteTime:absolute-offset,...track?{track}: {}});};
      if(loop&&a.duration>0){for(let cycle=Math.floor(from/a.duration);cycle<=Math.floor(to/a.duration);cycle++)for(const k of a.events)add(k,cycle*a.duration+(k.time??0));}else for(const k of a.events)add(k,k.time??0);
    };
    collect(a,this.loop,0,0);for(const [index,layer] of this.tracks)if(layer.alpha>0)collect(this.data.animations.get(layer.animation),layer.loop,layer.time,index);
    this.seek(end);
    return events.sort((x,y) => x.absoluteTime-y.absoluteTime);
  }
  _sample(t,animation=this.animation) {
    const data=this.data,a=data.animations.get(animation),members=data.skinMembers.get(this.skin),activeBones=new Set();
    data.bones.forEach((b,i)=>{if(!b.skin)activeBones.add(i);});
    for(const name of members?.bones??[]){let i=data.bones.findIndex(b=>b.name===name);while(i>=0){activeBones.add(i);i=data.bones[i].parent;}}
    const locals = data.bones.map(b => {
      const local = {...b.setup};
      for (const [kind, track] of entries(a?.bones?.[b.name])) boneTracks[kind].forEach(([property,field,fallback,mul], component) => {
        const v = interpolate(track,t,k => value(k,field,fallback),component);
        if (v !== undefined) local[property] = mul ? b.setup[property]*v : b.setup[property]+v;
      });
      return local;
    });
    const slots=data.slots.map(slot=>{
      const tracks=a?.slots?.[slot.name],ki=last(tracks?.attachment,t),name=ki<0?slot.attachment:tracks.attachment[ki].name;
      const selected=data.skins.get(this.skin)?.get(slot.name),defaults=data.skins.get('default')?.get(slot.name);
      const attachment=activeBones.has(slot.boneIndex)?selected?.get(name)??defaults?.get(name):undefined,owner=selected?.has(name)?this.skin:'default';
      const deform=a?.attachments?.[owner]?.[slot.name]?.[name]?.deform;
      const sequence=a?.attachments?.[owner]?.[slot.name]?.[name]?.sequence;
      return {...slot,...slotColors(slot,tracks,t),name:slot.name,attachment,attachmentName:name,sequencePath:attachment?sequencePath(attachment,attachment.sequence?sequenceIndex(attachment.sequence,sequence,t):0):undefined,offset:i=>interpolate(deform,t,k=>k.vertices?.[i-(k.offset??0)]??0,0,true)??0};
    });
    const ki=last(a?.drawOrder,t),order=ki<0?data.slots.map((_,i)=>i):a.drawOrder[ki].order;
    return {locals,slots,constraints:sampleConstraints(data,a,t,this.skin,activeBones),order};
  }
  _compose(t,absolute=t){let s=this._sample(t);const transition=this._transition;
    if(transition&&absolute<transition.duration){const old=transition.snapshot??this._sample(phase(transition.time+absolute,this.data.animations.get(transition.animation),transition.loop),transition.animation);s=blendSamples(old,s,absolute/transition.duration,this.data);}
    for(const [,layer] of [...this.tracks].sort((a,b)=>a[0]-b[0])){const a=this.data.animations.get(layer.animation),over=this._sample(phase(layer.time+absolute,a,layer.loop),layer.animation);s=blendSamples(s,over,layer.alpha,this.data,a,layer.additive);}
    return s;
  }
  evaluate(atlas) {
    const data=this.data,a=data.animations.get(this.animation),hasPhysics=data.constraints.some(c=>c.kind==='physics');
    const duration=a?.duration??(hasPhysics?5:0),t=this.loop&&duration>0?this.time%duration:Math.min(this.time,duration);
    const sampled=this._compose(t,this.time);let physics={mode:'none',states:new Map(),tick:0};
    if(hasPhysics){
      requireThat(t<=600&&duration<=600&&(this.loop||this.time<=600),'physics','Replay exceeds 600 seconds');
      let target=Math.floor(t*60);while(target>0&&t<target/60)target--;while(target<36000&&t>=(target+1)/60)target++;
      const key=JSON.stringify([this.animation,this.skin,this._generation,Math.floor(duration>0?this.time/duration:0)]);
      let cache=this._physics;
      if(!cache||cache.key!==key||target<cache.frame)cache={key,frame:-1,states:new Map()};
      const states=new Map(cache.states);
      for(let frame=cache.frame+1;frame<=target;frame++){
        const s=this._compose(frame/60,this.time-t+frame/60);solve(data,s.locals,s.constraints,this._integrationSlots,{mode:frame===0?'reset':'update',states,tick:frame});
      }
      this._physics={key,frame:target,states};physics={mode:'pose',states:new Map(states),tick:target};
    }
    const worlds=solve(data,sampled.locals,sampled.constraints,sampled.slots,physics);
    const order=sampled.order;
    const draws = [],paths=[],clips=[],boundingBoxes=[];let clipping=null;
    for (const index of order) {
      const slot=sampled.slots[index],tracks=a?.slots?.[slot.name],name=slot.attachmentName,att=slot.attachment;
      const finish=()=>{if(clipping?.end===slot.name)clipping=null;};
      if(!att){finish();continue;}
      if(['path','clipping','boundingbox'].includes(att.type)){
        const vertices=vertexPoints(att,worlds,worlds[slot.boneIndex],slot.offset),geometry={slot:slot.name,attachment:name,vertices};
        if(att.type==='clipping'){clips.push(geometry);if(!clipping)clipping={vertices,end:att.end};continue;}
        if(att.type==='path')paths.push(geometry);else boundingBoxes.push(geometry);finish();continue;
      }
      const region = atlas.regions.get(slot.sequencePath); requireThat(region,'atlas',`Missing region: ${slot.sequencePath}`);
      let vertices, uvs, triangles;
      const world = worlds[slot.boneIndex];
      if (att.type === 'region') {
        const m = multiply(world,matrix(att.local));
        const x = -att.width/2 + region.offsetX*att.width/region.originalWidth;
        const y = -att.height/2 + region.offsetY*att.height/region.originalHeight;
        const w = region.width*att.width/region.originalWidth, h = region.height*att.height/region.originalHeight;
        vertices = [point(m,x,y),point(m,x,y+h),point(m,x+w,y+h),point(m,x+w,y)];
        uvs = [[0,1],[0,0],[1,0],[1,1]].map(([u,v]) => atlas.uv(region,u,v,true)); triangles = [0,1,2,2,3,0];
      } else {
        vertices=vertexPoints(att,worlds,world,slot.offset);
        uvs = []; for (let i = 0; i < att.uvs.length; i += 2) uvs.push(atlas.uv(region,att.uvs[i],att.uvs[i+1],false)); triangles = att.triangles;
      }
      const tint=slot.color,dark=slot.dark;
      const draw = {slot:slot.name, attachment:name, page:region.page, pma:region.pma, blend:slot.blend ?? 'normal', color:tint.map((c,i) => c*att.color[i]),dark, vertices,uvs,triangles};
      requireThat(vertices.flat().every(v=>Number.isFinite(Math.fround(v))),'pose','World geometry exceeds float32 range'); draws.push(clipping?clipGeometry(draw,clipping.vertices):draw);finish();
    }
    return {animation:this.animation, time:t, skin:this.skin, bones:worlds, draws,paths,clips,boundingBoxes};
  }
}
