// 定向验证 T35 · MBTI。
//
// 这个项目已经有两层人格（性格=需求权重、特质=局部修正），所以加第三层之前
// 唯一要证明的事情是：**它不是标签**。
// 一个不接任何机制的标签就是 T22 之前那个「只涨不用」的 skill ——
// 面板上好看，玩到第 10 天和第 1 天一模一样。
//
// 所以这里几乎每一条都是【同一个人、同一时刻、只换四个字母】的对照实验：
// 如果换了字母行为不变，那这一轴就是死的，断言必须红。
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    running = false; wipeSave();
    const out = {};

    // ---- ① 阵容：每人一个类型，四个轴都不能一边倒 ----
    out.cast = sims.map(s => `${s.name}:${s.mbti}`);
    const axis = i => sims.reduce((n, s) => n + (s.mbti[i] === 'EITJ'[i] ? 0 : 0), 0);
    out.split = [0, 1, 2, 3].map(i => {
      const a = 'ESTJ'[i];
      return sims.filter(s => s.mbti[i] === a).length;
    });
    out.uniq = new Set(sims.map(s => s.mbti)).size;

    // 对照实验的骨架：同一个人，只换 mbti，量同一件事
    const swap = (s, type, fn) => { const old = s.mbti; s.mbti = type;
                                    const v = fn(); s.mbti = old; return v; };
    const probe = sims[1];

    // ---- ② E/I：交游掉得快慢（把 step 跑一小段，只看 social）----
    const decay = type => swap(probe, type, () => {
      const before = 60; probe.need.social = before;
      const keep = {}; for (const k of NK) { keep[k] = probe.need[k]; probe.need[k] = 60; }
      probe.act = { o: { adv: {}, cost: {}, dur: 100, use: [[0, 0]] }, phase: 'do', left: 999, seat: 'x' };
      for (let i = 0; i < 40; i++) step(0.25);
      const dropped = before - probe.need.social;
      for (const k of NK) probe.need[k] = keep[k];
      probe.act = null;
      return dropped;
    });
    out.dec = { E: decay('ESTJ'), I: decay('ISTJ') };

    // ---- ③ E/I：一场社交补回来多少 ----
    const gain = type => swap(probe, type, () => mb(probe, 'socGain'));
    out.gain = { E: gain('ENFP'), I: gain('INFJ') };

    // ---- ④ S/N：远处的东西，N 型愿意多走 ----
    // 同一个物件、同一份需求，只换人格 —— 差别只可能来自距离折扣
    const far = OBJ.find(o => o.id === 'tree1');
    probe.gx = 3; probe.gy = 3;
    for (const k of NK) if (NEEDS[k].dec) probe.need[k] = 55;
    probe.inv.food = 1; probe.money = 10;
    out.dist = { S: swap(probe, 'ISTJ', () => score(probe, far, true)),
                 N: swap(probe, 'INTJ', () => score(probe, far, true)) };

    // ---- ⑤ S/N：家计（延迟回报那一项）的权重 ----
    out.prov = { S: swap(probe, 'ISTJ', () => mb(probe, 'prov')),
                 N: swap(probe, 'INTJ', () => mb(probe, 'prov')) };

    // ---- ⑥ T/F：同样一段恩怨，F 型爱憎更分明 ----
    const other = sims[2].name;
    probe.mem = {};
    for (let i = 0; i < 3; i++) remember(probe, other, 'social.争执');
    const relT = swap(probe, 'ISTJ', () => relFromMemory(probe, other));
    const relF = swap(probe, 'ISFJ', () => relFromMemory(probe, other));
    out.memWrote = ((probe.mem[other] || []).length === 3);   // 键名写错会静默失败
    probe.mem = {};
    for (let i = 0; i < 3; i++) remember(probe, other, 'social.馈赠');
    const goodT = swap(probe, 'ISTJ', () => relFromMemory(probe, other));
    const goodF = swap(probe, 'ISFJ', () => relFromMemory(probe, other));
    probe.mem = {}; refreshRel();
    out.mem = { badT: relT, badF: relF, goodT, goodF };

    // ---- ⑦ T/F：同一条八卦，F 听得更进去 ----
    out.trust = { T: swap(probe, 'ISTJ', () => mb(probe, 'trust')),
                  F: swap(probe, 'ISFJ', () => mb(probe, 'trust')) };

    // ---- ⑧ J/P：承诺规则的松紧 ----
    probe.tt = [];                       // 排掉特质对耐心的影响，只看 J/P
    out.patience = { J: swap(probe, 'ESTJ', () => patienceOf(probe)),
                     P: swap(probe, 'ESTP', () => patienceOf(probe)) };

    // ---- ⑨ J/P：锚点日程的约束力 ----
    // 找一个「在锚点区内」和一个「在区外」的物件，比同一时刻的分数比
    const anchorRatio = type => swap(probe, type, () => {
      const z = anchorZone(probe);
      if (!z) return null;
      const inZ = OBJ.find(o => o.zone === z && !o.owner && o.adv && !o.pre);
      const outZ = OBJ.find(o => o.zone && o.zone !== z && !o.owner && o.adv && !o.pre);
      if (!inZ || !outZ) return null;
      const a = score(probe, inZ), b = score(probe, inZ, true);
      const c = score(probe, outZ), d = score(probe, outZ, true);
      return { in: a / b, out: c / d };
    });
    clock = 8 * 60;                        // 挪到一个有锚点的时段
    for (const k of NK) if (NEEDS[k].dec) probe.need[k] = 50;
    out.anchor = { J: anchorRatio('ESTJ'), P: anchorRatio('ESTP') };

    // ---- ⑩ 两层人格不能重叠：MBTI 不许去动需求权重 ----
    // 性格管"你想要什么"（weightOf），MBTI 管"你怎么去拿"。
    // 如果换个 MBTI 连 weightOf 都变了，说明两层在打架。
    const wBefore = NK.map(k => weightOf(probe, k).toFixed(3)).join(',');
    const wAfter = swap(probe, 'ENFP', () => NK.map(k => weightOf(probe, k).toFixed(3)).join(','));
    out.layers = { same: wBefore === wAfter };

    return out;
  });

  // ---- ⑪ 涌现方向：全员 E 和全员 I，跑三天比社交次数 ----
  // 控制变量：只改四个字母里的第一个，其余（性格/特质/地图/天气）完全一致。
  const runAB = async first => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('ab: ' + e.message));
    await p.goto(FILE);
    await p.waitForTimeout(1400);
    await p.evaluate(f => {
      wipeSave();
      for (const s of sims) s.mbti = f + s.mbti.slice(1);
      // 【别去数 EVENTS 的尾巴】：那是 400 条的环形缓冲，四天下来早转满了，
      // 尾巴里社交占多少跟 E/I 无关 —— 实测 E 和 I 数出来分毫不差（24:24）。
      // 挂在 onEvent 上现场累加，才是真的"这一局发生了多少次社交"。
      window.__soc = 0;
      onEvent(e => { if (e.type.startsWith('social.') && e.type !== 'social.missed') window.__soc++; });
      autoPilot = true; speed = 60; running = true;
    }, first);
    await p.waitForFunction(() => day >= 4, null, { timeout: 240000, polling: 400 });
    const n = await p.evaluate(() => ({
      social: window.__soc,
      avgSoc: Math.round(sims.reduce((a, s) => a + s.need.social, 0) / sims.length),
    }));
    await p.close();
    return n;
  };
  const abE = await runAB('E');
  const abI = await runAB('I');
  await browser.close();

  const P = [
    ['① 六个人六个类型，无重复', r.uniq === 6],
    ['① 四个轴都不是一边倒（各 2~4 人）', r.split.every(v => v >= 2 && v <= 4)],
    ['② E 的交游掉得比 I 快', r.dec.E > r.dec.I * 1.2],
    ['③ E 一场社交补得比 I 多', r.gain.E > r.gain.I],
    ['④ 远处的活计 N 型给的分更高', r.dist.N > r.dist.S],
    ['⑤ 家计（延迟回报）N 型权重更高', r.prov.N > r.prov.S],
    ['⑥ 记忆真的写进去了（键名写错会静默失败）', r.memWrote],
    ['⑥ 同样的怨，F 型恨得更深', r.mem.badF < r.mem.badT],
    ['⑥ 同样的恩，F 型也更领情', r.mem.goodF > r.mem.goodT],
    ['⑦ 同一条八卦，F 听得更进去', r.trust.F > r.trust.T],
    ['⑧ J 型开了工不轻易改主意', r.patience.J > r.patience.P * 1.5],
    ['⑨ J 型更守日程（区内更高、区外更低）',
      r.anchor.J && r.anchor.P && r.anchor.J.in > r.anchor.P.in &&
      r.anchor.J.out < r.anchor.P.out],
    // 这条是"别加废层"的护栏：MBTI 一旦伸手去改需求权重，两层人格就重叠了
    ['⑩ MBTI 不去动需求权重（和性格分工清楚）', r.layers.same],
    ['⑪ 全员 E 比全员 I 社交次数更多（涌现方向对）', abE.social > abI.social],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  T35 MBTI' : 'FAIL  T35 MBTI');
  for (const [t, v] of P) console.log(`  ${v ? '✓' : '✗'} ${t}`);
  console.log(`  阵容: ${r.cast.join('  ')}`);
  console.log(`  E/I: 交游三小时掉 ${r.dec.E.toFixed(1)} vs ${r.dec.I.toFixed(1)}` +
              `　一场社交回报 ×${r.gain.E} vs ×${r.gain.I}`);
  console.log(`  S/N: 远处林地打分 ${r.dist.S.toFixed(2)} vs ${r.dist.N.toFixed(2)}` +
              `　家计权重 ×${r.prov.S} vs ×${r.prov.N}`);
  console.log(`  T/F: 三次争执后关系 ${r.mem.badT.toFixed(1)} vs ${r.mem.badF.toFixed(1)}` +
              `　三次馈赠后 ${r.mem.goodT.toFixed(1)} vs ${r.mem.goodF.toFixed(1)}`);
  console.log(`  J/P: 耐心 ${r.patience.J} vs ${r.patience.P}` +
              (r.anchor.J ? `　锚点内 ${r.anchor.J.in.toFixed(2)} vs ${r.anchor.P.in.toFixed(2)}` +
                            `　区外 ${r.anchor.J.out.toFixed(2)} vs ${r.anchor.P.out.toFixed(2)}` : ''));
  console.log(`  三天 A/B: 全员E 社交 ${abE.social} 次（交游均值 ${abE.avgSoc}）` +
              ` / 全员I ${abI.social} 次（${abI.avgSoc}）`);
  if (errs.length) console.log('  报错:', errs.join(' | '));
  process.exit(ok ? 0 : 1);
})();
