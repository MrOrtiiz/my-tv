/**
 * Ö-ruset: our own island runner for the Spel menu, played with the TV remote.
 *
 * A boardwalk across an island in three lanes, seen from behind the rider. ◀ ▶ change lane, ▲ (or OK) jumps, ▼
 * ducks (and drops fast from a jump), OK in the air does a trick. Rails are ridden by themselves (a grind), ramps
 * throw you high for more tricks. Tricks, grinds and coins keep the combo going; the combo multiplies the score.
 * Spikes, crates, crabs, beams and a big octopus arm from the sea take a heart; three hearts a run.
 *
 * Everything is drawn here, in blocks (cubes in perspective), with our own characters: no pictures, no sounds files.
 * ES5 only (the TVs run old browsers).
 */
var Rush = (function () {
  'use strict';

  var W = 1920, H = 1080, STORE = 'fmtv.rush';
  var F = 820, HY = 380, CH = 2.4, PZ = 3.6, NEAR = 1.05, FAR = 78;   // the camera: focal, horizon, height, player depth
  var LANES = [-1.7, 0, 1.7], HALF = 2.75;
  var GRAV = 26, JUMP = 9.6, RAMP = 13.6, RAIL_Y = 0.55;

  var cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { cfg = {}; }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) {} }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    function k(v) { return Math.round(clamp(f < 0 ? v * (1 + f) : v + (255 - v) * f, 0, 255)); }
    return 'rgb(' + k(r) + ',' + k(g) + ',' + k(b) + ')';
  }

  // MARK: - The characters: the same as in Dansgolvet (its neon dancer, and the family's gubbar from Google Drive)

  var NEON_CH = {id: 'neon', name: 'Neon', kind: 'neon'};
  var cast = [NEON_CH], castNote = '';
  var CACHE = 'fmtv.rush.g.';   // + the picture's Drive id: the cut-out gubbe, as a small PNG, and when it changed

  function driveUrl() {
    return (window.Dance && Dance._drive && Dance._drive()) || (window.CONFIG && CONFIG.danceDrive) || '';
  }
  function shortName(n) {
    var words = String(n || 'Gubbe').replace(/\.[^.]+$/, '').split(/\s+/), out = '';
    for (var i = 0; i < words.length; i++) { if ((out + ' ' + words[i]).replace(/^\s+/, '').length > 14) break; out = (out + ' ' + words[i]).replace(/^\s+/, ''); }
    out = out.replace(/\s+(i|med|och|på|en|ett)$/i, '');
    return out || String(n).slice(0, 14);
  }
  function getJSON(url, ok, fail) {
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.timeout = 30000;
    x.onload = function () { var o = null; try { o = JSON.parse(x.responseText); } catch (e) {} if (o && o.ok) ok(o); else fail((o && o.error) || 'inget svar'); };
    x.onerror = x.ontimeout = function () { fail('nätet svarar inte'); };
    x.send();
  }

  /** The gubbar in the Drive folder (as in Dansgolvet), after Neon. */
  function loadCast() {
    var url = driveUrl();
    if (!url) return;
    castNote = 'Hämtar gubbarna från Drive…';
    getJSON(url, function (o) {
      var list = [NEON_CH];
      for (var i = 0; i < o.files.length; i++) {
        var f = o.files[i], old = null;
        for (var k = 0; k < cast.length; k++) if (cast[k].id === f.id) old = cast[k];
        if (old && old.mod === f.modified) { list.push(old); continue; }
        list.push({id: f.id, name: shortName(f.name), kind: 'img', thumb: f.thumb, mod: f.modified, type: f.type});
      }
      cast = list;
      castNote = o.files.length ? '' : 'Drive-mappen Gubbar är tom.';
      sel = 0;
      for (var j = 0; j < cast.length; j++) if (cast[j].id === cfg.char) sel = j;
      if (state === 'menu' && opened) { drawMenu(); prefetch(); }
    }, function (why) {
      castNote = 'Kunde inte hämta gubbarna från Drive (' + why + ').';
      if (state === 'menu' && opened) drawMenu();
    });
  }

  /** A gubbe's picture, cut out from its background (as Dansgolvet's phones do): from the TV's memory or from Drive. */
  function fetchSprite(ch, done) {
    if (ch.kind !== 'img' || ch.img) { done(true); return; }
    if (ch.waiting) { ch.waiting.push(done); return; }
    ch.waiting = [done];
    function finish(ok) { var w = ch.waiting; ch.waiting = null; for (var i = 0; i < w.length; i++) w[i](ok); }
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(CACHE + ch.id) || 'null'); } catch (e) {}
    if (saved && saved.mod === ch.mod && saved.url) {
      var im = new Image();
      im.onload = function () { ch.img = im; finish(true); };
      im.onerror = function () { saved = null; download(); };
      im.src = saved.url;
      return;
    }
    download();
    function download() {
      var url = driveUrl(), parts = [], type = ch.type || 'image/png';
      (function next(n) {
        getJSON(url + (url.indexOf('?') < 0 ? '?' : '&') + 'file=' + encodeURIComponent(ch.id) + '&part=' + n, function (o) {
          parts.push(o.data); type = o.type || type;
          if (n + 1 < o.parts) { next(n + 1); return; }
          cutOut('data:' + type + ';base64,' + parts.join(''), function (cv) {
            if (!cv) { finish(false); return; }
            ch.img = cv;
            try { localStorage.setItem(CACHE + ch.id, JSON.stringify({mod: ch.mod, url: cv.toDataURL('image/png')})); } catch (e) {}
            finish(true);
          });
        }, function () { finish(false); });
      })(0);
    }
  }

  /** The figure without its background: the picture's own transparency, or the background flooded in from the edges. */
  function cutOut(url, cb) {
    var im = new Image();
    im.onload = function () {
      var h = Math.min(520, im.height), w = Math.max(1, Math.round(im.width * h / im.height));
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      var x2 = cv.getContext('2d');
      x2.drawImage(im, 0, 0, w, h);
      var data;
      try { data = x2.getImageData(0, 0, w, h); } catch (e) { cb(null); return; }
      var d = data.data, m = new Uint8Array(w * h), i;
      var see = d[3] < 20 || d[(w - 1) * 4 + 3] < 20 || d[((h - 1) * w) * 4 + 3] < 20;
      if (see) for (i = 0; i < w * h; i++) m[i] = d[i * 4 + 3] > 128 ? 1 : 0;
      else {
        var bg = [d[0], d[1], d[2]], seen = new Uint8Array(w * h), stack = [];
        var near = function (k) { var dr = d[k * 4] - bg[0], dg = d[k * 4 + 1] - bg[1], db = d[k * 4 + 2] - bg[2]; return dr * dr + dg * dg + db * db < 2400; };
        for (i = 0; i < w; i++) { stack.push(i); stack.push((h - 1) * w + i); }
        for (i = 0; i < h; i++) { stack.push(i * w); stack.push(i * w + w - 1); }
        while (stack.length) {
          var k = stack.pop();
          if (seen[k] || !near(k)) continue;
          seen[k] = 1;
          var x = k % w, y = (k - x) / w;
          if (x > 0) stack.push(k - 1); if (x < w - 1) stack.push(k + 1);
          if (y > 0) stack.push(k - w); if (y < h - 1) stack.push(k + w);
        }
        for (i = 0; i < w * h; i++) m[i] = seen[i] ? 0 : 1;
      }
      var top = h, bot = 0, l = w, r = 0;
      for (var yy = 0; yy < h; yy++) {
        var n = 0;
        for (var xx = 0; xx < w; xx++) if (m[yy * w + xx]) { n++; if (xx < l) l = xx; if (xx > r) r = xx; }
        if (n > 2) { if (yy < top) top = yy; bot = yy; }
      }
      if (bot <= top || r <= l) { cb(null); return; }
      for (i = 0; i < w * h; i++) if (!m[i]) d[i * 4 + 3] = 0;
      x2.putImageData(data, 0, 0);
      var out = document.createElement('canvas'); out.width = r - l + 1; out.height = bot - top + 1;
      out.getContext('2d').drawImage(cv, l, top, out.width, out.height, 0, 0, out.width, out.height);
      cb(out);
    };
    im.onerror = function () { cb(null); };
    im.src = url;
  }

  var prefetchT = 0;
  function prefetch() {   // the gubbe in focus, a moment after it's chosen: ready to ride (and seen in the menu)
    clearTimeout(prefetchT);
    var ch = cast[sel];
    if (!ch || ch.kind !== 'img' || ch.img) return;
    prefetchT = setTimeout(function () { fetchSprite(ch, function () { if (state === 'menu' && opened) drawMenu(); }); }, 500);
  }

  // MARK: - Drawing: perspective, cubes, the island

  var canvas = null, c = null, camX = 0;

  function proj(x, y, z) { var s = F / z; return [W / 2 + (x - camX) * s, HY + (CH - y) * s, s]; }

  /** A cube: centred at x, from y up by h, centred at z (depth d). Top, the side towards us and the front. */
  function cube(x, y, z, w, h, d, col) {
    var z0 = z - d / 2, z1 = z + d / 2;
    if (z0 < NEAR) return;
    var x0 = x - w / 2, x1 = x + w / 2, y1 = y + h;
    var a = proj(x0, y, z0), b = proj(x1, y, z0), t0 = proj(x0, y1, z0), t1 = proj(x1, y1, z0);
    var f0 = proj(x0, y1, z1), f1 = proj(x1, y1, z1);
    if (y1 < CH) {   // the top
      c.fillStyle = shade(col, 0.22);
      c.beginPath(); c.moveTo(t0[0], t0[1]); c.lineTo(t1[0], t1[1]); c.lineTo(f1[0], f1[1]); c.lineTo(f0[0], f0[1]); c.closePath(); c.fill();
    }
    if (camX < x0) {   // the left side
      var lb = proj(x0, y, z1);
      c.fillStyle = shade(col, -0.22);
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(t0[0], t0[1]); c.lineTo(f0[0], f0[1]); c.lineTo(lb[0], lb[1]); c.closePath(); c.fill();
    } else if (camX > x1) {   // the right side
      var rb = proj(x1, y, z1);
      c.fillStyle = shade(col, -0.22);
      c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(t1[0], t1[1]); c.lineTo(f1[0], f1[1]); c.lineTo(rb[0], rb[1]); c.closePath(); c.fill();
    }
    c.fillStyle = col;
    c.fillRect(a[0], t0[1], b[0] - a[0], a[1] - t0[1]);
  }

  var CLOUDS = [[-30, 120, 1.2], [8, 80, 0.9], [36, 150, 1.4], [70, 100, 1]];
  function drawSky(t) {
    var g = c.createLinearGradient(0, 0, 0, HY + 40);
    g.addColorStop(0, '#4FB3FF'); g.addColorStop(0.7, '#9FDCFF'); g.addColorStop(1, '#FFE9B8');
    c.fillStyle = g; c.fillRect(0, 0, W, HY + 40);
    // the sun and its glow
    var sx = 1500 - camX * 6;
    var sg = c.createRadialGradient(sx, 150, 20, sx, 150, 260);
    sg.addColorStop(0, 'rgba(255, 246, 200, 0.9)'); sg.addColorStop(1, 'rgba(255, 246, 200, 0)');
    c.fillStyle = sg; c.fillRect(sx - 260, 0, 520, 420);
    c.fillStyle = '#FFF6C8'; c.beginPath(); c.arc(sx, 150, 64, 0, Math.PI * 2); c.fill();
    // clouds, drifting
    c.fillStyle = 'rgba(255, 255, 255, 0.92)';
    for (var i = 0; i < CLOUDS.length; i++) {
      var cx = ((CLOUDS[i][0] * 30 + t * 14) % 2600 + 2600) % 2600 - 340 - camX * 4, cy = CLOUDS[i][1], s = CLOUDS[i][2];
      c.fillRect(cx, cy, 200 * s, 44 * s); c.fillRect(cx + 40 * s, cy - 30 * s, 110 * s, 40 * s); c.fillRect(cx + 120 * s, cy - 14 * s, 60 * s, 20 * s);
    }
    // far islands on the horizon
    c.fillStyle = '#5FB86A';
    var hills = [[-900, 230, 70], [-420, 150, 44], [560, 260, 86], [980, 140, 40]];
    for (var k = 0; k < hills.length; k++) {
      var hx = W / 2 + hills[k][0] - camX * 10;
      c.beginPath(); c.moveTo(hx - hills[k][1], HY + 2); c.lineTo(hx - hills[k][1] * 0.4, HY - hills[k][2]); c.lineTo(hx + hills[k][1] * 0.3, HY - hills[k][2] * 0.8);
      c.lineTo(hx + hills[k][1], HY + 2); c.closePath(); c.fill();
    }
  }

  function drawSea(dist, t) {
    var g = c.createLinearGradient(0, HY, 0, H);
    g.addColorStop(0, '#46C1E8'); g.addColorStop(1, '#1679C9');
    c.fillStyle = g; c.fillRect(0, HY, W, H - HY);
    // waves: light dashes on the water, coming towards us
    c.fillStyle = 'rgba(255, 255, 255, 0.55)';
    var first = Math.ceil(dist / 3) * 3;
    for (var wz = first; wz < dist + FAR; wz += 3) {
      var z = wz - dist + PZ;
      if (z < NEAR + 0.2) continue;
      var k = Math.round(wz / 3);
      for (var side = -1; side <= 1; side += 2) {
        var x = side * (5 + ((k * 7) % 9) + Math.sin(t + k) * 0.4), p = proj(x, 0, z);
        c.fillRect(p[0] - 0.7 * p[2] / 2, p[1], 0.7 * p[2], Math.max(1, 0.05 * p[2]));
      }
    }
  }

  /** The boardwalk: sand at its edges, planks across that run towards us, posts along the sides. */
  function drawPath(dist) {
    var i, z, za, zb, a, b, d, e;
    // the sand under it
    a = proj(-HALF - 0.6, 0, NEAR); b = proj(HALF + 0.6, 0, NEAR); d = proj(HALF + 0.6, 0, FAR); e = proj(-HALF - 0.6, 0, FAR);
    c.fillStyle = '#F2D79A';
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.lineTo(e[0], e[1]); c.closePath(); c.fill();
    // planks, far to near
    var step = 0.9, start = Math.floor((dist + FAR) / step) * step;
    for (z = start; z > dist - PZ + NEAR; z -= step) {
      za = Math.max(NEAR, z - dist + PZ); zb = z + step - dist + PZ;
      if (zb <= NEAR || za >= FAR) continue;
      var k = Math.round(z / step);
      a = proj(-HALF, 0, za); b = proj(HALF, 0, za); d = proj(HALF, 0, zb); e = proj(-HALF, 0, zb);
      c.fillStyle = k % 2 ? '#C98B4E' : '#B97B42';
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.lineTo(e[0], e[1]); c.closePath(); c.fill();
    }
    // the lanes, faintly
    c.strokeStyle = 'rgba(90, 50, 20, 0.25)'; c.lineWidth = 3;
    for (i = 0; i < 2; i++) {
      var lx = (LANES[i] + LANES[i + 1]) / 2;
      a = proj(lx, 0, NEAR); b = proj(lx, 0, FAR);
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    }
  }

  /** Palms along the island, and rope posts at the boardwalk's edges (as things to draw in depth order). */
  function scenery(dist, list) {
    var first = Math.ceil((dist - PZ) / 7) * 7;
    for (var wz = first; wz < dist + FAR; wz += 7) {
      var k = Math.round(wz / 7), side = k % 2 ? 1 : -1;
      list.push({z: wz - dist + PZ, draw: palmDraw, x: side * (4.3 + (k * 13 % 5) * 0.7), k: k});
    }
    var fp = Math.ceil((dist - PZ) / 4) * 4;
    for (var pz = fp; pz < dist + 40; pz += 4) {
      list.push({z: pz - dist + PZ, draw: postDraw, x: -HALF - 0.15});
      list.push({z: pz - dist + PZ, draw: postDraw, x: HALF + 0.15});
    }
  }
  function postDraw(o) { cube(o.x, 0, o.z, 0.22, 0.7, 0.22, '#8A5A2E'); }
  function palmDraw(o) {
    if (o.z < NEAR + 0.5) return;
    var lean = (o.x > 0 ? -1 : 1) * 0.12;
    for (var i = 0; i < 5; i++) cube(o.x + lean * i, i * 0.7, o.z, 0.34 - i * 0.02, 0.72, 0.34, i % 2 ? '#9B6A3A' : '#8A5C30');
    var top = proj(o.x + lean * 5, 3.6, o.z), s = top[2];
    c.fillStyle = '#2FA34A';
    for (var l = 0; l < 6; l++) {
      var ang = l / 6 * Math.PI * 2 + o.k;
      c.save(); c.translate(top[0], top[1]); c.rotate(ang);
      c.beginPath(); if (c.ellipse) c.ellipse(0.75 * s, 0, 0.8 * s, 0.2 * s, 0.25, 0, Math.PI * 2); else c.rect(0, -0.1 * s, 1.5 * s, 0.2 * s);
      c.fill(); c.restore();
    }
    c.fillStyle = '#7A4A1E'; c.beginPath(); c.arc(top[0], top[1] + 0.1 * s, 0.14 * s, 0, Math.PI * 2); c.fill();
  }

  // MARK: - The obstacles and the coins

  function objDraw(o) {
    var z = o.z, x = o.x;
    if (o.type === 'coin') {
      if (o.got) return;
      var p = proj(x, o.y + 0.4, z), s = p[2], spin = Math.abs(Math.cos(now * 4 + o.at));
      c.fillStyle = '#C98A00'; c.beginPath(); if (c.ellipse) c.ellipse(p[0], p[1], 0.3 * s * Math.max(0.15, spin), 0.3 * s, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#FFD23D'; c.beginPath(); if (c.ellipse) c.ellipse(p[0], p[1], 0.24 * s * Math.max(0.1, spin), 0.24 * s, 0, 0, Math.PI * 2); c.fill();
      return;
    }
    if (o.type === 'spikes') {
      cube(x, 0, z, 1.3, 0.12, 0.6, '#C8352C');
      var a = proj(x - 0.6, 0.12, z - 0.1), s2 = a[2];
      c.fillStyle = '#D8E2EA';
      for (var i = 0; i < 5; i++) {
        var bx = a[0] + (0.06 + i * 0.25) * s2;
        c.beginPath(); c.moveTo(bx, a[1]); c.lineTo(bx + 0.11 * s2, a[1] - 0.42 * s2); c.lineTo(bx + 0.22 * s2, a[1]); c.closePath(); c.fill();
      }
      return;
    }
    if (o.type === 'crate') {
      cube(x, 0, z, 1.0, 0.95, 0.9, '#B07A3A');
      var f = proj(x - 0.5, 0.95, z - 0.45), g = proj(x + 0.5, 0, z - 0.45);
      c.strokeStyle = '#7A4F22'; c.lineWidth = Math.max(2, 0.06 * f[2]);
      c.strokeRect(f[0] + 0.06 * f[2], f[1] + 0.06 * f[2], g[0] - f[0] - 0.12 * f[2], g[1] - f[1] - 0.12 * f[2]);
      c.beginPath(); c.moveTo(f[0] + 0.06 * f[2], f[1] + 0.06 * f[2]); c.lineTo(g[0] - 0.06 * f[2], g[1] - 0.06 * f[2]); c.stroke();
      return;
    }
    if (o.type === 'beam') {
      cube(x - 0.62, 0, z, 0.16, 1.5, 0.16, '#6B4A2A'); cube(x + 0.62, 0, z, 0.16, 1.5, 0.16, '#6B4A2A');
      cube(x, 0.92, z, 1.5, 0.42, 0.22, '#FFD23D');
      var m = proj(x - 0.75, 1.34, z - 0.11), n = proj(x + 0.75, 0.92, z - 0.11);
      c.fillStyle = '#1D1D1F';
      for (var st = 0; st < 4; st++) {
        var sx0 = m[0] + (n[0] - m[0]) * (st / 4 + 0.05), sw = (n[0] - m[0]) * 0.12;
        c.beginPath(); c.moveTo(sx0, n[1]); c.lineTo(sx0 + sw, n[1]); c.lineTo(sx0 + sw * 2.2, m[1]); c.lineTo(sx0 + sw * 1.2, m[1]); c.closePath(); c.fill();
      }
      return;
    }
    if (o.type === 'rail') {
      var z0 = Math.max(z, NEAR + 0.05), z1 = z + o.len;
      if (z1 <= NEAR) return;
      for (var pz = Math.ceil(o.at / 2) * 2; pz < o.at + o.len; pz += 2) cube(x, 0, pz - o.at + z, 0.12, RAIL_Y, 0.12, '#5E6B78');
      var r0 = proj(x, RAIL_Y, z0), r1 = proj(x, RAIL_Y, z1);
      c.strokeStyle = '#E8EEF4'; c.lineWidth = Math.max(3, 0.1 * r0[2]);
      c.beginPath(); c.moveTo(r0[0], r0[1]); c.lineTo(r1[0], r1[1]); c.stroke();
      c.strokeStyle = 'rgba(255, 255, 255, 0.6)'; c.lineWidth = Math.max(1, 0.03 * r0[2]);
      c.beginPath(); c.moveTo(r0[0], r0[1] - 0.04 * r0[2]); c.lineTo(r1[0], r1[1] - 0.04 * r1[2]); c.stroke();
      return;
    }
    if (o.type === 'ramp') {
      var q0 = proj(x - 0.7, 0, z - 0.8), q1 = proj(x + 0.7, 0, z - 0.8), q2 = proj(x + 0.7, 0.75, z + 0.8), q3 = proj(x - 0.7, 0.75, z + 0.8);
      if (z - 0.8 < NEAR) return;
      c.fillStyle = '#3D7BFF'; c.beginPath(); c.moveTo(q0[0], q0[1]); c.lineTo(q1[0], q1[1]); c.lineTo(q2[0], q2[1]); c.lineTo(q3[0], q3[1]); c.closePath(); c.fill();
      c.fillStyle = '#FFFFFF';
      for (var ar = 0; ar < 3; ar++) {
        var az = z - 0.5 + ar * 0.45, ap = proj(x, 0.75 * (az - z + 0.8) / 1.6, az), as = ap[2];
        c.beginPath(); c.moveTo(ap[0] - 0.25 * as, ap[1] + 0.02 * as); c.lineTo(ap[0], ap[1] - 0.12 * as); c.lineTo(ap[0] + 0.25 * as, ap[1] + 0.02 * as); c.closePath(); c.fill();
      }
      return;
    }
    if (o.type === 'crab') {
      var leg = Math.sin(now * 14) * 0.06;
      cube(x - 0.36, 0, z, 0.1, 0.22 + leg, 0.1, '#B8281E'); cube(x + 0.36, 0, z, 0.1, 0.22 - leg, 0.1, '#B8281E');
      cube(x, 0.16, z, 0.8, 0.36, 0.55, '#E2483D');
      cube(x - 0.56, 0.3, z - 0.1, 0.26, 0.22, 0.22, '#FF6B5A'); cube(x + 0.56, 0.3, z - 0.1, 0.26, 0.22, 0.22, '#FF6B5A');
      cube(x - 0.16, 0.52, z - 0.2, 0.1, 0.16, 0.1, '#FFFFFF'); cube(x + 0.16, 0.52, z - 0.2, 0.1, 0.16, 0.1, '#FFFFFF');
      return;
    }
    if (o.type === 'arm') {   // an octopus arm from the sea, rising and then slamming across a lane
      var side = o.side, base = proj(side * (HALF + 1.6), -0.4, z), up = o.slam;
      var tip = up >= 1 ? proj(x - side * 0.6, 0.15, z) : proj(lerp(side * (HALF + 1.2), x, up * 0.6), lerp(3.4, 1.8, up), z);
      var ctrl = proj(lerp(side * (HALF + 1.4), x, up), lerp(3.8, 1.9, up), z);
      var s3 = base[2];
      c.lineCap = 'round';
      c.strokeStyle = '#8E44AD'; c.lineWidth = 0.62 * s3;
      c.beginPath(); c.moveTo(base[0], base[1]); c.quadraticCurveTo(ctrl[0], ctrl[1], tip[0], tip[1]); c.stroke();
      c.strokeStyle = '#B064D6'; c.lineWidth = 0.3 * s3;
      c.beginPath(); c.moveTo(base[0], base[1]); c.quadraticCurveTo(ctrl[0], ctrl[1] - 0.06 * s3, tip[0], tip[1] - 0.06 * s3); c.stroke();
      c.fillStyle = '#F4D0FF';
      for (var su = 1; su < 6; su++) {
        var tt = su / 6, ux = (1 - tt) * (1 - tt) * base[0] + 2 * (1 - tt) * tt * ctrl[0] + tt * tt * tip[0];
        var uy = (1 - tt) * (1 - tt) * base[1] + 2 * (1 - tt) * tt * ctrl[1] + tt * tt * tip[1];
        c.beginPath(); c.arc(ux, uy + 0.12 * s3, 0.07 * s3, 0, Math.PI * 2); c.fill();
      }
      c.lineCap = 'butt';
      if (up < 1) {   // its shadow, where it will land
        var w0 = proj(x - 0.8, 0, z - 0.3), w1 = proj(x + 0.8, 0, z + 0.3);
        c.fillStyle = 'rgba(80, 20, 120, ' + (0.18 + 0.3 * up).toFixed(2) + ')';
        c.fillRect(w0[0], w1[1], w1[0] - w0[0], w0[1] - w1[1]);
      }
    }
  }

  // MARK: - The run

  var opened = false, state = 'menu', raf = 0, last = 0, now = 0, sel = 0;
  var root = null, hud = null, panel = null;
  var run = null;   // {dist, speed, objs, next, score, coins, combo, comboT, best combo, hearts, ...}
  var P = null;     // the player: {lane, x, y, vy, duck, grind, trick, trickT, tricks, inv, char}
  var pops = [];    // floating texts: {text, x, y, t, color}
  var tips = {};

  function newRun() {
    run = {dist: 0, speed: 9, objs: [], next: 26, score: 0, coins: 0, combo: 0, comboT: 0, bestCombo: 0, hearts: 3, time: 0, over: false};
    P = {lane: 1, x: 0, y: 0, vy: 0, duck: 0, grind: false, grindT: 0, trick: 0, tricks: 0, inv: 0, char: cast[sel] && (cast[sel].kind === 'neon' || cast[sel].img) ? cast[sel] : NEON_CH};
    pops = [];
    tips = {};
    for (var i = 0; i < 6; i++) run.objs.push({type: 'coin', lane: 1, x: 0, at: 10 + i * 2.4, y: 0});
  }

  function lanesFree(n) {   // n different lanes, in a random order
    var l = [0, 1, 2];
    for (var i = 2; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = l[i]; l[i] = l[j]; l[j] = t; }
    return l.slice(0, n);
  }
  function add(o) { o.x = LANES[o.lane]; run.objs.push(o); return o; }
  function coinsLine(lane, at, n, y, gap) { for (var i = 0; i < n; i++) add({type: 'coin', lane: lane, at: at + i * (gap || 1.6), y: y || 0}); }

  /** The island ahead: one pattern at a time, harder as the run goes on (always a lane to get through). */
  function spawn() {
    var at = run.next, lvl = Math.min(1, run.time / 120), r = Math.random(), l;
    var pats = ['spikes', 'crates', 'beam', 'rail', 'ramp', 'crab', 'arm', 'coins', 'mix'];
    var weights = [3, 2.4, 2.2, 1.6, 1.2, 1.4 + lvl, run.time > 20 ? 1 + lvl : 0, 1.4, run.time > 40 ? 2 * lvl : 0];
    var sum = 0, i, pick = 0;
    for (i = 0; i < weights.length; i++) sum += weights[i];
    r *= sum;
    for (i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) { pick = i; break; } }
    var p = pats[pick];
    if (p === 'spikes') { l = lanesFree(lvl > 0.5 ? 2 : 1); for (i = 0; i < l.length; i++) add({type: 'spikes', lane: l[i], at: at}); coinsLine(l[0], at - 1.2, 3, 1.2, 1.2); }
    else if (p === 'crates') { l = lanesFree(2); add({type: 'crate', lane: l[0], at: at}); add({type: 'crate', lane: l[1], at: at + (lvl > 0.4 ? 0 : 3)}); }
    else if (p === 'beam') { l = lanesFree(lvl > 0.3 ? 2 : 1); for (i = 0; i < l.length; i++) add({type: 'beam', lane: l[i], at: at}); }
    else if (p === 'rail') { l = lanesFree(1)[0]; add({type: 'rail', lane: l, at: at, len: 8 + Math.floor(Math.random() * 6)}); coinsLine(l, at + 1, 5, RAIL_Y + 0.3, 1.8); }
    else if (p === 'ramp') { l = lanesFree(1)[0]; add({type: 'ramp', lane: l, at: at}); for (i = 0; i < 5; i++) add({type: 'coin', lane: l, at: at + 3 + i * 1.7, y: 1.4 + Math.sin(i / 4 * Math.PI) * 1.6}); }
    else if (p === 'crab') { l = lanesFree(1)[0]; add({type: 'crab', lane: l, at: at, dir: Math.random() < 0.5 ? -1 : 1}); }
    else if (p === 'arm') { l = lanesFree(1)[0]; add({type: 'arm', lane: l, at: at + 4, side: LANES[l] < 0 ? -1 : LANES[l] > 0 ? 1 : (Math.random() < 0.5 ? -1 : 1), slam: 0}); }
    else if (p === 'coins') { l = lanesFree(1)[0]; coinsLine(l, at, 6, 0, 1.5); }
    else { l = lanesFree(3); add({type: 'spikes', lane: l[0], at: at}); add({type: 'beam', lane: l[1], at: at + 0.3}); coinsLine(l[2], at - 1, 4, 0, 1.4); }
    run.next = at + Math.max(7.5, run.speed * (1.25 - 0.35 * lvl));
  }

  function pop(text, color) { pops.push({text: text, t: 0, color: color || '#FFFFFF', x: P.x}); }
  function mult() { return Math.min(8, 1 + Math.floor(run.combo / 8)); }
  function addCombo(n) { run.combo += n; run.comboT = 5; if (run.combo > run.bestCombo) run.bestCombo = run.combo; }

  function hurt() {
    if (P.inv > 0 || run.over) return;
    run.hearts--;
    P.inv = 1.6;
    if (run.combo >= 8) pop('Kombon bröts', '#FF6B5A');
    run.combo = 0; run.comboT = 0;
    run.speed = Math.max(9, run.speed - 1.5);
    sfx('hit');
    if (run.hearts <= 0) gameOver();
  }

  function step(dt) {
    var i, o;
    run.time += dt;
    run.speed = Math.min(22, run.speed + dt * 0.11);
    run.dist += run.speed * dt;
    // the score: distance, times the combo
    run.score += run.speed * dt * mult();
    if (run.comboT > 0) { run.comboT -= dt; if (run.comboT <= 0) { run.combo = 0; } }
    while (run.next < run.dist + FAR - 6) spawn();
    // the player: lane, jump, duck, grind
    P.x = lerp(P.x, LANES[P.lane], Math.min(1, dt * 14));
    if (P.duck > 0) P.duck -= dt;
    if (P.inv > 0) P.inv -= dt;
    var onRail = null;
    for (i = 0; i < run.objs.length; i++) {
      o = run.objs[i];
      if (o.type === 'rail' && o.lane === P.lane && Math.abs(P.x - o.x) < 0.5 && run.dist >= o.at - 0.2 && run.dist <= o.at + o.len) onRail = o;
    }
    if (onRail && P.y <= RAIL_Y + 0.08 && P.vy <= 0) {
      if (!P.grind) { P.grind = true; sfx('grind'); if (!tips.rail) tips.rail = 1; }
      P.y = RAIL_Y; P.vy = 0;
      P.grindT += dt;
      if (P.grindT > 0.45) { P.grindT = 0; addCombo(1); run.score += 20 * mult(); }
    } else {
      if (P.grind) { P.grind = false; P.grindT = 0; }
      if (P.y > 0 || P.vy > 0) {
        P.vy -= GRAV * dt;
        P.y += P.vy * dt;
        if (P.y <= 0) {
          P.y = 0; P.vy = 0;
          if (P.trick > 0) { pop('Vurpa!', '#FF6B5A'); run.combo = 0; run.comboT = 0; P.trick = 0; }
          P.tricks = 0;
        }
      }
    }
    if (P.trick > 0) { P.trick -= dt; if (P.trick <= 0) { P.trick = 0; } }
    // the world: crabs walk, arms slam, things are hit or collected
    for (i = run.objs.length - 1; i >= 0; i--) {
      o = run.objs[i];
      o.z = o.at - run.dist + PZ;
      if (o.z + (o.len || 0) < 0.4) { run.objs.splice(i, 1); continue; }
      if (o.type === 'crab' && o.z < 30) {
        o.x += o.dir * dt * 1.1;
        if (o.x > LANES[2]) { o.x = LANES[2]; o.dir = -1; }
        if (o.x < LANES[0]) { o.x = LANES[0]; o.dir = 1; }
        o.lane = o.x < -0.85 ? 0 : o.x > 0.85 ? 2 : 1;
      }
      if (o.type === 'arm') { var want = o.z < 9 ? 1 : o.z < 26 ? (26 - o.z) / 17 * 0.85 : 0; if (want >= 1 && o.slam < 1) sfx('slam'); o.slam = want; }
      if (o.type === 'ramp' && Math.abs(o.z - PZ) < 0.5 && Math.abs(P.x - o.x) < 0.7 && P.y < 0.3 && !o.used) {
        o.used = true; P.vy = RAMP; P.y = 0.05; P.duck = 0; sfx('jump');
        if (!tips.ramp) { tips.ramp = 1; hint('Tryck OK i luften för trick!'); }
      }
      var near = Math.abs(o.z - PZ) < 0.45, inLane = Math.abs(P.x - o.x) < 0.8;
      if (o.type === 'coin' && !o.got && Math.abs(o.z - PZ) < 0.6 && Math.abs(P.x - o.x) < 0.75 && Math.abs((P.y + 0.6) - (o.y + 0.4)) < 1.0) {
        o.got = true; run.coins++; run.score += 10 * mult(); addCombo(1); sfx('coin');
      }
      if (!near || !inLane || P.inv > 0) continue;
      var h = P.duck > 0 ? 0.7 : 1.5;
      if (o.type === 'spikes' && P.y < 0.35) hurt();
      else if (o.type === 'crate' && P.y < 0.92) hurt();
      else if (o.type === 'crab' && P.y < 0.55) hurt();
      else if (o.type === 'beam' && P.y < 1.38 && P.y + h > 0.95) hurt();
      else if (o.type === 'arm' && o.slam >= 1 && P.y < 1.0) hurt();
    }
    // first-time tips, a little before the thing comes
    for (i = 0; i < run.objs.length; i++) {
      o = run.objs[i];
      if (o.z > 14 || o.z < PZ) continue;
      if (o.type === 'spikes' && !tips.spikes) { tips.spikes = 1; hint('▲ Hoppa över spikarna!'); }
      if (o.type === 'beam' && !tips.beam) { tips.beam = 1; hint('▼ Ducka under bommen!'); }
      if (o.type === 'arm' && !tips.arm) { tips.arm = 1; hint('◀ ▶ Byt fil – armen slår ner!'); }
      if (o.type === 'rail' && !tips.railh) { tips.railh = 1; hint('Åk upp på räcket och glid!'); }
    }
    for (i = pops.length - 1; i >= 0; i--) { pops[i].t += dt; if (pops[i].t > 1.1) pops.splice(i, 1); }
  }

  function jump() {
    if (P.grind || P.y <= 0.001) {
      P.vy = JUMP; P.y = Math.max(P.y, 0.01); P.grind = false; P.duck = 0; sfx('jump');
    } else trick();
  }
  function trick() {
    if (P.y <= 0.3 || P.trick > 0 || P.tricks >= 3) return;
    P.trick = 0.34; P.tricks++;
    addCombo(1);
    var pts = 50 * mult();
    run.score += pts;
    pop(['Snurr!', 'Kickflip!', 'Supersnurr!'][P.tricks - 1] + ' +' + pts, '#FFD23D');
    sfx('trick');
  }

  // MARK: - Drawing a frame

  /** In the menu, the chosen character rides by itself, weaving and hopping now and then. */
  function menuRider() {
    var hop = now % 3.2, y = hop < 0.73 ? JUMP * hop - GRAV / 2 * hop * hop : 0;
    return {x: Math.sin(now * 0.6) * 1.2, y: Math.max(0, y), duck: 0, inv: 0, trick: hop > 0.25 && hop < 0.59 ? 0.59 - hop : 0, grind: false, char: cast[sel] && (cast[sel].kind === 'neon' || cast[sel].img) ? cast[sel] : NEON_CH};
  }

  /** The neon dancer's pose on the board: arms out for balance, up in the air, down when ducking, wide on a rail. */
  function neonPose(P, lean) {
    var air = P.y > 0.25 && !P.grind;
    if (P.duck > 0) return {la: [-40, -20], ra: [40, 20], ll: [-34, 26], rl: [34, -26], lean: lean, x: 0, y: 90, head: 0, bend: 0.45};
    if (air) return {la: [-150, -165], ra: [150, 165], ll: [-22, 34], rl: [22, -34], lean: lean, x: 0, y: -10, head: 0, bend: 0};
    if (P.grind) return {la: [-92, -88], ra: [92, 88], ll: [-16, 8], rl: [16, -8], lean: lean, x: 0, y: 14, head: 0, bend: 0};
    var sway = Math.sin(now * 5) * 4;
    return {la: [-100 + sway, -108], ra: [100 + sway, 108], ll: [-14, 8], rl: [14, -8], lean: lean, x: 0, y: 18, head: 0, bend: 0};
  }

  function drawPlayer() {
    var P = window.Rush && run ? Rush._player() : menuRider();
    var ch = P.char, flash = P.inv > 0 && Math.floor(P.inv * 10) % 2 === 0;
    if (flash) return;
    var x = P.x, y = P.y, z = PZ;
    // its shadow on the boards
    var sp = proj(x, P.grind ? RAIL_Y : 0, z), ss = sp[2];
    c.fillStyle = 'rgba(0, 0, 0, 0.22)';
    c.beginPath(); if (c.ellipse) c.ellipse(sp[0], sp[1], 0.5 * ss * (1 - Math.min(0.5, y * 0.15)), 0.12 * ss, 0, 0, Math.PI * 2); c.fill();
    var spin = P.trick > 0 ? Math.cos((1 - P.trick / 0.34) * Math.PI * 2) : 1;
    var mid = proj(x, y + 0.6, z);
    c.save();
    c.translate(mid[0], mid[1]); c.scale(Math.abs(spin) < 0.12 ? 0.12 * (spin < 0 ? -1 : 1) : spin, 1); c.translate(-mid[0], -mid[1]);
    // the board, its wheels
    cube(x - 0.18, y, z - 0.38, 0.1, 0.1, 0.12, '#1D1D1F'); cube(x + 0.18, y, z - 0.38, 0.1, 0.1, 0.12, '#1D1D1F');
    cube(x - 0.18, y, z + 0.38, 0.1, 0.1, 0.12, '#1D1D1F'); cube(x + 0.18, y, z + 0.38, 0.1, 0.1, 0.12, '#1D1D1F');
    cube(x, y + 0.1, z, 0.52, 0.08, 1.06, ch.kind === 'neon' ? '#FF3DA5' : '#2EE6FF');
    // the rider, leaning into a lane change
    var target = run && P.lane !== undefined ? LANES[P.lane] : x + Math.cos(now * 0.6) * 0.15;
    var lean = clamp((target - x) * 0.35, -0.16, 0.16), feet = proj(x, y + 0.18, z);
    if (ch.kind === 'img' && ch.img) {
      var hgt = 1.8 * ss * (P.duck > 0 ? 0.62 : 1), wid = hgt * ch.img.width / ch.img.height * (P.duck > 0 ? 1 / 0.62 * 0.9 : 1);
      c.save();
      c.translate(feet[0], feet[1]); c.rotate(lean);
      if (P.grind) c.rotate(Math.sin(now * 18) * 0.03);
      c.drawImage(ch.img, -wid / 2, -hgt, wid, hgt);
      c.restore();
    } else if (window.Dance && Dance._draw) {
      Dance._draw(c, neonPose(P, lean * 40), feet[0], feet[1] - 0.3 * ss, ss * 0.0024, 0.5 + 0.4 * Math.abs(Math.sin(now * 4)), false);
    } else {
      cube(x, y + 0.18, z, 0.5, 1.4, 0.4, '#8AF6FF');
    }
    c.restore();
    if (P.grind) {   // sparks off the rail
      var gp = proj(x, RAIL_Y, z - 0.4);
      c.fillStyle = '#FFE680';
      for (var k = 0; k < 6; k++) c.fillRect(gp[0] + (Math.random() - 0.5) * 60, gp[1] - Math.random() * 30, 5, 5);
    }
  }

  function render() {
    var dist = run ? run.dist : now * 7;
    var px = P ? P.x : Math.sin(now * 0.6) * 1.2;
    camX = px * 0.4;
    drawSky(now);
    drawSea(dist, now);
    drawPath(dist);
    var list = [];
    scenery(dist, list);
    if (run && state !== 'menu') for (var i = 0; i < run.objs.length; i++) { var o = run.objs[i]; list.push({z: o.z || (o.at - dist + PZ), draw: objDraw, o: o}); }
    list.push({z: PZ, draw: drawPlayer, me: true});
    list.sort(function (a, b) { return b.z - a.z; });
    for (var k = 0; k < list.length; k++) {
      var it = list[k];
      if (it.z > FAR || it.z < NEAR - 1) continue;
      c.globalAlpha = it.z > FAR - 22 ? clamp((FAR - it.z) / 22, 0, 1) : 1;
      if (it.me) it.draw(); else if (it.o) { it.o.z = it.z; it.draw(it.o); } else it.draw(it);
    }
    c.globalAlpha = 1;
    // floating texts over the rider
    c.textAlign = 'center';
    for (var p = 0; p < pops.length; p++) {
      var q = pops[p], pp = proj(q.x, 2.4 + q.t * 1.2, PZ);
      c.globalAlpha = clamp(1.2 - q.t, 0, 1);
      c.font = '800 54px Inter, Helvetica Neue, Arial, sans-serif';
      c.fillStyle = 'rgba(0, 0, 0, 0.35)'; c.fillText(q.text, pp[0] + 3, pp[1] + 4);
      c.fillStyle = q.color; c.fillText(q.text, pp[0], pp[1]);
    }
    c.globalAlpha = 1;
  }

  // MARK: - The screens: menu, the run's HUD, pause, game over

  function build() {
    root = $('rush');
    if (!root) { root = el('div', 'layer', $('stage') || document.body); root.id = 'rush'; }
    root.innerHTML = '';
    canvas = el('canvas', 'r-stage', root);
    canvas.width = W; canvas.height = H;
    c = canvas.getContext('2d');
    hud = el('div', 'r-hud', root);
    panel = el('div', 'r-panel', root);
  }

  function drawMenu() {
    hud.innerHTML = '';
    panel.className = 'r-panel menu';
    panel.innerHTML = '';
    var box = el('div', 'r-box', panel);
    el('div', 'r-title', box, 'Ö-ruset');
    el('div', 'r-sub', box, 'Åk brädan över ön. Hoppa, ducka, glid på räckena och gör trick i luften!');
    // the figures, as in Dansgolvet: Neon, then the gubbar from Drive (◀ ▶)
    var row = el('div', 'r-cast', box), from = clamp(sel - 2, 0, Math.max(0, cast.length - 6));
    for (var i = from; i < Math.min(cast.length, from + 6); i++) {
      var ch = cast[i], face = el('div', 'r-face' + (i === sel ? ' on' : ''), row);
      if (ch.kind === 'neon') {
        var cv = el('canvas', '', face); cv.width = 84; cv.height = 84;
        if (window.Dance && Dance._draw) Dance._draw(cv.getContext('2d'), {la: [-100, -108], ra: [100, 108], ll: [-14, 8], rl: [14, -8], lean: 0, x: 0, y: 0, head: 0, bend: 0}, 42, 82, 0.1, 0.5, false);
      } else if (ch.img) face.appendChild(thumbOf(ch.img));
      else if (ch.thumb) face.style.backgroundImage = 'url(' + ch.thumb + ')';
    }
    var cur = cast[sel] || NEON_CH;
    var pick = el('div', 'r-pick', box);
    el('span', 'r-arrow', pick, '◀');
    el('span', 'r-char', pick, cur.kind === 'img' && cur.waiting ? 'Hämtar ' + cur.name + '…' : cur.name);
    el('span', 'r-arrow', pick, '▶');
    if (castNote) el('div', 'r-note', box, castNote);
    el('div', 'r-go focus', box, 'Spela');
    if (cfg.best) el('div', 'r-best', box, 'Rekord: ' + Math.round(cfg.best) + ' poäng');
    var help = el('div', 'r-help', box);
    var rows = [['◀ ▶', 'byt fil'], ['▲', 'hoppa'], ['▼', 'ducka'], ['OK i luften', 'trick']];
    for (var k = 0; k < rows.length; k++) { var r = el('span', 'r-key', help); el('b', '', r, rows[k][0]); r.appendChild(document.createTextNode(' ' + rows[k][1])); }
  }

  function thumbOf(img) {   // a cut-out gubbe's head and shoulders, for the menu
    var t = document.createElement('canvas'), sh = img.height * 0.42, sw = Math.min(img.width, sh);
    t.width = 84; t.height = 84;
    t.getContext('2d').drawImage(img, (img.width - sw) / 2, 0, sw, sh, 0, 0, 84, 84);
    return t;
  }

  function drawHud() {
    panel.className = 'r-panel'; panel.innerHTML = '';
    hud.innerHTML = '';
    var left = el('div', 'r-score', hud);
    el('div', 'r-num', left, '0');
    var cb = el('div', 'r-combo', left);
    el('span', 'r-mult', cb, '×1');
    var bar = el('span', 'r-cbar', cb); el('span', 'r-cfill', bar);
    var right = el('div', 'r-right', hud);
    el('div', 'r-hearts', right);
    el('div', 'r-coins', right);
    el('div', 'r-hint', hud);
  }

  var hudKey = '';
  function updateHud() {
    var key = Math.floor(run.score) + '|' + run.combo + '|' + run.hearts + '|' + run.coins + '|' + Math.ceil(run.comboT * 10);
    if (key === hudKey) return;
    hudKey = key;
    var num = hud.querySelector('.r-num'); if (!num) return;
    num.textContent = String(Math.floor(run.score));
    var m = mult();
    hud.querySelector('.r-mult').textContent = '×' + m + (run.combo ? '  ·  kombo ' + run.combo : '');
    hud.querySelector('.r-combo').className = 'r-combo' + (m > 1 ? ' hot' : '');
    hud.querySelector('.r-cfill').style.width = clamp(run.comboT / 5 * 100, 0, 100).toFixed(0) + '%';
    var hearts = '';
    for (var i = 0; i < 3; i++) hearts += i < run.hearts ? '♥' : '♡';
    hud.querySelector('.r-hearts').textContent = hearts;
    hud.querySelector('.r-coins').textContent = '● ' + run.coins;
  }

  var hintTimer = 0;
  function hint(text) {
    var h = hud && hud.querySelector('.r-hint');
    if (!h) return;
    h.textContent = text; h.className = 'r-hint on';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { if (h) h.className = 'r-hint'; }, 2600);
  }

  var btn = 0;
  function drawPause() {
    panel.className = 'r-panel pause'; panel.innerHTML = '';
    var box = el('div', 'r-box small', panel);
    el('div', 'r-title small', box, 'Paus');
    var row = el('div', 'r-btns', box);
    el('div', 'r-btn' + (btn === 0 ? ' focus' : ''), row, 'Fortsätt');
    el('div', 'r-btn' + (btn === 1 ? ' focus' : ''), row, 'Till menyn');
  }

  function gameOver() {
    hudKey = ''; updateHud();   // the last heart shows as lost
    run.over = true;
    state = 'over'; btn = 0;
    var record = !cfg.best || run.score > cfg.best;
    if (record) cfg.best = Math.round(run.score);
    save();
    stopMusic(); sfx('over');
    run.record = record;
    drawOver();
  }
  function drawOver() {
    panel.className = 'r-panel over'; panel.innerHTML = '';
    var box = el('div', 'r-box', panel);
    el('div', 'r-title small', box, run.record ? 'Nytt rekord!' : 'Bra kört!');
    el('div', 'r-big', box, String(Math.round(run.score)));
    var st = el('div', 'r-stats', box);
    var items = [['Mynt', run.coins], ['Längsta kombo', run.bestCombo], ['Rekord', cfg.best || 0]];
    for (var i = 0; i < items.length; i++) { var s = el('div', 'r-stat', st); el('b', '', s, String(items[i][1])); el('span', '', s, items[i][0]); }
    var row = el('div', 'r-btns', box);
    el('div', 'r-btn' + (btn === 0 ? ' focus' : ''), row, 'Spela igen');
    el('div', 'r-btn' + (btn === 1 ? ' focus' : ''), row, 'Byt figur');
  }

  function start() {
    newRun();
    state = 'play';
    drawHud(); hudKey = '';
    startMusic();
    if (!cfg.played) { hint('◀ ▶ byt fil   ▲ hoppa   ▼ ducka'); cfg.played = 1; save(); }
  }
  function toMenu() { state = 'menu'; run = null; P = null; stopMusic(); drawMenu(); }

  function loop(ts) {
    if (!opened) return;
    raf = (window.requestAnimationFrame || function (f) { return setTimeout(function () { f(Date.now()); }, 33); })(loop);
    var t = (ts || Date.now()) / 1000, dt = last ? clamp(t - last, 0, 0.05) : 0.016;
    last = t;
    now += dt;
    if (state === 'play') { step(dt); if (state === 'play') updateHud(); }
    render();
  }

  function open() {
    if (opened) return;
    if (!root) build();
    opened = true;
    sel = 0;
    for (var j = 0; j < cast.length; j++) if (cast[j].id === cfg.char) sel = j;
    root.className = 'layer on';
    toMenu();
    loadCast();
    last = 0;
    loop();
  }
  function close() {
    if (!opened) return;
    opened = false;
    stopMusic();
    root.className = 'layer';
    if (raf) { (window.cancelAnimationFrame || clearTimeout)(raf); raf = 0; }
  }
  function isOpen() { return opened; }

  // MARK: - Sound: small effects and a sunny loop, made here with Web Audio

  var actx = null, master = null, noise = null, music = null;
  function audio() {
    if (actx) return actx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { actx = new AC(); } catch (e) { return null; }
    master = actx.createGain(); master.gain.value = 0.55; master.connect(actx.destination);
    noise = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    var d = noise.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return actx;
  }
  function tone(type, f0, f1, len, vol, at) {
    var a = audio(); if (!a) return;
    try { if (a.resume) a.resume(); } catch (e) {}
    var t = at || a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + len + 0.02);
  }
  function hiss(len, vol, freq, at) {
    var a = audio(); if (!a) return;
    var t = at || a.currentTime, n = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    n.buffer = noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.9;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(f); f.connect(g); g.connect(master); n.start(t, Math.random() * 0.4); n.stop(t + len + 0.02);
  }
  function sfx(kind) {
    if (kind === 'jump') tone('square', 330, 660, 0.14, 0.12);
    else if (kind === 'coin') { tone('square', 988, 0, 0.06, 0.08); var a = audio(); if (a) tone('square', 1319, 0, 0.12, 0.08, a.currentTime + 0.06); }
    else if (kind === 'trick') { hiss(0.25, 0.25, 2400); tone('triangle', 520, 1040, 0.2, 0.12); }
    else if (kind === 'grind') hiss(0.35, 0.2, 3800);
    else if (kind === 'hit') { hiss(0.3, 0.5, 400); tone('sawtooth', 180, 60, 0.3, 0.2); }
    else if (kind === 'slam') hiss(0.4, 0.35, 220);
    else if (kind === 'over') { tone('triangle', 523, 0, 0.18, 0.15); var b = audio(); if (b) { tone('triangle', 392, 0, 0.18, 0.15, b.currentTime + 0.18); tone('triangle', 262, 0, 0.4, 0.15, b.currentTime + 0.36); } }
  }

  // A happy island loop: F – C – Dm – Bb, bass, a plucked arpeggio, light drums. 120 bpm.
  var LOOP = [[53, [65, 69, 72]], [48, [60, 64, 67]], [50, [62, 65, 69]], [46, [58, 62, 65]]];
  function startMusic() {
    var a = audio(); if (!a) return;
    try { if (a.resume) a.resume(); } catch (e) {}
    stopMusic();
    var m = {t0: a.currentTime + 0.1, step: 0};
    var s16 = 60 / 120 / 4;
    m.timer = setInterval(function () {
      if (music !== m) return;
      while (m.t0 + m.step * s16 < a.currentTime + 0.2) {
        var t = m.t0 + m.step * s16, pos = m.step % 16, ch = LOOP[Math.floor(m.step / 16) % 4];
        if (pos % 4 === 0) tone('sine', 120, 45, 0.18, 0.35, t);
        if (pos % 8 === 4) hiss(0.12, 0.18, 1800, t);
        if (pos % 2 === 0) hiss(0.03, 0.06, 8000, t);
        if (pos % 4 === 0 || pos === 6 || pos === 14) tone('triangle', 440 * Math.pow(2, (ch[0] - 69) / 12), 0, s16 * 1.8, 0.16, t);
        if (pos % 2 === 0) { var n = ch[1][(pos / 2) % 3] + (pos >= 8 ? 12 : 0); tone('square', 440 * Math.pow(2, (n - 69) / 12), 0, s16 * 0.9, 0.035, t); }
        m.step++;
      }
    }, 40);
    music = m;
  }
  function stopMusic() { if (music) { clearInterval(music.timer); music = null; } }

  // MARK: - Keys

  var K = {left: 37, up: 38, right: 39, down: 40, ok: 13};
  window.addEventListener('keydown', function (e) {
    if (!opened) return;
    if (window.FreeMyTV && FreeMyTV.poke) FreeMyTV.poke();
    var k = e.keyCode, back = k === 10009 || k === 461 || k === 27 || k === 8 || (window.TV && TV.keys && k === TV.keys.back);
    e.preventDefault(); e.stopPropagation();
    if (state === 'menu') {
      if (back) { close(); return; }
      if (k === K.left) { sel = (sel + cast.length - 1) % cast.length; drawMenu(); prefetch(); }
      else if (k === K.right) { sel = (sel + 1) % cast.length; drawMenu(); prefetch(); }
      else if (k === K.ok) {
        var ch = cast[sel] || NEON_CH;
        cfg.char = ch.id; save();
        if (ch.kind === 'img' && !ch.img) {
          fetchSprite(ch, function (ok) {
            if (!opened || state !== 'menu') return;
            if (!ok) { castNote = ch.name + ' gick inte att hämta. Välj en annan, eller Neon.'; drawMenu(); return; }
            start();
          });
          drawMenu();
          return;
        }
        start();
      }
      return;
    }
    if (state === 'play') {
      if (back) { state = 'pause'; btn = 0; stopMusic(); drawPause(); return; }
      if (k === K.left && P.lane > 0) { P.lane--; if (P.grind) { P.grind = false; P.vy = 3; } }
      else if (k === K.right && P.lane < 2) { P.lane++; if (P.grind) { P.grind = false; P.vy = 3; } }
      else if (k === K.up) jump();
      else if (k === K.ok) { if (P.y > 0.3) trick(); else jump(); }
      else if (k === K.down) { if (P.y > 0.05 && !P.grind) P.vy = -16; else { P.duck = 0.6; if (P.grind) { P.grind = false; } } }
      return;
    }
    if (state === 'pause') {
      if (back) { state = 'play'; drawHud(); hudKey = ''; startMusic(); return; }
      if (k === K.left || k === K.right || k === K.up || k === K.down) { btn = btn ? 0 : 1; drawPause(); return; }
      if (k === K.ok) { if (btn === 0) { state = 'play'; drawHud(); hudKey = ''; startMusic(); } else toMenu(); }
      return;
    }
    if (state === 'over') {
      if (back) { toMenu(); return; }
      if (k === K.left || k === K.right || k === K.up || k === K.down) { btn = btn ? 0 : 1; drawOver(); return; }
      if (k === K.ok) { if (btn === 0) start(); else toMenu(); }
    }
  }, true);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && opened && state === 'play') { state = 'pause'; btn = 0; stopMusic(); drawPause(); }
  });

  return {open: open, close: close, isOpen: isOpen, _state: function () { return state; }, _run: function () { return run; }, _player: function () { return P; }};
})();
