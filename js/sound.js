/* ============================================================
   Звук. Всё синтезируется на месте, записей не скачиваем.

   Стук: дерево о дерево — несколько затухающих тонов корпуса
   и короткий щелчок в начале. Кость о доску — суше и выше,
   шашка на пункт — глухое «тук».

   Фон: чайхана. Гул голосов вдалеке (шум, пропущенный через
   «гласные» фильтры, с неровным ритмом речи), звон стаканов,
   кости за соседним столом.
   ============================================================ */
(function (global) {
  'use strict';

  var ctx = null, fx = null, amb = null, far = null, buf = null;

  function ac() {
    if (!ctx) {
      var A = global.AudioContext || global.webkitAudioContext;
      if (!A) return null;
      ctx = new A();
      fx = ctx.createGain();
      fx.gain.value = 1;
      fx.connect(ctx.destination);
      amb = ctx.createGain();
      amb.gain.value = 0;
      amb.connect(ctx.destination);
      /* всё, что «за соседним столом», слышно глуше */
      far = ctx.createBiquadFilter();
      far.type = 'lowpass';
      far.frequency.value = 1800;
      far.connect(amb);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noise() {
    if (buf) return buf;
    var len = ctx.sampleRate * 2, d, i;
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    d = buf.getChannelData(0);
    for (i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* Удар дерева: base — основной тон корпуса, gain — громкость,
     decay — сколько звенит, click — где «щёлкает» начало. */
  var RATIOS = [1, 2.32, 4.25, 6.8], AMPS = [1, .55, .3, .15];
  function knock(t, base, gain, decay, click, out) {
    out = out || fx;
    for (var i = 0; i < RATIOS.length; i++) {
      var f = base * RATIOS[i] * rnd(.98, 1.02);
      if (f > 9000) continue;
      var o = ctx.createOscillator(), g = ctx.createGain(), d = decay / (1 + i * .9);
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * AMPS[i], t + .002);
      g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + d + .02);
    }
    var n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = noise();
    bp.type = 'bandpass';
    bp.frequency.value = click;
    bp.Q.value = .9;
    ng.gain.setValueAtTime(gain * .7, t);
    ng.gain.exponentialRampToValueAtTime(.0001, t + .018);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    n.start(t, rnd(0, 1.5));
    n.stop(t + .03);
  }

  /* Стеклянный стакан: высокие чистые тоны, звенят дольше дерева */
  function clink(t, pitch, gain, out) {
    [1, 1.62, 2.26].forEach(function (r, i) {
      var o = ctx.createOscillator(), g = ctx.createGain(), d = [.7, .45, .3][i];
      o.type = 'sine';
      o.frequency.value = pitch * r * rnd(.995, 1.005);
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(gain / (1 + i), t + .003);
      g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + d + .02);
    });
  }

  function tone(t, freq, dur, gain, type) {
    var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = type || 'triangle';
    o.frequency.value = freq;
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + .015);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(lp);
    lp.connect(g);
    g.connect(fx);
    o.start(t);
    o.stop(t + dur + .05);
  }

  /* ---------- стук ---------- */

  var last = 0;

  function play(kind) {
    if (!ac()) return;
    var t = ctx.currentTime + .005, i;
    try {
      if (kind === 'tick') {
        /* отскок кости: не чаще, чем ухо различает */
        if (t - last < .05) return;
        last = t;
        knock(t, rnd(900, 1300), rnd(.06, .11), .06, 3400);
      } else if (kind === 'dice') {
        /* кости в руке: несколько сухих щелчков друг о друга */
        for (i = 0; i < 5; i++) knock(t + i * rnd(.03, .055), rnd(1900, 2700), .045, .03, 4200);
      } else if (kind === 'move') {
        knock(t, rnd(250, 310), .2, .13, 1800);
        knock(t + .028, rnd(300, 360), .06, .07, 2200);          /* шашка чуть подпрыгнула */
      } else if (kind === 'off') {
        knock(t, rnd(400, 440), .15, .1, 2400);
        clink(t + .05, 1760, .025, fx);
      } else if (kind === 'no') {
        knock(t, 140, .2, .09, 900);
      } else if (kind === 'win') {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(t + k * .11, f, .55, .07); });
      } else if (kind === 'lose') {
        tone(t, 392, .5, .06);
        tone(t + .18, 311, .7, .06);
      }
    } catch (e) {}
  }

  /* ---------- фон: чайхана ---------- */

  var on = false, want = false, loops = [], voices = [], timer = null, nextClink = 0, nextRattle = 0;

  var VOWELS = [
    { f: 290, q: 2.4, w: 1 },
    { f: 520, q: 2.2, w: 1 },
    { f: 860, q: 2.0, w: .7 },
    { f: 1400, q: 2.6, w: .45 }
  ];

  function start() {
    if (on || !ac()) return;
    on = true;
    var t = ctx.currentTime;

    /* гул помещения */
    var room = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), rg = ctx.createGain();
    room.buffer = noise();
    room.loop = true;
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    rg.gain.value = .25;
    room.connect(lp);
    lp.connect(rg);
    rg.connect(amb);
    room.start(t, rnd(0, 2));
    loops.push(room);

    /* голоса: у каждого свой «гласный» фильтр и свой неровный ритм */
    voices = VOWELS.map(function (v) {
      var s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise();
      s.loop = true;
      bp.type = 'bandpass';
      bp.frequency.value = v.f;
      bp.Q.value = v.q;
      g.gain.value = 0;
      s.connect(bp);
      bp.connect(g);
      g.connect(amb);
      s.start(t, rnd(0, 2));
      loops.push(s);
      return { g: g, bp: bp, v: v, at: 0 };
    });

    nextClink = t + rnd(3, 7);
    nextRattle = t + rnd(8, 16);
    timer = setInterval(tickAmb, 60);

    amb.gain.cancelScheduledValues(t);
    amb.gain.setValueAtTime(amb.gain.value, t);
    amb.gain.linearRampToValueAtTime(.6, t + 2.5);            /* входим в чайхану, а не врубаем */
  }

  function tickAmb() {
    if (!on) return;
    var t = ctx.currentTime;
    voices.forEach(function (x, i) {
      if (t < x.at) return;
      /* речь — это слоги и паузы: то громче, то тише, иногда тишина */
      /* узкая полоса шума тихая сама по себе — отсюда такие множители */
      var lvl = Math.random() < .22 ? 0 : rnd(.15, .5) * x.v.w;
      x.g.gain.setTargetAtTime(lvl, t, rnd(.04, .1));
      x.bp.frequency.setTargetAtTime(x.v.f * rnd(.85, 1.2), t, .08);
      x.at = t + rnd(.09, .26);
    });
    if (t >= nextClink) {
      /* стаканы: иногда один, иногда чокаются двое */
      var p = rnd(2400, 3100);
      clink(t, p, rnd(.02, .04), amb);
      if (Math.random() < .4) clink(t + rnd(.06, .12), p * rnd(1.05, 1.15), rnd(.015, .03), amb);
      nextClink = t + rnd(4, 13);
    }
    if (t >= nextRattle) {
      /* за соседним столом бросили кости */
      var n = 3 + Math.floor(Math.random() * 4);
      for (var k = 0; k < n; k++) knock(t + k * rnd(.05, .14), rnd(900, 1500), rnd(.02, .04), .05, 3000, far);
      nextRattle = t + rnd(12, 30);
    }
  }

  function stop() {
    if (!on) return;
    on = false;
    clearInterval(timer);
    timer = null;
    var t = ctx.currentTime;
    amb.gain.cancelScheduledValues(t);
    amb.gain.setValueAtTime(amb.gain.value, t);
    amb.gain.linearRampToValueAtTime(0, t + .6);
    var old = loops;
    loops = [];
    voices = [];
    setTimeout(function () { old.forEach(function (s) { try { s.stop(); } catch (e) {} }); }, 700);
  }

  /* Фон включается только после первого касания — раньше браузер звук не даст */
  function ambience(flag) {
    want = !!flag;
    if (!ctx) return;                    /* ещё не было касания — включим при нём */
    if (want && !document.hidden) start(); else stop();
  }

  function unlock() {
    if (!ac()) return;
    if (want && !document.hidden) start();
  }

  /* свернули Telegram — чайхана замолкает, вернулись — снова шумит */
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) { stop(); ctx.suspend && ctx.suspend(); }
    else { ctx.resume && ctx.resume(); if (want) start(); }
  });

  function state() { return { ctx: ctx ? ctx.state : 'none', amb: on, want: want }; }

  global.NardySound = { play: play, ambience: ambience, unlock: unlock, state: state };
})(window);
