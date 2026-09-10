#!/usr/bin/env node
// 霓虹废钢线 · 最小 DOM 桩
// 抽出来是因为验收（verify-neon）和实战探针（probe-neon）要用同一份环境：
// 两边如果各写一份桩，探针里跑通的代码在验收里未必跑通，那两边都不可信了。
'use strict';
const fs = require('fs'), path = require('path');
const FILE = path.resolve(__dirname, '..', 'games', 'neon-scrapline', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'canvas') return { width: 320, height: 180 };
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'getImageData') return () => ({ data: new Uint8Array(4) });
    return () => {};
  }, set: () => true,
});
const mkEl = () => ({
  width: 0, height: 0, style: { setProperty() {} }, className: '', textContent: '', innerHTML: '',
  classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
  firstElementChild: null, getContext: () => ctxStub, addEventListener() {}, appendChild() {}, remove() {},
  querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 180 }),
});
global.document = { createElement: mkEl, getElementById: mkEl, querySelector: mkEl, querySelectorAll: () => [], addEventListener() {}, body: mkEl() };
global.window = global; global.addEventListener = () => {}; global.matchMedia = () => ({ matches: false });
global.requestAnimationFrame = () => 0; global.performance = { now: () => 0 };
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
  eval(js);
  return global.NS;
}

module.exports = { html, js, run, pad, padOff, FAKEPAD, realTimeout };
