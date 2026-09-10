#!/usr/bin/env node
// 角色精灵生成器 v7 —— 真·像素画
// ==================================================================
// v6 以前是"矢量画 → 超采样 → 缩小 → 量化 → 描边"，缩下来之后头上一块
// 大阴影、瞪眼、糊发块，人像一颗土豆。这版彻底换路子：
//
//   * 在 32×42 的【逐像素】画布上一个点一个点地画（星露谷那种 Q 版比例），
//     再 ×3 放大成游戏要的 96×126 一帧 —— 一个逻辑像素正好等于地面
//     的 3px 颗粒，整张画面像素密度一致。
//   * 零依赖：自己写 PNG 编码（zlib 是 Node 内置的），不再需要 pillow。
//   * 头 / 身 / 发 / 服 / 五官 全部是可组合的部件；主角六人手写，
//     6~15 行按确定性哈希从部件库里生成（游戏里存的只是行号）。
//
// 用法：
//   node tools/character_gen.js            # 出 assets/sprites/cast96.png + 预览
//   node tools/character_gen.js --embed    # 同时把 base64 写回 games/sim/index.html
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const LW = 32, LH = 42, SCALE = 3, ATLAS_ROWS = 16;
const ROOT = path.resolve(__dirname, '..');

// ---------------- 调色板 ----------------
const OL = [40, 30, 28];                       // 描边：暖黑，不用纯黑
const SKIN = {
  fair:  { a: [246, 212, 178], b: [220, 168, 128] },
  warm:  { a: [236, 194, 152], b: [204, 148, 104] },
  tan:   { a: [214, 166, 122], b: [176, 124, 84]  },
  old:   { a: [226, 196, 164], b: [190, 152, 118] },
};
const BLUSH = [236, 150, 140];
const EYEW  = [252, 248, 240];
const HAIR = {
  black:    { a: [50, 44, 50],    b: [82, 74, 82]    },
  darkbrown:{ a: [84, 56, 42],    b: [122, 86, 62]   },
  chestnut: { a: [132, 84, 50],   b: [176, 120, 74]  },
  auburn:   { a: [172, 88, 50],   b: [216, 130, 78]  },
  ash:      { a: [106, 96, 88],   b: [146, 136, 126] },
  gray:     { a: [172, 166, 158], b: [212, 208, 200] },
  white:    { a: [214, 210, 202], b: [240, 238, 232] },
  honey:    { a: [190, 150, 86],  b: [228, 196, 126] },
};
const CLOTH = {
  indigo: { a: [86, 104, 150],  b: [62, 76, 114]   },
  teal:   { a: [108, 148, 140], b: [76, 110, 104]  },
  plum:   { a: [130, 104, 154], b: [96, 76, 118]   },
  ochre:  { a: [176, 136, 74],  b: [134, 100, 52]  },
  moss:   { a: [112, 132, 90],  b: [80, 96, 64]    },
  rust:   { a: [172, 96, 74],   b: [130, 68, 54]   },
  sand:   { a: [206, 184, 148], b: [170, 148, 114] },
  slate:  { a: [104, 110, 124], b: [76, 80, 94]    },
  cream:  { a: [238, 230, 210], b: [204, 194, 170] },
  snow:   { a: [244, 240, 232], b: [206, 200, 190] },
  lilac:  { a: [214, 206, 230], b: [176, 168, 196] },
  sky:    { a: [200, 214, 228], b: [162, 176, 196] },
  mint:   { a: [214, 232, 224], b: [172, 194, 186] },
  ink:    { a: [58, 56, 66],    b: [40, 38, 46]    },
  navy:   { a: [56, 66, 92],    b: [38, 44, 64]    },
  earth:  { a: [94, 78, 62],    b: [66, 54, 44]    },
  coal:   { a: [66, 60, 56],    b: [46, 42, 40]    },
  gold:   { a: [222, 176, 88],  b: [178, 132, 56]  },
  red:    { a: [186, 78, 62],   b: [140, 54, 46]   },
  pink:   { a: [216, 140, 150], b: [176, 100, 112] },
  green:  { a: [104, 140, 96],  b: [72, 102, 68]   },
  wood:   { a: [150, 110, 70],  b: [104, 74, 46]   },
};
const SHOE  = { a: [128, 94, 70], b: [84, 60, 48] };
const IRIS  = { brown: [72, 46, 38], black: [44, 36, 40], blue: [56, 72, 104], green: [62, 92, 70], amber: [130, 84, 40] };

// ---------------- 体型 ----------------
// 头都是 14×13，靠躯干宽度和腿长来分体型。dy 是整体下沉（人矮了脚还是踩地）。
const BUILD = {
  std:   { dy: 0, torsoW: 12, legW: 4, stoop: 0 },
  slim:  { dy: 0, torsoW: 10, legW: 3, stoop: 0 },
  stout: { dy: 0, torsoW: 14, legW: 5, stoop: 0 },
  young: { dy: 2, torsoW: 10, legW: 3, stoop: 0 },
  elder: { dy: 2, torsoW: 12, legW: 4, stoop: 1 },
};

