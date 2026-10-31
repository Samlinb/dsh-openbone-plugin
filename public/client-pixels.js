// Pure browser/Node pixel operations. This module never performs network requests.
const ensure=(ok,message)=>{if(!ok)throw new Error(message);};
export function validateContour(points,width,height){
 ensure(Array.isArray(points)&&points.length>=3&&points.length<=256&&points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=width&&p[1]>=0&&p[1]<=height),'Mark 3–256 contour points inside the source image.');
 let area=0;for(let i=0,j=points.length-1;i<points.length;j=i++)area+=points[j][0]*points[i][1]-points[i][0]*points[j][1];
 ensure(Math.abs(area)>2,'The contour must enclose an area.');
}
function inside(points,x,y){let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
export function inspectPixels({width,height,data}){
 ensure(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=4096&&height<=4096&&data.length===width*height*4,'Use an image up to 4096 × 4096.');
 let visible=0,transparent=0,left=width,top=height,right=-1,bottom=-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=data[(y*width+x)*4+3];if(a===0)transparent++;if(a>8){visible++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}}
 return {width,height,visiblePixels:visible,transparentPixels:transparent,bounds:visible?{left,top,right,bottom}:null,issues:visible?[]:['empty_image'],visualApproval:false};
}
export function cutPixels(source,points,joint){
 inspectPixels(source);validateContour(points,source.width,source.height);
 ensure(Array.isArray(joint)&&joint.length===2&&joint.every(Number.isFinite)&&joint[0]>=0&&joint[0]<=source.width&&joint[1]>=0&&joint[1]<=source.height,'Mark a joint inside the source image.');
 const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))-4),top=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))-4);
 const width=Math.min(source.width,Math.ceil(Math.max(...points.map(p=>p[0])))+4)-left,height=Math.min(source.height,Math.ceil(Math.max(...points.map(p=>p[1])))+4)-top;
 const data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let n=0;for(const dx of [.25,.75])for(const dy of [.25,.75])if(inside(points,left+x+dx,top+y+dy))n++;
  const a=((top+y)*source.width+left+x)*4,b=(y*width+x)*4;
  data.set(source.data.subarray(a,a+4),b);data[b+3]=Math.round(source.data[a+3]*n/4);
 }
 const result={width,height,data};ensure(inspectPixels(result).visiblePixels>8,'The selected contour is empty.');
 return {...result,geometry:{origin:[left,top],joint:[...joint],sourceSize:[source.width,source.height],polygon:points.map(p=>[...p])},pivot:[(joint[0]-left)/width,(joint[1]-top)/height]};
}
