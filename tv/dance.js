/*
 * Dansgolvet: Free My TV's own dance game. A neon dancer on the TV shows the moves to music made right here with
 * Web Audio (no files), and up to four phones (phone/dance.html, joined with a QR code) score how well each player
 * follows: the phone in the right hand, its motion sensor measured against the path of the dancer's glowing hand.
 * The dancer, the moves and the music are all our own.
 *
 * Phones join through ntfy.sh (a couple of messages each) and then talk to the TV over WebRTC on the home network.
 * When that doesn't open, the scores come through ntfy in batches instead. Without any phone it's just dancing along.
 * ES5 only.
 */
var Dance = (function () {
  'use strict';
  var RELAY = (window.CONFIG && CONFIG.relay) || 'https://ntfy.sh/';
  var PHONE = (window.CONFIG && CONFIG.dancePhoneUrl) || 'https://raw.githack.com/MrOrtiiz/my-tv/main/phone/dance.html';
  var QRLIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  var STORE = 'fmtv.dance';
  var COLORS = ['#FF3DA5', '#2EE6FF', '#FFD23D', '#7CFF5B'];
  var GRADES = ['Miss', 'Okej', 'Bra', 'Super', 'Perfekt!'], POINTS = [0, 50, 100, 150, 200];
  var W = 1920, H = 1080;

  var cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { cfg = {}; }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) {} }

  function rid(n) {
    var abc = 'abcdefghijklmnopqrstuvwxyz0123456789', out = '', b = null;
    try { b = new Uint8Array(n); window.crypto.getRandomValues(b); } catch (e) { b = null; }
    for (var i = 0; i < n; i++) out += abc.charAt((b ? b[i] : Math.floor(Math.random() * 256)) % abc.length);
    return out;
  }
  function topic() { if (!cfg.topic) { cfg.topic = 'fmtv-dans-' + rid(20); save(); } return cfg.topic; }
  /** A key only the TV and the QR code know: a gubbe sent through ntfy is locked with it. */
  function secret() { if (!cfg.key) { cfg.key = rid(32); save(); } return cfg.key; }
  var VERSION = '2026-11-14e';
  // The family's gubbar in Google Drive (phone/gubbar-script.gs): in every QR code, so no phone needs to paste it.
  var DRIVE = (window.CONFIG && CONFIG.danceDrive) || 'https://script.google.com/macros/s/AKfycbxd3dQBeCmP0gwgkpr-o51zB7gsKxhW2hZOqqWfjoQ3ZYmYSNhFPUDbeKICpapCpgcXsQ/exec';   // in the phone's link, so a phone never keeps an older page

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, parent, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // MARK: - The dancer
  //
  // A pose: angles in degrees, 0 = pointing down, 90 = to the screen's right, -90 = to the left, 180 = up.
  // la / ra = the arms on the screen's left / right [upper arm, forearm], ll / rl = the legs [thigh, shin],
  // lean = the torso's tilt, x / y = where the hips are (y > 0 is lower), head = the head's tilt.
  // The right arm on the screen is the lead: the player holds the phone in that hand and mirrors it.

  function P(la1, la2, ra1, ra2, ll1, ll2, rl1, rl2, lean, x, y, head, bend) {
    return {la: [la1, la2], ra: [ra1, ra2], ll: [ll1, ll2], rl: [rl1, rl2], lean: lean || 0, x: x || 0, y: y || 0, head: head || 0, bend: bend || 0};
  }

  var LEGS = [-6, -3, 6, 3];   // standing
  function S(la1, la2, ra1, ra2, lean, x, y, head) { return P(la1, la2, ra1, ra2, LEGS[0], LEGS[1], LEGS[2], LEGS[3], lean, x, y, head); }

  // Each move: its name, how many beats one round of it takes, and the poses in that round (evenly spread).
  var MOVES = {
    gunga: {name: 'Gunga höfterna', easy: true, cycle: 2, f: [
      P(-38, 42, 38, -42, -12, -4, 2, 2, 6, -26, 0, 6), P(-38, 42, 38, -42, -2, -2, 12, 4, -6, 26, 0, -6)]},
    klapp: {name: 'Klappa i takt', easy: true, cycle: 1, f: [
      S(-28, 62, 28, -62, 0, 0, 6), S(-88, -96, 88, 96, 0, 0, -4)]},
    pump: {name: 'Pumpa upp', easy: true, cycle: 1, f: [
      S(-38, 42, 96, 188, -4, 0, 8), S(-38, 42, 176, 178, 4, 0, -10, 4)]},
    sida: {name: 'Sida till sida', easy: true, cycle: 2, f: [
      P(-72, -84, -34, -52, -16, -6, 4, 2, -8, -44, 6, -8), P(34, 52, 72, 84, -4, -2, 16, 6, 8, 44, 6, 8)]},
    vinka: {name: 'Vinka högt', easy: true, cycle: 1, f: [
      S(-38, 42, 152, 204, 0, 0, 0, 4), S(-38, 42, 150, 132, 0, 0, 0, -4)]},
    frys: {name: 'Frys!', easy: true, cycle: 1, f: [
      P(-62, -62, 160, 162, -18, -8, 18, 8, 0, 0, 0, 8)]},
    stjarna: {name: 'Stjärnhopp', easy: true, cycle: 1, f: [
      P(-14, -10, 14, 10, -4, -2, 4, 2, 0, 0, 0), P(-148, -160, 148, 160, -24, -18, 24, 18, 0, 0, -36)]},
    hopp: {name: 'Hoppa!', easy: true, cycle: 1, f: [
      P(-30, -36, 30, 36, -26, 12, 26, -12, 0, 0, 44), P(-166, -170, 166, 170, -8, -4, 8, 4, 0, 0, -56)]},
    robot: {name: 'Robot', easy: false, cycle: 2, f: [
      S(-90, 4, 90, 176, 0, 0, 0, 10), S(-90, 176, 90, 4, 0, 0, 0, -10)]},
    snurr: {name: 'Armsnurr', easy: false, cycle: 2, f: [
      S(-20, -20, 20, 20), S(-95, -95, 95, 95), S(-170, -170, 170, 170), S(-232, -232, 232, 232)]},
    puff: {name: 'Slå framåt', easy: false, cycle: 2, f: [
      S(-40, 140, 90, 90, 6, 10, 0), S(-90, -90, 40, -140, -6, -10, 0)]},
    disco: {name: 'Disco-peka', easy: false, cycle: 2, f: [
      S(-38, 42, 146, 150, 6, 16, 0, 10), S(-38, 42, -28, -40, -4, -6, 8, -6)]},
    simma: {name: 'Simma', easy: false, cycle: 2, f: [
      S(-20, -24, 170, 172, 4, 0, 0), S(-170, -172, 20, 24, -4, 0, 0)]},
    jubel: {name: 'Jubla!', easy: true, cycle: 1, f: [
      P(-30, 150, 30, -150, -14, 6, 14, -6, 0, 0, 12), P(-150, -160, 150, 160, -8, -4, 8, 4, 0, 0, -30, 0)]},
    gitarr: {name: 'Luftgitarr', easy: true, cycle: 1, f: [
      S(-55, -100, 35, -60, -6, 0, 4, 6), S(-55, -100, 55, 20, -4, 0, 0, -4)]},
    salsa: {name: 'Salsasteg', easy: true, cycle: 2, f: [
      P(-40, 80, 40, 100, -18, -6, 4, 2, 6, -18, 4, 6), P(-40, 100, 40, -80, -4, -2, 18, 6, -6, 18, 4, -6)]},
    // the children's songs: touch what the song sings about
    huvud: {name: 'Huvud', easy: true, kids: true, cycle: 1, f: [S(-143, 106, 143, -106), S(-136, 101, 136, -101, 0, 0, 8, 6)]},
    axlar: {name: 'Axlar', easy: true, kids: true, cycle: 1, f: [S(-60, 120, 60, -120), S(-80, 100, 80, -100, 0, 0, 6)]},
    kna: {name: 'Knä', easy: true, kids: true, cycle: 1, f: [
      P(-10, -4, 10, 4, -25, 15, 25, -15, 0, 0, 21, 0, 0.6), P(-8, -2, 8, 2, -30, 25, 30, -25, 0, 0, 38, 4, 0.66)]},
    ta: {name: 'Tå', easy: true, kids: true, cycle: 1, f: [
      P(-6, -2, 6, 2, -30, 25, 30, -25, 0, 0, 38, 0, 0.95), P(-4, 0, 4, 0, -35, 15, 35, -15, 0, 0, 36, 6, 1)]},
    ogon: {name: 'Ögon', easy: true, kids: true, cycle: 1, f: [S(-140, 86, 140, -86), S(-132, 86, 132, -86, 0, 0, 6, 4)]},
    oron: {name: 'Öron', easy: true, kids: true, cycle: 1, f: [S(-114, 105, 114, -105), S(-108, 127, 108, -127, 0, 0, 4)]},
    mun: {name: 'Mun', easy: true, kids: true, cycle: 1, f: [S(-154, 58, 154, -58), S(-147, 55, 147, -55, 0, 0, 6)]},
    nasa: {name: 'Näsa', easy: true, kids: true, cycle: 1, f: [S(-38, 42, 152, -71), S(-38, 42, 150, -66, 0, 0, 6, 4)]},
    groda: {name: 'Grodhopp', easy: true, kids: true, cycle: 1, f: [
      P(-20, 17, 20, -17, -45, 10, 45, -10, 0, 0, 52), P(-10, 3, 10, -3, -12, -4, 12, 4, 0, 0, -24)]},
    svans: {name: 'Svans', easy: true, kids: true, cycle: 1, f: [
      P(-20, 17, 20, -17, -10, -4, 4, 2, 8, -24, 4, 6), P(-20, 17, 20, -17, -4, -2, 10, 4, -8, 24, 4, -6)]},
    kvack: {name: 'Kvack!', easy: true, kids: true, cycle: 2, f: [
      P(-10, -6, 10, 6, -60, 20, 60, -20, 0, 0, 94, 0, 0.5), P(-160, -165, 160, 165, -14, -6, 14, 6, 0, 0, -50)]},
    blinka: {name: 'Blinka', easy: true, kids: true, cycle: 1, f: [S(-150, -165, 150, 165), S(-138, -148, 138, 148, 0, 0, 4)]},
    diamant: {name: 'Diamant', easy: true, kids: true, cycle: 2, f: [S(-164, 133, 164, -133), S(-153, 126, 153, -126, 0, 0, 6)]},
    klattra: {name: 'Klättra upp', easy: true, kids: true, cycle: 1, f: [S(-165, -172, 118, 155, 0, 0, 0, 4), S(-118, -155, 165, 172, 0, 0, 0, -4)]},
    regn: {name: 'Regnet faller', easy: true, kids: true, cycle: 2, f: [S(-150, -165, 150, 165), S(-32, -22, 32, 22, 0, 0, 14)]},
    sol: {name: 'Solen', easy: true, kids: true, cycle: 2, f: [S(-160, 150, 160, -150), S(-108, -118, 108, 118, 0, 0, -8)]},
    smyga: {name: 'Smyg tyst', easy: true, kids: true, cycle: 2, f: [
      P(-70, -50, 154, -58, -14, -2, 4, 2, 0, -12, 6), P(-70, -50, 154, -58, -4, -2, 14, 2, 0, 12, 6)]},
    varna: {name: 'Akta dig!', easy: true, kids: true, cycle: 1, f: [S(-30, -20, 150, 168), S(-30, -20, 150, 196, 0, 0, 0, 4)]},
    bjorn: {name: 'Björnen vaknar!', easy: true, kids: true, cycle: 1, f: [
      P(-130, -170, 130, 170, -24, -6, 24, 6, 0, 0, 18), P(-112, -148, 112, 148, -28, -8, 28, 8, 0, 0, 30)]},
    sova: {name: 'Sov gott', easy: true, kids: true, cycle: 4, f: [S(-154, 58, 154, -58, -6, -10, 0, -20), S(-147, 55, 147, -55, -4, -14, 4, -24)]},
    vagga: {name: 'Vagga', easy: true, cycle: 4, f: [
      P(-150, -155, -170, -165, -10, -4, 4, 2, 10, -20, 0, 8), P(165, 170, 150, 155, -4, -2, 10, 4, -10, 20, 0, -8)]}
  };
  var MOVE_IDS = [];
  for (var mid in MOVES) if (MOVES.hasOwnProperty(mid)) MOVE_IDS.push(mid);

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpAngle(a, b, t) {
    var d = ((b - a) % 360 + 540) % 360 - 180;   // the shortest way round
    return a + d * t;
  }
  function ease(t) { return t * t * (3 - 2 * t); }
  function mix(p, q, t) {
    return {
      la: [lerpAngle(p.la[0], q.la[0], t), lerpAngle(p.la[1], q.la[1], t)],
      ra: [lerpAngle(p.ra[0], q.ra[0], t), lerpAngle(p.ra[1], q.ra[1], t)],
      ll: [lerpAngle(p.ll[0], q.ll[0], t), lerpAngle(p.ll[1], q.ll[1], t)],
      rl: [lerpAngle(p.rl[0], q.rl[0], t), lerpAngle(p.rl[1], q.rl[1], t)],
      lean: lerp(p.lean, q.lean, t), x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t), head: lerp(p.head, q.head, t),
      bend: lerp(p.bend || 0, q.bend || 0, t)
    };
  }

  /** The pose of a move `beat` beats after it started. */
  function poseAt(id, beat) {
    var m = MOVES[id] || MOVES.gunga, n = m.f.length;
    if (n === 1) return m.f[0];
    var pos = (beat / m.cycle) * n, i = Math.floor(pos), t = pos - i;
    return mix(m.f[((i % n) + n) % n], m.f[(((i + 1) % n) + n) % n], ease(t));
  }

  function dir(a) { var r = a * Math.PI / 180; return [Math.sin(r), Math.cos(r)]; }

  /** Where the joints are for a pose: the ground at gy, centred at cx, s = scale. */
  function joints(p, cx, gy, s) {
    var hx = cx + p.x * s, hy = gy - 330 * s + p.y * s;
    var lr = p.lean * Math.PI / 180, ux = Math.sin(lr), uy = -Math.cos(lr), px = -uy, py = ux;   // up the torso, across it
    var tl = 228 * (1 - 0.9 * (p.bend || 0));   // bending forward (towards the TV), the torso looks shorter
    var nx = hx + ux * tl * s, ny = hy + uy * tl * s;
    var sh = [nx + ux * -10 * s, ny + uy * -10 * s];
    var J = {hip: [hx, hy], neck: [nx, ny]};
    J.ls = [sh[0] - px * 56 * s, sh[1] - py * 56 * s];
    J.rs = [sh[0] + px * 56 * s, sh[1] + py * 56 * s];
    J.lh = [hx - px * 36 * s, hy - py * 36 * s];
    J.rh = [hx + px * 36 * s, hy + py * 36 * s];
    function limb(base, a, l1, l2) {
      var d1 = dir(a[0]), d2 = dir(a[1]);
      var m = [base[0] + d1[0] * l1 * s, base[1] + d1[1] * l1 * s];
      return [m, [m[0] + d2[0] * l2 * s, m[1] + d2[1] * l2 * s]];
    }
    var t;
    t = limb(J.ls, p.la, 118, 110); J.le = t[0]; J.lw = t[1];
    t = limb(J.rs, p.ra, 118, 110); J.re = t[0]; J.rw = t[1];
    t = limb(J.lh, p.ll, 168, 164); J.lk = t[0]; J.lf = t[1];
    t = limb(J.rh, p.rl, 168, 164); J.rk = t[0]; J.rf = t[1];
    var hr = (p.lean + p.head) * Math.PI / 180;
    J.head = [nx + Math.sin(hr) * 66 * s, ny - Math.cos(hr) * 66 * s];
    return J;
  }

  /** The neon dancer: a pink glow, a light core, the lead hand in gold. */
  var NEON = {glow: '255, 61, 165', body: '#8AF6FF', core: 'rgba(255, 255, 255, 0.85)', visor: '#FF3DA5'};
  function drawDancer(c, p, cx, gy, s, beatGlow, lead, pal) {
    pal = pal || NEON;
    var J = joints(p, cx, gy, s);
    var segs = [
      [J.lh, J.lk, J.lf], [J.rh, J.rk, J.rf],
      [J.ls, J.le, J.lw], [J.rs, J.re, J.rw]
    ];
    function path(w) {
      c.lineWidth = w;
      c.beginPath();
      for (var i = 0; i < segs.length; i++) {
        c.moveTo(segs[i][0][0], segs[i][0][1]);
        c.lineTo(segs[i][1][0], segs[i][1][1]);
        c.lineTo(segs[i][2][0], segs[i][2][1]);
      }
      c.stroke();
    }
    function torso(w) {
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(J.hip[0], J.hip[1]); c.lineTo(J.neck[0], J.neck[1]);
      c.moveTo(J.ls[0], J.ls[1]); c.lineTo(J.rs[0], J.rs[1]);
      c.moveTo(J.lh[0], J.lh[1]); c.lineTo(J.rh[0], J.rh[1]);
      c.stroke();
    }
    function head(r) { c.beginPath(); c.arc(J.head[0], J.head[1], r, 0, Math.PI * 2); }
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    var g = 0.16 + 0.12 * (beatGlow || 0);
    // the glow, in passes (cheaper on a TV than shadowBlur)
    c.strokeStyle = 'rgba(' + pal.glow + ', ' + g + ')'; path(62 * s); torso(76 * s);
    c.fillStyle = c.strokeStyle; head(66 * s); c.fill();
    c.strokeStyle = 'rgba(' + pal.glow + ', 0.42)'; path(40 * s); torso(52 * s);
    c.fillStyle = c.strokeStyle; head(56 * s); c.fill();
    c.strokeStyle = pal.body; path(24 * s); torso(34 * s);
    c.fillStyle = pal.body; head(46 * s); c.fill();
    c.strokeStyle = pal.core; path(8 * s); torso(12 * s);
    c.fillStyle = pal.core; head(30 * s); c.fill();
    // a visor across the face
    c.strokeStyle = pal.visor; c.lineWidth = 10 * s;
    c.beginPath(); c.moveTo(J.head[0] - 26 * s, J.head[1] - 4 * s); c.lineTo(J.head[0] + 26 * s, J.head[1] - 4 * s); c.stroke();
    if (lead) {   // the hand the phone follows
      var r = (26 + 8 * (beatGlow || 0)) * s;
      c.fillStyle = 'rgba(255, 210, 61, 0.28)'; c.beginPath(); c.arc(J.rw[0], J.rw[1], r * 1.9, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#FFD23D'; c.beginPath(); c.arc(J.rw[0], J.rw[1], r, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#FFF6D6'; c.beginPath(); c.arc(J.rw[0], J.rw[1], r * 0.45, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    return J;
  }

  /**
   * What the phone should feel during a move, from the lead hand's path: how far it travels per beat (still, mid,
   * high) and which way most (v = up and down, h = sideways, a = both).
   */
  var SIG = {};
  (function () {
    for (var i = 0; i < MOVE_IDS.length; i++) {
      var id = MOVE_IDS[i], m = MOVES[id], steps = 24 * m.cycle, last = null, dv = 0, dh = 0;
      for (var k = 0; k <= steps; k++) {
        var j = joints(poseAt(id, k / 24), 0, 0, 1), pt = j.rw;
        if (last) { dh += Math.abs(pt[0] - last[0]); dv += Math.abs(pt[1] - last[1]); }
        last = pt;
      }
      var per = (dv + dh) / m.cycle, e = per < 60 ? 's' : per < 260 ? 'm' : 'h';
      var rv = dv / Math.max(1, dv + dh), d = rv > 0.62 ? 'v' : rv < 0.38 ? 'h' : 'a';
      SIG[id] = {e: e, d: d};
    }
  })();

  // MARK: - The songs (our own, made here)

  var SCALE = {major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10]};
  /** A melody written as notes: 'G4 4  A4 1 …' (name and octave, or r for a rest, then beats). → [[midi or 0, beats]] */
  function tune(txt) {
    var out = [], parts = txt.replace(/\s+/g, ' ').replace(/^ | $/g, '').split(' '), names = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
    for (var i = 0; i + 1 < parts.length; i += 2) {
      var n = parts[i], m = 0;
      if (n !== 'r') m = 12 * (parseInt(n.slice(-1), 10) + 1) + names[n.charAt(0)] + (n.charAt(1) === '#' ? 1 : n.charAt(1) === 'b' ? -1 : 0);
      out.push([m, parseFloat(parts[i + 1])]);
    }
    return out;
  }
  function moves(txt) {   // 'huvud 4  axlar 2 …' → [[id, beats]]
    var out = [], parts = txt.replace(/\s+/g, ' ').replace(/^ | $/g, '').split(' ');
    for (var i = 0; i + 1 < parts.length; i += 2) out.push([parts[i], parseFloat(parts[i + 1])]);
    return out;
  }

  // The children's songs: old songs everyone knows (traditional melodies, free to use), with the moves the song sings
  // about. The melody goes round a few times; `plan` says with which moves, and speed 2 is the fast last round.
  var HSKT = moves('huvud 4  axlar 2  kna 2  ta 2  kna 2  ta 4   huvud 4  axlar 2  kna 2  ta 2  kna 2  ta 4' +
    '  ogon 4  oron 4  mun 2  nasa 6   huvud 4  axlar 2  kna 2  ta 2  kna 2  ta 4');
  var KIDS = [
    {id: 'huvud', name: 'Huvud, axlar, knä och tå', kids: true, tempo: 'Medel', bpm: 126, root: 48, scale: 'major', drums: 'kids', seed: 3,
      color: '#FF5FA2', cover: {bg: ['#FF8A3D', '#FF4FA0'], art: 'confetti', move: 'huvud', pal: {glow: '120, 20, 90', body: '#FFFFFF', core: '#FFF0F6', visor: '#2EE6FF'}},
      tune: tune('G4 4  A4 1 G4 1 F#4 1 G4 1  E4 2 G4 1 G4 1  G4 4' +
        '  G4 4  A4 1 G4 1 F#4 1 G4 1  D4 2 G4 1 G4 1  G4 1 F4 1 E4 1 D4 1' +
        '  C4 2 E4 2  G4 2 C5 2  D5 1 C5 1 B4 1 C5 1  A4 4' +
        '  B4 4  B4 1 G4 1 A4 1 B4 1  C5 2 C5 1 C5 1  C5 4'),
      harmony: [[0, 16], [0, 8], [4, 8], [0, 8], [3, 8], [4, 8], [0, 8]],
      plan: [{m: HSKT}, {m: HSKT}, {m: HSKT, speed: 2}]},
    {id: 'grodorna', name: 'Små grodorna', kids: true, tempo: 'Medel', bpm: 116, root: 53, scale: 'major', drums: 'kids', seed: 8,
      color: '#5FD35A', cover: {bg: ['#0C6B5A', '#7EE36B'], art: 'pond', move: 'groda', pal: {glow: '10, 60, 30', body: '#FFFFFF', core: '#F0FFE8', visor: '#FFD23D'}},
      pickup: [72, 0.5],
      tune: tune('A4 0.75 A4 0.25 A4 0.5 C5 0.5  A4 0.75 A4 0.25 A4 0.5 C5 0.5  D5 0.5 C5 0.5 Bb4 0.5 A4 0.5  G4 1 r 0.5 Bb4 0.5' +
        '  G4 0.75 G4 0.25 G4 0.5 Bb4 0.5  G4 0.75 G4 0.25 G4 0.5 Bb4 0.5  C5 0.5 Bb4 0.5 A4 0.5 G4 0.5  F4 1 r 0.5 C5 0.5'),
      harmony: [[0, 6], [4, 8], [0, 2]],
      plan: [{m: moves('groda 4 groda 4 groda 4 groda 4')}, {m: moves('oron 4 svans 4 oron 4 svans 4')}, {m: moves('kvack 4 kvack 4 kvack 4 kvack 4')},
        {m: moves('groda 4 groda 4 groda 4 groda 4')}, {m: moves('svans 4 oron 4 svans 4 oron 4')}, {m: moves('nasa 4 nasa 4 nasa 4 nasa 4')},
        {m: moves('groda 4 groda 4 groda 4 groda 4'), speed: 2}, {m: moves('oron 4 svans 4 oron 4 svans 4'), speed: 2}, {m: moves('kvack 4 kvack 4 kvack 4 kvack 4'), speed: 2}]},
    {id: 'blinka', name: 'Blinka lilla stjärna', kids: true, tempo: 'Lugn', bpm: 100, root: 48, scale: 'major', drums: 'kids', seed: 12,
      color: '#8FB8FF', cover: {bg: ['#0B1446', '#3E5BD8'], art: 'stars', move: 'blinka', pal: {glow: '255, 220, 120', body: '#FFF3C4', core: '#FFFFFF', visor: '#8FB8FF'}},
      tune: tune('C4 1 C4 1 G4 1 G4 1 A4 1 A4 1 G4 2  F4 1 F4 1 E4 1 E4 1 D4 1 D4 1 C4 2' +
        '  G4 1 G4 1 F4 1 F4 1 E4 1 E4 1 D4 2  G4 1 G4 1 F4 1 F4 1 E4 1 E4 1 D4 2' +
        '  C4 1 C4 1 G4 1 G4 1 A4 1 A4 1 G4 2  F4 1 F4 1 E4 1 E4 1 D4 1 D4 1 C4 2'),
      harmony: [[0, 4], [3, 2], [0, 2], [3, 2], [0, 2], [4, 2], [0, 2], [0, 2], [3, 2], [0, 2], [4, 2], [0, 2], [3, 2], [0, 2], [4, 2],
        [0, 4], [3, 2], [0, 2], [3, 2], [0, 2], [4, 2], [0, 2]],
      plan: [{m: moves('blinka 8 vagga 8 diamant 8 vagga 8 blinka 8 sova 8')}, {m: moves('blinka 8 vagga 8 diamant 8 vagga 8 blinka 8 sova 8')}]},
    {id: 'imse', name: 'Imse vimse spindel', kids: true, tempo: 'Lugn', bpm: 96, root: 48, scale: 'major', drums: 'kids', seed: 17,
      color: '#7ED0FF', cover: {bg: ['#1B3A6B', '#57B6E8'], art: 'web', move: 'klattra', pal: {glow: '20, 30, 90', body: '#FFFFFF', core: '#EAF6FF', visor: '#FF5FA2'}},
      pickup: [67, 0.5],
      tune: tune('C5 0.75 C5 0.25 C5 0.75 D5 0.25  E5 1.5 E5 0.5  E5 0.75 D5 0.25 C5 0.75 D5 0.25  E5 1 C5 1' +
        '  E5 1.5 E5 0.5  F5 1 G5 1  G5 0.75 F5 0.25 E5 0.75 F5 0.25  G5 1 E5 1' +
        '  C5 1.5 C5 0.5  D5 1 E5 1  E5 0.75 D5 0.25 C5 0.75 D5 0.25  E5 1 C5 1' +
        '  C5 0.75 C5 0.25 C5 0.75 D5 0.25  E5 1.5 E5 0.5  E5 0.75 D5 0.25 C5 0.75 D5 0.25  C5 1.5 G4 0.5'),
      harmony: [[0, 6], [4, 2], [0, 2], [4, 4], [0, 2], [0, 2], [4, 2], [0, 4], [0, 6], [4, 1], [0, 1]],
      plan: [{m: moves('klattra 8 regn 8 sol 8 klattra 8')}, {m: moves('klattra 8 regn 8 sol 8 klattra 8')}, {m: moves('klattra 8 regn 8 sol 8 klattra 8'), speed: 2}]},
    {id: 'bjornen', name: 'Björnen sover', kids: true, tempo: 'Medel', bpm: 104, root: 48, scale: 'major', drums: 'kids', seed: 23,
      color: '#C9925A', cover: {bg: ['#10202E', '#2E5A4A'], art: 'bear', move: 'bjorn', pal: {glow: '255, 170, 80', body: '#FFE3C2', core: '#FFFFFF', visor: '#FF8A3D'}},
      tune: tune('C4 1 C4 1 C4 1 E4 1  D4 1 D4 1 D4 1 F4 1' +
        '  E4 1 E4 1 D4 1 D4 1  C4 2 r 2' +
        '  E4 0.5 E4 0.5 E4 0.5 E4 0.5 G4 1 F4 1  D4 0.5 D4 0.5 D4 0.5 D4 0.5 F4 1 E4 1' +
        '  C4 1 C4 1 C4 1 E4 1  D4 1 D4 1 D4 1 F4 1' +
        '  E4 1 E4 1 D4 1 D4 1  C4 1 r 3'),
      harmony: [[0, 4], [4, 4], [4, 2], [0, 6], [0, 4], [4, 3], [0, 1], [0, 4], [4, 4], [4, 2], [0, 6]],
      plan: [{m: moves('sova 16 smyga 8 varna 8 sova 4 bjorn 4')}, {m: moves('sova 16 smyga 8 varna 8 sova 4 bjorn 4')},
        {m: moves('sova 16 smyga 8 varna 8 sova 4 bjorn 4')}]}
  ];

  var SONGS = [
    {id: 'neon', name: 'Neonnatt', tempo: 'Lugn', bpm: 108, root: 45, scale: 'minor', chords: [0, 5, 2, 6], drums: 'four', seed: 7,
      color: '#B34DFF', cover: {bg: ['#21094F', '#B34DFF'], art: 'grid', move: 'robot', pal: {glow: '255, 61, 165', body: '#8AF6FF', core: 'rgba(255, 255, 255, 0.9)', visor: '#FF3DA5'}},
      dance: {
        A: {easy: [['sida', 'klapp'], ['pump', 'klapp']], hard: [['sida', 'robot', 'pump', 'klapp'], ['puff', 'puff', 'disco', 'frys']]},
        B: {easy: [['pump', 'vinka'], ['stjarna', 'frys']], hard: [['pump', 'disco', 'snurr', 'frys'], ['stjarna', 'hopp', 'robot', 'frys']]},
        C: {easy: [['gunga', 'vinka'], ['klapp', 'sida']], hard: [['simma', 'simma', 'snurr', 'snurr'], ['gunga', 'vinka', 'klapp', 'frys']]}
      }},
    {id: 'sol', name: 'Solsken', tempo: 'Medel', bpm: 120, root: 50, scale: 'major', chords: [0, 4, 5, 3], drums: 'pop', seed: 21,
      color: '#FFB21F', cover: {bg: ['#FFE45C', '#FF7A1F'], art: 'sun', move: 'stjarna', pal: {glow: '230, 70, 20', body: '#FFFFFF', core: '#FFF4C8', visor: '#FF5A1F'}},
      dance: {
        A: {easy: [['klapp', 'sida'], ['vinka', 'klapp']], hard: [['klapp', 'sida', 'vinka', 'pump'], ['robot', 'robot', 'puff', 'frys']]},
        B: {easy: [['hopp', 'pump'], ['stjarna', 'vinka']], hard: [['hopp', 'stjarna', 'pump', 'disco'], ['snurr', 'puff', 'hopp', 'frys']]},
        C: {easy: [['sida', 'gunga'], ['pump', 'frys']], hard: [['gunga', 'disco', 'simma', 'frys'], ['sida', 'sida', 'robot', 'frys']]}
      }},
    {id: 'katt', name: 'Discokatten', tempo: 'Snabb', bpm: 128, root: 40, scale: 'minor', chords: [0, 3, 4, 3], drums: 'disco', seed: 42,
      color: '#29E3C9', cover: {bg: ['#063F52', '#29E3C9'], art: 'ball', move: 'disco', pal: {glow: '255, 61, 165', body: '#FFFFFF', core: '#FFE0F2', visor: '#FF3DA5'}},
      dance: {
        A: {easy: [['disco', 'klapp'], ['sida', 'pump']], hard: [['disco', 'disco', 'klapp', 'robot'], ['puff', 'snurr', 'pump', 'frys']]},
        B: {easy: [['stjarna', 'pump'], ['hopp', 'frys']], hard: [['stjarna', 'pump', 'hopp', 'disco'], ['simma', 'snurr', 'stjarna', 'frys']]},
        C: {easy: [['vinka', 'gunga'], ['klapp', 'frys']], hard: [['robot', 'robot', 'vinka', 'vinka'], ['gunga', 'puff', 'disco', 'frys']]}
      }},
    {id: 'latino', name: 'Ritmo Latino', tempo: 'Medel', bpm: 96, root: 43, scale: 'minor', chords: [0, 5, 2, 6], drums: 'dembow', seed: 77,
      color: '#FF6B3D', cover: {bg: ['#E8124F', '#FFB23D'], art: 'dots', move: 'salsa', pal: {glow: '120, 0, 60', body: '#FFF3C4', core: '#FFFFFF', visor: '#2EE6FF'}},
      dance: {
        A: {easy: [['salsa', 'klapp'], ['gunga', 'salsa']], hard: [['salsa', 'salsa', 'gunga', 'klapp'], ['disco', 'salsa', 'snurr', 'frys']]},
        B: {easy: [['salsa', 'pump'], ['jubel', 'frys']], hard: [['salsa', 'pump', 'disco', 'jubel'], ['snurr', 'salsa', 'hopp', 'frys']]},
        C: {easy: [['gunga', 'vinka'], ['salsa', 'frys']], hard: [['gunga', 'gunga', 'vinka', 'vinka'], ['salsa', 'robot', 'disco', 'frys']]}
      }},
    {id: 'fotboll', name: 'Fotbollsfest', tempo: 'Snabb', bpm: 126, root: 48, scale: 'major', chords: [0, 3, 0, 4], drums: 'stomp', seed: 10,
      color: '#3D7BFF', cover: {bg: ['#086B2C', '#3DDB72'], art: 'pitch', move: 'jubel', pal: {glow: '10, 30, 120', body: '#FFFFFF', core: '#E6F0FF', visor: '#3D7BFF'}},
      dance: {
        A: {easy: [['klapp', 'jubel'], ['pump', 'klapp']], hard: [['klapp', 'jubel', 'pump', 'klapp'], ['puff', 'puff', 'jubel', 'frys']]},
        B: {easy: [['jubel', 'hopp'], ['stjarna', 'jubel']], hard: [['jubel', 'hopp', 'jubel', 'stjarna'], ['pump', 'snurr', 'jubel', 'frys']]},
        C: {easy: [['vinka', 'sida'], ['klapp', 'frys']], hard: [['sida', 'vinka', 'robot', 'klapp'], ['vinka', 'simma', 'jubel', 'frys']]}
      }},
    {id: 'godnatt', name: 'Godnattdisco', tempo: 'Lugn', bpm: 92, root: 53, scale: 'major', chords: [0, 5, 3, 4], drums: 'soft', seed: 5,
      color: '#9D8CFF', cover: {bg: ['#0D1240', '#7B6CF0'], art: 'stars', move: 'vagga', pal: {glow: '157, 140, 255', body: '#FFE9A8', core: '#FFFFFF', visor: '#7B6CF0'}},
      dance: {
        A: {easy: [['vagga', 'gunga'], ['vinka', 'vagga']], hard: [['vagga', 'gunga', 'vinka', 'klapp'], ['sida', 'vagga', 'snurr', 'frys']]},
        B: {easy: [['sida', 'vinka'], ['vagga', 'frys']], hard: [['sida', 'vinka', 'disco', 'vagga'], ['simma', 'vagga', 'klapp', 'frys']]},
        C: {easy: [['gunga', 'vagga'], ['klapp', 'frys']], hard: [['vagga', 'vagga', 'gunga', 'gunga'], ['vinka', 'sida', 'vagga', 'frys']]}
      }},
    {id: 'robot', name: 'Robotrock', tempo: 'Snabb', bpm: 134, root: 40, scale: 'minor', chords: [0, 6, 5, 6], drums: 'rock', seed: 99,
      color: '#E8FF3D', cover: {bg: ['#161616', '#5A5A12'], art: 'bolt', move: 'gitarr', pal: {glow: '232, 255, 61', body: '#8AF6FF', core: '#FFFFFF', visor: '#E8FF3D'}},
      dance: {
        A: {easy: [['gitarr', 'pump'], ['gitarr', 'klapp']], hard: [['gitarr', 'gitarr', 'robot', 'pump'], ['robot', 'puff', 'gitarr', 'frys']]},
        B: {easy: [['hopp', 'gitarr'], ['stjarna', 'frys']], hard: [['hopp', 'gitarr', 'robot', 'jubel'], ['snurr', 'puff', 'hopp', 'frys']]},
        C: {easy: [['robot', 'gitarr'], ['pump', 'frys']], hard: [['robot', 'robot', 'gitarr', 'gitarr'], ['simma', 'disco', 'robot', 'frys']]}
      }}
  ];
  SONGS = SONGS.concat(KIDS);

  /**
   * The drum styles: where the kick and the snare (or clap) fall in the bar's 16 steps, how the hats go, and the
   * bass line's steps (oct: steps an octave up).
   */
  var STYLES = {
    four: {kick: [0, 4, 8, 12], snare: [4, 12], clap: true, hat: 'eighths', bass: [0, 2, 4, 6, 8, 10, 12, 14]},
    pop: {kick: [0, 6, 8, 10], snare: [4, 12], clap: false, hat: 'eighths', bass: [0, 6, 8, 12, 14]},
    disco: {kick: [0, 4, 8, 12], snare: [4, 12], clap: true, hat: 'open', bass: [0, 3, 6, 8, 10, 14], oct: [6, 14]},
    dembow: {kick: [0, 4, 8, 12], snare: [3, 6, 11, 14], clap: false, hat: 'eighths', bass: [0, 3, 8, 11], oct: [11]},
    stomp: {kick: [0, 2, 8, 10], snare: [4, 12, 13], clap: true, hat: 'quarters', bass: [0, 4, 8, 12]},
    soft: {kick: [0, 10], snare: [8], clap: true, hat: 'soft', bass: [0, 8], gentle: true},
    rock: {kick: [0, 7, 8], snare: [4, 12], clap: false, hat: 'eighths', bass: [0, 2, 4, 6, 8, 10, 12, 14], oct: [2, 6, 10, 14]}
  };
  // bars: a warm-up, then the sections, then a bow. 48 bars: about 1.5–1.8 minutes.
  var FORM = [['intro', 4], ['A', 8], ['B', 8], ['A', 8], ['C', 8], ['B', 8], ['outro', 4]];

  /** The whole dance for a song: [{b: start beat, n: beats, id, scored}], and the length in beats. */
  function choreo(song, hard) {
    if (song.tune) return kidsPlan(song).dance;
    var out = [], b = 0;
    for (var s = 0; s < FORM.length; s++) {
      var name = FORM[s][0], beats = FORM[s][1] * 4;
      if (name === 'intro') { out.push({b: b, n: beats, id: 'gunga', scored: false}); b += beats; continue; }
      if (name === 'outro') { out.push({b: b, n: beats - 4, id: 'vinka', scored: false}); out.push({b: b + beats - 4, n: 4, id: 'frys', scored: false}); b += beats; continue; }
      var phrases = song.dance[name][hard ? 'hard' : 'easy'], per = hard ? 2 : 4;
      for (var ph = 0; ph < beats / 8; ph++) {
        var list = phrases[ph % phrases.length];
        for (var k = 0; k < list.length; k++) { out.push({b: b, n: per, id: list[k], scored: true}); b += per; }
      }
    }
    for (var i = 0; i < out.length; i++) out[i].i = i;
    return {moves: out, beats: b};
  }


  /**
   * A children's song, laid out in beats: the melody, chords, bass and drums as events, and the moves. A count-in,
   * the rounds (a fast one plays the same melody and moves in half the beats), and a bow.
   */
  function kidsPlan(song) {
    if (song._plan) return song._plan;
    var ev = [], mv = [], b = 4, i, k, len = 0;
    for (i = 0; i < song.tune.length; i++) len += song.tune[i][1];
    for (k = 0; k < 4; k++) { ev.push({b: k, t: 'kick'}); if (k % 2) ev.push({b: k, t: 'clap', v: 0.5}); }
    ev.push({b: 0, t: 'pad', n: chordNotes(song, 0, song.root + 12), len: 4});
    mv.push({b: 0, n: 4, id: 'gunga', scored: false});
    if (song.pickup) ev.push({b: 4 - song.pickup[1], t: 'note', m: song.pickup[0], len: song.pickup[1]});
    for (var r = 0; r < song.plan.length; r++) {
      var seg = song.plan[r], sp = seg.speed || 1, at = 0, beats = len / sp;
      for (i = 0; i < song.tune.length; i++) {
        var nt = song.tune[i];
        if (nt[0] && !(i === song.tune.length - 1 && song.pickup && r === song.plan.length - 1)) ev.push({b: b + at / sp, t: 'note', m: nt[0], len: nt[1] / sp});
        at += nt[1];
      }
      at = 0;
      for (i = 0; i < song.harmony.length; i++) {
        var h = song.harmony[i], hb = b + at / sp, hl = h[1] / sp;
        ev.push({b: hb, t: 'pad', n: chordNotes(song, h[0], song.root + 12), len: hl});
        var root = song.root + SCALE[song.scale][h[0] % 7] - (SCALE[song.scale][h[0] % 7] > 6 ? 12 : 0);
        for (var q = 0; q < hl; q++) ev.push({b: hb + q, t: 'bass', m: root + (q % 2 ? 7 : 0)});
        at += h[1];
      }
      for (k = 0; k < beats; k++) {
        ev.push({b: b + k, t: 'kick', v: k % 2 ? 0.7 : 1});
        if (k % 2) ev.push({b: b + k, t: 'clap', v: 0.8});
        ev.push({b: b + k + 0.5, t: 'hat', v: sp > 1 ? 0.8 : 0.5});
      }
      at = 0;
      for (i = 0; i < seg.m.length; i++) { mv.push({b: b + at / sp, n: seg.m[i][1] / sp, id: seg.m[i][0], scored: true}); at += seg.m[i][1]; }
      b += beats;
    }
    ev.push({b: b, t: 'pad', n: chordNotes(song, 0, song.root + 12), len: 3});
    ev.push({b: b, t: 'note', m: song.root + 24, len: 2});
    ev.push({b: b, t: 'kick'});
    mv.push({b: b, n: 4, id: 'frys', scored: false});
    ev.sort(function (x, y) { return x.b - y.b; });
    for (i = 0; i < mv.length; i++) mv[i].i = i;
    song._plan = {events: ev, dance: {moves: mv, beats: b + 4}};
    return song._plan;
  }

  /** Plays a children's song's events a little ahead, on the audio clock. */
  function kidsTick(m) {
    var spb = 60 / m.song.bpm, ev = m.events;
    while (m.ei < ev.length && m.t0 + ev[m.ei].b * spb < actx.currentTime + 0.25) {
      var e = ev[m.ei++], t = Math.max(actx.currentTime, m.t0 + e.b * spb);
      if (e.t === 'note') lead(t, e.m, e.len * spb * 0.92, 1.15);
      else if (e.t === 'pad') pad(t, e.n, e.len * spb, 0.7);
      else if (e.t === 'bass') bass(t, e.m, spb * 0.8, 0.7);
      else if (e.t === 'kick') kick(t, (e.v || 1) * 0.75);
      else if (e.t === 'clap') snare(t, (e.v || 1) * 0.6, true);
      else if (e.t === 'hat') hat(t, (e.v || 1) * 0.6, false);
    }
  }

  // MARK: - The music: drums, bass, chords and a hook, scheduled ahead on the audio clock

  var actx = null, master = null, noise = null, delay = null;

  function audio() {
    if (actx) return actx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { actx = new AC(); } catch (e) { return null; }
    var comp = actx.createDynamicsCompressor();
    comp.connect(actx.destination);
    master = actx.createGain(); master.gain.value = 0.0001; master.connect(comp);
    delay = actx.createDelay(1.5);
    var fb = actx.createGain(); fb.gain.value = 0.28;
    var wet = actx.createGain(); wet.gain.value = 0.32;
    delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
    var len = actx.sampleRate;
    noise = actx.createBuffer(1, len, actx.sampleRate);
    var d = noise.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return actx;
  }

  function freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function kick(t, v) {
    var o = actx.createOscillator(), g = actx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    env(g, t, 0.95 * v, 0.003, 0.32);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4);
  }
  function snare(t, v, clap) {
    var n = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    n.buffer = noise; f.type = 'bandpass'; f.frequency.value = clap ? 1400 : 1900; f.Q.value = clap ? 1.2 : 0.8;
    env(g, t, 0.5 * v, 0.002, clap ? 0.12 : 0.18);
    n.connect(f); f.connect(g); g.connect(master); n.start(t, Math.random() * 0.5); n.stop(t + 0.25);
    if (!clap) {
      var o = actx.createOscillator(), og = actx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(190, t);
      env(og, t, 0.25 * v, 0.002, 0.09);
      o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.15);
    }
  }
  function hat(t, v, open) {
    var n = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    n.buffer = noise; f.type = 'highpass'; f.frequency.value = 7200;
    env(g, t, 0.18 * v, 0.001, open ? 0.2 : 0.045);
    n.connect(f); f.connect(g); g.connect(master); n.start(t, Math.random() * 0.5); n.stop(t + (open ? 0.3 : 0.08));
  }
  function bass(t, m, len, v) {
    var o = actx.createOscillator(), f = actx.createBiquadFilter(), g = actx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(freq(m), t);
    f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(1100, t); f.frequency.exponentialRampToValueAtTime(220, t + len);
    env(g, t, 0.34 * v, 0.006, len);
    o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + len + 0.05);
  }
  function pad(t, notes, len, v) {
    var f = actx.createBiquadFilter(), g = actx.createGain();
    f.type = 'lowpass'; f.frequency.value = 1700;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06 * v, t + 0.12);
    g.gain.setValueAtTime(0.06 * v, t + len - 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    f.connect(g); g.connect(master);
    for (var i = 0; i < notes.length; i++) {
      for (var k = 0; k < 2; k++) {
        var o = actx.createOscillator();
        o.type = k ? 'sawtooth' : 'triangle'; o.frequency.setValueAtTime(freq(notes[i]), t);
        o.detune.setValueAtTime(k ? 7 : -7, t);
        o.connect(f); o.start(t); o.stop(t + len + 0.02);
      }
    }
  }
  function lead(t, m, len, v) {
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(freq(m), t);
    env(g, t, 0.09 * v, 0.004, len);
    o.connect(g); g.connect(master); g.connect(delay); o.start(t); o.stop(t + len + 0.05);
  }

  /** A small seeded random, so a song is the same every time. */
  function rng(seed) { var s = seed; return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

  /** The notes of chord degree d in a song, from MIDI note `base`. */
  function chordNotes(song, d, base) {
    var sc = SCALE[song.scale], out = [];
    for (var k = 0; k < 3; k++) {
      var i = d + k * 2, oct = Math.floor(i / 7);
      out.push(base + sc[i % 7] + oct * 12);
    }
    return out;
  }

  /** The hook: 16 steps a bar, a note (0–7 in the chord's arpeggio, -1 = rest) per step. Two bars, A and B. */
  function hookFor(song) {
    var r = rng(song.seed), bars = [];
    for (var b = 0; b < 2; b++) {
      var steps = [];
      for (var i = 0; i < 16; i++) {
        var strong = i % 4 === 0, play = strong ? r() < 0.85 : (i % 2 === 0 ? r() < 0.5 : r() < 0.22);
        steps.push(play ? Math.floor(r() * 6) : -1);
      }
      bars.push(steps);
    }
    return bars;
  }

  var music = null;   // {song, t0, step, timer, hook}

  function sectionAt(bar) {
    var b = 0;
    for (var i = 0; i < FORM.length; i++) { if (bar < b + FORM[i][1]) return {name: FORM[i][0], bar: bar - b, len: FORM[i][1]}; b += FORM[i][1]; }
    return null;
  }

  function scheduleStep(m, step, t) {
    var song = m.song, bar = Math.floor(step / 16), pos = step % 16, sec = sectionAt(bar);
    if (!sec) return;
    var spb = 60 / song.bpm, s16 = spb / 4, name = sec.name;
    var deg = song.chords[bar % song.chords.length];
    var root = song.root, bassNote = root + SCALE[song.scale][deg % 7] - (SCALE[song.scale][deg % 7] > 6 ? 12 : 0);
    var fill = sec.bar === sec.len - 1 && pos >= 12;   // a drum fill into the next section
    var drums = name !== 'C' || sec.bar >= sec.len - 2;
    var full = name === 'A' || name === 'B' || name === 'C';
    var st = STYLES[song.drums] || STYLES.four, soft = st.gentle ? 0.6 : 1;
    function has(list) { for (var q = 0; q < list.length; q++) if (list[q] === pos) return true; return false; }
    // drums: in the intro and the outro just the kick on the beat; the break (C) without until its last two bars
    if (name === 'intro' || name === 'outro') { if (pos % 4 === 0 && (!st.gentle || pos % 8 === 0)) kick(t, 0.8 * soft); }
    else if (drums && has(st.kick)) kick(t, (pos % 4 === 0 ? 1 : 0.75) * soft);
    if (full && drums && has(st.snare)) snare(t, (song.drums === 'dembow' && pos !== 6 && pos !== 14 ? 0.7 : 1) * soft, st.clap);
    if (fill && full && pos % 2 === 1 && !st.gentle) snare(t, 0.6, false);
    if (name !== 'outro' || sec.bar < 2) {
      if (st.hat === 'open' && pos % 4 === 2) hat(t, 1, true);
      else if (st.hat === 'quarters') { if (pos % 4 === 0 || (name === 'B' && pos % 2 === 0)) hat(t, 0.7, false); }
      else if (st.hat === 'soft') { if (pos % 4 === 2) hat(t, 0.35, false); }
      else if (pos % 2 === 0 || name === 'B') hat(t, pos % 4 === 2 ? 1 : 0.55, false);
    }
    // bass
    if ((full || name === 'outro') && has(st.bass)) {
      var up = st.oct && has(st.oct) ? 12 : 0;
      bass(t, bassNote + up, s16 * (st.gentle ? 3.5 : 1.7), (name === 'C' ? 0.7 : 1) * soft);
    }
    // chords: once a bar
    if (pos === 0) pad(t, chordNotes(song, deg, root + 12), spb * 4, name === 'C' ? 1.4 : 1);
    // the hook, in B and C; an arpeggio in A
    var ch = chordNotes(song, deg, root + 24), arp = [ch[0], ch[1], ch[2], ch[0] + 12, ch[1] + 12, ch[2] + 12];
    if (name === 'B' || name === 'C') {
      var n = m.hook[bar % 2][pos];
      if (n >= 0) lead(t, arp[n], s16 * 1.6, name === 'C' ? 0.8 : 1);
    } else if (name === 'A' && pos % 2 === 0) {
      lead(t, arp[(pos / 2) % 4], s16 * 0.9, 0.45);
    }
  }

  function startMusic(song, lead) {
    var a = audio();
    if (!a) return null;
    try { if (a.resume) a.resume(); } catch (e) {}
    var m = {song: song, t0: a.currentTime + (lead || 0.6), step: 0, hook: song.tune ? null : hookFor(song), total: 48 * 16};
    if (song.tune) { m.events = kidsPlan(song).events; m.ei = 0; }
    master.gain.cancelScheduledValues(a.currentTime);
    master.gain.setValueAtTime(0.0001, a.currentTime);
    master.gain.exponentialRampToValueAtTime(0.7, a.currentTime + 0.3);
    var s16 = 60 / song.bpm / 4;
    m.timer = setInterval(function () {
      if (music !== m) return;
      if (m.events) { kidsTick(m); return; }
      while (m.step < m.total && m.t0 + m.step * s16 < actx.currentTime + 0.25) {
        scheduleStep(m, m.step, m.t0 + m.step * s16);
        m.step++;
      }
    }, 40);
    music = m;
    return m;
  }

  function stopMusic() {
    if (!music) return;
    clearInterval(music.timer);
    music = null;
    if (actx && master) {
      try {
        master.gain.cancelScheduledValues(actx.currentTime);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), actx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.25);
      } catch (e) {}
    }
  }

  // MARK: - Players and phones

  var players = [];   // {p, name, slot, color, score, hits, grade, gradeAt, dc, pc, last}
  var es = null;

  function playerBy(p) { for (var i = 0; i < players.length; i++) if (players[i].p === p) return players[i]; return null; }

  function post(t, o) {
    var x = new XMLHttpRequest();
    try { x.open('POST', RELAY + t + '?cache=no', true); x.send(JSON.stringify(o)); } catch (e) {}
  }

  /** To one phone: over WebRTC when it's open, else through ntfy. */
  function send(pl, o, viaRelay) {
    if (pl.dc && pl.dc.readyState === 'open') { try { pl.dc.send(JSON.stringify(o)); return; } catch (e) {} }
    if (viaRelay) post(topic() + '-' + pl.p, o);
  }
  /** To all the phones: those on WebRTC one by one, the rest in one ntfy message. */
  function sendAll(o) {
    var anyRelay = false;
    for (var i = 0; i < players.length; i++) {
      var pl = players[i];
      if (pl.dc && pl.dc.readyState === 'open') { try { pl.dc.send(JSON.stringify(o)); continue; } catch (e) {} }
      anyRelay = true;
    }
    if (anyRelay) post(topic() + '-all', o);
  }

  function listen() {
    if (es || !window.EventSource) return;
    es = new EventSource(RELAY + topic() + '-tv/sse?since=20s');
    es.onmessage = function (e) {
      var m = null, o = null;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (!m || m.event !== 'message') return;
      try { o = JSON.parse(m.message); } catch (x) { return; }
      if (o && o.t === 'avatarfile' && m.attachment && m.attachment.url) { avatarFile(o, m.attachment.url); return; }
      if (o) fromPhone(o, false);
    };
  }
  function unlisten() { if (es) { try { es.close(); } catch (e) {} es = null; } }

  function join(o) {
    var pl = playerBy(o.p);
    if (!pl) {
      if (players.length >= 4) { post(topic() + '-' + o.p, {t: 'full'}); return; }
      var used = {}, slot = 0;
      for (var i = 0; i < players.length; i++) used[players[i].slot] = true;
      while (used[slot]) slot++;
      pl = {p: o.p, slot: slot, color: COLORS[slot], score: 0, hits: [], grade: -1, gradeAt: 0};
      players.push(pl);
      players.sort(function (a, b) { return a.slot - b.slot; });
    }
    pl.name = String(o.name || ('Spelare ' + (pl.slot + 1))).slice(0, 14);
    pl.last = Date.now();
    var welcome = {t: 'welcome', slot: pl.slot, color: pl.color, name: pl.name};
    if (o.sdp && window.RTCPeerConnection) {
      answer(pl, o.sdp, function (sdp) { welcome.sdp = sdp; post(topic() + '-' + pl.p, welcome); });
    } else {
      post(topic() + '-' + pl.p, welcome);
    }
    drawPlayers();
    if (window.FreeMyTV && FreeMyTV.toast) FreeMyTV.toast(pl.name + ' är med och dansar!');
  }

  function answer(pl, offer, done) {
    if (pl.pc) { try { pl.pc.close(); } catch (e) {} }
    var pc, sent = false;
    try { pc = new RTCPeerConnection({iceServers: [{urls: 'stun:stun.l.google.com:19302'}]}); } catch (e) { done(null); return; }
    pl.pc = pc; pl.dc = null;
    function finish() {
      if (sent) return;
      sent = true;
      done(pc.localDescription ? pc.localDescription.sdp : null);
    }
    pc.ondatachannel = function (ev) {
      var dc = ev.channel;
      dc.onopen = function () { pl.dc = dc; drawPlayers(); if (state === 'dance' && current) send(pl, goMessage(), false); };
      dc.onmessage = function (m) { var o = null; try { o = JSON.parse(m.data); } catch (x) {} if (o) fromPhone(o, true, pl); };
      dc.onclose = function () { if (pl.dc === dc) pl.dc = null; drawPlayers(); };
    };
    pc.onicecandidate = function (ev) { if (!ev.candidate) finish(); };
    pc.setRemoteDescription({type: 'offer', sdp: offer}).then(function () {
      return pc.createAnswer();
    }).then(function (a) {
      return pc.setLocalDescription(a);
    }).then(function () {
      if (pc.iceGatheringState === 'complete') finish();
      setTimeout(finish, 2500);
    }).catch(function () { finish(); });
  }

  function fromPhone(o, direct, pl) {
    if (!o || !o.t) return;
    if (o.t === 'join') { join(o); return; }
    pl = pl || playerBy(o.p);
    if (!pl) return;
    pl.last = Date.now();
    if (o.t === 'ping') { send(pl, {t: 'pong', c: o.c, s: Date.now()}, !direct); return; }
    if (o.t === 'hit') { hit(pl, o.i, o.g); return; }
    if (o.t === 'hits') { for (var i = 0; i < (o.h || []).length; i++) hit(pl, o.h[i][0], o.h[i][1]); return; }
    if (o.t === 'leave') { leave(pl); return; }
    if (o.t === 'avp') { avatarPart(pl, o); return; }
    if (o.t === 'drive' && direct) { setDrive(o.u); return; }
    if (o.t === 'drivelock') { unlock(o.iv, o.d, function (txt) { setDrive(txt); }); return; }
    if (o.t === 'avatar') { setAvatar(pl, o); send(pl, {t: 'gotavatar'}, false); drawPlayers(); return; }
    if (o.t === 'start' && state === 'lobby') { start(); return; }
  }

  // MARK: - Their own dancers ("gubbar"): a head cut out of a picture on the phone, and the colours of the clothes

  /** The picture comes in parts over WebRTC (16 kB each), put together here. */
  function avatarPart(pl, o) {
    if (!o.id || !(o.n > 0) || o.n > 80) return;
    var bag = pl.parts && pl.parts.id === o.id ? pl.parts : (pl.parts = {id: o.id, d: []});
    bag.d[o.i] = String(o.d || '');
    for (var i = 0; i < o.n; i++) if (bag.d[i] === undefined) return;
    var whole = null;
    try { whole = JSON.parse(bag.d.join('')); } catch (e) { whole = null; }
    pl.parts = null;
    if (whole) { setAvatar(pl, whole); send(pl, {t: 'gotavatar'}, false); drawPlayers(); }
  }

  /** Opens something locked with the key (base64 iv and data), done(text). */
  function unlock(iv64, data64, done) {
    var subtle = window.crypto && window.crypto.subtle;
    if (!subtle || !window.TextEncoder) return;
    function bytes(b64) { return Uint8Array.from(atob(b64), function (ch) { return ch.charCodeAt(0); }); }
    subtle.digest('SHA-256', new TextEncoder().encode(secret())).then(function (raw) {
      return subtle.importKey('raw', raw, {name: 'AES-GCM'}, false, ['decrypt']);
    }).then(function (key) {
      return subtle.decrypt({name: 'AES-GCM', iv: bytes(iv64)}, key, bytes(data64));
    }).then(function (plain) { done(new TextDecoder().decode(plain)); }).catch(function () {});
  }

  /** A gubbe that came through ntfy as a locked file: fetched, opened with the key, and used. */
  function avatarFile(o, url) {
    var pl = playerBy(o.p), subtle = window.crypto && window.crypto.subtle;
    if (!pl || !subtle || !window.TextEncoder || !o.iv) return;
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.responseType = 'arraybuffer';
    x.onload = function () {
      if (x.status !== 200) return;
      var iv = Uint8Array.from(atob(o.iv), function (ch) { return ch.charCodeAt(0); });
      subtle.digest('SHA-256', new TextEncoder().encode(secret())).then(function (raw) {
        return subtle.importKey('raw', raw, {name: 'AES-GCM'}, false, ['decrypt']);
      }).then(function (key) {
        return subtle.decrypt({name: 'AES-GCM', iv: iv}, key, x.response);
      }).then(function (plain) {
        var obj = JSON.parse(new TextDecoder().decode(plain));
        setAvatar(pl, obj);
        send(pl, {t: 'gotavatar'}, true);
        drawPlayers();
      }).catch(function (e) { if (window.console) console.log('Dansgolvet: gubben gick inte att öppna', e && e.message); });
    };
    x.send();
  }

  function setAvatar(pl, o) {
    if (!o.head) { pl.avatar = null; return; }
    var av = {ready: false, colors: o.colors || {}, name: o.gname || '', full: null}, waiting = 1;
    function load(src) {
      var im = new Image();
      im.onload = function () { if (--waiting === 0) av.ready = true; };
      im.onerror = function () { av.full = null; if (--waiting === 0) av.ready = true; };
      im.src = src;
      return im;
    }
    var f = o.full;
    if (f && f.body && f.legs && f.legs.length === 2) {   // a whole figure: the body and legs from the picture too
      waiting += 3;
      av.full = {head: f.head, body: f.body, legs: f.legs};
      av.full.body.im = load(f.body.img);
      av.full.legs[0].im = load(f.legs[0].img);
      av.full.legs[1].im = load(f.legs[1].img);
      if (f.arms && f.arms.length === 2) {
        waiting += 4;
        av.full.arms = f.arms;
        for (var k = 0; k < 2; k++) { f.arms[k].upper.im = load(f.arms[k].upper.img); f.arms[k].fore.im = load(f.arms[k].fore.img); }
      }
    }
    av.img = load(o.head);
    pl.avatar = av;
  }

  function leave(pl) {
    for (var i = 0; i < players.length; i++) if (players[i] === pl) players.splice(i, 1);
    try { if (pl.pc) pl.pc.close(); } catch (e) {}
    drawPlayers();
  }

  function hit(pl, i, g) {
    if (!current || state !== 'dance') return;
    var mv = current.dance.moves[i];
    if (!mv || !mv.scored || pl.hits[i] !== undefined) return;
    g = clamp(Math.round(g), 0, 4);
    pl.hits[i] = g;
    pl.score += POINTS[g];
    pl.grade = g; pl.gradeAt = Date.now();
    drawScores();
  }

  // MARK: - The screens: lobby → countdown and dance → results

  var opened = false, state = 'lobby', sel = 0, song = 0, hard = false, current = null, raf = 0;
  var zone = 'rows', side = 1, view = 'songs', preview = 0;
  var canvas = null, ctx = null, root = null, idleStart = 0;

  function build() {
    root = $('dance');
    if (!root) { root = el('div', 'layer', $('stage') || document.body); root.id = 'dance'; }
    root.innerHTML = '';
    canvas = el('canvas', 'd-stage', root);
    canvas.width = W; canvas.height = H;
    ctx = canvas.getContext('2d');
    el('div', 'd-hud', root);
    el('div', 'd-panel', root);
  }

  function open() {
    if (opened) return;
    if (!root) build();
    opened = true;
    topic(); secret();   // made (and kept) now, not only when the QR code draws
    state = 'lobby'; sel = 0; zone = 'rows'; view = 'songs'; queue = [];
    root.className = 'layer on';
    listen();
    drawLobby();
    previewSoon();
    idleStart = Date.now();
    loop();
  }

  function close() {
    if (!opened) return;
    stopMusic(); clearTimeout(preview);
    current = null;
    opened = false;
    root.className = 'layer';
    if (raf) { (window.cancelAnimationFrame || clearTimeout)(raf); raf = 0; }
    sendAll({t: 'bye'});
    unlisten();
    for (var i = 0; i < players.length; i++) { try { if (players[i].pc) players[i].pc.close(); } catch (e) {} }
    players = [];
  }

  function isOpen() { return opened; }

  function phoneUrl() {
    return PHONE + '?v=' + VERSION + '#' + topic() + '|' + (RELAY !== 'https://ntfy.sh/' ? RELAY : '') + '|' + secret() + ((cfg.drive || DRIVE) ? '|' + (cfg.drive || DRIVE) : '');
  }

  /** The Drive gubbar's script address, from a phone: kept here and put in the QR code for every phone. */
  function setDrive(u) {
    if (!/^https:\/\/script\.google(usercontent)?\.com\/[^\s|#]+$/.test(String(u || '')) || cfg.drive === u) return;
    cfg.drive = u; save();
    if (state === 'lobby' && opened && view === 'phones') drawLobby();
    if (window.FreeMyTV && FreeMyTV.toast) FreeMyTV.toast('Gubbarna från Drive är kopplade.');
  }

  var qrWait = null;
  function withQr(done) {
    if (window.qrcode) { done(true); return; }
    if (qrWait) { qrWait.push(done); return; }
    qrWait = [done];
    var s = document.createElement('script');
    s.src = QRLIB;
    s.onload = s.onerror = function () { var w = qrWait; qrWait = null; for (var i = 0; i < w.length; i++) w[i](!!window.qrcode); };
    document.head.appendChild(s);
  }

  function panel() { return root.querySelector('.d-panel'); }
  function hud() { return root.querySelector('.d-hud'); }

  // MARK: - The lobby: round buttons on the left, rows of song cards and playlists, the players on the right

  var CW = 360, CH = 203, STEP = 388, SHOW = 4, LW = 520, LSTEP = 556, LSHOW = 3;
  var PLAYLISTS = [
    {name: 'Barnkalas', songs: ['huvud', 'grodorna', 'imse', 'bjornen', 'fotboll', 'blinka'], color: '#FF8FB8', ink: '#5A0F32', art: 'party'},
    {name: 'Lugnt för de minsta', songs: ['blinka', 'godnatt', 'neon'], color: '#F4C534', ink: '#4A3A06', art: 'moon'},
    {name: 'Full fart', songs: ['robot', 'katt', 'fotboll', 'sol'], color: '#7180F0', ink: '#FFFFFF', art: 'bolt'},
    {name: 'Dansmaraton', songs: null, color: '#BBA8F2', ink: '#2C1868', art: 'ball'}
  ];
  var ICON = {
    home: 'M12 3 2 12h3v8h5v-5h4v5h5v-8h3z',
    note: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3z',
    bolt: 'M7 2v11h3v9l7-12h-4l4-8z',
    phone: 'M7 1h10a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm0 4v14h10V5z',
    clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm-1 3v6l5 3 1-1.6-4-2.4V7z'
  };
  function icon(name, parent, size) {
    var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
    size = size || 44;
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
    path.setAttribute('d', ICON[name]); path.setAttribute('fill', 'currentColor'); path.setAttribute('fill-rule', 'evenodd');
    svg.appendChild(path); parent.appendChild(svg);
    return svg;
  }

  function songIndex(id) { for (var i = 0; i < SONGS.length; i++) if (SONGS[i].id === id) return i; return -1; }
  function listSongs(pl) {
    var out = [], i;
    if (!pl.songs) { for (i = 0; i < SONGS.length; i++) out.push(i); return out; }
    for (i = 0; i < pl.songs.length; i++) { var k = songIndex(pl.songs[i]); if (k >= 0) out.push(k); }
    return out;
  }
  function songMinutes(sg) { return choreo(sg, false).beats / sg.bpm; }
  function best(sg) { return (cfg.best && cfg.best[sg.id]) || 0; }

  /** The lobby's rows: every song, the playlists, and (once something's been danced) the latest. */
  function rows() {
    var all = [], kids = [], recent = [], i;
    for (i = 0; i < SONGS.length; i++) (SONGS[i].kids ? kids : all).push(i);
    var r = cfg.recent || [];
    for (i = 0; i < r.length; i++) { var k = songIndex(r[i]); if (k >= 0) recent.push(k); }
    var out = [{key: 'all', title: 'Danslåtar', kind: 'song', items: all}, {key: 'kids', title: 'Barnsånger', kind: 'song', items: kids},
      {key: 'lists', title: 'Spellistor för hela familjen', kind: 'list', items: PLAYLISTS}];
    if (recent.length) out.push({key: 'recent', title: 'Senast dansade', kind: 'song', items: recent});
    return out;
  }

  var rowAt = 0, colAt = [0, 0, 0, 0], offAt = [0, 0, 0, 0], rowTop = 0, liveCover = null, coverCache = {}, queue = [];

  function starsEl(parent, n, cls) {
    var st = el('span', 'd-stars-row' + (cls ? ' ' + cls : ''), parent);
    for (var i = 0; i < 5; i++) el('span', i < n ? 'd-star on' : 'd-star', st, '★');
    return st;
  }

  function drawLobby() {
    var p = panel(), h = hud();
    h.innerHTML = '';
    p.className = 'd-panel lobby';
    p.innerHTML = '';
    // the round buttons
    var rail = el('div', 'd-rail', p), items = [['home', 'Stäng Dansgolvet'], ['note', 'Låtar'], ['bolt', 'Nivå: ' + (hard ? 'Svår' : 'Lätt')], ['phone', 'Mobiler']];
    for (var i = 0; i < items.length; i++) {
      var on = (i === 1 && view === 'songs') || (i === 3 && view === 'phones');
      var b = el('div', 'd-rbtn' + (on ? ' on' : '') + (zone === 'side' && side === i ? ' focus' : '') + (i === 2 && hard ? ' hard' : ''), rail);
      icon(items[i][0], b, 40);
      if (zone === 'side' && side === i) el('div', 'd-rtip', b, items[i][1]);
    }
    drawPill(p);
    if (view === 'songs' && !players.length) {   // the QR code is behind the phone button now: say so
      var nudge = el('div', 'd-nudge', p);
      nudge.appendChild(document.createTextNode('Vill du ha poäng? Välj '));
      icon('phone', nudge, 26);
      nudge.appendChild(document.createTextNode(' Mobiler till vänster och skanna koden.'));
    }
    var main = el('div', 'd-main', p), next = null;
    if (view === 'songs') next = drawRows(main); else drawPhones(main);
    if (liveCover && liveCover !== next) { drawCover(liveCover, liveCover.song, -1); }
    liveCover = next;
  }

  function drawRows(main) {
    var list = rows(), live = null;
    if (rowAt >= list.length) rowAt = list.length - 1;
    if (rowAt < rowTop) rowTop = rowAt;
    if (rowAt > rowTop + 2) rowTop = rowAt - 2;
    var y = 34 - rowTop * 330;
    for (var r = 0; r < list.length; r++) {
      var row = list[r], isList = row.kind === 'list', show = isList ? LSHOW : SHOW, step = isList ? LSTEP : STEP;
      var col = Math.min(colAt[r] || 0, row.items.length - 1);
      colAt[r] = col;
      if (col < offAt[r]) offAt[r] = col;
      if (col > offAt[r] + show - 1) offAt[r] = col - show + 1;
      offAt[r] = clamp(offAt[r], 0, Math.max(0, row.items.length - show));
      var box = el('div', 'd-row' + (r < rowTop ? ' gone' : ''), main);
      box.style.top = y + 'px';
      el('div', 'd-rtitle', box, row.title);
      var strip = el('div', 'd-strip', box);
      strip.style.left = (-offAt[r] * step) + 'px';
      for (var i = 0; i < row.items.length; i++) {
        var focus = zone === 'rows' && rowAt === r && col === i;
        var card = el('div', 'd-card2' + (isList ? ' list' : '') + (focus ? ' focus' : ''), strip);
        card.style.left = i * step + 'px';
        if (isList) { listCard(card, row.items[i]); continue; }
        var si = row.items[i], sg = SONGS[si], key = row.key + si, cv = coverCache[key];
        if (!cv) { cv = document.createElement('canvas'); cv.width = CW; cv.height = CH; cv.song = sg; drawCover(cv, sg, -1); coverCache[key] = cv; }
        var art = el('div', 'd-art', card);
        art.appendChild(cv);
        el('div', 'd-cname', art, sg.name);
        var meta = el('div', 'd-meta', card);
        var tempo = el('span', 'd-tempo-pill', meta), lvl = sg.bpm < 100 ? 1 : sg.bpm < 125 ? 2 : 3;
        for (var t = 0; t < 3; t++) el('span', t < lvl ? 'd-bar on' : 'd-bar', tempo);
        el('span', 'd-tempo-text', meta, sg.tempo);
        starsEl(meta, best(sg));
        if (focus) live = cv;
      }
      if (offAt[r] + show < row.items.length) el('div', 'd-peek', box);
      y += isList ? 330 : 330;
    }
    return live;
  }

  function listCard(card, pl) {
    var idx = listSongs(pl), mins = 0, stars = 0;
    for (var i = 0; i < idx.length; i++) { mins += songMinutes(SONGS[idx[i]]); stars += best(SONGS[idx[i]]); }
    var face = el('div', 'd-lface', card);
    face.style.background = pl.color; face.style.color = pl.ink;
    el('div', 'd-lstack', card).style.background = pl.color;
    el('div', 'd-lname', face, pl.name);
    var cv = el('canvas', 'd-lart', face);
    cv.width = 210; cv.height = 170;
    listArt(cv, pl);
    var meta = el('div', 'd-meta', card);
    var n = el('span', 'd-lcount', meta); icon('note', n, 26); n.appendChild(document.createTextNode(' ' + idx.length));
    var m = el('span', 'd-lcount', meta); icon('clock', m, 26); m.appendChild(document.createTextNode(' ' + Math.round(mins) + ' min'));
    starsEl(meta, Math.round(stars / Math.max(1, idx.length)));
  }

  /** A playlist's picture: a moon for the calm one, a bolt for the fast one, a disco ball for all of them. */
  function listArt(cv, pl) {
    var c = cv.getContext('2d'), w = cv.width, h = cv.height, i;
    if (pl.art === 'moon') {
      c.fillStyle = '#FFF4C8'; c.beginPath(); c.arc(w * 0.55, h * 0.5, 58, 0, Math.PI * 2); c.fill();
      c.fillStyle = pl.color; c.beginPath(); c.arc(w * 0.66, h * 0.4, 50, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#FFFFFF';
      var st = [[0.2, 0.25, 7], [0.85, 0.75, 5], [0.3, 0.8, 4], [0.9, 0.2, 6]];
      for (i = 0; i < st.length; i++) { star(c, st[i][0] * w, st[i][1] * h, st[i][2]); }
      c.fillStyle = '#FF8FB8'; c.beginPath(); c.arc(w * 0.42, h * 0.62, 6, 0, Math.PI * 2); c.fill();
    } else if (pl.art === 'bolt') {
      c.fillStyle = 'rgba(255, 255, 255, 0.25)';
      for (i = 0; i < 4; i++) c.fillRect(w * 0.08, h * (0.25 + i * 0.16), w * (0.22 - i * 0.04), 7);
      c.fillStyle = '#FFE14D';
      c.beginPath(); c.moveTo(w * 0.7, h * 0.05); c.lineTo(w * 0.42, h * 0.55); c.lineTo(w * 0.58, h * 0.55); c.lineTo(w * 0.46, h * 0.95);
      c.lineTo(w * 0.82, h * 0.4); c.lineTo(w * 0.65, h * 0.4); c.lineTo(w * 0.8, h * 0.05); c.closePath(); c.fill();
    } else if (pl.art === 'party') {
      var cols = ['#FFD23D', '#2EE6FF', '#7CFF5B', '#B34DFF', '#FFFFFF'], R = rng(5);
      for (i = 0; i < 26; i++) { c.fillStyle = cols[i % cols.length]; c.save(); c.translate(R() * w, R() * h); c.rotate(R() * 3); c.fillRect(-6, -3, 12, 6); c.restore(); }
      var bl = [[0.42, 0.4, '#FF3D7F'], [0.62, 0.32, '#3D7BFF'], [0.78, 0.46, '#FFD23D']];
      for (i = 0; i < bl.length; i++) {
        var bx = w * bl[i][0], by = h * bl[i][1];
        c.strokeStyle = 'rgba(90, 15, 50, 0.6)'; c.lineWidth = 2; c.beginPath(); c.moveTo(bx, by + 34); c.quadraticCurveTo(bx - 10, by + 70, bx + 4, h); c.stroke();
        c.fillStyle = bl[i][2]; c.beginPath(); if (c.ellipse) c.ellipse(bx, by, 26, 34, 0, 0, Math.PI * 2); else c.arc(bx, by, 30, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255, 255, 255, 0.45)'; c.beginPath(); c.arc(bx - 9, by - 12, 6, 0, Math.PI * 2); c.fill();
      }
    } else {
      var x = w * 0.55, y = h * 0.52, r = 62;
      c.strokeStyle = 'rgba(255, 255, 255, 0.8)'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, y - r); c.stroke();
      var g = c.createRadialGradient(x - 20, y - 20, 6, x, y, r);
      g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#7FA8D8');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      c.save(); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.clip();
      c.strokeStyle = 'rgba(40, 60, 110, 0.35)'; c.lineWidth = 2;
      for (i = -4; i <= 4; i++) { c.beginPath(); c.moveTo(x - r, y + i * 15); c.lineTo(x + r, y + i * 15); c.stroke(); c.beginPath(); c.moveTo(x + i * 15, y - r); c.lineTo(x + i * 15, y + r); c.stroke(); }
      c.restore();
      c.fillStyle = '#FFFFFF'; star(c, w * 0.2, h * 0.3, 9); star(c, w * 0.9, h * 0.75, 7); star(c, w * 0.25, h * 0.8, 5);
    }
  }
  function star(c, x, y, r) {
    c.beginPath(); c.moveTo(x, y - r * 2); c.lineTo(x + r * 0.5, y); c.lineTo(x, y + r * 2); c.lineTo(x - r * 0.5, y); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(x - r * 2, y); c.lineTo(x, y + r * 0.5); c.lineTo(x + r * 2, y); c.lineTo(x, y - r * 0.5); c.closePath(); c.fill();
  }

  /** The players, on the right: a phone button, then a ring for each of the four places. */
  function drawPill(p) {
    var pill = el('div', 'd-pill', p);
    var ph = el('div', 'd-pill-phone' + (view === 'phones' ? ' on' : ''), pill); icon('phone', ph, 34);
    for (var s2 = 0; s2 < 4; s2++) {
      var pl = null;
      for (var i = 0; i < players.length; i++) if (players[i].slot === s2) pl = players[i];
      var ring = el('div', 'd-ring' + (pl ? ' in' : ''), pill, pl ? pl.name.charAt(0).toUpperCase() : '+');
      ring.style.borderColor = COLORS[s2];
      if (pl) { ring.style.background = COLORS[s2]; ring.title = pl.name; }
    }
  }

  function drawPhones(main) {
    var box = el('div', 'd-phones', main);
    var q = el('div', 'd-qr', box);
    withQr(function (ok) {
      if (!ok) { q.textContent = 'QR-koden gick inte att ladda.'; return; }
      try { var qr = window.qrcode(0, 'M'); qr.addData(phoneUrl()); qr.make(); q.innerHTML = qr.createSvgTag({cellSize: 6, margin: 3}); } catch (e) { q.textContent = ''; }
    });
    var how = el('div', 'd-how', box);
    el('div', 'd-how-title', how, 'Vill du ha poäng?');
    el('div', 'd-how-step', how, '1.  Skanna koden med mobilens kamera.');
    el('div', 'd-how-step', how, '2.  Skriv ditt namn och välj din gubbe.');
    el('div', 'd-how-step', how, '3.  Håll mobilen i höger hand och härma.');
    el('div', 'd-players', how);
    el('div', 'd-how-back', how, 'Tillbaka  →  låtarna');
    drawPlayers();
  }

  /** Who's in: the rings on the right. */
  function drawChips() {
    if (!root || state !== 'lobby') return;
    var old = root.querySelector('.d-pill');
    if (!old) return;
    var p = old.parentNode;
    p.removeChild(old);
    drawPill(p);
  }

  /**
   * A song's cover: its colours, a pattern for its kind of music and the dancer in its signature move. beat < 0 is
   * the still picture; else the dancer dances (the card in focus).
   */
  function drawCover(cv, sg, beat) {
    var c = cv.getContext('2d'), w = cv.width, h = cv.height, cov = sg.cover, R = rng(sg.seed * 31 + 7), i, x, y, r;
    c.save();
    var g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, cov.bg[0]); g.addColorStop(1, cov.bg[1]);
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    var tick = beat < 0 ? 0 : beat, pulse = beat < 0 ? 1 : Math.max(0, 1 - (beat - Math.floor(beat)) * 2);
    if (cov.art === 'grid') {   // a neon floor running to the horizon, and a striped sun going down
      var mg = c.createLinearGradient(0, h * 0.1, 0, h * 0.62);
      mg.addColorStop(0, '#FFD23D'); mg.addColorStop(1, '#FF3DA5');
      c.fillStyle = mg; c.beginPath(); c.arc(w * 0.5, h * 0.62, h * 0.46, Math.PI, 0); c.fill();
      c.fillStyle = cov.bg[0];
      for (i = 0; i < 5; i++) c.fillRect(0, h * (0.36 + i * 0.05), w, 2 + i * 1.5);
      c.fillStyle = 'rgba(20, 6, 50, 0.7)'; c.fillRect(0, h * 0.62, w, h);
      c.strokeStyle = 'rgba(46, 230, 255, ' + (0.4 + 0.3 * pulse).toFixed(2) + ')'; c.lineWidth = 2;
      for (i = 0; i < 6; i++) { y = h * 0.62 + Math.pow(((i + tick % 1) / 6), 1.8) * h * 0.4; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      for (i = -8; i <= 8; i++) { c.beginPath(); c.moveTo(w / 2 + i * 10, h * 0.62); c.lineTo(w / 2 + i * 70, h); c.stroke(); }
    } else if (cov.art === 'sun') {   // sun rays turning slowly
      c.translate(w * 0.5, h * 0.4);
      c.rotate(tick * 0.06);
      c.fillStyle = 'rgba(255, 255, 255, 0.3)';
      for (i = 0; i < 14; i++) {
        c.rotate(Math.PI / 7);
        c.beginPath(); c.moveTo(0, 0); c.lineTo(-w * 0.07, -w); c.lineTo(w * 0.07, -w); c.closePath(); c.fill();
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = '#FFF6B8'; c.beginPath(); c.arc(w * 0.5, h * 0.4, h * 0.22, 0, Math.PI * 2); c.fill();
    } else if (cov.art === 'ball') {   // disco balls and their sparkles
      for (i = 0; i < 34; i++) {
        x = R() * w; y = R() * h; r = 2 + R() * 4;
        var tw = beat < 0 ? 0.8 : 0.3 + 0.7 * Math.abs(Math.sin(beat * 1.5 + i));
        c.fillStyle = 'rgba(255, 255, 255, ' + tw.toFixed(2) + ')';
        star(c, x, y, r * 0.6);
      }
      var balls = [[0.16, 0.3, 0.13], [0.84, 0.24, 0.16]];
      for (var k = 0; k < balls.length; k++) {
        x = w * balls[k][0]; y = h * balls[k][1]; r = h * balls[k][2];
        c.strokeStyle = 'rgba(255, 255, 255, 0.6)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, y - r); c.stroke();
        c.fillStyle = '#D8E2EA'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(40, 60, 80, 0.45)';
        for (i = -2; i <= 2; i++) {
          c.beginPath(); c.moveTo(x - r, y + i * r * 0.35); c.lineTo(x + r, y + i * r * 0.35); c.stroke();
          c.beginPath(); c.moveTo(x + i * r * 0.35, y - r); c.lineTo(x + i * r * 0.35, y + r); c.stroke();
        }
      }
    } else if (cov.art === 'dots') {   // polka dots and swirls of stripes
      for (i = 0; i < 22; i++) {
        c.fillStyle = i % 3 ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 230, 80, 0.5)';
        c.beginPath(); c.arc(R() * w, R() * h, 6 + R() * 16, 0, Math.PI * 2); c.fill();
      }
      c.lineWidth = 10;
      c.strokeStyle = 'rgba(46, 230, 255, 0.7)'; c.beginPath(); c.arc(0, h * 1.1, h * 0.7, -Math.PI / 2, 0); c.stroke();
      c.strokeStyle = 'rgba(255, 255, 255, 0.55)'; c.lineWidth = 6; c.beginPath(); c.arc(w, h * 1.1, h * 0.7, Math.PI, Math.PI * 1.5); c.stroke();
    } else if (cov.art === 'pitch') {   // a football pitch's lines, and a ball that bounces
      c.fillStyle = 'rgba(255, 255, 255, 0.08)';
      for (i = 0; i < 8; i += 2) c.fillRect(i * w / 8, 0, w / 8, h);
      c.strokeStyle = 'rgba(255, 255, 255, 0.6)'; c.lineWidth = 4;
      c.beginPath(); c.moveTo(w * 0.5, 0); c.lineTo(w * 0.5, h); c.stroke();
      c.beginPath(); c.arc(w * 0.5, h * 0.55, h * 0.3, 0, Math.PI * 2); c.stroke();
      c.strokeRect(-4, h * 0.25, w * 0.12, h * 0.5); c.strokeRect(w * 0.88, h * 0.25, w * 0.13, h * 0.5);
      x = w * 0.2; y = h * 0.3 - (beat < 0 ? 0 : Math.abs(Math.sin(beat * Math.PI)) * 18); r = h * 0.11;
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#1A1A1A'; c.beginPath(); c.arc(x, y, r * 0.38, 0, Math.PI * 2); c.fill();
      for (i = 0; i < 5; i++) { var a2 = i * Math.PI * 2 / 5 - Math.PI / 2; c.beginPath(); c.arc(x + Math.cos(a2) * r * 0.8, y + Math.sin(a2) * r * 0.8, r * 0.2, 0, Math.PI * 2); c.fill(); }
    } else if (cov.art === 'stars') {   // a moon and twinkling stars
      for (i = 0; i < 40; i++) {
        var tw2 = beat < 0 ? 0.7 : 0.3 + 0.7 * Math.abs(Math.sin(beat * 0.7 + i * 1.7));
        c.fillStyle = 'rgba(255, 246, 214, ' + tw2.toFixed(2) + ')';
        c.beginPath(); c.arc(R() * w, R() * h * 0.85, 1 + R() * 2.4, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = '#FFF0B8'; c.beginPath(); c.arc(w * 0.82, h * 0.3, h * 0.17, 0, Math.PI * 2); c.fill();
      c.fillStyle = cov.bg[1]; c.beginPath(); c.arc(w * 0.87, h * 0.24, h * 0.145, 0, Math.PI * 2); c.fill();
    } else if (cov.art === 'confetti') {   // confetti falling, and big friendly dots
      var cc = ['#FFD23D', '#2EE6FF', '#7CFF5B', '#FFFFFF', '#B34DFF'];
      for (i = 0; i < 9; i++) { c.fillStyle = 'rgba(255, 255, 255, 0.16)'; c.beginPath(); c.arc(R() * w, R() * h, 20 + R() * 34, 0, Math.PI * 2); c.fill(); }
      for (i = 0; i < 46; i++) {
        x = R() * w; y = (R() * h + tick * 18 * (0.6 + (i % 4) * 0.2)) % (h + 20) - 10;
        c.fillStyle = cc[i % cc.length]; c.save(); c.translate(x, y); c.rotate(R() * 6 + tick); c.fillRect(-6, -3, 12, 6); c.restore();
      }
    } else if (cov.art === 'web') {   // a spider's web in the corner, the spider going up and down its thread
      c.strokeStyle = 'rgba(255, 255, 255, 0.45)'; c.lineWidth = 1.5;
      var cx0 = w * 0.08, cy0 = h * 0.05;
      for (i = 0; i < 7; i++) { var ang = i / 6 * Math.PI / 2; c.beginPath(); c.moveTo(cx0, cy0); c.lineTo(cx0 + Math.cos(ang) * h * 0.8, cy0 + Math.sin(ang) * h * 0.8); c.stroke(); }
      for (var ring = 1; ring < 6; ring++) {
        c.beginPath();
        for (i = 0; i < 7; i++) { var a3 = i / 6 * Math.PI / 2, rr = ring * h * 0.13; c[i ? 'lineTo' : 'moveTo'](cx0 + Math.cos(a3) * rr, cy0 + Math.sin(a3) * rr); }
        c.stroke();
      }
      x = w * 0.84; y = h * (0.3 + (beat < 0 ? 0.15 : 0.18 * (1 + Math.sin(beat * Math.PI / 2))));
      c.strokeStyle = 'rgba(255, 255, 255, 0.7)'; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, y); c.stroke();
      c.strokeStyle = '#1A1030'; c.lineWidth = 3;
      for (i = 0; i < 4; i++) { c.beginPath(); c.moveTo(x - 6, y); c.lineTo(x - 22, y - 10 + i * 8); c.moveTo(x + 6, y); c.lineTo(x + 22, y - 10 + i * 8); c.stroke(); }
      c.fillStyle = '#1A1030'; c.beginPath(); c.arc(x, y, 13, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(x - 5, y - 3, 4, 0, Math.PI * 2); c.arc(x + 5, y - 3, 4, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(180, 230, 255, 0.6)';
      for (i = 0; i < 16; i++) { var dx = R() * w, dy = (R() * h + (beat < 0 ? 0 : beat * 40)) % h; c.fillRect(dx, dy, 2, 9); }
    } else if (cov.art === 'bear') {   // a night forest, a moon, and a sleeping bear's cave with its Zzz
      c.fillStyle = '#FFF0B8'; c.beginPath(); c.arc(w * 0.8, h * 0.22, h * 0.12, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(8, 24, 20, 0.9)';
      var trees = [0.06, 0.2, 0.62, 0.96];
      for (i = 0; i < trees.length; i++) { x = w * trees[i]; c.beginPath(); c.moveTo(x, h * 0.18); c.lineTo(x - 34, h * 0.8); c.lineTo(x + 34, h * 0.8); c.closePath(); c.fill(); }
      c.fillStyle = '#3B2A1E'; c.beginPath(); c.arc(w * 0.18, h, h * 0.42, Math.PI, 0); c.fill();
      c.fillStyle = '#120A06'; c.beginPath(); c.arc(w * 0.18, h, h * 0.24, Math.PI, 0); c.fill();
      c.fillStyle = 'rgba(255, 255, 255, 0.85)'; c.font = '700 22px Arial';
      var zz = beat < 0 ? 0 : (beat * 0.5) % 1;
      c.fillText('z', w * 0.24, h * (0.62 - zz * 0.1)); c.font = '700 30px Arial'; c.fillText('Z', w * 0.29, h * (0.5 - zz * 0.1));
    } else if (cov.art === 'pond') {   // a pond with lily pads, and a little frog hopping on one
      c.fillStyle = 'rgba(20, 90, 120, 0.45)'; c.fillRect(0, h * 0.62, w, h);
      c.strokeStyle = 'rgba(255, 255, 255, 0.35)'; c.lineWidth = 2;
      for (i = 0; i < 5; i++) { c.beginPath(); if (c.ellipse) c.ellipse(R() * w, h * (0.7 + R() * 0.25), 30 + R() * 30, 6, 0, 0, Math.PI * 2); c.stroke(); }
      var pads = [[0.14, 0.74, 34], [0.86, 0.8, 40], [0.7, 0.66, 24]];
      for (i = 0; i < pads.length; i++) {
        c.fillStyle = '#3FA34D'; c.beginPath(); c.moveTo(w * pads[i][0], h * pads[i][1]);
        c.arc(w * pads[i][0], h * pads[i][1], pads[i][2], 0.3, Math.PI * 2 - 0.1); c.closePath(); c.fill();
      }
      x = w * 0.14; y = h * 0.62 - (beat < 0 ? 0 : Math.abs(Math.sin(beat * Math.PI)) * 22);
      c.fillStyle = '#7CFF5B'; c.beginPath(); if (c.ellipse) c.ellipse(x, y, 20, 14, 0, 0, Math.PI * 2); else c.arc(x, y, 16, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(x - 8, y - 12, 6, 0, Math.PI * 2); c.arc(x + 8, y - 12, 6, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#10301A'; c.beginPath(); c.arc(x - 8, y - 12, 2.6, 0, Math.PI * 2); c.arc(x + 8, y - 12, 2.6, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255, 255, 255, 0.7)';
      for (i = 0; i < 6; i++) { c.beginPath(); c.arc(R() * w, R() * h * 0.5, 2 + R() * 2, 0, Math.PI * 2); c.fill(); }
    } else if (cov.art === 'bolt') {   // speaker stripes and lightning bolts that flash on the beat
      c.strokeStyle = 'rgba(232, 255, 61, 0.3)'; c.lineWidth = 7;
      for (i = 0; i < 14; i++) { c.beginPath(); c.moveTo(-60 + i * 34, h); c.lineTo(40 + i * 34, 0); c.stroke(); }
      c.fillStyle = 'rgba(232, 255, 61, ' + (0.55 + 0.45 * pulse).toFixed(2) + ')';
      var bolts = [[0.14, 1], [0.86, -1]];
      for (k = 0; k < bolts.length; k++) {
        x = w * bolts[k][0]; var d = bolts[k][1] * h * 0.1;
        c.beginPath(); c.moveTo(x + d, h * 0.05); c.lineTo(x - d * 0.6, h * 0.5); c.lineTo(x + d * 0.3, h * 0.5); c.lineTo(x - d, h * 0.95);
        c.lineTo(x + d * 1.2, h * 0.4); c.lineTo(x + d * 0.2, h * 0.4); c.lineTo(x + d * 1.6, h * 0.05); c.closePath(); c.fill();
      }
    }
    c.restore();
    // the dancer, big, the feet out of the picture like on a poster
    var f = MOVES[cov.move].f, pose = beat < 0 ? f[f.length > 1 ? 1 : 0] : poseAt(cov.move, beat);
    if (beat >= 0) pose = mixBounce(pose, 5 * Math.sin(Math.PI * (beat - Math.floor(beat))));
    drawDancer(c, pose, w / 2, h * 1.18, h / 720, beat < 0 ? 0.5 : pulse, false, cov.pal);
    // a soft dark edge at the bottom, for the name
    var sh = c.createLinearGradient(0, h * 0.6, 0, h);
    sh.addColorStop(0, 'rgba(0, 0, 0, 0)'); sh.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    c.fillStyle = sh; c.fillRect(0, h * 0.6, w, h * 0.4);
  }

  /** The card in focus dances to its song (the preview while it plays). */
  function lobbyFrame() {
    if (!liveCover) return;
    var sg = liveCover.song, beat;
    if (music && music.song === sg && actx) beat = (actx.currentTime - music.t0) * sg.bpm / 60;
    else beat = (Date.now() - idleStart) / 1000 * sg.bpm / 60;
    drawCover(liveCover, sg, Math.max(0, beat));
  }

  /** A bit of the song in focus (its chorus) once the focus rests on it. */
  function previewSoon() {
    clearTimeout(preview);
    preview = setTimeout(function () {
      if (!opened || state !== 'lobby' || !liveCover) return;
      var sg = liveCover.song;
      if (music && music.song === sg) return;
      stopMusic();
      var m = startMusic(sg, 0.15);
      if (!m) return;
      var s16 = 60 / sg.bpm / 4, from = 12 * 16;   // bar 12: the first chorus (a children's song: from the start)
      if (!sg.tune) { m.step = from; m.t0 -= from * s16; }
      try { master.gain.cancelScheduledValues(actx.currentTime); master.gain.setValueAtTime(0.0001, actx.currentTime); master.gain.exponentialRampToValueAtTime(0.45, actx.currentTime + 0.6); } catch (e) {}
    }, 650);
  }

  /** Remember how it went: the best stars for the song, and that it was danced (the "latest" row). */
  function remember(sg) {
    var top = 0;
    for (var i = 0; i < players.length; i++) top = Math.max(top, stars(players[i]));
    if (!cfg.best) cfg.best = {};
    if (top > (cfg.best[sg.id] || 0)) cfg.best[sg.id] = top;
    var r = cfg.recent || [], out = [sg.id];
    for (i = 0; i < r.length && out.length < 8; i++) if (r[i] !== sg.id) out.push(r[i]);
    cfg.recent = out;
    save();
  }

  function lobbyKey(k, back) {
    if (zone === 'rows' && view === 'songs') {
      var list = rows(), row = list[rowAt], was = liveCover;
      if (back) { close(); return; }
      if (k === K.left) { if (colAt[rowAt] === 0) { zone = 'side'; side = 1; } else colAt[rowAt]--; }
      else if (k === K.right) { if (colAt[rowAt] < row.items.length - 1) colAt[rowAt]++; }
      else if (k === K.up || k === K.down) {
        var to = rowAt + (k === K.up ? -1 : 1);
        if (to < 0 || to >= list.length) return;
        var seen = colAt[rowAt] - offAt[rowAt], isList = list[to].kind === 'list', fromList = row.kind === 'list';
        if (isList !== fromList) seen = Math.round(seen * (fromList ? LSTEP / STEP : STEP / LSTEP));
        colAt[to] = clamp(offAt[to] + seen, 0, list[to].items.length - 1);
        rowAt = to;
      } else if (k === K.ok) {
        if (row.kind === 'list') { queue = listSongs(row.items[colAt[rowAt]]); song = queue.shift(); start(); }
        else { queue = []; song = row.items[colAt[rowAt]]; start(); }
        return;
      } else return;
      drawLobby();
      if (liveCover) { song = SONGS.indexOf(liveCover.song); if (liveCover !== was) previewSoon(); }
      return;
    }
    // the round buttons
    if (back) { if (view === 'phones') { view = 'songs'; side = 1; zone = 'rows'; drawLobby(); } else close(); return; }
    if (k === K.up && side > 0) side--;
    else if (k === K.down && side < 3) side++;
    else if (k === K.right) { zone = 'rows'; view = 'songs'; }
    else if (k === K.ok) {
      if (side === 0) { close(); return; }
      if (side === 1) { view = 'songs'; zone = 'rows'; }
      if (side === 2) hard = !hard;
      if (side === 3) view = 'phones';
    } else return;
    drawLobby();
    if (view === 'songs' && zone === 'rows') previewSoon();
  }

  function drawPlayers() {
    if (!root) return;
    drawChips();
    var box = root.querySelector('.d-players');
    if (!box) { drawScores(); return; }
    box.innerHTML = '';
    for (var s = 0; s < 4; s++) {
      var pl = null;
      for (var i = 0; i < players.length; i++) if (players[i].slot === s) pl = players[i];
      var row = el('div', 'd-slot' + (pl ? ' in' : ''), box);
      var dot = el('span', 'd-dot', row); dot.style.background = COLORS[s];
      el('span', 'd-pname', row, pl ? pl.name : 'Ledig plats');
      if (pl) el('span', 'd-link', row, (pl.avatar ? 'Egen gubbe · ' : '') + (pl.dc ? 'Ansluten' : 'Via nätet'));
    }
  }

  var scoresKey = '';
  function drawScores() {
    if (!root || state !== 'dance') return;
    var box = root.querySelector('.d-scores');
    if (!box) return;
    var key = '';   // only redrawn when something shown changes (else the grades' pop starts over)
    for (var j = 0; j < players.length; j++) {
      var q = players[j];
      key += q.name + ':' + q.score + ':' + (q.grade >= 0 && Date.now() - q.gradeAt < 1400 ? q.grade + '@' + q.gradeAt : '-') + '|';
    }
    if (key === scoresKey && box.childNodes.length) return;
    scoresKey = key;
    box.innerHTML = '';
    for (var i = 0; i < players.length; i++) {
      var pl = players[i], card = el('div', 'd-card', box);
      card.style.borderColor = pl.color;
      var dot = el('span', 'd-dot', card); dot.style.background = pl.color;
      el('span', 'd-pname', card, pl.name);
      el('span', 'd-score', card, String(pl.score));
      if (pl.grade >= 0 && Date.now() - pl.gradeAt < 1400) {
        var g = el('div', 'd-grade g' + pl.grade, card, GRADES[pl.grade]);
        g.style.color = pl.grade >= 3 ? pl.color : '';
      }
    }
  }

  function goMessage() {
    var mv = current.dance.moves, list = [], lib = {};
    for (var i = 0; i < mv.length; i++) {
      if (!mv[i].scored) continue;
      list.push([mv[i].i, mv[i].b, mv[i].n, mv[i].id]);
      if (!lib[mv[i].id]) lib[mv[i].id] = [MOVES[mv[i].id].name, SIG[mv[i].id].e, SIG[mv[i].id].d];
    }
    return {t: 'go', song: current.song.name, bpm: current.song.bpm, at: current.at, hard: hard, m: list, lib: lib, beats: current.dance.beats};
  }

  function start() {
    var s = SONGS[song];
    for (var i = 0; i < players.length; i++) { players[i].score = 0; players[i].hits = []; players[i].grade = -1; }
    clearTimeout(preview); stopMusic();
    var m = startMusic(s, 0.8);
    current = {song: s, dance: choreo(s, hard), music: m, beat: -1};
    current.firstScored = 16;
    for (var f = 0; f < current.dance.moves.length; f++) if (current.dance.moves[f].scored) { current.firstScored = current.dance.moves[f].b; break; }
    // When beat 0 happens, by this TV's clock (the phones line up their own to it)
    current.at = m ? Date.now() + Math.round((m.t0 - actx.currentTime + (actx.outputLatency || actx.baseLatency || 0)) * 1000) : Date.now() + 800;
    current.startedAt = Date.now();
    state = 'dance';
    var p = panel();
    p.className = 'd-panel dancing';
    p.innerHTML = '';
    var h = hud();
    h.innerHTML = '';
    var top = el('div', 'd-top', h);
    var t = el('div', 'd-songname', top, s.name + (hard ? '  ·  Svår' : '  ·  Lätt'));
    t.style.color = s.color;
    var bar = el('div', 'd-progress', top); el('div', 'd-fill', bar);
    el('div', 'd-scores', h);
    var next = el('div', 'd-next', h);
    el('div', 'd-next-title', next, 'Sedan');
    for (var k = 0; k < 3; k++) {
      var c = el('div', 'd-thumb', next), cv = el('canvas', '', c);
      cv.width = 150; cv.height = 190;
      el('div', 'd-tname', c);
    }
    var nowBox = el('div', 'd-now', h);
    el('div', 'd-move', nowBox);
    el('div', 'd-beats', nowBox);
    el('div', 'd-count', h);
    drawScores();
    sendAll(goMessage());
  }

  function finish() {
    stopMusic();
    sendAll({t: 'done'});
    if (current) remember(current.song);
    state = 'results'; sel = 0;
    drawResults();
  }

  function stars(pl) {
    var max = 0, mv = current ? current.dance.moves : [];
    for (var i = 0; i < mv.length; i++) if (mv[i].scored) max += POINTS[4];
    var r = max ? pl.score / max : 0;
    return r >= 0.85 ? 5 : r >= 0.7 ? 4 : r >= 0.5 ? 3 : r >= 0.3 ? 2 : r > 0.05 ? 1 : 0;
  }

  function drawResults() {
    var h = hud(); h.innerHTML = '';
    var p = panel();
    p.className = 'd-panel results';
    p.innerHTML = '';
    el('div', 'd-title', p, players.length ? 'Snyggt dansat!' : 'Tack för dansen!');
    var list = players.slice().sort(function (a, b) { return b.score - a.score; });
    var box = el('div', 'd-ranks', p);
    if (!list.length) el('div', 'd-sub', box, 'Ingen mobil var med den här gången, så ingen fick poäng. Skanna QR-koden nästa gång!');
    for (var i = 0; i < list.length; i++) {
      var pl = list[i], row = el('div', 'd-rank', box), n = stars(pl);
      row.style.borderColor = pl.color;
      el('span', 'd-place', row, i === 0 && list.length > 1 ? '👑' : String(i + 1));
      var dot = el('span', 'd-dot', row); dot.style.background = pl.color;
      el('span', 'd-pname', row, pl.name);
      el('span', 'd-stars', row, new Array(n + 1).join('★') + new Array(6 - n).join('☆'));
      el('span', 'd-score', row, String(pl.score));
      var counts = [0, 0, 0, 0, 0];
      for (var k in pl.hits) if (pl.hits.hasOwnProperty(k)) counts[pl.hits[k]]++;
      el('span', 'd-perfects', row, counts[4] + ' perfekta');
    }
    var btns = el('div', 'd-buttons', p), labels = resultButtons();
    for (var b = 0; b < labels.length; b++) el('div', 'd-btn' + (b === sel ? ' focus' : '') + (b === 0 && queue.length ? ' next' : ''), btns, labels[b][1]);
  }

  /** The buttons after a song: with a playlist going, the next song first. */
  function resultButtons() {
    var out = [];
    if (queue.length) out.push(['next', 'Nästa: ' + SONGS[queue[0]].name]);
    out.push(['again', 'Dansa igen'], ['lobby', 'Välj en annan låt']);
    return out;
  }

  function backToLobby() { stopMusic(); current = null; state = 'lobby'; zone = 'rows'; view = 'songs'; queue = []; sendAll({t: 'lobby'}); drawLobby(); previewSoon(); }

  // MARK: - Drawing the stage, every frame

  function loop() {
    if (!opened) return;
    var rafFn = window.requestAnimationFrame || function (f) { return setTimeout(f, 33); };
    raf = rafFn(loop);
    frame();
  }

  /** Where the song is, in beats (from the audio clock when there's music). */
  function beatNow() {
    if (!current) return (Date.now() - idleStart) / 1000 * (100 / 60);
    if (current.music && actx) return (actx.currentTime - current.music.t0) * current.song.bpm / 60;
    return (Date.now() - current.at) / 1000 * current.song.bpm / 60;
  }

  function moveAt(beat) {
    var mv = current.dance.moves;
    for (var i = mv.length - 1; i >= 0; i--) if (beat >= mv[i].b) return mv[i];
    return null;
  }

  var lastSecond = -1;
  function frame() {
    if (state === 'lobby') { lobbyFrame(); return; }
    var c = ctx, beat = beatNow(), phase = beat - Math.floor(beat), pulse = Math.max(0, 1 - phase * 2.2);
    var accent = current ? current.song.color : '#B34DFF';
    drawBackdrop(c, beat, pulse, accent);

    var pose, mv = null;
    if (state === 'dance' && current) {
      if (beat < 0) pose = poseAt('gunga', 0);
      else {
        mv = moveAt(beat);
        pose = mv ? poseAt(mv.id, beat - mv.b) : poseAt('frys', 0);
        var was = mv && mv.i > 0 ? current.dance.moves[mv.i - 1] : null, into = mv ? beat - mv.b : 1;
        if (was && into < 0.22) pose = mix(poseAt(was.id, mv.b - was.b), pose, ease(into / 0.22));
      }
    } else {
      pose = poseAt(state === 'results' ? 'vinka' : 'gunga', beat);
    }
    // a little bounce on every beat
    var bounce = state === 'dance' && beat >= 0 && (!mv || mv.id !== 'frys') ? 10 * Math.sin(Math.PI * phase) : 4 * Math.sin(Math.PI * phase);
    pose = mixBounce(pose, bounce);
    var dancers = dancersNow(), spots = layout(dancers.length);
    for (var d = 0; d < dancers.length; d++) {
      var sp = spots[d], who = dancers[d];
      drawShadow(c, sp.x + pose.x * sp.s, sp.gy, sp.s);
      if (who && who.avatar && who.avatar.ready) drawAvatar(c, pose, sp.x, sp.gy, sp.s, who.avatar, who.color, pulse, state === 'dance');
      else drawDancer(c, pose, sp.x, sp.gy, sp.s, pulse, state === 'dance');
      if (who && dancers.length > 1) nameTag(c, who, sp.x, sp.gy, sp.s);
    }

    if (state === 'dance' && current) danceHud(beat, mv);
  }

  /** Who dances: everyone who has a gubbe of their own (in the results, the winner); else the neon dancer. */
  function dancersNow() {
    var own = [];
    for (var i = 0; i < players.length; i++) if (players[i].avatar) own.push(players[i]);
    if (state === 'results' && own.length) {
      own.sort(function (a, b) { return b.score - a.score; });
      return [own[0]];
    }
    return own.length ? players.slice(0, 4) : [null];   // with any gubbe: everyone dances (neon for those without one)
  }

  /** Where the dancers stand: one big in the middle, or a row. */
  function layout(n) {
    var out = [], i;
    if (state === 'results') return [{x: 1520, gy: 1010, s: 0.9}];
    var size = [1.12, 0.95, 0.8, 0.7][n - 1] || 0.7, span = [0, 620, 900, 1110][n - 1] || 1110, mid = n > 2 ? 880 : W / 2;
    for (i = 0; i < n; i++) out.push({x: n === 1 ? W / 2 : mid - span / 2 + span * i / (n - 1), gy: 1000, s: size});
    return out;
  }

  function nameTag(c, pl, x, gy, s) {
    c.save();
    c.font = '700 ' + Math.round(30 * s + 6) + 'px Inter, Helvetica Neue, Arial, sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(10, 7, 22, 0.75)';
    var w = c.measureText(pl.name).width + 36;
    c.beginPath();
    if (c.roundRect) c.roundRect(x - w / 2, gy + 18, w, 44, 22); else c.rect(x - w / 2, gy + 18, w, 44);
    c.fill();
    c.fillStyle = pl.color;
    c.fillText(pl.name, x, gy + 51);
    c.restore();
  }

  function shade(hex, f) {
    var n = parseInt(String(hex || '#888888').slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    function k(v) { return Math.round(clamp(f < 0 ? v * (1 + f) : v + (255 - v) * f, 0, 255)); }
    return 'rgb(' + k(r) + ', ' + k(g) + ', ' + k(b) + ')';
  }

  /**
   * A player's own dancer: the head from their picture on a body in the colours of their clothes, on the same
   * skeleton (and the same moves) as the neon dancer, with a glow in the player's colour.
   */
  function drawAvatar(c, p, cx, gy, s, av, color, beatGlow, lead) {
    if (av.full) return drawFull(c, p, cx, gy, s, av, color, beatGlow, lead);
    var J = joints(p, cx, gy, s), col = av.colors, top = col.top || '#9AA0B4', skin = col.skin || '#E0AC8A';
    var legs = col.legs || skin, shoes = col.shoes || '#F2F2F2';
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    function line(a, b, w, st) { c.strokeStyle = st; c.lineWidth = w; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
    function limb(a, b, d, w, st) { c.strokeStyle = st; c.lineWidth = w; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.stroke(); }
    // the player's colour as a glow behind
    var glow = hexA(color, 0.22 + 0.18 * (beatGlow || 0));
    limb(J.lh, J.lk, J.lf, 70 * s, glow); limb(J.rh, J.rk, J.rf, 70 * s, glow);
    limb(J.ls, J.le, J.lw, 70 * s, glow); limb(J.rs, J.re, J.rw, 70 * s, glow);
    line(J.hip, J.neck, 150 * s, glow);
    // legs and shoes
    limb(J.lh, J.lk, J.lf, 38 * s, shade(legs, -0.35)); limb(J.rh, J.rk, J.rf, 38 * s, shade(legs, -0.35));
    limb(J.lh, J.lk, J.lf, 30 * s, legs); limb(J.rh, J.rk, J.rf, 30 * s, legs);
    var feet = [[J.lf, -1], [J.rf, 1]];
    for (var f = 0; f < 2; f++) {
      c.fillStyle = shade(shoes, -0.3);
      c.beginPath();
      if (c.ellipse) c.ellipse(feet[f][0][0] + feet[f][1] * 8 * s, feet[f][0][1] + 4 * s, 34 * s, 18 * s, 0, 0, Math.PI * 2); else c.arc(feet[f][0][0], feet[f][0][1], 22 * s, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = shoes;
      c.beginPath();
      if (c.ellipse) c.ellipse(feet[f][0][0] + feet[f][1] * 8 * s, feet[f][0][1] + 1 * s, 30 * s, 14 * s, 0, 0, Math.PI * 2); else c.arc(feet[f][0][0], feet[f][0][1], 18 * s, 0, Math.PI * 2);
      c.fill();
    }
    // the top: from the shoulders, a little wider at the bottom, down past the hips
    var lr = p.lean * Math.PI / 180, ux = Math.sin(lr), uy = -Math.cos(lr), px = -uy, py = ux;
    var hemX = J.hip[0] - ux * 70 * s, hemY = J.hip[1] - uy * 70 * s;
    var pts = [
      [J.ls[0] - px * 18 * s, J.ls[1] - py * 18 * s], [J.rs[0] + px * 18 * s, J.rs[1] + py * 18 * s],
      [hemX + px * 92 * s, hemY + py * 92 * s], [hemX - px * 92 * s, hemY - py * 92 * s]
    ];
    function poly(fill, grow) {
      c.fillStyle = fill; c.strokeStyle = fill; c.lineWidth = grow;
      c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
      for (var k = 1; k < pts.length; k++) c.lineTo(pts[k][0], pts[k][1]);
      c.closePath(); c.fill(); if (grow) c.stroke();
    }
    poly(shade(top, -0.3), 14 * s);
    poly(top, 0);
    c.strokeStyle = shade(top, -0.15); c.lineWidth = 6 * s;   // a hem
    c.beginPath(); c.moveTo(pts[3][0], pts[3][1]); c.lineTo(pts[2][0], pts[2][1]); c.stroke();
    // arms: sleeves in the top's colour, hands in skin
    function arm(sh, el, wr) {
      limb(sh, el, wr, 46 * s, shade(top, -0.3));
      limb(sh, el, wr, 38 * s, top);
      c.fillStyle = skin; c.beginPath(); c.arc(wr[0], wr[1], 17 * s, 0, Math.PI * 2); c.fill();
    }
    arm(J.ls, J.le, J.lw); arm(J.rs, J.re, J.rw);
    if (lead) {
      var r = (24 + 8 * (beatGlow || 0)) * s;
      c.fillStyle = 'rgba(255, 210, 61, 0.3)'; c.beginPath(); c.arc(J.rw[0], J.rw[1], r * 1.9, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#FFD23D'; c.lineWidth = 7 * s; c.beginPath(); c.arc(J.rw[0], J.rw[1], r, 0, Math.PI * 2); c.stroke();
    }
    // a neck, then the head from the picture, tilting with the body
    line(J.neck, [J.neck[0] + ux * 26 * s, J.neck[1] + uy * 26 * s], 30 * s, skin);
    var img = av.img, hh = 250 * s, hw = hh * (img.width / Math.max(1, img.height));
    if (hw > 300 * s) { hh *= 300 * s / hw; hw = 300 * s; }
    c.translate(J.neck[0], J.neck[1]);
    c.rotate((p.lean + p.head) * Math.PI / 180);
    c.drawImage(img, -hw / 2, -hh + 22 * s, hw, hh);
    c.restore();
    return J;
  }

  /**
   * A whole figure from a picture: its own legs (swinging at the hips), its own body (leaning with the dance) and
   * head, and dancing arms in the clothes' colour from the shoulders. Sizes are in the figure's height (U).
   */
  function drawFull(c, p, cx, gy, s, av, color, beatGlow, lead) {
    var f = av.full, U = 700 * s, col = av.colors, top = col.top || '#9AA0B4', skin = col.skin || '#E0AC8A';
    var legLen = Math.max(f.legs[0].h, f.legs[1].h) * U, bodyH = f.body.h * U, bodyW = f.body.w * U;
    var lr = p.lean * Math.PI / 180, ux = Math.sin(lr), uy = -Math.cos(lr), px = -uy, py = ux;
    // the hem (where the legs start) and the neck
    var hx = cx + p.x * s, hy = gy - legLen + p.y * s;
    var nx = hx + ux * bodyH, ny = hy + uy * bodyH;
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    // a glow in the player's colour behind
    c.fillStyle = hexA(color, 0.18 + 0.16 * (beatGlow || 0));
    c.beginPath();
    if (c.ellipse) c.ellipse((hx + nx) / 2, (hy + ny) / 2 - 40 * s, bodyW * 0.75, (bodyH + legLen) * 0.62, lr, 0, Math.PI * 2);
    c.fill();
    // the legs: each swings at its top with the thigh's angle (a little less, they're short and stiff)
    var legs = [[f.legs[0], p.ll], [f.legs[1], p.rl]];
    for (var i = 0; i < 2; i++) {
      var L = legs[i][0], ang = (legs[i][1][0] * 0.7 + legs[i][1][1] * 0.3) * 0.8;
      var ax = hx + px * L.ax * U, ay = hy + py * L.ax * U;
      c.save();
      c.translate(ax, ay);
      c.rotate(-ang * Math.PI / 180);
      c.drawImage(L.im, (L.x - L.ax) * U - L.w * U / 2, -6 * s, L.w * U, L.h * U);
      c.restore();
    }
    // the body, from the neck down to the hem, leaning with the dance
    c.save();
    c.translate(hx, hy);
    c.rotate(lr);
    c.drawImage(f.body.im, f.body.x * U - bodyW / 2, -bodyH, bodyW, bodyH);
    c.restore();
    if (f.arms) {   // the picture's own arms, turning at the shoulder and the elbow
      var cosL = Math.cos(lr), sinL = Math.sin(lr), handR = null;
      for (var q = 0; q < 2; q++) {
        var A = f.arms[q], ang = q === 0 ? p.la : p.ra, base = q === 0 ? -90 : 90;
        var lx = A.sx * U, ly = -bodyH + A.sy * U;
        var sxw = hx + lx * cosL - ly * sinL, syw = hy + lx * sinL + ly * cosL;
        var t1 = (base - ang[0]) * Math.PI / 180, t2 = (base - ang[1]) * Math.PI / 180;
        var exw = sxw + (A.ex * Math.cos(t1) - A.ey * Math.sin(t1)) * U, eyw = syw + (A.ex * Math.sin(t1) + A.ey * Math.cos(t1)) * U;
        c.save(); c.translate(exw, eyw); c.rotate(t2);
        c.drawImage(A.fore.im, -A.fore.px * U, -A.fore.py * U, A.fore.w * U, A.fore.h * U); c.restore();
        c.save(); c.translate(sxw, syw); c.rotate(t1);
        c.drawImage(A.upper.im, -A.upper.px * U, -A.upper.py * U, A.upper.w * U, A.upper.h * U); c.restore();
        if (q === 1) handR = [exw + (A.hx * Math.cos(t2) - A.hy * Math.sin(t2)) * U, eyw + (A.hx * Math.sin(t2) + A.hy * Math.cos(t2)) * U];
      }
      if (lead && handR) {
        var rr = (24 + 8 * (beatGlow || 0)) * s;
        c.fillStyle = 'rgba(255, 210, 61, 0.3)'; c.beginPath(); c.arc(handR[0], handR[1], rr * 1.9, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#FFD23D'; c.lineWidth = 7 * s; c.beginPath(); c.arc(handR[0], handR[1], rr, 0, Math.PI * 2); c.stroke();
      }
    }
    // or dancing arms from the shoulders, in the clothes' colour, with hands
    var shY = 0.1 * bodyH, shX = 0.3 * bodyW, a1 = 0.16 * U, a2 = 0.15 * U, sw = Math.max(26 * s, 0.17 * bodyW);
    var sides = f.arms ? [] : [[-1, p.la], [1, p.ra]], hand = null;
    for (var k = 0; k < sides.length; k++) {
      var sd = sides[k][0], ag = sides[k][1];
      var sx = nx - ux * shY + px * sd * shX, sy = ny - uy * shY + py * sd * shX;
      var d1 = dir(ag[0]), d2 = dir(ag[1]);
      var ex = sx + d1[0] * a1, ey = sy + d1[1] * a1, wx = ex + d2[0] * a2, wy = ey + d2[1] * a2;
      c.strokeStyle = shade(top, -0.3); c.lineWidth = sw + 7 * s;
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.lineTo(wx, wy); c.stroke();
      c.strokeStyle = top; c.lineWidth = sw;
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.lineTo(wx, wy); c.stroke();
      c.fillStyle = shade(top, -0.12); c.beginPath(); c.arc(wx, wy, sw * 0.55, 0, Math.PI * 2); c.fill();   // the cuff
      c.fillStyle = skin; c.beginPath(); c.arc(wx + d2[0] * sw * 0.45, wy + d2[1] * sw * 0.45, sw * 0.42, 0, Math.PI * 2); c.fill();
      if (sd > 0) hand = [wx + d2[0] * sw * 0.45, wy + d2[1] * sw * 0.45];
    }
    if (lead && hand) {
      var r = (24 + 8 * (beatGlow || 0)) * s;
      c.fillStyle = 'rgba(255, 210, 61, 0.3)'; c.beginPath(); c.arc(hand[0], hand[1], r * 1.9, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#FFD23D'; c.lineWidth = 7 * s; c.beginPath(); c.arc(hand[0], hand[1], r, 0, Math.PI * 2); c.stroke();
    }
    // the head, on the neck, tilting
    var img = av.img, headH = f.head.h * U, headW = headH * (img.width / Math.max(1, img.height));
    c.translate(nx, ny);
    c.rotate((p.lean + p.head) * Math.PI / 180);
    c.drawImage(img, (f.head.x - f.body.x) * U - headW / 2, -headH + 0.012 * U, headW, headH);
    c.restore();
  }

  function mixBounce(p, b) {
    return {la: p.la, ra: p.ra, ll: p.ll, rl: p.rl, lean: p.lean, x: p.x, y: p.y + b, head: p.head, bend: p.bend || 0};
  }

  function drawShadow(c, x, gy, s) {
    c.save();
    c.fillStyle = 'rgba(0, 0, 0, 0.45)';
    c.beginPath();
    if (c.ellipse) c.ellipse(x, gy + 6, 150 * s, 24 * s, 0, 0, Math.PI * 2); else c.arc(x, gy + 6, 60 * s, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  var TILE = ['#FF3DA5', '#2EE6FF', '#FFD23D', '#B34DFF', '#7CFF5B'];
  function drawBackdrop(c, beat, pulse, accent) {
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0A0716'); g.addColorStop(0.62, '#170B2E'); g.addColorStop(1, '#05030A');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // light beams sweeping from the top
    c.save();
    c.globalCompositeOperation = 'lighter';
    var t = beat * 0.5;
    var beams = [[160, 0.9, '#FF3DA5'], [700, -0.7, '#2EE6FF'], [1220, 0.8, accent], [1760, -0.9, '#FFD23D']];
    for (var i = 0; i < beams.length; i++) {
      var bx = beams[i][0], sw = Math.sin(t * beams[i][1] + i) * 420, a = 0.07 + 0.08 * pulse;
      var bg = c.createLinearGradient(bx, 0, bx + sw, 780);
      bg.addColorStop(0, hexA(beams[i][2], a * 2.2)); bg.addColorStop(1, hexA(beams[i][2], 0));
      c.fillStyle = bg;
      c.beginPath(); c.moveTo(bx - 14, -10); c.lineTo(bx + 14, -10); c.lineTo(bx + sw + 190, 780); c.lineTo(bx + sw - 190, 780); c.closePath(); c.fill();
    }
    c.restore();
    // the dance floor: tiles in perspective that light up with the beat
    var horizon = 730, rows = 5, cols = 9, b = Math.floor(beat);
    for (var r = 0; r < rows; r++) {
      var y0 = horizon + (H - horizon) * Math.pow(r / rows, 1.6), y1 = horizon + (H - horizon) * Math.pow((r + 1) / rows, 1.6);
      var w0 = 760 + 1300 * (r / rows), w1 = 760 + 1300 * ((r + 1) / rows);
      for (var k = 0; k < cols; k++) {
        var on = ((k * 7 + r * 3 + b * 5) % 11) < 3;
        var lit = on ? 0.18 + 0.4 * pulse : 0.05;
        c.fillStyle = hexA(TILE[(((k + r + b) % TILE.length) + TILE.length) % TILE.length], lit);
        var x0a = W / 2 - w0 / 2 + w0 * k / cols, x0b = W / 2 - w0 / 2 + w0 * (k + 1) / cols;
        var x1a = W / 2 - w1 / 2 + w1 * k / cols, x1b = W / 2 - w1 / 2 + w1 * (k + 1) / cols;
        c.beginPath(); c.moveTo(x0a + 3, y0 + 2); c.lineTo(x0b - 3, y0 + 2); c.lineTo(x1b - 3, y1 - 2); c.lineTo(x1a + 3, y1 - 2); c.closePath(); c.fill();
      }
    }
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ', ' + (n >> 8 & 255) + ', ' + (n & 255) + ', ' + clamp(a, 0, 1).toFixed(3) + ')';
  }

  var thumbFor = [];
  function danceHud(beat, mv) {
    var h = hud(), total = current.dance.beats;
    var fill = h.querySelector('.d-fill');
    if (fill) fill.style.width = clamp(beat / total * 100, 0, 100).toFixed(1) + '%';
    // the countdown before the first scored move, and the start
    var count = h.querySelector('.d-count'), firstScored = current.firstScored;
    for (var fs = 0; fs < current.dance.moves.length; fs++) if (current.dance.moves[fs].scored) { firstScored = current.dance.moves[fs].b; break; }
    var left = firstScored - beat, text = '';
    if (beat < 0) text = 'Gör dig redo';
    else if (left > 0 && left <= 4) text = String(Math.ceil(left));
    else if (left > 4 && beat < firstScored - 4) text = 'Värm upp!';
    else if (left <= 0 && left > -2) text = 'Kör!';
    if (count.textContent !== text) { count.textContent = text; count.className = 'd-count' + (text ? ' on' : ''); }
    // now and next
    var nowName = h.querySelector('.d-move'), dots = h.querySelector('.d-beats');
    var name = mv ? MOVES[mv.id].name : '';
    if (nowName.textContent !== name) nowName.textContent = name;
    if (mv) {
      var into = Math.floor(beat - mv.b), d = '';
      if (mv.scored) for (var i = 0; i < mv.n; i++) d += i <= into ? '●' : '○';   // none in the warm-up and the bow
      if (dots.textContent !== d) dots.textContent = d;
    }
    var thumbs = h.querySelectorAll('.d-thumb'), list = current.dance.moves, from = mv ? mv.i + 1 : 0;
    for (var k = 0; k < thumbs.length; k++) {
      var m = list[from + k], cv = thumbs[k].firstChild, label = thumbs[k].lastChild, key = m ? m.id : '';
      thumbs[k].style.visibility = m ? 'visible' : 'hidden';
      if (thumbFor[k] !== key && m) {
        thumbFor[k] = key;
        var tc = cv.getContext('2d');
        tc.clearRect(0, 0, cv.width, cv.height);
        var f = MOVES[m.id].f, pose = f[f.length > 1 ? 1 : 0];
        drawDancer(tc, pose, 75, 184, 0.235, 0, true);
        label.textContent = MOVES[m.id].name;
      }
    }
    // the scores' "Perfekt!" fade away
    var sec = Math.floor(Date.now() / 300);
    if (sec !== lastSecond) { lastSecond = sec; drawScores(); }
    if (beat >= total + 1) finish();
  }

  // MARK: - Keys

  var K = {left: 37, up: 38, right: 39, down: 40, ok: 13, back: 10009};
  window.addEventListener('keydown', function (e) {
    if (!opened) return;
    if (window.TV && TV.keys) K.back = TV.keys.back;
    if (window.FreeMyTV && FreeMyTV.poke) FreeMyTV.poke();
    var k = e.keyCode;
    e.preventDefault(); e.stopPropagation();
    var back = k === K.back || k === 27 || k === 8 || k === 461 || k === 10009;
    if (state === 'dance') { if (back) backToLobby(); return; }
    if (state === 'results') {
      if (back) { backToLobby(); return; }
      var bl = resultButtons();
      if (k === K.left || k === K.up) { sel = (sel + bl.length - 1) % bl.length; drawResults(); return; }
      if (k === K.right || k === K.down) { sel = (sel + 1) % bl.length; drawResults(); return; }
      if (k === K.ok) {
        var what = bl[clamp(sel, 0, bl.length - 1)][0];
        if (what === 'next') { song = queue.shift(); start(); }
        else if (what === 'again') start();
        else backToLobby();
      }
      return;
    }
    lobbyKey(k, back);
  }, true);

  document.addEventListener('visibilitychange', function () { if (document.hidden && opened) close(); });

  return {
    open: open, close: close, isOpen: isOpen,
    // for tests and the phone page's own copy of the scoring
    _moves: MOVES, _sig: SIG, _songs: SONGS, _choreo: choreo, _players: function () { return players; }, _state: function () { return state; }
  };
})();
