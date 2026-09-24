#!/usr/bin/env node
// 静街 · 生存探针（凑起来能不能活）
// ==================================================================
// verify-street 查的是「每个零件对不对」。这个查的是「凑在一起能不能活」：
// 用一个笨机器人真的把日子过下去，看它死在第几天、死于什么。
//
// 机器人只会：渴了喝、饿了吃、有药就处理伤口、白天出去翻最近没翻过的柜子、
// 撞墙了绕一下、门锁着就撬、天黑就回屋。它不会算噪音预算、不会绕开高密度街区、
// 不会为过冬屯柴火、不会打架。所以它活的天数是这条曲线的【下限】——
// 人应该活得比它久。
//
// 打在真游戏上之后补的三件事（每一件都是【量具的洞】，不是游戏的）：
//   ① 撞墙要绕。原来按 Math.sign 直线走，撞上墙就站着不动，
//      12 局里 8 局被自己的卡死检测报成僵局。
//   ② 要调 update(dt)。原来只推时钟不推实体 —— 僵尸一步没动过，
//      于是死因分布里永远没有"被围"，看着像战斗系统不存在。
//   ③ 要会开门撬门翻窗。门有 45%~95% 的概率是锁着的，不撬就永远进不了屋，
//      搜刮覆盖率卡在 10%，然后饿死占 58%。
//
// 四张表（顺序就是重要性）：
//   ① 死因分布   ★ 调平衡的唯一依据。任何一项超过 40%，说明别的系统在当装饰
//   ② 存活天数
//   ③ 噪音总量与街区密度 + 守恒校验
//   ④ 卡死检测 + 活动半径趋势（半径递减 = 游戏在奖励缩着，风险清单第 4 条）
//
// 用法：node tools/probe-street.js [局数=20] [风险倍率=1]
'use strict';
const { run, isFixture, REAL } = require('./street-stub');
const QS = run(false);
if (!QS) { console.log('拿不到 QS 钩子，契约见 tools/street-stub.js 头部'); process.exit(1); }

const N = Number(process.argv[2] || 20);
const RISK = Number(process.argv[3] || 1);
const MAXDAY = 60;
const HOME = { x: 8, y: 70 };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// 种子：前五个固定，方便跨改动对比；其余按等差铺开
const SEEDS = [1, 20260911, 777, 424242, 9];
while (SEEDS.length < N) SEEDS.push(SEEDS.length * 104729 + 13);
SEEDS.length = N;

