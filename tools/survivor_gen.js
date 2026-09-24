#!/usr/bin/env node
// 静街 · 幸存者精灵生成器（T0）
// ==================================================================
// 从 tools/character_gen.js【分叉】而来，不是改它 —— 市井还在用那一份。
// 但也没有整份抄：PNG 编码与图集拼装是纯基础设施，直接 require 过来
// （`tools/` 本来就是这个仓库真正的共享层）。抄的只是【画法】。
//
// 和市井那一版的三处不同（策划第十一节）：
//   ① 比例：头 11 行 → 头身比 1:3.18。
//      【文档原来写"从 1:2 拉到 1:2.6"，是错的】—— 量过市井：它已经是 1:2.62，
//      照那个数改等于什么都没做。成年人的轮廓要到 3.2 上下才看得出来。
//   ② 调色：16 色主板由【算】出来，不是手敲 —— 先定鲜艳的 RAW，
//      再统一降饱和 20%、压亮度上限 82%。于是"降了没降"是可断言的。
//   ③ 唯一的高饱和色是僵尸的眼睛，它不参与降饱和。
//
// 一帧仍是逻辑 32×42 ×3 = 96×126：帧高必须整除 RS=3（市井 T31 的坑），
// 而且和市井同尺寸才能直接借它的 Sheet.blit。
//
// 用法：
//   node tools/survivor_gen.js           # 出 assets/sprites/survivors96.png + 贴花图 + 预览
//   node tools/survivor_gen.js --embed   # 同时嵌回 games/quiet-street/index.html（不存在就跳过）
'use strict';
const fs = require('fs'), path = require('path');
const CG = require('./character_gen');
const { encodePNG } = CG;

// 【提高像素密度】逻辑 32×42 ×3 → 48×63 ×2。
// 设备像素数完全不变（32×3=96=48×2，42×3=126=63×2），图集尺寸一个像素都不涨，
// 但同样的地方塞进 2.25 倍的美术信息 —— "糊"的根源是 art 像素太少，不是画得不好。
const LW = 48, LH = 63, SCALE = 2, ATLAS_ROWS = 16;
// 从 a 收到 b 的半宽序列，bulge 给中段一点鼓 —— 收腰、收脚踝都用它
const ramp = (n, a, b, bulge = 0) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    out.push(Math.max(1, Math.round(a + (b - a) * t + Math.sin(t * Math.PI) * bulge)));
  }
  return out;
};
const ROOT = path.resolve(__dirname, '..');

// 静街自己的 Sheet。以前直接借市井的 —— 但它的 blit 用的是【它自己的】 LW/LH（32×42），
// 静街提到 48×63 之后再借就只会拷到左上角一块。守卫报出来的正是这件事。
// 只借 encodePNG（那个和尺寸无关）。
class Sheet {
  constructor(w, h) { this.w = w; this.h = h; this.buf = Buffer.alloc(w * h * 4); }
  blit(px, ox, oy, scale) {
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      const c = px.get(x, y); if (!c) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const X = ox + x * scale + dx, Y = oy + y * scale + dy;
        if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) continue;
        const i = (Y * this.w + X) * 4;
        this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2]; this.buf[i + 3] = 255;
      }
    }
  }
  fill(rgb) { for (let i = 0; i < this.w * this.h; i++) { this.buf[i * 4] = rgb[0]; this.buf[i * 4 + 1] = rgb[1]; this.buf[i * 4 + 2] = rgb[2]; this.buf[i * 4 + 3] = 255; } }
  png() { return encodePNG(this.w, this.h, this.buf); }
}

// ---------------- 调色：算出来的 16 色 ----------------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function toHSL([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function toRGB([h, s, l]) {
  if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(clamp(v, 0, 1) * 255));
}
const DESAT = 0.20, LCAP = 0.82;           // 策划第十一节定的两个数
const grade = c => { const [h, s, l] = toHSL(c); return toRGB([h, s * (1 - DESAT), Math.min(l, LCAP)]); };
const shade = (c, k = .78) => c.map(v => Math.round(v * k));
// 光从【左上】打过来 —— 整张图共用这一个方向，不然每个部件各亮各的，看着就散。
const lit = (c, k = 1.16) => c.map(v => Math.min(255, Math.round(v * k)));
const dim = (c, k = .62) => c.map(v => Math.round(v * k));
const tone = c => { const a = grade(c); return { a, b: shade(a) }; };

const OL = [34, 30, 30];                    // 描边：暖黑，不用纯黑
// 场景里唯一允许的高饱和色。刻意【不】过 grade() —— 黑暗里先看见的是几点眼睛。
const EYE_GLOW = [210, 226, 74];

const RAW = {
  skinFair: [238, 200, 168], skinTan: [198, 150, 110], skinPale: [222, 204, 190],
  hairBlack: [56, 48, 48],   hairBrown: [116, 80, 56],  hairGray: [168, 162, 154],
  slate:    [104, 118, 130], olive:    [118, 126, 88],  ochre:   [176, 142, 78],
  brick:    [162, 86, 72],   bone:     [214, 206, 190], charcoal:[72, 70, 72],
  denim:    [86, 104, 134],  leather:  [128, 92, 62],   steel:   [150, 156, 162],
  blood:    [138, 42, 38],
};
const PAL = {}; for (const k in RAW) PAL[k] = tone(RAW[k]);

// 四季环境偏移：每季一个整体色偏 + 一条四色地面梯度（游戏画地面用，这里只出预览）
const SEASON = {
  秋: { tint: [10, 2, -14], ramp: [[122, 104, 70], [104, 90, 62], [88, 78, 56], [72, 64, 48]] },
  冬: { tint: [-8, -2, 12], ramp: [[176, 182, 190], [150, 158, 168], [122, 132, 144], [96, 104, 116]] },
  春: { tint: [-6, 8, -4],  ramp: [[104, 122, 84], [88, 106, 72], [74, 90, 62], [60, 74, 52]] },
  夏: { tint: [8, 6, -10],  ramp: [[128, 126, 84], [110, 110, 74], [94, 96, 64], [78, 82, 56]] },
};

// ---------------- 画布 ----------------
class Px {
  constructor() { this.d = new Array(LW * LH).fill(null); }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < LW && y < LH && c) this.d[y * LW + x] = c; }
  get(x, y) { return (x >= 0 && y >= 0 && x < LW && y < LH) ? this.d[y * LW + x] : null; }
  rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  // 按【每行半宽】画形状 —— 像素画里的"弧度"就是靠一格一格的阶梯做出来的。
  // 第一版整个人全是 rect(x0,y0,x1,y1)：头是方盒、躯干是等宽柱 ——
  // 手玩的原话是"完全直线，没有任何弧度"。
  shape(cx, y0, halves, c) {
    halves.forEach((hw, i) => { if (hw > 0) this.rect(cx - hw, y0 + i, cx + hw - 1, y0 + i, c); });
    return this;
  }
  mirror() {                                   // 左右镜像：西面 = 东面翻过来
    const d = this.d.slice();
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++)
      this.d[y * LW + x] = d[y * LW + (LW - 1 - x)];
    return this;
  }
  // 只在【最底下一圈】压暗，把人和地面分开。不做整圈描边。
  groundEdge() {
    const src = this.d.slice();
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      if (src[y * LW + x]) continue;
      const up = y > 0 && src[(y - 1) * LW + x];
      if (up && !(y < LH - 1 && src[(y + 1) * LW + x])) this.d[y * LW + x] = [22, 20, 20];
    }
    return this;
  }
  outline() {
    const src = this.d.slice();
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      if (src[y * LW + x]) continue;
      const n = (x > 0 && src[y * LW + x - 1]) || (x < LW - 1 && src[y * LW + x + 1]) ||
                (y > 0 && src[(y - 1) * LW + x]) || (y < LH - 1 && src[(y + 1) * LW + x]);
      if (n) this.d[y * LW + x] = OL;
    }
  }
}

