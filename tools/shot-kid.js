// 截图：摇篮里的孩子进花名册 + 成年后住厢屋的铺盖。
// 这一版有两处只有眼睛能验的东西：花名册那一行长什么样、铺盖画出来像不像地铺。
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1180, height: 900 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(FILE);
  await p.waitForTimeout(1600);

  await p.evaluate(() => {
    running = false; wipeSave();
    const A = sims[0], B = sims[1];               // 玩家和邻居
    for (let i = 0; i < 9; i++) { day++;
      remember(A, B.name, 'social.深谈'); remember(B, A.name, 'social.深谈');
      remember(A, B.name, 'social.馈赠'); remember(B, A.name, 'social.馈赠'); }
    refreshRel(); makeLovers(A, B); day += 6; A.money = 200; makeWed(A, B);
    day += 5; kidTick(); panel();
  });
  await p.click('.who b[data-kid="0"]');
  await p.waitForTimeout(200);
  await p.locator('#panel').screenshot({ path: 'shot-kid-panel.png' });

  await p.evaluate(() => {
    day += GROW_UP; growTick();
    const kid = sims[sims.length - 1];
    PC.px = (HOME[kid.home].x + 3.5) * T; PC.py = (HOME[kid.home].y + 4.5) * T;
    PC.gx = PC.px / T | 0; PC.gy = PC.py / T | 0;
    render(); panel();
  });
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'shot-kid-house.png' });
  const info = await p.evaluate(() => ({
    roster: sims.map(s => s.name + '@' + s.home + (HOMEOWNER[s.home] === s.name ? '(户主)' : '(厢)')),
    bunks: OBJ.filter(o => o.bunk).map(o => o.n + '@' + o.x + ',' + o.y),
    feed: EVENTS.slice(-6).map(e => evText(e)),
  }));
  console.log(JSON.stringify(info, null, 1));
  await b.close();
})();
