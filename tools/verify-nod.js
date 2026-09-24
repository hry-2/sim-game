#!/usr/bin/env node
// 点头 · 离线验收（判定层对不对）
// ==================================================================
// 这份脚本是在游戏本体【之前】写的。霓虹那一轮最大的教训是量具晚了：
// 桩不像真 DOM，能测的东西被砍掉一半。所以这次先把量具和契约定下来
// （契约见 nod-stub.js 头部）。
//
// 三条自己的规矩：
//   一、断言查【意图】，不贴实现写（霓虹教训一）
//   二、每条断言都【打印它数到的数量】——「扫到 45 个」和「扫到 0 个」都是绿的（教训二）
//   三、游戏不存在时跑 tools/_nod_fixture.html，并且大声说出来
//
// ------------------------------------------------------------------
// 【量具的能力边界】（霓虹教训二十五：边界不写下来，缺口就会被当成已验过）
//
//   能验：法线竖直分量 -> 下翻 / 上翻 / 回中 这段【纯函数】，以及它下游的
//         全部判定逻辑 —— 计时、不重复、守恒、改判、阅后即焚。
//         这是 ADR-0004 把判定和传感器拆开换来的。
//
//   不能验：浏览器到底给不给得出那个分量。具体有三件事只能【真机手测】：
//         1. iOS 13+ 的 DeviceOrientationEvent.requestPermission() 弹不弹、给不给
//         2. HTTPS 之外（局域网 http / file://）传感器是不是真的被静默拒绝
//         3. 手举到额头时，实际读数抖不抖、45° 门限是不是真的不误触
//         这三条在真机上过一遍之前，不许说「点头验过了」。
// ==================================================================
'use strict';
const S = require('./nod-stub');
const { run, lsTouched, isFixture, TARGET, REAL } = S;

let fail = 0, n = 0;
const ok = (c, m) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const sec = t => console.log('\n' + t);
const rel = p => p.replace(process.cwd() + '/', '');

console.log(isFixture
  ? `⚠ 游戏本体还不存在（等着 ${rel(REAL)}）\n  现在验的是量具自检靶子 tools/_nod_fixture.html —— 全绿只说明【量具是好的】`
  : `验收目标：${rel(TARGET)}`);

// 起一局并推到「进行」状态：举到中位 -> 数完 3-2-1 -> 第一个词
function open(NOD, opt) {
  NOD.start(opt || {});
  NOD.feedNormal(0);        // 举到中位，起手才开始数
  NOD.ready(3000);
  return NOD;
}

// ---- 0) 契约齐不齐 --------------------------------------------------
sec('钩子契约');
const NOD = run({});
{
  ok(!!NOD, NOD ? '游戏挂上了 window.NOD' : '❗ window.NOD 是空的 —— 下面全部作废');
  if (!NOD) { console.log('\n结果：0/1 通过'); process.exit(1); }

  const need = ['PACKS', 'WORDS', 'SECS', 'TH', 'start', 'ready', 'tick',
    'verdict', 'release', 'feedNormal', 'feedTap', 'amend',
    'word', 'left', 'score', 'log', 'usedMs', 'pace', 'shown', 'state', 'portrait'];
  const miss = need.filter(k => NOD[k] === undefined);
  ok(miss.length === 0, `契约 ${need.length} 项，缺 ${miss.length} 项${miss.length ? '：' + miss.join(' ') : ''}`);

  // 六个词包的名字必须和 CONTEXT.md 里钉的一致 —— 词变了可以，分类名不许飘
  const want = ['动物', '日常动作', '影视动画', '成语', '食物', '名人'];
  const same = NOD.PACKS.length === want.length && want.every((w, i) => NOD.PACKS[i] === w);
  ok(same, `词包 ${NOD.PACKS.length} 个：${NOD.PACKS.join(' / ')}`);
  ok(NOD.PACKS.indexOf('随机') < 0, '「随机」不在 PACKS 里 —— 它是抽法，不是一个词包');

  const secsOk = NOD.SECS.length === 3 && NOD.SECS.join(',') === '60,120,180';
  ok(secsOk, `时长三档：${NOD.SECS.join(' / ')} 秒`);
}

