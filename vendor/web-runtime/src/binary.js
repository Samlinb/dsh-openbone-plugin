// Independent bounded wire decoder, based on OpenBone's own Spine40Binary data adapter.
// Does not bundle or translate an official Spine runtime implementation.
import {requireThat,RuntimeError} from './core.js';
import {versionFamily} from './versions.js';
const inherits=['normal','onlyTranslation','noRotationOrReflection','noScale','noScaleOrReflection'];
const mixes=['mixRotate','mixX','mixY','mixScaleX','mixScaleY','mixShearY'];
const kinds=['ik','transform','path','physics'];
const obj=()=>Object.create(null);
const child=(o,k)=>o[k]??=(obj());
class Reader {
  constructor(bytes){this.bytes=bytes;this.view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);this.pos=0;this.budget=Math.max(1000000,bytes.length);this.strings=[];this.bones=[];this.slots=[];this.skins=[];this.events=[];this.root=obj();}
  need(n){requireThat(this.pos+n<=this.bytes.length,'binary@'+this.pos,'Truncated binary');}
  byte(){this.need(1);return this.bytes[this.pos++];}
  uint16(){this.need(2);const n=this.view.getUint16(this.pos);this.pos+=2;return n;}
  int(){this.need(4);const n=this.view.getInt32(this.pos);this.pos+=4;return n;}
  varint(){let value=0;for(let shift=0;shift<35;shift+=7){const b=this.byte();requireThat(shift!==28||(b&0xf0)===0,'binary.varint','Varint overflow');value|=(b&127)<<shift;if(!(b&128))return value>>>0;}throw new RuntimeError('INVALID_DATA','binary','Invalid varint');}
  count(){const n=this.varint();requireThat(n<=this.bytes.length-this.pos&&n<=this.budget,'binary.count','Count exceeds input/budget');this.budget-=n;return n;}
  signed(){const n=this.varint();return (n>>>1)^-(n&1);}
  bool(){const n=this.byte();requireThat(n<=1,'binary.boolean','Invalid boolean');return n===1;}
  number(){this.need(4);const n=this.view.getFloat32(this.pos);this.pos+=4;requireThat(Number.isFinite(n),'binary.number','Nonfinite number');return n;}
  text(){const n=this.varint();if(n===0)return null;requireThat(n<=1000001,'binary.string','String too long');this.need(n-1);const s=new TextDecoder('utf-8',{fatal:true}).decode(this.bytes.subarray(this.pos,this.pos+n-1));this.pos+=n-1;return s;}
  at(list,i){requireThat(Number.isInteger(i)&&i>=0&&i<list.length,'binary.index','Index out of range');return list[i];}
  ref(){const i=this.varint();return i===0?null:this.at(this.strings,i-1);}
  required(s){requireThat(typeof s==='string'&&s.length,'binary.name','Empty name');return s;}
  color(){return (this.int()>>>0).toString(16).padStart(8,'0');}
  floats(o,...fields){for(const f of fields)o[f]=this.number();}
  array(n){return Array.from({length:n},()=>this.number());}
  optional(o,flags,start,...fields){fields.forEach((f,i)=>{if(flags&(1<<(start+i)))o[f]=this.number();});}
  enumeration(values){return this.at(values,this.varint());}
  each(fn){for(let i=0,n=this.count();i<n;i++)fn(i);}
  unsupported(feature){throw new RuntimeError('UNSUPPORTED_FEATURE','binary@'+this.pos,feature);}
  oldMix(c,transform){c.mixRotate=this.number();c.mixX=c.mixY=this.number();if(transform){c.mixScaleX=c.mixScaleY=this.number();c.mixShearY=this.number();}}
  pathModes(c,f){c.positionMode=this.at(['fixed','percent'],f&1);c.spacingMode=this.at(['length','fixed','percent','proportional'],(f>>1)&3);c.rotateMode=this.at(['tangent','chain','chainScale'],(f>>3)&3);}
  ikFlags(c,v43){const f=this.byte();c.skin=!!(f&1);if(v43&&(f&2))this.unsupported('4.3 IK scaleY mode');c.bendPositive=v43?!(f&4):!!(f&2);c.compress=!!(f&(v43?8:4));c.stretch=!!(f&(v43?16:8));if(!v43)c.uniform=!!(f&16);c.mix=f&32?(f&64?this.number():1):0;c.softness=f&128?this.number():0;}
  physicsFields(c){const f=this.byte();c.skin=!!(f&1);this.optional(c,f,1,'x','y','rotate','scaleX','shearX');if(this.family==='4.3'&&c.scaleX<0)this.unsupported('4.3 physics scaleY');c.limit=f&64?this.number():5000;c.fps=this.byte();this.floats(c,'inertia','strength','damping');c.mass=f&128?1/this.number():1;this.floats(c,'wind','gravity');const g=this.byte();if(g&127)this.unsupported('global physics parameters');c.mix=g&128?this.number():1;}
  constraints(kind){const list=this.root[kind]=[];this.each(()=>{const c={name:this.required(this.text()),order:this.varint()};list.push(c);if(this.family!=='4.2'||kind==='path')c.skin=this.bool();c.bones=[];this.each(()=>c.bones.push(this.at(this.bones,this.varint())));c.target=this.at(kind==='path'?this.slots:this.bones,this.varint());
    if(kind==='ik'){if(this.family==='4.2')this.ikFlags(c,false);else{this.floats(c,'mix','softness');c.bendPositive=this.byte()===1;c.compress=this.bool();c.stretch=this.bool();c.uniform=this.bool();}}
    else if(kind==='transform'){if(this.family==='4.2'){const f=this.byte();c.skin=!!(f&1);c.local=!!(f&2);c.relative=!!(f&4);this.optional(c,f,3,'rotation','x','y','scaleX','scaleY');this.optional(c,this.byte(),0,'shearY',...mixes);for(const m of mixes)c[m]??=0;}
      else{c.local=this.bool();c.relative=this.bool();this.floats(c,'rotation','x','y','scaleX','scaleY','shearY');if(this.legacy)this.oldMix(c,true);else this.floats(c,...mixes);}}
    else{if(this.family==='4.2'){const f=this.byte();this.pathModes(c,f);if(f&128)c.rotation=this.number();}else{c.positionMode=this.enumeration(['fixed','percent']);c.spacingMode=this.enumeration(['length','fixed','percent','proportional']);c.rotateMode=this.enumeration(['tangent','chain','chainScale']);c.rotation=this.number();}this.floats(c,'position','spacing');if(this.legacy)this.oldMix(c,false);else this.floats(c,...mixes.slice(0,3));}
  });}
  constraints43(){this.each(order=>{const name=this.required(this.text()),type=this.byte(),kind=this.at(['ik','path','transform','physics'],type),c={name,order};(this.root[kind]??=[]).push(c);
    if(type===3){c.bone=this.at(this.bones,this.varint());this.physicsFields(c);return;}
    c.bones=[];this.each(()=>c.bones.push(this.at(this.bones,this.varint())));c.target=this.at(type===1?this.slots:this.bones,this.varint());
    if(type===0)this.ikFlags(c,true);
    else if(type===1){const f=this.byte();c.skin=!!(f&1);this.pathModes(c,f>>1);if(f&128)c.rotation=this.number();this.floats(c,'position','spacing',...mixes.slice(0,3));}
    else{const f=this.byte();c.skin=!!(f&1);if((f&16)||!!(f&2)!==!!(f&4))this.unsupported('4.3 clamp/mixed transform');c.local=!!(f&2);c.relative=!!(f&8);const active=Array(6).fill(false);
      for(let i=0;i<(f>>5);i++){const from=this.byte(),offset=this.number(),count=this.byte();if(from>=6||offset!==0||count!==1)this.unsupported('4.3 remapped property');const to=this.byte(),toOffset=this.number();this.number();const scale=this.number();if(to!==from||toOffset!==0||scale!==1||active[from])this.unsupported('4.3 cross-property transform');active[from]=true;}
      this.optional(c,this.byte(),0,'rotation','x','y','scaleX','scaleY','shearY');const flags=this.byte();mixes.forEach((m,i)=>{const v=flags&(1<<i)?this.number():1;c[m]=active[i]?v:0;});}
  });}
  vertices(a,size,weighted){requireThat(size<=65535,'binary.vertices','Too many vertices');a.vertices=[];if(!weighted){a.vertices=this.array(size*2);return;}
    const expected=this.family==='4.3'?this.count():-1;let entries=0;
    for(let i=0;i<size;i++){const n=this.count();entries+=1+n;a.vertices.push(n);for(let j=0;j<n;j++){const b=this.varint();this.at(this.bones,b);a.vertices.push(b,...this.array(3));}}
    requireThat(expected<0||expected===entries,'binary.vertices','Weighted bone array size mismatch');}
  attachment(key){if(this.modern)return this.attachment42(key);const name=this.ref()??key,type=this.byte(),a={};
    if(type===0){a.type='region';a.path=this.ref()??name;this.floats(a,'rotation','x','y','scaleX','scaleY','width','height');a.color=this.color();if(this.family==='4.1'&&this.bool())this.unsupported('attachment sequence');}
    else if(type===2){a.type='mesh';a.path=this.ref()??name;a.color=this.color();const size=this.count();a.uvs=this.array(size*2);a.triangles=[];this.each(()=>a.triangles.push(this.uint16()));this.vertices(a,size,this.bool());a.hull=this.varint();if(this.family==='4.1'&&this.bool())this.unsupported('attachment sequence');if(this.nonessential){a.edges=[];this.each(()=>a.edges.push(this.uint16()));this.floats(a,'width','height');}}
    else if(type===3){a.type='linkedmesh';a.path=this.ref()??name;a.color=this.color();a.skin=this.ref()??'default';a.parent=this.required(this.ref());a.deform=this.bool();if(this.nonessential)this.floats(a,'width','height');}
    else if([1,4,6].includes(type)){a.type=type===1?'boundingbox':type===4?'path':'clipping';if(type===4){a.closed=this.bool();a.constantSpeed=this.bool();}if(type===6)a.end=this.at(this.slots,this.varint());const size=this.count();a.vertexCount=size;this.vertices(a,size,this.bool());if(type===4)a.lengths=this.array(size/3);if(this.nonessential){const color=this.color();if(type!==4)a.color=color;}}
    else this.unsupported('attachment type '+type);return a;}
  attachment42(key){const f=this.byte(),type=f&7,name=f&8?this.required(this.ref()):key,a={};
    if(type===0||type===2){a.path=f&16?(this.ref()??name):name;a.color=f&32?this.color():'ffffffff';if(f&64)this.unsupported('attachment sequence');}
    if(type===0){a.type='region';a.rotation=f&128?this.number():0;this.floats(a,'x','y','scaleX','scaleY','width','height');}
    else if(type===2){a.type='mesh';a.hull=this.count();const size=this.count();this.vertices(a,size,!!(f&128));a.uvs=this.array(size*2);const faces=(size*2-a.hull-2)*3;requireThat(faces>=0&&faces<=this.budget,'binary.mesh','Invalid triangle count');this.budget-=faces;a.triangles=Array.from({length:faces},()=>this.varint());if(this.family==='4.3'&&this.count()!==0)this.unsupported('cross-slot mesh timelines');if(this.nonessential){a.edges=[];this.each(()=>a.edges.push(this.varint()));this.floats(a,'width','height');}}
    else if([1,4,6].includes(type)){a.type=type===1?'boundingbox':type===4?'path':'clipping';if(type===4){a.closed=!!(f&16);a.constantSpeed=!!(f&32);}if(type===6)a.end=this.at(this.slots,this.varint());const size=this.count();a.vertexCount=size;this.vertices(a,size,!!(f&(type===4?64:16)));if(type===4)a.lengths=this.array(size/3);if(this.nonessential){const color=this.color();if(type!==4)a.color=color;}}
    else this.unsupported('attachment type '+type);return a;}
  skin(name,count){this.skins.push(name);const skin={name,attachments:obj()};this.root.skins.push(skin);
    for(let i=0;i<count;i++){const slot=this.at(this.slots,this.varint()),row=obj();requireThat(!Object.hasOwn(skin.attachments,slot),'binary.skin','Duplicate slot');skin.attachments[slot]=row;this.each(()=>{const key=this.required(this.ref());requireThat(!Object.hasOwn(row,key),'binary.attachment','Duplicate attachment');row[key]=this.attachment(key);});}return skin;}
  read(family){this.family=family;this.legacy=family==='3.8';this.modern=family==='4.2'||family==='4.3';const root=this.root;
    let hash;if(this.legacy)hash=this.text();else{this.need(8);hash=this.view.getBigInt64(this.pos).toString();this.pos+=8;}
    this.version=this.required(this.text());requireThat(versionFamily(this.version)===family,'binary.version','Version mismatch');
    requireThat(this.version!=='3.8.75','binary.version','3.8.75 binary layout is not supported','UNSUPPORTED_VERSION');
    root.skeleton={spine:'4.2.22',hash};this.floats(root.skeleton,'x','y','width','height');if(this.modern)root.skeleton.referenceScale=this.number();
    this.nonessential=this.bool();if(this.nonessential){root.skeleton.fps=this.number();this.text();const audio=this.text();if(audio!==null)root.skeleton.audio=audio;}
    this.each(()=>this.strings.push(this.text()));root.bones=[];
    this.each(i=>{const b={name:this.required(this.text())};if(i>0)b.parent=this.at(this.bones,this.varint());this.bones.push(b.name);root.bones.push(b);this.floats(b,'rotation','x','y','scaleX','scaleY','shearX','shearY');if(family!=='4.3')b.length=this.number();b.inherit=this.enumeration(inherits);if(family==='4.3')b.length=this.number();b.skin=this.bool();if(this.nonessential){b.color=this.color();if(this.modern){this.text();if(family==='4.3'){this.number();this.number();}this.bool();}}});
    root.slots=[];this.each(()=>{const s={name:this.required(this.text()),bone:this.at(this.bones,this.varint()),color:this.color()};this.slots.push(s.name);root.slots.push(s);if(this.int()!==-1)this.unsupported('two-color slots');s.attachment=this.ref();s.blend=this.enumeration(['normal','additive','multiply','screen']);if(this.nonessential&&this.modern)this.bool();});
    if(family==='4.3')this.constraints43();else{for(const kind of kinds.slice(0,3))this.constraints(kind);if(family==='4.2'){root.physics=[];this.each(()=>{const c={name:this.required(this.text()),order:this.varint(),bone:this.at(this.bones,this.varint())};this.physicsFields(c);root.physics.push(c);});}}
    root.skins=[];const defaultSlots=this.count();if(defaultSlots>0)this.skin('default',defaultSlots);
    this.each(()=>{const name=this.required(this.modern?this.text():this.ref()),members={};if(this.nonessential&&this.modern)this.color();members.bones=[];this.each(()=>members.bones.push(this.at(this.bones,this.varint())));
      if(family==='4.3'){const all=kinds.flatMap(k=>(root[k]??[]).map(c=>({...c,kind:k}))).sort((a,b)=>a.order-b.order);this.each(()=>{const c=this.at(all,this.varint());(members[c.kind]??=[]).push(c.name);});}
      else for(const k of kinds.slice(0,family==='4.2'?4:3)){members[k]=[];this.each(()=>members[k].push(this.at(root[k]??[],this.varint()).name));}
      Object.assign(this.skin(name,this.count()),members);});
    if(defaultSlots===0)root.skins.unshift({name:'default',attachments:obj()});
    root.events=obj();this.each(()=>{const name=this.required(this.modern?this.text():this.ref()),e={int:this.signed(),float:this.number(),string:this.text()??''};const audio=this.text();if(audio!==null){e.audio=audio;this.floats(e,'volume','balance');}requireThat(!Object.hasOwn(root.events,name),'binary.event','Duplicate event');root.events[name]=e;this.events.push({name,...e});});
    root.animations=obj();this.each(()=>{const name=this.required(this.text());requireThat(!Object.hasOwn(root.animations,name),'binary.animation','Duplicate animation');root.animations[name]=this.animation();});
    requireThat(this.pos===this.bytes.length,'binary@'+this.pos,'Trailing bytes');return {json:root,version:this.version};
  }
  curve(k,dims){const type=this.byte();if(type===1)k.curve='stepped';else if(type===2)k.curve=this.array(dims*4);else requireThat(type===0,'binary.curve','Unknown curve type');}
  frame(fields,dims,packed){const k={time:this.number()};if(packed&&dims>1)k.color=Array.from({length:dims},()=>this.byte().toString(16).padStart(2,'0')).join('');else for(const f of fields)k[f]=packed?this.byte()/255:this.number();return k;}
  absolute(keys,fields,dims,packed,fraction=false){for(let i=0;i+1<keys.length;i++){const k=keys[i],next=keys[i+1],rel=k.curve;if(!Array.isArray(rel))continue;const read=(key,c)=>packed&&dims>1?parseInt(key.color.slice(c*2,c*2+2),16)/255:key[fields[Math.min(c,fields.length-1)]]??0,dt=next.time-k.time;k.curve=[];
      for(let c=0;c<dims;c++){const a=fraction?0:read(k,c),b=fraction?1:read(next,c);k.curve.push(k.time+rel[0]*dt,a+rel[1]*(b-a),k.time+rel[2]*dt,a+rel[3]*(b-a));}}}
  track(frames,fields,dims,packed=false){requireThat(frames>0,'binary.track','Empty track');const keys=[];
    if(this.legacy){for(let f=0;f<frames;f++){const k=this.frame(fields,dims,packed);keys.push(k);if(f+1<frames)this.curve(k,1);}this.absolute(keys,fields,dims,packed);}
    else{keys.push(this.frame(fields,dims,packed));for(let f=1;f<frames;f++){const k=this.frame(fields,dims,packed);this.curve(keys.at(-1),dims);keys.push(k);}}return keys;}
  constraintName(kind,index){const list=this.family==='4.3'?(this.root[kind]??[]).filter(c=>c.order===index):[this.at(this.root[kind]??[],index)];requireThat(list.length===1,'binary.constraint','Invalid constraint index/type');return list[0].name;}
  expandMix(keys,transform){for(const k of keys){k.mixY=k.mixX;if(transform)k.mixScaleY=k.mixScaleX;if(Array.isArray(k.curve)){const old=k.curve;k.curve=(transform?[0,1,1,2,2,3]:[0,1,1]).flatMap(i=>old.slice(i*4,i*4+4));}}}
  constraintTracks(a){this.each(()=>{const name=this.constraintName('ik',this.varint()),frames=this.count();if(!this.legacy)this.count();const keys=[];child(a,'ik')[name]=keys;let pending;
    for(let f=0;f<frames;f++){let k;if(this.modern){const flags=this.byte();k={time:this.number(),mix:flags&1?(flags&2?this.number():1):0,softness:flags&4?this.number():0,bendPositive:!!(flags&8),compress:!!(flags&16),stretch:!!(flags&32)};if(f>0){if(flags&64)keys.at(-1).curve='stepped';else if(flags&128)keys.at(-1).curve=this.array(8);}}
      else{k=pending??this.frame(['mix','softness'],2,false);pending=undefined;k.bendPositive=this.byte()===1;k.compress=this.bool();k.stretch=this.bool();if(f+1<frames){if(this.legacy)this.curve(k,1);else{pending=this.frame(['mix','softness'],2,false);this.curve(k,2);}}}keys.push(k);}
    if(this.legacy)this.absolute(keys,['mix','softness'],2,false);});
    this.each(()=>{const name=this.constraintName('transform',this.varint()),frames=this.count();if(!this.legacy)this.count();const fields=this.legacy?['mixRotate','mixX','mixScaleX','mixShearY']:mixes,keys=this.track(frames,fields,fields.length);if(this.legacy)this.expandMix(keys,true);child(a,'transform')[name]=keys;});
    this.each(()=>{const groups=child(child(a,'path'),this.constraintName('path',this.varint()));this.each(()=>{const type=this.byte(),frames=this.count();if(!this.legacy)this.count();const name=this.at(['position','spacing','mix'],type),fields=type===2?(this.legacy?['mixRotate','mixX']:mixes.slice(0,3)):['value'],keys=this.track(frames,fields,fields.length);if(this.legacy&&type===2)this.expandMix(keys,false);groups[name]=keys;});});
    if(this.modern)this.each(()=>{const i=this.varint()-1;if(i<0)this.unsupported('global physics timeline');const groups=child(child(a,'physics'),this.constraintName('physics',i));this.each(()=>{const type=this.byte(),frames=this.count(),name=this.at(['inertia','strength','damping','invalid','mass','wind','gravity','mix','reset'],type);if(type===3||type===8)this.unsupported('physics reset/channel');this.count();groups[name]=this.track(frames,['value'],1);});});
  }
  animation(){const a=obj();if(!this.legacy)this.count();
    this.each(()=>{const slot=child(child(a,'slots'),this.at(this.slots,this.varint()));this.each(()=>{const type=this.byte(),frames=this.count();if(type===0){slot.attachment=Array.from({length:frames},()=>({time:this.number(),name:this.ref()}));}else{if(this.legacy&&type!==1)this.unsupported('two-color timeline');const field=type===1?'rgba':type===2?'rgb':type===5?'alpha':this.unsupported('two-color timeline'),dims=type===1?4:type===2?3:1;if(!this.legacy)this.count();slot[field]=this.track(frames,[type===5?'value':'color'],dims,true);}});});
    const types=['rotate','translate','translatex','translatey','scale','scalex','scaley','shear','shearx','sheary'];
    this.each(()=>{const bone=child(child(a,'bones'),this.at(this.bones,this.varint()));this.each(()=>{let type=this.byte();const frames=this.count();if(!this.legacy)this.count();if(this.legacy)type=this.at([0,1,4,7],type);const name=this.at(types,type),fields=[1,4,7].includes(type)?['x','y']:['value'],next=this.track(frames,fields,fields.length);
      if(bone[name]){requireThat(next[0].time===0,'binary.track','Partially overlapping duplicate timeline');const end=bone[name].at(-1).time;if(end>next.at(-1).time){const hold={...next.at(-1),time:end};delete hold.curve;next.push(hold);}}bone[name]=next;});});
    this.constraintTracks(a);if(this.family==='4.3'&&this.count()!==0)this.unsupported('slider timelines');
    this.each(()=>{const skin=child(child(a,'attachments'),this.at(this.skins,this.varint()));this.each(()=>{const slot=child(skin,this.at(this.slots,this.varint()));this.each(()=>{const keys=[];child(slot,this.required(this.ref())).deform=keys;if((this.family==='4.1'||this.modern)&&this.byte()!==0)this.unsupported('sequence timeline');const frames=this.count();if(!this.legacy)this.count();let time=this.number();
      for(let f=0;f<frames;f++){const k={time},values=this.count();keys.push(k);if(values>0){k.offset=this.varint();k.vertices=this.array(values);}if(f+1<frames){if(this.legacy){this.curve(k,1);time=this.number();}else{time=this.number();this.curve(k,1);}}}if(this.legacy)this.absolute(keys,['progress'],1,false,true);});});});
    const orders=this.count();if(orders>0){a.drawOrder=[];for(let i=0;i<orders;i++){const k={time:this.number(),offsets:[]};this.each(()=>k.offsets.push({slot:this.at(this.slots,this.varint()),offset:this.varint()|0}));a.drawOrder.push(k);}}
    if(this.family==='4.3'&&this.count()!==0)this.unsupported('draw-order folder timelines');
    const events=this.count();if(events>0){a.events=[];for(let i=0;i<events;i++){const time=this.number(),def=this.at(this.events,this.varint()),k={time,name:def.name,int:this.signed(),float:this.number()};k.string=(this.modern?this.text():this.bool()?this.text():null)??def.string;if(def.audio!==undefined)this.floats(k,'volume','balance');a.events.push(k);}}
    if(this.nonessential&&this.family==='4.3')this.color();return a;
  }
}
export function decodeBinary(input){const bytes=input instanceof Uint8Array?input:new Uint8Array(input);requireThat(bytes.length<=64*1024*1024,'binary','Binary exceeds 64 MiB');
  let family;
  try{const probe=new Reader(bytes);probe.need(8);probe.pos=8;family=versionFamily(probe.text());}catch{}
  if(!family){const probe=new Reader(bytes);probe.text();family=versionFamily(probe.text());requireThat(family==='3.8','binary.version','Unknown binary family','UNSUPPORTED_VERSION');}
  try{return new Reader(bytes).read(family);}catch(e){if(e instanceof RuntimeError)throw e;throw new RuntimeError('INVALID_DATA','binary',e.message);}
}