function play(seed) {
  QS.start(seed);
  if ('__risk' in QS) QS.__risk = RISK;
  const P = QS.P, T = QS.TOWN;
  const daily = [];                       // 每天一行：噪音、密度、活动半径
  let noiseDay = 0, radiusDay = 0, day = T.day;
  let lastSearched = 0, stallH = 0, stalled = null;
  // 【声明放在主循环前面】：function 会提升，let 不会 ——
  // 放在循环后面就是暂时性死区，跑起来报 "Cannot access 'det' before initialization"。
  // 这个仓库在这上面栽过不止一次（市井文档里数到第六次）。
  let det = 0, detDir = 1;
  const houseOf = id => T.houses[T.containers[id].house];

  for (let h = 0; h < MAXDAY * 24 && !P.dead; h++) {
    const hour = T.hour;
    // —— 维持：渴了喝、饿了吃、冷了穿 ——
    if (P.body.口渴 < 45) drink();
    if (P.body.饥饿 < 45) eat();
    if (T.season === '冬' && QS.warmth && QS.warmth() < 30) wear();
    // —— 伤口：有东西就按四步处理，缺的那步就跳过（于是感染概率自己会涨）——
    for (const wd of P.wounds) {
      if (wd.done) continue;
      for (const step of QS.WOUND[wd.type].steps) if (!wd.treated.includes(step)) QS.treat(wd.part, step);
      wd.done = true;
    }
    if (P.infect && P.infect.kind === 'wound' && P.inv.includes('抗生素')) QS.useItem('抗生素');
    // 【会包扎】。treat() 以前在游戏里从没被调用过，机器人自然也不会用 ——
    // 于是"失血"这个死因一直是在演"没人会止血"，不是在演平衡。
    if (QS.treatNext) for (let i = 0; i < P.wounds.length; i++) {
      const st = QS.nextStep(P.wounds[i]);
      if (st && P.inv.includes(QS.STEP_ITEM[st])) { QS.treatNext(i); break; }
    }

    // —— 白天出门翻柜子，天黑回屋 ——
    const night = hour >= 20 || hour < 6;
    if (night) {
      QS.update(1 / 30);
      QS.advanceHours(1);
    } else {
      // 挑最近的一个没翻过的容器。笨：不看那个街区有多少僵尸
      let tgt = -1, td = 1e9;
      for (let i = 0; i < T.containers.length; i++) {
        if (T.searched[i]) continue;
        const hs = houseOf(i), d = dist(P, hs);
        if (d < td) { td = d; tgt = i; }
      }
      if (tgt >= 0) {
        const c = T.containers[tgt];
        // 直接奔容器所在的那一格，不是奔房子中心 —— 不然永远进不去
        const stance = td > 25 ? '跑' : '走';
        // 【标定】一次 move() 走 SPEED 格，而 SPEED 是"格 / 游戏分钟"——
        // 所以一个游戏小时应该有 60 次 move，不是我随手写的 22。
        // 少给了之后机器人每天只走三小时路，搜刮覆盖率 1%，看着像地图太大。
        // 霓虹教训二十三：量具校准了三次，每次都被当成游戏 bug。
        for (let k = 0; k < 60 && !P.dead; k++) {
          const st = QS.pathStep(P.x, P.y, c.x, c.y);
          // 【判据用寻路，不用直线距离】：原来写 dist < 1.6 就动手，
          // 于是机器人【斜着】站在柜子旁边（距 1.5）反复喊"眼前没什么可弄的"——
          // 游戏扫的是十字五格，斜角不算。下一步就是柜子那一格时，才算正对着它。
          if (!st) break;
          if (st.x === c.x && st.y === c.y) { QS.interact(); break; }
          if (st.tile === QS.TL.门 || st.tile === QS.TL.窗) QS.interact();   // 门锁着就撬，窗就翻
          else stepToward(st.x + .5, st.y + .5, stance);
          QS.update(1 / 30);                                         // 让僵尸也走一步
        }
        radiusDay = Math.max(radiusDay, dist(P, HOME));
      }
      if (!P.dead) QS.advanceHours(1);
    }
    noiseDay += QS.BLOCKS.reduce((a, b) => a + b.heat, 0);

    // —— 卡死检测：翻箱没进展而身体在掉，就是僵局 ——
    const searched = [...T.searched].reduce((a, b) => a + b, 0);
    stallH = searched === lastSearched ? stallH + 1 : 0;
    lastSearched = searched;
    if (stallH > 72 && !stalled) {
      stalled = `连续 ${stallH} 小时没翻到任何新容器（已翻 ${searched}/${T.containers.length}）`
        + `，位置 (${P.x.toFixed(0)},${P.y.toFixed(0)})，饥饿 ${P.body.饥饿.toFixed(0)}`;
    }
    if (T.day !== day) {
      daily.push({ day, noise: Math.round(noiseDay), pop: QS.BLOCKS.map(b => b.pop),
        sum: QS.BLOCKS.reduce((a, b) => a + b.pop, 0), radius: Math.round(radiusDay),
        searched });
      day = T.day; noiseDay = 0; radiusDay = 0;
    }
  }
  // 先喝屋里的自来水（停水前），没有再喝瓶装的。
  // 第一版没写这一步，于是 55% 的局在第 2 天渴死 —— 那是量具的洞，不是难度。
  // 撞墙就绕：先试单轴，还撞就沿垂直方向走几步再说。
  // 人本能会做这件事，机器人不会 —— 不补上，卡死检测报的全是假僵局。
  function stepToward(tx, ty, stance) {
    const bx = P.x, by = P.y;
    const dx = Math.sign(tx - P.x), dy = Math.sign(ty - P.y);
    if (det > 0) { det--; QS.move(detDir * (dy ? 1 : 0) || detDir, detDir * (dx ? 1 : 0), stance); return; }
    QS.move(dx, dy, stance);
    if (Math.abs(P.x - bx) > 1e-9 || Math.abs(P.y - by) > 1e-9) return;
    QS.move(dx, 0, stance);
    if (Math.abs(P.x - bx) > 1e-9) return;
    QS.move(0, dy, stance);
    if (Math.abs(P.y - by) > 1e-9) return;
    det = 5; detDir = -detDir;                     // 还是动不了：换个方向绕几步
  }
  function drink() {
    if (P.atHouse != null && QS.drinkFrom && QS.drinkFrom(P.atHouse)) return true;
    for (const k of ['瓶装水', '汽水']) if (P.inv.includes(k)) return QS.useItem(k);
  }
  function eat() { for (const k of ['罐头', '干粮', '熏肉', '腌菜']) if (P.inv.includes(k)) return QS.useItem(k); }
  // 背包排在最前：+12 格是这游戏里最大的一次能力提升，
  // 人一眼就会背上，机器人不背就等于在演"背不动"。
  function wear() { for (const k of ['背包', '外套', '毛衣', '靴', '手套']) if (P.inv.includes(k)) QS.useItem(k); }

  const rep = QS.deathReport && QS.deathReport();
  return { seed, days: T.day, cause: (QS.death && QS.death.cause) || '还活着',
    searched: [...T.searched].reduce((a, b) => a + b, 0), total: T.containers.length,
    sum: QS.BLOCKS.reduce((a, b) => a + b.pop, 0), kills: QS.kills, waves: QS.waves,
    init: QS.BLOCKS.reduce((a, b) => a + b.init, 0), seeped: QS.seeped || 0,
    daily, stalled, report: rep };
}

