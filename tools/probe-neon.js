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

function play(seed, maxWave, dg) {
  freshProf();
  if (dg) { NS.PROF.dangerMax = dg; NS.pickDanger(dg); }   // 档位要在 start 之前定
  NS.setMode('free'); NS.start(seed);            // 种子必须传给 start —— 它自己会重新播种
  const G = NS.G, P = NS.P;
  const log = [];
  let mods = [], elites = 0, buffs = 0, seenElite = new Set(), t = 0, w = 1, hpLow = 100;
  let lastWave = 1;
  let stall = 0, prevW = 1;
  while (G.state !== 'over' && G.wave <= maxWave && t < 60 * 40) {
    // 商店：一个笨买家。优先级是「回血 → 新枪 → 重摇 → 增益」，
    // 并且刻意留一半废钢不花 —— 全花光的话就量不出「留到下一局」这条路了。
    if (G.phase === 'shop') {
      const keep = G.scrapGot * .5;
      for (const id of ['fix', 'rr', 'buff']) {       // 军械不买：可能买到布雷器，它用不了
        while (G.scrap - (NS.SHOP.find(x => x.id === id) || {}).cost >= keep && NS.shopBuy(id)) { /* 能买就买 */ }
      }
      NS.closeShop();
      continue;
    }
    if (G.state === 'levelup') {
      // 按一个固定优先级拿牌。之前是无脑拿第一张，结果同一套数值下
      // 有的种子到 21 波、有的第 2 波就死 —— 那测的是运气不是曲线。
      // 机器人不会用布雷器 —— 那把枪的本事是「算他们会走哪」，
      // 而它只会瞄着打。换上去之后一发都打不死，直接卡住。
      // 这是量具的能力边界，不是那把枪的问题：有些武器的技巧是位置性的，
      // 机器人评估不了。所以让它跳过。
      if (G.offer.length > 1) {
        const usable = G.offer.filter(u => u.id !== 'w_mine');
        if (usable.length) G.offer = usable;
      }
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
    // 交战距离跟着【周围有几只】走，不用固定阈值。固定阈值两头都不对：
    //   定 110/130 → 它一直悬在打不动的带子上，一波磨 25 秒，最后触发
    //     「三分钟没推进」报成假卡死；
    //   定 75/95   → 贴太近，5 局里 2 局第 5 波前就死。
    // 人的打法本来就是「人少贴上去、人多拉开」，那就照这个写。
    // 另外它原来根本不会主动靠近（只会退和捡东西），一只站在远处的母巢
    // 能让它干等三分钟 —— 量具自己的毛病比游戏里的更难发现。
    let near = 0;
    for (const m of G.mobs) if (!m.dead && len(m.x - P.x, m.y - P.y) < 145) near++;
    const keepOut = Math.min(130, 70 + near * 9);
    let chasing = false;
    if (tg && td < keepOut) { mx = (P.x - tg.x) / td; my = (P.y - tg.y) / td; }
    else if (tg && td > keepOut + 22) { mx = (tg.x - P.x) / td; my = (tg.y - P.y) / td; chasing = true; }
    else if (dr) { mx = (dr.x - P.x) / (dd || 1); my = (dr.y - P.y) / (dd || 1); }
    // 后退时掺一点朝场中的分量：直着往后退会把自己顶到墙角里白送。
    // 但【追击时不掺】—— 目标缩在角落的时候，朝场中的拉力正好把追击抵消掉，
    // 两个向量打平，机器人就在原地打转。实测：剩一个中继在角落，152 秒不动。
    // 已经决定要贴上去了，就别让位置启发式把这个决定撤销。
    const cx = NS.ARENA.w / 2 - P.x, cy = NS.ARENA.h / 2 - P.y, cd = len(cx, cy) || 1;
    if (!chasing && cd > Math.min(NS.ARENA.w, NS.ARENA.h) * .3) { mx += cx / cd * .8; my += cy / cd * .8; }
    const ml = len(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    // 打提前量。原来瞄的是目标【当前】位置，而子弹飞 100px 要 0.37 秒，
    // 期间怪走了 9px —— 而怪的半径只有 5px，于是一直擦过去。
    // 后果是探针报了两次「卡住了」：场上剩几只慢怪，机器人全速开火 175 秒打不死。
    // 人会本能地打提前量或者干脆走近，机器人不会 —— 这是量具的毛病，不是游戏的。
    let ax = 1, ay = 0;
    if (tg) {
      const flight = td / Math.max(60, P.bspd || 265);
      const px = tg.x + (tg.vx || 0) * flight - P.x;
      const py = tg.y + (tg.vy || 0) * flight - P.y;
      const pl = len(px, py) || 1;
      ax = px / pl; ay = py / pl;
    }
    // 冲刺一冷却好就用，方向就是要跑的方向
    pad(mx, my, ax, ay, (P.dashCdT === 0 && tg && td < 150) ? [1] : []);
    NS.update(D);
    t += D;
    hpLow = Math.min(hpLow, P.hp / P.maxhp);
    stall = G.wave === prevW ? stall + D : 0; prevW = G.wave;
    if (stall > 180) {
      // 卡住的时候必须说清是【为什么】卡住，否则「卡了」这个结论没法用
      const boss = G.mobs.find(m => NS.isBoss(m));
      const comp = {};
      for (const m of G.mobs) if (!m.dead) comp[NS.MOB[m.type].nm] = (comp[NS.MOB[m.type].nm] || 0) + 1;
      const why = `预算剩 ${G.budget}，场上 ${Object.entries(comp).map(([k, v]) => k + '×' + v).join(' ') || '空'}`
        + (boss ? `，${NS.MOB[boss.type].nm} 还有 ${Math.round(boss.hp / boss.max * 100)}% 血` : '，没有 BOSS')
        + `，加时 ${(-G.waveT).toFixed(0)}s，过热=${G.overheat}`
        + `，最近的距离 ${Math.round(Math.min(...G.mobs.filter(m => !m.dead).map(m => len(m.x - P.x, m.y - P.y))))}px`;
      return { seed, wave: G.wave, stalled: true, why, dead: false, t: Math.round(t),
        lv: P.lv, elites, mods, log, hpLow: Math.round(hpLow * 100) };
    }
    if (G.wave !== lastWave) {
      log.push({ w: lastWave, hp: Math.round(P.hp / P.maxhp * 100), mod: G.mod ? G.mod.id : '' });
      lastWave = G.wave;
      if (G.mod) mods.push(G.wave + ':' + G.mod.id);
    }
  }
  padOff();
  const picked = Object.keys(G.buffs).length;
  return { seed, wave: G.wave, dead: G.state === 'over' && !G.won, won: !!G.won, by: G.deathBy, t: Math.round(t),
    lv: P.lv, elites, mods, log, hpLow: Math.round(hpLow * 100), picked,
    scrapGot: G.scrapGot, scrapLeft: G.scrap, bought: G.bought };
}

const MAXW = Number(process.argv[2] || 31);
const DG = Number(process.argv[3] || 0);
const seeds = [1, 20260910, 777, 424242, 9];
console.log(`每个种子最多打 ${MAXW} 波 · 危险等级 ${NS.DANGER[DG].n.replace(/ /g, '')}`);
console.log('机器人只会瞄最近的 + 边打边退，它到的波数是这条曲线的下限\n');
let reached = [], results = [];
for (const s of seeds) {
  const r = play(s, MAXW, DG);
  reached.push(r.wave); results.push(r);
  console.log(`种子 ${String(s).padEnd(9)} → 第 ${String(r.wave).padStart(2)} 波${r.won ? ' 撤离成功' : r.dead ? ` 死了（${r.by || '?'}）` : r.stalled ? ' 卡住了（三分钟没推进）' : ' 还活着'}`
    + `  等级 ${String(r.lv).padStart(2)}  用了 ${String(r.t).padStart(3)}s  见过 ${String(r.elites).padStart(2)} 个精英  血最低 ${r.hpLow}%`);
  if (r.scrapGot != null) console.log(`             捡到 ${r.scrapGot} 废钢，在商店买了 ${r.bought} 次，剩 ${r.scrapLeft} 存进档案`);
  if (r.stalled) console.log(`             卡住原因：${r.why}`);
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
// 这里只报事实，不设合格线 —— 「笨机器人该有多高通关率」是个主观取舍，
// 得靠人试玩来定，不该由我在这里编一个数字然后自己对着它调。
// 机器人的作用是：给出一个可复现的下限，以及在改动前后做对比。
const wins = results.filter(r => r.won).length;
const deaths = results.filter(r => r.dead);
const stalls = results.filter(r => r.stalled);
console.log(`撤离成功 ${wins} 局，死亡 ${deaths.length} 局，卡住 ${stalls.length} 局。`);
if (deaths.length) console.log(`  死在：${deaths.map(r => `第 ${r.wave} 波（${r.by || '?'}）`).join('，')}`);
const floors = results.map(r => r.hpLow);
console.log(`血量最低点：${floors.map(f => f + '%').join(' / ')} —— 越接近 0 说明真的被逼到了`);
console.log(stalls.length ? '✗ 有局卡住了，上面写了原因 —— 这是 bug，不是难度'
  : '✓ 没有卡住的局：每一波都收得掉');
