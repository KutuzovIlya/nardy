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

  /* Доска лежит горизонтально, телефон — вертикально в руке.
     Ширину делят 12 пунктов и планка, поэтому она и задаёт размер
     шашки: всё лишнее из ширины убрано, лотки для снятых шашек
     переехали в полки на верхнем и нижнем борту. */
  var CD = 66;          /* шашка — единица меры */
  var COL = 68;         /* пункт чуть шире шашки */
  var BAR = 36;         /* средняя планка */
  var FRAME = 14;       /* борт */
  var SHELF = 72;       /* полка для снятых шашек */
  var PTH = 380;        /* длина пункта: 15 шашек влезают, не вылезая в середину */
  var MID = 170;        /* поле между рядами: костям нужно место, чтобы скакать */
  var DD = 88;          /* кость: четыре при дубле должны влезать в половину доски */

  var VW = 2 * FRAME + 12 * COL + BAR;                    /* 880 */
  var VH = 2 * FRAME + 2 * SHELF + 2 * PTH + MID;         /* 810 — доска шире, чем выше */

  var TOPY = FRAME + SHELF;              /* верх верхнего ряда */
  var BOTY = VH - FRAME - SHELF;         /* низ нижнего ряда */

  var flip = false;     /* развернуть доску на 180°, чтобы свой дом был снизу */

  var C = {
    frameHi: '#5E3A23', frameLo: '#1E110B',
    bed: '#3E2517', bedLo: '#200F07',
    bone: '#D9C39B', boneMid: '#C2A97E', boneLo: '#9C8256',
    felt: '#1D5A53', feltMid: '#154742', feltLo: '#0E332F',
    brass: '#C8A24A', dark: '#2B1710'
  };

  function setFlip(v) { flip = !!v; }
  function isFlip() { return flip; }
  function vw() { return VW; }
  function vh() { return VH; }

  /* Разворот доски на 180°: тот же стол, только вы сидите с другой стороны */
  function map(x, y, w, h) {
    if (!flip) return { x: x, y: y, w: w, h: h };
    return { x: VW - x - w, y: VH - y - h, w: w, h: h };
  }

  function colX(j) { return FRAME + j * COL + (j >= 6 ? BAR : 0); }

  /* Голова белых — верхний правый угол, чёрных — нижний левый.
     Отсюда и раскладка: сверху пункты 11..0 слева направо,
     снизу 12..23. Дом белых оказывается в нижнем правом углу,
     дом чёрных — в верхнем левом. */
  function geom(i) {
    var top = i < 12;
    var j = top ? 11 - i : i - 12;
    return { j: j, top: top, x: colX(j), y: top ? TOPY : BOTY - PTH, w: COL, h: PTH };
  }

  /* Стопка выше пяти вылезает за пункт в середину — как на настоящей доске */
  function gapFor(n) {
    if (n <= 1) return 0;
    return Math.max(18, Math.min(56, (PTH - CD) / (n - 1)));
  }

  function manAt(i, k, n) {
    var g = geom(i), sp = gapFor(n);
    return {
      x: g.x + (COL - CD) / 2,
      y: g.top ? TOPY + k * sp : BOTY - CD - k * sp
    };
  }

  /* Снятые ложатся в полку у своего дома: белые снизу, чёрные сверху */
  function trayAt(player, k) {
    var step = 50, y0 = player === 'w' ? VH - FRAME - SHELF : FRAME;
    return {
      x: player === 'w'
        ? VW - FRAME - 10 - CD - k * step
        : FRAME + 10 + k * step,
      y: y0 + (SHELF - CD) / 2
    };
  }

  function trayBox(player) {
    return {
      x: FRAME + 4,
      y: player === 'w' ? VH - FRAME - SHELF + 3 : FRAME + 3,
      w: VW - 2 * FRAME - 8,
      h: SHELF - 6
    };
  }

  function diceAt(player, idx, n) {
    /* по центру своей половины, а не поверх конкретного пункта —
       иначе четыре кости при дубле упираются в борт */
    var cx = player === 'w'
      ? (colX(6) + colX(11) + COL) / 2
      : (colX(0) + colX(5) + COL) / 2;
    var gap = 8, total = n * DD + (n - 1) * gap;
    return { x: cx - total / 2 + idx * (DD + gap), y: TOPY + PTH + (MID - DD) / 2 };
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
    ctx.strokeStyle = 'rgba(255,232,192,' + (light || 0.30) + ')';
    ctx.lineWidth = 1.8;
    path(ctx);
    ctx.restore();
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(16,7,2,.75)';
    ctx.lineWidth = 2.6;
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

  /* Восьмиконечная воровская звезда — главный знак на таких досках */
  function thiefStar(ctx, cx, cy, r) {
    var i, a;
    ctx.save();
    ctx.translate(cx, cy);

    /* два квадрата, повёрнутые друг относительно друга */
    [0, Math.PI / 4].forEach(function (turn) {
      cut(ctx, function (c) {
        c.beginPath();
        for (i = 0; i < 4; i++) {
          a = turn + i * Math.PI / 2;
          var x = Math.cos(a) * r, y = Math.sin(a) * r;
          if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.closePath();
        c.stroke();
      }, 1, 0.30);
    });

    /* лучи от центра к вершинам */
    cut(ctx, function (c) {
      c.beginPath();
      for (i = 0; i < 8; i++) {
        a = i * Math.PI / 4;
        c.moveTo(Math.cos(a) * r * 0.20, Math.sin(a) * r * 0.20);
        c.lineTo(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97);
      }
      c.stroke();
    }, 1, 0.22);

    /* грани лучей — чтобы звезда читалась объёмной */
    ctx.save();
    for (i = 0; i < 8; i++) {
      a = i * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97);
      ctx.lineTo(Math.cos(a + Math.PI / 8) * r * 0.42, Math.sin(a + Math.PI / 8) * r * 0.42);
      ctx.lineTo(Math.cos(a - Math.PI / 8) * r * 0.42, Math.sin(a - Math.PI / 8) * r * 0.42);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? 'rgba(255,230,190,.13)' : 'rgba(18,8,2,.34)';
      ctx.fill();
    }
    ctx.restore();

    [r * 0.20, r * 0.42].forEach(function (rr) {
      cut(ctx, function (c) { c.beginPath(); c.arc(0, 0, rr, 0, 6.284); c.stroke(); }, 1, 0.24);
    });

    var g = ctx.createRadialGradient(-r * 0.08, -r * 0.08, 1, 0, 0, r * 0.20);
    g.addColorStop(0, 'rgba(255,224,170,.22)');
    g.addColorStop(1, 'rgba(24,11,4,.5)');
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.19, 0, 6.284);
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
    rrect(ctx, 0, 0, VW, VH, 16);
    ctx.fillStyle = g;
    ctx.fill();
    grain(ctx, 0, 0, VW, VH, 7, 210, 0.12);

    var c = FRAME / 2;
    ctx.save();
    ctx.beginPath();
    rrect(ctx, 0, 0, VW, VH, 16);
    rrect(ctx, FRAME, FRAME, VW - 2 * FRAME, VH - 2 * FRAME, 5);
    ctx.clip('evenodd');
    chevrons(ctx, 34, c, VW - 34, c, 10);
    chevrons(ctx, VW - 34, VH - c, 34, VH - c, 10);
    chevrons(ctx, c, VH - 34, c, 34, 10);
    chevrons(ctx, VW - c, 34, VW - c, VH - 34, 10);
    ctx.restore();

    [[c + 1, c + 1], [VW - c - 1, c + 1], [c + 1, VH - c - 1], [VW - c - 1, VH - c - 1]]
      .forEach(function (p) { thiefStar(ctx, p[0], p[1], 8); });

    ctx.strokeStyle = 'rgba(200,162,74,.42)';
    ctx.lineWidth = 1.1;
    rrect(ctx, 2.5, 2.5, VW - 5, VH - 5, 14); ctx.stroke();
    rrect(ctx, FRAME - 2, FRAME - 2, VW - 2 * FRAME + 4, VH - 2 * FRAME + 4, 6); ctx.stroke();
  }

  function drawBed(ctx) {
    var x = FRAME, y = FRAME, w = VW - 2 * FRAME, h = VH - 2 * FRAME;
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, C.bed);
    g.addColorStop(0.5, '#361F12');
    g.addColorStop(1, C.bedLo);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    grain(ctx, x, y, w, h, 21, 190, 0.10);

    var s = ctx.createLinearGradient(x, 0, x + 34, 0);
    s.addColorStop(0, 'rgba(0,0,0,.6)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(x, y, 34, h);
    s = ctx.createLinearGradient(x + w, 0, x + w - 34, 0);
    s.addColorStop(0, 'rgba(0,0,0,.6)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(x + w - 34, y, 34, h);
  }

  /* Полка для снятых шашек — утопленный жёлоб вдоль борта */
  function drawShelf(ctx, player) {
    var b = trayBox(player);
    rrect(ctx, b.x, b.y, b.w, b.h, 8);
    ctx.fillStyle = '#190D06';
    ctx.fill();
    ctx.save();
    ctx.clip();
    grain(ctx, b.x, b.y, b.w, b.h, player === 'w' ? 33 : 44, 40, 0.08);
    var s = ctx.createLinearGradient(0, b.y, 0, b.y + 18);
    s.addColorStop(0, 'rgba(0,0,0,.8)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(b.x, b.y, b.w, 18);
    ctx.restore();
    ctx.strokeStyle = 'rgba(200,162,74,.28)';
    ctx.lineWidth = 1;
    rrect(ctx, b.x, b.y, b.w, b.h, 8); ctx.stroke();
    thiefStar(ctx, b.x + b.w / 2, b.y + b.h / 2, 26);
  }

  /* Надпись стоит ровно, даже если доска развёрнута на 180° */
  function label(ctx, x, y, text) {
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.rotate(Math.PI);
    ctx.fillStyle = 'rgba(214,178,104,.42)';
    ctx.font = '500 13px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '4px';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function drawBar(ctx) {
    var x = colX(6) - BAR, y = TOPY - 6, h = BOTY - TOPY + 12;
    var g = ctx.createLinearGradient(x, 0, x + BAR, 0);
    g.addColorStop(0, '#150B05');
    g.addColorStop(0.5, '#4E2D1B');
    g.addColorStop(1, '#150B05');
    rrect(ctx, x, y, BAR, h, 6);
    ctx.fillStyle = g; ctx.fill();
    ctx.save();
    ctx.clip();
    grain(ctx, x, y, BAR, h, 55, 30, 0.12);
    chevrons(ctx, x + BAR / 2, y + 22, x + BAR / 2, y + h - 22, 10);
    ctx.restore();
    ctx.strokeStyle = 'rgba(200,162,74,.26)';
    ctx.lineWidth = 1;
    rrect(ctx, x, y, BAR, h, 6); ctx.stroke();
  }

  function drawPoints(ctx) {
    var i, g, light, baseY, apexY, grd;
    for (i = 0; i < 24; i++) {
      g = geom(i);
      light = ((g.j + (g.top ? 0 : 1)) % 2) === 0;
      baseY = g.top ? TOPY : BOTY;
      apexY = g.top ? TOPY + PTH : BOTY - PTH;
      ctx.beginPath();
      ctx.moveTo(g.x + 1, baseY);
      ctx.lineTo(g.x + COL - 1, baseY);
      ctx.lineTo(g.x + COL / 2, apexY);
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
      grain(ctx, g.x, Math.min(baseY, apexY), COL, PTH, 100 + i, 12, light ? 0.07 : 0.05);
      ctx.restore();
      ctx.strokeStyle = light ? 'rgba(70,45,18,.45)' : 'rgba(0,0,0,.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    /* воровские звёзды в поле между рядами */
    thiefStar(ctx, (colX(0) + colX(5) + COL) / 2, TOPY + PTH + MID / 2, 52);
    thiefStar(ctx, (colX(6) + colX(11) + COL) / 2, TOPY + PTH + MID / 2, 52);

    /* латунная нить вдоль домов */
    ctx.strokeStyle = 'rgba(200,162,74,.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(colX(0), TOPY - 3); ctx.lineTo(colX(5) + COL, TOPY - 3);
    ctx.moveTo(colX(6), BOTY + 3); ctx.lineTo(colX(11) + COL, BOTY + 3);
    ctx.stroke();
  }

  function drawLight(ctx) {
    var g = ctx.createLinearGradient(0, 0, VW * 0.75, VH);
    g.addColorStop(0, 'rgba(255,238,208,.10)');
    g.addColorStop(0.35, 'rgba(255,238,208,.02)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    rrect(ctx, 0, 0, VW, VH, 16);
    ctx.fillStyle = g; ctx.fill();

    var v = ctx.createRadialGradient(VW / 2, VH * 0.44, VH * 0.30, VW / 2, VH * 0.5, VH * 0.9);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,.46)');
    rrect(ctx, 0, 0, VW, VH, 16);
    ctx.fillStyle = v; ctx.fill();
  }

  function render(canvas) {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    /* честная плотность экрана: на айфоне она 3, и обрезать её нельзя — мылит */
    var dpr = Math.min(global.devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    var k = w * dpr / VW;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (flip) { ctx.translate(VW, VH); ctx.rotate(Math.PI); }
    ctx.clearRect(0, 0, VW, VH);
    drawFrame(ctx);
    drawBed(ctx);
    drawShelf(ctx, 'w');
    drawShelf(ctx, 'b');
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

  /* Гранитный кубик: синий камень с крапом, прожилками и полировкой.
     Точки высверлены — тёмная лунка со светлым краем, где ловит свет. */
  function die(side, value, px) {
    var key = 'die' + side + value + px;
    if (cache[key]) return cache[key];
    cache[key] = face(px, function (ctx, s) {
      var pale = side === 'w', i, gr = rnd32(value * 13 + (pale ? 3 : 7));
      ctx.save();
      rrect(ctx, 1, 1, s - 2, s - 2, s * 0.17);
      ctx.clip();

      var g = ctx.createLinearGradient(0, 0, s * 0.85, s);
      if (pale) {
        g.addColorStop(0, '#7C93AE'); g.addColorStop(0.45, '#5A7391'); g.addColorStop(1, '#33475F');
      } else {
        g.addColorStop(0, '#42597A'); g.addColorStop(0.45, '#2B3E58'); g.addColorStop(1, '#151F2E');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);

      /* крап: гранит держится на нём */
      for (i = 0; i < Math.round(s * 6); i++) {
        var x = gr() * s, y = gr() * s, r = s * (0.004 + gr() * 0.016);
        var t = gr();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.284);
        ctx.fillStyle = t > 0.72 ? 'rgba(226,236,248,' + (0.20 + gr() * 0.5).toFixed(2) + ')'
          : t > 0.42 ? 'rgba(10,16,26,' + (0.18 + gr() * 0.45).toFixed(2) + ')'
          : 'rgba(150,172,198,' + (0.10 + gr() * 0.28).toFixed(2) + ')';
        ctx.fill();
      }

      /* прожилки */
      for (i = 0; i < 5; i++) {
        ctx.beginPath();
        var y0 = gr() * s;
        ctx.moveTo(-2, y0);
        ctx.bezierCurveTo(s * 0.3, y0 + (gr() - 0.5) * s * 0.3,
                          s * 0.7, y0 + (gr() - 0.5) * s * 0.3, s + 2, y0 + (gr() - 0.5) * s * 0.2);
        ctx.strokeStyle = gr() > 0.5 ? 'rgba(206,222,240,.13)' : 'rgba(8,14,22,.20)';
        ctx.lineWidth = 0.6 + gr() * 1.6;
        ctx.stroke();
      }

      PIPS[value].forEach(function (p) {
        var cx = p[0] / 100 * s, cy = p[1] / 100 * s, rr = s * 0.088;
        /* лунка */
        var pg = ctx.createRadialGradient(cx + rr * 0.32, cy + rr * 0.36, rr * 0.06, cx, cy, rr);
        pg.addColorStop(0, pale ? '#1B2836' : '#0A121C');
        pg.addColorStop(0.72, pale ? '#101A25' : '#060B12');
        pg.addColorStop(1, pale ? '#2C4058' : '#16212F');
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, 6.284);
        ctx.fillStyle = pg;
        ctx.fill();
        /* светлый край сверху-слева — свет на кромке отверстия */
        ctx.beginPath();
        ctx.arc(cx, cy, rr * 0.98, Math.PI * 0.9, Math.PI * 1.9);
        ctx.strokeStyle = 'rgba(216,232,250,.42)';
        ctx.lineWidth = s * 0.014;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, rr * 0.98, Math.PI * 1.9, Math.PI * 2.9);
        ctx.strokeStyle = 'rgba(6,10,16,.4)';
        ctx.lineWidth = s * 0.012;
        ctx.stroke();
      });

      /* полировка */
      var hi = ctx.createLinearGradient(0, 0, s * 0.55, s * 0.65);
      hi.addColorStop(0, 'rgba(233,243,255,' + (pale ? 0.40 : 0.24) + ')');
      hi.addColorStop(0.55, 'rgba(233,243,255,0)');
      ctx.fillStyle = hi;
      ctx.fillRect(0, 0, s, s);
      var sh = ctx.createLinearGradient(s * 0.35, s * 0.45, s, s);
      sh.addColorStop(0, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(2,6,12,.5)');
      ctx.fillStyle = sh;
      ctx.fillRect(0, 0, s, s);

      /* скол кромки */
      ctx.strokeStyle = 'rgba(222,236,252,.22)';
      ctx.lineWidth = s * 0.012;
      rrect(ctx, 2, 2, s - 4, s - 4, s * 0.16);
      ctx.stroke();
      ctx.restore();
    });
    return cache[key];
  }

  global.NardyBoard = {
    VW: VW, VH: VH, CD: CD, DD: DD, COL: COL, PTH: PTH,
    setFlip: setFlip, isFlip: isFlip, vw: vw, vh: vh, map: map,
    geom: geom, manAt: manAt, trayAt: trayAt, trayBox: trayBox, diceAt: diceAt,
    gapFor: gapFor, render: render, checker: checker, die: die
  };
})(window);