// ---------------- 画布 ----------------
class Px {
  constructor() { this.d = new Array(LW * LH).fill(null); }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < LW && y < LH && c) this.d[y * LW + x] = c; }
  get(x, y) { return (x >= 0 && y >= 0 && x < LW && y < LH) ? this.d[y * LW + x] : null; }
  rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  outline() {                                   // 四邻域膨胀一圈描边
    const src = this.d.slice();
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      if (src[y * LW + x]) continue;
      const n = (x > 0 && src[y * LW + x - 1]) || (x < LW - 1 && src[y * LW + x + 1]) ||
                (y > 0 && src[(y - 1) * LW + x]) || (y < LH - 1 && src[(y + 1) * LW + x]);
      if (n) this.d[y * LW + x] = OL;
    }
  }
}

// ---------------- 部件绘制 ----------------
// 走路帧：[站, 左脚抬, 站, 右脚抬]。抬脚那两帧身子上浮 1px，手臂 / 裙摆反向摆。
const WALK = [
  { bob: 0,  lift: 0,  swing: 0 },
  { bob: -1, lift: -1, swing: 1 },
  { bob: 0,  lift: 0,  swing: 0 },
  { bob: -1, lift: +1, swing: -1 },
];

function draw(spec, fr) {
  const px = new Px();
  const b = BUILD[spec.build || 'std'];
  const W = WALK[fr];
  const B = W.bob + b.dy;                       // 上半身整体位移
  const cx = 16;                                // 中线在 15|16 之间，宽度都用偶数
  const skin = SKIN[spec.skin || 'fair'], hair = HAIR[spec.hair || 'darkbrown'];
  const cloth = CLOTH[spec.cloth || 'indigo'], inner = CLOTH[spec.inner || 'cream'];
  const belt = CLOTH[spec.belt || 'rust'], trous = CLOTH[spec.trousers || 'coal'];
  const outfit = spec.outfit || 'duanda';
  const iris = IRIS[spec.iris || 'brown'];

  // 关键行：头 7~19，颈 20，躯干 21~30，臀 31，脚底 40（std 体型）
  const hy0 = 7 + B + b.stoop, hy1 = hy0 + 12;
  const hx0 = cx - 7, hx1 = cx + 6;              // 9..22
  const tY0 = 21 + B, tY1 = 30 + B;
  const tw = b.torsoW, tx0 = cx - tw / 2, tx1 = cx + tw / 2 - 1;
  const hipY = 31 + B;                           // 大腿起点
  const footY = 40;                              // 脚底始终踩地
  const wideSleeve = outfit !== 'duanda';
  const ax0 = tx0 - (wideSleeve ? 4 : 2), ax1 = tx1 + (wideSleeve ? 4 : 2);   // 袖子外缘

  // ---- 后层头发（长发/双马尾垂在身后的部分）----
  hairBack(px, spec, hair, hx0, hx1, hy0, B);

  // ---- 腿 + 鞋 ----
  const lw = b.legW;
  const legs = [
    { x0: cx - 1 - lw, x1: cx - 2, lift: W.lift < 0 ? -1 : 0, c: trous.a },
    { x0: cx + 1,      x1: cx + lw, lift: W.lift > 0 ? -1 : 0, c: trous.b },
  ];
  for (const L of legs) {
    const fy = footY + L.lift;                   // 抬起的脚底高 1px
    px.rect(L.x0, hipY, L.x1, fy - 2, L.c);
    if (outfit === 'duanda') px.rect(L.x0, fy - 6, L.x1, fy - 2, CLOTH.sand.a);   // 行縢
    if (outfit === 'duanda') px.rect(L.x0, fy - 6, L.x1, fy - 6, CLOTH.sand.b);
    px.rect(L.x0 - 1, fy - 1, L.x1 + 1, fy - 1, SHOE.a);                        // 鞋面
    px.rect(L.x0 - 1, fy, L.x1 + 1, fy, SHOE.b);                                // 鞋底
  }

  // ---- 躯干 + 下装 ----
  if (outfit === 'ruqun') {
    // 襦裙：高腰、裙摆外扩到脚踝，露两格小腿
    const waist = tY0 + 5, hem = footY - 4;
    px.rect(tx0, tY0, tx1, waist - 1, inner.a);
    px.rect(tx1 - 2, tY0, tx1, waist - 1, inner.b);                      // 右侧受光背面
    skirt(px, cx, tw, waist, hem, cloth, belt, W.swing);
    px.rect(tx0 - 1, waist - 1, tx1 + 1, waist - 1, belt.a);
    px.rect(tx0 - 1, waist,     tx1 + 1, waist,     belt.b);
    px.rect(cx + 1, waist + 1, cx + 1, waist + 5, belt.b);              // 垂下的绦
    collar(px, cx, tY0, inner.a, inner.b, cloth.b);
  } else if (outfit === 'changshan' || outfit === 'daopao') {
    // 长衫 / 道袍：一色到底，腰带在中段
    const waist = tY0 + 7, hem = footY - 4;
    px.rect(tx0, tY0, tx1, waist - 1, cloth.a);
    px.rect(tx1 - 2, tY0, tx1, waist - 1, cloth.b);
    skirt(px, cx, tw, waist, hem, cloth, null, W.swing, outfit === 'daopao' ? 2 : 1);
    px.rect(tx0 - 1, waist - 1, tx1 + 1, waist - 1, belt.a);
    px.rect(tx0 - 1, waist,     tx1 + 1, waist,     belt.b);
    collar(px, cx, tY0, inner.a, inner.b, cloth.b);
  } else {
    // 短打：短褂到臀，腰带压住褂尾
    px.rect(tx0, tY0, tx1, tY1 - 1, cloth.a);
    px.rect(tx1 - 2, tY0, tx1, tY1 - 1, cloth.b);
    px.rect(tx0, tY1, tx1, tY1, cloth.b);
    px.rect(tx0 - 1, tY1 - 2, tx1 + 1, tY1 - 2, belt.a);
    px.rect(tx0 - 1, tY1 - 1, tx1 + 1, tY1 - 1, belt.b);
    collar(px, cx, tY0, inner.a, inner.b, cloth.b);
  }
  // 肩头削两角，别画成方箱子
  px.d[tY0 * LW + tx0] = null; px.d[tY0 * LW + tx1] = null;

  // ---- 手臂 / 袖子 ----
  for (const s of [-1, 1]) {
    const sw = s * W.swing;                                  // 左右手反向摆
    if (wideSleeve) {
      const x0 = s < 0 ? ax0 : tx1 + 1, x1 = s < 0 ? tx0 - 1 : ax1;
      const top = tY0 + 1, bot = tY0 + 10 + (outfit === 'daopao' ? 1 : 0);
      px.rect(x0, top, x1, bot, s < 0 ? cloth.a : cloth.b);
      px.rect(x0, top, x1, top, cloth.a);                     // 肩线
      px.rect(x0, bot, x1, bot, s < 0 ? cloth.b : CLOTH.ink.a); // 袖口
      // 袖口露出一点手
      const hx = s < 0 ? x1 - 1 : x0;
      px.rect(hx, bot - 1, hx + 1, bot - 1, skin.a);
    } else {
      const x0 = s < 0 ? ax0 : tx1 + 1, x1 = s < 0 ? tx0 - 1 : ax1;
      const top = tY0 + 1 + sw, bot = tY0 + 7 + sw;
      px.rect(x0, top, x1, bot, s < 0 ? cloth.a : cloth.b);
      px.rect(x0, bot + 1, x1, bot + 2, s < 0 ? skin.a : skin.b);   // 手
    }
  }

  // ---- 颈 ----
  if (!b.stoop) px.rect(cx - 2, hy1 + 1, cx + 1, hy1 + 1, skin.b);

  // ---- 头 ----
  px.rect(hx0 + 2, hy0, hx1 - 2, hy0, skin.a);
  px.rect(hx0 + 1, hy0 + 1, hx1 - 1, hy0 + 1, skin.a);
  px.rect(hx0, hy0 + 2, hx1, hy1 - 2, skin.a);
  px.rect(hx0 + 1, hy1 - 1, hx1 - 1, hy1 - 1, skin.a);
  px.rect(hx0 + 3, hy1, hx1 - 3, hy1, skin.a);
  px.rect(hx1, hy0 + 4, hx1, hy1 - 2, skin.b);              // 右脸颊背光
  px.rect(hx1 - 1, hy1 - 1, hx1 - 1, hy1 - 1, skin.b);
  px.rect(hx0 + 3, hy1, hx1 - 3, hy1, skin.b);              // 下巴阴影
  if (spec.ears) { px.rect(hx0 - 1, hy0 + 7, hx0 - 1, hy0 + 8, skin.b); px.rect(hx1 + 1, hy0 + 7, hx1 + 1, hy0 + 8, skin.b); }

  face(px, spec, skin, iris, hair, cx, hy0);
  hairFront(px, spec, hair, hx0, hx1, hy0);
  if (spec.beard) beard(px, spec, hx0, hx1, hy0);
  if (spec.cane) {
    const x = ax1 + 2, y0 = tY0 + 8, y1 = footY;
    px.rect(x, y0, x, y1, CLOTH.wood.a); px.rect(x - 1, y0, x, y0, CLOTH.wood.b);
  }

  px.outline();
  return px;
}

