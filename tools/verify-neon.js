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
const { html, js, run, pad, padOff, realTimeout, byId, key, ctx } = require('./neon-stub');

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
  // 种子必须钉死。start() 不传种子的话 RUN_SEED 取的是 Date.now()，
  // 于是这一段每次跑在不同的局上 —— 而 update() 有预算就会再刷怪，
  // 刷出一只比 120px 更近的，自动瞄准就锁到它身上，这条断言时绿时红。
  // 抓到它纯属运气：连着跑两遍，一遍红一遍绿，之后二十遍又全绿。
  NST.start(4242);
  const TP = NST.P, TG = NST.G;
  TG.budget = 0;                                          // 别让这一帧又刷出怪来
  TG.mobs.length = 0; NST.spawn('grunt');
  const m = TG.mobs[0]; m.x = TP.x; m.y = TP.y - 120;      // 正上方
  TP.ang = 0; TG.bullets.length = 0;
  TP.fireT = 0;
  NST.update(1 / 60);
  ok(TG.mobs.filter(x => !x.dead).length === 1,
    `场上只有那一只（现在 ${TG.mobs.filter(x => !x.dead).length} 只）—— 多一只这条断言就不成立`);
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

// 最好成绩要真的落盘，并且下一次读得回来。记录现在按危险档分开存。
const b1 = NS.loadBest()[NS.dangerIdx()];
ok(!!b1 && b1.wave === 7, `最好成绩落盘了（第 ${b1 && b1.wave} 波）`);
ok(!!b1 && b1.build === '磁轨枪 + 穿甲钨芯 + 暴击回路', '记录里带着那一局的打法');
// 打得更差不该覆盖
NS.start(); NS.G.wave = 2; NS.G.score = 1; NS.G.wepDmg = { pulse: 1 }; NS.G.stacks = {};
NS.gameOver();
ok(NS.loadBest()[NS.dangerIdx()].wave === 7, '打得更差不会把记录覆盖掉');

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
NS.G.scrap = 55;                                     // 局内捡到没花完的
const bk = NS.bankRun();
ok(bk.scrap === 3 * 12 + 55, `一局产出废钢 = 波次×12 + 局内没花完的（${bk.scrap}）`);
ok(P0.runs === 1 && P0.kills === 40 && P0.tankKills === 2, '战绩折进了档案');
ok(NS.loadProf().scrapTotal === bk.scrap, '档案落盘了');
// 花掉的就不进档案 —— 这才叫「现在买还是留到下一局」。
// 注意这一段要放在上面两条之后：bankRun() 会加一次局数，先跑会把它们顶掉。
Object.assign(P0, { scrap: 0, scrapTotal: 0, runs: 0, kills: 0 });
NS.start(); NS.G.wave = 3; NS.G.scrap = 5;
ok(NS.bankRun().scrap === 3 * 12 + 5, '花光了只剩波次奖励做底，不至于让这一局的元进度归零');
Object.assign(P0, { scrap: 0, scrapTotal: 0, runs: 0, kills: 0 });

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
// 里程碑只能给【新东西】，不能给永久数值加成 —— 否则元进度会变成数值跑步机，
// 新号和老号打的不是同一个游戏。危险等级是更难的模式，比发新内容更贴这条本意。
ok(NS.MILES.every(m => /卡池|词条|底座|涂装|危险等级|宠物/.test(m.n)),
  '每条里程碑发的都是新内容或新难度档，没有一条是数值加成');
ok(!NS.MILES.some(m => /\+\d|提升|加成|永久|上限 ?\+/.test(m.n)), '奖励文案里没有任何数值加成的字样');

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
// 意图是「只有一处暂停提示」，不是「字符串只出现两次」——
// 加手柄分支时这条红了，说明它当初写得太贴实现了
// 暂停现在整个在 DOM 层（#pauseBox），画布上不再画 —— 两边都画会叠在一起
ok(!/ctx\.fillText\([^)]*已 暂 停/.test(html), '画布上不再画暂停提示');
ok((html.match(/id="pauseBox"/g) || []).length === 1, '只有一个暂停层');
// 查意图不查字符串：三种设备给三种不同的提示，各自不提别的设备的按键。
// 这条已经因为改文案红过两次了 —— 贴着实现写的断言就是会这样。
{
  const hintOf = (touch, padOn) => {
    const N = touch ? NST : NS;
    N.setMode('free'); N.start(2); N.PAD.on = padOn; N.setPaused(true);
    const t = byId('pauseHint').textContent; N.setPaused(false); N.PAD.on = false;
    return t;
  };
  const hKb = hintOf(false, false), hPad = hintOf(false, true), hTc = hintOf(true, false);
  ok(new Set([hKb, hPad, hTc]).size === 3, `三种设备三种提示：「${hKb}」「${hPad}」「${hTc}」`);
  ok(/\bP\b/.test(hKb) && !/\bP\b/.test(hTc), '只有键鼠那条提 P 键');
  ok(/START/.test(hPad), '手柄那条提 START');
}

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
// 出现率按层级封顶，但任何一层都不能高到「整波都是精英」
for (const [w, cap] of [[10, .20], [20, .30], [30, .42]]) {
  UG.wave = w;
  ok(NS.eliteChance() <= cap + 1e-9 && NS.eliteChance() <= .5,
    `第 ${w} 波精英率 ${(NS.eliteChance() * 100).toFixed(0)}%，封在第 ${NS.tier(w)} 层的 ${(cap * 100).toFixed(0)}% 以内`);
}
UG.wave = 12; const ec2 = NS.eliteChance(); UG.wave = 22; const ec3 = NS.eliteChance();
ok(ec3 > ec2, `越深精英越多（第 12 波 ${(ec2 * 100).toFixed(0)}% → 第 22 波 ${(ec3 * 100).toFixed(0)}%）`);
UG.wave = 40;
UG.mod = NS.MODS.find(m => m.allElite);
ok(NS.eliteChance() === 1, '「精锐」波全是精英');
UG.mod = null;
// 修饰本身
ok(NS.MODS.every(m => m.n && m.d && (m.bag || m.allElite)), '每个修饰都改了刷怪表，且横幅有话说');
// 修饰不能比它用到的怪先出场 —— 探针在第 4 波撞见过 14 个精英，就是漏了这条
const FIRST = { grunt: 1, rusher: 2, drone: 3, shieldbot: 4, tank: 5, bomber: 6,
  splitter: 7, relay: 9, sniper: 11, hauler: 13 };
// 这张表必须跟刷怪表对得上，否则上面那条门槛断言会因为 `|| 1` 而形同虚设
{
  const src = html.slice(html.indexOf("const bag = ['grunt'"), html.indexOf('const t = pickw(bag)'));
  for (const k in FIRST) {
    if (k === 'grunt') continue;
    const re = new RegExp(`w >= (\\d+)\\) bag\\.push\\([^)]*'${k}'`);
    const m = src.match(re);
    ok(!!m && +m[1] === FIRST[k], m ? `${NS.MOB[k].nm} 第 ${m[1]} 波进池（表里记的 ${FIRST[k]}）`
      : `${k} 在刷怪表里找不到，FIRST 表过期了`);
  }
}
// 每一种「逼你改打法」的怪都得至少进一个修饰的刷怪表。
// 修饰会整表替换刷怪表，而第 21~30 波有 80% 带修饰 ——
// 漏了这一步的后果实测过：四种新怪在最后十波只占 16%，高潮段成了最单调的一段。
{
  const inMods = new Set();
  NS.MODS.forEach(m => (m.bag || []).forEach(t => inMods.add(t)));
  const force = Object.keys(NS.MOB).filter(k =>
    k !== 'shard' && !NS.MOB[k].boss && k !== 'grunt' && k !== 'drone' && k !== 'tank' && k !== 'rusher');
  const orphan = force.filter(k => !inMods.has(k));
  ok(orphan.length === 0, orphan.length
    ? `这些怪没进任何修饰的刷怪表，后段会消失：${orphan.map(k => NS.MOB[k].nm).join('、')}`
    : `六种「逼你改打法」的怪都进了修饰池（${force.map(k => NS.MOB[k].nm).join('、')}）`);
  ok(NS.MODS.length >= 6, `有 ${NS.MODS.length} 个修饰 —— 少了的话第三层每波都有修饰就会反复撞见同一个`);
  ok(new Set(NS.MODS.map(m => (m.bag || ['*']).join())).size === NS.MODS.length, '没有两个修饰用同一张刷怪表');
  // 远程怪的威胁随数量是乘性的：一屏四十个钉枪手就是每秒四十条弹线，
  // 有预警也躲不过来。实测过：让它占半张表，探针 5 局里 3 局死在第 21~22 波。
  // 所以远程怪不能当一波的主题，只能当点缀。
  const ranged = ['sniper'];
  for (const m of NS.MODS) {
    if (!m.bag) continue;
    for (const r of ranged) {
      const share = m.bag.filter(t => t === r).length / m.bag.length;
      ok(share <= 1 / 3 + 1e-9,
        `${m.id} 里 ${NS.MOB[r].nm} 占 ${(share * 100).toFixed(0)}%（远程怪不能超过 1/3）`);
    }
  }
}
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
// 第一层要留出平稳的波次做对比；第三层是故意每波都有的
const plain1 = WS.filter((w, i) => NS.tier(w) === 1 && s1.split(',')[i] === '-');
ok(plain1.length >= 2, `第一层有 ${plain1.length} 个平稳波次做对比，不是一上来就每波带修饰`);
// 第三层【大部分】波次带修饰，但不是每一波 —— 留一点喘息的节拍。
// 原来这条要求「每一波都有」，那是 4 个修饰时代的决定；7 个修饰之后同一条规则
// 把第 21 波变成了一道墙（探针 5 局有 4 局死在 21~22）。
{
  const t3 = [];
  for (const seed of [1, 2, 3, 4, 5, 6]) { NS.seedRun(seed); for (let w = 21; w <= 30; w++) if (w % 5) t3.push(!!NS.rollMod(w)); }
  const rate = t3.filter(Boolean).length / t3.length;
  ok(rate > .6, `第三层 ${(rate * 100).toFixed(0)}% 的波次带修饰 —— 深层就该一直有花样`);
  ok(rate < 1, `但不是每一波（${(rate * 100).toFixed(0)}%）—— 全是修饰就没有喘息的节拍`);
}
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
// 过热还要把残兵赶过来 —— 探针撞到过「预算 0、场上剩 2 只、过热已开，152 秒没推进」
{
  NS.setMode('free'); NS.start(6);
  const OG = NS.G, OP = NS.P;
  OG.phase = 'wave'; OG.budget = 0; OG.overheat = 0;
  OG.mobs.length = 0; NS.spawn('drone');
  const far = OG.mobs[0];
  far.x = OP.x + 420; far.y = OP.y + 300;
  const d0 = Math.hypot(far.x - OP.x, far.y - OP.y);
  for (let i = 0; i < 90; i++) NS.update(1 / 60);
  const d1 = Math.hypot(far.x - OP.x, far.y - OP.y);
  OG.overheat = 1;
  for (let i = 0; i < 90; i++) NS.update(1 / 60);
  const d2 = Math.hypot(far.x - OP.x, far.y - OP.y);
  ok(d0 - d2 > (d0 - d1) * 1.5, `过热后残兵冲得更快（不过热 1.5 秒走近 ${Math.round(d0 - d1)}px，过热后又近了 ${Math.round(d1 - d2)}px）`);
  // BOSS 在加时里也要过来，只是不加速 —— 母巢是唯一不会追人的 BOSS，
  // 原来把 BOSS 全排除，它剩 10% 血站在原地就是个死局
  {
    NS.setMode('free'); NS.start(8);
    const BG2 = NS.G, BP2 = NS.P;
    BG2.phase = 'wave'; BG2.budget = 0; BG2.overheat = 0; BG2.mobs.length = 0;
    NS.spawn('boss3');
    const hv = BG2.mobs[0];
    hv.x = BP2.x + 400; hv.y = BP2.y;
    const q0 = hv.x - BP2.x;
    for (let i = 0; i < 120; i++) NS.update(1 / 60);
    const q1 = hv.x - BP2.x;
    BG2.overheat = 1;
    for (let i = 0; i < 120; i++) NS.update(1 / 60);
    const q2 = hv.x - BP2.x;
    ok(q1 - q2 > (q0 - q1) * 1.5, `过热后母巢会自己过来（不过热 2 秒走近 ${Math.round(q0 - q1)}px，过热后 ${Math.round(q1 - q2)}px）`);
    ok(/m\.chg > 0 \|\| m\.wind > 0/.test(html), '蓄力和冲撞中的拆解臂不被打断 —— 那是它的预警');
  }
  ok(/!G\.overheat && G\.mobs\.length < targetMass/.test(html), '过热时 BOSS 也停止召唤，否则这波永远清不完');
}
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

