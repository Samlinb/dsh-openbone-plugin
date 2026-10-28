/** Uniform viewer controls; each implementation retains its original playback/rendering logic. */
export async function createPlayer(engine,canvas,url){
  if(engine==='official'){
    const {loadOfficial,OFFICIAL_RUNTIME_INFO}=await import('./runtime/official/adapter.js');
    const player=await loadOfficial(canvas,url);let animation=null,loop=true;
    return {
      label:`Spine ${OFFICIAL_RUNTIME_INFO.versions[player.line]}`,source:player.source,
      animations:new Map(player.data.animations.map(a=>[a.name,a])),skins:player.data.skins.map(s=>s.name),
      get time(){return player.time;},get animation(){return animation;},get loop(){return loop;},
      setAnimation(name,value){animation=name;loop=value;player.setAnimation(name,value);},
      setLoop(value){loop=value;const time=player.time;if(animation){player.setAnimation(animation,value);player.seek(time);}},
      setSkin:name=>player.setSkin(name),seek:time=>player.seek(time),update:delta=>player.update(delta),
      bounds:()=>player.bounds(),render:camera=>player.render({camera}),capture:()=>player.capture(),dispose:()=>player.dispose(),
    };
  }
  const {load,WebGLRenderer,bounds,RUNTIME_INFO}=await import('./runtime/src/index.js');
  const assets=await load(url);let renderer;
  try{
    renderer=new WebGLRenderer(canvas).setAssets(assets);const skeleton=assets.data.createSkeleton();
    return {
      label:`OpenBone ${RUNTIME_INFO.version}`,source:assets.source,animations:assets.data.animations,skins:[...assets.data.skins.keys()],
      get time(){return skeleton.time;},get animation(){return skeleton.animation;},get loop(){return skeleton.loop;},
      setAnimation:(name,loop)=>skeleton.setAnimation(name,loop),setLoop:value=>{skeleton.loop=value;},setSkin:name=>skeleton.setSkin(name),
      seek:time=>skeleton.seek(time),update:delta=>skeleton.update(delta),bounds:()=>bounds(skeleton.evaluate(assets.atlas)),
      render:camera=>renderer.render(skeleton.evaluate(assets.atlas),{camera}),capture:()=>renderer.capture(),
      dispose(){renderer.dispose();assets.dispose();},
    };
  }catch(error){renderer?.dispose();assets.dispose();throw error;}
}
