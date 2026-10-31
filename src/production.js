import { fields, requireThat } from './errors.js';

export const productionSchema={type:'object',additionalProperties:false,properties:Object.fromEntries(['motion','projection','joints','layering'].map(key=>[key,{type:'string',minLength:1,maxLength:200}])),required:['motion','projection','joints','layering']};
export function productionBrief(value){
  fields(value,productionSchema.required,productionSchema.required);
  for(const key of productionSchema.required)requireThat(typeof value[key]==='string'&&value[key].trim().length>0&&value[key].length<=200,'INVALID_INPUT',`Production ${key} must describe the final animation requirement (1–200 characters).`);
  return structuredClone(value);
}
export function productionPrompt(value){
  if(!value)return '';
  return ` Final animation: ${value.motion}. Locked projection: ${value.projection}. Joint coverage and pivots: ${value.joints}. Back-to-front occlusion: ${value.layering}. Hidden joint ends must be solid continuous fill without a closing outline, cut ring, shadow or highlight. Keep visible contours crisp and all attachment margins complete.`;
}