// 裙/袍下摆：从腰到 hem 逐渐外扩，右侧两列背光，最后一行是襕边
function skirt(px, cx, tw, waist, hem, cloth, trim, sway, flare = 1) {
  const rows = hem - waist + 1;
  for (let i = 0; i < rows; i++) {
    const y = waist + 1 + i;
    if (y > hem) break;
    const grow = Math.min(2 + flare, Math.floor(i / (flare === 2 ? 2 : 3)));
    let x0 = cx - tw / 2 - grow, x1 = cx + tw / 2 - 1 + grow;
    if (y >= hem - 1) { x0 += sway < 0 ? -1 : 0; x1 += sway > 0 ? 1 : 0; }
    px.rect(x0, y, x1, y, cloth.a);
    px.rect(x1 - 2, y, x1, y, cloth.b);
  }
  px.rect(cx - tw / 2 - 3, hem, cx + tw / 2 + 2, hem, cloth.b);
  if (trim) px.rect(cx - tw / 2 - 3 + 1, hem, cx + tw / 2 + 2 - 1, hem, trim.b);
}

// 交领右衽：浅色内衬画一个 V，再压一道深色衣缘
function collar(px, cx, tY0, ia, ib, edge) {
  px.set(cx - 3, tY0, ia); px.set(cx + 2, tY0, ia);
  px.set(cx - 2, tY0 + 1, ia); px.set(cx + 1, tY0 + 1, ia);
  px.set(cx - 1, tY0 + 2, ia); px.set(cx, tY0 + 2, ib);
  px.set(cx, tY0 + 3, edge); px.set(cx, tY0 + 4, edge);
}

