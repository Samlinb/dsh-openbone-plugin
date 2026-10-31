import {hash} from './files.js';
import {requireThat} from './errors.js';
const entity=(project,key)=>{const h=hash(project+':mask-rig:'+key);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const transform=(x,y)=>({x,y,rotation:0,scaleX:1,scaleY:1});
export function checkAssemblyProject(project,s,bones){
 const own=new Set([entity(project,'root'),...[...(s.plan?.parts??[]),...(s.history??[])].map(p=>entity(project,'bone:'+(p.id??p.partId)))]);
 requireThat(bones.every(b=>own.has(b.id)),'ASSEMBLY_CONFLICT','This project contains another rig. Use a blank project before processing images.');
}
/** Source image y-down -> skeleton y-up. No guessed scale or independent centering. */
export async function assemblyEdits(assets,project,s,scene){
 const edits=[],bones=scene.bones,slots=scene.slots,attachments=scene.attachments,parts=s.plan.parts,rootId=entity(project,'root');
 const known=new Set(bones.map(b=>b.id));const own=new Set([rootId,...[...parts,...s.history].map(p=>entity(project,'bone:'+(p.id??p.partId)))]);
 checkAssemblyProject(project,s,bones);
 const geometries={};for(const p of parts){const {part}=await assets.resolve(project,s.selected[p.id].assetId);requireThat(part.geometry,'GEOMETRY_REQUIRED',`Part ${p.id} needs a source contour and joint before automatic assembly.`);geometries[p.id]=part;}
 if(!known.has(rootId))edits.push({op:'create_bone',boneId:rootId,name:'OpenBone root',parentId:null,setup:transform(0,0),length:0});
 const done=new Set();function add(p){if(done.has(p.id))return;if(p.parent)add(parts.find(x=>x.id===p.parent));const part=geometries[p.id],g=part.geometry,parent=p.parent?geometries[p.parent].geometry.joint:[g.sourceSize[0]/2,g.sourceSize[1]],boneId=entity(project,'bone:'+p.id),setup=transform(g.joint[0]-parent[0],parent[1]-g.joint[1]);
  edits.push(known.has(boneId)?{op:'edit_bone',boneId,setup}:{op:'create_bone',boneId,name:p.id,parentId:p.parent?entity(project,'bone:'+p.parent):rootId,setup,length:30});
  if(known.has(boneId))edits.push({op:'reparent_bone',boneId,parentId:p.parent?entity(project,'bone:'+p.parent):rootId,policy:'keep_local'});done.add(p.id);
 }parts.forEach(add);
 const order=parts.slice().sort((a,b)=>a.order-b.order),slotIds=[];
 for(const p of order){const part=geometries[p.id],g=part.geometry,boneId=entity(project,'bone:'+p.id),slotId=entity(project,'slot:'+p.id),attachmentId=entity(project,'region:'+p.id);slotIds.push(slotId);
  if(!slots.some(s=>s.id===slotId))edits.push({op:'create_slot',slotId,boneId,name:p.id});
  const region={attachmentId,assetId:s.selected[p.id].assetId,width:part.width,height:part.height,setup:transform(g.origin[0]+part.width/2-g.joint[0],g.joint[1]-g.origin[1]-part.height/2)};
  edits.push(attachments.some(a=>a.id===attachmentId)?{op:'edit_region',...region}:{op:'create_region',...region,slotId,name:p.id,makeActive:true});
 }
 // Preserve old generated slots after replanning, but hide their old images.
 for(const slot of slots)if(!slotIds.includes(slot.id))edits.push({op:'edit_slot',slotId:slot.id,activeAttachmentId:null});
 edits.push({op:'set_slot_order',slotIds:[...slots.filter(s=>!slotIds.includes(s.id)).map(s=>s.id),...slotIds]});return edits;
}
