#!/usr/bin/env node
'use strict';
// 把【外部 PNG 帧】变成静街要的精灵图集。
//
//   node tools/sprite_import.js <帧目录> [--colors 24] [--row 0]
//   node tools/sprite_import.js --sheet 图.png --cell 64x64 --pick "走:s=8,1..9" [...]
//   node tools/sprite_import.js --selftest
//
// 两种来源：
//   目录  —— 一帧一个文件（3D 渲染、AI 出图都是这种）
//   网格  —— 一张大图切格子（绝大多数免费精灵包是这种：行=动作×朝向，列=帧）
//
// 为什么需要它：不管美术是 3D 渲染出来的、买的、还是 AI 生成的，
// 进游戏之前都得过同一道关 —— 对齐到 96×126 的格子、降采样、量化调色板、硬边 alpha。
// 3D 渲染和 AI 出图都是【软边 + 连续色调】，不处理就不像像素画，只像缩小的照片。
//
// 帧命名：<朝向><分隔><动作>.png，朝向 s/n/w/e 或 0~3，动作 0~6
//   s-0.png  s-1.png … s-6.png   n-0.png …   w-0.png …   e-0.png …
//   （28 张；缺的帧会用同朝向的第 0 帧顶上，并在报告里列出来）
const fs = require('fs'), path = require('path');
const { decodePNG } = require('./png_io.js');
const { encodePNG } = require('./character_gen.js');

const FW = 96, FH = 126, COLS = 28, ROWS = 16, PER_DIR = 7;
const DIRN = { s:0, n:1, w:2, e:3, 0:0, 1:1, 2:2, 3:3 };
const SLOT_NAME = ['走0', '走1', '走2', '走3', '出手', '收手', '处决'];

// ── 取像素 ──
// ── 整数倍【最近邻】放大 ──
// 像素画只能整数倍最近邻放大。1.5 倍这种非整数缩放会把每个像素摊成一团糊，
// 那是像素画最忌讳的一件事。64 ×2 = 128，再裁进 96×126 就好。
function upscaleNN(img, k) {
  if (k <= 1) return img;
  const W = img.width * k, H = img.height * k;
  const out = { width: W, height: H, data: Buffer.alloc(W * H * 4) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = ((y / k | 0) * img.width + (x / k | 0)) * 4, d = (y * W + x) * 4;
    out.data[d] = img.data[s]; out.data[d + 1] = img.data[s + 1];
    out.data[d + 2] = img.data[s + 2]; out.data[d + 3] = img.data[s + 3];
  }
  return out;
}

// ── 把颜色拉进这个游戏的画风 ──
// 策划第十一节定的两个数：降饱和 20%、明度封顶 0.82。
// 外来素材（尤其奇幻 RPG 风的免费包）饱和度往往高得多，不处理就是两套画风打架。
function grade(img, desat, lcap) {
  const toH = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, sa = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, sa, l];
  };
  const toR = ([h, sa, l]) => {
    if (!sa) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < .5 ? l * (1 + sa) : l + sa - l * sa, pp = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? pp + (q - pp) * 6 * t : t < .5 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(Math.max(0, Math.min(1, v)) * 255));
  };
  for (let i = 0; i < img.data.length; i += 4) {
    if (!img.data[i + 3]) continue;
    const [h, sa, l] = toH([img.data[i], img.data[i + 1], img.data[i + 2]]);
    const c = toR([h, sa * (1 - desat), Math.min(l, lcap)]);
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
  }
  return img;
}

const at = (img, x, y) => {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return [0, 0, 0, 0];
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};

