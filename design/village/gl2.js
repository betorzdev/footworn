/* A better small WebGL2 world for the snow-village options. On top of gl.js: moon shadows (a
   shadow map with hardware PCF), warm pools of window and lamp light on the snow and contact
   occlusion (two top-down maps painted on a 2D canvas, after pixel3d-renderer's window pools and
   Stålberg's blurred top-down AO), smooth terrain normals, a procedural sky with moon and stars,
   soft alpha sprites (smoke, snow) and additive ones (lanterns), and a post pass with outlines
   from depth and normal edges (the Townscaper look), a night grade and a vignette.
   No dependencies. */
(function () {
  'use strict';
  var G = window.G = {};
  var TAU = Math.PI * 2;
  var clamp = G.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  G.lerp = function (a, b, t) { return a + (b - a) * t; };
  G.ease = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  G.rand = function (a, b) { var x = Math.sin(a * 127.1 + (b || 0) * 311.7) * 43758.5453; return x - Math.floor(x); };
  G.hex = function (h) { var m = /^#?(..)(..)(..)$/.exec(h); return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]; };
  G.mix = function (a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  G.scale = function (a, k) { return [a[0] * k, a[1] * k, a[2] * k]; };
  G.css = function (c, a) { return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a == null ? 1 : a) + ')'; };

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  G.norm = norm;
  function persp(fovy, asp, n, f) { var t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]; }
  function ortho(l, r, b, t, n, f) { return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]; }
  function lookAt(e, c, up) {
    var z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  }
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }

  /* ---------- meshes: position, normal, colour, emission ---------- */
  function Mesh() { this.v = []; this.count = 0; }
  G.Mesh = Mesh;
  Mesh.prototype.clear = function () { this.v.length = 0; this.count = 0; };
  Mesh.prototype.triN = function (a, b, c, na, nb, nc, col, em) {
    var v = this.v, e = em || 0;
    v.push(a[0], a[1], a[2], na[0], na[1], na[2], col[0], col[1], col[2], e,
      b[0], b[1], b[2], nb[0], nb[1], nb[2], col[0], col[1], col[2], e,
      c[0], c[1], c[2], nc[0], nc[1], nc[2], col[0], col[1], col[2], e);
    this.count += 3;
  };
  Mesh.prototype.tri = function (a, b, c, col, em) { var n = norm(cross(sub(b, a), sub(c, a))); this.triN(a, b, c, n, n, n, col, em); };
  Mesh.prototype.quad = function (a, b, c, d, col, em) { this.tri(a, b, c, col, em); this.tri(a, c, d, col, em); };
  function frame(cx, cz, rot) {
    var cs = Math.cos(rot || 0), sn = Math.sin(rot || 0);
    return function (x, y, z) { return [cx + x * cs + z * sn, y, cz - x * sn + z * cs]; };
  }
  G.frame = frame;
  Mesh.prototype.box = function (cx, y0, cz, w, h, d, col, em, rot, opt) {
    var P = frame(cx, cz, rot), x = w / 2, z = d / 2, y1 = y0 + h, top = (opt && opt.top) || col;
    this.quad(P(-x, y1, z), P(x, y1, z), P(x, y1, -z), P(-x, y1, -z), top, em);
    this.quad(P(-x, y0, z), P(x, y0, z), P(x, y1, z), P(-x, y1, z), col, em);
    this.quad(P(x, y0, -z), P(-x, y0, -z), P(-x, y1, -z), P(x, y1, -z), col, em);
    this.quad(P(x, y0, z), P(x, y0, -z), P(x, y1, -z), P(x, y1, z), col, em);
    this.quad(P(-x, y0, -z), P(-x, y0, z), P(-x, y1, z), P(-x, y1, -z), col, em);
  };
  /* a gable roof, ridge along local x; `ends` paints the gable triangles */
  Mesh.prototype.roof = function (cx, y0, cz, w, h, d, col, rot, over, ends) {
    var P = frame(cx, cz, rot), o = over == null ? .1 : over, x = w / 2 + o, z = d / 2 + o, y1 = y0 + h;
    this.quad(P(-x, y0, z), P(x, y0, z), P(x, y1, 0), P(-x, y1, 0), col);
    this.quad(P(x, y0, -z), P(-x, y0, -z), P(-x, y1, 0), P(x, y1, 0), col);
    if (ends) {
      var xi = w / 2;
      this.tri(P(xi, y0, d / 2), P(xi, y0, -d / 2), P(xi, y1 - h * o / z, 0), ends);
      this.tri(P(-xi, y0, -d / 2), P(-xi, y0, d / 2), P(-xi, y1 - h * o / z, 0), ends);
    }
  };
  Mesh.prototype.cyl = function (cx, y0, cz, r, h, seg, col, em, r2, smooth) {
    var y1 = y0 + h, rt = r2 == null ? r : r2, k = (r - rt) / Math.max(1e-4, Math.abs(h)) * Math.sign(h || 1);
    for (var i = 0; i < seg; i++) {
      var a = i / seg * TAU, b = (i + 1) / seg * TAU;
      var p0 = [cx + Math.cos(a) * r, y0, cz + Math.sin(a) * r], p1 = [cx + Math.cos(b) * r, y0, cz + Math.sin(b) * r];
      var q0 = [cx + Math.cos(a) * rt, y1, cz + Math.sin(a) * rt], q1 = [cx + Math.cos(b) * rt, y1, cz + Math.sin(b) * rt];
      if (smooth) {
        var na = norm([Math.cos(a), k, Math.sin(a)]), nb = norm([Math.cos(b), k, Math.sin(b)]);
        this.triN(p1, p0, q0, nb, na, na, col, em); if (rt > 0) this.triN(p1, q0, q1, nb, na, nb, col, em);
      } else { this.tri(p1, p0, q0, col, em); if (rt > 0) this.tri(p1, q0, q1, col, em); }
      if (rt > 0) this.tri([cx, y1, cz], q1, q0, col, em);
    }
  };
  Mesh.prototype.cone = function (cx, y0, cz, r, h, seg, col, em, smooth) { this.cyl(cx, y0, cz, r, h, seg, col, em, 0, smooth); };
  Mesh.prototype.ring = function (cx, y, cz, r0, r1, seg, col, em) {
    for (var i = 0; i < seg; i++) {
      var a = i / seg * TAU, b = (i + 1) / seg * TAU;
      this.quad([cx + Math.cos(a) * r1, y, cz + Math.sin(a) * r1], [cx + Math.cos(a) * r0, y, cz + Math.sin(a) * r0], [cx + Math.cos(b) * r0, y, cz + Math.sin(b) * r0], [cx + Math.cos(b) * r1, y, cz + Math.sin(b) * r1], col, em);
    }
  };
  Mesh.prototype.disc = function (cx, y, cz, r, seg, col, em) { this.ring(cx, y, cz, 0.0001, r, seg, col, em); };
  Mesh.prototype.flat = function (cx, y, cz, w, d, col, em, rot) {
    var P = frame(cx, cz, rot), x = w / 2, z = d / 2;
    this.quad(P(-x, y, z), P(x, y, z), P(x, y, -z), P(-x, y, -z), col, em);
  };
  /* a low-poly blob (rock, bush, snow heap): an n-gon prism with a smaller top */
  Mesh.prototype.lump = function (cx, y0, cz, r, h, seg, col, seed) {
    var pts = [];
    for (var i = 0; i < seg; i++) { var a = i / seg * TAU + G.rand(seed, i) * .4, rr = r * (.8 + G.rand(i, seed) * .4); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    var top = [cx, y0 + h, cz];
    for (i = 0; i < seg; i++) {
      var p = pts[i], q = pts[(i + 1) % seg];
      var a0 = [cx + p[0], y0, cz + p[1]], b0 = [cx + q[0], y0, cz + q[1]], a1 = [cx + p[0] * .55, y0 + h * .7, cz + p[1] * .55], b1 = [cx + q[0] * .55, y0 + h * .7, cz + q[1] * .55];
      this.quad(b0, a0, a1, b1, col); this.tri(top, b1, a1, col);
    }
  };
  /* a smooth heightfield over [x0, x0+size]² */
  Mesh.prototype.terrain = function (x0, z0, size, n, hf, cf) {
    var s = size / n, e = s * .5;
    function nrm(x, z) { return norm([hf(x - e, z) - hf(x + e, z), 2 * e, hf(x, z - e) - hf(x, z + e)]); }
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      var xa = x0 + i * s, za = z0 + j * s, xb = xa + s, zb = za + s;
      var a = [xa, hf(xa, za), za], b = [xa, hf(xa, zb), zb], c = [xb, hf(xb, zb), zb], d = [xb, hf(xb, za), za];
      var col = cf((a[1] + b[1] + c[1] + d[1]) / 4, xa + s / 2, za + s / 2);
      var na = nrm(xa, za), nb = nrm(xa, zb), nc = nrm(xb, zb), nd = nrm(xb, za);
      this.triN(a, b, c, na, nb, nc, col); this.triN(a, c, d, na, nc, nd, col);
    }
  };

  /* ---------- shaders ---------- */
  var MAIN_VS = '#version 300 es\nlayout(location=0) in vec3 p;layout(location=1) in vec3 n;layout(location=2) in vec3 c;layout(location=3) in float e;' +
    'uniform mat4 vp;uniform mat4 lvp;out vec3 vP;out vec3 vN;out vec3 vC;out float vE;out vec4 vL;' +
    'void main(){vP=p;vN=n;vC=c;vE=e;vL=lvp*vec4(p,1.);gl_Position=vp*vec4(p,1.);}';
  var MAIN_FS = '#version 300 es\nprecision highp float;precision highp sampler2DShadow;' +
    'in vec3 vP;in vec3 vN;in vec3 vC;in float vE;in vec4 vL;' +
    'uniform vec3 moonDir,moonCol,skyAmb,gndAmb,fogCol,eye,rimCol;uniform float fogD,fogH,bands,poolK;' +
    'uniform vec4 lp[16];uniform vec3 lc[16];uniform sampler2DShadow sm;uniform sampler2D lm,ao;uniform vec4 box;' +
    'layout(location=0) out vec4 oC;layout(location=1) out vec4 oN;' +
    'float shadow(){vec3 s=vL.xyz/vL.w*.5+.5;if(s.x<0.||s.y<0.||s.x>1.||s.y>1.||s.z>1.)return 1.;vec2 t=1./vec2(textureSize(sm,0));float r=0.;' +
    'for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)r+=texture(sm,vec3(s.xy+vec2(x,y)*t*1.2,s.z-.0018));return r/9.;}' +
    'void main(){vec3 N=normalize(vN);if(!gl_FrontFacing)N=-N;vec3 V=normalize(eye-vP);' +
    'vec2 uv=(vP.xz-box.xy)/box.z;vec3 pool=texture(lm,uv).rgb;float occ=mix(1.,texture(ao,uv).r,1.-smoothstep(0.,2.2,vP.y));' +
    'float d=max(dot(N,moonDir),0.)*shadow();if(bands>0.)d=smoothstep(.0,.08,d)*.8+d*.2;' +
    'vec3 L=mix(gndAmb,skyAmb,N.y*.5+.5)*occ+moonCol*d;' +
    'L+=pool*poolK*exp(-max(vP.y,0.)*.5)*(.3+.7*clamp(N.y*.7+.4,0.,1.));' +
    'for(int i=0;i<16;i++){vec3 q=lp[i].xyz-vP;float r=length(q);float a=max(0.,1.-r/max(lp[i].w,.001));a*=a;L+=lc[i]*a*(max(dot(N,q/max(r,.001)),0.)*.8+.2);}' +
    'vec3 col=vC*L+rimCol*pow(1.-max(dot(N,V),0.),4.)*(.3+.7*d);col=mix(col,vC,vE);' +
    'float dist=length(eye-vP);float f=1.-exp(-pow(dist*fogD,1.5));f*=mix(1.,.55,smoothstep(0.,fogH,vP.y));' +
    'oC=vec4(mix(col,fogCol,clamp(f,0.,1.)),1.);oN=vec4(N*.5+.5,1.);}';
  var DEPTH_VS = '#version 300 es\nlayout(location=0) in vec3 p;uniform mat4 lvp;void main(){gl_Position=lvp*vec4(p,1.);}';
  var DEPTH_FS = '#version 300 es\nprecision mediump float;void main(){}';
  var SPR_VS = '#version 300 es\nlayout(location=0) in vec3 p;layout(location=1) in vec4 c;layout(location=2) in float s;uniform mat4 vp;uniform float k;out vec4 vC;' +
    'void main(){vC=c;gl_Position=vp*vec4(p,1.);gl_PointSize=clamp(s*k/gl_Position.w,1.,300.);}';
  var SPR_FS = '#version 300 es\nprecision mediump float;in vec4 vC;uniform float soft;layout(location=0) out vec4 o;' +
    'void main(){vec2 q=gl_PointCoord*2.-1.;float d=dot(q,q);if(d>1.)discard;' +
    'if(soft>.5){float a=vC.a*smoothstep(1.,.2,d);o=vec4(vC.rgb*a,a);}else{float a=exp(-d*4.)*vC.a;o=vec4(vC.rgb*a,0.);}}';
  var POST_VS = '#version 300 es\nout vec2 uv;void main(){vec2 p=vec2(gl_VertexID==1?3.:-1.,gl_VertexID==2?3.:-1.);uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  var POST_FS = '#version 300 es\nprecision highp float;in vec2 uv;uniform sampler2D ct,nt,dt;uniform vec2 px;' +
    'uniform vec3 camR,camU,camF,skyTop,skyMid,skyLow,moonDir,moonTint,edgeCol;uniform vec2 tanH;uniform float edge,sat,vig,near,far,time,stars,grain,lift;out vec4 o;' +
    'float lin(float z){return 2.*near*far/(far+near-(z*2.-1.)*(far-near));}' +
    'float h21(vec2 p){p=fract(p*vec2(233.34,851.73));p+=dot(p,p+23.45);return fract(p.x*p.y);}' +
    'vec3 sky(vec3 d){float t=d.y;vec3 c=mix(skyLow,skyMid,smoothstep(-.05,.28,t));c=mix(c,skyTop,smoothstep(.28,.95,t));' +
    'float m=max(dot(d,moonDir),0.);c+=moonTint*(smoothstep(.99955,.9997,m)*1.6+pow(m,400.)*.35+pow(m,12.)*.12);' +
    'if(stars>0.&&t>.02){vec2 g=vec2(atan(d.z,d.x)*60.,asin(clamp(t,-1.,1.))*60.);vec2 id=floor(g),f=fract(g)-.5;float r=h21(id);' +
    'if(r>.965){float tw=.6+.4*sin(time*(1.+r*3.)+r*40.);c+=vec3(.9,.93,1.)*smoothstep(.08,0.,length(f))*tw*stars*smoothstep(.02,.3,t);}}return c;}' +
    'void main(){vec2 tx=px;vec3 c=(texture(ct,uv+tx*vec2(-.25,-.25)).rgb+texture(ct,uv+tx*vec2(.25,-.25)).rgb+texture(ct,uv+tx*vec2(-.25,.25)).rgb+texture(ct,uv+tx*vec2(.25,.25)).rgb)*.25;' +
    'ivec2 ip=ivec2(uv/px);float z=texelFetch(dt,ip,0).r;vec3 dir=normalize(camF+(uv.x*2.-1.)*tanH.x*camR+(uv.y*2.-1.)*tanH.y*camU);vec3 col;' +
    'if(z>=1.){col=sky(dir)+c;}else{col=c;' +
    'if(edge>0.){float lz=lin(z);vec3 n0=texelFetch(nt,ip,0).xyz*2.-1.;float e=0.;' +
    'for(int i=0;i<4;i++){ivec2 o2=ip+(i==0?ivec2(1,0):i==1?ivec2(-1,0):i==2?ivec2(0,1):ivec2(0,-1));float z2=texelFetch(dt,o2,0).r;' +
    'float dz=z2>=1.?1.:abs(lin(z2)-lz)/lz;vec3 n2=texelFetch(nt,o2,0).xyz*2.-1.;e=max(e,max(smoothstep(.015,.04,dz),smoothstep(.25,.5,1.-dot(n0,n2))));}' +
    'col=mix(col,col*edgeCol,e*edge*(1.-smoothstep(40.,140.,lz)));}}' +
    'col+=lift;float l=dot(col,vec3(.299,.587,.114));col=mix(vec3(l),col,sat);' +
    'col*=1.-vig*dot(uv-.5,uv-.5)*1.8;col+=(h21(uv*1000.+fract(time))-.5)*grain;o=vec4(col,1.);}';

  function compile(gl, vs, fs) {
    function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) + '\n' + s); return o; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i), name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
    return { p: p, u: u };
  }

  /* ---------- the world ---------- */
  G.world = function (canvas, overlay, env) {
    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    var MAIN = compile(gl, MAIN_VS, MAIN_FS), DEPTH = compile(gl, DEPTH_VS, DEPTH_FS), SPR = compile(gl, SPR_VS, SPR_FS), POST = compile(gl, POST_VS, POST_FS);
    var W = {
      gl: gl, env: env, layers: [], dyn: new Mesh(), glow: [], puffs: [], staticGlow: [], lights: [], labels: [],
      cam: { target: [0, 0, 0], yaw: .5, pitch: .5, dist: 30, fov: .7 }, goal: null, t: 0, idle: 0, W: 1, H: 1,
      box: env.box || [-50, -50, 100],
    };
    var dbuf = gl.createBuffer(), sbuf = gl.createBuffer();
    W.layer = function () { var L = { mesh: new Mesh(), buf: gl.createBuffer(), count: 0 }; W.layers.push(L); return L; };
    var shadowDirty = true;
    W.upload = function (L) { gl.bindBuffer(gl.ARRAY_BUFFER, L.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L.mesh.v), gl.STATIC_DRAW); L.count = L.mesh.count; shadowDirty = true; };
    W.addGlow = function (arr, p, c, a, s) { arr.push(p[0], p[1], p[2], c[0], c[1], c[2], a, s); };

    /* top-down maps: warm light pools (black ground, added light) and occlusion (white, dark blobs) */
    var lmC = document.createElement('canvas'), aoC = document.createElement('canvas'); lmC.width = lmC.height = aoC.width = aoC.height = 1024;
    W.lm = lmC.getContext('2d'); W.ao = aoC.getContext('2d');
    function tex(filter) { var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
    var lmT = tex(gl.LINEAR), aoT = tex(gl.LINEAR);
    W.toMap = function (x, z) { return [(x - W.box[0]) / W.box[2] * 1024, (z - W.box[1]) / W.box[2] * 1024]; };
    W.mapScale = 1024 / W.box[2];
    W.clearMaps = function () {
      W.lm.globalCompositeOperation = 'source-over'; W.lm.fillStyle = '#000'; W.lm.fillRect(0, 0, 1024, 1024);
      W.ao.globalCompositeOperation = 'source-over'; W.ao.filter = 'none'; W.ao.fillStyle = '#fff'; W.ao.fillRect(0, 0, 1024, 1024);
      W.lm.globalCompositeOperation = 'lighter';
    };
    W.pool = function (x, z, r, col, a) {
      var p = W.toMap(x, z), R = r * W.mapScale, g = W.lm.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
      g.addColorStop(0, G.css(col, a)); g.addColorStop(.4, G.css(col, a * .45)); g.addColorStop(1, G.css(col, 0));
      W.lm.fillStyle = g; W.lm.fillRect(p[0] - R, p[1] - R, R * 2, R * 2);
    };
    var aoShapes = [];
    W.occlude = function (x, z, w, d, rot, k) { aoShapes.push([x, z, w, d, rot || 0, k == null ? .55 : k]); };
    W.uploadMaps = function () {
      var c = W.ao; c.save(); c.filter = 'blur(' + Math.round(W.mapScale * .55) + 'px)';
      aoShapes.forEach(function (s) {
        var p = W.toMap(s[0], s[1]); c.save(); c.translate(p[0], p[1]); c.rotate(-s[4]); c.fillStyle = 'rgba(0,0,0,' + s[5] + ')';
        c.fillRect(-s[2] / 2 * W.mapScale, -s[3] / 2 * W.mapScale, s[2] * W.mapScale, s[3] * W.mapScale); c.restore();
      });
      c.restore(); aoShapes = [];
      gl.bindTexture(gl.TEXTURE_2D, lmT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lmC);
      gl.bindTexture(gl.TEXTURE_2D, aoT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, aoC);
    };
    W.clearMaps(); W.uploadMaps();

    /* the shadow map */
    var SM = 2048, smT = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, smT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, SM, SM, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    var smF = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, smF);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, smT, 0); gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    var md = norm(env.moonDir), sc = env.shadowCenter || [0, 0, 0], sh = env.shadowHalf || 50;
    var LVP = mul(ortho(-sh, sh, -sh, sh, 1, 400), lookAt([sc[0] + md[0] * 200, sc[1] + md[1] * 200, sc[2] + md[2] * 200], sc, [0, 1, 0]));

    /* the scene target: colour, normals, depth */
    var fb = gl.createFramebuffer(), cT = tex(gl.LINEAR), nT = tex(gl.NEAREST), dT = tex(gl.NEAREST), fw = 0, fh = 0;
    function target(w, h) {
      if (w === fw && h === fh) return; fw = w; fh = h;
      gl.bindTexture(gl.TEXTURE_2D, cT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, nT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, dT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cT, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, nT, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dT, 0);
    }

    function bindMesh(buf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 40, 24);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 40, 36);
    }
    function off() { for (var i = 0; i < 4; i++) gl.disableVertexAttribArray(i); }
    function drawAll(withDyn) {
      W.layers.forEach(function (L) { if (L.count) { bindMesh(L.buf); gl.drawArrays(gl.TRIANGLES, 0, L.count); } });
      if (withDyn && W.dyn.count) { gl.bindBuffer(gl.ARRAY_BUFFER, dbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(W.dyn.v), gl.DYNAMIC_DRAW); bindMesh(dbuf); gl.drawArrays(gl.TRIANGLES, 0, W.dyn.count); }
      off();
    }
    function sprites(arr, soft) {
      if (!arr.length) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, sbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
      gl.uniform1f(SPR.u.soft, soft ? 1 : 0);
      if (soft) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, arr.length / 8); off();
    }

    W.project = function (p) {
      var m = W.vp, x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      if (w <= .01) return null; return { x: (x / w * .5 + .5) * W.W, y: (1 - (y / w * .5 + .5)) * W.H, w: w };
    };
    W.flyTo = function (g, ms) {
      var c = W.cam, dy = (g.yaw == null ? c.yaw : g.yaw) - c.yaw;
      while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
      W.goal = { from: { target: c.target.slice(), yaw: c.yaw, pitch: c.pitch, dist: c.dist }, to: { target: g.target || c.target, yaw: c.yaw + dy, pitch: g.pitch == null ? c.pitch : g.pitch, dist: g.dist || c.dist }, t: 0, ms: ms || 1500 };
    };

    var drag = null, pts = {};
    canvas.addEventListener('pointerdown', function (e) { canvas.setPointerCapture(e.pointerId); pts[e.pointerId] = [e.clientX, e.clientY]; drag = { moved: 0 }; W.goal = null; W.idle = 0; });
    canvas.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        var o = ids[0] == e.pointerId ? pts[ids[1]] : pts[ids[0]], old = pts[e.pointerId];
        var d0 = Math.hypot(old[0] - o[0], old[1] - o[1]), d1 = Math.hypot(e.clientX - o[0], e.clientY - o[1]);
        if (d0 > 0 && d1 > 0) W.cam.dist = clamp(W.cam.dist * d0 / d1, env.minDist || 6, env.maxDist || 120);
        pts[e.pointerId] = [e.clientX, e.clientY]; drag.moved = 99; return;
      }
      var dx = e.clientX - pts[e.pointerId][0], dy = e.clientY - pts[e.pointerId][1]; pts[e.pointerId] = [e.clientX, e.clientY];
      W.cam.yaw -= dx * .006; W.cam.pitch = clamp(W.cam.pitch + dy * .004, .1, 1.3); if (drag) drag.moved += Math.abs(dx) + Math.abs(dy);
    });
    canvas.addEventListener('pointerup', function (e) {
      delete pts[e.pointerId]; var r = canvas.getBoundingClientRect();
      if (drag && drag.moved < 6 && W.onPick) W.onPick(e.clientX - r.left, e.clientY - r.top); drag = null;
    });
    canvas.addEventListener('pointercancel', function (e) { delete pts[e.pointerId]; drag = null; });
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); W.goal = null; W.idle = 0; W.cam.dist = clamp(W.cam.dist * Math.exp(e.deltaY * .0012), env.minDist || 6, env.maxDist || 120); }, { passive: false });

    var last = 0;
    function frameFn(now) {
      var dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now; W.t += dt; W.idle += dt;
      var r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      var cw = Math.max(1, Math.round(r.width * dpr)), ch = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      W.W = r.width; W.H = r.height;
      var ss = dpr < 1.5 ? 1.5 : 1, tw = Math.round(cw * ss), th = Math.round(ch * ss); target(tw, th);
      var c = W.cam;
      if (W.goal) {
        var g = W.goal; g.t += dt * 1000; var k = G.ease(clamp(g.t / g.ms, 0, 1));
        c.target = [0, 1, 2].map(function (i) { return g.from.target[i] + (g.to.target[i] - g.from.target[i]) * k; });
        c.yaw = g.from.yaw + (g.to.yaw - g.from.yaw) * k; c.pitch = g.from.pitch + (g.to.pitch - g.from.pitch) * k; c.dist = g.from.dist + (g.to.dist - g.from.dist) * k;
        if (g.t >= g.ms) W.goal = null;
      } else if (W.idle > 8 && env.drift) c.yaw += dt * env.drift;
      var eye = [c.target[0] + Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist, c.target[1] + Math.sin(c.pitch) * c.dist, c.target[2] + Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist];
      W.eye = eye; var NEAR = .3, FAR = 700;
      W.vp = mul(persp(c.fov, W.W / W.H, NEAR, FAR), lookAt(eye, c.target, [0, 1, 0]));
      W.dyn.clear(); W.glow = W.staticGlow.slice(); W.puffs = []; W.lights = [];
      if (W.onFrame) W.onFrame(W.t, dt);

      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(true);
      if (shadowDirty) {
        shadowDirty = false;
        gl.bindFramebuffer(gl.FRAMEBUFFER, smF); gl.viewport(0, 0, SM, SM); gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.useProgram(DEPTH.p); gl.uniformMatrix4fv(DEPTH.u.lvp, false, LVP); drawAll(false);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, tw, th);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(MAIN.p); var u = MAIN.u, E = env;
      gl.uniformMatrix4fv(u.vp, false, W.vp); gl.uniformMatrix4fv(u.lvp, false, LVP);
      gl.uniform3fv(u.moonDir, md); gl.uniform3fv(u.moonCol, E.moon); gl.uniform3fv(u.skyAmb, E.skyAmb); gl.uniform3fv(u.gndAmb, E.gndAmb);
      gl.uniform3fv(u.fogCol, E.fog); gl.uniform3fv(u.eye, eye); gl.uniform3fv(u.rimCol, E.rim || [0, 0, 0]);
      gl.uniform1f(u.fogD, E.fogD); gl.uniform1f(u.fogH, E.fogH || 30); gl.uniform1f(u.bands, E.bands || 0); gl.uniform1f(u.poolK, E.poolK || 1.6);
      var lp = new Float32Array(64), lc = new Float32Array(48);
      W.lights.slice(0, 16).forEach(function (L, i) { lp.set([L.p[0], L.p[1], L.p[2], L.r], i * 4); lc.set(L.c, i * 3); });
      gl.uniform4fv(u.lp, lp); gl.uniform3fv(u.lc, lc); gl.uniform4f(u.box, W.box[0], W.box[1], W.box[2], 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, smT); gl.uniform1i(u.sm, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lmT); gl.uniform1i(u.lm, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, aoT); gl.uniform1i(u.ao, 2);
      drawAll(true);
      // sprites: soft ones (smoke, snow) then glows, into the colour only, depth-tested, not written
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
      gl.useProgram(SPR.p); gl.uniformMatrix4fv(SPR.u.vp, false, W.vp); gl.uniform1f(SPR.u.k, th / (2 * Math.tan(c.fov / 2)));
      gl.enable(gl.BLEND); gl.depthMask(false);
      sprites(W.puffs, true); sprites(W.glow, false);
      gl.depthMask(true); gl.disable(gl.BLEND);
      // post
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cw, ch); gl.disable(gl.DEPTH_TEST);
      gl.useProgram(POST.p); var P = POST.u;
      var F = norm(sub(c.target, eye)), R = norm(cross(F, [0, 1, 0])), U = cross(R, F), th2 = Math.tan(c.fov / 2);
      gl.uniform3fv(P.camR, R); gl.uniform3fv(P.camU, U); gl.uniform3fv(P.camF, F); gl.uniform2f(P.tanH, th2 * W.W / W.H, th2);
      gl.uniform3fv(P.skyTop, E.skyTop); gl.uniform3fv(P.skyMid, E.skyMid); gl.uniform3fv(P.skyLow, E.skyLow); gl.uniform3fv(P.moonDir, norm(E.moonSky || E.moonDir)); gl.uniform3fv(P.moonTint, E.moonTint || [1, 1, 1]);
      gl.uniform3fv(P.edgeCol, E.edgeCol || [.2, .2, .3]); gl.uniform1f(P.edge, E.edge || 0); gl.uniform1f(P.sat, E.sat == null ? 1 : E.sat); gl.uniform1f(P.vig, E.vig || 0);
      gl.uniform1f(P.near, NEAR); gl.uniform1f(P.far, FAR); gl.uniform1f(P.time, W.t); gl.uniform1f(P.stars, E.stars || 0); gl.uniform1f(P.grain, E.grain || .012); gl.uniform1f(P.lift, E.lift || 0);
      gl.uniform2f(P.px, 1 / tw, 1 / th);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cT); gl.uniform1i(P.ct, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, nT); gl.uniform1i(P.nt, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, dT); gl.uniform1i(P.dt, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);

      W.labels.forEach(function (L) {
        var s = W.project(L.p), d = Math.hypot(eye[0] - L.p[0], eye[1] - L.p[1], eye[2] - L.p[2]);
        var on = s && (!L.show || L.show(d, W)) && s.x > -60 && s.x < W.W + 60 && s.y > -60 && s.y < W.H + 60;
        if (!on) { if (!L.el.hidden) L.el.hidden = true; return; }
        L.el.hidden = false; L.el.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px)'; L.el.style.zIndex = String(1000 - Math.round(d)); L.sx = s.x; L.sy = s.y;
      });
      requestAnimationFrame(frameFn);
    }
    requestAnimationFrame(frameFn);
    W.label = function (p, html, cls, show) {
      var el = document.createElement('div'); el.className = 'lbl ' + (cls || ''); el.innerHTML = html; el.hidden = true;
      overlay.appendChild(el); var L = { p: p, el: el, show: show }; W.labels.push(L); return L;
    };
    return W;
  };

  G.along = function (path, d) {
    for (var i = 0; i < path.length - 1; i++) {
      var a = path[i], b = path[i + 1], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (d <= L) { var k = d / L; return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k], dir: Math.atan2(b[0] - a[0], b[2] - a[2]), done: false }; }
      d -= L;
    }
    return { p: path[path.length - 1].slice(), dir: 0, done: true };
  };
})();
