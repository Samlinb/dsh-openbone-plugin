import {requireThat} from './core.js';
const integers = (text, n, path) => {
  const values = text?.split(',').map(Number);
  requireThat(values?.length === n && values.every(Number.isInteger),path,`Expected ${n} integers`); return values;
};
export class TextureAtlas {
  constructor(text) {
    requireThat(typeof text === 'string','atlas','Expected text');
    this.pages = new Map(); this.regions = new Map();
    let page = null, region = null;
    for (const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) { page = null; region = null; continue; }
      const colon = line.indexOf(':');
      if (colon < 0) {
        if (!page) {
          requireThat(!this.pages.has(line),'atlas','Duplicate page');
          page = {name:line,pma:false,filter:'Nearest,Nearest'}; this.pages.set(line,page); region = null;
        } else {
          requireThat(!this.regions.has(line),'atlas','Duplicate region');
          region = {name:line,page:page.name,degrees:0,offsetX:0,offsetY:0,pma:page.pma}; this.regions.set(line,region);
        }
        continue;
      }
      requireThat(page,'atlas','Property without page');
      const key = line.slice(0,colon).trim(), v = line.slice(colon+1).trim();
      if (!region) {
        requireThat(!page[`seen_${key}`],'atlas',`Duplicate page property: ${key}`); page[`seen_${key}`] = true;
        if (key === 'size') [page.width,page.height] = integers(v,2,'atlas.size');
        else if (key === 'pma') { requireThat(['true','false'].includes(v),'atlas.pma','Expected boolean'); page.pma = v === 'true'; }
        else if (key === 'filter') { requireThat(['Nearest,Nearest','Linear,Linear'].includes(v.replaceAll(' ','')),'atlas.filter','Unsupported filter'); page.filter = v.replaceAll(' ',''); }
        else if (key === 'format') requireThat(v === 'RGBA8888','atlas.format','Expected RGBA8888');
        else if (key === 'repeat') requireThat(v === 'none','atlas.repeat','Repeating pages are unsupported');
        else if (key === 'scale') requireThat(Number(v) > 0 && Number.isFinite(Number(v)),'atlas.scale','Invalid scale');
        else requireThat(false,`atlas.${key}`,'Unsupported atlas property','UNSUPPORTED_FEATURE');
      } else {
        requireThat(!region[`seen_${key}`],'atlas',`Duplicate region property: ${key}`); region[`seen_${key}`] = true;
        if (key === 'rotate') { region.degrees = v === 'true' ? 90 : v === 'false' ? 0 : Number(v); requireThat([0,90,180,270].includes(region.degrees),'atlas.rotate','Expected quarter turn'); }
        else if (key === 'xy') [region.x,region.y] = integers(v,2,'atlas.xy');
        else if (key === 'size') [region.width,region.height] = integers(v,2,'atlas.size');
        else if (key === 'bounds') [region.x,region.y,region.width,region.height] = integers(v,4,'atlas.bounds');
        else if (key === 'orig') [region.originalWidth,region.originalHeight] = integers(v,2,'atlas.orig');
        else if (key === 'offset') [region.offsetX,region.offsetY] = integers(v,2,'atlas.offset');
        else if (key === 'offsets') [region.offsetX,region.offsetY,region.originalWidth,region.originalHeight] = integers(v,4,'atlas.offsets');
        else if (key === 'index') requireThat(v === '-1','atlas.index','Sequence regions are unsupported','UNSUPPORTED_FEATURE');
        else requireThat(false,`atlas.${key}`,'Unsupported atlas property','UNSUPPORTED_FEATURE');
      }
    }
    requireThat(this.pages.size > 0,'atlas','No texture pages');
    for (const p of this.pages.values()) requireThat(Number.isInteger(p.width) && p.width > 0 && p.width <= 8192 && Number.isInteger(p.height) && p.height > 0 && p.height <= 8192,'atlas.size','Page dimensions must be 1..8192');
    for (const r of this.regions.values()) {
      const p = this.pages.get(r.page); r.pma = p.pma;
      r.originalWidth ??= r.width; r.originalHeight ??= r.height;
      const rotated = r.degrees === 90 || r.degrees === 270;
      requireThat([r.x,r.y,r.width,r.height,r.originalWidth,r.originalHeight,r.offsetX,r.offsetY].every(Number.isInteger) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.offsetX >= 0 && r.offsetY >= 0 && r.offsetX+r.width <= r.originalWidth && r.offsetY+r.height <= r.originalHeight && r.x+(rotated?r.height:r.width) <= p.width && r.y+(rotated?r.width:r.height) <= p.height,'atlas.region','Invalid region bounds');
    }
  }
  uv(r,u,v,packed = false) {
    const p = this.pages.get(r.page);
    const x = packed ? u*r.width : u*r.originalWidth-r.offsetX;
    const y = packed ? v*r.height : v*r.originalHeight-(r.originalHeight-r.offsetY-r.height);
    switch (r.degrees) {
      case 90: return [(r.x+y)/p.width,(r.y+r.width-x)/p.height];
      case 180: return [(r.x+r.width-x)/p.width,(r.y+r.height-y)/p.height];
      case 270: return [(r.x+r.height-y)/p.width,(r.y+x)/p.height];
      default: return [(r.x+x)/p.width,(r.y+y)/p.height];
    }
  }
}