// ── 盒式降采样：按面积平均，只对【不透明】的部分平均 ──
// 直接采样最近邻会把 3D 渲染的细节采丢；把透明像素也算进平均会让边缘发灰。
function boxDown(img, w, h) {
  const out = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0, na = 0;
    const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.ceil((x + 1) * sx));
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.ceil((y + 1) * sy));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const p = at(img, xx, yy); na++; a += p[3];
      if (p[3] > 8) { r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; n += p[3]; }
    }
    const o = (y * w + x) * 4;
    if (n > 0) { out.data[o] = Math.round(r / n); out.data[o + 1] = Math.round(g / n); out.data[o + 2] = Math.round(b / n); }
    out.data[o + 3] = Math.round(a / Math.max(1, na));
  }
  return out;
}

// ── 调色板：中位切分 ──
// 3D 渲染是连续色调，几万种颜色。像素画的"干净"来自【少量确定的颜色】。
function medianCut(pixels, k) {
  let boxes = [pixels];
  while (boxes.length < k) {
    let bi = -1, best = -1;
    boxes.forEach((b, i) => { if (b.length < 2) return;
      let lo = [255, 255, 255], hi = [0, 0, 0];
      for (const p of b) for (let c = 0; c < 3; c++) { if (p[c] < lo[c]) lo[c] = p[c]; if (p[c] > hi[c]) hi[c] = p[c]; }
      const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * Math.log2(b.length + 1);
      if (span > best) { best = span; bi = i; }
    });
    if (bi < 0) break;
    const b = boxes[bi];
    let lo = [255, 255, 255], hi = [0, 0, 0];
    for (const p of b) for (let c = 0; c < 3; c++) { if (p[c] < lo[c]) lo[c] = p[c]; if (p[c] > hi[c]) hi[c] = p[c]; }
    const ax = [0, 1, 2].reduce((m, c) => hi[c] - lo[c] > hi[m] - lo[m] ? c : m, 0);
    b.sort((p, q) => p[ax] - q[ax]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.filter(b => b.length).map(b => {
    const s = [0, 0, 0];
    for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return s.map(v => Math.round(v / b.length));
  });
}
const nearest = (pal, c) => {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i], d = (p[0] - c[0]) ** 2 * .3 + (p[1] - c[1]) ** 2 * .59 + (p[2] - c[2]) ** 2 * .11;
    if (d < bd) { bd = d; bi = i; }
  }
  return pal[bi];
};

// ── 一帧：贴到 96×126，横向居中、【脚底对齐底边】 ──
// 对齐用脚不用中心 —— 人物是站在地上的，中心对齐会让走路时整个人上下浮动。
function fitFrame(img, colors, alphaCut) {
  let x0 = img.width, x1 = -1, y0 = img.height, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
    if (at(img, x, y)[3] > alphaCut) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { width: FW, height: FH, data: Buffer.alloc(FW * FH * 4) };
  const cw = x1 - x0 + 1, chh = y1 - y0 + 1;
  // 缩放要按【人物的包围盒】算，不是按格子。免费包的格子里人往往只占一半，
  // 按格子算会得到 ×1，人就一直是小小一个。
  // 放大只走【整数倍最近邻】—— 1.5 倍那种非整数缩放会把像素画糊掉。
  const fit = Math.min(FW / cw, FH / chh);
  let dw, dh, small;
  if (fit >= 2) {
    const k = Math.floor(fit);
    dw = cw * k; dh = chh * k;
  } else { const k = Math.min(fit, 1); dw = Math.max(1, Math.round(cw * k)); dh = Math.max(1, Math.round(chh * k)); }
  const crop = { width: cw, height: chh, data: Buffer.alloc(cw * chh * 4) };
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
    const p = at(img, x0 + x, y0 + y), o = (y * cw + x) * 4;
    crop.data[o] = p[0]; crop.data[o + 1] = p[1]; crop.data[o + 2] = p[2]; crop.data[o + 3] = p[3];
  }
  small = (dw > cw) ? upscaleNN(crop, Math.round(dw / cw)) : boxDown(crop, dw, dh);
  const out = { width: FW, height: FH, data: Buffer.alloc(FW * FH * 4) };
  const ox = Math.floor((FW - dw) / 2), oy = FH - dh;   // 脚底贴底边
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const s = (y * dw + x) * 4, d = ((oy + y) * FW + ox + x) * 4;
    // 【硬边 alpha】：像素画没有半透明边缘，软边缩完会糊成一圈灰
    if (small.data[s + 3] < alphaCut) continue;
    out.data[d] = small.data[s]; out.data[d + 1] = small.data[s + 1];
    out.data[d + 2] = small.data[s + 2]; out.data[d + 3] = 255;
  }
  return out;
}

