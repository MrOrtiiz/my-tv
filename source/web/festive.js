/*
 * The Swedish calendar on the home screen: today's holiday or theme day next to the date (red days in red), and an
 * animation that fits it: snow and fairy lights at Christmas, fireworks at New Year, candlelight on Lucia, hearts on
 * Father's and Mother's Day, petals at Midsummer, feathers at Easter, embers on Walpurgis Night, blue and yellow confetti
 * on the National Day... (Home Settings → Holidays). Easter and the days that move with it are computed for every year.
 * One canvas at half size, 30 fps, stopped while the app is hidden. ES5 only.
 */
var Festive = (function () {
  'use strict';
  var W = 960, H = 540, FRAME = 1000 / 30;
  var canvas = null, g = null, raf = 0, last = 0, acc = 0, kind = '', parts = [], timer = 0, forced = null;

  function on() { return typeof Prefs === 'undefined' || !Prefs.holidays || Prefs.holidays(); }
  function key(m, d) { return m + '-' + d; }
  function add(date, days) { return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days); }

  /** Easter Sunday (the Gregorian computus). */
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g2 = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g2 + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }

  /** The first given weekday (0 Sunday … 6 Saturday) on or after a date. */
  function onOrAfter(y, m, d, wd) { var t = new Date(y, m - 1, d); return add(t, (wd - t.getDay() + 7) % 7); }

  /** The year's days: {"month-day": {name, red, anim}}. */
  var cache = {};
  function days(y) {
    if (cache[y]) return cache[y];
    var out = {};
    function put(date, name, red, anim) { out[key(date.getMonth() + 1, date.getDate())] = {name: name, red: !!red, anim: anim || 'sparkle'}; }
    function fixed(m, d, name, red, anim) { put(new Date(y, m - 1, d), name, red, anim); }
    fixed(1, 1, 'Nyårsdagen', true, 'newyear');
    fixed(1, 5, 'Trettondagsafton', false, 'sparkle');
    fixed(1, 6, 'Trettondedag jul', true, 'sparkle');
    fixed(2, 14, 'Alla hjärtans dag', false, 'hearts');
    fixed(3, 25, 'Våffeldagen', false, 'sparkle');
    fixed(4, 30, 'Valborgsmässoafton', false, 'valborg');
    fixed(5, 1, 'Första maj', true, 'sparkle');
    fixed(6, 6, 'Sveriges nationaldag', true, 'flags');
    fixed(10, 4, 'Kanelbullens dag', false, 'sparkle');
    fixed(10, 31, 'Halloween', false, 'halloween');
    fixed(11, 6, 'Gustav Adolfsdagen', false, 'sparkle');
    fixed(12, 10, 'Nobeldagen', false, 'sparkle');
    fixed(12, 13, 'Lucia', false, 'lucia');
    fixed(12, 24, 'Julafton', false, 'christmas');
    fixed(12, 25, 'Juldagen', true, 'christmas');
    fixed(12, 26, 'Annandag jul', true, 'christmas');
    fixed(12, 31, 'Nyårsafton', false, 'newyear');
    var e = easter(y);
    put(add(e, -47), 'Fettisdagen', false, 'sparkle');
    put(add(e, -3), 'Skärtorsdagen', false, 'easter');
    put(add(e, -2), 'Långfredagen', true, 'easter');
    put(add(e, -1), 'Påskafton', false, 'easter');
    put(e, 'Påskdagen', true, 'easter');
    put(add(e, 1), 'Annandag påsk', true, 'easter');
    put(add(e, 39), 'Kristi himmelsfärdsdag', true, 'sparkle');
    put(add(e, 48), 'Pingstafton', false, 'sparkle');
    put(add(e, 49), 'Pingstdagen', true, 'sparkle');
    var mid = onOrAfter(y, 6, 19, 5);
    put(mid, 'Midsommarafton', false, 'midsummer');
    put(add(mid, 1), 'Midsommardagen', true, 'midsummer');
    var saints = onOrAfter(y, 10, 31, 6);
    put(add(saints, -1), 'Alla helgons afton', false, 'candles');
    put(saints, 'Alla helgons dag', true, 'candles');
    // Mother's Day: the last Sunday of May. Father's Day: the second Sunday of November.
    var may = new Date(y, 4, 31);
    put(add(may, -may.getDay()), 'Mors dag', false, 'hearts-pink');
    put(add(onOrAfter(y, 11, 1, 0), 7), 'Fars dag', false, 'hearts-blue');
    // Advent: the four Sundays before Christmas Eve.
    var first = add(onOrAfter(y, 11, 27, 0), 0), names = ['Första advent', 'Andra advent', 'Tredje advent', 'Fjärde advent'];
    for (var a = 0; a < 4; a++) { var adv = add(first, 7 * a); if (!out[key(adv.getMonth() + 1, adv.getDate())]) put(adv, names[a], false, 'advent'); }
    cache[y] = out;
    return out;
  }

  // Fun days: releases worth a count-down. [year, month, day, the day's name, the count-down's name, animation].
  // Dates as announced for Sweden (GTA VI: Rockstar, 19 Nov 2026; Avengers: Doomsday: Swedish premiere 16 Dec 2026).
  var EVENTS = [
    [2026, 11, 19, 'GTA VI släpps i dag!', 'GTA VI', 'neon'],
    [2026, 12, 16, 'Avengers: Doomsday har premiär!', 'Avengers: Doomsday', 'heroes']
  ];
  var COUNTDOWN = 30;   // days before

  function event(t) {
    for (var i = 0; i < EVENTS.length; i++) {
      var e = EVENTS[i];
      if (e[0] === t.getFullYear() && e[1] === t.getMonth() + 1 && e[2] === t.getDate()) return {name: e[3], red: false, anim: e[5]};
    }
    return null;
  }

  /** "GTA VI om 14 dagar", "Avengers: Doomsday i morgon": the nearest release within COUNTDOWN days, or ''. */
  function countdown() {
    var t = new Date(), today0 = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime(), best = null, bestN = 1e9;
    for (var i = 0; i < EVENTS.length; i++) {
      var e = EVENTS[i], n = Math.round((new Date(e[0], e[1] - 1, e[2]).getTime() - today0) / 86400000);
      if (n >= 1 && n <= COUNTDOWN && n < bestN) { best = e; bestN = n; }
    }
    if (!best) return '';
    return best[4] + (bestN === 1 ? ' i morgon' : ' om ' + bestN + ' dagar');
  }

  /** Today's day ({name, red, anim}): a holiday first, else a release day; or null. */
  function today() {
    if (forced) return forced;
    var t = new Date();
    return days(t.getFullYear())[key(t.getMonth() + 1, t.getDate())] || event(t) || null;
  }

  // MARK: - The animations

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function heart(x, y, s, color, alpha) {
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y + s * 0.3);
    g.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
    g.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
    g.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
    g.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
    g.fill();
  }

  function glow(x, y, r, rgb, a) {
    var gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
    gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  var SETUP = {
    christmas: function () {
      for (var i = 0; i < 110; i++) parts.push({t: 'snow', x: rand(0, W), y: rand(0, H), r: rand(0.8, 2.6), v: rand(14, 40), p: rand(0, 6.3)});
      for (var j = 0; j < 22; j++) parts.push({t: 'bulb', i: j, c: pick(['255,70,70', '255,200,60', '80,200,120', '90,160,255', '255,140,40']), p: rand(0, 6.3)});
    },
    newyear: function () {
      parts.push({t: 'launcher', next: 0.4});
      burst(W * 0.3, H * 0.28); burst(W * 0.7, H * 0.22);
    },
    lucia: function () {
      for (var i = 0; i < 46; i++) parts.push({t: 'light', x: rand(0, W), y: rand(H * 0.3, H + 40), v: rand(6, 16), r: rand(10, 26), p: rand(0, 6.3)});
      for (var j = 0; j < 40; j++) parts.push({t: 'spark', x: rand(0, W), y: rand(0, H), p: rand(0, 6.3)});
    },
    advent: function () {
      for (var i = 0; i < 24; i++) parts.push({t: 'light', x: rand(0, W), y: rand(H * 0.4, H + 40), v: rand(4, 10), r: rand(8, 20), p: rand(0, 6.3)});
      for (var j = 0; j < 40; j++) parts.push({t: 'snow', x: rand(0, W), y: rand(0, H), r: rand(0.6, 1.8), v: rand(10, 24), p: rand(0, 6.3)});
    },
    candles: function () {
      for (var i = 0; i < 30; i++) parts.push({t: 'light', x: rand(0, W), y: rand(H * 0.45, H + 40), v: rand(3, 8), r: rand(8, 18), p: rand(0, 6.3)});
    },
    hearts: function () { for (var i = 0; i < 26; i++) parts.push({t: 'heart', x: rand(0, W), y: rand(0, H + 60), s: rand(8, 22), v: rand(14, 30), p: rand(0, 6.3), c: pick(['#FF3B6B', '#FF6B8E', '#E8174B', '#FF9FB5'])}); },
    'hearts-pink': function () { for (var i = 0; i < 26; i++) parts.push({t: 'heart', x: rand(0, W), y: rand(0, H + 60), s: rand(8, 22), v: rand(14, 30), p: rand(0, 6.3), c: pick(['#FF8FB8', '#FF5E9C', '#FFC2D8', '#F7A1C4'])}); },
    'hearts-blue': function () { for (var i = 0; i < 26; i++) parts.push({t: 'heart', x: rand(0, W), y: rand(0, H + 60), s: rand(8, 22), v: rand(14, 30), p: rand(0, 6.3), c: pick(['#4F8DFF', '#2F6BEA', '#8DB8FF', '#5AC8FA'])}); },
    midsummer: function () { for (var i = 0; i < 50; i++) parts.push({t: 'petal', x: rand(0, W), y: rand(-H, H), v: rand(16, 34), a: rand(0, 6.3), va: rand(-1.5, 1.5), p: rand(0, 6.3), c: pick(['255,255,255', '255,214,230', '255,236,120', '200,160,255', '255,170,200'])}); },
    easter: function () { for (var i = 0; i < 40; i++) parts.push({t: 'feather', x: rand(0, W), y: rand(-H, H), v: rand(12, 26), a: rand(0, 6.3), va: rand(-1, 1), p: rand(0, 6.3), c: pick(['255,214,0', '255,90,160', '90,200,255', '120,230,120', '255,140,40', '180,110,255'])}); },
    valborg: function () { for (var i = 0; i < 90; i++) parts.push({t: 'ember', x: rand(W * 0.1, W * 0.9), y: rand(H * 0.4, H + 20), v: rand(30, 70), p: rand(0, 6.3), life: rand(0, 1)}); },
    flags: function () { for (var i = 0; i < 90; i++) parts.push({t: 'confetti', x: rand(0, W), y: rand(-H, H), v: rand(30, 60), a: rand(0, 6.3), va: rand(-4, 4), p: rand(0, 6.3), c: i % 2 ? '#FECC02' : '#006AA7'}); },
    halloween: function () {
      for (var i = 0; i < 7; i++) parts.push({t: 'bat', x: rand(-200, W), y: rand(30, H * 0.5), v: rand(40, 80), p: rand(0, 6.3), s: rand(10, 18)});
      for (var j = 0; j < 40; j++) parts.push({t: 'ember', x: rand(0, W), y: rand(H * 0.5, H + 20), v: rand(14, 30), p: rand(0, 6.3), life: rand(0, 1)});
    },
    sparkle: function () { for (var i = 0; i < 34; i++) parts.push({t: 'spark', x: rand(0, W), y: rand(0, H * 0.75), p: rand(0, 6.3)}); },
    // A neon sunset over the sea, pink and cyan streaks and a slow scan line: a night in a sunny city by the ocean.
    neon: function () {
      parts.push({t: 'sun'});
      for (var i = 0; i < 26; i++) parts.push({t: 'streak', x: rand(-W, W), y: rand(H * 0.1, H * 0.9), v: rand(120, 260), l: rand(40, 140), c: pick(['255,60,180', '0,230,255', '255,170,60', '180,90,255'])});
    },
    // Cosmic energy: rings that ripple out and sparks in purple and gold.
    heroes: function () {
      parts.push({t: 'rings', next: 0});
      for (var i = 0; i < 60; i++) parts.push({t: 'cosmic', x: rand(0, W), y: rand(0, H), vx: rand(-20, 20), vy: rand(-20, 20), p: rand(0, 6.3), c: pick(['170,90,255', '255,200,80', '120,160,255'])});
    }
  };

  function burst(x, y) {
    var c = pick(['255,90,90', '255,210,80', '120,220,255', '190,130,255', '120,255,160', '255,255,255', '255,140,60']);
    for (var i = 0; i < 90; i++) {
      var a = Math.random() * 6.283, s = rand(50, 160);
      parts.push({t: 'fw', x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, c: c});
    }
  }

  function draw(dt) {
    g.clearRect(0, 0, W, H);
    var i, p, keep = [];
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      switch (p.t) {
        case 'snow':
          p.y += p.v * dt; p.p += dt; if (p.y > H + 4) { p.y = -4; p.x = rand(0, W); }
          g.globalAlpha = 0.85; g.fillStyle = '#FFF'; g.beginPath(); g.arc(p.x + Math.sin(p.p) * 8, p.y, p.r, 0, 6.283); g.fill();
          break;
        case 'bulb':
          // Fairy lights hanging across the top in two gentle curves.
          var bx = 20 + p.i * (W - 40) / 21, sag = Math.sin(Math.PI * ((p.i % 11) / 10)) * 26, by = 10 + sag;
          p.p += dt * rand(1.5, 3);
          var on = 0.55 + 0.45 * Math.abs(Math.sin(p.p));
          g.globalAlpha = 1; glow(bx, by + 6, 18, p.c, 0.45 * on);
          g.globalAlpha = 0.6; g.strokeStyle = 'rgba(40,60,40,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(bx, by - 2); g.lineTo(bx, by + 2); g.stroke();
          g.globalAlpha = on; g.fillStyle = 'rgb(' + p.c + ')'; g.beginPath(); g.ellipse ? g.ellipse(bx, by + 6, 3.2, 5, 0, 0, 6.283) : g.arc(bx, by + 6, 4, 0, 6.283); g.fill();
          break;
        case 'light':
          p.y -= p.v * dt; p.p += dt * 2; if (p.y < -30) { p.y = H + 30; p.x = rand(0, W); }
          g.globalAlpha = 1; glow(p.x + Math.sin(p.p * 0.5) * 6, p.y, p.r, '255,190,90', 0.22 + 0.12 * Math.sin(p.p * 3));
          g.globalAlpha = 0.9; g.fillStyle = 'rgb(255,226,160)'; g.beginPath(); g.arc(p.x + Math.sin(p.p * 0.5) * 6, p.y, 1.6, 0, 6.283); g.fill();
          break;
        case 'spark':
          p.p += dt * 1.8;
          var sa = Math.max(0, Math.sin(p.p)) ;
          g.globalAlpha = sa * 0.9; g.strokeStyle = '#FFF6D8'; g.lineWidth = 1;
          g.beginPath(); g.moveTo(p.x - 5 * sa, p.y); g.lineTo(p.x + 5 * sa, p.y); g.moveTo(p.x, p.y - 5 * sa); g.lineTo(p.x, p.y + 5 * sa); g.stroke();
          if (p.p > 6.283) { p.p = 0; p.x = rand(0, W); p.y = rand(0, H * 0.75); }
          break;
        case 'heart':
          p.y -= p.v * dt; p.p += dt; if (p.y < -40) { p.y = H + 30; p.x = rand(0, W); }
          heart(p.x + Math.sin(p.p) * 14, p.y, p.s, p.c, 0.75);
          break;
        case 'petal':
        case 'feather':
          p.y += p.v * dt; p.p += dt; p.a += p.va * dt; if (p.y > H + 20) { p.y = -20; p.x = rand(0, W); }
          g.save(); g.translate(p.x + Math.sin(p.p) * 20, p.y); g.rotate(p.a);
          g.globalAlpha = 0.85; g.fillStyle = 'rgb(' + p.c + ')'; g.beginPath();
          if (g.ellipse) g.ellipse(0, 0, p.t === 'petal' ? 5 : 3, p.t === 'petal' ? 3 : 11, 0, 0, 6.283); else g.arc(0, 0, 4, 0, 6.283);
          g.fill(); g.restore();
          break;
        case 'ember':
          p.y -= p.v * dt; p.p += dt * 6; p.life += dt * 0.35;
          if (p.life > 1 || p.y < 0) { p.y = rand(H * 0.75, H + 20); p.x = rand(W * 0.1, W * 0.9); p.life = 0; }
          g.globalAlpha = 1; glow(p.x + Math.sin(p.p) * 3, p.y, 6, '255,140,40', (1 - p.life) * 0.6);
          g.globalAlpha = (1 - p.life); g.fillStyle = 'rgb(255,' + Math.floor(160 + 60 * Math.sin(p.p)) + ',60)'; g.fillRect(p.x + Math.sin(p.p) * 3, p.y, 1.6, 1.6);
          break;
        case 'confetti':
          p.y += p.v * dt; p.p += dt * 3; p.a += p.va * dt; if (p.y > H + 10) { p.y = -10; p.x = rand(0, W); }
          g.save(); g.translate(p.x + Math.sin(p.p) * 10, p.y); g.rotate(p.a); g.scale(1, Math.abs(Math.cos(p.p)));
          g.globalAlpha = 0.95; g.fillStyle = p.c; g.fillRect(-4, -2, 8, 4); g.restore();
          break;
        case 'bat':
          p.x += p.v * dt; p.p += dt * 10; if (p.x > W + 40) { p.x = -40; p.y = rand(30, H * 0.5); }
          var flap = Math.sin(p.p) * p.s * 0.5, yy = p.y + Math.sin(p.p * 0.2) * 10;
          g.globalAlpha = 0.85; g.fillStyle = '#15121C'; g.beginPath();
          g.moveTo(p.x, yy); g.quadraticCurveTo(p.x - p.s * 0.6, yy - flap, p.x - p.s, yy + 2); g.quadraticCurveTo(p.x - p.s * 0.5, yy + 1, p.x, yy + 4);
          g.quadraticCurveTo(p.x + p.s * 0.5, yy + 1, p.x + p.s, yy + 2); g.quadraticCurveTo(p.x + p.s * 0.6, yy - flap, p.x, yy); g.fill();
          break;
        case 'sun':
          var sy = H * 0.62, sr = 92, sx = W * 0.82;
          var sg = g.createLinearGradient(0, sy - sr, 0, sy + sr * 0.2);
          sg.addColorStop(0, 'rgba(255,220,90,0.55)'); sg.addColorStop(0.55, 'rgba(255,80,160,0.5)'); sg.addColorStop(1, 'rgba(160,40,200,0.2)');
          g.globalAlpha = 1; g.fillStyle = sg; g.beginPath(); g.arc(sx, sy, sr, Math.PI, 0); g.fill();
          g.fillStyle = 'rgba(10,0,30,0.35)';
          for (var b = 0; b < 5; b++) g.fillRect(sx - sr, sy - 10 - b * 15, sr * 2, 2.5 + b * 0.5);
          glow(sx, sy, 230, '255,60,180', 0.12);
          break;
        case 'streak':
          p.x += p.v * dt; if (p.x > W + p.l) { p.x = -p.l - rand(0, W); p.y = rand(H * 0.1, H * 0.9); }
          var sgr = g.createLinearGradient(p.x - p.l, 0, p.x, 0);
          sgr.addColorStop(0, 'rgba(' + p.c + ',0)'); sgr.addColorStop(1, 'rgba(' + p.c + ',0.8)');
          g.globalAlpha = 1; g.strokeStyle = sgr; g.lineWidth = 1.5; g.beginPath(); g.moveTo(p.x - p.l, p.y); g.lineTo(p.x, p.y); g.stroke();
          break;
        case 'rings':
          p.next -= dt;
          if (p.next <= 0) { p.next = rand(1.2, 2.4); parts.push({t: 'ring', x: rand(W * 0.2, W * 0.8), y: rand(H * 0.2, H * 0.7), r: 4, c: pick(['170,90,255', '255,200,80'])}); }
          break;
        case 'ring':
          p.r += 120 * dt;
          if (p.r > 260) continue;
          g.globalAlpha = Math.max(0, 1 - p.r / 260) * 0.7; g.strokeStyle = 'rgb(' + p.c + ')'; g.lineWidth = 2.5;
          g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.stroke();
          g.globalAlpha = 1; glow(p.x, p.y, p.r * 0.5, p.c, 0.08 * (1 - p.r / 260));
          break;
        case 'cosmic':
          p.x += p.vx * dt; p.y += p.vy * dt; p.p += dt * 3;
          if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
          g.globalAlpha = 1; glow(p.x, p.y, 7, p.c, 0.35 + 0.25 * Math.sin(p.p));
          break;
        case 'launcher':
          p.next -= dt;
          if (p.next <= 0) { p.next = rand(0.45, 1.2); parts.push({t: 'rocket', x: rand(W * 0.12, W * 0.88), y: H, vy: rand(-380, -300), top: rand(H * 0.1, H * 0.4)}); }
          break;
        case 'rocket':
          p.y += p.vy * dt;
          g.globalAlpha = 0.9; g.fillStyle = '#FFE9B0'; g.fillRect(p.x, p.y, 1.6, 6);
          if (p.y <= p.top) { burst(p.x, p.y); continue; }
          break;
        case 'fw':
          p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt; p.vx *= 0.985; p.vy *= 0.985; p.life -= dt * 0.55;
          if (p.life <= 0) continue;
          g.globalAlpha = p.life; g.fillStyle = 'rgb(' + p.c + ')'; g.fillRect(p.x - 1.2, p.y - 1.2, 2.6, 2.6);
          if (p.life > 0.6) { g.globalAlpha = 1; glow(p.x, p.y, 5, p.c, 0.25 * p.life); }
          break;
      }
      keep.push(p);
    }
    parts = keep;
    g.globalAlpha = 1;
  }

  function loop(t) {
    raf = 0;
    if (!kind || document.hidden) return;
    var dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
    last = t; acc += dt * 1000;
    if (acc >= FRAME) { draw(acc / 1000); acc = 0; }
    raf = window.requestAnimationFrame(loop);
  }
  function run() { if (!raf && kind && !document.hidden) { last = 0; acc = FRAME; raf = window.requestAnimationFrame(loop); } }
  function stop() { if (raf) window.cancelAnimationFrame(raf); raf = 0; }

  function ensure() {
    if (canvas) return true;
    var host = document.getElementById('sky');
    if (!host) return false;
    canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.id = 'festive';
    host.appendChild(canvas);   // over the sky and its veil, under everything else
    g = canvas.getContext('2d');
    return true;
  }

  /** Starts, changes or stops the animation for today; checked again each minute (midnight changes the day). */
  function update() {
    if (!ensure()) return;
    var d = on() ? today() : null, want = d ? d.anim : '';
    if (want === kind) { run(); return; }
    stop();
    kind = want; parts = [];
    if (api.onChange) api.onChange();   // the date line shows the day's name
    g.clearRect(0, 0, W, H);
    canvas.style.opacity = kind ? '1' : '0';
    if (kind && SETUP[kind]) SETUP[kind]();
    run();
  }

  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else run(); });
  setTimeout(update, 300);
  timer = setInterval(update, 60000);

  var api = {
    today: function () { return on() ? today() : null; },
    countdown: function () { return on() && !forced ? countdown() : ''; },
    update: update,
    /** For trying an animation: Festive.preview('newyear', 'Nyårsafton', false); Festive.preview() to stop. */
    preview: function (anim, name, red) { forced = anim ? {anim: anim, name: name || anim, red: !!red} : null; update(); },
    days: days,
    /** Set by home.js: redraws the date line when the day changes. */
    onChange: null
  };
  return api;
})();
