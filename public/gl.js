/* A small WebGL2 world for the village (village.js draws with it). Low-poly meshes in layers, lit
   and then photographed like a scale model. The light: the moon or a low sun with soft shadows (a
   shadow map, hardware PCF), warm pools of window and lamp light on the snow and soft contact
   occlusion round what stands on it, both painted once on top-down 2D canvases (after
   pixel3d-renderer's window pools and Stålberg's blurred top-down AO). Snow has drifts, a light
   that wraps and grains that glitter (after Journey's sand); ice mirrors. The picture: a sky with
   its disc, stars, clouds and the aurora; contact shadow from the depth; the glow of what is
   brighter than the screen (after Jimenez, SIGGRAPH 2014); a lens that blurs what is off the
   plane in focus, as a close-up of a model does; ink outlines from depth and normal edges (the
   Townscaper look), a grade and a vignette. Soft sprites (smoke, snow) and additive ones
   (lanterns), pictures laid on the scene (a site's icon on its banner: `setDecals`), an orbit
   camera that flies, whose centre follows the gap the panels leave
   (`shift`), and HTML labels pinned to 3D points.
   It is made to be left open: the picture is drawn once and kept, and drawn again only when the
   camera, a layer, a map or the size changes; while the weather moves, the picture's own passes
   run again every `skyTick` seconds over the scene as it was drawn, into a second kept frame the
   first fades to, so the sky moves on. A frame is that kept
   picture and what moves over it (snow, smoke, glows, a few small meshes); when nothing moves
   there are no frames at all.
   A classic script, no dependencies; colours come in from the caller, who reads them from
   tokens.css. */