// ---------------- 部件表（策划 Q13d 定的数量）----------------
const BUILD = { std: { torsoW: 15, legW: 5 }, slim: { torsoW: 12, legW: 4 }, stout: { torsoW: 18, legW: 6 } };
const FACES = ['neutral', 'tired', 'grim', 'wide'];                                   // 4
const HAIRS = ['buzz', 'short', 'messy', 'side', 'long', 'ponytail', 'bun', 'bald'];  // 8
const TOPS  = ['tee', 'shirt', 'jacket', 'hoodie', 'coverall', 'sweater'];            // 6
const PANTS = ['jeans', 'cargo', 'slacks', 'shorts'];                                 // 4
const SHOES = ['boots', 'sneakers'];                                                  // 2
const HATS  = [null, 'cap', 'beanie', 'hood'];
// 贴花是【叠加】：只能加东西，不能改整体。
// 「湿透（整体压暗 + 偏蓝）」是【乘算】，所以它不在这里 —— 它和 lightmap 走同一条路。
// 第一版把它当贴花画成了满身横条，整个人像穿了囚服：预览图一眼就看出来了。
const DECALS = ['绷带', '血渍', '冬装', '背包', '武器', '冻伤'];        // 6 类贴花
const RENDER_FX = { 湿透: { mul: [0.72, 0.78, 0.92] } };                // 1 个渲染层效果
// 贴花有层序：绷带和血在衣服【底下】，外套压住它们，包和武器在最外面。
// 预览图第一版没排序，于是绷带画在了冬装外面 —— 看着像把绷带缠在大衣上。
const DECAL_ORDER = ['绷带', '血渍', '冻伤', '冬装', '背包', '武器'];

// 关键行（48×63）：头 8~24（17 行）、颈 25、躯干 27~42、臀 44、脚底 60
// 头身比 = (60-8+1)/17 = 1:3.12，和原来的 1:3.18 基本一致 —— 比例不变，只是像素更细
const HY0 = 8, HH = 17, TY0 = 27, TY1 = 42, HIP = 44, FOOT = 60, CX = 24;
// 【真正的四帧步循环】：触地左 → 过渡 → 触地右 → 过渡。
// 第一版四帧里有【两帧完全一样】（0 和 2 都是 lift:0 swing:0），
// 抬脚只有 1 像素、摆手 1 像素 —— 手玩的原话是"人物没有动作"，确实看不出来。
// 现在：迈步用【横向跨距】表达（前腿往前 1、后腿往后 1），抬脚 2 像素，摆手 2 像素。
// 【腿和手都走椭圆轨迹】，不是直上直下。
// 四个相位连起来是一个椭圆：迈到前面 → 抬起来往前送 → 蹬到后面 → 抬起来往回收。
// 第一版只有 y 方向的 ±2，所以脚是"上下点"不是"迈步"—— 这就是"动作完全直线"。
const LEG_ARC = [{ x:  3, y:  0 }, { x:  2, y: -5 }, { x: -3, y:  0 }, { x: -2, y: -3 }];
const ARM_ARC = [{ x: -2, y:  2 }, { x:  0, y:  0 }, { x:  2, y: -2 }, { x:  0, y:  0 }];
const legAt = (fr, side) => LEG_ARC[(fr + (side < 0 ? 0 : 2)) & 3];
const armAt = (fr, side) => ARM_ARC[(fr + (side < 0 ? 2 : 0)) & 3];
// WALK 从弧线推出来，字段名保留 —— decal() 和攻击分支还在用 swing
const WALK = LEG_ARC.map((L, f) => ({
  bob: (f & 1) ? -1 : 0, lift: L.y, swing: ARM_ARC[f].y, swingX: ARM_ARC[f].x,
  strideL: LEG_ARC[f].x, strideR: LEG_ARC[(f + 2) & 3].x,
}));

