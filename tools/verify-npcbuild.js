// NPC 兴造：村子必须自己会长。
// 在此之前六户人家开局什么样、一年后还是什么样，只有玩家那块地在变；
// 同时 NPC 的钱越攒越多没处花。这个测试同时盯住这两头 —— 盖得出来，
// 并且盖房不能把日子过垮（饿不着、不死人）。
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html')
                  + '?auto=1&t=' + Date.now());
  await page.waitForTimeout(1200);

  // 顶层声明点名。以前整块代码插错位置，逻辑测试照样全绿，屏幕上却什么都没有。
  const missing = await page.evaluate(() => ['npcBuildTick','npcCost','npcHasLike',
    'NPC_WISH','WOOD_BUY','WISH_GAP','buildZoneOK'].filter(n => {
      try { return typeof eval(n) === 'undefined'; } catch (e) { return true; } }));

  await page.evaluate(() => { autoPilot = true; speed = 60; running = true; });
  await page.waitForFunction(() => day >= 40, null, { timeout: 420000, polling: 500 });

  const r = await page.evaluate(() => {
    const npc = BUILT.filter(b => b.by && b.by !== PC.name);
    return {
      day, npcBuilds: npc.length,
      // 至少三户人家动过土 —— 只有一个土豪在盖不算村子在长
      families: new Set(npc.map(b => b.by)).size,
      // 盖的东西得摆在自家院里，不能挤到别人家或公地上
      offPlot: OBJ.filter(o => o.built && o.owner && o.owner !== PC.name).filter(o => {
        const s = sims.find(x => x.name === o.owner);
        if (!s) return false;                 // 已故老邻居留下的园子，还在是对的
        if (s.home == null) return true;
        const h = HOME[s.home];
        return !(o.x >= h.x && o.x < h.x + HW && o.y >= h.y && o.y < h.y + HH);
      }).length,
      starving: sims.filter(s => s.need.hunger < 5).length,
      dead: sims.filter(s => s.dead).length,
      hunger: +(sims.reduce((a, s) => a + s.need.hunger, 0) / sims.length).toFixed(1),
      // 钱的下水道：不该还是人人捧着几百文没处使
      richest: Math.round(Math.max(...sims.filter(s => s !== PC).map(s => s.money))),
    };
  });

  // 存档回放：NPC 盖的东西得连同「是谁盖的」一起活过一次存读
  const save = await page.evaluate(() => { saveGame(); return BUILT.length; });
  await page.reload();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({
    n: BUILT.length,
    byKept: BUILT.filter(b => b.by && b.by !== PC.name).length,
    owners: OBJ.filter(o => o.built && o.owner !== PC.name).length,
  }));

  const checks = [
    ['顶层声明齐全', missing.length === 0, missing.join(',')],
    ['NPC 真的盖了东西', r.npcBuilds >= 6, r.npcBuilds],
    ['不止一户在盖', r.families >= 3, r.families],
    ['都盖在自家院里', r.offPlot === 0, r.offPlot],
    ['没人饿着', r.starving === 0, r.starving],
    ['没人死', r.dead === 0, r.dead],
    ['需求没被拖垮', r.hunger > 60, r.hunger],
    ['钱有下水道', r.richest < 500, r.richest],
    ['存档条数不变', after.n === save, `${save}→${after.n}`],
    ['读档记得是谁盖的', after.byKept >= 6, after.byKept],
    ['读档后归属没丢', after.owners >= 6, after.owners],
    ['无报错', errs.length === 0, errs[0] || ''],
  ];
  await browser.close();
  const bad = checks.filter(c => !c[1]);
  for (const [n, ok, v] of checks) console.log(`${ok ? '✓' : '✗'} ${n} ${v}`);
  console.log(bad.length ? `FAIL[${bad.map(c => c[0]).join(',')}]`
                         : `PASS 全部 ${checks.length} 项 第${r.day}天 NPC盖了${r.npcBuilds}样`);
  process.exit(bad.length ? 1 : 0);
})();
