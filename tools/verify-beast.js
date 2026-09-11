// 野兽：该来的时候来，该走的时候走。
//
// 原先有两处漏洞，合起来让野兽成了村里最大的死因：
//   ① ttl 到点的判断写在「闲逛」分支里 —— 盯着人的那只永远不走（实测单只活
//      0.8 天，ttl 本该 0.33 天），咬死一个接着咬下一个。
//   ② beastCap() 降了没人清场 —— beastSpawn 只管不再生成，已经在场的照旧咬。
//      于是「白天的春夏一只都没有」这条设计是空的（实测 200 天里 393 个
//      春夏白天的小时有野兽在场）。
// 放大后果的是：野兽只追山上的人，而 NPC 上山砍柴毫无还手之力 ——
// strike() 是玩家专用的键盘动作。200 天 12 人亡里 6 个被咬死，且专挑十几二十岁。
//
// 【量具】这个测试不按实时跑，而是直接 step()：
//   · 可复现 —— 按实时跑的话，页面加载后到脚本接管之间跑了多少步取决于机器
//     负载，起始 clock 一漂，野兽出没的哈希种子就变了，同一份代码两次跑出
//     完全不同的村子。我为此误判过一次「游戏不可复现」。
//   · 快 —— 200 天约 12 秒，按实时跑要二十多分钟。
const { chromium } = require('playwright');
const path = require('path');
const DAYS = 200;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html')
                  + '?auto=1&t=' + Date.now());
  await page.waitForFunction(() => typeof step === 'function', null, { timeout: 30000 });

  const r = await page.evaluate(d => {
    running = false; autoPilot = true;          // 接管：从这里开始一步都不多不少
    const born = {}, deaths = [];
    const oDie = die, oBite = beastBite;
    let bites = 0;
    window.die = (x, w) => { deaths.push(`${x.name} ${x.age}岁 ${w || ''}`); return oDie(x, w); };
    window.beastBite = (b, t) => { bites++; return oBite(b, t); };

    let maxAge = 0, maxN = 0, offSeason = 0;
    const target = day + d; let guard = 0, lastHr = -1;
    while (day < target && guard++ < d * 1440 / SIM_DT * 1.2) {
      step(SIM_DT);
      if (ending) ending = null;                // 玩家死了也接着跑，不然天数不可比
      const now = day * 1440 + clock;
      for (const x of BEASTS) {
        if (born[x.id] == null) born[x.id] = now;
        maxAge = Math.max(maxAge, now - born[x.id]);
      }
      maxN = Math.max(maxN, BEASTS.length);
      const hr = (clock / 60 | 0);
      if (hr !== lastHr) {
        lastHr = hr;
        // 「白天的春夏一只都没有」。5 点那一格不算：clock 在 beastTick 之后才
        // 推进，所以交界的那一瞬读到的是上一小时的场面，清场要等下一步。
        const 白天 = clock >= 5 * 60 && clock < 19 * 60;
        if (白天 && hr !== 5 && ['春', '夏'].includes(seasonOf(day)) && BEASTS.length) offSeason++;
      }
    }
    return { day, maxN, bites, deaths,
      beastKills: deaths.filter(x => /咬的/.test(x)).length,
      maxAgeDays: +(maxAge / 1440).toFixed(2), ttlDays: +(480 / 1440).toFixed(2),
      offSeason };
  }, DAYS);
  await browser.close();

  const checks = [
    ['跑满了天数', r.day >= DAYS, r.day],
    ['野兽不会赖着不走', r.maxAgeDays <= r.ttlDays + 0.02, `${r.maxAgeDays}天 / ttl ${r.ttlDays}天`],
    ['春夏白天一只都没有', r.offSeason === 0, r.offSeason + ' 小时'],
    ['同时在场不超过冬夜上限 4', r.maxN <= 4, r.maxN],
    // NPC 上山砍柴没有还手之力，所以野兽不该是村里的主要死因
    ['没人被咬死', r.beastKills === 0, r.beastKills],
    ['咬人次数没有失控', r.bites < 60, r.bites],
    ['两百天里死的人不算多', r.deaths.length <= 8, r.deaths.length],
    ['无报错', errs.length === 0, errs[0] || ''],
  ];
  const bad = checks.filter(c => !c[1]);
  for (const [n, ok, v] of checks) console.log(`${ok ? '✓' : '✗'} ${n} ${v}`);
  console.log('  死亡名单: ' + (r.deaths.join('、') || '无'));
  console.log(bad.length ? `FAIL[${bad.map(c => c[0]).join(',')}]`
                         : `PASS 全部 ${checks.length} 项（${DAYS} 天）`);
  process.exit(bad.length ? 1 : 0);
})();
