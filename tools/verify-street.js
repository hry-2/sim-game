#!/usr/bin/env node
// 静街 · 离线验收（零件对不对）
// ==================================================================
// 这份脚本是在游戏本体【之前】写的。霓虹那一轮最大的教训是量具晚了：
// 桩不像真 DOM，能测的东西被砍掉一半；render() 从来没被调用过，绘制代码
// 到浏览器里才第一次执行。所以这次先把量具和契约定下来（见 street-stub.js 头部）。
//
// 三条自己的规矩：
//   一、断言查【意图】，不贴实现写（霓虹教训一）
//   二、每条断言都【打印它数到的数量】——「扫到 45 个」和「扫到 0 个」都是绿的（教训二）
//   三、游戏不存在时跑 tools/_street_fixture.html，并且大声说出来
'use strict';
const S = require('./street-stub');
const { run, ops, opsReset, isFixture, TARGET, REAL } = S;

let fail = 0, n = 0;
const ok = (c, m) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const sec = t => console.log('\n' + t);

console.log(isFixture
  ? `⚠ 游戏本体还不存在（等着 ${REAL.replace(process.cwd() + '/', '')}）\n  现在验的是量具自检靶子 tools/_street_fixture.html —— 全绿只说明【量具是好的】`
  : `验收目标：${TARGET.replace(process.cwd() + '/', '')}`);

// ---- 0) 精灵图集与调色板（T0，不需要游戏本体）----
sec('精灵图集');
{
  const G = require('./survivor_gen');
  ok(G.LW * G.SCALE === 96 && G.LH * G.SCALE === 126, `一帧 ${G.LW * G.SCALE}×${G.LH * G.SCALE}`);
  ok((G.LH * G.SCALE) % 3 === 0, `帧高 ${G.LH * G.SCALE} 整除 RS=3（市井 T31 的坑）`);
  const ratio = (G.FOOT - G.HY0 + 1) / G.HH;
  ok(ratio > 3.0 && ratio < 3.4,
    `头身比 1:${ratio.toFixed(2)} —— 市井量出来是 1:2.62，所以"拉到 1:2.6"等于没改`);
  // 部件数量（策划 Q13d）
  ok(G.FACES.length === 4 && G.HAIRS.length === 8 && G.TOPS.length === 6 &&
     G.PANTS.length === 4 && G.SHOES.length === 2,
    `部件：脸 ${G.FACES.length} / 发 ${G.HAIRS.length} / 上衣 ${G.TOPS.length} / 裤 ${G.PANTS.length} / 鞋 ${G.SHOES.length}`);
  ok(Object.keys(G.JOBS).length === 6, `六个职业各一套起手外观：${Object.keys(G.JOBS).join(' ')}`);
  // 每一帧都得真的画出东西来，而且宽高一致
  // 循环里【不要】逐帧打断言 —— 24 行没有文案的 ✓ 正是霓虹教训二骂的那种
  // "绿着但什么都没说"。数完再打一条，把数到的量写进去。
  let frames = 0, empty = 0, badShape = 0, minPx = 1e9, maxPx = 0;
  for (const name in G.JOBS) for (let d = 0; d < 4; d++) for (let sl = 0; sl < G.PER_DIR; sl++) {
    const px = G.draw(G.JOBS[name], sl < 4 ? sl : 0, d, sl < 4 ? 0 : sl - 3);   // slot 4/5/6 → atk 1/2/3
    const n = px.d.filter(Boolean).length;
    frames++; if (!n) empty++; if (px.d.length !== G.LW * G.LH) badShape++;
    minPx = Math.min(minPx, n); maxPx = Math.max(maxPx, n);
  }
  ok(frames === 6 * 4 * G.PER_DIR && empty === 0 && badShape === 0,
    `扫到 ${frames} 帧（六职业 × 4 向 × ${G.PER_DIR} 帧），空帧 ${empty}，尺寸不对 ${badShape}；像素数 ${minPx}~${maxPx}`);
  ok(G.COLS === 4 * G.PER_DIR && G.colOf(2, 4) === 2 * G.PER_DIR + 4,
    `图集 ${G.COLS} 列 = 4 向 × ${G.PER_DIR}（走路 4 + 出手 + 收手 + 处决）`);
  // 处决姿势要和出手一眼分得开
  for (let d = 0; d < 4; d++) {
    const a1 = G.draw(G.JOBS.木匠, 0, d, 1).d.map(c => c ? c.join(',') : '').join('|');
    const a3 = G.draw(G.JOBS.木匠, 0, d, 3).d.map(c => c ? c.join(',') : '').join('|');
    ok(a1 !== a3, `${G.DIRS[d]}：处决和出手不是同一张`);
  }
  // 击打姿势必须和走路那几帧都不一样 —— 否则"加了动作"等于没加
  for (let d = 0; d < 4; d++) {
    const atk = G.draw(G.JOBS.木匠, 0, d, 1).d.map(c => c ? c.join(',') : '').join('|');
    const walks = [0, 1, 2, 3].map(f => G.draw(G.JOBS.木匠, f, d, 0).d.map(c => c ? c.join(',') : '').join('|'));
    ok(!walks.includes(atk), `${G.DIRS[d]}：出手那帧和四帧走路都不一样`);
  }
  {
    const a1 = G.draw(G.JOBS.木匠, 0, 3, 1), a2 = G.draw(G.JOBS.木匠, 0, 3, 2);
    const reach = px => { let m = 0; for (let y = 0; y < G.LH; y++) for (let x = 0; x < G.LW; x++) if (px.get(x, y)) m = Math.max(m, x); return m; };
    ok(reach(a1) > reach(a2), `东面：出手伸到 x=${reach(a1)}，收手回到 x=${reach(a2)} —— 两帧是有先后的，不是同一张`);
  }
  // 调色板是【算】出来的：降饱和 20%、亮度上限 82%
  let bad = [];
  for (const k in G.RAW) {
    const [, s0] = G.toHSL(G.RAW[k]), [, s1, l1] = G.toHSL(G.PAL[k].a);
    if (s1 > s0 * (1 - G.DESAT) + .02) bad.push(k + ' 饱和没降');
    if (l1 > G.LCAP + .02) bad.push(k + ' 亮度超上限');
  }
  ok(Object.keys(G.RAW).length === 16, `主板 ${Object.keys(G.RAW).length} 色`);
  ok(!bad.length, `全部降饱和 ${G.DESAT * 100}%、亮度压到 ${G.LCAP * 100}% 以内：违规 ${bad.join(' ') || '无'}`);
  // 场景里唯一的高饱和色是僵尸的眼睛
  const maxS = Math.max(...Object.keys(G.PAL).map(k => G.toHSL(G.PAL[k].a)[1]));
  const eyeS = G.toHSL(G.EYE_GLOW)[1];
  ok(eyeS > maxS * 1.3,
    `僵尸眼睛饱和 ${eyeS.toFixed(2)} 明显高于主板最高的 ${maxS.toFixed(2)} —— 黑暗里先看见的是几点眼睛`);
  // 贴花：六类叠加 + 一个渲染层效果（湿透是乘算，做不成贴花）
  ok(G.DECALS.length === 6 && !!G.RENDER_FX.湿透,
    `贴花 ${G.DECALS.length} 类；湿透走渲染层（乘算 ${G.RENDER_FX.湿透.mul.join('/')}），不是贴花`);
  ok(G.DECAL_ORDER.indexOf('冬装') > G.DECAL_ORDER.indexOf('绷带') &&
     G.DECAL_ORDER.indexOf('武器') === G.DECAL_ORDER.length - 1,
    `贴花层序：${G.DECAL_ORDER.join(' → ')}（外套压住绷带，武器在最外面）`);
  let emptyDecal = [];
  for (const r of G.decalRows()) if (!G.decal(r.kind, 0, r.opt).d.filter(Boolean).length) emptyDecal.push(r.label);
  ok(!emptyDecal.length, `${G.decalRows().length} 行贴花每行都画出东西：空的 ${emptyDecal.join(' ') || '无'}`);
  // 全开 vs 全关必须是两个明显不同的样子
  const base = G.draw(G.JOBS.木匠, 0);
  const over = G.decalRows().filter(r => r.kind !== '武器').reduce((a, r) => a + G.decal(r.kind, 0, r.opt).d.filter(Boolean).length, 0);
  ok(over > base.d.filter(Boolean).length * .25,
    `贴花全开比素身多 ${over} 个像素（素身 ${base.d.filter(Boolean).length}）—— 两个明显不同的样子`);
  // 四季
  const seasons = Object.keys(G.SEASON);
  ok(seasons.length === 4 && seasons.every(k => G.SEASON[k].ramp.length === 4),
    `四季各一套 4 色环境偏移：${seasons.join(' ')}`);
  // 同一个种子永远同一张脸（游戏里存的只有行号）
  ok(JSON.stringify(G.genLook(1234)) === JSON.stringify(G.genLook(1234)), '同种子同一张脸');
  ok(JSON.stringify(G.genLook(1234)) !== JSON.stringify(G.genLook(1235)), '不同种子不同的人');
}

// ---- 1) 整段脚本真的能跑到底 ----
sec('脚本初始化');
let QS = null, QST = null;
try { QS = run(false); ok(!!QS, '桌面：脚本跑到底，没有初始化顺序错误'); }
catch (e) { ok(false, '桌面：脚本抛错：' + e.message); }
try { QST = run(true); ok(!!QST, '触屏：脚本跑到底'); }
catch (e) { ok(false, '触屏：脚本抛错：' + e.message); }
QS = run(false);
if (!QS) { console.log('\n拿不到 QS 钩子，后面全部跳过。契约见 tools/street-stub.js 头部'); process.exit(1); }

const need = ['start', 'update', 'render', 'migrate', 'noise', 'lootContainer', 'move',
              'tileHash', 'deathReport', 'save', 'load', 'setUI'];
ok(need.every(k => typeof QS[k] === 'function'),
  `契约里的 ${need.length} 个函数都在：缺 ${need.filter(k => typeof QS[k] !== 'function').join(' ') || '无'}`);

// ---- 2) 种子必须能从外部钉死（霓虹教训四）----
sec('种子');
{
  QS.start(20260911);
  const h0 = QS.tileHash();
  let same = 0;
  for (let i = 0; i < 10; i++) { QS.start(20260911); if (QS.tileHash() === h0) same++; }
  ok(same === 10, `同一个种子连生成 10 次，瓦片哈希一致的有 ${same} 次`);
  const hs = new Set();
  for (const s of [1, 2, 777, 424242, 9]) { QS.start(s); hs.add(QS.tileHash()); }
  ok(hs.size === 5, `5 个不同种子给出 ${hs.size} 座不同的镇`);
}

// ---- 3) 镇子：房型齐、栋数对、每栋至少两条出路 ----
sec('镇子生成');
QS.start(20260911);
const T = QS.TOWN;
{
  const types = Object.keys(QS.HOUSE_TYPE);
  const got = {};
  for (const h of T.houses) got[h.type] = (got[h.type] || 0) + 1;
  const miss = types.filter(t => !got[t]);
  // 原来写的是 `types.length === 10`。做 MVP 切片（4 栋房）时它会假红 ——
  // 而市井 T25 的教训正是：断言里写死的数字，都是等着假红的。改成查意图：表非空，且每种都出现。
  ok(types.length >= 4, `房型表里有 ${types.length} 种（切片 4 种、全镇 10 种都算过）`);
  ok(!miss.length, `${types.length} 种房型每种至少一栋：缺 ${miss.join(' ') || '无'}`);
  const want = types.reduce((a, t) => a + QS.HOUSE_TYPE[t].n, 0);
  ok(T.houses.length === want, `一共 ${T.houses.length} 栋建筑（表里写的是 ${want}）`);
  // 红线（市井 T30）：卡住了要能自己出来
  const bad = T.houses.filter(h => (h.exits || []).length < 2);
  ok(!bad.length, `每栋至少两条出路：不合格 ${bad.length} 栋 / 共 ${T.houses.length} 栋`);
  const win = T.houses.filter(h => h.exits.some(e => e.kind === '窗'));
  ok(win.length === T.houses.length, `每栋都有窗（钉了板也能拆着出去）：${win.length} / ${T.houses.length}`);
  // 房内连通只是一半：镇上每个柜子都得【走得到】，不然那栋房里的东西等于不存在
  if (QS.reachAudit) {
    const ra = QS.reachAudit();
    ok(ra.bad.length === 0, `${ra.total} 个容器全都走得到：走不到的 ${ra.bad.length} 个${ra.bad.length ? '（' + ra.bad.slice(0, 6).join(',') + '…）' : ''}`);
  }
}

// ---- 4) 容器与战利品表 ----
sec('容器与战利品');
{
  const miss = T.containers.filter(c => !QS.LOOT[c.lootKey]);
  ok(!miss.length, `${T.containers.length} 个容器的 LOOT 键全部命中：未命中 ${miss.length} 个`);
  const kinds = new Set(T.containers.map(c => c.kind));
  ok(kinds.size >= 8, `场上实际出现了 ${kinds.size} 种容器（表里定义了 ${Object.keys(QS.CONTAINER).length} 种）`);
  // 空手率：既不能全是空的，也不能翻一个赚一票
  const empty = T.containers.filter(c => !c.items.length).length;
  const rate = empty / T.containers.length;
  ok(rate > .02 && rate < .75, `空手率 ${(rate * 100).toFixed(1)}%（${empty}/${T.containers.length}）—— 难度旋钮，不是 0 也不是 1 就行`);
  // 反查另一边：LOOT 里出现的每样东西都得在物品表里有条目
  const inLoot = new Set();
  for (const k in QS.LOOT) for (const it in QS.LOOT[k]) if (it !== '空') inLoot.add(it);
  const orphan = [...inLoot].filter(i => !QS.ITEMS[i]);
  ok(!orphan.length, `LOOT 里 ${inLoot.size} 样东西都在物品表里：孤儿 ${orphan.join(' ') || '无'}`);
  const noKg = Object.keys(QS.ITEMS).filter(i => QS.ITEMS[i].kg == null || QS.ITEMS[i].slot == null);
  ok(!noKg.length, `物品表 ${Object.keys(QS.ITEMS).length} 件都有格数与公斤：缺 ${noKg.join(' ') || '无'}`);
}

