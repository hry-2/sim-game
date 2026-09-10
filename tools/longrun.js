// 长程对照：八卦开 / 关，跑到第 N 天看村子的走向。
// 3 天的冒烟窗口看不出社会系统的漂移 —— 关系饱和、戾气消失、贫富拉平
// 都是十几天尺度上才显形的问题。
const { chromium } = require('playwright');
const path = require('path');

const DAYS = +(process.argv[2] || 14);

async function run(gossipOn) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html'));
  await page.waitForTimeout(1200);

  await page.evaluate(on => {
    if (!on) { window.tellGossip = () => null; gossipExchange = () => 0; }
    autoPilot = true; speed = 60; running = true;
  }, gossipOn);

  // 等到目标天数（速度 60 ≈ 每秒 4 游戏小时）
  await page.waitForFunction(d => day >= d, DAYS, { timeout: 240000, polling: 500 });

  const r = await page.evaluate(() => {
    const pairs = [];
    for (const a of sims) for (const b of sims) if (a !== b) pairs.push(a.rel[b.name]);
    const cash = sims.map(s => s.money);
    const soc = EVENTS.filter(e => e.type.startsWith('social.')
      && e.type !== 'social.missed' && e.type !== 'social.gossip');
    const second = sims.flatMap(s => Object.values(s.mem || {}).flat()).filter(e => e.hand === 2);
    return {
      day,
      relAvg: +(pairs.reduce((a, b) => a + b, 0) / pairs.length).toFixed(1),
      relMin: +Math.min(...pairs).toFixed(1),
      relMax: +Math.max(...pairs).toFixed(1),
      // 关系的离散度 —— 全都黏在一起说明社会结构被抹平了，没有派系也就没有故事
      relSpread: +(Math.max(...pairs) - Math.min(...pairs)).toFixed(1),
      // T2 特质梯度只有在长程上才测得准（3 天时摩擦还没攒够，均值会假性倒挂）
      foes: (() => { const v = []; for (const a of sims) for (const b of sims)
        if (a !== b && friction(a, b)) v.push(a.rel[b.name]);
        return v.length ? +(v.reduce((x, y) => x + y) / v.length).toFixed(1) : null; })(),
      friends: (() => { const v = []; for (const a of sims) for (const b of sims)
        if (a !== b && !friction(a, b)) v.push(a.rel[b.name]);
        return v.length ? +(v.reduce((x, y) => x + y) / v.length).toFixed(1) : null; })(),
      hostile: soc.filter(e => e.type === 'social.争执').length,
      socialN: soc.length,
      hostileRate: soc.length ? +(soc.filter(e => e.type === 'social.争执').length / soc.length).toFixed(2) : 0,
      wealthSpread: Math.max(...cash) - Math.min(...cash),
      gossipEv: EVENTS.filter(e => e.type === 'social.gossip').length,
      secondHand: second.length,
      memTotal: sims.reduce((n, s) => n + Object.values(s.mem || {}).reduce((m, l) => m + l.length, 0), 0),
      memMax: Math.max(...sims.flatMap(s => Object.values(s.mem || {}).map(l => l.length)), 0),
      starving: sims.filter(s => s.need.hunger < 5).length,
    };
  });
  await browser.close();
  return { ...r, errs: errs.length };
}

(async () => {
  const on = await run(true), off = await run(false);
  const row = (k, u) => `${k.padEnd(12)} 开:${String(on[u]).padStart(7)}   关:${String(off[u]).padStart(7)}`;
  console.log(`=== 跑到第 ${on.day} 天（八卦开/关对照）===`);
  const gradOK = on.foes < on.friends && off.foes < off.friends;
  console.log(`  特质梯度（对立的关系必须更差）: ${gradOK ? '✓ 成立' : '✗ 倒挂'}`);
  for (const [k, u] of [['特质·敌', 'foes'], ['特质·友', 'friends'], ['关系均值', 'relAvg'], ['关系最低', 'relMin'], ['关系最高', 'relMax'],
                        ['关系离散', 'relSpread'], ['社交次数', 'socialN'], ['争执占比', 'hostileRate'],
                        ['贫富差', 'wealthSpread'], ['记忆条数', 'memTotal'], ['单对峰值', 'memMax'],
                        ['八卦事件', 'gossipEv'], ['二手记忆', 'secondHand'],
                        ['饿死', 'starving'], ['报错', 'errs']])
    console.log('  ' + row(k, u));
})();