function face(px, spec, skin, iris, hair, cx, hy0) {
  const ey = hy0 + 6;                                  // 眼睛顶行
  const eyes = spec.eye || 'round';
  const lx = cx - 4, rx = cx + 2;                      // 左右眼左列：12 / 18
  for (const ex of [lx, rx]) {
    if (eyes === 'smile') {                            // 眯起来笑
      px.set(ex - 1, ey + 1, OL); px.set(ex, ey, OL); px.set(ex + 1, ey + 1, OL);
    } else if (eyes === 'squint') {                    // 老人的细眼
      px.rect(ex, ey + 1, ex + 1, ey + 1, OL);
      px.rect(ex, ey + 2, ex + 1, ey + 2, skin.b);
    } else if (eyes === 'big') {                       // 大眼：多一行眼白
      px.rect(ex, ey - 1, ex + 1, ey - 1, OL);
      px.set(ex, ey, EYEW); px.set(ex + 1, ey, iris);
      px.set(ex, ey + 1, EYEW); px.set(ex + 1, ey + 1, iris);
      px.set(ex, ey + 2, EYEW); px.set(ex + 1, ey + 2, iris);
    } else if (eyes === 'beady') {                     // 小豆眼
      px.rect(ex, ey, ex + 1, ey + 1, OL);
    } else {                                           // round：默认
      px.rect(ex, ey, ex + 1, ey, OL);
      px.set(ex, ey + 1, EYEW); px.set(ex + 1, ey + 1, iris);
      px.set(ex, ey + 2, EYEW); px.set(ex + 1, ey + 2, iris);
    }
  }
  if (spec.brow) {                                     // 眉：与发色同
    const c = spec.brow === 'gray' ? HAIR.gray.a : hair.a;
    const by = ey - 2 + (eyes === 'big' ? -1 : 0);
    px.rect(lx, by, lx + 1, by, c); px.rect(rx, by, rx + 1, by, c);
    if (spec.brow === 'bushy' || spec.brow === 'gray') { px.set(lx - 1, by, c); px.set(rx + 2, by, c); }
  }
  const my = hy0 + 10;
  const lip = [178, 96, 84];
  switch (spec.mouth || 'smile') {
    case 'grin':  px.rect(cx - 2, my, cx + 1, my, OL); px.set(cx - 3, my - 1, OL); px.set(cx + 2, my - 1, OL);
                  px.rect(cx - 1, my + 1, cx, my + 1, lip); break;
    case 'small': px.set(cx - 1, my, lip); px.set(cx, my, lip); break;
    case 'line':  px.rect(cx - 1, my, cx, my, skin.b); px.set(cx - 2, my, skin.b); break;
    case 'frown': px.rect(cx - 1, my, cx, my, OL); px.set(cx - 2, my + 1, OL); px.set(cx + 1, my + 1, OL); break;
    case 'pout':  px.set(cx - 1, my, lip); px.set(cx, my, lip); px.set(cx - 1, my + 1, skin.b); break;
    default:      px.rect(cx - 1, my, cx, my, OL); px.set(cx - 2, my - 1, OL); px.set(cx + 1, my - 1, OL);
  }
  if (spec.blush) { px.rect(cx - 6, my - 1, cx - 5, my - 1, BLUSH); px.rect(cx + 4, my - 1, cx + 5, my - 1, BLUSH); }
  if (spec.nose) px.set(cx, my - 2, skin.b);
}

