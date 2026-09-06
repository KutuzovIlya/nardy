/* ============================================================
   Доска: резной орех, костяные вставки, шашки и кости рисуются
   на canvas и раздаются интерфейсу картинками.

   Вся геометрия считается в «альбомных» координатах 1240×820.
   На телефоне доска стоит вертикально: холст поворачивается на
   90°, а надписи, кости и метки рисуются ровно — поэтому ничего
   не читается вбок.
   ============================================================ */
(function (global) {
  'use strict';

  var VW = 1240, VH = 820;
  var FRAME = 26, TRAY = 96, GAP = 12;
  var FX0 = FRAME + TRAY + GAP;
  var FX1 = VW - FRAME - TRAY - GAP;
  var BAR = 48;
  var PTW = (FX1 - FX0 - BAR) / 12;
  var FY0 = FRAME + 10, FY1 = VH - FRAME - 10;
  var PTH = 316, CD = 66, DD = 62;

  var tall = false;   /* вертикальная раскладка */

  var C = {
    frameHi: '#5E3A23', frameLo: '#1E110B',
    bed: '#3E2517', bedLo: '#200F07',
    bone: '#D9C39B', boneMid: '#C2A97E', boneLo: '#9C8256',
    felt: '#1D5A53', feltMid: '#154742', feltLo: '#0E332F',
    brass: '#C8A24A', dark: '#2B1710'
  };

  function setTall(v) { tall = !!v; }
  function isTall() { return tall; }
  function vw() { return tall ? VH : VW; }
  function vh() { return tall ? VW : VH; }

  /* Прямоугольник из альбомных координат в текущие */
  function map(x, y, w, h) {
    if (!tall) return { x: x, y: y, w: w, h: h };
    return { x: VH - y - h, y: x, w: h, h: w };
  }

  function colX(j) { return FX0 + j * PTW + (j >= 6 ? BAR : 0); }

  function geom(i) {
    var top = i >= 12;
    var j = top ? i - 12 : 11 - i;
    return { j: j, top: top, x: colX(j), y: top ? FY0 : FY1 - PTH, w: PTW, h: PTH };
  }

  function gapFor(n) {
    if (n <= 1) return 0;
    return Math.max(15, Math.min(58, (PTH - CD) / (n - 1)));
  }

  function manAt(i, k, n) {
    var g = geom(i), sp = gapFor(n);
    return {
      x: g.x + (PTW - CD) / 2,
      y: g.top ? FY0 + k * sp : FY1 - CD - k * sp
    };
  }

  function trayAt(player, k) {
    return {
      x: player === 'w' ? VW - FRAME - TRAY + (TRAY - CD) / 2 : FRAME + (TRAY - CD) / 2,
      y: player === 'w' ? FY0 + k * 30 : FY1 - CD - k * 30
    };
  }

  function trayBox(player) {
    return {
      x: player === 'w' ? VW - FRAME - TRAY + 3 : FRAME + 3,
      y: FRAME + 8,
      w: TRAY - 6,
      h: VH - 2 * FRAME - 16
    };
  }

  function diceAt(player, idx, n) {
    var cx = player === 'w' ? FX0 + 9 * PTW + BAR : FX0 + 3 * PTW;
    var total = n * DD + (n - 1) * 10;
    return { x: cx - total / 2 + idx * (DD + 10), y: (FY0 + PTH + FY1 - PTH) / 2 - DD / 2 };
  }

  /* ---------- вспомогательное ---------- */

  function rnd32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function grain(ctx, x, y, w, h, seed, lines, alpha) {
    var r = rnd32(seed), i, xx, yy, amp, ph, per;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    for (i = 0; i < lines; i++) {
      yy = y + r() * h;
      amp = 1.5 + r() * 6;
      ph = r() * 6.283;
      per = 90 + r() * 300;
      ctx.beginPath();
      ctx.moveTo(x, yy);
      for (xx = x; xx <= x + w; xx += 12) ctx.lineTo(xx, yy + Math.sin(xx / per + ph) * amp);
      ctx.strokeStyle = r() > 0.45
        ? 'rgba(255,214,160,' + (alpha * r() * 0.9).toFixed(3) + ')'
        : 'rgba(22,10,3,' + (alpha * 1.8 * r()).toFixed(3) + ')';
      ctx.lineWidth = 0.5 + r() * 1.7;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* Резьба: канавка идёт светлой и тёмной нитью — как след стамески */
  function cut(ctx, path, depth, light) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.translate(0, -depth);
    ctx.strokeStyle = 'rgba(255,226,180,' + (light || 0.30) + ')';
    ctx.lineWidth = 1.6;
    path(ctx);
    ctx.restore();
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(20,9,3,.55)';
    ctx.lineWidth = 2.2;
    path(ctx);
    ctx.restore();
  }

  /* Розетка-солнце: главный мотив резных нард */
  function rosette(ctx, cx, cy, r, rays) {
    var i, a, step = Math.PI * 2 / rays;
    ctx.save();
    ctx.translate(cx, cy);

    cut(ctx, function (c) {
      c.beginPath();
      for (i = 0; i < rays; i++) {
        a = i * step;
        c.moveTo(Math.cos(a) * r * 0.30, Math.sin(a) * r * 0.30);
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.stroke();
    }, 1, 0.24);

    cut(ctx, function (c) {
      c.beginPath();
      for (i = 0; i < rays; i++) {
        a = i * step + step / 2;
        c.moveTo(Math.cos(a) * r * 0.44, Math.sin(a) * r * 0.44);
        c.lineTo(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86);
      }
      c.stroke();
    }, 1, 0.16);

    [r * 0.30, r * 0.46, r].forEach(function (rr, k) {
      cut(ctx, function (c) {
        c.beginPath();
        c.arc(0, 0, rr, 0, 6.284);
        c.stroke();
      }, 1, k === 2 ? 0.26 : 0.20);
    });

    var g = ctx.createRadialGradient(-r * 0.12, -r * 0.12, 1, 0, 0, r * 0.30);
    g.addColorStop(0, 'rgba(255,224,170,.20)');
    g.addColorStop(1, 'rgba(24,11,4,.45)');
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.28, 0, 6.284);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  /* Ёлочка вдоль борта — самый ходовой резной поясок */
  function chevrons(ctx, x0, y0, x1, y1, size) {
    var len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / (size * 1.5));
    var ang = Math.atan2(y1 - y0, x1 - x0), i, t, x, y;
    for (i = 0; i <= n; i++) {
      t = (i * size * 1.5) / len;
      x = x0 + (x1 - x0) * t;
      y = y0 + (y1 - y0) * t;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      cut(ctx, function (c) {
        c.beginPath();
        c.moveTo(-size * 0.5, -size * 0.55);
        c.lineTo(size * 0.32, 0);
        c.lineTo(-size * 0.5, size * 0.55);
        c.stroke();
      }, 0.8, 0.26);
      ctx.restore();
    }
  }

  /* ---------- части доски ---------- */

  function drawFrame(ctx) {
    var g = ctx.createLinearGradient(0, 0, VW * 0.6, VH);
    g.addColorStop(0, C.frameHi);
    g.addColorStop(0.45, '#3B2114');
    g.addColorStop(1, C.frameLo);
    rrect(ctx, 0, 0, VW, VH, 20);
    ctx.fillStyle = g;
    ctx.fill();
    grain(ctx, 0, 0, VW, VH, 7, 210, 0.12);

    var c = FRAME / 2;
    ctx.save();
    ctx.beginPath();
    rrect(ctx, 0, 0, VW, VH, 20);
    rrect(ctx, FRAME, FRAME, VW - 2 * FRAME, VH - 2 * FRAME, 6);
    ctx.clip('evenodd');
    chevrons(ctx, 60, c, VW - 60, c, 15);
    chevrons(ctx, VW - 60, VH - c, 60, VH - c, 15);
    chevrons(ctx, c, VH - 60, c, 60, 15);
    chevrons(ctx, VW - c, 60, VW - c, VH - 60, 15);
    ctx.restore();

    [[c + 2, c + 2], [VW - c - 2, c + 2], [c + 2, VH - c - 2], [VW - c - 2, VH - c - 2]]
      .forEach(function (p) { rosette(ctx, p[0], p[1], 15, 8); });

    ctx.strokeStyle = 'rgba(200,162,74,.42)';
    ctx.lineWidth = 1.1;
    rrect(ctx, 3.5, 3.5, VW - 7, VH - 7, 17); ctx.stroke();
    rrect(ctx, FRAME - 2.5, FRAME - 2.5, VW - 2 * FRAME + 5, VH - 2 * FRAME + 5, 7); ctx.stroke();
  }

  function drawBed(ctx) {
    var x = FRAME, y = FRAME, w = VW - 2 * FRAME, h = VH - 2 * FRAME;
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, C.bed);
    g.addColorStop(0.5, '#361F12');
    g.addColorStop(1, C.bedLo);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    grain(ctx, x, y, w, h, 21, 170, 0.10);

    var s = ctx.createLinearGradient(x, 0, x + 44, 0);
    s.addColorStop(0, 'rgba(0,0,0,.6)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(x, y, 44, h);
    s = ctx.createLinearGradient(x + w, 0, x + w - 44, 0);
    s.addColorStop(0, 'rgba(0,0,0,.6)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(x + w - 44, y, 44, h);
    s = ctx.createLinearGradient(0, y, 0, y + 32);
    s.addColorStop(0, 'rgba(0,0,0,.55)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(x, y, w, 32);
  }

  function drawTray(ctx, side) {
    var b = trayBox(side === 'l' ? 'b' : 'w');
    rrect(ctx, b.x, b.y, b.w, b.h, 10);
    ctx.fillStyle = '#190D06';
    ctx.fill();
    ctx.save();
    ctx.clip();
    grain(ctx, b.x, b.y, b.w, b.h, side === 'l' ? 33 : 44, 44, 0.08);
    var s = ctx.createLinearGradient(b.x, b.y, b.x + 24, b.y);
    s.addColorStop(0, 'rgba(0,0,0,.8)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(b.x, b.y, 24, b.h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(200,162,74,.3)';
    ctx.lineWidth = 1;
    rrect(ctx, b.x, b.y, b.w, b.h, 10); ctx.stroke();
    label(ctx, b.x + b.w / 2, side === 'l' ? b.y + 34 : b.y + b.h - 34, 'ДОМ');
  }

  /* Надпись всегда стоит ровно, как бы ни лежала доска */
  function label(ctx, x, y, text) {
    ctx.save();
    ctx.translate(x, y);
    if (tall) ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(214,178,104,.5)';
    ctx.font = '500 15px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '5px';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function drawBar(ctx) {
    var x = FX0 + 6 * PTW, y = FRAME + 8, h = VH - 2 * FRAME - 16;
    var g = ctx.createLinearGradient(x, 0, x + BAR, 0);
    g.addColorStop(0, '#150B05');
    g.addColorStop(0.5, '#4E2D1B');
    g.addColorStop(1, '#150B05');
    rrect(ctx, x, y, BAR, h, 8);
    ctx.fillStyle = g; ctx.fill();
    ctx.save();
    ctx.clip();
    grain(ctx, x, y, BAR, h, 55, 30, 0.12);
    chevrons(ctx, x + BAR / 2, y + 30, x + BAR / 2, y + h - 30, 13);
    ctx.restore();
    ctx.strokeStyle = 'rgba(200,162,74,.28)';
    ctx.lineWidth = 1;
    rrect(ctx, x, y, BAR, h, 8); ctx.stroke();
  }

  function drawPoints(ctx) {
    var i, g, light, baseY, apexY, grd;
    for (i = 0; i < 24; i++) {
      g = geom(i);
      light = ((g.j + (g.top ? 0 : 1)) % 2) === 0;
      baseY = g.top ? FY0 : FY1;
      apexY = g.top ? FY0 + PTH : FY1 - PTH;
      ctx.beginPath();
      ctx.moveTo(g.x + 1.5, baseY);
      ctx.lineTo(g.x + PTW - 1.5, baseY);
      ctx.lineTo(g.x + PTW / 2, apexY);
      ctx.closePath();
      grd = ctx.createLinearGradient(0, baseY, 0, apexY);
      if (light) {
        grd.addColorStop(0, C.bone); grd.addColorStop(0.55, C.boneMid); grd.addColorStop(1, C.boneLo);
      } else {
        grd.addColorStop(0, C.felt); grd.addColorStop(0.55, C.feltMid); grd.addColorStop(1, C.feltLo);
      }
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.save();
      ctx.clip();
      grain(ctx, g.x, Math.min(baseY, apexY), PTW, PTH, 100 + i, 14, light ? 0.07 : 0.05);
      ctx.restore();
      ctx.strokeStyle = light ? 'rgba(70,45,18,.45)' : 'rgba(0,0,0,.45)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    /* резные солнца в свободных полях между рядами */
    rosette(ctx, FX0 + 3 * PTW, VH / 2, 40, 12);
    rosette(ctx, FX0 + 9 * PTW + BAR, VH / 2, 40, 12);

    ctx.strokeStyle = 'rgba(200,162,74,.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(colX(6), FY0 - 3); ctx.lineTo(colX(11) + PTW, FY0 - 3);
    ctx.moveTo(colX(0), FY1 + 3); ctx.lineTo(colX(5) + PTW, FY1 + 3);
    ctx.stroke();
  }

  function drawLight(ctx) {
    var g = ctx.createLinearGradient(0, 0, VW * 0.75, VH);
    g.addColorStop(0, 'rgba(255,238,208,.10)');
    g.addColorStop(0.35, 'rgba(255,238,208,.02)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    rrect(ctx, 0, 0, VW, VH, 20);
    ctx.fillStyle = g; ctx.fill();

    var v = ctx.createRadialGradient(VW / 2, VH * 0.42, VH * 0.30, VW / 2, VH * 0.5, VH * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,.5)');
    rrect(ctx, 0, 0, VW, VH, 20);
    ctx.fillStyle = v; ctx.fill();
  }

  function render(canvas) {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    var k = (tall ? h : w) * dpr / VW;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (tall) { ctx.translate(VH, 0); ctx.rotate(Math.PI / 2); }
    ctx.clearRect(0, 0, VW, VH);
    drawFrame(ctx);
    drawBed(ctx);
    drawTray(ctx, 'l');
    drawTray(ctx, 'r');
    drawPoints(ctx);
    drawBar(ctx);
    drawLight(ctx);
  }

  /* ---------- шашки и кости картинками ---------- */

  var cache = {};

  function face(px, paint) {
    var cv = global.document.createElement('canvas');
    cv.width = cv.height = px;
    paint(cv.getContext('2d'), px);
    return cv.toDataURL('image/png');
  }

  /* Точёная шашка: фаска, две канавки и резная звезда посередине */
  function checker(side, px) {
    var key = 'man' + side + px;
    if (cache[key]) return cache[key];
    cache[key] = face(px, function (ctx, s) {
      var r = s / 2, i, a;
      var bone = side === 'w';
      ctx.save();
      ctx.beginPath();
      ctx.arc(r, r, r - 1, 0, 6.284);
      ctx.clip();

      var g = ctx.createRadialGradient(r * 0.68, r * 0.6, r * 0.1, r, r, r);
      if (bone) {
        g.addColorStop(0, '#FFFAEC'); g.addColorStop(0.42, '#F2E1BB');
        g.addColorStop(0.78, '#D6BA8A'); g.addColorStop(1, '#9A7C4B');
      } else {
        g.addColorStop(0, '#6A5C4B'); g.addColorStop(0.42, '#42372C');
        g.addColorStop(0.78, '#241C15'); g.addColorStop(1, '#0C0906');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);

      var gr = rnd32(bone ? 5 : 9);
      ctx.globalAlpha = bone ? 0.20 : 0.26;
      for (i = 0; i < 46; i++) {
        a = gr() * 6.284;
        var rr = r * (0.2 + gr() * 0.78);
        ctx.beginPath();
        ctx.arc(r, r, rr, a, a + 0.35 + gr() * 0.7);
        ctx.strokeStyle = gr() > 0.5 ? 'rgba(255,240,210,.5)' : 'rgba(30,18,6,.5)';
        ctx.lineWidth = 0.4 + gr() * 1.1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      [0.80, 0.62].forEach(function (f) {
        ctx.beginPath(); ctx.arc(r, r - s * 0.008, r * f, 0, 6.284);
        ctx.strokeStyle = bone ? 'rgba(255,250,235,.55)' : 'rgba(210,180,120,.20)';
        ctx.lineWidth = s * 0.018; ctx.stroke();
        ctx.beginPath(); ctx.arc(r, r + s * 0.008, r * f, 0, 6.284);
        ctx.strokeStyle = 'rgba(40,24,8,.45)';
        ctx.lineWidth = s * 0.018; ctx.stroke();
      });

      /* насечка по ободу — след резца на токарном станке */
      ctx.save();
      ctx.translate(r, r);
      for (i = 0; i < 48; i++) {
        a = i * Math.PI / 24;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.87, Math.sin(a) * r * 0.87);
        ctx.lineTo(Math.cos(a) * r * 0.955, Math.sin(a) * r * 0.955);
        ctx.strokeStyle = 'rgba(40,24,8,.30)';
        ctx.lineWidth = s * 0.016;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.87, Math.sin(a) * r * 0.87 - s * 0.01);
        ctx.lineTo(Math.cos(a) * r * 0.955, Math.sin(a) * r * 0.955 - s * 0.01);
        ctx.strokeStyle = bone ? 'rgba(255,250,232,.34)' : 'rgba(206,174,116,.16)';
        ctx.lineWidth = s * 0.012;
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.translate(r, r);
      for (i = 0; i < 8; i++) {
        a = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.12, Math.sin(a) * r * 0.12);
        ctx.lineTo(Math.cos(a) * r * 0.44, Math.sin(a) * r * 0.44);
        ctx.strokeStyle = 'rgba(40,24,8,.42)';
        ctx.lineWidth = s * 0.022;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.12, Math.sin(a) * r * 0.12 - s * 0.012);
        ctx.lineTo(Math.cos(a) * r * 0.44, Math.sin(a) * r * 0.44 - s * 0.012);
        ctx.strokeStyle = bone ? 'rgba(255,248,228,.5)' : 'rgba(200,168,110,.22)';
        ctx.lineWidth = s * 0.016;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.12, 0, 6.284);
      ctx.fillStyle = bone ? 'rgba(120,92,48,.35)' : 'rgba(200,162,74,.3)';
      ctx.fill();
      ctx.restore();

      var sh = ctx.createRadialGradient(r, r, r * 0.72, r, r, r);
      sh.addColorStop(0, 'rgba(0,0,0,0)');
      sh.addColorStop(1, bone ? 'rgba(60,40,14,.5)' : 'rgba(0,0,0,.65)');
      ctx.fillStyle = sh;
      ctx.fillRect(0, 0, s, s);

      var hi = ctx.createLinearGradient(0, 0, s * 0.7, s * 0.8);
      hi.addColorStop(0, bone ? 'rgba(255,255,245,.5)' : 'rgba(255,236,200,.16)');
      hi.addColorStop(0.55, 'rgba(255,255,245,0)');
      ctx.fillStyle = hi;
      ctx.fillRect(0, 0, s, s);
      ctx.restore();
    });
    return cache[key];
  }

  var PIPS = {
    1: [[50, 50]],
    2: [[27, 27], [73, 73]],
    3: [[27, 27], [50, 50], [73, 73]],
    4: [[27, 27], [73, 27], [27, 73], [73, 73]],
    5: [[27, 27], [73, 27], [50, 50], [27, 73], [73, 73]],
    6: [[27, 25], [73, 25], [27, 50], [73, 50], [27, 75], [73, 75]]
  };

  /* Костяной кубик: точка в кольце — как на старых игральных костях */
  function die(side, value, px) {
    var key = 'die' + side + value + px;
    if (cache[key]) return cache[key];
    cache[key] = face(px, function (ctx, s) {
      var bone = side === 'w', i, gr = rnd32(value * 7 + (bone ? 1 : 2));
      ctx.save();
      rrect(ctx, 1, 1, s - 2, s - 2, s * 0.2);
      ctx.clip();
      var g = ctx.createLinearGradient(0, 0, s * 0.9, s);
      if (bone) {
        g.addColorStop(0, '#FFFAEC'); g.addColorStop(0.5, '#EFE0BD'); g.addColorStop(1, '#C9B183');
      } else {
        g.addColorStop(0, '#4E4437'); g.addColorStop(0.5, '#2C2419'); g.addColorStop(1, '#120D08');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);

      ctx.globalAlpha = bone ? 0.18 : 0.22;
      for (i = 0; i < 26; i++) {
        ctx.beginPath();
        var y0 = gr() * s;
        ctx.moveTo(0, y0);
        ctx.bezierCurveTo(s * 0.3, y0 + (gr() - 0.5) * 8, s * 0.7, y0 + (gr() - 0.5) * 8, s, y0 + (gr() - 0.5) * 6);
        ctx.strokeStyle = gr() > 0.5 ? 'rgba(255,244,220,.6)' : 'rgba(40,25,8,.6)';
        ctx.lineWidth = 0.4 + gr();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      PIPS[value].forEach(function (p) {
        var cx = p[0] / 100 * s, cy = p[1] / 100 * s, rr = s * 0.085;
        ctx.beginPath();
        ctx.arc(cx, cy, rr * 1.9, 0, 6.284);
        ctx.strokeStyle = bone ? 'rgba(70,48,18,.38)' : 'rgba(226,206,160,.34)';
        ctx.lineWidth = s * 0.016;
        ctx.stroke();
        var pg = ctx.createRadialGradient(cx - rr * 0.3, cy - rr * 0.35, rr * 0.1, cx, cy, rr);
        if (bone) { pg.addColorStop(0, '#6A5537'); pg.addColorStop(1, '#241A0D'); }
        else { pg.addColorStop(0, '#F6EAC8'); pg.addColorStop(1, '#B39A63'); }
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, 6.284);
        ctx.fillStyle = pg;
        ctx.fill();
      });

      var hi = ctx.createLinearGradient(0, 0, s * 0.5, s * 0.6);
      hi.addColorStop(0, bone ? 'rgba(255,255,248,.55)' : 'rgba(255,240,210,.14)');
      hi.addColorStop(0.6, 'rgba(255,255,255,0)');
      ctx.fillStyle = hi;
      ctx.fillRect(0, 0, s, s);
      var sh = ctx.createLinearGradient(s * 0.4, s * 0.5, s, s);
      sh.addColorStop(0, 'rgba(0,0,0,0)');
      sh.addColorStop(1, bone ? 'rgba(70,48,16,.34)' : 'rgba(0,0,0,.5)');
      ctx.fillStyle = sh;
      ctx.fillRect(0, 0, s, s);
      ctx.restore();
    });
    return cache[key];
  }

  global.NardyBoard = {
    VW: VW, VH: VH, CD: CD, DD: DD, PTW: PTW, PTH: PTH, FY0: FY0, FY1: FY1,
    setTall: setTall, isTall: isTall, vw: vw, vh: vh, map: map,
    geom: geom, manAt: manAt, trayAt: trayAt, trayBox: trayBox, diceAt: diceAt,
    gapFor: gapFor, render: render, checker: checker, die: die
  };
})(window);
