// 性别与性向。要守两件事：
//   ① 它是真机制 —— 看不上就是追不动，跟关系多好无关
//   ② 它不是谁的劣势 —— 同性成家和异性成家走的是同一条路，
//      一样的门槛、一样有孩子（生不出就抱养）、一样长大成人
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html') + '?auto=1';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    running = false; wipeSave();
    const out = {};
    const warm = (x, y, n) => { for (let i = 0; i < n; i++) { day++;
      remember(x, y.name, 'social.深谈'); remember(x, y.name, 'social.馈赠'); } };

    // ---- ① 阵容里本来就有各种组合，不用玩家去凑 ----
    out.cast = sims.map(s => `${s.name}·${s.sex}·${orientOf(s)}`);
    out.kinds = [...new Set(sims.map(s => orientOf(s)))];
    out.bothSexes = new Set(sims.map(s => s.sex)).size >= 2;

    // ---- ② 看不上就追不动：把关系刷满也一样 ----
    const gay = sims.find(s => orientOf(s) === '同');
    const foe = sims.find(s => s !== gay && !gay.likes.includes(s.sex));
    for (let i = 0; i < 20; i++) { warm(gay, foe, 1); warm(foe, gay, 1); }
    refreshRel();
    out.blocked = { rel: Math.round(gay.rel[foe.name]),
                    woo: canWoo(gay, foe),
                    mutual: mutualLike(gay, foe) };

    // ---- ③ 同性：同样的关系就能成 ----
    const mate = sims.find(s => s !== gay && mutualLike(gay, s) && !s.parents);
    for (let i = 0; i < 20; i++) { warm(gay, mate, 1); warm(mate, gay, 1); }
    refreshRel();
    out.same = { who: gay.name + '×' + mate.name,
                 sameSex: gay.sex === mate.sex,
                 woo: canWoo(gay, mate) };
    makeLovers(gay, mate);
    p_since(); function p_since() { PAIR[pkey(gay.name, mate.name)].since = day - WED_DAYS - 1; }
    gay.money = 999;
    out.same.wed = canWed(gay, mate);
    makeWed(gay, mate);
    out.same.spouse = spouseOf(gay.name) === mate.name;

    // ---- ④ 生不出就抱养：一样有孩子，一样要哄，一样长大 ----
    out.canBear = canBear(gay, mate);
    PAIR[pkey(gay.name, mate.name)].since = day - 99;
    const n0 = KIDS.length, e0 = EVENTS.length;
    kidTick();
    const ev = EVENTS.slice(e0).map(e => e.type);
    out.kid = { added: KIDS.length - n0,
                via: ev.includes('family.adopt') ? '抱养' : ev.includes('family.child') ? '生育' : '没有',
                text: EVENTS.slice(e0).map(e => evText(e)).find(t => /孩子/.test(t)) || '' };
    // 抱养来的孩子和亲生的走同一条路：有摇篮、要哄、会长大
    const kid = KIDS[KIDS.length - 1];
    out.kidSame = { crib: OBJ.some(o => o.n && o.n.includes(kid.name)),
                    needsFeeding: typeof kid.fed === 'number',
                    growsUp: typeof GROW_UP === 'number' && kid.born > 0 };
    return out;
  });
  await browser.close();

  const P = [
    ['① 阵容里本来就有多种性向，不用玩家去凑', r.kinds.length >= 3 && r.bothSexes],
    ['② 看不上就追不动 —— 关系刷满也一样',
      r.blocked.rel >= 60 && !r.blocked.mutual && !r.blocked.woo],
    ['③ 同性：同样的关系就追得动', r.same.sameSex && r.same.woo],
    ['③ 同性成家走的是同一条路（同样的门槛）', r.same.wed && r.same.spouse],
    ['④ 生不出就抱养，一样有孩子', !r.canBear && r.kid.added === 1 && r.kid.via === '抱养'],
    ['④ 抱养的孩子和亲生的一模一样：有摇篮、要哄、会长大',
      r.kidSame.crib && r.kidSame.needsFeeding && r.kidSame.growsUp],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  性别与性向' : 'FAIL  性别与性向');
  for (const [n, v] of P) console.log(`  ${v ? '✓' : '✗'} ${n}`);
  console.log('  阵容: ' + r.cast.join('　'));
  console.log(`  ${r.same.who}　成家 → ${r.kid.via}：${r.kid.text}`);
  if (errs.length) console.log('  报错: ' + errs.join(' | '));
  process.exit(ok ? 0 : 1);
})();
