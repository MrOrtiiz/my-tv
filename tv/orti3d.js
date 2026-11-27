/*
 * O.R.T.I. – den holografiska kärnan i skärmsläckaren (hemma; Inställningar → Hemskärm → Skärmsläckare: O.R.T.I.).
 *
 * Ren WebGL 1 i ES5 (Three.js går inte: koden i tv/ ska vara ES5, och TV:ns Chromium 85 klarar WebGL 1 bra).
 * En riktig 3D-scen med perspektivkamera: en partikelsfär med två energikärnor och en vitgul punkt, en kedja av små
 * ringar med ljuspulser, en gyllene kärna och två partikelskivor i sprängvy, diagonalt från vänster mot höger.
 *
 * Delar: Mat (matriser), Gfx (program och buffertar), bygg* (geometrin), State (lägena), Quality (kvalitetsnivåer),
 * Scene (ritningen). Allt syns via window.OrtiScene: create(canvas), start(), stop(), destroy(), setState(...).
 */
var OrtiScene = (function () {
  'use strict';

  // MARK: - Färger (briefens palett, 0–1)

  function hex(h) { return [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255]; }
  var C = {
    deep: hex('#061A35'), holo: hex('#1677D2'), blue: hex('#009DFF'), cyan: hex('#00CFFF'), core: hex('#B9F5FF'),
    white: hex('#DCEAF2'), gold: hex('#E8B94E'), warm: hex('#FFF1A0'), red: hex('#FF4141')
  };

  // MARK: - Mat: 4×4-matriser (kolumnvis, som WebGL)

  var Mat = {
    ident: function () { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
    mul: function (a, b) {
      var o = new Array(16), i, j;
      for (i = 0; i < 4; i++) for (j = 0; j < 4; j++)
        o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
      return o;
    },
    persp: function (fovy, aspect, near, far) {
      var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
    },
    look: function (e, c, up) {
      var z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(up, z)), y = cross(z, x);
      return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
        -dot(x, e), -dot(y, e), -dot(z, e), 1];
    },
    trans: function (v) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1]; },
    /** Rotation kring en axel (normerad). */
    rot: function (ax, a) {
      var c = Math.cos(a), s = Math.sin(a), t = 1 - c, x = ax[0], y = ax[1], z = ax[2];
      return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
        t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
        t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
    },
    /** Vrider lokala y-axeln till riktningen n (en skivas normal). */
    alignY: function (n) {
      n = norm(n);
      var ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], x = norm(cross(ref, n)), z = cross(x, n);
      return [x[0], x[1], x[2], 0, n[0], n[1], n[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1];
    },
    scale: function (s) { return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]; }
  };
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

  // Samma slump varje gång (samma bild varje kväll), men olika per del.
  var seed = 1;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  function reseed(s) { seed = s; }

  // MARK: - Shaders

  // Punkter: egen vridning (aSpin) för en del partiklar, blinkande fragment (aPhase ≥ 10), mjuka runda punkter.
  var VS_POINTS = [
    'attribute vec3 aPos; attribute vec3 aCol; attribute float aSize; attribute float aPhase; attribute float aSpin;',
    'uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;',
    'uniform float uTime; uniform float uScale; uniform float uBright; uniform float uTwinkle; uniform float uPulse;',
    'uniform vec3 uTint; uniform float uTintAmt;',
    'varying vec3 vCol; varying float vA;',
    'void main() {',
    '  vec3 p = aPos;',
    '  float a = uTime * aSpin;',
    '  float c = cos(a); float s = sin(a);',
    '  p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);',
    '  vec4 mv = uView * uModel * vec4(p, 1.0);',
    '  gl_Position = uProj * mv;',
    '  float ph = mod(aPhase, 10.0);',
    '  float tw = 0.62 + 0.38 * sin(uTime * (0.6 + fract(ph * 7.31) * 1.8) + ph * 6.2832);',
    '  float fl = aPhase >= 10.0 ? step(0.55, sin(uTime * (0.35 + fract(ph * 3.7) * 0.6) + ph * 9.0)) : 1.0;',
    '  gl_PointSize = max(1.0, aSize * uScale * (1.0 + uPulse * 0.35) / -mv.z);',
    '  vA = uBright * mix(1.0, tw, uTwinkle) * fl;',
    '  vCol = mix(aCol, uTint, uTintAmt);',
    '}'
  ].join('\n');
  var FS_POINTS = [
    'precision mediump float;',
    'varying vec3 vCol; varying float vA;',
    'void main() {',
    '  vec2 d = gl_PointCoord - vec2(0.5);',
    '  float r = length(d) * 2.0;',
    '  float a = clamp(1.0 - r, 0.0, 1.0);',
    '  a = a * a * (0.55 + 0.45 * a);',
    '  gl_FragColor = vec4(vCol * vA * a, 1.0);',
    '}'
  ].join('\n');
  var VS_LINES = [
    'attribute vec3 aPos; attribute vec3 aCol; attribute float aSize; attribute float aPhase; attribute float aSpin;',
    'uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;',
    'uniform float uTime; uniform float uBright; uniform float uTwinkle;',
    'uniform vec3 uTint; uniform float uTintAmt;',
    'varying vec3 vCol; varying float vA;',
    'void main() {',
    '  vec3 p = aPos;',
    '  float a = uTime * aSpin;',
    '  float c = cos(a); float s = sin(a);',
    '  p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);',
    '  gl_Position = uProj * uView * uModel * vec4(p, 1.0);',
    '  float ph = mod(aPhase, 10.0);',
    '  float tw = 0.6 + 0.4 * sin(uTime * (0.4 + fract(ph * 5.13) * 1.2) + ph * 6.2832);',
    '  float fl = aPhase >= 10.0 ? step(0.4, sin(uTime * (0.3 + fract(ph * 2.9) * 0.5) + ph * 7.0)) : 1.0;',
    '  vA = uBright * aSize * mix(1.0, tw, uTwinkle) * fl;',
    '  vCol = mix(aCol, uTint, uTintAmt);',
    '}'
  ].join('\n');
  var FS_LINES = [
    'precision mediump float;',
    'varying vec3 vCol; varying float vA;',
    'void main() { gl_FragColor = vec4(vCol * vA, 1.0); }'
  ].join('\n');

  // Sken: en fyrkant mot kameran med mjuk avtoning (ingen gräns för storleken, som punkter kan ha).
  var VS_HALO = [
    'attribute vec2 aCorner;',
    'uniform vec2 uCenter; uniform vec2 uRadius;',
    'varying vec2 vUV;',
    'void main() { vUV = aCorner; gl_Position = vec4(uCenter + aCorner * uRadius, 0.0, 1.0); }'
  ].join('\n');
  var FS_HALO = [
    'precision mediump float;',
    'uniform vec3 uColor; uniform float uAlpha;',
    'varying vec2 vUV;',
    'void main() { float r = length(vUV); float a = exp(-r * r * 4.5) * (1.0 - smoothstep(0.85, 1.0, r)); gl_FragColor = vec4(uColor * a * uAlpha, 1.0); }'
  ].join('\n');

  // MARK: - Geometri: en "byggare" samlar punkter eller linjer (9 tal per hörn)

  var STRIDE = 9;
  function Builder() { this.d = []; }
  Builder.prototype.v = function (p, col, size, phase, spin) {
    this.d.push(p[0], p[1], p[2], col[0], col[1], col[2], size, phase || 0, spin || 0);
  };
  /** En linje; "size" används som linjens ljusstyrka (0–1). */
  Builder.prototype.l = function (a, b, col, alpha, phase, spin) {
    this.v(a, col, alpha, phase, spin);
    this.v(b, col, alpha, phase, spin);
  };
  Builder.prototype.count = function () { return this.d.length / STRIDE; };

  function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function dim(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function onSphere() {
    var u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    return [s * Math.cos(t), u, s * Math.sin(t)];
  }

  /** Ett sken av många mjuka punkter (en enda stor punkt kan vara för stor för TV:ns grafikkrets). */
  function glow(P, c, r, col, n, k) {
    for (var i = 0; i < n; i++) {
      var d = onSphere(), rr = r * Math.pow(rnd(), 1.6);
      P.v([c[0] + d[0] * rr, c[1] + d[1] * rr * 0.9, c[2] + d[2] * rr], dim(col, k * (1 - rr / r * 0.7)), 70 + rnd() * 70, rnd() * 10, 0);
    }
  }

  /** Lager A: den stora partikelsfären (punkter på flera skal, fragment, linjesegment, radiella markeringar). */
  function buildSphere(q) {
    reseed(11);
    var P = new Builder(), L = new Builder(), i, n, p, r, col;
    for (i = 0; i < q.sphere; i++) {
      n = onSphere();
      var shell = rnd();
      r = shell < 0.55 ? 0.93 + rnd() * 0.1 : shell < 0.8 ? 0.7 + rnd() * 0.2 : shell < 0.93 ? 1.04 + rnd() * 0.12 : 0.35 + rnd() * 0.3;
      p = [n[0] * r, n[1] * r, n[2] * r];
      var pick = rnd();
      col = pick < 0.05 ? C.gold : pick < 0.35 ? C.cyan : pick < 0.75 ? C.blue : C.holo;
      var a = r > 1.03 ? 0.35 : r < 0.66 ? 0.5 : 0.7;
      P.v(p, dim(col, a * (0.45 + rnd() * 0.55)), 7 + rnd() * 13, rnd() * 10 + (rnd() < 0.12 ? 10 : 0), rnd() < 0.18 ? (rnd() - 0.5) * 0.5 : 0);
    }
    // Tätare moln kring kärnorna (den ljusa delen i sfärens mitt)
    for (i = 0; i < q.sphere * 0.18; i++) {
      n = onSphere(); r = Math.pow(rnd(), 0.7) * 0.55;
      p = [n[0] * r * 1.3, n[1] * r * 0.7, n[2] * r];
      P.v(p, dim(rnd() < 0.5 ? C.cyan : C.blue, 0.35 + rnd() * 0.4), 8 + rnd() * 10, rnd() * 10, (rnd() - 0.5) * 0.6);
    }
    // Linjesegment och små digitala fragment, tangentiellt mot skalet.
    for (i = 0; i < q.segs; i++) {
      n = onSphere();
      r = 0.88 + rnd() * 0.22;
      p = [n[0] * r, n[1] * r, n[2] * r];
      var t = norm(cross(n, onSphere())), len = 0.015 + rnd() * rnd() * 0.09;
      col = rnd() < 0.06 ? C.gold : rnd() < 0.5 ? C.cyan : C.blue;
      L.l(p, add(p, [t[0] * len, t[1] * len, t[2] * len]), col, 0.25 + rnd() * 0.45, rnd() * 10 + (rnd() < 0.2 ? 10 : 0), rnd() < 0.15 ? (rnd() - 0.5) * 0.4 : 0);
    }
    // Diskreta radiella markeringar.
    for (i = 0; i < q.radial; i++) {
      n = onSphere();
      var r0 = 1.0 + rnd() * 0.08, r1 = r0 + 0.04 + rnd() * 0.16;
      L.l([n[0] * r0, n[1] * r0, n[2] * r0], [n[0] * r1, n[1] * r1, n[2] * r1], C.holo, 0.22 + rnd() * 0.3, rnd() * 10, 0);
    }
    // Några latitudbågar i skalet, glest prickade (den tekniska strukturen).
    for (i = 0; i < 7; i++) {
      var lat = (i / 6 - 0.5) * 2.2, cr = Math.cos(lat), y = Math.sin(lat);
      for (var k = 0; k < 140; k++) {
        if (rnd() < 0.45) continue;
        var ang = k / 140 * Math.PI * 2;
        P.v([Math.cos(ang) * cr * 0.99, y * 0.99, Math.sin(ang) * cr * 0.99], dim(C.cyan, 0.55), 6, rnd() * 10, 0);
      }
    }
    return {points: P, lines: L};
  }

  /** Lager B: en energikärna (mittpunkt, koncentriska ringar, roterande partiklar, symboler, radiella linjer). */
  function buildCore(q, s, tint) {
    reseed(s);
    var P = new Builder(), L = new Builder(), i, k;
    glow(P, [0, 0, 0], 0.3, C.blue, 160, 0.09);       // ljusspridningen
    glow(P, [0, 0, 0], 0.08, C.core, 40, 0.22);
    P.v([0, 0, 0], [1, 1, 1], 40, 2.1, 0);            // den intensiva mittpunkten
    P.v([0, 0, 0], C.core, 60, 1.1, 0);
    for (k = 1; k <= q.coreRings; k++) {
      var r = 0.06 + k * 0.045, cnt = Math.round(30 + k * 16);
      for (i = 0; i < cnt; i++) {
        if (rnd() < 0.18) continue;
        var a = i / cnt * Math.PI * 2;
        var col = k % 3 === 0 ? tint : k % 2 ? C.cyan : C.core;
        P.v([Math.cos(a) * r, (rnd() - 0.5) * 0.01, Math.sin(a) * r], dim(col, 0.8 + rnd() * 0.2), 11 + (k % 2) * 6, rnd() * 10 + (k === 4 ? 10 : 0), (k % 2 ? 1 : -1) * (0.25 + k * 0.05));
      }
      // ringarna som tunna linjer, i bågar
      var segs = 64, from = rnd() * 6, len = 2 + rnd() * 3.5;
      for (i = 0; i < segs; i++) {
        var a0 = from + i / segs * len, a1 = from + (i + 1) / segs * len;
        L.l([Math.cos(a0) * (r + 0.012), 0, Math.sin(a0) * (r + 0.012)], [Math.cos(a1) * (r + 0.012), 0, Math.sin(a1) * (r + 0.012)], C.blue, 0.45, k, (k % 2 ? -1 : 1) * 0.2);
      }
    }
    for (i = 0; i < 28; i++) {
      var b = i / 28 * Math.PI * 2, r0 = 0.08 + rnd() * 0.05, r1 = 0.3 + rnd() * 0.18;
      L.l([Math.cos(b) * r0, 0, Math.sin(b) * r0], [Math.cos(b) * r1, (rnd() - 0.5) * 0.06, Math.sin(b) * r1], C.cyan, 0.08 + rnd() * 0.14, rnd() * 10, 0.15);
    }
    // små "symboler": korta parallella streck runt kärnan
    for (i = 0; i < 26; i++) {
      var c = rnd() * Math.PI * 2, rr = 0.34 + rnd() * 0.08, x = Math.cos(c) * rr, z = Math.sin(c) * rr;
      L.l([x, 0, z], [x + Math.cos(c + 1.57) * 0.025, 0, z + Math.sin(c + 1.57) * 0.025], C.white, 0.5, 10 + rnd() * 10, 0.1);
    }
    return {points: P, lines: L};
  }

  /** Lager C: en liten ring i kedjan (en sluten linje), med prickar. */
  function buildRing(r, s) {
    reseed(s);
    var P = new Builder(), L = new Builder(), segs = 40, i;
    for (i = 0; i < segs; i++) {
      var a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
      L.l([Math.cos(a0) * r, 0, Math.sin(a0) * r], [Math.cos(a1) * r, 0, Math.sin(a1) * r], rnd() < 0.15 ? C.gold : C.cyan, 0.55, rnd() * 10, 0);
    }
    for (i = 0; i < 10; i++) { var a = rnd() * Math.PI * 2; P.v([Math.cos(a) * r, 0, Math.sin(a) * r], C.white, 9, rnd() * 10, 0); }
    return {points: P, lines: L};
  }

  /** Lager D: den gyllene kärnan (ringar, markeringar, guld och vita partiklar, segment, mörkt yttre lager). */
  function buildGold(q) {
    reseed(77);
    var P = new Builder(), L = new Builder(), i, k;
    glow(P, [0, 0, 0], 0.28, C.gold, 110, 0.08);
    glow(P, [0, 0, 0], 0.08, C.warm, 36, 0.22);
    P.v([0, 0, 0], [1, 1, 1], 34, 3.7, 0);
    for (k = 1; k <= 9; k++) {
      var r = 0.06 + k * 0.075, cnt = Math.round(24 + k * 22);
      for (i = 0; i < cnt; i++) {
        if (rnd() < 0.3) continue;
        var a = i / cnt * Math.PI * 2, col = k < 4 ? (rnd() < 0.7 ? C.gold : C.warm) : rnd() < 0.25 ? C.gold : rnd() < 0.5 ? C.white : C.cyan;
        P.v([Math.cos(a) * r, (rnd() - 0.5) * 0.015, Math.sin(a) * r], dim(col, k < 4 ? 1 : 0.7), 10 + rnd() * 8, rnd() * 10, 0);
      }
      if (k % 2 === 0) {
        var from = rnd() * 6;
        for (i = 0; i < 48; i++) {
          var a0 = from + i / 48 * 3.2, a1 = from + (i + 1) / 48 * 3.2;
          L.l([Math.cos(a0) * r, 0, Math.sin(a0) * r], [Math.cos(a1) * r, 0, Math.sin(a1) * r], k < 5 ? C.gold : C.blue, 0.5, k, 0);
        }
      }
    }
    for (i = 0; i < 160; i++) {
      var t = i / 160 * Math.PI * 2, r0 = 0.74, r1 = i % 5 ? 0.77 : 0.8;
      L.l([Math.cos(t) * r0, 0, Math.sin(t) * r0], [Math.cos(t) * r1, 0, Math.sin(t) * r1], C.white, 0.35, rnd() * 10, 0);
    }
    // det mörka, genomskinliga yttre lagret: många svaga, djupblå punkter
    for (i = 0; i < q.goldOuter; i++) {
      var rr = 0.8 + Math.sqrt(rnd()) * 0.32, b = rnd() * Math.PI * 2;
      P.v([Math.cos(b) * rr, (rnd() - 0.5) * 0.04, Math.sin(b) * rr], dim(C.holo, 0.35), 6 + rnd() * 6, rnd() * 10, 0);
    }
    return {points: P, lines: L};
  }

  /** Lager E och F: en partikelskiva med täthetsband, tydlig kant, koncentriska ringar och synligt djup. */
  function buildDisc(q, s, n) {
    reseed(s);
    var P = new Builder(), L = new Builder(), i, thick = 0.075;
    for (i = 0; i < n; i++) {
      var r = Math.sqrt(rnd());
      var band = 0.45 + 0.55 * Math.abs(Math.sin(r * 11.0 + s));
      if (rnd() > band) { r = Math.sqrt(rnd()); }
      var a = rnd() * Math.PI * 2, y = (rnd() - 0.5) * thick * (0.4 + r);
      var col = rnd() < 0.08 ? C.cyan : rnd() < 0.55 ? C.blue : C.holo;
      var k = (0.4 + 0.6 * r) * (0.5 + rnd() * 0.5);
      P.v([Math.cos(a) * r, y, Math.sin(a) * r], dim(col, k), 9 + rnd() * 12, rnd() * 10 + (rnd() < 0.08 ? 10 : 0), 0);
    }
    // kanten: tät, ljusare, i två skikt (djupet)
    for (i = 0; i < q.rim; i++) {
      var b = rnd() * Math.PI * 2, rr = 0.96 + rnd() * 0.05, yy = rnd() < 0.5 ? -thick : thick;
      P.v([Math.cos(b) * rr, yy * (rnd() * 2 - 1), Math.sin(b) * rr], dim(rnd() < 0.3 ? C.cyan : C.blue, 0.95), 10 + rnd() * 8, rnd() * 10, 0);
    }
    for (var side = -1; side <= 1; side += 2) {
      for (i = 0; i < 180; i++) {
        var t0 = i / 180 * Math.PI * 2, t1 = (i + 1) / 180 * Math.PI * 2;
        L.l([Math.cos(t0), side * thick, Math.sin(t0)], [Math.cos(t1), side * thick, Math.sin(t1)], C.cyan, side > 0 ? 0.55 : 0.3, 0, 0);
      }
    }
    for (i = 0; i < 240; i++) {   // tekniska markeringar på kanten
      var c = i / 240 * Math.PI * 2, r1 = i % 6 ? 1.03 : 1.08;
      L.l([Math.cos(c), thick, Math.sin(c)], [Math.cos(c) * r1, thick, Math.sin(c) * r1], C.white, 0.35, rnd() * 10, 0);
    }
    for (var ring = 1; ring <= 5; ring++) {
      var rr2 = ring * 0.17, from = rnd() * 6, len = 3 + rnd() * 3;
      for (i = 0; i < 90; i++) {
        var a0 = from + i / 90 * len, a1 = from + (i + 1) / 90 * len;
        L.l([Math.cos(a0) * rr2, thick, Math.sin(a0) * rr2], [Math.cos(a1) * rr2, thick, Math.sin(a1) * rr2], ring === 3 ? C.cyan : C.holo, 0.2, ring, (ring % 2 ? 1 : -1) * 0.04);
      }
    }
    return {points: P, lines: L};
  }

  /** Lösa partiklar i rymden mellan delarna (djup och parallax). */
  function buildDust(q) {
    reseed(5);
    var P = new Builder();
    for (var i = 0; i < q.dust; i++) {
      var p = [-5 + rnd() * 10.5, -2.6 + rnd() * 4.8, -3 + rnd() * 5];
      P.v(p, dim(rnd() < 0.1 ? C.gold : C.blue, 0.25 + rnd() * 0.35), 5 + rnd() * 6, rnd() * 10 + 10, 0);
    }
    return {points: P};
  }

  // MARK: - Kvalitetsnivåer

  var QUALITY = {
    low: {res: 0.6, fps: 30, sphere: 9000, segs: 1800, radial: 120, coreRings: 5, rings: 12, goldOuter: 700, disc1: 3800, disc2: 3400, rim: 700, dust: 250},
    medium: {res: 0.85, fps: 30, sphere: 22000, segs: 4200, radial: 220, coreRings: 6, rings: 16, goldOuter: 1600, disc1: 9000, disc2: 8000, rim: 1400, dust: 600},
    ultra: {res: 1, fps: 60, sphere: 44000, segs: 8000, radial: 320, coreRings: 7, rings: 20, goldOuter: 3000, disc1: 18000, disc2: 16000, rim: 2600, dust: 1100}
  };

  // MARK: - Lägen (IDLE, LISTENING, THINKING, SPEAKING, SUCCESS, ALERT): mjuka övergångar

  var STATES = {
    idle: {bright: 0.95, speed: 1, tint: C.deep, tintAmt: 0, pulse: 0, ring: 0},
    listening: {bright: 1.05, speed: 1.3, tint: C.cyan, tintAmt: 0.25, pulse: 0.2, ring: 0.6},
    thinking: {bright: 1, speed: 2.2, tint: C.gold, tintAmt: 0.12, pulse: 0.1, ring: 0.2},
    speaking: {bright: 1.1, speed: 1.4, tint: C.core, tintAmt: 0.15, pulse: 0.3, ring: 0.3},
    success: {bright: 1.25, speed: 1.2, tint: C.core, tintAmt: 0.35, pulse: 0.5, ring: 0.5},
    alert: {bright: 0.9, speed: 0.9, tint: C.red, tintAmt: 0.22, pulse: 0.15, ring: 0}
  };

  // MARK: - Scenen

  function create(canvas, opts) {
    opts = opts || {};
    var gl = null, progP = null, progL = null, progH = null, quad = null, halos = [], objs = [], pulseBuf = null, pulseData = null, raf = 0, running = false;
    var level = opts.quality === 'low' || opts.quality === 'ultra' ? opts.quality : 'medium';
    var auto = !opts.quality || opts.quality === 'auto';
    var q = QUALITY[level], t0 = Date.now(), simT = 0, lastNow = 0, lastDraw = 0, lost = false;
    var cur = {bright: 0.8, speed: 1, tint: C.deep.slice(), tintAmt: 0, pulse: 0, ring: 0}, target = STATES.idle, stateName = 'idle';
    var audio = 0, userBright = opts.brightness || 1, userSpeed = opts.speed || 1, night = 1;
    var perf = {frames: 0, slow: 0, fast: 0, since: 0, fps: 0}, chainPts = [];

    function ctx() {
      var o = {alpha: false, antialias: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance'};
      return canvas.getContext('webgl', o) || canvas.getContext('experimental-webgl', o);
    }
    function shader(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    function program(vs, fs) {
      var p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      var u = {}, names = ['uProj', 'uView', 'uModel', 'uTime', 'uScale', 'uBright', 'uTwinkle', 'uPulse', 'uTint', 'uTintAmt'];
      for (var i = 0; i < names.length; i++) u[names[i]] = gl.getUniformLocation(p, names[i]);
      var a = {pos: gl.getAttribLocation(p, 'aPos'), col: gl.getAttribLocation(p, 'aCol'), size: gl.getAttribLocation(p, 'aSize'),
        phase: gl.getAttribLocation(p, 'aPhase'), spin: gl.getAttribLocation(p, 'aSpin')};
      return {p: p, u: u, a: a};
    }
    function buffer(b, dynamic) {
      if (!b || !b.count()) return null;
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.d), dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      return {buf: buf, n: b.count()};
    }
    /** En del av scenen: punkter och linjer, med en funktion som ger modellmatrisen vid tiden t. */
    function obj(g, model, opt) {
      objs.push({pts: buffer(g.points), lines: buffer(g.lines), model: model, twinkle: opt && opt.twinkle !== undefined ? opt.twinkle : 0.6,
        bright: opt && opt.bright || 1, layer: opt && opt.layer || 'blue'});
    }

    // Platserna i världen: sfären till vänster, kedjan, den gyllene kärnan och skivorna diagonalt åt höger.
    var S = [-2.35, 0.35, -0.2], SR = 1.45;
    var GOLD = [0.55, -0.42, 0.3], DISC1 = [1.95, -0.6, 0.15], DISC2 = [3.2, -0.72, -0.1];
    var DISC_N = norm([1, 0.1, 0.62]);

    function build() {
      gl = ctx();
      if (!gl) return false;
      progP = program(VS_POINTS, FS_POINTS);
      progL = program(VS_LINES, FS_LINES);
      progH = gl.createProgram();
      gl.attachShader(progH, shader(gl.VERTEX_SHADER, VS_HALO));
      gl.attachShader(progH, shader(gl.FRAGMENT_SHADER, FS_HALO));
      gl.linkProgram(progH);
      progH.loc = {corner: gl.getAttribLocation(progH, 'aCorner'), center: gl.getUniformLocation(progH, 'uCenter'),
        radius: gl.getUniformLocation(progH, 'uRadius'), color: gl.getUniformLocation(progH, 'uColor'), alpha: gl.getUniformLocation(progH, 'uAlpha')};
      quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
      objs = [];
      var sph = buildSphere(q), tilt = norm([0.25, 1, 0.12]);
      obj(sph, function (t) { return Mat.mul(Mat.trans(S), Mat.mul(Mat.rot(tilt, t * 0.035), Mat.scale(SR))); }, {twinkle: 0.55});
      // Två energikärnor inne i sfären, var sin vridning och lutning, och en vitgul punkt bredvid
      var c1 = add(S, [-0.42, 0.18, 0.35]), c2 = add(S, [0.46, 0.02, 0.2]), ax1 = norm([0.3, 1, 0.5]), ax2 = norm([-0.2, 1, 0.6]);
      obj(buildCore(q, 21, C.cyan), function (t) { return Mat.mul(Mat.trans(c1), Mat.mul(Mat.alignY(ax1), Mat.mul(Mat.rot([0, 1, 0], t * 0.32), Mat.scale(1.7)))); }, {twinkle: 0.4, layer: 'core'});
      obj(buildCore(q, 33, C.gold), function (t) { return Mat.mul(Mat.trans(c2), Mat.mul(Mat.alignY(ax2), Mat.mul(Mat.rot([0, 1, 0], -t * 0.24), Mat.scale(1.5)))); }, {twinkle: 0.4, layer: 'core'});
      var spark = new Builder();
      spark.v([0, 0, 0], C.warm, 120, 0.5, 0);
      spark.v([0, 0, 0], [1, 1, 1], 30, 0.9, 0);
      var c3 = add(S, [0.95, -0.38, 0.45]);
      obj({points: spark}, function () { return Mat.trans(c3); }, {twinkle: 0.5, layer: 'core'});
      // Kedjan av små ringar längs en kurva från sfären till den gyllene kärnan
      chainPts = [];
      var A = add(S, [1.55, -0.25, 0.1]);
      for (var i = 0; i < q.rings; i++) {
        var u = i / (q.rings - 1);
        var p = [A[0] + (GOLD[0] - A[0] - 0.5) * u, A[1] + (GOLD[1] - A[1]) * u + Math.sin(u * Math.PI) * 0.18, A[2] + (GOLD[2] - A[2]) * u + Math.sin(u * 7) * 0.16];
        chainPts.push(p);
        (function (pos, k) {
          reseed(300 + k);
          var ax = norm([1, 0.3 + rnd() * 0.6, rnd() - 0.5]), spinAx = norm([rnd() - 0.5, 1, rnd() - 0.5]), sp = (rnd() - 0.5) * 0.9;
          var sc = 0.1 + rnd() * 0.13;
          obj(buildRing(1, 400 + k), function (t) { return Mat.mul(Mat.trans(pos), Mat.mul(Mat.alignY(ax), Mat.mul(Mat.rot(spinAx, t * sp), Mat.scale(sc * (1 + cur.ring * 0.25 * Math.sin(t * 2 + k)))))); }, {twinkle: 0.3, layer: 'ring'});
        })(p, i);
      }
      var goldAx = norm([1, 0.2, 0.85]);
      obj(buildGold(q), function (t) { return Mat.mul(Mat.trans(GOLD), Mat.mul(Mat.alignY(goldAx), Mat.mul(Mat.rot([0, 1, 0], t * 0.09), Mat.scale(0.95)))); }, {twinkle: 0.5, layer: 'gold'});
      obj(buildDisc(q, 3, q.disc1), function (t) { return Mat.mul(Mat.trans(DISC1), Mat.mul(Mat.alignY(DISC_N), Mat.mul(Mat.rot([0, 1, 0], t * 0.045), Mat.scale(1.45)))); }, {twinkle: 0.35});
      obj(buildDisc(q, 9, q.disc2), function (t) { return Mat.mul(Mat.trans(DISC2), Mat.mul(Mat.alignY(norm([1, 0.06, 0.7])), Mat.mul(Mat.rot([0, 1, 0], -t * 0.032), Mat.scale(1.6)))); }, {twinkle: 0.35});
      obj(buildDust(q), function () { return Mat.ident(); }, {twinkle: 1});
      // Skenen: [plats, radie (världsenheter), färg, styrka, pulserar med ljudet/lägena]
      halos = [[S, 2.2, C.holo, 0.16, 0], [c1, 0.75, C.blue, 0.55, 1], [c1, 0.22, C.core, 0.7, 1], [c2, 0.65, C.cyan, 0.45, 1], [c2, 0.2, C.core, 0.65, 1],
        [c3, 0.2, C.warm, 0.5, 1], [GOLD, 0.7, C.gold, 0.3, 0], [GOLD, 0.18, C.warm, 0.7, 0], [DISC1, 1.5, C.blue, 0.1, 0], [DISC2, 1.6, C.blue, 0.09, 0]];
      // Informationspulserna: åtta punkter som vandrar längs kedjan (uppdateras varje bildruta)
      pulseData = new Float32Array(8 * 2 * STRIDE);
      pulseBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pulseBuf);
      gl.bufferData(gl.ARRAY_BUFFER, pulseData, gl.DYNAMIC_DRAW);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.clearColor(0, 0, 0, 1);
      return true;
    }

    function freeGL() {
      if (!gl) return;
      for (var i = 0; i < objs.length; i++) {
        if (objs[i].pts) gl.deleteBuffer(objs[i].pts.buf);
        if (objs[i].lines) gl.deleteBuffer(objs[i].lines.buf);
      }
      if (pulseBuf) gl.deleteBuffer(pulseBuf);
      if (progP) gl.deleteProgram(progP.p);
      if (progL) gl.deleteProgram(progL.p);
      if (progH) gl.deleteProgram(progH);
      if (quad) gl.deleteBuffer(quad);
      progH = null; quad = null; halos = [];
      objs = []; pulseBuf = null; progP = progL = null;
    }

    function resize() {
      var stage = document.getElementById('stage'), scale = 1;
      if (stage && stage.getBoundingClientRect) scale = Math.max(0.5, stage.getBoundingClientRect().width / 1920);
      var w = Math.round(1920 * Math.min(2, scale) * q.res), h = Math.round(w * 9 / 16);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (gl) gl.viewport(0, 0, w, h);
    }

    function bindAttribs(pr, buf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      var a = pr.a, s = STRIDE * 4;
      gl.enableVertexAttribArray(a.pos); gl.vertexAttribPointer(a.pos, 3, gl.FLOAT, false, s, 0);
      gl.enableVertexAttribArray(a.col); gl.vertexAttribPointer(a.col, 3, gl.FLOAT, false, s, 12);
      gl.enableVertexAttribArray(a.size); gl.vertexAttribPointer(a.size, 1, gl.FLOAT, false, s, 24);
      gl.enableVertexAttribArray(a.phase); gl.vertexAttribPointer(a.phase, 1, gl.FLOAT, false, s, 28);
      gl.enableVertexAttribArray(a.spin); gl.vertexAttribPointer(a.spin, 1, gl.FLOAT, false, s, 32);
    }

    function uniforms(pr, proj, view, t) {
      gl.useProgram(pr.p);
      gl.uniformMatrix4fv(pr.u.uProj, false, proj);
      gl.uniformMatrix4fv(pr.u.uView, false, view);
      gl.uniform1f(pr.u.uTime, t);
      if (pr.u.uScale) gl.uniform1f(pr.u.uScale, canvas.height / 1080 * 2.4);
      if (pr.u.uPulse) gl.uniform1f(pr.u.uPulse, cur.pulse * (0.5 + 0.5 * Math.sin(t * 3)) + audio);
      gl.uniform3fv(pr.u.uTint, cur.tint);
      gl.uniform1f(pr.u.uTintAmt, cur.tintAmt);
    }

    function updatePulses(t) {
      if (chainPts.length < 2) return;
      var n = chainPts.length, k = 0;
      for (var i = 0; i < 8; i++) {
        var u = (t * (0.07 + (i % 3) * 0.025) + i / 8) % 1;
        var f = u * (n - 1), j = Math.floor(f), w = f - j, a = chainPts[j], b = chainPts[Math.min(n - 1, j + 1)];
        var p = [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
        var col = stateName === 'thinking' || i % 4 === 0 ? C.gold : C.core;
        var glow = Math.sin(u * Math.PI);
        var arr = [[p, col, 34 * glow, 0.2], [p, [1, 1, 1], 11 * glow, 0.4]];
        for (var m = 0; m < 2; m++) {
          pulseData.set([arr[m][0][0], arr[m][0][1], arr[m][0][2], arr[m][1][0], arr[m][1][1], arr[m][1][2], arr[m][2], arr[m][3], 0], k);
          k += STRIDE;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, pulseBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pulseData);
    }

    function draw(now) {
      // Lägena glider mot målet (ingen hård växling)
      var k = 0.04;
      cur.bright += (target.bright - cur.bright) * k;
      cur.speed += (target.speed - cur.speed) * k;
      cur.tintAmt += (target.tintAmt - cur.tintAmt) * k;
      cur.pulse += (target.pulse - cur.pulse) * k;
      cur.ring += (target.ring - cur.ring) * k;
      for (var c = 0; c < 3; c++) cur.tint[c] += (target.tint[c] - cur.tint[c]) * k;
      if (stateName === 'success' && Date.now() - successAt > 1800) setState('idle');
      var dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      simT += dt * cur.speed * userSpeed * (night < 1 ? 0.75 : 1);
      var t = simT;
      // Kameran: långsam, asymmetrisk rörelse (ingen snabb zoom eller rotation)
      var cam = [-0.9 + Math.sin(t * 0.021) * 0.5, 1.25 + Math.sin(t * 0.017 + 1) * 0.2, 8.4 + Math.sin(t * 0.013) * 0.3];
      var view = Mat.look(cam, [0.3 + Math.sin(t * 0.011) * 0.12, -0.42, 0], [0, 1, 0]);
      var proj = Mat.persp(36 * Math.PI / 180, canvas.width / canvas.height, 0.1, 60);
      gl.clear(gl.COLOR_BUFFER_BIT);
      var bright = cur.bright * userBright * night;
      updatePulses(t);
      for (var pass = 0; pass < 2; pass++) {
        var pr = pass === 0 ? progL : progP;
        uniforms(pr, proj, view, t);
        for (var i = 0; i < objs.length; i++) {
          var o = objs[i], b = pass === 0 ? o.lines : o.pts;
          if (!b) continue;
          var lb = bright * o.bright * (o.layer === 'core' ? 1 + audio * 0.8 + cur.pulse * 0.4 : 1);
          gl.uniformMatrix4fv(pr.u.uModel, false, o.model(t));
          gl.uniform1f(pr.u.uBright, lb);
          gl.uniform1f(pr.u.uTwinkle, o.twinkle);
          bindAttribs(pr, b.buf);
          gl.drawArrays(pass === 0 ? gl.LINES : gl.POINTS, 0, b.n);
        }
      }
      uniforms(progP, proj, view, t);
      gl.uniformMatrix4fv(progP.u.uModel, false, Mat.ident());
      gl.uniform1f(progP.u.uBright, bright);
      gl.uniform1f(progP.u.uTwinkle, 0);
      bindAttribs(progP, pulseBuf);
      gl.drawArrays(gl.POINTS, 0, 16);
      drawHalos(Mat.mul(proj, view), bright);
    }

    /** Skenen sist, ovanpå (additivt): mitten projiceras, radien följer avståndet. */
    function drawHalos(pv, bright) {
      gl.useProgram(progH);
      for (var a = 0; a < 5; a++) gl.disableVertexAttribArray(a);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(progH.loc.corner);
      gl.vertexAttribPointer(progH.loc.corner, 2, gl.FLOAT, false, 0, 0);
      var aspect = canvas.width / canvas.height, f = 1 / Math.tan(18 * Math.PI / 180);
      for (var i = 0; i < halos.length; i++) {
        var h = halos[i], p = h[0];
        var x = pv[0] * p[0] + pv[4] * p[1] + pv[8] * p[2] + pv[12], y = pv[1] * p[0] + pv[5] * p[1] + pv[9] * p[2] + pv[13];
        var w = pv[3] * p[0] + pv[7] * p[1] + pv[11] * p[2] + pv[15];
        if (w <= 0) continue;
        var r = h[1] * f / w, k = h[3] * (h[4] ? 1 + audio * 1.2 + cur.pulse * 0.6 : 1) * (0.92 + 0.08 * Math.sin(simT * 1.3 + i));
        gl.uniform2f(progH.loc.center, x / w, y / w);
        gl.uniform2f(progH.loc.radius, r / aspect, r);
        gl.uniform3fv(progH.loc.color, mix3(h[2], cur.tint, cur.tintAmt));
        gl.uniform1f(progH.loc.alpha, k * bright);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.disableVertexAttribArray(progH.loc.corner);
    }

    // Prestanda: mäter bildfrekvensen och byter nivå i läget Auto (ned direkt, upp försiktigt).
    function measure(now, took) {
      perf.frames++;
      if (!perf.since) perf.since = now;
      if (took > 1000 / q.fps * 0.9) perf.slow++; else if (took < 1000 / q.fps * 0.35) perf.fast++;
      if (now - perf.since < 4000) return;
      perf.fps = Math.round(perf.frames * 1000 / (now - perf.since));
      var slow = perf.fps < q.fps * 0.8 || perf.slow > perf.frames * 0.4, fast = perf.fast > perf.frames * 0.9 && perf.fps >= q.fps * 0.95;
      perf.frames = perf.slow = perf.fast = 0; perf.since = now;
      if (!auto) return;
      if (slow && level !== 'low') setQuality(level === 'ultra' ? 'medium' : 'low', true);
      else if (fast && level === 'medium' && !upgraded) { upgraded = true; setQuality('ultra', true); }
    }
    var upgraded = false, successAt = 0;

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden || lost) return;
      if (now - lastDraw < 1000 / q.fps - 2) return;
      lastDraw = now;
      var t1 = Date.now();
      draw(now);
      measure(now, Date.now() - t1 + (now - lastDraw > 0 ? 0 : 0));
    }

    function setQuality(l, fromAuto) {
      if (!QUALITY[l]) return;
      if (!fromAuto) auto = l === 'auto';
      if (l === 'auto') return;
      if (l === level && gl) return;
      level = l; q = QUALITY[l];
      if (gl) { freeGL(); build(); resize(); }
    }

    function setState(name) {
      if (!STATES[name]) return;
      stateName = name;
      target = STATES[name];
      if (name === 'success') successAt = Date.now();
    }

    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); lost = true; }, false);
    canvas.addEventListener('webglcontextrestored', function () { lost = false; objs = []; if (build()) resize(); }, false);

    return {
      /** Bygger scenen; false om WebGL saknas (då visar skärmsläckaren reservläget). */
      init: function () {
        try { if (!build()) return false; } catch (e) { if (window.console) console.warn('O.R.T.I.: ' + e.message); return false; }
        resize();
        return true;
      },
      start: function () { if (running) return; running = true; lastNow = 0; raf = requestAnimationFrame(frame); },
      stop: function () { running = false; cancelAnimationFrame(raf); },
      /** Släpper allt i grafikminnet (när skärmsläckaren har tonat ut). */
      destroy: function () {
        running = false; cancelAnimationFrame(raf);
        freeGL();
        var ext = gl && gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        gl = null;
      },
      frame: function () { if (gl) draw(performance.now ? performance.now() : Date.now()); },
      resize: resize,
      setState: setState,
      state: function () { return stateName; },
      /** Ljudnivå 0–1 (SPEAKING): kärnorna och partiklarna följer den. */
      level: function (v) { audio = Math.max(0, Math.min(1, v || 0)) * 0.6; },
      setQuality: setQuality,
      quality: function () { return {level: level, auto: auto, fps: perf.fps}; },
      setBrightness: function (b) { userBright = b; },
      setSpeed: function (s) { userSpeed = s; },
      setNight: function (on) { night = on ? 0.6 : 1; }
    };
  }

  /** Kan TV:n visa scenen? (WebGL 1) */
  function supported() {
    try {
      var c = document.createElement('canvas'), g = window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'));
      var ext = g && g.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();   // bara en kontroll: släpp kontexten direkt
      return !!g;
    } catch (e) { return false; }
  }

  return {create: create, supported: supported, colors: C};
})();