// dir：0 南（正面）· 1 北（背面）· 2 西 · 3 东
// 西面不单独画 —— 画东面然后镜像，省一半的活，也保证两边一致。
const DIRS = ['南', '北', '西', '东'];
// atk：0 走路 · 1 出手（手臂伸出去）· 2 收手（拉回一半）
// 「没有击打动作」是手玩报的 —— 原来挥击只画一道弧，精灵本身一动不动。
// ════════ 手摆底板 ════════
// 参数化画不出来的东西在这儿手摆：头、躯干、四肢的轮廓和明暗。
// 但【底板只定姿势】—— 发色肤色衣色仍然按角色生成，16 行的变化一个不少。
// 写法是 [行, 起始x, 串]，色号见 letters()。
const ART_S = [
  // ── 头 8~24：半宽 4→7→2，颧骨最宽、下巴收尖
  // ── 头 8~24（动漫向）：大眼、鼻子只剩一格、嘴小、下巴收尖
  [ 8,20,'hhhhhhhhh'],
  [ 9,19,'hhHHHHHHHhh'],
  [10,18,'hhHHHHHHHHHhh'],
  [11,17,'hhxHHHHHHHHHxhh'],
  [12,17,'hhxxHHHHHHHxxhh'],
  [13,17,'hhxxxxxxxxxxxhh'],
  [14,17,'hhxxsssssxxxxhh'],          // 刘海压低 —— 动漫脸的额头短
  [15,17,'hsxxxxsssxxxxsh'],          // 眉
  [16,17,'hseeeessseeeesh'],          // 上睫毛：一道厚深线
  [17,17,'hsEiiEsssEiiEsh'],          // 虹膜【两侧留白】—— 全填满就成了墨镜
  [18,18,'siiissssiiis'],[18,30,'s'],
  [19,18,'ssiisssssiis'],[19,30,'s'],
  [20,18,'Ssssssssssss'],[20,30,'S'],
  [21,19,'sssssSsssss'],              // 鼻子只有一格
  [22,19,'ssssTTsssss'],              // 嘴只有两格
  [23,20,'SsssssssS'],
  [24,21,'SSsssSS'],                  // 下巴收尖
  [25,22,'SsssS'], [26,22,'TSSST'],   // 颈
  // ── 肩 27~28：肩不是一条通宽的亮条（那看着像衣架）。
  // 只有斜方肌那一小段提亮，肩头本身压暗，两端收窄一格。
  [27,17,'jJJJJJjjjjjjjd'],
  [28,15,'djD'],[28,18,'jJJJjjjjjjddd'],[28,32,'Djd'],
  // ── 躯干 29~37（x18~30）+ 双臂（x14~17 / x31~34）
  // 领口是【对称的 V】，不是每行右移一格的斜线 —— 上一版就是这么划出一道亮斜线的
  [29,14,'dJjD'],[29,18,'jJJjjwWwjjddd'],[29,31,'DJjd'],
  [30,14,'dJjD'],[30,18,'jJJjjjwjjjddd'],[30,31,'DJjd'],
  [31,14,'dJjD'],[31,18,'jJJjjjdjjjddd'],[31,31,'DJjd'],
  [32,14,'dJjD'],[32,18,'jJJjjjdjjjddd'],[32,31,'DJjd'],
  [33,14,'dJjD'],[33,18,'jJJjjjdjjjddd'],[33,31,'DJjd'],
  [34,14,'dJjD'],[34,18,'jJJjjjdjjjddd'],[34,31,'DJjd'],
  [35,14,'dJjD'],[35,18,'jJJjjjdjjjddd'],[35,31,'DJjd'],
  [36,14,'dJjD'],[36,18,'jJJjjjdjjjddd'],[36,31,'DJjd'],
  [37,14,'dJjD'],[37,18,'jJJjjjdjjjddd'],[37,31,'DJjd'],
  // ── 收腰 38~43：躯干收到 x19~29，手臂跟着往里挪一格
  [38,15,'dJjD'],[38,19,'jJJjjdjjjdd'],[38,30,'DJjd'],
  [39,15,'dJjD'],[39,19,'jJJjjdjjjdd'],[39,30,'DJjd'],
  [40,15,'dJjD'],[40,19,'jJJjjdjjjdd'],[40,30,'DJjd'],
  // 手（皮肤）41~43
  [41,15,'SssS'],[41,19,'jJJjjdjjjdd'],[41,30,'SssS'],
  [42,15,'SssS'],[42,19,'jJJjjdjjjdd'],[42,30,'SssS'],
  [43,15,'TSST'],[43,19,'dddddddddddd'.slice(0,11)],[43,30,'TSST'],
  // ── 臀 44~46
  [44,19,'dDddqdddDdd'],
  [45,19,'pPPppqppPPp'],
  [46,19,'pPPppqppPPp'],
  // ── 腿 47~57：两条腿中间有缝
  [47,19,'pPPpqqqppPp'],[48,19,'pPPpqqqppPp'],[49,19,'pPPpqqqppPp'],
  [50,19,'pPPpq'],[50,25,'qppPp'],
  [51,19,'pPPpq'],[51,25,'qppPp'],
  [52,19,'pPPpq'],[52,25,'qppPp'],
  [53,19,'pPPpq'],[53,25,'qppPp'],
  [54,19,'pPPpq'],[54,25,'qppPp'],
  [55,19,'pPPpq'],[55,25,'qppPp'],
  [56,20,'PPpq'],[56,25,'qppP'],
  [57,20,'qppq'],[57,25,'qppq'],
  // ── 靴 58~61：比腿宽，往前探
  [58,18,'bBbbbn'],[58,25,'nbbbBb'],
  [59,18,'bBbbbn'],[59,25,'nbbbBb'],
  [60,18,'bbbbbn'],[60,25,'nbbbbb'],
  [61,18,'nnnnnn'],[61,25,'nnnnnn'],
];
// ── 背面：同一副骨架，头全是发、胸口没有领口、背上一道过肩缝
const ART_N = [
  [ 8,20,'hhhhhhhhh'],
  [ 9,19,'hhHHHHHHHhh'],
  [10,18,'hhHHHHHHHHHhh'],
  [11,17,'hhxHHHHHHHHHxhh'],
  [12,17,'hhxxHHHHHHHxxhh'],
  [13,17,'hhxxxxxxxxxxxhh'],
  [14,17,'hhxxxxxxxxxxxhh'],
  [15,17,'hhhxxxxxxxxxhhh'],
  [16,17,'hhhxxxxxxxxxhhh'],
  [17,17,'hhhhxxxxxxxhhhh'],
  [18,18,'hhhhxxxxxhhhh'],
  [19,18,'hhhhhxxxhhhhh'],
  [20,19,'hhhhhhhhhhh'],
  [21,19,'hhhhhhhhhhh'],
  [22,20,'hhhhhhhhh'],
  [23,21,'hSsssSh'],                 // 发梢盖住一点后颈
  [24,22,'SsssS'],[25,22,'SsssS'],[26,22,'TSSST'],
  [27,17,'jJJJJJjjjjjjjd'],
  [28,15,'djD'],[28,18,'jJJJjjjjjjddd'],[28,32,'Djd'],
  [29,14,'dJjD'],[29,18,'jJJjjjjjjjddd'],[29,31,'DJjd'],
  [30,14,'dJjD'],[30,18,'jJJjjjjjjjddd'],[30,31,'DJjd'],
  [31,14,'dJjD'],[31,18,'jJdddddddddDd'],[31,31,'DJjd'],   // 过肩缝
  [32,14,'dJjD'],[32,18,'jJJjjjdjjjddd'],[32,31,'DJjd'],
  [33,14,'dJjD'],[33,18,'jJJjjjdjjjddd'],[33,31,'DJjd'],
  [34,14,'dJjD'],[34,18,'jJJjjjdjjjddd'],[34,31,'DJjd'],
  [35,14,'dJjD'],[35,18,'jJJjjjdjjjddd'],[35,31,'DJjd'],
  [36,14,'dJjD'],[36,18,'jJJjjjdjjjddd'],[36,31,'DJjd'],
  [37,14,'dJjD'],[37,18,'jJJjjjdjjjddd'],[37,31,'DJjd'],
  [38,15,'dJjD'],[38,19,'jJJjjdjjjdd'],[38,30,'DJjd'],
  [39,15,'dJjD'],[39,19,'jJJjjdjjjdd'],[39,30,'DJjd'],
  [40,15,'dJjD'],[40,19,'jJJjjdjjjdd'],[40,30,'DJjd'],
  [41,15,'SssS'],[41,19,'jJJjjdjjjdd'],[41,30,'SssS'],
  [42,15,'SssS'],[42,19,'jJJjjdjjjdd'],[42,30,'SssS'],
  [43,15,'TSST'],[43,19,'ddddddddddd'],[43,30,'TSST'],
  [44,19,'dDddqdddDdd'],
  [45,19,'pPPppqppPPp'],[46,19,'pPPppqppPPp'],
  [47,19,'pPPpqqqppPp'],[48,19,'pPPpqqqppPp'],[49,19,'pPPpqqqppPp'],
  [50,19,'pPPpq'],[50,25,'qppPp'],[51,19,'pPPpq'],[51,25,'qppPp'],
  [52,19,'pPPpq'],[52,25,'qppPp'],[53,19,'pPPpq'],[53,25,'qppPp'],
  [54,19,'pPPpq'],[54,25,'qppPp'],[55,19,'pPPpq'],[55,25,'qppPp'],
  [56,20,'PPpq'],[56,25,'qppP'],[57,20,'qppq'],[57,25,'qppq'],
  [58,19,'nbbbb'],[58,25,'bbbbn'],                    // 背面看到的是鞋跟
  [59,19,'nbbbb'],[59,25,'bbbbn'],
  [60,19,'nnbbb'],[60,25,'bbbnn'],
  [61,19,'nnnnn'],[61,25,'nnnnn'],
];
// ── 侧面（朝东）：窄得多，鼻子探出去，一条腿在前一条在后
const ART_E = [
  // 侧面（朝东）。上一版两处错：鼻子探出两格成了尖刺；身体比头窄太多 ——
  // 人侧过来的厚度大约是肩宽的三分之二，不是一片纸。
  [ 8,21,'hhhhhhhh'],
  [ 9,19,'hhHHHHHHHHh'],
  [10,18,'hhHHHHHHHHHHh'],
  [11,18,'hhxHHHHHHHHHs'],
  [12,18,'hhxxHHHHHHHss'],
  [13,18,'hhxxxxxxxxhss'],            // 刘海
  [14,18,'hhxxxxxxxssss'],
  [15,18,'hhxxxxsxxxxss'],            // 眉
  [16,18,'hhxxxseeeesss'],            // 上睫毛
  [17,18,'hhxxxsEiiEsss'],            // 侧面同样留白
  [18,18,'hhxxxssiiisss'],[18,31,'s'],  // 鼻尖只探一格
  [19,18,'hhxxxsssSssss'],[19,31,'s'],
  [20,18,'hhxxssssssSss'],
  [21,19,'hhxsssTTsssS'.slice(0,11)],   // 嘴
  [22,20,'hhsssssssS'],
  [23,21,'hSsssssS'],
  [24,22,'SsssSS'],                     // 下巴收尖
  [25,22,'SsssS'],[26,22,'TSSST'],
  // 躯干 x18~31（厚度 14），近侧手臂压在前面，后面留一道暗缝
  [27,18,'jJJJJJjjjjjjjd'],
  [28,18,'jJJJjjjjjjjddd'],[28,24,'DJjd'],
  [29,18,'jJJjjjjjjjjddd'],[29,24,'DJjd'],
  [30,18,'jJJjjjjjjjjddd'],[30,24,'DJjd'],
  [31,18,'jJJjjjjjjjjddd'],[31,24,'DJjd'],
  [32,18,'jJJjjjjjjjjddd'],[32,24,'DJjd'],
  [33,18,'jJJjjjjjjjjddd'],[33,24,'DJjd'],
  [34,18,'jJJjjjjjjjjddd'],[34,24,'DJjd'],
  [35,18,'jJJjjjjjjjjddd'],[35,24,'DJjd'],
  [36,18,'jJJjjjjjjjjddd'],[36,24,'DJjd'],
  [37,18,'jJJjjjjjjjjddd'],[37,24,'DJjd'],
  [38,19,'jJJjjjjjjddd'],[38,24,'DJjd'],
  [39,19,'jJJjjjjjjddd'],[39,24,'DJjd'],
  [40,19,'jJJjjjjjjddd'],[40,24,'DJjd'],
  [41,19,'jJJjjjjjjddd'],[41,24,'SssS'],
  [42,19,'jJJjjjjjjddd'],[42,24,'SssS'],
  [43,19,'dddddddddddd'],[43,24,'TSST'],
  [44,19,'dDddqdddDddd'],
  [45,19,'pPPppqppPPpp'],[46,19,'pPPppqppPPpp'],
  [47,19,'qqppqqppPPpp'],[48,19,'qqppqqppPPpp'],[49,19,'qqppqqppPPpp'],
  [50,19,'qqppq'],[50,24,'pPPpp'],   // 后腿压暗、前腿提亮 —— 这是前后腿唯一的区别
  [51,19,'qqppq'],[51,24,'pPPpp'],
  [52,19,'qqppq'],[52,24,'pPPpp'],
  [53,19,'qqppq'],[53,24,'pPPpp'],
  [54,19,'qqppq'],[54,24,'pPPpp'],
  [55,19,'qqppq'],[55,24,'pPPpp'],
  [56,20,'qppq'],[56,24,'pPPp'],
  [57,20,'qppq'],[57,24,'qppp'],
  [58,18,'nbbbn'],[58,23,'bBbbbbn'],
  [59,18,'nbbbn'],[59,23,'bBbbbbn'],
  [60,18,'nnbbn'],[60,23,'bbbbbbn'],
  [61,18,'nnnnn'],[61,23,'nnnnnnn'],
];

