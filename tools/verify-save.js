// 定向验证 T20 存档。
// 关键不是"能存能读"，而是【关掉页面再打开，村子还是那个村子】——
// 种地要三天、记忆按天衰减、积怨要攒好几天，没有存档这些设计全是空转。
//
// 用同一个 browser context 开两个页面，才共享 localStorage（换 context 等于换浏览器）。
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');

const SNAP = () => ({
  day, clock: Math.round(clock), running, speed, autoPilot,
  sims: sims.map(s => `${s.name}:${s.inv.food}/${s.inv.wood}/${s.inv.goods}/${s.inv.fish}/${s.inv.pickle}/${s.inv.egg}/${Math.round(s.money)}/${s.skill.toFixed(3)}`),
  needs: sims.map(s => NK.map(k => Math.round(s.need[k])).join(',')),
  fields: FIELDS.map(f => `${f.st}${f.grow}${f.wet ? '湿' : '干'}${f.sower || '-'}`),
  mem: sims.reduce((n, s) => n + Object.values(s.mem || {}).reduce((m, l) => m + l.length, 0), 0),
  rels: sims.flatMap(a => sims.filter(b => b !== a).map(b => a.rel[b.name])),
  ev: EVENTS.length,
  built: BUILT.map(b => `${b.key}@${b.x},${b.y}`),
  mkt: Object.keys(MKT).map(k => Math.round(MKT[k].p)).join(','),
});

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const errs = [];

  // ---- 跑五天，攒出足够复杂的状态（记忆、田、市价、积怨都要有内容）----
  const p1 = await ctx.newPage();
  p1.on('pageerror', e => errs.push('p1: ' + e.message));
  await p1.goto(FILE);
  await p1.waitForTimeout(1300);
  await p1.evaluate(() => { autoPilot = true; speed = 60; running = true; });
  await p1.waitForFunction(() => day >= 5, null, { timeout: 240000, polling: 400 });

  const before = await p1.evaluate(`(() => { running = false; saveGame();
    const snap = ${SNAP.toString()};
    return { ...snap(), kb: Math.round(localStorage.getItem('sim-game-save').length / 1024) }; })()`);
  await p1.close();

  // ---- 关掉再打开 ----
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errs.push('p2: ' + e.message));
  await p2.goto(FILE);
  await p2.waitForTimeout(1800);
  const after = await p2.evaluate(`(${SNAP.toString()})()`);
  const feedRows = await p2.evaluate(() => document.querySelectorAll('#feed .l').length);

  // ---- 坏存档不能把游戏搞崩 ----
  const robust = await p2.evaluate(() => {
    const out = {};
    const raw = localStorage.getItem('sim-game-save');
    // ① 版本对不上 → 当作没有存档，而不是读出一堆残缺字段
    const old = JSON.parse(raw); old.v = 0;
    localStorage.setItem('sim-game-save', JSON.stringify(old));
    out.oldVer = loadGame() === false && hasSave() === false;
    // ② 半截 JSON → 不能抛异常
    localStorage.setItem('sim-game-save', '{"v":12,"sims":[{"na');
    let threw = false;
    try { out.corrupt = loadGame() === false; } catch (e) { threw = true; }
    out.corruptNoThrow = !threw;
    // ③ 阵容对不上的存档：只跳过不认识的人，不该崩
    localStorage.setItem('sim-game-save', JSON.stringify({
      v: 12, day: 9, clock: 100, sims: [{ name: '查无此人', need: {}, inv: {}, rel: {}, mem: {} }],
      fields: [], events: [],
    }));
    out.strangerOK = loadGame() === true && day === 9;
    // ④ 清档
    localStorage.setItem('sim-game-save', raw);
    wipeSave();
    out.wiped = hasSave() === false && loadGame() === false;
    return out;
  });

  await browser.close();

  const same = k => JSON.stringify(before[k]) === JSON.stringify(after[k]);
  const P = [
    ['① 天数与时刻', same('day') && same('clock')],
    ['② 暂停状态与倍速', same('running') && same('speed') && same('autoPilot')],
    ['③ 六人的钱粮木器与技能', same('sims')],
    ['④ 六人的七项需求', same('needs')],
    ['⑤ 田地阶段/长势/干湿/播种人', same('fields')],
    ['⑥ 记忆条数', same('mem')],
    // 关系是【从记忆推导】的，读档时 refreshRel() 会重算一遍。
    // 一开始漂移 0.0104，我误以为是浮点误差 —— 其实是【刷新周期的陈旧值】：
    // rel 只每 5 模拟分钟整表重算，存的是旧值、读的是新值。
    // 修法是 saveGame() 存之前先刷一次，剩下的才是真正的浮点噪声（1e-13 量级）。
    ['⑦ 全部关系值（容差 0.001）',
      before.rels.length === after.rels.length &&
      before.rels.every((v, i) => Math.abs(v - after.rels[i]) < 0.001)],
    ['⑧ 市价', same('mkt')],
    ['⑧b 造过的东西还在（且不会重复长出来）', same('built')],
    // 事件流有意只存最近 200 条 —— 全存会让存档无谓地胖，读起来也没人翻那么远
    ['⑨ 事件流按上限保留', after.ev === Math.min(before.ev, 200)],
    ['⑩ 读档后事件流真的渲染出来', feedRows > 3],
    ['⑪ 版本对不上就当没有存档', robust.oldVer],
    ['⑫ 半截 JSON 不抛异常', robust.corrupt && robust.corruptNoThrow],
    ['⑬ 阵容对不上只跳过不崩', robust.strangerOK],
    ['⑭ 重开一局能清干净', robust.wiped],
    ['⑮ 存档体积合理（<512KB）', before.kb < 512],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  T20 存档' : 'FAIL  T20 存档');
  for (const [t, v] of P) console.log(`  ${v ? '✓' : '✗'} ${t}`);
  console.log(`  ${before.kb} KB　第${before.day}天${before.clock}分 → 重开后 第${after.day}天${after.clock}分`);
  const relDrift = Math.max(0, ...before.rels.map((v, i) => Math.abs(v - after.rels[i])));
  console.log(`  事件流 ${before.ev} → ${after.ev}（上限 200）　记忆 ${before.mem} 条` +
              `　关系最大漂移 ${relDrift.toFixed(4)}`);
  if (!same('sims')) console.log('  前:', before.sims.join(' '), '\n  后:', after.sims.join(' '));
  if (errs.length) console.log('  报错:', errs.join(' | '));
  process.exit(ok ? 0 : 1);
})();
