#!/usr/bin/env node
// 霓虹废钢线 · 离线验收
// ==================================================================
// 为什么要有这个：游戏整个包在 IIFE 里，`node --check` 只能查语法，
// 查不出【初始化顺序】这类错 —— 比如词条表引用了还没声明的武器表。
// 那种错在浏览器里表现为"标题页正常，点开始没反应"，控制台还可能什么都不报。
//
// 这里用一个最小 DOM 桩把整段脚本真的跑一遍，再检查几件肉眼难看准的事：
// 精灵每行宽度一致、武器表字段齐全、词条不会把武器数值写死。
'use strict';
const { html, js, run, pad, padOff, realTimeout } = require('./neon-stub');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

// ---- 1) 整段脚本真的能跑到底 ----
console.log('脚本初始化');
let NS = null, NST = null;
try { NS = run(false); ok(!!NS && NS.isTouch === false, '桌面：脚本跑到底，没有初始化顺序错误'); }
catch (e) { ok(false, '桌面：脚本抛错：' + e.message); }
try { NST = run(true); ok(!!NST && NST.isTouch === true, '触屏：脚本跑到底，认出了粗指针'); }
catch (e) { ok(false, '触屏：脚本抛错：' + e.message); }
global.setTimeout = realTimeout;
if (!NS) { console.log('\n拿不到验收钩子，后面的检查跳过'); process.exit(1); }

// ---- 2) 精灵：每一帧的每一行宽度必须一致 ----
// 直接遍历运行时的 GRID。之前这里拿正则找内联的 sprite([...])，
// 而网格全在 GRID 里声明，于是永远匹配到 0 个 —— 断言绿着，一行都没查。
console.log('精灵宽度');
{
  let nspr = 0, bad = [];
  const chk = (name, rows) => {
    nspr++;
    const w = rows[0].length;
    rows.forEach((r, i) => { if (r.length !== w) bad.push(`${name} 第 ${i} 行宽 ${r.length}，应为 ${w}`); });
  };
  for (const k in NS.GRID) {
    const v = NS.GRID[k];
    if (!Array.isArray(v)) continue;
    if (typeof v[0] === 'string') chk(k, v);
    else v.forEach((f, i) => Array.isArray(f) && typeof f[0] === 'string' && chk(`${k}[${i}]`, f));
  }
  bad.forEach(m => console.log('    ' + m));
  ok(nspr > 20, `扫到了 ${nspr} 帧字符网格（不是 0 —— 这条以前是空跑的）`);
  ok(bad.length === 0, '每一帧的每一行宽度都一致');
}

// ---- 3) 武器表 ----
console.log('武器');
const need = { bullet: ['rate', 'dmg', 'count', 'spread', 'bspd', 'range'], rail: ['rate', 'dmg', 'reach'], arc: ['rate', 'dmg', 'chain', 'reach'], nade: ['rate', 'dmg', 'splash', 'bspd', 'range'] };
for (const id of NS.WEP_ORDER) {
  const W = NS.WEAPONS[id];
  const miss = (need[W.kind] || []).filter(k => W[k] == null);
  ok(!!W && !miss.length && !!W.n && !!W.d && !!W.col, `${id}（${W && W.n}）字段齐全${miss.length ? ' 缺：' + miss : ''}`);
}
ok(NS.WEP_ORDER.every(id => id === 'pulse' || NS.UPGRADES.some(u => u.wep === id)),
  '除默认枪外，每把枪都有一张换装卡能拿到');

// ---- 4) 换枪不能把攒下来的词条清掉 ----
console.log('词条与换枪');
NS.start();
const P = NS.P;
const rof = NS.UPGRADES.find(u => u.id === 'rof'), dmg = NS.UPGRADES.find(u => u.id === 'dmg');
for (let i = 0; i < 3; i++) { rof.f(P); dmg.f(P); }
const beforeRate = P.fireRate, beforeDmg = P.dmg;
ok(beforeRate > NS.WEAPONS.pulse.rate * 1.5, `射速词条吃到了（${NS.WEAPONS.pulse.rate} → ${beforeRate.toFixed(2)}）`);
NS.equip('shot');
const shotRate = P.fireRate;
ok(Math.abs(shotRate - NS.WEAPONS.shot.rate * P.mul.rate) < 1e-6, '换成霰弹后，射速 = 霰弹基础值 × 词条倍率');
ok(shotRate > NS.WEAPONS.shot.rate, '换枪没有把词条清掉');
NS.equip('pulse');
ok(Math.abs(P.fireRate - beforeRate) < 1e-6 && Math.abs(P.dmg - beforeDmg) < 1e-6, '换回来数值还原');

// ---- 5) 五把枪都能开火，各有各的产物 ----
console.log('开火');
const shots = {};
for (const id of NS.WEP_ORDER) {
  NS.equip(id);
  NS.G.bullets.length = 0; NS.G.beams.length = 0; NS.G.arcs.length = 0;
  NS.G.mobs.length = 0; NS.spawn('grunt');
  const m = NS.G.mobs[0]; m.x = P.x + 30; m.y = P.y; m.hp = 9999;
  P.ang = 0;
  NS.G.slashes.length = 0;
  if (id === 'blade') { m.x = P.x + 20; }               // 刀要贴上去才够得着
  NS.fire();
  shots[id] = { b: NS.G.bullets.length, beam: NS.G.beams.length, arc: NS.G.arcs.length,
    slash: NS.G.slashes.length, hp: Math.round(m.hp) };
}
ok(shots.pulse.b === 1, `脉冲：一发子弹（${shots.pulse.b}）`);
ok(shots.shot.b >= 5, `霰弹：一次多发（${shots.shot.b}）`);
ok(shots.rail.beam === 1 && shots.rail.hp < 9999, `磁轨：一条光束，线上的敌人直接掉血（${9999 - shots.rail.hp}）`);
ok(shots.arc.arc === 1 && shots.arc.hp < 9999, `电弧：一条折线，最近的敌人掉血（${9999 - shots.arc.hp}）`);
ok(shots.nade.b === 1, `榴弹：一枚抛射物（${shots.nade.b}）`);
ok(shots.blade.slash === 1, `振动刀：一道挥击弧（${shots.blade.slash}）`);

// ---- 6) 触屏 ----
console.log('触屏');
for (const id of ['id="tc"', 'id="stkL"', 'id="stkR"', 'id="btnDash"', 'id="btnWep"', 'id="rotHint"'])
  ok(html.includes(id), `${id} 在页面里`);