// ---- 1) 计时：三档准确，起手不吃局时 --------------------------------
sec('计时');
{
  for (const s of NOD.SECS) {
    NOD.start({ pack: '动物', secs: s, seed: 7 });
    const before = NOD.left();
    NOD.feedNormal(0);
    NOD.ready(3000);                       // 整个起手倒数
    const after = NOD.left();
    ok(before === s * 1000 && after === s * 1000,
      `${s} 秒档：开局 ${before}ms，数完 3-2-1 还是 ${after}ms —— 起手不吃局时`);
  }

  open(NOD, { pack: '动物', secs: 60, seed: 7 });
  let steps = 0;
  while (NOD.state() !== '总结' && steps < 1000) { NOD.tick(1000); steps++; }
  ok(steps === 60 && NOD.left() === 0, `60 秒档走了 ${steps} 次 tick(1000) 到 0，用时 ${NOD.usedMs()}ms`);
  ok(NOD.state() === '总结', `时间耗尽后状态是「${NOD.state()}」`);

  // 判定不加时（Q4）：确认状态下时间照走
  open(NOD, { pack: '动物', secs: 60, seed: 7 });
  const t0 = NOD.left();
  NOD.verdict('猜中');
  NOD.tick(1000);
  ok(NOD.left() === t0 - 1000, `确认画面上时间照走：${t0} -> ${NOD.left()}，猜中不加时`);
}

// ---- 2) 不重复 + 种子能从外部钉死 -----------------------------------
sec('不重复');
{
  open(NOD, { pack: '动物', secs: 180, seed: 42 });
  const size = NOD.poolSize();
  const seen = [];
  for (let i = 0; i < size; i++) {
    seen.push(NOD.word());
    NOD.verdict('猜中'); NOD.release();
  }
  const uniq = new Set(seen);
  ok(uniq.size === size, `抽满一轮 ${size} 个词，去重后 ${uniq.size} 个 —— 一个都没重`);
  ok(NOD.cycles() === 1, `第 ${size + 1} 次抽词触发重置，cycles=${NOD.cycles()}`);

  // 种子钉死：同种子同序列，不同种子不同序列（霓虹教训四）
  const seqOf = seed => {
    open(NOD, { pack: '随机', secs: 180, seed });
    const a = [];
    for (let i = 0; i < 12; i++) { a.push(NOD.word()); NOD.verdict('跳过'); NOD.release(); }
    return a.join(',');
  };
  const a1 = seqOf(42), a2 = seqOf(42), b1 = seqOf(43);
  ok(a1 === a2, `同种子两次开局，前 12 个词完全一致（${a1.split(',').slice(0, 3).join(' ')} …）`);
  ok(a1 !== b1, `换种子后序列变了（seed43 开头：${b1.split(',').slice(0, 3).join(' ')} …）`);

  // ?seed= 也能钉（量具靠它，没有它这一节的断言就不是确定性的）
  const N2 = run({ search: '?seed=42' });
  open(N2, { pack: '随机', secs: 180 });
  const c = [];
  for (let i = 0; i < 12; i++) { c.push(N2.word()); N2.verdict('跳过'); N2.release(); }
  ok(c.join(',') === a1, '?seed=42 和 start({seed:42}) 给出同一串词');
}

