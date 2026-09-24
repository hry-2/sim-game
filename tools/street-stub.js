#!/usr/bin/env node
// 静街 · 最小 DOM 桩 + 验收钩子契约
// ==================================================================
// 抽出来的理由和霓虹一样：验收（verify-street）和探针（probe-street）必须
// 共用同一份环境。两边各写一份桩的话，探针里跑通的代码在验收里未必跑通，
// 于是两边都不可信。
//
// 桩要【贴着真 DOM 做】（霓虹教训十二）：元素按 id 缓存、classList 是真的 Set、
// appendChild 真的记下孩子、textContent 真的转字符串、innerHTML='' 真的清孩子。
// 桩偷懒的地方，就是以后写不出断言的地方。
//
// ------------------------------------------------------------------
// 【验收钩子契约】游戏必须挂在 window.QS 上的东西。
// 这份契约就是量具对游戏的要求 —— 游戏还没写，所以它先在这里定稿。
//
//   世界与推进
//     start(seed)            开一局。种子【只能】来自这个参数或 ?seed=，
//                            start 里不许再用 Date.now() 重播种（霓虹教训四）
//     update(dt)             推进 dt 现实秒
//     render()               画一帧。每条绘制路径进来时调一次 paint('名字')，
//                            把名字记进 QS.__drawn —— 否则"画错一个字要到浏览器里才发现"
//     DRAW_PATHS             应该被画到的路径名清单（数组）
//     __drawn                Set，render() 实际走过的路径名
//     tileHash()             瓦片布局的哈希，用来验"同种子同镇"
//
//   世界状态
//     TOWN   { seed, day, hhmm, season, W, H, houses[], containers[], searched }
//     BLOCKS [{ id, name, pop, init, heat, lock, adj[] }]
//     Z      [{ x, y, state }]                 僵尸
//     P      { x, y, stance, body{}, wounds[], infect, inv[], dead }
//     kills, waves
//
//   数据表（第一节到第五节那几张）
//     HOUSE_TYPE, CONTAINER, LOOT, ITEMS, RECIPES, WOUND, NOISE
//
//   动作（探针驱动游戏只准用这些，不许直接改状态）
//     noise(x, y, r, durSec)     move(dx, dy, stance)      advanceHours(h)
//     lootContainer(id)          useItem(name)             treat(part, step)
//     drinkFrom(houseId)         水源：停水日之前能喝
//     migrate()                  每天 04:00 的迁移结算，单独暴露以便直接验
//     wave() / kill(n)           浪潮与击杀，用来验守恒
//     setUI(s) / night(on)       切界面状态与昼夜，只为把每条绘制路径都逼出来
//
//   表（除数据规格里那几张之外，探针要读的）
//     SPEED      { 蹲行, 走, 跑, 僵尸游荡, 僵尸追击 } —— 三角关系不许调飞
//     TEMP_BASE  { 季节: { 户外, 室内 } }   warmth() 当前保暖值
//     INFECT_TEXT{ wound, zombie }         两套词汇，一个词都不许重合
//
//   日志与死亡
//     LOG     [{ day, lines[] }]
//     death   null | { cause, day, hhmm }
//     deathReport()              三段文案，返回 { cause, lines[] }
//
//   存档
//     save(), load(), wipeChar(), wipeTown()
//
// 契约变了就要同时改这里、verify-street.js 和数据规格第十节。
// ==================================================================
'use strict';
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 定名还没落（策划第〇节的 ⬜），所以路径只在这一行里 ——
// 改名字只改这一行，量具的其余部分一个字不用动。
const REAL = path.join(ROOT, 'games', 'quiet-street', 'index.html');
// 游戏还不存在时，量具拿这个假游戏自检。量具自己的 bug 会被当成游戏的 bug
// （霓虹教训十九、二十三），所以它必须有一个"已知正确"的靶子。
const FIXTURE = path.join(__dirname, '_street_fixture.html');

const TARGET = process.env.QS_TARGET || (fs.existsSync(REAL) ? REAL : FIXTURE);
const isFixture = TARGET === FIXTURE;
const html = fs.readFileSync(TARGET, 'utf8');
// 收集【所有】内联脚本，不是第一个。单个贪婪匹配在有两个 <script> 时会把
// 中间的 HTML 也吃进去，报一个看不懂的语法错。
const js = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [])
  .map(s => s.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')).join('\n;\n');

// ---- 画布桩：记下每个被调用的绘制方法，好让"真的画过"能被断言 ----
let OPS = [];
// 【桩要表现得像真 DOM】—— 这个仓库第四次被这条咬（前三次是缺 Image、缺 AudioContext、
// 缺 playbackRate）。measureText 以前固定返回 10，于是所有"排版会不会超出画布"的断言
// 全是假绿：33 个字量出来 22 像素，怎么比都通过。
// 不需要精确，只需要【单调且区分中英】：等宽字体里汉字约等于字号，ASCII 约 0.6 倍。
const ctxState = { font: '10px monospace' };
const fontPx = f => { const m = /(\d+(?:\.\d+)?)px/.exec(String(f)); return m ? +m[1] : 10; };
const measure = str => {
  const px = fontPx(ctxState.font);
  let w = 0;
  for (const ch of String(str)) w += ch.charCodeAt(0) > 0x2e7f ? px : px * .6;
  return w;
};
const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'canvas') return { width: 960, height: 640 };
    if (k === 'font') return ctxState.font;
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return s => ({ width: measure(s) });
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (k === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    return (...a) => { OPS.push(k); };
  },
  set: (t, k, v) => { if (k === 'font') ctxState.font = v; return true; },
});

