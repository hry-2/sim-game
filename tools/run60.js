// 六十天托管长跑：这一版真正要看的是【村子会不会长大】。
// T40 时六座宅子一满，孩子长大就消失；现在爹娘家收得下一个，
// 所以人口该在 6 和 12 之间自己找平衡 —— 既不清零，也不无限膨胀。
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1100, height: 800 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(FILE);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { wipeSave(); autoPilot = true; speed = 60; running = true; });
  await p.waitForFunction(() => day >= 61, null, { timeout: 900000, polling: 1000 });
  const r = await p.evaluate(() => ({
    day, n: sims.length,
    roster: sims.map(s => `${s.name}${s.age}岁@${s.home}${HOMEOWNER[s.home] === s.name ? '' : '·厢'}`),
    gone: GONE.map(g => `${g.name}(${g.why})`),
    kids: KIDS.map(k => `${k.name}·${day - k.born}日`),
    bunks: OBJ.filter(o => o.bunk).map(o => o.n),
    line: ['love.wed', 'family.child', 'family.stay', 'family.grown', 'family.leave',
           'life.death', 'life.heir', 'life.movein']
      .map(t => t + ':' + EVENTS.filter(e => e.type === t).length).join(' '),
    starving: sims.filter(s => s.need.hunger < 8).length,
    avgVigor: Math.round(sims.reduce((a, s) => a + s.vigor, 0) / sims.length),
    tale: EVENTS.filter(e => ['family.stay', 'family.grown', 'family.leave', 'life.heir',
                              'life.death', 'love.wed'].includes(e.type)).map(evText),
  }));
  await b.close();
  console.log(`第 ${r.day} 日 · ${r.n} 人（${r.roster.join(' ')}）`);
  console.log(`摇篮: ${r.kids.join(' ') || '—'}　铺盖: ${r.bunks.join(' ') || '—'}`);
  console.log(`已故: ${r.gone.join(' ') || '—'}`);
  console.log(`计数: ${r.line}`);
  console.log(`饿殍 ${r.starving}　体质均值 ${r.avgVigor}`);
  console.log('—— 这六十天发生的事 ——');
  for (const t of r.tale) console.log('  ' + t);
  if (errs.length) console.log('报错:', errs.join(' | '));
  process.exit(errs.length || r.n < 6 || r.n > 12 || r.starving > 0 ? 1 : 0);
})();
