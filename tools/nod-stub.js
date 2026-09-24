#!/usr/bin/env node
// 点头 · 最小 DOM 桩 + 验收钩子契约
// ==================================================================
// 抽出来的理由和静街、霓虹一样：量具必须和游戏共用同一份环境。
// 桩要【贴着真 DOM 做】（霓虹教训十二）—— 桩偷懒的地方，就是以后写不出断言的地方。
//
// 这份桩比静街那份小很多，因为点头没有画布、没有精灵、没有存档：
// 它只有 DOM、WebAudio、一个传感器事件源，和一个【会咬人的 localStorage】。
//
// ------------------------------------------------------------------
// 【验收钩子契约】游戏必须挂在 window.NOD 上的东西。
// 这份契约就是量具对游戏的要求 —— 游戏还没写，所以它先在这里定稿。
//
//   开局
//     PACKS                  六个词包名（数组，不含「随机」）
//     WORDS                  { 词包名: [词, ...] }
//     SECS                   [60, 120, 180]，一局可选的三档
//     start({pack, secs, seed})
//                            开一局。pack 传词包名或 '随机'。
//                            种子【只能】来自这个参数或 ?seed=，
//                            start 里不许再用 Date.now() 重播种（霓虹教训四）
//
//   状态机（state 取值）
//     '起手'  3-2-1 倒数中，还没有词，局时没开始走
//     '进行'  屏幕上是一个词
//     '确认'  刚判定完，屏幕上是「猜中 / 跳过」确认画面，等回中位
//     '总结'  时间到了
//
//   推进（量具只用这两个，不碰真实时钟）
//     ready(ms)              推进起手倒数。它【不消耗局时】
//     tick(ms)               推进局时 ms 毫秒
//
//   判定层（ADR-0004：循环只认这一层，不知道传感器存在）
//     verdict('猜中'|'跳过') 唯一的判定入口。提交后进入 '确认'
//     release()              离开 '确认'，亮出下一个词
//
//   输入层（把姿态 / 点击翻译成 verdict + release，纯函数，可离线验）
//     feedNormal(z)          喂屏幕法线的竖直分量，-1(朝下) .. 0(朝前) .. +1(朝上)
//     feedTap(y, h)          喂一次点击：y 是触点纵坐标，h 是屏幕高
//     TH                     { 判定, 中位 } 两个门限（法线分量的绝对值）
//
//   读
//     packOf(word)           词属于哪个包（量具验随机包的跨包混抽要用）
//
//   子包
//     SUBS                   { 包名: [[子包名, 起, 止], ...] } —— 区间指向 WORDS[包名]，
//                            必须连续、无缝、恰好铺满整个包（量具钉着这条）
//     subsOf(pack)           这个包的子包名清单
//     subs()                 { 包名: 子包名 } —— 每个包各挑各的，没给的包整包参战
//     sub()                  只选了一个包时的那一个子包；多选或整类随机时是 null
//     start({packs:[...], subs:{包名:子包名}, ...})
//                            一局同时选好几个包；空列表 = 全部。
//                            细分入口在每张卡片上，所以细分【不】要求只选一个包：
//                            选了动物+食物，动物仍可以只抽「水里的」。
//                            subs 里写了没被选中的包，不会把那个包拉进来。
//     start({pack, sub, ...}) 单数形式是只选一个包时的糖；多选时 sub 无解，丢掉
//     packs()                这一局选了哪几个包
//     word()                 当前词；'起手' / '确认' / '总结' 时返回 null
//     shown()                屏幕上实际是什么：{kind:'倒数'|'词'|'确认'|'总结', ...}
//     left()                 剩余局时（毫秒）
//     score()                { 猜中, 跳过 }
//     log()                  [{ word, verdict }]，按出现顺序
//     usedMs()               实际用时（毫秒）
//     pace()                 平均每个词几秒。总结页第三个数用的是它，不是 usedMs ——
//                            一局总是跑满时间，usedMs 永远等于所选档位，不携带信息
//
//   总结
//     amend(i)               改判第 i 条，猜中 <-> 跳过，score() 跟着变
//
//   界面状态（为了把每条渲染路径都逼出来）
//     portrait(on)           切竖屏。竖屏要盖提示层且【暂停计时】
//     paint(name)/__painted  每条渲染路径进来时报一次名，记进 Set
//     PAINT_PATHS            应该被画到的路径名清单（含 '菜单' —— 还没开局时的那一屏）
//
// 契约变了就要同时改这里和 verify-nod.js。
// ==================================================================
'use strict';
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 路径只出现在这一行 —— 改名字只改这里，量具其余部分一个字不动。
const REAL = path.join(ROOT, 'games', 'nod', 'index.html');
// 游戏还不存在时，量具拿这个假游戏自检。量具自己也会有 bug，而量具的 bug
// 会被当成游戏的 bug（霓虹教训十九、二十三），所以它必须有个"已知正确"的靶子。
const FIXTURE = path.join(__dirname, '_nod_fixture.html');

