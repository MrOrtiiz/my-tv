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
  var VERSION = '2026-11-14c';   // in the phone's link, so a phone never keeps an older page

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

  function P(la1, la2, ra1, ra2, ll1, ll2, rl1, rl2, lean, x, y, head) {
    return {la: [la1, la2], ra: [ra1, ra2], ll: [ll1, ll2], rl: [rl1, rl2], lean: lean || 0, x: x || 0, y: y || 0, head: head || 0};
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
      S(-20, -24, 170, 172, 4, 0, 0), S(-170, -172, 20, 24, -4, 0, 0)]}
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
      lean: lerp(p.lean, q.lean, t), x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t), head: lerp(p.head, q.head, t)
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
    var nx = hx + ux * 228 * s, ny = hy + uy * 228 * s;
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
  function drawDancer(c, p, cx, gy, s, beatGlow, lead) {
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
    c.strokeStyle = 'rgba(255, 61, 165, ' + g + ')'; path(62 * s); torso(76 * s);
    c.fillStyle = c.strokeStyle; head(66 * s); c.fill();
    c.strokeStyle = 'rgba(255, 61, 165, 0.42)'; path(40 * s); torso(52 * s);
    c.fillStyle = 'rgba(255, 61, 165, 0.42)'; head(56 * s); c.fill();
    c.strokeStyle = '#8AF6FF'; path(24 * s); torso(34 * s);
    c.fillStyle = '#8AF6FF'; head(46 * s); c.fill();
    c.strokeStyle = 'rgba(255, 255, 255, 0.85)'; path(8 * s); torso(12 * s);
    c.fillStyle = 'rgba(255, 255, 255, 0.9)'; head(30 * s); c.fill();
    // a visor across the face
    c.strokeStyle = '#FF3DA5'; c.lineWidth = 10 * s;
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
  var SONGS = [
    {id: 'neon', name: 'Neonnatt', tempo: 'Lugn', bpm: 108, root: 45, scale: 'minor', chords: [0, 5, 2, 6], drums: 'four', seed: 7,
      color: '#B34DFF',
      dance: {
        A: {easy: [['sida', 'klapp'], ['pump', 'klapp']], hard: [['sida', 'robot', 'pump', 'klapp'], ['puff', 'puff', 'disco', 'frys']]},
        B: {easy: [['pump', 'vinka'], ['stjarna', 'frys']], hard: [['pump', 'disco', 'snurr', 'frys'], ['stjarna', 'hopp', 'robot', 'frys']]},
        C: {easy: [['gunga', 'vinka'], ['klapp', 'sida']], hard: [['simma', 'simma', 'snurr', 'snurr'], ['gunga', 'vinka', 'klapp', 'frys']]}
      }},
    {id: 'sol', name: 'Solsken', tempo: 'Medel', bpm: 120, root: 50, scale: 'major', chords: [0, 4, 5, 3], drums: 'pop', seed: 21,
      color: '#FFB21F',
      dance: {
        A: {easy: [['klapp', 'sida'], ['vinka', 'klapp']], hard: [['klapp', 'sida', 'vinka', 'pump'], ['robot', 'robot', 'puff', 'frys']]},
        B: {easy: [['hopp', 'pump'], ['stjarna', 'vinka']], hard: [['hopp', 'stjarna', 'pump', 'disco'], ['snurr', 'puff', 'hopp', 'frys']]},
        C: {easy: [['sida', 'gunga'], ['pump', 'frys']], hard: [['gunga', 'disco', 'simma', 'frys'], ['sida', 'sida', 'robot', 'frys']]}
      }},
    {id: 'katt', name: 'Discokatten', tempo: 'Snabb', bpm: 128, root: 40, scale: 'minor', chords: [0, 3, 4, 3], drums: 'disco', seed: 42,
      color: '#29E3C9',
      dance: {
        A: {easy: [['disco', 'klapp'], ['sida', 'pump']], hard: [['disco', 'disco', 'klapp', 'robot'], ['puff', 'snurr', 'pump', 'frys']]},
        B: {easy: [['stjarna', 'pump'], ['hopp', 'frys']], hard: [['stjarna', 'pump', 'hopp', 'disco'], ['simma', 'snurr', 'stjarna', 'frys']]},
        C: {easy: [['vinka', 'gunga'], ['klapp', 'frys']], hard: [['robot', 'robot', 'vinka', 'vinka'], ['gunga', 'puff', 'disco', 'frys']]}
      }}
  ];
  // bars: a warm-up, then the sections, then a bow. 48 bars: about 1.5–1.8 minutes.
  var FORM = [['intro', 4], ['A', 8], ['B', 8], ['A', 8], ['C', 8], ['B', 8], ['outro', 4]];

  /** The whole dance for a song: [{b: start beat, n: beats, id, scored}], and the length in beats. */
  function choreo(song, hard) {
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
    // drums
    if (pos % 4 === 0 && (name !== 'C' || sec.bar >= sec.len - 2)) {
      var four = song.drums === 'four' || song.drums === 'disco' || name === 'intro' || name === 'outro';
      if (four || pos === 0 || pos === 8) kick(t, name === 'intro' ? 0.8 : 1);
    }
    if (song.drums === 'pop' && (pos === 6 || pos === 10) && full && name !== 'C') kick(t, 0.75);
    if (full && drums && (pos === 4 || pos === 12)) snare(t, 1, song.drums !== 'pop');
    if (fill && full && pos % 2 === 1) snare(t, 0.6, false);
    if (name !== 'outro' || sec.bar < 2) {
      if (song.drums === 'disco' && pos % 4 === 2) hat(t, 1, true);
      else if (pos % 2 === 0 || name === 'B') hat(t, pos % 4 === 2 ? 1 : 0.55, false);
    }
    // bass
    if (full || name === 'outro') {
      var pat = song.drums === 'disco' ? [0, 3, 6, 8, 10, 14] : song.drums === 'pop' ? [0, 6, 8, 12, 14] : [0, 2, 4, 6, 8, 10, 12, 14];
      for (var i = 0; i < pat.length; i++) if (pat[i] === pos) {
        var up = song.drums === 'disco' && (pos === 6 || pos === 14) ? 12 : 0;
        bass(t, bassNote + up, s16 * 1.7, name === 'C' ? 0.7 : 1);
      }
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
    var m = {song: song, t0: a.currentTime + (lead || 0.6), step: 0, hook: hookFor(song), total: 48 * 16};
    master.gain.cancelScheduledValues(a.currentTime);
    master.gain.setValueAtTime(0.0001, a.currentTime);
    master.gain.exponentialRampToValueAtTime(0.7, a.currentTime + 0.3);
    var s16 = 60 / song.bpm / 4;
    m.timer = setInterval(function () {
      if (music !== m) return;
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
    state = 'lobby'; sel = 0;
    root.className = 'layer on';
    listen();
    drawLobby();
    idleStart = Date.now();
    loop();
  }

  function close() {
    if (!opened) return;
    stopMusic();
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

  function phoneUrl() { return PHONE + '?v=' + VERSION + '#' + topic() + '|' + (RELAY !== 'https://ntfy.sh/' ? RELAY : '') + '|' + secret(); }

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

  function drawLobby() {
    var p = panel(), h = hud();
    h.innerHTML = '';
    p.className = 'd-panel lobby';
    p.innerHTML = '';
    var left = el('div', 'd-left', p);
    el('div', 'd-title', left, 'Dansgolvet');
    el('div', 'd-sub', left, 'Härma dansaren. Den lysande handen visar vad mobilen ska göra.');
    var items = [];
    for (var i = 0; i < SONGS.length; i++) {
      var s = SONGS[i], row = el('div', 'd-song' + (i === song ? ' chosen' : ''), left);
      row.style.borderColor = i === song ? s.color : '';
      var dot = el('span', 'd-dot', row); dot.style.background = s.color;
      el('span', 'd-name', row, s.name);
      el('span', 'd-tempo', row, s.tempo + ' · ' + s.bpm + ' bpm');
      items.push(row);
    }
    var lvl = el('div', 'd-level', left);
    el('span', 'd-label', lvl, 'Nivå');
    el('span', 'd-opt' + (!hard ? ' on' : ''), lvl, 'Lätt');
    el('span', 'd-opt' + (hard ? ' on' : ''), lvl, 'Svår');
    items.push(lvl);
    var go = el('div', 'd-go', left, 'Dansa!');
    items.push(go);
    for (var k = 0; k < items.length; k++) if (k === sel) items[k].className += ' focus';
    el('div', 'd-hint', left, '▲ ▼ välj   OK  ' + (sel < SONGS.length ? 'välj låt' : sel === SONGS.length ? 'byt nivå' : 'starta') + '   Tillbaka stänger');

    var right = el('div', 'd-right', p);
    el('div', 'd-qr-title', right, 'Vill du ha poäng?');
    el('div', 'd-qr-sub', right, 'Skanna med mobilen och håll den i höger hand.');
    var q = el('div', 'd-qr', right);
    withQr(function (ok) {
      if (!ok) { q.textContent = 'QR-koden gick inte att ladda.'; return; }
      try { var qr = window.qrcode(0, 'M'); qr.addData(phoneUrl()); qr.make(); q.innerHTML = qr.createSvgTag({cellSize: 6, margin: 3}); } catch (e) { q.textContent = ''; }
    });
    el('div', 'd-players', right);
    drawPlayers();
  }

  function drawPlayers() {
    if (!root) return;
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
    var m = startMusic(s, 0.8);
    current = {song: s, dance: choreo(s, hard), music: m, beat: -1};
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
    var btns = el('div', 'd-buttons', p);
    var again = el('div', 'd-btn', btns, 'Dansa igen');
    var other = el('div', 'd-btn', btns, 'Välj en annan låt');
    (sel === 0 ? again : other).className += ' focus';
  }

  function backToLobby() { stopMusic(); current = null; state = 'lobby'; sel = SONGS.length + 1; sendAll({t: 'lobby'}); drawLobby(); }

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
    var c = ctx, beat = beatNow(), phase = beat - Math.floor(beat), pulse = Math.max(0, 1 - phase * 2.2);
    var accent = current ? current.song.color : '#B34DFF';
    drawBackdrop(c, beat, pulse, accent);

    var pose, mv = null;
    if (state === 'dance' && current) {
      if (beat < 0) pose = poseAt('gunga', 0);
      else {
        mv = moveAt(beat);
        pose = mv ? poseAt(mv.id, beat - mv.b) : poseAt('frys', 0);
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
    if (state === 'lobby') {   // between the songs and the QR code
      var ls = n === 1 ? 0.9 : n === 2 ? 0.62 : 0.48, gap = n === 1 ? 0 : n === 2 ? 200 : 118;
      for (i = 0; i < n; i++) out.push({x: 1095 + (i - (n - 1) / 2) * gap, gy: 1010, s: ls});
      return out;
    }
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
    return {la: p.la, ra: p.ra, ll: p.ll, rl: p.rl, lean: p.lean, x: p.x, y: p.y + b, head: p.head};
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
    var count = h.querySelector('.d-count'), firstScored = 16;
    var left = firstScored - beat, text = '';
    if (beat < 0) text = 'Gör dig redo';
    else if (left > 0 && left <= 4) text = String(Math.ceil(left));
    else if (left > 4 && beat < 8) text = 'Värm upp!';
    else if (left <= 0 && left > -2) text = 'Kör!';
    if (count.textContent !== text) { count.textContent = text; count.className = 'd-count' + (text ? ' on' : ''); }
    // now and next
    var nowName = h.querySelector('.d-move'), dots = h.querySelector('.d-beats');
    var name = mv ? MOVES[mv.id].name : '';
    if (nowName.textContent !== name) nowName.textContent = name;
    if (mv) {
      var into = Math.floor(beat - mv.b), d = '';
      for (var i = 0; i < mv.n; i++) d += i <= into ? '●' : '○';
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
      if (k === K.left || k === K.right || k === K.up || k === K.down) { sel = sel ? 0 : 1; drawResults(); return; }
      if (k === K.ok) { if (sel === 0) start(); else backToLobby(); }
      return;
    }
    // the lobby
    if (back) { close(); return; }
    var n = SONGS.length + 2;
    if (k === K.up) { sel = (sel + n - 1) % n; drawLobby(); return; }
    if (k === K.down) { sel = (sel + 1) % n; drawLobby(); return; }
    if (sel === SONGS.length && (k === K.left || k === K.right || k === K.ok)) { hard = !hard; drawLobby(); return; }
    if (k === K.ok) {
      if (sel < SONGS.length) { song = sel; sel = SONGS.length + 1; drawLobby(); return; }
      start();
    }
  }, true);

  document.addEventListener('visibilitychange', function () { if (document.hidden && opened) close(); });

  return {
    open: open, close: close, isOpen: isOpen,
    // for tests and the phone page's own copy of the scoring
    _moves: MOVES, _sig: SIG, _songs: SONGS, _choreo: choreo, _players: function () { return players; }, _state: function () { return state; }
  };
})();