// 后层：垂在身后的发
function hairBack(px, spec, hair, hx0, hx1, hy0, B) {
  const s = spec.hairstyle;
  if (s === 'long') {
    px.rect(hx0 - 1, hy0 + 5, hx1 + 1, hy0 + 19, hair.a);   // 披在肩背后的整块
    px.rect(hx1 - 1, hy0 + 5, hx1 + 1, hy0 + 19, hair.a);
  } else if (s === 'twintail') {
    for (const s of [-1, 1]) {
      const x = s < 0 ? hx0 - 3 : hx1 + 1;
      px.rect(x, hy0 + 4, x + 2, hy0 + 5, hair.a);
      px.rect(x, hy0 + 6, x + 2, hy0 + 6, CLOTH.red.a);       // 发绳
      px.rect(x, hy0 + 7, x + 2, hy0 + 15, s < 0 ? hair.a : hair.a);
      px.rect(x + (s < 0 ? 1 : 0), hy0 + 16, x + (s < 0 ? 2 : 1), hy0 + 17, s < 0 ? hair.a : hair.a);
    }
  } else if (s === 'ponytail') {
    px.rect(hx1 - 2, hy0 + 2, hx1 + 3, hy0 + 4, hair.a);
    px.rect(hx1 + 2, hy0 + 5, hx1 + 4, hy0 + 13, hair.a);
  }
}

// 前层：发盖、刘海、侧发、发髻、簪、幞头
function hairFront(px, spec, hair, hx0, hx1, hy0) {
  const s = spec.hairstyle || 'short';
  if (s === 'bald') {                                          // 地中海：两侧灰发 + 光顶
    px.rect(hx0 - 1, hy0 + 2, hx0 + 1, hy0 + 8, hair.a);
    px.rect(hx1 - 1, hy0 + 2, hx1 + 1, hy0 + 8, hair.a);
    px.set(hx0 + 4, hy0 + 1, SKIN.fair.a);                    // 头顶反光
    return cap(px, spec, hx0, hx1, hy0);
  }
  // 发盖：比头宽 1px，盖到眼上一行
  px.rect(hx0 + 3, hy0 - 2, hx1 - 3, hy0 - 2, hair.a);
  px.rect(hx0 + 1, hy0 - 1, hx1 - 1, hy0 - 1, hair.a);
  px.rect(hx0, hy0, hx1, hy0 + 3, hair.a);
  px.rect(hx0 - 1, hy0 + 1, hx1 + 1, hy0 + 4, hair.a);
  px.rect(hx0 + 3, hy0 - 2, hx0 + 5, hy0 - 2, hair.b);        // 左上高光
  px.rect(hx0 + 1, hy0 - 1, hx0 + 3, hy0 - 1, hair.b); px.set(hx0 + 1, hy0, hair.b);
  // 刘海
  const fringe = spec.fringe || 'straight';
  const y = hy0 + 4, cx = 16;
  if (fringe === 'straight') {                                 // 齐刘海：整排，两端挑起一撮
    px.rect(hx0, y + 1, hx1, y + 1, hair.a);
    px.rect(hx0, y + 2, hx0 + 1, y + 2, hair.a); px.rect(hx1 - 1, y + 2, hx1, y + 2, hair.a);
    px.set(cx - 2, y + 2, hair.a); px.set(cx + 2, y + 2, hair.a);
  } else if (fringe === 'side') {                              // 斜刘海：往右扫
    px.rect(hx0, y + 1, hx1 - 3, y + 1, hair.a);
    px.rect(hx0, y + 2, hx0 + 4, y + 2, hair.a); px.set(hx0 + 6, y + 2, hair.a);
    px.rect(hx1 - 2, y + 1, hx1, y + 1, hair.a); px.rect(hx1 - 1, y + 2, hx1, y + 2, hair.a);
  } else if (fringe === 'middle') {                            // 中分：露额头
    px.rect(hx0, y + 1, hx0 + 3, y + 1, hair.a); px.rect(hx0, y + 2, hx0 + 1, y + 2, hair.a);
    px.rect(hx1 - 3, y + 1, hx1, y + 1, hair.a); px.rect(hx1 - 1, y + 2, hx1, y + 2, hair.a);
  } else if (fringe === 'messy') {                             // 乱翘：男孩子
    for (const dx of [0, 2, 3, 5, 7, 9, 11, 12, 13]) px.set(hx0 + dx, y + 1, dx > 9 ? hair.a : hair.a);
    for (const dx of [0, 3, 8, 13]) px.set(hx0 + dx, y + 2, dx > 9 ? hair.a : hair.a);
  } else if (fringe === 'up') {                                // 束起：额头全露，只留鬓角
    px.rect(hx0 - 1, y + 1, hx0, y + 2, hair.a); px.rect(hx1, y + 1, hx1 + 1, y + 2, hair.a);
  }
  // 侧发
  if (s === 'short') {
    px.rect(hx0 - 1, y + 1, hx0 - 1, y + 4, hair.a); px.rect(hx1 + 1, y + 1, hx1 + 1, y + 4, hair.a);
  } else if (s === 'long' || s === 'twintail') {
    px.rect(hx0 - 1, y + 1, hx0 - 1, y + 9, hair.a); px.rect(hx1 + 1, y + 1, hx1 + 1, y + 9, hair.a);
    if (s === 'long') { px.rect(hx0 - 2, y + 4, hx0 - 2, y + 12, hair.a); px.rect(hx1 + 2, y + 4, hx1 + 2, y + 12, hair.a); }
  } else if (s === 'bun') {                                    // 挽发：顶上一个髻
    px.rect(cx - 2, hy0 - 5, cx + 1, hy0 - 5, hair.a);
    px.rect(cx - 3, hy0 - 4, cx + 2, hy0 - 3, hair.a);
    px.rect(cx + 1, hy0 - 4, cx + 2, hy0 - 3, hair.a);
    px.rect(hx0 - 1, y + 1, hx0 - 1, y + 3, hair.a); px.rect(hx1 + 1, y + 1, hx1 + 1, y + 3, hair.a);
  } else if (s === 'spiky') {                                  // 炸毛
    for (const dx of [1, 4, 8, 12]) px.set(hx0 + dx, hy0 - 3, hair.a);
    px.set(hx0 + 6, hy0 - 3, hair.a); px.set(hx0 + 6, hy0 - 4, hair.a);
    px.set(hx0 - 1, hy0, hair.a); px.set(hx1 + 1, hy0, hair.a);
    px.rect(hx0 - 1, y + 1, hx0 - 1, y + 3, hair.a); px.rect(hx1 + 1, y + 1, hx1 + 1, y + 3, hair.a);
  } else if (s === 'topknot') {                                // 男子束髻
    px.rect(cx - 2, hy0 - 5, cx + 1, hy0 - 3, hair.a); px.set(cx + 1, hy0 - 4, hair.a);
    px.rect(hx0 - 1, y + 1, hx0 - 1, y + 2, hair.a); px.rect(hx1 + 1, y + 1, hx1 + 1, y + 2, hair.a);
  } else if (s === 'ponytail') {
    px.rect(hx0 - 1, y + 1, hx0 - 1, y + 3, hair.a); px.rect(hx1 + 1, y + 1, hx1 + 1, y + 3, hair.a);
  }
  cap(px, spec, hx0, hx1, hy0);
}

