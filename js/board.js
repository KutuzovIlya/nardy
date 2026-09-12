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

  /* ---------- оформление ----------
     Три борта, три набора шашек, три пары костей — выбирает игрок.
     trim — поясок по борту, mark — знак в углах. */
  var WOODS = {
    walnut: {                              /* орех, ёлочка, воровские звёзды */
      frameHi: '#5E3A23', frameMid: '#3B2114', frameLo: '#1E110B',
      bed: '#3E2517', bedMid: '#361F12', bedLo: '#200F07',
      barLo: '#150B05', barHi: '#4E2D1B', shelf: '#190D06',
      bone: '#D9C39B', boneMid: '#C2A97E', boneLo: '#9C8256',
      felt: '#1D5A53', feltMid: '#154742', feltLo: '#0E332F',
      trim: 'chevrons', mark: 'star'
    },
    ebony: {                               /* эбен, латунная инкрустация, бордо */
      frameHi: '#2E2622', frameMid: '#17120F', frameLo: '#070605',
      bed: '#231B17', bedMid: '#18120F', bedLo: '#0A0806',
      barLo: '#060504', barHi: '#2A221D', shelf: '#0B0807',
      bone: '#E2CFA6', boneMid: '#CDB688', boneLo: '#A68C5C',
      felt: '#6B1F26', feltMid: '#55171D', feltLo: '#360E12',
      trim: 'inlay', mark: 'stud'
    },
    oak: {                                 /* светлый дуб, витой канат, тёмные клинья */
      frameHi: '#A87842', frameMid: '#7A5228', frameLo: '#4A2F15',
      bed: '#6E4827', bedMid: '#5E3C1F', bedLo: '#3C2511',
      barLo: '#3A2410', barHi: '#8A5E30', shelf: '#2A1A0C',
      bone: '#F0E2C2', boneMid: '#DCC79C', boneLo: '#B89C68',
      felt: '#3A2416', feltMid: '#2C1B10', feltLo: '#1A0F08',
      trim: 'rope', mark: 'star'
    }
  };
  var STYLE = { wood: 'walnut', men: 'turned', dice: 'ember' };
  var C = WOODS.walnut;

  /* Сменить оформление: картинки шашек и костей рисуются заново */
  function setStyle(st) {
    if (st.wood && WOODS[st.wood]) STYLE.wood = st.wood;
    if (st.men && /^(turned|inlay|stone)$/.test(st.men)) STYLE.men = st.men;
    if (st.dice && /^(ember|bone|brass)$/.test(st.dice)) STYLE.dice = st.dice;
    C = WOODS[STYLE.wood];
    cache = {};
  }

  function vw() { return VW; }
  function vh() { return VH; }

  /* Из координат доски — в координаты экрана. Доска не разворачивается:
     головы стоят на своих местах при любом цвете игрока. */
  function map(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }

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

  /* Латунная инкрустация: тонкая полоса с тёмной окантовкой и заклёпки */
  function inlay(ctx, x0, y0, x1, y1) {
    var len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0), t;
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, -2.6, len, 5.2);
    var g = ctx.createLinearGradient(0, -1.6, 0, 1.6);
    g.addColorStop(0, '#F1D98F'); g.addColorStop(.5, '#C8A24A'); g.addColorStop(1, '#7A5A1E');
    ctx.fillStyle = g;
    ctx.fillRect(0, -1.6, len, 3.2);
    for (t = 24; t < len - 12; t += 48) stud(ctx, t, 0, 3.4);
    ctx.restore();
  }

  function stud(ctx, x, y, r) {
    var g = ctx.createRadialGradient(x - r * .35, y - r * .35, r * .1, x, y, r);
    g.addColorStop(0, '#FFF0C0'); g.addColorStop(.5, '#D9B560'); g.addColorStop(1, '#6F5418');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.284);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = .8;
    ctx.stroke();
  }

  /* Витой канат: частые косые насечки — будто верёвка вдоль борта */
  function rope(ctx, x0, y0, x1, y1) {
    var len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0), t;
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(ang);
    for (t = 0; t < len; t += 6) {
      (function (tt) {
        cut(ctx, function (c) {
          c.beginPath();
          c.moveTo(tt - 2.5, -4.5);
          c.quadraticCurveTo(tt + 1.5, 0, tt + 2.5, 4.5);
          c.stroke();
        }, 0.7, 0.30);
      })(t);
    }
    ctx.restore();
  }

  function trim(ctx, x0, y0, x1, y1) {
    if (C.trim === 'inlay') inlay(ctx, x0, y0, x1, y1);
    else if (C.trim === 'rope') rope(ctx, x0, y0, x1, y1);
    else chevrons(ctx, x0, y0, x1, y1, 10);
  }

  function mark(ctx, x, y, r) {
    if (C.mark === 'stud') stud(ctx, x, y, r * .7);
    else thiefStar(ctx, x, y, r);
  }

  /* ---------- части доски ---------- */

  function drawFrame(ctx) {
    var g = ctx.createLinearGradient(0, 0, VW * 0.6, VH);
    g.addColorStop(0, C.frameHi);
    g.addColorStop(0.45, C.frameMid);
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
    trim(ctx, 34, c, VW - 34, c);
    trim(ctx, VW - 34, VH - c, 34, VH - c);
    trim(ctx, c, VH - 34, c, 34);
    trim(ctx, VW - c, 34, VW - c, VH - 34);
    ctx.restore();

    [[c + 1, c + 1], [VW - c - 1, c + 1], [c + 1, VH - c - 1], [VW - c - 1, VH - c - 1]]
      .forEach(function (p) { mark(ctx, p[0], p[1], 8); });

    ctx.strokeStyle = 'rgba(200,162,74,.42)';
    ctx.lineWidth = 1.1;
    rrect(ctx, 2.5, 2.5, VW - 5, VH - 5, 14); ctx.stroke();
    rrect(ctx, FRAME - 2, FRAME - 2, VW - 2 * FRAME + 4, VH - 2 * FRAME + 4, 6); ctx.stroke();
  }

  function drawBed(ctx) {
    var x = FRAME, y = FRAME, w = VW - 2 * FRAME, h = VH - 2 * FRAME;
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, C.bed);
    g.addColorStop(0.5, C.bedMid);
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
    ctx.fillStyle = C.shelf;
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
    if (C.mark === 'stud') rosette(ctx, b.x + b.w / 2, b.y + b.h / 2, 26, 16);
    else thiefStar(ctx, b.x + b.w / 2, b.y + b.h / 2, 26);
  }

  function drawBar(ctx) {
    var x = colX(6) - BAR, y = TOPY - 6, h = BOTY - TOPY + 12;
    var g = ctx.createLinearGradient(x, 0, x + BAR, 0);
    g.addColorStop(0, C.barLo);
    g.addColorStop(0.5, C.barHi);
    g.addColorStop(1, C.barLo);
    rrect(ctx, x, y, BAR, h, 6);
    ctx.fillStyle = g; ctx.fill();
    ctx.save();
    ctx.clip();
    grain(ctx, x, y, BAR, h, 55, 30, 0.12);
    trim(ctx, x + BAR / 2, y + 22, x + BAR / 2, y + h - 22);
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
    /* золотой герб в поле между рядами, по одному на половину */
    var my = TOPY + PTH + MID / 2;
    if (gerb) {
      drawGerb(ctx, (colX(0) + colX(5) + COL) / 2, my, MID * 0.96);
      drawGerb(ctx, (colX(6) + colX(11) + COL) / 2, my, MID * 0.96);
    } else {
      thiefStar(ctx, (colX(0) + colX(5) + COL) / 2, my, 52);
      thiefStar(ctx, (colX(6) + colX(11) + COL) / 2, my, 52);
    }

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
    ctx.clearRect(0, 0, VW, VH);
    drawFrame(ctx);
    drawBed(ctx);
    drawShelf(ctx, 'w');
    drawShelf(ctx, 'b');
    drawPoints(ctx);
    drawBar(ctx);
    drawLight(ctx);
  }

  /* ---------- герб ---------- */

  var gerb = null;

  /* Официальный герб — общественное достояние (исходник — assets/gerb.svg).
     В gerb.png он уже перекрашен в золото: из герба взято только светлое —
     орёл без красного щита, сверху светлее, снизу темнее. Так он ложится
     в дерево инкрустацией, а грузится в шесть раз легче исходника. */
  function loadArt(done) {
    var im = new global.Image();
    im.onload = function () {
      gerb = im;
      if (done) done();
    };
    im.onerror = function () { if (done) done(); };
    im.src = 'assets/gerb.png';
  }

  /* Инкрустация: тёмный отпечаток снизу, золото сверху, блик по краю */
  function drawGerb(ctx, cx, cy, h) {
    if (!gerb) return;
    var w = h * gerb.width / gerb.height;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.filter = 'blur(1.5px) brightness(0)';
    ctx.drawImage(gerb, cx - w / 2 + 2.5, cy - h / 2 + 3, w, h);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.drawImage(gerb, cx - w / 2, cy - h / 2, w, h);
    ctx.globalAlpha = 0.30;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(gerb, cx - w / 2 - 1, cy - h / 2 - 1.5, w, h);
    ctx.restore();
  }

  /* ---------- шашки и кости картинками ---------- */

  var cache = {};

  function face(px, paint) {
    var cv = global.document.createElement('canvas');
    cv.width = cv.height = px;
    paint(cv.getContext('2d'), px);
    return cv.toDataURL('image/png');
  }

  function checker(side, px) {
    var key = 'man' + STYLE.men + side + px;
    if (cache[key]) return cache[key];
    var paint = STYLE.men === 'inlay' ? inlaidMan : STYLE.men === 'stone' ? stoneMan : turnedMan;
    cache[key] = face(px, function (ctx, s) { paint(ctx, s, side === 'w'); });
    return cache[key];
  }

  /* Гладкая шашка: полированная кость или эбен, латунный поясок и латунная
     вставка посередине с гравированной звездой */
  function inlaidMan(ctx, s, bone) {
    var r = s / 2, i, a;
    ctx.save();
    ctx.beginPath(); ctx.arc(r, r, r - 1, 0, 6.284); ctx.clip();
    var g = ctx.createRadialGradient(r * .62, r * .55, r * .08, r, r, r);
    if (bone) { g.addColorStop(0, '#FFFBF0'); g.addColorStop(.5, '#EFE0BE'); g.addColorStop(1, '#B89A68'); }
    else { g.addColorStop(0, '#4A423C'); g.addColorStop(.5, '#1E1A17'); g.addColorStop(1, '#060505'); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    /* латунный поясок */
    ctx.beginPath(); ctx.arc(r, r, r * .7, 0, 6.284);
    ctx.lineWidth = s * .035;
    ctx.strokeStyle = '#C8A24A';
    ctx.stroke();
    ctx.beginPath(); ctx.arc(r, r - s * .006, r * .7, 0, 6.284);
    ctx.lineWidth = s * .012;
    ctx.strokeStyle = 'rgba(255,240,190,.7)';
    ctx.stroke();
    /* вставка */
    var b = ctx.createRadialGradient(r * .85, r * .8, 1, r, r, r * .36);
    b.addColorStop(0, '#FFF0C0'); b.addColorStop(.55, '#D9B560'); b.addColorStop(1, '#8A6A24');
    ctx.beginPath(); ctx.arc(r, r, r * .36, 0, 6.284);
    ctx.fillStyle = b;
    ctx.fill();
    ctx.save();
    ctx.translate(r, r);
    ctx.strokeStyle = 'rgba(60,40,10,.7)';
    ctx.lineWidth = s * .014;
    for (i = 0; i < 8; i++) {
      a = i * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * .06, Math.sin(a) * r * .06);
      ctx.lineTo(Math.cos(a) * r * .28, Math.sin(a) * r * .28);
      ctx.stroke();
    }
    ctx.restore();
    /* блик полировки */
    var hi = ctx.createLinearGradient(0, 0, s * .6, s * .7);
    hi.addColorStop(0, bone ? 'rgba(255,255,250,.6)' : 'rgba(255,245,225,.22)');
    hi.addColorStop(.5, 'rgba(255,255,250,0)');
    ctx.fillStyle = hi;
    ctx.fillRect(0, 0, s, s);
    var sh = ctx.createRadialGradient(r, r, r * .78, r, r, r);
    sh.addColorStop(0, 'rgba(0,0,0,0)');
    sh.addColorStop(1, bone ? 'rgba(70,48,18,.45)' : 'rgba(0,0,0,.7)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, s, s);
    ctx.restore();
  }

  /* Каменная шашка: белый мрамор с прожилками или чёрный гранит с крапом,
     скошенный край */
  function stoneMan(ctx, s, white) {
    var r = s / 2, i, gr = rnd32(white ? 77 : 91);
    ctx.save();
    ctx.beginPath(); ctx.arc(r, r, r - 1, 0, 6.284); ctx.clip();
    var g = ctx.createRadialGradient(r * .7, r * .62, r * .1, r, r, r);
    if (white) { g.addColorStop(0, '#FFFFFB'); g.addColorStop(.6, '#E6E1D8'); g.addColorStop(1, '#A8A196'); }
    else { g.addColorStop(0, '#4A4B50'); g.addColorStop(.6, '#232427'); g.addColorStop(1, '#0B0B0C'); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    if (white) {
      /* прожилки мрамора */
      for (i = 0; i < 7; i++) {
        ctx.beginPath();
        var y0 = gr() * s, y1 = gr() * s;
        ctx.moveTo(0, y0);
        ctx.bezierCurveTo(s * .3, y0 + (gr() - .5) * s * .5, s * .7, y1 + (gr() - .5) * s * .5, s, y1);
        ctx.strokeStyle = 'rgba(110,105,100,' + (.12 + gr() * .2).toFixed(2) + ')';
        ctx.lineWidth = s * (.004 + gr() * .012);
        ctx.stroke();
      }
    } else {
      /* крап гранита */
      for (i = 0; i < s * 2.2; i++) {
        ctx.beginPath();
        ctx.arc(gr() * s, gr() * s, s * (.004 + gr() * .012), 0, 6.284);
        ctx.fillStyle = gr() > .55 ? 'rgba(210,210,215,' + (.1 + gr() * .3).toFixed(2) + ')' : 'rgba(0,0,0,.45)';
        ctx.fill();
      }
    }
    /* скошенный край: светлая фаска сверху, тень снизу */
    ctx.beginPath(); ctx.arc(r, r, r * .86, 0, 6.284);
    ctx.lineWidth = s * .05;
    var bev = ctx.createLinearGradient(0, 0, 0, s);
    bev.addColorStop(0, white ? 'rgba(255,255,255,.7)' : 'rgba(200,200,210,.25)');
    bev.addColorStop(1, 'rgba(0,0,0,.35)');
    ctx.strokeStyle = bev;
    ctx.stroke();
    var hi = ctx.createLinearGradient(0, 0, s * .6, s * .7);
    hi.addColorStop(0, white ? 'rgba(255,255,255,.45)' : 'rgba(230,235,245,.18)');
    hi.addColorStop(.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = hi;
    ctx.fillRect(0, 0, s, s);
    ctx.restore();
  }

  /* Точёная шашка: фаска, две канавки и резная звезда посередине */
  function turnedMan(ctx, s, bone) {
    (function (ctx, s) {
      var r = s / 2, i, a;
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
    })(ctx, s);
  }

  var PIPS = {
    1: [[50, 50]],
    2: [[27, 27], [73, 73]],
    3: [[27, 27], [50, 50], [73, 73]],
    4: [[27, 27], [73, 27], [27, 73], [73, 73]],
    5: [[27, 27], [73, 27], [50, 50], [27, 73], [73, 73]],
    6: [[27, 25], [73, 25], [27, 50], [73, 50], [27, 75], [73, 75]]
  };

  function die(side, value, px) {
    var key = 'die' + STYLE.dice + side + value + px;
    if (cache[key]) return cache[key];
    var paint = STYLE.dice === 'bone' ? boneDie : STYLE.dice === 'brass' ? brassDie : emberDie;
    cache[key] = face(px, function (ctx, s) { paint(ctx, s, value); });
    return cache[key];
  }

  /* Лунка точки: тёмное дно и светлый край снизу — будто высверлена */
  function drill(ctx, cx, cy, rr, dark, rim) {
    var g = ctx.createRadialGradient(cx - rr * .25, cy - rr * .3, rr * .1, cx, cy, rr);
    g.addColorStop(0, dark[0]); g.addColorStop(.8, dark[1]); g.addColorStop(1, dark[2]);
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.284);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, rr, .15 * Math.PI, .85 * Math.PI);
    ctx.strokeStyle = rim;
    ctx.lineWidth = rr * .28;
    ctx.stroke();
  }

  /* Кость: старая слоновая, чуть желтоватая, точки высверлены и затёрты чернью */
  function boneDie(ctx, s, value) {
    var i, gr = rnd32(value * 13 + 3);
    ctx.save();
    rrect(ctx, 1, 1, s - 2, s - 2, s * .17); ctx.clip();
    var g = ctx.createLinearGradient(0, 0, s * .8, s);
    g.addColorStop(0, '#FFF8E6'); g.addColorStop(.5, '#EEDDB8'); g.addColorStop(1, '#C8AE7E');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    for (i = 0; i < 14; i++) {
      ctx.beginPath();
      var y = gr() * s;
      ctx.moveTo(0, y);
      ctx.lineTo(s, y + (gr() - .5) * s * .2);
      ctx.strokeStyle = 'rgba(150,120,70,' + (.05 + gr() * .08).toFixed(2) + ')';
      ctx.lineWidth = s * (.004 + gr() * .01);
      ctx.stroke();
    }
    PIPS[value].forEach(function (p) {
      drill(ctx, p[0] / 100 * s, p[1] / 100 * s, s * .08, ['#3A2A18', '#140C06', '#2A1C0E'], 'rgba(255,245,220,.55)');
    });
    var hi = ctx.createLinearGradient(0, 0, s * .5, s * .55);
    hi.addColorStop(0, 'rgba(255,255,250,.45)'); hi.addColorStop(.6, 'rgba(255,255,250,0)');
    ctx.fillStyle = hi;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(120,90,50,.35)';
    ctx.lineWidth = s * .012;
    rrect(ctx, 2, 2, s - 4, s - 4, s * .16); ctx.stroke();
    ctx.restore();
  }

  /* Латунь: шлифованный металл, точки залиты чёрной эмалью */
  function brassDie(ctx, s, value) {
    var i, gr = rnd32(value * 7 + 11);
    ctx.save();
    rrect(ctx, 1, 1, s - 2, s - 2, s * .17); ctx.clip();
    var g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, '#F6E2A0'); g.addColorStop(.4, '#D2AE58'); g.addColorStop(.75, '#A8822E'); g.addColorStop(1, '#6F5418');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    for (i = 0; i < 40; i++) {
      ctx.beginPath();
      var y = gr() * s;
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.strokeStyle = gr() > .5 ? 'rgba(255,245,210,.10)' : 'rgba(80,55,10,.10)';
      ctx.lineWidth = s * .006;
      ctx.stroke();
    }
    PIPS[value].forEach(function (p) {
      drill(ctx, p[0] / 100 * s, p[1] / 100 * s, s * .08, ['#2A2622', '#0A0908', '#1A1612'], 'rgba(255,240,190,.6)');
    });
    var hi = ctx.createLinearGradient(0, 0, s * .5, s * .55);
    hi.addColorStop(0, 'rgba(255,250,230,.4)'); hi.addColorStop(.6, 'rgba(255,250,230,0)');
    ctx.fillStyle = hi;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(90,60,10,.5)';
    ctx.lineWidth = s * .014;
    rrect(ctx, 2, 2, s - 4, s - 4, s * .16); ctx.stroke();
    ctx.restore();
  }

  /* Чёрный камень со светящимися точками. Точка — не дырка, а огонёк:
     сначала ореол вокруг, потом тело, потом добела горячая середина. */
  function emberDie(ctx, s, value) {
    (function (ctx, s) {
      var i, gr = rnd32(value * 17 + 5);
      ctx.save();
      rrect(ctx, 1, 1, s - 2, s - 2, s * 0.17);
      ctx.clip();

      var g = ctx.createLinearGradient(0, 0, s * 0.8, s);
      g.addColorStop(0, '#2A2A2E');
      g.addColorStop(0.45, '#161618');
      g.addColorStop(1, '#070708');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);

      /* камень: редкий крап и матовые разводы */
      for (i = 0; i < Math.round(s * 3); i++) {
        var x = gr() * s, y = gr() * s, r = s * (0.003 + gr() * 0.012);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.284);
        ctx.fillStyle = gr() > 0.5
          ? 'rgba(190,195,205,' + (0.05 + gr() * 0.16).toFixed(2) + ')'
          : 'rgba(0,0,0,' + (0.2 + gr() * 0.4).toFixed(2) + ')';
        ctx.fill();
      }

      PIPS[value].forEach(function (p) {
        var cx = p[0] / 100 * s, cy = p[1] / 100 * s, rr = s * 0.082;

        /* ореол */
        var halo = ctx.createRadialGradient(cx, cy, rr * 0.4, cx, cy, rr * 3.1);
        halo.addColorStop(0, 'rgba(255,196,92,.55)');
        halo.addColorStop(0.45, 'rgba(255,170,60,.18)');
        halo.addColorStop(1, 'rgba(255,150,40,0)');
        ctx.beginPath();
        ctx.arc(cx, cy, rr * 3.1, 0, 6.284);
        ctx.fillStyle = halo;
        ctx.fill();

        /* тело огонька */
        var core = ctx.createRadialGradient(cx - rr * 0.2, cy - rr * 0.2, rr * 0.08, cx, cy, rr);
        core.addColorStop(0, '#FFFDF2');
        core.addColorStop(0.42, '#FFDE9A');
        core.addColorStop(0.82, '#E8A63A');
        core.addColorStop(1, '#9A5F12');
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, 6.284);
        ctx.fillStyle = core;
        ctx.fill();

        /* добела горячая середина */
        ctx.beginPath();
        ctx.arc(cx - rr * 0.16, cy - rr * 0.18, rr * 0.34, 0, 6.284);
        ctx.fillStyle = 'rgba(255,255,250,.92)';
        ctx.fill();
      });

      /* полировка по верхней грани */
      var hi = ctx.createLinearGradient(0, 0, s * 0.5, s * 0.55);
      hi.addColorStop(0, 'rgba(226,232,244,.22)');
      hi.addColorStop(0.6, 'rgba(226,232,244,0)');
      ctx.fillStyle = hi;
      ctx.fillRect(0, 0, s, s);

      ctx.strokeStyle = 'rgba(206,214,230,.20)';
      ctx.lineWidth = s * 0.012;
      rrect(ctx, 2, 2, s - 4, s - 4, s * 0.16);
      ctx.stroke();
      ctx.restore();
    })(ctx, s);
  }

  global.NardyBoard = {
    VW: VW, VH: VH, CD: CD, DD: DD, COL: COL, PTH: PTH,
    vw: vw, vh: vh, map: map, loadArt: loadArt, setStyle: setStyle, style: function () { return STYLE; },
    geom: geom, manAt: manAt, trayAt: trayAt, trayBox: trayBox, diceAt: diceAt,
    gapFor: gapFor, render: render, checker: checker, die: die
  };
})(window);
