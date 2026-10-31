import {createPlayer} from './engines.js';
const $ = id => document.getElementById(id);
const messages = {
  en:{title:'OpenBone preview',play:'Play',pause:'Pause',fit:'Fit',capture:'Capture',loop:'Loop',loading:'Loading…',ready:'WebGL preview loaded',error:'Preview failed',animation:'Animation',skin:'Skin',time:'Time',speed:'Speed',engine:'Runtime'},
  zh:{title:'OpenBone 动画预览',play:'播放',pause:'暂停',fit:'适应画面',capture:'截图',loop:'循环',loading:'加载中…',ready:'WebGL 预览已加载',error:'预览失败',animation:'动画',skin:'皮肤',time:'时间',speed:'速度',engine:'运行时'},
};
const engine=new URL(location.href).searchParams.get('engine')==='official'?'official':'independent';
let language = navigator.language.startsWith('zh') ? 'zh':'en', playing=false, player, frame, camera, duration=0, identity, last, disposed=false, loaded=false, readySent=false;
const t = key => messages[language][key];
function localize() {
  document.documentElement.lang=language; document.title=t('title'); $('title').textContent=t('title');
  for (const key of ['fit','capture']) $(key).textContent=t(key);
  $('loop-label').textContent=t('loop'); $('play').textContent=t(playing?'pause':'play');
  for (const key of ['animation','skin','speed','engine']) $(key).setAttribute('aria-label',t(key)); $('seek').setAttribute('aria-label',t('time'));
  if(loaded)$('status').textContent=`${t('ready')} · ${player.label}`;
}
function fail(error) { playing=false; loaded=false; $('status').textContent=`${t('error')}: ${error.code ?? ''} ${error.message}`; localize(); }
function fitCamera() {
  const time = player.time, poses=[];
  for(let i=0;i<=60;i++) { player.seek(duration*i/60); poses.push(player.bounds()); }
  player.seek(time);
  const x=Math.min(...poses.map(b=>b.x)), y=Math.min(...poses.map(b=>b.y));
  camera={x,y,width:Math.max(...poses.map(b=>b.x+b.width))-x,height:Math.max(...poses.map(b=>b.y+b.height))-y};
}
function animate(now) {
  if(disposed)return;
  try {
    if(playing && last!==undefined) player.update(Math.min((now-last)/1000,0.1)*Number($('speed').value));
    last=now;
    const dpr=Math.min(devicePixelRatio,2), rect=$('canvas').getBoundingClientRect();
    const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
    if($('canvas').width!==width || $('canvas').height!==height){$('canvas').width=width;$('canvas').height=height;}
    player.render(camera);
    if(loaded&&!readySent){readySent=true;const message={type:'openbone-preview-ready',revision:identity.sourceRevision};window.parent.postMessage(message,'*');window.opener?.postMessage(message,'*');}
    $('seek').value=String(player.loop && duration>0 ? player.time%duration:Math.min(player.time,duration));
    $('time').textContent=`${Number($('seek').value).toFixed(3)} s`;
    frame=requestAnimationFrame(animate);
  } catch(error){fail(error);}
}
$('language').value=language;$('language').onchange=()=>{language=$('language').value;localize();};localize();
$('engine').value=engine;$('engine').onchange=()=>{const url=new URL(location.href);url.searchParams.set('engine',$('engine').value);location.assign(url);};
try {
  const response=await fetch('./identity.json');if(!response.ok)throw new Error(`HTTP ${response.status}`);identity=await response.json();
  player=await createPlayer(engine,$('canvas'),new URL('./assets/current.json',location.href).href);
  if(player.source.manifestSHA256!==identity.manifestSHA256)throw new Error('Snapshot identity mismatch');
  for(const name of player.animations.keys())$('animation').add(new Option(name,name));
  for(const name of player.skins)$('skin').add(new Option(name,name));
  function selectAnimation(){ const name=$('animation').value;if(name){player.setAnimation(name,$('loop').checked);duration=player.animations.get(name).duration;}else duration=0;$('seek').max=String(duration);fitCamera(); }
  $('animation').onchange=selectAnimation;
  $('skin').onchange=()=>{player.setSkin($('skin').value);fitCamera();};
  if($('skin').value)player.setSkin($('skin').value);selectAnimation();
  $('play').disabled=false;$('play').onclick=()=>{playing=!playing;last=undefined;localize();};
  $('loop').onchange=()=>{player.setLoop($('loop').checked);};
  $('seek').oninput=()=>{player.seek(Number($('seek').value));};
  $('fit').onclick=fitCamera;
  $('capture').onclick=()=>{player.render(camera);$('download').href=player.capture();$('download').hidden=false;};
  loaded=true;localize();
  $('identity').textContent=`${identity.projectId} · revision ${identity.sourceRevision} · SHA-256 ${identity.manifestSHA256}`;
  window.openbonePreview = { get identity(){return {...identity};},capture(){player.render(camera);return {identity:{...identity},engine,animation:player.animation,time:player.time,png:player.capture()};} };
  frame=requestAnimationFrame(animate);
}catch(error){fail(error);player?.dispose();}
window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(frame);player?.dispose();delete window.openbonePreview;},{once:true});
