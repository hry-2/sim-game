// 定向验证 T13/T14：不是"八卦事件发生了"，而是"玩家的行为真的传到了第三人耳朵里"。
// 这是整个改动的兑现点，必须单独证明，不能靠冒烟测试的统计侧写。
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 880 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html'));
  await page.waitForTimeout(1500);

  // === 1. 因果链：玩家跟 A 吵架 → A 转述给 B → B 对玩家变冷淡 ===
  const chain = await page.evaluate(() => {
    running = false;
    const A = sims[1], B = sims[2];
    // 干净起点
    for (const s of sims) { s.mem = {}; for (const t of sims) if (t !== s) s.rel[t.name] = REL_BASE; }
    refreshRel();
    const before = B.rel[PC.name];

    // 玩家跟 A 大吵一架（只影响 A）
    remember(A, PC.name, 'social.争执');
    remember(PC, A.name, 'social.争执');
    refreshRel();
    const midB = B.rel[PC.name];          // B 还不知情，应当不变

    // A 和 B 好好聊了一次 —— A 会把最想说的事说出去
    const n = gossipExchange(A, B);
    refreshRel();
    const afterB = B.rel[PC.name];

    const heard = (B.mem[PC.name] || []).filter(e => e.hand === 2);
    return {
      before, midB, afterB, events: n,
      heardCount: heard.length,
      heardWhy: heard[0] ? heard[0].why : null,
      heardW: heard[0] ? heard[0].w : null,
      srcW: (A.mem[PC.name].find(e => e.type === 'social.争执') || {}).w,
      // B 不该因此就跟玩家吵架（二手不算亲身恩怨）
      ownGrudge: grudgeOf(B, PC.name, true),
      allGrudge: grudgeOf(B, PC.name, false),
    };
  });

  // === 2. 闸门①：B 不能把听来的话再转给 C ===
  const relay = await page.evaluate(() => {
    const B = sims[2], C = sims[3];
    const n = gossipExchange(B, C);
    const second = (C.mem[PC.name] || []).filter(e => e.hand === 2);
    return { events: n, cGotIt: second.length };   // 应当为 0
  });

  // === 3. 闸门④：同一件事听两次不该叠加 ===
  const dedup = await page.evaluate(() => {
    const A = sims[1], B = sims[2];
    const n0 = (B.mem[PC.name] || []).length;
    gossipExchange(A, B); gossipExchange(A, B);
    return { grew: (B.mem[PC.name] || []).length - n0 };   // 应当为 0
  });

  // === 4. 闸门②：不信任的人说的话，分量更轻 ===
  const trust = await page.evaluate(() => {
    const A = sims[1], hi = sims[2], lo = sims[3];
    for (const t of [hi, lo]) { t.mem = {}; t.rel[A.name] = REL_BASE; }
    hi.rel[A.name] = 90; lo.rel[A.name] = 10;      // 一个信他，一个不信
    A.mem[PC.name] = [];
    remember(A, PC.name, 'social.争执');
    const g1 = tellGossip(A, hi), g2 = tellGossip(A, lo);
    return { trusted: g1 && Math.abs(g1.w), distrusted: g2 && Math.abs(g2.w) };
  });

  // === 5. T14 馈赠额度真的会卡住 ===
  const gift = await page.evaluate(() => {
    const s = PC; s._gift = null;
    const seq = [];
    for (let i = 0; i < 4; i++) { seq.push(giftLeft(s)); if (giftLeft(s) > 0) useGift(s); }
    const blocked = giftLeft(s) <= 0;
    day += 7;                                       // 跨周应当重置
    const nextWeek = giftLeft(s);
    day -= 7;
    return { seq, blocked, nextWeek };
  });

  // === 6. 菜单上要真的显示额度并置灰 ===
  const menu = await page.evaluate(() => {
    PC._gift = { w: Math.floor((day - 1) / 7), n: 2 };   // 额度用完
    openNpcMenu(sims[1]);
    const it = menu.items.find(x => x.a.n === '馈赠');
    const label = it.label, ok = it.ok;
    closeMenu();
    PC._gift = null;
    openNpcMenu(sims[1]);
    const fresh = menu.items.find(x => x.a.n === '馈赠').label;
    closeMenu();
    return { spent: label, spentOk: ok, fresh };
  });

  const P = [
    ['① 玩家吵架前 B 不知情', chain.before === chain.midB],
    ['② A 转述后 B 态度变差', chain.afterB < chain.midB],
    ['③ B 拿到二手记忆', chain.heardCount === 1],
    ['④ 转述必然衰减', Math.abs(chain.heardW) < Math.abs(chain.srcW)],
    ['⑤ 文案指明消息来源', /^听.+说：/.test(chain.heardWhy || '')],
    ['⑥ 二手不算亲身恩怨', chain.ownGrudge === 0 && chain.allGrudge > 0],
    ['⑦ 闸门①：二手不转述', relay.cGotIt === 0],
    ['⑧ 闸门④：听过不重听', dedup.grew === 0],
    ['⑨ 闸门②：不信则打折', trust.trusted > (trust.distrusted || 0) * 2],
    // 涟漪必须"看得见"。原本 rel/100 的信任折扣让一条争吵只传出 2 分的影响，
    // 数值上正确，玩家却完全无感 —— 这条断言守住这个设计意图。
    ['⑬ 涟漪足够被感知(≥3分)', chain.midB - chain.afterB >= 3],
    ['⑩ 馈赠两次后卡住', JSON.stringify(gift.seq) === '[2,1,0,0]' && gift.blocked],
    ['⑪ 跨周额度重置', gift.nextWeek === 2],
    ['⑫ 菜单显示额度/置灰', /本周 0\/2/.test(menu.spent) && !menu.spentOk
                            && /本周 2\/2/.test(menu.fresh)],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  T13 八卦 / T14 馈赠额度' : 'FAIL');
  for (const [t, v] of P) console.log(`  ${v ? '✓' : '✗'} ${t}`);
  console.log(`  链路: B对玩家 ${chain.before} → 吵架后 ${chain.midB} → 听说后 ${chain.afterB.toFixed(1)}`);
  console.log(`  衰减: 源 ${chain.srcW} → 二手 ${chain.heardW}`);
  console.log(`  信任: 信他 ${trust.trusted} vs 不信 ${trust.distrusted}`);
  console.log(`  文案: 「${chain.heardWhy}」`);
  if (errs.length) console.log('  报错:', errs.join(' | '));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