function partOf(y, x0, profile) {
  if (y <= 26) return 'head';
  if (y <= 44) {
    if (profile) return x0 >= 22 ? 'armR' : 'torso';      // 侧面只有近侧一条手臂
    return x0 < 18 ? 'armL' : x0 >= 30 ? 'armR' : 'torso';
  }
  if (y <= 49) return 'torso';                            // 胯跟着躯干走
  if (y <= 57) return x0 < 24 ? 'legL' : 'legR';          // 侧面：legL 是后腿、legR 是前腿
  return x0 < 23 ? 'bootL' : 'bootR';
}

// 正面/背面：腿的前后幅度【很小】。照侧面的幅度画正面就成了劈叉 ——
// 正面的走路靠抬腿和身体起伏读出来，不靠迈得多远。
const WALK_F = [
  { armL:[ 1, 0], armR:[-1, 0], legL:[ 1, 0], legR:[-1, 0], bootL:[ 1, 0], bootR:[-1, 0] },
  { head:[0,-1], torso:[0,-1], armL:[0,-1], armR:[0,-1], legR:[0,-2], bootR:[0,-2] },
  { armL:[-1, 0], armR:[ 1, 0], legL:[-1, 0], legR:[ 1, 0], bootL:[-1, 0], bootR:[ 1, 0] },
  { head:[0,-1], torso:[0,-1], armL:[0,-1], armR:[0,-1], legL:[0,-2], bootL:[0,-2] },
];
// 侧面：前后大幅摆动，手和腿反相 —— 同相摆动是"顺拐"，一眼就看得出不对
const WALK_P = [
  { armR:[-2, 0], legR:[ 3, 0], bootR:[ 3, 0], legL:[-3, 0], bootL:[-3, 0] },
  { head:[0,-1], torso:[0,-1], legR:[0,-3], bootR:[0,-3], legL:[-1, 0], bootL:[-1, 0] },
  { armR:[ 2, 0], legR:[-3, 0], bootR:[-3, 0], legL:[ 3, 0], bootL:[ 3, 0] },
  { head:[0,-1], torso:[0,-1], legL:[0,-3], bootL:[0,-3], legR:[-1, 0], bootR:[-1, 0] },
];
// 4 出手 · 5 预备/收手 · 6 处决
const ATK_F = {
  4: { armR:[ 5,-9], head:[ 1, 0], torso:[ 1, 0] },
  5: { armR:[-4,-4], head:[-1, 0], torso:[-1, 0] },
  6: { head:[0, 3], torso:[0, 3], armL:[0, 3], armR:[ 4, 6], legL:[0, 2], legR:[0, 2] },
};
const ATK_P = {
  4: { armR:[ 9,-7], head:[ 1, 0], torso:[ 1, 0] },
  5: { armR:[-6,-4], head:[-1, 0], torso:[-1, 0] },
  6: { head:[1, 4], torso:[0, 3], armR:[ 7, 5], legL:[0, 2], legR:[0, 2], bootL:[0, 1], bootR:[0, 1] },
};

// 手臂绕【肩】转，腿绕【胯】转 —— 肩胯不动，末端动得最多。
// 上一版把手臂当刚体整条平移，出手那帧就把整条手臂从肩膀上扯下来了。
const PIVOT = { armL: [27, 43], armR: [27, 43], legL: [49, 57], legR: [49, 57] };

