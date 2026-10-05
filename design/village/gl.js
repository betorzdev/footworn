/* A tiny WebGL world for the village options: flat-shaded low-poly meshes (boxes, gable roofs,
   cylinders, cones), a sun and a hemisphere light, up to 16 point lights, distance fog, additive
   glow sprites, an orbit camera (drag, wheel, pinch) that can fly to a place, and HTML labels
   pinned to 3D points. No dependencies: the real dashboard could keep it. */
(function () {
  'use strict';
  var V3 = window.V3 = {};
  var TAU = Math.PI * 2;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  V3.clamp = clamp;
  V3.lerp = function (a, b, t) { return a + (b - a) * t; };
  V3.ease = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  V3.rand = function (a, b) { var x = Math.sin(a * 127.1 + (b || 0) * 311.7) * 43758.5453; return x - Math.floor(x); };
  V3.hex = function (h) { var m = /^#?(..)(..)(..)$/.exec(h); return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]; };
  V3.mix = function (a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  V3.scale = function (a, k) { return [a[0] * k, a[1] * k, a[2] * k]; };

  /* ---------- matrices (column-major) ---------- */
  function persp(fovy, asp, n, f) {
    var t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f);
    return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0];
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function lookAt(e, c, up) {
    var z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  }
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }

  /* ---------- meshes ---------- */
  function Mesh() { this.v = []; this.count = 0; }
  V3.Mesh = Mesh;
  Mesh.prototype.clear = function () { this.v.length = 0; this.count = 0; };
  Mesh.prototype.tri = function (a, b, c, col, em) {
    var n = norm(cross(sub(b, a), sub(c, a))), v = this.v, e = em || 0;
    [a, b, c].forEach(function (p) { v.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], e); });
    this.count += 3;
  };
  Mesh.prototype.quad = function (a, b, c, d, col, em) { this.tri(a, b, c, col, em); this.tri(a, c, d, col, em); };
  /* Local frame: centre (cx, cz), turned by rot around y. */
  function frame(cx, cz, rot) {
    var cs = Math.cos(rot || 0), sn = Math.sin(rot || 0);
    return function (x, y, z) { return [cx + x * cs + z * sn, y, cz - x * sn + z * cs]; };
  }
  V3.frame = frame;
  Mesh.prototype.box = function (cx, y0, cz, w, h, d, col, em, rot, opt) {
    var P = frame(cx, cz, rot), x = w / 2, z = d / 2, y1 = y0 + h, side = (opt && opt.side) || col, top = (opt && opt.top) || col;
    this.quad(P(-x, y1, z), P(x, y1, z), P(x, y1, -z), P(-x, y1, -z), top, em);       // top
    this.quad(P(-x, y0, z), P(x, y0, z), P(x, y1, z), P(-x, y1, z), col, em);          // front (+z)
    this.quad(P(x, y0, -z), P(-x, y0, -z), P(-x, y1, -z), P(x, y1, -z), col, em);      // back
    this.quad(P(x, y0, z), P(x, y0, -z), P(x, y1, -z), P(x, y1, z), side, em);         // right
    this.quad(P(-x, y0, -z), P(-x, y0, z), P(-x, y1, z), P(-x, y1, -z), side, em);     // left
  };
  /* A gable roof whose ridge runs along local x. */
  Mesh.prototype.roof = function (cx, y0, cz, w, h, d, col, rot, over) {
    var P = frame(cx, cz, rot), o = over == null ? .08 : over, x = w / 2 + o, z = d / 2 + o, y1 = y0 + h;
    this.quad(P(-x, y0, z), P(x, y0, z), P(x, y1, 0), P(-x, y1, 0), col);
    this.quad(P(x, y0, -z), P(-x, y0, -z), P(-x, y1, 0), P(x, y1, 0), col);
    var g = V3.scale(col, .8);
    this.tri(P(x - o, y0, z - o), P(x - o, y0, -z + o), P(x - o, y1, 0), g);
    this.tri(P(-x + o, y0, -z + o), P(-x + o, y0, z - o), P(-x + o, y1, 0), g);
  };
  Mesh.prototype.cyl = function (cx, y0, cz, r, h, seg, col, em, r2) {
    var y1 = y0 + h, rt = r2 == null ? r : r2;
    for (var i = 0; i < seg; i++) {
      var a = i / seg * TAU, b = (i + 1) / seg * TAU;
      var p0 = [cx + Math.cos(a) * r, y0, cz + Math.sin(a) * r], p1 = [cx + Math.cos(b) * r, y0, cz + Math.sin(b) * r];
      var q0 = [cx + Math.cos(a) * rt, y1, cz + Math.sin(a) * rt], q1 = [cx + Math.cos(b) * rt, y1, cz + Math.sin(b) * rt];
      this.quad(p1, p0, q0, q1, col, em);
      if (rt > 0) this.tri([cx, y1, cz], q1, q0, col, em);
    }
  };
  Mesh.prototype.cone = function (cx, y0, cz, r, h, seg, col, em) { this.cyl(cx, y0, cz, r, h, seg, col, em, 0); };
  Mesh.prototype.disc = function (cx, y, cz, r, seg, col, em) {
    for (var i = 0; i < seg; i++) {
      var a = i / seg * TAU, b = (i + 1) / seg * TAU;
      this.tri([cx, y, cz], [cx + Math.cos(b) * r, y, cz + Math.sin(b) * r], [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r], col, em);
    }
  };
  /* A flat quad lying on the ground (or at height y), turned by rot. */
  Mesh.prototype.flat = function (cx, y, cz, w, d, col, em, rot) {
    var P = frame(cx, cz, rot), x = w / 2, z = d / 2;
    this.quad(P(-x, y, z), P(x, y, z), P(x, y, -z), P(-x, y, -z), col, em);
  };
  /* A heightfield of n×n cells over [x0, x0+size]², coloured by a function of the height. */
  Mesh.prototype.terrain = function (x0, z0, size, n, hf, cf) {
    var s = size / n;
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      var xa = x0 + i * s, za = z0 + j * s, xb = xa + s, zb = za + s;
      var a = [xa, hf(xa, za), za], b = [xa, hf(xa, zb), zb], c = [xb, hf(xb, zb), zb], d = [xb, hf(xb, za), za];
      var col = cf((a[1] + b[1] + c[1] + d[1]) / 4, xa + s / 2, za + s / 2);
      this.tri(a, b, c, col); this.tri(a, c, d, col);
    }
  };

  /* ---------- shaders ---------- */
  var VS = 'attribute vec3 p;attribute vec3 n;attribute vec3 c;attribute float e;uniform mat4 vp;' +
    'varying vec3 vP;varying vec3 vN;varying vec3 vC;varying float vE;' +
    'void main(){vP=p;vN=n;vC=c;vE=e;gl_Position=vp*vec4(p,1.);}';
  var FS = 'precision mediump float;varying vec3 vP;varying vec3 vN;varying vec3 vC;varying float vE;' +
    'uniform vec3 sunDir;uniform vec3 sunCol;uniform vec3 skyAmb;uniform vec3 gndAmb;uniform vec3 fogCol;uniform vec3 eye;uniform float fogD;' +
    'uniform vec4 lp[16];uniform vec3 lc[16];' +
    'void main(){vec3 N=normalize(vN);vec3 lit=mix(gndAmb,skyAmb,N.y*.5+.5)+sunCol*max(dot(N,sunDir),0.);' +
    'for(int i=0;i<16;i++){vec3 d=lp[i].xyz-vP;float r=length(d);float a=max(0.,1.-r/max(lp[i].w,.001));a*=a;lit+=lc[i]*a*(max(dot(N,d/max(r,.001)),0.)*.8+.2);}' +
    'vec3 col=mix(vC*lit,vC,vE);float dist=length(eye-vP);float f=1.-exp(-pow(dist*fogD,1.6));' +
    'gl_FragColor=vec4(mix(col,fogCol,clamp(f,0.,1.)),1.);}';
  var GVS = 'attribute vec3 p;attribute vec4 c;attribute float s;uniform mat4 vp;uniform float k;varying vec4 vC;' +
    'void main(){vC=c;gl_Position=vp*vec4(p,1.);gl_PointSize=clamp(s*k/gl_Position.w,1.,256.);}';
  var GFS = 'precision mediump float;varying vec4 vC;void main(){vec2 q=gl_PointCoord*2.-1.;float d=dot(q,q);if(d>1.)discard;' +
    'float a=exp(-d*4.);gl_FragColor=vec4(vC.rgb*vC.a*a,0.);}';

  function compile(gl, vs, fs) {
    function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  /* ---------- the world ---------- */
  V3.world = function (canvas, overlay, env) {
    var gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL is not available');
    var prog = compile(gl, VS, FS), gprog = compile(gl, GVS, GFS);
    var loc = {}, gloc = {};
    ['p', 'n', 'c', 'e'].forEach(function (k) { loc[k] = gl.getAttribLocation(prog, k); });
    ['vp', 'sunDir', 'sunCol', 'skyAmb', 'gndAmb', 'fogCol', 'eye', 'fogD', 'lp', 'lc'].forEach(function (k) { loc[k] = gl.getUniformLocation(prog, k); });
    ['p', 'c', 's'].forEach(function (k) { gloc[k] = gl.getAttribLocation(gprog, k); });
    ['vp', 'k'].forEach(function (k) { gloc[k] = gl.getUniformLocation(gprog, k); });
    var sbuf = gl.createBuffer(), dbuf = gl.createBuffer(), gbuf = gl.createBuffer();

    var W = {
      gl: gl, env: env, stat: new Mesh(), dyn: new Mesh(), glow: [], staticGlow: [], lights: [], labels: [],
      cam: { target: [0, 0, 0], yaw: .5, pitch: .5, dist: 30, fov: .75 },
      goal: null, onFrame: null, onPick: null, t: 0, idle: 0, vp: null, eye: [0, 0, 0], W: 1, H: 1,
    };
    var statCount = 0;
    W.build = function () {
      gl.bindBuffer(gl.ARRAY_BUFFER, sbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(W.stat.v), gl.STATIC_DRAW);
      statCount = W.stat.count;
    };
    /* glow sprites: {p:[x,y,z], c:[r,g,b], a, s} */
    W.addGlow = function (arr, p, c, a, s) { arr.push(p[0], p[1], p[2], c[0], c[1], c[2], a, s); };

    function resize() {
      var r = canvas.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      W.W = r.width; W.H = r.height; W.dpr = d;
    }

    function bindMesh(buf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      var S = 40;
      gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, S, 0);
      gl.enableVertexAttribArray(loc.n); gl.vertexAttribPointer(loc.n, 3, gl.FLOAT, false, S, 12);
      gl.enableVertexAttribArray(loc.c); gl.vertexAttribPointer(loc.c, 3, gl.FLOAT, false, S, 24);
      gl.enableVertexAttribArray(loc.e); gl.vertexAttribPointer(loc.e, 1, gl.FLOAT, false, S, 36);
    }

    W.project = function (p) {
      var m = W.vp, x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      if (w <= .01) return null;
      return { x: (x / w * .5 + .5) * W.W, y: (1 - (y / w * .5 + .5)) * W.H, w: w };
    };

    /* fly the camera to a target over ms */
    W.flyTo = function (g, ms) {
      var c = W.cam;
      var dy = (g.yaw == null ? c.yaw : g.yaw) - c.yaw;
      while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
      W.goal = { from: { target: c.target.slice(), yaw: c.yaw, pitch: c.pitch, dist: c.dist }, to: { target: g.target || c.target, yaw: c.yaw + dy, pitch: g.pitch == null ? c.pitch : g.pitch, dist: g.dist || c.dist }, t: 0, ms: ms || 1400 };
    };

    /* pointer: drag orbits, wheel and pinch zoom, a click picks */
    var drag = null, pts = {};
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId); pts[e.pointerId] = [e.clientX, e.clientY];
      drag = { x: e.clientX, y: e.clientY, moved: 0 }; W.goal = null; W.idle = 0;
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        var o = ids[0] == e.pointerId ? pts[ids[1]] : pts[ids[0]], old = pts[e.pointerId];
        var d0 = Math.hypot(old[0] - o[0], old[1] - o[1]), d1 = Math.hypot(e.clientX - o[0], e.clientY - o[1]);
        if (d0 > 0) W.cam.dist = clamp(W.cam.dist * d0 / d1, env.minDist || 6, env.maxDist || 120);
        pts[e.pointerId] = [e.clientX, e.clientY]; if (drag) drag.moved = 99; return;
      }
      var dx = e.clientX - pts[e.pointerId][0], dy = e.clientY - pts[e.pointerId][1];
      pts[e.pointerId] = [e.clientX, e.clientY];
      W.cam.yaw -= dx * .006; W.cam.pitch = clamp(W.cam.pitch + dy * .004, .12, 1.35);
      if (drag) drag.moved += Math.abs(dx) + Math.abs(dy);
    });
    function up(e) {
      delete pts[e.pointerId];
      if (drag && drag.moved < 6 && W.onPick) W.onPick(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top);
      drag = null;
    }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', function (e) { delete pts[e.pointerId]; drag = null; });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault(); W.goal = null; W.idle = 0;
      W.cam.dist = clamp(W.cam.dist * Math.exp(e.deltaY * .0012), env.minDist || 6, env.maxDist || 120);
    }, { passive: false });

    var last = 0, running = true;
    W.stop = function () { running = false; };
    W.start = function () { if (!running) { running = true; last = 0; requestAnimationFrame(frameFn); } };
    function frameFn(now) {
      if (!running) return;
      var dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now; W.t += dt; W.idle += dt;
      resize();
      var c = W.cam;
      if (W.goal) {
        var g = W.goal; g.t += dt * 1000; var k = V3.ease(clamp(g.t / g.ms, 0, 1));
        c.target = [0, 1, 2].map(function (i) { return g.from.target[i] + (g.to.target[i] - g.from.target[i]) * k; });
        c.yaw = g.from.yaw + (g.to.yaw - g.from.yaw) * k; c.pitch = g.from.pitch + (g.to.pitch - g.from.pitch) * k; c.dist = g.from.dist + (g.to.dist - g.from.dist) * k;
        if (g.t >= g.ms) W.goal = null;
      } else if (W.idle > 6 && env.drift) c.yaw += dt * env.drift;
      var eye = [c.target[0] + Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist, c.target[1] + Math.sin(c.pitch) * c.dist, c.target[2] + Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist];
      W.eye = eye;
      W.vp = mul(persp(c.fov, W.W / W.H, .3, 600), lookAt(eye, c.target, [0, 1, 0]));

      W.dyn.clear(); W.glow = W.staticGlow.slice(); W.lights = [];
      if (W.onFrame) W.onFrame(W.t, dt);

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(loc.vp, false, new Float32Array(W.vp));
      gl.uniform3fv(loc.sunDir, norm(env.sunDir)); gl.uniform3fv(loc.sunCol, env.sun); gl.uniform3fv(loc.skyAmb, env.skyAmb);
      gl.uniform3fv(loc.gndAmb, env.gndAmb); gl.uniform3fv(loc.fogCol, env.fog); gl.uniform3fv(loc.eye, eye); gl.uniform1f(loc.fogD, env.fogD);
      var lp = new Float32Array(64), lc = new Float32Array(48);
      W.lights.slice(0, 16).forEach(function (L, i) { lp.set([L.p[0], L.p[1], L.p[2], L.r], i * 4); lc.set(L.c, i * 3); });
      gl.uniform4fv(loc.lp, lp); gl.uniform3fv(loc.lc, lc);
      gl.disable(gl.CULL_FACE); // roofs and ends are wound both ways; cheap enough to draw both sides
      if (statCount) { bindMesh(sbuf); gl.drawArrays(gl.TRIANGLES, 0, statCount); }
      if (W.dyn.count) {
        gl.bindBuffer(gl.ARRAY_BUFFER, dbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(W.dyn.v), gl.DYNAMIC_DRAW);
        bindMesh(dbuf); gl.drawArrays(gl.TRIANGLES, 0, W.dyn.count);
      }
      [loc.n, loc.e].forEach(function (l) { gl.disableVertexAttribArray(l); });
      if (W.glow.length) {
        gl.useProgram(gprog);
        gl.uniformMatrix4fv(gloc.vp, false, new Float32Array(W.vp)); gl.uniform1f(gloc.k, W.H * W.dpr / (2 * Math.tan(c.fov / 2)));
        gl.bindBuffer(gl.ARRAY_BUFFER, gbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(W.glow), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(gloc.p); gl.vertexAttribPointer(gloc.p, 3, gl.FLOAT, false, 32, 0);
        gl.enableVertexAttribArray(gloc.c); gl.vertexAttribPointer(gloc.c, 4, gl.FLOAT, false, 32, 12);
        gl.enableVertexAttribArray(gloc.s); gl.vertexAttribPointer(gloc.s, 1, gl.FLOAT, false, 32, 28);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
        gl.drawArrays(gl.POINTS, 0, W.glow.length / 8);
        gl.depthMask(true); gl.disable(gl.BLEND);
        [gloc.p, gloc.c, gloc.s].forEach(function (l) { gl.disableVertexAttribArray(l); });
      }

      /* labels: {p, el, show(dist)} */
      W.labels.forEach(function (L) {
        var s = W.project(L.p), d = Math.hypot(eye[0] - L.p[0], eye[1] - L.p[1], eye[2] - L.p[2]);
        var on = s && (!L.show || L.show(d, W)) && s.x > -50 && s.x < W.W + 50 && s.y > -50 && s.y < W.H + 50;
        if (!on) { if (!L.el.hidden) L.el.hidden = true; return; }
        L.el.hidden = false; L.el.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px)';
        L.el.style.zIndex = String(1000 - Math.round(d));
        L.sx = s.x; L.sy = s.y;
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

  /* walking along a polyline at speed: returns {p, dir, done} */
  V3.along = function (path, d) {
    for (var i = 0; i < path.length - 1; i++) {
      var a = path[i], b = path[i + 1], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (d <= L) { var k = d / L; return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k], dir: Math.atan2(b[0] - a[0], b[2] - a[2]), done: false }; }
      d -= L;
    }
    var z = path[path.length - 1]; return { p: z.slice(), dir: 0, done: true };
  };
  V3.pathLen = function (path) { var s = 0; for (var i = 0; i < path.length - 1; i++) s += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][2] - path[i][2]); return s; };
})();