// ---- 5) 配方材料反查（规格第八节第 4 条）----
sec('配方');
{
  const inLoot = new Set();
  for (const k in QS.LOOT) for (const it in QS.LOOT[k]) if (it !== '空') inLoot.add(it);
  const outs = new Set(QS.RECIPES.map(r => r.out));
  const bad = [];
  for (const r of QS.RECIPES) for (const m in r.need)
    if (!inLoot.has(m) && !outs.has(m)) bad.push(r.out + '←' + m);
  ok(!bad.length, `${QS.RECIPES.length} 条配方的材料都能在镇上找到或做出来：找不到的 ${bad.join(' ') || '无'}`);
}

// ---- 6) 噪音：打在哪个街区、谁听见了 ----
sec('噪音');
{
  QS.start(7);
  const before = QS.BLOCKS.map(b => b.heat);
  const b = QS.noise(60, 10, QS.NOISE.手枪, 1);
  const after = QS.BLOCKS.map(b => b.heat);
  const moved = after.map((h, i) => h - before[i]).filter(d => d > 0).length;
  ok(moved === 1, `一枪只加热了 ${moved} 个街区（${b.id}：${before[QS.BLOCKS.indexOf(b)].toFixed(2)} → ${b.heat.toFixed(2)}）`);
  const chase = QS.Z.filter(z => z.state === '追击').length;
  ok(chase > 0, `听到枪声转入追击的僵尸：${chase} 只`);
  // 三角关系：走不掉、跑得掉，而跑很吵（规格第〇节第 2 条，不许调飞）
  const S2 = QS.SPEED, N2 = QS.NOISE;
  // 红线改过一次：原来是"走不掉、跑得掉"，实际效果是"永远只能跑"，
  // 于是噪音从选择变成过路费。现在走得开、蹲不掉。
  ok(S2.蹲行 < S2.僵尸追击 && S2.僵尸追击 < S2.走 && S2.走 < S2.跑,
    `蹲 ${S2.蹲行} < 僵尸追击 ${S2.僵尸追击} < 走 ${S2.走} < 跑 ${S2.跑} —— 走得开一只，蹲着被发现就得站起来`);
  ok(N2.跑 > N2.走 && N2.蹲行 === 0,
    `跑的噪音 ${N2.跑} > 走 ${N2.走}，蹲行 ${N2.蹲行} —— 逃跑自带代价`);
  // 冲刺尸是唯一"跑得动"的僵尸，它不许把上面那条红线掰断
  const K = QS.ZOMBIE_KIND || {};
  const sp = Object.entries(K).filter(([, k]) => k.burst);
  ok(sp.length > 0, `会冲刺的品种：${sp.map(([n]) => n).join(' ') || '无'}`);
  ok(sp.every(([, k]) => k.burst > S2.跑 && k.after < S2.走),
    sp.map(([n, k]) => `${n} 冲刺 ${k.burst} > 玩家跑 ${S2.跑}（这 ${k.burstSec} 秒跑不掉），冲完 ${k.after} < 玩家走 ${S2.走}（之后一定跑得掉）`).join('；'));
  ok(Object.values(K).every(k => k.chase === S2.僵尸追击),
    `每个品种的常速都【等于】表里的 ${S2.僵尸追击} —— 同一个数不许写两个地方`);
}

// ---- 7) 迁移：只沿邻接表，而且守恒 ----
sec('迁移与守恒');
{
  QS.start(11);
  const init = QS.BLOCKS.reduce((a, b) => a + b.pop, 0);
  const tabled = QS.BLOCKS.reduce((a, b) => a + b.init, 0);     // 读表，不写死 320
  ok(init === tabled, `开局全镇 ${init} 只 == 街区表里写的 ${tabled} 只`);
  const adj = new Set();
  for (const b of QS.BLOCKS) for (const j of b.adj) adj.add(b.id + '-' + j);
  let cross = 0, flows = 0, days = 0;
  for (let d = 0; d < 30; d++) {
    QS.noise(60, 10, QS.NOISE.手枪, 2);          // 每天往 B 区开两枪
    if (d === 14) QS.kill(20);
    if (d === 29) QS.wave();
    const f = QS.migrate(); days++;
    flows += f.length;
    for (const x of f) if (!adj.has(x.from + '-' + x.to)) cross++;
  }
  ok(flows > 0, `${days} 天里一共发生 ${flows} 次迁移（不是 0 —— 0 的话这条断言什么都没查）`);
  ok(cross === 0, `跨非邻接边的流量 ${cross} 次`);
  const sum = QS.BLOCKS.reduce((a, b) => a + b.pop, 0);
  // 浪潮规模读表，不写死 —— 断言里写死的数字都是等着假红的（市井 T25）
  const WN = QS.WAVE_N;
  const want = tabled + WN * QS.waves + (QS.seeped || 0) - QS.kills;
  ok(sum === want, `守恒：场上 ${sum} == ${tabled} + 浪潮 ${WN}×${QS.waves} + 渗入 ${QS.seeped || 0} − 击杀 ${QS.kills} = ${want}`);
  ok((QS.seeped || 0) <= (QS.SEEP_CAP || 0), `渗入 ${QS.seeped || 0} 只，没超过上限 ${QS.SEEP_CAP || 0}（渗入不是给存量补货）`);
  const hot = QS.BLOCKS.find(b => b.id === 'B');
  ok(hot.pop > hot.init, `连吵 30 天的 B 区从 ${hot.init} 涨到 ${hot.pop} 只 —— 噪音真的把密度搬过来了`);
}

// ---- 8) 两条感染线的词汇不许重合 ----
sec('两条感染线');
{
  const blob = o => [o.name, o.bad, o.tip, o.cure, ...(o.stages || [])].filter(Boolean).join('');
  const gram = s => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) if (/[一-龥]{2}/.test(s.slice(i, i + 2))) g.add(s.slice(i, i + 2)); return g; };
  const A = gram(blob(QS.INFECT_TEXT.wound)), B = gram(blob(QS.INFECT_TEXT.zombie));
  const dup = [...A].filter(g => B.has(g));
  ok(A.size > 3 && B.size > 3, `两套词汇各有 ${A.size} / ${B.size} 个二字词可比（不是空的）`);
  ok(!dup.length, `两套词汇重合的词：${dup.join(' ') || '无'}`);
  ok(QS.INFECT_TEXT.wound.cure && !QS.INFECT_TEXT.zombie.cure,
    `伤口那条有药（${QS.INFECT_TEXT.wound.cure}），咬出来那条没有 —— 这条不许因为"手感"改掉`);
  ok((QS.INFECT_TEXT.zombie.stages || []).length === 4,
    `不可治那条的四阶段都写在界面上：${(QS.INFECT_TEXT.zombie.stages || []).join(' / ')}`);
}

