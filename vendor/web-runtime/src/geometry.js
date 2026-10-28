import {requireThat} from './core.js';
import {orient,areaSign,intersectionFraction} from './predicates.js';
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
// Ear clipping, accepting either winding and omitting zero-area ears.
export function triangulate(p){const sign=areaSign(p);if(sign===0)return [];
  const remaining=p.map((_,i)=>i).filter((_,i)=>i===0||p[i][0]!==p[i-1][0]||p[i][1]!==p[i-1][1]),out=[];let budget=p.length*p.length;
  if(remaining.length>1&&p[remaining[0]][0]===p[remaining.at(-1)][0]&&p[remaining[0]][1]===p[remaining.at(-1)][1])remaining.pop();
  while(remaining.length>3&&budget-->0){let found=false;
    for(let j=0;j<remaining.length;j++){const a=remaining[(j+remaining.length-1)%remaining.length],b=remaining[j],c=remaining[(j+1)%remaining.length];
      if(orient(p[a],p[b],p[c])*sign<=0)continue;
      if(remaining.some(k=>k!==a&&k!==b&&k!==c&&orient(p[a],p[b],p[k])*sign>=0&&orient(p[b],p[c],p[k])*sign>=0&&orient(p[c],p[a],p[k])*sign>=0))continue;
      out.push(a,b,c);remaining.splice(j,1);found=true;break;}
    if(!found){const j=remaining.findIndex((b,i)=>orient(p[remaining[(i+remaining.length-1)%remaining.length]],p[b],p[remaining[(i+1)%remaining.length]])===0);
      if(j>=0)remaining.splice(j,1);else break;}}
  if(remaining.length===3&&orient(...remaining.map(i=>p[i]))!==0)out.push(...remaining);
  requireThat(remaining.length<=3,'clipping','Cannot triangulate polygon');return out;
}
export function clipGeometry(subject,boundary){const clipTriangles=triangulate(boundary),vertices=[],uvs=[],triangles=[];
  for(let i=0;i<subject.triangles.length;i+=3)for(let j=0;j<clipTriangles.length;j+=3){const clip=clipTriangles.slice(j,j+3).map(k=>boundary[k]),sign=orient(...clip);if(sign===0)continue;
    let polygon=subject.triangles.slice(i,i+3).map(k=>({p:subject.vertices[k],uv:subject.uvs[k]}));
    for(let edge=0;edge<3&&polygon.length;edge++){const start=clip[edge],end=clip[(edge+1)%3],out=[];let previous=polygon.at(-1),inside=orient(start,end,previous.p)*sign>=0;
      for(const current of polygon){const ci=orient(start,end,current.p)*sign>=0;
        if(ci!==inside){const t=intersectionFraction(previous.p,current.p,start,end),lerp=(a,b)=>(1-t)*a+t*b;
          out.push({p:[start[0]===end[0]?start[0]:lerp(previous.p[0],current.p[0]),start[1]===end[1]?start[1]:lerp(previous.p[1],current.p[1])],uv:[lerp(previous.uv[0],current.uv[0]),lerp(previous.uv[1],current.uv[1])]});}
        if(ci)out.push(current);previous=current;inside=ci;}polygon=out;}
    if(polygon.length<3)continue;const base=vertices.length;for(const v of polygon){vertices.push(v.p);uvs.push(v.uv);}for(let k=1;k+1<polygon.length;k++)if(orient(polygon[0].p,polygon[k].p,polygon[k+1].p)!==0)triangles.push(base,base+k,base+k+1);
  }return {...subject,vertices,uvs,triangles};
}