function quantizeAll(frames, k) {
  const px = [];
  for (const f of frames) if (f) for (let i = 0; i < f.data.length; i += 4)
    if (f.data[i + 3]) px.push([f.data[i], f.data[i + 1], f.data[i + 2]]);
  if (!px.length) return 0;
  // 整组帧共用【同一张调色板】—— 每帧各量化各的，走起来颜色会闪
  const pal = medianCut(px, k);
  for (const f of frames) if (f) for (let i = 0; i < f.data.length; i += 4) {
    if (!f.data[i + 3]) continue;
    const c = nearest(pal, [f.data[i], f.data[i + 1], f.data[i + 2]]);
    f.data[i] = c[0]; f.data[i + 1] = c[1]; f.data[i + 2] = c[2];
  }
  return pal.length;
}

// ── 从网格图里切一格 ──
function cellOf(sheet, cw, ch, col, row) {
  const out = { width: cw, height: ch, data: Buffer.alloc(cw * ch * 4) };
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const p = at(sheet, col * cw + x, row * ch + y), o = (y * cw + x) * 4;
    out.data[o] = p[0]; out.data[o + 1] = p[1]; out.data[o + 2] = p[2]; out.data[o + 3] = p[3];
  }
  return out;
}
// --pick "走:s=8,1..4"  → 朝南的走路四帧取第 8 行的第 1~4 格
// --pick "出手:e=15,3"  → 朝东的出手取第 15 行第 3 格
// 语法：<动作>:<朝向>=<行>,<列或列区间>
//   动作 走 / 出手 / 收手 / 处决；朝向 s n w e
const ACT_SLOT = { 走:[0, 1, 2, 3], 出手:[4], 收手:[5], 处决:[6] };
function parsePicks(list) {
  const out = [];
  for (const spec of list) {
    const m = /^(走|出手|收手|处决):([snwe])=(\d+),(\d+)(?:\.\.(\d+))?$/.exec(spec);
    if (!m) throw new Error(`--pick 看不懂："${spec}"（要像 走:s=8,1..4）`);
    const slots = ACT_SLOT[m[1]], row = +m[3], c0 = +m[4], c1 = m[5] ? +m[5] : +m[4];
    const cols = []; for (let c = c0; c <= c1; c++) cols.push(c);
    if (m[1] === '走') {
      // 走路要四帧。给多了【等距取四张】，给少了循环补 —— 免费包常见 6/8/9 帧
      for (let i = 0; i < 4; i++)
        out.push({ slot: slots[i], dir: DIRN[m[2]], row, col: cols[Math.min(cols.length - 1, Math.round(cols.length * i / 4))] });
    } else out.push({ slot: slots[0], dir: DIRN[m[2]], row, col: cols[0] });
  }
  return out;
}

function loadDir(dir) {
  const got = new Array(COLS).fill(null), miss = [];
  for (const fn of fs.readdirSync(dir)) {
    const m = /^([snwe0-3])[-_ ]?([0-6])\.png$/i.exec(fn);
    if (!m) continue;
    const d = DIRN[m[1].toLowerCase()], slot = +m[2];
    got[d * PER_DIR + slot] = decodePNG(fs.readFileSync(path.join(dir, fn)));
  }
  for (let d = 0; d < 4; d++) for (let s = 0; s < PER_DIR; s++) {
    const i = d * PER_DIR + s;
    if (!got[i]) { got[i] = got[d * PER_DIR]; miss.push(['南', '北', '西', '东'][d] + '·' + SLOT_NAME[s]); }
  }
  return { got, miss };
}