const TARGET = process.env.NOD_TARGET || (fs.existsSync(REAL) ? REAL : FIXTURE);
const isFixture = TARGET === FIXTURE;
const html = fs.readFileSync(TARGET, 'utf8');
// 收集【所有】内联脚本，不是第一个（静街踩过：贪婪匹配会把中间的 HTML 吃进去）
const js = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [])
  .map(s => s.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')).join('\n;\n');

// ---- DOM 桩 ----------------------------------------------------------
// measureText 单调且区分中英（静街踩过：固定返回 10，所有排版断言都是假绿）。
// 点头屏幕上就一个巨大的词，"长词会不会撑破屏幕"是真要测的东西。
const ctxState = { font: '10px system-ui' };
const fontPx = f => { const m = /(\d+(?:\.\d+)?)px/.exec(String(f)); return m ? +m[1] : 10; };
const measure = str => {
  const px = fontPx(ctxState.font);
  let w = 0;
  for (const ch of String(str)) w += ch.charCodeAt(0) > 0x2e7f ? px : px * .6;
  return w;
};

const mkEl = () => {
  const cls = new Set(), attrs = {};
  let _text = '', _html = '';
  const el = {
    width: 0, height: 0, children: [], dataset: {}, hidden: false,
    style: { setProperty(k, v) { this[k] = v; } },
    classList: {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      contains: c => cls.has(c),
      toggle: (c, on) => { const want = on === undefined ? !cls.has(c) : !!on; cls[want ? 'add' : 'delete'](c); return want; },
    },
    firstElementChild: null, remove() {},
    addEventListener() {}, removeEventListener() {},
    // 真 DOM 有属性，桩缺了就测不到「哪个词包被选中」这类事（教训十二）
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: k => (k in attrs ? attrs[k] : null),
    hasAttribute: k => k in attrs, removeAttribute(k) { delete attrs[k]; },
    getContext: () => new Proxy({}, {
      get: (t, k) => k === 'measureText' ? (s => ({ width: measure(s) }))
        : k === 'font' ? ctxState.font
        : k === 'canvas' ? { width: 320, height: 200 }
        : (() => {}),
      set: (t, k, v) => { if (k === 'font') ctxState.font = v; return true; },
    }),
    appendChild(c) { el.children.push(c); if (!el.firstElementChild) el.firstElementChild = c; return c; },
    querySelectorAll: () => [], querySelector: () => null,
    focus() {}, blur() {},
    // 跟着 style.width/height 走（静街踩过：固定返回视口尺寸会造成两边一致、双双错）
    getBoundingClientRect() {
      const px = v => { const m = /(-?\d+(?:\.\d+)?)px/.exec(String(v || '')); return m ? +m[1] : null; };
      const w = px(el.style.width), h = px(el.style.height);
      return { left: 0, top: 0, width: w == null ? (el.width || 800) : w, height: h == null ? (el.height || 360) : h };
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

// ---- 会咬人的 localStorage -------------------------------------------
// 「阅后即焚」是一条设计承诺（CONTEXT.md），不是一句口号。源码里 grep 一次不够 ——
// 拼出来的 window['local'+'Storage'] 能躲过 grep。所以桩里放一个记账的假货：
// 谁碰了它都会被记下来，断言直接读 LS_TOUCHED。
let LS_TOUCHED = [];
const lsTrap = new Proxy({}, {
  get: (t, k) => { LS_TOUCHED.push(String(k)); return () => null; },
  set: (t, k) => { LS_TOUCHED.push('set:' + String(k)); return true; },
});

// ---- 运行 ------------------------------------------------------------
// sensor：有没有 DeviceOrientationEvent。没有传感器时游戏必须退到点击那条路 ——
// 那条分支在开发机上平时根本走不到（霓虹教训十三就是这么漏出来的）。
// portrait：竖屏。盖提示层并暂停计时这件事，只有在这里能测到。
function run(opts) {
  const o = opts || {};
  const search = o.search || '';
  LS_TOUCHED = [];
  ELS = {}; LISTEN = {};

  global.document = {
    createElement: mkEl, getElementById: byId,
    querySelector: () => mkEl(), querySelectorAll: () => [],
    addEventListener: on, removeEventListener() {},
    body: mkEl(), documentElement: mkEl(), head: mkEl(),
    hidden: false, visibilityState: 'visible',
  };
  global.window = global;
  global.addEventListener = on;
  global.removeEventListener = () => {};
  global.localStorage = lsTrap;
  global.sessionStorage = lsTrap;
  global.matchMedia = q => ({
    matches: /portrait/.test(q) ? !!o.portrait : /coarse/.test(q) ? o.touch !== false : false,
    addEventListener() {}, removeEventListener() {}, addListener() {},
  });
  global.screen = {
    orientation: {
      type: o.portrait ? 'portrait-primary' : 'landscape-primary',
      addEventListener() {},
      // 真机上 iOS Safari 不支持 lock()，桩也让它 reject —— 游戏不许依赖它成功
      lock: () => Promise.reject(new Error('not supported')),
      unlock() {},
    },
  };
  // 传感器：存在与否都要能跑。存在时带 requestPermission（iOS 13+ 的那道闸）。
  if (o.sensor === false) {
    delete global.DeviceOrientationEvent;
  } else {
    global.DeviceOrientationEvent = class {};
    if (o.permission !== false) {
      global.DeviceOrientationEvent.requestPermission =
        () => Promise.resolve(o.permission === 'denied' ? 'denied' : 'granted');
    }
  }
  // 最小 WebAudio 桩。不做它的话音效整段被 try/catch 吞掉，
  // 「起手倒数响没响」「最后十秒响没响」就永远测不到 —— 桩偷懒的地方就是测不到的地方。
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  global.AudioContext = class {
    constructor() { this.sampleRate = 44100; this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
    createOscillator() { return { type: '', frequency: param(), detune: param(), connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; }
    createBiquadFilter() { return { type: '', Q: param(), frequency: param(), connect() {}, disconnect() {} }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  };
  global.webkitAudioContext = global.AudioContext;
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
  global.performance = { now: () => 0 };
  global.location = { search, href: 'file:///nod/index.html' + search, hash: '', protocol: 'file:' };
  global.innerWidth = o.portrait ? 360 : 800;
  global.innerHeight = o.portrait ? 800 : 360;
  global.devicePixelRatio = 2;
  global.visualViewport = { width: global.innerWidth, height: global.innerHeight, addEventListener() {} };
  global.setTimeout = () => 0;
  global.clearTimeout = () => {};
  global.setInterval = () => 0;
  global.clearInterval = () => {};
  // Node 18+ 自带只读的 global.navigator，直接赋值会抛 —— 只能 defineProperty 盖掉
  Object.defineProperty(global, 'navigator', {
    value: { userAgent: 'node-stub', maxTouchPoints: o.touch === false ? 0 : 5 },
    configurable: true, writable: true,
  });
  global.NOD = undefined;

  eval(js);
  if (global.NOD) global.NOD.__ev = LISTEN;
  return global.NOD;
}

const lsTouched = () => LS_TOUCHED;

module.exports = { html, js, run, byId, fire, lsTouched, TARGET, isFixture, REAL, FIXTURE };
