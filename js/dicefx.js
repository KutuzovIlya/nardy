/* ============================================================
   Бросок костей. Своя физика, без библиотек: у кости есть
   положение, скорость, вращение и высота над доской. Высота
   даёт отскоки и тень, вращение — кувырки, трение — укатывание.
   Грань меняется на лету и в конце садится на выпавшее число.
   ============================================================ */
(function (global) {
  'use strict';

  var B = global.NardyBoard;
  var cv = null, ctx = null, imgs = {}, ready = false;
  var cur = null;          /* {side, vals, spots:[{x,y,a}], used:[]} */
  var raf = 0, live = null;

  function preload() {
    if (ready) return;
    ready = true;
    ['w', 'b'].forEach(function (s) {
      for (var v = 1; v <= 6; v++) {
        var im = new Image();
        im.src = B.die(s, v, 132);
        imgs[s + v] = im;
      }
    });
  }

  function attach(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    preload();
    resize();
  }

  function resize() {
    if (!cv) return;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 3);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    draw();
  }

  /* Кости лежат по местам — без броска (перезагрузка, смена размера) */
  function place(side, vals) {
    var spots = vals.map(function (v, i) {
      var d = B.diceAt(side, i, vals.length);
      return { x: d.x + B.DD / 2, y: d.y + B.DD / 2, a: (i - vals.length / 2) * 0.08, face: v };
    });
    cur = { side: side, vals: vals.slice(), spots: spots, used: vals.map(function () { return false; }) };
  }

  function show(used) {
    if (cur && used) cur.used = used.slice();
    draw();
  }

  function clear() {
    cur = null;
    stop();
    draw();
  }

  function stop() {
    if (raf) { global.cancelAnimationFrame(raf); raf = 0; }
    live = null;
  }

  /* Половина доски, в которую летят кости */
  /* вся середина доски — для жеребьёвки */
  function wideZone() {
    var midTop = B.geom(0).y + B.PTH, midBot = B.geom(12).y;
    return {
      x0: 40 + B.DD / 2, x1: B.vw() - 40 - B.DD / 2,
      y0: midTop + B.DD / 2 + 4, y1: midBot - B.DD / 2 - 4
    };
  }

  function zone(side) {
    var g0 = B.geom(side === 'w' ? 18 : 6), g5 = B.geom(side === 'w' ? 23 : 11);
    var x0 = Math.min(g0.x, g5.x), x1 = Math.max(g0.x, g5.x) + B.COL;
    var midTop = B.geom(0).y + B.PTH, midBot = B.geom(12).y;
    /* строго среднее поле: иначе кости укатываются на пункты и шашки */
    return {
      x0: x0 + B.DD / 2 + 6, x1: x1 - B.DD / 2 - 6,
      y0: midTop + B.DD / 2 + 4,
      y1: midBot - B.DD / 2 - 4
    };
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* Бросок: кости влетают с внешнего края своей половины */
  function roll(side, vals, onBounce, onDone, opts) {
    preload();
    opts = opts || {};
    var z = opts.wide ? wideZone() : zone(side);
    var fromLeft = side === 'b';
    var bodies = vals.map(function (v, i) {
      return {
        x: fromLeft ? z.x0 - 60 - i * 46 : z.x1 + 60 + i * 46,
        y: rnd(z.y0 + 40, z.y1 - 40),
        vx: (fromLeft ? 1 : -1) * rnd(0.34, 0.52),
        vy: rnd(-0.10, 0.10),
        z: rnd(190, 260),
        vz: rnd(0.02, 0.10),
        a: rnd(0, 6.28),
        spin: rnd(-0.011, 0.011),
        face: 1 + Math.floor(Math.random() * 6),
        val: v,
        side: opts.sides ? opts.sides[i] : side,
        rest: false,
        flip: 0
      };
    });
    live = { side: side, vals: vals.slice(), bodies: bodies, z: z, t: 0,
             onBounce: onBounce || null, onDone: onDone || null };
    cur = { side: side, vals: vals.slice(),
            spots: bodies.map(function () { return { x: 0, y: 0, a: 0, face: 1 }; }),
            used: vals.map(function () { return false; }) };
    stopLater();
  }

  function stopLater() {
    var last = 0;
    function frame(ts) {
      if (!live) return;
      if (!last) last = ts;
      var dt = Math.min(34, ts - last);
      last = ts;
      step(dt);
      draw();
      if (live && live.bodies.every(function (b) { return b.rest; })) {
        var done = live.onDone;
        settle();
        live = null;
        raf = 0;
        draw();
        if (done) done();
        return;
      }
      raf = global.requestAnimationFrame(frame);
    }
    raf = global.requestAnimationFrame(frame);
  }

  function settle() {
    if (!live) return;
    cur.spots = live.bodies.map(function (b) {
      return { x: b.x, y: b.y, a: b.a, face: b.val, side: b.side };
    });
  }

  var G = 0.0034;          /* притяжение */
  var BOUNCE = 0.42;       /* упругость */
  var RUB = 0.70;          /* трение о сукно при касании */
  var AIR = 0.9985;

  function step(dt) {
    var L = live, i, b, hit;
    L.t += dt;
    for (i = 0; i < L.bodies.length; i++) {
      b = L.bodies[i];
      if (b.rest) continue;

      b.vz -= G * dt;
      b.z += b.vz * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.a += b.spin * dt;
      b.vx *= AIR; b.vy *= AIR;

      /* грань мельтешит, пока кость в полёте */
      b.flip += dt;
      if (b.flip > 70 && (b.z > 4 || Math.abs(b.vx) + Math.abs(b.vy) > 0.12)) {
        b.flip = 0;
        b.face = 1 + Math.floor(Math.random() * 6);
      }

      hit = false;

      if (b.z <= 0) {
        b.z = 0;
        if (b.vz < -0.03) {
          b.vz = -b.vz * BOUNCE;
          b.vx *= RUB; b.vy *= RUB;
          b.spin *= 0.55;
          hit = true;
        } else {
          b.vz = 0;
          b.vx *= 0.86; b.vy *= 0.86;
          b.spin *= 0.90;
        }
      }

      /* борта своей половины */
      if (b.x < L.z.x0) { b.x = L.z.x0; b.vx = Math.abs(b.vx) * 0.55; b.spin = -b.spin; hit = true; }
      if (b.x > L.z.x1) { b.x = L.z.x1; b.vx = -Math.abs(b.vx) * 0.55; b.spin = -b.spin; hit = true; }
      if (b.y < L.z.y0) { b.y = L.z.y0; b.vy = Math.abs(b.vy) * 0.55; hit = true; }
      if (b.y > L.z.y1) { b.y = L.z.y1; b.vy = -Math.abs(b.vy) * 0.55; hit = true; }

      /* кости не должны лежать друг на друге */
      for (var j = 0; j < L.bodies.length; j++) {
        if (j === i) continue;
        var o = L.bodies[j], dx = b.x - o.x, dy = b.y - o.y;
        var d = Math.hypot(dx, dy) || 0.01, min = B.DD * 0.96;
        if (d < min) {
          var push = (min - d) / 2 / d;
          b.x += dx * push; b.y += dy * push;
          o.x -= dx * push; o.y -= dy * push;
          b.vx += dx * 0.0016; b.vy += dy * 0.0016;
          if (b.z < 4) hit = true;
        }
      }

      if (hit && L.onBounce && b.z < 40) L.onBounce();

      if (b.z === 0 && Math.abs(b.vx) + Math.abs(b.vy) < 0.012 && Math.abs(b.spin) < 0.0016) {
        b.rest = true;
        b.face = b.val;
        b.a = Math.round(b.a / (Math.PI / 2)) * (Math.PI / 2) + rnd(-0.10, 0.10);
      }
      /* затянувшийся бросок дожимаем, чтобы игра не ждала */
      if (L.t > 2200) { b.rest = true; b.face = b.val; b.z = 0; }
    }
  }

  function draw() {
    if (!ctx || !cv.width) return;
    var dpr = cv.width / cv.clientWidth;
    var k = cv.clientWidth * dpr / B.vw();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!cur) return;
    ctx.setTransform(k, 0, 0, k, 0, 0);

    var list = live ? live.bodies : cur.spots;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var side = b.side || (live ? live.side : cur.side);
      var im = imgs[side + (b.face || cur.vals[i])];
      if (!im || !im.complete) continue;
      var z = b.z || 0;
      var lift = 1 + z * 0.0016;
      var half = B.DD / 2 * lift;

      /* тень уползает и размывается по мере подъёма */
      ctx.save();
      ctx.globalAlpha = Math.max(0.06, 0.34 - z * 0.0011);
      ctx.translate(b.x + z * 0.05, b.y + z * 0.10);
      ctx.rotate(b.a || 0);
      ctx.filter = 'blur(' + Math.min(9, 1.5 + z * 0.02).toFixed(1) + 'px)';
      ctx.fillStyle = '#000';
      ctx.fillRect(-half * 0.94, -half * 0.94, half * 1.88, half * 1.88);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = (!live && cur.used[i]) ? 0.42 : 1;
      ctx.translate(b.x, b.y - z * 0.16);
      ctx.rotate(b.a || 0);
      var s = (!live && cur.used[i]) ? 0.86 : 1;
      ctx.drawImage(im, -half * s, -half * s, half * 2 * s, half * 2 * s);
      ctx.restore();
    }
  }

  global.NardyDice = {
    attach: attach, resize: resize, place: place, show: show,
    roll: roll, clear: clear, draw: draw,
    rolling: function () { return !!live; }
  };
})(window);