// 头饰：簪 / 幞头 / 布巾 / 花
function cap(px, spec, hx0, hx1, hy0) {
  const c = spec.cap, cx = 16;
  if (!c) return;
  const col = CLOTH[spec.capColor || 'ink'];
  if (c === 'zan') {                                            // 发簪：横插一根，簪头一点
    const y = hy0 - 4 + (spec.hairstyle === 'bun' ? 0 : 2);
    px.rect(cx + 1, y, cx + 6, y, CLOTH.gold.a); px.set(cx + 7, y, CLOTH.red.a); px.set(cx + 7, y - 1, CLOTH.red.a);
  } else if (c === 'jin') {                                     // 幞头：黑帽包住发顶，脑后两只软脚
    px.rect(hx0 + 2, hy0 - 5, hx1 - 2, hy0 - 5, col.a);
    px.rect(hx0 + 1, hy0 - 4, hx1 - 1, hy0 - 2, col.a);
    px.rect(hx0, hy0 - 1, hx1, hy0 + 1, col.a);
    px.rect(hx1 - 3, hy0 - 4, hx1 - 1, hy0 + 1, col.b);
    px.rect(hx0, hy0 + 1, hx1, hy0 + 1, col.b);                 // 帽檐
    px.rect(hx0 - 1, hy0 + 2, hx0 - 1, hy0 + 6, col.b); px.rect(hx1 + 1, hy0 + 2, hx1 + 1, hy0 + 6, col.b);   // 软脚
  } else if (c === 'scarf') {                                   // 包头布巾：干活的人
    px.rect(hx0 + 2, hy0 - 3, hx1 - 2, hy0 - 3, col.a);
    px.rect(hx0, hy0 - 2, hx1, hy0 + 2, col.a);
    px.rect(hx1 - 2, hy0 - 2, hx1, hy0 + 2, col.b);
    px.rect(hx0 - 1, hy0, hx0 - 1, hy0 + 2, col.a);
    px.rect(hx1 + 1, hy0 - 1, hx1 + 2, hy0 + 1, col.b);         // 打的结
    px.rect(hx0, hy0 + 3, hx1, hy0 + 3, col.b);
  } else if (c === 'flower') {                                  // 鬓边一朵花
    px.rect(hx1, hy0 - 1, hx1 + 1, hy0, CLOTH.pink.a); px.set(hx1 + 1, hy0 - 1, CLOTH.pink.b);
    px.set(hx1 + 2, hy0 + 1, CLOTH.green.a);
  }
}

