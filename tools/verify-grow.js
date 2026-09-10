// 定向验证 T40 · 孩子成人。
//
// 地基三样在 T39 就位了（mkSim 工厂 / 16 行图集 / 花名册进存档），
// 这一版只剩两件事，而两件都是【设计取舍】，所以断言主要钉的是取舍本身：
//
//   ① 遗传什么。脸遗传不了 —— 图集是离线烘焙的，运行时混不出"像爹又像娘"的脸。
//      但脾气可以混，而且在这个游戏里脾气才是真正看得见的东西：
//      MBTI 四个字母各取自父母一方，性格取自一方，特质父母各出一样。
//   ② 住哪。有空宅就接手（比外人优先），没有就出外谋生。
//      于是"你家孩子能不能留下"和"村里有没有人过世"是同一条线 —— 那才叫延续。
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(1800);

  const r = await page.evaluate(() => {
    running = false; wipeSave();
    const out = {};
    const A = sims[1], B = sims[4];
    const warm = (x, y, n) => { for (let i = 0; i < n; i++) { day++;
      remember(x, y.name, 'social.深谈'); remember(x, y.name, 'social.馈赠'); } };

    // ---- ① 出生就起名（事件流和摇篮在他长大之前就得叫得出这个名字）----
    warm(A, B, 9); warm(B, A, 9); refreshRel();
    makeLovers(A, B); day += 6; A.money = 200; makeWed(A, B);
    day += 5; kidTick();
    const kid = KIDS[0];
    out.born = { name: kid.name, crib: OBJ.find(o => o.crib).n,
                 named: !!kid.name && kid.name.length > 0 };

    // ---- ②a 没有空宅，但爹娘家还住得下 → 留在家里（T41）----
    // 原来这里只有"空宅 or 出外"两条路，于是村里六座宅子一满，
    // 孩子长大就直接消失 —— 玩家看到的是【孩子没出现在花名册里】。
    day += GROW_UP - 3; growTick();          // 先走到"预告"那一天
    day += 3;
    const n0 = sims.length;
    growTick();
    const stayed = sims.find(s => s.name === kid.name);
    const hK = stayed && stayed.home;         // 住进爹娘中哪一家由游戏决定
    const bunk = OBJ.find(o => o.bunk && o.owner === kid.name);
    const ownBed = OBJ.find(o => o.homeIdx === hK && o.priv && !o.bunk);
    const jar = OBJ.find(o => o.homeIdx === hK && o.id.startsWith('jar'));
    out.stay = {
      n: [n0, sims.length], inSims: !!stayed,
      sameHome: stayed && (stayed.home === A.home || stayed.home === B.home),
      notOwner: HOMEOWNER[hK] !== kid.name && [A.name, B.name].includes(HOMEOWNER[hK]),
      bunk: !!bunk, worse: bunk && ownBed && bunk.adv.energy < ownBed.adv.energy,
      // 同住一宅：米缸共用，铺位各归各的
      shareJar: stayed && score(stayed, jar, true) !== null,
      ownBedBlocked: stayed && score(stayed, ownBed, true) === null,
      ev: EVENTS.some(e => e.type === 'family.stay'),
      // 铺盖是【绕过建造校验】直接放进屋里的一格实心物 ——
      // 建造系统有连通性闸门，它没有。所以这里补一次全图可达性。
      reach: (() => {
        const st = OBJ.find(o => o.id === 'shrine').use[0];
        const seen = floodFrom(st[0], st[1]);
        return OBJ.every(o => (o.use || []).every(u => seen.has(u[1] * GW + u[0])));
      })(),
      // 预告：成年前三天就该说一声，而且只说一次
      soon: EVENTS.filter(e => e.type === 'family.soon').length === 1,
    };

    // ---- ②b 空宅没有、爹娘两家也都满了 → 出外谋生（村子不会无限膨胀）----
    // 成家不搬家：爹娘各有各的宅子，所以【两边各能收一个】。
    // 一直生到没地方为止 —— 上限是真的存在，而不是第一个孩子就被赶走。
    const n1 = sims.length;
    let left = 0, rounds = 0;
    while (!left && rounds++ < 4) {
      PAIR[pkey(A.name, B.name)] = { st: '结发', since: day - 6 };
      day += 5; kidTick();
      day += GROW_UP; growTick();
      left = EVENTS.filter(e => e.type === 'family.leave').length;
    }
    out.noRoom = { grew: sims.length - n1, gone: !KIDS.length, left, rounds,
                   cap: HOMECAP,
                   full: [A.home, B.home].every(h => residents(h).length === HOMECAP) };

    // ---- ③ 有空宅 → 接手，而且比外人优先 ----
    PAIR[pkey(A.name, B.name)] = { st: '结发', since: day - 6 };
    day += 5; kidTick();
    const kid2 = KIDS[0];
    const C = sims[2], hi = C.home;
    C.vigor = 1; C.need.hunger = 2; C.need.energy = 2;
    day++; lifeTick();
    out.vacant = HOMEOWNER[hi] === null;
    // 孩子快成年时，空宅要给他留着 —— 外人不该抢先搬进来
    day += GROW_UP - 2;
    const beforeMoveIn = sims.length;
    lifeTick(); lifeTick();
    out.reserved = { n: sims.length, noOutsider: sims.length === beforeMoveIn };
    day += 4; growTick();
    const kidSim = sims.find(s => s.name === kid2.name);
    out.grown = {
      became: !!kidSim, home: kidSim && kidSim.home === hi,
      owner: HOMEOWNER[hi] === (kid2 && kid2.name),
      parents: kidSim && kidSim.parents, age: kidSim && kidSim.age,
      row: kidSim && kidSim.row, freshRow: kidSim && !sims.some(s => s !== kidSim && s.row === kidSim.row),
      cribGone: !OBJ.some(o => o.crib),
      dad: A.mbti, mum: B.mbti, child: kidSim && kidSim.mbti,
      everyLetter: kidSim && [0, 1, 2, 3].every(i =>
        kidSim.mbti[i] === A.mbti[i] || kidSim.mbti[i] === B.mbti[i]),
      // 换几个种子跑一遍：每个字母永远来自父母，而且【混得出双方都没有的组合】。
      // 只看一个孩子是测不出来的 —— 他碰巧跟爹一样也说明不了机制坏了。
      mixes: (() => {
        const rows = [];
        for (let sd = 1; sd <= 12; sd++) rows.push(inherit(A, B, sd).mbti);
        return { all: rows,
                 everyLetterOK: rows.every(m => [0,1,2,3].every(i =>
                   m[i] === A.mbti[i] || m[i] === B.mbti[i])),
                 mixed: rows.some(m => m !== A.mbti && m !== B.mbti) };
      })(),
      traitFrom: kidSim && (kidSim.trait === A.trait || kidSim.trait === B.trait),
      ttBoth: kidSim && kidSim.tt.some(t => A.tt.includes(t)) &&
                        kidSim.tt.some(t => B.tt.includes(t)),
      persona: kidSim && !!kidSim.w && kidSim.tt.length > 0,
    };

    // ---- ④ 血亲不通婚 ----
    if (kidSim) {
      delete PAIR[pkey(A.name, B.name)];
      const D = sims.find(s => s !== kidSim && s !== A && s !== B && !s.parents);
      for (let i = 0; i < 14; i++) { day++;
        for (const [x, y] of [[kidSim, A], [A, kidSim], [kidSim, D], [D, kidSim]]) {
          remember(x, y.name, 'social.深谈'); remember(x, y.name, 'social.馈赠'); } }
      refreshRel();
      out.kin = { relDad: Math.round(kidSim.rel[A.name]),
                  relOther: Math.round(kidSim.rel[D.name]),
                  wooDad: canWoo(kidSim, A),          // 亲爹：不行
                  wooOther: canWoo(kidSim, D),        // 外人：同样的关系，可以
                  isKin: kin(kidSim, A), notKin: kin(kidSim, D) };
    }

    // ---- 存档准备 ----
    day = 90; clock = 300; saveGame();
    out.before = sims.map(s => s.name + (s.parents ? '(' + s.parents.join('+') + ')' : ''));
    return out;
  });

  // ---- ⑤ 出身进存档 ----
  await page.close();
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errs.push('p2: ' + e.message));
  await p2.goto(FILE);
  await p2.waitForTimeout(1800);
  const after = await p2.evaluate(() =>
    sims.map(s => s.name + (s.parents ? '(' + s.parents.join('+') + ')' : '')));
  await browser.close();

  const g = r.grown;
  const P = [
    ['① 出生就起名，摇篮上写着他的名字', r.born.named && /摇篮/.test(r.born.crib) &&
      r.born.crib.startsWith(r.born.name)],
    ['② 成年前三日先给个预告', r.stay.soon],
    ['② 没空宅但爹娘家住得下 → 留下，进花名册',
      r.stay.n[1] === r.stay.n[0] + 1 && r.stay.inSims && r.stay.sameHome &&
      r.stay.ev],
    ['② 留下的不是户主，睡自己的铺盖（比榻差）',
      r.stay.notOwner && r.stay.bunk && r.stay.worse],
    ['② 同住一宅：米缸共用，铺位各归各的',
      r.stay.shareJar && r.stay.ownBedBlocked],
    ['② 多出来的那一格没把屋里堵死（铺盖不走建造校验）', r.stay.reach],
    ['② 爹娘两家各收一个，满了才出外谋生（村子不会无限膨胀）',
      r.noRoom.left === 1 && r.noRoom.gone && r.noRoom.grew === 1 && r.noRoom.full],
    ['③ 有人过世，宅子空出来', r.vacant],
    ['③ 孩子快成年时空宅给他留着，外人不抢先', r.reserved.noOutsider],
    ['③ 成年后接手那座宅子', g.became && g.home && g.owner],
    ['③ 十六岁当家，摇篮撤掉', g.age === 16 && g.cribGone],
    ['③ 有自己的长相（图集里没人用过的一行）', g.row >= 6 && g.freshRow],
    // 遗传的是脾气不是脸 —— 这是这一版的设计取舍本身
    ['④ MBTI 四个字母各取自父母一方', g.everyLetter],
    ['④ 十二个种子里每个字母都来自父母', g.mixes.everyLetterOK],
    ['④ 混得出双方都没有的组合（不是照抄一方）', g.mixes.mixed],
    ['④ 性格取自一方，特质父母各出一样', g.traitFrom && g.ttBoth],
    ['④ 新人是完整的人，不是空壳', g.persona && !!g.parents],
    ['⑤ 血亲不通婚：跟亲爹不行', r.kin && !r.kin.wooDad && r.kin.isKin],
    ['⑤ 同样的关系，跟外人可以', r.kin && r.kin.wooOther && !r.kin.notKin],
    ['⑥ 出身存得下读得回', JSON.stringify(r.before) === JSON.stringify(after) &&
      after.some(x => /\(/.test(x))],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  T40 孩子成人' : 'FAIL  T40 孩子成人');
  for (const [t, v] of P) console.log(`  ${v ? '✓' : '✗'} ${t}`);
  console.log(`  ${g.parents ? g.parents.join(' × ') : '?'} → ${r.born.name}` +
              `　人格 ${g.dad} × ${g.mum} → ${g.child}`);
  console.log(`  十二个种子: ${[...new Set(g.mixes.all)].join(' ')}`);
  if (r.kin) console.log(`  血亲: 对亲爹关系 ${r.kin.relDad}（示好 ${r.kin.wooDad ? '可' : '不可'}）` +
                         `　对外人 ${r.kin.relOther}（示好 ${r.kin.wooOther ? '可' : '不可'}）`);
  console.log(`  花名册: ${after.join(' ')}`);
  if (errs.length) console.log('  报错:', errs.join(' | '));
  process.exit(ok ? 0 : 1);
})();