function compose(px, pal, ART, off, profile) {
  for (const [y, x0, str] of ART) {
    const part = partOf(y, x0, profile), own = off[part] || [0, 0];
    // 部件有父子关系：躯干一动，挂在它身上的手臂、腿、靴子都得跟着动。
    // 上一版各走各的，躯干上抬一格而大腿顶端不动，胯那里就裂开了。
    const T = part === 'head' || part === 'torso' ? [0, 0] : (off.torso || [0, 0]);
    const o = [own[0] + T[0], own[1] + T[1]];
    const pv = PIVOT[part];
    // 支点：末端动得最多，肩胯不动
    const at = yy => {
      if (!pv) return o;
      const t = Math.max(0, Math.min(1, (yy - pv[0]) / (pv[1] - pv[0])));
      // 向零取整，不是四舍五入：支点那几行必须【严格不动】。
      // round 会把 t=0.125 的 0.625 进成 1，肩头往外挪一格 —— 而它本来紧贴躯干，
      // 一格就是一道缝，整条手臂从身上掉下来。
      return [Math.trunc(own[0] * t) + T[0], Math.trunc(own[1] * t) + T[1]];
    };
    const [dx, dy] = at(y);
    // 每行的垂直位移不一样，行与行之间会被【拉开空隙】—— 上一版处决帧的手臂
    // 就是这样成了一条虚线。把跳过的目标行补上。
    const Yprev = (y - 1) + at(y - 1)[1];
    const Y0 = Yprev + 1 < y + dy ? Yprev + 1 : y + dy;
    for (let Y = Y0; Y <= y + dy; Y++) {
      if (Y < 0 || Y >= LH) continue;
      [...str].forEach((ch, k) => {
        const X = x0 + k + dx;
        if (ch === '.' || X < 0 || X >= LW) return;
        const c = pal[ch];
        if (!c) throw new Error(`行 ${y} 未知色号 '${ch}'`);
        px.set(X, Y, c);
      });
    }
  }
  return px;
}

// 字母色号 → 这个角色自己的颜色。底板是共用的，颜色不是。
function letters(spec) {
  const skin = PAL[spec.skin || 'skinFair'], hair = PAL[spec.hair || 'hairBrown'];
  const top = PAL[spec.topColor || 'olive'], pant = PAL[spec.pantColor || 'denim'];
  const shoe = PAL[spec.shoeColor || 'leather'], inner = PAL[spec.innerColor || 'bone'];
  return {
    k: [24, 22, 22],
    h: dim(hair.a, .55), x: hair.b, H: lit(hair.a),
    s: skin.a, S: shade(skin.a, .78), T: shade(skin.a, .58),
    e: [34, 30, 34], E: [246, 244, 240],
    // 虹膜低饱和 —— 全场唯一的高饱和留给僵尸的眼睛，那是"一眼认出危险"的硬规则
    i: PAL[spec.iris || 'denim'].b,
    w: inner.a, W: lit(inner.a),
    j: top.a, J: lit(top.a), d: shade(top.a, .62), D: shade(top.a, .44),
    p: pant.a, P: lit(pant.a), q: shade(pant.a, .60),
    b: shoe.a, B: lit(shoe.a), n: shade(shoe.a, .55),
  };
}

// 贴地那一圈压暗：不做整圈描边，只把脚和地面分开。
// 对整个轮廓的下沿都压会在头发底下多出一道线，头看着像和身子断开。
function groundEdge(px) {
  const src = px.d.slice();
  for (let y = 56; y < LH; y++) for (let x = 0; x < LW; x++) {
    if (src[y * LW + x]) continue;
    if (src[(y - 1) * LW + x] && !(y < LH - 1 && src[(y + 1) * LW + x])) px.d[y * LW + x] = [22, 20, 20];
  }
  return px;
}

const DIR_ART = [ART_S, ART_N, ART_E, ART_E];

// 手的位置：用和底板【同一套】位移算，不能各算各的。
// 各算各的就会出现"手在动而家伙不动"，那比完全不动还怪。
// 静止时的手心是从底板上量的：正/背面右手 x30~33、侧面近手 x24~27，都在 41~43 行。
const HAND0 = { 0:[31, 42], 1:[31, 42], 2:[25, 42], 3:[25, 42] };
function handAt(dir, slot) {
  const profile = dir >= 2;
  const off = slot < 4 ? (profile ? WALK_P : WALK_F)[slot] : (profile ? ATK_P : ATK_F)[slot];
  const own = off.armR || [0, 0], T = off.torso || [0, 0], pv = PIVOT.armR;
  const t = Math.max(0, Math.min(1, (42 - pv[0]) / (pv[1] - pv[0])));   // 手在第 42 行
  const b = HAND0[dir];
  const x = b[0] + Math.trunc(own[0] * t) + T[0], y = b[1] + Math.trunc(own[1] * t) + T[1];
  return dir === 2 ? [LW - 1 - x, y] : [x, y];      // 西面是东面镜像
}
// atk: 0 走路（用 fr）· 1 出手 · 2 预备/收手 · 3 处决
function draw(spec, fr, dir = 0, atk = 0) {
  const px = new Px(), profile = dir >= 2;
  const slot = atk === 0 ? (fr & 3) : 3 + atk;
  const off = slot < 4 ? (profile ? WALK_P : WALK_F)[slot] : (profile ? ATK_P : ATK_F)[slot];
  compose(px, letters(spec), DIR_ART[dir], off, profile);
  hat(px, spec, CX - 7, CX + 7, HY0 + (off.head ? off.head[1] : 0));
  groundEdge(px);
  if (dir === 2) px.mirror();                          // 西面 = 东面镜像
  return px;
}

function face(px, spec, skin, hy0) {
  const ey = hy0 + 5, lx = CX - 3, rx = CX + 2, f = spec.face || 'neutral';
  for (const ex of [lx, rx]) {
    if (f === 'tired') { px.set(ex, ey, OL); px.set(ex + 1, ey, OL); px.set(ex, ey + 1, skin.b); }
    else if (f === 'grim') { px.set(ex, ey, OL); px.set(ex + 1, ey, OL); }
    else if (f === 'wide') { px.set(ex, ey, OL); px.set(ex + 1, ey, [246, 242, 234]); px.set(ex, ey + 1, OL); px.set(ex + 1, ey + 1, OL); }
    else { px.set(ex, ey, OL); px.set(ex + 1, ey, OL); px.set(ex + 1, ey + 1, skin.b); }
  }
  const my = hy0 + 8;
  if (f === 'grim') px.rect(CX - 1, my, CX + 1, my, OL);
  else if (f === 'tired') { px.rect(CX - 1, my, CX, my, skin.b); }
  else px.rect(CX - 1, my, CX, my, OL);
  if (spec.brow) { px.rect(lx, ey - 2, lx + 1, ey - 2, PAL[spec.hair || 'hairBrown'].b);
                   px.rect(rx, ey - 2, rx + 1, ey - 2, PAL[spec.hair || 'hairBrown'].b); }
  px.set(CX, ey + 2, dim(skin.b, .88));                              // 鼻影
  px.rect(lx, ey - 1, lx + 1, ey - 1, dim(skin.b, .92));             // 眉骨下的暗
  px.rect(rx, ey - 1, rx + 1, ey - 1, dim(skin.b, .92));
  if (spec.beard) { px.rect(CX - 3, my + 1, CX + 2, my + 2, PAL[spec.hair || 'hairBrown'].b);
                    px.rect(CX - 3, my + 1, CX - 1, my + 1, dim(PAL[spec.hair || 'hairBrown'].b, .85)); }
}

