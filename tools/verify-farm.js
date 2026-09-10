// 定向验证 T19 种地。
// 冒烟测试只跑 3 天，而一茬庄稼要 3 天以上，所以那边看不出循环是否闭合 ——
// 这里直接驱动状态机，把每一条设计意图变成可证伪的断言。
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html'));
  await page.waitForTimeout(1400);

  // === 1. 四阶段循环必须闭合，且回到「耕」而不是「荒」 ===
  const cycle = await page.evaluate(() => {
    running = false;
    // 【改过】field1 原是玩家那块私田。开局无家之后玩家的田要自己开，
    // 这条测的是田的状态机本身，跟谁的田无关 —— 改用 sims[1] 自己那块（field2）。
    const s = sims[1], o = OBJ.find(x => x.id === 'field2'), f = o.field;
    const seen = [];
    const snap = () => seen.push({ st: fieldStage(f), n: o.n, note: o.note, dur: o.dur });
    f.st = '荒'; f.grow = 0; f.wet = false; f.sower = null;
    s.inv.food = 5;
    snap(); o.eff(s);                       // 开垦
    snap(); const foodBefore = s.inv.food; o.eff(s);   // 播种
    const sowCost = foodBefore - s.inv.food;
    snap();
    for (let i = 0; i < 3; i++) { f.wet = true; farmDayTick(); }
    snap();                                  // 应当已成穗
    const gain0 = s.inv.food; o.eff(s);      // 收割
    snap();
    return { seen, sowCost, gain: s.inv.food - gain0 };
  });

  // === 2. 不浇水就不长 —— 这是"每天都得回来一趟"的全部来源 ===
  const water = await page.evaluate(() => {
    const o = OBJ.find(x => x.id === 'field2'), f = o.field;
    f.st = '苗'; f.grow = 0; f.wet = false; f.sower = sims[1].name;
    for (let i = 0; i < 5; i++) farmDayTick();          // 五天不管
    const dry = f.grow;
    f.grow = 0;
    for (let i = 0; i < 3; i++) { f.wet = true; farmDayTick(); }
    const wet = f.grow;
    return { dry, wet };
  });

  // === 3. 没浇的田要把家计【拉低】—— 否则种下去就没人管了 ===
  const upkeep = await page.evaluate(() => {
    const s = sims[3];
    for (const f of FIELDS) { f.st = '荒'; f.grow = 0; f.wet = false; f.sower = null; }
    s.inv.food = 4; s.money = 40;
    const bare = provision(s);
    const f = FIELDS[0];
    f.st = '苗'; f.grow = 50; f.sower = s.name; f.wet = true;
    const watered = provision(s);
    f.wet = false;
    const thirsty = provision(s);
    // 熟了之后不能再算作家底，否则没人去收（实测六块田全熟在地里）
    f.grow = 100; f.wet = false;
    const ripe = provision(s);
    return { bare, watered, thirsty, ripe };
  });

  // === 4. 抢收要结仇，自收不结仇（只可能发生在【公田】——私田别人根本进不去）===
  const theft = await page.evaluate(() => {
    const owner = sims[1], thief = sims[2], o = OBJ.find(x => x.id === 'common1'), f = o.field;
    owner.mem = {}; thief.mem = {}; refreshRel();
    const before = owner.rel[thief.name];
    f.st = '苗'; f.grow = 100; f.wet = false; f.sower = owner.name;
    settleEff(thief, o, o.eff(thief));
    const after = owner.rel[thief.name];
    const m = (owner.mem[thief.name] || []).filter(e => e.type === 'conflict.harvest');
    // 自己收自己的
    f.st = '苗'; f.grow = 100; f.sower = owner.name;
    const n0 = Object.keys(owner.mem).length;
    settleEff(owner, o, o.eff(owner));
    const selfGrudge = (owner.mem[owner.name] || []).length;
    return { before, after, memN: m.length, memW: m[0] && m[0].w, selfGrudge };
  });

  // === 5. 不饿的时候不该去动公田上别人种的庄稼 ===
  const restraint = await page.evaluate(() => {
    const s = sims[4], o = OBJ.find(x => x.id === 'common1'), f = o.field;
    f.st = '苗'; f.grow = 100; f.wet = false; f.sower = sims[5].name;
    for (const k of NK) if (NEEDS[k].dec) s.need[k] = 85;
    s.inv.food = 8;
    const full = score(s, o, true);
    s.need.hunger = 15; s.inv.food = 0;                 // 断粮又饿
    const starving = score(s, o, true);
    return { full, starving, ratio: full > 0 ? +(starving / full).toFixed(1) : 0 };
  });

  // === 6. 自己种的不该被这道闸门误伤（同一块公田，只换播种人）===
  const own = await page.evaluate(() => {
    const s = sims[4], o = OBJ.find(x => x.id === 'common2'), f = o.field;
    for (const k of NK) if (NEEDS[k].dec) s.need[k] = 85;
    s.inv.food = 8;
    f.st = '苗'; f.grow = 100; f.wet = false; f.sower = s.name;
    const mine = score(s, o, true);
    f.sower = sims[5].name;
    const theirs = score(s, o, true);
    return { mine, theirs };
  });

  // === 7. 私田是真私的：别人连候选都进不了；公田人人可用 ===
  const tenure = await page.evaluate(() => {
    const mineObj = OBJ.find(o => o.field && o.field.owner === sims[1].name);
    const pub = OBJ.find(o => o.field && !o.field.owner);
    for (const k of NK) if (NEEDS[k].dec) { sims[1].need[k] = 50; sims[2].need[k] = 50; }
    return {
      ownerSees: score(sims[1], mineObj, true) != null,
      otherBlind: score(sims[2], mineObj, true) === null,
      pubOpen: score(sims[1], pub, true) != null && score(sims[2], pub, true) != null,
      privCount: FIELDS.filter(f => f.owner).length,
      // 【改过】原来的不变量是"私田人手一块"。开局无家之后，玩家那块地是空的、
      // 田要自己开 —— 基准改成"除玩家外，每座有人的宅子自带一块私田"。
      npcFields: FIELDS.filter(f => f.owner && f.owner !== PC.name).length,
      npcHomes: HOMEOWNER.filter((n, i) => n && i !== PLOT0).length,
      pubCount: FIELDS.filter(f => !f.owner).length,
      people: sims.length,
      // 公田更肥，才值得跑那三十格
      pubYield: (() => { const f = pub.field, s = sims[1];
        f.st = '苗'; f.grow = 100; f.crop = '稻'; f.sower = s.name;
        const b = s.inv.food; fieldEff(f, s); return s.inv.food - b; })(),
      privYield: (() => { const f = mineObj.field, s = sims[1];
        f.st = '苗'; f.grow = 100; f.crop = '稻'; f.sower = s.name;
        const b = s.inv.food; fieldEff(f, s); return s.inv.food - b; })(),
    };
  });

  const st = cycle.seen.map(x => x.st).join('→');
  const P = [
    ['① 四阶段闭合（荒→耕→苗→穗→耕）', st === '荒→耕→苗→穗→耕'],
    ['② 播种耗一斗米', cycle.sowCost === 1],
    ['③ 收割得四斗米', cycle.gain === 4],
    ['④ 收完回到熟田，不用重开垦', cycle.seen[4].st === '耕'],
    ['⑤ 名称/提示/时长随阶段变', new Set(cycle.seen.map(x => x.n)).size >= 4
                                && new Set(cycle.seen.map(x => x.dur)).size >= 3],
    ['⑥ 不浇水就长不熟', water.dry < 100 && water.wet >= 100],
    ['⑦ 长着的庄稼算家底', upkeep.watered > upkeep.bare],
    ['⑧ 没浇的田把家计拉低', upkeep.thirsty < upkeep.watered],
    ['⑨ 熟了不再算家底（逼人下地）', upkeep.ripe < upkeep.watered],
    ['⑩ 抢收结仇', theft.after < theft.before - 10 && theft.memN === 1 && theft.memW <= -20],
    ['⑪ 自收不结仇', theft.selfGrudge === 0],
    ['⑫ 不饿就不动别人的田', restraint.starving > restraint.full * 5],
    ['⑬ 闸门不误伤自己种的', own.mine > own.theirs * 5],
    ['⑭ 除玩家外每户一块私田', tenure.npcFields === tenure.npcHomes],
    ['⑮ 公田还在（抢收靠它）', tenure.pubCount >= 1],
    ['⑯ 私田只有主人看得见', tenure.ownerSees && tenure.otherBlind],
    ['⑰ 公田人人可用', tenure.pubOpen],
    ['⑱ 公田更肥（值得跑那几十格）', tenure.pubYield > tenure.privYield],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  T19 种地' : 'FAIL  T19 种地');
  for (const [t, v] of P) console.log(`  ${v ? '✓' : '✗'} ${t}`);
  console.log(`  循环: ${st}`);
  console.log(`  生长: 五天不浇 ${water.dry} / 三天浇水 ${water.wet}`);
  console.log(`  家计: 空手 ${upkeep.bare.toFixed(1)} → 浇过 ${upkeep.watered.toFixed(1)}` +
              ` → 没浇 ${upkeep.thirsty.toFixed(1)} → 熟了 ${upkeep.ripe.toFixed(1)}`);
  console.log(`  抢收: 苦主对他 ${theft.before.toFixed(1)} → ${theft.after.toFixed(1)}（记忆 ${theft.memW}）`);
  const f2 = v => (v == null ? 'null' : v.toFixed(1));
  console.log(`  克制: 吃饱时打分 ${f2(restraint.full)} / 断粮时 ${f2(restraint.starving)}` +
              `（${restraint.ratio}×）　自己种的 ${f2(own.mine)} vs 别人种的 ${f2(own.theirs)}`);
  console.log(`  田权: 邻 ${tenure.npcFields}/${tenure.npcHomes} 块 / 公 ${tenure.pubCount} 块　` +
              `收成 私${tenure.privYield} 斗 vs 公${tenure.pubYield} 斗`);
  if (errs.length) console.log('  报错:', errs.join(' | '));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
