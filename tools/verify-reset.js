// 开一局 / 续一局 / 重开一局 —— 三种进门方式各该看到哪个画面。
//
// 这里出过一个很隐蔽的 bug：「重开一局」是 wipeSave() 紧跟 location.reload()，
// 而 pagehide 上挂着 saveGame —— reload 自己会触发 pagehide，刚擦掉的档在那一瞬间
// 被原样写回去。于是下一次加载 loadGame() 照样成功：点几次「重开一局」都是同一个
// 村子，捏人页根本不出现。这种 bug 只有在页面【真的重载】时才现形，
// 所以这个测试必须走真实的点击 + 导航，不能在同一个页面里模拟。
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 880 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());          // 「重开一局？」的 confirm
  const creating = () => page.evaluate(() => !!document.getElementById('create'));

  // ① 全新一局（localStorage 是空的）：该自己弹捏人
  await page.goto(URL);
  await page.waitForTimeout(1500);
  const c1 = await creating();
  await page.click('#cgo');
  await page.waitForTimeout(400);
  const c1off = !(await creating());

  // ② 跑几天存上
  await page.evaluate(() => { autoPilot = true; speed = 60; running = true; });
  await page.waitForFunction(() => day >= 3, null, { timeout: 180000, polling: 300 });
  const saved = await page.evaluate(() => (saveGame(), hasSave()));

  // ③ 刷新：该续上原来那局，不该再问你捏人
  await page.reload();
  await page.waitForTimeout(1600);
  const r = await page.evaluate(() => ({ day, has: hasSave() }));
  const c2 = await creating();

  // ④ 点「重开一局」：档要真的没了、天数归一、捏人页要回来
  const nav = page.waitForNavigation({ timeout: 20000 }).catch(() => null);
  const btn = await page.evaluate(() => {
    const b = document.querySelector('[data-reset="1"]'); if (!b) return false;
    b.click(); return true;
  });
  await nav;
  await page.waitForTimeout(1800);
  const a = await page.evaluate(() => ({ day, has: hasSave(), sims: sims.length }));
  const c3 = await creating();

  const checks = [
    ['新局弹捏人页', c1, c1],
    ['定下来就关掉', c1off, c1off],
    ['跑起来能存档', saved, saved],
    ['刷新续上原局', r.day >= 3 && r.has, `day${r.day}`],
    ['刷新不再问捏人', !c2, c2],
    ['找到重开按钮', btn, btn],
    ['重开真把档擦了', !a.has, a.has],      // ← pagehide 把档写回去的话这条会红
    ['重开回到第一天', a.day === 1, a.day],
    ['重开后花名册在', a.sims >= 4, a.sims],
    ['重开弹回捏人页', c3, c3],
    ['无报错', errs.length === 0, errs[0] || ''],
  ];
  await browser.close();
  const bad = checks.filter(c => !c[1]);
  for (const [n, ok, v] of checks) console.log(`${ok ? '✓' : '✗'} ${n} ${v}`);
  console.log(bad.length ? `FAIL[${bad.map(c => c[0]).join(',')}]` : `PASS 全部 ${checks.length} 项`);
  process.exit(bad.length ? 1 : 0);
})();
