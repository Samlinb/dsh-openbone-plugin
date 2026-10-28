// OpenBone PhysicsSolver's fixed 60 Hz replay contract, independent of render cadence.
import {requireThat} from './core.js';
const zero=()=>({initialized:false,ux:0,uy:0,cx:0,cy:0,tx:0,ty:0,xo:0,xv:0,yo:0,yv:0,ro:0,rv:0,so:0,sv:0,steps:0,last:0,pending:0});
const clamp=(v,l)=>Math.max(-l,Math.min(l,v));
const turn=a=>{let v=a%(2*Math.PI);if(v>Math.PI)v-=2*Math.PI;if(v<=-Math.PI)v+=2*Math.PI;return v;};
export function physicsStep(p,input,length,previous=zero(),mode,tick) {
  if(p.mix===0)return {matrix:input,state:previous};
  const state=mode==='reset'?zero():previous;
  let {ux,uy,cx,cy,tx,ty,xo,xv,yo,yv,ro,rv,so,sv,steps,last,pending}=state;
  let [a,b,c,d,wx,wy]=input;
  const x=p.x>0,y=p.y>0,angular=p.rotate>0||p.shearX>0,scale=p.scaleX>0,mix=p.mix,dt=1/60;
  if(mode!=='pose'){
    const delta=mode==='reset'?0:tick-last;requireThat(delta>=0&&tick<=36000,'physics','Invalid replay tick');pending+=delta;last=tick;
    if(!state.initialized){ux=wx;uy=wy;}else{
      const bound=p.limit*delta*dt,m=dt/p.mass,damping=p.damping,count=pending;
      if(x){xo+=clamp((ux-wx)*p.inertia,bound);ux=wx;}if(y){yo+=clamp((uy-wy)*p.inertia,bound);uy=wy;}
      if(x||y){for(let n=0;n<count;n++){if(x){xv+=(p.wind*100-xo*p.strength)*m;xo+=xv*dt;xv*=damping;}if(y){yv-=(p.gravity*100+yo*p.strength)*m;yo+=yv*dt;yv*=damping;}}if(x)wx+=xo*mix*p.x;if(y)wy+=yo*mix*p.y;}
      if(angular||scale){const ca=Math.atan2(c,a),dx=clamp(cx-wx,bound),dy=clamp(cy-wy,bound),mr=(p.rotate+p.shearX)*mix;
        if(angular)ro+=turn(Math.atan2(dy+ty,dx+tx)-ca-ro*mr)*p.inertia;
        let direction=ca+(angular?ro*mr:0),co=Math.cos(direction),si=Math.sin(direction);const reach=length*Math.hypot(a,c);
        if(scale&&reach>=1e-6)so+=(dx*co+dy*si)*p.inertia/reach;
        for(let n=0;n<count;n++){if(scale){sv+=(p.wind*co-p.gravity*si-so*p.strength)*m;so+=sv*dt;sv*=damping;}
          if(angular){rv-=((p.wind*si+p.gravity*co)*(length/100)+ro*p.strength)*m;ro+=rv*dt;rv*=damping;if(n+1<count){direction=ca+ro*mr;co=Math.cos(direction);si=Math.sin(direction);}}}}
      if(x||y||angular||scale){pending=0;steps+=count;}
    }cx=wx;cy=wy;
  }else{if(x)wx+=xo*mix*p.x;if(y)wy+=yo*mix*p.y;}
  if(angular){const offset=ro*mix;let rotation=offset*p.rotate;const shear=offset*p.shearX;
    if(p.shearX>0){if(p.rotate>0){const co=Math.cos(rotation),si=Math.sin(rotation),nb=co*b-si*d;d=si*b+co*d;b=nb;}rotation+=shear;}
    else{const co=Math.cos(rotation),si=Math.sin(rotation),nb=co*b-si*d;d=si*b+co*d;b=nb;}
    const co=Math.cos(rotation),si=Math.sin(rotation),na=co*a-si*c;c=si*a+co*c;a=na;}
  if(scale){const factor=1+so*mix*p.scaleX;a*=factor;c*=factor;}
  const result=[a,b,c,d,wx,wy];
  const next=mode==='pose'?state:{initialized:true,ux,uy,cx,cy,tx:length*a,ty:length*c,xo,xv,yo,yv,ro,rv,so,sv,steps,last,pending};
  requireThat(result.every(Number.isFinite)&&Object.values(next).every(v=>typeof v!=='number'||Number.isFinite(v)),'physics','Nonfinite integration result');
  return {matrix:result,state:next};
}
