// OpenBone integration layer. Animation, constraints, clipping, sequence, mixing and
// rendering are supplied by the official Spine runtimes, subject to their licenses.
import {RuntimeError,requireThat} from '../src/core.js';
import {normalizeJson,versionFamily} from '../src/versions.js';
import {decodeBinary} from '../src/binary.js';
import {openSource} from './source.js';
export const OFFICIAL_RUNTIME_INFO=Object.freeze({name:'OpenBone / official Spine WebGL',versions:{'4.2':'4.2.120','4.3':'4.3.13'}});
export async function loadOfficial(canvas,url,options={}){
  const source=await openSource(url,options),family=versionFamily(source.version),line=family==='4.3'?'4.3':'4.2';
  const sdk=await(line==='4.3'?import('./dist/spine43.js'):import('./dist/spine42.js'));
  options.signal?.throwIfAborted();
  let context,scene,atlas;const images=[];
  try{
    const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true,antialias:true});requireThat(gl,'webgl','WebGL unavailable','WEBGL_UNAVAILABLE');
    context=new sdk.ManagedWebGLRenderingContext(gl);scene=new sdk.SceneRenderer(canvas,context,true);atlas=new sdk.TextureAtlas(source.atlasText);
    // All uploaded textures use PMA. Decode straight pages once; existing PMA pages retain their bytes.
    if(line==='4.2'){sdk.GLTexture.DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL=true;scene.skeletonRenderer.premultipliedAlpha=true;}
    for(const page of atlas.pages){const bytes=await source.page(page.name);const image=await createImageBitmap(new Blob([bytes]),{premultiplyAlpha:page.pma?'none':'premultiply',colorSpaceConversion:'none'});images.push(image);
      requireThat(image.width===page.width&&image.height===page.height&&image.width<=8192&&image.height<=8192,'texture','Invalid page dimensions');
      options.signal?.throwIfAborted();page.setTexture(line==='4.3'?new sdk.GLTexture(context,image,true):new sdk.GLTexture(context,image));}
    let input=source.isBinary?source.skeletonBytes:source.root;
    if(family!=='4.2'&&family!=='4.3')input=normalizeJson(source.isBinary?decodeBinary(input).json:structuredClone(input));
    const loader=new sdk.AtlasAttachmentLoader(atlas),reader=source.isBinary&&['4.2','4.3'].includes(family)?new sdk.SkeletonBinary(loader):new sdk.SkeletonJson(loader);
    const data=reader.readSkeletonData(input);return new OfficialPlayer({canvas,source,sdk,line,context,scene,atlas,images,data});
  }catch(e){scene?.dispose();atlas?.dispose();context?.dispose();images.forEach(i=>i.close());throw e;}
}
export class OfficialPlayer {
  constructor(o){Object.assign(this,o);this.disposed=false;this.time=0;this.skin='default';this.commands=[];this.hasPhysics=(this.data.physicsConstraints?.length??0)>0||(this.data.constraints??[]).some(c=>c instanceof this.sdk.PhysicsConstraintData);this._reset();}
  _check(){requireThat(!this.disposed,'player','Player is disposed');}
  _reset(){const s=this.skeleton=new this.sdk.Skeleton(this.data);if(this.data.findSkin(this.skin))s.setSkin(this.data.findSkin(this.skin));this.stateData=new this.sdk.AnimationStateData(this.data);this.state=new this.sdk.AnimationState(this.stateData);this.time=0;this._frame=0;this._cursor=0;this._applied=0;
    this.events=[];this.state.addListener({event:(entry,event)=>{if(this._emit)this.events.push({name:event.data.name,time:event.time,track:entry.trackIndex,event});}});
    this._applyCommands(0);this.state.apply(s);s.updateWorldTransform(this.sdk.Physics.reset);}
  _apply(c){if(c.type==='clear'){this.state.clearTrack(c.index);return;}const entry=this.state.setAnimation(c.index,c.name,c.loop);entry.alpha=c.alpha??1;entry.mixDuration=c.mix??0;if(c.additive){if(this.sdk.MixBlend)entry.mixBlend=this.sdk.MixBlend.add;else entry.additive=true;}}
  _applyCommands(at){while(this._applied<this.commands.length&&this.commands[this._applied].at<=at)this._apply(this.commands[this._applied++]);}
  _pose(at,physics){this.state.update(at-this._cursor);this._cursor=at;this._applyCommands(at);this.state.apply(this.skeleton);this.skeleton.time=at;this.skeleton.updateWorldTransform(physics);}
  _record(command){this.commands=this.commands.filter(c=>c.at<=this.time);this.commands.push(command);this._applyCommands(this.time);}
  _advance(target,emit){this._check();requireThat(Number.isFinite(target)&&target>=0,'time','Expected nonnegative seconds');requireThat(!this.hasPhysics||target<=600,'time','Physics replay exceeds 600 seconds');this.events=[];this._emit=emit;
    const commandBoundaries=until=>{while(this._applied<this.commands.length&&this.commands[this._applied].at<until){const at=this.commands[this._applied].at;this._pose(at,this.sdk.Physics.pose);}};
    while(this.hasPhysics&&(this._frame+1)/60<=target){const at=(this._frame+1)/60;commandBoundaries(at);this._pose(at,this.sdk.Physics.update);this._frame++;}
    commandBoundaries(target);
    if(this._cursor<target)this._pose(target,this.sdk.Physics.pose);else if(this._cursor===target){this._applyCommands(target);this.state.apply(this.skeleton);this.skeleton.updateWorldTransform(this.sdk.Physics.pose);}this.time=target;this._emit=false;return this.events;}
  setAnimation(name,loop=true){this._check();requireThat(this.data.findAnimation(name),'animation',`Unknown animation: ${name}`);this.commands=[{at:0,type:'animation',index:0,name,loop}];this._reset();return this;}
  mixTo(name,duration,loop=true){this._check();requireThat(this.data.findAnimation(name),'animation',`Unknown animation: ${name}`);requireThat(Number.isFinite(duration)&&duration>=0,'mixDuration','Invalid duration');this._record({at:this.time,type:'animation',index:0,name,loop,mix:duration});return this;}
  setTrack(index,name,{alpha=1,additive=false,loop=true}={}){this._check();requireThat(Number.isInteger(index)&&index>0&&index<=64&&Number.isFinite(alpha)&&alpha>=0&&alpha<=1,'track','Invalid track');requireThat(this.data.findAnimation(name),'animation',`Unknown animation: ${name}`);this._record({at:this.time,type:'animation',index,name,loop,alpha,additive});return this;}
  clearTrack(index){this._check();requireThat(Number.isInteger(index)&&index>=0&&index<=64,'track','Invalid track');this._record({at:this.time,type:'clear',index});return this;}
  setSkin(name){this._check();requireThat(this.data.findSkin(name),'skin',`Unknown skin: ${name}`);const time=this.time;this.skin=name;this._reset();this._advance(time,false);return this;}
  seek(seconds){this._check();requireThat(Number.isFinite(seconds)&&seconds>=0&&(!this.hasPhysics||seconds<=600),'time','Invalid seconds or physics replay horizon');this._reset();this._advance(seconds,false);return this;}
  update(delta){this._check();requireThat(Number.isFinite(delta)&&delta>=0,'delta','Invalid delta');return this._advance(this.time+delta,true);}
  bounds(){const b=this.skeleton.getBoundsRect();return Number.isFinite(b.x)&&Number.isFinite(b.y)&&b.width>0&&b.height>0?b:{x:-.5,y:-.5,width:1,height:1};}
  render({camera=this.bounds(),padding=1.15,background=[0,0,0,0]}={}){this._check();const gl=this.context.gl;requireThat(!gl.isContextLost(),'webgl','Context lost; reload this player','CONTEXT_LOST');const w=this.canvas.width,h=this.canvas.height;requireThat(w>0&&h>0&&camera.width>0&&camera.height>0&&padding>0,'render','Invalid canvas/camera');
    const scale=Math.min(w/camera.width,h/camera.height)/padding,c=this.scene.camera;c.position.x=camera.x+camera.width/2;c.position.y=camera.y+camera.height/2;c.setViewport(w/scale,h/scale);gl.viewport(0,0,w,h);gl.clearColor(...background);gl.clear(gl.COLOR_BUFFER_BIT);this.scene.begin();try{this.scene.drawSkeleton(this.skeleton);}finally{this.scene.end();}return this;}
  capture(){this._check();return this.canvas.toDataURL('image/png');}
  dispose(){if(this.disposed)return;this.disposed=true;this.state.clearListeners();this.state.clearTracks();this.scene.dispose();this.atlas.dispose();this.context.gl.useProgram(null);this.context.dispose();this.images.forEach(i=>i.close());this.images.length=0;}
}
