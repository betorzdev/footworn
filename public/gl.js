/* A small WebGL2 world for the village (village.js draws with it). Flat-shaded low-poly meshes in
   layers; moon shadows (a shadow map with hardware PCF); warm pools of window and lamp light on
   the snow and soft contact occlusion, both painted once on top-down 2D canvases (after
   pixel3d-renderer's window pools and Stålberg's blurred top-down AO); a procedural sky with moon
   and stars; soft sprites (smoke, snow) and additive ones (lanterns); and a post pass with ink
   outlines from depth and normal edges (the Townscaper look), a night grade and a vignette. An
   orbit camera that flies, whose centre follows the gap the panels leave (`shift`), and HTML
   labels pinned to 3D points.
   It is made to be left open: the lit scene is drawn once and kept, and drawn again only when the
   camera, a layer, a map or the size changes. A frame is that kept picture and what moves over
   it (snow, smoke, glows, a few small meshes); when nothing moves there are no frames at all.
   A classic script, no dependencies; colours come in from the caller, who reads them from
   tokens.css. */
(function () {
  'use strict';
  var G = window.FootwornGL = {};
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
  /* What is drawn over the kept scene: hidden where the scene's own depth is nearer (`hid`, with
     a little room, since that depth may be kept at another size), and given the post pass's grade. */
  var OVER_U = 'uniform highp sampler2D dt;uniform vec2 inv;uniform float near,far,sat,vig;' +
    'float lin(float z){return 2.*near*far/(far+near-(z*2.-1.)*(far-near));}' +
    'bool hid(){float s=texture(dt,gl_FragCoord.xy*inv).r;return s<1.&&lin(gl_FragCoord.z)>lin(s)*1.002+.04;}' +
    'vec3 grade(vec3 c){vec2 q=gl_FragCoord.xy*inv-.5;float l=dot(c,vec3(.299,.587,.114));return mix(vec3(l),c,sat)*(1.-vig*dot(q,q)*1.8);}';
  /* The lit surface: into the scene target (colour and normals), or, `over`, straight to the screen. */
  function mainFS(over) {
    return '#version 300 es\nprecision highp float;precision highp sampler2DShadow;' +
      'in vec3 vP;in vec3 vN;in vec3 vC;in float vE;in vec4 vL;' +
      'uniform vec3 moonDir,moonCol,skyAmb,gndAmb,fogCol,eye,rimCol;uniform float fogD,fogH,bands,poolK;uniform int nl;' +
      'uniform vec4 lp[16];uniform vec3 lc[16];uniform sampler2DShadow sm;uniform sampler2D lm,ao;uniform vec4 box;' +
      (over ? OVER_U + 'uniform float lift;out vec4 oC;' : 'layout(location=0) out vec4 oC;layout(location=1) out vec4 oN;') +
      'float shadow(){vec3 s=vL.xyz/vL.w*.5+.5;if(s.x<0.||s.y<0.||s.x>1.||s.y>1.||s.z>1.)return 1.;vec2 t=1./vec2(textureSize(sm,0));float r=0.;' +
      'for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)r+=texture(sm,vec3(s.xy+vec2(x,y)*t*1.2,s.z-.0018));return r/9.;}' +
      'void main(){' + (over ? 'if(hid())discard;' : '') + 'vec3 N=normalize(vN);if(!gl_FrontFacing)N=-N;vec3 V=normalize(eye-vP);' +
      'vec2 uv=(vP.xz-box.xy)/box.z;vec3 pool=texture(lm,uv).rgb;float occ=mix(1.,texture(ao,uv).r,1.-smoothstep(0.,2.2,vP.y));' +
      'float d=max(dot(N,moonDir),0.)*shadow();if(bands>0.)d=smoothstep(.0,.08,d)*.8+d*.2;' +
      'vec3 L=mix(gndAmb,skyAmb,N.y*.5+.5)*occ+moonCol*d;' +
      'L+=pool*poolK*exp(-max(vP.y,0.)*.5)*(.3+.7*clamp(N.y*.7+.4,0.,1.));' +
      'for(int i=0;i<nl;i++){vec3 q=lp[i].xyz-vP;float r=length(q);float a=max(0.,1.-r/max(lp[i].w,.001));a*=a;L+=lc[i]*a*(max(dot(N,q/max(r,.001)),0.)*.8+.2);}' +
      'vec3 col=vC*L+rimCol*pow(1.-max(dot(N,V),0.),4.)*(.3+.7*d);col=mix(col,vC,vE);' +
      'float dist=length(eye-vP);float f=1.-exp(-pow(dist*fogD,1.5));f*=mix(1.,.55,smoothstep(0.,fogH,vP.y));' +
      'vec3 fc=mix(col,fogCol,clamp(f,0.,1.));' + (over ? 'oC=vec4(grade(fc+lift),1.);}' : 'oC=vec4(fc,1.);oN=vec4(N*.5+.5,1.);}');
  }
  var DEPTH_VS = '#version 300 es\nlayout(location=0) in vec3 p;uniform mat4 lvp;void main(){gl_Position=lvp*vec4(p,1.);}';
  var DEPTH_FS = '#version 300 es\nprecision mediump float;void main(){}';
  var SPR_VS = '#version 300 es\nlayout(location=0) in vec3 p;layout(location=1) in vec4 c;layout(location=2) in float s;uniform mat4 vp;uniform float k;out vec4 vC;' +
    'void main(){vC=c;gl_Position=vp*vec4(p,1.);gl_PointSize=clamp(s*k/gl_Position.w,1.,300.);}';
  /* Falling snow, wholly here: a flake is (x, y, z, speed), fixed in its buffer; the fall, the
     sway and the wrap round the camera's target come from the clock. */
  var SNOW_VS = '#version 300 es\nlayout(location=0) in vec4 a;uniform mat4 vp;uniform float k,time,size;uniform vec3 ct,col;uniform vec2 room;out vec4 vC;' +
    'void main(){float i=float(gl_VertexID),h=room.x*.5;' +
    'vec3 p=vec3(mod(a.x+sin(time*.5+i)*.7-ct.x+h,room.x)-h+ct.x,mod(a.y-time*a.w*1.3,room.y),mod(a.z+cos(time*.4+i)*.5-ct.z+h,room.x)-h+ct.z);' +
    'vC=vec4(col,.7*a.w);gl_Position=vp*vec4(p,1.);gl_PointSize=clamp(size*k/gl_Position.w,1.,300.);}';
  var SPR_FS = '#version 300 es\nprecision highp float;in vec4 vC;uniform float soft,over;' + OVER_U + 'layout(location=0) out vec4 o;' +
    'void main(){vec2 q=gl_PointCoord*2.-1.;float d=dot(q,q);if(d>1.)discard;if(over>.5&&hid())discard;vec3 c=over>.5?grade(vC.rgb):vC.rgb;' +
    'if(soft>.5){float a=vC.a*smoothstep(1.,.2,d);o=vec4(c*a,a);}else{float a=exp(-d*4.)*vC.a;o=vec4(c*a,0.);}}';
  /* A moving lamp's light on the ground: a flat quad under it, in the mesh's own vertex layout
     (the normal carries the offset from the lamp's foot and its height, the emission its reach),
     added with the falloff the lit surface gives a point light. */
  var SPOT_VS = '#version 300 es\nlayout(location=0) in vec3 p;layout(location=1) in vec3 n;layout(location=2) in vec3 c;layout(location=3) in float e;' +
    'uniform mat4 vp;out vec3 vQ;out vec3 vC;out float vR;void main(){vQ=n;vC=c;vR=e;gl_Position=vp*vec4(p,1.);}';
  var SPOT_FS = '#version 300 es\nprecision highp float;in vec3 vQ;in vec3 vC;in float vR;' + OVER_U + 'out vec4 o;' +
    'void main(){float r=length(vQ);if(r>=vR||hid())discard;float a=1.-r/vR;o=vec4(grade(vC*a*a*(vQ.z/r*.8+.2)),0.);}';
  var POST_VS = '#version 300 es\nout vec2 uv;void main(){vec2 p=vec2(gl_VertexID==1?3.:-1.,gl_VertexID==2?3.:-1.);uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  /* The post pass writes the kept frame. Its alpha is the stars' twinkle, left for the blit to
     play: a star's brightness in the high four bits, its phase in the low four, 0 anywhere else. */
  var POST_FS = '#version 300 es\nprecision highp float;in vec2 uv;uniform sampler2D ct,nt;uniform highp sampler2D dt;uniform vec2 px;' +
    'uniform vec3 camR,camU,camF,skyTop,skyMid,skyLow,moonDir,moonTint,edgeCol,starCol;uniform vec2 tanH,shift;uniform float edge,sat,vig,near,far,time,stars,grain,lift;out vec4 o;float sA=0.;' +
    'float lin(float z){return 2.*near*far/(far+near-(z*2.-1.)*(far-near));}' +
    'float h21(vec2 p){p=fract(p*vec2(233.34,851.73));p+=dot(p,p+23.45);return fract(p.x*p.y);}' +
    'vec3 sky(vec3 d){float t=d.y;vec3 c=mix(skyLow,skyMid,smoothstep(-.05,.28,t));c=mix(c,skyTop,smoothstep(.28,.95,t));' +
    'float m=max(dot(d,moonDir),0.);c+=moonTint*(smoothstep(.99955,.9997,m)*1.6+pow(m,400.)*.35+pow(m,12.)*.12);' +
    'if(stars>0.&&t>.02){vec2 g=vec2(atan(d.z,d.x)*60.,asin(clamp(t,-1.,1.))*60.);vec2 id=floor(g),f=fract(g)-.5;float r=h21(id);' +
    'if(r>.965){float s=smoothstep(.08,0.,length(f))*stars*smoothstep(.02,.3,t);c+=starCol*s*.6;' +
    'sA=(floor(clamp(s,0.,1.)*15.+.5)*16.+floor((r-.965)/.035*15.+.5))/255.;}}return c;}' +
    'void main(){vec2 tx=px;vec3 c=(texture(ct,uv+tx*vec2(-.25,-.25)).rgb+texture(ct,uv+tx*vec2(.25,-.25)).rgb+texture(ct,uv+tx*vec2(-.25,.25)).rgb+texture(ct,uv+tx*vec2(.25,.25)).rgb)*.25;' +
    'ivec2 ip=ivec2(uv/px);float z=texelFetch(dt,ip,0).r;vec3 dir=normalize(camF+(uv.x*2.-1.-shift.x)*tanH.x*camR+(uv.y*2.-1.-shift.y)*tanH.y*camU);vec3 col;' +
    'if(z>=1.){col=sky(dir)+c;}else{col=c;' +
    'if(edge>0.){float lz=lin(z);vec3 n0=texelFetch(nt,ip,0).xyz*2.-1.;float e=0.;' +
    'for(int i=0;i<4;i++){ivec2 o2=ip+(i==0?ivec2(1,0):i==1?ivec2(-1,0):i==2?ivec2(0,1):ivec2(0,-1));float z2=texelFetch(dt,o2,0).r;' +
    'float dz=z2>=1.?1.:abs(lin(z2)-lz)/lz;vec3 n2=texelFetch(nt,o2,0).xyz*2.-1.;e=max(e,max(smoothstep(.015,.04,dz),smoothstep(.25,.5,1.-dot(n0,n2))));}' +
    'col=mix(col,col*edgeCol,e*edge*(1.-smoothstep(40.,140.,lz)));}}' +
    'col+=lift;float l=dot(col,vec3(.299,.587,.114));col=mix(vec3(l),col,sat);' +
    'col*=1.-vig*dot(uv-.5,uv-.5)*1.8;col+=(h21(uv*1000.+fract(time))-.5)*grain;o=vec4(col,sA);}';
  var BLIT_FS = '#version 300 es\nprecision highp float;uniform sampler2D bt;uniform vec2 inv;uniform float time,vig;uniform vec3 starCol;out vec4 o;' +
    'void main(){vec4 c=texelFetch(bt,ivec2(gl_FragCoord.xy),0);int v=int(c.a*255.+.5);' +
    'if(v>15){float r=.965+float(v&15)/15.*.035;vec2 q=gl_FragCoord.xy*inv-.5;' +
    'c.rgb+=starCol*(float(v>>4)/15.)*.4*sin(time*(1.+r*3.)+r*40.)*(1.-vig*dot(q,q)*1.8);}o=vec4(c.rgb,1.);}';

  function compile(gl, vs, fs) {
    function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) + '\n' + s); return o; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i), name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
    return { p: p, u: u };
  }

  /* ---------- the world ---------- */
  var MAX_PX = 8.3e6;     // the canvas never goes past a 4K screen's worth of pixels
  var DRAFT_PX = 2.6e6;   // the scene target while the camera moves; at rest it is drawn once, in full
  var FULL_PX = 9e6;
  var SETTLE = .2;        // seconds the camera rests before that full drawing
  G.world = function (canvas, overlay, env) {
    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    var MAIN = compile(gl, MAIN_VS, mainFS(false)), OVER = compile(gl, MAIN_VS, mainFS(true)), DEPTH = compile(gl, DEPTH_VS, DEPTH_FS),
      SPR = compile(gl, SPR_VS, SPR_FS), SNOW = compile(gl, SNOW_VS, SPR_FS), SPOT = compile(gl, SPOT_VS, SPOT_FS),
      POST = compile(gl, POST_VS, POST_FS), BLIT = compile(gl, POST_VS, BLIT_FS);
    /* `layers`, `lights` and the glows of setGlow are the scene that is kept; `dyn`, `glow`,
       `puffs` and the spots are what moves over it, emptied before every onFrame. */
    var W = {
      gl: gl, env: env, layers: [], dyn: new Mesh(), glow: [], puffs: [], lights: [], labels: [],
      cam: { target: [0, 0, 0], yaw: .5, pitch: .5, dist: 30, fov: .7 }, goal: null, t: 0, idle: 0, W: 1, H: 1,
      box: env.box || [-50, -50, 100],
    };
    var dbuf = gl.createBuffer(), sbuf = gl.createBuffer(), gbuf = gl.createBuffer(), fbuf = gl.createBuffer(), gcount = 0, snow = null;
    var spots = new Mesh(), moving = [], ground = env.ground || [1, 1, 1];
    var dirty = true, shadowDirty = true, labelsDirty = true, force = true, raf = 0;
    function kick() { if (!raf) raf = requestAnimationFrame(frameFn); }
    /* The loop sleeps when nothing moves. `wake` asks for a frame; `invalidate`, for the kept
       scene to be drawn again; `relabel`, for the labels to be placed again. */
    W.wake = function () { force = true; kick(); };
    W.invalidate = function () { dirty = true; kick(); };
    W.relabel = function () { labelsDirty = true; kick(); };
    W.layer = function () { var L = { mesh: new Mesh(), buf: gl.createBuffer(), count: 0 }; W.layers.push(L); return L; };
    W.dropLayer = function (L) { var i = W.layers.indexOf(L); if (i >= 0) W.layers.splice(i, 1); gl.deleteBuffer(L.buf); shadowDirty = true; W.invalidate(); };
    W.upload = function (L) { gl.bindBuffer(gl.ARRAY_BUFFER, L.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L.mesh.v), gl.STATIC_DRAW); L.count = L.mesh.count; L.mesh.clear(); shadowDirty = true; W.invalidate(); };
    W.addGlow = function (arr, p, c, a, s) { arr.push(p[0], p[1], p[2], c[0], c[1], c[2], a, s); };
    /* The glows that stay with the scene (windows, lamps): a list addGlow filled. */
    W.setGlow = function (arr) { gl.bindBuffer(gl.ARRAY_BUFFER, gbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); gcount = arr.length / 8; W.invalidate(); };
    /* The snow: flakes as (x, y, z, speed) in a Float32Array, o = { area, height, size, col }; null stops it. */
    W.setSnow = function (flakes, o) {
      snow = flakes ? { n: flakes.length / 4, o: o } : null;
      if (flakes) { gl.bindBuffer(gl.ARRAY_BUFFER, fbuf); gl.bufferData(gl.ARRAY_BUFFER, flakes, gl.STATIC_DRAW); }
      W.wake();
    };
    /* A lamp that moves (p its foot on the ground, h its height, r its reach, c its colour):
       its light on the ground, and on what is drawn over the scene. */
    W.spot = function (p, h, r, c) {
      var e = Math.sqrt(Math.max(0, r * r - h * h)), v = spots.v, k = [c[0] * ground[0], c[1] * ground[1], c[2] * ground[2]];
      [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]].forEach(function (q) { v.push(p[0] + q[0] * e, p[1], p[2] + q[1] * e, q[0] * e, q[1] * e, h, k[0], k[1], k[2], r); });
      spots.count += 6; moving.push({ p: [p[0], p[1] + h, p[2]], r: r, c: c });
    };

    /* top-down maps: warm light pools (black ground, added light) and occlusion (white, dark
       blobs). Each is painted again only when its list changes. */
    var lmC = document.createElement('canvas'), aoC = document.createElement('canvas'), inkC = document.createElement('canvas');
    lmC.width = lmC.height = aoC.width = aoC.height = inkC.width = inkC.height = 1024;
    var lm = lmC.getContext('2d'), ao = aoC.getContext('2d'), ink = inkC.getContext('2d'), poolKey = null, occKey = null;
    function tex(filter) { var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
    var lmT = tex(gl.LINEAR), aoT = tex(gl.LINEAR);
    function toMap(x, z) { return [(x - W.box[0]) / W.box[2] * 1024, (z - W.box[1]) / W.box[2] * 1024]; }
    /* [[x, z, r, colour, alpha], …] */
    W.paintPools = function (list) {
      var key = W.box.join() + '|' + list.join(';'); if (key === poolKey) return; poolKey = key;
      var S = 1024 / W.box[2];
      lm.globalCompositeOperation = 'source-over'; lm.fillStyle = '#000'; lm.fillRect(0, 0, 1024, 1024); lm.globalCompositeOperation = 'lighter';
      list.forEach(function (o) {
        var p = toMap(o[0], o[1]), R = o[2] * S, g = lm.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
        g.addColorStop(0, G.css(o[3], o[4])); g.addColorStop(.4, G.css(o[3], o[4] * .45)); g.addColorStop(1, G.css(o[3], 0));
        lm.fillStyle = g; lm.fillRect(p[0] - R, p[1] - R, R * 2, R * 2);
      });
      gl.bindTexture(gl.TEXTURE_2D, lmT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lmC); W.invalidate();
    };
    /* [[x, z, w, d, rot, darkness], …]: every footprint drawn sharp, then the lot blurred at once
       (a blur a shape is hundreds of passes, and stalls the GPU for most of a second). */
    W.paintOcclusion = function (list) {
      var key = W.box.join() + '|' + list.join(';'); if (key === occKey) return; occKey = key;
      var S = 1024 / W.box[2];
      ink.clearRect(0, 0, 1024, 1024);
      list.forEach(function (s) {
        var p = toMap(s[0], s[1]); ink.save(); ink.translate(p[0], p[1]); ink.rotate(-s[4]); ink.fillStyle = 'rgba(0,0,0,' + s[5] + ')';
        ink.fillRect(-s[2] / 2 * S, -s[3] / 2 * S, s[2] * S, s[3] * S); ink.restore();
      });
      ao.filter = 'none'; ao.fillStyle = '#fff'; ao.fillRect(0, 0, 1024, 1024);
      ao.filter = 'blur(' + Math.round(S * .55) + 'px)'; ao.drawImage(inkC, 0, 0); ao.filter = 'none';
      gl.bindTexture(gl.TEXTURE_2D, aoT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, aoC); W.invalidate();
    };
    W.paintPools([]); W.paintOcclusion([]);

    /* the shadow map */
    var SM = 2048, smT = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, smT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, SM, SM, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    var smF = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, smF);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, smT, 0); gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    var md = norm(env.moonDir), LVP;
    /* the square of ground the maps and the shadow cover: [x0, z0, size] */
    W.bounds = function (box) {
      W.box = box;
      var h = box[2] / 2, sc = [box[0] + h, 0, box[1] + h];
      LVP = mul(ortho(-h, h, -h, h, 1, 200 + h * 2), lookAt([sc[0] + md[0] * (100 + h), md[1] * (100 + h), sc[2] + md[2] * (100 + h)], sc, [0, 1, 0]));
      shadowDirty = true; W.invalidate();
    };
    W.bounds(W.box);

    /* the scene target (colour, normals, depth), and the frame kept from it */
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
    var kf = gl.createFramebuffer(), kT = tex(gl.NEAREST), kw = 0, kh = 0;
    function keep(w, h) {
      if (w === kw && h === kh) return; kw = w; kh = h;
      gl.bindTexture(gl.TEXTURE_2D, kT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, kf); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, kT, 0);
    }

    function bindMesh(buf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 40, 24);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 40, 36);
    }
    function off() { for (var i = 0; i < 4; i++) gl.disableVertexAttribArray(i); }
    function drawLayers() {
      W.layers.forEach(function (L) { if (L.count) { bindMesh(L.buf); gl.drawArrays(gl.TRIANGLES, 0, L.count); } });
      off();
    }
    /* What changes every frame goes up through one array that only ever grows. */
    var scratch = new Float32Array(4096);
    function f32(a) { if (a.length > scratch.length) scratch = new Float32Array(a.length * 2); scratch.set(a); return scratch.subarray(0, a.length); }
    function drawMesh(M) {
      gl.bindBuffer(gl.ARRAY_BUFFER, dbuf); gl.bufferData(gl.ARRAY_BUFFER, f32(M.v), gl.DYNAMIC_DRAW);
      bindMesh(dbuf); gl.drawArrays(gl.TRIANGLES, 0, M.count); off();
    }
    function points(buf, n, soft) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
      gl.uniform1f(SPR.u.soft, soft ? 1 : 0);
      if (soft) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, n); off();
    }
    function sprites(arr, soft) {
      if (!arr.length) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, sbuf); gl.bufferData(gl.ARRAY_BUFFER, f32(arr), gl.DYNAMIC_DRAW);
      points(sbuf, arr.length / 8, soft);
    }

    W.project = function (p) {
      var m = W.vp, x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      if (w <= .01) return null; return { x: (x / w * .5 + .5) * W.W, y: (1 - (y / w * .5 + .5)) * W.H, w: w };
    };
    W.flyTo = function (g, ms) {
      var c = W.cam, dy = (g.yaw == null ? c.yaw : g.yaw) - c.yaw;
      while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
      W.goal = { from: { target: c.target.slice(), yaw: c.yaw, pitch: c.pitch, dist: c.dist }, to: { target: g.target || c.target, yaw: c.yaw + dy, pitch: g.pitch == null ? c.pitch : g.pitch, dist: g.dist || c.dist }, t: 0, ms: ms == null ? 1500 : ms };
      if (!W.goal.ms) { W.goal.t = 1; W.goal.ms = 1; }
      kick();
    };

    var drag = null, pts = {};
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;   // a right click's pointerup may never come
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ } pts[e.pointerId] = [e.clientX, e.clientY]; drag = { moved: 0 }; W.goal = null; W.idle = 0; kick();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (pts[e.pointerId] && e.pointerType === 'mouse' && !(e.buttons & 1)) { delete pts[e.pointerId]; drag = null; }   // let go where no pointerup reached
      if (!pts[e.pointerId]) { if (W.onHover && e.pointerType === 'mouse') { var rb = canvas.getBoundingClientRect(); W.onHover(e.clientX - rb.left, e.clientY - rb.top); } return; }
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        var o = ids[0] == e.pointerId ? pts[ids[1]] : pts[ids[0]], old = pts[e.pointerId];
        var d0 = Math.hypot(old[0] - o[0], old[1] - o[1]), d1 = Math.hypot(e.clientX - o[0], e.clientY - o[1]);
        if (d0 > 0 && d1 > 0) W.cam.dist = clamp(W.cam.dist * d0 / d1, env.minDist || 6, env.maxDist || 120);
        pts[e.pointerId] = [e.clientX, e.clientY]; if (drag) drag.moved = 99; kick(); return;
      }
      var dx = e.clientX - pts[e.pointerId][0], dy = e.clientY - pts[e.pointerId][1]; pts[e.pointerId] = [e.clientX, e.clientY];
      W.cam.yaw -= dx * .006; W.cam.pitch = clamp(W.cam.pitch + dy * .004, .1, 1.3); if (drag) drag.moved += Math.abs(dx) + Math.abs(dy);
      kick();
    });
    canvas.addEventListener('pointerup', function (e) {
      delete pts[e.pointerId]; var r = canvas.getBoundingClientRect();
      if (drag && drag.moved < 6 && W.onPick) W.onPick(e.clientX - r.left, e.clientY - r.top); if (drag && drag.moved >= 6 && W.onDrag) W.onDrag(); drag = null;
    });
    canvas.addEventListener('pointercancel', function (e) { delete pts[e.pointerId]; drag = null; });
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); W.goal = null; W.idle = 0; if (W.onDrag) W.onDrag(); W.cam.dist = clamp(W.cam.dist * Math.exp(e.deltaY * .0012), env.minDist || 6, env.maxDist || 120); kick(); }, { passive: false });

    /* A lost context (a GPU reset, a reclaimed background tab) takes every buffer and texture
       with it: stop drawing, and when it comes back let the caller start again (onRestore). */
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
    canvas.addEventListener('webglcontextrestored', function () { if (W.onRestore) W.onRestore(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) W.wake(); });
    /* The canvas's box is read when it changes, never in the frame. */
    var rect = canvas.getBoundingClientRect();
    function measure() { rect = canvas.getBoundingClientRect(); W.wake(); }
    if (window.ResizeObserver) new ResizeObserver(measure).observe(canvas);
    window.addEventListener('resize', measure);
    /* A window carried to a screen of another density changes no CSS size: ask for that one. */
    (function density() {
      var m = window.matchMedia && matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
      if (m && m.addEventListener) m.addEventListener('change', function () { measure(); density(); }, { once: true });
    })();

    var NEAR = .3, FAR = 700, lpA = new Float32Array(64), lcA = new Float32Array(48), cw = 1, ch = 1;
    function lit(P, lights) {
      var u = P.u, E = env, n = Math.min(16, lights.length);
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(u.vp, false, W.vp); gl.uniformMatrix4fv(u.lvp, false, LVP);
      gl.uniform3fv(u.moonDir, md); gl.uniform3fv(u.moonCol, E.moon); gl.uniform3fv(u.skyAmb, E.skyAmb); gl.uniform3fv(u.gndAmb, E.gndAmb);
      gl.uniform3fv(u.fogCol, E.fog); gl.uniform3fv(u.eye, W.eye); gl.uniform3fv(u.rimCol, E.rim || [0, 0, 0]);
      gl.uniform1f(u.fogD, E.fogD); gl.uniform1f(u.fogH, E.fogH || 30); gl.uniform1f(u.bands, E.bands || 0); gl.uniform1f(u.poolK, E.poolK || 1.6);
      for (var i = 0; i < n; i++) { var L = lights[i]; lpA[i * 4] = L.p[0]; lpA[i * 4 + 1] = L.p[1]; lpA[i * 4 + 2] = L.p[2]; lpA[i * 4 + 3] = L.r; lcA.set(L.c, i * 3); }
      gl.uniform1i(u.nl, n); gl.uniform4fv(u.lp, lpA); gl.uniform3fv(u.lc, lcA); gl.uniform4f(u.box, W.box[0], W.box[1], W.box[2], 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, smT); gl.uniform1i(u.sm, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lmT); gl.uniform1i(u.lm, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, aoT); gl.uniform1i(u.ao, 2);
    }
    /* The uniforms of what goes over the kept scene; the scene's depth waits on unit 3. */
    function over(P) {
      var u = P.u;
      gl.uniform1i(u.dt, 3); gl.uniform2f(u.inv, 1 / cw, 1 / ch); gl.uniform1f(u.near, NEAR); gl.uniform1f(u.far, FAR);
      gl.uniform1f(u.sat, env.sat == null ? 1 : env.sat); gl.uniform1f(u.vig, env.vig || 0);
    }

    /* The scene as it stands, into the kept frame: the lit layers, the glows that stay, the
       post pass. `ss` is the scene target's scale over the canvas. */
    function bake(ss) {
      var E = env, c = W.cam, tw = Math.max(1, Math.round(cw * ss)), th = Math.max(1, Math.round(ch * ss));
      target(tw, th); keep(cw, ch);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(true);
      if (shadowDirty) {
        shadowDirty = false;
        gl.bindFramebuffer(gl.FRAMEBUFFER, smF); gl.viewport(0, 0, SM, SM); gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.useProgram(DEPTH.p); gl.uniformMatrix4fv(DEPTH.u.lvp, false, LVP); drawLayers();
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, tw, th);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      lit(MAIN, W.lights); drawLayers();
      // the glows, into the colour only, depth-tested, not written
      if (gcount) {
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
        gl.useProgram(SPR.p); gl.uniformMatrix4fv(SPR.u.vp, false, W.vp); gl.uniform1f(SPR.u.k, th / (2 * Math.tan(c.fov / 2)));
        gl.uniform1f(SPR.u.over, 0); gl.uniform1i(SPR.u.dt, 2);   // not the depth it is drawing against
        gl.enable(gl.BLEND); gl.depthMask(false); points(gbuf, gcount, false); gl.depthMask(true); gl.disable(gl.BLEND);
      }
      // post
      gl.bindFramebuffer(gl.FRAMEBUFFER, kf); gl.viewport(0, 0, cw, ch); gl.disable(gl.DEPTH_TEST);
      gl.useProgram(POST.p); var P = POST.u;
      var F = norm(sub(c.target, W.eye)), R = norm(cross(F, [0, 1, 0])), U = cross(R, F), th2 = Math.tan(c.fov / 2);
      gl.uniform3fv(P.camR, R); gl.uniform3fv(P.camU, U); gl.uniform3fv(P.camF, F); gl.uniform2f(P.tanH, th2 * W.W / W.H, th2); gl.uniform2f(P.shift, W.sh[0], W.sh[1]);
      gl.uniform3fv(P.skyTop, E.skyTop); gl.uniform3fv(P.skyMid, E.skyMid); gl.uniform3fv(P.skyLow, E.skyLow); gl.uniform3fv(P.moonDir, norm(E.moonSky || E.moonDir)); gl.uniform3fv(P.moonTint, E.moonTint || [1, 1, 1]);
      gl.uniform3fv(P.edgeCol, E.edgeCol || [.2, .2, .3]); gl.uniform3fv(P.starCol, E.star || [1, 1, 1]); gl.uniform1f(P.edge, E.edge || 0); gl.uniform1f(P.sat, E.sat == null ? 1 : E.sat); gl.uniform1f(P.vig, E.vig || 0);
      gl.uniform1f(P.near, NEAR); gl.uniform1f(P.far, FAR); gl.uniform1f(P.time, W.t); gl.uniform1f(P.stars, E.stars || 0); gl.uniform1f(P.grain, E.grain || .012); gl.uniform1f(P.lift, E.lift || 0);
      gl.uniform2f(P.px, 1 / tw, 1 / th);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cT); gl.uniform1i(P.ct, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, nT); gl.uniform1i(P.nt, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, dT); gl.uniform1i(P.dt, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
    /* The kept frame to the screen, and over it what moves: the meshes, the lamps' light on the
       ground, the snow, the smoke, the glows. */
    function present() {
      var c = W.cam, E = env;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cw, ch);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(true);
      gl.useProgram(BLIT.p); gl.uniform2f(BLIT.u.inv, 1 / cw, 1 / ch); gl.uniform1f(BLIT.u.time, W.t); gl.uniform1f(BLIT.u.vig, E.vig || 0); gl.uniform3fv(BLIT.u.starCol, E.star || [1, 1, 1]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, kT); gl.uniform1i(BLIT.u.bt, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!W.dyn.count && !spots.count && !snow && !W.puffs.length && !W.glow.length) return;
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, dT); gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
      if (W.dyn.count) { lit(OVER, W.lights.concat(moving)); over(OVER); gl.uniform1f(OVER.u.lift, E.lift || 0); drawMesh(W.dyn); }
      gl.enable(gl.BLEND); gl.depthMask(false);
      if (spots.count) { gl.useProgram(SPOT.p); gl.uniformMatrix4fv(SPOT.u.vp, false, W.vp); over(SPOT); gl.blendFunc(gl.ONE, gl.ONE); drawMesh(spots); }
      var k = ch / (2 * Math.tan(c.fov / 2));
      if (snow) {
        var o = snow.o, u = SNOW.u;
        gl.useProgram(SNOW.p); gl.uniformMatrix4fv(u.vp, false, W.vp); over(SNOW); gl.uniform1f(u.over, 1); gl.uniform1f(u.soft, 1);
        gl.uniform1f(u.k, k); gl.uniform1f(u.time, W.t); gl.uniform1f(u.size, o.size); gl.uniform3fv(u.ct, c.target); gl.uniform3fv(u.col, o.col); gl.uniform2f(u.room, o.area, o.height);
        gl.bindBuffer(gl.ARRAY_BUFFER, fbuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.POINTS, 0, snow.n); off();
      }
      if (W.puffs.length || W.glow.length) {
        gl.useProgram(SPR.p); gl.uniformMatrix4fv(SPR.u.vp, false, W.vp); gl.uniform1f(SPR.u.k, k); over(SPR); gl.uniform1f(SPR.u.over, 1);
        sprites(W.puffs, true); sprites(W.glow, false);
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
    }

    /* A frame. The scene is drawn again only when it changed (the camera, a layer, a map, the
       size): a draft while the camera moves, once in full when it rests. Every other frame is the
       kept one and what moves over it: at most 60 a second while the camera moves, 30 while only
       the weather does, and none at all when nothing does (the loop sleeps until `wake`). */
    var last = 0, kept = null, keptQ = 0, still = 0;
    function frameFn(now) {
      raf = 0;
      if (document.hidden || gl.isContextLost()) { last = 0; return; }
      if (last && now - last < (W.goal || drag || dirty ? 13 : 30)) { kick(); return; }
      var dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now; W.t += dt; W.idle += dt;
      var dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(1, rect.width), h = Math.max(1, rect.height);
      if (w * h * dpr * dpr > MAX_PX) dpr = Math.sqrt(MAX_PX / (w * h));
      cw = Math.max(1, Math.round(w * dpr)); ch = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; dirty = true; }
      W.W = w; W.H = h;
      var c = W.cam;
      if (W.goal) {
        var g = W.goal; g.t += dt * 1000; var k = G.ease(clamp(g.t / g.ms, 0, 1));
        c.target = [0, 1, 2].map(function (i) { return g.from.target[i] + (g.to.target[i] - g.from.target[i]) * k; });
        c.yaw = g.from.yaw + (g.to.yaw - g.from.yaw) * k; c.pitch = g.from.pitch + (g.to.pitch - g.from.pitch) * k; c.dist = g.from.dist + (g.to.dist - g.from.dist) * k;
        if (g.t >= g.ms) W.goal = null;
      } else if (W.idle > 8 && env.drift) c.yaw += dt * env.drift;
      var eye = [c.target[0] + Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist, c.target[1] + Math.sin(c.pitch) * c.dist, c.target[2] + Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist];
      W.eye = eye;
      var PR = persp(c.fov, W.W / W.H, NEAR, FAR), sf = W.shift ? W.shift() : [0, 0]; W.sh = sf;
      PR[8] -= sf[0]; PR[9] -= sf[1];
      var vp = mul(PR, lookAt(eye, c.target, [0, 1, 0])), same = !!kept && vp.every(function (v, i) { return v === kept[i]; }), rest = same && !W.goal && !drag;
      W.vp = vp; still = rest ? still + dt : 0;
      W.dyn.clear(); spots.clear(); moving.length = 0; W.glow.length = 0; W.puffs.length = 0;
      var busy = W.onFrame ? W.onFrame(W.t, dt) : false;

      var q = rest && (keptQ === 2 || still > SETTLE) ? 2 : 1, drew = dirty || !same || q > keptQ;
      if (drew) {
        var ss = q === 2 && dpr < 1.5 ? 1.5 : 1, room = q === 2 ? FULL_PX : DRAFT_PX;
        if (cw * ch * ss * ss > room) ss = Math.sqrt(room / (cw * ch));
        dirty = false; bake(ss); kept = vp; keptQ = q; labelsDirty = true;
      }
      if (drew || busy || force) present();
      force = false;

      if (labelsDirty) {
        labelsDirty = false;
        W.labels.forEach(function (L) {
          var s = W.project(L.p), d = Math.hypot(eye[0] - L.p[0], eye[1] - L.p[1], eye[2] - L.p[2]);
          var on = s && (!L.show || L.show(d, W)) && s.x > -60 && s.x < W.W + 60 && s.y > -60 && s.y < W.H + 60;
          if (!on) { if (!L.el.hidden) L.el.hidden = true; return; }
          var z = 1000 - Math.round(d);
          L.el.hidden = false; L.el.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px)'; if (z !== L.z) { L.z = z; L.el.style.zIndex = String(z); } L.sx = s.x; L.sy = s.y;
        });
      }
      if (busy || W.goal || drag || dirty || keptQ < 2 || (env.drift && W.idle > 8)) kick();
    }
    kick();
    W.label = function (p, html, cls, show) {
      var el = document.createElement('div'); el.className = 'lbl ' + (cls || ''); el.innerHTML = html; el.hidden = true;
      overlay.appendChild(el); var L = { p: p, el: el, show: show }; W.labels.push(L); W.relabel(); return L;
    };
    W.unlabel = function (L) { var i = W.labels.indexOf(L); if (i >= 0) W.labels.splice(i, 1); L.el.remove(); };
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