// ---- 3) 随机包是跨包混抽，不是随机挑一个包 ---------------------------
sec('随机包');
{
  const total = NOD.PACKS.reduce((s, p) => s + (NOD.WORDS[p] || []).length, 0);
  open(NOD, { pack: '随机', secs: 180, seed: 5 });
  ok(NOD.poolSize() === total, `随机包池子 ${NOD.poolSize()} 个词 = 六包之和 ${total}`);

  const which = w => NOD.PACKS.find(p => (NOD.WORDS[p] || []).indexOf(w) >= 0);
  const hit = new Set();
  const draws = Math.min(20, total);
  for (let i = 0; i < draws; i++) { hit.add(which(NOD.word())); NOD.verdict('跳过'); NOD.release(); }
  ok(hit.size >= 2, `连抽 ${draws} 个词跨了 ${hit.size} 个词包：${[...hit].join(' / ')} —— 是混抽不是选包`);
}

// ---- 4) 判定：猜中 +1、跳过 0、跳过不限次 ----------------------------
sec('判定');
{
  open(NOD, { pack: '动物', secs: 180, seed: 9 });
  for (let i = 0; i < 4; i++) { NOD.verdict('猜中'); NOD.release(); }
  for (let i = 0; i < 3; i++) { NOD.verdict('跳过'); NOD.release(); }
  const sc = NOD.score();
  ok(sc.猜中 === 4 && sc.跳过 === 3, `猜中 ${sc.猜中} / 跳过 ${sc.跳过} —— 跳过不加分也不减分`);

  // 跳过不限次：整池子全跳掉也不该被拦（Q13 —— 上限会让猜词人管理一个他看不见的资源）
  open(NOD, { pack: '动物', secs: 180, seed: 9 });
  const size = NOD.poolSize();
  let passed = 0;
  for (let i = 0; i < size + 5; i++) { if (NOD.verdict('跳过')) passed++; NOD.release(); }
  ok(passed === size + 5, `连跳 ${passed} 次没有被拦（池子只有 ${size} 个词）—— 跳过无上限`);
  ok(NOD.score().猜中 === 0, `全跳之后猜中 ${NOD.score().猜中} 个`);

  // 确认状态下不许再判 —— 这是「回中才亮下一词」堵掉连判的那条（Q14 乙）
  open(NOD, { pack: '动物', secs: 180, seed: 9 });
  NOD.verdict('猜中');
  const dup = NOD.verdict('猜中');
  ok(dup === false && NOD.log().length === 1,
    `确认状态下再判一次被拒，log 里仍是 ${NOD.log().length} 条 —— 一次翻转不会连判两次`);
  ok(NOD.word() === null, '确认画面上 word() 是空的 —— 下一个词还没亮');
  NOD.release();
  ok(NOD.word() !== null && NOD.state() === '进行', `回中之后亮出下一个词「${NOD.word()}」`);
}

// ---- 5) 守恒：猜中 + 跳过 == 出现过的词数 ----------------------------
sec('守恒');
{
  open(NOD, { pack: '随机', secs: 180, seed: 11 });
  let shown = 0;
  for (let i = 0; i < 17; i++) {
    if (NOD.word() != null) shown++;
    NOD.verdict(i % 3 === 0 ? '跳过' : '猜中');
    NOD.release();
  }
  const sc = NOD.score(), lg = NOD.log();
  ok(sc.猜中 + sc.跳过 === shown, `出现过 ${shown} 个词，猜中 ${sc.猜中} + 跳过 ${sc.跳过} = ${sc.猜中 + sc.跳过}`);
  ok(lg.length === shown, `log 里 ${lg.length} 条，一条不多一条不少`);
  ok(lg.every(e => e.word && (e.verdict === '猜中' || e.verdict === '跳过')),
    `${lg.length} 条 log 每条都带词和判定，没有第三种判定`);
}

