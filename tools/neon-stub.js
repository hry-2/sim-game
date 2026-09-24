#!/usr/bin/env node
// 霓虹废钢线 · 最小 DOM 桩
// 抽出来是因为验收（verify-neon）和实战探针（probe-neon）要用同一份环境：
// 两边如果各写一份桩，探针里跑通的代码在验收里未必跑通，那两边都不可信了。
'use strict';
const fs = require('fs'), path = require('path');
const FILE = path.resolve(__dirname, '..', 'games', 'neon-scrapline', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

// 画布默认是个黑洞，但可以打开录制：ctx.__rec() 之后每次调用和每次赋值
// 都进 ctx.__ops。这是为了能验「屏幕上分得清吗」——「经验点像敌人子弹」
// 「跟班像掉落物」这类 bug 在数据层全是对的，只有画出来的东西能证伪。
const _ops = [];
let _rec = false;
const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'canvas') return { width: 320, height: 180 };
    if (k === '__rec') return on => { _rec = on !== false; _ops.length = 0; };
    if (k === '__ops') return _ops;
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'getImageData') return () => ({ data: new Uint8Array(4) });
    return (...a) => { if (_rec) _ops.push([k, ...a]); };
  },
  set: (t, k, v) => { if (_rec) _ops.push(['=' + k, v]); return true; },
});
// classList 是真的（一个 Set），元素按 id 缓存 —— 否则 getElementById 每次返回新对象，
// 「按钮被置灰了没有」这类状态改动在离线环境里根本观察不到。
const mkEl = () => {
  const cls = new Set();
  let _text = '', _html = '';
  const el = {
    width: 0, height: 0, children: [],
    style: { setProperty(k, v) { this[k] = v; } },
    classList: {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      contains: c => cls.has(c),
      toggle: (c, on) => { const want = on === undefined ? !cls.has(c) : !!on; cls[want ? 'add' : 'delete'](c); return want; },
    },
    firstElementChild: null, getContext: () => ctxStub, addEventListener() {}, remove() {},
    appendChild(c) { el.children.push(c); if (!el.firstElementChild) el.firstElementChild = c; return c; },
    querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 180 }),
  };
  // 真 DOM 会把 textContent 转成字符串，桩不转的话 `textContent === '10'`
  // 这种断言会因为拿到数字 10 而假红。
  Object.defineProperty(el, 'textContent', {
    get: () => _text, set: v => { _text = v == null ? '' : String(v); },
  });
  // innerHTML = '' 在真 DOM 里会把子元素清掉。桩不清的话「重画了列表」
  // 这种断言会数到旧的加新的。
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
let ELS = {};
const byId = id => (ELS[id] || (ELS[id] = mkEl()));
// 事件监听器要真的记下来。原来 addEventListener 是空实现，于是键位分支
// 只能拿正则查源码 ——「源码里有这行」和「按下去真的有反应」是两件事。
let LISTEN = {};
const on = (t, f) => { (LISTEN[t] = LISTEN[t] || []).push(f); };
const fire = (t, ev) => (LISTEN[t] || []).forEach(f => f(ev));
// ns 指明打给哪一份构建；不传就打给最近一次 run() 的
const key = (code, ns) => {
  const L = (ns && ns.__ev) || LISTEN;
  (L.keydown || []).forEach(f => f({ code, preventDefault() {} }));
};
global.document = { createElement: mkEl, getElementById: byId, querySelector: mkEl,
  querySelectorAll: () => [], addEventListener: on, body: mkEl() };
global.window = global; global.addEventListener = on; global.matchMedia = () => ({ matches: false });
global.requestAnimationFrame = () => 0; global.performance = { now: () => 0 };
// 时间钉死。不钉的话 start() 不传种子时 RUN_SEED 取 Date.now()，
// 整个套件里几十处 start() 就每次跑在不同的局上 —— 断言时绿时红，
// 而且只在「这一帧恰好又刷出一只更近的怪」这种巧合下才红，几乎抓不到。
// 每日局的 dayKey() 也走 Date.now()，一起钉死才比得起来。
const FIXED_NOW = Date.UTC(2026, 0, 2, 3, 4, 5);
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(FIXED_NOW); }
  static now() { return FIXED_NOW; }
};
global.location = { search: '', href: '' }; global.innerWidth = 1280; global.innerHeight = 720;
const realTimeout = global.setTimeout; global.setTimeout = () => 0;
const LS = {};
const FAKEPAD = { connected: true, axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 12 }, () => ({ pressed: false })) };
let PADS = [];
Object.defineProperty(global, 'navigator', {
  value: { getGamepads: () => PADS, userAgent: 'node' }, configurable: true, writable: true });
const pad = (lx, ly, rx, ry, btns) => {
  FAKEPAD.axes = [lx, ly, rx, ry];
  FAKEPAD.buttons.forEach((b, i) => { b.pressed = !!(btns && btns.includes(i)); });
  PADS = [FAKEPAD];
};
const padOff = () => { PADS = []; };
global.localStorage = { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: k => { delete LS[k]; } };
// 同一段脚本按【桌面】和【触屏】各跑一次 —— 触屏分支平时在开发机上根本走不到
function run(touch) {
  global.matchMedia = q => ({ matches: touch && /coarse/.test(q) });
  global.NS = undefined;
  ELS = {}; LISTEN = {};          // 每次重跑都给一套干净的元素和监听器
  global.document.body = mkEl();
  eval(js);
  // 每份构建的监听器单独挂在它自己的 NS 上。共用一个 LISTEN 的话，
  // 第二次 run() 会把第一份的监听器顶掉 —— 于是 key() 打到的是触屏那份，
  // 而断言看的是桌面那份，表现为「按了没反应」。
  if (global.NS) global.NS.__ev = LISTEN;
  return global.NS;
}

module.exports = { html, js, run, pad, padOff, FAKEPAD, realTimeout, byId, key, fire, ctx: ctxStub };