function hairDraw(px, spec, hair, hx0, hx1, hy0) {
  const s = spec.hairstyle || 'short';
  if (s === 'bald') { px.rect(hx0, hy0 + 2, hx0, hy0 + 4, hair.b); px.rect(hx1, hy0 + 2, hx1, hy0 + 4, hair.b); return; }
  px.rect(hx0 + 1, hy0 - 1, hx1 - 1, hy0 - 1, hair.a);
  px.rect(hx0, hy0, hx1, hy0 + 2, hair.a);
  px.rect(hx0 + 1, hy0 - 1, hx0 + 4, hy0 - 1, lit(hair.a, 1.25));    // 头顶受光
  px.rect(hx0, hy0, hx0 + 2, hy0, lit(hair.a, 1.12));
  px.rect(hx1 - 1, hy0, hx1, hy0 + 2, hair.b);                       // 背光侧
  for (let i = 0; i < 3; i++) px.set(hx0 + 2 + i * 3, hy0 + 1, hair.b);   // 几缕发丝
  if (s === 'buzz') px.rect(hx0, hy0 + 3, hx1, hy0 + 3, hair.b);
  if (s === 'short' || s === 'messy') { px.rect(hx0 - 1, hy0 + 1, hx0 - 1, hy0 + 4, hair.a); px.rect(hx1 + 1, hy0 + 1, hx1 + 1, hy0 + 4, hair.a); }
  if (s === 'messy') for (const dx of [1, 4, 7, 9]) px.set(hx0 + dx, hy0 - 2, hair.a);
  if (s === 'side') { px.rect(hx0, hy0 + 3, hx0 + 5, hy0 + 3, hair.a); px.rect(hx1 + 1, hy0 + 1, hx1 + 1, hy0 + 3, hair.a); }
  if (s === 'long') { px.rect(hx0 - 1, hy0 + 1, hx0 - 1, hy0 + 12, hair.a); px.rect(hx1 + 1, hy0 + 1, hx1 + 1, hy0 + 12, hair.a); }
  if (s === 'ponytail') { px.rect(hx1 + 1, hy0 + 1, hx1 + 2, hy0 + 2, hair.a); px.rect(hx1 + 2, hy0 + 3, hx1 + 3, hy0 + 8, hair.a); }
  if (s === 'bun') { px.rect(CX - 2, hy0 - 4, CX + 1, hy0 - 2, hair.a); px.rect(CX + 1, hy0 - 3, CX + 1, hy0 - 2, hair.b); }
}

function hat(px, spec, hx0, hx1, hy0) {
  const c = spec.hat; if (!c) return;
  const col = PAL[spec.hatColor || 'charcoal'];
  if (c === 'cap') { px.rect(hx0, hy0 - 2, hx1, hy0 + 1, col.a); px.rect(hx0 - 2, hy0 + 2, hx1, hy0 + 2, col.b); }
  if (c === 'beanie') { px.rect(hx0, hy0 - 3, hx1, hy0 + 1, col.a); px.rect(hx0, hy0 + 2, hx1, hy0 + 2, col.b); }
  if (c === 'hood') { px.rect(hx0 - 1, hy0 - 2, hx1 + 1, hy0 + 2, col.a); px.rect(hx0 + 1, hy0 + 1, hx1 - 1, hy0 + 4, null); px.rect(hx0 - 1, hy0 + 3, hx0, hy0 + 6, col.b); px.rect(hx1, hy0 + 3, hx1 + 1, hy0 + 6, col.b); }
}

// ---------------- 贴花：画在透明底上，游戏里叠在本体上 ----------------
// 状态外显（策划第十一节）：玩家不该靠翻面板才知道自己在流血。
function decal(kind, fr, opt = {}, dir = 0, atk = 0) {
  // 【手上/手臂上的东西要跟着手臂摆】：第一版只取了 W.bob，
  // 于是武器和手臂绷带在四帧之间只上下抖 1 像素，手臂在摆它们不动 —— 直接贡献"丑"。
  const px = new Px(), W = WALK[fr & 3], B = W.bob, S = W.swing;
  const back = dir === 1, prof = dir === 2 || dir === 3;
  const tY0 = TY0 + B, hy0 = HY0 + B, bone = PAL.bone, blood = PAL.blood;
  if (kind === '绷带') {
    const part = opt.part || '躯干';
    if (part === '头') px.rect(CX - 5, hy0 + 3, CX + 4, hy0 + 4, bone.a);
    else if (part === '躯干') { px.rect(CX - 5, tY0 + 3, CX + 4, tY0 + 5, bone.a); px.rect(CX - 5, tY0 + 5, CX + 4, tY0 + 5, bone.b); }
    else if (part === '左臂') px.rect(CX - 7, tY0 + 3 - S, CX - 6, tY0 + 6 - S, bone.a);
    else if (part === '右臂') px.rect(CX + 5, tY0 + 3 + S, CX + 6, tY0 + 6 + S, bone.a);
    else if (part === '左腿') px.rect(CX - 4, HIP + 4, CX - 2, HIP + 6, bone.a);
    else px.rect(CX + 1, HIP + 4, CX + 3, HIP + 6, bone.a);
  } else if (kind === '血渍') {
    const n = opt.level || 1;
    px.rect(CX - 2, tY0 + 4, CX, tY0 + 5, blood.a);
    if (n >= 2) { px.rect(CX + 1, tY0 + 6, CX + 2, tY0 + 7, blood.b); px.rect(CX - 4, tY0 + 2, CX - 3, tY0 + 2, blood.a); }
    if (n >= 3) { px.rect(CX - 3, HIP + 2, CX - 1, HIP + 4, blood.b); px.rect(CX + 2, tY0 + 1, CX + 3, tY0 + 2, blood.a); }
  } else if (kind === '冬装') {
    px.rect(CX - 7, tY0, CX + 6, tY0 + 9, PAL.charcoal.a);
    px.rect(CX + 4, tY0, CX + 6, tY0 + 9, PAL.charcoal.b);
    px.rect(CX - 4, tY0 - 1, CX + 3, tY0 + 1, PAL.brick.a);          // 围巾
    px.rect(CX + 2, tY0 + 2, CX + 3, tY0 + 4, PAL.brick.b);
  } else if (kind === '背包') {
    if (back) {                                                      // 背面：包在正中，最显眼
      px.rect(CX - 4, tY0 + 1, CX + 3, tY0 + 8, PAL.olive.a);
      px.rect(CX - 4, tY0 + 1, CX - 2, tY0 + 8, lit(PAL.olive.a, 1.1));
      px.rect(CX - 4, tY0 + 4, CX + 3, tY0 + 4, PAL.olive.b);
    } else if (prof) {                                               // 侧面：包在身后
      px.rect(CX - 7, tY0 + 2, CX - 5, tY0 + 8, PAL.olive.a);
      px.rect(CX - 7, tY0 + 4, CX - 5, tY0 + 4, PAL.olive.b);
    } else {
      px.rect(CX - 8, tY0 + 1, CX - 6, tY0 + 7, PAL.olive.a);
      px.rect(CX - 8, tY0 + 4, CX - 6, tY0 + 4, PAL.olive.b);
      px.rect(CX - 5, tY0 + 2, CX - 5, tY0 + 5, PAL.leather.b);      // 肩带
    }
  } else if (kind === '武器') {
    const w = opt.weapon || '斧';
    // 【以前这里是旧的 32×42 坐标】，人物换成 48×63 之后武器落在小臂中段，
    // 而且撬棍只有"1 像素宽、8 像素高的一条线" —— 游戏里差 4 个逻辑像素，等于看不见。
    // 现在按 handAt() 算的手心画，宽度和长度都按新身材来。
    const slot = atk === 0 ? (fr & 3) : 3 + atk;
    let [hx, hy] = handAt(dir === 2 ? 3 : dir, slot);     // 先在东面空间算，最后统一镜像
    // 侧面的手在躯干轮廓【里面】，家伙照原位画就成了贴在胸口的一道条 —— 往身前挪两格
    if (prof) hx += 2;
    // 撬棍原来用 steel：钢灰压在灰外套上分不出来。武器得跟衣服有明度差才读得出。
    const st = { a:[168, 176, 182], b:[64, 70, 76] };
    const lt = PAL.leather, ch = PAL.charcoal;
    const bar = (x0, y0, x1, y1, c) => px.rect(x0, y0, x1, y1, c);
    if (w === '撬棍') {                       // 撬棍：直杆 + 顶上一个弯钩
      bar(hx, hy - 14, hx + 1, hy + 2, st.a);
      bar(hx, hy - 14, hx + 1, hy - 13, st.b);
      bar(hx + 2, hy - 14, hx + 3, hy - 13, st.a);        // 钩
      bar(hx, hy + 1, hx + 1, hy + 2, st.b);
    } else if (w === '斧') {                  // 斧：木柄 + 一块看得出形状的斧头
      bar(hx, hy - 13, hx + 1, hy + 2, lt.a);
      bar(hx, hy - 13, hx + 1, hy - 12, lt.b);
      bar(hx - 2, hy - 15, hx + 3, hy - 11, st.a);
      bar(hx - 3, hy - 14, hx - 3, hy - 12, st.a);        // 刃口再探一格
      bar(hx - 2, hy - 15, hx + 3, hy - 15, st.b);
    } else if (w === '锤') {                  // 锤：短柄 + 方头
      bar(hx, hy - 10, hx + 1, hy + 2, lt.a);
      bar(hx - 2, hy - 13, hx + 3, hy - 10, st.b);
      bar(hx - 2, hy - 13, hx + 3, hy - 12, st.a);
    } else if (w === '长矛') {                // 长矛：很长的杆 + 尖
      bar(hx, hy - 22, hx + 1, hy + 4, lt.b);
      bar(hx, hy - 26, hx + 1, hy - 23, st.a);
      bar(hx, hy - 27, hx, hy - 27, st.b);
    } else if (w === '菜刀') {                // 菜刀：短柄 + 一块方刃
      bar(hx, hy - 3, hx + 1, hy + 2, ch.a);
      bar(hx - 1, hy - 9, hx + 2, hy - 4, st.a);
      bar(hx - 1, hy - 9, hx + 2, hy - 9, st.b);
    }
    if (dir === 2) px.mirror();               // 西面：连武器一起镜像
  } else if (kind === '冻伤') {
    px.rect(CX - 8, tY0 + 8 - S, CX - 6, tY0 + 9 - S, PAL.skinPale.a);   // 手跟着摆
    px.rect(CX + 5, tY0 + 8 + S, CX + 7, tY0 + 9 + S, PAL.skinPale.a);
    px.rect(CX - 4, FOOT - 1, CX - 2, FOOT - 1, PAL.skinPale.a);
    px.rect(CX + 1, FOOT - 1, CX + 3, FOOT - 1, PAL.skinPale.a);
  }
  return px;
}