// ---- 6) 改判：切了之后守恒仍然成立 -----------------------------------
sec('改判');
{
  open(NOD, { pack: '动物', secs: 180, seed: 13 });
  for (let i = 0; i < 6; i++) { NOD.verdict(i < 4 ? '猜中' : '跳过'); NOD.release(); }
  const b = NOD.score();
  NOD.amend(0);                                   // 猜中 -> 跳过
  const m = NOD.score();
  ok(m.猜中 === b.猜中 - 1 && m.跳过 === b.跳过 + 1,
    `改判一条：猜中 ${b.猜中}->${m.猜中}，跳过 ${b.跳过}->${m.跳过}`);
  NOD.amend(5);                                   // 跳过 -> 猜中
  const m2 = NOD.score();
  ok(m2.猜中 === b.猜中 && m2.跳过 === b.跳过, `再改回一条，回到 ${m2.猜中}/${m2.跳过}`);
  ok(m2.猜中 + m2.跳过 === NOD.log().length,
    `改判两次之后守恒仍成立：${m2.猜中}+${m2.跳过}=${NOD.log().length}`);
  ok(NOD.amend(999) === false, '改判越界的下标被拒');
}

// ---- 6b) 节奏：总结页第三个数必须带信息 -------------------------------
sec('节奏');
{
  // 一局总是跑满时间，所以「实际用时」恒等于所选档位 —— 这一条钉住它不许回到总结页上
  open(NOD, { pack: '动物', secs: 60, seed: 31 });
  for (let i = 0; i < 10; i++) { NOD.verdict('猜中'); NOD.release(); NOD.tick(4000); }
  const p1 = NOD.pace();
  ok(Math.abs(p1 - 4) < 1e-6, `10 个词各花 4 秒，节奏 ${p1.toFixed(1)}"/词`);

  open(NOD, { pack: '动物', secs: 60, seed: 31 });
  for (let i = 0; i < 5; i++) { NOD.verdict('猜中'); NOD.release(); NOD.tick(8000); }
  const p2 = NOD.pace();
  ok(p2 > p1, `慢一倍的一局节奏是 ${p2.toFixed(1)}"/词，比 ${p1.toFixed(1)}" 大 —— 它真的随打法变`);

  open(NOD, { pack: '动物', secs: 60, seed: 31 });
  while (NOD.state() !== '总结') NOD.tick(1000);
  ok(NOD.pace() === 0, `一个词都没判完的一局，节奏是 ${NOD.pace()} —— 不会除以零`);
}

// ---- 7) 阅后即焚 -----------------------------------------------------
sec('阅后即焚');
{
  // 两道闸：源码 grep 挡住明写的，桩里的记账代理挡住拼出来的
  const hits = (S.js.match(/localStorage|sessionStorage|indexedDB/g) || []);
  ok(hits.length === 0, `源码里出现存储 API ${hits.length} 次`);

  const N3 = run({});
  open(N3, { pack: '动物', secs: 60, seed: 3 });
  for (let i = 0; i < 5; i++) { N3.verdict('猜中'); N3.release(); }
  while (N3.state() !== '总结') N3.tick(1000);
  N3.amend(0);
  const touched = lsTouched();
  ok(touched.length === 0, `跑完整整一局 + 改判，存储被碰 ${touched.length} 次${touched.length ? '：' + touched.slice(0, 4).join(' ') : ''}`);
}

