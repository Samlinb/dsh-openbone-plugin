// Independent OpenBone double-precision solvers. See core/math in the Java model.
import {matrix, multiply, point, requireThat} from './core.js';
import {physicsStep} from './physics.js';
const rad = Math.PI/180, deg = 180/Math.PI;
const identity = [1,0,0,1,0,0];
const det = m => m[0]*m[3]-m[1]*m[2];
const wrap = a => a > Math.PI ? a-2*Math.PI : a < -Math.PI ? a+2*Math.PI : a;
const delta = (a,b) => {const d=a-b; return d>180?d-360:d< -180?d+360:d;};
export function inherit(mode, p, t, m = matrix(t)) {
  if (!mode || mode === 'normal') return multiply(p,m);
  const origin = point(p,t.x,t.y); let linear;
  if (mode === 'onlyTranslation') linear=m;
  else if (mode === 'noRotationOrReflection') {
    const length=Math.hypot(p[0],p[2]);
    if (length*length>.0001) {
      const ux=p[0]/length,uy=p[2]/length,other=Math.abs(det(p))/length,cross=(length-other)*ux*uy;
      linear=multiply([length*ux*ux+other*uy*uy,cross,cross,length*uy*uy+other*ux*ux,0,0],m);
    } else {
      const a=-Math.atan2(p[1],p[3]),c=Math.cos(a),s=Math.sin(a);
      linear=multiply(multiply([0,p[1],0,p[3],0,0],[c,-s,s,c,0,0]),m);
    }
  } else {
    const a=(t.rotation%360)*rad,c=Math.cos(a),s=Math.sin(a);
    let x=p[0]*c+p[1]*s,y=p[2]*c+p[3]*s;
    const length=Math.hypot(x,y),factor=length>.00001?1/length:length;
    x*=factor;y*=factor;
    const sign=mode==='noScale'&&det(p)<0?-1:1;
    linear=multiply(multiply([x,-y*sign,y,x*sign,0,0],[c,s,-s,c,0,0]),m);
  }
  return [...linear.slice(0,4),...origin];
}
function single(b,local,world,c) {
  const t=local[b],p=c.data.bones[b].parent<0?identity:world[c.data.bones[b].parent],target=world[c.targetIndex];
  const determinant=det(p);let dx=0,dy=0;
  if (Math.abs(determinant)>.0001) {
    const x=target[4]-p[4],y=target[5]-p[5];dx=(x*p[3]-y*p[1])/determinant-t.x;dy=(y*p[0]-x*p[2])/determinant-t.y;
  }
  const aim=Math.atan2(dy,dx)*deg+(t.scaleX<0?180:0);let sx=t.scaleX,sy=t.scaleY;
  const reach=(c.data.bones[b].length??0)*sx,distance=Math.hypot(dx,dy);
  if ((c.compress||c.stretch)&&reach>.0001&&(c.compress&&distance<reach||c.stretch&&distance>reach)) {
    const f=(distance/reach-1)*c.mix+1;sx*=f;if(c.uniform)sy*=f;
  }
  local[b]={x:t.x,y:t.y,rotation:t.rotation+delta(aim,t.rotation)*c.mix,scaleX:sx,scaleY:sy,shearX:0,shearY:0};
}
function ellipse(length,ax,ay,tx,ty,bend) {
  const radius2=tx*tx+ty*ty,aa=ax*ax,bb=ay*ay,q2=bb-aa,q1=-2*bb*length,q0=bb*length*length+aa*radius2-aa*bb;
  const discriminant=q1*q1-4*q2*q0,direction=Math.atan2(ty,tx);
  if(discriminant>=0&&q2!==0) {
    const q=-.5*(q1+(q1<0?-1:1)*Math.sqrt(discriminant));let rx=q/q2;
    if(q!==0&&Math.abs(q0/q)<Math.abs(rx))rx=q0/q;
    const y2=radius2-rx*rx;
    if(y2>=0){const y=Math.sqrt(y2)*bend;return [direction-Math.atan2(y,rx),Math.atan2(y/ay,(rx-length)/ax)];}
  }
  let minAngle=Math.PI,minX=length-ax,minY=0,minR=minX*minX,maxAngle=0,maxX=length+ax,maxY=0,maxR=maxX*maxX;
  const extremum=-ax*length/(aa-bb);
  if(extremum>=-1&&extremum<=1){const theta=Math.acos(extremum),x=length+ax*Math.cos(theta),y=ay*Math.sin(theta),r=x*x+y*y;
    if(r<minR){minR=r;minAngle=theta;minX=x;minY=y;}if(r>maxR){maxR=r;maxAngle=theta;maxX=x;maxY=y;}}
  return radius2<=(minR+maxR)/2?[direction-Math.atan2(minY*bend,minX),minAngle*bend]:[direction-Math.atan2(maxY*bend,maxX),maxAngle*bend];
}
function two(c,local,world) {
  const [bi,ci]=c.boneIndices,p=local[bi],child=local[ci],parent=c.data.bones[bi];
  const psx=Math.abs(p.scaleX),psy=Math.abs(p.scaleY),csx=Math.abs(child.scaleX),orientation=(p.scaleX<0?-1:1)*(p.scaleY<0?-1:1),bend=c.bendPositive?1:-1;
  const uniform=Math.abs(psx-psy)<=.0001,cy=!uniform||c.stretch?0:child.y,up=parent.parent<0?identity:world[parent.parent],target=world[c.targetIndex],d=det(up);
  let tx=-p.x,ty=-p.y;
  if(Math.abs(d)>.0001){const x=target[4]-up[4],y=target[5]-up[5];tx=(x*up[3]-y*up[1])/d-p.x;ty=(y*up[0]-x*up[2])/d-p.y;}
  const length=Math.abs(d)<=.0001?Math.hypot(p.x,p.y):Math.hypot(psx*child.x,psy*cy),second=(c.data.bones[ci].length??0)*csx;
  if(length<.0001||second<1e-12||psx<1e-12||psy<1e-12){single(bi,local,world,{...c,compress:false,softness:0,uniform:false});local[ci]={...child,y:cy,rotation:0};return;}
  let radius=Math.hypot(tx,ty);
  if(c.softness!==0){const soft=c.softness*psx*(csx+1)/2,over=radius-length-second*psx+soft;
    if(soft>0&&over>0&&radius>=1e-12){const u=over>=2*soft?0:over/(2*soft)-1,f=(over-soft*(1-u*u))/radius;tx-=f*tx;ty-=f*ty;radius=Math.hypot(tx,ty);}}
  let sx=p.scaleX,sy=p.scaleY,angles;
  if(uniform){const reach=second*psx;let cos=(radius*radius-length*length-reach*reach)/(2*length*reach),theta;
    if(cos< -1){cos=-1;theta=Math.PI*bend;}else if(cos>1){cos=1;theta=0;if(c.stretch){const f=1+(radius/(length+reach)-1)*c.mix;sx*=f;if(c.uniform)sy*=f;}}else theta=Math.acos(cos)*bend;
    const x=length+reach*cos,y=reach*Math.sin(theta);angles=[Math.atan2(ty*x-tx*y,tx*x+ty*y),theta];
  }else angles=ellipse(length,psx*second,psy*second,tx,ty,bend);
  const offset=Math.atan2(cy,child.x)*orientation,pa=(angles[0]-offset)*deg+(p.scaleX<0?180:0),ca=(angles[1]+offset)*deg*orientation+(child.scaleX<0?180:0);
  local[bi]={...p,rotation:p.rotation+delta(pa,p.rotation)*c.mix,scaleX:sx,scaleY:sy};
  local[ci]={...child,y:cy,rotation:child.rotation+delta(ca,child.rotation)*c.mix};
}
function transformConstraint(c,local,world,shear,locked) {
  const mixes=['mixRotate','mixX','mixY','mixScaleX','mixScaleY','mixShearY'].map(k=>c[k]);
  const offsets=['rotation','x','y','scaleX','scaleY','shearY'].map(k=>c[k]);
  if(c.local){const target=local[c.targetIndex],to=[target.rotation,target.x,target.y,target.scaleX,target.scaleY,shear[c.targetIndex]];
    for(const id of c.boneIndices){const p=local[id],from=[p.rotation,p.x,p.y,p.scaleX,p.scaleY,shear[id]],out=[...from];
      for(let n=0;n<6;n++){const mix=mixes[n],off=offsets[n];if(mix===0)continue;
        out[n]=n===3||n===4?(c.relative?from[n]*(1+(to[n]-1+off)*mix):Math.abs(from[n])<1e-12?0:(from[n]+(to[n]-from[n]+off)*mix)/from[n]):from[n]+(to[n]-(c.relative?0:from[n])+off)*mix;}
      local[id]={...p,rotation:out[0],x:out[1],y:out[2],scaleX:out[3],scaleY:out[4],shearY:out[5]};shear[id]=out[5];}return;}
  const target=world[c.targetIndex],reflect=det(target)>0?1:-1,ta=Math.atan2(target[2],target[0]),ty=Math.atan2(target[3],target[1]),pos=point(target,c.x,c.y);
  for(const id of c.boneIndices){let [a,b,cc,d,x,y]=world[id];
    if(c.mixRotate!==0){const r=wrap(ta-(c.relative?0:Math.atan2(cc,a))+c.rotation*rad*reflect)*c.mixRotate,co=Math.cos(r),si=Math.sin(r),na=co*a-si*cc,nb=co*b-si*d;cc=si*a+co*cc;d=si*b+co*d;a=na;b=nb;}
    x+=(pos[0]-(c.relative?0:x))*c.mixX;y+=(pos[1]-(c.relative?0:y))*c.mixY;
    if(c.mixScaleX!==0){const len=Math.hypot(a,cc),tl=Math.hypot(target[0],target[2]),f=c.relative?1+(tl-1+c.scaleX)*c.mixScaleX:len<1e-12?0:(len+(tl-len+c.scaleX)*c.mixScaleX)/len;a*=f;cc*=f;}
    if(c.mixScaleY!==0){const len=Math.hypot(b,d),tl=Math.hypot(target[1],target[3]),f=c.relative?1+(tl-1+c.scaleY)*c.mixScaleY:len<1e-12?0:(len+(tl-len+c.scaleY)*c.mixScaleY)/len;b*=f;d*=f;}
    if(c.mixShearY>0){const by=Math.atan2(d,b),angle=c.relative?by+(wrap(ty-ta)-Math.PI/2+c.shearY*rad*reflect)*c.mixShearY:by+(wrap(ty-ta-(by-Math.atan2(cc,a)))+c.shearY*rad*reflect)*c.mixShearY,len=Math.hypot(b,d);b=Math.cos(angle)*len;d=Math.sin(angle)*len;}
    locked.set(id,[a,b,cc,d,x,y]);}
}
export function vertexPoints(att,world,slotMatrix,offset=()=>0) {
  const vertices=[];let di=0;
  if(att.weighted)for(const row of att.rows){let x=0,y=0;for(const inf of row){const p=point(world[inf.bi],inf.x+offset(di++),inf.y+offset(di++));x+=p[0]*inf.weight;y+=p[1]*inf.weight;}vertices.push([x,y]);}
  else for(let i=0;i<att.vertices.length;i+=2)vertices.push(point(slotMatrix,att.vertices[i]+offset(i),att.vertices[i+1]+offset(i+1)));
  return vertices;
}
function cubic(p,i,t){i*=3;const u=1-t;return [0,1].map(k=>p[i][k]*u*u*u+3*p[i+1][k]*u*u*t+3*p[i+2][k]*u*t*t+p[i+3][k]*t*t*t);}
function tangent(p,i,t){i*=3;if(t<.001)return Math.atan2(p[i+1][1]-p[i][1],p[i+1][0]-p[i][0]);const u=1-t,q=cubic(p,i/3,t);return Math.atan2(q[1]-(p[i][1]*u*u+2*p[i+1][1]*u*t+p[i+2][1]*t*t),q[0]-(p[i][0]*u*u+2*p[i+1][0]*u*t+p[i+2][0]*t*t));}
function lengths(p,curve,n){const out=[];let last=p[curve*3],sum=0;for(let i=1;i<=n;i++){const next=cubic(p,curve,i/n);sum+=Math.hypot(next[0]-last[0],next[1]-last[1]);out.push(sum);last=next;}return out;}
function pathSampler(path,controls){const p=controls.slice(1,path.closed?undefined:-1);if(path.closed)p.push(controls[0],controls[1]);
  const count=(p.length-1)/3,cumulative=[];let total=0;for(let n=0;n<count;n++){total=path.constantSpeed?total+lengths(p,n,4)[3]:path.lengths[n];cumulative.push(total);}
  return {total,at(distance){if(total===0)return {p:p[0],angle:0};let d=distance;if(path.closed)d=((d%total)+total)%total;
    if(d<0||d>total){const i=d<0?0:p.length-2,start=p[d<0?0:p.length-1],angle=Math.atan2(p[i+1][1]-p[i][1],p[i+1][0]-p[i][0]),off=d<0?d:d-total;return {p:[start[0]+off*Math.cos(angle),start[1]+off*Math.sin(angle)],angle};}
    let curve=0;while(curve<count-1&&d>cumulative[curve])curve++;const prior=curve===0?0:cumulative[curve-1],span=cumulative[curve]-prior;let t=span===0?0:(d-prior)/span;
    if(path.constantSpeed){const seg=lengths(p,curve,10),at=t*seg[9];let i=0;while(i<9&&at>seg[i])i++;const before=i===0?0:seg[i-1],len=seg[i]-before;t=len===0?i*.1:(i+(at-before)/len)*.1;}
    return t<1e-5?{p:p[curve*3],angle:tangent(p,curve,0)}:{p:cubic(p,curve,t),angle:tangent(p,curve,t)};}};
}
function pathConstraint(c,world,locked,slots){if(c.mixRotate===0&&c.mixX===0&&c.mixY===0)return;const slot=slots[c.targetIndex],path=slot.attachment;if(path?.type!=='path')return;
  const target=world[slot.boneIndex],controls=vertexPoints(path,world,target,slot.offset),sampler=pathSampler(path,controls),total=sampler.total;
  const tangents=c.rotateMode==='tangent',scale=c.rotateMode==='chainScale',count=c.boneIndices.length,samples=tangents?count:count+1,spaces=Array(samples).fill(0),boneLengths=Array(count).fill(0);let sum=0;
  for(let n=1;n<samples;n++){const id=c.boneIndices[n-1],m=world[id],setup=c.data.bones[id].length??0,len=Math.hypot(setup*m[0],setup*m[2]);boneLengths[n-1]=len;
    spaces[n]=c.spacingMode==='percent'?c.spacing:c.spacingMode==='proportional'?(setup<1e-5?c.spacing:len):setup<1e-5?c.spacing:((c.spacingMode==='length'?setup:0)+c.spacing)*len/setup;
    if(c.spacingMode==='proportional'&&setup>=1e-5)sum+=len;}
  if(c.spacingMode==='proportional'&&sum>0)for(let n=1;n<samples;n++)spaces[n]*=samples/sum*c.spacing;
  const multiplier=c.spacingMode==='percent'?total:c.spacingMode==='proportional'?total/samples:1,positions=[];let at=c.position*(c.positionMode==='percent'?total:1);
  for(let n=0;n<samples;n++){at+=spaces[n]*multiplier;positions.push(sampler.at(at));}
  let current=positions[0].p;const offset=c.rotation*rad*(det(target)>0?1:-1),tip=c.rotation===0&&c.rotateMode==='chain';
  for(let n=0;n<count;n++){const id=c.boneIndices[n];let [a,b,cc,d,x,y]=world[id];x+=(current[0]-x)*c.mixX;y+=(current[1]-y)*c.mixY;
    let next=n+1<samples?positions[n+1].p:[0,0];const dx=next[0]-current[0],dy=next[1]-current[1];
    if(scale&&boneLengths[n]>=1e-5){const s=1+(Math.hypot(dx,dy)/boneLengths[n]-1)*c.mixRotate;a*=s;cc*=s;}
    if(c.mixRotate>0){const angle=tangents?positions[n].angle:spaces[n+1]<1e-5?positions[n+1].angle:Math.atan2(dy,dx);let r=angle-Math.atan2(cc,a);
      if(tip){const co=Math.cos(r),si=Math.sin(r),len=c.data.bones[id].length??0;next=[next[0]+(len*(co*a-si*cc)-dx)*c.mixRotate,next[1]+(len*(si*a+co*cc)-dy)*c.mixRotate];}else r+=offset;
      r=wrap(r)*c.mixRotate;const co=Math.cos(r),si=Math.sin(r),na=co*a-si*cc,nb=co*b-si*d;cc=si*a+co*cc;d=si*b+co*d;a=na;b=nb;}
    locked.set(id,[a,b,cc,d,x,y]);current=next;}
}
export function solve(data,locals,constraints,slots,physics={mode:'none',states:new Map(),tick:0}) {
  const local=locals.map(t=>({...t})),world=[],shear=local.map(t=>t.shearY),locked=new Map();
  const rebuild=()=>data.bones.forEach((b,i)=>{if(locked.has(i)){world[i]=locked.get(i);return;}const t=local[i],m=matrix(t);if(shear[i]!==t.shearY){const a=((t.rotation%360+90+shear[i]%360)%360)*rad;m[1]=Math.cos(a)*t.scaleY;m[3]=Math.sin(a)*t.scaleY;}world[i]=b.parent<0?m:inherit(b.inherit,world[b.parent],t,m);});
  rebuild();
  for(const source of constraints){const c={...source,data};if(!c.active)continue;
    if(c.kind==='ik'){if(c.mix===0)continue;if(c.boneIndices.length===1)single(c.boneIndices[0],local,world,c);else {two(c,local,world);shear[c.boneIndices[0]]=0;}}
    else if(c.kind==='transform')transformConstraint(c,local,world,shear,locked);
    else if(c.kind==='path')pathConstraint(c,world,locked,slots);
    else if(physics.mode!=='none'){const id=c.boneIndices[0],result=physicsStep(c,world[id],data.bones[id].length??0,physics.states.get(c.name),physics.mode,physics.tick);locked.set(id,result.matrix);physics.states.set(c.name,result.state);}
    rebuild();
  }
  requireThat(world.flat().every(Number.isFinite),'pose','Nonfinite constraint result');return world;
}
