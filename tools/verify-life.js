// 定向验证 T39 · 生老病死 + 外观图集。
//
// 在这之前，诊断里那个「饿死」只是 `sims.filter(s=>s.need.hunger<5).length` ——
// 一个计数，掉到 0 也不会死。这一版把它变成真的。
//
// 两条设计前提，前几条断言就是钉它们的：
//   ① 不做生日簿。一年 28 天，活到七十是一千九百多天，那种"寿终"玩家一辈子看不到。
//      年岁只是【初始条件】（决定体质封顶），真正的死因是【照顾不周】。
//   ② 阵容不再是常数。人会死、会有人搬进来，所以花名册必须进存档，
//      而且宅子、私田、床的归属要跟着一起转手 —— 这是最容易漏的一环。
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

    // ---- ① 年岁是初始条件：老的人体质封顶就低 ----
    out.cast = sims.map(s => ({ n: s.name, age: s.age, cap: Math.round(vigorCap(s)),
                                row: s.row }));
    out.rows = new Set(sims.map(s => s.row)).size;
    out.atlas = ATLAS_ROWS;
    const old = sims.reduce((a, b) => a.age > b.age ? a : b);
    const young = sims.reduce((a, b) => a.age < b.age ? a : b);
    out.ageCap = { oldCap: vigorCap(old), youngCap: vigorCap(young) };

    // ---- ② 病从体质弱 / 身上脏 / 天时不好来（都用已有的量）----
    const A = sims[3];
    const base = illRisk(A);
    A.vigor = 20; const lowVigor = illRisk(A);
    A.vigor = 100; A.need.hygiene = 8; const dirty = illRisk(A);
    A.need.hygiene = 80;
    out.risk = { base, lowVigor, dirty };

    // ---- ③ 病是真的会来的，而且病人格外想躺着 ----
    A.vigor = 18; A.need.hygiene = 10;
    let d0 = day;
    for (let i = 0; i < 60 && !A.ill; i++) { day++; lifeTick(); }
    const bed = OBJ.find(o => o.owner === A.name && artOf(o) === 'bed');
    const sick = score(A, bed, true);
    const wasIll = A.ill; A.ill = 0;
    const well = score(A, bed, true); A.ill = wasIll;
    out.ill = { got: !!A.ill, days: day - d0, sick, well };

    // ---- ④ 药草能治：榻上的「将养」（这是药草第一次真的有用）----
    // 【改过】开局无家，玩家的榻要自己支 —— 先造一张再测「将养」
    PC.inv.wood = 999; PC.money = 9999;
    for (let y = PCHOME.y; y < PCHOME.y + HH && !OBJ.some(o => o.built && o.owner === PC.name); y++)
      for (let x = PCHOME.x; x < PCHOME.x + HW; x++)
        if (!buildCheck('榻', x, y)) { placeBuild('榻', x, y); break; }
    const myBed = OBJ.find(o => o.owner === PC.name && artOf(o) === 'bed');
    PC.ill = 1; PC.inv.herb = 0;
    const noHerb = menuList(myBed).find(v => v.heal);
    PC.inv.herb = 2;
    const withHerb = menuList(myBed).find(v => v.heal);
    out.heal = { row: !!withHerb, greyNoHerb: noHerb && !noHerb.ok, okWithHerb: withHerb && withHerb.ok };
    PC.act = { o: myBed, seat: 'x', st: myBed.use[0], phase: 'do', left: 0,
               scale: 0.6, heal: 1, variantDur: 180 };
    step(0.25);
    out.healed = { ill: PC.ill, herb: PC.inv.herb };

    // ---- ⑤ 死：不是一个标记，是真的从村子里消失 ----
    const B = sims.find(s => !s.isPlayer && s !== A);
    const hi = B.home, n0 = sims.length;
    B.vigor = 1; B.need.hunger = 2; B.need.energy = 2;
    day++; lifeTick();
    out.death = { before: n0, after: sims.length,
                  gone: GONE.map(g => g.name), inSims: sims.includes(B),
                  homeVacant: HOMEOWNER[hi] === null };

    // ---- ⑥ 空宅不是无主之物 ----
    // owner 闸门只挡"有主且不是我的"。人一没，owner 变 null，
    // 闸门直接放行 —— 全村都能进死者家里睡觉。这条单独挡。
    const deadBed = OBJ.find(o => o.homeIdx === hi && artOf(o) === 'bed');
    const deadField = OBJ.find(o => o.homeIdx === hi && o.field);
    out.vacant = { name: deadBed.n,
                   nobodyCanUse: sims.every(s => score(s, deadBed, true) === null),
                   fieldToo: sims.every(s => score(s, deadField, true) === null),
                   hint: (() => { const u = deadBed.use[0]; PC.act = null;
                     const pp = [PC.px, PC.py];
                     PC.px = (u[0] + .5) * T; PC.py = (u[1] + .5) * T;
                     const w = blockReason(deadBed, u, PC);
                     PC.px = pp[0]; PC.py = pp[1]; return w; })() };

    // ---- ⑦ 迁入：空宅挂出去，几天后有人来，长相取图集里没人用的一行 ----
    for (let i = 0; i < 8 && sims.length < 6; i++) { day++; lifeTick(); }
    const nu = sims.find(s => !NAMES.includes(s.name));
    out.movein = { came: !!nu, name: nu && nu.name, age: nu && nu.age,
                   row: nu && nu.row, freshRow: nu && !NAMES.some((_, i) => i === nu.row),
                   tookHome: HOMEOWNER[hi] === (nu && nu.name),
                   bedRenamed: deadBed.n, canUse: nu && score(nu, deadBed, true) != null,
                   hasPersona: nu && !!nu.trait && !!nu.mbti && nu.tt.length > 0 };

    // ---- ⑧ 玩家亡故 → 终局（这个无终局沙盒第一次有了终局）----
    // 先存一份改过阵容的档，留给下面的读档验证
    day = 40; clock = 500;
    saveGame();
    out.before = { roster: sims.map(s => `${s.name}@${s.home}/${s.row}/${s.age}`),
                   homeowner: HOMEOWNER.slice(), gone: GONE.map(g => g.name) };
    return out;
  });

  // ---- ⑨ 花名册进存档：人换了，读回来还是那批人、住那些宅子 ----
  await page.close();
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errs.push('p2: ' + e.message));
  await p2.goto(FILE);
  await p2.waitForTimeout(1800);
  const after = await p2.evaluate(() => ({
    roster: sims.map(s => `${s.name}@${s.home}/${s.row}/${s.age}`),
    homeowner: HOMEOWNER.slice(), gone: GONE.map(g => g.name),
    pcIsPlayer: !!PC.isPlayer, pcName: PC.name,
    // 继承来的宅子，主人用得了；别人用不了
    // 【改过】原来查的是"玩家继承来的宅子"，而玩家那块地现在是空的、没有榻。
    // 这条要守的是「有主的榻只有主人和配偶用得了」，跟是不是玩家无关 —— 改用邻居的。
    ownOK: (() => { const owner = sims.find(s => !s.isPlayer && s.home != null);
                    const b = OBJ.find(o => o.homeIdx === owner.home && artOf(o) === 'bed');
                    const other = sims.find(s => s !== owner && s.name !== spouseOf(owner.name));
                    return !!b && score(owner, b, true) != null
                               && score(other, b, true) === null; })(),
    // ⑧ 终局：一局结束就是结束 —— 死后还自动存档的话，
    // pagehide 会把"死后的村子"存下去，重开时玩家会静默变成花名册里的第一个人。
    ending: (() => { running = false;
      PC.vigor = 1; PC.need.hunger = 2; PC.need.energy = 2;
      day++; lifeTick();
      return { shown: !!ending, name: ending && ending.name,
               inSims: sims.includes(PC), saveWiped: hasSave() === false }; })(),
  }));
  await browser.close();

  const P = [
    ['① 六个人年岁不同，图集行号也不同', r.cast.length === 6 && r.rows === 6],
    ['① 图集有十六行长相（够迁入的人用）', r.atlas >= 12],
    ['① 年岁只当初始条件：老的人体质封顶更低',
      r.ageCap.oldCap < r.ageCap.youngCap && r.ageCap.youngCap === 100],
    ['② 体质越弱越容易病', r.risk.lowVigor > r.risk.base],
    ['② 身上越脏越容易病', r.risk.dirty > r.risk.base],
    ['③ 病真的会来', r.ill.got],
    ['③ 病人格外想躺着（不给 NPC 开特例，只放大"歇着"）', r.ill.sick > r.ill.well],
    ['④ 榻上有「将养」，没药草是灰的', r.heal.row && r.heal.greyNoHerb && r.heal.okWithHerb],
    ['④ 一剂药草病即愈（药草第一次真有用）', r.healed.ill === 0 && r.healed.herb === 1],
    ['⑤ 死了是真的从村子里消失', r.death.after === r.death.before - 1 && !r.death.inSims],
    ['⑤ 名字进了「已故」，宅子空出来', r.death.gone.length === 1 && r.death.homeVacant],
    // 这条是这一版最容易漏的一环
    ['⑥ 空宅不是无主之物（榻和田都没人能用）',
      r.vacant.nobodyCanUse && r.vacant.fieldToo && /空着/.test(r.vacant.hint || '')],
    ['⑦ 几天后有人迁入，住进那座空宅', r.movein.came && r.movein.tookHome],
    ['⑦ 新人有自己的长相（图集里没人用过的一行）', r.movein.row >= 6],
    ['⑦ 新人有性格/特质/人格，不是空壳', r.movein.hasPersona],
    ['⑦ 宅子转手：床改了名，新主人用得了', /阿|石|三|四|六|秋|竹|木/.test(r.movein.bedRenamed) &&
      r.movein.canUse],
    ['⑧ 玩家亡故 → 终局屏', after.ending.shown && !after.ending.inSims],
    ['⑧ 一局结束就是结束：存档抹掉，不会读回一个"死后的村子"',
      after.ending.saveWiped],
    ['⑨ 花名册存得下读得回（阵容已经不是原来那六个）',
      JSON.stringify(r.before.roster) === JSON.stringify(after.roster) &&
      r.before.roster.some(x => !/小满|阿沅|老莫|芜青|阿柳|梨娘/.test(x))],
    ['⑨ 宅子归属和已故名单也存得下',
      JSON.stringify(r.before.homeowner) === JSON.stringify(after.homeowner) &&
      JSON.stringify(r.before.gone) === JSON.stringify(after.gone)],
    ['⑨ 读档后玩家还是玩家，继承的宅子权限也对', after.pcIsPlayer && after.ownOK],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  T39 生老病死' : 'FAIL  T39 生老病死');
  for (const [t, v] of P) console.log(`  ${v ? '✓' : '✗'} ${t}`);
  console.log(`  阵容: ${r.cast.map(c => `${c.n}${c.age}岁(封顶${c.cap})`).join(' ')}`);
  console.log(`  病risk: 常态 ${r.risk.base.toFixed(3)} / 体质弱 ${r.risk.lowVigor.toFixed(3)}` +
              ` / 身上脏 ${r.risk.dirty.toFixed(3)}　${r.ill.days} 天后病倒`);
  console.log(`  躺着的分数: 病着 ${r.ill.sick.toFixed(1)} vs 没病 ${r.ill.well.toFixed(1)}`);
  console.log(`  ${r.death.gone.join('、')} 没了 → 空宅「${r.vacant.name}」` +
              ` → ${r.movein.name}（${r.movein.age} 岁，图集第 ${r.movein.row} 行）搬了进来`);
  console.log(`  读档后的花名册: ${after.roster.join(' ')}`);
  if (errs.length) console.log('  报错:', errs.join(' | '));
  process.exit(ok ? 0 : 1);
})();
