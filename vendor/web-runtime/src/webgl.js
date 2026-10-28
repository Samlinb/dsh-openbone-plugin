import {requireThat} from './core.js';
const vertexSource = `attribute vec2 a_position; attribute vec2 a_uv;
uniform vec4 u_camera; varying vec2 v_uv;
void main(){gl_Position=vec4((a_position-u_camera.xy)*u_camera.zw,0.0,1.0); v_uv=a_uv;}`;
const fragmentSource = `precision mediump float; varying vec2 v_uv;
uniform sampler2D u_texture; uniform vec4 u_color; uniform vec3 u_dark; uniform float u_pma;
void main(){vec4 t=texture2D(u_texture,v_uv);vec3 rgb=mix(t.rgb*t.a,t.rgb,u_pma);
gl_FragColor=vec4((rgb*u_color.rgb+(vec3(t.a)-rgb)*u_dark)*u_color.a,t.a*u_color.a);}`;
export function bounds(pose) {
  let minX = Infinity,minY = Infinity,maxX = -Infinity,maxY = -Infinity;
  for (const d of pose.draws) for (const [x,y] of d.vertices) { minX=Math.min(minX,x); minY=Math.min(minY,y); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y); }
  return minX === Infinity ? {x:0,y:0,width:1,height:1} : {x:minX,y:minY,width:Math.max(1e-6,maxX-minX),height:Math.max(1e-6,maxY-minY)};
}
export class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas; this.disposed = false; this.textures = new Map();
    this.gl = canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:true,preserveDrawingBuffer:true});
    requireThat(this.gl,'webgl','WebGL is unavailable','WEBGL_UNAVAILABLE'); const gl = this.gl;
    const compile = (type,source) => {
      const shader = gl.createShader(type); gl.shaderSource(shader,source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(error); } return shader;
    };
    const vs = compile(gl.VERTEX_SHADER,vertexSource), fs = compile(gl.FRAGMENT_SHADER,fragmentSource);
    this.program = gl.createProgram(); gl.attachShader(this.program,vs); gl.attachShader(this.program,fs); gl.linkProgram(this.program); gl.deleteShader(vs); gl.deleteShader(fs);
    requireThat(gl.getProgramParameter(this.program,gl.LINK_STATUS),'webgl',gl.getProgramInfoLog(this.program));
    this.buffer = gl.createBuffer(); this.position = gl.getAttribLocation(this.program,'a_position'); this.uv = gl.getAttribLocation(this.program,'a_uv');
    this.camera = gl.getUniformLocation(this.program,'u_camera'); this.color = gl.getUniformLocation(this.program,'u_color'); this.sampler = gl.getUniformLocation(this.program,'u_texture');
    this.dark=gl.getUniformLocation(this.program,'u_dark');this.pma=gl.getUniformLocation(this.program,'u_pma');
  }
  setAssets(assets) {
    requireThat(!this.disposed,'renderer','Renderer is disposed'); const gl = this.gl;
    this.clearTextures();
    try {
      for (const [name,page] of assets.atlas.pages) {
        const image = assets.images.get(name); requireThat(image,'texture',`Missing decoded image: ${name}`);
        const texture = gl.createTexture(); this.textures.set(name,texture); gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
        const filter = page.filter.startsWith('Linear') ? gl.LINEAR : gl.NEAREST;
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      }
    } catch (e) { this.clearTextures(); throw e; }
    return this;
  }
  render(pose, {camera = bounds(pose), padding = 1.15, background = [0,0,0,0]} = {}) {
    requireThat(!this.disposed,'renderer','Renderer is disposed'); const gl = this.gl;
    requireThat(!gl.isContextLost(),'webgl','WebGL context was lost; recreate renderer','CONTEXT_LOST');
    requireThat([camera.x,camera.y,camera.width,camera.height,padding,...background].every(Number.isFinite) && camera.width > 0 && camera.height > 0 && padding > 0,'camera','Invalid render options');
    const w = this.canvas.width,h = this.canvas.height; requireThat(w > 0 && h > 0,'canvas','Canvas must have positive dimensions');
    const scale = Math.min(w/camera.width,h/camera.height)/padding;
    gl.viewport(0,0,w,h); gl.clearColor(...background); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(this.program);
    gl.uniform4f(this.camera,camera.x+camera.width/2,camera.y+camera.height/2,2*scale/w,2*scale/h);
    gl.uniform1i(this.sampler,0); gl.activeTexture(gl.TEXTURE0); gl.enable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer); gl.enableVertexAttribArray(this.position); gl.enableVertexAttribArray(this.uv);
    gl.vertexAttribPointer(this.position,2,gl.FLOAT,false,16,0); gl.vertexAttribPointer(this.uv,2,gl.FLOAT,false,16,8);
    for (const draw of pose.draws) {
      requireThat(this.textures.has(draw.page),'texture',`Missing texture: ${draw.page}`);
      const data = new Float32Array(draw.triangles.length*4); let cursor = 0;
      for (const i of draw.triangles) { data.set([...draw.vertices[i],...draw.uvs[i]],cursor); cursor += 4; }
      gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW); gl.bindTexture(gl.TEXTURE_2D,this.textures.get(draw.page));
      const c = draw.color;gl.uniform4f(this.color,...c);gl.uniform3f(this.dark,...(draw.dark??[0,0,0]));gl.uniform1f(this.pma,draw.pma?1:0);
      const destination = draw.blend === 'additive' ? gl.ONE : draw.blend==='screen'?gl.ONE_MINUS_SRC_COLOR:gl.ONE_MINUS_SRC_ALPHA;
      gl.blendFuncSeparate(draw.blend==='multiply'?gl.DST_COLOR:gl.ONE,destination,gl.ONE,draw.blend==='additive'?gl.ONE:gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES,0,draw.triangles.length);
    }
  }
  clearTextures() { for (const t of this.textures.values()) this.gl.deleteTexture(t); this.textures.clear(); }
  capture(type='image/png',quality) { requireThat(!this.disposed,'renderer','Renderer is disposed');return this.canvas.toDataURL(type,quality); }
  dispose() { if (this.disposed) return; this.disposed = true;const gl=this.gl;this.clearTextures();if(gl.getParameter(gl.CURRENT_PROGRAM)===this.program)gl.useProgram(null);gl.deleteBuffer(this.buffer);gl.deleteProgram(this.program); }
}