// ---------------- 六个职业的起手外观 ----------------
const JOBS = {
  护士:   { build: 'slim', skin: 'skinFair', hair: 'hairBrown', hairstyle: 'bun',      face: 'tired',   top: 'shirt',    topColor: 'bone',  pants: 'slacks', pantColor: 'bone',     shoes: 'sneakers', shoeColor: 'bone' },
  木匠:   { build: 'stout', skin: 'skinTan',  hair: 'hairBlack', hairstyle: 'buzz',     face: 'grim',    top: 'coverall', topColor: 'denim', pants: 'jeans',  pantColor: 'denim',    shoes: 'boots',    shoeColor: 'leather', hat: 'cap', hatColor: 'ochre', brow: true },
  警察:   { build: 'std',   skin: 'skinFair', hair: 'hairBlack', hairstyle: 'short',    face: 'grim',    top: 'jacket',   topColor: 'slate', pants: 'slacks', pantColor: 'charcoal', shoes: 'boots',    shoeColor: 'charcoal', brow: true },
  农民:   { build: 'std',   skin: 'skinTan',  hair: 'hairGray',  hairstyle: 'side',     face: 'neutral', top: 'shirt',    topColor: 'olive', pants: 'cargo',  pantColor: 'leather',  shoes: 'boots',    shoeColor: 'leather',  hat: 'cap', hatColor: 'olive', beard: true },
  厨子:   { build: 'stout', skin: 'skinFair', hair: 'hairBrown', hairstyle: 'messy',    face: 'neutral', top: 'tee',      topColor: 'bone',  pants: 'jeans',  pantColor: 'charcoal', shoes: 'sneakers', shoeColor: 'charcoal' },
  闲人:   { build: 'slim',  skin: 'skinPale', hair: 'hairBrown', hairstyle: 'long',     face: 'wide',    top: 'hoodie',   topColor: 'brick', pants: 'jeans',  pantColor: 'denim',    shoes: 'sneakers', shoeColor: 'bone' },
};

// ---------------- 按种子生成（图集后面几行）----------------
function h01(seed, salt) {
  let x = (Math.imul(seed, 2654435761) + Math.imul(salt, 40503)) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0; x = Math.imul(x, 1274126177) >>> 0; x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}
const pickOf = (seed, salt, arr) => arr[Math.floor(h01(seed, salt) * arr.length) % arr.length];
function genLook(seed) {
  const s = {
    build: pickOf(seed, 1, ['std', 'std', 'slim', 'stout']),
    skin: pickOf(seed, 2, ['skinFair', 'skinFair', 'skinTan', 'skinPale']),
    hair: pickOf(seed, 3, ['hairBlack', 'hairBrown', 'hairBrown', 'hairGray']),
    hairstyle: pickOf(seed, 4, HAIRS),
    face: pickOf(seed, 5, FACES),
    top: pickOf(seed, 6, TOPS),
    topColor: pickOf(seed, 7, ['olive', 'slate', 'ochre', 'brick', 'bone', 'charcoal', 'denim']),
    pants: pickOf(seed, 8, PANTS),
    pantColor: pickOf(seed, 9, ['denim', 'charcoal', 'leather', 'olive']),
    shoes: pickOf(seed, 10, SHOES),
    shoeColor: pickOf(seed, 11, ['leather', 'charcoal', 'bone']),
    hat: pickOf(seed, 12, HATS),
    hatColor: pickOf(seed, 13, ['charcoal', 'olive', 'ochre', 'slate']),
    brow: h01(seed, 14) < .6,
    beard: h01(seed, 15) < .3,
  };
  if (s.top === 'hoodie' && s.hat === 'hood') s.hatColor = s.topColor;
  return s;
}