const mkEl = () => {
  const cls = new Set();
  let _text = '', _html = '';
  const el = {
    width: 0, height: 0, children: [], dataset: {},
    style: { setProperty(k, v) { this[k] = v; } },
    classList: {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      contains: c => cls.has(c),
      toggle: (c, on) => { const want = on === undefined ? !cls.has(c) : !!on; cls[want ? 'add' : 'delete'](c); return want; },
    },
    firstElementChild: null, getContext: () => ctxStub, addEventListener() {}, remove() {},
    appendChild(c) { el.children.push(c); if (!el.firstElementChild) el.firstElementChild = c; return c; },
    querySelectorAll: () => [], querySelector: () => null,
    // 【桩要表现得像真 DOM】—— 第五次栽在这条上。
    // 以前固定返回 960×640，于是任何"按元素实际尺寸排版"的代码在量具里
    // 都算出一个跟真实情况无关的数，而断言拿同一个错值去比，两边一致、双双错 ——
    // 最阴的那种假绿。现在跟着 style.width/height 走（fit() 设的就是它）。
    getBoundingClientRect() {
      const px = v => { const m = /(-?\d+(?:\.\d+)?)px/.exec(String(v || '')); return m ? +m[1] : null; };
      const w = px(el.style.width), h = px(el.style.height);
      // 画布比视口宽时浏览器把居中退化成靠左（实测如此），所以 left 取 0
      return { left: 0, top: 0, width: w == null ? (el.width || 960) : w, height: h == null ? (el.height || 640) : h };
    },
  };
  Object.defineProperty(el, 'textContent', { get: () => _text, set: v => { _text = v == null ? '' : String(v); } });
  Object.defineProperty(el, 'innerHTML', {
    get: () => _html,
    set: v => { _html = v == null ? '' : String(v); if (!_html) { el.children.length = 0; el.firstElementChild = null; } },
  });
  Object.defineProperty(el, 'className', {
    get: () => [...cls].join(' '),
    set: v => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => cls.add(x)); },
  });
  return el;
};

let ELS = {}, LISTEN = {};
const byId = id => (ELS[id] || (ELS[id] = mkEl()));
const on = (t, f) => { (LISTEN[t] = LISTEN[t] || []).push(f); };
const fire = (t, ev) => (LISTEN[t] || []).forEach(f => f(ev));
const key = code => fire('keydown', { code, key: code, preventDefault() {} });

const LS = {};
global.localStorage = {
  getItem: k => (k in LS ? LS[k] : null),
  setItem: (k, v) => { LS[k] = String(v); },
  removeItem: k => { delete LS[k]; },
  get length() { return Object.keys(LS).length; },
  key: i => Object.keys(LS)[i],
};
const realTimeout = global.setTimeout;

// touch 参数：同一段脚本按【桌面】和【触屏】各跑一次 ——
// 触屏分支在开发机上平时根本走不到（霓虹教训十三就是这么漏出来的）
function run(touch) {
  global.document = {
    createElement: mkEl, getElementById: byId, querySelector: mkEl,
    querySelectorAll: () => [], addEventListener: on, body: mkEl(),
    documentElement: mkEl(), head: mkEl(),
  };
  global.window = global;
  global.addEventListener = on;
  global.matchMedia = q => ({ matches: !!touch && /coarse/.test(q), addEventListener() {} });
  // 真浏览器有 Image，桩不该缺 —— 缺了游戏里那句 new Image() 直接抛错，
  // 而那是嵌入精灵图集的必经之路。onload 立刻触发，当作图已经解好。
  global.Image = class { constructor() { this.width = 0; this.height = 0; }
    set src(v) { this._src = v; this.width = 384; this.height = 2016; if (this.onload) this.onload(); }
    get src() { return this._src; } };
  // 最小 AudioContext 桩。不做它的话 sfx() 直接 return，
  // 「音效有没有偷偷消耗游戏随机数」这条就永远测不到 —— 桩偷懒的地方就是测不到的地方。
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  global.AudioContext = class {
    constructor() { this.sampleRate = 44100; this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d, length: n }; }
    createGain() { return { gain: param(), connect() {} }; }
    // playbackRate 是真 BufferSource 一定有的 —— 桩少一个属性，游戏里一行赋值就崩
    createBufferSource() { return { buffer: null, playbackRate: param(), detune: param(), connect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { type: '', Q: param(), frequency: param(), connect() {} }; }
    createOscillator() { return { type: '', frequency: param(), connect() {}, start() {}, stop() {} }; }
    resume() {}
  };
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
  global.performance = { now: () => 0 };
  global.location = { search: '', href: '', hash: '' };
  global.innerWidth = 1280; global.innerHeight = 800;
  global.devicePixelRatio = 2;
  global.visualViewport = { width: 1280, height: 800, addEventListener() {} };
  global.setTimeout = () => 0;
  global.QS = undefined;
  ELS = {}; LISTEN = {}; OPS = [];
  eval(js);
  if (global.QS) global.QS.__ev = LISTEN;
  return global.QS;
}

const ops = () => OPS;
const opsReset = () => { OPS = []; };

module.exports = { html, js, run, byId, key, fire, ops, opsReset, realTimeout, TARGET, isFixture, REAL, FIXTURE };
