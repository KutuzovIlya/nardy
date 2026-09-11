/* ============================================================
   Нарды — интерфейс: расстановка шашек, ходы, диалоги, звук
   ============================================================ */
(function () {
  'use strict';

  var N = window.Nardy, B = window.NardyBoard, AI = window.NardyAI;
  var $ = function (id) { return document.getElementById(id); };

  var board = $('board'), scene = $('scene'), stage = $('stage');
  var lZones = $('zones'), lMen = $('men'), lSpots = $('spots'), lDice = $('dicefx');

  var S = null;              /* состояние партии */
  var VIS = null;            /* какие шашки где лежат: { pts: [..], off: {} } */
  var men = {};              /* id шашки -> элемент */
  var pos = {};              /* id -> {x,y} в пикселях */
  var tags = [];             /* счётчики на высоких стопках */
  var sel = null;            /* выбранный пункт */
  var legal = [];
  var busy = true;
  var undoStack = [];
  var rows = [];             /* журнал ходов */
  var tally = { w: 0, b: 0 };
  var drag = null;
  var hinted = null;

  var opts = { mode: 'ai', level: 'normal', human: 'w', sound: true, banter: 'hard', timer: 'off', match: '0' };
  try {
    var prefs = JSON.parse(localStorage.getItem('nardy.opts') || 'null');
    if (prefs) { for (var k in prefs) if (opts[k] !== undefined) opts[k] = prefs[k]; }
    var sc = JSON.parse(localStorage.getItem('nardy.tally') || 'null');
    if (sc) tally = sc;
  } catch (e) { /* приватный режим — просто играем без сохранения */ }

  function save() {
    try {
      localStorage.setItem('nardy.opts', JSON.stringify(opts));
      localStorage.setItem('nardy.tally', JSON.stringify(tally));
    } catch (e) {}
  }

  /* Незаконченная партия переживает перезагрузку страницы */
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('nardy.game') || 'null'); } catch (e) {}
  if (saved && (!saved.s || saved.s.winner)) saved = null;

  function persist() {
    if (opts.mode === 'net') return;
    try {
      localStorage.setItem('nardy.game', JSON.stringify({ s: S, rows: rows }));
    } catch (e) {}
  }

  function forget() {
    saved = null;
    try { localStorage.removeItem('nardy.game'); } catch (e) {}
  }

  function isAI(p) { return opts.mode === 'ai' && p !== opts.human; }
  function nameOf(p) { return p === 'w' ? 'Белые' : 'Чёрные'; }

  /* ---------- сетевой стол ---------- */

  var net = {
    ready: null,      /* null — проверяем, false — сети нет */
    code: null,
    seat: null,
    table: null,
    unsub: null,
    unpeers: null,
    peers: [],
    shown: false,     /* итог партии уже показан */
    toss: null,
    moves: [],        /* шашки, сдвинутые за мой текущий ход, — уйдут серверу разом */
    gid: null,        /* какая партия стола сейчас на доске */
    turnKey: '',      /* чей и какой по счёту ход сейчас на доске */
    warned: ''        /* о каком ходе уже предупредили «осталось 10 секунд» */
  };
  var lobbyOff = null;
  var bf = {};              /* какие подколы за партию уже прозвучали */

  function isNet() { return opts.mode === 'net' && !!net.code; }

  /* Стол ведёт сервер: кости бросает он, ход уходит ему целиком */
  function auth() { return isNet() && NardyNet.authoritative(); }

  /* Ссылка, по которой соперник попадает сразу за стол */
  function shareLink() {
    return location.origin + location.pathname + location.search + '#stol=' + net.code;
  }

  function readInvite() {
    var p = NardyTG.startParam();
    if (p && p.length >= 4 && p.length <= 8) return p;
    var m = /[#?&]stol=([A-Za-z0-9]{4,8})/.exec(location.hash + location.search);
    return m ? m[1].toUpperCase() : null;
  }

  function forgetInvite() {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {}
  }

  /* Чей сейчас ход с точки зрения этого устройства */
  function mine() {
    if (!S || S.winner) return false;
    return isNet() ? net.seat === S.turn : !isAI(S.turn);
  }

  function canPlay() { return !busy && !!S && !S.winner && mine(); }

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function sig(st) {
    return st.points.join(',') + '|' + st.off.w + ':' + st.off.b + '|' + st.turn +
      '|' + st.dice.slice().sort().join('') + '|' + st.roll.join('') +
      '|' + st.headUsed + '|' + (st.winner || '');
  }

  /* ---------- звук ---------- */

  var actx = null;
  function ac() {
    if (!actx) {
      var A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      actx = new A();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }

  function noise(dur, freq, q, gain, delay) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + (delay || 0);
    var len = Math.max(1, Math.ceil(c.sampleRate * dur));
    var buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0), i;
    for (i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    var g = c.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t);
  }

  function tone(freq, dur, gain, delay, type) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + (delay || 0);
    var o = c.createOscillator(); o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function sfx(kind) {
    NardyTG.buzz(kind);
    if (!opts.sound) return;
    try {
      if (kind === 'move') { noise(0.05, 2400, 1.2, 0.16); tone(220, 0.07, 0.05, 0, 'square'); }
      else if (kind === 'dice') {
        noise(0.07, 1500, 0.8, 0.13, 0);
        noise(0.06, 2100, 1.0, 0.11, 0.09);
        noise(0.09, 1200, 0.7, 0.15, 0.19);
      }
      else if (kind === 'off') { tone(880, 0.16, 0.07, 0); tone(1320, 0.2, 0.05, 0.05); }
      else if (kind === 'win') {
        [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.5, 0.07, i * 0.11, 'triangle'); });
      }
      else if (kind === 'no') { tone(150, 0.16, 0.06, 0, 'sawtooth'); }
      else if (kind === 'tick') { noise(0.035, 1900, 1.4, 0.10); }
    } catch (e) {}
  }

  /* ---------- построение доски ---------- */

  function box(el, r) {
    var q = B.map(r.x, r.y, r.w, r.h);
    el.style.left = (q.x / B.vw() * 100) + '%';
    el.style.top = (q.y / B.vh() * 100) + '%';
    el.style.width = (q.w / B.vw() * 100) + '%';
    el.style.height = (q.h / B.vh() * 100) + '%';
  }

  function buildZones() {
    lZones.innerHTML = '';
    for (var i = 0; i < 24; i++) {
      var g = B.geom(i), z = document.createElement('div');
      z.className = 'zone';
      z.dataset.i = i;
      box(z, g);
      lZones.appendChild(z);
    }
    /* лотки: бросить шашку в лоток = снять её с доски */
    ['w', 'b'].forEach(function (p) {
      var e = document.createElement('div');
      e.className = 'zone tray';
      e.dataset.tray = p;
      box(e, B.trayBox(p));
      lZones.appendChild(e);
    });
  }

  function buildMen() {
    lMen.innerHTML = '';
    men = {}; tags = [];
    ['w', 'b'].forEach(function (p) {
      for (var i = 0; i < N.NC; i++) {
        var e = document.createElement('div');
        e.className = 'man ' + p;
        e.style.backgroundImage = 'url(' + B.checker(p, 176) + ')';
        e.dataset.id = p + i;
        lMen.appendChild(e);
        men[p + i] = e;
      }
    });
    for (var t = 0; t < 24; t++) {
      var tg = document.createElement('div');
      tg.className = 'tag';
      tg.style.display = 'none';
      lMen.appendChild(tg);
      tags.push(tg);
    }
  }

  /* Раскладка шашек выводится из позиции: один источник правды */
  function visFrom(st) {
    var v = { pts: [], off: { w: [], b: [] } }, i, j, c;
    for (i = 0; i < 24; i++) v.pts.push([]);
    ['w', 'b'].forEach(function (p) {
      var next = 0;
      for (i = 0; i < 24; i++) {
        c = N.cnt(st, i, p);
        for (j = 0; j < c; j++) v.pts[i].push(p + (next++));
      }
      for (j = 0; j < st.off[p]; j++) v.off[p].push(p + (next++));
    });
    return v;
  }

  /* Доска лежит горизонтально и занимает всю ширину экрана.
     Таблички игроков прижимаются к ней вплотную, а свободная высота
     уходит наружу — иначе вокруг доски зияют пустые поля. */
  function fit() {
    var tbl = document.querySelector('.table');
    var w = tbl.clientWidth;
    var h = tbl.clientHeight - $('pl-w').offsetHeight - $('pl-b').offsetHeight - 20;
    if (!w || h < 120) return;
    var ar = B.vw() / B.vh();
    if (w / h > ar) w = h * ar; else h = w / ar;
    board.style.width = Math.floor(w) + 'px';
    board.style.height = Math.floor(h) + 'px';
    stage.style.flex = 'none';
    stage.style.height = Math.floor(h) + 'px';
  }

  /* Свой цвет снизу, свой дом — в ближнем углу: как за настоящим столом */
  function setSides() {
    var my = isNet() ? net.seat : (opts.mode === 'ai' ? opts.human : 'w');
    $('pl-w').style.order = my === 'b' ? '0' : '2';
    $('pl-b').style.order = my === 'b' ? '2' : '0';
    stage.style.order = '1';
    /* доску не разворачиваем: расстановка голов фиксированная */
  }

  function scale() { return board.clientWidth / B.vw(); }

  /* из координат доски — в экранные пиксели с учётом разворота */
  function px(x, y, size, k) {
    var q = B.map(x, y, size, size);
    return { x: q.x * k, y: q.y * k };
  }

  function setT(id, x, y, extra) {
    pos[id] = { x: x, y: y };
    men[id].style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)' + (extra || '');
  }

  function place(instant) {
    var k = scale(), i, j, ids, n, p, id;
    if (!k) return;
    lMen.style.setProperty('--cd', (B.CD * k) + 'px');
    lSpots.style.setProperty('--cd', (B.CD * k) + 'px');

    if (instant) {
      lMen.style.transition = 'none';
      for (id in men) men[id].style.transition = 'none';
    }

    for (i = 0; i < 24; i++) {
      ids = VIS.pts[i]; n = ids.length;
      for (j = 0; j < n; j++) {
        p = px(B.manAt(i, j, n).x, B.manAt(i, j, n).y, B.CD, k);
        var lift = (sel === i && j === n - 1) ? ' scale(1.06)' : '';
        setT(ids[j], p.x, p.y, lift);
        men[ids[j]].style.zIndex = 1 + j;
        men[ids[j]].classList.toggle('pick', sel === i && j === n - 1);
      }
      var tg = tags[i];
      if (n > 5) {
        var top = px(B.manAt(i, n - 1, n).x, B.manAt(i, n - 1, n).y, B.CD, k);
        tg.style.display = '';
        tg.textContent = n;
        tg.style.transform = 'translate3d(' + top.x.toFixed(1) + 'px,' +
          (top.y + B.CD * k * 0.32).toFixed(1) + 'px,0)';
        tg.className = 'tag' + (VIS.pts[i][0][0] === 'b' ? ' on-dark' : '');
      } else tg.style.display = 'none';
    }

    ['w', 'b'].forEach(function (pl) {
      VIS.off[pl].forEach(function (mid, idx) {
        var t = B.trayAt(pl, idx), q = px(t.x, t.y, B.CD, k);
        setT(mid, q.x, q.y);
        men[mid].style.zIndex = 1 + idx;
      });
    });

    if (instant) {
      void lMen.offsetHeight;
      lMen.style.transition = '';
      for (id in men) men[id].style.transition = '';
    }
    renderDice(false);
    renderSpots();
    markLive();
  }

  /* Пункты, с которых сейчас есть ход */
  function markLive() {
    var live = {};
    if (!busy && mine()) {
      legal.forEach(function (m) {
        live[m.from] = 1;
        if (m.to === N.OFF) live.off = 1;
      });
    }
    for (var i = 0; i < 24; i++) lZones.children[i].classList.toggle('live', !!live[i]);
    lZones.children[24].classList.remove('live');
    lZones.children[25].classList.remove('live');
  }

  /* ---------- кости ---------- */

  var diceKey = '';
  var lastTick = 0;

  /* Кости живут на своём холсте: бросок считается физикой */
  function renderDice(animate) {
    if (!S || !S.roll.length) { diceKey = ''; NardyDice.clear(); return; }
    var vals = S.roll[0] === S.roll[1]
      ? [S.roll[0], S.roll[0], S.roll[0], S.roll[0]]
      : S.roll.slice();
    var left = S.dice.slice(), used = [];
    vals.forEach(function (v) {
      var at = left.indexOf(v);
      if (at >= 0) { left.splice(at, 1); used.push(false); } else used.push(true);
    });
    var key = S.turn + ':' + S.roll.join(',') + ':' + S.turnNo.w + ':' + S.turnNo.b;
    if (animate) {
      diceKey = key;
      NardyDice.roll(S.turn, vals, diceTick, function () { renderDice(false); });
      return;
    }
    if (NardyDice.rolling()) return;
    if (key !== diceKey) { diceKey = key; NardyDice.place(S.turn, vals); }
    NardyDice.show(used);
  }

  /* стук кости о доску — но не чаще, чем ухо разбирает.
     Имя не tick: так называется счётчик отложенных действий. */
  function diceTick() {
    var now = Date.now();
    if (now - lastTick < 55) return;
    lastTick = now;
    sfx('tick');
  }

  /* жеребьёвка: по кости каждому, летят с обеих сторон */
  function renderOpeningDice(a, b) {
    diceKey = 'toss';
    NardyDice.roll('w', [a, b], diceTick, null, { sides: ['w', 'b'], wide: true });
  }

  /* ---------- метки возможных ходов ---------- */

  /* Куда дойдёт выбранная шашка: {пункт: цепочка ходов}.
     При 6-4 сюда попадают и +6, и +4, и +10 одним махом. */
  var reach = {};

  function destFor(i) {
    return legal.filter(function (m) { return m.from === i; });
  }

  /* Ходы не подсвечиваем — игроки опытные, сами видят */
  function renderSpots() {
    if (lSpots.firstChild) lSpots.innerHTML = '';
  }

  /* ---------- панели ---------- */

  /* Реплика комментатора. side: 'me' — событие у того, кто смотрит */
  function sideOf(p) {
    var who = isNet() ? net.seat : (opts.mode === 'ai' ? opts.human : null);
    return (who && p === who) ? 'me' : 'foe';
  }

  function quip(event, who, force) {
    var text = NardyBanter.line(opts.banter, event, sideOf(who), force);
    if (!text) return;
    var q = $('quip');
    q.textContent = text;
    q.classList.add('show');
    clearTimeout(quip._t);
    quip._t = setTimeout(function () { q.classList.remove('show'); }, 2600);
  }

  function hushQuip() {
    $('quip').classList.remove('show');
    clearTimeout(quip._t);
  }

  function toast(text, ms) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, ms || 1900);
  }

  /* Чей цвет «мой» на этом экране: он снизу, его счёт — первым */
  function myColor() { return isNet() ? net.seat : (opts.mode === 'ai' ? opts.human : null); }

  function updateUI() {
    if (!S) return;
    var me = myColor(), a = me || 'w', z = N.opp(a);
    $('tally-a').textContent = tally[a];
    $('tally-z').textContent = tally[z];
    var to = auth() && net.table && net.table.opts ? net.table.opts.to : 0;
    $('score-sub').textContent = to ? 'до ' + to : 'счёт';
    ['w', 'b'].forEach(function (p) {
      var who = plate(p);
      $('name-' + p).textContent = who.name;
      $('meta-' + p).textContent = who.meta;
      $('pl-' + p).classList.toggle('act', !S.winner && S.turn === p);
    });
    paintClock();
    var my = canPlay();
    $('act-undo').disabled = !(my && undoStack.length);
    setSides();
    setAvatars();
    $('act-sound').setAttribute('aria-pressed', String(opts.sound));
    $('act-sound').textContent = opts.sound ? '♪' : '✕';
    $('act-sound').title = opts.sound ? 'Выключить звук' : 'Включить звук';
  }

  /* Что написано на табличке игрока: имя крупно, под ним цвет и состояние */
  function plate(p) {
    var color = p === 'w' ? 'белые' : 'чёрные';
    if (isNet()) {
      var seat = net.table && net.table.seats ? net.table.seats[p] : null;
      if (!seat) return { name: 'Место свободно', meta: color + ' · ждём соперника' };
      if (seat.id === NardyNet.id()) return { name: seat.name || 'Вы', meta: color + ' · вы' };
      var tag = NardyNet.hasRoom() ? (oppOnline(p) ? ' · в сети' : ' · не в сети') : '';
      return { name: seat.name || 'Соперник', meta: color + tag };
    }
    if (isAI(p)) {
      var lvl = { easy: 'новичок', normal: 'опытный', hard: 'мастер' }[opts.level];
      return { name: 'Компьютер', meta: color + ' · ' + lvl };
    }
    if (opts.mode === 'ai') {
      var u = NardyAccount.user();
      return { name: (u && u.name) || NardyNet.name() || 'Вы', meta: color };
    }
    return { name: p === 'w' ? 'Белые' : 'Чёрные', meta: 'игрок' };
  }

  /* Часы хода: «ходит · 0:42» и кольцо вокруг аватарки того, чей ход */
  var RING = 2 * Math.PI * 24;
  function paintClock() {
    var ms = clockLeft(), full = NardyTable.LIMITS.move;
    ['w', 'b'].forEach(function (p) {
      var on = ms >= 0 && S && !S.winner && S.turn === p;
      $('pl-' + p).classList.toggle('clocked', on);
      $('pl-' + p).classList.toggle('hurry', on && ms <= 10000);
      $('turn-' + p).textContent = on ? 'ходит · ' + clockText(ms) : 'ходит';
      if (on) {
        var frac = Math.max(0, Math.min(1, ms / full));
        $('ring-' + p).style.strokeDasharray = (frac * RING).toFixed(1) + ' ' + RING.toFixed(1);
      }
    });
  }

  /* Аватарка: фото из Telegram у людей, резная шашка у компьютера */
  function setAvatars() {
    ['w', 'b'].forEach(function (p) {
      var box = $('ava-' + p);
      if (!box) return;
      var url = '';
      if (isNet()) {
        var seat = net.table && net.table.seats ? net.table.seats[p] : null;
        url = seat && seat.photo ? seat.photo : '';
      } else if (!isAI(p) && (opts.mode !== 'ai' || p === opts.human)) {
        url = NardyTG.photo();
      }
      if (box.dataset.url === url) return;
      box.dataset.url = url;
      box.innerHTML = url
        ? '<img alt="" src="' + esc(url) + '" onerror="this.remove()">'
        : '<span class="disc ' + p + '"></span>';
      var d = box.querySelector('.disc');
      if (d) d.style.backgroundImage = 'url(' + B.checker(p, 96) + ')';
    });
  }

  function renderLog() {
    var ol = $('log');
    if (!ol) return;                 /* журнал убран с экрана */
    ol.innerHTML = '';
    rows.slice(-40).forEach(function (r) {
      var li = document.createElement('li');
      li.className = r.p;
      li.innerHTML = '<b>' + nameOf(r.p) + ' ' + r.roll.join('-') + '</b><span>' +
        (r.moves.length ? r.moves.join(' ') : (r === rows[rows.length - 1] ? '…' : 'пропуск')) + '</span>';
      ol.appendChild(li);
    });
  }

  /* ---------- ход ---------- */

  /* Пока тикает таймер, состояние может смениться (пришёл ход соперника).
     Такой отложенный вызов нужно отменить, иначе он сработает не по той партии. */
  var tick = 0;

  function later(ms, fn) {
    var at = tick;
    setTimeout(function () { if (at === tick) fn(); }, ms);
  }

  function snapshot() {
    return {
      st: N.clone(S),
      vis: {
        pts: VIS.pts.map(function (a) { return a.slice(); }),
        off: { w: VIS.off.w.slice(), b: VIS.off.b.slice() }
      },
      moves: rows.length ? rows[rows.length - 1].moves.length : 0,
      sent: net.moves.length
    };
  }

  function doMove(mv) { doChain([mv]); }

  /* Одна шашка за один жест — даже если это сумма костей: при 6-2
     на 8 правила проверяют каждый шаг, а глазу видно одно движение,
     прямо на 8, без заезда на промежуточный пункт. И отменяется
     такой ход тоже целиком. */
  function doChain(path) {
    tick++;
    undoStack.push(snapshot());
    var p = S.turn, last = path[path.length - 1];
    var id = VIS.pts[path[0].from].pop();
    if (last.to === N.OFF) VIS.off[p].push(id); else VIS.pts[last.to].push(id);
    path.forEach(function (mv) {
      N.applyTo(S, mv);
      if (auth() && p === net.seat) net.moves.push({ from: mv.from, to: mv.to, die: mv.die });
    });
    if (rows.length) {
      rows[rows.length - 1].moves.push(N.label(p, path[0].from) + '/' + N.label(p, last.to));
    }
    sel = null;
    clearHint();
    place(false);
    men[id].classList.remove('land');
    void men[id].offsetWidth;
    men[id].classList.add('land');
    sfx(last.to === N.OFF ? 'off' : 'move');
    if (last.to === N.OFF) quip('off', p);
    renderLog();
    updateUI();
    persist();
    /* По сети отдельные шашки не шлём: сопернику уходит весь ход разом,
       при передаче хода. */
  }

  function undo() {
    if (!undoStack.length) return;
    quip('undo', S.turn);
    var s = undoStack.pop();
    S = s.st;
    VIS = s.vis;
    net.moves.length = s.sent;
    if (rows.length) rows[rows.length - 1].moves.length = s.moves;
    sel = null;
    legal = N.legalMoves(S);
    place(false);
    renderLog();
    updateUI();
  }

  function afterMove() {
    if (S.winner) { auth() ? sendTurn() : finish(); return; }
    legal = N.legalMoves(S);
    if (!legal.length) {
      if (S.dice.length && !isAI(S.turn)) toast('Больше ходить нечем');
      later(850, passTurn);
      return;
    }
    if (!isAI(S.turn)) { busy = false; renderSpots(); }
    markLive();
    updateUI();
  }

  function passTurn() {
    if (auth()) { sendTurn(); return; }
    if (S.winner) { finish(); return; }
    N.endTurn(S);
    if (isNet()) { busy = true; legal = []; markLive(); updateUI(); pushTable(); return; }
    beginTurn();
  }

  function beginTurn() {
    sel = null;
    undoStack = [];
    clearHint();
    busy = true;
    misses = 0;
    tick++;
    var d1 = N.rollDie(), d2 = N.rollDie();
    N.setRoll(S, d1, d2);
    rows.push({ p: S.turn, roll: [d1, d2], moves: [] });
    renderDice(true);
    renderLog();
    sfx('dice');
    legal = N.legalMoves(S);
    updateUI();
    persist();
    pushTable();
    banter(d1, d2);
    if (!legal.length) {
      toast(nameOf(S.turn) + ': ходов нет');
      sfx('no');
      quip('stuck', S.turn, true);
      later(1500, passTurn);
      return;
    }
    if (isAI(S.turn)) later(700, aiTurn);
    else { busy = false; markLive(); updateUI(); }
  }

  /* На каждый бросок — своя реплика. Редкое событие важнее обычного броска */
  function banter(d1, d2) {
    var p = S.turn, ev;
    if (!S.turnNo.w && !S.turnNo.b) ev = 'start';
    else if (!bf['home' + p] && N.allHome(S, p) && S.off[p] < 12) { bf['home' + p] = 1; ev = 'home'; }
    else if (!bf['almost' + p] && S.off[p] >= 12) { bf['almost' + p] = 1; ev = 'almost'; }
    else if (d1 === d2 && d1 === 6) ev = 'six';
    else if (d1 === d2) ev = 'double';
    else if (d1 + d2 === 3) ev = 'worst';
    else if (!bf.slow && S.turnNo.w + S.turnNo.b >= 90) { bf.slow = 1; ev = 'slow'; }
    else if (!bf.head && S.turnNo[p] >= 8 && N.cnt(S, N.HEAD[p], p) >= 10 &&
             sideOf(p) === 'me') { bf.head = 1; ev = 'head'; }
    else ev = 'roll';
    quip(ev, p, true);
  }

  function aiTurn() {
    var path = AI.choose(S, opts.level);
    if (!path.length) { passTurn(); return; }
    (function step(i) {
      if (i >= path.length || S.winner) { afterMove(); return; }
      doMove(path[i]);
      later(500, function () { step(i + 1); });
    })(0);
  }

  /* ---------- выбор шашки ---------- */

  function pick(i) {
    sel = i;
    reach = N.chains(S, i);
    place(false);
    markLive();
  }

  function clearSel() {
    if (sel === null) return;
    sel = null;
    reach = {};
    place(false);
    markLive();
  }

  function clearHint() {
    if (hinted && men[hinted]) men[hinted].classList.remove('hint');
    hinted = null;
  }

  function tryMoveTo(to) {
    var path = reach[to];
    if (!path || !path.length) return false;
    busy = true;
    reach = {};
    doChain(path);
    later(260, afterMove);
    return true;
  }

  function canPick(i) {
    return legal.some(function (m) { return m.from === i; });
  }

  /* ---------- указатель: клик и перетаскивание ---------- */

  /* Промах: щелчок и отдача, а на каждый третий за ход — фраза */
  var misses = 0;

  function miss() {
    sfx('no');
    misses++;
    if (misses % 3 === 0) quip('miss', S.turn, true);
  }

  function onDown(e) {
    if (!canPlay()) return;
    var z = e.target.closest ? e.target.closest('.zone') : null;
    if (!z) { clearSel(); return; }
    if (z.dataset.tray) {
      if (z.dataset.tray === S.turn && sel !== null) tryMoveTo(N.OFF);
      return;
    }
    var i = +z.dataset.i;
    if (sel !== null && sel !== i) {
      if (tryMoveTo(i)) return;
      if (N.cnt(S, i, S.turn) === 0) { miss(); clearSel(); return; }
    }
    if (!canPick(i)) {
      miss();
      clearSel();
      return;
    }
    if (sel !== i) pick(i);          /* по своей же шашке — сразу тащим */
    var ids = VIS.pts[i];
    var id = ids[ids.length - 1];
    drag = { id: id, from: i, x0: e.clientX, y0: e.clientY, moved: false };
    try { lZones.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function onMove(e) {
    if (!drag) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 7) return;
    drag.moved = true;
    var el = men[drag.id], p = pos[drag.id];
    el.style.transition = 'none';
    el.style.zIndex = 30;
    el.classList.add('carry');
    el.style.transform = 'translate3d(' + (p.x + dx) + 'px,' + (p.y + dy - B.CD * scale() * 0.18) +
      'px,0) scale(1.16)';
  }

  /* Куда упала шашка. Палец редко попадает точно, поэтому если промах —
     берём ближайший доступный пункт в пределах полутора шашек. */
  function dropTarget(cx, cy) {
    var el = document.elementFromPoint(cx, cy);
    var z = el && el.closest ? el.closest('.zone') : null;
    if (z) {
      if (z.dataset.tray) {
        if (z.dataset.tray === S.turn && reach[N.OFF]) return N.OFF;
      } else if (reach[+z.dataset.i]) return +z.dataset.i;
    }
    var r = board.getBoundingClientRect(), k = r.width / B.vw();
    var bx = (cx - r.left) / k, by = (cy - r.top) / k;
    var best = null, bd = 1e9;
    Object.keys(reach).forEach(function (key) {
      var to = +key, p, n;
      if (to === N.OFF) p = B.trayAt(S.turn, VIS.off[S.turn].length);
      else { n = VIS.pts[to].length + 1; p = B.manAt(to, n - 1, n); }
      var q = B.map(p.x, p.y, B.CD, B.CD);
      var ddx = bx - (q.x + B.CD / 2), ddy = by - (q.y + B.CD / 2);
      var dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dist < bd) { bd = dist; best = to; }
    });
    return (best !== null && bd < B.CD * 1.7) ? best : null;
  }

  function onCancel() {
    if (!drag) return;
    var el = men[drag.id];
    el.style.transition = '';
    el.classList.remove('carry');
    drag = null;
    place(false);
  }

  function onUp(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    try { lZones.releasePointerCapture(e.pointerId); } catch (err) {}
    var el = men[d.id];
    el.style.transition = '';
    el.classList.remove('carry');
    if (!d.moved) { place(false); return; }      /* просто нажали — шашка выбрана */
    var to = dropTarget(e.clientX, e.clientY);
    if (to === null || !tryMoveTo(to)) {
      miss();
      place(false);
    }
  }


  /* ---------- игра по сети ---------- */

  function oppOnline(p) {
    var t = net.table;
    if (t && t.seen) return !!t.seen[p] && t.now - t.seen[p] < 45000;
    for (var i = 0; i < net.peers.length; i++) {
      var pr = net.peers[i].presence;
      if (pr && pr.table === net.code && pr.seat === p && !net.peers[i].isMe) return true;
    }
    return false;
  }

  /* Полное тело документа стола */
  function tableBody(extra) {
    var t = net.table || {};
    var b = {
      v: 1,
      seq: (t.seq || 0) + 1,      /* растущий номер: отсеиваем отставшие копии */
      code: net.code,
      status: 'live',
      createdAt: t.createdAt || Date.now(),
      updatedAt: Date.now(),
      seats: t.seats || { w: null, b: null },
      state: S,
      tally: tally,
      toss: t.toss || null,
      gid: t.gid || null,            /* номер партии для сервера */
      offer: t.offer || null,        /* предложение переиграть */
      declined: t.declined || 0
    };
    if (extra) for (var k in extra) b[k] = extra[k];
    return b;
  }

  NardyNet.onLost = function () { if (isNet()) toast('Нет связи — ход уйдёт, как только появится', 3000); };
  NardyNet.onBack = function () { if (isNet()) toast('Связь есть, ход ушёл'); };

  function pushTable(extra) {
    if (!isNet()) return;
    net.table = tableBody(extra);
    NardyNet.write(net.table).then(null, function () {
      toast('Ход не ушёл — проверьте связь');
    });
  }

  /* Двигаем к новой позиции те шашки, которые действительно сдвинулись,
     иначе анимация превратилась бы в телепортацию всей доски. */
  function reconcile() {
    ['w', 'b'].forEach(function (p) {
      var pool = [], take = [], give = [], i, j, k, arr, have, need;
      for (i = 0; i < 24; i++) {
        arr = VIS.pts[i];
        have = 0;
        for (j = 0; j < arr.length; j++) if (arr[j].charAt(0) === p) have++;
        need = N.cnt(S, i, p);
        if (have > need) take.push([i, have - need]);
        else if (need > have) give.push([i, need - have]);
      }
      take.sort(function (a, b) { return N.rel(p, a[0]) - N.rel(p, b[0]); });
      give.sort(function (a, b) { return N.rel(p, a[0]) - N.rel(p, b[0]); });
      take.forEach(function (t) {
        arr = VIS.pts[t[0]];
        for (k = 0; k < t[1]; k++) {
          for (j = arr.length - 1; j >= 0; j--) {
            if (arr[j].charAt(0) === p) { pool.push(arr.splice(j, 1)[0]); break; }
          }
        }
      });
      while (VIS.off[p].length > S.off[p]) pool.push(VIS.off[p].pop());
      give.forEach(function (g) {
        for (k = 0; k < g[1] && pool.length; k++) VIS.pts[g[0]].push(pool.shift());
      });
      while (VIS.off[p].length < S.off[p] && pool.length) VIS.off[p].push(pool.shift());
    });
    if (!visOk()) VIS = visFrom(S);
    place(false);
  }

  function visOk() {
    var i, j, arr, w, b;
    for (i = 0; i < 24; i++) {
      arr = VIS.pts[i]; w = 0; b = 0;
      for (j = 0; j < arr.length; j++) arr[j].charAt(0) === 'w' ? w++ : b++;
      if (w && b) return false;
      if (w !== N.cnt(S, i, 'w') || b !== N.cnt(S, i, 'b')) return false;
    }
    return VIS.off.w.length === S.off.w && VIS.off.b.length === S.off.b;
  }

  /* ---------- стол, который ведёт сервер ---------- */

  function turnKey(t) {
    var st = t.state;
    return t.gid + '|' + st.turn + '|' + st.turnNo.w + '|' + st.turnNo.b + '|' + (st.winner || '');
  }

  /* Ход готов — отдаём серверу все шашки разом. Ответ — новый стол
     с костями соперника; по нему доска и выравнивается. */
  function sendTurn() {
    busy = true;
    legal = [];
    sel = null;
    markLive();
    updateUI();
    var t = net.table;
    NardyNet.turn(t.game, S.turnNo[net.seat], net.moves.slice()).then(function (d) {
      if (!d || !d.table) return;
      /* сервер ход не принял — ставим его позицию, иначе доски разойдутся */
      var bad = d.error && d.error !== 'stale';
      if (bad) toast('Ход не прошёл проверку — позиция восстановлена');
      syncAuth(d.table, bad || d.error === 'stale');
    });
  }

  function syncAuth(t, force) {
    if (!t) {
      toast('Стол закрыт');
      quitTable(true);
      return;
    }
    var old = net.table;
    if (old && t.seq < old.seq) return;                  /* пришла старая копия */
    var newer = !old || t.seq > old.seq || !S || force;
    net.table = t;
    if (t.tally) tally = t.tally;
    if (t.status === 'open') {
      updateUI();
      if (sheet.dataset.kind === 'table' && veil.classList.contains('show')) tableSheet();
      return;
    }
    /* соперник только что сел — окно со столом больше не нужно */
    if ((!old || old.status === 'open') && sheet.dataset.kind === 'table' && veil.classList.contains('show')) {
      closeSheet();
      var opp = t.seats[N.opp(net.seat)];
      toast((opp && opp.name ? opp.name : 'Соперник') + ' за столом — начинаем');
    }
    if (!newer) { updateUI(); return; }                   /* только «в сети» и часы */

    offers(t);
    var st = t.state, key = turnKey(t), fresh = t.gid !== net.gid;
    /* свой ход в разгаре: мои сдвинутые шашки не трогаем */
    if (!force && S && !fresh && key === net.turnKey && st.turn === net.seat && !st.winner) {
      updateUI();
      return;
    }

    tick++;
    if (drag) onCancel();                     /* шашка в пальцах — отпускаем, позиция сменилась */
    var rolled = fresh || key !== net.turnKey;
    net.turnKey = key;
    if (fresh) {
      net.gid = t.gid;
      net.shown = false;
      bf = {}; recorded = false; NardyBanter.reset();
      if (sheet.dataset.kind === 'result' && veil.classList.contains('show')) closeSheet();
    }
    S = st;
    if (!VIS) VIS = visFrom(S);
    reconcile();
    sel = null;
    undoStack = [];
    net.moves = [];

    if (rolled && t.last && t.last.auto && !fresh) {
      toast(t.last.by === net.seat
        ? 'Время вышло — за вас сходил компьютер. Просрочка ' + t.late[net.seat] + ' из 3'
        : ((t.seats[t.last.by] || {}).name || 'Соперник') + ' не успел — за него сходил компьютер', 2600);
    }
    if (S.winner) {
      busy = true;
      legal = [];
      renderDice(false);
      markLive();
      updateUI();
      if (!net.shown) finish(false);
      return;
    }
    if (fresh && t.toss && !S.turnNo.w && !S.turnNo.b) {
      /* сначала жеребьёвка по кости с каждой стороны, потом первый бросок */
      busy = true;
      legal = [];
      markLive();
      updateUI();
      NardyDice.clear();
      renderOpeningDice(t.toss.a, t.toss.b);
      sfx('dice');
      toast('Жеребьёвка: ' + t.toss.a + ' — ' + t.toss.b + '. Первыми ходят ' +
        (S.turn === 'w' ? 'белые' : 'чёрные'), 1600);
      later(1700, function () { startTurn(true); });
      return;
    }
    startTurn(rolled);
  }

  /* Начало хода: кости уже брошены сервером, осталось показать */
  function startTurn(rolled) {
    renderDice(rolled);
    if (rolled) { sfx('dice'); banter(S.roll[0], S.roll[1]); }
    if (net.seat !== S.turn) {
      busy = true;
      legal = [];
      markLive();
      updateUI();
      return;
    }
    misses = 0;
    legal = N.legalMoves(S);
    if (!legal.length) {
      busy = true;
      toast('Ходов нет');
      if (rolled) quip('stuck', S.turn, true);
      markLive();
      updateUI();
      later(1500, passTurn);
      return;
    }
    busy = false;
    markLive();
    updateUI();
  }

  /* предложение переиграть: сопернику — вопрос, себе — ответ */
  function offers(t) {
    if (t.offer && t.offer.by !== net.seat && net.seenOffer !== t.offer.ts) {
      net.seenOffer = t.offer.ts;
      offerSheet(t);
    }
    if (net.mineOffer && t.declined && t.declined !== net.seenDecline) {
      net.seenDecline = t.declined;
      net.mineOffer = 0;
      toast('Соперник хочет доиграть');
    }
    if (net.mineOffer && !t.offer) net.mineOffer = 0;
    if (sheet.dataset.kind === 'offer' && !t.offer && veil.classList.contains('show')) closeSheet();
  }

  /* Сколько осталось на ход — по часам сервера */
  function clockLeft() {
    var t = net.table;
    if (!auth() || !t || !t.deadline || !S || S.winner) return -1;
    return Math.max(0, t.deadline - NardyNet.now());
  }

  function clockText(ms) {
    var s = Math.ceil(Math.min(ms, 60000) / 1000);     /* пока идёт жеребьёвка, часы стоят на минуте */
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  setInterval(function () {
    var ms = clockLeft();
    if (ms < 0) return;
    paintClock();
    if (S.turn === net.seat && ms <= 10000 && ms > 0 && net.warned !== net.turnKey) {
      net.warned = net.turnKey;
      NardyTG.buzz('lose');
      toast('Осталось 10 секунд');
    }
  }, 500);

  /* Единственный источник правды в сетевой партии — документ стола */
  function syncFrom(t, force) {
    if (NardyNet.authoritative()) { syncAuth(t, force); return; }
    if (!t) {
      toast('Стол закрыт');
      quitTable(true);
      return;
    }
    if (net.table && (t.seq || 0) < (net.table.seq || 0)) return;   /* пришла старая копия */
    var was = net.table ? net.table.status : 'open';
    net.table = t;
    if (t.status === 'open') {
      updateUI();
      if (sheet.dataset.kind === 'table' && veil.classList.contains('show')) tableSheet();
      return;
    }
    if (was === 'open' && sheet.dataset.kind === 'table' && veil.classList.contains('show')) {
      closeSheet();
      var opp = t.seats[N.opp(net.seat)];
      toast((opp && opp.name ? esc(opp.name) : 'Соперник') + ' за столом — начинаем');
    }
    var st = t.state;
    if (!st || !st.points) return;
    var fresh = !S || sig(st) !== sig(S);
    if (fresh) {
      tick++;                       /* всё отложенное по старой позиции отменяем */
      var rolled = !S || S.roll.join() !== st.roll.join() || S.turn !== st.turn;
      S = st;
      rows = t.rows || [];
      if (!VIS) VIS = visFrom(S);
      reconcile();
      renderDice(rolled);
      renderLog();
      sel = null;
      undoStack = [];
    }
    if (t.tally) tally = t.tally;

    /* предложение переиграть: сопернику — вопрос, себе — ответ */
    if (t.offer && t.offer.by !== net.seat && net.seenOffer !== t.offer.ts) {
      net.seenOffer = t.offer.ts;
      offerSheet(t);
    }
    if (net.mineOffer && t.declined && t.declined !== net.seenDecline) {
      net.seenDecline = t.declined;
      net.mineOffer = 0;
      toast('Соперник хочет доиграть');
    }
    if (net.mineOffer && !t.offer) net.mineOffer = 0;
    if (sheet.dataset.kind === 'offer' && !t.offer && veil.classList.contains('show')) {
      closeSheet();
    }
    /* соперник начал новую партию — убираем со своего экрана итог прошлой */
    if (fresh && !st.winner && sheet.dataset.kind === 'result' && veil.classList.contains('show')) {
      closeSheet();
    }
    if (t.toss && net.toss !== t.toss.n && !st.turnNo.w && !st.turnNo.b) {
      net.toss = t.toss.n;
      toast('Жеребьёвка: ' + t.toss.a + ' — ' + t.toss.b + '. Первыми ходят ' +
        (st.turn === 'w' ? 'белые' : 'чёрные'), 1800);
    }
    updateUI();
    if (S.winner) {
      if (!net.shown) finish(false);
      return;
    }
    if (!fresh) return;
    if (net.seat === S.turn) {
      if (!S.dice.length) { beginTurn(); return; }
      legal = N.legalMoves(S);
      if (!legal.length) { busy = true; later(900, passTurn); return; }
      busy = false;
      markLive();
      updateUI();
    } else {
      busy = true;
      legal = [];
      markLive();
      updateUI();
    }
  }

  function toss() {
    var a, b;
    do { a = N.rollDie(); b = N.rollDie(); } while (a === b);
    return { a: a, b: b, n: Date.now(), turn: a > b ? 'w' : 'b' };
  }

  function openTable(code) {
    if (net.unsub) net.unsub();
    if (net.unpeers) net.unpeers();
    net.code = code;
    net.shown = false;
    opts.mode = 'net';
    try { localStorage.setItem('nardy.net', JSON.stringify({ code: code, seat: net.seat })); } catch (e) {}
    buildMen();
    place(true);
    updateUI();
    net.unsub = NardyNet.watchTable(code, syncFrom, function () {
      toast('Связь со столом потеряна');
    });
    NardyNet.here(code, net.seat);
    net.unpeers = NardyNet.watchPeers(function (peers) {
      net.peers = peers;
      updateUI();
    });
  }

  /* Садимся за стол, который ведёт сервер: и свой новый, и чужой */
  function seatedAuth(r) {
    net.seat = r.seat;
    net.table = null;
    net.gid = null;
    net.turnKey = '';
    S = null;
    rows = [];
    tally = r.table.tally || { w: 0, b: 0 };
    VIS = visFrom(r.table.state);
    closeSheet();
    openTable(r.code);
    syncAuth(r.table);
  }

  function createTable() {
    var seat = opts.human === 'b' ? 'b' : 'w';
    if (NardyNet.authoritative()) {
      NardyNet.create({
        seat: seat,
        who: { name: NardyNet.name() || 'Игрок', photo: NardyTG.photo() },
        opts: { timer: opts.timer === 'on', to: Number(opts.match) || 0 }
      }).then(function (r) {
        if (!r.ok) { toast('Не удалось создать стол'); return; }
        seatedAuth(r);
        tableSheet();
      }, function () { toast('Сервер не отвечает — стол не создан'); });
      return;
    }
    var seats = { w: null, b: null };
    seats[seat] = { id: NardyNet.id(), name: NardyNet.name() || 'Игрок', photo: NardyTG.photo() };
    var fresh = N.create();
    net.seat = seat;
    net.table = null;
    S = null;
    rows = [];
    VIS = visFrom(fresh);
    var body = {
      v: 1, seq: 1, status: 'open', createdAt: Date.now(), updatedAt: Date.now(),
      seats: seats, state: fresh, rows: [], tally: { w: 0, b: 0 }, toss: null
    };
    NardyNet.create(body).then(function (code) {
      tally = { w: 0, b: 0 };
      net.table = body;        /* что опубликовали, то и знаем — эха не ждём */
      openTable(code);
      tableSheet();
    }, function () { toast('Не удалось создать стол'); });
  }

  function sitDown(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4 || code.length > 8) { toast('Код стола — шесть знаков'); return; }
    NardyNet.sit(code, null, { name: NardyNet.name() || 'Игрок', photo: NardyTG.photo() }, function (t) {
      var st = t.state;
      if (!t.toss && !st.roll.length && !st.turnNo.w && !st.turnNo.b) {
        var x = toss();
        st.turn = x.turn;
        t.toss = x;
        t.gid = code + '-' + Date.now();
      }
    }).then(function (r) {
      if (!r.ok) {
        toast({
          busy: 'За стол как раз садится другой — попробуйте ещё раз',
          gone: 'Такого стола нет',
          full: 'За столом уже двое',
          taken: 'Это место занято'
        }[r.why] || 'Не вышло сесть за стол');
        return;
      }
      if (NardyNet.authoritative()) { seatedAuth(r); return; }
      net.seat = r.seat;
      net.table = r.table;
      S = null;
      rows = [];
      VIS = visFrom(r.table.state);
      closeSheet();
      openTable(code);
      syncFrom(r.table);
    }, function () { toast('Не удалось сесть за стол'); });
  }

  /* Итог партии — в личную историю. Игры вдвоём за одним экраном
     не записываем: там оба игрока свои, счёт для профиля бессмыслен. */
  var recorded = false;

  function keepScore(winner, mars) {
    if (recorded) return;
    recorded = true;
    var foe = null, mine;
    if (isNet()) {
      var seat = net.table && net.table.seats ? net.table.seats[N.opp(net.seat)] : null;
      if (!seat) return;
      foe = { id: seat.id, name: seat.name, kind: 'net' };
      mine = net.seat;
    } else if (opts.mode === 'ai') {
      var lvl = { easy: 'Новичок', normal: 'Опытный', hard: 'Мастер' }[opts.level];
      foe = { id: opts.level, name: 'Компьютер · ' + lvl, kind: 'ai' };
      mine = opts.human;
    } else return;
    /* в общий профиль партию по сети записывает сервер — сам, без нас */
    NardyStats.record(foe, winner === mine, mars);
  }

  function loginSheet() {
    sheetKind = 'login';
    var tgName = NardyTG.userName(), photo = NardyTG.photo();
    var real = NardyTG.on && !!NardyTG.initData() && NardyAccount.hasServer();
    openSheet(
      '<h1>Длинные нарды</h1>' +
      (real
        ? '<p class="lede">Вход через Telegram. Профиль, счёт и братишки будут общими на всех ваших устройствах.</p>' +
          '<div class="field"><ul class="tables"><li>' +
          (photo ? '<span class="ava"><img alt="" src="' + esc(photo) + '"></span>' : '') +
          '<span><b>' + esc(tgName || 'Игрок') + '</b></span></li></ul></div>' +
          '<div class="sheet-actions"><button class="btn btn-key" type="button" data-act="login">' +
          'Войти' + (tgName ? ' как ' + esc(tgName) : '') + '</button></div>'
        : '<p class="lede">' +
          (NardyAccount.hasServer()
            ? 'Полный вход работает только внутри Telegram. Здесь играем гостем: '
            : 'Играем гостем: ') +
          'имя увидит соперник, статистика останется на этом устройстве.</p>' +
          '<div class="field"><label>Как вас зовут</label>' +
          '<input class="inp" id="login-name" maxlength="18" placeholder="Игрок" value="' +
          esc(NardyNet.name() || tgName) + '"></div>' +
          '<div class="sheet-actions"><button class="btn btn-key" type="button" data-act="login">' +
          'Играть</button></div>')
    );
  }

  function doLogin() {
    var f = $('login-name');
    var name = f ? f.value.trim() : '';
    NardyAccount.login(name).then(function (u) {
      NardyNet.rename(u.name);
      if (u.guest && u.why) toast('Вошли гостем: ' + u.why, 2600);
      setupSheet();
    });
  }

  function topSheet() {
    sheetKind = 'top';
    openSheet('<h1>Рейтинг</h1><p class="lede">Загружаем…</p>');
    NardyAccount.top().then(function (d) {
      var mine = NardyAccount.user();
      openSheet(
        '<h1>Рейтинг</h1>' +
        '<p class="lede">По числу побед.</p>' +
        '<div class="field"><ul class="tables">' +
        (d.top.length ? d.top.map(function (u, i) {
          return '<li><b class="mono">' + (i + 1) + '</b><span>' + esc(u.name) +
            (mine && u.id === mine.id ? ' <em class="bro">вы</em>' : '') + '</span>' +
            '<span class="dim">' + u.w + ':' + u.l + '</span></li>';
        }).join('') : '<li class="muted">Пока пусто</li>') +
        '</ul></div>' +
        '<div class="sheet-actions">' +
        '<button class="btn" type="button" data-act="profile">Профиль</button>' +
        '<button class="btn btn-key" type="button" data-act="close">Закрыть</button></div>'
      );
    }, function () {
      openSheet('<h1>Рейтинг</h1><p class="lede">Сервер не отвечает.</p>' +
        '<div class="sheet-actions"><button class="btn btn-key" type="button" data-act="close">Закрыть</button></div>');
    });
  }

  function profileSheet() {
    var u = NardyAccount.user();
    sheetKind = 'profile';
    if (NardyAccount.hasServer() && u && !u.guest) {
      openSheet('<h1>' + esc(u.name) + '</h1><p class="lede">Загружаем…</p>');
      NardyAccount.profile().then(function (d) { drawProfile(d.user); },
                                 function () { drawProfile(null); });
      return;
    }
    drawProfile(null);
  }

  /* Профиль показываем с сервера, если он есть; иначе своё, с устройства */
  function drawProfile(srv) {
    var u = NardyAccount.user() || {};
    var name = (srv && srv.name) || u.name || NardyNet.name() || 'Игрок';
    var t, rows, bros;
    if (srv) {
      t = { w: srv.w, l: srv.l, mars: srv.mars, marsLost: srv.marsLost };
      rows = srv.foes;
      bros = {};
      (srv.bros || []).forEach(function (id) { bros[id] = true; });
    } else {
      var st = NardyStats.summary();
      t = st.total;
      rows = st.foes.filter(function (f) { return f.games > 0; }).slice(0, 10);
      bros = st.bros;
    }
    sheetKind = 'profile';
    openSheet(
      '<h1>' + esc(name) + '</h1>' +
      '<p class="lede">' + (srv
        ? 'Общий профиль: считается на сервере, партия засчитывается, когда её подтвердят оба.'
        : 'Считается на этом устройстве.') + '</p>' +
      '<div class="field"><label>Всего</label>' +
      '<ul class="tables"><li><b class="mono">' + t.w + ' : ' + t.l + '</b>' +
      '<span>' + (t.w + t.l) + ' партий' +
      (t.mars ? ' · марсов ' + t.mars : '') +
      (t.marsLost ? ' · сам ловил ' + t.marsLost : '') + '</span></li></ul></div>' +
      '<div class="field"><label>С кем играл</label><ul class="tables">' +
      (rows && rows.length ? rows.map(function (f) {
        return '<li><b class="mono">' + f.w + ':' + f.l + '</b><span>' + esc(f.name) +
          (bros[f.id] ? ' <em class="bro">братишка</em>' : '') + '</span>' +
          '<span class="dim">' + (f.games || f.w + f.l) + '</span></li>';
      }).join('') : '<li class="muted">Пока никого. Сыграйте партию.</li>') +
      '</ul></div>' +
      '<div class="sheet-actions">' +
      (NardyAccount.hasServer()
        ? '<button class="btn" type="button" data-act="top">Рейтинг</button>' +
          '<button class="btn" type="button" data-act="logout">Выйти</button>'
        : '<button class="btn" type="button" data-act="stats-reset">Обнулить</button>') +
      '<button class="btn btn-key" type="button" data-act="close">Закрыть</button></div>'
    );
  }

  function rematch() {
    if (!isNet()) { newGame(); return; }
    if (auth()) {
      closeSheet();
      net.mineOffer = 0;
      NardyNet.again().then(function (d) { if (d && d.table) syncAuth(d.table); });
      return;
    }
    var t = toss(), st = N.create();
    st.turn = t.turn;
    net.shown = false;
    bf = {}; recorded = false; NardyBanter.reset();
    hushQuip();
    net.toss = null;
    net.mineOffer = 0;
    closeSheet();
    NardyNet.write({
      v: 1, seq: ((net.table && net.table.seq) || 0) + 1, code: net.code, status: 'live',
      createdAt: (net.table && net.table.createdAt) || Date.now(), updatedAt: Date.now(),
      seats: net.table.seats, state: st, rows: [], tally: tally, toss: t,
      gid: net.code + '-' + Date.now(), offer: null, declined: 0
    });
  }

  function quitTable(silent) {
    if (net.unsub) net.unsub();
    if (net.unpeers) net.unpeers();
    if (lobbyOff) { lobbyOff(); lobbyOff = null; }
    net.unsub = net.unpeers = null;
    net.code = net.seat = net.table = null;
    net.peers = [];
    net.shown = false;
    net.gid = null;
    net.turnKey = '';
    net.moves = [];
    NardyNet.leave();
    try { localStorage.removeItem('nardy.net'); } catch (e) {}
    opts.mode = 'ai';
    save();
    busy = true;
    if (!silent) { S = null; VIS = visFrom(N.create()); buildMen(); place(true); rows = []; renderLog(); updateUI(); }
    setupSheet();
  }

  /* ---------- диалоги ---------- */

  var veil = $('veil'), sheet = $('sheet');

  var sheetKind = '';

  function openSheet(html) {
    sheet.innerHTML = html;
    sheet.dataset.kind = sheetKind || '';
    sheetKind = '';
    veil.classList.add('show');
  }

  function closeSheet() {
    veil.classList.remove('show');
    if (lobbyOff) { lobbyOff(); lobbyOff = null; }
  }

  function saveName() {
    var f = $('net-name');
    if (f) NardyNet.rename(f.value.trim());
  }

  function segHTML(key, items, val) {
    return '<div class="seg" data-k="' + key + '">' + items.map(function (it) {
      return '<button type="button" data-v="' + it[0] + '" aria-pressed="' +
        (val === it[0]) + '">' + it[1] + '</button>';
    }).join('') + '</div>';
  }

  function setupSheet() {
    openSheet(
      '<h1>Длинные нарды</h1>' +
      '<p class="lede">Пятнадцать шашек стоят на голове, идут по кругу в свой дом и уходят с доски. ' +
      'Шашки не бьют — их запирают.</p>' +
      '<div class="field"><label>Соперник</label>' +
      segHTML('mode', [['ai', 'Компьютер'], ['duo', 'Вдвоём'], ['net', 'По сети']], opts.mode) +
      '<p class="hint" id="net-hint"></p></div>' +
      '<div class="field" id="f-level"><label>Уровень компьютера</label>' +
      segHTML('level', [['easy', 'Новичок'], ['normal', 'Опытный'], ['hard', 'Мастер']], opts.level) + '</div>' +
      '<div class="field" id="f-side"><label>Вы играете</label>' +
      segHTML('human', [['w', 'белыми'], ['b', 'чёрными']], opts.human) + '</div>' +
      '<div class="field"><label>Комментатор</label>' +
      segHTML('banter', [['hard', 'Как за столом'], ['soft', 'Прилично'], ['off', 'Тихо']], opts.banter) +
      '</div>' +
      (S && !S.winner ? '<p class="hint">Партия идёт. Начнёте новую — счёт матча ' +
        tally.w + ' : ' + tally.b + ' сохранится.</p>' : '') +
      '<div class="sheet-actions">' +
      '<button class="btn" type="button" data-act="profile">Профиль</button>' +
      '<button class="btn" type="button" data-act="rules">Правила</button>' +
      (saved
        ? '<button class="btn" type="button" data-act="start">Заново</button>' +
          '<button class="btn btn-key" type="button" data-act="resume">Продолжить</button>'
        : '<button class="btn btn-key" type="button" data-act="start">Начать партию</button>') +
      '</div>'
    );
    syncSetup();
  }

  function syncSetup() {
    var show = opts.mode === 'ai';
    var fl = $('f-level'), fs = $('f-side');
    if (fl) fl.style.display = show ? '' : 'none';
    if (fs) fs.style.display = show ? '' : 'none';
    var b = sheet.querySelector('.seg[data-k="mode"] [data-v="net"]');
    var hint = $('net-hint');
    if (b) b.disabled = net.ready === false;
    if (hint) {
      hint.textContent = net.ready === null ? 'Проверяем связь…'
        : net.ready === false ? 'Игра по сети работает только в опубликованной версии страницы.'
        : '';
    }
  }

  /* ---------- сетевые диалоги ---------- */

  function netSheet() {
    if (net.code) { tableSheet(); return; }
    openSheet(
      '<h1>Игра по сети</h1>' +
      '<p class="lede">Создайте стол и передайте сопернику код. Он откроет эту же ссылку, ' +
      'введёт код — и вы играете с разных устройств.</p>' +
      '<div class="field"><label>Как вас зовут</label>' +
      '<input class="inp" id="net-name" maxlength="18" placeholder="Игрок" value="' +
      esc(NardyNet.name()) + '"></div>' +
      '<div class="field"><label>Вы играете</label>' +
      segHTML('human', [['w', 'белыми'], ['b', 'чёрными']], opts.human) + '</div>' +
      /* часы и матч держит сервер — без него их некому считать */
      (NardyNet.authoritative()
        ? '<div class="field"><label>Время на ход</label>' +
          segHTML('timer', [['off', 'Без часов'], ['on', '60 секунд']], opts.timer) + '</div>' +
          '<div class="field"><label>Счёт</label>' +
          segHTML('match', [['0', 'Подряд'], ['3', 'До 3'], ['5', 'До 5'], ['7', 'До 7']], opts.match) + '</div>'
        : '') +
      '<div class="sheet-actions">' +
      '<button class="btn" type="button" data-act="back">Назад</button>' +
      '<button class="btn btn-key" type="button" data-act="net-new">Создать стол</button></div>' +
      (NardyNet.hasLobby()
        ? '<div class="field gap"><label>Кто ждёт соперника</label>' +
          '<ul class="tables" id="net-list"><li class="muted">смотрим…</li></ul></div>'
        : '<div class="gap"></div>') +
      '<div class="field"><label>Или код стола</label><div class="row">' +
      '<input class="inp mono" id="net-code" maxlength="6" placeholder="КОД" ' +
      'autocapitalize="characters" autocomplete="off" spellcheck="false">' +
      '<button class="btn" type="button" data-act="net-join">Сесть</button></div></div>'
    );
    if (NardyNet.hasLobby()) watchLobby();
  }

  function watchLobby() {
    if (lobbyOff) lobbyOff();
    lobbyOff = NardyNet.watchLobby(function (list) {
      var ul = $('net-list');
      if (!ul) return;
      var mineId = NardyNet.id();
      list = list.filter(function (t) {
        var w = t.seats && t.seats.w, b = t.seats && t.seats.b;
        return !((w && w.id === mineId) || (b && b.id === mineId));
      });
      if (!list.length) {
        ul.innerHTML = '<li class="muted">Пока никто не ждёт. Создайте стол — соперник увидит его здесь.</li>';
        return;
      }
      ul.innerHTML = list.map(function (t) {
        var host = (t.seats.w || t.seats.b || {}).name || 'Игрок';
        var side = t.seats.w ? 'чёрными' : 'белыми';
        return '<li><b class="mono">' + esc(t.code) + '</b>' +
          '<span>' + esc(host) + ' ждёт · сядете ' + side + '</span>' +
          '<button class="btn" type="button" data-act="net-sit" data-code="' + esc(t.code) + '">Сесть</button></li>';
      }).join('');
    }, function () {
      var ul = $('net-list');
      if (ul) ul.innerHTML = '<li class="muted">Список столов недоступен</li>';
    });
  }

  function inviteSheet(code) {
    openSheet(
      '<h1>Вас зовут за стол</h1>' +
      '<p class="lede">Кто-то ждёт соперника. Представьтесь — и садитесь играть.</p>' +
      '<div class="code-big mono">' + esc(code) + '</div>' +
      '<div class="field"><label>Как вас зовут</label>' +
      '<input class="inp" id="net-name" maxlength="18" placeholder="Игрок" value="' +
      esc(NardyNet.name()) + '"></div>' +
      '<div class="sheet-actions">' +
      '<button class="btn" type="button" data-act="back">Не сейчас</button>' +
      '<button class="btn btn-key" type="button" data-act="net-sit" data-code="' + esc(code) + '">Сесть за стол</button>' +
      '</div>'
    );
  }

  function tableSheet() {
    var t = net.table || {}, waiting = t.status === 'open';
    sheetKind = 'table';
    var opp = t.seats ? t.seats[N.opp(net.seat)] : null;
    openSheet(
      '<h1>Стол ' + esc(net.code) + '</h1>' +
      '<p class="lede">' + (waiting
        ? 'Передайте код сопернику — он откроет эту же ссылку, введёт код и сядет напротив.'
        : 'Напротив ' + esc((opp && opp.name) || 'соперник') + '. Ходите по очереди, доска у обоих одна.') +
      '</p>' +
      '<div class="code-big mono">' + esc(net.code) + '</div>' +
      '<p class="hint" style="text-align:center">' +
      (waiting ? 'Ждём соперника…' : 'Вы играете ' + (net.seat === 'w' ? 'белыми' : 'чёрными')) +
      (t.opts ? '<br>' + (t.opts.to ? 'Матч до ' + t.opts.to + ' побед' : 'Играем подряд, без счёта до победы') +
        (t.opts.timer ? ' · 60 секунд на ход' : ' · без часов') : '') + '</p>' +
      /* внутри артефакта страница живёт в песочнице — её адрес сопернику не отдать */
      (NardyTG.on && NardyTG.bot()
        ? '<div class="sheet-actions" style="margin-top:14px">' +
          '<button class="btn btn-key" type="button" data-act="net-share">Позвать в чат</button></div>'
        : '') +
      (NardyNet.kind() === 'db' ? '' :
        '<div class="field"><label>Ссылка-приглашение</label><div class="row">' +
        '<input class="inp" id="net-link" readonly value="' + esc(shareLink()) + '">' +
        '<button class="btn" type="button" data-act="net-copy">Копировать</button></div>' +
        '<p class="hint">По ней соперник попадёт прямо за этот стол.</p></div>') +
      '<div class="field"><label>Комментатор</label>' +
      segHTML('banter', [['hard', 'Как за столом'], ['soft', 'Прилично'], ['off', 'Тихо']], opts.banter) +
      '</div>' +
      (waiting ? '' :
        '<p class="hint" style="text-align:center">Счёт матча ' + tally.w + ' : ' + tally.b +
        ' — при переигровке сохранится.</p>' +
        '<div class="sheet-actions"><button class="btn" type="button" ' +
        'data-act="net-restart">Начать заново</button></div>') +
      '<div class="sheet-actions">' +
      '<button class="btn" type="button" data-act="net-quit">Покинуть стол</button>' +
      '<button class="btn btn-key" type="button" data-act="close">К доске</button></div>'
    );
  }

  /* Переиграть можно только по согласию: предложение уходит сопернику */
  function offerRestart() {
    if (!isNet()) return;
    closeSheet();
    net.mineOffer = Date.now();
    if (auth()) {
      NardyNet.offer().then(function (d) {
        if (d && d.error === 'busy') { net.mineOffer = 0; toast('Соперник уже предложил сам'); }
        if (d && d.table) syncAuth(d.table);
      });
    } else {
      pushTable({ offer: { by: net.seat, ts: net.mineOffer } });
    }
    toast('Предложил начать заново. Ждём ответа');
  }

  function offerSheet(t) {
    var by = t.seats ? t.seats[t.offer.by] : null;
    sheetKind = 'offer';
    openSheet(
      '<h1>Начать заново?</h1>' +
      '<p class="lede">' + esc((by && by.name) || 'Соперник') +
      ' предлагает бросить эту партию и начать новую. ' +
      'Счёт матча ' + tally.w + ' : ' + tally.b + ' сохранится.</p>' +
      '<div class="sheet-actions">' +
      '<button class="btn" type="button" data-act="offer-no">Доиграем</button>' +
      '<button class="btn btn-key" type="button" data-act="offer-yes">Согласен</button></div>'
    );
  }

  function answerOffer(yes) {
    closeSheet();
    if (!isNet() || !net.table) return;
    if (auth()) {
      NardyNet.answer(yes).then(function (d) { if (d && d.table) syncAuth(d.table); });
      if (!yes) toast('Доигрываем');
      return;
    }
    if (yes) { rematch(); return; }              /* rematch сам снимет предложение */
    pushTable({ offer: null, declined: Date.now() });
    toast('Доигрываем');
  }

  function rulesSheet() {
    openSheet(
      '<h1>Правила</h1>' +
      '<div class="rules">' +
      '<p>Длинные нарды. У каждого 15 шашек, они стоят на своей <b>голове</b> — в противоположных углах доски. ' +
      'Оба идут по кругу в одну сторону, к своему <b>дому</b> — последней четверти пути.</p>' +
      '<h3>Ход</h3><p>Бросают две кости и двигают шашки на выпавшее число пунктов: две разные шашки или одну дважды. ' +
      'При <b>дубле</b> кости играются четыре раза. Разыграть нужно как можно больше костей; если проходит только одна — играется старшая.</p>' +
      '<h3>Голова</h3><p>За ход с головы снимается <b>одна</b> шашка. Исключение — первый ход при 6-6, 4-4 или 3-3: тогда две.</p>' +
      '<h3>Куда нельзя</h3><p>Занять можно только пустой пункт или свой. Пункт, где стоит хотя бы одна чужая шашка, закрыт. ' +
      'Шашки в этой игре не бьют.</p>' +
      '<h3>Правило шести</h3><p>Нельзя выстроить шесть своих пунктов подряд, если все 15 шашек соперника окажутся заперты позади. ' +
      'Хотя бы одна чужая шашка должна быть впереди блока.</p>' +
      '<h3>Выход</h3><p>Когда все 15 шашек собраны в доме, их снимают с доски. Точное число снимает шашку с этого пункта; ' +
      'большее — только с самой дальней. Кто снял все шашки первым, выиграл. Если соперник не снял ни одной — это <b>марс</b>: почётно, но очко всё равно одно.</p>' +
      '</div>' +
      '<div class="sheet-actions"><button class="btn btn-key" type="button" data-act="close">Понятно</button></div>'
    );
  }

  function finish(bump) {
    busy = true;
    forget();
    sel = null;
    net.shown = true;
    renderSpots();
    markLive();
    var w = S.winner, l = N.opp(w);
    /* у серверного стола итог записан в самом столе: там и марс, и причина */
    var end = auth() && net.table ? net.table.end : null;
    var match = auth() && net.table && net.table.match && net.table.match.over;
    var mars = end ? !!end.mars : S.off[l] === 0;
    var late = !!(end && end.why === 'time');
    keepScore(w, mars);
    quip(mars ? 'mars' : 'win', w, true);
    if (bump !== false) {
      tally[w] += 1;                 /* марс — такое же одно очко */
      save();
      if (isNet()) pushTable({ status: 'done' });
    }
    updateUI();
    var me = isNet() ? net.seat : (opts.mode === 'ai' ? opts.human : null);
    sfx(me && me !== w ? 'lose' : 'win');
    later(900, function () {
      sheetKind = 'result';
      var seat = isNet() && net.table && net.table.seats ? net.table.seats[w] : null;
      var who = isNet()
        ? (net.seat === w ? 'Вы победили' : 'Победа: ' + ((seat && seat.name) || nameOf(w)))
        : nameOf(w) + ' победили';
      var why = late ? (net.seat === w ? 'Соперник трижды подряд не успел сходить.' : 'Три просрочки подряд — партия отдана.')
        : mars ? 'Марс — соперник не снял ни одной шашки.' : 'Партия закрыта.';
      var score = match
        ? (net.seat === w ? 'Матч ваш — ' : 'Матч проигран — ') + tally[net.seat] + ' : ' + tally[N.opp(net.seat)] + '.'
        : 'Счёт матча ' + tally.w + ' : ' + tally.b + '.';
      openSheet(
        '<div class="crown"><span class="disc ' + w + '"></span></div>' +
        '<h1 style="text-align:center">' + esc(who) + '</h1>' +
        '<p class="lede" style="text-align:center;margin-inline:auto">' + why + '<br>' + score + '</p>' +
        '<div class="sheet-actions">' +
        (isNet()
          ? '<button class="btn" type="button" data-act="net-quit">Покинуть стол</button>'
          : '<button class="btn" type="button" data-act="reset">Сбросить счёт</button>') +
        '<button class="btn btn-key" type="button" data-act="again">' + (match ? 'Новый матч' : 'Ещё партию') + '</button></div>'
      );
      var disc = sheet.querySelector('.crown .disc');
      if (disc) disc.style.backgroundImage = 'url(' + B.checker(w, 96) + ')';
    });
  }

  /* ---------- запуск партии ---------- */

  /* Возврат к сохранённой партии с того места, где её оставили */
  function resume() {
    if (!saved) { newGame(); return; }
    closeSheet();
    S = saved.s;
    rows = saved.rows || [];
    VIS = visFrom(S);
    undoStack = [];
    sel = null;
    busy = true;
    buildMen();
    place(true);
    renderLog();
    updateUI();
    if (!S.dice.length) { beginTurn(); return; }
    renderDice(false);
    legal = N.legalMoves(S);
    if (!legal.length) { setTimeout(passTurn, 900); return; }
    if (isAI(S.turn)) setTimeout(aiTurn, 600);
    else { busy = false; markLive(); updateUI(); }
  }

  function newGame() {
    /* «по сети» без стола — это не партия, а недоразумение */
    if (opts.mode === 'net' && !net.code) { netSheet(); return; }
    closeSheet();
    hushQuip();
    bf = {}; recorded = false; NardyBanter.reset();
    forget();
    S = N.create();
    VIS = visFrom(S);
    rows = [];
    undoStack = [];
    sel = null;
    legal = [];
    buildMen();
    place(true);
    renderLog();
    updateUI();
    opening();
  }

  function opening() {
    busy = true;
    var a, b;
    do { a = N.rollDie(); b = N.rollDie(); } while (a === b);
    S.turn = a > b ? 'w' : 'b';
    renderOpeningDice(a, b);
    sfx('dice');
    toast('Жеребьёвка: ' + a + ' — ' + b + '. Первыми ходят ' +
      (S.turn === 'w' ? 'белые' : 'чёрные'), 1600);
    setTimeout(beginTurn, 1700);
  }

  /* ---------- события ---------- */

  lZones.addEventListener('pointerdown', onDown);
  lZones.addEventListener('pointermove', onMove);
  lZones.addEventListener('pointerup', onUp);
  lZones.addEventListener('pointercancel', onCancel);
  lSpots.addEventListener('pointerdown', onDown);

  $('act-new').addEventListener('click', function () { isNet() ? tableSheet() : setupSheet(); });
  ['pl-w', 'pl-b'].forEach(function (id) {
    $(id).addEventListener('click', function () { if (!busy || S) profileSheet(); });
  });
  $('act-undo').addEventListener('click', function () { undo(); });
  $('act-sound').addEventListener('click', function () {
    opts.sound = !opts.sound;
    save();
    if (opts.sound) sfx('move');
    updateUI();
  });

  veil.addEventListener('click', function (e) {
    if (e.target === veil) { if (S) closeSheet(); return; }
    var seg = e.target.closest('.seg');
    if (seg && e.target.tagName === 'BUTTON') {
      opts[seg.dataset.k] = e.target.dataset.v;
      Array.prototype.forEach.call(seg.children, function (b) {
        b.setAttribute('aria-pressed', String(b === e.target));
      });
      save();
      if (seg.dataset.k === 'mode' && opts.mode === 'net') { netSheet(); return; }
      syncSetup();
      return;
    }
    var act = e.target.dataset ? e.target.dataset.act : null;
    if (act === 'start') newGame();
    else if (act === 'again') { isNet() ? rematch() : newGame(); }
    else if (act === 'resume') resume();
    else if (act === 'net-new') { saveName(); createTable(); }
    else if (act === 'net-sit') { saveName(); sitDown(e.target.dataset.code); }
    else if (act === 'net-join') { saveName(); sitDown($('net-code') ? $('net-code').value : ''); }
    else if (act === 'net-quit') quitTable();
    else if (act === 'net-restart') offerRestart();
    else if (act === 'profile') profileSheet();
    else if (act === 'login') doLogin();
    else if (act === 'top') topSheet();
    else if (act === 'logout') { NardyAccount.logout(); loginSheet(); }
    else if (act === 'stats-reset') { NardyStats.reset(); profileSheet(); }
    else if (act === 'offer-yes') answerOffer(true);
    else if (act === 'offer-no') answerOffer(false);
    else if (act === 'net-share') {
      if (!NardyTG.invite(net.code, 'Партию в нарды? Стол ' + net.code)) toast('Не вышло открыть чат');
    }
    else if (act === 'net-copy') {
      var f = $('net-link');
      if (f) {
        f.select();
        var done = function () { toast('Ссылка скопирована'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(f.value).then(done, function () { toast('Скопируйте ссылку вручную'); });
        } else {
          try { document.execCommand('copy'); done(); } catch (err) { toast('Скопируйте ссылку вручную'); }
        }
      }
    }
    else if (act === 'back') { opts.mode = 'ai'; save(); setupSheet(); }
    else if (act === 'rules') rulesSheet();
    else if (act === 'close') { if (S) closeSheet(); else setupSheet(); }
    else if (act === 'reset') { tally = { w: 0, b: 0 }; save(); updateUI(); newGame(); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && veil.classList.contains('show') && S) closeSheet();
    if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!$('act-undo').disabled) undo(); }
  });

  var rt;
  function onResize() {
    fit();
    B.render(scene);
    NardyDice.resize();
    if (VIS) place(true);
  }
  function bumpResize() {
    clearTimeout(rt);
    rt = setTimeout(onResize, 120);
  }
  window.addEventListener('resize', bumpResize);
  window.addEventListener('orientationchange', bumpResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', bumpResize);

  /* ---------- старт ---------- */

  window.NardyDebug = function () {
    return {
      pos: S ? S.points.join(',') + '|' + S.off.w + ':' + S.off.b + '|' + S.turn : null,
      roll: S ? S.roll.slice() : null,
      reach: Object.keys(reach).map(Number),
      sel: sel, mode: opts.mode, code: net.code, seat: net.seat, ready: net.ready,
             hasTable: !!net.table, hasS: !!S, busy: busy, legal: legal.length,
             isNet: isNet(), status: net.table && net.table.status };
  };

  NardyTG.ready();
  if (!NardyNet.name() && NardyTG.userName()) NardyNet.rename(NardyTG.userName());
  ['w', 'b'].forEach(function (p) {
    Array.prototype.forEach.call(document.querySelectorAll('.disc.' + p), function (d) {
      d.style.backgroundImage = 'url(' + B.checker(p, 96) + ')';
    });
  });

  fit();
  buildZones();
  B.render(scene);
  B.loadArt(function () { B.render(scene); });   /* герб приезжает отдельно */
  NardyDice.attach($('dicefx'));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { B.render(scene); });
  }
  S = null;
  VIS = visFrom(saved ? saved.s : N.create());
  buildMen();
  place(true);
  updateUI();
  if (NardyAccount.signed()) setupSheet(); else loginSheet();

  /* Сеть подключается отдельно: страница обязана работать и без неё */
  NardyNet.connect().then(function (db) {
    net.ready = !!db;
    syncSetup();
    if (!db) {
      if (opts.mode === 'net') { opts.mode = 'ai'; save(); setupSheet(); }
      return;
    }
    var invite = readInvite();
    if (invite) {
      forgetInvite();
      opts.mode = 'net';
      save();
      inviteSheet(invite);
      return;
    }
    var back = null;
    try { back = JSON.parse(localStorage.getItem('nardy.net') || 'null'); } catch (e) {}
    if (!back || !back.code) {
      if (opts.mode === 'net') netSheet();
      return;
    }
    NardyNet.peek(back.code).then(function (t) {
      var seat = t && t.seats && t.seats[back.seat];
      if (!seat || seat.id !== NardyNet.id()) {
        try { localStorage.removeItem('nardy.net'); } catch (e) {}
        if (opts.mode === 'net') { opts.mode = 'ai'; save(); setupSheet(); }
        return;
      }
      net.seat = back.seat;
      net.table = t;
      tally = t.tally || tally;
      S = null;
      rows = [];
      closeSheet();
      if (NardyNet.authoritative()) {
        net.table = null;
        net.gid = null;
        net.turnKey = '';
        VIS = visFrom(t.state);
        openTable(back.code);
        syncAuth(t);
        return;
      }
      openTable(back.code);
    }, function () {});
  });
})();