// 胡子：络腮 + 长须。盖住嘴，露出鼻子和眼
function beard(px, spec, hx0, hx1, hy0) {
  const c = HAIR[spec.beard === true ? 'gray' : spec.beard];
  const cx = 16, y = hy0 + 9;
  px.rect(cx - 4, y, cx - 2, y, c.a); px.rect(cx + 1, y, cx + 3, y, c.b);     // 髭
  px.rect(hx0 + 2, y + 1, hx1 - 2, y + 2, c.a);
  px.rect(hx0 + 3, y + 3, hx1 - 3, y + 4, c.a);
  px.rect(cx - 2, y + 5, cx + 1, y + 7, c.a);
  px.rect(cx - 1, y + 8, cx, y + 8, c.a);
  px.rect(cx + 1, y + 1, hx1 - 2, y + 2, c.b); px.rect(cx + 1, y + 3, hx1 - 3, y + 4, c.b);
  px.rect(cx, y + 5, cx + 1, y + 7, c.b);
  px.set(cx - 1, y, c.b);                                                     // 嘴缝
}

// ---------------- 主角六人 ----------------
// 顺序 = 精灵表行序（games/sim/index.html 的 NAMES）
const CAST = {
  '小满': { build: 'std',   skin: 'fair', hairstyle: 'twintail', fringe: 'straight', hair: 'chestnut',
            eye: 'round', iris: 'brown', mouth: 'smile', blush: true,
            outfit: 'ruqun', cloth: 'teal', inner: 'mint', belt: 'rust', trousers: 'coal', cap: 'flower' },
  '阿沅': { build: 'slim',  skin: 'warm', hairstyle: 'topknot', fringe: 'up', hair: 'black', brow: true,
            eye: 'round', iris: 'black', mouth: 'frown', nose: true,
            outfit: 'changshan', cloth: 'indigo', inner: 'sky', belt: 'sand', trousers: 'navy', cap: 'jin', capColor: 'ink' },
  '老莫': { build: 'elder', skin: 'old',  hairstyle: 'bald', hair: 'gray', brow: 'gray', ears: true,
            eye: 'squint', mouth: 'line', beard: 'white', nose: true, cane: true,
            outfit: 'daopao', cloth: 'snow', inner: 'sand', belt: 'wood', trousers: 'slate' },
  '芜青': { build: 'young', skin: 'tan',  hairstyle: 'spiky', fringe: 'messy', hair: 'auburn', brow: true,
            eye: 'smile', mouth: 'grin', blush: true,
            outfit: 'duanda', cloth: 'ochre', inner: 'cream', belt: 'red', trousers: 'earth' },
  '阿柳': { build: 'slim',  skin: 'fair', hairstyle: 'long', fringe: 'middle', hair: 'black', brow: true,
            eye: 'big', iris: 'blue', mouth: 'pout', blush: true,
            outfit: 'ruqun', cloth: 'plum', inner: 'lilac', belt: 'ink', trousers: 'coal', cap: 'zan' },
  '梨娘': { build: 'stout', skin: 'warm', hairstyle: 'bun', fringe: 'side', hair: 'honey',
            eye: 'round', iris: 'amber', mouth: 'small', blush: true,
            outfit: 'ruqun', cloth: 'ochre', inner: 'cream', belt: 'green', trousers: 'coal', cap: 'zan' },
};

// ---------------- 按种子生成外观（6~15 行）----------------
// 确定性哈希：同一个种子永远同一张脸；游戏里存的只有行号，所以行的样子不能变。
function h01(seed, salt) {
  let x = (Math.imul(seed, 2654435761) + Math.imul(salt, 40503)) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0; x = Math.imul(x, 1274126177) >>> 0; x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}
const pick = (seed, salt, arr) => arr[Math.floor(h01(seed, salt) * arr.length) % arr.length];

function genLook(seed) {
  const female = h01(seed, 1) < 0.5;
  const old = h01(seed, 20) < 0.2;
  const spec = {
    build: old ? 'elder' : pick(seed, 2, ['std', 'std', 'slim', 'stout']),
    skin: old ? 'old' : pick(seed, 3, ['fair', 'fair', 'warm', 'tan']),
    hair: old ? pick(seed, 4, ['gray', 'white', 'ash']) : pick(seed, 4, ['black', 'black', 'darkbrown', 'chestnut', 'auburn']),
    iris: pick(seed, 5, ['brown', 'brown', 'black', 'amber', 'green']),
    trousers: pick(seed, 6, ['coal', 'earth', 'navy', 'slate']),
    belt: pick(seed, 7, ['rust', 'earth', 'ink', 'green', 'red']),
    eye: old ? 'squint' : pick(seed, 8, ['round', 'round', 'big', 'smile', 'beady']),
    mouth: pick(seed, 9, ['smile', 'small', 'line', 'grin', 'pout']),
  };
  if (female) {
    Object.assign(spec, {
      hairstyle: pick(seed, 10, ['twintail', 'long', 'bun', 'bun', 'ponytail']),
      fringe: pick(seed, 11, ['straight', 'side', 'middle']),
      outfit: h01(seed, 12) < 0.75 ? 'ruqun' : 'changshan',
      cloth: pick(seed, 13, ['teal', 'plum', 'rust', 'moss', 'indigo', 'pink', 'ochre']),
      inner: pick(seed, 14, ['cream', 'mint', 'lilac', 'sky', 'snow']),
      blush: true,
      cap: pick(seed, 15, [null, 'zan', 'zan', 'flower', 'scarf']),
      capColor: 'sand',
    });
    if (old) { spec.hairstyle = 'bun'; spec.cap = 'zan'; spec.blush = false; spec.brow = 'gray'; }
  } else {
    Object.assign(spec, {
      hairstyle: pick(seed, 10, ['short', 'short', 'topknot', 'spiky']),
      fringe: pick(seed, 11, ['messy', 'side', 'up', 'straight']),
      outfit: pick(seed, 12, ['duanda', 'duanda', 'changshan']),
      cloth: pick(seed, 13, ['indigo', 'moss', 'slate', 'ochre', 'earth', 'teal', 'sand']),
      inner: pick(seed, 14, ['cream', 'sand', 'sky']),
      brow: true, nose: h01(seed, 16) < 0.5, ears: h01(seed, 17) < 0.4,
      cap: pick(seed, 15, [null, null, 'jin', 'scarf']),
      capColor: pick(seed, 18, ['ink', 'navy', 'earth']),
    });
    if (old) { spec.hairstyle = pick(seed, 19, ['bald', 'topknot']); spec.beard = pick(seed, 21, ['gray', 'white']); spec.brow = 'gray'; spec.cane = h01(seed, 22) < 0.5; if (spec.outfit === 'duanda') spec.outfit = 'changshan'; }
    if (spec.hairstyle === 'topknot') spec.fringe = 'up';
  }
  return spec;
}