console.log(isFixture
  ? `⚠ 游戏本体还不存在（等着 ${REAL.replace(process.cwd() + '/', '')}）——\n  现在跑的是自检靶子，这几张表只证明【表本身算得对】，不是真实难度\n`
  : `目标：真游戏 · ${N} 局 · 风险倍率 ${RISK}\n`);

const R = SEEDS.map(play);

// ---- ① 死因分布 ----
console.log('① 死因分布 ★ 调平衡的唯一依据');
const TARGET = { 感染: 30, 被围: 25, 冻死: 15, 脱水: 8, 饿死: 7, 脓毒: 10, 失血: 5 };
const cnt = {};
for (const r of R) cnt[r.cause] = (cnt[r.cause] || 0) + 1;
const rows = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
for (const [c, k] of rows) {
  const pct = k / R.length * 100;
  const t = TARGET[c];
  console.log(`   ${c.padEnd(6)} ${String(k).padStart(3)} 局  ${pct.toFixed(0).padStart(3)}%`
    + (t != null ? `  目标 ${t}%` : '  （目标里没有这一项）')
    + '  ' + '█'.repeat(Math.round(pct / 4)));
}
const worst = rows[0];
console.log(worst[1] / R.length > .4
  ? `   ✗ 「${worst[0]}」占了 ${(worst[1] / R.length * 100).toFixed(0)}% —— 超过 40%，别的系统在当装饰`
  : `   ✓ 最高的一项「${worst[0]}」占 ${(worst[1] / R.length * 100).toFixed(0)}%，没有一家独大`);