// ---- 8) 输入层：姿态 / 点击 -> 判定（纯函数那一段）--------------------
sec('输入层');
{
  const deg = d => Math.sin(d * Math.PI / 180);
  ok(Math.abs(NOD.TH.判定 - deg(45)) < 1e-6 && Math.abs(NOD.TH.中位 - deg(20)) < 1e-6,
    `门限：判定 ${(Math.asin(NOD.TH.判定) * 180 / Math.PI).toFixed(0)}° / 中位 ${(Math.asin(NOD.TH.中位) * 180 / Math.PI).toFixed(0)}°`);

  // 下翻 = 猜中，上翻 = 跳过
  open(NOD, { pack: '动物', secs: 180, seed: 17 });
  NOD.feedNormal(-deg(60));
  ok(NOD.log().length === 1 && NOD.log()[0].verdict === '猜中', `下翻 60° -> 「${NOD.log()[0].verdict}」`);
  NOD.feedNormal(0);                                  // 回中
  NOD.feedNormal(deg(60));
  ok(NOD.log()[1] && NOD.log()[1].verdict === '跳过', `上翻 60° -> 「${NOD.log()[1].verdict}」`);

  // 没到门限不判
  open(NOD, { pack: '动物', secs: 180, seed: 17 });
  for (const d of [10, 30, 44, -10, -30, -44]) NOD.feedNormal(-deg(d));
  ok(NOD.log().length === 0, `在 ±44° 以内喂了 6 次姿态，判定 ${NOD.log().length} 次 —— 没到 45° 不算`);

  // 一次大幅翻转不会连判：过门限后停在门限外，再怎么喂也只判一次
  open(NOD, { pack: '动物', secs: 180, seed: 17 });
  for (let i = 0; i < 10; i++) NOD.feedNormal(-deg(70));
  ok(NOD.log().length === 1, `在 70° 上连喂 10 次，只判了 ${NOD.log().length} 次 —— 靠回中去抖，不靠计时锁`);
  ok(NOD.state() === '确认', `仍停在「${NOD.state()}」，没回中就不放行`);
  NOD.feedNormal(deg(25));
  ok(NOD.state() === '确认', '回到 25° 还不算中位（门限 20°）');
  NOD.feedNormal(deg(10));
  ok(NOD.state() === '进行' && NOD.log().length === 1, `回到 10° 才放行，log 仍是 ${NOD.log().length} 条`);

  // 起手要先举到中位才开始倒数 —— 防止猜词人提前瞄到第一个词
  NOD.start({ pack: '动物', secs: 60, seed: 17 });
  NOD.ready(3000);
  ok(NOD.state() === '起手' && NOD.word() === null,
    `没举到中位就想数完：状态还是「${NOD.state()}」，词是空的`);
  NOD.feedNormal(deg(5));
  NOD.ready(3000);
  ok(NOD.state() === '进行' && NOD.word() !== null, `举到中位后数完 3-2-1，亮出「${NOD.word()}」`);

  // 点击兜底：下半屏猜中、上半屏跳过，一个词一次点击
  open(NOD, { pack: '动物', secs: 180, seed: 17 });
  NOD.feedTap(300, 360);        // 下半屏
  NOD.feedTap(60, 360);         // 上半屏
  const lg = NOD.log();
  ok(lg.length === 2 && lg[0].verdict === '猜中' && lg[1].verdict === '跳过',
    `两次点击 -> ${lg.map(e => e.verdict).join(' / ')}（下半屏猜中、上半屏跳过）`);
  ok(NOD.state() === '进行', '点击那条路一次点击走完一个词，不用再点一下放行');
}

// ---- 9) 没有传感器也要能玩完一整局（ADR-0004 的整个理由）-------------
sec('没传感器');
{
  const N4 = run({ sensor: false });
  ok(!!N4, '没有 DeviceOrientationEvent 时游戏仍然初始化');
  N4.start({ pack: '动物', secs: 60, seed: 21 });
  N4.feedTap(300, 360);                                  // 点一下起手
  N4.ready(3000);
  ok(N4.state() === '进行', `纯点击也能过起手，状态「${N4.state()}」`);
  let done = 0;
  while (N4.state() !== '总结' && done < 200) { N4.feedTap(300, 360); N4.tick(1000); done++; }
  ok(N4.state() === '总结' && N4.score().猜中 === done,
    `纯点击走完整局：${done} 次点击、猜中 ${N4.score().猜中} 个`);

  // iOS 把权限拒了，也要退到点击而不是卡死
  const N5 = run({ permission: 'denied' });
  N5.start({ pack: '动物', secs: 60, seed: 21 });
  N5.feedTap(300, 360); N5.ready(3000);
  ok(N5.state() === '进行', '传感器权限被拒时，点击那条路照样开局');
}