function build(frames, row, colors) {
  const n = quantizeAll(frames, colors);
  const buf = Buffer.alloc(FW * COLS * FH * ROWS * 4);
  const AW = FW * COLS;
  // row === 'all'：把同一个角色填满 16 行。
  // 外来素材通常只有【一个】角色，而游戏的图集是 16 行（6 职业 + 10 个生成的路人）。
  // 只填第 0 行的话，其余 15 行是空的 —— 大部分角色会直接隐形。
  const rows = row === 'all' ? Array.from({ length: ROWS }, (_, i) => i) : [row];
  for (const r of rows) for (let cIdx = 0; cIdx < COLS; cIdx++) {
    const f = frames[cIdx]; if (!f) continue;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const s = (y * FW + x) * 4;
      if (!f.data[s + 3]) continue;
      const d = ((r * FH + y) * AW + cIdx * FW + x) * 4;
      buf[d] = f.data[s]; buf[d + 1] = f.data[s + 1]; buf[d + 2] = f.data[s + 2]; buf[d + 3] = 255;
    }
  }
  return { png: encodePNG(AW, FH * ROWS, buf), colors: n, rows: rows.length };
}

// ── 自测：拿现有图集当外来素材走一遍，看形状和内容有没有被弄坏 ──
function selftest() {
  const ROOT = path.resolve(__dirname, '..');
  const src = decodePNG(fs.readFileSync(path.join(ROOT, 'assets/sprites/survivors96.png')));
  let bad = 0;
  const cut = (col, row) => {
    const f = { width: FW, height: FH, data: Buffer.alloc(FW * FH * 4) };
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const p = at(src, col * FW + x, row * FH + y), o = (y * FW + x) * 4;
      f.data[o] = p[0]; f.data[o + 1] = p[1]; f.data[o + 2] = p[2]; f.data[o + 3] = p[3];
    }
    return f;
  };
  const frames = []; for (let c = 0; c < COLS; c++) frames.push(cut(c, 2));
  const before = frames.map(f => { let n = 0; for (let i = 3; i < f.data.length; i += 4) if (f.data[i]) n++; return n; });
  const r = build(frames, 0, 24);
  const back = decodePNG(r.png);
  const ok = (c, m) => { if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
  ok(back.width === FW * COLS && back.height === FH * ROWS, `图集 ${back.width}×${back.height}（要 ${FW * COLS}×${FH * ROWS}）`);
  let after = 0; for (let i = 3; i < back.data.length; i += 4) if (back.data[i]) after++;
  const sum = before.reduce((a, b) => a + b, 0);
  ok(Math.abs(after - sum) <= sum * .02, `不透明像素 ${sum} → ${after}（误差 ${(Math.abs(after - sum) / sum * 100).toFixed(1)}%，允许 2%）`);
  const cols = new Set(); for (let i = 0; i < back.data.length; i += 4) if (back.data[i + 3]) cols.add(back.data[i] + ',' + back.data[i + 1] + ',' + back.data[i + 2]);
  ok(cols.size <= 24, `量化到 ${cols.size} 色（上限 24）`);
  let soft = 0; for (let i = 3; i < back.data.length; i += 4) if (back.data[i] > 0 && back.data[i] < 255) soft++;
  ok(soft === 0, `没有半透明边缘（${soft} 个）—— 像素画不做软边`);
  console.log(bad ? `\n自测 ${bad} 条不过` : '\n自测全过');
  process.exit(bad ? 1 : 0);
}