// ---- ② 存活天数 ----
console.log('\n② 存活天数');
const days = R.map(r => r.days).sort((a, b) => a - b);
const avg = days.reduce((a, b) => a + b, 0) / days.length;
const mid = days[Math.floor(days.length / 2)];
console.log(`   平均 ${avg.toFixed(1)} 天，中位 ${mid}，最差 ${days[0]}，最好 ${days[days.length - 1]}`);
const bucket = [0, 0, 0, 0];
for (const d of days) bucket[d < 7 ? 0 : d < 14 ? 1 : d < 30 ? 2 : 3]++;
['<7 天', '7~13 天', '14~29 天', '≥30 天'].forEach((lab, i) =>
  console.log(`   ${lab.padEnd(9)} ${String(bucket[i]).padStart(3)} 局  ${'█'.repeat(bucket[i])}`));
console.log(bucket[0] / R.length > .5
  ? '   ✗ 一半以上活不过第一周 —— 开局太陡，第一天的脚本化开场（T8）要背这个锅'
  : '   ✓ 大多数局活过了第一周');

// ---- ③ 噪音与密度 + 守恒 ----
console.log('\n③ 噪音总量与街区密度（取第一个种子，每 5 天一行）');
const d0 = R[0].daily;
console.log('   天   噪音   A   B   C   D   E   F   合计   翻过');
for (let i = 0; i < d0.length; i += 5) {
  const r = d0[i];
  console.log(`   ${String(r.day).padStart(2)}  ${String(r.noise).padStart(5)}  `
    + r.pop.map(p => String(p).padStart(3)).join(' ') + `  ${String(r.sum).padStart(5)}  ${r.searched}`);
}
const bad = R.filter(r => r.sum !== r.init + 120 * r.waves + r.seeped - r.kills);
console.log(bad.length
  ? `   ✗ ${bad.length} 局的僵尸总数不守恒（存量模型坏了，这是 bug 不是难度）`
  : `   ✓ ${R.length} 局的僵尸总数全部守恒（表里的 ${R[0].init} + 浪潮 + 渗入 − 击杀）`);

// ---- ④ 卡死与活动半径 ----
console.log('\n④ 卡死检测与活动半径');
const stuck = R.filter(r => r.stalled);
console.log(stuck.length
  ? `   ✗ ${stuck.length} 局卡住了：\n` + stuck.slice(0, 3).map(r => `      种子 ${r.seed}：${r.stalled}`).join('\n')
  : `   ✓ ${R.length} 局都没卡住（连续 72 小时翻不到新容器就算僵局）`);
// 活动半径递减 = 缩着比出门划算 = 决策 2 落空（风险清单第 4 条）
const half = R.filter(r => r.daily.length >= 6);
if (half.length) {
  let early = 0, late = 0, k = 0;
  for (const r of half) {
    const a = r.daily.slice(0, 3), b = r.daily.slice(-3);
    early += a.reduce((x, y) => x + y.radius, 0) / a.length;
    late += b.reduce((x, y) => x + y.radius, 0) / b.length;
    k++;
  }
  early /= k; late /= k;
  console.log(`   活动半径：前三天均值 ${early.toFixed(1)} 格 → 最后三天 ${late.toFixed(1)} 格`);
  console.log(late < early * .7
    ? '   ✗ 半径明显递减 —— 游戏在奖励"缩在屋里"，三个拐点（T10/T15）没把人逼出门'
    : '   ✓ 半径没有塌缩：机器人一直在往外走');
}
const covered = R.reduce((a, r) => a + r.searched / r.total, 0) / R.length;
console.log(`   搜刮覆盖率均值 ${(covered * 100).toFixed(1)}%（${R[0].total} 个容器）`);

// ---- 样例回溯 ----
const withRep = R.find(r => r.report && r.report.lines.length >= 2);
if (withRep) {
  console.log(`\n死亡回溯样例（种子 ${withRep.seed}）：`);
  withRep.report.lines.forEach(l => console.log('   ' + l));
}
console.log('\n机器人不算噪音预算、不绕高密度街区、不为过冬屯柴 —— 上面的天数是下限，人应该活得更久。');
process.exit(bad.length || stuck.length ? 1 : 0);