// ---------------- 图集 ----------------
function rowSpecs() {
  const names = Object.keys(JOBS), specs = names.map(n => JOBS[n]);
  for (let i = names.length; i < ATLAS_ROWS; i++) { specs.push(genLook(3000 + i)); names.push('gen' + String(i).padStart(2, '0')); }
  return { names, specs };
}
// 图集：24 列 = 4 向 × 6 帧（走路 4 + 出手 + 收手），列号 = dir*6 + slot
// slot 0~3 走路 · 4 出手 · 5 收手
// slot 0~3 走路 · 4 出手 · 5 收手 · 6 处决（压低身子往下砸）
const PER_DIR = 7, COLS = 4 * PER_DIR;
const colOf = (dir, slot) => dir * PER_DIR + slot;
function buildAtlas() {
  const { specs } = rowSpecs();
  const FW = LW * SCALE, FH = LH * SCALE;
  const sheet = new Sheet(FW * COLS, FH * ATLAS_ROWS);
  specs.forEach((spec, r) => {
    for (let d = 0; d < 4; d++) {
      for (let f = 0; f < 4; f++) sheet.blit(draw(spec, f, d, 0), colOf(d, f) * FW, r * FH, SCALE);
      sheet.blit(draw(spec, 0, d, 1), colOf(d, 4) * FW, r * FH, SCALE);
      sheet.blit(draw(spec, 0, d, 2), colOf(d, 5) * FW, r * FH, SCALE);
      sheet.blit(draw(spec, 0, d, 3), colOf(d, 6) * FW, r * FH, SCALE);
    }
  });
  return sheet;
}
// 贴花图：一类一行（绷带六个部位、血渍三档、武器五件各占一行的四帧里的变体）
function decalRows() {
  const rows = [];
  for (const p of ['头', '躯干', '左臂', '右臂', '左腿', '右腿']) rows.push({ kind: '绷带', opt: { part: p }, label: '绷带·' + p });
  for (const l of [1, 2, 3]) rows.push({ kind: '血渍', opt: { level: l }, label: '血渍·' + l });
  rows.push({ kind: '冬装', opt: {}, label: '冬装' });
  rows.push({ kind: '背包', opt: {}, label: '背包' });
  for (const w of ['撬棍', '斧', '锤', '长矛', '菜刀']) rows.push({ kind: '武器', opt: { weapon: w }, label: '武器·' + w });
  rows.push({ kind: '冻伤', opt: {}, label: '冻伤' });
  return rows;
}
function buildDecalAtlas() {
  const rows = decalRows(), FW = LW * SCALE, FH = LH * SCALE;
  const sheet = new Sheet(FW * COLS, FH * rows.length);
  rows.forEach((r, i) => {
    for (let d = 0; d < 4; d++) {
      for (let f = 0; f < 4; f++) sheet.blit(decal(r.kind, f, r.opt, d), colOf(d, f) * FW, i * FH, SCALE);
      sheet.blit(decal(r.kind, 0, r.opt, d, 1), colOf(d, 4) * FW, i * FH, SCALE);
      sheet.blit(decal(r.kind, 0, r.opt, d, 2), colOf(d, 5) * FW, i * FH, SCALE);
      sheet.blit(decal(r.kind, 0, r.opt, d, 3), colOf(d, 6) * FW, i * FH, SCALE);
    }
  });
  return sheet;
}
// 预览：四季各一排，每排四个人；最后再加一排"贴花全开 vs 全关"
function buildPreview() {
  const { specs } = rowSpecs();
  const S = 3, per = 4, seasons = Object.keys(SEASON);
  const cellW = LW * S, rowH = LH * S + 10;
  const sheet = new Sheet(cellW * per * 2 + 16, rowH * (seasons.length + 1) + 16);
  sheet.fill([26, 28, 30]);
  const tint = (px, t) => {
    for (let i = 0; i < px.d.length; i++) if (px.d[i])
      px.d[i] = px.d[i].map((v, k) => clamp(v + t[k], 0, 255));
    return px;
  };
  seasons.forEach((sn, r) => {
    const ramp = SEASON[sn].ramp;
    for (let i = 0; i < per * 2; i++) {
      const spec = specs[i % specs.length];
      const ox = 8 + i * cellW, oy = 8 + r * rowH;
      for (let y = 0; y < LH * S; y++) for (let x = 0; x < cellW; x++) {         // 地面梯度当背景
        const c = ramp[Math.min(3, Math.floor(y / (LH * S / 4)))];
        const idx = ((oy + y) * sheet.w + ox + x) * 4;
        sheet.buf[idx] = c[0]; sheet.buf[idx + 1] = c[1]; sheet.buf[idx + 2] = c[2]; sheet.buf[idx + 3] = 255;
      }
      sheet.blit(tint(draw(spec, i & 3), SEASON[sn].tint), ox, oy, S);
    }
  });
  // 最后一排：左四个素身，右四个把七类贴花全叠上
  const oy = 8 + seasons.length * rowH;
  for (let i = 0; i < per * 2; i++) {
    const spec = specs[i % specs.length], ox = 8 + i * cellW;
    sheet.blit(draw(spec, 0), ox, oy, S);
    if (i >= per) {
      const on = [{ k: '绷带', o: { part: '躯干' } }, { k: '绷带', o: { part: '左臂' } },
                  { k: '血渍', o: { level: 3 } }, { k: '冻伤' }, { k: '冬装' },
                  { k: '背包' }, { k: '武器', o: { weapon: '斧' } }];
      on.sort((a, b) => DECAL_ORDER.indexOf(a.k) - DECAL_ORDER.indexOf(b.k));
      for (const d of on) sheet.blit(decal(d.k, 0, d.o || {}), ox, oy, S);
    }
  }
  return sheet;
}

function main() {
  const args = process.argv.slice(2);
  const outDir = path.join(ROOT, 'assets', 'sprites');
  fs.mkdirSync(outDir, { recursive: true });
  const atlas = buildAtlas().png();
  fs.writeFileSync(path.join(outDir, 'survivors96.png'), atlas);
  const dec = buildDecalAtlas().png();
  fs.writeFileSync(path.join(outDir, 'survivors_decal96.png'), dec);
  fs.writeFileSync(path.join(outDir, 'survivors_preview.png'), buildPreview().png());
  console.log(`assets/sprites/survivors96.png        帧 ${LW * SCALE}×${LH * SCALE}，${COLS} 列（4 向 × ${PER_DIR} 帧：走路 4 + 出手 + 收手）× ${ATLAS_ROWS} 行`);
  console.log(`assets/sprites/survivors_decal96.png  ${decalRows().length} 行贴花`);
  console.log(`assets/sprites/survivors_preview.png  四季各一排 + 贴花全开/全关`);
  console.log(`头身比 1:${((FOOT - HY0 + 1) / HH).toFixed(2)}（市井是 1:2.62）`);
  if (args.includes('--embed')) {
    const file = path.join(ROOT, 'games', 'quiet-street', 'index.html');
    if (!fs.existsSync(file)) { console.log('games/quiet-street/index.html 还不存在，跳过嵌入'); return; }
    const src = fs.readFileSync(file, 'utf8');
    const re = /^cast\.src='data:image\/png;base64,[A-Za-z0-9+/=]*';/m;
    // 贴花图集以前【只写到 assets/，从不嵌回游戏】—— 于是它生成了十七行却一次都没画过。
    const reD = /^deco\.src='data:image\/png;base64,[A-Za-z0-9+/=]*';/m;
    const miss = [!re.test(src) && 'cast.src', !reD.test(src) && 'deco.src'].filter(Boolean);
    if (miss.length) { console.error('没找到这几行，未写入：' + miss.join('、')); process.exit(1); }
    fs.writeFileSync(file, src
      .replace(re, `cast.src='data:image/png;base64,${atlas.toString('base64')}';`)
      .replace(reD, `deco.src='data:image/png;base64,${dec.toString('base64')}';`));
    console.log('已写回 games/quiet-street/index.html');
  }
}
if (require.main === module) main();
module.exports = { Sheet, draw, decal, handAt, decalRows, JOBS, genLook, buildAtlas, buildDecalAtlas, buildPreview,
  LW, LH, SCALE, ATLAS_ROWS, PAL, RAW, OL, EYE_GLOW, SEASON, DESAT, LCAP, toHSL, grade,
  FACES, HAIRS, TOPS, PANTS, SHOES, HATS, DECALS, RENDER_FX, DECAL_ORDER, HY0, HH, FOOT, BUILD,
  TY0, TY1, CX, lit, dim, DIRS, COLS, PER_DIR, colOf };