// ---- 9) 死亡回溯：三段 + 文案红线 ----
sec('死亡回溯');
{
  let got = 0, bad = [], sample = null, zomb = 0;
  for (const s of [3, 5, 8, 13, 21, 34, 55, 89, 144, 233]) {
    QS.start(s);
    // 身上【没有酒精】是故意的：让第三段有话可说。
    // 但水和饭要给足 —— 不然角色第 2 天就渴死，测不到"被咬"那条线。
    // （第一版就是这么写的，然后入冬那条断言假红了半天。）
    QS.P.inv = ['撬棍', ...Array(20).fill('瓶装水'), ...Array(20).fill('罐头')];
    // 【还得让它在屋里】：不然秋天户外 −2/时，50 小时就冻死了，
    // 而潜伏期是 36~96 小时 —— 十有八九测的是冻死，不是感染。
    // 这是同一个毛病的第五次：没让被测的东西活到能测的时候。
    QS.P.inside = true;
    QS.lootContainer(0);
    QS.bite('左小臂');
    for (let h = 0; h < 120 && !QS.death; h++) {
      if (QS.P.body.口渴 < 45) QS.useItem('瓶装水');
      if (QS.P.body.饥饿 < 45) QS.useItem('罐头');
      QS.P.inside = true;
      QS.advanceHours(1);
    }
    if (QS.death && QS.death.cause === '感染') zomb++;
    if (!QS.death) QS.die('脱水');
    const r = QS.deathReport();
    if (r && r.lines.length >= 2) got++;
    sample = sample || r;
    const txt = (r ? r.lines.join('') : '');
    if (/[a-z]{2,}_[a-z]{2,}|#\d+|\bzid\b|undefined|NaN/.test(txt)) bad.push('内部键值/未定义：' + s);
    // 「尸毒」是禁用词：本作没有"毒"这个机制，也没有解毒剂，这个词会让玩家以为有。
    // 界面上只说「已感染」/「死于感染」。见 CONTEXT.md
    if (/尸毒|病毒|丧尸病/.test(txt)) bad.push('禁用词：' + s);
    if (/本该|你太|应该早/.test(txt)) bad.push('道德评价：' + s);
  }
  ok(got === 10, `10 局里有 ${got} 局生成了 ≥2 段的回溯`);
  ok(zomb >= 1 && zomb <= 8, `10 次咬伤里 ${zomb} 次滚出不可治的感染（表里写的是 35%）—— 这个数最该被探针盯（规格第十一节）`);
  ok(!bad.length, `文案红线：违规 ${bad.length} 条 ${bad.slice(0, 3).join('；')}`);
  if (sample) sample.lines.forEach(l => console.log('      ' + l));
  ok(QS.P.snaps.length > 0 && QS.P.snaps.length <= 48,
    `背包快照环形缓冲：${QS.P.snaps.length} 条（上限 48 条 = 24 小时）`);
  ok(Object.keys(QS.TOWN.ITEMINDEX).length > 5,
    `生成期就建好了物品索引：${Object.keys(QS.TOWN.ITEMINDEX).length} 样东西知道在哪 —— 第三段靠它`);
}

// ---- 10) 存档：镇子与角色分开，读档顺序对 ----
sec('存档');
{
  QS.start(99);
  QS.lootContainer(0); QS.lootContainer(1); QS.lootContainer(2);
  const searchedBefore = [...QS.TOWN.searched].reduce((a, b) => a + b, 0);
  ok(QS.TOWN.searched.length === QS.TOWN.containers.length,
    `searched 位数 ${QS.TOWN.searched.length} == 容器数 ${QS.TOWN.containers.length}`);
  QS.save();
  QS.start(99);
  ok([...QS.TOWN.searched].reduce((a, b) => a + b, 0) === 0, '重开一局，翻过的记录先归零');
  const okLoad = QS.load();
  const after = [...QS.TOWN.searched].reduce((a, b) => a + b, 0);
  ok(okLoad && after === searchedBefore, `读档后翻过的容器还是 ${after} 个（存档前 ${searchedBefore} 个）`);
  ok(QS.TOWN.searched.length === QS.TOWN.containers.length, '读档后位数仍然对得上');
  ok(QS.__pathReady === true, '读档顺序：先 town 再 char，中间重建了寻路（市井 T32 的坑）');
  QS.wipeChar(); QS.wipeTown();
}

// ---- 10.5) 据点、快进闸门、出生点（拷问第二轮定的三条）----
sec('据点与快进');
{
  QS.start(42);
  const h = QS.TOWN.houses.findIndex(x => x.type === '民宅');
  // 材料要给够：床吃 2 块木板、箱吃 1 块，钉窗还要一窗一块。
  // 第一版只给 3 块，board() 只钉上一扇，然后快进那两条红得莫名其妙 ——
  // 量具第三次栽在自己的准备上。
  QS.P.inv.push(...Array(12).fill('木板'), ...Array(12).fill('钉'));
  ok(QS.strongholds().length === 0, `开局没有据点（${QS.strongholds().length} 个）`);
  QS.place('床', h);
  ok(QS.strongholds().length === 0, '只有床不算据点 —— 还差储物箱');
  QS.place('储物箱', h);
  ok(QS.strongholds().includes(h), `放了床和箱，第 ${h} 号房成了据点（共 ${QS.strongholds().length} 个）`);
  // 归属：镇子档里不许出现角色名（ADR-0002 钉的就是这条）
  QS.P.name = '阿岩';
  QS.save();
  const townJson = localStorage.getItem('qs.town.' + QS.TOWN.seed) || '';
  ok(!/owner|阿岩/.test(townJson), `镇子档里没有归属字段也没有角色名（${townJson.length} 字节）—— 见 ADR-0002`);
  ok(QS.TOWN.built.every(b => b.owner === undefined), `${QS.TOWN.built.length} 件建造物没有一件带 owner`);
  // 快进闸门
  QS.P.atHouse = h; QS.P.inside = true;
  QS.TOWN.hour = 22;
  const before = QS.canFastForward();
  ok(!before.ok && /窗/.test(before.why), `窗没钉齐时不许快进：「${before.why}」`);
  const bd = QS.board(h);
  ok(bd.did > 0 && !bd.lack, `钉上了 ${bd.did} 扇窗，材料够用（缺的话会说缺什么：「${bd.lack || '无'}」）`);
  QS.P.inv = QS.P.inv.filter(x => x !== '木板');
  const bd2 = QS.board(QS.TOWN.houses.findIndex(x => x.type === '仓库'));
  ok(bd2.did === 0 && bd2.lack === '木板', `没木板时钉不上，而且说得出缺什么：「${bd2.lack}」—— 市井 T29`);
  QS.Z.forEach(z => { z.x = 0; z.y = 0; });
  const now = QS.canFastForward();
  ok(now.ok, `钉齐 + 外面没人时才放开快进（${QS.TOWN.houses[h].exits.filter(e => e.kind === '窗').length} 扇窗全钉上了）`);
  QS.Z[0].x = QS.P.x; QS.Z[0].y = QS.P.y;
  const blocked = QS.canFastForward();
  ok(!blocked.ok && /只/.test(blocked.why), `外面有僵尸就关掉：「${blocked.why}」`);
  QS.TOWN.hour = 12;
  ok(!QS.canFastForward().ok, `白天一律 1x：「${QS.canFastForward().why}」`);
  // 出生点：从镇外进来，且离据点最远、不在最密街区
  const sp = QS.spawnPoint();
  const hs = QS.TOWN.houses[h];
  const densest = QS.BLOCKS.slice().sort((a, b) => b.pop - a.pop)[0];
  ok(sp && (sp.x <= 2 || sp.y >= QS.TOWN.H - 2 || sp.x >= QS.TOWN.W - 2),
    `新角色从镇子边缘进来：(${sp.x},${sp.y})`);
  ok(sp.block !== densest.id, `出生点不在最密的 ${densest.id} 区（${densest.pop} 只），在 ${sp.block} 区`);
  ok(Math.hypot(hs.x - sp.x, hs.y - sp.y) > 10,
    `出生点离据点 ${Math.hypot(hs.x - sp.x, hs.y - sp.y).toFixed(0)} 格 —— 回自己的据点是第一天的目标，不是起点`);
  QS.wipeChar(); QS.wipeTown();
}

// ---- 10.7) 镇志、遗嘱池、三座镇、恐慌与情绪（拷问第三轮定的四条）----
sec('镇志与传承');
{
  QS.start(77);
  ok(QS.DEEDS.length >= 6, `镇志有 ${QS.DEEDS.length} 条可做成的事`);
  ok(Object.keys(QS.TOWN.deeds).length === 0, '新镇的镇志是空的');
  QS.P.inv.push(...Array(6).fill('木板'), ...Array(6).fill('钉'));
  const h = QS.TOWN.houses.findIndex(x => x.type === '民宅');
  QS.P.atHouse = h; QS.place('床', h); QS.place('储物箱', h);
  QS.checkDeeds();
  ok(QS.TOWN.deeds.base === QS.TOWN.day, `立起据点当天就记进镇志（第 ${QS.TOWN.deeds.base} 天）`);
  ok(QS.deedsLeft().length === QS.DEEDS.length - 1,
    `镇志还剩 ${QS.deedsLeft().length} 件没做成 —— 遗嘱页上那句"剩下的归你"就是它`);
  // 遗嘱池必须跟着镇子走，不能是全局的（规格第七节原来写错了）
  QS.P.name = '阿岩'; QS.die('被围');
  ok(QS.TOWN.legacy.length === 1 && QS.TOWN.legacy[0].days === QS.TOWN.day,
    `死了之后这一局进了【镇子】的遗嘱池（${QS.TOWN.legacy.length} 条）`);
  QS.save();
  ok(localStorage.getItem('qs.legacy') === null,
    '没有全局的 qs.legacy —— A 镇的遗嘱不会漏到 B 镇去用');
  const tj = localStorage.getItem('qs.town.77') || '';
  ok(/legacy/.test(tj) && /deeds/.test(tj), `镇子档里同时带着镇志与遗嘱池（${tj.length} 字节）`);
  QS.start(77); QS.load();
  ok(QS.TOWN.deeds.base && QS.TOWN.legacy.length === 1, '读档后镇志与遗嘱池都还在');
  // 三座镇的上限
  const had = QS.towns().length;
  for (const sd of [101, 102]) { QS.start(sd); QS.save(); }
  ok(QS.towns().length === had + 2, `现在存着 ${QS.towns().length} 座镇`);
  ok(!QS.canAddTown(999) && QS.canAddTown(101),
    `到了 ${QS.TOWN_CAP} 座就不让再开新镇，但已有的镇照样能存`);
  for (const sd of [77, 101, 102]) { QS.start(sd); QS.wipeTown(); }
  QS.wipeChar();
}

sec('恐慌与情绪各有一份工作');
{
  QS.start(8);
  const base = QS.accuracy();
  QS.P.body.恐慌 = 100;
  const scared = QS.accuracy();
  ok(Math.abs(scared.melee - base.melee) < 1e-9,
    `恐慌拉满，近战命中一点没变（${base.melee.toFixed(2)} → ${scared.melee.toFixed(2)}）—— 踉跄链已经在罚被围了`);
  ok(scared.gun < base.gun * .7,
    `恐慌拉满，枪械精度 ${base.gun.toFixed(2)} → ${scared.gun.toFixed(2)}（"别在被围时掏枪"有了数值支撑）`);
  QS.P.body.恐慌 = 0;
  QS.P.wounds.push({ part: '左小臂', type: '咬', treated: [] });
  ok(QS.accuracy().melee < base.melee, `手臂伤才压近战（${base.melee.toFixed(2)} → ${QS.accuracy().melee.toFixed(2)}）`);
  // 情绪：睡在自己据点的床上才回
  QS.start(8);
  QS.P.inv.push(...Array(6).fill('木板'), ...Array(6).fill('钉'));
  const hh = QS.TOWN.houses.findIndex(x => x.type === '民宅');
  // 【别查绝对值】：真游戏里情绪每小时还在自然走低（独处 −1.2/时），
  // 于是"睡一小时后正好是 60"这种断言只在靶子上成立。要查的是意图：
  // 在据点睡 vs 在陌生地方睡，差出来的那 10 点。
  QS.P.body.情绪 = 50; QS.P.atHouse = null;
  const away = QS.sleep(1);
  const m1 = QS.P.body.情绪;
  ok(!away, `睡在陌生地方：没算在据点里（情绪 ${m1.toFixed(1)}）`);
  QS.P.body.情绪 = 50;
  QS.P.atHouse = hh; QS.place('床', hh); QS.place('储物箱', hh);
  const home = QS.sleep(1);
  const m2 = QS.P.body.情绪;
  ok(home && Math.abs((m2 - m1) - 10) < .01,
    `睡在自己据点的床上多回 ${(m2 - m1).toFixed(1)} 点情绪（陌生地方 ${m1.toFixed(1)} / 据点 ${m2.toFixed(1)}）—— 六表里唯一奖励经营据点的那条`);
  QS.wipeChar(); QS.wipeTown();
}

// ---- 10.9) 时间基准与移动端（手玩报上来的两件事）----
sec('速度的时间基准');
{
  QS.start(1);
  const SPM = 22.5 / 60;                       // 一个游戏分钟等于多少现实秒
  const P = QS.P;
  const per = (st, mult) => {
    P.x = 46.5; P.y = 40.5; const a = [P.x, P.y];
    for (let i = 0; i < 60; i++) QS.move(0, -1, st, (1 / 60) / SPM);   // 一现实秒，60 帧
    return Math.hypot(P.x - a[0], P.y - a[1]);
  };
  const walk = per('走'), run = per('跑'), sneak = per('蹲行');
  const want = k => QS.SPEED[k] / SPM;
  ok(Math.abs(walk - want('走')) < .05 && Math.abs(run - want('跑')) < .05 && Math.abs(sneak - want('蹲行')) < .05,
    `一现实秒走 ${walk.toFixed(2)} / 跑 ${run.toFixed(2)} / 蹲 ${sneak.toFixed(2)} 格（表折过来应是 ${want('走').toFixed(2)} / ${want('跑').toFixed(2)} / ${want('蹲行').toFixed(2)}）`);
  // 僵尸必须和玩家用同一把尺子 —— 第一版玩家按游戏分钟走、僵尸按现实秒走，差 22.5 倍
  P.x = 46.5; P.y = 40.5;
  QS.Z.length = 0;
  const z = { kind:'普通', block:'C', state:'追击', tx:P.x, ty:P.y, x:46.5, y:P.y + 8, hp:3, dash:0, tired:0, lost:600 };
  QS.Z.push(z);
  let moved = 0;
  for (let i = 0; i < 60; i++) { const b = z.y; QS.update(1 / 60); moved += Math.abs(z.y - b); }
  ok(Math.abs(moved - QS.SPEED.僵尸追击 / SPM) < .1,
    `僵尸追击一现实秒走 ${moved.toFixed(2)} 格（应是 ${(QS.SPEED.僵尸追击 / SPM).toFixed(2)}）—— 和玩家同一把尺子`);
  ok(walk > moved && moved > sneak,
    `走 ${walk.toFixed(2)} > 僵尸 ${moved.toFixed(2)} > 蹲 ${sneak.toFixed(2)} 格/秒：这几个数的关系比它们各自的值重要`);
  ok(run > moved * 2.5,
    `跑 ${run.toFixed(2)} 是僵尸追击 ${moved.toFixed(2)} 的 ${(run / moved).toFixed(1)} 倍 —— 跑是急救，不是通勤`);
  // 冲刺尸：Sec 结尾的字段是现实秒，别当游戏分钟减
  QS.Z.length = 0;
  const zs = { kind:'冲刺尸', block:'C', state:'追击', tx:P.x, ty:P.y, x:46.5, y:P.y + 8, hp:3, dash:0, tired:0, lost:600 };
  QS.Z.push(zs);
  let dashed = 0;
  for (let i = 0; i < 60; i++) { const b = zs.y; QS.update(1 / 60); dashed += Math.abs(zs.y - b); }
  ok(dashed > run, `冲刺尸冲起来一秒 ${dashed.toFixed(2)} 格 > 玩家跑 ${run.toFixed(2)} —— 这几秒真的跑不掉`);
  // 【采样窗口要对准要测的那一段】：原来从冲刺开始数 8 秒，里面还有 3 秒在冲，
  // 均速自然高于走速，断言红得莫名其妙。先等冲刺结束，再开表量累瘫那一段。
  // 这是这一轮第四次栽在采样窗口上（市井 T16 也记过一次）。
  let guard = 0;
  while (zs.dash > 0 && guard++ < 60 * 10) QS.update(1 / 60);
  let after = 0, secs = 0;
  for (let i = 0; i < 60 * 4 && zs.tired > 0; i++) { const b = zs.y; QS.update(1 / 60); after += Math.abs(zs.y - b); secs += 1 / 60; }
  ok(secs > 1 && after / secs < walk,
    `冲完累瘫那 ${secs.toFixed(1)} 秒里 ${(after / secs).toFixed(2)} 格/秒 < 玩家走 ${walk.toFixed(2)} —— 付过代价就一定跑得掉`);
  // 噪音按游戏分钟发，不按帧发
  QS.start(1); QS.BLOCKS.forEach(b => b.heat = 0);
  QS.P.x = 46.5; QS.P.y = 40.5;
  for (let i = 0; i < 60; i++) QS.move(0, -1, '走', (1 / 60) / SPM);
  const h1 = QS.BLOCKS.reduce((a, b) => a + b.heat, 0);
  ok(h1 > 0 && h1 < 1, `按住方向键一现实秒，热度只涨了 ${h1.toFixed(3)}（按帧发的话会涨 60 倍）`);
}

sec('移动端');
{
  // 逻辑分辨率跟着视口宽高比走（霓虹教训五），而且要【铺满】
  const save = [global.innerWidth, global.innerHeight];
  const tryLayout = (w, h, touch) => {
    global.innerWidth = w; global.innerHeight = h;
    document.body.classList[touch ? 'add' : 'remove']('touch');
    QS.layout();
    return { vw:QS.VW, vh:QS.VH, s:QS.CSS_SCALE, cw:QS.VW * QS.TS * QS.CSS_SCALE, ch:QS.VH * QS.TS * QS.CSS_SCALE };
  };
  const por = tryLayout(375, 812, true);
  ok(por.cw >= 375 && por.ch >= 812,
    `竖屏 375×812 → ${por.vw}×${por.vh} 格 ×${por.s} = ${por.cw}×${por.ch} CSS 像素，铺满`);
  const lan = tryLayout(812, 375, true);
  ok(lan.cw >= 812 && lan.ch >= 375,
    `横屏 812×375 → ${lan.vw}×${lan.vh} 格 ×${lan.s} = ${lan.cw}×${lan.ch}，也铺满`);
  // 铺满不等于可以裁：多出来的不许超过一格，否则画面下面整条没了
  for (const [w, h] of [[375, 812], [812, 375], [360, 640], [768, 1024], [320, 480]]) {
    const r = tryLayout(w, h, true);
    const overW = r.cw - w, overH = r.ch - h;
    const cell = QS.TS * r.s;
    ok(overW >= 0 && overH >= 0 && overW <= cell && overH <= cell,
      `${w}×${h} → ${r.vw}×${r.vh}格 ×${r.s}，多出 ${overW}×${overH} 像素（不超过一格 ${cell}）`);
  }
  ok(lan.vw > por.vw && lan.vh < por.vh,
    `转屏之后格数真的变了（竖 ${por.vw}×${por.vh} → 横 ${lan.vw}×${lan.vh}）—— 不是把横条塞进竖屏`);
  const tiny = tryLayout(320, 480, true);
  ok(tiny.vw >= QS.TOUCH_MIN.w && tiny.vh >= QS.TOUCH_MIN.h,
    `再小的屏也保证参考框 ${QS.TOUCH_MIN.w}×${QS.TOUCH_MIN.h}（320×480 给了 ${tiny.vw}×${tiny.vh}）`);
  ok(Number.isInteger(por.s) && Number.isInteger(lan.s),
    `触屏的放大倍率是整数（${por.s} / ${lan.s}）—— 忽 1 忽 2 的像素一眼就脏`);
  tryLayout(save[0], save[1], false);
  ok(QS.VW === 17 && QS.VH === 12, `切回桌面又是 ${QS.VW}×${QS.VH}`);
  for (const id of ['id="tc"', 'id="stk"', 'id="bE"', 'id="bR"', 'id="bC"'])
    ok(S.html.includes(id), `${id} 在页面里`);
  ok(/user-scalable=no/.test(S.html), '视口禁掉缩放（否则玩着会被双击放大）');
  ok(/#tc\s*\{[^}]*position:fixed/.test(S.html), '触屏层盖满视口，不是只盖画布（竖屏拇指在画布外）');
  ok(/#tc\s*\{[^}]*touch-action:none/.test(S.html), '触屏层关掉默认手势');
  ok(/overscroll-behavior:none/.test(S.html), '关掉下拉刷新与橡皮筋');
  ok(/body\.touch #tc/.test(S.html), '摇杆只在触屏模式显示');
  ok(/body\.touch \.keyhint\s*\{\s*display:none/.test(S.html), '手机上删掉键盘提示 —— 它没有的东西不该占地方');
  ok(/safe-area-inset/.test(S.html), '按钮避开刘海和小白条');
  ok(/visibilitychange/.test(S.html), '切后台会松开摇杆，回来不会还按着');
  ok(/visualViewport/.test(S.html), 'fit() 听可视视口 —— 地址栏收起会改它');
  ok(/orientationchange/.test(S.html), 'fit() 听横竖屏切换');
  ok(/addEventListener\('touchstart', goTouch/.test(S.html), '第一次真的碰屏幕就切到触屏模式（触屏笔记本也能用）');
  ok(!/if \(!isTouch\) return;/.test(S.html), '监听器总是装上，不因为开局猜错就永久失效');
}

// ---- 10.93) 感知：视锥、游荡、隔墙看不见（手玩报的）----
sec('僵尸的眼睛和脚');
{
  QS.start(7);
  const P = QS.P, SPM = 22.5 / 60;
  ok(QS.SPEED.僵尸游荡 < QS.SPEED.走 * .5,
    `游荡 ${QS.SPEED.僵尸游荡}（${(QS.SPEED.僵尸游荡 / SPM).toFixed(2)} 格/秒）明显慢过玩家走 ${QS.SPEED.走}（${(QS.SPEED.走 / SPM).toFixed(2)}）—— 拖着脚，不是慢跑`);
  ok(QS.SPEED.僵尸追击 > QS.SPEED.僵尸游荡 * 2,
    `追击 ${QS.SPEED.僵尸追击} 是游荡 ${QS.SPEED.僵尸游荡} 的 ${(QS.SPEED.僵尸追击 / QS.SPEED.僵尸游荡).toFixed(1)} 倍 —— 拖着脚的和扑上来的是两个速度`);
  ok(QS.SPEED.僵尸追击 < QS.SPEED.走,
    `追击 ${QS.SPEED.僵尸追击} < 走 ${QS.SPEED.走} —— 走得开一只，所以"跑"是你自己选的，不是被迫的`);
  // 视锥：背对着你就看不见。
  // 【站位要先找一段真的空旷的地方】——第一版把人放在主街上，东边 4 格已经进了
  // 商业街的房子，视线被墙挡住，于是"正对着也没发现"，红得莫名其妙。
  // 这是这一轮第六次栽在测试自己的准备上。
  let ox = -1, oy = -1;
  outer: for (let y = 2; y < QS.TOWN.H - 2; y++) for (let x = 2; x < QS.TOWN.W - 8; x++) {
    let clear = true;
    for (let k = 0; k <= 7; k++) {
      const t = QS.TOWN.tiles[y * QS.TOWN.W + x + k];
      if (t !== QS.TL.草 && t !== QS.TL.路) { clear = false; break; }
    }
    if (clear) { ox = x; oy = y; break outer; }
  }
  ok(ox > 0, `找到一段 8 格全空的地方做视锥测试：(${ox},${oy})`);
  P.x = ox + .5; P.y = oy + .5; P.stance = '走'; QS.TOWN.hour = 12;
  const mk = dir => { QS.Z.length = 0;
    const z = { kind:'普通', block:'C', state:'游荡', hp:3, dash:0, tired:0, lost:0,
                x:P.x + 4, y:P.y, dir, wx:null, wy:null, wt:99 };
    QS.Z.push(z); return z; };
  const away = mk(0);                               // 朝东，玩家在它西边
  QS.update(1 / 60);
  ok(away.state === '游荡', `背对着站 4 格远，它没发现你（视锥 ±${Math.round(60)}°）`);
  const toward = mk(Math.PI);                       // 朝西，正对玩家
  QS.update(1 / 60);
  ok(toward.state === '追击', '正对着你 4 格远，它发现了你');
  const close = mk(0); close.x = P.x + .8;          // 贴身：不管朝哪
  QS.update(1 / 60);
  ok(close.state === '追击', '贴到 0.8 格，背对着也会发现 —— 不能贴着它脸站一整天');
  // 蹲着能缩短它的视距
  P.stance = '蹲行';
  const sneak = mk(Math.PI); sneak.x = P.x + 5;
  QS.update(1 / 60);
  const crouchOK = sneak.state === '游荡';
  P.stance = '走';
  const stand = mk(Math.PI); stand.x = P.x + 5;
  QS.update(1 / 60);
  ok(crouchOK && stand.state === '追击',
    `5 格外：站着被发现，蹲着没有（视距打 ${QS.SIGHT ? QS.SIGHT.蹲行折扣 : .7} 折）`);
  // 游荡的目标要留着走一段，不能每帧重摇
  const w = mk(0); w.wt = 0;
  QS.update(1 / 60); const t1 = [w.wx, w.wy];
  for (let i = 0; i < 20; i++) QS.update(1 / 60);
  ok(w.wx === t1[0] && w.wy === t1[1],
    `游荡目标 21 帧没变（每帧重摇的话它只会原地发抖）`);
  // 隔着墙看不见：墙后面的僵尸不画
  const hs = QS.TOWN.houses[0];
  P.x = hs.x + hs.w / 2; P.y = hs.y + hs.h + 2.5;   // 站在南墙外面
  QS.Z.length = 0;
  const zin = { kind:'普通', block:'A', state:'游荡', hp:3, dash:0, tired:0, lost:0,
                x:hs.x + hs.w / 2, y:hs.y + 2.5, dir:0, wx:null, wy:null, wt:99 };
  QS.Z.push(zin);
  ok(QS.losBlocked(P.x, P.y, zin.x, zin.y) > 0, `屋里那只和你之间隔着 ${QS.losBlocked(P.x, P.y, zin.x, zin.y)} 层墙`);
  QS.setUI('none'); QS.render();
  ok(!QS.__order.some(e => e.kind === 'z'), '墙后面的僵尸一只都没画 —— 隔着墙看不见活的东西');
  zin.x = P.x; zin.y = P.y + 1.5;                    // 挪到屋外、就在跟前
  QS.render();
  ok(QS.__order.some(e => e.kind === 'z'), '挪到眼前就画出来了（这条防的是"culling 写死成永远不画"）');
}

// ---- 10.92) 近战（T6）----
sec('近战');
{
  QS.start(7);
  const P = QS.P, T = QS.TOWN;
  let ox = -1, oy = -1;
  outer2: for (let y = 2; y < T.H - 2; y++) for (let x = 2; x < T.W - 10; x++) {
    let clear = true;
    for (let k = 0; k <= 9; k++) { const t = T.tiles[y * T.W + x + k]; if (t !== QS.TL.草 && t !== QS.TL.路) { clear = false; break; } }
    if (clear) { ox = x; oy = y; break outer2; }
  }
  P.x = ox + 1.5; P.y = oy + .5; P.aim = 0; P.stance = '走';
  const mkz = (dx, dy, hp) => { const z = { kind:'普通', block:'C', state:'追击', tx:P.x, ty:P.y,
    x:P.x + dx, y:P.y + dy, hp, max:hp, dash:0, tired:0, lost:600, dir:Math.PI, wx:null, wy:null, wt:99, down:0, stun:0 };
    QS.Z.push(z); return z; };
  // 武器差的是攻速×硬直×够得着×耐久，不是伤害
  // 【挥到底】：命中现在挂在计时器上（挥到 45% 才结算），
  // 所以测试不能调完 swing() 就查结果 —— 得把时间推过那一下。
  const swingThrough = () => {
    QS.swing();
    for (let i = 0; i < 200 && QS.P.strikeAt > 0; i++) QS.update(1 / 60);
    return QS.toast;
  };
  const W = QS.WEAPON;
  ok(QS.WEP_ORDER.every(w => W[w]), `五件武器都在表里：${QS.WEP_ORDER.join(' ')}`);
  ok(W.菜刀.swingSec < W.斧.swingSec && W.菜刀.dura < W.斧.dura && W.长矛.reach > W.斧.reach,
    `菜刀快(${W.菜刀.swingSec}s)但不经用(${W.菜刀.dura})，斧慢(${W.斧.swingSec}s)但一下顶两下，长矛够得远(${W.长矛.reach} vs ${W.斧.reach})`);
  ok(QS.WEP_ORDER.filter(w => W[w].dmg !== 1).length === 1,
    `五件里只有斧的伤害不是 1 —— 差别在手感不在数字`);
  // 一次只打得中一个
  QS.Z.length = 0;
  const a = mkz(1, 0, 9), b = mkz(1.1, .2, 9);
  P.inv = ['撬棍'];
  const msg = swingThrough();
  const hit = [a, b].filter(z => z.hp < 9).length;
  ok(hit === 1, `两只贴在一起，挥一次只有 ${hit} 只掉血（「${msg}」）—— 规则是"别被围"，不是"一刀一片"`);
  // 收手期间动不了
  const px = P.x;
  QS.move(1, 0, '走', 1);
  ok(P.x === px, `收手期间挪不动（硬直 ${W.撬棍.recoverSec}s）—— 这是近战的全部代价`);
  // 把贴身的清掉再验"能动了"——两只贴着会随机触发踉跄，那是另一条规则
  QS.Z.length = 0;
  for (let i = 0; i < 150; i++) QS.update(1 / 60);
  QS.move(1, 0, '走', 1);
  ok(P.x > px, '收完手又能动了');
  // 打得死
  QS.Z.length = 0; P.x = ox + 1.5; P.y = oy + .5; P.aim = 0;
  const c = mkz(1, 0, 2);
  const k0 = QS.kills;
  for (let s = 0; s < 8 && QS.Z.length; s++) { swingThrough(); for (let i = 0; i < 90; i++) QS.update(1 / 60); }
  ok(QS.Z.length === 0 && QS.kills === k0 + 1, `瘦的那种两三下打死（击杀 ${QS.kills - k0}）`);
  // 空手打不死
  QS.Z.length = 0; P.inv = []; P.x = ox + 1.5; P.y = oy + .5;
  const d2 = mkz(1, 0, 3);
  ok(QS.weapon() === '空手', '背包里没家伙就是空手');
  for (let s = 0; s < 6; s++) { swingThrough(); for (let i = 0; i < 60; i++) QS.update(1 / 60); }
  ok(d2.hp === 3 && QS.Z.length === 1, `空手挥六次打不掉血（只能推开）—— 得找件家伙`);
  // 耐久：会断
  QS.Z.length = 0; P.inv = ['菜刀']; P.dura = {};
  P.x = ox + 1.5; P.y = oy + .5;
  const e2 = mkz(1, 0, 9999);
  // 【每打一下会把它推开】，十几下之后就够不着了，而挥空不算磨损 ——
  // 所以测耐久要把它按回原位。这是设计（打退半步制造间距），不是 bug。
  let swings = 0;
  while (P.inv.includes('菜刀') && swings < 200) {
    e2.x = P.x + 1; e2.y = P.y;
    // 【别把 swing 清零】：那会跳过中段的结算，耐久一点都不磨。
    QS.swing(); P.swing = P.strikeAt; QS.update(1 / 60);   // 直接跳到命中那一刻
    swings++; P.swing = 0; P.recover = 0;
  }
  ok(!P.inv.includes('菜刀') && swings <= W.菜刀.dura + 2,
    `菜刀挥了 ${swings} 下就断了（表里 ${W.菜刀.dura}）`);
  // 打倒 ≠ 打死，但倒地的必须能补刀 —— 否则你把它打趴下之后只能挥空
  QS.Z.length = 0; P.inv = ['撬棍']; P.dura = {};
  P.x = ox + 1.5; P.y = oy + .5; P.aim = 0;
  const f2 = mkz(1, 0, 6); f2.down = 15; f2.hp = 1;
  const before2 = QS.kills;
  const dm = swingThrough();
  ok(QS.kills === before2 + 1, `倒在地上的能补刀（「${dm}」）—— 打倒是机会，不是十几秒的锁`);
  // 游荡状态被打趴下的也得爬得起来（原来这段写在"追击"分支里，它会永远躺着）
  QS.Z.length = 0;
  const g2 = mkz(3, 0, 3); g2.state = '游荡'; g2.down = .2;
  for (let i = 0; i < 60; i++) QS.update(1 / 60);
  ok(g2.down <= 0, `游荡状态倒地的也会爬起来（down=${g2.down.toFixed(2)}）`);

  // 三只按住你一秒半才死，一闪而过不死
  QS.start(7); const P2 = QS.P;
  P2.x = ox + 1.5; P2.y = oy + .5; P2.stance = '走';
  QS.Z.length = 0;
  for (const [dx, dy] of [[.5, 0], [-.5, 0], [0, .5]]) QS.Z.push({ kind:'普通', block:'C', state:'追击',
    tx:P2.x, ty:P2.y, x:P2.x + dx, y:P2.y + dy, hp:3, max:3, dash:0, tired:0, lost:600, dir:0, wx:null, wy:null, wt:99, down:0, stun:0 });
  for (let i = 0; i < 30; i++) QS.update(1 / 60);          // 半秒
  ok(!QS.death, `三只贴上来半秒还没死（按住 ${QS.STAGGER.必死秒}s 才算）`);
  for (let i = 0; i < 120; i++) QS.update(1 / 60);          // 再两秒
  ok(QS.death && QS.death.cause === '被围', `按住两秒半就死了（${QS.death && QS.death.cause}）`);
}

sec('打击手感');
{
  QS.start(7);
  const P = QS.P, T = QS.TOWN;
  let ox = -1, oy = -1;
  outerJ: for (let y = 3; y < T.H - 3; y++) for (let x = 3; x < T.W - 6; x++) {
    let clear = true;
    for (let k = 0; k <= 5 && clear; k++) { const t = T.tiles[y * T.W + x + k]; if (t !== QS.TL.草 && t !== QS.TL.路) clear = false; }
    if (clear) { ox = x; oy = y; break outerJ; }
  }
  P.x = ox + .5; P.y = oy + .5; P.aim = 0; P.inv = ['斧']; P.dura = {};
  QS.Z.length = 0;
  const z = { kind:'普通', block:'C', state:'追击', tx:P.x, ty:P.y, x:P.x + 1.1, y:P.y,
              hp:9, max:9, dash:0, tired:0, lost:600, dir:Math.PI, wx:null, wy:null, wt:99, down:0, stun:0, flash:0 };
  QS.Z.push(z);
  // ① 结算不在按下的那一瞬 —— 先看见动作，再拿到结果
  QS.swing();
  ok(z.hp === 9 && P.strikeAt > 0,
    `按下的那一帧还没结算（血 ${z.hp}，等挥到 ${P.strikeAt.toFixed(2)}s）—— 反过来的话，你先拿到结果再看见动作`);
  let n = 0;
  while (P.strikeAt > 0 && n++ < 200) QS.update(1 / 60);
  ok(z.hp < 9, `挥到中段才掉血（${n} 帧之后，血 ${z.hp}）`);
  // ② 顿帧 + 震屏 + 闪白
  ok(QS.hitstop > 0, `命中冻住了 ${(QS.hitstop * 1000) | 0} 毫秒 —— 最便宜的"打到了"`);
  ok(QS.shake > 0, `命中震了 ${QS.shake.toFixed(1)} 像素`);
  ok(z.flash > 0, `被打的那只在闪白（${z.flash.toFixed(2)}s）`);
  // 顿帧要会自己退
  // 【特效计时走 tickFX，不走 update】——顿帧冻住的正是 update，
  // 放进去就永远解不了冻。这条断言顺带把这个结构钉住。
  for (let i = 0; i < 60; i++) QS.tickFX(1 / 60);
  ok(QS.hitstop === 0 && QS.shake === 0, '顿帧和震屏都会自己退回 0，不会卡住');
  QS.update(1 / 60);
  ok(QS.hitstop === 0, 'update() 不碰顿帧 —— 它被冻住的时候得有别的东西来解冻');
  // ③ 致命的那一下比普通命中更重
  // 【先把上一次挥击收完】：斧是 0.95s 挥 + 0.6s 硬直，
  // 而上面只推到"命中那一刻"（26 帧）就停了 —— 不收完，下一次 swing() 只会回"还没收手"。
  for (let i = 0; i < 120; i++) QS.update(1 / 60);
  QS.Z.length = 0;
  const z2 = { ...z, hp:1, max:1, x:P.x + 1.1, y:P.y, flash:0 };
  QS.Z.push(z2);
  QS.swing(); n = 0;
  while (P.strikeAt > 0 && n++ < 200) QS.update(1 / 60);
  ok(QS.hitstop > .08, `打死那一下冻得更久（${(QS.hitstop * 1000) | 0} 毫秒 > 普通命中的 60）`);
  // ④ 音效不许消耗【游戏的】随机数序列
  const roll = withSfx => {
    QS.start(99);
    QS.P.inv = ['撬棍'];
    if (withSfx) for (let i = 0; i < 30; i++) QS.sfx('命中');
    QS.bite('左小臂');
    return (QS.P.infect ? QS.P.infect.left : -1) + '/' + QS.tileHash();
  };
  ok(roll(false) === roll(true),
    `响了 30 次音效，同种子的结果一模一样（${roll(false)}）—— 视觉与音频的随机单开一条，不碰种子`);
  ok(Object.keys(QS.SFX).length >= 5, `五种音效都在表里：${Object.keys(QS.SFX).join(' ')}`);
  QS.setMute(true); QS.sfx('命中'); QS.setMute(false);
  ok(QS.muted === false, '静音开关来回切不崩');
}

sec('动作感：扫掠 / 垫步 / 连击 / 取消 / 处决');
{
  QS.start(7);
  const P = QS.P, T = QS.TOWN;
  let ox = -1, oy = -1;
  outerA: for (let y = 3; y < T.H - 3; y++) for (let x = 3; x < T.W - 8; x++) {
    let c = true;
    for (let k = 0; k <= 7 && c; k++) { const t = T.tiles[y * T.W + x + k]; if (t !== QS.TL.草 && t !== QS.TL.路) c = false; }
    if (c) { ox = x; oy = y; break outerA; }
  }
  const mk = (dx, hp, down) => { const z = { kind:'普通', block:'C', state:'追击', tx:P.x, ty:P.y,
    x:P.x + dx, y:P.y, hp, max:hp, dash:0, tired:0, lost:600, dir:Math.PI, wx:null, wy:null, wt:99,
    down:down || 0, stun:0, flash:0, hurt:0, hurtA:0 }; QS.Z.push(z); return z; };
  const settle = () => { for (let i = 0; i < 200 && (P.swing > 0 || P.recover > 0); i++) QS.update(1 / 60); };
  const reset = () => { P.x = ox + 1.5; P.y = oy + .5; P.aim = 0; P.inv = ['斧']; P.dura = {};
    P.swing = P.recover = P.strikeAt = P.exec = P.combo = 0; QS.Z.length = 0; };

  // ① 扫掠：目标在挥击【中途】才进入范围，也该打得到
  reset();
  const far = mk(4, 9);                            // 一开始够不着
  QS.swing();
  for (let i = 0; i < 6; i++) QS.update(1 / 60);
  far.x = P.x + 1.1;                               // 挥到一半它凑过来了
  let n = 0; while (P.strikeAt > 0 && n++ < 200) QS.update(1 / 60);
  ok(far.hp < 9, `挥到一半才凑过来的也打得到（血 ${far.hp}）—— 一瞬间的点检测会把它漏掉`);
  ok(far.hurt > 0 && Math.abs(far.hurtA) < .3, `挨打的那只在往挨打的方向踉跄（${far.hurt.toFixed(2)}s）`);
  settle();

  // ② 出手垫半步
  reset();
  mk(1.1, 9);
  const x0 = P.x;
  QS.swing();
  ok(P.x > x0 + .1, `出手时往前垫了 ${(P.x - x0).toFixed(2)} 格 —— 重心跟着武器走`);
  settle();

  // ③ 连击：踩在取消窗口里，下一击更快
  reset();
  mk(1.1, 99);
  QS.swing();
  const slow = P.swing;
  while (P.swing > 0) QS.update(1 / 60);
  while (!QS.inCancel() && P.recover > 0) QS.update(1 / 60);
  ok(QS.inCancel(), `收手的最后 ${(QS.CANCEL * 100) | 0}% 是取消窗口`);
  QS.swing();
  ok(P.swing < slow * .8, `连上了：挥击从 ${slow.toFixed(2)}s 缩到 ${P.swing.toFixed(2)}s，连击数 ${P.combo}`);
  settle();

  // ④ 取消：收手末段能推开，刚收手时不能
  reset();
  mk(1.1, 99);
  QS.swing();
  while (P.swing > 0) QS.update(1 / 60);
  ok(QS.shove() === '还没收手', '刚开始收手时推不了');
  while (!QS.inCancel()) QS.update(1 / 60);
  ok(QS.shove().indexOf('推') === 0, '收手末段可以取消成推开 —— 砍完立刻推开一圈跑');
  settle();

  // ⑤ 处决：对倒地的是一条独立的路，不是普通补刀
  reset();
  const lying = mk(1.1, 5, 15);                    // 血还有 5，但躺着
  const k0 = QS.kills, b0 = [...T.blood].reduce((a, b) => a + b, 0);
  QS.swing();
  n = 0; while (P.strikeAt > 0 && n++ < 200) QS.update(1 / 60);
  ok(QS.kills === k0 + 1, `倒地的一下结果（血还有 5 也照样）—— 处决不看血量`);
  ok(QS.hitstop > .15, `处决冻 ${(QS.hitstop * 1000) | 0} 毫秒，比普通命中的 60 重得多`);
  ok(P.exec > 0, `处决有独立姿势（第 7 列），持续 ${P.exec.toFixed(2)}s`);
  ok([...T.blood].reduce((a, b) => a + b, 0) >= b0 + 3, '处决留一大摊血');
}

sec('动作的拍子');
{
  QS.start(7);
  const P = QS.P, T = QS.TOWN;
  let ox = -1, oy = -1;
  outerP: for (let y = 3; y < T.H - 3; y++) for (let x = 3; x < T.W - 6; x++) {
    let c = true;
    for (let k = 0; k <= 5 && c; k++) { const t = T.tiles[y * T.W + x + k]; if (t !== QS.TL.草 && t !== QS.TL.路) c = false; }
    if (c) { ox = x; oy = y; break outerP; }
  }
  P.x = ox + 1.5; P.y = oy + .5; P.aim = 0; P.inv = ['斧']; P.dura = {};
  P.swing = P.recover = P.strikeAt = P.exec = 0; P.frame = 0;
  QS.Z.length = 0;
  ok(QS.poseSlot() === 0, '站着是走路第 0 帧');
  QS.Z.push({ kind:'普通', block:'C', state:'追击', tx:P.x, ty:P.y, x:P.x + 1.1, y:P.y,
              hp:99, max:99, dash:0, tired:0, lost:600, dir:Math.PI, wx:null, wy:null, wt:99,
              down:0, stun:0, flash:0, hurt:0, hurtA:0 });
  QS.swing();
  ok(QS.poseSlot() === 5, '按下之后是【预备】（胳膊半收，正在抡）—— 不是一上来就伸出去');
  let n = 0; while (P.strikeAt > 0 && n++ < 200) QS.update(1 / 60);
  ok(QS.poseSlot() === 4, `结算之后才是【出手】（挥了 ${n} 帧）`);
  while (P.swing > 0) QS.update(1 / 60);
  ok(QS.poseSlot() === 5, '收手');
  while (P.recover > 0) QS.update(1 / 60);
  ok(QS.poseSlot() === (P.frame & 3), '收完手回到走路帧');
  // 动画时钟跟着 tickFX 走（呼吸这类东西用它），不受顿帧冻结影响
  const t0 = QS.animT;
  for (let i = 0; i < 30; i++) QS.tickFX(1 / 60);
  ok(QS.animT > t0, `动画时钟在走（${t0.toFixed(2)} → ${QS.animT.toFixed(2)}）—— 顿帧冻住的是世界，不是呼吸`);
  ok(!!QS.SFX.脚步, '脚步声在音效表里');
}

sec('推开：被围那一秒半里的答案');
{
  QS.start(7);
  const P = QS.P, T = QS.TOWN;
  let ox = -1, oy = -1;
  outer3: for (let y = 2; y < T.H - 2; y++) for (let x = 2; x < T.W - 10; x++) {
    let clear = true;
    for (let k = 0; k <= 9; k++) { const t = T.tiles[y * T.W + x + k]; if (t !== QS.TL.草 && t !== QS.TL.路) { clear = false; break; } }
    if (clear) { ox = x; oy = y; break outer3; }
  }
  P.x = ox + 4.5; P.y = oy + .5; P.aim = 0; P.stance = '走';
  QS.Z.length = 0;
  const hug = [];
  for (const [dx, dy] of [[.6, 0], [.7, .5], [.5, -.5]]) {
    const z = { kind:'普通', block:'C', state:'追击', tx:P.x, ty:P.y, x:P.x + dx, y:P.y + dy,
                hp:3, max:3, dash:0, tired:0, lost:600, dir:Math.PI, wx:null, wy:null, wt:99, down:0, stun:0 };
    QS.Z.push(z); hug.push(z);
  }
  for (let i = 0; i < 50; i++) QS.update(1 / 60);            // 被按住 0.83 秒
  ok(!QS.death && P.held > .5, `三只按住了 ${P.held.toFixed(2)} 秒，还没死（${QS.STAGGER.必死秒}s 才死）`);
  const before = hug.map(z => Math.hypot(z.x - P.x, z.y - P.y));
  const msg = QS.shove();
  const after = hug.map(z => Math.hypot(z.x - P.x, z.y - P.y));
  ok(before.every(d => d >= QS.SEP_P - .05),
    `没有一只站在你身上（最近的 ${Math.min(...before).toFixed(2)} ≥ ${QS.SEP_P}）—— 它们围成一圈，不叠成一摞`);
  ok(after.every((d, i) => d > before[i] + .8), `一推推开【三只】（${before.map(d => d.toFixed(1)).join('/')} → ${after.map(d => d.toFixed(1)).join('/')}）—— 挥击一次只打一只，推是范围的`);
  ok(P.held === 0, `推完被围的计时清零（${msg}）—— 这就是那一秒半里的答案`);
  ok(hug.every(z => z.hp === 3), '推开不掉血，只制造间距');
  ok(P.recover > 0, `推也有硬直 ${P.recover.toFixed(2)}s —— 不是免费的`);
  // 推完不跑还是会死
  for (let i = 0; i < 60 * 4; i++) { for (const z of hug) { z.tx = P.x; z.ty = P.y; } QS.update(1 / 60); }
  ok(!!QS.death, '推完站着不动，它们围回来照样死 —— 推是为了跑，不是为了赢');
}

// ---- 10.94) 进房子要有用：僵尸和玩家走的不是同一套可通行 ----
sec('墙门窗对谁有效');
{
  QS.start(7);
  const T = QS.TOWN;
  const hs = T.houses.find(h => h.exits.some(e => e.kind === '窗') && h.exits.some(e => e.kind === '门'));
  const win = hs.exits.find(e => e.kind === '窗'), door = hs.exits.find(e => e.kind === '门');
  ok(QS.passable(win.x, win.y) && !QS.zPassable(win.x, win.y),
    `窗：玩家翻得过去，僵尸翻不过去（${hs.type}）`);
  const d = T.doors[door.x + ',' + door.y];
  d.locked = false; d.open = true;
  ok(QS.zPassable(door.x, door.y), '门开着，僵尸走得进来 —— 进屋不关门等于没进');
  d.open = false;
  ok(!QS.zPassable(door.x, door.y), '门关上，僵尸走不进来');
  // 钉了板的窗同样拦得住
  QS.P.inv.push('木板', '钉');
  const bd = QS.board(hs.id);
  ok(bd.did > 0 && !QS.zPassable(win.x, win.y), `钉上 ${bd.did} 块板，窗还是拦得住`);
  // 整条流程走一遍：翻窗进屋，追着的那只六秒进不来
  QS.start(7);
  const T2 = QS.TOWN;
  const h2 = T2.houses.find(h => h.exits.some(e => e.kind === '窗'));
  const w2 = h2.exits.find(e => e.kind === '窗');
  QS.P.x = w2.x + .5; QS.P.y = w2.y + 1.5;
  const msg = QS.interact();
  QS.Z.length = 0;
  const z = { kind:'普通', block:h2.block, state:'追击', tx:QS.P.x, ty:QS.P.y,
              x:QS.P.x, y:QS.P.y + 2, hp:3, dash:0, tired:0, lost:600, dir:0, wx:null, wy:null, wt:99 };
  QS.Z.push(z);
  for (let i = 0; i < 60 * 6; i++) { z.tx = QS.P.x; z.ty = QS.P.y; QS.update(1 / 60); }
  const zin = T2.tiles[Math.floor(z.y) * T2.W + Math.floor(z.x)] === QS.TL.地板;
  ok(QS.P.inside && !zin,
    `玩家「${msg}」进了屋，追了 6 秒的那只还在外面 ${Math.hypot(z.x - QS.P.x, z.y - QS.P.y).toFixed(1)} 格处 —— 进房子是有用的`);
}

// ---- 10.96) 视野、记忆迷雾、地面信息密度（"太丑"那一轮）----
sec('视野与记忆迷雾（默认关，`?fog=1` 开）');
{
  QS.start(7);
  const P = QS.P, T = QS.TOWN;
  // 【默认必须是关的】：试玩的结论是雾更丑不是更好看。
  // 代码留着是为了还能试，不是为了"做都做了就开着"。
  ok(QS.fog === false, '迷雾默认关着 —— 做过不等于该留着');
  QS.setFog(true);                                  // 下面几条验的是"开起来是对的
  // 三档：看见 / 记得 / 从没见过
  ok([...T.seen].every(v => v === 0), `新镇的记忆层是空的（${T.seen.length} 格全 0）`);
  // 站位要先找一段空旷地 —— 站在商业街上，东边六格就是墙，视锥测试必红（第七次了）
  let ox = -1, oy = -1;
  outerF: for (let y = 3; y < T.H - 3; y++) for (let x = 8; x < T.W - 10; x++) {
    let clear = true;
    for (let k = -7; k <= 7 && clear; k++) {
      const t = T.tiles[y * T.W + x + k];
      if (t !== QS.TL.草 && t !== QS.TL.路) clear = false;
    }
    if (clear) { ox = x; oy = y; break outerF; }
  }
  ok(ox > 0, `找到一段左右各 7 格全空的地方做视锥测试：(${ox},${oy})`);
  P.x = ox + .5; P.y = oy + .5; P.aim = -Math.PI / 2;
  QS.setUI('none'); QS.render();
  const seen1 = [...T.seen].reduce((a, b) => a + b, 0);
  ok(seen1 > 10, `朝北站一帧，记住了 ${seen1} 格`);
  for (let k = 0; k < 48; k++) { P.aim = k / 48 * Math.PI * 2; QS.render(); }
  const seen2 = [...T.seen].reduce((a, b) => a + b, 0);
  ok(seen2 > seen1, `原地转一圈，记住的从 ${seen1} 涨到 ${seen2} —— 视锥是真的在挡`);
  // 视锥：背后的格子看不见，正前方看得见
  P.aim = 0;
  ok(QS.canSee(ox + 6, oy), '正前方 6 格看得见');
  ok(!QS.canSee(ox - 6, oy), '背后 6 格看不见（视锥 ±75°）');
  ok(QS.canSee(ox - 2, oy), `背后 2 格看得见（近身 ${QS.SIGHT_T.近身} 格不看朝向）`);
  // 记忆不衰减
  const before = [...T.seen].reduce((a, b) => a + b, 0);
  for (let i = 0; i < 200; i++) QS.render();
  ok([...T.seen].reduce((a, b) => a + b, 0) >= before, '记忆不随时间衰减（不惩罚记性好的人）');
  // 僵尸只在视锥内才画
  QS.Z.length = 0;
  const mkz2 = (dx, dy) => { const z = { kind:'普通', block:'C', state:'游荡', tx:0, ty:0, x:P.x + dx, y:P.y + dy,
    hp:3, max:3, dash:0, tired:0, lost:0, dir:0, wx:null, wy:null, wt:99, down:0, stun:0 }; QS.Z.push(z); return z; };
  P.aim = 0; mkz2(4, 0); mkz2(-4, 0);
  QS.render();
  const drew = QS.__order.filter(e => e.kind === 'z').length;
  ok(drew === 1, `前后各一只，只画出 ${drew} 只 —— 僵尸不画进记忆层（记了就成雷达了）`);
  // 记忆层进镇子档
  QS.P.name = '阿岩'; QS.save();
  const tj = localStorage.getItem('qs.town.' + T.seed) || '';
  ok(/"seen"/.test(tj) && /"blood"/.test(tj), `镇子档里带着记忆层与血迹（${(tj.length / 1024).toFixed(1)}KB）`);
  QS.start(7);
  ok([...QS.TOWN.seen].reduce((a, b) => a + b, 0) === 0, '重开一局，记忆先归零');
  QS.load();
  ok([...QS.TOWN.seen].reduce((a, b) => a + b, 0) > 0, '读档后上一个你探过的地方还亮着 —— 传承又多一样');
  QS.wipeTown(); QS.wipeChar();
  QS.setFog(false);                                 // 关回去，别影响后面的断言
}

sec('地面的信息密度');
{
  QS.start(7);
  const T = QS.TOWN;
  // 每种地面四张变体
  for (const k of [QS.TL.草, QS.TL.路, QS.TL.地板, QS.TL.田])
    ok(QS.TILESET[k] && QS.TILESET[k].length === 4, `瓦片 ${k} 烤了 ${QS.TILESET[k] ? QS.TILESET[k].length : 0} 张变体`);
  // 杂物覆盖率：室外 15% 室内 8%
  let out = 0, outN = 0, ins = 0, insN = 0;
  for (let y = 0; y < T.H; y++) for (let x = 0; x < T.W; x++) {
    const t = T.tiles[y * T.W + x];
    if (t === QS.TL.草 || t === QS.TL.路) { outN++; if (QS.clutterAt(x, y, t)) out++; }
    if (t === QS.TL.地板) { insN++; if (QS.clutterAt(x, y, t)) ins++; }
  }
  const outR = out / outN * 100, insR = ins / insN * 100;
  ok(outR > 10 && outR < 20, `室外杂物覆盖率 ${outR.toFixed(1)}%（目标 15%，${out}/${outN} 格）`);
  ok(insR > 4 && insR < 13, `室内杂物覆盖率 ${insR.toFixed(1)}%（目标 8%，${ins}/${insN} 格）`);
  ok(Object.keys(QS.CLUTTER).length === 8, `手摆了 ${Object.keys(QS.CLUTTER).length} 种杂物小件`);
  ok(Object.values(QS.CLUTTER).every(g => g.length === 8 && g.every(r => r.length === 8)),
    '每种杂物都是 8×8，没有一行长短不齐');
  ok(Object.keys(QS.FACE_ART).length === 3 &&
     Object.values(QS.FACE_ART).every(g => g.length === 10 && g.every(r => r.length === 24)),
    `手摆的立面 ${Object.keys(QS.FACE_ART).join('/')}，每张 24×10 且行宽一致`);
  // 走路的时候地上不许抖 —— 两个源头各钉一条
  QS.P.x = 40.37; QS.P.y = 30.62;                   // 故意给个小数位置
  QS.setUI('none'); QS.render();
  ok(Number.isInteger(QS.cam.x) && Number.isInteger(QS.cam.y),
    `镜头对齐到整数世界像素（${QS.cam.x},${QS.cam.y}）—— 不取整的话每格落点是小数，走一步整张地面都在抖`);
  const o1 = QS.clutterOffset(17, 23);
  QS.P.x = 41.81; QS.P.y = 31.09; QS.render();      // 镜头挪了
  const o2 = QS.clutterOffset(17, 23);
  ok(o1[0] === o2[0] && o1[1] === o2[1],
    `镜头挪动之后，同一格的杂物还在原位（${o1.join(',')}）—— 偏移只看世界坐标，不看屏幕坐标`);

  // 血迹：打死一只留一摊，而且进镇子档
  QS.Z.length = 0; QS.P.inv = ['斧']; QS.P.aim = 0; QS.P.dura = {};
  let bx = -1, by = -1;
  outerB: for (let y = 3; y < T.H - 3; y++) for (let x = 3; x < T.W - 4; x++) {
    const a = T.tiles[y * T.W + x], b = T.tiles[y * T.W + x + 1];
    if ((a === QS.TL.草 || a === QS.TL.路) && (b === QS.TL.草 || b === QS.TL.路)) { bx = x; by = y; break outerB; }
  }
  QS.P.x = bx + .5; QS.P.y = by + .5;
  QS.Z.push({ kind:'普通', block:'C', state:'追击', tx:QS.P.x, ty:QS.P.y, x:QS.P.x + 1, y:QS.P.y,
              hp:1, max:1, dash:0, tired:0, lost:600, dir:Math.PI, wx:null, wy:null, wt:99, down:0, stun:0 });
  const b0 = [...T.blood].reduce((a, b) => a + b, 0);
  QS.swing();
  for (let i = 0; i < 200 && QS.P.strikeAt > 0; i++) QS.update(1 / 60);
  ok([...T.blood].reduce((a, b) => a + b, 0) > b0,
    `打死一只，地上留了血 —— "这条街我清过"看得见`);
}

sec('墙是细的，而且认邻居');
{
  QS.start(7);
  const T = QS.TOWN;
  ok(QS.WTH < QS.TS / 2, `墙厚 ${QS.WTH} < 半格 ${QS.TS / 2} —— 墙是一条线，不是一块砖`);
  // 盒子必须真的立起来：顶面在 footprint 之上，立面填在中间
  const g = QS.boxGeom(100, QS.WTH, QS.WALL_H);
  ok(g.topY < 100, `顶面在 footprint 之上 ${100 - g.topY} 像素 —— 不抬升就是"有厚度的俯视"，不是 2.5D`);
  ok(g.faceY + QS.WALL_H === g.baseY, `立面从 ${g.faceY} 填到底边 ${g.baseY}，正好 ${QS.WALL_H} 高`);
  ok(g.topY + QS.WTH === g.faceY, '顶面下缘和立面上缘接得上，中间没有缝');
  ok(QS.WALL_H > QS.TS / 2, `层高 ${QS.WALL_H} > 半格 ${QS.TS / 2} —— 矮了就读不出立起来`);
  // 找一段竖墙，中间那几格的上下都该是墙
  let vx = -1, vy = -1;
  outerW: for (let y = 2; y < T.H - 4; y++) for (let x = 2; x < T.W - 2; x++)
    if (QS.wallLike(x, y) && QS.wallLike(x, y + 1) && QS.wallLike(x, y + 2) && QS.wallLike(x, y + 3)) { vx = x; vy = y + 1; break outerW; }
  ok(vx > 0, `找到一段竖墙：(${vx},${vy})`);
  const m = QS.wallMask(vx, vy);
  ok((m & 1) && (m & 2), `竖墙中段的掩码 ${m} 同时有上下邻居 —— 受光边和立面都不该在这里重画`);
  // 找一段横墙
  let hx = -1, hy = -1;
  outerH: for (let y = 2; y < T.H - 2; y++) for (let x = 2; x < T.W - 4; x++)
    if (QS.wallLike(x, y) && QS.wallLike(x + 1, y) && QS.wallLike(x + 2, y) && QS.wallLike(x + 3, y)) { hx = x + 1; hy = y; break outerH; }
  const mh = QS.wallMask(hx, hy);
  ok((mh & 4) && (mh & 8), `横墙中段的掩码 ${mh} 同时有左右邻居 —— 带子会连起来，不是一格一块`);
  // 门窗算墙的一部分，否则墙会在门口断开
  const hs = T.houses[0], door = hs.exits.find(e => e.kind === '门');
  ok(QS.wallLike(door.x, door.y), '门算"墙一类"，不然墙会在门口断开');
}

sec('人物真的在动');
{
  const G = require('./survivor_gen');
  // 「人物没有动作」是手玩报的：原来四帧里有两帧【完全一样】，抬脚和摆手都只有 1 像素。
  // 这条断言就是那次的回归闸门。
  let same = 0, diffs = [];
  for (let f = 0; f < 4; f++) {
    const a = G.draw(G.JOBS.木匠, f).d, b = G.draw(G.JOBS.木匠, (f + 1) & 3).d;
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      const ca = a[i] ? a[i].join(',') : '', cb = b[i] ? b[i].join(',') : '';
      if (ca !== cb) n++;
    }
    diffs.push(n); if (n === 0) same++;
  }
  ok(same === 0, `四帧两两相邻都不一样（差异 ${diffs.join('/')} 格）—— 原来 0 和 2 是同一张图`);
  ok(Math.min(...diffs) > 120,
    `最小的一对也差 ${Math.min(...diffs)} 个像素（一帧 ${G.LW * G.LH} 格）—— 走起来看得出来`);
  // 四向必须真的不一样 —— 不然"加了朝向"等于没加
  const sig = d => G.draw(G.JOBS.木匠, 0, d).d.map(c => c ? c.join(',') : '').join('|');
  const sigs = [0, 1, 2, 3].map(sig);
  ok(new Set(sigs).size === 4, `四个朝向两两不同（南/北/西/东）`);
  ok(sig(2) !== sig(3), '西和东不是同一张图（一个是另一个的镜像）');
  // 【别拿"暗像素"当脸】：背面的黑头发也是暗的，第一版就这么红了一次。
  // 要查的是【脸那块有没有皮肤】—— 背面是一片后脑勺，不该露脸。
  const front = G.draw(G.JOBS.木匠, 0, 0), back = G.draw(G.JOBS.木匠, 0, 1);
  // 【要拿只可能属于那个部件的东西当证据】。
  // 这条断言错过两次：第一版拿"暗像素"当脸 —— 黑头发也暗；
  // 第二版拿"肤色"当脸 —— 浅棕色头发也满足 r>g>b 且 r>120。
  // 眼白是整张图上最亮的颜色（唯一不过 grade() 的），头发衣服都到不了，指向明确。
  const eyeWhite = c => c && c[0] > 230 && c[1] > 230 && c[2] > 225;
  // 【不写死坐标】：上一版把脸框死在 x11~20，人物一改尺寸采样区就落到头发上，
  //  正面只数到 2 个皮肤像素 —— 写死的数字是在等着失败。
  //  改成按导出的头部行范围扫【整行宽】，脖子那几行排除掉（背面也有脖子）。
  const eyes = px => { let n = 0;
    for (let y = G.HY0; y < G.HY0 + G.HH; y++) for (let x = 0; x < G.LW; x++) if (eyeWhite(px.get(x, y))) n++;
    return n; };
  ok(eyes(front) >= 4 && eyes(back) === 0,
    `正面头上有 ${eyes(front)} 个眼白像素，背面 ${eyes(back)} 个 —— 背面是后脑勺，不该有脸`);
  // 朝向要跟瞄准角对得上
  const QSd = QS.dirOf;
  ok(QSd(0) === 3 && QSd(Math.PI / 2) === 0 && QSd(Math.PI) === 2 && QSd(-Math.PI / 2) === 1,
    '瞄准角折成四向：0=东 π/2=南 π=西 −π/2=北');
  const W0 = G.draw(G.JOBS.木匠, 0), W1 = G.draw(G.JOBS.木匠, 1);
  ok(W0.d.length === W1.d.length, '每帧尺寸一致');
  // 密度：桌面上人物占 96×126 CSS 像素，太稀就是"糊"。这条是"优化人物"那轮的回归闸门。
  let fill = 0, n = 0;
  for (const k in G.JOBS) { fill += G.draw(G.JOBS[k], 0).d.filter(Boolean).length; n++; }
  const avg = Math.round(fill / n);
  ok(avg > 400, `六个职业平均每帧 ${avg} 个非空像素（一帧 ${G.LW * G.LH} 格）—— 太稀就读成一块色`);
  // 光向要统一：躯干、腿、手臂、头发的受光侧都该在【左】
  const px0 = G.draw(G.JOBS.木匠, 1);
  const lum = (x, y) => { const c = px0.get(x, y); return c ? c[0] * .3 + c[1] * .59 + c[2] * .11 : null; };
  // 同样不写死 x：每行自己找最左和最右的实心像素，再往里收一格取样。
  // 人物一加宽，写死的 x 就采到空气里去了。
  let leftBright = 0, pairs = 0;
  for (let y = G.TY0 + 1; y < G.TY0 + 9; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0; x < G.LW; x++) if (px0.get(x, y)) { if (x0 < 0) x0 = x; x1 = x; }
    if (x1 - x0 < 6) continue;
    const l = lum(x0 + 1, y), r = lum(x1 - 1, y);
    if (l != null && r != null) { pairs++; if (l > r) leftBright++; }
  }
  ok(pairs > 3 && leftBright / pairs > .7,
    `躯干 ${pairs} 行里有 ${leftBright} 行是左亮右暗 —— 光向统一在左上，不是各亮各的`);
  // ── 人得是一整块 ──
  // 手摆底板是按【部件 + 位移】拼的，部件一动就可能从躯干上掉下来。
  // 这条今天抓到四个真 bug：手臂整条飞出去、处决帧手臂成虚线、胯部裂开、肩头断一格。
  // 数四连通块：>1 就说明有零件掉了。
  const blobs = px => {
    const seen = new Uint8Array(G.LW * G.LH); let n = 0;
    for (let i = 0; i < G.LW * G.LH; i++) {
      if (!px.d[i] || seen[i]) continue;
      n++; const st = [i]; seen[i] = 1;
      while (st.length) {
        const j = st.pop(), x = j % G.LW, y = (j / G.LW) | 0;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + a, Y = y + b, k = Y * G.LW + X;
          if (X >= 0 && Y >= 0 && X < G.LW && Y < G.LH && px.d[k] && !seen[k]) { seen[k] = 1; st.push(k); }
        }
      }
    }
    return n;
  };
  const broken = [];
  for (let d = 0; d < 4; d++) {
    for (let f = 0; f < 4; f++) { const n = blobs(G.draw(G.JOBS.木匠, f, d, 0)); if (n > 1) broken.push(`向${d}走${f}=${n}`); }
    for (let a = 1; a <= 3; a++) { const n = blobs(G.draw(G.JOBS.木匠, 0, d, a)); if (n > 1) broken.push(`向${d}招${a}=${n}`); }
  }
  ok(broken.length === 0, `28 帧每帧都是一整块${broken.length ? '：' + broken.join(' ') : ''} —— 部件没从身上掉下来`);
}

sec('搜刮：格、公斤、拿与放');
{
  QS.start(4242);
  const P = QS.P;
  // ── 开容器不等于拿走 ──
  // 原来互动一按，东西【全自动进包】，然后才弹面板告诉你拿到了什么。
  // 那不是操作界面，是事后通知，而且你没有任何选择。
  const ci = QS.TOWN.containers.findIndex(c => c.items.length >= 2);
  const c = QS.TOWN.containers[ci];
  const nBefore = c.items.length, invBefore = P.inv.length;
  QS.openContainer(ci);
  ok(c.items.length === nBefore && P.inv.length === invBefore,
    `翻开${c.kind}之后柜子里还是 ${c.items.length} 件、包里还是 ${P.inv.length} 件 —— 开不等于拿`);
  ok(QS.__ui === 'loot' && P.open && P.open.id === ci, '翻开会把面板指到这个容器上');

  // ── 背不背得动，不是装不装得下 ──
  // 【格子去掉了】：它只是在你和"拿不拿"之间多加一道算术，而那道算术不产生决定。
  // 真正的决定是"背这么重值不值" —— 公斤自己就说清楚了。
  P.inv = []; P.worn = [];
  ok(QS.kgLine() === 15, `空身时 ${QS.kgLine()}kg 开始超重`);
  P.worn = ['背包'];
  ok(QS.kgLine() === 15 + QS.PACK_KG,
    `背上背包之后线推到 ${QS.kgLine()}kg —— 背包的作用是【多背 ${QS.PACK_KG} 公斤才开始变慢】，不是多几个格子`);

  // ── 拿：永远拿得走，只是会变重 ──
  P.worn = []; P.inv = [];
  const many = c.items.length;
  for (let i = 0; i < many; i++) QS.takeItem(ci, 0);
  ok(c.items.length === 0 && P.inv.length === many,
    `柜子里 ${many} 件全拿得走 —— 没有"装不下"这回事了`);

  // ── 放回去能减重 ──
  const kgBefore = QS.loadKg();
  QS.putItem(0);
  ok(QS.loadKg() < kgBefore,
    `放回一件之后从 ${kgBefore.toFixed(1)}kg 降到 ${QS.loadKg().toFixed(1)}kg —— 容器是临时储藏点，也是超重时唯一的出路`);

  // ── 背包穿得上 ──
  // 原来 useItem 对"背包"三个分支一个都不沾，把它原样塞回包里 ——
  // 于是它那条规则根本够不着，是死的。
  P.inv = ['背包']; P.worn = [];
  const lineBefore = QS.kgLine();
  QS.useItem('背包');
  ok(P.worn.includes('背包') && QS.kgLine() === lineBefore + QS.PACK_KG,
    `背上背包：超重线 ${lineBefore}kg → ${QS.kgLine()}kg`);

  // ── 三档负重 ──
  QS.start(4242); QS.P.inv = []; QS.P.worn = [];
  ok(QS.loadTier() === 0, '空手是第 0 档');
  QS.P.inv = Array(9).fill('汽油');                // 9 × 3kg = 27kg
  ok(QS.loadTier() === 2, `27kg 是第 2 档（走不动），线在 ${QS.kgLine()}kg`);
  const y0 = QS.P.y;
  QS.move(0, 1, '走', 1);
  ok(QS.P.y === y0, '第 2 档真的挪不动 —— 不是"走得慢"');
  QS.P.inv = Array(6).fill('汽油');                // 18kg
  ok(QS.loadTier() === 1, `18kg 是第 1 档（超重：移速 ×0.65、噪音 ×1.5）`);
  QS.P.worn = ['背包'];
  ok(QS.loadTier() === 0,
    `同样 18kg，背上背包就不超重了（线 ${QS.kgLine()}kg）—— 背包是【背得更多】，看得见`);

  // ── 面板是能点的 ──
  QS.start(4242);
  const ci2 = QS.TOWN.containers.findIndex(x => x.items.length >= 1);
  QS.P.inv = [];
  QS.openContainer(ci2);
  QS.render();
  const rows = QS.uiHit.length;
  ok(rows >= 4, `面板上有 ${rows} 个可点区域（两个页签 + 若干行 + 全拿/关闭）—— 画在画布上的 UI 得自己做命中测试`);
  const boxBefore = QS.TOWN.containers[ci2].items.length;
  // 【认物品行要按宽度，不是按顺序】：页签和底部的全拿/关闭都是半宽，
  //  只有物品行是整宽。上一版随手挑了第一个命中区，挑到的是页签 ——
  //  点它等于切到当前这一页，什么都没变，于是断言红了却怪不到功能头上。
  const maxW = Math.max(...QS.uiHit.map(h => h.w));
  const row = QS.uiHit.find(h => h.w === maxW);
  QS.uiTap(row.x + 2, row.y + 2);
  ok(QS.TOWN.containers[ci2].items.length === boxBefore - 1 && QS.P.inv.length === 1,
    `点物品行真的把东西拿过来了（柜子 ${boxBefore} → ${QS.TOWN.containers[ci2].items.length}，包里 ${QS.P.inv.length}）`);
}

sec('画布 UI 不许超出可见区');
{
  // 布局为了"铺满"允许画布比视口宽最多一格（见"移动端"那一节）。
  // 而浏览器在子元素超宽时会把居中【退化成靠左】—— 多出来的全在右边。
  // 320px 的屏上，面板右边的"装不下""关闭"就这么被切掉了。
  const save = [global.innerWidth, global.innerHeight];
  const bad = [];
  for (const [w, h] of [[320, 568], [375, 812], [360, 640], [414, 896]]) {
    global.innerWidth = w; global.innerHeight = h;
    document.body.classList.add('touch');
    QS.layout(); QS.setTouch(true);
    QS.start(4242);
    const ci = QS.TOWN.containers.findIndex(c => c.items.length >= 2);
    QS.P.x = QS.TOWN.containers[ci].x + .5; QS.P.y = QS.TOWN.containers[ci].y + 1.5;
    QS.openContainer(ci);
    QS.render();
    const vx = QS.visX(), CW = QS.VW * QS.TS;
    // 可见区本身要正确：画布多宽，看得见的就该少那么多
    const over = CW - Math.floor(w / QS.CSS_SCALE);
    if (over > 0 && Math.round(vx.x1) > CW - over + 1) bad.push(`${w}px 可见区算错(${Math.round(vx.x1)}/${CW - over})`);
    for (const r of QS.uiHit)
      if (r.x < vx.x0 - 1 || r.x + r.w > vx.x1 + 1) bad.push(`${w}px 面板伸出可见区(${r.x}~${r.x + r.w} 超出 ${Math.round(vx.x0)}~${Math.round(vx.x1)})`);
    // 提示条也一样：它是居中的，两头都会被切
    if (QS.toastW('在民宅的橱柜里翻到 罐头、火柴、干粮、瓶装水、绷带。') > vx.x1 - vx.x0 - 11)
      bad.push(`${w}px 提示条超出可见区`);
  }
  ok(bad.length === 0, `四种窄屏上画布 UI 都在可见区内${bad.length ? '：' + bad.join('；') : ''}`);
  QS.setUI('none'); QS.setTouch(false);
  document.body.classList.remove('touch');
  global.innerWidth = save[0]; global.innerHeight = save[1]; QS.layout();
}

sec('背包里能对物品做什么');
{
  QS.start(4242);
  const P = QS.P;
  // ── 伤口是一道【有顺序的工序】，不是"物品的用法" ──
  // treat() 以前只定义、【从没被调用过】—— 被咬了根本没办法包扎，绷带在包里是死重。
  P.wounds = [{ part:'右手', type:'咬', treated:[] }];
  P.inv = [];
  const lack = QS.treatNext(0);
  ok(/缺瓶装水/.test(lack) && P.wounds[0].treated.length === 0,
    `缺东西就明说缺什么（"${lack}"），而且不会白白把这一步算掉`);
  P.inv = ['瓶装水', '酒精', '针线', '绷带'];
  const seq = [];
  for (let i = 0; i < 5; i++) seq.push(QS.treatNext(0));
  ok(P.wounds[0].treated.join('→') === '清洗→消毒→缝合→包扎',
    `咬伤按顺序走完四步：${P.wounds[0].treated.join('→')}`);
  ok(P.inv.length === 0, `四件耗材都用掉了（剩 ${P.inv.length} 件）`);
  ok(/处理完/.test(seq[4]), `处理完之后再点会说清楚（"${seq[4]}"）`);
  // 抓伤只有两步 —— 别把所有伤口当成一样的
  P.wounds = [{ part:'左腿', type:'抓', treated:[] }];
  ok(QS.nextStep(P.wounds[0]) === '消毒', '抓伤的第一步是消毒，不是清洗');

  // ── 背包里每件东西都要能【做点什么】或者【丢掉】 ──
  P.wounds = [];
  P.inv = ['罐头', '外套', '撬棍', '木板'];
  P.worn = [];
  QS.useItem('外套');
  ok(P.worn.includes('外套'), '外套穿得上');
  const before = P.inv.length;
  QS.useItem('罐头');
  ok(P.inv.length === before - 1 && P.body.饥饿 > 0, '罐头吃得掉');
  // 木板没有直接用法，但至少得能丢 —— 不然背多了只能站着
  P.inv = ['木板', '木板', '汽油'];
  P.open = null; QS.setUI('loot'); QS.setTouch(true); QS.render();
  const drop = QS.uiHit.find(h => h.w < 40 && h.h <= 16);
  ok(!!drop, '每行右边都有一个「丢」的可点区域');
  const n0 = P.inv.length;
  drop.act();
  ok(P.inv.length === n0 - 1, `丢得掉（${n0} → ${P.inv.length}）—— 以前只有开着容器才能放回，野外背多了就只能站着`);
  QS.setUI('none'); QS.setTouch(false); P.open = null;
}

sec('走路的拍子');
{
  // 【四帧等长就是节拍器】。这和画得好不好无关，纯粹是时间分配。
  // 但【正面和侧面不能用同一张表】：正面视角两个着地帧本来就像
  //（量出来只差 792 像素，侧面是 2396）——再让它们各占 32%，
  // 就是 64% 的时间画面几乎不动然后两下快闪，那是"发粘"不是"有重量"。
  const sum = b => b.reduce((x, y) => x + y, 0);
  const spread = b => Math.max(...b) / Math.min(...b);
  for (const [name, b] of [['正面', QS.WALK_BEAT], ['侧面', QS.WALK_BEAT_P], ['跑', QS.RUN_BEAT]])
    ok(Math.abs(sum(b) - 1) < 1e-9, `${name}的拍子表归一（${sum(b)}）`);
  ok(spread(QS.WALK_BEAT) > 1.15,
    `正面四拍仍然不等长（最长/最短 = ${spread(QS.WALK_BEAT).toFixed(2)}）—— 等长就是节拍器`);
  ok(spread(QS.WALK_BEAT_P) > spread(QS.WALK_BEAT),
    `侧面比正面更不均（${spread(QS.WALK_BEAT_P).toFixed(2)} > ${spread(QS.WALK_BEAT).toFixed(2)}）` +
    ` —— 侧面腿的前后摆动看得清楚，拉长着地才有重量；正面看不清，拉长只会发粘`);

  // 量实际停留：按 60fps 推一遍相位
  const hold = (running, profile) => {
    const h = [0, 0, 0, 0], tick = 1 / 60, rate = running ? 10.5 : 6.4;
    let t = 0;
    for (let i = 0; i < 6000; i++) { h[QS.frameAt((t % 4) / 4, running, profile)] += tick; t += tick * rate; }
    const s = sum(h);
    return h.map(x => x / s);
  };
  const f = hold(false, false), p = hold(false, true), r = hold(true, false);
  const contact = a => a[0] + a[2];
  ok(contact(p) > contact(f),
    `着地占比 侧面 ${(contact(p) * 100).toFixed(0)}% > 正面 ${(contact(f) * 100).toFixed(0)}%`);
  ok(contact(r) < contact(p),
    `跑起来着地降到 ${(contact(r) * 100).toFixed(0)}% —— 跑的腾空时间更长`);
  ok(Math.max(...f) / Math.min(...f) > 1.15 && Math.max(...p) / Math.min(...p) > 1.5,
    `实际停留都不均（正面 ${f.map(x => (x * 100).toFixed(0)).join('/')}，侧面 ${p.map(x => (x * 100).toFixed(0)).join('/')}）`);

  // ── 挥一下要多久 ──
  // 1.2~1.55 秒在动作游戏里太慢。整体砍三成，但保持武器之间的相对关系。
  const W = QS.WEAPON;
  const full = k => W[k].swingSec + W[k].recoverSec;
  ok(full('撬棍') < 1.0, `撬棍挥一下 ${full('撬棍').toFixed(2)} 秒（改前 1.20）`);
  ok(full('斧') < 1.2, `斧挥一下 ${full('斧').toFixed(2)} 秒（改前 1.55）`);
  ok(full('菜刀') < full('锤') && full('锤') < full('撬棍') && full('撬棍') < full('长矛') && full('长矛') < full('斧'),
    `轻重次序没被砍乱：菜刀 ${full('菜刀').toFixed(2)} < 锤 ${full('锤').toFixed(2)} < 撬棍 ${full('撬棍').toFixed(2)} < 长矛 ${full('长矛').toFixed(2)} < 斧 ${full('斧').toFixed(2)}`);

  // ── 侧面走动时上身往前压 ──
  ok(/const lx = \(P\.moving && dNow >= 2\)/.test(S.html),
    '侧面走动时上身往前压一格 —— 直上直下地平移是滑行，不是走路');
  ok((S.html.match(/e\.x - 16 \+ lx/g) || []).length >= 2,
    '贴花跟着一起压 —— 不跟的话武器会从手里飞出去');
}

sec('装备了看得见');
{
  // 「装备了武器，人物没变化」查出来是两层：
  // 1) 贴花图集生成了十七行，但【从没嵌进游戏，也从没画过】；
  // 2) 武器贴花还按旧的 32×42 坐标画，人换成 48×63 之后落在小臂中段，
  //    而且撬棍只有"1 像素宽 8 像素高的一条线" —— 差 4 个逻辑像素，等于看不见。
  ok(/^deco\.src='data:image\/png;base64,[A-Za-z0-9+/=]{100,}';/m.test(S.html),
    '贴花图集真的嵌进了游戏 —— 以前只写到 assets/，游戏里一张都没有');
  ok(/DECAL_ROW/.test(S.html) && /武器·撬棍/.test(S.html), '游戏里有贴花行号表');
  ok(/put\('武器·'\s*\+\s*w\)/.test(S.html), '手上那把真的画到人身上');

  const G = require('./survivor_gen.js');
  const px = w => G.decal('武器', 0, { weapon:w }, 0, 0).d.filter(Boolean).length;
  const sizes = ['撬棍', '斧', '锤', '长矛', '菜刀'].map(w => `${w} ${px(w)}`);
  const min = Math.min(...['撬棍', '斧', '锤', '长矛', '菜刀'].map(px));
  ok(min >= 24, `五把武器最小的也有 ${min} 个逻辑像素（${sizes.join('、')}）—— 4 个像素等于看不见`);

  // ── 武器要长在手上，不是长在小臂上 ──
  // 以前贴花自己一套坐标、底板另一套，于是"手在动而家伙不动"。
  const off = [];
  for (const dir of [0, 1, 3]) for (const slot of [0, 1, 2, 3, 4]) {
    const [hx, hy] = G.handAt(dir, slot);
    const d = G.decal('武器', slot < 4 ? slot : 0, { weapon:'斧' }, dir, slot < 4 ? 0 : 1).d;
    let near = 0, tot = 0;
    for (let i = 0; i < d.length; i++) if (d[i]) {
      tot++;
      const x = i % G.LW, y = (i / G.LW) | 0;
      if (Math.abs(x - hx) <= 6 && Math.abs(y - hy) <= 18) near++;
    }
    if (!tot || near / tot < .9) off.push(`向${dir}帧${slot}(${near}/${tot})`);
  }
  ok(off.length === 0, `每一帧武器都长在手上${off.length ? '：' + off.join(' ') : ''} —— 贴花和底板用同一套位移`);

  // 五把互相不一样，不然"换了武器"看不出来
  const sigs = new Set(['撬棍', '斧', '锤', '长矛', '菜刀'].map(w =>
    G.decal('武器', 0, { weapon:w }, 0, 0).d.map(c => c ? 1 : 0).join('')));
  ok(sigs.size === 5, `五把武器的剪影两两不同（${sigs.size}/5）`);

  ok(S.html.includes('id="bP"'), '手机上有打开背包的按钮 —— 没有它就没法换武器（Tab 在手机上不存在）');
}

sec('装备与提示条');
{
  QS.start(4242);
  const P = QS.P;
  // ── 「撬棍怎么装备」以前【没有答案】 ──
  // weapon() 从一张写死的优先级表里挑第一个你身上有的，你不能选，
  // 也没有任何地方告诉你它是怎么挑的。
  P.inv = ['撬棍', '斧']; P.wep = null;
  const auto = QS.weapon();
  ok(auto === '斧', `不选的时候仍按优先级自动挑（${auto}）—— 开局不用先做家务`);
  QS.equip('撬棍');
  ok(QS.weapon() === '撬棍' && QS.wep === '撬棍', `拿起撬棍之后手上就是撬棍（不再是${auto}）`);
  QS.equip('撬棍');
  ok(QS.wep === null && QS.weapon() === auto, '再点一次交回自动挑 —— 不会把自己锁死在一把烂武器上');
  QS.equip('斧');
  P.inv = P.inv.filter(x => x !== '斧');           // 斧断了/丢了
  ok(QS.weapon() === '撬棍', '选中的那把没了就自动退回优先级 —— 不会变成空手');

  // ── 纯背包页（Tab）──
  // 拆 lootPanel 的时候写坏过一次：新面板要求 P.open 有值，而 Tab 没有容器，
  // 于是 Tab 打开背包直接变成死的。
  P.open = null; QS.setUI('loot');
  QS.render();
  ok(QS.__ui === 'loot' && QS.uiHit.length >= 2,
    `没有容器也能开背包页（${QS.uiHit.length} 个可点区域）—— Tab 看背包不需要柜子`);

  // ── 提示条不许伸出画布 ──
  const CW = QS.VW * QS.TS;
  const long = '在民宅的橱柜里翻到 罐头、火柴、干粮、瓶装水、绷带、螺丝刀、胶带。';
  const w = QS.toastW(long);
  ok(w <= CW - 12, `${long.length} 字的句子框宽 ${w}，画布 ${CW} —— 框子不伸出屏幕`);
  ok(QS.toastW('短') < QS.toastW('长一点的一句话'),
    '宽度是【量】出来的，短句子不会占一整条');
  ok(QS.toastW('aaaaaaaa') < QS.toastW('中中中中中中中中'),
    '八个英文字母比八个汉字窄 —— 按字数乘 9 的老算法对中英混排是错的');
  QS.setUI('none'); P.open = null;
}

sec('移动端的界面');
{
  // ── 人不能被自己的按钮埋掉 ──
  // 触屏底下约三成是摇杆和按钮的地盘。镜头一顶死在地图下边界，
  // 人就被压到屏幕最底下 —— 而开局就在镇外南缘，这是手机上第一眼撞到的问题。
  QS.start(7);
  QS.setTouch(true);
  const CH = QS.VH * QS.TS;
  QS.P.x = QS.W / 2; QS.P.y = QS.H - 1.5;          // 贴着地图南缘站
  QS.render();
  const frac = (QS.P.y * QS.TS - QS.cam.y) / CH;
  ok(frac > 0 && frac < .72,
    `贴着地图南缘时人在屏幕 ${(frac * 100).toFixed(0)}% 高度 —— 底下三成是按钮，人不能站在那儿`);
  // 桌面不该越界：越界等于在地图外面留一条黑边，桌面没有按钮挡人，没必要付这个代价
  QS.setTouch(false);
  QS.render();
  const fracD = (QS.P.y * QS.TS - QS.cam.y) / (QS.VH * QS.TS);
  ok(fracD > frac,
    `同一个位置，桌面上人在 ${(fracD * 100).toFixed(0)}%、触屏上在 ${(frac * 100).toFixed(0)}% —— 越界只给触屏`);

  // ── 浮层：开着的时候要能关、要压暗、控件要收起 ──
  ok(/body\.modal #tc\s*\{\s*display:none/.test(S.html),
    '浮层打开时收起触屏控件 —— 不收的话按钮盖在面板上');
  ok(/id="mclose"/.test(S.html) && /body\.touch\.modal #mclose/.test(S.html),
    '有整屏的"轻点关闭"接收层 —— 手机上没有 Esc 键');
  ok(S.html.includes('id="bJ"'),
    '手机上有打开日志的按钮 —— J 键在手机上不存在，原来根本打不开');
  ok(/function panel[\s\S]{0,400}fillRect\(0, 0, CW, CH\)/.test(S.html),
    '浮层把底下压暗 —— 两层信息一起抢眼睛，面板上的字就读不进去');
}



// ---- 10.95) 伪 2.5D：谁先画谁后画 ----
sec('立面与遮挡');
{
  QS.start(7);
  const hs = QS.TOWN.houses.find(h => h.type === '五金') || QS.TOWN.houses[0];
  QS.P.x = hs.x + hs.w / 2; QS.P.y = hs.y + hs.h - 1.5;      // 站在南墙里侧
  QS.setUI('none'); QS.render();
  const o = QS.__order;
  ok(o.length > 20, `一帧里按行画了 ${o.length} 件东西`);
  let bad = 0;
  for (let i = 1; i < o.length; i++) if (o[i].row < o[i - 1].row) bad++;
  ok(bad === 0, `行号一路不减（从上往下画）：逆序 ${bad} 次`);
  const me = o.findIndex(e => e.kind === 'p');
  ok(me > 0, `玩家排在第 ${me} 位`);
  const myRow = o[me].row;
  const wallAfter = o.slice(me).filter(e => e.kind === 'prop' && e.row > myRow).length;
  ok(wallAfter > 0,
    `玩家画完之后还有 ${wallAfter} 件更南边的物件要画 —— 南墙会盖住他的脚，这就是"站在墙后面"`);
  const before = o.slice(0, me).every(e => e.row <= myRow);
  ok(before, '画在玩家之前的，行号都不比他大（北边的墙被他挡住，不是反过来）');
  ok(QS.WALL_H > 0 && QS.PROP_H > 0 && QS.WALL_H > QS.PROP_H,
    `层高：墙 ${QS.WALL_H} > 家具 ${QS.PROP_H} 世界像素`);
}

// ---- 11) render() 必须真的被调用，而且每条路径都画过（霓虹教训二）----
sec('绘制路径');
{
  QS.start(5);
  QS.__drawn.clear(); opsReset();
  QS.noise(20, 70, QS.NOISE.锤钉, 1);
  for (const ui of ['none', 'loot', 'log']) { QS.setUI(ui); QS.render(); }
  QS.night(true); QS.render();
  QS.setUI('death'); QS.die('冻死'); QS.render();
  const want = QS.DRAW_PATHS, drew = QS.__drawn;
  const missed = want.filter(p => !drew.has(p));
  ok(want.length >= 10, `契约里列了 ${want.length} 条绘制路径`);
  ok(!missed.length, `${want.length} 条路径都画过：漏 ${missed.join(' ') || '无'}`);
  ok(ops().length > 0, `画布上实际发生了 ${ops().length} 次绘制调用（0 的话 render 是空跑）`);
}

// ---- 12) 身体：速率对得上规格 ----
sec('身体');
{
  QS.start(5);
  const B = QS.P.body;
  QS.advanceHours(1);
  ok(Math.abs(100 - B.口渴 - 4.2) < .01, `口渴每小时 −${(100 - B.口渴).toFixed(1)}（24 小时见底）`);
  ok(Math.abs(100 - B.疲劳 - 6.25) < .01, `疲劳每小时 −${(100 - B.疲劳).toFixed(2)}（清醒 16 小时）`);
  QS.start(5); QS.P.inv = [];
  const d = QS.advanceHours(400);
  ok(!!QS.death, `不吃不喝会死，死因是「${QS.death && QS.death.cause}」，第 ${QS.death && QS.death.day} 天`);
  QS.start(5);
  ok(QS.TOWN.season === '秋', '开局是秋天');
  // 要走到第 21 天，得先让它活到第 21 天 —— 这是量具自己的责任，不是游戏的。
  // 【真游戏里还得让它在屋里】：体温按"室内/户外"分两张表，而玩家是从镇外的路上
  // 开局的，站在路上不动 50 小时，秋天也会冻死。靶子默认 inside:true，真游戏
  // 按脚下的瓦片算 —— 这条断言的措辞本来就写着"在屋里"。
  QS.P.inside = true; QS.P.atHouse = QS.P.atHouse != null ? QS.P.atHouse : 0;
  QS.P.inv = [...Array(200).fill('瓶装水'), ...Array(200).fill('罐头')];
  // 停在入冬【当天】，不要多走两天 —— 多走的那两天里它会在屋里冻死，
  // 然后"活到入冬"这条断言红得莫名其妙。这是第二次因为量具自己没安排好而假红。
  for (let h = 0; h < 24 * 25 && !QS.death && QS.TOWN.day < 21; h++) {
    if (QS.P.body.口渴 < 45) QS.useItem('瓶装水');
    if (QS.P.body.饥饿 < 45) QS.useItem('罐头');
    QS.advanceHours(1);
  }
  ok(!QS.death, `在屋里喂饱了能活到入冬：第 ${QS.TOWN.day} 天${QS.death ? '（死于' + QS.death.cause + '）' : ''}`);
  ok(QS.TOWN.season === '冬', `第 ${QS.TOWN.day} 天入冬了（季节是 ${QS.TOWN.season}）`);
  // 入冬是个拐点：有外套撑得住，光膀子出门撑不住。这两条就是决策 6 的落点
  QS.P.inside = true;
  QS.P.inv.push('外套'); QS.useItem('外套');
  const t0 = QS.P.body.体温;
  for (let h = 0; h < 24 && !QS.death; h++) {
    if (QS.P.body.口渴 < 45) QS.useItem('瓶装水');
    if (QS.P.body.饥饿 < 45) QS.useItem('罐头');
    QS.advanceHours(1);
  }
  ok(!QS.death, `入冬后穿上外套（保暖 ${QS.warmth()}）在屋里又活了一天：体温 ${t0.toFixed(0)} → ${QS.P.body.体温.toFixed(0)}`);
  QS.P.worn.length = 0; QS.P.inside = false;
  let froze = 0;
  for (; froze < 12 && !QS.death; froze++) QS.advanceHours(1);
  ok(!!QS.death && QS.death.cause === '冻死',
    `脱了衣服在冬天户外站 ${froze} 小时就死了（${QS.death && QS.death.cause}）—— 规格说 3 小时进冻伤`);
}

console.log(`\n${n - fail} 绿 / ${fail} 红`);
if (isFixture) console.log('（跑的是自检靶子。游戏本体到位后，这些断言一条都不用改 —— 桩会自动换目标）');
process.exit(fail ? 1 : 0);