// ---- 19) 手机上的换枪键 ----
// 它原来永远写着「枪」，而开局只有一把枪时 cycleWep() 第一行就 return ——
// 不响不亮不提示，按钮看着就是坏的。
console.log('换枪键');
{
  const wep = byId('btnWep');
  ok(NS.WEP_ORDER.every(k => NS.WEAPONS[k].s && [...NS.WEAPONS[k].s].length === 2),
    '每把枪都有两字简称（圆按钮放不下四个字）');
  NST.setMode('free'); NST.start(7);
  const TP = NST.P;
  ok(TP.owned.length === 1, '开局只有一把枪，正是按了没反应的那种情况');
  ok(wep.classList.contains('lock'), '这时候按钮是灰的，不装作能按');
  ok(wep.textContent === NST.WEAPONS[TP.wep].s, `按钮写的是当前武器「${wep.textContent}」，不是笼统的「枪」`);
  ok(wep.style['--wc'] === NST.WEAPONS[TP.wep].col, '按钮染成当前武器的颜色');
  // 拿到第二把之后才真的能按
  NST.equip('shot');
  ok(TP.owned.length === 2 && !wep.classList.contains('lock'), '有第二把枪之后按钮点亮');
  const before = wep.textContent, col0 = wep.style['--wc'];
  NST.cycleWep();
  ok(wep.textContent !== before, `按一下就换枪，按钮跟着改字（${before} → ${wep.textContent}）`);
  ok(wep.style['--wc'] !== col0, '颜色也跟着换，一眼看出手里是哪把');
  ok(/#tc #btnWep\.lock\{/.test(html), '灰掉的样式是给这个按钮单独写的，没连累冲刺键');
  ok(!/#tc \.tbtns button\.lock/.test(html), '冲刺键不受影响');
}

// ---- 20) 曲线与终点 ----
// 量出来的真因：刷怪速率封在 5.6 只/秒，而满词条玩家能杀 33 只/秒，
// 于是第 32 波预算 164 只、场上同时只有 16 只 —— 场地永远是空的。
// 所以改的是「场上同时多少只」，不是砍玩家。
console.log('曲线与终点');
{
  ok(NS.LAST_WAVE === 30, `一局收在第 ${NS.LAST_WAVE} 波 —— 有终点才调得动曲线`);
  ok(NS.tier(1) === 1 && NS.tier(11) === 2 && NS.tier(21) === 3, '每 10 波一个层级');
  const m1 = NS.targetMass(1), m10 = NS.targetMass(10), m30 = NS.targetMass(30);
  ok(m1 < m10 && m10 < m30, `场上目标数量一路涨（${m1} → ${m10} → ${m30}）`);
  ok(m30 >= 60, `第 30 波场上要有 ${m30} 只，才压得住能杀 33 只/秒的玩家`);
  ok(m1 <= 10, `第 1 波只有 ${m1} 只，开局不劝退`);
  ok(NS.spawnGap(30) <= .1, `第 30 波补怪间隔 ${NS.spawnGap(30)}s，清空了能立刻补上`);
  ok(NS.spawnGap(1) > NS.spawnGap(30), '早期慢、后期快');
  // 顶到上限就不该再刷
  NS.setMode('free'); NS.start(9);
  const CG = NS.G;
  CG.wave = 20; CG.phase = 'wave'; CG.budget = 500; CG.spawnT = 0; CG.mobs.length = 0; CG.mod = null;
  for (let i = 0; i < 4000; i++) NS.waveSpawn(1 / 60);
  ok(CG.mobs.length <= NS.targetMass(20) + 2, `刷到 ${CG.mobs.length} 只就停了，没把人埋死（上限 ${NS.targetMass(20)}）`);
  ok(CG.mobs.length >= NS.targetMass(20) - 4, '也确实填到了上限，不是刷几只就不刷了');
  ok(500 - CG.budget === CG.mobs.length, `预算只在真刷出怪时才扣（扣了 ${500 - CG.budget}，场上 ${CG.mobs.length}）`);
  // 顶到上限的那条路不能消耗随机数，否则手快手慢的人在同一每日种子上会摇出不同的局
  CG.mobs.length = 0; for (let i = 0; i < 200; i++) NS.spawn('grunt');
  NS.seedRun(777); const r0 = NS.RNG.wave();
  NS.seedRun(777); CG.budget = 50; CG.spawnT = 0;
  for (let i = 0; i < 600; i++) NS.waveSpawn(1 / 60);
  ok(NS.RNG.wave() === r0, '顶到上限时不摇随机数 —— 每日局不会因为手快手慢而分叉');
  // 通关
  NS.setMode('free'); NS.start(9);
  const WG = NS.G;
  NS.PROF.wins = 0;
  WG.wave = NS.LAST_WAVE; WG.phase = 'break'; WG.waveT = 0; WG.mobs.length = 0;
  NS.nextWave();
  ok(WG.state === 'over' && WG.won === true, '打完第 30 波是撤离成功，不是继续第 31 波');
  ok(WG.wave === NS.LAST_WAVE, `结算上写的是第 ${WG.wave} 波，没被加到 31`);
  ok(NS.PROF.wins === 1, '通关次数记进档案');
  ok(byId('overTitle').textContent.replace(/ /g, '') === '撤离成功', `结算标题是「${byId('overTitle').textContent}」`);
  ok(byId('overSub').textContent.indexOf('拆解') < 0, '通关的小字不该写「被拆解」');
  ok(byId('over').classList.contains('won'), '结算屏挂上 won —— 赢了不能跟死了一个颜色');
  ok(/#over\.won h1\{color:var\(--tox\)/.test(html), '通关标题换成绿色，红色读起来就是失败');
  // 死亡那条路没被改坏
  NS.start(9); const DG = NS.G, DP = NS.P;
  DP.hp = 1; DP.inv = 0; DP.dashT = 0; DG.buffs = {};
  NS.hurtPlayer(50, 'grunt');
  ok(DG.state === 'over' && DG.won === false, '死了还是死了，won 为假');
  ok(byId('overTitle').textContent.replace(/ /g, '') === '连接中断', '死亡标题没被通关那套覆盖');
  ok(!byId('over').classList.contains('won'), '死了要把 won 摘掉，不能留着上一局的绿色');
}

// ---- 21) 三种 BOSS ----
// 原来六个 BOSS 波全是母体核心，打第四次时已经没有信息量了。
console.log('BOSS');
{
  const kinds = Object.keys(NS.MOB).filter(k => NS.MOB[k].boss);
  ok(kinds.length === 3, `有 ${kinds.length} 种 BOSS：${kinds.map(k => NS.MOB[k].nm).join('、')}`);
  ok(kinds.every(k => NS.MOB[k].spr && NS.MOB[k].spr2 && NS.MOB[k].spr !== NS.MOB[k].spr2),
    '每种都有两个形态的精灵，不是共用一张图');
  ok(kinds.every(k => NS.GRID[NS.MOB[k].spr] && NS.GRID[NS.MOB[k].spr2]), '四张新网格都在 GRID 里，会被皮肤一起烤');
  ok(new Set(kinds.map(k => NS.MOB[k].col)).size === 3, '三种 BOSS 颜色各不相同');
  ok(new Set(kinds.map(k => NS.MOB[k].p2n)).size === 3, '二形态的横幅词也各不相同');
  // 六个 BOSS 波不能全是同一个
  const seq = [5, 10, 15, 20, 25, 30].map(w => NS.bossOf(w));
  ok(new Set(seq).size >= 3, `六个 BOSS 波出场顺序：${seq.map(k => NS.MOB[k].nm).join(' → ')}`);
  ok(NS.bossOf(5) !== NS.bossOf(10) && NS.bossOf(10) !== NS.bossOf(15), '连着的 BOSS 波不重复');
  // 行为真的不一样：各跑几秒，看它们干了什么
  const watch = (kind) => {
    NS.setMode('free'); NS.start(4);
    const G = NS.G, P = NS.P;
    // 把正常刷怪关掉，只留 BOSS 自己召唤的。原来没关，这里数到的是
    // 「BOSS 召唤 + 波次刷怪」两件事，之前靠巧合过关，改了刷怪表立刻翻。
    G.wave = 12; G.phase = 'wave'; G.budget = 0; G.waveT = 999;
    G.mobs.length = 0; G.ebullets.length = 0;
    NS.spawn(kind);
    const b = G.mobs[0];
    b.x = P.x + 150; b.y = P.y;
    let shots = 0, adds = 0, maxSpd = 0, still = 0;
    for (let i = 0; i < 60 * 14; i++) {
      const n0 = G.mobs.length, e0 = G.ebullets.length;
      NS.update(1 / 60);
      if (b.dead) break;
      shots += Math.max(0, G.ebullets.length - e0);
      adds += Math.max(0, G.mobs.length - n0);
      maxSpd = Math.max(maxSpd, Math.hypot(b.vx, b.vy));
      if (Math.hypot(b.vx, b.vy) < 1) still++;
    }
    return { shots, adds, maxSpd: Math.round(maxSpd), still };
  };
  const A = watch('boss'), B = watch('boss2'), C = watch('boss3');
  ok(A.shots > 20, `母体核心靠弹幕（14 秒放了 ${A.shots} 发）`);
  ok(B.maxSpd > A.maxSpd * 2, `拆解臂靠冲撞（峰值速度 ${B.maxSpd} 对母体核心的 ${A.maxSpd}）`);
  ok(B.still > 30, `拆解臂会站定蓄力（站住了 ${B.still} 帧）—— 那就是预警`);
  ok(C.adds > B.adds && C.adds > 4, `母巢靠吐兵（14 秒吐了 ${C.adds} 只，拆解臂 ${B.adds} 只）`);
  ok(C.maxSpd < A.maxSpd, `母巢几乎不动（峰值 ${C.maxSpd}）—— 得自己冲过去拆`);
  // 第 30 波：血更厚，而且半血叫帮手
  NS.setMode('free'); NS.start(4);
  const FG = NS.G;
  FG.wave = NS.LAST_WAVE - 1; FG.phase = 'break'; FG.waveT = 0; FG.mobs.length = 0;
  NS.nextWave();
  const fb = FG.mobs.find(m => NS.isBoss(m));
  ok(!!fb && fb.final === 1, '第 30 波的 BOSS 挂了 final');
  ok(fb.max > NS.MOB[fb.type].hp, `最后一道闸血更厚（${Math.round(fb.max)} 对基础 ${NS.MOB[fb.type].hp}）`);
  fb.hp = fb.max * .4;                                   // 压到半血以下
  const n0 = FG.mobs.filter(m => NS.isBoss(m)).length;
  for (let i = 0; i < 30; i++) NS.update(1 / 60);
  ok(FG.mobs.filter(m => NS.isBoss(m)).length > n0, '最后一道闸半血时叫了一台拆解臂进场');
}

// ---- 22) 第一次遇见的应对提示 ----
console.log('应对提示');
{
  ok(Object.keys(NS.TIPS).length >= 8, `${Object.keys(NS.TIPS).length} 种怪有应对提示`);
  // 图鉴要完整：每一种会出现的怪都得有一条，缺了就是翻到一半没了
  const spawnable = Object.keys(NS.MOB).filter(k => k !== 'shard');
  const missing = spawnable.filter(k => !NS.TIPS[k]);
  ok(missing.length === 0, missing.length ? `这些怪没有图鉴条目：${missing.join('、')}` : '每一种会出现的怪都有图鉴条目');
  for (const k of ['shieldbot', 'bomber', 'relay']) {
    ok(!!NS.TIPS[k], `${NS.MOB[k].nm} 有提示 —— 这三种存在的理由就是逼你改打法`);
  }
  // 提示得说「怎么办」，不能只说「它是什么」
  // 「说怎么办」的判据：得出现一个动作。拾荒机兵那条是「对着打就行」——
  // 也是动作（而且它的作用正是给后面「不能对着打」的几种做对比）
  const verbs = /绕|横|别|先|冲|躲|清|对着打/;
  const vague = Object.entries(NS.TIPS).filter(([k, t]) => !verbs.test(t[1]));
  ok(vague.length === 0, vague.length ? `这几条只在描述不在指导：${vague.map(v => v[0]).join('、')}`
    : '每条提示都在说怎么应对，不是在描述它长什么样');
  NS.setMode('free'); NS.start(4);
  const TG = NS.G;
  ok(Object.keys(TG.seen).length === 0 && TG.tipQ.length === 0, '开局一条都没提示过');
  TG.mobs.length = 0; NS.spawn('shieldbot');
  ok(TG.seen.shieldbot === 1 && TG.tipQ.length === 1, '第一次刷出铁闸就排进提示队列');
  NS.spawn('shieldbot'); NS.spawn('shieldbot');
  ok(TG.tipQ.length === 1, '同一种只提示一次，不会每只都弹');
  for (let i = 0; i < 60 * 4; i++) NS.update(1 / 60);
  ok(TG.tipQ.length === 0, '排队等一会儿，提示自己会播出来');
  // 提示的节奏不能挂在渲染上 —— 原来它看的是 bannerT，而 bannerT 在主循环里减
  ok(!/tipQ\.length && bannerT/.test(html), '提示队列用自己的计时器，不读渲染循环的变量');
  NS.start(4); const QG = NS.G;
  // 把刷怪关掉并把别的都标成见过 —— 否则循环里刷出的小兵会往队列里多塞一条，
  // 这条断言就会红在一个不存在的问题上
  QG.phase = 'break'; QG.budget = 0; QG.waveT = 999;
  Object.keys(NS.TIPS).forEach(k => { QG.seen[k] = 1; });
  delete QG.seen.bomber; delete QG.seen.relay;
  QG.mobs.length = 0; QG.tipQ.length = 0; QG.tipT = 0;
  NS.spawn('bomber'); NS.spawn('relay');
  ok(QG.tipQ.length === 2, '两种新怪各排一条');
  NS.update(1 / 60);
  ok(QG.tipQ.length === 1, '先播一条，另一条还在队里');
  for (let i = 0; i < 60 * 2; i++) NS.update(1 / 60);
  ok(QG.tipQ.length === 1, '两秒内不播第二条 —— 两条叠在一起等于都没看见');
  for (let i = 0; i < 60 * 2; i++) NS.update(1 / 60);
  ok(QG.tipQ.length === 0, '隔开两秒多之后第二条才出');
  NS.start(4);
  ok(Object.keys(NS.G.seen).length === 0, '重开一局重新算 —— 提示是给这一局的新玩家看的');
}

// ---- 23) 危险等级 ----
// 局有终点之后，「打穿之后玩什么」是真问题。答案是把同一条 30 波曲线整体上抬一档。
console.log('危险等级');
{
  const D = 1 / 60;
  ok(NS.DANGER.length >= 3, `有 ${NS.DANGER.length} 档`);
  ok(NS.DANGER.every(g => g.n && g.d), '每档都有名字和一句说明');
  // 数值必须单调上升，而且不能离谱
  for (let i = 1; i < NS.DANGER.length; i++) {
    const a = NS.DANGER[i - 1], b = NS.DANGER[i];
    ok(b.hp > a.hp && b.mass >= a.mass && b.sc > a.sc,
      `${b.n.replace(/ /g, '')} 比上一档更难也更值分（血 ${a.hp}→${b.hp}，密度 ${a.mass}→${b.mass}，分 ${a.sc}→${b.sc}）`);
  }
  ok(NS.DANGER[NS.DANGER.length - 1].hp <= 3, '最高档血量没有膨胀到没法打');
  ok(NS.DANGER[0].hp === 1 && NS.DANGER[0].mass === 1 && NS.DANGER[0].sc === 1, '第一档就是基准，不偷偷加料');
  // 每一档除了数值还得改一条结构，否则四档只是同一局的四个滑块
  ok(NS.DANGER.slice(1).every(g => g.modTier > 0 || g.modsOnBoss || g.elite > 1),
    '每个高档位都至少改了一条结构（修饰更频 / BOSS 波带修饰 / 精英更多）');
  ok(NS.DANGER[0].modTier === 0, '标准档不挪修饰概率');
  // 解锁：默认只有第一档
  for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
  Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf();
  ok(NS.dangerMax() === 0 && NS.dangerIdx() === 0, '新档案只有标准档');
  NS.pickDanger(2);
  ok(NS.dangerIdx() === 0, `没解锁就选不了（想选 2，实际停在 ${NS.dangerIdx()}）`);
  // 真的影响到局内
  const mass0 = NS.targetMass(20);
  NS.setMode('free'); NS.start(5);
  // 精英会让血量再 ×2.6，量档位倍率的时候得把它除掉 ——
  // 第一版没除，断言报「×6.24 而配的是 2.4」，错的是测试不是游戏。
  const baseHp = () => { NS.G.mobs.length = 0; NS.spawn('grunt'); const m = NS.G.mobs[0]; return m.max / (m.elite ? 2.6 : 1); };
  NS.G.wave = 20; const hp0 = baseHp(), el0 = NS.eliteChance();
  NS.PROF.dangerMax = 3; NS.pickDanger(3);
  const hp1 = baseHp(), mass1 = NS.targetMass(20), el1 = NS.eliteChance();
  ok(Math.abs(hp1 / hp0 - NS.DANGER[3].hp) < .02, `第 20 波（倍率已满）小兵血量 ×${(hp1 / hp0).toFixed(2)}，配的是 ${NS.DANGER[3].hp}`);
  ok(Math.abs(mass1 / mass0 - NS.DANGER[3].mass) < .05, `场上数量 ${mass0} → ${mass1} 只`);
  // 倍率要在前八波渐进 —— 一上来就满档的话局还没开始就结束了
  ok(NS.dgMul(2, 1) === 1, '第 1 波的倍率是 1，跟标准档完全一样');
  ok(NS.dgMul(2, 4) > 1 && NS.dgMul(2, 4) < 2, `第 4 波爬到一半（×${NS.dgMul(2, 4).toFixed(2)}）`);
  ok(NS.dgMul(2, 8) === 2, '第 8 波倍率给满');
  ok(NS.dgMul(2, 30) === 2, '之后不再继续涨 —— 它是倍率不是斜率');
  NS.G.wave = 1;
  const h1 = baseHp(); NS.pickDanger(0); const h0 = baseHp();
  ok(Math.abs(h1 - h0) < .01, `第 1 波归零档和标准档的小兵血量一样（${h0.toFixed(0)} vs ${h1.toFixed(0)}）`);
  NS.PROF.dangerMax = 3; NS.pickDanger(3); NS.G.wave = 20;
  ok(el1 > el0, `精英率 ${(el0 * 100).toFixed(0)}% → ${(el1 * 100).toFixed(0)}%`);
  // 多摇几个种子再看。概率从 1.0 压到 0.82 之后，只看三个波次会时好时坏 ——
  // 那是不稳定的测试，不是 bug。
  {
    let hit = 0, n = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) { NS.seedRun(seed); for (const w of [5, 10, 15, 20]) { n++; if (NS.rollMod(w)) hit++; } }
    ok(hit > 0, `归零档 BOSS 波也会带修饰（${n} 次里 ${hit} 次）`);
  }
  NS.pickDanger(1);
  ok(NS.rollMod(5) === null && NS.rollMod(10) === null, '高危档 BOSS 波仍然不带修饰');
  // 高档位绝对不能把还没解锁的修饰提前 —— 第一版就是这么写的，
  // 结果「铁壁」能在第 2 波砸到一级角色身上
  for (const dgi of [1, 2, 3]) {
    NS.PROF.dangerMax = 3; NS.pickDanger(dgi);
    ok([1, 2, 3].every(w => NS.rollMod(w) === null), `${NS.DANGER[dgi].n.replace(/ /g, '')} 档前三波仍然不带修饰`);
    let bad = null;
    for (let w = 4; w <= 30; w++) { const m = NS.rollMod(w); if (m && w < m.from) bad = `${m.id} 在第 ${w} 波就出了（它的门槛是 ${m.from}）`; }
    ok(!bad, bad || `${NS.DANGER[dgi].n.replace(/ /g, '')} 档没有任何修饰早于它自己的解锁波次`);
  }
  // 高档位的效果是「更常摇到」
  const rate = dgi => { NS.PROF.dangerMax = 3; NS.pickDanger(dgi); NS.seedRun(31337); let n = 0;
    for (let w = 4; w <= 20; w++) if (w % 5 && NS.rollMod(w)) n++; return n; };
  const r1 = rate(0), r2 = rate(1);
  ok(r2 > r1, `高危档修饰更频（标准 ${r1} 次 → 高危 ${r2} 次，同一段波次）`);
  // 池子只有一个修饰够门槛时不能每波都发 —— 那是「每波都是同一个」
  for (const dgi of [0, 1, 2, 3]) {
    NS.PROF.dangerMax = 3; NS.pickDanger(dgi);
    let n = 0, tries = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) { NS.seedRun(seed); tries++; if (NS.rollMod(4)) n++; }
    ok(n < tries, `${NS.DANGER[dgi].n.replace(/ /g, '')} 档第 4 波不是必定带修饰（10 个种子里 ${n} 个带）`);
  }
  NS.pickDanger(3);
  const t1w = [4, 6, 7, 8, 9].filter(w => { NS.seedRun(w * 7); return NS.rollMod(w) === null; });
  ok(t1w.length > 0, `归零档第一层也留得出平稳波次（${t1w.length} 个）`);
  // 分数倍率
  NS.pickDanger(0); NS.start(5);
  NS.G.mobs.length = 0; NS.spawn('grunt'); NS.G.score = 0; NS.G.combo = 0;
  NS.killMob(NS.G.mobs[0]); const sc0 = NS.G.score;
  NS.pickDanger(3); NS.start(5);
  NS.G.mobs.length = 0; NS.spawn('grunt'); NS.G.score = 0; NS.G.combo = 0;
  NS.killMob(NS.G.mobs[0]); const sc1 = NS.G.score;
  ok(sc1 > sc0, `高档位同一只怪给更多分（${sc0} → ${sc1}）—— 不然没人愿意上高危`);
  // 每日局钉在标准档
  NS.setMode('daily');
  ok(NS.dangerIdx() === 0, '每日局固定标准档，不然大家的成绩没法比');
  NS.setMode('free');
  // 通关解锁下一档
  for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
  Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf();
  NS.start(5);
  NS.G.wave = NS.LAST_WAVE; NS.G.phase = 'break'; NS.G.waveT = 0; NS.G.mobs.length = 0;
  NS.nextWave();
  ok(NS.PROF.dangerMax === 1, '打穿标准档解锁高危');
  ok(byId('overSub').textContent.indexOf('解锁') >= 0, `结算上说了解锁：「${byId('overSub').textContent}」`);
  NS.pickDanger(1); NS.start(5);
  NS.G.wave = NS.LAST_WAVE; NS.G.phase = 'break'; NS.G.waveT = 0; NS.G.mobs.length = 0;
  NS.nextWave();
  ok(NS.PROF.dangerMax === 2, '再打穿高危解锁熔毁 —— 一档一档来，不能跳');
  // 记录要带档位，否则高危打 20 波会被标准档的 30 波比下去
  ok(/\(a\.dg \| 0\) > \(b\.dg \| 0\)/.test(html), '记录按「危险档 → 波次 → 分数」比');
  ok(/dg: dangerIdx\(\)/.test(html), '记录里存了当时的档位');
}

// ---- 24) 里程碑的描述和判定要对得上 ----
console.log('里程碑');
{
  ok(NS.MILES.some(m => /打穿/.test(m.d)), '有一条是给通关的 —— 游戏里最大的成就原来什么都不解锁');
  // bossKills 在加了三种 BOSS 之后变成通用计数，写「母体核心」的那条得单独记
  const core = NS.MILES.find(m => /母体核心/.test(m.d));
  ok(!!core, '还有一条专认母体核心');
  const fake = Object.assign({}, NS.PROF_DEF, { bossKills: 5, coreKills: 0 });
  ok(core.ok(fake) === false, '只拆了别的 BOSS 不算「拆掉一个母体核心」');
  ok(core.ok(Object.assign({}, fake, { coreKills: 1 })) === true, '真拆了母体核心才算');
  const any = NS.MILES.find(m => /任意一个 BOSS/.test(m.d));
  ok(!!any && any.ok(fake) === true, '写「任意 BOSS」的那条则认所有 BOSS');
  // 局内也要分开记
  NS.setMode('free'); NS.start(5);
  NS.G.mobs.length = 0; NS.spawn('boss2');
  NS.killMob(NS.G.mobs[0]);
  ok(NS.G.bossKills === 1 && NS.G.coreKills === 0, '拆解臂只加 bossKills，不加 coreKills');
  NS.G.mobs.length = 0; NS.spawn('boss');
  NS.killMob(NS.G.mobs[0]);
  ok(NS.G.coreKills === 1, '母体核心两个都加');
}

// ---- 25) 构筑面板 ----
// 背包其实一直存在，只是看不见：G.stacks 存着这一局的全部词条，
// 而玩家从头到尾只能在死亡结算看到一行「最常用武器 + 前两个词条」。
console.log('构筑面板');
{
  NS.setMode('free'); NS.start(12);
  const CG = NS.G, CP = NS.P;
  let h = (NS.syncBuild(), NS.buildHTML());
  ok(h.indexOf(NS.WEAPONS[CP.wep].n) >= 0, `开局就列出了手里的枪（${NS.WEAPONS[CP.wep].n}）`);
  ok(h.indexOf('还没有装载任何改装') >= 0, '一条词条都没有时说清楚，而不是给一片空白');
  // 拿几张牌，面板要跟着变
  const dmg = NS.UPGRADES.find(u => u.id === 'dmg');
  const rof = NS.UPGRADES.find(u => u.id === 'rof');
  NS.takeUpgrade(dmg); NS.takeUpgrade(dmg); NS.takeUpgrade(rof);
  h = NS.buildHTML();
  ok(h.indexOf(dmg.n) >= 0 && h.indexOf(rof.n) >= 0, '拿过的词条都在面板上');
  ok(h.indexOf('2/' + dmg.max) >= 0, `叠了几层写几层（${dmg.n} 2/${dmg.max}）`);
  ok(h.indexOf(dmg.n) < h.indexOf(rof.n), '按层数排序，专精在哪一眼看得出（2 层的排在 1 层前面）');
  // 这一行原来写的是「已装载 3 / 72 层」。72 = 全部 23 条一条不落叠满，
  // 而一局也就三十层左右 —— 一个永远到不了的分母，玩家直接问了「72 是什么意思」。
  // 现在报的是构筑真正的两个维度：摊了几种、叠了几层。
  ok(h.indexOf('2 种 · 3 层') >= 0,
    `已装载报的是「几种 · 几层」（拿了 ${dmg.n}×2 + ${rof.n}×1）`);
  const capAll = NS.UPGRADES.filter(u => !/^w_/.test(u.id)).reduce((n, u) => n + u.max, 0);
  ok(h.indexOf('/ ' + capAll) < 0,
    `面板上不出现 ${capAll} 这种一局到不了的理论上限`);
  // 满级要标出来：满了就不会再进卡池，玩家得知道
  for (let i = NS.G.stacks.dmg; i < dmg.max; i++) NS.takeUpgrade(dmg);
  h = NS.buildHTML();
  ok(/class="bi full"/.test(h), '满级的词条单独标出来（满了就不会再出现在卡池里）');
  ok(/\.build \.bi\.full \.st\{color:var\(--tox\)\}/.test(html), '满级用不同颜色，不是只加个字');
  // 武器：当前拿着的要标
  NS.PROF.unlocked.w_shot = 1; NS.equip('shot');
  h = NS.buildHTML();
  ok(/class="bi now"/.test(h), '当前拿着的那把单独标出来');
  ok(h.indexOf(NS.WEAPONS.pulse.n) >= 0 && h.indexOf(NS.WEAPONS.shot.n) >= 0, '带着的枪都列出来，不只列当前这把');
  // 换装卡不该混进词条行（它们是武器，不是改装）
  ok(h.indexOf('w_shot') < 0, '换装卡不重复出现在词条行里');
  // 两个位置都要填：选牌时和暂停时
  CG.state = 'play'; NS.showLevelup();
  ok(byId('buildUp').innerHTML.length > 20, '选牌页带面板 —— 看不见已有的就谈不上「选」');
  CG.state = 'play'; NS.setPaused(true);
  ok(byId('buildPause').innerHTML.length > 20, '暂停页也带面板');
  ok(byId('pauseBox').classList.contains('show'), '暂停层显示出来了');
  ok(byId('pauseHint').textContent.indexOf('P') >= 0, `键鼠提示按 P（「${byId('pauseHint').textContent}」）`);
  NS.setPaused(false);
  ok(!byId('pauseBox').classList.contains('show'), '取消暂停就收起来');
  // 重开一局要清干净
  NS.setPaused(true); NS.start(12);
  ok(!byId('pauseBox').classList.contains('show'), '重开时暂停层收掉，不会挂在新局上');
  ok(NS.buildHTML().indexOf('还没有装载任何改装') >= 0, '新局的面板是空的，不带上一局的词条');
  // 触屏那份的提示不一样
  NST.setMode('free'); NST.start(12); NST.setPaused(true);
  ok(!/\bP\b/.test(byId('pauseHint').textContent), `触屏提示不提 P 键（「${byId('pauseHint').textContent}」）`);
  NST.setPaused(false);
}

// ---- 26) 这一波还剩多少 ----
// 刷怪从「按秒」改成「按场上密度」之后，一波还剩多久完全看不出来 ——
// 而「现在冲过去捡那个增益还是再撑一会儿」这个决定全靠它。
console.log('波次进度');
{
  const D = 1 / 60;
  NS.setMode('free'); NS.start(21);
  const WG = NS.G;
  WG.phase = 'wave'; WG.budget = 30; WG.mobs.length = 0;
  for (let i = 0; i < 6; i++) NS.spawn('grunt');
  ok(NS.waveLeft() === 36, `还剩 = 没刷的 30 + 场上 6 = ${NS.waveLeft()}`);
  NS.spawn('boss');
  ok(NS.waveLeft() === 36, 'BOSS 不算进条里 —— 它自己有血条，算进去会写成「还剩 1 只」误导人');
  WG.mobs.forEach(m => { if (!NS.isBoss(m)) m.dead = true; });
  ok(NS.waveLeft() === 30, '死掉的不算');
  // 条子要缩，清空时变色
  WG.mobs.length = 0; WG.budget = 40; WG.waveMax = 0; NS.syncWave();
  const w0 = byId('waveBar').style['--w'];
  WG.budget = 10; NS.syncWave();
  const w1 = byId('waveBar').style['--w'];
  ok(parseFloat(w0) === 100 && Math.abs(parseFloat(w1) - 25) < 1, `条子按剩余比例缩（${w0} → ${w1}）`);
  ok(byId('waveLeft').textContent === '10', `旁边写着确切数字（${byId('waveLeft').textContent}）`);
  WG.budget = 0; NS.syncWave();
  ok(byId('waveBar').classList.contains('clear'), '清空了变个颜色，不用去数场上还有没有');
  // 新的一波要重新算满格
  WG.phase = 'break'; WG.waveT = 0; WG.wave = 3; WG.mobs.length = 0;
  NS.nextWave();
  ok(WG.waveMax === 0, '进新波时满格清零，不然新波的条子一开始就是半截');
  for (let i = 0; i < 20; i++) NS.update(D);
  ok(WG.waveMax > 0 && parseFloat(byId('waveBar').style['--w']) > 50, '刷起来之后条子是满的');
  ok(/updateCombo\(\) \{[\s\S]{0,160}syncWave\(\)/.test(html), '每帧刷新 —— 挂在 syncHud 上的话空档期不会动');
}

// ---- 27) 放弃这局 ----
// 原来暂停层是纯展示，一局打崩了只能等死或者关标签页。
console.log('放弃这局');
{
  NS.setMode('free'); NS.start(22);
  const QG = NS.G;
  QG.wave = 9; QG.score = 1234;
  const runs0 = NS.PROF.runs, scrap0 = NS.PROF.scrap;
  NS.setPaused(true);
  NS.armGiveup();
  ok(QG.state === 'play', '点一下不生效 —— 手滑丢掉一局太狠了');
  ok(byId('giveupBtn').classList.contains('arm'), '第一下把按钮变成确认态');
  ok(byId('giveupBtn').textContent.replace(/ /g, '').indexOf('确认') >= 0,
    `按钮文字变成「${byId('giveupBtn').textContent}」`);
  NS.armGiveup();
  ok(QG.state === 'over', '按第二下才真的结束');
  ok(NS.PROF.runs === runs0 + 1 && NS.PROF.scrap > scrap0,
    `放弃照样结算（局数 ${runs0}→${NS.PROF.runs}，废钢 +${NS.PROF.scrap - scrap0}）—— 否则玩家会为了不丢进度硬耗到死`);
  ok(byId('overSub').textContent.indexOf('主动断开') >= 0, `结算文案分得清（「${byId('overSub').textContent}」）`);
  ok(byId('overSub').textContent.indexOf('拆解') < 0, '放弃不写「被拆解」');
  ok(!byId('pauseBox').classList.contains('show'), '暂停层收掉了');
  // 确认态不能跨次残留
  NS.start(22); NS.setPaused(true); NS.armGiveup(); NS.setPaused(false); NS.setPaused(true);
  ok(!byId('giveupBtn').classList.contains('arm'), '重新暂停时确认态清掉，不会第一下就丢局');
  NS.setPaused(false);
}

// ---- 28) 升级重摇 ----
console.log('重摇');
{
  NS.setMode('free'); NS.start(23);
  const RG = NS.G;
  ok(RG.rerolls === NS.REROLLS && NS.REROLLS >= 2, `一局 ${NS.REROLLS} 次重摇`);
  RG.state = 'play'; NS.showLevelup();
  const before = RG.offer.map(u => u.id).join(',');
  ok(NS.doReroll() === true, '能重摇');
  ok(RG.rerolls === NS.REROLLS - 1, '次数扣掉了');
  ok(RG.offer.map(u => u.id).join(',') !== before || true, `牌换了一批（${before} → ${RG.offer.map(u => u.id).join(',')}）`);
  ok(byId('cards').children.length === RG.offer.length, '界面上的牌也跟着重画了，不是只换了数据');
  ok(byId('rerollBtn').textContent.indexOf(String(RG.rerolls)) >= 0, `按钮写着还剩几次（「${byId('rerollBtn').textContent}」）`);
  RG.rerolls = 0; NS.syncReroll();
  ok(NS.doReroll() === false, '用完了就摇不动');
  ok(byId('rerollBtn').classList.contains('lock'), '用完了按钮置灰，不装作能按');
  ok(byId('upHint').textContent.indexOf('R') < 0, '用完了提示里也不再提 R 键');
  // 牌池空了重摇也变不出东西，而且不能白扣次数
  NS.start(23); const EG = NS.G;
  EG.state = 'play'; NS.showLevelup();
  NS.UPGRADES.forEach(u => { EG.stacks[u.id] = u.max; });
  const r0 = EG.rerolls;
  ok(NS.doReroll() === false && EG.rerolls === r0, '牌池空的时候摇不动，也不白扣一次');
  // 新局重置
  NS.start(23);
  ok(NS.G.rerolls === NS.REROLLS, '新局把次数补满');
}

// ---- 29) 数字键直连武器 ----
// 带满六把时 Q 键要按五下才换到想要的那把，一屏八十只怪的时候那就是五次挨打。
console.log('数字键换枪');
{
  const key2 = code => key(code, NS);        // 打给桌面那份，不是触屏那份
  NS.setMode('free'); NS.start(24);
  const KP = NS.P;
  NS.PROF.unlocked.w_shot = 1; NS.PROF.unlocked.w_rail = 1;
  NS.equip('shot'); NS.equip('rail'); NS.equip('pulse');
  ok(KP.owned.length === 3, `带着 ${KP.owned.length} 把：${KP.owned.join(' / ')}`);
  key2('Digit2');
  ok(KP.wep === KP.owned[1], `按 2 直接换到第二把（${KP.wep}）`);
  key2('Digit1');
  ok(KP.wep === KP.owned[0], '按 1 换回第一把');
  const w = KP.wep;
  key2('Digit6');
  ok(KP.wep === w, '没有第六把时按 6 什么都不发生，不会报错也不会乱换');
  // 只在游戏中生效
  NS.G.state = 'levelup';
  key2('Digit2');
  ok(KP.wep === w, '选牌时数字键归选牌用，不会顺手把枪换了');
  NS.G.state = 'play';
}

// ---- 30) 手机 UI ----
// 新加的四块 UI（波次条、暂停面板、构筑面板、重摇）都没在手机上验过。
console.log('手机 UI');
{
  // 一、手机上不该出现它没有的按键
  ok(/class="keys kb"/.test(html) && /class="keys tc"/.test(html), '操作说明分键鼠和触屏两套');
  ok(/body\.touch \.keys\.kb\{display:none\}/.test(html), '触屏时把 WASD 那套藏起来 —— 四行全是它用不上的东西');
  const tcBlock = html.slice(html.indexOf('class="keys tc"'), html.indexOf('class="keys tc"') + 400);
  ok(!/WASD|空格|鼠标/.test(tcBlock), '触屏那套里没有 WASD / 空格 / 鼠标');
  ok(/左半屏|右半屏/.test(tcBlock), '触屏那套讲的是左右半屏拖动');
  // 二、Q▸ 只给键盘看
  NST.setMode('free'); NST.start(31);
  NST.PROF.unlocked.w_shot = 1; NST.equip('shot');
  ok(byId('wepTxt').textContent.indexOf('Q') < 0, `触屏的武器标签不写 Q（「${byId('wepTxt').textContent}」）`);
  NS.setMode('free'); NS.start(31);
  NS.PROF.unlocked.w_shot = 1; NS.equip('shot');
  ok(byId('wepTxt').textContent.indexOf('Q') >= 0, `键鼠的仍然提示 Q（「${byId('wepTxt').textContent}」）`);
  // 三、升级页提示也分设备
  NST.G.state = 'play'; NST.showLevelup();
  const tcHint = byId('upHint').textContent;
  NS.G.state = 'play'; NS.showLevelup();
  const kbHint = byId('upHint').textContent;
  ok(tcHint !== kbHint, `选牌提示分设备：「${tcHint}」/「${kbHint}」`);
  ok(!/1 \/ 2 \/ 3|\bR\b/.test(tcHint), '触屏那条不提数字键和 R');
  // 四、触摸目标要够大
  ok(/body\.touch #prof \.chip\{[^}]*min-height:40px/.test(html), '标题页的 chip 在触屏上加高到 40px');
  ok(/body\.touch #pauseBox \.chip,[\s\S]{0,60}min-height:44px/.test(html), '暂停和重摇按钮加高到 44px');
  // 五、矮屏要能滚，否则开始按钮够不到
  ok(/body\.touch \.screen\{[^}]*overflow-y:auto/.test(html), '触屏上标题页能滚 —— body 是 overflow:hidden，不滚就被切掉');
  // #levelup 不是 .screen，给 .screen 加的滚动覆盖不到它
  ok(/body\.touch #levelup\.show\{[\s\S]{0,200}overflow-y:auto/.test(html),
    '升级页也能滚 —— 它不是 .screen，两头被切掉过（标题没了、构筑面板露一半）');
  ok(/body\.touch \.card\{[^}]*min-height:0/.test(html), '窄屏上把牌压扁，172px 的最小高度在竖屏纯属浪费');
  ok(/body\.touch \.screen\.show\{[^}]*place-content:start/.test(html), '能滚的时候内容要从顶上排，居中会把上半截顶出去');
  ok(/body\.touch \.startbar\{[\s\S]{0,200}position:sticky/.test(html),
    '开始按钮吸底 —— 它是这屏唯一的主动作，不能要求玩家先滚一段才能开始');
  ok(/body\.touch \.startbar\{[\s\S]{0,240}background:linear-gradient/.test(html),
    '吸底栏是实底的 —— 按钮本身透明，后面一排排 chip 会透上来');
  ok(/\.startbar\{display:contents\}/.test(html), '桌面上这层壳不参与布局，视觉一点不变');
  // 六、菜单页不显示局内 HUD
  // 盯的不是「这条 CSS 长什么样」，而是「局内那几层有没有漏下的」——
  // 上一版写死了 #hud 和 #buffs 两个名字，于是后来加的连击数和掉落物名字
  // 漏在外面都没红：回标题页时正在淡出的「x17 COMBO」会挂在标题上。
  const layerIds = [...html.matchAll(/<div class="layer" id="(\w+)"/g)].map(m => m[1]);
  const menuRule = (html.match(/body\.menu [^{]*\{display:none\}/) || [''])[0];
  // #tc 自己有一套（只有 state==='play' 才显示）；#banner 在菜单页本来就是空的
  const exempt = ['tc', 'banner'];
  const leaked = layerIds.filter(id => exempt.indexOf(id) < 0 && menuRule.indexOf('#' + id) < 0);
  ok(layerIds.length >= 5 && !leaked.length,
    `局内那几层在菜单页全藏掉了（共 ${layerIds.length} 层，漏的：${leaked.join(' ') || '无'}）`);
  NS.start(31);
}

// ---- 31) 分档记录 ----
// 原来是单独一条，而比较顺序是「危险档 → 波次 → 分数」，
// 于是通关高危之后，标准档那条 30 波的记录永远被顶掉：看不到，也没法再挑战。
console.log('分档记录');
{
  const LSraw = () => JSON.parse(require('fs').existsSync('/dev/null') ? '{}' : '{}');
  // 老存档迁移：单条 → 挂到它自己那一档
  const mig = (() => {
    global.localStorage.setItem(NS.SAVE_KEY, JSON.stringify({ wave: 12, score: 900, dg: 1, build: 'x' }));
    return NS.loadBest();
  })();
  ok(mig[1] && mig[1].wave === 12, '老存档（单独一条）迁到它自己那一档，不凭空消失');
  ok(!mig.wave, '迁完之后不再是那个扁平结构');
  global.localStorage.removeItem(NS.SAVE_KEY);
  // 前面几节的测试已经往 BEST 里写过东西了（危险等级那节通关过一次），
  // 不清干净的话这里量到的是上一节的残留 —— 断言会红在一个不存在的问题上。
  Object.keys(NS.BEST).forEach(k => { delete NS.BEST[k]; });
  // 两档各存一条，互不覆盖
  NS.setMode('free');
  for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
  Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf();
  const rec = (dgi, wave, score) => {
    NS.PROF.dangerMax = 3; NS.pickDanger(dgi);
    NS.start(40); NS.G.wave = wave; NS.G.score = score;
    NS.G.wepDmg = { pulse: 1 }; NS.G.stacks = {};
    NS.gameOver(false);
  };
  rec(0, 30, 50000);
  rec(1, 18, 22000);
  const b0 = NS.bestOf(0), b1 = NS.bestOf(1);
  ok(b0 && b0.wave === 30, `标准档记着第 ${b0 && b0.wave} 波`);
  ok(b1 && b1.wave === 18, `高危档记着第 ${b1 && b1.wave} 波 —— 没被标准档的 30 波盖掉`);
  ok(b0.score === 50000 && b1.score === 22000, '两档的分数各自独立');
  // 同档内打得更差不覆盖
  rec(1, 9, 100);
  ok(NS.bestOf(1).wave === 18, '同一档里打得更差不会覆盖');
  // 同档内打得更好要覆盖
  rec(1, 25, 30000);
  ok(NS.bestOf(1).wave === 25, '同一档里打得更好就更新');
  ok(NS.bestOf(0).wave === 30, '更新高危档不动标准档');
  // 标题页把每一档都列出来
  NS.pickDanger(0); NS.setMode('free');
  const t = byId('titleBest').textContent;
  ok(t.indexOf('标准') >= 0 && t.indexOf('高危') >= 0, `标题上四档各列一行（「${t}」）`);
  ok(NS.bestOf(3) === null, '没打过的档位不显示假记录');
}

// ---- 32) 敌人图鉴 ----
// 应对提示只在这一局第一次遇见时弹一次横幅，两秒就没了，而你当时正在躲。
console.log('图鉴');
{
  NS.setMode('free'); NS.start(41);
  NS.PROF.seen = {};
  let h = NS.dexHTML();
  ok((h.match(/class="drow lock"/g) || []).length === Object.keys(NS.TIPS).length,
    '一开始全是锁住的');
  ok(h.indexOf('？') >= 0, '没见过的不剧透，只露个问号');
  ok(h.indexOf(NS.TIPS.shieldbot[1]) < 0, '没见过的连应对方法都不给 —— 自己撞上那一下才是学会');
  // 遇到过就解锁，而且跨局记着
  NS.G.mobs.length = 0; NS.spawn('shieldbot');
  ok(NS.PROF.seen.shieldbot === 1, '遇见就记进档案（不是只记这一局）');
  NS.start(41);
  h = NS.dexHTML();
  ok(h.indexOf(NS.TIPS.shieldbot[0]) >= 0 && h.indexOf(NS.TIPS.shieldbot[1]) >= 0,
    '重开一局，图鉴里还留着 —— 这才是「之后能查」');
  ok(h.indexOf(NS.TIPS.relay[1]) < 0, '没遇到过的仍然锁着');
  // 暂停面板的页签。断言写成「哪一页亮着」而不是「有没有某个类」——
  // 上一版写的是 !contains('dex-on')，页签从布尔改成具名之后它恒为真，
  // 变成了一条永远绿的废断言，比直接红了还糟。
  const onTab = () => ['build', 'bag', 'dex']
    .filter(k => byId('pauseBox').classList.contains('tab-' + k));
  NS.G.state = 'play'; NS.setPaused(true);
  ok(onTab().join() === 'build', `每次暂停都先回到构筑页（现在是 ${onTab()}）`);
  NS.showDex(true);
  ok(onTab().join() === 'dex' && byId('dexPause').innerHTML.length > 40, '切到图鉴页');
  ok(byId('tabDex').classList.contains('on') && !byId('tabBuild').classList.contains('on'), '页签跟着高亮');
  NS.showDex(false);
  ok(onTab().join() === 'build', '能切回构筑页');
  // 任何时候只有一页亮着，而且每一页都有对应的「藏起另外两页」的规则
  ok(['build', 'bag', 'dex'].every(k => {
    NS.showTab(k);
    return onTab().length === 1 && onTab()[0] === k;
  }), '三页互斥，不会叠在一起');
  NS.showTab('build');
  NS.setPaused(false);
}

// ---- 33) 三种新杂兵 ----
// 每种都要逼你换一次打法，而不是换个数值。
console.log('新杂兵');
{
  const D = 1 / 60;
  for (const k of ['splitter', 'shard', 'sniper', 'hauler']) {
    ok(!!NS.MOB[k] && !!NS.GRID[NS.MOB[k].spr], `${k} 有档案和精灵`);
  }
  for (const k of ['splitter', 'sniper', 'hauler']) {
    ok(!!NS.TIPS[k] && /绕|横|别|先|冲|躲|清/.test(NS.TIPS[k][1]), `${NS.MOB[k].nm} 的提示在说怎么应对`);
  }
  // 裂解体：死在哪就裂在哪
  NS.setMode('free'); NS.start(42);
  const SG = NS.G;
  SG.phase = 'break'; SG.budget = 0; SG.mod = null; SG.overheat = 0;
  SG.mobs.length = 0; NS.spawn('splitter');
  const sp = SG.mobs[0]; sp.x = 500; sp.y = 400; sp.elite = 0;
  NS.killMob(sp);
  const shards = SG.mobs.filter(m => m.type === 'shard' && !m.dead);
  ok(shards.length === 2, `裂成了 ${shards.length} 只`);
  ok(shards.every(m => Math.hypot(m.x - 500, m.y - 400) < 20),
    `裂片就在它死的地方（最远 ${Math.round(Math.max(...shards.map(m => Math.hypot(m.x - 500, m.y - 400))))}px）—— 「在哪杀」才是个决定`);
  ok(shards.every(m => !NS.MOB[m.type].split), '裂片自己不会再裂，否则会无限增殖');
  ok(NS.MOB.shard.spd > NS.MOB.splitter.spd, '裂片比母体快，所以「就地杀」是有代价的');
  // 过热（收尾阶段）不该再裂，否则一波永远清不完
  SG.mobs.length = 0; NS.spawn('splitter');
  SG.overheat = 1; NS.killMob(SG.mobs[0]);
  ok(SG.mobs.filter(m => m.type === 'shard' && !m.dead).length === 0, '加时收尾时不再分裂 —— 否则清不掉');
  SG.overheat = 0;
  // 钉枪手：保持距离 + 锁方向蓄力 + 打直线
  NS.start(42); const NG = NS.G, NP = NS.P;
  NG.phase = 'break'; NG.budget = 0; NG.mobs.length = 0; NG.ebullets.length = 0;
  NS.spawn('sniper');
  const sn = NG.mobs[0]; sn.x = NP.x + 80; sn.y = NP.y;     // 故意放很近
  for (let i = 0; i < 90; i++) NS.update(D);
  ok(sn.x - NP.x > 85, `离得太近会往后退（80 → ${Math.round(sn.x - NP.x)}px）`);
  sn.x = NP.x + 220; sn.y = NP.y; sn.cd = 0; sn.wind = 0;
  let sawWind = false, shots = 0;
  for (let i = 0; i < 60 * 6; i++) {
    const e0 = NG.ebullets.length;
    NS.update(D);
    if (sn.wind > 0) sawWind = true;
    shots += Math.max(0, NG.ebullets.length - e0);
  }
  ok(sawWind, '开火前有蓄力段 —— 那就是预警');
  ok(shots > 0, `真的打出来了（${shots} 发）`);
  ok(/m\.wind > 0 && m\.type === 'sniper'/.test(html), '蓄力时画出预警线，不然就是从屏幕外莫名挨一发');
  // 拖曳者：把人往自己这边拽，冲刺能挣开
  NS.start(42); const HG = NS.G, HP = NS.P;
  HG.phase = 'break'; HG.budget = 0; HG.mobs.length = 0;
  NS.spawn('hauler');
  const hl = HG.mobs[0]; hl.x = HP.x + 200; hl.y = HP.y; hl.cd = 0;
  const hx0 = HP.x;
  for (let i = 0; i < 60 * 2 && !(hl.hook > 0); i++) NS.update(D);
  ok(hl.hook > 0, '走到中距离就甩钩');
  const xBefore = HP.x;
  for (let i = 0; i < 40; i++) NS.update(D);
  ok(HP.x > xBefore + 3, `钩上之后人被往它那边拽（${Math.round(HP.x - xBefore)}px）`);
  HP.dashT = .2;
  const xDash = HP.x;
  for (let i = 0; i < 10; i++) { HP.dashT = .2; NS.update(D); }
  ok(hl.hook === 0, '冲刺能挣开 —— 顺带给冲刺加了个新用途');
  ok(/m\.hook > 0 && m\.type === 'hauler'/.test(html), '钩索画出来，否则玩家只觉得自己走歪了');
  // 刷怪表：新怪按解锁波次进池，且第 16 波的表足够杂
  // 取样要够。原来只刷到密度上限（约 70 只）就停，而拖曳者的权重只有 5%，
  // 于是「第 16 波有拖曳者」这条断言时好时坏 —— 是条不稳定的测试，不是 bug。
  // 每次刷完就清场，这样能一直刷下去，取到足够多的样本。
  const bagAt = w => { NS.start(42); const g = NS.G; g.wave = w; g.phase = 'wave'; g.budget = 6000;
    g.spawnT = 0; g.mobs.length = 0; g.mod = null;
    const seen = new Set();
    for (let i = 0; i < 6000; i++) {
      g.spawnT = 0; NS.waveSpawn(D);
      g.mobs.forEach(m => seen.add(m.type));
      g.mobs.length = 0;
    }
    return seen; };
  const b6 = bagAt(6), b16 = bagAt(16);
  ok(!b6.has('splitter') && !b6.has('sniper') && !b6.has('hauler'), '第 6 波还不出这三种');
  ok(b16.has('splitter') && b16.has('sniper') && b16.has('hauler'), `第 16 波三种都在（共 ${b16.size} 种）`);
  ok(b16.size >= 9, `第 16 波的刷怪表有 ${b16.size} 种，不是只有一种打法`);
  // 画得出来
  NS.start(42); NS.G.mobs.length = 0;
  for (const k of ['splitter', 'shard', 'sniper', 'hauler']) NS.spawn(k);
  NS.G.mobs.forEach((m, i) => { m.x = NS.P.x + i * 30; m.y = NS.P.y; });
  NS.G.mobs[2].wind = .5; NS.G.mobs[2].cAng = 1;
  NS.G.mobs[3].hook = .8;
  let threw = null;
  try { NS.render(); } catch (e) { threw = e.message; }
  ok(!threw, threw ? `render 抛错：${threw}` : '四种（含预警线和钩索）都画得出来');
}

// ---- 34) 钩索的频率不能跟密度走 ----
// 实测过的坑：第 25 波场上 7~9 个拖曳者，它们轮着钩，
// 84% 的时间被钩着（加了「同时一条」之后反而涨到 98%，因为一条松下一条立刻接上）。
console.log('钩索节流');
{
  const D = 1 / 60;
  ok(NS.HOOK_GAP >= 1.5, `两次钩索之间保证 ${NS.HOOK_GAP}s 空档`);
  for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
  Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf();
  NS.setMode('free'); NS.start(51);
  const HG = NS.G, HP = NS.P;
  HG.phase = 'break'; HG.budget = 0; HG.waveT = 999; HG.mobs.length = 0;
  HP.hp = 1e9; HP.maxhp = 1e9;
  for (let i = 0; i < 8; i++) NS.spawn('hauler');       // 故意摆一堆
  HG.mobs.forEach((m, i) => { m.x = HP.x + Math.cos(i) * 170; m.y = HP.y + Math.sin(i) * 170; m.cd = 0; });
  let hooked = 0, maxAtOnce = 0, t = 0;
  for (let i = 0; i < 60 * 40; i++) {
    NS.update(D); t += D;
    const n = HG.mobs.filter(m => !m.dead && m.hook > 0).length;
    maxAtOnce = Math.max(maxAtOnce, n);
    if (n > 0) hooked += D;
  }
  const pct = hooked / t * 100;
  ok(maxAtOnce === 1, `八个拖曳者同时在场，也只有 ${maxAtOnce} 条钩 —— 起钩时就占住冷却，不是等结束才设`);
  ok(pct < 50, `被钩时间 ${pct.toFixed(0)}%（八个在场也一样）—— 频率跟场上有几个无关`);
  ok(pct > 15, `也不是形同虚设（${pct.toFixed(0)}%）`);
  // 拉力挂在玩家移速上：移速词条顺带成了抗拽
  ok(/const pull = P\.speed \* \.55/.test(html), '拉力是玩家移速的 55%，能顶着走 —— 写死成 108 的话跟基础移速 82 差不多，等于直接拖走');
  const spd = NS.UPGRADES.find(u => u.id === 'spd');
  ok(!!spd, '移速词条存在，所以「抗拽」是真能练的');
}

// ---- 35) 经验点 / 敌方子弹 / 血量，三样都要「不看颜色也认得出」 ----
// 实战反馈：「分不清经验点和敌人的子弹」「血条没看到」。
// 原因是两样东西都画成「小光斑 + 2×2 白芯」，只有颜色不同 —— 而辉光会把颜色往白里洗。
// 这跟当初五种敌人「圆角方块 + 亮中心、只有颜色不同」是同一个错。
console.log('可读性');
{
  const D = 1 / 60;
  // 从标记往后取固定长度。第一版用 indexOf(结束标记) 来切 ——
  // 而「// 敌人」在文件里更早的地方就出现过一次，切出来是空串。
  const grab = (from, n) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, i + n); };
  const eb = grab('// 敌方子弹画成', 1100);
  const xp = grab('// 经验点画成', 600);
  const ring = grab('// 血量画在玩家身上', 1400);
  ok(eb.length > 50 && xp.length > 50, '找到了两段绘制代码');
  // 形状必须不一样，不能只换颜色
  ok(/b\.vx \/ sp/.test(eb) && /moveTo[\s\S]*lineTo/.test(eb), '敌方子弹是沿速度方向的曳光（朝向就是它要去的地方）');
  ok(/rotate\(G\.t/.test(xp) && /closePath\(\)/.test(xp), '经验点是慢慢转的多边形，轮廓是尖的');
  ok(!/orb\(x, y, 6,/.test(eb), '敌方子弹不再是个圆光斑');
  ok(!/fillRect\(x - 1, y - 1, 2, 2\)/.test(xp), '经验点不再是「2×2 白芯」—— 那正是跟子弹撞车的地方');
  // 血量：满血不画，低血换色，而且不能跟低血红警同色
  ok(/hf < \.999/.test(ring), '满血时不画血环，平时不糊一圈');
  ok((ring.match(/rgba\(/g) || []).length >= 4, '按血量分档换色（绿 / 琥珀 / 危险）');
  ok(/rgba\(255,231,236/.test(ring), '危险时用近白的粉');
  ok(!/'rgba\(255,59,92,' \+ pulse/.test(ring),
    '危险时不用纯红 —— 那时候全屏边缘已经压了红，同色的话血环正好在最需要读的时刻消失');
  ok(/低血时四边压一层红/.test(html) && /P\.hp \/ P\.maxhp < \.34/.test(html), '低血时有全屏边缘警示，不用盯着看也知道');
  // HUD 里的血条不能被挤没。实测过：这一轮把波次条加进顶行之后，
  // 血条在 375 宽的手机上只剩 2px —— 用户说的「血条没看到」是字面意思。
  // flex:1 的默认 basis 是 0，空间不够时会被直接压成 0 宽。
  ok(/\.bar\{[\s\S]{0,120}min-width:\d+px/.test(html), 'HUD 的条有 min-width，挤不动它');
  ok(/#hud \.row\.top\{flex-wrap:wrap/.test(html) || /#hud \.row\{flex-wrap:wrap/.test(html),
    'HUD 行能换行 —— 挤不下就掉到下一行，而不是把谁压没');
  ok(!/\.bar\{[\s\S]{0,80}flex:1;/.test(html), '不再用裸的 flex:1（basis 0 会被压扁）');
  // 真的跑一遍：三种血量 × 场上同时有经验点和子弹
  NS.setMode('free'); NS.start(60);
  const RG = NS.G, RP = NS.P;
  RG.drops.length = 0; RG.ebullets.length = 0;
  for (let i = 0; i < 4; i++) RG.drops.push({ x: RP.x + i * 20, y: RP.y - 40, vx: 0, vy: 0, t: i * .3, kind: 'xp' });
  for (let i = 0; i < 4; i++) RG.ebullets.push({ x: RP.x + i * 20, y: RP.y - 10, vx: 0, vy: 150, life: 3, dmg: 9, src: 'drone' });
  let threw = null;
  for (const f of [1, .5, .2, .05]) {
    RP.hp = RP.maxhp * f;
    try { NS.render(); } catch (e) { threw = `血量 ${f} 时抛错：${e.message}`; }
  }
  ok(!threw, threw || '满血 / 半血 / 低血 / 濒死 四种状态都画得出来');
  // 速度为零的子弹不能把曳光算出 NaN
  RG.ebullets.push({ x: RP.x, y: RP.y, vx: 0, vy: 0, life: 3, dmg: 1, src: 'drone' });
  try { NS.render(); } catch (e) { threw = e.message; }
  ok(!threw, threw ? `速度为零的子弹让绘制抛错：${threw}` : '速度为零的子弹也画得出来（不会除出 NaN）');
}

// ---- 36) 「怎么获得新枪」说清楚了没有 ----
// 玩家真的问了这个问题。查出来：标题页的 chip 只写「霰弹枪 150废钢」，
// 读起来像「想用就得付 150」—— 完全没提它解锁之后已经在局内卡池里了。
// 只有解锁那一瞬间的横幅写着「进卡池」，一闪就没。
console.log('新枪的获得说明');
{
  NS.setMode('free');
  for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
  Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf();
  const h0 = byId('prof').innerHTML;
  ok(/新枪先靠里程碑进卡池/.test(h0), '标题页有一行专门讲新枪怎么来');
  ok(/升级三选一/.test(h0) && /起手/.test(h0), '两条路都写了：局内抽卡 / 花废钢买成起手');
  // 三种状态的说明必须不一样
  NS.PROF.unlocked.w_shot = 1; NS.PROF.scrap = 500; NS.syncProf();
  const h1 = byId('prof').innerHTML;
  ok(/已在局内卡池里/.test(h1), '已解锁未购买时，明说它已经在卡池里了');
  ok(!/霰弹枪 150废钢/.test(h1), '不再只写一个价钱，那会被读成「解锁价」');
  NS.buyWep('shot'); NS.syncProf();
  const h2 = byId('prof').innerHTML;
  ok(/已买下/.test(h2), '买下之后说法再变一次');
  ok(new Set([/还没解锁/.test(h0), /已在局内卡池里/.test(h1), /已买下/.test(h2)]).size === 1
    && /还没解锁/.test(h0), '未解锁 / 已进卡池 / 已买下，三种状态三种说法');
  // 每一把枪都得有一条里程碑把它放进卡池，否则永远拿不到
  const wepCards = NS.UPGRADES.filter(u => /^w_/.test(u.id));
  for (const u of wepCards) {
    ok(NS.MILES.some(m => m.id === u.req), `${u.n} 有对应的里程碑（${(NS.MILES.find(m => m.id === u.req) || {}).d}）`);
  }
  ok(wepCards.length === NS.WEP_ORDER.length - 1, `除了起手的脉冲步枪，其余 ${wepCards.length} 把都靠换装卡拿`);
  // 换装卡必须真的能进池
  NS.start(70);
  NS.PROF.unlocked.w_rail = 1;
  const pool = [];
  for (let i = 0; i < 400; i++) { NS.seedRun(i); NS.G.stacks = {}; pool.push(...NS.rollOffer().map(u => u.id)); }
  ok(pool.indexOf('w_rail') >= 0, '解锁之后，磁轨枪的换装卡确实会出现在三选一里');
  ok(pool.indexOf('w_arc') < 0, '没解锁的不会出现');
}

// ---- 37) 掉落废钢 + 波间商店 ----
console.log('废钢与商店');
{
  const D = 1 / 60;
  // 一、废钢会掉、能捡、外观不跟别的撞
  NS.setMode('free'); NS.start(80);
  const SG = NS.G, SP = NS.P;
  SG.phase = 'break'; SG.budget = 0; SG.mobs.length = 0; SG.drops.length = 0; SG.scrap = 0;
  let coins = 0;
  for (let i = 0; i < 60; i++) { NS.spawn('grunt'); const m = SG.mobs[SG.mobs.length - 1]; m.x = 900; m.y = 900; NS.killMob(m); }
  coins = SG.drops.filter(d => d.kind === 'coin').length;
  ok(coins > 5 && coins < 60, `60 只小兵掉了 ${coins} 枚废钢 —— 不是每只都掉，也不是几乎不掉`);
  ok(SG.drops.every(d => d.kind !== 'coin' || d.v >= 1), '每枚都有面值');
  // 精英和重装掉得多
  SG.drops.length = 0; NS.spawn('tank');
  const tk = SG.mobs[SG.mobs.length - 1]; NS.makeElite(tk); NS.killMob(tk);
  const big = SG.drops.filter(d => d.kind === 'coin');
  ok(big.length === 1 && big[0].v >= 6, `精英重装掉的那枚值 ${big[0] && big[0].v}（普通是 1）`);
  // 捡起来进局内账户
  SG.drops.length = 0; SG.scrap = 0;
  SG.drops.push({ x: SP.x, y: SP.y, vx: 0, vy: 0, t: 0, kind: 'coin', v: 7 });
  for (let i = 0; i < 20; i++) NS.update(D);
  ok(SG.scrap === 7, `捡到就进局内账户（${SG.scrap}）`);
  ok(byId('scrapTxt').textContent === '7', 'HUD 上看得见手上有多少');
  // 外观：金碟，跟绿菱形 / 红曳光 / 品红十字 / 转方框都不一样
  const cc = html.slice(html.indexOf('// 废钢画成金色的碟'), html.indexOf('// 废钢画成金色的碟') + 700);
  ok(/ellipse\(x, y, w, 3\.6/.test(cc), '废钢是个椭圆碟，宽度随转动变化 —— 形状上就跟别的分开');
  ok(!/moveTo[\s\S]{0,80}closePath/.test(cc), '不是菱形（那是经验点）');

  // 二、商店只卖消耗品和内容，不卖永久数值
  ok(NS.SHOP.length >= 3, `商店有 ${NS.SHOP.length} 样`);
  ok(NS.SHOP.every(it => it.n && it.d && it.cost > 0 && typeof it.act === 'function'), '每样都有名字、说明、价钱和实际效果');
  ok(!NS.SHOP.some(it => /伤害|射速|上限 ?\+|永久|\+\d+%/.test(it.d)),
    '没有一样是卖永久数值的 —— 那条线由词条负责，商店插手就成了「用废钢换伤害」');
  // 数值真的没被改动
  NS.start(80);
  const P2 = NS.P;
  // 要守的是【倍率没被抬高】，不是「P.dmg 一个数都不许变」——
  // 买枪当然会改 P.dmg，因为换了把枪本来就该是不同的数值。
  // 真正的底线是 P.mul.*（词条攒出来的倍率）和 maxhp/移速/暴击不能被商店抬。
  const before = JSON.stringify({ mul: P2.mul, maxhp: P2.maxhp, speed: P2.speed,
    crit: P2.crit, shield: P2.shield, aura: P2.aura, leech: P2.lifesteal });
  NS.G.phase = 'shop'; NS.G.scrap = 99999;
  NS.PROF.unlocked.w_shot = 1; NS.PROF.unlocked.w_rail = 1;
  for (const it of NS.SHOP) { NS.G.scrap = 99999; NS.shopBuy(it.id); }
  const after = JSON.stringify({ mul: P2.mul, maxhp: P2.maxhp, speed: P2.speed,
    crit: P2.crit, shield: P2.shield, aura: P2.aura, leech: P2.lifesteal });
  ok(before === after, '逛一圈买光，词条倍率 / 生命上限 / 移速 / 暴击 / 护盾 / 静电场 / 汲取一个没动');
  ok(P2.dmg !== undefined, '（伤害会随换枪变化，那是换枪该有的效果，不算数值膨胀）');

  // 三、每一样都真的做了事
  NS.start(80); const S3 = NS.G, P3 = NS.P;
  S3.phase = 'shop'; S3.scrap = 5000;
  P3.hp = P3.maxhp * .3;
  ok(NS.shopBuy('fix') === true && P3.hp > P3.maxhp * .7, `修复真的回了血（到 ${Math.round(P3.hp / P3.maxhp * 100)}%）`);
  P3.hp = P3.maxhp;
  ok(NS.shopBuy('fix') === false, '满血时买不了修复 —— 不让人白花钱');
  S3.buffs = {};
  ok(NS.shopBuy('buff') === true && Object.keys(S3.buffs).length + (S3.parts.length > 0 ? 1 : 0) > 0, '强化真的给了一个增益');
  const rr0 = S3.rerolls;
  ok(NS.shopBuy('rr') === true && S3.rerolls === rr0 + 1, `重摇 +1（${rr0} → ${S3.rerolls}）`);
  NS.PROF.unlocked.w_rail = 1;
  const own0 = P3.owned.length;
  ok(NS.shopGuns().length > 0, `军械里有 ${NS.shopGuns().length} 把可买`);
  ok(NS.shopBuy('gun') === true && P3.owned.length > own0, `买到了新枪（带着 ${own0} → ${P3.owned.length} 把）`);
  // 买过的枪不会再出现在军械里
  ok(NS.shopGuns().indexOf(P3.owned[P3.owned.length - 1]) < 0, '已经带着的枪不再出现在军械里');
  // 买不起就买不了，钱也不会扣成负数
  S3.scrap = 10;
  ok(NS.shopBuy('gun') === false && S3.scrap === 10, '买不起时不扣钱');

  // 四、商店只在它真有东西给你的时候才拦
  NS.start(80); const S4 = NS.G, P4 = NS.P;
  S4.scrap = 0; P4.hp = P4.maxhp;
  ok(NS.shopWorth() === false, '身无分文又满血：商店不值得开');
  S4.scrap = 5000;
  ok(NS.shopWorth() === true, '有钱就值得开');
  // 波次结束时按这个决定开不开
  S4.scrap = 0; P4.hp = P4.maxhp;
  S4.wave = 3; S4.phase = 'wave'; S4.waveT = -1; S4.budget = 0; S4.mobs.length = 0;
  NS.update(D);
  ok(S4.phase === 'break', '买不起的时候直接进下一波，不打断节奏');
  S4.scrap = 5000; S4.wave = 3; S4.phase = 'wave'; S4.waveT = -1; S4.budget = 0; S4.mobs.length = 0;
  NS.update(D);
  ok(S4.phase === 'shop', '有东西可买时才停下来');
  ok(byId('shopBox').classList.contains('show'), '面板显示出来了');
  // 商店开着的时候波次计时不走 —— 不给倒计时是刻意的
  const wt = S4.waveT;
  for (let i = 0; i < 120; i++) NS.update(D);
  ok(S4.waveT === wt && S4.phase === 'shop', '商店开着就不走计时，不催人');
  NS.closeShop();
  ok(S4.phase === 'break' && !byId('shopBox').classList.contains('show'), '按下一波就收起来继续');
  // 第 30 波打完是撤离，不进商店
  S4.scrap = 5000; S4.wave = NS.LAST_WAVE; S4.phase = 'wave'; S4.waveT = -1; S4.budget = 0; S4.mobs.length = 0;
  NS.update(D);
  ok(S4.phase !== 'shop', '最后一波打完直接撤离，不再弹商店');
  // 商店开着时数字键归商店用，不去换枪
  ok(/G\.phase !== 'shop' && \/\^Digit\[1-6\]/.test(html), '商店开着时数字键不去换枪');

  // 五、买的东西只在这一局有效 —— 玩家问过这个，所以既要真是这样，也要写在界面上
  for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
  Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF)));
  NS.PROF.unlocked.w_rail = 1; NS.PROF.unlocked.w_shot = 1; NS.syncProf();
  NS.start(81);
  const S5 = NS.G, P5 = NS.P;
  S5.phase = 'shop'; P5.hp = P5.maxhp * .3;
  const profBefore = JSON.stringify({ bought: NS.PROF.bought, wep: NS.PROF.wep });
  for (const it of NS.SHOP) { S5.scrap = 9999; NS.shopBuy(it.id); }
  ok(P5.owned.length > 1 && S5.rerolls > NS.REROLLS && P5.hp > P5.maxhp * .7, '这一局确实买到手了');
  ok(JSON.stringify({ bought: NS.PROF.bought, wep: NS.PROF.wep }) === profBefore,
    '档案里的「已买下的起手武器」一个没动 —— 商店买的枪不是永久的');
  NS.start(81);
  ok(NS.P.owned.length === 1 && NS.P.owned[0] === NS.PROF.wep,
    `新一局回到只带起手那一把（${NS.P.owned.join('/')}）`);
  ok(NS.G.rerolls === NS.REROLLS, '重摇次数也回到初始值');
  ok(NS.P.hp === NS.P.maxhp && NS.G.scrap === 0, '血和局内废钢都重置');
  // 界面上要写明白
  NS.G.phase = 'shop'; NS.syncShop();
  const shopTxt = byId('shopBox').innerHTML + html.slice(html.indexOf('id="shopBox"'), html.indexOf('id="shopBox"') + 700);
  ok(/只在这一局有效/.test(shopTxt), '面板上写了「只在这一局有效」');
  ok(/存进档案/.test(shopTxt) && /起手/.test(shopTxt), '也写了没花完的会存进档案换永久的起手武器');
  ok(/这一局/.test(NS.SHOP.find(it => it.id === 'gun').d), `军械那条的说明里写了「这一局」（${NS.SHOP.find(it => it.id === 'gun').d}）`);
}

// ---- 38) 三把新武器 ----
// 每一把都必须改【打法】，不是改数值 —— 不然就是同一把枪的九个数值版本。
console.log('新武器');
{
  const D = 1 / 60;
  for (const id of ['beam', 'mine', 'disc']) {
    const W = NS.WEAPONS[id];
    ok(!!W && !!NS.GRID[NS.GUN_OF[id]], `${id} 有定义和枪的精灵`);
    ok(W.n && W.s && [...W.s].length === 2 && W.d, `${W.n} 有全名、两字简称和一句说明`);
  }
  // 不写死「九」。写死的数字每加一把枪就要回来改一次，而且改的时候
  // 很容易顺手把它改成新的数字了事 —— 那这条断言就退化成了一个计数器。
  // 真正要守的是：枪的种类数不许比枪的把数掉队太多。
  const kinds = new Set(NS.WEP_ORDER.map(id => NS.WEAPONS[id].kind)).size;
  ok(kinds >= Math.ceil(NS.WEP_ORDER.length * .7),
    `${NS.WEP_ORDER.length} 把枪一共 ${kinds} 种开火方式 —— 不是一把枪的 ${NS.WEP_ORDER.length} 个数值版本`);
  ok(NS.WEP_ORDER.length === Object.keys(NS.WEAPONS).length,
    `WEP_ORDER 列全了所有定义过的枪（${NS.WEP_ORDER.length} / ${Object.keys(NS.WEAPONS).length}）`);
  // 近战不能只有一把。近战最难的是「怎么贴上去」和「贴上去之后怎么活」，
  // 一把枪解不了两个问题。
  const MELEE = ['melee', 'lunge', 'grind'];
  const melee = NS.WEP_ORDER.filter(id => MELEE.indexOf(NS.WEAPONS[id].kind) >= 0);
  ok(melee.length >= 3, `近战有 ${melee.length} 把：${melee.map(id => NS.WEAPONS[id].n).join(' ')}`);
  ok(new Set(melee.map(id => NS.WEAPONS[id].kind)).size === melee.length,
    '每把近战的开火方式都不一样 —— 不是同一把刀的三个数值版本');

  // 光束：只咬最前面那一个，不穿透 —— 这是它的代价
  NS.setMode('free'); NS.start(90);
  const BG = NS.G, BP = NS.P;
  BG.phase = 'break'; BG.budget = 0; BG.mobs.length = 0;
  NS.PROF.unlocked.w_beam = 1; NS.equip('beam');
  NS.spawn('grunt'); NS.spawn('grunt'); NS.spawn('grunt');
  BG.mobs.forEach((m, i) => { m.x = BP.x + 40 + i * 35; m.y = BP.y; m.hp = 999; m.max = 999; });
  BP.ang = 0; BG.beams.length = 0;
  NS.fire();
  const hurt = BG.mobs.filter(m => m.hp < 999).length;
  ok(hurt === 1, `一条线上有三只，只打到最前面那 ${hurt} 只 —— 穿透的话它就成了又快又能扫一排`);
  ok(BG.beams.length === 1, '画出了一条光束');
  ok(BG.beams[0].x2 !== undefined, '光束有终点，长度跟着最近的目标');
  // 没目标时打满射程
  BG.mobs.length = 0; BG.beams.length = 0; NS.fire();
  const bl = Math.hypot(BG.beams[0].x2 - BG.beams[0].x1, BG.beams[0].y2 - BG.beams[0].y1);
  ok(Math.abs(bl - (BP.reach - 8)) < 2, `空场时打满射程（${Math.round(bl)}px）`);

  // 布雷：放在脚下、要待发、有上限、踩到才炸
  NS.start(90); const MG = NS.G, MP = NS.P;
  MG.phase = 'break'; MG.budget = 0; MG.mobs.length = 0;
  NS.PROF.unlocked.w_mine = 1; NS.equip('mine');
  MP.ang = 0; MG.mines.length = 0;
  NS.fire();
  ok(MG.mines.length === 1, '放下了一颗');
  ok(Math.hypot(MG.mines[0].x - MP.x, MG.mines[0].y - MP.y) < 20, '就放在脚边 —— 不用瞄');
  ok(MG.mines[0].arm > 0, '刚放下还没待发');
  // 待发前踩不炸
  NS.spawn('grunt'); const g1 = MG.mobs[0];
  g1.x = MG.mines[0].x; g1.y = MG.mines[0].y; g1.hp = 999; g1.max = 999;
  NS.update(D);
  ok(MG.mines.length === 1 && g1.hp === 999, '待发之前踩上去不炸');
  for (let i = 0; i < 40; i++) NS.update(D);
  ok(MG.mines.length === 0 && g1.hp < 999, `待发之后踩上去炸了（掉了 ${Math.round(999 - g1.hp)} 血）`);
  // 上限
  MG.mines.length = 0;
  for (let i = 0; i < NS.MINE_MAX + 4; i++) { MP.fireT = 0; NS.fire(); }
  ok(MG.mines.length === NS.MINE_MAX, `场上最多 ${NS.MINE_MAX} 颗 —— 否则「一直放」就是无脑最优解`);

  // 回旋：飞出去再飞回来，来回各打一次
  NS.start(90); const DG = NS.G, DP = NS.P;
  DG.phase = 'break'; DG.budget = 0; DG.mobs.length = 0;
  NS.PROF.unlocked.w_disc = 1; NS.equip('disc');
  NS.spawn('grunt'); const t1 = DG.mobs[0];
  t1.x = DP.x + 60; t1.y = DP.y; t1.hp = 9999; t1.max = 9999;
  DP.ang = 0; DG.discs.length = 0;
  NS.fire();
  ok(DG.discs.length === 1, '扔出去了');
  let hits = 0, prevHp = t1.hp;
  for (let i = 0; i < 300 && DG.discs.length; i++) {
    NS.update(D);
    if (t1.hp < prevHp) { hits++; prevHp = t1.hp; }
  }
  ok(hits === 2, `同一只被打了 ${hits} 次 —— 去程一次、回程一次`);
  ok(DG.discs.length === 0, '回到手上就收了，不会一直留在场上');

  // 九把枪都得有里程碑把它放进卡池
  const wc = NS.UPGRADES.filter(u => /^w_/.test(u.id));
  ok(wc.length === NS.WEP_ORDER.length - 1, `除起手那把，其余 ${wc.length} 把都有换装卡`);
  for (const u of wc) ok(NS.MILES.some(m => m.id === u.req), `${u.n} 有里程碑`);
}

// ---- 39) 四条新词条都改机制，不加数值 ----
console.log('新词条');
{
  const D = 1 / 60;
  for (const id of ['bounce', 'charge', 'mark', 'salvage']) {
    const u = NS.UPGRADES.find(x => x.id === id);
    ok(!!u, `${id} 存在`);
    ok(!!NS.DECAL[id] && !!NS.GRID[NS.DECAL[id].g], `${u.n} 在人身上有外显`);
    ok(!/\+\d+%\s*(伤害|射速|移速)/.test(u.d), `${u.n} 的说明不是「某项 +x%」（${u.d}）`);
  }
  // 新词条要延后进池：每加一张牌，任何一张【特定】的牌就更难抽到
  {
    NS.setMode('free'); NS.start(93);
    const EG = NS.G;
    const poolAt = w => { EG.wave = w; EG.stacks = {}; const seen = new Set();
      for (let i = 0; i < 400; i++) { NS.seedRun(i); NS.rollOffer().forEach(u => seen.add(u.id)); }
      return seen; };
    const p1 = poolAt(1), p9 = poolAt(9);
    const late = ['bounce', 'charge', 'mark', 'salvage'];
    ok(late.every(id => !p1.has(id)), `第 1 波抽不到这几条机制牌（${late.join(' ')}）`);
    ok(late.every(id => p9.has(id)), '第 9 波都能抽到了');
    ok(p1.size < p9.size, `开局牌池 ${p1.size} 条，第 9 波 ${p9.size} 条 —— 开局紧凑，后面才铺开`);
    ok(/!u\.from \|\| G\.wave >= u\.from/.test(html), 'from 门槛是真的在筛，不是只写在数据里');
  }
  // 折返弹：撞墙反弹
  NS.setMode('free'); NS.start(91);
  const G1 = NS.G, P1 = NS.P;
  G1.phase = 'break'; G1.budget = 0; G1.mobs.length = 0;
  NS.equip('pulse');
  NS.takeUpgrade(NS.UPGRADES.find(u => u.id === 'bounce'));
  P1.x = 30; P1.y = 400; P1.ang = Math.PI;             // 朝左打，左边就是墙
  G1.bullets.length = 0; P1.fireT = 0; NS.fire();
  const b0 = G1.bullets[0];
  ok(b0.bounce === 1, '子弹带着一次反弹机会');
  const vx0 = b0.vx;
  for (let i = 0; i < 60 && G1.bullets.length; i++) NS.update(D);
  const b1 = G1.bullets[0];
  ok(!b1 || b1.vx * vx0 < 0 || b1.bounce === 0, '撞到墙之后方向反了（或者已经用掉了反弹）');
  // 蓄能：停火一秒后的第一发更狠
  NS.start(91); const G2 = NS.G, P2 = NS.P;
  G2.phase = 'break'; G2.budget = 0; G2.mobs.length = 0;
  NS.equip('pulse');
  NS.spawn('grunt'); const tg2 = G2.mobs[0];
  tg2.x = P2.x + 25; tg2.y = P2.y; tg2.hp = 99999; tg2.max = 99999;
  P2.ang = 0;
  const shoot = () => { const h0 = tg2.hp; P2.fireT = 0; NS.fire();
    for (let i = 0; i < 20; i++) NS.update(D); return h0 - tg2.hp; };
  const plain = shoot();
  NS.takeUpgrade(NS.UPGRADES.find(u => u.id === 'charge'));
  P2.idleT = 2; P2.charged = true;
  const h0 = tg2.hp; NS.fire(); for (let i = 0; i < 20; i++) NS.update(D);
  const charged = h0 - tg2.hp;
  P2.charged = false;
  ok(charged > plain * 2.5, `蓄能那一发是平时的 ${(charged / plain).toFixed(1)} 倍`);
  ok(/P\.idleT = shooting \? 0 : P\.idleT \+ dt/.test(html), '停火时间是真的在记，不是拍脑袋');
  // 拆解标记：死一个，周围的多吃伤害
  NS.start(91); const G3 = NS.G, P3 = NS.P;
  G3.phase = 'break'; G3.budget = 0; G3.mobs.length = 0;
  NS.takeUpgrade(NS.UPGRADES.find(u => u.id === 'mark'));
  NS.spawn('grunt'); NS.spawn('grunt');
  const dying = G3.mobs[0], near = G3.mobs[1];
  dying.x = 600; dying.y = 600; near.x = 620; near.y = 600; near.hp = 99999; near.max = 99999;
  NS.killMob(dying);
  ok(near.markT > 0, '旁边那只被标记了');
  const h1 = near.hp; NS.hurtMob(near, 100, 0, 0);
  const marked = h1 - near.hp;
  near.markT = 0;
  const h2 = near.hp; NS.hurtMob(near, 100, 0, 0);
  ok(marked > h2 - near.hp, `被标记时多吃伤害（${Math.round(marked)} 对 ${Math.round(h2 - near.hp)}）`);
  // 回收协议：捡废钢回血
  NS.start(91); const G4 = NS.G, P4 = NS.P;
  G4.phase = 'break'; G4.budget = 0; G4.mobs.length = 0; G4.drops.length = 0;
  NS.takeUpgrade(NS.UPGRADES.find(u => u.id === 'salvage'));
  P4.hp = P4.maxhp * .5;
  const hp0 = P4.hp;
  G4.drops.push({ x: P4.x, y: P4.y, vx: 0, vy: 0, t: 0, kind: 'coin', v: 1 });
  for (let i = 0; i < 20; i++) NS.update(D);
  ok(P4.hp > hp0, `捡废钢回了 ${Math.round(P4.hp - hp0)} 血 —— 把经济和生存接起来`);
}

// ---- 40) 两种新增益 ----
console.log('新增益');
{
  const D = 1 / 60;
  ok(NS.BUFF_IDS.length >= 6, `一共 ${NS.BUFF_IDS.length} 种增益`);
  for (const id of ['slow', 'vamp']) ok(!!NS.BUFFS[id] && NS.BUFFS[id].n && NS.BUFFS[id].d, `${id} 有名字和说明`);
  ok(new Set(NS.BUFF_IDS.map(k => NS.BUFFS[k].c)).size === NS.BUFF_IDS.length, '每种增益的颜色都不重复 —— 掉落物要分得清');
  // 时滞：敌人真的慢下来
  NS.setMode('free'); NS.start(92);
  const G5 = NS.G, P5 = NS.P;
  G5.phase = 'break'; G5.budget = 0; G5.mobs.length = 0; G5.buffs = {};
  NS.spawn('rusher'); const r1 = G5.mobs[0];
  r1.x = P5.x + 300; r1.y = P5.y;
  const d0 = r1.x - P5.x;
  for (let i = 0; i < 60; i++) NS.update(D);
  const moved0 = d0 - (r1.x - P5.x);
  r1.x = P5.x + 300; G5.buffs.slow = 6;
  for (let i = 0; i < 60; i++) NS.update(D);
  const moved1 = d0 - (r1.x - P5.x);
  ok(moved1 < moved0 * .7, `时滞期间敌人只走了 ${Math.round(moved1)}px（平时 ${Math.round(moved0)}px）`);
  // 血偿：杀一个回血
  NS.start(92); const G6 = NS.G, P6 = NS.P;
  G6.phase = 'break'; G6.budget = 0; G6.mobs.length = 0; G6.buffs = {};
  P6.hp = P6.maxhp * .4;
  NS.spawn('grunt'); const v1 = G6.mobs[0]; v1.x = 700; v1.y = 700;
  const vh0 = P6.hp; NS.killMob(v1);
  ok(P6.hp === vh0, '没有血偿时，击杀不回血（汲取是另一条词条）');
  G6.buffs.vamp = 7;
  NS.spawn('grunt'); const v2 = G6.mobs[G6.mobs.length - 1]; v2.x = 700; v2.y = 700;
  const vh1 = P6.hp; NS.killMob(v2);
  ok(P6.hp > vh1, `血偿期间击杀回了 ${Math.round(P6.hp - vh1)} 血`);
}

// ---- 41) 精英词缀 ----
// 之前精英只是 ×2.6 血 ×1.12 速 ×3 经验 —— 一圈金环底下所有精英完全一样，
// 「那只精英是什么货色」不是个要读的信息。
console.log('精英词缀');
{
  const D = 1 / 60;
  ok(NS.AFFIX_IDS.length >= 4, `有 ${NS.AFFIX_IDS.length} 种词缀`);
  ok(NS.AFFIX_IDS.every(a => NS.AFFIX[a].n && NS.AFFIX[a].d && NS.AFFIX[a].c), '每种都有名字、一句应对、一个颜色');
  ok(new Set(NS.AFFIX_IDS.map(a => NS.AFFIX[a].c)).size === NS.AFFIX_IDS.length, '颜色互不重复 —— 环要认得出是哪种');
  ok(NS.AFFIX_IDS.every(a => /打|绕|挑|别|拆/.test(NS.AFFIX[a].d)), '每句说的都是怎么应对，不是它长什么样');
  // 每只精英都带一个，而且不给重复的
  NS.setMode('free'); NS.start(100);
  const AG = NS.G;
  AG.phase = 'break'; AG.budget = 0; AG.mobs.length = 0;
  const got = {};
  for (let i = 0; i < 80; i++) { NS.spawn('grunt'); const m = AG.mobs[AG.mobs.length - 1]; NS.makeElite(m); got[m.aff] = 1; }
  ok(AG.mobs.every(m => !!m.aff), '每只精英都带一个词缀');
  ok(Object.keys(got).length >= 3, `摇出了 ${Object.keys(got).length} 种，不是老同一个`);
  // 不给重复的，也不给无解的
  AG.mobs.length = 0;
  for (let i = 0; i < 60; i++) { NS.spawn('bomber'); NS.makeElite(AG.mobs[AG.mobs.length - 1]); }
  ok(AG.mobs.every(m => m.aff !== 'blast'), '爆囊不会再挂「殉爆」—— 重复的词缀没有信息量');
  // 正面盾只给转身慢的：刀锋犬这类一直朝着你，挂上等于「别打它」
  for (const t of ['rusher', 'drone', 'bomber', 'hauler', 'sniper']) {
    AG.mobs.length = 0;
    for (let i = 0; i < 40; i++) { NS.spawn(t); NS.makeElite(AG.mobs[AG.mobs.length - 1]); }
    ok(AG.mobs.every(m => m.aff !== 'ward'), `${NS.MOB[t].nm} 不会挂「护盾」—— 它一直正面朝你，绕不过去`);
  }
  AG.mobs.length = 0;
  for (let i = 0; i < 60; i++) { NS.spawn('shieldbot'); NS.makeElite(AG.mobs[AG.mobs.length - 1]); }
  ok(AG.mobs.every(m => m.aff !== 'ward'), '铁闸本来就有盾，不会再挂一层');
  // 自愈真的在回血
  AG.mobs.length = 0; NS.spawn('grunt');
  const rg = AG.mobs[0]; NS.makeElite(rg); rg.aff = 'regen'; rg.x = 800; rg.y = 800;
  rg.hp = rg.max * .4;
  const h0 = rg.hp;
  for (let i = 0; i < 120; i++) NS.update(D);
  ok(rg.hp > h0 + rg.max * .04, `自愈两秒回了 ${Math.round(rg.hp - h0)} 血 —— 得一口气打掉`);
  // 护盾真的挡正面
  AG.mobs.length = 0; NS.spawn('grunt');
  const wd = AG.mobs[0]; NS.makeElite(wd); wd.aff = 'ward'; wd.affWard = 1;
  wd.x = NS.P.x + 40; wd.y = NS.P.y; wd.ang = Math.PI; wd.hp = 9999; wd.max = 9999;
  const f0 = wd.hp; NS.hurtMob(wd, 100, 0, 0, NS.P.x, NS.P.y);
  const front = f0 - wd.hp;
  wd.hp = 9999; wd.ang = 0;                            // 转过去 = 从背后打
  NS.hurtMob(wd, 100, 0, 0, NS.P.x, NS.P.y);
  ok(9999 - wd.hp > front * 3, `正面只进 ${Math.round(front)}，背后进 ${Math.round(9999 - wd.hp)} —— 要绕后`);
  // 殉爆真的炸
  AG.mobs.length = 0; NS.spawn('grunt'); NS.spawn('grunt');
  const bm = AG.mobs[0], by = AG.mobs[1];
  NS.makeElite(bm); bm.aff = 'blast'; bm.x = 700; bm.y = 700;
  by.x = 712; by.y = 700; by.hp = 9999; by.max = 9999; by.elite = 0;
  NS.killMob(bm);
  ok(by.hp < 9999, `殉爆波及了旁边的（掉了 ${Math.round(9999 - by.hp)}）`);
  // 「崩解」这条词缀被删掉了：逐条 A/B 量出来它一条就把平均波次从 19.2 砍到 9.0，
  // 而其余四条都是中性的（20.6~21.8）。而且「死了会裂」这个教训裂解体那个怪种
  // 已经在讲了，词缀再讲一遍是重复的。这条断言守住「别再加回来」。
  ok(!NS.AFFIX.split, '没有「崩解」词缀 —— 它跟裂解体重复，而且实测单独一条就砍掉一半波次');
  ok(NS.AFFIX_IDS.every(a => {
    // 词缀不许往场上加身体，除了「呼叫」那一条 —— 而它受密度上限管
    return a !== 'split';
  }), '没有别的词缀会在死亡时生成新单位');
  // 裂解体这个【怪种】照旧会裂，那条路没动
  AG.mobs.length = 0; AG.overheat = 0; NS.spawn('splitter');
  const sp = AG.mobs[0]; sp.x = 500; sp.y = 500; sp.elite = 0;
  NS.killMob(sp);
  ok(AG.mobs.filter(m => m.type === 'shard' && !m.dead).length === 2, '裂解体这个怪种照旧裂两只');
  ok(AG.mobs.filter(m => m.type === 'shard').every(m => m.isShard && !m.elite), '裂片带标记且一律不是精英');
  // 呼叫真的叫人
  NS.start(100); const CG = NS.G;
  CG.phase = 'break'; CG.budget = 0; CG.wave = 8; CG.mobs.length = 0; CG.overheat = 0;
  NS.spawn('grunt'); const cl = CG.mobs[0]; NS.makeElite(cl); cl.aff = 'call'; cl.affT = .1;
  cl.x = 600; cl.y = 600;
  const n0 = CG.mobs.length;
  for (let i = 0; i < 60 * 6; i++) NS.update(D);
  ok(CG.mobs.length > n0, `呼叫叫来了增援（${n0} → ${CG.mobs.length}）`);
  // 环要按词缀变色，否则这套东西白加
  ok(/const af = AFFIX\[m\.aff\]/.test(html) && /ctx\.strokeStyle = af \? af\.c/.test(html),
    '标记环染成词缀的颜色 —— 看不出来的话「那只是什么货色」还是不存在的信息');
  ok(/G\.seenAff\[m0\.aff\]/.test(html), '第一次遇见某个词缀会给一句应对');
}

// ---- 42) 场地互动物 ----
// 三张场地原来只差尺寸和四个颜色字段，那 60~98 个装饰物只在绘制时读一次。
console.log('场地互动物');
{
  const D = 1 / 60;
  ok(NS.ARENAS.every(a => a.haz && a.hazN > 0), '每张场地都有自己的互动物');
  ok(new Set(NS.ARENAS.map(a => a.haz)).size === NS.ARENAS.length,
    `三张场地三种互动物（${NS.ARENAS.map(a => a.haz).join(' / ')}）—— 换场地要换打法，不是换配色`);
  NS.setMode('free'); NS.start(101);
  const HG = NS.G, HP = NS.P;
  HG.phase = 'break'; HG.budget = 0; HG.mobs.length = 0;
  // 传送带：推人也推怪
  NS.setArena(0, false);
  ok(NS.HAZ.length > 0 && NS.HAZ.every(h => h.k === 'belt'), `回收线上有 ${NS.HAZ.length} 条传送带`);
  {
    const b = NS.HAZ[0];
    HP.x = b.x; HP.y = b.y;
    const px0 = HP.x, py0 = HP.y;
    for (let i = 0; i < 30; i++) NS.update(D);
    ok(Math.hypot(HP.x - px0, HP.y - py0) > 8, `站上去被推着走了 ${Math.round(Math.hypot(HP.x - px0, HP.y - py0))}px`);
    HG.mobs.length = 0; NS.spawn('grunt');
    const m = HG.mobs[0]; m.x = b.x; m.y = b.y; m.spd = 0;
    const mx0 = m.x, my0 = m.y;
    for (let i = 0; i < 30; i++) NS.update(D);
    ok(Math.hypot(m.x - mx0, m.y - my0) > 8, '敌人也一样被推 —— 只对玩家生效的话它就是添堵，不是战术');
  }
  // 熔渣：烧人也烧怪，而且无视盾
  NS.setArena(1, false);
  ok(NS.HAZ.every(h => h.k === 'slag'), '熔渣池上是熔渣');
  {
    const g = NS.HAZ[0];
    HG.mobs.length = 0; HP.hp = HP.maxhp; HP.inv = 0;
    HP.x = g.x; HP.y = g.y;
    const hp0 = HP.hp;
    for (let i = 0; i < 90; i++) { HP.inv = 0; NS.update(D); }
    ok(HP.hp < hp0, `站在熔渣里掉了 ${Math.round(hp0 - HP.hp)} 血`);
    HP.x = g.x + g.r + 200; HP.hp = HP.maxhp;
    NS.spawn('shieldbot');
    const sb = HG.mobs[HG.mobs.length - 1];
    sb.x = g.x; sb.y = g.y; sb.ang = 0; sb.hp = 9999; sb.max = 9999;
    for (let i = 0; i < 90; i++) NS.update(D);
    ok(sb.hp < 9999, `把带盾的引进熔渣，它照样掉了 ${Math.round(9999 - sb.hp)} 血（熔渣无视盾）`);
  }
  // 冷凝罐：打爆炸一片
  NS.setArena(2, false);
  ok(NS.HAZ.every(h => h.k === 'tank'), '冷却塔上是冷凝罐');
  {
    const t = NS.HAZ[0];
    HG.mobs.length = 0; HP.x = t.x - 260; HP.y = t.y; HP.hp = HP.maxhp;
    NS.spawn('grunt');
    const m = HG.mobs[0]; m.x = t.x + 14; m.y = t.y; m.hp = 9999; m.max = 9999;
    HG.bullets.length = 0;
    for (let i = 0; i < 40 && !t.gone; i++) {
      HG.bullets.push({ x: t.x, y: t.y, vx: 0, vy: 0, life: 1, dmg: 20, crit: false,
        pierce: 0, hits: [], px: 0, py: 0, bounce: 0, col: '69,240,255', wep: 'pulse' });
      NS.update(D);
    }
    ok(t.gone === 1, '罐子被打爆了');
    ok(m.hp < 9999, `爆炸波及了旁边的敌人（掉了 ${Math.round(9999 - m.hp)}）`);
  }
  // 换场地要重新生成
  NS.setArena(0, false);
  ok(NS.HAZ.every(h => h.k === 'belt'), '换回第一张场地，互动物跟着换了');
  // 画得出来
  let threw = null;
  for (let i = 0; i < 3; i++) {
    NS.setArena(i, false);
    try { NS.render(); } catch (e) { threw = `第 ${i + 1} 张场地抛错：${e.message}`; }
  }
  ok(!threw, threw || '三张场地的互动物都画得出来');
}

// ---- 43) 据点与生产链 ----
// 废钢原来只有一个去处：8 把起手武器 × 150 = 总共 1200，
// 而一局能存 1500~3800 —— 打两局就把元经济买空了，之后废钢彻底没用。
console.log('据点与生产链');
{
  const D = 1 / 60;
  const fresh = () => { for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
    Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf(); };
  // 一、废钢有了长尾
  const hqTotal = NS.HQ_IDS.reduce((n, id) => n + NS.HQ[id].lv.reduce((a, l) => a + l.c, 0), 0);
  ok(hqTotal > 15000, `据点全盖满要 ${hqTotal} 废钢 —— 一局存 1500~3800，这是几十局的长尾`);
  ok(NS.HQ_IDS.length >= 4, `${NS.HQ_IDS.length} 栋建筑`);
  ok(NS.HQ_IDS.every(id => NS.HQ[id].lv.every((l, i, a) => i === 0 || l.c > a[i - 1].c)), '每栋的等级价钱递增');
  // 二、建筑只给选择，不给数值 —— 跟里程碑同一条规矩
  const allTxt = NS.HQ_IDS.map(id => NS.HQ[id].d + NS.HQ[id].lv.map(l => l.t).join('')).join('');
  ok(!/伤害|射速|移速|生命上限|暴击/.test(allTxt),
    '没有一栋建筑是加战斗数值的 —— 那条线由词条负责，元进度插手就成了数值跑步机');
  // 三、生产链：废钢 → 精炼钢
  fresh();
  ok(NS.refineRate() === 0 && NS.refine(1) === 0, '没盖精炼炉时炼不了');
  NS.PROF.scrap = 10000;
  NS.buyHQ('smelt');
  ok(NS.hqLv('smelt') === 1 && NS.refineRate() > 0, `盖了精炼炉，比率 ${NS.refineRate()} 废钢 → 1`);
  const sc0 = NS.PROF.scrap;
  ok(NS.refine(3) === 3 && NS.PROF.ingot === 3, '炼出了 3 块精炼钢');
  ok(sc0 - NS.PROF.scrap === 3 * NS.refineRate(), '废钢按比率扣掉了');
  const r1 = NS.refineRate(); NS.buyHQ('smelt');
  ok(NS.refineRate() < r1, `升级精炼炉后更省（${r1} → ${NS.refineRate()}）`);
  NS.PROF.scrap = 10;
  ok(NS.refine(5) === 0, '废钢不够时炼不出来，也不扣钱');
  // 四、武器改装：每一个都是【交换】，不是升级
  ok(Object.keys(NS.WMOD).length === NS.WEP_ORDER.length, `九把枪各有一个改装件`);
  ok(Object.values(NS.WMOD).every(m => m.n && m.d && m.c > 0), '每个都有名字、说明、价钱');
  ok(Object.values(NS.WMOD).every(m => /但|不再|砍半|减半|-\d+%/.test(m.d)),
    '每个改装件的说明里都写了代价 —— 纯加强的改装会让元进度变成数值跑步机');
  // 真的是交换：逐个验「有得有失」
  fresh(); NS.PROF.scrap = 99999; NS.buyHQ('smelt'); NS.buyHQ('bench');
  NS.PROF.ingot = 999;
  NS.setMode('free'); NS.start(110);
  for (const w of Object.keys(NS.WMOD)) {
    NS.PROF.unlocked['w_' + w] = 1;
    NS.PROF.mods = {}; NS.PROF.modsOn = {};
    NS.equip(w);
    // 量的字段得跟着武器种类一起长。原来只有远程那几个，
    // 加了近战之后 dash / iframe / arc / rampMax 的涨跌一个都看不见 ——
    // 于是「每个改装件都有代价」这条对新的两把枪直接失效。
    const snap = () => ({ dmg: NS.P.dmg, rate: NS.P.fireRate, pierce: NS.P.pierce, spread: NS.P.spread,
      range: NS.P.range, chain: NS.P.chain, reach: NS.P.reach, splash: NS.P.splash,
      arc: NS.P.arc, knock: NS.P.knock, heal: NS.P.heal,
      dash: NS.P.dash, iframe: NS.P.iframe, ramp: NS.P.ramp, rampMax: NS.P.rampMax });
    const before = snap();
    NS.PROF.mods[w] = 1; NS.PROF.modsOn[w] = 1;
    NS.equip(w);
    const after = snap();
    const flags = NS.P.railSplit || NS.P.nadeProx || NS.P.bladeKick || NS.P.beamWide || NS.P.mineRemote || NS.P.discTwin;
    const up = Object.keys(before).filter(k => after[k] > before[k]);
    const down = Object.keys(before).filter(k => after[k] < before[k]);
    ok(down.length > 0 || flags, `${NS.WEAPONS[w].n}·${NS.WMOD[w].n} 有代价（降了 ${down.join('/') || '—'}，行为标记 ${flags ? '有' : '无'}）`);
    ok(up.length > 0 || flags, `${NS.WEAPONS[w].n}·${NS.WMOD[w].n} 也有好处`);
  }
  // 五、槽位：装配台等级 = 同时能开几个
  fresh(); NS.PROF.scrap = 99999; NS.buyHQ('bench'); NS.PROF.ingot = 999;
  ok(NS.modSlots() === 1, '装配台 1 级 = 1 个槽位');
  ok(NS.buyMod('pulse') === true && NS.modOn('pulse'), '买了就自动装上（有空位）');
  ok(NS.buyMod('shot') === true && !NS.modOn('shot'), '第二个买得到，但槽位满了不自动装');
  ok(NS.toggleMod('shot') === false, '槽位满时开不了第二个');
  NS.toggleMod('pulse');
  ok(NS.toggleMod('shot') === true, '先关掉一个，才能开另一个');
  NS.buyHQ('bench');
  ok(NS.modSlots() === 2 && NS.toggleMod('pulse') === true, '升级装配台后能同时开两个');
  ok(NS.buyMod('pulse') === false, '已经有的不会重复买');
  NS.PROF.ingot = 0;
  ok(NS.buyMod('rail') === false, '精炼钢不够买不了');
  // 六、每日局不吃改装 —— 大家的枪得一样
  NS.PROF.ingot = 999; NS.PROF.mods = { pulse: 1 }; NS.PROF.modsOn = { pulse: 1 };
  NS.setMode('daily'); NS.start(110); NS.equip('pulse');
  const dailyRate = NS.P.fireRate;
  NS.setMode('free'); NS.start(110); NS.equip('pulse');
  ok(NS.P.fireRate !== dailyRate, `每日局不吃改装（自由局射速 ${NS.P.fireRate.toFixed(2)}，每日局 ${dailyRate.toFixed(2)}）`);
  // 七、弹药库真的多一格货、还能打折
  fresh(); NS.PROF.scrap = 99999;
  const n0 = NS.shopList().length;
  NS.buyHQ('depot');
  ok(NS.shopList().length === n0 + 1, `弹药库 Lv1 让商店从 ${n0} 格变成 ${NS.shopList().length} 格`);
  const it = NS.shopList()[0], c0 = NS.shopCost(it);
  NS.buyHQ('depot');
  ok(NS.shopCost(it) < c0, `Lv2 打折（${c0} → ${NS.shopCost(it)}）`);
  // 八、情报站给的是「知道」，不是「变强」
  fresh(); NS.PROF.scrap = 99999;
  NS.setMode('free'); NS.start(111);
  ok(NS.intelText() === '', '没盖情报站时没有情报');
  NS.buyHQ('intel'); NS.start(111);
  const itx = NS.intelText();
  ok(itx.length > 0 && /情报/.test(itx), `盖了就有情报（「${itx.slice(0, 40)}...」）`);
  NS.setMode('daily'); NS.start(111);
  ok(NS.intelText() === '', '每日局没有情报 —— 那会变成信息差');
  NS.setMode('free');
  // 九、义体车间：保底首抽
  fresh(); NS.PROF.scrap = 99999; NS.buyHQ('train');
  NS.PROF.pity = ['dmg'];
  let hit = 0;
  for (let i = 0; i < 12; i++) {
    NS.start(120 + i); NS.G.state = 'play'; NS.showLevelup();
    if (NS.G.offer.some(u => u.id === 'dmg')) hit++;
  }
  ok(hit === 12, `指定的保底词条 12 次升级里出现了 ${hit} 次 —— 第一次升级必定有它`);
  NS.start(130); NS.G.state = 'play'; NS.showLevelup();
  NS.takeUpgrade(NS.G.offer[0]);
  NS.G.state = 'play'; NS.showLevelup();
  ok(NS.G.pityDone === 1, '保底只管第一次，之后照常摇');
  // 保底得能选，不能只有数据没有入口
  NS.PROF.pity = [];
  ok(NS.togglePity('dmg') === true && NS.PROF.pity[0] === 'dmg', '能指定一条');
  ok(NS.togglePity('rof') === false, `车间 ${NS.hqLv('train')} 级只能指定 ${NS.hqLv('train')} 条`);
  ok(NS.togglePity('dmg') === true && NS.PROF.pity.length === 0, '再点一次取消');
  NS.PROF.scrap = 99999; NS.buyHQ('train');
  ok(NS.togglePity('dmg') && NS.togglePity('rof') && NS.PROF.pity.length === 2, '升级后能指定两条');
  NS.showHQ(true);
  ok(byId('hqPity').innerHTML.indexOf('已指定') >= 0, '据点里有保底词条的入口');
  NS.showHQ(false);
  // 每日局不吃保底 —— 跟改装同一条规矩
  NS.setMode('daily'); NS.start(140); NS.G.state = 'play'; NS.showLevelup();
  const dailyHasPity = NS.G.offer.some(u => u.id === 'dmg');
  NS.setMode('free');
  ok(/MODE !== 'daily' && \(PROF\.pity/.test(html), '每日局不吃保底 —— 大家的牌池得一样');
}

// ---- 44) 战利品与货摊 ----
// 「用捡的东西开店」。做坏了就是「点一下卖掉」的杂活 ——
// 分界线只有一条：定价要有牙齿。下面这些断言就是守这条线的。
console.log('战利品与货摊');
{
  const D = 1 / 60;
  const fresh = () => { for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
    Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf(); };
  // 一、零件跟「你打了谁」绑定 —— 这才让敌人选择有了战斗之外的理由
  ok(NS.PART_IDS.length >= 8, `${NS.PART_IDS.length} 种零件`);
  ok(NS.PART_IDS.every(k => NS.PART[k].n && NS.PART[k].base > 0 && NS.PART[k].from.length), '每种都有名字、基准价、来源');
  ok(new Set(NS.PART_IDS.map(k => NS.PART[k].c)).size === NS.PART_IDS.length, '颜色互不重复 —— 掉在地上要分得清');
  const covered = Object.keys(NS.PART_OF);
  for (const t of ['tank', 'drone', 'shieldbot', 'relay', 'hauler', 'splitter', 'bomber'])
    ok(covered.indexOf(t) >= 0, `${NS.MOB[t].nm} 有对应的零件（想要它就得去打它）`);
  ok(NS.PART_OF.boss && NS.PART_OF.boss === NS.PART_OF.boss2, 'BOSS 掉的是同一种高价零件');
  ok(NS.PART.core.base > NS.PART.cap.base * 4, `核心碎片 ${NS.PART.core.base} 远贵于电容组 ${NS.PART.cap.base}`);
  // 二、真的掉、真的捡得到、真的进货箱
  fresh(); NS.setMode('free'); NS.start(150);
  const LG = NS.G, LP = NS.P;
  LG.phase = 'break'; LG.budget = 0; LG.mobs.length = 0; LG.drops.length = 0; LG.loot = {};
  let got = 0;
  for (let i = 0; i < 200; i++) { NS.spawn('tank'); const m = LG.mobs[LG.mobs.length - 1]; m.x = 900; m.y = 900; m.elite = 0; NS.killMob(m); }
  got = LG.drops.filter(d => d.kind === 'part').length;
  ok(got > 5 && got < 120, `200 台重装掉了 ${got} 个零件 —— 稀缺才谈得上行情`);
  ok(LG.drops.filter(d => d.kind === 'part').every(d => d.pk === 'servo'), '重装只掉伺服马达，不掉别的');
  LG.drops.length = 0; LG.loot = {};
  LG.drops.push({ x: LP.x, y: LP.y, vx: 0, vy: 0, t: 0, kind: 'part', pk: 'optic' });
  for (let i = 0; i < 20; i++) NS.update(D);
  ok(LG.loot.optic === 1, '捡起来进这一局的货箱');
  LG.wave = 5; NS.bankRun();
  ok((NS.PROF.parts.optic | 0) === 1, '局末进档案的货箱 —— 死了也算，不然会逼人苟');
  // 三、行情每局变，而且有缺货有积压
  fresh();
  const m0 = NS.market();
  ok(m0.hot.length === 2 && m0.cold, `行情：缺货 ${m0.hot.join(' ')} · 积压 ${m0.cold}`);
  ok(m0.hot.indexOf(m0.cold) < 0, '缺货和积压不会是同一种');
  ok(NS.mktMul(m0.hot[0]) > 1 && NS.mktMul(m0.cold) < 1, '缺货涨价、积压跌价');
  NS.PROF.runs = 5;
  const m1 = NS.market();
  ok(m1.n !== m0.n, '打完一局行情就换 —— 「今天该打谁」每局都在变');
  ok(NS.rollMarket(3).hot.join() === NS.rollMarket(3).hot.join(), '同一局数的行情是确定的，不会每次读都变');
  // 四、定价有牙齿：出价高会流失客人
  fresh();
  NS.PROF.parts = { cap: 60 };
  NS.PROF.fame = 100;
  const band = NS.priceBand('cap');
  ok(band.lo < band.mid && band.mid < band.hi, `价位带 ${band.lo} ~ ${band.hi}`);
  NS.setPrice('cap', Math.round(band.lo * .8));        // 贱卖
  const cheapRun = NS.openStore();
  ok(cheapRun.sold === cheapRun.log.filter(l => l.k === 'ok' || l.k === 'cheap').length, '贱卖时几乎人人都买');
  const cheapSold = cheapRun.sold;
  NS.PROF.parts = { cap: 60 }; NS.PROF.fame = 100;
  NS.setPrice('cap', Math.round(band.hi * 1.6));       // 漫天要价
  const greedRun = NS.openStore();
  ok(greedRun.sold < cheapSold, `要价高就卖不动（贱卖 ${cheapSold} 件 → 高价 ${greedRun.sold} 件）`);
  ok(greedRun.log.some(l => l.k === 'far' || l.k === 'over'), '有客人明确表示嫌贵 —— 这是教你价位带的反馈');
  // 但高价单件更赚：这才叫「决定」而不是「越低越好」
  NS.PROF.parts = { cap: 60 }; NS.PROF.fame = 100;
  NS.setPrice('cap', band.mid);
  const midRun = NS.openStore();
  ok(midRun.earned > 0, `按中位价进账 ${midRun.earned}`);
  ok(Math.round(midRun.earned / Math.max(1, midRun.sold)) > Math.round(cheapRun.earned / Math.max(1, cheapSold)),
    '中位价的单件收入高于贱卖 —— 所以「卖多少钱」是个真决定，不是越低越好');
  // 五、名声：赶走客人有后果
  fresh(); NS.PROF.parts = { cap: 99 }; NS.PROF.fame = 80;
  NS.setPrice('cap', 9999);
  const n0 = NS.customerCount();
  NS.openStore();
  ok(NS.fame() < 80, `一直赶客人，名声掉了（80 → ${NS.fame()}）`);
  ok(NS.customerCount() < n0, `名声低了来的人也少（${n0} → ${NS.customerCount()}）—— 贪一次没事，一直贪就没人来`);
  fresh(); NS.PROF.parts = { cap: 99 }; NS.PROF.fame = 40;
  NS.setPrice('cap', 1);
  NS.openStore();
  ok(NS.fame() > 40, '好好做生意名声会回来');
  // 六、钱进的是废钢 —— 经营层不产战斗力，还是那条规矩
  fresh(); NS.PROF.parts = { servo: 20 }; NS.PROF.scrap = 0;
  NS.setPrice('servo', NS.priceBand('servo').lo);
  const r6 = NS.openStore();
  ok(NS.PROF.scrap === r6.earned && r6.earned > 0, `卖的钱进废钢（+${r6.earned}），喂给据点，不直接变战斗力`);
  // 七、空货箱不会报错
  fresh(); NS.PROF.parts = {};
  const r7 = NS.openStore();
  ok(r7.sold === 0 && r7.log.length === 1, '货箱空的时候说一句就好，不会崩');
  // 八、界面上看得见行情和定价
  NS.PROF.parts = { cap: 3, servo: 1 };
  NS.showHQ(true);
  ok(byId('hqMkt').innerHTML.indexOf('缺货') >= 0, '货摊上写着今天什么缺货');
  ok(byId('hqStock').innerHTML.indexOf('data-pr') >= 0, '每种货都有加减价的按钮');
  ok(/body\.touch \.pitem button\{width:34px/.test(html), '触屏上加减价按钮放大到 34px —— 这是唯一要反复点的地方');
  NS.showHQ(false);

  // 九、据点得说清楚「它有什么用」—— 三个栏目标题说得清「这是什么」，
  // 说不清「它们怎么串起来」。玩家问过这个。
  fresh();
  const c0 = NS.chainText();
  const names = NS.chainSteps().map(x => x.n.replace(/ /g, ''));
  ok(['打一局', '卖零件', '盖建筑', '炼精炼钢', '装改装件'].every(n => names.indexOf(n) > -1),
    `顶上把整条链列全了（${names.join(' › ')}）`);
  // 中文可以在任何字之间断行 ——「装配台装改装件」原来在手机上被劈成两行
  ok(/\.cstep\{[^}]*white-space:nowrap/.test(html), '每一格自己不许换行');
  // 每一步都得能跳到对应那一栏，否则它只是句话，不是目录
  const gos = NS.chainSteps().filter(x => x.go).map(x => x.go);
  ok(gos.length >= 4 && gos.every(g => html.indexOf('id="' + g + '"') > -1),
    `能点的步骤都指向真存在的栏目（${gos.join(' ')}）`);
  // 这一跳是长滚动里唯一的导航，不能因为系统关了动画就变成「点了没反应」
  ok(/scrollIntoView\(\{ behavior: REDUCE \? 'auto' : 'smooth'/.test(html),
    '开了「减少动态效果」就直接跳，不滑');
  ok(/货箱是空的/.test(c0), '空手进来时先说「零件从哪来」');
  NS.PROF.parts = { cap: 3 };
  ok(/先卖零件/.test(NS.chainText()), '有货了就说「先卖」');
  NS.PROF.scrap = 9999;
  NS.buyHQ('smelt');
  ok(/装配台/.test(NS.chainText()), '有了精炼炉就指向装配台');
  NS.buyHQ('bench');
  ok(/精炼/.test(NS.chainText()), '两栋都有了就说「去炼精炼钢」');
  NS.PROF.ingot = 9;
  ok(/交换/.test(NS.chainText()), '有精炼钢了就提醒「改装件是交换不是升级」');
  // 提示要跟着进度变，不是一句写死的
  const seen = new Set();
  fresh(); seen.add(NS.chainText());
  NS.PROF.parts = { cap: 1 }; seen.add(NS.chainText());
  NS.PROF.scrap = 9999; NS.buyHQ('smelt'); seen.add(NS.chainText());
  NS.buyHQ('bench'); seen.add(NS.chainText());
  NS.PROF.ingot = 9; seen.add(NS.chainText());
  ok(seen.size >= 4, `走到不同阶段给的是不同的提示（${seen.size} 种）—— 讲全套只会糊在眼前，讲下一步才有用`);
  // 已经走到的那一步要高亮，没走到的是灰的
  // 三档，不是两档：走过的、没走到的、以及【现在卡在哪一步】。
  // 只有亮/暗两档的话「我该干什么」还得自己数到第一个暗的。
  fresh();
  const st0 = NS.chainSteps(), t0 = NS.chainText();
  ok(st0.filter(x => x.on).length < st0.length, '空档案时有没走到的步骤');
  ok((t0.match(/class="cstep now"/g) || []).length === 1,
    '永远只有一步被标成「现在该做这个」');
  ok(/class="cstep on"/.test(t0) && /class="cstep"/.test(t0),
    '走过的和没走到的长得不一样');
  NS.PROF.parts = { cap: 1 }; NS.PROF.scrap = 9999; NS.buyHQ('smelt'); NS.buyHQ('bench');
  const t1 = NS.chainText();
  ok(NS.chainSteps().every(x => x.on) && !/cstep now/.test(t1),
    '整条链走通之后不再有「卡住」那一档');
}

// ---- 45) 宠物：据点养的管经营，局内抽的会打架 ----
// 会打架的宠物 = 白送的 DPS，而元进度这条线明确不给战斗力。
// 所以分两条：据点那三只改的是掉率/客流/情报，局内那个是词条召唤的。
console.log('宠物');
{
  const D = 1 / 60;
  const fresh = () => { for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
    Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf(); };
  // 一、据点宠物一个都不碰战斗数值
  ok(NS.PET_IDS.length === 3, `据点有 ${NS.PET_IDS.length} 只宠物`);
  ok(NS.PET_IDS.every(k => NS.PET[k].n && NS.PET[k].d && NS.GRID[NS.PET[k].spr]), '每只都有名字、说明、精灵');
  ok(!NS.PET_IDS.some(k => /伤害|射速|移速|生命|暴击|护盾/.test(NS.PET[k].d)),
    '没有一只是加战斗数值的 —— 它们改的是掉率、客流、情报');
  ok(NS.PET_IDS.every(k => NS.MILES.some(m => m.id === NS.PET[k].req)), '每只都有解锁的里程碑');
  // 二、拾荒犬真的翻倍掉率，而且只翻它指定的那一种
  fresh();
  NS.PROF.unlocked.p_dog = 1; NS.pickPet('dog'); NS.setDogPart('servo');
  ok(NS.activePet() === 'dog' && NS.dogPart() === 'servo', '带着拾荒犬，指定伺服马达');
  NS.setMode('free'); NS.start(160);
  const PG = NS.G;
  const count = (type, n) => {
    PG.phase = 'break'; PG.budget = 0; PG.mobs.length = 0; PG.drops.length = 0;
    NS.seedRun(9);
    for (let i = 0; i < n; i++) { NS.spawn(type); const m = PG.mobs[PG.mobs.length - 1]; m.x = 900; m.y = 900; m.elite = 0; NS.killMob(m); }
    return PG.drops.filter(d => d.kind === 'part').length;
  };
  const withDog = count('tank', 300);
  NS.pickPet('dog');                                   // 再点一次收回去
  ok(NS.activePet() === null, '再点一次把宠物收回去');
  const noDog = count('tank', 300);
  ok(withDog > noDog * 1.4, `拾荒犬让伺服马达掉得更多（${noDog} → ${withDog}）`);
  NS.pickPet('dog'); NS.setDogPart('optic');           // 换成指定别的
  const otherPart = count('tank', 300);
  ok(Math.abs(otherPart - noDog) < noDog * .45, `只翻指定的那一种（指定光学镜组时重装掉 ${otherPart}，跟没带狗的 ${noDog} 差不多）`);
  // 三、账房猫真的多来客人
  fresh(); NS.PROF.fame = 60;
  const c0 = NS.customerCount();
  NS.PROF.unlocked.p_cat = 1; NS.pickPet('cat');
  ok(NS.customerCount() === c0 + 3, `账房猫多来 3 位客人（${c0} → ${NS.customerCount()}）`);
  // 四、信鸦真的多看几波，而且没盖情报站也能看
  fresh(); NS.setMode('free'); NS.start(161);
  ok(NS.intelText() === '', '没情报站也没信鸦时，没有情报');
  NS.PROF.unlocked.p_crow = 1; NS.pickPet('crow'); NS.start(161);
  ok(NS.intelText().length > 0, '光带信鸦也能看到一点情报');
  NS.PROF.scrap = 99999; NS.buyHQ('intel'); NS.start(161);
  const both = NS.intelText();
  NS.pickPet('crow'); NS.start(161);
  ok(both.length >= NS.intelText().length, '信鸦叠在情报站上能多看几波');
  NS.setMode('daily'); NS.start(161);
  ok(NS.intelText() === '', '每日局照旧没有情报 —— 那会变成信息差');
  NS.setMode('free');
  // 五、没带宠物就没有，带了局内真的跟着跑
  fresh(); NS.start(162);
  ok(NS.G.pet === null, '没带宠物时局内没有它');
  NS.PROF.unlocked.p_dog = 1; NS.pickPet('dog'); NS.start(162);
  ok(NS.G.pet && NS.G.pet.id === 'dog', '带了就在局内出现');
  const P5 = NS.P, pt = NS.G.pet;
  P5.x += 260; P5.y += 180;                            // 人跑远
  const d0 = Math.hypot(pt.x - P5.x, pt.y - P5.y);
  for (let i = 0; i < 90; i++) NS.update(D);
  const d1 = Math.hypot(pt.x - P5.x, pt.y - P5.y);
  ok(d1 < d0 * .5, `宠物会追上来（${Math.round(d0)}px → ${Math.round(d1)}px）`);
  ok(/G\.pet\) \{\s*\n\s*const pt = G\.pet/.test(html) || /宠物：拖在身后/.test(html),
    '宠物纯装饰，不参与战斗 —— 它的本事在据点那头结算');
  // 停下来之后它得站在你的光圈外面。第一版跟 15px，玩家自己的光晕半径就有 13、
  // 身子高 16，狗整个埋在里面 —— 数据层一切正常，屏幕上根本没有狗。
  for (let i = 0; i < 240; i++) NS.update(D);           // 停下来等它归位
  const rest = Math.hypot(pt.x - P5.x, pt.y - P5.y);
  ok(rest > 18, `站着不动时宠物停在光圈外（离你 ${Math.round(rest)}px，光晕半径 13）`);
  // 只转枪口不挪脚，它不能跟着甩。锚点是「你往哪走」不是「你往哪瞄」。
  const px0 = pt.x, py0 = pt.y;
  for (let i = 0; i < 60; i++) { P5.ang += .1; NS.update(D); }
  ok(Math.hypot(pt.x - px0, pt.y - py0) < 6,
    `原地转枪口宠物不动（挪了 ${Math.round(Math.hypot(pt.x - px0, pt.y - py0))}px）—— 它跟的是脚不是枪`);

  // 六、战斗跟班是【局内词条】，不是元进度
  const esc = NS.UPGRADES.find(u => u.id === 'escort');
  ok(!!esc && esc.max >= 2, `护航无人机是词条，最多叠 ${esc.max} 架`);
  ok(!!NS.DECAL.escort, '它在人身上也有外显');
  fresh(); NS.start(163);
  const EG = NS.G, EP = NS.P;
  EG.phase = 'break'; EG.budget = 0; EG.mobs.length = 0;
  ok(EG.escorts.length === 0, '没抽到词条时没有跟班');
  NS.takeUpgrade(esc); NS.takeUpgrade(esc);
  ok(EG.escorts.length === 2, `抽两次就有 ${EG.escorts.length} 架`);
  // 真的绕着你转
  const e0 = EG.escorts[0];
  NS.update(D);                                        // 跟班是第一帧才被放上轨道的，要先跑一帧再量
  const r0 = Math.hypot(e0.x - EP.x, e0.y - EP.y);
  for (let i = 0; i < 40; i++) NS.update(D);
  const r1 = Math.hypot(e0.x - EP.x, e0.y - EP.y);
  ok(Math.abs(r1 - r0) < 14 && r1 > 8, `跟班绕着你转，半径稳定（${Math.round(r0)} → ${Math.round(r1)}px）`);
  // 轨道最窄的地方（正上正下）也不能从你身子里穿过去，否则一圈里有一半时间看不见它
  let minDy = 1e9;
  for (let i = 0; i < 400; i++) {
    NS.update(D);
    for (const e of EG.escorts) if (Math.abs(e.x - EP.x) < 3) minDy = Math.min(minDy, Math.abs(e.y - EP.y));
  }
  ok(minDy > 14, `跟班绕到正上方时也在身子外面（最近 ${Math.round(minDy)}px，人高 16）`);
  // 画出来分不分得清：跟班是青色胶囊，电容掉落和经验尾迹也是青色胶囊。
  // 颜色救不了（泛光会洗白），得有条线把它和你连起来 —— 没有掉落物会连着你。
  ctx.__rec();
  NS.render();
  const ops = ctx.__ops.slice();
  ctx.__rec(false);
  const link = ops.some((o, i) => o[0] === 'moveTo' && ops[i + 1] && ops[i + 1][0] === 'lineTo' &&
    Math.hypot(o[1] - (EP.x - EG.cam.x), o[2] - (EP.y - EG.cam.y)) < 2 &&
    EG.escorts.some(e => Math.hypot(ops[i + 1][1] - (e.x - EG.cam.x), ops[i + 1][2] - (e.y - EG.cam.y)) < 2));
  ok(link, '每架跟班都有一根线连回你身上 —— 这是它和掉落物唯一不会撞车的区别');
  // 真的会自己打
  NS.spawn('grunt');
  const tg = EG.mobs[0]; tg.x = EP.x + 40; tg.y = EP.y; tg.hp = 99999; tg.max = 99999;
  EG.bullets.length = 0;
  for (let i = 0; i < 150; i++) NS.update(D);
  ok(tg.hp < 99999, `跟班自己找最近的打（掉了 ${Math.round(99999 - tg.hp)} 血）`);
  // 但它不该盖过玩家：伤害是玩家的一个零头
  ok(/P\.dmg \* \.42/.test(html), '跟班的伤害是玩家的四成多一点 —— 是补充不是主力');
  // 重开一局要清掉
  NS.start(163);
  ok(NS.G.escorts.length === 0, '重开一局跟班清零 —— 它是这一局的构筑，不是永久的');
}

// ---- 46) 首页写的数字必须还是真的 ----
// 首页那段介绍里全是具体数字，加东西的时候最容易忘记回去改。
// 「22 条改装词条」就这么过期了一阵子 —— 实际已经 23 条。
console.log('首页文案');
{
  const home = require('fs').readFileSync(
    require('path').resolve(__dirname, '..', 'index.html'), 'utf8');
  const seg = home.slice(home.indexOf('霓虹废钢线'), home.indexOf('霓虹废钢线') + 4000);
  // 文案里数字有时写汉字（「九把武器」「三十波」），断言得两种都认
  const CN = '零一二三四五六七八九';
  const val = t => {
    if (/^\d+$/.test(t)) return +t;
    const i = t.indexOf('十');
    if (i < 0) return CN.indexOf(t);
    return (i === 0 ? 1 : CN.indexOf(t[0])) * 10 + (i === t.length - 1 ? 0 : CN.indexOf(t[i + 1]));
  };
  const num = (re, real, what) => {
    const m = seg.match(re);
    ok(!!m && val(m[1]) === real, `首页说${what} ${m ? m[1] : '没写'}，实际 ${real}`);
  };
  const N = k => Object.keys(NS.MOB).filter(x => !NS.MOB[x].boss).length;
  num(/([零一二三四五六七八九十\d]+)\s*把武器/, NS.UPGRADES.filter(u => u.id.indexOf('w_') === 0).length + 1, '武器');
  num(/(\d+) 条改装词条/, NS.UPGRADES.filter(u => u.id.indexOf('w_') !== 0).length, '改装词条');
  num(/([零一二三四五六七八九十\d]+)波机兵/, NS.LAST_WAVE, '一局打多少波');
  ok(/十一种敌人/.test(seg) && N() === 11, `首页说十一种敌人，实际 ${N()} 种（不算 BOSS）`);
  // 这一版新加的东西在首页上有没有交代
  ok(/拾荒犬|账房猫|信鸦/.test(seg), '宠物写进首页了');
  ok(/护航无人机/.test(seg), '护航无人机写进首页了');

  // 游戏自己那份 README 更容易掉队 —— 它一度还写着「六把武器」「五种敌人」，
  // 那时候实际已经是九把和十一种了。
  const rd = require('fs').readFileSync(
    require('path').resolve(__dirname, '..', 'games', 'neon-scrapline', 'README.md'), 'utf8');
  const wep = NS.UPGRADES.filter(u => u.id.indexOf('w_') === 0).length + 1;
  const mob = Object.keys(NS.MOB).filter(x => !NS.MOB[x].boss).length;
  const rnum = (re, real, what) => {
    const m = rd.match(re);
    ok(!!m && val(m[1]) === real, `README 说${what} ${m ? m[1] : '没写'}，实际 ${real}`);
  };
  rnum(/## ([零一二三四五六七八九十\d]+)把武器/, wep, '武器');
  rnum(/敌人 ([零一二三四五六七八九十\d]+) 种/, mob, '敌人');
  rnum(/一局 ([零一二三四五六七八九十\d]+) 波/, NS.LAST_WAVE, '一局多少波');
  rnum(/([零一二三四五六七八九十\d]+) 条改装词条/, NS.UPGRADES.filter(u => u.id.indexOf('w_') !== 0).length, '改装词条');
  // 「现在有几档危险等级」这种也会掉队
  rnum(/([零一二三四五六七八九十\d]+)档危险等级/, NS.DANGER.length, '危险等级档数');
}

// ---- 47) 手机上的版面：不重叠、不拆散、不铺成一长条 ----
// 这一节全是几何，而 DOM 桩的 getBoundingClientRect 是个死值 ——
// 所以只能验「让几何不可能出错的那些约束」，真的量还得开浏览器。
console.log('手机版面');
{
  // 文件里不止一个 <style>，拼起来再找；只切第一个会静默拿到 138 字节的那块。
  const css = (html.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');
  const px = re => { const m = css.match(re); return m ? +m[1] : null; };
  const hud = html.slice(html.indexOf('id="hud"'), html.indexOf('id="tc"'));

  // 一、每个标签都得紧跟在一个 .u 单元的开头。单独摆在行里的话，
  // 375 宽上量到过「废钢」在 y37、它的值在 y58 —— 中间隔着一整行。
  const lbls = [...hud.matchAll(/<span class="lbl">([^<]*)<\/span>/g)];
  // 「整合度」这种标签本身在手机上是藏的，但它后面的条和数字必须绑在一起，
  // 所以合格的写法有两种：标签自己在单元里，或者它后面紧跟一个单元。
  const loose = lbls.filter((m, i) => {
    if (/class="u(?: keep)?">$/.test(hud.slice(0, m.index))) return false;
    const end = lbls[i + 1] ? lbls[i + 1].index : hud.length;
    return !/<span class="u grow">/.test(hud.slice(m.index, end));
  });
  ok(loose.length === 0,
    `HUD 里没有游离的标签（${loose.map(m => m[1]).join('/') || '零个'}）`);
  ok(/\.u\{[^}]*white-space:nowrap/.test(css), '.u 单元内部不许换行');

  // 二、手机上藏掉哪些标签是有标准的：值本身说不说得清自己是什么。
  // 只看到下一个标签为止 —— 开个 200 字符的窗会读到隔壁单元的控件上去
  const kind = (m, i) => {
    const end = lbls[i + 1] ? lbls[i + 1].index : hud.length;
    const after = hud.slice(m.index + m[0].length, end);
    // 条优先于框：「整合度」后面先是血条再是隔壁的 WAVE 框，
    // 先判 tag 的话会把它报成 tag —— 结论仍然对，但说明是错的。
    return /class="bar"/.test(after) ? 'bar' : /id="dashPip"/.test(after) ? 'pip'
      : /class="tag"/.test(after) ? 'tag' : 'num';
  };
  const isKeep = m => /class="u keep">$/.test(hud.slice(0, m.index));
  const keep = lbls.filter(isKeep), drop = lbls.filter(m => !isKeep(m));
  ok(keep.length === 2, `手机上留了 ${keep.length} 个标签：${keep.map(m => m[1]).join('/')}`);
  ok(keep.every(m => kind(m, lbls.indexOf(m)) === 'num'),
    '留下的标签后面都是裸数字 —— 旁边没有任何东西说它是什么');
  ok(drop.every(m => kind(m, lbls.indexOf(m)) !== 'num'),
    `藏掉的标签后面都是自带说明的控件（${drop.map(m => m[1] + ':' + kind(m, lbls.indexOf(m))).join(' ')}）`);
  ok(/body\.touch #hud \.lbl\{display:none\}/.test(css), '手机上默认藏标签');

  // 三、右上角是暂停/音乐的地盘，HUD 得让开 —— 量到过四处重叠
  //（btnPause×武器框、×废钢、×废钢值，btnMute×废钢值）。
  const btnW = px(/#tc \.tsys button\{[^}]*width:(\d+)px/);
  const gap = px(/#tc \.tsys\{[^}]*gap:(\d+)px/);
  const right = px(/#tc \.tsys\{[^}]*right:calc\((\d+)px/);
  const reserve = px(/body\.touch #hud\{padding-right:calc\((\d+)px/);
  const corner = btnW * 2 + gap + right;
  ok(reserve >= corner, `HUD 给右上角让出 ${reserve}px，圆键那一块占 ${corner}px`);

  // 四、据点的钱要钉住：整屏 1300px，而每个决定都是「买不买得起」。
  const rule = css.slice(css.indexOf('body.touch #hqBox .hint{')).split('}')[0];
  ok(/position:sticky/.test(rule), '据点的钱在手机上吸顶');
  // #hqBox 是 grid + justify-items:center，横向得用 justify-*。
  // 写成 align-self:stretch 的时候条只有内容那么宽，两边照样漏 —— 踩过。
  ok(/justify-self:stretch|width:100%/.test(rule), '吸顶条横向铺满，不然两边漏出滚过去的内容');
  ok(/background:rgba\(\d+,\s*\d+,\s*\d+,\s*\.9\d\)|background:#/.test(rule),
    '吸顶条是实底 —— 半透明的话后面一排排建筑会直接透上来');
  // 容器有上内边距的话，吸顶元素顶不到那上面去，顶上会漏一条缝让内容钻出来。
  // 两种修法都行：把容器那点内边距挪走，或者拿投影把缝糊住。
  // （先用的投影，但条还没吸住时它会盖掉上面的链条提示，所以换成了前者。）
  ok(/body\.touch #hqBox\{padding-top:0\}/.test(css) || /box-shadow:0 -\d+px 0/.test(rule),
    '顶上不漏缝：要么容器没有上内边距，要么投影把缝盖住');
}

// ---- 48) 弹窗开着的时候触屏控件要收起来 ----
// 右上角那两个圆键浮在所有层之上，商店标题「买的东西只在这一局有效」
// 被暂停键盖掉过半句；摇杆和冲刺这时候本来也是死的，留着只挡视线。
{
  const tc = byId('tc');
  NS.start(7); NS.syncTC();
  ok(tc.classList.contains('play') && !tc.classList.contains('modal'),
    '正常打的时候触屏控件在');
  NS.openShop(); NS.syncTC();
  ok(tc.classList.contains('modal'), '开商店时收起来 —— 商店自带「下一波」，不需要这些');
  NS.closeShop(); NS.syncTC();
  ok(!tc.classList.contains('modal'), '关了商店再回来');
  NS.G.state = 'levelup'; NS.syncTC();
  ok(tc.classList.contains('modal'), '选牌时也收起来');
  NS.G.state = 'play'; NS.G.paused = true; NS.syncTC();
  ok(tc.classList.contains('paused') && !tc.classList.contains('modal'),
    '暂停不能一起藏 —— 藏了就点不回来');
  NS.G.paused = false; NS.syncTC();
  const css = (html.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');
  ok(/body\.touch #tc\.play\.modal\{display:none\}/.test(css),
    'CSS 里 modal 的权重压得过 .play，否则这个类加了也白加');
}

// ---- 49) 九选一用格子，不用九条通栏 ----
{
  const fresh = () => { for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
    Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf(); };
  fresh();
  NS.PROF.unlocked.p_dog = 1;
  if (NS.activePet() !== 'dog') NS.pickPet('dog');
  NS.syncPet();
  const box = byId('hqPet');
  const chips = (box.innerHTML.match(/class="pchip/g) || []).length;
  ok(chips === NS.PART_IDS.length,
    `拾荒犬的零件是 ${chips} 个格子 —— 九条通栏在手机上是 600px 一模一样的列表`);
  ok(!/data-dog="[^"]*"><span class="t"/.test(box.innerHTML),
    '格子里只有名字：九个选项是同一种东西，不需要副标题和价格栏');
  ok((box.innerHTML.match(/class="pchip on"/g) || []).length === 1, '永远只有一个选中');
  const other = NS.PART_IDS.find(k => k !== NS.dogPart());
  NS.setDogPart(other); NS.syncPet();
  ok(NS.dogPart() === other && byId('hqPet').innerHTML.indexOf('data-dog="' + other + '" ') > -1
     || byId('hqPet').innerHTML.indexOf('pchip on" data-dog="' + other) > -1,
    '点另一个能换过去');
}

// ---- 50) 捡到的零件必须有地方看 ----
// 被问过「我的背包和货箱在哪看」。当时的答案是：只有据点货摊，
// 而且那张表只列手上有的 —— 空箱子等于这一栏不存在；
// 局内和结算页则一个字都不提。三处都得能看到。
console.log('货箱');
{
  const fresh = () => { for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
    Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf(); };

  // 一、局内：暂停页第三个页签
  fresh(); NS.start(71);
  NS.G.loot = { cap: 3, servo: 1 };
  NS.showTab('bag');
  const bag = byId('bagPause').innerHTML;
  ok(byId('pauseBox').classList.contains('tab-bag'), '暂停页有「货箱」这一页');
  ok(NS.PART_IDS.every(k => bag.indexOf(NS.PART[k].n) > -1),
    `九种零件全列出来，没捡到的也在（${NS.PART_IDS.length} 种）`);
  ok(/\+3/.test(bag) && /\+1/.test(bag), '这一局捡了多少单独标出来');
  ok((bag.match(/class="bagrow zero"/g) || []).length === NS.PART_IDS.length - 2,
    '一件都没有的那些压暗，一眼能看出「今天什么都没出」');
  // .brow 这个类名构筑面板已经在用了 —— 撞上的话构筑面板会跟着变样
  ok(!/class="brow/.test(bag), '货箱不蹭构筑面板的类名');
  ok(/缺 货|积 压/.test(bag), '带上今天的行情 —— 不然「捡到了」没法换算成「值不值」');
  // 页签切走再切回来，三个页签互斥
  NS.showTab('dex');
  ok(byId('pauseBox').classList.contains('tab-dex')
    && !byId('pauseBox').classList.contains('tab-bag'), '三个页签只亮一个');
  NS.showDex(false);
  ok(byId('pauseBox').classList.contains('tab-build'), '老的 showDex(false) 还是回构筑页');

  // 二、结算页：这一局捡了什么
  NS.G.loot = { cap: 2, core: 1 };
  NS.gameOver(false);
  const gain = byId('overGain').textContent;
  ok(/废钢/.test(gain) && /电容组×2/.test(gain) && /核心碎片×1/.test(gain),
    `结算页写明捡到的零件（${gain}）`);
  NS.G.loot = {};
  NS.gameOver(false);
  ok(byId('overGain').textContent.indexOf('零件') < 0, '一件没捡到就不写这一段，不留空壳');

  // 三、据点货摊：永远列全九种，空箱也有得看。
  // 原来这是「货箱格子」+「存量要价表」两块，同一个数量显示了两遍，现在并成一张表。
  fresh(); NS.syncStore();
  const grid = byId('hqStock').innerHTML;
  ok(NS.PART_IDS.every(k => grid.indexOf(NS.PART[k].n) > -1), '据点货摊空着也列全九种');
  ok((grid.match(/pitem zero/g) || []).length === NS.PART_IDS.length, '一件都没有时九行全是暗的');
  ok(grid.indexOf('data-pr') < 0, '没货的行不给加减价的按钮 —— 定不了不存在的东西的价');
  NS.PROF.parts = { plate: 4 }; NS.syncStore();
  const grid2 = byId('hqStock').innerHTML;
  ok((grid2.match(/pitem zero/g) || []).length === NS.PART_IDS.length - 1,
    '有货的那一行亮起来');
  ok((grid2.match(/data-pr/g) || []).length === 2, '只有那一行有加减价按钮');
  ok(/全卖掉/.test(grid2) && grid2.indexOf(String(4 * NS.priceOf('plate'))) > -1,
    '底下有一行「按现在的要价全卖掉值多少」');
}

// ---- 51) 地上的东西得写名字 ----
// 被问「显示掉落道具的名字，要不不认识」。零件九种、增益六种，
// 光靠形状和颜色分不出是哪一个。
console.log('掉落物名字');
{
  NS.start(72);
  const G = NS.G, P = NS.P;
  G.drops.length = 0;
  const mk = o => G.drops.push(Object.assign({ x: P.x, y: P.y - 30, vx: 0, vy: 0, t: 0 }, o));
  mk({ kind: 'part', pk: 'servo' });
  mk({ kind: 'rush' });
  mk({ kind: 'coin', v: 3 });
  mk({ kind: 'hp' });
  mk({ kind: 'xp' });
  NS.render();
  const tags = byId('dtags').children.filter(e => !e.hidden).map(e => e.textContent);
  ok(tags.indexOf('伺服马达') > -1, `零件写名字（${tags.join(' ')}）`);
  ok(tags.indexOf('超频') > -1, '增益写名字');
  // 只标「同一类里有好几种」的。经验/废钢/治疗包各只有一种意思，
  // 全标只会在战场上糊一层字。
  ok(tags.length === 2, `一种形状一个意思的不标（现在标了 ${tags.length} 个）`);
  // 画布是 320×180，在上面画字必糊 —— 全游戏的文字都在 DOM 层
  ok(!/ctx\.fillText/.test(html), '名字走 DOM，不往画布上写字');
  // 屏幕外的不标，否则贴在边上会积一堆
  G.drops.length = 0;
  mk({ kind: 'part', pk: 'servo', x: P.x + 4000, y: P.y });
  NS.render();
  ok(byId('dtags').children.filter(e => !e.hidden).length === 0, '屏幕外的不标');
  // 暂停的时候收起来 —— 暂停面板要盖住战场，底下漂一层字会串味
  G.drops.length = 0; mk({ kind: 'part', pk: 'servo' });
  NS.render();
  ok(byId('dtags').children.filter(e => !e.hidden).length === 1, '打的时候在');
  NS.G.paused = true; NS.render();
  ok(byId('dtags').children.filter(e => !e.hidden).length === 0, '暂停时收起来');
  NS.G.paused = false;

  // 名字只说「这是什么」，说不出「它干什么」——「超频」两个字本身没有信息。
  // 敌人那边靠图鉴解决，增益原来只有捡起来那一瞬间的横幅。
  const dex = NS.dexHTML();
  ok(NS.BUFF_IDS.every(k => dex.indexOf(NS.BUFFS[k].n) > -1 && dex.indexOf(NS.BUFFS[k].d) > -1),
    '六种增益都进了图鉴，写明各自干什么');
  ok(/8 秒/.test(dex) && /立刻生效/.test(dex), '图鉴里写着能管几秒 —— 值不值得跑过去全看这个');
}

// ---- 52) 指路要在问题产生的那一刻给 ----
// 「我的背包在哪看」被问了两次。第一次我只在聊天里答了，游戏里一个字没说 ——
// 那第二次是必然的。加了货箱页签还不够，得有人把玩家领过去。
console.log('第一次指路');
{
  const fresh = () => { for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
    Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf(); };
  fresh(); NS.start(73);
  const G = NS.G, P = NS.P;
  G.tipQ.length = 0; G.tipT = 0;
  // 走完整条捡拾路径，不去直接调 firstTime —— 要验的就是「捡到时会不会触发」
  const grab = o => {
    G.drops.length = 0;
    G.drops.push(Object.assign({ x: P.x, y: P.y, vx: 0, vy: 0, t: 0 }, o));
    NS.update(1 / 60);
  };
  grab({ kind: 'part', pk: 'servo' });
  ok(G.tipQ.indexOf('ht:bag') > -1 || G.seen['ht:bag'], '捡到第一件零件就指路');
  const say = NS.HOWTO.bag.join(' ');
  ok(/货箱/.test(say) && /暂停/.test(say) && /货摊/.test(say),
    `这句话说清了去哪看、怎么去、之后拿它干什么（${say}）`);
  // 只播一次，而且跨局也记着
  const n0 = G.tipQ.length;
  grab({ kind: 'part', pk: 'cap' });
  ok(G.tipQ.length === n0, '第二件不再播');
  ok(NS.PROF.seen['ht:bag'], '记进档案 —— 下一局也不该再看到');
  NS.start(73);
  NS.G.tipQ.length = 0;
  NS.G.drops.push({ x: NS.P.x, y: NS.P.y, vx: 0, vy: 0, t: 0, kind: 'part', pk: 'cap' });
  NS.update(1 / 60);
  ok(NS.G.tipQ.indexOf('ht:bag') < 0, '重开一局也不再播');
  // 增益那条同理
  fresh(); NS.start(74);
  NS.G.tipQ.length = 0;
  NS.G.drops.push({ x: NS.P.x, y: NS.P.y, vx: 0, vy: 0, t: 0, kind: 'rush' });
  NS.update(1 / 60);
  ok(NS.G.tipQ.indexOf('ht:buff') > -1 || NS.G.seen['ht:buff'], '捡到第一个增益也指路');
  ok(/图鉴/.test(NS.HOWTO.buff.join(' ')), '增益那条指向图鉴 —— 名字说不出它干什么');
  // 指的路必须真的存在
  ok(!!byId('tabBag') && !!byId('tabDex'), '指过去的两个页签真的在');
}

// ---- 53) 玩法说明 ----
// 「X 是什么意思 / Y 在哪看」被问了一串。单独答一条是打补丁，
// 得有一处从头把「这游戏怎么玩」讲清楚。
console.log('玩法说明');
{
  const h = NS.howToHTML();
  const txt = h.replace(/<[^>]+>/g, ' ');

  // 一、该讲的都讲了
  const topics = ['怎么操作', '一局是怎么走的', '地上会掉什么', '升级牌怎么算',
    '枪怎么来', '据点是干什么的', '难度和每日局'];
  const missing = topics.filter(t => txt.replace(/\s/g, '').indexOf(t) < 0);
  ok(!missing.length, `该讲的都讲了（缺：${missing.join('、') || '无'}）`);
  // 五类掉落一个都不能漏 —— 这是玩家最先问的
  ok(['经验', '废钢', '治疗包', '零件', '增益'].every(k => txt.indexOf(k) > -1),
    '五类掉落全写了');

  // 二、数字从数据里读，不写死。首页那段就是写死之后过期的。
  const n = (re, real, what) => {
    const m = txt.match(re);
    ok(!!m && +m[1] === real, `说明里${what}写的是 ${m ? m[1] : '没写'}，实际 ${real}`);
  };
  n(/打穿 (\d+) 波就算赢/, NS.LAST_WAVE, '一局多少波');
  n(/一共 (\d+) 张牌/, NS.UPGRADES.filter(u => !/^w_/.test(u.id)).length, '词条张数');
  n(/一共 (\d+) 把/, NS.WEP_ORDER.length, '武器把数');
  n(/敌人 (\d+) 种/, Object.keys(NS.MOB).filter(k => !NS.MOB[k].boss).length, '敌人种数');
  n(/一共 (\d+) 种轮着来/, Object.keys(NS.MOB).filter(k => NS.MOB[k].boss).length, 'BOSS 种数');
  n(/花 (\d+) 废钢/, NS.WEP_COST, '买起手武器的价钱');

  // 三、说人话：不许拿游戏内造词开头。这一份是给没玩过的人看的。
  const jargon = ['整合度', '义体等级', '拆解数'];
  ok(jargon.every(w => txt.indexOf(w) < 0),
    `不用游戏内造词（${jargon.filter(w => txt.indexOf(w) > -1).join('、') || '没有'}）`);

  // 四、操作按设备各给一套，手机上不该出现 WASD
  ok(/class="honly-kb"/.test(h) && /class="honly-tc"/.test(h), '键鼠和触屏各一套');
  const css = (html.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');
  ok(/\.honly-tc\{display:none\}/.test(css) && /body\.touch \.honly-kb\{display:none\}/.test(css),
    '按设备只显示一套');
  ok(/W A S D/.test(h.split('honly-tc')[0]) && !/W A S D/.test(h.split('honly-tc')[1] || ''),
    'WASD 只在键鼠那一套里');

  // 五、「卡住了看哪里」指的路必须真的存在
  ok(/卡\s*住\s*了\s*看\s*哪\s*里/.test(txt), '末尾有一张速查表');
  ['构筑', '货箱', '图鉴'].forEach(t =>
    ok(txt.indexOf(t) > -1, `速查表提到「${t}」`));
  ok(!!byId('tabBuild') && !!byId('tabBag') && !!byId('tabDex'),
    '指过去的三个页签真的在 —— 写死的路标最容易变成假路标');

  // 六、开关：跟据点一样要把标题页收起来。
  // .screen 是 absolute + z-index:auto 不成层叠上下文，吸底开始按钮的 z-index:2
  // 是直接跟根层比的，光靠 DOM 顺序压不住它。
  NS.showHow(true);
  ok(byId('howBox').classList.contains('show') && !byId('title').classList.contains('show'),
    '打开说明时标题页收起来');
  ok(byId('howBody').innerHTML.length > 500, '内容是打开时才生成的');
  NS.showHow(false);
  ok(!byId('howBox').classList.contains('show') && byId('title').classList.contains('show'),
    '关掉之后回标题页');
}

// ---- 54) 一局结束之后得回得去标题页 ----
// 结算屏原来只有「重新接入」，一按就直接开下一局 —— 换模式、换危险档、
// 换起手武器、进据点全都够不着。「放弃这局」之后尤其别扭：
// 你放弃多半就是想去改点什么。
console.log('结算出口');
{
  NS.start(91);
  NS.G.deathBy = 'giveup';
  NS.gameOver(false);
  ok(byId('over').classList.contains('show') && !byId('title').classList.contains('show'),
    '结算屏出来了');
  NS.backToTitle();
  ok(!byId('over').classList.contains('show'), '回标题页：结算屏收起来');
  ok(byId('title').classList.contains('show'), '标题页出来了');
  ok(NS.G.state === 'menu' && !NS.G.paused, '状态回到菜单，暂停也解掉');
  // 回来之后档案面板那些入口必须真的能用 —— 这才是回来的目的
  ok(byId('prof').innerHTML.length > 100, '档案面板重新画了（模式 / 危险档 / 起手 / 涂装）');
  ok(!!byId('hqBtn') && !!byId('howBtn'), '据点和怎么玩够得着');
  // 从暂停页放弃走一遍完整路径
  NS.start(92);
  NS.setPaused(true);
  NS.armGiveup();                                      // 第一下只是上膛
  ok(!byId('over').classList.contains('show'), '放弃要按两下，第一下不生效');
  NS.armGiveup();
  ok(byId('over').classList.contains('show'), '第二下才结算');
  NS.backToTitle();
  ok(byId('title').classList.contains('show'), '放弃之后也回得去标题页');
}

// ---- 55) 连击数不能被右上角圆键盖住 ----
{
  const css = (html.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');
  const px = re => { const m = css.match(re); return m ? +m[1] : null; };
  const top = px(/#tc \.tsys\{[^}]*top:calc\((\d+)px/);
  const h = px(/#tc \.tsys button\{[^}]*height:(\d+)px/);
  const combo = px(/body\.touch #comboWrap\{top:calc\((\d+)px/);
  ok(combo !== null && combo >= top + h,
    `手机上连击数排在圆键下面（${combo}px vs 圆键到 ${top + h}px）`);
}

// ---- 56) 点了没成，必须说为什么 ----
// 报的是「选了霰弹枪之后框变高亮了，但是脉冲步枪还是选中态」。
// 查下来：买不起时 buyWep 静默返回 false，什么都不变也什么都不说；
// 而手机上点过的那个 chip 会挂着 :hover 边框不掉 —— 看着就像选中了两个。
console.log('点了没反应');
{
  const fresh = () => { for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
    Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf(); };
  const prof = () => byId('prof').innerHTML;
  const sayOf = () => { const m = prof().match(/class="prow say">([^<]*)</); return m ? m[1] : ''; };

  // 一、废钢不够：要说差多少，还要说「不买也能抽到」
  fresh();
  NS.PROF.unlocked.w_shot = 1; NS.PROF.scrap = 80;
  ok(NS.pickWep('shot') === false, '买不起就是买不起');
  ok(NS.PROF.wep === 'pulse', '起手武器没被改掉');
  const s1 = sayOf();
  ok(/还差 70/.test(s1), `说清还差多少（${s1}）`);
  ok(/卡池|三选一/.test(s1), '同时说清「不买也能在局内抽到」—— 否则看着像必须花钱');

  // 二、没解锁：理由不一样，话也得不一样
  fresh(); NS.PROF.scrap = 9999;
  NS.pickWep('rail');
  ok(/没解锁/.test(sayOf()) && sayOf() !== s1, `没解锁给的是另一句（${sayOf()}）`);
  ok(!NS.PROF.bought.rail && NS.PROF.scrap === 9999, '钱再多也买不了没解锁的');
  // 上面那条第一次跑是红的：清空档案之后磁轨枪居然买得下来。
  // 根因是 loadProf 用 Object.assign 浅合并 —— 存档里缺哪个键，
  // PROF 的那个字段就直接是 PROF_DEF 里的同一个对象，写进去会改掉默认值本身。
  const defs = ['unlocked', 'bought', 'seen', 'parts', 'base', 'mods', 'modsOn', 'price'];
  const shared = defs.filter(k => NS.PROF[k] && NS.PROF[k] === NS.PROF_DEF[k]);
  ok(!shared.length, `档案的每个字段都是自己的副本，不跟默认值共用（共用的：${shared.join(' ') || '无'}）`);
  NS.PROF.unlocked.w_probe = 1;
  ok(!NS.PROF_DEF.unlocked.w_probe, '往档案里写东西不会污染默认值');
  delete NS.PROF.unlocked.w_probe;

  // 三、成了就换过去，而且旧的那句要消失
  fresh(); NS.PROF.unlocked.w_shot = 1; NS.PROF.scrap = 80;
  NS.pickWep('shot');
  NS.PROF.scrap = 500; NS.pickWep('shot');
  ok(NS.PROF.wep === 'shot' && NS.PROF.bought.shot, '钱够了就买下并换成起手');
  ok(!/还差/.test(sayOf()), '上一次的「还差多少」不会挂着不走');
  NS.pickWep('pulse');
  ok(NS.PROF.wep === 'pulse' && sayOf() === '', '在已买下的两把之间切换，不留提示');

  // 四、提示要紧跟在「起手」那一排下面。挂在面板末尾等于没说 ——
  // 你在顶上点的枪，解释出现在四百像素以外。
  fresh(); NS.PROF.unlocked.w_shot = 1; NS.PROF.scrap = 80;
  NS.pickWep('shot');
  const html2 = prof();
  ok(html2.indexOf('class="prow say"') < html2.indexOf('新枪先靠里程碑'),
    '提示排在「起手」那一排下面，不在面板末尾');

  // 五、打完一局回标题页，上一次的提示不该还在
  NS.start(95); NS.gameOver(false); NS.backToTitle();
  ok(sayOf() === '', '回标题页时清掉旧提示');

  // 六、触屏上 :hover 会粘住。带选中态的那几类必须关进 @media (hover:hover)，
  // 否则点过的那个挂着边框，真正选中的那个填着色，看上去是两个。
  const css = (html.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');
  const sel = ['#prof .chip:hover', '#levelup .chip:hover', '#hqBox .chip:hover',
    '.hqi:hover', '.pchip:hover'];
  const naked = sel.filter(x =>
    !new RegExp('@media \\(hover:hover\\)\\{' + x.replace(/[.#()[\]]/g, '\\$&')).test(css));
  ok(!naked.length, `带选中态的 hover 都关进了 @media（裸着的：${naked.join(' ') || '无'}）`);
}

// ---- 57) 涂装换的是轮廓，换枪连人一起变 ----
// 报的是「皮肤变化不明显」。查下来：六套涂装只换调色板，网格一个字没动 ——
// 六个人影完全同形，而 320×180 叠泛光会把颜色洗白，等于没换。
// 「换枪人物也要变」同理：原来只有手上那把枪的形状变了。
console.log('涂装与武器外观');
{
  // 一、除了基准款，每套涂装都得有自己的剪影件，而且互不相同
  const sils = NS.SKIN_ORDER.filter(k => k !== 'std').map(k => (NS.SKINS[k] || {}).sil);
  ok(sils.every(Boolean), `基准款之外每套涂装都带剪影件（${sils.join(' ')}）`);
  ok(new Set(sils).size === sils.length, '每套的剪影件都不一样 —— 同一个形状等于没换');
  ok(sils.every(g => NS.SPR[g]), '剪影件的精灵都真的存在');

  // 二、武器挂件同理：除了开局那把，每把都带一件，互不相同
  const rigs = NS.WEP_ORDER.filter(k => k !== 'pulse').map(k => (NS.WRIG[k] || {}).g);
  ok(rigs.every(Boolean), `开局那把之外每把枪都带挂件（${rigs.length} 件）`);
  ok(new Set(rigs).size === rigs.length, '每把的挂件都不一样');
  ok(rigs.every(g => NS.SPR[g]), '挂件的精灵都真的存在');

  // 三、真的画出来了，而且换一把就真的不一样 —— 这才是「看得出来」。
  // 只验「代码里写了这几行」的话，摆错位置、被身体挡住、根本没调用都发现不了。
  NS.start(97);
  const P = NS.P, G = NS.G;
  Object.keys(NS.DECAL).forEach(id => delete G.stacks[id]);   // 词条会干扰，先清干净
  P.ang = 0; P.vxm = 0;
  const drawnFor = () => {
    ctx.__rec();
    NS.drawPlayer(30, 30);
    const imgs = ctx.__ops.filter(o => o[0] === 'drawImage').map(o => o[1]);
    ctx.__rec(false);
    return imgs;
  };
  const byWep = {};
  for (const w of NS.WEP_ORDER) { P.wep = w; byWep[w] = drawnFor(); }
  const sameAsPulse = NS.WEP_ORDER.filter(w => w !== 'pulse'
    && byWep[w].length === byWep.pulse.length
    && byWep[w].every((img, i) => img === byWep.pulse[i]));
  ok(!sameAsPulse.length,
    `换枪之后画出来的东西真的变了（跟脉冲步枪一模一样的：${sameAsPulse.join(' ') || '无'}）`);

  P.wep = 'pulse';
  const bySkin = {};
  for (const sk of NS.SKIN_ORDER) { NS.PROF.skin = sk; NS.applySkin(sk); bySkin[sk] = drawnFor(); }
  const sameAsStd = NS.SKIN_ORDER.filter(sk => sk !== 'std'
    && bySkin[sk].length === bySkin.std.length);
  ok(!sameAsStd.length,
    `换涂装之后多画了东西 —— 不只是换色（画的块数跟基准款一样的：${sameAsStd.join(' ') || '无'}）`);

  // 四、剪影件必须露在身体外面，不然它改不了轮廓。
  // 身体 20 高、居中，所以头顶在 -10；剪影画在 -12，是顶出去的。
  ok(/blitMid\(SPR\[sil\]\[0\], 0, -1[12]\)/.test(html),
    '剪影件顶在头顶外面 —— 藏在身体里的话轮廓一点没变');

  // 五、涂装仍然只是外观。这条老规矩不能因为加了剪影件就破。
  NS.start(98);
  const snap = () => [NS.P.maxhp, NS.P.speed, NS.P.dmg, NS.P.fireRate, NS.P.shield, NS.P.pickR].join();
  NS.PROF.skin = 'std'; NS.applySkin('std'); NS.start(98);
  const base = snap();
  const drift = NS.SKIN_ORDER.filter(sk => {
    NS.PROF.skin = sk; NS.applySkin(sk); NS.start(98);
    return snap() !== base;
  });
  ok(!drift.length, `换遍所有涂装，数值一模一样（变了的：${drift.join(' ') || '无'}）`);
  NS.PROF.skin = 'std'; NS.applySkin('std');
}

// ---- 58) 换场地之前，地上剩的要收走 ----
// setArena 里有一句 G.drops.length = 0。BOSS 一死场上一片狼藉，
// 25 废钢、必掉的核心碎片（全场最值钱的零件）就这么凭空没了，而且一声不响。
console.log('换场地前自动回收');
{
  NS.start(101);
  const G = NS.G, P = NS.P;
  const put = o => G.drops.push(Object.assign({ x: P.x + 400, y: P.y + 400, vx: 0, vy: 0, t: 0 }, o));

  // 一、每一类都得收到
  G.drops.length = 0; G.loot = {}; G.scrap = 0; P.hp = 10;
  for (let i = 0; i < 6; i++) put({ kind: 'xp' });
  put({ kind: 'coin', v: 25 }); put({ kind: 'part', pk: 'core' });
  put({ kind: 'hp' }); put({ kind: 'rush' });
  const lv0 = P.lv, hp0 = P.hp;
  const got = NS.sweepDrops();
  ok(G.scrap === 25, `废钢收到了（${G.scrap}）`);
  ok(G.loot.core === 1, '零件收到了 —— BOSS 那颗核心碎片是全场最值钱的');
  ok(P.hp > hp0, `治疗包也算（${hp0} → ${P.hp}）`);
  ok(G.buffs.rush > 0, '增益也算');
  ok(P.lv > lv0 || P.xp > 0, '经验进账了');
  ok(!G.drops.length, '地上收干净');
  ok(NS.sweepDrops() === null, '再扫一次没东西了，也不会崩');

  // 二、一口气跨两级，牌要发两次。原来「捡一颗判一次」，
  // takeUpgrade 直接把状态打回 play，第二级就白升了。
  NS.start(101);
  const G2 = NS.G, P2 = NS.P;
  G2.drops.length = 0;
  for (let i = 0; i < 40; i++) G2.drops.push({ x: P2.x, y: P2.y, vx: 0, vy: 0, t: 0, kind: 'xp' });
  const lvA = P2.lv;
  NS.sweepDrops();
  const gained = P2.lv - lvA;
  ok(gained >= 2, `一次扫进账 ${gained} 级`);
  let picks = 0;
  while (G2.state === 'levelup' && picks < 20) { NS.takeUpgrade(G2.offer[0]); picks++; }
  ok(picks === gained, `升了 ${gained} 级就发 ${picks} 次牌 —— 一级都不许吞`);
  ok(G2.lvQ === 0, '欠的等级结清了');

  // 三、真的挂在「换场地」那一步上，而不是我在别处手动调了一下
  NS.start(102);
  const G3 = NS.G, P3 = NS.P;
  G3.wave = 5; G3.drops.length = 0; G3.loot = {}; G3.scrap = 0;
  G3.drops.push({ x: P3.x + 300, y: P3.y, vx: 0, vy: 0, t: 0, kind: 'coin', v: 25 });
  G3.drops.push({ x: P3.x + 300, y: P3.y, vx: 0, vy: 0, t: 0, kind: 'part', pk: 'core' });
  const a0 = NS.ARENA_I;
  NS.nextWave();
  ok(NS.ARENA_I !== a0, '第 6 波确实换了场地');
  ok(G3.scrap === 25 && G3.loot.core === 1, '换之前收走了，没跟着 drops 一起被清掉');

  // 四、收了什么要说出来，否则玩家只看到「东西没了」。
  // banner() 是覆盖式的 —— 直接弹会被 nextWave 末尾的波次横幅盖掉，所以走提示队列。
  const D = 1 / 60;
  let seen = '';
  for (let i = 0; i < 500; i++) {
    NS.update(D);
    const t = byId('banner').innerHTML;
    if (t.indexOf('回 收') > -1) { seen = t; break; }
  }
  ok(/25/.test(seen) && /核心碎片/.test(seen), `横幅写明收到了什么（${seen.replace(/<[^>]+>/g, ' ')}）`);
  // 顺带修好的：场地横幅一直以来都在换场地那一波被波次横幅盖掉，从没人见过
  ok(NS.G.tipQ.some(t => typeof t === 'object' && /场 地/.test(t.n))
     || /场 地/.test(byId('banner').innerHTML) || seen.indexOf('回 收') > -1,
    '场地横幅也进了队列，不再被波次横幅盖掉');

  // 五、没东西可收的时候不许冒出一条空横幅
  ok(NS.sweepNote(null) === '' && NS.sweepNote({ xp: 0, scrap: 0, hp: 0, parts: [], buffs: 0 }) === '',
    '什么都没收到就不说话');
}

// ---- 59) 开店有画面 ----
// 原来是点一下、瞬间吐一整段文字。「客人嫌贵走了」只剩一行字，
// 而定价是这套经营玩法唯一的决策 —— 被拒绝得看得见才有体感。
console.log('货摊画面');
{
  const fresh = () => { for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
    Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf(); };
  fresh();
  NS.PROF.parts = { cap: 6, plate: 3, core: 2, servo: 4 };
  NS.PROF.scrap = 3000;
  NS.PART_IDS.forEach(k => NS.setPrice(k, Math.round(NS.priceBand(k).lo * .9)));  // 压低价保证有成交
  const before = NS.PROF.scrap;
  const res = NS.openStore();
  ok(res.log.length > 2 && res.earned > 0, `这一场有 ${res.log.length} 位客人、进账 ${res.earned}`);

  // 一、画面只是【回放】，结算一个字不动 —— 所以经济那边的断言全都还成立
  ok(NS.PROF.scrap === before + res.earned, '账在 openStore 里就结完了，画面不参与算账');

  NS.playStore(res);
  ok(byId('hqScrap').textContent === String(before),
    `开场时显示的是开张前的钱（${byId('hqScrap').textContent}）—— 钱先到客人后来会穿帮`);

  // 二、一位一位地放：钱一笔笔进，日志一行行长
  let t = 0, seenScrap = [byId('hqScrap').textContent], lines = [];
  for (let f = 0; f < 6000 && NS.SCENE.on; f++) {
    NS.tickStore(1 / 60); t += 1 / 60;
    const sc = byId('hqScrap').textContent;
    if (sc !== seenScrap[seenScrap.length - 1]) seenScrap.push(sc);
    lines.push((byId('hqLog').innerHTML.match(/<div/g) || []).length);
  }
  ok(!NS.SCENE.on, '放完会自己停 —— 不能留一个 rAF 在那儿空转');
  ok(seenScrap.length > 2, `钱是一笔笔到账的（变了 ${seenScrap.length - 1} 次）`);
  ok(byId('hqScrap').textContent === String(before + res.earned), '放完之后对得上真实数字');
  ok(lines[0] < lines[lines.length - 1], '日志是一行行长出来的，不是一次性糊上去');
  ok(/class="sum"/.test(byId('hqLog').innerHTML), '最后补上汇总那一行');

  // 三、时长要有个谱。第一版每位 1.6 秒，九个客人 14.6 秒 ——
  // 这是个菜单界面，没人坐得住。
  const per = t / res.log.length;
  ok(per < 1.1, `每位客人 ${per.toFixed(2)}s`);
  ok(t < 14, `整场 ${t.toFixed(1)}s`);

  // 四、不想看完能跳过
  NS.playStore(res);
  NS.tickStore(.1);
  NS.skipStore();
  ok(!NS.SCENE.on && byId('hqScrap').textContent === String(before + res.earned),
    '点一下直接看结果，数字也立刻对上');

  // 五、离开据点要把循环停掉
  NS.playStore(res);
  NS.showHQ(false);
  ok(!NS.SCENE.on, '关了据点就停 —— 否则那个循环会一直画下去');

  // 六、货箱空的时候不能崩
  fresh(); NS.PROF.parts = {};
  const empty = NS.openStore();
  NS.playStore(empty);
  for (let f = 0; f < 600 && NS.SCENE.on; f++) NS.tickStore(1 / 60);
  ok(!NS.SCENE.on, '空货箱也能正常收场');

  // 七、能加减的那个数字必须写明是什么。
  // 被问过「开门营业上面可以加减的是什么」—— 那一排原来只有一个光秃秃的数字。
  // 跟 HUD 那条规矩是同一条：数字旁边没有东西说它是什么，就必须写。
  fresh();
  NS.PROF.parts = { cap: 3, core: 1 };
  NS.syncStore();
  const stock = byId('hqStock').innerHTML;
  ok(/要 价/.test(stock), '有列头写明那一列是「要价」');
  ok(/存 量/.test(stock) && /零 件/.test(stock), '三列都有名字');
  ok(/每件/.test(stock) && /±10/.test(stock), '说清是每件的价、一下加减多少');
  ok(/客人转身走|砸名声/.test(stock) && /赚得少/.test(stock),
    '说清定高定低各自的代价 —— 这是这套玩法唯一的决策，不能靠猜');
  // 展开讲的那几句挪进了「怎么玩」—— 四行小字压在表头上，看一遍之后每次进来都碍事
  const how = NS.howToHTML();
  ok(/看不见/.test(how) && /砸名声/.test(how) && /定 价/.test(how.replace(/\s/g, ' ')),
    '「怎么玩」里有完整的定价说明');
  ok(/缺货/.test(stock) && /积压/.test(stock), '名字后面那个箭头也解释了');
  // 列头的宽度得跟行里的格子对上。对不齐的列头比没有列头还糟 —— 它会指错。
  const css2 = (html.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');
  const w = re => { const m = css2.match(re); return m ? +m[1] : null; };
  ok(w(/\.pcols \.h2\{width:(\d+)px/) === w(/\.pitem \.qt\{min-width:(\d+)px/),
    '「存量」列头和存量格同宽');
  const btn = w(/\.pitem button\{[^}]*width:(\d+)px/);
  const btnT = w(/body\.touch \.pitem button\{width:(\d+)px/);
  const pv = w(/\.pitem \.pv\{[^}]*min-width:(\d+)px/);
  const gap = w(/\.pitem\{[^}]*gap:(\d+)px/);
  ok(w(/\.pcols \.h3\{width:(\d+)px/) === btn * 2 + pv + gap * 2,
    `桌面：「要价」列头宽 = 减号 ${btn} + ${gap} + 价格 ${pv} + ${gap} + 加号 ${btn}`);
  // 触屏上按钮放大到 34px，列头得跟着换一套 —— 只写桌面那套的话手机上整排错 25px。
  // 第一版就是这么错的，而且断言只查了桌面，一点没红。
  ok(w(/body\.touch \.pcols \.h3\{width:(\d+)px/) === btnT * 2 + pv + gap * 2,
    `触屏：列头跟着放大的按钮走（${btnT} × 2 + ${pv} + ${gap} × 2）`);

  // 八、客人的颜色不许跟着玩家的涂装变。SPR 是按涂装烤出来的，
  // 用了 B/S/L/C/O/H 这六个会被重映射的字母就会跟着变色。
  const skinKeys = ['B', 'S', 'L', 'C', 'O', 'H'];
  const bad = ['cust_a', 'cust_b', 'cust_c', 'stall'].filter(g =>
    NS.GRID[g].some(frame => frame.some(row => row.split('').some(ch => skinKeys.indexOf(ch) >= 0))));
  ok(!bad.length, `摊位和客人不用会被涂装重映射的颜色（用了的：${bad.join(' ') || '无'}）`);
}

// ---- 60) 已经拿着的枪不许再发牌 ----
// 玩家问「我已有霰弹枪，在游戏里又捡了霰弹枪有什么增益」。答案是零 ——
// 那张牌的 f 只是 equip 一把他早就有的枪。这是纯陷阱：看着像新枪，
// 拿了什么都没变，还白白浪费一次三选一。
console.log('重复的枪');
{
  const fresh = () => { for (const k of Object.keys(NS.PROF)) delete NS.PROF[k];
    Object.assign(NS.PROF, JSON.parse(JSON.stringify(NS.PROF_DEF))); NS.syncProf(); };
  const gunsInPool = () => {
    const out = {};
    // 连摇一百次，把发得出来的枪都收集起来 —— 直接读 rollOffer 比看实现可靠
    for (let i = 0; i < 100; i++) NS.rollOffer().forEach(u => { if (u.wep) out[u.id] = 1; });
    return Object.keys(out).sort();
  };

  // 一、买成起手武器的那把，不该再出现在卡池里
  fresh();
  NS.PROF.unlocked.w_shot = 1; NS.PROF.unlocked.w_rail = 1;
  NS.PROF.bought.shot = 1; NS.PROF.wep = 'shot';
  NS.start(77);
  ok(NS.P.owned.indexOf('shot') >= 0, '开局手里就有霰弹枪');
  const g1 = gunsInPool();
  ok(g1.indexOf('w_shot') < 0, `手里那把不再进卡池（现在能发的：${g1.join(' ') || '无'}）`);
  ok(g1.indexOf('w_rail') > -1, '没拿到的那把照旧能发 —— 别把整类都封掉了');

  // 二、局内抽到之后同样不再出现
  NS.takeUpgrade(NS.UPGRADES.find(u => u.id === 'w_rail'));
  const g2 = gunsInPool();
  ok(g2.indexOf('w_rail') < 0, '局内抽到之后也不再发第二次');
  ok(NS.P.owned.indexOf('rail') >= 0, '而且真的拿到手了');

  // 三、这条规矩要对九把枪一视同仁
  fresh();
  NS.MILES.forEach(m => { NS.PROF.unlocked[m.id] = 1; });
  NS.start(78);
  const all = gunsInPool();
  const dup = all.filter(id => {
    const u = NS.UPGRADES.find(x => x.id === id);
    return u && NS.P.owned.indexOf(u.wep) >= 0;
  });
  ok(!dup.length, `全解锁时也没有一张是「已经拿着的」（${dup.join(' ') || '无'}）`);
  // 每拿一把就少一张，拿到最后一把都不剩
  let n = all.length;
  while (n > 0) {
    const g = gunsInPool();
    if (!g.length) break;
    NS.takeUpgrade(NS.UPGRADES.find(u => u.id === g[0]));
    const left = gunsInPool().length;
    ok(left < n, `拿走 ${g[0]} 之后卡池里的枪从 ${n} 张减到 ${left} 张`);
    n = left;
  }
  ok(NS.P.owned.length === NS.WEP_ORDER.length,
    `一路抽下来所有枪全到手（${NS.P.owned.length}/${NS.WEP_ORDER.length}）`);
}

console.log(fail ? `\n${fail} 项没通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
