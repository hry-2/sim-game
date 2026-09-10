#!/usr/bin/env node
// 霓虹废钢线 · 实战探针
// ==================================================================
// verify-neon 查的是「每个零件对不对」。这个查的是「凑在一起能不能玩」：
// 用假手柄驱动一个笨机器人真的把局打下去，看它死在第几波。
// 机器人只会：瞄最近的、边打边退、退的时候朝场地中间靠、冲刺一冷却好就用、
// 拿牌按一个固定优先级。它不会绕后打盾、不会先杀中继、不会攒冲刺躲爆囊，
// 所以它到的波数是这条曲线的【下限】—— 人应该打得比它远。
'use strict';
const { run, pad, padOff } = require('./neon-stub');
const NS = run(false);
const D = 1 / 60;

const len = (x, y) => Math.sqrt(x * x + y * y);

// 每个种子都从零号档案开始。不清的话里程碑奖励会跨局累积，
// 后跑的种子自带一身加成 —— 那比的是跑的顺序，不是这一局的难度。
function freshProf() {
  for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
  Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF)));
  NS.syncProf();
}

function play(seed, maxWave) {
  freshProf();
  NS.setMode('free'); NS.start(seed);            // 种子必须传给 start —— 它自己会重新播种
  const G = NS.G, P = NS.P;
  const log = [];
  let mods = [], elites = 0, buffs = 0, seenElite = new Set(), t = 0, w = 1, hpLow = 100;
  let lastWave = 1;
  let stall = 0, prevW = 1;
  while (G.state !== 'over' && G.wave <= maxWave && t < 60 * 40) {
    if (G.state === 'levelup') {
      // 按一个固定优先级拿牌。之前是无脑拿第一张，结果同一套数值下
      // 有的种子到 21 波、有的第 2 波就死 —— 那测的是运气不是曲线。
      const pri = ['dmg', 'rof', 'hp', 'count', 'spd', 'pierce', 'leech', 'crit', 'mag', 'shield'];
      if (!G.offer.length) { NS.G.state = 'play'; continue; }   // 兜底，正常不该发生
      const pick = G.offer.slice().sort((a, b) => {
        const ia = pri.indexOf(a.id), ib = pri.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })[0];
      NS.takeUpgrade(pick);
      continue;
    }
    // 目标：最近的活怪
    let tg = null, td = 1e9;
    for (const m of G.mobs) {
      if (m.dead) continue;
      const d = len(m.x - P.x, m.y - P.y);
      if (d < td) { td = d; tg = m; }
      if (m.elite && !seenElite.has(m)) { seenElite.add(m); elites++; }
    }
    // 顺手捡最近的掉落
    let dr = null, dd = 1e9;
    for (const d of G.drops) {
      const q = len(d.x - P.x, d.y - P.y);
      if (q < dd) { dd = q; dr = d; }
    }
    let mx = 0, my = 0;
    if (tg && td < 110) { mx = (P.x - tg.x) / td; my = (P.y - tg.y) / td; }   // 太近就退
    else if (dr) { mx = (dr.x - P.x) / (dd || 1); my = (dr.y - P.y) / (dd || 1); }
    // 后退时掺一点朝场中的分量：直着往后退会把自己顶到墙角里白送
    const cx = NS.ARENA.w / 2 - P.x, cy = NS.ARENA.h / 2 - P.y, cd = len(cx, cy) || 1;
    if (cd > Math.min(NS.ARENA.w, NS.ARENA.h) * .3) { mx += cx / cd * .8; my += cy / cd * .8; }
    const ml = len(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    const ax = tg ? (tg.x - P.x) / td : 1, ay = tg ? (tg.y - P.y) / td : 0;
    // 冲刺一冷却好就用，方向就是要跑的方向
    pad(mx, my, ax, ay, (P.dashCdT === 0 && tg && td < 150) ? [1] : []);
    NS.update(D);
    t += D;
    hpLow = Math.min(hpLow, P.hp / P.maxhp);
    stall = G.wave === prevW ? stall + D : 0; prevW = G.wave;
    if (stall > 180) return { seed, wave: G.wave, stalled: true, dead: false, t: Math.round(t),
      lv: P.lv, elites, mods, log, hpLow: Math.round(hpLow * 100) };
    if (G.wave !== lastWave) {
      log.push({ w: lastWave, hp: Math.round(P.hp / P.maxhp * 100), mod: G.mod ? G.mod.id : '' });
      lastWave = G.wave;
      if (G.mod) mods.push(G.wave + ':' + G.mod.id);
    }
  }
  padOff();
  const picked = Object.keys(G.buffs).length;
  return { seed, wave: G.wave, dead: G.state === 'over', by: G.deathBy, t: Math.round(t),
    lv: P.lv, elites, mods, log, hpLow: Math.round(hpLow * 100), picked };
}

const MAXW = Number(process.argv[2] || 20);
const seeds = [1, 20260910, 777, 424242, 9];
console.log(`每个种子最多打 ${MAXW} 波，机器人只会瞄最近的 + 边打边退\n`);
let reached = [];
for (const s of seeds) {
  const r = play(s, MAXW);
  reached.push(r.wave);
  console.log(`种子 ${String(s).padEnd(9)} → 第 ${String(r.wave).padStart(2)} 波${r.dead ? ` 死了（${r.by || '?'}）` : r.stalled ? ' 卡住了（三分钟没推进）' : ' 还活着'}`
    + `  等级 ${String(r.lv).padStart(2)}  用了 ${String(r.t).padStart(3)}s  见过 ${String(r.elites).padStart(2)} 个精英  血最低 ${r.hpLow}%`);
  if (r.mods.length) console.log(`             修饰波：${r.mods.join('  ')}`);
}
const avg = reached.reduce((a, b) => a + b, 0) / reached.length;
// 「到第 5 波」是撞上 BOSS，不是打过 BOSS —— 要 > 5 才算过
const early = reached.filter(w => w <= 5).length, far = reached.filter(w => w > MAXW).length;
console.log(`\n平均到第 ${avg.toFixed(1)} 波（最差 ${Math.min(...reached)}，最好 ${Math.max(...reached)}）。`);
// 结论写成比例，不写成「全都」/「有一个」—— 五个种子里有一个翻车是正常方差，
// 一半翻车才是曲线有问题。
console.log(early <= 1 ? `✓ ${seeds.length} 局里只有 ${early} 局没过第一个 BOSS —— 开局是能学的`
  : `✗ ${seeds.length} 局里有 ${early} 局连第 5 波都没过，开局太陡`);
console.log(far < seeds.length ? `✓ ${seeds.length - far} 局在 ${MAXW} 波内被拦住了 —— 曲线没平掉`
  : `✗ 全部撑到 ${MAXW} 波还没事，后期没压力`);
