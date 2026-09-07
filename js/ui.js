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

  var opts = { mode: 'ai', level: 'normal', human: 'w', sound: true, banter: 'hard' };
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
    toss: null
  };
  var lobbyOff = null;
  var bf = {};              /* какие подколы за партию уже прозвучали */

  function isNet() { return opts.mode === 'net' && !!net.code; }

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
    if (opts.sound) NardyVoice.speak(text);
    var q = $('quip');
    q.textContent = text;
    q.classList.add('show');
    clearTimeout(quip._t);
    quip._t = setTimeout(function () { q.classList.remove('show'); }, 2600);
  }

  function hushQuip() {
    NardyVoice.hush();
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

  function updateUI() {
    if (!S) return;
    $('tally-w').textContent = tally.w;
    $('tally-b').textContent = tally.b;
    var chip = $('net-chip');
    chip.hidden = !isNet();
    if (isNet()) chip.textContent = 'стол ' + net.code;
    $('pl-w').classList.toggle('act', !S.winner && S.turn === 'w');
    $('pl-b').classList.toggle('act', !S.winner && S.turn === 'b');
    var lvl = { easy: 'Новичок', normal: 'Опытный', hard: 'Мастер' }[opts.level];
    if (isNet()) {
      $('meta-w').textContent = seatLabel('w');
      $('meta-b').textContent = seatLabel('b');
    } else {
      $('meta-w').textContent = isAI('w') ? 'Компьютер · ' + lvl : 'Игрок';
      $('meta-b').textContent = isAI('b') ? 'Компьютер · ' + lvl : 'Игрок';
    }
    var my = canPlay();
    $('act-undo').disabled = !(my && undoStack.length);
    $('act-hint').disabled = !(my && legal.length);
    setSides();
    setAvatars();
    $('act-sound').setAttribute('aria-pressed', String(opts.sound));
    $('act-sound').textContent = opts.sound ? '♪' : '✕';
    $('act-sound').title = opts.sound ? 'Выключить звук' : 'Включить звук';
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
      moves: rows.length ? rows[rows.length - 1].moves.length : 0
    };
  }

  function doMove(mv) {
    tick++;
    undoStack.push(snapshot());
    var p = S.turn;
    var id = VIS.pts[mv.from].pop();
    if (mv.to === N.OFF) VIS.off[p].push(id); else VIS.pts[mv.to].push(id);
    N.applyTo(S, mv);
    if (rows.length) {
      rows[rows.length - 1].moves.push(N.label(p, mv.from) + '/' + N.label(p, mv.to));
    }
    sel = null;
    clearHint();
    place(false);
    men[id].classList.remove('land');
    void men[id].offsetWidth;
    men[id].classList.add('land');
    sfx(mv.to === N.OFF ? 'off' : 'move');
    if (mv.to === N.OFF) quip('off', p);
    renderLog();
    updateUI();
    persist();
    /* победный ход уходит одной записью вместе со счётом — см. finish() */
    if (!S.winner) pushTable();
  }

  function undo() {
    if (!undoStack.length) return;
    quip('undo', S.turn);
    var s = undoStack.pop();
    S = s.st;
    VIS = s.vis;
    if (rows.length) rows[rows.length - 1].moves.length = s.moves;
    sel = null;
    legal = N.legalMoves(S);
    place(false);
    renderLog();
    updateUI();
    pushTable();
  }

  function afterMove() {
    if (S.winner) { finish(); return; }
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
    playChain(path, 0);
    return true;
  }

  /* Составной ход показываем по шагам — видно, каким путём шашка идёт */
  function playChain(path, i) {
    doMove(path[i]);
    if (i + 1 < path.length) later(230, function () { playChain(path, i + 1); });
    else later(260, afterMove);
  }

  function canPick(i) {
    return legal.some(function (m) { return m.from === i; });
  }

  /* ---------- указатель: клик и перетаскивание ---------- */

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
      if (N.cnt(S, i, S.turn) === 0) { sfx('no'); clearSel(); return; }
    }
    if (!canPick(i)) {
      sfx('no');
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
      sfx('no');
      place(false);
    }
  }

  /* ---------- подсказка ---------- */

  function hint() {
    if (!canPlay() || !legal.length) return;
    var path = AI.choose(S, 'hard');
    if (!path.length) return;
    quip('hint', S.turn);
    var mv = path[0];
    pick(mv.from);
    var ids = VIS.pts[mv.from];
    hinted = ids[ids.length - 1];
    men[hinted].classList.add('hint');
    toast('Совет: ' + N.label(S.turn, mv.from) + '/' + N.label(S.turn, mv.to));
  }

  /* ---------- игра по сети ---------- */

  function seatLabel(p) {
    var who = net.table && net.table.seats ? net.table.seats[p] : null;
    if (!who) return 'место свободно';
    if (who.id === NardyNet.id()) return esc(who.name || 'Игрок') + ' · вы';
    var tag = NardyNet.hasRoom() ? (oppOnline(p) ? ' · в сети' : ' · не в сети') : '';
    return esc(who.name || 'Игрок') + tag;
  }

  function oppOnline(p) {
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
      rows: rows.slice(-60),
      tally: tally,
      toss: t.toss || null
    };
    if (extra) for (var k in extra) b[k] = extra[k];
    return b;
  }

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

  /* Единственный источник правды в сетевой партии — документ стола */
  function syncFrom(t) {
    if (!t) {
      toast('Стол закрыт');
      quitTable(true);
      return;
    }
    if (net.table && (t.seq || 0) < (net.table.seq || 0)) return;   /* пришла старая копия */
    net.table = t;
    if (t.status === 'open') {
      updateUI();
      if (sheet.dataset.kind === 'table' && veil.classList.contains('show')) tableSheet();
      return;
    }
    if (sheet.dataset.kind === 'table' && veil.classList.contains('show')) {
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
    /* соперник начал новую партию — убираем со своего экрана итог прошлой */
    if (fresh && !st.winner && sheet.dataset.kind === 'result' && veil.classList.contains('show')) {
      closeSheet();
    }
    if (t.toss && net.toss !== t.toss.n && !rows.length) {
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

  function createTable() {
    var seat = opts.human === 'b' ? 'b' : 'w';
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

  function rematch() {
    if (!isNet()) { newGame(); return; }
    var t = toss(), st = N.create();
    st.turn = t.turn;
    net.shown = false;
    bf = {}; NardyBanter.reset();
    hushQuip();
    net.toss = null;
    closeSheet();
    NardyNet.write({
      v: 1, seq: ((net.table && net.table.seq) || 0) + 1, code: net.code, status: 'live',
      createdAt: (net.table && net.table.createdAt) || Date.now(), updatedAt: Date.now(),
      seats: net.table.seats, state: st, rows: [], tally: tally, toss: t
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
      '<div class="sheet-actions">' +
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
      (waiting ? 'Ждём соперника…' : 'Вы играете ' + (net.seat === 'w' ? 'белыми' : 'чёрными')) + '</p>' +
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
      '<div class="sheet-actions">' +
      '<button class="btn" type="button" data-act="net-quit">Покинуть стол</button>' +
      '<button class="btn btn-key" type="button" data-act="close">К доске</button></div>'
    );
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
      'большее — только с самой дальней. Кто снял все шашки первым, выиграл. Если соперник не снял ни одной — это <b>марс</b>, две партии.</p>' +
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
    var mars = S.off[l] === 0;
    quip(mars ? 'mars' : 'win', w, true);
    if (bump !== false) {
      tally[w] += mars ? 2 : 1;
      save();
      if (isNet()) pushTable({ status: 'done' });
    }
    updateUI();
    sfx('win');
    later(900, function () {
      sheetKind = 'result';
      var who = isNet()
        ? (net.seat === w ? 'Вы победили' : nameOf(w) + ' победили')
        : nameOf(w) + ' победили';
      openSheet(
        '<div class="crown"><span class="disc ' + w + '"></span></div>' +
        '<h1 style="text-align:center">' + who + '</h1>' +
        '<p class="lede" style="text-align:center;margin-inline:auto">' +
        (mars ? 'Марс — соперник не снял ни одной шашки. Два очка.' : 'Партия закрыта. Одно очко.') +
        '<br>Счёт матча ' + tally.w + ' : ' + tally.b + '.</p>' +
        '<div class="sheet-actions">' +
        (isNet()
          ? '<button class="btn" type="button" data-act="net-quit">Покинуть стол</button>'
          : '<button class="btn" type="button" data-act="reset">Сбросить счёт</button>') +
        '<button class="btn btn-key" type="button" data-act="again">Ещё партию</button></div>'
      );
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
    NardyVoice.prime();
    closeSheet();
    hushQuip();
    bf = {}; NardyBanter.reset();
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
  $('act-undo').addEventListener('click', function () { undo(); });
  $('act-hint').addEventListener('click', hint);
  $('act-sound').addEventListener('click', function () {
    opts.sound = !opts.sound;
    if (!opts.sound) NardyVoice.hush(); else NardyVoice.prime();
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
  NardyDice.attach($('dicefx'));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { B.render(scene); });
  }
  S = null;
  VIS = visFrom(saved ? saved.s : N.create());
  buildMen();
  place(true);
  updateUI();
  setupSheet();

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
      openTable(back.code);
    }, function () {});
  });
})();
