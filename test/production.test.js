import test from 'node:test';
import assert from 'node:assert/strict';
import {productionBrief,productionPrompt} from '../src/production.js';
import {assetBrief} from '../src/assets.js';
test('production contract preserves final motion, contact coverage and occlusion before generation',()=>{
 const production={motion:'hop with deep compression',projection:'front three-quarter, left visible',joints:'hip overlap 30 px, pivot inside torso',layering:'tail, far limbs, torso, head, near limbs'};
 const brief=assetBrief({requestId:'plan',character:'rabbit',style:'cream',parts:[{id:'ear',description:'one ear',pivot:[.5,.9]}],production});
 assert.deepEqual(brief.production,production);
 const prompt=productionPrompt(brief.production);
 for(const value of Object.values(production))assert.ok(prompt.includes(value));
 assert.match(prompt,/without a closing outline/);
 assert.throws(()=>productionBrief({...production,joints:''}));
 assert.throws(()=>productionBrief({...production,referenceUrl:'unvalidated'}));
});
