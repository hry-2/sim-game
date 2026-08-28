// 定向验证 T37 · 恋爱与成家。
//
// 两条设计红线，前面几条断言就是钉它们的：
//   ① 不加新数值 —— 关系仍然只从记忆推导，恋爱是【状态】不是进度条；
//      「相恋/结发」必须双方都够格，一厢情愿点不动。
//   ② 成家必须有机制后果 —— 私产互通、家计合一、吃醋写进记忆、孩子每天要哄。
//      少了这些它就只是一枚勋章。
//
// 最后一条（⑫）是这个项目真正的差异化：**不用玩家插手，NPC 自己会谈恋爱**。
// 星露谷里 Abigail 和 Sebastian 之间永远不会发生任何事。
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');

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
    const A = sims[1], B = sims[2], C = sims[3];
    const warm = (x, y, n) => { for (let i = 0; i < n; i++) {
      day++; remember(x, y.name, 'social.深谈'); remember(x, y.name, 'social.馈赠'); } };

    // ---- ① 起点：关系是读数，不是进度条 ----
    out.start = { bond: bondOf(A, B.name), pair: !!pairOf(A.name),
                  int: Math.round(intimacy(A, B.name)) };

    // ---- ② 门槛是【双向】的：一厢情愿不算数 ----
    warm(A, B, 9); refreshRel();
    out.oneSided = { aRel: Math.round(A.rel[B.name]), bRel: Math.round(B.rel[A.name]),
                     canWoo: canWoo(A, B) };
    warm(B, A, 9); refreshRel();
    out.mutual = { canWoo: canWoo(A, B), bond: bondOf(A, B.name),
                   aInt: Math.round(intimacy(A, B.name)) };

    // ---- ③ 示好 → 相恋 ----
    makeLovers(A, B);
    out.lovers = { bond: bondOf(A, B.name), sym: bondOf(B, A.name),
                   canWedNow: canWed(A, B) };

    // ---- ④ 相恋不满 5 日不能求亲 ----
    day += WED_DAYS - 1; A.money = 500;
    out.tooSoon = canWed(A, B);
    day += 2;
    out.longEnough = canWed(A, B);

    // ---- ⑤ 聘礼只扣一次 ----
    // 这是这一版真正踩到的 bug：结算的第一行就 `s.money -= a.cost`，
    // 等走到 canWed() 时"钱够不够"已经被自己扣成不够了 ——
    // 于是钱照扣、亲永远成不了，而且不报错。二十天的自动跑里两对情侣一直停在"相恋"。
    const wedAct = SOCIAL.find(a => a.love === 'wed');
    const m0 = A.money;
    A.act = { social: { t: B, a: wedAct }, phase: 'do', left: 0, seat: 'social',
              o: { n: '求亲', dur: wedAct.dur, adv: { social: wedAct.soc } } };
    step(0.25);
    out.wed = { st: (PAIR[pkey(A.name, B.name)] || {}).st,
                paid: Math.round(m0 - A.money), cost: WED_COST,
                spouse: spouseOf(A.name) };

    // ---- ⑥ 私产互通，但只对自家人 ----
    const bBed = OBJ.find(o => o.owner === B.name && artOf(o) === 'bed');
    out.share = { spouseSees: score(A, bBed, true) != null,
                  strangerBlind: score(C, bBed, true) === null,
                  hint: (() => { const u = bBed.use[0];
                    const sv = [C.px, C.py]; C.act = null;
                    PC.act = null; const pp = [PC.px, PC.py];
                    PC.px = (u[0] + .5) * T; PC.py = (u[1] + .5) * T;
                    const w = blockReason(bBed, u, PC);
                    PC.px = pp[0]; PC.py = pp[1]; C.px = sv[0]; C.py = sv[1];
                    return w; })() };

    // ---- ⑦ 家计合一 ----
    A.inv.food = 0; A.money = 0; B.inv.food = 9; B.money = 100;
    const together = provision(A);
    const k = pkey(A.name, B.name), keep = PAIR[k]; delete PAIR[k];
    const alone = provision(A);
    PAIR[k] = keep;
    out.house = { together: Math.round(together), alone: Math.round(alone) };

    // ---- ⑧ 吃醋：不另做系统，写进配偶的记忆，八卦自然会传 ----
    B.mem = {}; refreshRel();
    jealousy(A, C.name);
    const jm = (B.mem[A.name] || [])[0];
    out.jealous = { n: (B.mem[A.name] || []).length, type: jm && jm.type,
                    negative: jm && jm.w < 0,
                    // 对着配偶自己不该吃醋
                    self: (() => { B.mem = {}; jealousy(A, B.name);
                                   return (B.mem[A.name] || []).length; })() };

    // ---- ⑨ 一个人只有一个对象 ----
    out.exclusive = { wooThird: canWoo(A, C), thirdWooA: canWoo(C, A) };

    // ---- ⑩ 孩子：成家满 5 日出生；不哄要掉需求；哄了就不掉 ----
    day += KID_AFTER; kidTick();
    const kid = kidOf(A.name);
    out.kid = { born: !!kid, key: kid && kid.key };
    A.need.fun = 80; B.need.fun = 80;
    day += 3; kidTick();
    out.neglect = { funDropped: A.need.fun < 80, both: B.need.fun < 80 };
    kid.fed = day; A.need.fun = 80;
    kidTick();
    out.cared = { funKept: A.need.fun === 80 };
    // 摇篮：孩子在地图上是一个真物件，而且 NPC 父母也够得着
    const crib = OBJ.find(o => o.crib);
    const inYardOf = nm => { const i = NAMES.indexOf(nm); if (i < 0 || !crib) return false;
      const h = HOME[i];
      return crib.x >= h.x && crib.x < h.x + HW && crib.y >= h.y && crib.y < h.y + HH; };
    kid.fed = day - 1;
    out.crib = { exists: !!crib, art: crib && !!FURN[artOf(crib)],
                 inYard: inYardOf(A.name) || inYardOf(B.name),
                 solid: crib && solid[crib.y][crib.x] === 1,
                 parentSees: crib && score(A, crib, true) != null,
                 otherParent: crib && score(B, crib, true) != null,
                 strangerBlind: crib && score(C, crib, true) === null,
                 needsCare: crib && !!crib.pre(A), note1: crib && crib.note };
    crib.eff(A);
    out.cribFed = { needsCare: !!crib.pre(A), note: crib.note, fed: kid.fed === day };

    // ---- 存档准备 ----
    KIDS.length = 0; KIDS.push({ key: k, born: day - 2, fed: day - 1 }); syncCribs();
    day = 30; clock = 300;
    saveGame();
    out.before = { pair: JSON.stringify(PAIR), kids: JSON.stringify(KIDS) };
    out.K = { LOVE_REL, LOVE_INT, WED_REL, WED_DAYS, WED_COST, KID_AFTER };
    return out;
  });

  // ---- ⑪ 存档 ----
  await page.close();
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errs.push('p2: ' + e.message));
  await p2.goto(FILE);
  await p2.waitForTimeout(1600);
  const after = await p2.evaluate(() => ({ pair: JSON.stringify(PAIR),
                                           kids: JSON.stringify(KIDS),
                                           cribs: OBJ.filter(o => o.crib).length }));
  await p2.close();

  // ---- ⑫ 涌现：不碰玩家，跑 14 天，看 NPC 自己有没有谈起恋爱 ----
  const p3 = await ctx.newPage();
  p3.on('pageerror', e => errs.push('run: ' + e.message));
  await p3.goto(FILE);
  await p3.waitForTimeout(1400);
  await p3.evaluate(() => { wipeSave(); autoPilot = true; speed = 60; running = true; });
  await p3.waitForFunction(() => day >= 14, null, { timeout: 600000, polling: 500 });
  const em = await p3.evaluate(() => {
    running = false;
    return { day, pairs: Object.entries(PAIR).map(([k, v]) => `${k}:${v.st}`),
             kids: KIDS.length };
  });
  await browser.close();

  const P = [
    ['① 起点没有对象，关系只是个读数', !r.start.pair && r.start.int === 0 &&
       ['陌生', '相识', '交好'].includes(r.start.bond)],
    ['② 一厢情愿点不动（门槛是双向的）', !r.oneSided.canWoo],
    ['② 双方都够了才能示好', r.mutual.canWoo && r.mutual.aInt >= r.K.LOVE_INT],
    ['③ 示好之后双方都是「相恋」', r.lovers.bond === '相恋' && r.lovers.sym === '相恋'],
    ['④ 相恋不满 %d 日求不了亲'.replace('%d', r.K.WED_DAYS), !r.lovers.canWedNow && !r.tooSoon],
    ['④ 满了才能求亲', r.longEnough],
    // 这条钉的是真踩到的 bug：先扣钱再判资格 → 钱照扣、亲永远成不了
    ['⑤ 求亲走完真的成了亲', r.wed.st === '结发' && r.wed.spouse],
    ['⑤ 聘礼只扣一次（不是两次）', r.wed.paid === r.wed.cost],
    ['⑥ 成家后私产互通', r.share.spouseSees],
    ['⑥ 外人还是进不去', r.share.strangerBlind && /家的/.test(r.share.hint || '')],
    ['⑦ 家计合一（一本账）', r.house.together > r.house.alone + 20],
    ['⑧ 吃醋写进配偶的记忆，且是负分', r.jealous.n === 1 && r.jealous.negative &&
       r.jealous.type === 'conflict.吃醋'],
    ['⑧ 对着配偶自己不吃醋', r.jealous.self === 0],
    ['⑨ 一个人只有一个对象', !r.exclusive.wooThird && !r.exclusive.thirdWooA],
    ['⑩ 成家满 %d 日有孩子'.replace('%d', r.K.KID_AFTER), r.kid.born],
    ['⑩ 不哄，双亲都掉需求', r.neglect.funDropped && r.neglect.both],
    ['⑩ 哄过就不掉', r.cared.funKept],
    ['⑩ 孩子在地图上是一个真物件（摇篮，摆在院子里）',
      r.crib.exists && r.crib.art && r.crib.inYard && r.crib.solid],
    // 这条是把"哄孩子"从床的菜单挪出来的理由：菜单只有玩家点得到，
    // 挂在那儿的话 NPC 父母永远哄不了自己的孩子 —— 那不是设计，是漏洞。
    ['⑩ 双亲都够得着，外人够不着', r.crib.parentSees && r.crib.otherParent &&
      r.crib.strangerBlind],
    ['⑩ 该哄的时候要哄，哄过就睡着', r.crib.needsCare && !r.cribFed.needsCare &&
      r.cribFed.fed && /睡着/.test(r.cribFed.note)],
    // 摇篮不进存档：它完全由 KIDS 推导，读档时重建一次（和 wipeBuilt 同一套思路）
    ['⑪ 姻缘和孩子存得下读得回', r.before.pair === after.pair &&
      JSON.parse(r.before.kids).length === JSON.parse(after.kids).length &&
      JSON.parse(after.kids)[0].key === JSON.parse(r.before.kids)[0].key],
    ['⑪ 读档后摇篮照着 KIDS 重建，不重不漏', after.cribs === JSON.parse(after.kids).length],
    // 这一条是差异化本身：星露谷里 NPC 之间永远不会发生任何事
    ['⑫ 十四天里 NPC 自己谈起了恋爱（玩家没插手）', em.pairs.length >= 1],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  T37 恋爱与成家' : 'FAIL  T37 恋爱与成家');
  for (const [t, v] of P) console.log(`  ${v ? '✓' : '✗'} ${t}`);
  console.log(`  门槛: 示好 关系${r.K.LOVE_REL}/交心${r.K.LOVE_INT}　成亲 关系${r.K.WED_REL}/相恋${r.K.WED_DAYS}日/聘礼${r.K.WED_COST}文`);
  console.log(`  单边 ${r.oneSided.aRel}↔${r.oneSided.bRel} → 不行；双边够了 → 可以`);
  console.log(`  家计: 各过各的 ${r.house.alone} → 一本账 ${r.house.together}`);
  console.log(`  第 ${em.day} 天自动跑：${em.pairs.join('、') || '（还没有人成对）'}　孩子 ${em.kids}`);
  if (errs.length) console.log('  报错:', errs.join(' | '));
  process.exit(ok ? 0 : 1);
})();