// ---- 10) 竖屏：盖提示层并暂停计时 -------------------------------------
sec('竖屏');
{
  open(NOD, { pack: '动物', secs: 60, seed: 23 });
  NOD.tick(5000);
  const before = NOD.left();
  NOD.portrait(true);
  for (let i = 0; i < 10; i++) NOD.tick(1000);
  const during = NOD.left();
  ok(during === before, `竖屏 10 秒，剩余时间纹丝不动：${before} -> ${during}`);
  NOD.render();
  ok(NOD.__painted.has('竖屏盖层'), '竖屏时画的是盖层');
  NOD.portrait(false);
  NOD.tick(1000);
  ok(NOD.left() === before - 1000, `转回横屏继续走：${before} -> ${NOD.left()}`);

  // 总结页竖着看更顺，而且盖层上「计时已暂停」那句话在一个已经结束的局上是胡说
  while (NOD.state() !== '总结') NOD.tick(1000);
  NOD.portrait(true);
  ok(NOD.shown().kind === '总结', `总结页转竖屏，屏幕上还是「${NOD.shown().kind}」 —— 不盖`);
}

// ---- 11) 渲染路径：每一条都得真的走到一次 -----------------------------
sec('渲染路径');
{
  const N6 = run({});
  N6.render();                                   // 菜单（还没开局）
  N6.start({ pack: '动物', secs: 60, seed: 29 });
  N6.render();                                   // 倒数
  N6.feedNormal(0); N6.ready(3000); N6.render(); // 词
  N6.verdict('猜中'); N6.render();               // 确认
  N6.release();
  N6.portrait(true); N6.render();                // 竖屏盖层（玩到一半转竖了）
  N6.portrait(false);
  while (N6.state() !== '总结') N6.tick(1000);
  N6.render();                                   // 总结
  const miss = N6.PAINT_PATHS.filter(p => !N6.__painted.has(p));
  ok(miss.length === 0,
    `${N6.PAINT_PATHS.length} 条渲染路径走到 ${N6.PAINT_PATHS.length - miss.length} 条${miss.length ? '，漏：' + miss.join(' ') : ''}`);
}

// ---- 12) 词库规模（靶子不验 —— 它故意只有 6 个词一包）-----------------
sec('词库');
{
  const filled = NOD.PACKS.filter(p => (NOD.WORDS[p] || []).length > 0);
  const sizes = filled.map(p => `${p} ${NOD.WORDS[p].length}`).join(' / ');
  if (isFixture) {
    console.log(`  – 靶子不验词库规模（每包只有 ${NOD.WORDS[NOD.PACKS[0]].length} 个词，够跑边界就行）`);
    ok(filled.length === 6, `六包都有词：${sizes}`);
  } else {
    ok(filled.length >= 1, `已实现 ${filled.length}/6 个词包：${sizes}`);
    const thin = filled.filter(p => NOD.WORDS[p].length < 200);
    ok(thin.length === 0,
      `每个非空词包 ≥200 词，不够的 ${thin.length} 个${thin.length ? '：' + thin.join(' ') : ''}`);
    // 同一个词在两个包里出现，会让「随机包跨包混抽」的去重出洞
    const all = [];
    for (const p of filled) for (const w of NOD.WORDS[p]) all.push(w);
    const dups = all.length - new Set(all).size;
    ok(dups === 0, `全部 ${all.length} 个词跨包去重后差 ${dups} 个`);
  }
}

// ---- 结果 ------------------------------------------------------------
console.log(`\n结果：${n - fail}/${n} 通过`);
if (isFixture) {
  console.log('⚠ 跑的是靶子 —— 这只证明量具是好的，不证明游戏是好的');
}
console.log('⚠ 传感器那三条（iOS 权限 / HTTPS / 真机抖动）离线验不到，见脚本头部的能力边界');
process.exit(fail ? 1 : 0);
