/*
 * The weather as the home screen's background: the sky of the current weather in your city (clear, clouds, fog, rain,
 * snow, thunder), by day or by night, light or dark with the theme. Drawn on two canvases at half size: the sky once per
 * change, and what moves (clouds, rain, snow, stars, lightning) at 30 fps, stopped while the app is hidden.
 * ES5 only (older TVs), no allocations per frame.
 */
var WeatherBg = (function () {
  'use strict';
  var W = 960, H = 540, FRAME = 1000 / 30;
  var skyCanvas = null, fxCanvas = null, sky = null, fx = null;
  var state = {on: false, kind: '', day: true, dark: false, heavy: 0};
  var clouds = [], drops = [], flakes = [], stars = [], bands = [];
  var cloudSprite = null, cloudSpriteDark = null, fogSprite = null, fogSpriteDark = null, raf = 0, last = 0, acc = 0, flash = 0, nextFlash = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }

  /** WMO weather code (Open-Meteo) → what the sky shows, and how strong (0 light, 1 moderate, 2 heavy). */
  function classify(code) {
    if (code === 0 || code === 1) return {kind: 'clear', heavy: 0};
    if (code === 2) return {kind: 'partly', heavy: 0};
    if (code === 3) return {kind: 'overcast', heavy: 0};
    if (code === 45 || code === 48) return {kind: 'fog', heavy: 0};
    if (code >= 51 && code <= 57) return {kind: 'rain', heavy: 0};
    if (code === 61 || code === 80) return {kind: 'rain', heavy: 0};
    if (code === 63 || code === 66 || code === 81) return {kind: 'rain', heavy: 1};
    if (code === 65 || code === 67 || code === 82) return {kind: 'rain', heavy: 2};
    if (code === 71 || code === 77 || code === 85) return {kind: 'snow', heavy: 0};
    if (code === 73) return {kind: 'snow', heavy: 1};
    if (code === 75 || code === 86) return {kind: 'snow', heavy: 2};
    if (code >= 95) return {kind: 'thunder', heavy: 2};
    return {kind: 'overcast', heavy: 0};
  }

  // Top and bottom of the sky: [light theme by day, light theme by night, dark theme by day, dark theme by night].
  var SKIES = {
    clear: [['#4C9BE0', '#BFE1F7'], ['#6B7FB0', '#C9CFE3'], ['#14457E', '#2F6BA8'], ['#050A1E', '#16224A']],
    partly: [['#6FA6D6', '#D3E3F0'], ['#7C88A8', '#CDD2DF'], ['#1A3E66', '#3A5F86'], ['#0A1024', '#1E2944']],
    overcast: [['#8E9AA7', '#D2D8DE'], ['#7E8590', '#C4C8CE'], ['#262C35', '#434A55'], ['#111419', '#262A31']],
    fog: [['#AEB5BC', '#E2E5E8'], ['#9A9FA6', '#D3D6DA'], ['#2C3036', '#4A4F56'], ['#15171B', '#2D3035']],
    rain: [['#68798B', '#AFBAC6'], ['#5E6878', '#A3ABB7'], ['#1A222D', '#2F3A48'], ['#0A0E14', '#1C232D']],
    snow: [['#9FB0C3', '#E3EAF1'], ['#8D99AE', '#D5DCE6'], ['#1F2A3A', '#3A4759'], ['#0D121B', '#232D3C']],
    thunder: [['#4A5362', '#8892A0'], ['#3E4553', '#7C8594'], ['#0D1016', '#222731'], ['#06070A', '#161920']]
  };

  function makeCloudSprite(dark) {
    var c = document.createElement('canvas');
    c.width = 320; c.height = 140;
    var g = c.getContext('2d');
    var puffs = [[90, 85, 60], [150, 70, 70], [215, 82, 58], [255, 95, 42], [60, 98, 40], [175, 100, 60]];
    for (var i = 0; i < puffs.length; i++) {
      var p = puffs[i], r = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], p[2]);
      r.addColorStop(0, dark ? 'rgba(150,158,170,0.55)' : 'rgba(255,255,255,0.75)');
      r.addColorStop(1, dark ? 'rgba(150,158,170,0)' : 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, c.width, c.height);
    }
    return c;
  }

  /** A long, soft band of mist: faded at the top, the bottom and both ends. */
  function makeFogSprite(dark) {
    var c = document.createElement('canvas');
    c.width = 480; c.height = 120;
    var g = c.getContext('2d'), col = dark ? '170,176,186' : '255,255,255';
    var v = g.createLinearGradient(0, 0, 0, c.height);
    v.addColorStop(0, 'rgba(' + col + ',0)');
    v.addColorStop(0.5, 'rgba(' + col + ',' + (dark ? 0.16 : 0.45) + ')');
    v.addColorStop(1, 'rgba(' + col + ',0)');
    g.fillStyle = v;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    var h = g.createLinearGradient(0, 0, c.width, 0);
    h.addColorStop(0, 'rgba(0,0,0,0)');
    h.addColorStop(0.25, 'rgba(0,0,0,1)');
    h.addColorStop(0.75, 'rgba(0,0,0,1)');
    h.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = h;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function ensure() {
    if (skyCanvas) return true;
    var host = document.getElementById('sky');
    if (!host) return false;
    skyCanvas = document.createElement('canvas');
    fxCanvas = document.createElement('canvas');
    var list = [skyCanvas, fxCanvas];
    for (var i = 0; i < list.length; i++) {
      list[i].width = W; list[i].height = H;
      list[i].className = 'wx';
      // Above the plain day and night gradients, under the veil.
      host.insertBefore(list[i], host.querySelector('.veil'));
    }
    sky = skyCanvas.getContext('2d');
    fx = fxCanvas.getContext('2d');
    cloudSprite = makeCloudSprite(false);
    cloudSpriteDark = makeCloudSprite(true);
    fogSprite = makeFogSprite(false);
    fogSpriteDark = makeFogSprite(true);
    return true;
  }

  function paintSky() {
    var pal = SKIES[state.kind][(state.dark ? 2 : 0) + (state.day ? 0 : 1)];
    var g = sky.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, pal[0]);
    g.addColorStop(1, pal[1]);
    sky.fillStyle = g;
    sky.fillRect(0, 0, W, H);
    var sunny = state.kind === 'clear' || state.kind === 'partly';
    if (sunny && state.day) {
      // The sun, top right, as a soft glow.
      var s = sky.createRadialGradient(W * 0.82, H * 0.16, 0, W * 0.82, H * 0.16, H * 0.62);
      s.addColorStop(0, state.dark ? 'rgba(255,214,140,0.45)' : 'rgba(255,244,214,0.95)');
      s.addColorStop(0.18, state.dark ? 'rgba(255,190,110,0.22)' : 'rgba(255,236,190,0.55)');
      s.addColorStop(1, 'rgba(255,230,180,0)');
      sky.fillStyle = s;
      sky.fillRect(0, 0, W, H);
    } else if (sunny) {
      // The moon, top right, and the stars.
      var m = sky.createRadialGradient(W * 0.82, H * 0.17, 0, W * 0.82, H * 0.17, H * 0.3);
      m.addColorStop(0, 'rgba(235,240,255,0.55)');
      m.addColorStop(0.08, 'rgba(220,228,255,0.35)');
      m.addColorStop(1, 'rgba(200,210,255,0)');
      sky.fillStyle = m;
      sky.fillRect(0, 0, W, H);
      sky.fillStyle = 'rgba(240,244,255,0.95)';
      sky.beginPath();
      sky.arc(W * 0.82, H * 0.17, 9, 0, Math.PI * 2);
      sky.fill();
      var n = state.kind === 'clear' ? 140 : 60;
      for (var i = 0; i < n; i++) {
        sky.fillStyle = 'rgba(255,255,255,' + rand(0.25, 0.8).toFixed(2) + ')';
        sky.fillRect(rand(0, W), rand(0, H * 0.75), rand(0.6, 1.4), rand(0.6, 1.4));
      }
    }
  }

  function setup() {
    var k = state.kind, h = state.heavy, i;
    clouds.length = 0; drops.length = 0; flakes.length = 0; stars.length = 0; bands.length = 0;
    var cloudCount = k === 'partly' ? 5 : k === 'overcast' ? 9 : k === 'rain' || k === 'thunder' ? 8 : k === 'snow' ? 6 : k === 'clear' && state.day ? 1 : 0;
    for (i = 0; i < cloudCount; i++) {
      var scale = rand(0.8, k === 'partly' || k === 'clear' ? 1.4 : 2.2);
      clouds.push({x: rand(-300, W), y: rand(-20, k === 'partly' || k === 'clear' ? H * 0.45 : H * 0.55), s: scale,
        v: rand(4, 10) * (k === 'thunder' ? 2 : 1), a: rand(0.5, 1)});
    }
    if (k === 'rain' || k === 'thunder') {
      var nd = h === 0 ? 70 : h === 1 ? 140 : 220;
      for (i = 0; i < nd; i++) drops.push({x: rand(0, W), y: rand(0, H), l: rand(8, 16), v: rand(420, 620)});
    }
    if (k === 'snow') {
      var nf = h === 0 ? 70 : h === 1 ? 120 : 180;
      for (i = 0; i < nf; i++) flakes.push({x: rand(0, W), y: rand(0, H), r: rand(0.8, 2.4), v: rand(18, 45), p: rand(0, 6.28)});
    }
    if (k === 'clear' && !state.day) {
      for (i = 0; i < 18; i++) stars.push({x: rand(0, W), y: rand(0, H * 0.7), p: rand(0, 6.28), w: rand(0.6, 1.6)});
    }
    if (k === 'fog') {
      for (i = 0; i < 6; i++) bands.push({x: rand(-W, W * 0.5), y: H * (0.12 + i * 0.15), v: rand(5, 12), h: rand(110, 190)});
    }
    flash = 0;
    nextFlash = k === 'thunder' ? Date.now() + rand(4000, 9000) : 0;
  }

  function moving() { return clouds.length || drops.length || flakes.length || stars.length || bands.length || nextFlash; }

  function draw(dt, now) {
    fx.clearRect(0, 0, W, H);
    var i, sprite = state.dark || state.kind === 'rain' || state.kind === 'thunder' ? cloudSpriteDark : cloudSprite;
    for (i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      c.x += c.v * dt;
      if (c.x > W + 40) { c.x = -320 * c.s - rand(0, 200); c.y = rand(-20, H * 0.5); }
      fx.globalAlpha = c.a * (state.kind === 'overcast' || state.kind === 'rain' || state.kind === 'thunder' ? 0.75 : 1);
      fx.drawImage(sprite, c.x, c.y, 320 * c.s, 140 * c.s);
    }
    fx.globalAlpha = 1;
    for (i = 0; i < bands.length; i++) {
      var b = bands[i];
      b.x += b.v * dt;
      if (b.x > W) b.x = -W * 1.6;
      fx.drawImage(state.dark ? fogSpriteDark : fogSprite, b.x, b.y - b.h / 2, W * 1.6, b.h);
    }
    if (drops.length) {
      fx.strokeStyle = state.dark ? 'rgba(190,205,225,0.32)' : 'rgba(40,60,85,0.30)';
      fx.lineWidth = 1;
      fx.beginPath();
      for (i = 0; i < drops.length; i++) {
        var d = drops[i];
        d.y += d.v * dt;
        d.x -= d.v * dt * 0.12;
        if (d.y > H) { d.y = -d.l; d.x = rand(0, W + 60); }
        fx.moveTo(d.x, d.y);
        fx.lineTo(d.x - d.l * 0.12, d.y + d.l);
      }
      fx.stroke();
    }
    if (flakes.length) {
      fx.fillStyle = state.dark ? 'rgba(235,240,250,0.85)' : 'rgba(255,255,255,0.95)';
      fx.beginPath();
      for (i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        f.y += f.v * dt;
        f.p += dt * 0.8;
        var x = f.x + Math.sin(f.p) * 10;
        if (f.y > H + 4) { f.y = -4; f.x = rand(0, W); }
        fx.moveTo(x + f.r, f.y);
        fx.arc(x, f.y, f.r, 0, 6.2832);
      }
      fx.fill();
    }
    for (i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.p += dt * 1.6;
      fx.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.6 * Math.abs(Math.sin(s.p))).toFixed(2) + ')';
      fx.fillRect(s.x, s.y, s.w + 0.6, s.w + 0.6);
    }
    if (nextFlash && now >= nextFlash) { flash = 1; nextFlash = now + rand(6000, 14000); }
    if (flash > 0) {
      fx.fillStyle = 'rgba(235,240,255,' + (flash * 0.55).toFixed(2) + ')';
      fx.fillRect(0, 0, W, H);
      flash -= dt * 3;
    }
  }

  function loop(t) {
    raf = 0;
    if (!state.on || document.hidden) return;
    var dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
    last = t;
    acc += dt * 1000;
    if (acc >= FRAME) {
      draw(acc / 1000, Date.now());
      acc = 0;
    }
    raf = window.requestAnimationFrame(loop);
  }

  function run() {
    if (raf || !state.on || document.hidden || !moving()) return;
    last = 0; acc = FRAME;
    raf = window.requestAnimationFrame(loop);
  }

  function stop() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
  }

  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else run(); });

  return {
    /** Shows the weather (code from Open-Meteo, day from its is_day, dark from the theme), or nothing when off. */
    update: function (on, code, day, dark) {
      if (!ensure()) return;
      var body = document.body;
      if (!on || code === undefined || code === null) {
        state.on = false;
        stop();
        body.className = body.className.replace(/\s*\bwxbg\b/g, '');
        return;
      }
      var c = classify(code);
      var same = state.on && state.kind === c.kind && state.heavy === c.heavy && state.day === day && state.dark === dark;
      state.on = true;
      if (!/\bwxbg\b/.test(body.className)) body.className += ' wxbg';
      if (same) { run(); return; }
      state.kind = c.kind; state.heavy = c.heavy; state.day = day; state.dark = dark;
      paintSky();
      setup();
      fx.clearRect(0, 0, W, H);
      draw(0, Date.now());
      run();
    },
    /** Paused (a sheet or the screensaver covers it) or running again. */
    pause: function (paused) { if (paused) stop(); else run(); }
  };
})();
