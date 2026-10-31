import {PNG} from 'pngjs';
import {requireThat} from './errors.js';

export function polygon(value,width,height){
 requireThat(Array.isArray(value)&&value.length>=3&&value.length<=256&&value.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=width&&p[1]>=0&&p[1]<=height),'INVALID_MASK','Use 3–256 [x,y] points in original image pixels.');
 let area=0;for(let i=0,j=value.length-1;i<value.length;j=i++)area+=value[j][0]*value[i][1]-value[i][0]*value[j][1];
 requireThat(Math.abs(area)>2,'INVALID_MASK','Mask must have nonzero area.');return value;
}
export function inside(points,x,y){let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
export function coverage(points,x,y){let n=0;for(const dx of [.25,.75])for(const dy of [.25,.75])if(inside(points,x+dx,y+dy))n++;return n/4;}
export function cutMask(source,points,pivot){
 polygon(points,source.width,source.height);requireThat(Array.isArray(pivot)&&pivot.length===2&&pivot.every(Number.isFinite)&&pivot[0]>=0&&pivot[0]<=source.width&&pivot[1]>=0&&pivot[1]<=source.height,'INVALID_MASK','Joint must be [x,y] in source pixels.');
 const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))-4),top=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))-4);
 const width=Math.min(source.width,Math.ceil(Math.max(...points.map(p=>p[0])))+4)-left,height=Math.min(source.height,Math.ceil(Math.max(...points.map(p=>p[1])))+4)-top;
 const out=new PNG({width:Math.max(16,width),height:Math.max(16,height)});let count=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=coverage(points,x+left,y+top),si=((y+top)*source.width+x+left)*4,i=(y*out.width+x)*4;source.data.copy(out.data,i,si,si+4);out.data[i+3]=Math.round(source.data[si+3]*a);if(out.data[i+3])count++;}
 requireThat(count>8,'INVALID_MASK','Mask contains no useful pixels.');
 // Only flood near-white background when all four SOURCE corners establish it.
 // Closed outlines and warm white fur remain barriers; arbitrary photos use the contour unchanged.
 const white=i=>source.data[i]>=250&&source.data[i+1]>=250&&source.data[i+2]>=250&&source.data[i+3]>250;
 let ink=0;for(let i=0;i<out.data.length;i+=4)if(out.data[i+3]>0&&(out.data[i]<245||out.data[i+1]<245||out.data[i+2]<245))ink++;
 if(ink>8&&[0,(source.width-1)*4,(source.height-1)*source.width*4,(source.width*source.height-1)*4].every(white)){
  const seen=new Uint8Array(out.width*out.height),queue=new Int32Array(seen.length);let head=0,tail=0;
  const visit=k=>{if(seen[k])return;const i=k*4;if(out.data[i+3]!==0&&!(out.data[i]>=250&&out.data[i+1]>=250&&out.data[i+2]>=250))return;seen[k]=1;queue[tail++]=k;};
  for(let x=0;x<out.width;x++){visit(x);visit((out.height-1)*out.width+x);}for(let y=0;y<out.height;y++){visit(y*out.width);visit(y*out.width+out.width-1);}
  while(head<tail){const k=queue[head++],x=k%out.width,y=Math.floor(k/out.width);out.data[k*4+3]=0;if(x)visit(k-1);if(x+1<out.width)visit(k+1);if(y)visit(k-out.width);if(y+1<out.height)visit(k+out.width);}
 }
 return {png:out,geometry:{origin:[left,top],joint:pivot,sourceSize:[source.width,source.height],polygon:points},pivot:[(pivot[0]-left)/out.width,(pivot[1]-top)/out.height]};
}
/** Provider pixels can change ONLY inside the explicit repair mask. */
export function compositeRepair(original,generated,points){
 polygon(points,original.width,original.height);const out=new PNG({width:original.width,height:original.height});original.data.copy(out.data);
 for(let y=0;y<out.height;y++)for(let x=0;x<out.width;x++){const a=coverage(points,x,y);if(!a)continue;const i=(y*out.width+x)*4,j=(Math.min(generated.height-1,Math.floor((y+.5)*generated.height/out.height))*generated.width+Math.min(generated.width-1,Math.floor((x+.5)*generated.width/out.width)))*4;
  const green=generated.data[j+1]>100&&generated.data[j+1]>generated.data[j]*1.35&&generated.data[j+1]>generated.data[j+2]*1.35;
  for(let c=0;c<4;c++)out.data[i+c]=Math.round(original.data[i+c]*(1-a)+(c===3&&green?0:generated.data[j+c])*a);
 }return out;
}
export function repairGuide(original,points){const guide=new PNG({width:original.width,height:original.height});for(let y=0;y<guide.height;y++)for(let x=0;x<guide.width;x++){const i=(y*guide.width+x)*4,v=inside(points,x+.5,y+.5)?255:0;guide.data.set([v,v,v,255],i);}return PNG.sync.write(guide);}