// ---------------- PNG 编码（零依赖）----------------
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------- 拼图集 ----------------
class Sheet {
  constructor(w, h) { this.w = w; this.h = h; this.buf = Buffer.alloc(w * h * 4); }
  blit(px, ox, oy, scale) {
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      const c = px.get(x, y); if (!c) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const X = ox + x * scale + dx, Y = oy + y * scale + dy;
        if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) continue;
        const i = (Y * this.w + X) * 4; this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2]; this.buf[i + 3] = 255;
      }
    }
  }
  fill(rgb) { for (let i = 0; i < this.w * this.h; i++) { this.buf[i * 4] = rgb[0]; this.buf[i * 4 + 1] = rgb[1]; this.buf[i * 4 + 2] = rgb[2]; this.buf[i * 4 + 3] = 255; } }
  png() { return encodePNG(this.w, this.h, this.buf); }
}

function rowSpecs() {
  const names = Object.keys(CAST);
  const specs = names.map(n => CAST[n]);
  for (let i = names.length; i < ATLAS_ROWS; i++) { specs.push(genLook(1000 + i)); names.push('gen' + String(i).padStart(2, '0')); }
  return { names, specs };
}

function buildAtlas() {
  const { specs } = rowSpecs();
  const FW = LW * SCALE, FH = LH * SCALE;
  const sheet = new Sheet(FW * 4, FH * ATLAS_ROWS);
  specs.forEach((spec, r) => { for (let f = 0; f < 4; f++) sheet.blit(draw(spec, f), f * FW, r * FH, SCALE); });
  return sheet;
}

// 预览：四人一行、深底，逻辑像素 ×4，方便肉眼审
function buildPreview() {
  const { specs } = rowSpecs();
  const S = 4, cols = 4, rows = Math.ceil(specs.length / cols);
  const sheet = new Sheet(LW * S * 4 * cols + (cols + 1) * 8, LH * S * rows + (rows + 1) * 8);
  sheet.fill([56, 62, 48]);
  specs.forEach((spec, i) => {
    const ox = 8 + (i % cols) * (LW * S * 4 + 8), oy = 8 + Math.floor(i / cols) * (LH * S + 8);
    for (let f = 0; f < 4; f++) sheet.blit(draw(spec, f), ox + f * LW * S, oy, S);
  });
  return sheet;
}

function main() {
  const args = process.argv.slice(2);
  const outDir = path.join(ROOT, 'assets', 'sprites');
  fs.mkdirSync(outDir, { recursive: true });
  const atlas = buildAtlas().png();
  fs.writeFileSync(path.join(outDir, 'cast96.png'), atlas);
  fs.writeFileSync(path.join(outDir, 'cast96_preview.png'), buildPreview().png());
  console.log(`assets/sprites/cast96.png  帧 ${LW * SCALE}x${LH * SCALE}, 4 帧 x ${ATLAS_ROWS} 行`);
  if (args.includes('--embed')) {
    const file = path.join(ROOT, 'games', 'sim', 'index.html');
    const src = fs.readFileSync(file, 'utf8');
    const re = /^cast\.src='data:image\/png;base64,[A-Za-z0-9+/=]+';/m;
    if (!re.test(src)) { console.error('没找到 cast.src=... 那一行，未写入'); process.exit(1); }
    fs.writeFileSync(file, src.replace(re, `cast.src='data:image/png;base64,${atlas.toString('base64')}';`));
    console.log('已写回 games/sim/index.html');
  }
}
if (require.main === module) main();
module.exports = { draw, CAST, genLook, LW, LH, SCALE, encodePNG, Sheet };