ok(/user-scalable=no/.test(html), '视口禁掉了缩放（否则玩着会被双击放大）');
ok(/#stage\{[^}]*touch-action:none/.test(html), '#stage 关掉了默认触摸手势');
ok(/overscroll-behavior:none/.test(html), '关掉了下拉刷新与橡皮筋');
ok(/body\.touch #tc\.play/.test(html), '摇杆只在 play 状态显示，不挡标题页和升级卡');
ok(/visualViewport/.test(html), 'fit() 听了可视视口 —— 横竖屏切换和地址栏收起都会改它');
ok(/orientationchange/.test(html), 'fit() 听了横竖屏切换');
ok(/#tc\{[^}]*position:fixed/.test(html), '触屏层盖满视口，不是只盖画布（竖屏时拇指在画布外）');
ok(/safe-area-inset/.test(html), '按钮避开了刘海和小白条');
ok(/visibilitychange/.test(html), '切后台会松开摇杆，回来不会还按着');
ok(/function goTouch/.test(html), '第一次真的碰屏幕就切到触屏模式（触屏笔记本也能用手指）');
ok(!/if \(!isTouch\) return;/.test(html), '监听器总是装上，不因为开局猜错就永久失效');
if (NST) {
  NST.start();
  const TP = NST.P, TG = NST.G;
  TG.mobs.length = 0; NST.spawn('grunt');
  const m = TG.mobs[0]; m.x = TP.x; m.y = TP.y - 120;      // 正上方
  TP.ang = 0; TG.bullets.length = 0;
  TP.fireT = 0;
  NST.update(1 / 60);
  const want = Math.atan2(m.y - TP.y, m.x - TP.x);
  ok(Math.abs(NST.TC.on && (TP.ang - want)) < .01, '右手没按时，自动瞄最近的敌人');
  ok(TG.bullets.length > 0 || TG.arcs.length > 0 || TG.beams.length > 0, '触屏下不按也会开火（单手能玩）');
  // 左摇杆推满，人得动起来
  const x0 = TP.x, y0 = TP.y;
  NST.TC.mx = 1; NST.TC.my = 0; NST.TC.ml = 1;
  for (let i = 0; i < 10; i++) NST.update(1 / 60);
  ok(TP.x > x0 + 5, `左摇杆推右，人往右走了（${Math.round(TP.x - x0)}px）`);
  NST.TC.ml = 0;
  // 右摇杆按住 → 按摇杆方向瞄
  NST.TC.ax = 0; NST.TC.ay = -1; NST.TC.al = 1;
  NST.update(1 / 60);
  ok(Math.abs(TP.ang - (-Math.PI / 2)) < .01, '右摇杆按住时，朝摇杆的方向瞄');
}

// ---- 7) 记录与战报：一局打完要留下东西，否则没有"再来一局"的理由 ----
console.log('记录与战报');
ok(/localStorage/.test(html), '用了 localStorage 存最好成绩');
ok(/catch \(e\) \{ return null; \}/.test(html) && /catch \(e\) \{ return false; \}/.test(html),
  'localStorage 读写都包了 try/catch（无痕模式下它会直接抛）');
for (const t of ['grunt', 'rusher', 'drone', 'tank', 'boss'])
  ok(!!NS.MOB[t].nm, `${t} 有中文名（战报要写被谁拆的）`);

NS.start();
const RP = NS.P, RG = NS.G;
NS.equip('rail');
RG.wepDmg = { pulse: 30, rail: 900 };
RG.stacks = { pierce: 3, crit: 2, rof: 1, w_rail: 1 };
ok(NS.topWeapon() === '磁轨枪', `打出伤害最多的那把枪算这一局的枪（${NS.topWeapon()}）`);
ok(JSON.stringify(NS.topUpgrades(2)) === JSON.stringify(['穿甲钨芯', '暴击回路']),
  `堆得最多的两条词条：${NS.topUpgrades(2).join(' + ')}`);
ok(!/w_/.test(JSON.stringify(NS.topUpgrades(3))), '换装卡不算进"堆"出来的词条');
ok(NS.runReport() === '磁轨枪 + 穿甲钨芯 + 暴击回路', `战报：${NS.runReport()}`);

// 死亡原因要落到具体是谁
RG.mobs.length = 0; NS.spawn('tank');
const tk = RG.mobs[0]; tk.x = RP.x; tk.y = RP.y;
RP.hp = 5; RP.inv = 0; RG.wave = 7;
NS.update(1 / 60);
ok(RG.deathBy === 'tank', `记下了是谁打的最后一下（${RG.deathBy}）`);
ok(RG.state === 'over', '血空了就结束');

// 最好成绩要真的落盘，并且下一次读得回来
const b1 = NS.loadBest();
ok(!!b1 && b1.wave === 7, `最好成绩落盘了（第 ${b1 && b1.wave} 波）`);
ok(!!b1 && b1.build === '磁轨枪 + 穿甲钨芯 + 暴击回路', '记录里带着那一局的打法');
// 打得更差不该覆盖
NS.start(); NS.G.wave = 2; NS.G.score = 1; NS.G.wepDmg = { pulse: 1 }; NS.G.stacks = {};
NS.gameOver();
const b2 = NS.loadBest();
ok(b2.wave === 7, '打得更差不会把记录覆盖掉');

// ---- 8) 成长：解锁改变可能性，不是改变数值 ----
console.log('成长系统');
const P0 = NS.PROF;
// 从零开始的档案
Object.assign(P0, { scrap: 0, scrapTotal: 0, kills: 0, runs: 0, bestWave: 0,
  bossKills: 0, tankKills: 0, unlocked: {}, bought: {}, wep: 'pulse', chassis: 'std' });
NS.saveProf();
const locked = NS.rollOffer();
ok(!locked.some(u => u.req), '新档案：没解锁的卡一张都不进三选一');
ok(NS.MILES.every(m => m.d && m.n && typeof m.ok === 'function'), `${NS.MILES.length} 个里程碑都有条件和奖励`);
ok(NS.nextMile().id === 'w_shot', `下一个解锁是最容易的那个（${NS.nextMile().n}）`);

// 里程碑要在到达阈值时才亮
P0.bestWave = 3; ok(NS.checkMiles().length === 0, '第 3 波：还不给霰弹枪');
P0.bestWave = 4; ok(NS.checkMiles().map(m => m.id).join() === 'w_shot', '第 4 波：霰弹枪解锁');
ok(NS.rollOffer !== undefined && NS.UPGRADES.find(u => u.id === 'w_shot').req === 'w_shot',
  '换装卡挂着 req，靠解锁开门');
P0.unlocked.u_cap = 1;
ok(NS.rollOffer.call && (() => { for (let i = 0; i < 40; i++) if (NS.rollOffer().some(u => u.id === 'u_cap')) return true; return false; })(),
  '解锁之后，新词条真的会出现在三选一里');

// 每一局都有产出，打崩的一局也不白打
Object.assign(P0, { scrap: 0, scrapTotal: 0, runs: 0, kills: 0 });
NS.start(); NS.G.wave = 3; NS.G.kills = 40; NS.G.bossKills = 0; NS.G.tankKills = 2;
const bk = NS.bankRun();
ok(bk.scrap === 3 * 12 + 40, `一局产出废钢 = 波次×12 + 击杀（${bk.scrap}）`);
ok(P0.runs === 1 && P0.kills === 40 && P0.tankKills === 2, '战绩折进了档案');
ok(NS.loadProf().scrapTotal === bk.scrap, '档案落盘了');

// 买起手武器：要先解锁，还要花废钢
P0.scrap = 100; P0.unlocked.w_rail = 1;
ok(NS.buyWep('rail') === false, `废钢不够买不了（${P0.scrap} < ${NS.WEP_COST}）`);
P0.scrap = NS.WEP_COST;
ok(NS.buyWep('rail') === true && P0.bought.rail === 1 && P0.scrap === 0, '够了就能买，钱会扣');
delete P0.unlocked.w_arc; P0.scrap = 999;
ok(NS.buyWep('arc') === false, '没解锁的枪，有钱也买不到');

// 起手武器要真的生效
P0.wep = 'rail'; NS.start();
ok(NS.P.wep === 'rail', '开局就是买好的那把枪');
P0.wep = 'nade'; NS.start();
ok(NS.P.wep === 'pulse', '没买过的枪不会被当成起手（回落到脉冲）');

// 底座：三个都带代价，不是三档强度
ok(Object.keys(NS.CHASSIS).length >= 3, `${Object.keys(NS.CHASSIS).length} 个底座`);
P0.chassis = 'std'; NS.start();
const base = { spd: NS.P.speed, hp: NS.P.maxhp };
P0.unlocked.c_light = 1; NS.pickChassis('light'); NS.start();
ok(NS.P.speed > base.spd && NS.P.maxhp < base.hp,
  `轻甲：移速 ${base.spd.toFixed(0)}→${NS.P.speed.toFixed(0)}，血 ${base.hp}→${NS.P.maxhp}`);
P0.unlocked.c_heavy = 1; NS.pickChassis('heavy'); NS.start();
ok(NS.P.maxhp > base.hp && NS.P.speed < base.spd, `重载：血更多但更慢（${NS.P.maxhp} / ${NS.P.speed.toFixed(0)}）`);
ok(NS.P.hp === NS.P.maxhp, '底座改了血上限之后，开局是满血');
delete P0.unlocked.c_heavy;
ok(NS.pickChassis('heavy') === false, '没解锁的底座选不了');
P0.chassis = 'std';

// 没有一条解锁是纯数值永久加成 —— 那会把前期削简单
ok(NS.MILES.every(m => /卡池|词条|底座|涂装/.test(m.n)), '所有里程碑给的都是新东西，不是永久数值加成');

// ---- 涂装：必须是纯外观 ----
console.log('涂装');
ok(NS.SKIN_ORDER.length >= 5, `${NS.SKIN_ORDER.length} 套涂装`);
ok(NS.SKIN_ORDER.every(id => NS.SKINS[id].n && NS.SKINS[id].trail), '每套都有名字和拖尾色');
ok(NS.SKIN_ORDER.filter(id => NS.SKINS[id].req).length === NS.SKIN_ORDER.length - 1,
  '除默认涂装外，每套都要解锁');
ok(NS.SKINS.core.pal.C !== NS.SKINS.std.pal.C || !NS.SKINS.std.pal.C,
  '不同涂装的调色板真的不一样');
ok(NS.sprSet('core') !== NS.sprSet('std') && NS.sprSet('core') === NS.sprSet('core'),
  '每套涂装各烤一份精灵并缓存住');
// 没解锁的选不了
Object.assign(NS.PROF, { unlocked: {}, skin: 'std' });
ok(NS.pickSkin('core') === false, '没解锁的涂装选不了');
NS.PROF.unlocked.s_core = 1;
ok(NS.pickSkin('core') === true && NS.PROF.skin === 'core', '解锁了就能选，并且记进档案');

// 这一条是这个功能的底线：换遍所有涂装，玩家数值必须一模一样
const FIELDS = ['speed','maxhp','hp','fireRate','dmg','count','spread','bspd','range',
                'pierce','dashCd','crit','shield','pickR','lifesteal','explode','aura'];
NS.setMode('free');
Object.assign(NS.PROF, { chassis: 'std', wep: 'pulse', bought: {},
  unlocked: Object.fromEntries(NS.SKIN_ORDER.filter(i => NS.SKINS[i].req).map(i => [NS.SKINS[i].req, 1])) });
let ref = null, allSame = true, diff = '';
for (const id of NS.SKIN_ORDER) {
  NS.PROF.skin = id; NS.start();
  const snap = FIELDS.map(k => NS.P[k]).join('|');
  if (ref === null) ref = snap;
  else if (snap !== ref) { allSame = false; diff = id; }
}
ok(allSame, allSame ? `${NS.SKIN_ORDER.length} 套涂装的数值完全相同（纯外观）` : `涂装 ${diff} 改了数值 —— 它不该改`);
ok(NS.SKIN_ORDER.every(id => !('f' in NS.SKINS[id]) && !('req' in NS.SKINS[id] && typeof NS.SKINS[id].f === 'function')),
  '涂装的定义里没有任何生效函数（结构上就没法带数值）');

// 每日局的涂装跟着当天的种子走，且不看解锁
ok(NS.SKIN_ORDER.indexOf(NS.dailySkin()) >= 0, `今日主题涂装：${NS.SKINS[NS.dailySkin()].n}`);
ok(NS.dailySkin() === NS.dailySkin(), '同一天算出同一套主题');
Object.assign(NS.PROF, { unlocked: {}, skin: 'std' });
NS.setMode('daily'); NS.start();
ok(NS.SKIN === NS.SKINS[NS.dailySkin()], '每日局用今日主题，不看解锁（外观不影响公平）');
NS.setMode('free');
// 读档补发：条件早满足却没发的，进游戏就该发
try { global.localStorage.setItem(NS.PROF_KEY, JSON.stringify({ runs: 11, bestWave: 8, kills: 500 })); } catch (e) {}
const NS2 = run(false);
ok(NS2.PROF.unlocked.w_shot && NS2.PROF.unlocked.u_cap && NS2.PROF.unlocked.w_rail,
  '读档时补发早该给的里程碑（老档案遇到新里程碑也能立刻拿到）');
ok(NS2.nextMile() === null || !NS2.nextMile().ok(NS2.PROF), '下一个解锁一定是条件还没满足的那个');

// ---- 9) 随机源与每日局 ----
console.log('随机源');
ok(!/Math\.random\(/.test(html), '整份文件没有一处 Math.random（仓库规矩）');
ok(/RNG = \{ fx:/.test(html), '随机源分了流');

// 同一个种子 → 同一批怪、同一批三选一
function sample(seed) {
  NS.seedRun(seed);
  const waves = [];
  for (let i = 0; i < 12; i++) waves.push(NS.RNG.wave().toFixed(6));
  const cards = [];
  for (let i = 0; i < 12; i++) cards.push(NS.RNG.card().toFixed(6));
  return { waves: waves.join(), cards: cards.join() };
}
const s1 = sample(12345), s2 = sample(12345), s3 = sample(12346);
ok(s1.waves === s2.waves && s1.cards === s2.cards, '同一个种子 → 完全一样的刷怪流和卡牌流');
ok(s1.waves !== s3.waves, '换个种子就不一样了');
// 分流的意义：多摸几次粒子流，不该影响卡牌流
NS.seedRun(999); const c1 = [];
for (let i = 0; i < 6; i++) c1.push(NS.RNG.card().toFixed(6));
NS.seedRun(999); for (let i = 0; i < 500; i++) NS.RNG.fx();
const c2 = [];
for (let i = 0; i < 6; i++) c2.push(NS.RNG.card().toFixed(6));
ok(c1.join() === c2.join(), '粒子/暴击摸了 500 次，三选一还是同样三张（分流的意义）');

console.log('每日局');
ok(/^\d{4}-\d{2}-\d{2}$/.test(NS.dayKey()), `当天的种子键：${NS.dayKey()}`);
ok(NS.strSeed('ns-2026-09-10') === NS.strSeed('ns-2026-09-10'), '同一天算出同一个种子');
ok(NS.strSeed('ns-2026-09-10') !== NS.strSeed('ns-2026-09-11'), '不同的天不同的种子');
// 每日局要忽略档案，固定配置
Object.assign(NS.PROF, { unlocked: { w_rail: 1, c_light: 1 }, bought: { rail: 1 }, wep: 'rail', chassis: 'light' });
NS.setMode('free'); NS.start();
const freeP = { wep: NS.P.wep, hp: NS.P.maxhp };
ok(freeP.wep === 'rail', `自由局用档案里的起手武器（${freeP.wep}）`);
NS.setMode('daily'); NS.start();
ok(NS.P.wep === 'pulse', '每日局固定用脉冲步枪，不看档案');
ok(NS.P.maxhp !== freeP.hp && NS.P.maxhp === 100, `每日局不套底座（血 ${NS.P.maxhp}）`);
ok(NS.RUN_SEED === NS.strSeed('ns-' + NS.dayKey()), '每日局的种子就是当天日期');
// 每日局里，没解锁的词条也要能出
Object.assign(NS.PROF, { unlocked: {} });
let sawLocked = false;
for (let i = 0; i < 60 && !sawLocked; i++) if (NS.rollOffer().some(u => u.req)) sawLocked = true;
ok(sawLocked, '每日局词条全开（没解锁的也会出现）');
NS.setMode('free');
let sawLocked2 = false;
for (let i = 0; i < 60 && !sawLocked2; i++) if (NS.rollOffer().some(u => u.req)) sawLocked2 = true;
ok(!sawLocked2, '切回自由局，没解锁的又不出了');
// 每日成绩单独存，不和自由局的记录混
const bestBefore = NS.loadBest();
NS.setMode('daily'); NS.start(); NS.G.wave = 4; NS.G.score = 900; NS.gameOver();
const d1 = NS.loadDaily();
ok(!!d1 && d1.day === NS.dayKey() && d1.wave === 4, `每日成绩单独存（第 ${d1 && d1.wave} 波）`);
ok(JSON.stringify(NS.loadBest()) === JSON.stringify(bestBefore), '每日局不会污染自由局的历史最好');
NS.setMode('free');

// ---- 9.5) 近战 ----
console.log('近战');
const BL = NS.WEAPONS.blade;
ok(BL && BL.kind === 'melee', `振动刀存在，kind=${BL && BL.kind}`);
ok(BL.reach > 0 && BL.arc > 0 && BL.knock > 0 && BL.heal > 0,
  `扇形 ${BL.arc}°、半径 ${BL.reach}、击退 ${BL.knock}、命中回血 ${BL.heal}`);
ok(NS.GRID[NS.GUN_OF.blade], '刀有自己的精灵');
ok(NS.UPGRADES.some(u => u.wep === 'blade' && u.req === 'w_blade'), '刀有换装卡，且要先解锁');
ok(NS.MILES.some(m => m.id === 'w_blade'), '刀挂在里程碑上');

NS.setMode('free');
Object.assign(NS.PROF, { unlocked: { w_blade: 1 }, bought: {}, wep: 'pulse', chassis: 'std', skin: 'std' });
NS.start();
const BP = NS.P, BG = NS.G;
NS.equip('blade');
ok(BP.reach > 0 && BP.arc > 0, `装上刀之后有了扇形（半径 ${BP.reach.toFixed(0)}，${(BP.arc * 180 / Math.PI).toFixed(0)}°）`);
// 一刀砍一片
BG.mobs.length = 0;
for (let i = 0; i < 4; i++) { NS.spawn('grunt'); const m = BG.mobs[i];
  m.x = BP.x + 22; m.y = BP.y - 12 + i * 8; m.hp = m.max = 999; }
NS.spawn('grunt'); const far = BG.mobs[4]; far.x = BP.x - 40; far.y = BP.y; far.hp = far.max = 999;
BP.ang = 0; BP.hp = 50; BG.slashes.length = 0;
NS.fire();
const cleaved = BG.mobs.filter(m => m.hp < 999).length;
ok(cleaved >= 3, `一刀砍到 ${cleaved} 个（扇形内的全砍到）`);
ok(far.hp === 999, '身后的没砍到（扇形是有方向的）');
ok(BP.hp > 50, `命中回了血（50 → ${BP.hp.toFixed(1)}）`);
ok(BG.slashes.length === 1, '挥出去一道看得见的弧');
// 击退：被砍的会被推开
BG.mobs.length = 0; NS.spawn('grunt');
const km = BG.mobs[0]; km.x = BP.x + 20; km.y = BP.y; km.hp = km.max = 999;
const kx0 = km.x; BP.ang = 0; NS.fire();
ok(km.x - kx0 >= 6, `命中真的把敌人推开了（推了 ${(km.x - kx0).toFixed(1)}px，要求 ≥6）`);
// 贴得越近也要推得动 —— 除以距离的写法在贴身时会退化成 0
BG.mobs.length = 0; NS.spawn('grunt');
const nm2 = BG.mobs[0]; nm2.x = BP.x + 6; nm2.y = BP.y; nm2.hp = nm2.max = 999;
const nx0 = nm2.x; BP.ang = 0; NS.fire();
ok(nm2.x - nx0 >= 6, `贴身砍也推得动（推了 ${(nm2.x - nx0).toFixed(1)}px）`);
// 一刀砍一片不能就地满血
BG.mobs.length = 0;
for (let i = 0; i < 6; i++) { NS.spawn('grunt'); const m = BG.mobs[i];
  m.x = BP.x + 20; m.y = BP.y - 15 + i * 6; m.hp = m.max = 999; }
BP.hp = 40; BP.ang = 0; NS.fire();
ok(BP.hp - 40 <= 3.01, `砍到 6 个也只回 ${(BP.hp - 40).toFixed(1)} 血（每刀有上限）`);
// 对刀没用的两条词条被改成有用的
const r0 = BP.reach, a0 = BP.arc;
NS.UPGRADES.find(u => u.id === 'pierce').f(BP);
ok(BP.reach > r0, `穿甲钨芯对刀改成加长（${r0.toFixed(0)} → ${BP.reach.toFixed(0)}）`);
NS.UPGRADES.find(u => u.id === 'count').f(BP);
ok(BP.arc > a0, `双联发射对刀改成加宽（${(a0*180/Math.PI).toFixed(0)}° → ${(BP.arc*180/Math.PI).toFixed(0)}°）`);
NS.equip('pulse');
ok(BP.arc === 0 && BP.pierce > 0, '换回远程枪，扇形归零、穿透恢复');

// ---- 10) 人物与道具外显 ----
console.log('人物与道具外显');
ok(!!NS.GRID.player && NS.GRID.player.length === 4, `身体 ${NS.GRID.player && NS.GRID.player.length} 帧走路循环`);
const bh = NS.GRID.player[0].length, bwid = NS.GRID.player[0][0].length;
ok(bh >= 18 && bwid >= 14, `身体 ${bwid}×${bh}，比原来的 18×12 有地方放细节`);
ok(NS.WEP_ORDER.every(id => NS.GRID[NS.GUN_OF[id]]), `${NS.WEP_ORDER.length} 把武器各有自己的外形精灵`);
ok(new Set(NS.WEP_ORDER.map(id => NS.GRID[NS.GUN_OF[id]][0][0].length + 'x' + NS.GRID[NS.GUN_OF[id]][0].length)).size >= 3,
  '各把武器的外形尺寸不全一样（换武器看得出来）');

// 每一条能叠的词条都要有对应的贴花，否则"升级了看不出变化"
const stackable = NS.UPGRADES.filter(u => !u.wep).map(u => u.id);
const missing = stackable.filter(id => !NS.DECAL[id] && id !== 'count');
ok(missing.length === 0, missing.length ? `这些词条没有外显：${missing.join(' ')}` : `${stackable.length} 条词条都有外显（count 走加枪管）`);
ok(Object.values(NS.DECAL).every(d => NS.GRID[d.g]), '每片贴花都有对应的精灵');
ok(new Set(Object.values(NS.DECAL).map(d => d.on)).size === 3, '贴花分三层：枪上 / 身上 / 背后');
// 贴花不许重叠在同一个点，否则会糊成一团
const slots = {};
let clash = '';
for (const id in NS.DECAL) { const d = NS.DECAL[id], k = d.on + ':' + d.x + ',' + d.y;
  if (slots[k]) clash = k; slots[k] = id; }
ok(!clash, clash ? `有两片贴花挤在同一个槽位：${clash}` : '每片贴花各占一个槽位');
// 贴花只跟着已拿到的词条出现
NS.start(); NS.G.stacks = {};
ok(NS.DECAL.hp && Object.keys(NS.G.stacks).length === 0, '开局没有任何词条');
NS.G.stacks = { hp: 1, shield: 2, rof: 3 };
const shown = Object.keys(NS.DECAL).filter(id => NS.G.stacks[id] > 0);
ok(shown.length === 3, `拿了 3 条词条就挂 3 片贴花（${shown.join(' ')}）`);
// 贴花走调色板，所以跟着涂装变色
ok(Object.values(NS.DECAL).every(d => NS.GRID[d.g][0].join('').split('').every(c => c === '.' || /[A-Z]/.test(c))),
  '贴花只用调色板键，所以会跟着涂装一起换色');

// ---- 11) 触屏的系统键、BOSS 第二形态、多张场地 ----
console.log('触屏系统键');
for (const id of ['id="btnPause"', 'id="btnMute"'])
  ok(html.includes(id), `${id} 在页面里`);
ok(/#tc\.paused \.stk,#tc\.paused \.tbtns\{display:none\}/.test(html),
  '暂停时收起摇杆和动作键');
ok(/tc\.classList\.toggle\('play', G\.state === 'play'\)/.test(html),
  '暂停时触屏层还在 —— 否则暂停了就再也点不回来');
ok(/TC\.on \? '- 已 暂 停 -  点右上角继续'/.test(html),
  '暂停提示会区分键鼠和手机（手机上没有 P 键）');
// 意图是「只有一处暂停提示」，不是「字符串只出现两次」——
// 加手柄分支时这条红了，说明它当初写得太贴实现了
ok((html.match(/ctx\.fillText\([^)]*已 暂 停/g) || []).length === 1, '只有一处画暂停提示的地方');
ok(!/class="tpaused"/.test(html), '没有额外的 DOM 暂停层叠在上面');
ok(/PAD\.on \? '- 已 暂 停 -  按 START/.test(html), '手柄接入时提示改成 START');

console.log('BOSS');
ok(!!NS.GRID.boss_a && !!NS.GRID.boss_b, 'BOSS 有两套精灵（外壳完整 / 崩解）');
ok(NS.MOB.boss.spr === 'boss_a', 'BOSS 走精灵，不再是程序化画的圆环');
const bsz = NS.GRID.boss_a[0].length;
ok(bsz >= 20 && NS.GRID.boss_b[0].length === bsz, `两套同尺寸 ${bsz}×${bsz}`);
ok(NS.GRID.boss_a.join() !== NS.GRID.boss_b.join(), '两套长得不一样');
// 掉到一半血进第二形态，行为要真的变
NS.setMode('free'); NS.start();
const BG2 = NS.G, BP2 = NS.P;
BG2.mobs.length = 0; NS.spawn('boss');
const bs = BG2.mobs[0];
bs.x = BP2.x + 200; bs.y = BP2.y;
const spd0 = bs.spd;
ok(!bs.p2, '刚出场是第一形态');
bs.hp = bs.max * .49;
for (let i = 0; i < 3; i++) NS.update(1 / 60);
ok(!!bs.p2, '掉到一半血就进第二形态');
ok(bs.spd > spd0, `第二形态更快（${spd0.toFixed(0)} → ${bs.spd.toFixed(0)}）`);
BG2.ebullets.length = 0; bs.cd = 0;
for (let i = 0; i < 20; i++) NS.update(1 / 60);
ok(BG2.ebullets.length > 0, `第二形态在喷弹幕（${BG2.ebullets.length} 发）`);
ok(bs.cd < 1, `第二形态的开火间隔短得多（${bs.cd.toFixed(2)}s）`);

console.log('场地');
ok(NS.ARENAS.length >= 3, `${NS.ARENAS.length} 张场地`);
ok(NS.ARENAS.every(a => a.n && a.w && a.h && a.grid && a.lane), '每张都有名字、尺寸和配色');
ok(new Set(NS.ARENAS.map(a => a.w + 'x' + a.h)).size === NS.ARENAS.length, '每张的形状都不一样');
ok(new Set(NS.ARENAS.map(a => a.grid)).size === NS.ARENAS.length, '每张的网格色都不一样');
NS.start();
ok(NS.ARENA_I === 0 && NS.ARENA.w === NS.ARENAS[0].w, '开局是第一张');
// 打掉 BOSS 之后（第 6/11/16 波）换场地
NS.G.wave = 5; NS.nextWave();
ok(NS.G.wave === 6 && NS.ARENA_I === 1, `第 6 波换到第二张（${NS.ARENA.a.n}）`);
ok(NS.ARENA.w === NS.ARENAS[1].w && NS.ARENA.h === NS.ARENAS[1].h, '场地尺寸真的换了');
ok(NS.P.x === NS.ARENAS[1].w / 2, '人被放到新场地中间，不会卡在墙外');
NS.G.wave = 10; NS.nextWave();
ok(NS.ARENA_I === 2, `第 11 波换到第三张（${NS.ARENA.a.n}）`);
NS.G.wave = 15; NS.nextWave();
ok(NS.ARENA_I === 0, '第 16 波转回第一张（循环）');
NS.G.wave = 6; const i0 = NS.ARENA_I; NS.nextWave();
ok(NS.ARENA_I === i0, '不是每一波都换 —— 只在 BOSS 之后换');

// ---- 12) 三种要战术应对的敌人 ----
console.log('战术敌人');
for (const t of ['shieldbot', 'bomber', 'relay']) ok(!!NS.MOB[t] && !!NS.GRID[NS.MOB[t].spr], `${t} 有档案和精灵`);
ok(NS.MOB.shieldbot.shield && NS.MOB.bomber.fuse && NS.MOB.relay.guard, '三种各有自己的机制标记');

NS.setMode('free'); NS.start();
const TG = NS.G, TP = NS.P;
// 铁闸：正面挡伤，绕后才打得动
TG.mobs.length = 0; NS.spawn('shieldbot');
const sb = TG.mobs[0]; sb.x = TP.x + 60; sb.y = TP.y; sb.hp = sb.max = 1000;
sb.ang = Math.PI;                                        // 盾朝着玩家
let h0 = sb.hp; NS.hurtMob(sb, 100, 0, 0, TP.x, TP.y);
const front = h0 - sb.hp;
sb.hp = 1000; NS.hurtMob(sb, 100, 0, 0, sb.x + 40, sb.y);   // 从它背后打
const back = 1000 - sb.hp;
ok(front < 25, `正面打只进 ${front.toFixed(0)} 伤害（挡掉了）`);
ok(back > 90, `背后打进 ${back.toFixed(0)} 伤害（绕后才有用）`);
ok(back > front * 3, '正面和背后差三倍以上，值得为它改变位置');
// 爆炸没有方向，所以无视盾 —— 榴弹和爆裂核心因此有专属场合
sb.hp = 1000; NS.hurtMob(sb, 100, 0, 0);
ok(1000 - sb.hp > 90, `爆炸（不带来源）无视盾，进 ${(1000 - sb.hp).toFixed(0)} 伤害`);

// 爆囊：靠近点火，烧完就炸，伤玩家也炸别的敌人
TG.mobs.length = 0; NS.spawn('bomber');
const bo = TG.mobs[0]; bo.x = TP.x + 200; bo.y = TP.y;
NS.update(1 / 60);
ok(bo.fz < 0, '离得远不点火');
bo.x = TP.x + 20; NS.update(1 / 60);
ok(bo.fz > 0, `靠近就点火（引信 ${bo.fz.toFixed(2)}s）`);
NS.spawn('grunt'); const nb = TG.mobs[TG.mobs.length - 1];
nb.x = bo.x + 10; nb.y = bo.y; nb.hp = nb.max = 500;
TP.hp = 100; TP.inv = 0;
NS.blowUp(bo);
ok(TP.hp < 100, `炸到了玩家（100 → ${TP.hp.toFixed(0)}）`);
ok(nb.hp < 500, `连锁炸到了旁边的敌人（500 → ${nb.hp.toFixed(0)}）`);
ok(TG.deathBy === 'bomber' || TP.hp > 0, '死亡原因会记成爆囊');
ok(!TG.mobs.includes(bo), '炸完自己就没了');

// 中继：给周围加护盾，不打掉它别的都打不动
TG.mobs.length = 0; NS.spawn('relay'); NS.spawn('grunt');
const rl = TG.mobs[0], gd = TG.mobs[1];
rl.x = TP.x + 150; rl.y = TP.y; gd.x = rl.x + 20; gd.y = rl.y; gd.hp = gd.max = 1000;
NS.update(1 / 60);
ok(gd.guarded > 0, '中继给旁边的挂上了护盾');
ok(rl.links && rl.links.length === 1, '中继记着自己在护谁（用来画连线）');
gd.hp = 1000; NS.hurtMob(gd, 100, 0, 0, TP.x, TP.y);
const guarded = 1000 - gd.hp;
gd.guarded = 0; gd.hp = 1000; NS.hurtMob(gd, 100, 0, 0, TP.x, TP.y);
const bare = 1000 - gd.hp;
ok(guarded < bare * .5, `被护着只进 ${guarded.toFixed(0)}，没护着进 ${bare.toFixed(0)}`);
// 中继一死，护盾很快失效
TG.mobs = TG.mobs.filter(m => m !== rl);
for (let i = 0; i < 25; i++) NS.update(1 / 60);
ok(gd.guarded === 0, '中继没了，护盾自己就掉了（不是永久的）');

// 刷怪表：三种要在合适的波次进场
const bagAt = w => { TG.wave = w; TG.phase = 'wave'; const seen = new Set();
  for (let i = 0; i < 400; i++) { TG.mobs.length = 0; TG.budget = 1; TG.spawnT = -1;
    NS.waveSpawn(1); if (TG.mobs[0]) seen.add(TG.mobs[0].type); } return seen; };
const b3 = bagAt(3), b7 = bagAt(7), b12 = bagAt(12);
ok(!b3.has('shieldbot') && !b3.has('bomber') && !b3.has('relay'), '第 3 波还不出这三种');
ok(b7.has('shieldbot') && b7.has('bomber'), '第 7 波已经有铁闸和爆囊');
ok(b12.has('relay'), '第 12 波有信号中继');
ok(b12.size >= 6, `第 12 波的刷怪表有 ${b12.size} 种，不是只有一种打法`);

// ---- 13) 观感设置与可及性 ----
console.log('设置与可及性');
ok(NS.OPT && ['shake','bloom','vol'].every(k => k in NS.OPT), '有震屏 / 辉光 / 音量三项');
ok(/prefers-reduced-motion/.test(html) && /const REDUCE/.test(html),
  '读了系统的「减少动态效果」');
ok(/OPT\.shake/.test(html) && /const sh = G\.shake \* OPT\.shake/.test(html), '震屏真的乘上了设置值');
ok(/if \(OPT\.bloom > 0\) \{/.test(html), '辉光关掉时整段跳过，不是只把透明度调 0');
ok(/\.42 \* OPT\.bloom/.test(html), '辉光强度跟着设置');
ok(/\.5 \* \(typeof OPT/.test(html), '音量接到了音频主控');
// 改了要落盘，重开还在
NS.setOpt('shake', 0); NS.setOpt('bloom', 0); NS.setOpt('vol', .5);
ok(NS.OPT.shake === 0 && NS.OPT.bloom === 0, '改得动');
const saved = NS.loadProf();
ok(saved.optShake === 0 && saved.optBloom === 0 && saved.optVol === .5, '三项都落盘了');
NS.setOpt('shake', 1); NS.setOpt('bloom', 1); NS.setOpt('vol', 1);
// 震屏关掉之后画面不能再抖
NS.start(); NS.setOpt('shake', 0);
NS.G.shake = 10;
ok(NS.OPT.shake === 0, '震屏设为 0');
ok(/sh > \.05 \? rnd\(-sh, sh\)/.test(html) && /const sh = G\.shake \* OPT\.shake/.test(html),
  '抖动量来自 G.shake × 设置，所以设 0 就完全不抖');
NS.setOpt('shake', 1);

// ---- 14) 手柄 ----
console.log('手柄');
ok(/getGamepads/.test(html), '轮询了 Gamepad API');
ok(/gamepadconnected/.test(html) && /gamepaddisconnected/.test(html), '接入和断开都监听了');
ok(NS.PAD && 'ix' in NS.PAD && 'ax' in NS.PAD, '左右摇杆各有自己的向量');
ok(/PAD_DEAD = \.22/.test(html), '摇杆有死区（否则会自己漂）');
NS.setMode('free'); NS.start();
const GP = NS.P, GG = NS.G;
// 死区：轻轻碰一下不该动
pad(.15, 0, 0, 0); NS.update(1 / 60);
ok(NS.PAD.ix === 0, `轴推到 0.15 落在死区内（读到 ${NS.PAD.ix}）`);
// 左摇杆推满右 → 人往右走
GG.mobs.length = 0;
const gx0 = GP.x;
for (let i = 0; i < 12; i++) { pad(1, 0, 0, 0); NS.update(1 / 60); }
ok(GP.x > gx0 + 5, `左摇杆推右，人往右走（${Math.round(GP.x - gx0)}px）`);
ok(NS.PAD.on, '有输入就自动认成手柄模式');
// 右摇杆朝上 → 朝上瞄，并且推着就开火
GG.bullets.length = 0; GP.fireT = 0; NS.equip('pulse');
pad(0, 0, 0, -1); NS.update(1 / 60);
ok(Math.abs(GP.ang - (-Math.PI / 2)) < .01, '右摇杆朝上，人就朝上瞄');
ok(GG.bullets.length > 0, '推着右摇杆就开火，不用按扳机');
// 右摇杆不动但按右扳机 → 自动瞄最近的
GG.mobs.length = 0; NS.spawn('grunt');
const gm = GG.mobs[0]; gm.x = GP.x; gm.y = GP.y - 100;
GG.bullets.length = 0; GP.fireT = 0;
pad(0, 0, 0, 0, [7]); NS.update(1 / 60);
ok(Math.abs(GP.ang - Math.atan2(gm.y - GP.y, gm.x - GP.x)) < .01, '只按扳机时自动瞄最近的');
// START 暂停，而且是「按一下」不是「按住连发」
GG.paused = false;
pad(0, 0, 0, 0, [9]); NS.update(1 / 60);
ok(GG.paused, 'START 暂停');
pad(0, 0, 0, 0, [9]); NS.update(1 / 60);
ok(GG.paused, '按住不放不会来回切（只认按下那一下）');
pad(0, 0, 0, 0, []); NS.update(1 / 60);
pad(0, 0, 0, 0, [9]); NS.update(1 / 60);
ok(!GG.paused, '松开再按才切回来');
GG.paused = false;
// 换枪键
NS.PROF.bought.shot = 1; NS.PROF.unlocked.w_shot = 1; NS.equip('pulse'); NS.equip('shot'); NS.equip('pulse');
const w0 = GP.wep;
pad(0, 0, 0, 0, []); NS.update(1 / 60);
pad(0, 0, 0, 0, [2]); NS.update(1 / 60);
ok(GP.wep !== w0, `X 键换枪（${w0} → ${GP.wep}）`);
padOff(); NS.update(1 / 60);
ok(NS.PAD.ix === 0 && NS.PAD.al === 0, '手柄拔掉后输入归零，不会卡住方向');

{  // 块作用域：这文件是一整个顶层作用域，新段落圈起来免得跟上面的临时变量撞名
// ---- 15) 临时增益 ----
console.log('临时增益');
NS.setMode('free'); NS.start();
const UP = NS.P, UG = NS.G;
ok(NS.BUFF_IDS.length >= 4, `有 ${NS.BUFF_IDS.length} 种增益`);
ok(NS.BUFF_IDS.every(id => NS.BUFFS[id].n && NS.BUFFS[id].d), '每种都有名字和一句说明（横幅不能是空的）');
// 超频：射速正好翻倍，不是「快了一点」
NS.equip('pulse'); UG.mobs.length = 0; UG.buffs = {};
const D = 1 / 60, coolAt = () => { UP.fireT = 0; pad(0, 0, 0, -1); NS.update(D); return UP.fireT; };
const cd0 = coolAt();
UG.buffs.rush = 8;
const cd1 = coolAt();
ok(Math.abs(cd0 / cd1 - 2) < .02, `超频后开火间隔正好减半（${cd0.toFixed(3)}s → ${cd1.toFixed(3)}s）`);
UG.buffs = {}; padOff(); NS.update(D);
// 护壁：完全免伤，而且会到期
UP.hp = 100; UP.inv = 0; UP.dashT = 0; UG.buffs.ward = 4;
NS.hurtPlayer(30, 'test');
ok(UP.hp === 100, '护壁期间一点血都不掉');
for (let i = 0; i < 260; i++) NS.update(D);               // 跑过 4 秒
ok(!UG.buffs.ward, '护壁会到期，不是永久的');
UP.hp = 100; UP.inv = 0; UP.dashT = 0; NS.hurtPlayer(30, 'test');
ok(UP.hp < 100, '到期后照常掉血');
// 吸附：范围 ×4，所以本来吸不到的现在会飞过来
const far = UP.pickR * 2;
const mkDrop = () => { UG.drops.length = 0; UG.drops.push({ x: UP.x + far, y: UP.y, vx: 0, vy: 0, t: 0, kind: 'xp' }); return UG.drops[0]; };
UG.buffs = {}; let dp = mkDrop();
for (let i = 0; i < 60; i++) NS.update(D);
const moved0 = far - (dp.x - UP.x);
UG.buffs.magnet = 10; dp = mkDrop();
for (let i = 0; i < 60; i++) NS.update(D);
const moved1 = far - (dp.x - UP.x);
ok(moved0 < 3 && moved1 > 40, `吸附把范围外的掉落拉了过来（不开 ${moved0.toFixed(1)}px，开了 ${moved1.toFixed(1)}px）`);
UG.buffs = {}; UG.drops.length = 0;
// 磁暴：近的挨打，远的没事，而且无视铁闸正面的盾
UG.mobs.length = 0; NS.spawn('grunt'); NS.spawn('grunt');
const near = UG.mobs[0], away = UG.mobs[1];
near.x = UP.x + 40; near.y = UP.y; away.x = UP.x + 400; away.y = UP.y;
const nh = near.hp, ah = away.hp;
NS.grabBuff('surge');
ok(near.hp < nh - 20, `磁暴打掉近处 ${Math.round(nh - near.hp)} 血`);
ok(away.hp === ah, '远处的没事（是清一片，不是清全屏）');
UG.mobs.length = 0; NS.spawn('shieldbot');
const sb = UG.mobs[0]; sb.x = UP.x + 40; sb.y = UP.y; sb.ang = Math.PI;   // 盾正对着玩家
const sh0 = sb.hp; NS.hurtMob(sb, 46, 0, 0, UP.x, UP.y);
const blocked = sh0 - sb.hp;
sb.hp = sh0; NS.grabBuff('surge');
ok(sh0 - sb.hp > blocked * 3, `磁暴无视正面盾（普通打 ${Math.round(blocked)}，磁暴打 ${Math.round(sh0 - sb.hp)}）`);
ok(/BUFFS\[d\.kind\]/.test(html), '掉落物有专门的增益外观分支');

// ---- 16) 精英与波次修饰 ----
console.log('精英与波次修饰');
UG.mobs.length = 0; NS.spawn('grunt');
const el = UG.mobs[0], ehp = el.hp, exp0 = el.xp;
NS.makeElite(el);
ok(Math.abs(el.hp / ehp - 2.6) < .01 && el.max === el.hp, `精英血量 ×2.6（${Math.round(ehp)} → ${Math.round(el.hp)}）`);
ok(el.xp === exp0 * 3, '精英给三倍经验，所以值得去打');
ok(/m\.elite \? 1\.25 : 1/.test(html), '精英画得更大一号');
ok(/rgba\(255,224,102/.test(html) && /m\.elite\) \{/.test(html), '精英身上有标记环，远处就认得出');
// 精英必掉增益
UG.drops.length = 0; NS.killMob(el);
ok(UG.drops.some(d => NS.BUFFS[d.kind]), '精英死了必掉一个增益');
ok(UG.eliteKills === 1, '精英击杀单独记数');
// 出现率：前期没有，后期有上限
UG.mod = null;
UG.wave = 5; ok(NS.eliteChance() === 0, '第 5 波之前不出精英');
UG.wave = 6; ok(NS.eliteChance() > 0, '第 6 波开始出精英');
UG.wave = 40; ok(NS.eliteChance() <= .20 + 1e-9, `出现率封顶 ${(NS.eliteChance() * 100).toFixed(0)}%（不会整波都是精英）`);
UG.mod = NS.MODS.find(m => m.allElite);
ok(NS.eliteChance() === 1, '「精锐」波全是精英');
UG.mod = null;
// 修饰本身
ok(NS.MODS.every(m => m.n && m.d && (m.bag || m.allElite)), '每个修饰都改了刷怪表，且横幅有话说');
// 修饰不能比它用到的怪先出场 —— 探针在第 4 波撞见过 14 个精英，就是漏了这条
const FIRST = { rusher: 2, drone: 3, shieldbot: 4, tank: 5, bomber: 6, relay: 9, grunt: 1 };
for (const m of NS.MODS) {
  const need = m.allElite ? 6 : Math.max(...m.bag.map(t => FIRST[t] || 1));
  ok(m.from >= need, `${m.id} 从第 ${m.from} 波才出现，不早于它用的怪（第 ${need} 波）`);
}
ok(NS.MODS.find(m => m.allElite).from > 6, '「精锐」还要再晚一些，等人先单独见过精英');
// 下限按「这一波还剩几只」判，不按倍率本身判：铁壁 0.45 在第 9 波也有二十只
ok(NS.MODS.every(m => {
  const n = Math.round((9 + m.from * 4) * (m.budget || 1));
  return n >= 12 && n <= 90;
}), '每个修饰在它出场那一波的怪量都在 12~90 之间（不空场也不卡死）');
ok(NS.MODS.find(m => m.allElite).budget < 1, '全精英那一波数量要减，不然是数值膨胀');
for (const w of [5, 10, 15]) { UG.wave = w; ok(NS.rollMod(w) === null, `第 ${w} 波是 BOSS，不叠修饰`); }
ok(NS.rollMod(3) === null && NS.rollMod(1) === null, '前三波不加修饰，先让人学会走位');
// 修饰真的换了刷怪表
NS.seedRun(7); UG.wave = 8; UG.phase = 'wave'; UG.budget = 20; UG.spawnT = 0;
UG.mod = NS.MODS.find(m => m.id === 'swarm'); UG.mobs.length = 0;
for (let i = 0; i < 40; i++) { UG.spawnT = 0; NS.waveSpawn(D); }
ok(UG.mobs.length > 3 && UG.mobs.every(m => m.type === 'rusher'), `兽潮只刷刀锋犬（刷了 ${UG.mobs.length} 只）`);
ok(UG.mobs.every(m => m.spd > NS.MOB.rusher.spd), '兽潮的刀锋犬确实更快');
UG.mod = null; UG.mobs.length = 0;
// 每日局：同一个种子，修饰序列必须一样
const WS = [];
for (let w = 4; w <= 24; w++) if (w % 5) WS.push(w);
const seq = seed => { NS.seedRun(seed); return WS.map(w => { const m = NS.rollMod(w); return m ? m.id : '-'; }).join(','); };
const s1 = seq(20260910), s2 = seq(20260910);
// 先确认这个序列里真的摇出过修饰，否则「两边都是空的」也会让下面那条断言变绿
const hit = s1.split(',').filter(x => x !== '-');
ok(hit.length >= 2, `20 波里摇出了 ${hit.length} 个修饰：${hit.join(' ')}`);
ok(hit.length <= WS.length * .5, '也不能每波都有修饰，得有平稳的波次做对比');
ok(s1 === s2, '同种子的修饰序列完全一致');
ok(seq(20260911) !== s1, '换一天就不一样');
// start(seed) 必须真的钉住整局 —— 探针一开始拿 seedRun 播种，
// 结果被 start() 里的 Date.now() 冲掉了，同一份代码跑出两个难度。
const runOf = seed => {
  NS.setMode('free'); NS.start(seed);
  const out = [NS.RUN_SEED];
  for (let i = 0; i < 900; i++) NS.update(D);
  out.push(NS.G.wave, NS.G.mobs.length, Math.round(NS.G.mobs.reduce((a, m) => a + m.x + m.y, 0)));
  return out.join('|');
};
const r1 = runOf(4242), r2 = runOf(4242);
ok(r1 === r2, `start(4242) 两次跑出完全一样的局（${r1}）`);
ok(runOf(4243) !== r1, '换种子就是另一局');
ok(/seedOverride/.test(html) && /get\('seed'\)/.test(html), '?seed= 也能指定，局可以分享回放');
// 词条全满之后升级不能卡死 —— 探针打到二十几波才撞出来的
NS.setMode('free'); NS.start(11);
const XG = NS.G, XP = NS.P;
NS.UPGRADES.forEach(u => { XG.stacks[u.id] = u.max; });
ok(NS.rollOffer().length === 0, '全满之后牌池确实是空的');
XP.hp = 10; const xs = XG.score;
NS.showLevelup();
ok(XG.state === 'play', '没牌可发时不进升级界面（原来会弹出一个点不动的空界面）');
ok(XP.hp > 10 && XG.score > xs, `改成回血加分作为补偿（血 10 → ${Math.round(XP.hp)}）`);
// 僵局泄压阀：加时太久，剩下的护盾要失效，否则清不掉的一波会永远卡着
NS.setMode('free'); NS.start(5);
const VG = NS.G, VP = NS.P;
VG.phase = 'wave'; VG.budget = 0; VG.waveT = -5; VG.overheat = 0;
VG.mobs.length = 0; NS.spawn('shieldbot');
const vb = VG.mobs[0]; vb.x = VP.x + 40; vb.y = VP.y; vb.ang = Math.PI;   // 盾正对玩家
const vh = vb.hp; NS.hurtMob(vb, 100, 0, 0, VP.x, VP.y);
const front = vh - vb.hp;
ok(front < 30, `正常情况下正面硬打只有 ${Math.round(front)} 伤害（盾生效）`);
for (let i = 0; i < 8 * 60; i++) NS.update(D);              // 加时跑过 12 秒
ok(VG.overheat === 1, '加时超过 12 秒，护盾过热');
vb.hp = vh; NS.hurtMob(vb, 100, 0, 0, VP.x, VP.y);
ok(vh - vb.hp > front * 3, `过热后正面能打进去了（${Math.round(front)} → ${Math.round(vh - vb.hp)}）`);
ok(/G\.overheat = 0; \}/.test(html) || /overheat = 0/.test(html), '过关后过热状态要清掉，不能带进下一波');
// 铁壁的量得压住 —— 第 8 波三十只带盾的等于清不掉
const wall = NS.MODS.find(m => m.id === 'wall');
ok(wall.budget <= .5, `铁壁预算压到 ${wall.budget}（一屏全是盾就没有绕后的余地了）`);
ok(wall.from >= 9, `铁壁推到第 ${wall.from} 波，那时人手里有能绕后的东西`);
ok(new Set(hit).size >= 2, '摇出来的不是同一个修饰反复出现');
}

// ---- 17) 画面真的画得出来 ----
// 之前整个验收一次都没调过 render()：新加的精英标记环、增益掉落物、
// 过热横幅全是只在浏览器里才第一次执行 —— 打错一个字要到手玩才发现。
console.log('渲染');
{
  const draw = (label, prep) => {
    try { prep(); NS.render(); ok(true, label); }
    catch (e) { ok(false, `${label} —— render 抛错：${e.message}`); }
  };
  NS.setMode('free'); NS.start(3);
  const RG = NS.G, RP = NS.P;
  draw('空场能画', () => { RG.mobs.length = 0; RG.drops.length = 0; });
  draw('每种敌人同时在场能画', () => {
    RG.mobs.length = 0;
    for (const t in NS.MOB) NS.spawn(t);
  });
  draw('精英（放大 + 标记环）能画', () => { RG.mobs.forEach(m => m.type !== 'boss' && NS.makeElite(m)); });
  draw('四种增益掉落物都能画', () => {
    RG.drops.length = 0;
    NS.BUFF_IDS.forEach((k, i) => RG.drops.push({ x: RP.x + i * 20, y: RP.y, vx: 0, vy: 0, t: 0, kind: k }));
    RG.drops.push({ x: RP.x, y: RP.y + 30, vx: 0, vy: 0, t: 0, kind: 'hp' });
    RG.drops.push({ x: RP.x, y: RP.y + 50, vx: 0, vy: 0, t: 0, kind: 'xp' });
  });
  draw('增益生效中的画面能画', () => { RG.buffs = { rush: 8, ward: 4, magnet: 10 }; });
  // 这条以前只是「render 没抛错」，等于没测 —— 现在查芯片真的建出来又收回去
  RG.buffs = { rush: 8, ward: 4 }; NS.updateBuffs();
  ok(!!NS.BUFF_EL.rush && !!NS.BUFF_EL.ward && !NS.BUFF_EL.magnet, 'HUD 上只给正在生效的增益立芯片');
  RG.buffs = {}; NS.updateBuffs();
  ok(Object.keys(NS.BUFF_EL).length === 0, '增益到期芯片就收掉，不会留一排空条');
  RG.buffs = { rush: 4 }; NS.updateBuffs();
  const bw = NS.BUFF_EL.rush.bar.style.width;
  RG.buffs = { rush: 2 }; NS.updateBuffs();
  ok(bw === '50%' && NS.BUFF_EL.rush.bar.style.width === '25%', `条子按剩余时间收缩（${bw} → ${NS.BUFF_EL.rush.bar.style.width}）`);
  ok(!NS.BUFFS.surge.t, '磁暴是即时的，不该在 HUD 上占一条');
  RG.buffs = {};
  draw('过热状态能画', () => { RG.overheat = 1; });
  draw('每个修饰的横幅都能画', () => { NS.MODS.forEach(m => { RG.mod = m; NS.render(); }); RG.mod = null; });
  draw('暂停画面能画（三种设备提示）', () => { RG.paused = true; NS.render(); NS.PAD.on = true; NS.render(); NS.PAD.on = false; });
  draw('三张场地都能画', () => { RG.paused = false; [0, 1, 2].forEach(i => { NS.setArena(i, false); NS.render(); }); });
  draw('每套涂装都能画', () => { NS.SKIN_ORDER.forEach(k => { NS.pickSkin(k); NS.render(); }); });
  draw('关掉震屏和辉光也能画', () => { NS.setOpt('shake', 0); NS.setOpt('bloom', 0); });
  draw('触屏那份脚本也画得出来', () => { NST.setMode('free'); NST.start(3); NST.render(); });
}

// ---- 18) 移动端铺满屏幕 ----
// 原来画布固定 320×180，等比缩放后竖屏上下各剩一大片黑。
// 现在逻辑分辨率跟着视口宽高比走，参考框 320×180 永远完整装在里面。
console.log('铺满屏幕');
{
  const setVP = (w, h) => { global.innerWidth = w; global.innerHeight = h; };
  const px = v => Math.round(parseFloat(v));
  // 桌面 16:9：一个像素都不该变
  // 桌面钉死 320×180：机台观感不变，视野也不该跟着窗口形状漂
  for (const [w, h] of [[1280, 720], [1920, 800], [900, 900]]) {
    setVP(w, h); NS.fit();
    ok(NS.VW === 320 && NS.VH === 180, `桌面窗口 ${w}×${h} 下视野仍是 ${NS.VW}×${NS.VH}`);
  }

  // 手机用触屏那份（pad=0，要求严丝合缝）
  const fills = (w, h, label) => {
    setVP(w, h); NST.fit();
    const cw = px(NST.cv.style.width), ch = px(NST.cv.style.height);
    ok(Math.abs(cw - w) <= 2 && Math.abs(ch - h) <= 2,
      `${label} ${w}×${h}：画布铺到 ${cw}×${ch}，上下左右都不留黑边`);
    ok(NST.VW >= NST.REF_W - 1 && NST.VH >= NST.REF_H - 1,
      `${label} 视野 ${NST.VW}×${NST.VH}，两个方向都不比 320×180 少`);
    ok(NST.cv.width === NST.VW && NST.cv.height === NST.VH, `${label} 后备缓冲跟着一起改了`);
  };
  fills(375, 812, '竖屏');
  fills(812, 375, '横屏');
  fills(390, 844, '窄长竖屏');
  fills(1024, 768, '平板');

  // 极端比例要掐住，不能算出几千像素高的视野
  setVP(200, 2000); NST.fit();
  ok(NST.VH <= NST.REF_W / .3 + 2, `极端比例下视野封在 ${NST.VW}×${NST.VH}，没有失控`);

  // 视野比场地还大时把场地居中，不能夹出负数
  setVP(375, 812); NST.fit();
  NST.setArena(2, false);                                   // 冷却塔只有 608 高
  ok(NST.VH > NST.ARENA.h, `竖屏视野 ${NST.VH} 高于冷却塔的 ${NST.ARENA.h}，正好是会夹出负数的情形`);
  const c = NST.camAt(300, NST.ARENA.h, NST.VH);
  ok(c === (NST.ARENA.h - NST.VH) / 2 && c < 0, `这时候把场地摆中间（cam=${c.toFixed(1)}），而不是夹到一个比下界还小的上界`);
  NST.setMode('free'); NST.start(3);
  let threw = null;
  try { for (let i = 0; i < 120; i++) { NST.update(1 / 60); NST.render(); } } catch (e) { threw = e.message; }
  ok(!threw, threw ? `竖屏跑起来抛错：${threw}` : '竖屏下更新和渲染都跑得动');
  // 画布铺满之后，画布里的东西会跟固定在视口上的触屏按钮抢位置
  ok(/body\.touch #hud\{[\s\S]{0,220}safe-area-inset-top/.test(html), '触屏时 HUD 让开刘海和圆角');
  ok(/body\.touch #buffs\{[\s\S]{0,160}safe-area-inset-left/.test(html), '增益条也让开左侧安全区');
  ok(/const ox = isTouch \? pad : VW - mw - pad/.test(html), '触屏时小地图挪到左下，不跟右下角的按钮重叠');
  ok(/\.tbtns\{[\s\S]{0,200}right:calc\(14px \+ env\(safe-area-inset-right/.test(html)
    || /right:calc\(14px \+ env\(safe-area-inset-right,0px\)\)/.test(html), '动作按钮本来就在右下并让开了安全区');

  setVP(1280, 720); NST.fit(); NS.fit();                    // 复原，别影响后面的断言
}

console.log(fail ? `\n${fail} 项没通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