const args = process.argv.slice(2);
if (args.includes('--selftest')) selftest();
// ── 看一张网格图的排版 ──
// 免费包的行列含义各家不同（有的第 8 行是朝南走路，有的是第 2 行）。
// 猜不如量：把每格有多少不透明像素打出来，一眼就能认出哪行是哪个动作。
if (args.includes('--inspect')) {
  const f = args[args.indexOf('--inspect') + 1];
  const m = /^(\d+)x(\d+)$/.exec(args[args.indexOf('--cell') + 1] || '64x64');
  const cw = +m[1], chh = +m[2];
  const img = decodePNG(fs.readFileSync(f));
  const C = Math.floor(img.width / cw), R = Math.floor(img.height / chh);
  console.log(`${f}\n${img.width}×${img.height}，格 ${cw}×${chh} → ${C} 列 × ${R} 行\n`);
  console.log('     ' + Array.from({ length: C }, (_, i) => String(i).padStart(4)).join(''));
  for (let r = 0; r < R; r++) {
    const cells = [];
    for (let c = 0; c < C; c++) {
      let n = 0;
      for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) if (at(img, c * cw + x, r * chh + y)[3] > 8) n++;
      cells.push(n ? String(Math.round(n / (cw * chh) * 99)).padStart(4) : '   ·');
    }
    console.log(String(r).padStart(4) + ' ' + cells.join(''));
  }
  console.log('\n数字=该格被画满的百分比，· 表示空格。');
  process.exit(0);
}
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const colors = +opt('colors', 24) || 24;
const rowArg = opt('row', '0');
const row = rowArg === 'all' ? 'all' : (+rowArg || 0);
const noGrade = args.includes('--no-grade');
const sheetPath = opt('sheet');
let frames, miss = [];

if (sheetPath) {
  // ── 网格模式：一张大图切格子 ──
  const cell = /^(\d+)x(\d+)$/.exec(opt('cell', '64x64'));
  if (!cell) throw new Error('--cell 要像 64x64');
  const cw = +cell[1], chh = +cell[2];
  const sheet = decodePNG(fs.readFileSync(sheetPath));
  const picks = parsePicks(args.filter((a, i) => args[i - 1] === '--pick'));
  if (!picks.length) throw new Error('网格模式需要至少一条 --pick，例如 --pick "走:s=8,1..9"');
  // 整数倍最近邻放大到接近目标高度 —— 非整数缩放会把像素画糊掉
  const k = Math.max(1, Math.floor(FH / chh));
  frames = new Array(COLS).fill(null);
  for (const p of picks) frames[p.dir * PER_DIR + p.slot] = upscaleNN(cellOf(sheet, cw, chh, p.col, p.row), k);
  for (let d = 0; d < 4; d++) for (let sl = 0; sl < PER_DIR; sl++) {
    const i = d * PER_DIR + sl;
    if (!frames[i]) { frames[i] = frames[d * PER_DIR]; miss.push(['南','北','西','东'][d] + '·' + SLOT_NAME[sl]); }
  }
  console.log(`网格 ${cw}×${chh}，最近邻放大 ×${k} → ${cw * k}×${chh * k}`);
} else {
  const dir = args.find(a => !a.startsWith('--') && a !== opt('colors', null) && a !== opt('row', null));
  if (!dir) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 20).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(0); }
  const r = loadDir(dir); frames = r.got; miss = r.miss;
}

let fitted = frames.map(f => f && fitFrame(f, colors, 128));
// 外来素材（尤其奇幻 RPG 风的免费包）饱和度往往高得多 —— 不拉进画风就是两套画风打架
if (!noGrade) fitted = fitted.map(f => f && grade(f, 0.20, 0.82));
const r = build(fitted, row, colors);
const out = path.resolve(__dirname, '..', 'assets/sprites/imported96.png');
fs.writeFileSync(out, r.png);
console.log(`assets/sprites/imported96.png  ${FW * COLS}×${FH * ROWS}，填了 ${r.rows} 行，${r.colors} 色${noGrade ? '' : '，已拉进画风（降饱和 20%、明度封顶 .82）'}`);
if (miss.length) console.log(`缺了 ${miss.length} 帧（用同朝向第 0 帧顶上）：${miss.join('、')}`);
