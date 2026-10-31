import { requireThat } from './errors.js';

export const authoringWorkflow = {
  execution: 'Hosted project. DSH shell files are not project assets. Never inspect source code, host processes, credentials or server paths to create artwork.',
  steps: ['prepare: inspect binding, context, assets, image/capture capability and references', 'step 1: production character with final motion/projection/overlap/layering; generate or import a character reference, show it and wait for user satisfaction; step 2: plan parts, submit original-pixel contours and joints in ONE production split-masks call; assemble once to create/save the rig in original coordinates; use repair-local only for defective areas, prepare handles polling; retain other selections', 'discover editing schemas; build the setup rig with assetId references', 'use time-zero project_capture and production review-static before animation; reviews require current capture identity and selected scene assets', 'author anticipation, takeoff, airborne, contact, compression and recovery; secondary motion follows the body', 'use project_capture to inspect key poses and the loop seam; give the viewer to the user for normal-speed playback and correct visible defects', 'save the finished revision and report remaining limitations; approval belongs to the user'],
  missingReference: 'An empty reference library is allowed. Continue original design with the bundled authoring guide; do not search the host filesystem.',
  failure: 'Explain the exact missing capability and next action. Repeating discovery or guessing paths does not resolve missing assets.',
  unavailableImages: 'When imageGeneration.available is false and no suitable images exist, stop new-character creation and report the operator configuration requirement. Do not call assets_generate to test the flag, do not offer a blank invisible rig as completion, and do not ask the user for server paths.',
};

/** Adapt Java's local-file editing contracts to the hosted asset-ID interface. */
export function authoringSchemas(tools) {
  return tools.map(original => {
    const tool=structuredClone(original);
    tool.description='Inner operation: invoke through openbone_project_call, not as a direct DSH tool. '+tool.description;
    tool.description=tool.description.replace(/All file paths must be absolute and inside its workspaceRoot \(see context\)\./g,'Use generated project assetId values for region images. Server file paths are private.');
    if(tool.name==='openbone_apply_edits') {
      for(const edit of tool.inputSchema.properties.edits.items.oneOf) {
        if(!edit.properties.pngPath)continue;
        delete edit.properties.pngPath;
        edit.properties.assetId={type:'string',description:'Image ID from openbone_assets_list/status. Use the returned dimensions; place the region center relative to the bone pivot. Do not provide pngPath.'};
        if(edit.required)edit.required=edit.required.map(k=>k==='pngPath'?'assetId':k);
      }
      tool.description+=' Region setup positions locate the image center relative to its bone origin; normalized image pivot [px,py] maps to center offset [(0.5-px)*width,(py-0.5)*height] before rotation. Image y points down; skeleton y points up. Inspect joint overlap in the static preview.';
    }
    return tool;
  });
}

export async function resolveAssetEdits(assets,projectId,args) {
  requireThat(Array.isArray(args.edits),'INVALID_INPUT','Expected edits array.');
  const translated=structuredClone(args);
  for(const edit of translated.edits) {
    requireThat(!Object.hasOwn(edit,'pngPath'),'INVALID_INPUT','Use assetId from this project. Server paths are not accepted.');
    if(Object.hasOwn(edit,'assetId')) {
      requireThat(['create_region','edit_region'].includes(edit.op),'INVALID_INPUT','assetId is only valid for region images.');
      const {file}=await assets.resolve(projectId,edit.assetId);delete edit.assetId;edit.pngPath=file;
    } else requireThat(edit.op!=='create_region','ASSET_REQUIRED','Create a region with an assetId returned by this project’s asset tools.');
  }
  return translated;
}