(function () {
  'use strict';
  var G = window.FootwornGL = {};
  var TAU = Math.PI * 2;
  /* A surface's emission, 0 to 1, or what it is made of: snow, or ice. */
  G.SNOW = 2; G.ICE = 3;
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
  Mesh.prototype.roof = function (cx, y0, cz, w, h, d, col, rot, over, ends, em) {
    var P = frame(cx, cz, rot), o = over == null ? .1 : over, x = w / 2 + o, z = d / 2 + o, y1 = y0 + h;
    this.quad(P(-x, y0, z), P(x, y0, z), P(x, y1, 0), P(-x, y1, 0), col, em);
    this.quad(P(x, y0, -z), P(-x, y0, -z), P(-x, y1, 0), P(x, y1, 0), col, em);
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
  Mesh.prototype.lump = function (cx, y0, cz, r, h, seg, col, seed, em) {
    var pts = [];
    for (var i = 0; i < seg; i++) { var a = i / seg * TAU + G.rand(seed, i) * .4, rr = r * (.8 + G.rand(i, seed) * .4); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    var top = [cx, y0 + h, cz];
    for (i = 0; i < seg; i++) {
      var p = pts[i], q = pts[(i + 1) % seg];
      var a0 = [cx + p[0], y0, cz + p[1]], b0 = [cx + q[0], y0, cz + q[1]], a1 = [cx + p[0] * .55, y0 + h * .7, cz + p[1] * .55], b1 = [cx + q[0] * .55, y0 + h * .7, cz + q[1] * .55];
      this.quad(b0, a0, a1, b1, col, em); this.tri(top, b1, a1, col, em);
    }
  };
  /* a smooth heightfield over [x0, x0+size]² */
  Mesh.prototype.terrain = function (x0, z0, size, n, hf, cf, em) {
    var s = size / n, m = n + 3, H = new Float32Array(m * m), i, j;
    for (i = 0; i < m; i++) for (j = 0; j < m; j++) H[i * m + j] = hf(x0 + (i - 1) * s, z0 + (j - 1) * s);   // each height asked once; a row more all round, for the normals
    function at(i, j) { return H[(i + 1) * m + j + 1]; }
    function pt(i, j) { return [x0 + i * s, at(i, j), z0 + j * s]; }
    function nrm(i, j) { return norm([at(i - 1, j) - at(i + 1, j), 2 * s, at(i, j - 1) - at(i, j + 1)]); }
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      var a = pt(i, j), b = pt(i, j + 1), c = pt(i + 1, j + 1), d = pt(i + 1, j), na = nrm(i, j), nc = nrm(i + 1, j + 1);
      var col = cf((a[1] + b[1] + c[1] + d[1]) / 4, a[0] + s / 2, a[2] + s / 2);
      this.triN(a, b, c, na, nrm(i, j + 1), nc, col, em); this.triN(a, c, d, na, nc, nrm(i + 1, j), col, em);
    }
  };

  /* ---------- shaders ---------- */
  var MAIN_VS = '#version 300 es\nlayout(location=0) in vec3 p;layout(location=1) in vec3 n;layout(location=2) in vec3 c;layout(location=3) in float e;' +
    'uniform mat4 vp;uniform mat4 lvp;out vec3 vP;out vec3 vN;out vec3 vC;out float vE;out vec4 vL;' +
    'void main(){vP=p;vN=n;vC=c;vE=e;vL=lvp*vec4(p,1.);gl_Position=vp*vec4(p,1.);}';
  /* Shared GLSL. NOISE: value noise and its fbm. TONE: the grade every pixel ends with, the kept
     scene's and what is drawn over it: exposure, a soft shoulder for what is brighter than the
     screen, saturation, contrast, a split tone (shadows, highlights) and the vignette. */
  var NOISE = 'float h21(vec2 p){p=fract(p*vec2(233.34,851.73));p+=dot(p,p+23.45);return fract(p.x*p.y);}\n' +
      'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}\n' +
      'float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+17.3;a*=.5;}return s;}\n';
  var TONE = 'uniform float expo,con,sat,vig,lift;uniform vec3 tintS,tintH;\n' +
      'vec3 tone(vec3 c,vec2 q){c=max(c*expo+lift,0.);c=mix(c,.6+.4*(1.-exp(-(c-.6)/.4)),step(.6,c));\n' +
      'float l=dot(c,vec3(.299,.587,.114));c=mix(vec3(l),c,sat);c=mix(c,c*c*(3.-2.*c),con);\n' +
      'c*=mix(tintS,tintH,smoothstep(.05,.7,l));return c*(1.-vig*dot(q,q)*1.8);}\n';
  /* What is drawn over the kept scene: hidden where the scene's own depth is nearer (`hid`, with
     a little room, since that depth may be kept at another size), and given the same grade. */
  var OVER_U = 'uniform highp sampler2D dt;uniform vec2 inv;uniform float near,far;' + TONE +
    'float lin(float z){return 2.*near*far/(far+near-(z*2.-1.)*(far-near));}' +
    'bool hid(){float s=texture(dt,gl_FragCoord.xy*inv).r;return s<1.&&lin(gl_FragCoord.z)>lin(s)*1.002+.04;}' +
    'vec3 grade(vec3 c){return tone(c,gl_FragCoord.xy*inv-.5);}';
  /* The lit surface: into the scene target (colour, and normals with the mirror in alpha: 1 a
     solid, .5 clear ice), or, `over`, straight to the screen. Snow's normal is bent by drifts and
     grain, its light wraps, and its grains glitter (after Journey's sand: a random facet per cell
     that catches the moon, or a lamp, for one view only); ice is dark, with snow blown over it. */
  function mainFS(over) {
    return '#version 300 es\n' +
      'precision highp float;precision highp sampler2DShadow;\n' +
      'in vec3 vP;in vec3 vN;in vec3 vC;in float vE;in vec4 vL;\n' +
      'uniform vec3 moonDir,moonCol,skyAmb,gndAmb,fogCol,eye,rimCol,snowCol,iceCol;uniform float fogD,fogH,fog0,bands,poolK,snowK,sparkK,emK;uniform int nl;\n' +
      'uniform vec4 lp[16];uniform vec3 lc[16];uniform sampler2DShadow sm;uniform sampler2D lm,ao;uniform vec4 box;\n' + NOISE + (over ? OVER_U + 'out vec4 oC;' : 'layout(location=0) out vec4 oC;layout(location=1) out vec4 oN;') + '\n' +
      'float shadow(){vec3 s=vL.xyz/vL.w*.5+.5;if(s.x<0.||s.y<0.||s.x>1.||s.y>1.||s.z>1.)return 1.;vec2 t=1./vec2(textureSize(sm,0));float r=0.;\n' +
      'for(int x=-2;x<=2;x++)for(int y=-2;y<=2;y++)r+=texture(sm,vec3(s.xy+vec2(x,y)*t*1.1,s.z-.0018));return r/25.;}\n' +
      'void main(){\n' + (over ? 'if(hid())discard;' : '') + '\n' +
      'vec3 N=normalize(vN);if(!gl_FrontFacing)N=-N;vec3 V=normalize(eye-vP);float dist=length(eye-vP),ice=step(2.5,vE),snow=step(1.5,vE)*(1.-ice),em=vE>1.5?0.:vE,mat=1.;vec3 base=vC;\n' +
      'if(ice>.5){float pt=smoothstep(.62,.86,fbm(vP.xz*.09)+.34*fbm(vP.xz*.55));base=mix(iceCol,snowCol*.93,pt);mat=mix(.5,1.,pt);snow=pt;\n' +
      'N=normalize(vec3((vn(vP.xz*2.3)-.5)*.06,1.,(vn(vP.xz*2.3+9.)-.5)*.06));}\n' +
      'else if(snow>0.&&snowK>0.&&N.y>.35){vec2 q=vP.xz;float e=.08,n0=fbm(q*.8),gx=fbm(q*.8+vec2(e,0.))-n0,gz=fbm(q*.8+vec2(0.,e))-n0;\n' +
      'float f=exp(-dist*.03),m0=vn(q*11.),hx=vn(q*11.+vec2(.4,0.))-m0,hz=vn(q*11.+vec2(0.,.4))-m0;\n' +
      'N=normalize(N-(vec3(gx,0.,gz)/e*exp(-dist*.006)+vec3(hx,0.,hz)*.12*f)*snowK);}\n' +
      'vec2 uv=(vP.xz-box.xy)/box.z;vec3 pool=texture(lm,uv).rgb;vec2 oc=texture(ao,uv).rg;float occ=mix(1.,oc.r,1.-smoothstep(0.,2.2,vP.y)),shade=clamp(oc.r/max(oc.g,.01),0.,1.);\n' +   // red: contact and shade; green: contact alone; their ratio, a village's own shade, dims its direct light at every height
      'float sh=shadow(),nd=dot(N,moonDir),d=max(mix(nd,(nd+.3)/1.3,snow),0.)*sh;if(bands>0.)d=smoothstep(.0,.08,d)*.8+d*.2;\n' +
      'vec3 L=mix(gndAmb,skyAmb,N.y*.5+.5)*occ+moonCol*d*shade;\n' +
      'vec3 pl=pool*poolK*exp(-max(vP.y,0.)*.5)*(.3+.7*clamp(N.y*.7+.4,0.,1.));L+=pl;\n' +
      'for(int i=0;i<nl;i++){vec3 q=lp[i].xyz-vP;float r=length(q);float a=max(0.,1.-r/max(lp[i].w,.001));a*=a;L+=lc[i]*a*(max(dot(N,q/max(r,.001)),0.)*.8+.2);}\n' +
      'vec3 col=base*L+rimCol*pow(1.-max(dot(N,V),0.),4.)*(.3+.7*d);\n' +
      'if(snow>0.&&sparkK>0.){vec3 H=normalize(moonDir+V);vec2 c=floor(vP.xz*26.);vec3 Gn=normalize(vec3(h21(c+3.1)-.5,.55,h21(c+7.7)-.5));\n' +
      'float f=exp(-dist*.07)*snow*sparkK*step(.82,h21(c));\n' +
      'col+=f*(moonCol*sh*pow(max(dot(Gn,H),0.),90.)*3.5+pl*pow(max(dot(Gn,normalize(V+vec3(0.,1.,0.))),0.),120.)*3.5);\n' +
      'col+=snow*moonCol*sh*pow(max(dot(N,H),0.),20.)*.22;}\n' +
      'col=mix(col,vC*mix(1.,emK,em),em);\n' +
      'float f2=1.-exp(-pow(max(dist-fog0,0.)*fogD,1.5));f2*=mix(1.,.55,smoothstep(0.,fogH,vP.y));\n' +
      'vec3 fc=mix(col,fogCol,clamp(f2,0.,1.));\n' + (over ? 'oC=vec4(grade(fc),1.);}' : 'oC=vec4(fc,1.);oN=vec4(N*.5+.5,mat);}');
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
  /* A picture laid on the scene (a site's icon on its banner): its texture where it is opaque, in
     a light worked out once per picture, with the normal for the ink lines. */
  var DECAL_VS = '#version 300 es\nlayout(location=0) in vec3 p;layout(location=1) in vec2 t;uniform mat4 vp;out vec2 vT;void main(){vT=t;gl_Position=vp*vec4(p,1.);}';
  var DECAL_FS = '#version 300 es\nprecision highp float;in vec2 vT;uniform sampler2D tx;uniform vec3 nrm,light,fogCol;uniform float fog;layout(location=0) out vec4 oC;layout(location=1) out vec4 oN;' +
    'void main(){vec4 c=texture(tx,vT);if(c.a<.5)discard;oC=vec4(mix(c.rgb*light,fogCol,fog),1.);oN=vec4(nrm*.5+.5,1.);}';
  var POST_VS = '#version 300 es\nout vec2 uv;void main(){vec2 p=vec2(gl_VertexID==1?3.:-1.,gl_VertexID==2?3.:-1.);uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  var HEAD = '#version 300 es\nprecision highp float;in vec2 uv;out vec4 o;\n';
  /* From a pixel back to the world: its depth, and the ray through it (not normalised: the eye
     plus the ray times the linear depth is the point). */
  var VIEW_U = 'uniform vec3 camR,camU,camF,eye;uniform vec2 tanH,shift;uniform float near,far;uniform highp sampler2D dt;\n' +
      'float lin(float z){return 2.*near*far/(far+near-(z*2.-1.)*(far-near));}\n' +
      'vec3 ray(vec2 u){return camF+(u.x*2.-1.-shift.x)*tanH.x*camR+(u.y*2.-1.-shift.y)*tanH.y*camU;}\n' +
      'float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}\n';
  /* Contact shadow from the depth itself: how much of the hemisphere over each point is taken
     (a spiral of taps turned per pixel, blurred 4×4 where it is used). */
  var AO_FS = HEAD + VIEW_U + 'uniform sampler2D nt;uniform mat4 vp;uniform float rad;uniform int taps;\n' +
      'void main(){ivec2 ip=ivec2(gl_FragCoord.xy);float z=texelFetch(dt,ip,0).r;if(z>=1.){o=vec4(1.);return;}\n' +
      'vec3 N=normalize(texelFetch(nt,ip,0).xyz*2.-1.),P=eye+ray(uv)*lin(z);\n' +
      'vec3 t=normalize(abs(N.y)<.99?cross(N,vec3(0.,1.,0.)):vec3(1.,0.,0.)),b=cross(N,t);float a0=ign(gl_FragCoord.xy)*6.2832,occ=0.,n=float(taps);\n' +
      'for(int i=0;i<taps;i++){float fi=float(i)+.5,r=sqrt(fi/n),a=a0+fi*2.39996;\n' +
      'vec3 s=P+N*.04+(t*cos(a)*r+b*sin(a)*r+N*sqrt(1.-r*r*.8))*rad*mix(.25,1.,fract(fi*.618));\n' +
      'vec4 c=vp*vec4(s,1.);float dz=c.w-lin(texture(dt,c.xy/c.w*.5+.5).r);occ+=step(.03,dz)*(1.-smoothstep(rad,rad*3.,dz));}\n' +
      'o=vec4(vec3(1.-occ/n),1.);}\n';
  /* The scene's colour and what belongs to the picture, not to a surface: the sky (gradient,
     the glow round the moon or the sun, stars, clouds, and the aurora: curtains with a sharp foot
     that fade upwards, a band of noise seen through a stack of heights), the contact shadow, what the
     ice mirrors (a march along the mirrored ray through the picture itself, the sky where it
     finds nothing) and the ink lines. Its alpha is the stars' twinkle, left for the blit to
     play: a star's brightness in the high four bits, its phase in the low four, 0 anywhere else. */
  var COMP_FS = HEAD + VIEW_U + NOISE + 'uniform sampler2D ct,nt,at;uniform mat4 vp;\n' +
      'uniform vec3 skyTop,skyMid,skyLow,moonDir,moonTint,edgeCol,starCol,hazeCol,cloudCol,aurA,aurB;\n' +
      'uniform float edge,time,stars,aoK,auroraK,cloudK,reflK,discK,disc,mg;uniform int qa,qm;float sA=0.;\n' +
      'vec3 aurora(vec3 d){vec3 a=vec3(0.);if(d.y<0.)return a;\n' +
      'float na=float(qa),jt=ign(gl_FragCoord.xy)/na;for(int i=0;i<qa;i++){float fi=float(i)/na+jt,h=.45+fi*.75;vec2 p=d.xz*(h/(d.y+.09));\n' +
      'float w=fbm(p*.3+vec2(time*.012,3.)),x=p.x*.5+w*5.+p.y*.25;\n' +
      'float band=pow(1.-abs(sin(x)),12.),rays=.35+.65*vn(vec2(p.x*7.+w*9.,time*.04)),env=smoothstep(.18,.5,fbm(p*.11+vec2(9.,time*.005)));\n' +
      'a+=mix(aurA,aurB,fi*fi)*band*rays*env*exp(-fi*2.6)*24./na;}\n' +
      'return (1.-exp(-a*smoothstep(.02,.1,d.y)*.5))*.75;}\n' +
      'vec3 sky(vec3 d){float t=d.y;vec3 c=mix(skyLow,skyMid,smoothstep(-.03,.17,t));c=mix(c,skyTop,smoothstep(.17,.6,t));\n' +
      'float m=max(dot(d,moonDir),0.);c+=hazeCol*(pow(m,5.)*.6+pow(m,40.)*.5)*(1.-smoothstep(-.02,.45,t));\n' +
      'if(stars>0.&&t>.02){vec2 g=vec2(atan(d.z,d.x)*60.,asin(clamp(t,-1.,1.))*60.);vec2 id=floor(g),f=fract(g)-.5;float r=h21(id);\n' +
      'if(r>.965){float s=smoothstep(.08,0.,length(f))*stars*smoothstep(.02,.3,t);c+=starCol*s*.6;\n' +
      'sA=(floor(clamp(s,0.,1.)*15.+.5)*16.+floor((r-.965)/.035*15.+.5))/255.;}}\n' +
      'if(auroraK>0.)c+=aurora(d)*auroraK;\n' +
      'if(cloudK>0.&&t>0.){vec2 q=d.xz/(t+.18)*.9+vec2(time*.004,0.);float cl=smoothstep(.42,.75,fbm(q)+.12*vn(q*5.))*smoothstep(0.,.12,t)*cloudK;\n' +
      'c=mix(c,cloudCol+hazeCol*pow(m,3.)*.8,cl*.75);if(cl>.2)sA=0.;}\n' +
      'c+=moonTint*(smoothstep(disc-.00015,disc,m)*discK+pow(m,400.)*.35+pow(m,12.)*.12);return c;}\n' +
      'void main(){ivec2 ip=ivec2(gl_FragCoord.xy);vec3 c=texelFetch(ct,ip,0).rgb;float z=texelFetch(dt,ip,0).r;vec3 dir=ray(uv),nd=normalize(dir),col;\n' +
      'if(z>=1.){col=sky(nd)+c;}else{col=c;float lz=lin(z);vec4 nm=texelFetch(nt,ip,0);vec3 n0=normalize(nm.xyz*2.-1.);\n' +
      'if(aoK>0.){float a=0.;ivec2 hi=textureSize(at,0)-1;for(int x=-2;x<2;x++)for(int y=-2;y<2;y++)a+=texelFetch(at,clamp(ip+ivec2(x,y),ivec2(0),hi),0).r;col*=mix(1.,a/16.,aoK);}\n' +
      'float rf=clamp((1.-nm.a)*2.,0.,1.)*reflK;\n' +
      'if(rf>.01){vec3 P=eye+dir*lz,R=reflect(nd,n0),rc=sky(R);sA=0.;float t=.5;\n' +
      'for(int i=0;i<qm;i++){vec4 q=vp*vec4(P+R*t,1.);if(q.w<=0.)break;vec2 u=q.xy/q.w*.5+.5;if(u.x<0.||u.x>1.||u.y<0.||u.y>1.)break;\n' +
      'float sz=texture(dt,u).r;if(sz<1.){float dd=q.w-lin(sz);if(dd>0.&&dd<1.2+t*(mg-1.)*2.){rc=texture(ct,u).rgb;break;}}t*=mg;}\n' +
      'col=mix(col,rc,clamp(.22+.78*pow(1.-max(dot(-nd,n0),0.),3.),0.,1.)*rf);}\n' +
      'if(edge>0.){float e=0.;for(int i=0;i<4;i++){ivec2 o2=ip+(i==0?ivec2(1,0):i==1?ivec2(-1,0):i==2?ivec2(0,1):ivec2(0,-1));float z2=texelFetch(dt,o2,0).r;\n' +
      'float dz=z2>=1.?1.:abs(lin(z2)-lz)/lz;vec3 n2=texelFetch(nt,o2,0).xyz*2.-1.;e=max(e,max(smoothstep(.015,.04,dz),smoothstep(.25,.5,1.-dot(n0,n2))));}\n' +
      'col=mix(col,col*edgeCol,e*edge*(1.-smoothstep(40.,140.,lz)));}}\n' +
      'o=vec4(col,z>=1.?sA:0.);}\n';
  /* The glow of what is brighter than the screen (after Jimenez, SIGGRAPH 2014): halved down a
     chain, then added back up it, each step through a small tent. */
  var DOWN_FS = HEAD + 'uniform sampler2D t;uniform vec2 px;uniform float thr;\n' +
      'void main(){vec3 c=(texture(t,uv+px*vec2(-1.,-1.)).rgb+texture(t,uv+px*vec2(1.,-1.)).rgb+texture(t,uv+px*vec2(-1.,1.)).rgb+texture(t,uv+px*vec2(1.,1.)).rgb)*.25;\n' +
      'if(thr>0.){float l=max(c.r,max(c.g,c.b));c*=max(l-thr,0.)/max(l,1e-4);}o=vec4(min(c,vec3(40.)),1.);}\n';
  var UP_FS = HEAD + 'uniform sampler2D t;uniform vec2 px;\n' +
      'void main(){vec3 c=texture(t,uv).rgb*4.;for(int i=0;i<4;i++){vec2 d=i==0?vec2(1.,0.):i==1?vec2(-1.,0.):i==2?vec2(0.,1.):vec2(0.,-1.);c+=texture(t,uv+d*px).rgb*2.+texture(t,uv+(d+d.yx)*px*vec2(1.,i<2?1.:-1.)).rgb;}\n' +
      'o=vec4(c/16.,1.);}\n';
  /* The lens: what stands off the plane in focus is blurred, as a close-up of a scale model is
     (a disc of taps as wide as the pixel's circle of confusion; a tap in focus and nearer than
     the pixel is left out, so nothing sharp bleeds); then the glow, the grade and the grain. */
  var FINAL_FS = HEAD + NOISE + TONE + 'uniform sampler2D ht,bt;uniform highp sampler2D dt;uniform vec2 px;uniform float near,far,focus,dofK,bloomK,grain,time;uniform int taps;\n' +
      'float lin(float z){return 2.*near*far/(far+near-(z*2.-1.)*(far-near));}\n' +
      'float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}\n' +
      'float coc(float z){if(z>=1.)return 0.;float l=lin(z),a=l<focus?(focus*.62-l)/(focus*.4):min((l-focus*1.5)/(focus*1.6),.6);return clamp(a,0.,1.)*dofK;}\n' +
      'void main(){float z=texture(dt,uv).r,lz=lin(z),cc=coc(z);vec3 acc=texture(ht,uv).rgb;float ws=1.;\n' +
      'if(cc>.6){float a0=ign(gl_FragCoord.xy)*6.2832,n=float(taps);for(int i=0;i<taps;i++){float fi=float(i)+.5,r=sqrt(fi/n)*cc,a=a0+fi*2.39996;vec2 u=uv+vec2(cos(a),sin(a))*r*px;\n' +
      'float sz=texture(dt,u).r,w=(coc(sz)>=r*.8||lin(sz)>lz+.5)?1.:0.;acc+=texture(ht,u).rgb*w;ws+=w;}}\n' +
      'vec3 col=tone(acc/ws+texture(bt,uv).rgb*bloomK,uv-.5);col+=(h21(uv*1000.+fract(time))-.5)*grain;\n' +
      'o=vec4(col,texelFetch(ht,ivec2(uv*vec2(textureSize(ht,0))),0).a);}\n';
  /* The kept frame to the screen (two of them while the sky moves on: the one before fades to
     the new one), and the stars' twinkle. */
  var BLIT_FS = '#version 300 es\nprecision highp float;uniform sampler2D bt,bt2;uniform vec2 inv;uniform float time,vig,fade;uniform vec3 starCol;out vec4 o;' +
    'void main(){ivec2 ip=ivec2(gl_FragCoord.xy);vec4 c=texelFetch(bt,ip,0);if(fade<1.)c.rgb=mix(texelFetch(bt2,ip,0).rgb,c.rgb,fade);int v=int(c.a*255.+.5);' +
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
      AO = compile(gl, POST_VS, AO_FS), COMP = compile(gl, POST_VS, COMP_FS), DOWN = compile(gl, POST_VS, DOWN_FS), UP = compile(gl, POST_VS, UP_FS),
      FINAL = compile(gl, POST_VS, FINAL_FS), BLIT = compile(gl, POST_VS, BLIT_FS), DECAL = compile(gl, DECAL_VS, DECAL_FS);
    /* Light brighter than the screen needs a float target; without one the scene stays in eight bits and only glows less. */
    var hdr = !!gl.getExtension('EXT_color_buffer_float'), HF = hdr ? gl.RGBA16F : gl.RGBA8, HT = hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
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
    /* The pictures that stay with the scene: [{ img, at: [4 corners], n }], an image loaded or
       not yet (it is laid once it is). */
    var decals = [], decalKey = '', texOf = new Map();
    W.setDecals = function (list) {
      var key = list.map(function (d) { return d.img.src + ':' + d.at.join() + ':' + (d.dim || 0); }).join('|');
      if (key === decalKey) return; decalKey = key;
      decals.forEach(function (d) { gl.deleteBuffer(d.buf); });
      decals = list.map(function (d) {
        var c = d.at, v = [], uv = [[0, 1], [1, 1], [1, 0], [0, 1], [1, 0], [0, 0]];
        [0, 1, 2, 0, 2, 3].forEach(function (i, k) { v.push(c[i][0], c[i][1], c[i][2], uv[k][0], uv[k][1]); });
        var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
        return { img: d.img, n: d.n, buf: buf, mid: [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2, (c[0][2] + c[2][2]) / 2], dim: d.dim || 0 };
      });
      texOf.forEach(function (t, img) { if (!decals.some(function (d) { return d.img === img; })) { gl.deleteTexture(t); texOf.delete(img); } });   // a picture no longer laid
      W.invalidate();
    };
    function imageTex(img) {
      var t = texOf.get(img); if (t) return t;
      t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      texOf.set(img, t); return t;
    }
    /* in the moon's or the sun's light and the sky's, dimmed with the village (`dim`) and faded
       into the fog as the lit surface is */
    function drawDecals() {
      var E = env, ready = decals.filter(function (d) { return d.img.complete && d.img.naturalWidth; }); if (!ready.length) return;
      gl.useProgram(DECAL.p); gl.uniformMatrix4fv(DECAL.u.vp, false, W.vp); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(DECAL.u.tx, 0); gl.uniform3fv(DECAL.u.fogCol, E.fog);
      ready.forEach(function (d) {
        var k = Math.max(0, dot(d.n, md)) * .9, L = [0, 1, 2].map(function (i) { return (E.skyAmb[i] + E.moon[i] * k + .15) * (1 - d.dim); });
        var dist = Math.hypot(W.eye[0] - d.mid[0], W.eye[1] - d.mid[1], W.eye[2] - d.mid[2]), fg = 1 - Math.exp(-Math.pow(Math.max(dist - W.cam.dist * (E.fogFrom || 0), 0) * E.fogD, 1.5));
        gl.uniform3fv(DECAL.u.nrm, d.n); gl.uniform3fv(DECAL.u.light, L); gl.uniform1f(DECAL.u.fog, clamp(fg * .55, 0, 1)); gl.bindTexture(gl.TEXTURE_2D, imageTex(d.img));
        gl.bindBuffer(gl.ARRAY_BUFFER, d.buf);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
        gl.drawArrays(gl.TRIANGLES, 0, 6); off();
      });
    }
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
    /* [[x, z, w, d, rot, darkness, shade, round], …]: every footprint drawn sharp, then the lot blurred at once.
       A footprint marked `shade` (a village's own shade) darkens the red channel only: the lit
       surface reads it as shade on the direct light too, not only on what the sky gives. One marked
       `round` is an ellipse that fades out over its outer half instead of a sharp rectangle.
       (a blur a shape is hundreds of passes, and stalls the GPU for most of a second). */
    W.paintOcclusion = function (list) {
      var key = W.box.join() + '|' + list.join(';'); if (key === occKey) return; occKey = key;
      var S = 1024 / W.box[2];
      ink.clearRect(0, 0, 1024, 1024);
      list.forEach(function (s) {
        var p = toMap(s[0], s[1]), c = s[6] ? 'rgba(0,255,255,' : 'rgba(0,0,0,'; ink.save(); ink.translate(p[0], p[1]); ink.rotate(-s[4]);
        if (s[7]) {
          var g = ink.createRadialGradient(0, 0, 0, 0, 0, s[2] / 2 * S);
          g.addColorStop(0, c + s[5] + ')'); g.addColorStop(.5, c + s[5] + ')'); g.addColorStop(1, c + '0)');
          ink.scale(1, s[3] / s[2]); ink.fillStyle = g; ink.beginPath(); ink.arc(0, 0, s[2] / 2 * S, 0, Math.PI * 2); ink.fill();
        } else { ink.fillStyle = c + s[5] + ')'; ink.fillRect(-s[2] / 2 * S, -s[3] / 2 * S, s[2] * S, s[3] * S); }
        ink.restore();
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
    /* The light's view of the square of ground the maps and the shadow cover. */
    function cast() {
      var h = W.box[2] / 2, sc = [W.box[0] + h, 0, W.box[1] + h];
      LVP = mul(ortho(-h, h, -h, h, 1, 200 + h * 2), lookAt([sc[0] + md[0] * (100 + h), md[1] * (100 + h), sc[2] + md[2] * (100 + h)], sc, [0, 1, 0]));
      shadowDirty = true;
    }
    /* that square: [x0, z0, size] */
    W.bounds = function (box) { W.box = box; cast(); W.invalidate(); };
    /* The moon, or the sun, somewhere else: the shadows follow with the next drawing of the scene. */
    W.setSun = function (dir) { md = norm(dir); cast(); };
    W.bounds(W.box);

    /* the scene target (colour, normals, depth), and the frame kept from it */
    var fb = gl.createFramebuffer(), cT = tex(gl.LINEAR), nT = tex(gl.NEAREST), dT = tex(gl.NEAREST), fw = 0, fh = 0;
    var hF = gl.createFramebuffer(), hT = tex(gl.LINEAR), aF = gl.createFramebuffer(), aT = tex(gl.NEAREST), BL = [];
    for (var bi = 0; bi < 6; bi++) BL.push({ f: gl.createFramebuffer(), t: tex(gl.LINEAR), w: 1, h: 1 });
    function one(F, T, fmt, type, w, h) {
      gl.bindTexture(gl.TEXTURE_2D, T); gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, gl.RGBA, type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, F); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, T, 0);
    }
    /* Answers whether the targets are new, and so empty. */
    function target(w, h) {
      if (w === fw && h === fh) return false; fw = w; fh = h;
      gl.bindTexture(gl.TEXTURE_2D, cT); gl.texImage2D(gl.TEXTURE_2D, 0, HF, w, h, 0, gl.RGBA, HT, null);
      gl.bindTexture(gl.TEXTURE_2D, nT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, dT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cT, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, nT, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dT, 0);
      one(hF, hT, HF, HT, w, h); one(aF, aT, gl.RGBA8, gl.UNSIGNED_BYTE, w, h);
      BL.forEach(function (b, i) { b.w = Math.max(1, w >> (i + 1)); b.h = Math.max(1, h >> (i + 1)); one(b.f, b.t, HF, HT, b.w, b.h); });
      return true;
    }
    /* Two kept frames: the one on screen and, while the sky moves on, the one before it. */
    var kf = [gl.createFramebuffer(), gl.createFramebuffer()], kT = [tex(gl.NEAREST), tex(gl.NEAREST)], kw = 0, kh = 0, slot = 0, fadeAt = -1e9, bakedAt = 0;
    function keep(w, h) {
      if (w === kw && h === kh) return; kw = w; kh = h; fadeAt = -1e9;
      one(kf[0], kT[0], gl.RGBA8, gl.UNSIGNED_BYTE, w, h); one(kf[1], kT[1], gl.RGBA8, gl.UNSIGNED_BYTE, w, h);
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

    var NEAR = .3, FAR = 1100, lpA = new Float32Array(64), lcA = new Float32Array(48), cw = 1, ch = 1;
    function lit(P, lights) {
      var u = P.u, E = env, n = Math.min(16, lights.length);
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(u.vp, false, W.vp); gl.uniformMatrix4fv(u.lvp, false, LVP);
      gl.uniform3fv(u.moonDir, md); gl.uniform3fv(u.moonCol, E.moon); gl.uniform3fv(u.skyAmb, E.skyAmb); gl.uniform3fv(u.gndAmb, E.gndAmb);
      gl.uniform3fv(u.fogCol, E.fog); gl.uniform3fv(u.eye, W.eye); gl.uniform3fv(u.rimCol, E.rim || [0, 0, 0]);
      gl.uniform1f(u.fogD, E.fogD); gl.uniform1f(u.fog0, W.cam.dist * (E.fogFrom || 0)); gl.uniform1f(u.fogH, E.fogH || 30); gl.uniform1f(u.bands, E.bands || 0); gl.uniform1f(u.poolK, E.poolK || 1.6);
      gl.uniform3fv(u.snowCol, E.snowCol || [1, 1, 1]); gl.uniform3fv(u.iceCol, E.ice || [0, 0, 0]); gl.uniform1f(u.snowK, E.snowK || 0); gl.uniform1f(u.sparkK, E.sparkK || 0); gl.uniform1f(u.emK, E.emK || 1);
      for (var i = 0; i < n; i++) { var L = lights[i]; lpA[i * 4] = L.p[0]; lpA[i * 4 + 1] = L.p[1]; lpA[i * 4 + 2] = L.p[2]; lpA[i * 4 + 3] = L.r; lcA.set(L.c, i * 3); }
      gl.uniform1i(u.nl, n); gl.uniform4fv(u.lp, lpA); gl.uniform3fv(u.lc, lcA); gl.uniform4f(u.box, W.box[0], W.box[1], W.box[2], 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, smT); gl.uniform1i(u.sm, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lmT); gl.uniform1i(u.lm, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, aoT); gl.uniform1i(u.ao, 2);
    }
    /* The uniforms of what goes over the kept scene; the scene's depth waits on unit 3. */
    function toneU(u) {
      var E = env;
      gl.uniform1f(u.expo, E.expo || 1); gl.uniform1f(u.con, E.con || 0); gl.uniform1f(u.sat, E.sat == null ? 1 : E.sat); gl.uniform1f(u.vig, E.vig || 0); gl.uniform1f(u.lift, E.lift || 0);
      gl.uniform3fv(u.tintS, E.tintS || [1, 1, 1]); gl.uniform3fv(u.tintH, E.tintH || [1, 1, 1]);
    }
    function over(P) {
      var u = P.u;
      gl.uniform1i(u.dt, 3); gl.uniform2f(u.inv, 1 / cw, 1 / ch); gl.uniform1f(u.near, NEAR); gl.uniform1f(u.far, FAR); toneU(u);
    }

    /* What the light on the scene is made of: while it stays the same, the scene's own targets do too. */
    var litAt = null;
    function litKey() { var E = env; return [E.moon, E.skyAmb, E.gndAmb, E.fog, E.rim, E.ice, E.emK, md].join(); }
    /* The scene as it stands, into the kept frame `into`: the lit layers, the glows that stay,
       then the picture's passes. `ss` is the scene target's scale over the canvas; a draft
       (`q` 1, the camera moving) takes fewer taps and steps. `only` asks for the picture's passes
       alone, over the scene as it was last drawn: the sky's tick, while nothing else changed. */
    function bake(ss, q, into, only) {
      var tw = Math.max(1, Math.round(cw * ss)), th = Math.max(1, Math.round(ch * ss));
      if (target(tw, th) || shadowDirty || litKey() !== litAt) only = false;
      keep(cw, ch);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(true);
      if (!only) scene(tw, th);
      picture(tw, th, q, into, only);
    }
    function scene(tw, th) {
      var c = W.cam; litAt = litKey();
      if (shadowDirty) {
        shadowDirty = false;
        gl.bindFramebuffer(gl.FRAMEBUFFER, smF); gl.viewport(0, 0, SM, SM); gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.useProgram(DEPTH.p); gl.uniformMatrix4fv(DEPTH.u.lvp, false, LVP); drawLayers();
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, tw, th);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      lit(MAIN, W.lights); drawLayers(); drawDecals();
      // the glows, into the colour only, depth-tested, not written
      if (gcount) {
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
        gl.useProgram(SPR.p); gl.uniformMatrix4fv(SPR.u.vp, false, W.vp); gl.uniform1f(SPR.u.k, th / (2 * Math.tan(c.fov / 2)));
        gl.uniform1f(SPR.u.over, 0); gl.uniform1i(SPR.u.dt, 2);   // not the depth it is drawing against
        gl.enable(gl.BLEND); gl.depthMask(false); points(gbuf, gcount, false); gl.depthMask(true); gl.disable(gl.BLEND);
      }
    }
    /* contact shadow, sky and mirror, glow, lens, grade */
    function picture(tw, th, q, into, only) {
      var E = env, c = W.cam;
      gl.disable(gl.DEPTH_TEST);
      var F = norm(sub(c.target, W.eye)), R = norm(cross(F, [0, 1, 0])), U = cross(R, F), th2 = Math.tan(c.fov / 2), full = q === 2;
      function view(u) {
        gl.uniform3fv(u.camR, R); gl.uniform3fv(u.camU, U); gl.uniform3fv(u.camF, F); gl.uniform3fv(u.eye, W.eye); gl.uniform2f(u.tanH, th2 * W.W / W.H, th2); gl.uniform2f(u.shift, W.sh[0], W.sh[1]);
        gl.uniform1f(u.near, NEAR); gl.uniform1f(u.far, FAR); gl.uniformMatrix4fv(u.vp, false, W.vp);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, nT); gl.uniform1i(u.nt, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, dT); gl.uniform1i(u.dt, 2);
      }
      if (E.ao && !only) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, aF); gl.viewport(0, 0, tw, th); gl.useProgram(AO.p); view(AO.u);
        gl.uniform1f(AO.u.rad, E.aoR || .9); gl.uniform1i(AO.u.taps, full ? 16 : 8); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, hF); gl.viewport(0, 0, tw, th); gl.useProgram(COMP.p); var P = COMP.u; view(P);
      gl.uniform3fv(P.skyTop, E.skyTop); gl.uniform3fv(P.skyMid, E.skyMid); gl.uniform3fv(P.skyLow, E.skyLow); gl.uniform3fv(P.moonDir, norm(E.moonSky || E.moonDir)); gl.uniform3fv(P.moonTint, E.moonTint || [1, 1, 1]);
      gl.uniform3fv(P.hazeCol, E.haze || [0, 0, 0]); gl.uniform3fv(P.cloudCol, E.cloud || [0, 0, 0]); gl.uniform1f(P.cloudK, E.cloudK || 0); gl.uniform1f(P.auroraK, E.aurora || 0); gl.uniform1f(P.reflK, E.refl == null ? 1 : E.refl);
      gl.uniform1f(P.disc, E.disc || .9997); gl.uniform1f(P.discK, E.discK == null ? 1.6 : E.discK); gl.uniform1f(P.aoK, E.ao || 0);
      var steps = full ? 40 : 16; gl.uniform1i(P.qa, full ? 24 : 10); gl.uniform1i(P.qm, steps); gl.uniform1f(P.mg, Math.pow(300, 1 / steps));   // the mirror's march reaches 150 either way
      gl.uniform3fv(P.edgeCol, E.edgeCol || [.2, .2, .3]); gl.uniform3fv(P.starCol, E.star || [1, 1, 1]); gl.uniform1f(P.edge, E.edge || 0);
      gl.uniform1f(P.time, W.t); gl.uniform1f(P.stars, E.stars || 0); gl.uniform3fv(P.aurA, E.auroraA || [0, 1, .4]); gl.uniform3fv(P.aurB, E.auroraB || [.4, .2, 1]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cT); gl.uniform1i(P.ct, 0);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, aT); gl.uniform1i(P.at, 3);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
      var n = E.bloom ? BL.length : 0, i;
      if (n) {
        gl.useProgram(DOWN.p); gl.uniform1i(DOWN.u.t, 0);
        for (i = 0; i < n; i++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, BL[i].f); gl.viewport(0, 0, BL[i].w, BL[i].h); gl.bindTexture(gl.TEXTURE_2D, i ? BL[i - 1].t : hT);
          gl.uniform2f(DOWN.u.px, 1 / (i ? BL[i - 1].w : tw), 1 / (i ? BL[i - 1].h : th)); gl.uniform1f(DOWN.u.thr, i ? 0 : E.bloomThr || .9); gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.useProgram(UP.p); gl.uniform1i(UP.u.t, 0); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        for (i = n - 1; i > 0; i--) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, BL[i - 1].f); gl.viewport(0, 0, BL[i - 1].w, BL[i - 1].h); gl.bindTexture(gl.TEXTURE_2D, BL[i].t);
          gl.uniform2f(UP.u.px, 1 / BL[i].w, 1 / BL[i].h); gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.disable(gl.BLEND);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, kf[into]); gl.viewport(0, 0, cw, ch); gl.useProgram(FINAL.p); P = FINAL.u; toneU(P);
      gl.uniform2f(P.px, 1 / cw, 1 / ch); gl.uniform1f(P.near, NEAR); gl.uniform1f(P.far, FAR); gl.uniform1f(P.focus, c.dist); gl.uniform1f(P.dofK, (E.dof || 0) * ch / 1080); gl.uniform1i(P.taps, full ? 40 : 14);
      gl.uniform1f(P.bloomK, n ? (E.bloom || 0) / n : 0); gl.uniform1f(P.grain, E.grain == null ? .012 : E.grain); gl.uniform1f(P.time, W.t);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hT); gl.uniform1i(P.ht, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, n ? BL[0].t : hT); gl.uniform1i(P.bt, 1);
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
      var fade = env.skyTick ? clamp((W.t - fadeAt) / env.skyTick, 0, 1) : 1;
      gl.useProgram(BLIT.p); gl.uniform1f(BLIT.u.fade, fade); gl.uniform2f(BLIT.u.inv, 1 / cw, 1 / ch); gl.uniform1f(BLIT.u.time, W.t); gl.uniform1f(BLIT.u.vig, E.vig || 0); gl.uniform3fv(BLIT.u.starCol, E.star || [1, 1, 1]);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, kT[1 - slot]); gl.uniform1i(BLIT.u.bt2, 1);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, kT[slot]); gl.uniform1i(BLIT.u.bt, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!W.dyn.count && !spots.count && !snow && !W.puffs.length && !W.glow.length) return;
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, dT); gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
      if (W.dyn.count) { lit(OVER, W.lights.concat(moving)); over(OVER); drawMesh(W.dyn); }
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
       size): a draft while the camera moves, once in full when it rests; and, at rest while the
       weather moves, the picture alone once every `skyTick` seconds into the other kept frame
       (`tick`), for the sky. Every other frame is the
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
      var tick = !drew && env.skyTick && rest && busy && keptQ === 2 && W.t - bakedAt >= env.skyTick;
      if (tick) { slot = 1 - slot; fadeAt = W.t; } else if (drew) fadeAt = -1e9;
      if (drew || tick) {
        var ss = q === 2 && dpr < 1.5 ? 1.5 : 1, room = q === 2 ? FULL_PX : DRAFT_PX;
        if (cw * ch * ss * ss > room) ss = Math.sqrt(room / (cw * ch));
        dirty = false; bake(ss, q, slot, tick); bakedAt = W.t; kept = vp; keptQ = q; if (drew) labelsDirty = true;
      }
      if (drew || tick || busy || force) present();
      force = false;

      if (labelsDirty) {
        labelsDirty = false;
        /* The labels on screen vie for room: the highest `prio` is placed first (one without, or at
           Infinity, always is) and one that would cover a label already placed stays hidden; one
           that was shown keeps a little more room, so two that barely touch do not blink as the
           camera moves. A label's size is read once, after its text changes (`bw` set to 0). */
        var vying = [], unread = [];
        W.labels.forEach(function (L) {
          var s = W.project(L.p), d = Math.hypot(eye[0] - L.p[0], eye[1] - L.p[1], eye[2] - L.p[2]);
          var on = s && (!L.show || L.show(d, W)) && s.x > -60 && s.x < W.W + 60 && s.y > -60 && s.y < W.H + 60;
          L.culled = false;
          if (!on) { L.was = false; if (!L.el.hidden) L.el.hidden = true; return; }
          L.sx = s.x; L.sy = s.y; L.d = d; L.rank = L.prio ? L.prio() : Infinity;
          if (L.rank <= 0) { L.culled = true; L.was = false; if (!L.el.hidden) L.el.hidden = true; return; }
          vying.push(L);
          if (!L.bw) { L.el.hidden = false; unread.push(L); }
        });
        unread.forEach(function (L) { var c = L.el.firstElementChild || L.el; L.bw = c.offsetWidth; L.bh = c.offsetHeight; });   // one layout, for the new ones only
        var gap = labelGap(), placed = [];
        vying.sort(function (a, b) { return b.rank - a.rank || b.was - a.was; }).forEach(function (L) {
          var pad = L.was ? -gap : gap, bx = [L.sx - L.bw / 2 - pad, L.sy - L.bh - pad, L.sx + L.bw / 2 + pad, L.sy + pad];
          var hit = L.rank !== Infinity && placed.some(function (q) { return bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1]; });
          L.was = !hit;
          if (hit) { L.culled = true; if (!L.el.hidden) L.el.hidden = true; return; }
          placed.push([L.sx - L.bw / 2, L.sy - L.bh, L.sx + L.bw / 2, L.sy]);
          var z = 1000 - Math.round(L.d);
          L.el.hidden = false; L.el.style.transform = 'translate(' + L.sx.toFixed(1) + 'px,' + L.sy.toFixed(1) + 'px)'; if (z !== L.z) { L.z = z; L.el.style.zIndex = String(z); }
        });
      }
      if (busy || W.goal || drag || dirty || keptQ < 2 || (env.drift && W.idle > 8)) kick();
    }
    kick();
    /* A label over a point of the scene, shown while `show(distance, W)` says so. One given a
       `prio()` vies for room with the others: at 0 or less it is not shown, and the lower of two
       that would overlap is hidden; either way it is `culled`, still placed (`sx`, `sy`) for the
       pointer to find. Whoever changes its text sets `bw` to 0, for its size to be read again. */
    var gapPx = 0;   // the room kept between two labels: the spacing token --s-1
    function labelGap() { return gapPx || (gapPx = parseFloat(getComputedStyle(overlay).getPropertyValue('--s-1')) || 4); }
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
