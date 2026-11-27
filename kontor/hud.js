/*
 * Kontrollrum: skärmsläckaren på jobbets TV (Inställningar → Hemskärm → Skärmsläckare → Kontrollrum). Glödande ringar
 * som roterar långsamt runt klockan, med restiden hem (trafik.js), vädret och nästa Barça-match runt om.
 * Ringarna ritas en gång på var sin canvas och roteras sedan av CSS (billigt för stickan). Allt glider sakta, så att
 * inget bränns in. Bara i kontor/. ES5.
 */
var Hud = (function () {
  'use strict';
  var root = null, shift = null, on = false, timer = 0;
  var CYAN = '120, 214, 255', DAYS = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'],
    MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  var LEVEL = {green: '52, 199, 89', yellow: '255, 201, 64', red: '255, 69, 58'};

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function rad(deg) { return (deg - 90) * Math.PI / 180; }

  /** En canvas på size × size i parent, med mitten i (0, 0); draw(g) ritar ringen. */
  var into = null;
  function layer(cls, size, draw) {
    var c = el('canvas', 'ring ' + cls, into);
    c.width = c.height = size;
    c.style.width = c.style.height = size + 'px';
    c.style.marginLeft = c.style.marginTop = -size / 2 + 'px';
    var g = c.getContext('2d');
    g.translate(size / 2, size / 2);
    draw(g);
    return c;
  }

  function glow(g, alpha, blur) {
    g.shadowColor = 'rgba(' + CYAN + ', ' + alpha + ')';
    g.shadowBlur = blur;
  }

  function arc(g, r, from, to, width, color) {
    g.beginPath();
    g.arc(0, 0, r, rad(from), rad(to));
    g.lineWidth = width;
    g.strokeStyle = color;
    g.stroke();
  }

  // MARK: - Ringarna

  /** Ringarna och stjärnfältet i parent: skärmsläckaren och bakgrunden på startsidan (decorate) har samma. */
  function rings(parent) {
    into = parent;
    // Stjärnfältet: punkter och tunna linjer mellan de närmaste, utanför ringarna.
    layer('stars', 1240, function (g) {
      var pts = [], i, j;
      for (i = 0; i < 150; i++) {
        var a = Math.random() * Math.PI * 2, r = 470 + Math.pow(Math.random(), 0.7) * 140;
        pts.push([Math.cos(a) * r, Math.sin(a) * r, Math.random()]);
      }
      g.lineWidth = 1;
      for (i = 0; i < pts.length; i++) {
        for (j = i + 1; j < pts.length; j++) {
          var dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
          if (dx * dx + dy * dy < 2600) {
            g.strokeStyle = 'rgba(200, 225, 255, 0.16)';
            g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[j][0], pts[j][1]); g.stroke();
          }
        }
      }
      for (i = 0; i < pts.length; i++) {
        g.fillStyle = 'rgba(220, 235, 255, ' + (0.35 + pts[i][2] * 0.5) + ')';
        g.beginPath(); g.arc(pts[i][0], pts[i][1], 1 + pts[i][2] * 1.6, 0, Math.PI * 2); g.fill();
      }
    });

    // Yttre ringen: tunn, med tjockare stycken och luckor.
    layer('outer', 1000, function (g) {
      glow(g, 0.9, 22);
      arc(g, 440, 0, 360, 3, 'rgba(' + CYAN + ', 0.75)');
      var parts = [[20, 64], [150, 172], [205, 260], [318, 336]];
      for (var i = 0; i < parts.length; i++) arc(g, 440, parts[i][0], parts[i][1], 11, 'rgba(' + CYAN + ', 0.95)');
      glow(g, 0, 0);
      for (i = 0; i < 14; i++) arc(g, 462, 96 + i * 2.2, 96 + i * 2.2 + 1.1, 16, 'rgba(' + CYAN + ', 0.7)');
    });

    // Skalstreck.
    layer('ticks', 1000, function (g) {
      glow(g, 0.6, 8);
      g.strokeStyle = 'rgba(' + CYAN + ', 0.8)';
      for (var i = 0; i < 90; i++) {
        var a = rad(i * 4), long = i % 5 === 0, r1 = long ? 382 : 390, r2 = 404;
        g.lineWidth = long ? 3 : 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        g.stroke();
      }
    });

    // Det breda bandet: tre fjärdedelar av ett varv, i fält.
    layer('band', 1000, function (g) {
      glow(g, 0.55, 26);
      arc(g, 345, -40, 220, 34, 'rgba(96, 170, 240, 0.55)');
      glow(g, 0, 0);
      g.strokeStyle = 'rgba(10, 20, 34, 0.9)';
      g.lineWidth = 2;
      for (var d = -40; d <= 220; d += 13) {
        var a = rad(d);
        g.beginPath(); g.moveTo(Math.cos(a) * 327, Math.sin(a) * 327); g.lineTo(Math.cos(a) * 363, Math.sin(a) * 363); g.stroke();
      }
      for (var k = 0; k < 5; k++) {
        var b = rad(-20 + k * 7);
        g.fillStyle = 'rgba(255, 210, 90, 0.95)';
        g.beginPath(); g.arc(Math.cos(b) * 305, Math.sin(b) * 305, 4, 0, Math.PI * 2); g.fill();
      }
    });

    // Inre ringen med prickfältet.
    layer('inner', 1000, function (g) {
      g.fillStyle = 'rgba(190, 215, 255, 0.10)';
      for (var y = -262; y <= 262; y += 11) {
        for (var x = -262; x <= 262; x += 11) if (x * x + y * y < 262 * 262 && Math.random() < 0.55) g.fillRect(x, y, 1.6, 1.6);
      }
      glow(g, 1, 24);
      arc(g, 280, 0, 360, 6, 'rgba(' + CYAN + ', 0.95)');
      arc(g, 290, 200, 330, 2, 'rgba(' + CYAN + ', 0.6)');
    });

  }

  function build() {
    root = el('div', '', document.body);
    root.id = 'hud';
    shift = el('div', 'shift', root);
    rings(shift);
    // Accentbågen: färgen följer trafiken (grön, gul, röd). Ritas om när trafiken ändras.
    var accent = el('canvas', 'ring accent', shift);
    accent.width = accent.height = 1000;
    accent.style.width = accent.style.height = '1000px';
    accent.style.marginLeft = accent.style.marginTop = '-500px';

    var mid = el('div', 'mid', shift);
    el('div', 'hello', mid);
    el('div', 'time', mid);
    el('div', 'date', mid);

    el("div", "info left", shift);
    el("div", "info right", shift);
    el("div", "info bottom", shift);
  }

  function paintAccent(level) {
    var c = root.querySelector('.accent'), g = c.getContext('2d'), col = LEVEL[level] || LEVEL.yellow;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, 1000, 1000);
    g.translate(500, 500);
    g.shadowColor = 'rgba(' + col + ', 0.9)';
    g.shadowBlur = 18;
    arc(g, 315, 232, 292, 5, 'rgba(' + col + ', 0.95)');
    arc(g, 315, 296, 300, 9, 'rgba(' + col + ', 0.95)');
  }

  // MARK: - Innehållet

  function hello(d) {
    var h = d.getHours();
    return h < 5 ? 'God natt, Yuri' : h < 10 ? 'God morgon, Yuri' : h < 12 ? 'God förmiddag, Yuri' : h < 18 ? 'God eftermiddag, Yuri' : 'God kväll, Yuri';
  }

  function tile(cls, label, big, small, level) {
    var t = root.querySelector(".info." + cls);
    t.innerHTML = '';
    t.style.display = big ? '' : 'none';
    if (!big) return;
    el('div', 'label', t, label);
    var b = el('div', 'big', t, big);
    if (level) b.className = 'big ' + level;
    if (small) el('div', 'small', t, small);
  }

  function update() {
    if (!root) return;
    var d = new Date();
    root.querySelector('.time').textContent = two(d.getHours()) + ':' + two(d.getMinutes());
    root.querySelector('.date').textContent = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];

    var t = window.Trafik && Trafik.state ? Trafik.state() : null, h = d.getHours(), weekday = d.getDay() >= 1 && d.getDay() <= 5;
    root.querySelector('.hello').textContent = t && weekday && h >= 15 && h < 18
      ? 'Dags att åka hem? ' + t.min + ' min'
      : hello(d);
    tile('left', 'RESTID HEM', t ? t.min + ' min' : '', t ? (t.delay >= 1 ? '+' + t.delay + ' min kö' : 'Fritt') + '  ·  framme ' + t.arrive : '', t ? t.level : '');
    paintAccent(t ? t.level : 'green');

    var w = typeof Data !== 'undefined' && Prefs.weather() ? Data.weather : null;
    tile('right', 'UPPSALA', w && !isNaN(w.temp) ? Data.degrees(w.temp) : '', w ? Data.condition(w.code, w.isDay) : '');

    var m = window.BarcaBox && BarcaBox.next ? BarcaBox.next() : null;
    if (m) {
      var k = new Date(m.start);
      tile('bottom', 'NÄSTA MATCH', m.title, DAYS[k.getDay()] + ' ' + k.getDate() + ' ' + MONTHS[k.getMonth()] + '  ·  ' + two(k.getHours()) + ':' + two(k.getMinutes()) + (m.competition ? '  ·  ' + m.competition : ''));
    } else tile('bottom', '', '', '');

    // Hela bilden glider sakta (10 minuter ett varv), som klockan i den andra skärmsläckaren.
    var phase = 2 * Math.PI * (d.getTime() / 1000 % 600) / 600;
    shift.style.webkitTransform = shift.style.transform =
      'translate(' + Math.round(36 * Math.sin(phase)) + 'px,' + Math.round(22 * Math.sin(2 * phase + 0.7)) + 'px)';
  }

  function show() {
    if (on) return;
    if (!root) build();
    on = true;
    update();
    root.className = 'on';
    timer = setInterval(update, 15000);
  }

  function hide() {
    if (!on) return;
    on = false;
    clearInterval(timer);
    root.className = '';
  }

  /** Samma ringar, svagare, bakom hela startsidan (kontor: allt i samma stil). En gång. */
  function decorate() {
    var sky = document.getElementById('sky');
    if (!sky || document.getElementById('hudbg')) return;
    var bg = el('div', '', sky);
    bg.id = 'hudbg';
    rings(bg);
  }

  return {show: show, hide: hide, isOn: function () { return on; }, decorate: decorate};
})();
