// 定向验证 T32 建造。
// 建造是这个项目里第一个让玩家【改动地图】的系统，所以风险和别的功能不是一类：
// 以前"座位不被挡""每户出得了自家院子"是启动时校验一次的静态性质，
// 现在玩家能亲手把老莫封死在他院里、把自己砌死在门内。
// 这里最要紧的两条是⑦⑧（连通性闸门）和⑬（读档顺序），其余是常规回归。
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    running = false; wipeSave(); wipeBuilt();
    const out = {};
    const freeSpot = key => {
      for (let y = PCHOME.y; y < PCHOME.y + HH; y++)
        for (let x = PCHOME.x; x < PCHOME.x + HW; x++)
          if (!buildCheck(key, x, y)) return [x, y];
      // 找不到落子点时别返回 null 让调用方在 [0] 上崩 —— 说清楚是哪一样、为什么
      throw new Error('院里找不到能放「' + key + '」的地方：' +
                      buildCheck(key, PCHOME.x + 9, PCHOME.y + 7));
    };

    // 手艺闸（后加的）排在料钱检查之前，不给足手艺的话下面全被它挡住。
    // 先单独验一下闸本身拦得住，再给足往下测。
    PC.skill = 0;
    out.lowSkill = buildCheck('义仓', PLAZA.x0 + 2, PLAZA.y0 + 2);   // 义仓要手艺 5
    PC.skill = 999;

    // ---- ① 造价是真的要付 ----
    PC.inv.wood = 0; PC.money = 5;
    out.poorWood = buildCheck('水渠', PCHOME.x + 9, PCHOME.y + 7);
    PC.inv.wood = 99;
    out.poorMoney = buildCheck('水渠', PCHOME.x + 9, PCHOME.y + 7);

    // ---- ② 【改过】规矩从"只能建在自家院里"换成了"只要是草地就行" ----
    // 玩家那块地现在既没有屋也没有篱笆，就是一片草地；禁令只剩"别人家的院子"。
    PC.money = 9999; PC.inv.stone = 9999;
    out.onDirt = buildCheck('腌坛', 30, 30);           // 镇中心：夯土/石板，不是草地
    const other = HOME[2];
    out.inHouse = buildCheck('腌坛', other.x + 2, other.y + 2);      // 别人家的屋里
    out.othersYard = buildCheck('腌坛', other.x + 9, other.y + 7);   // 别人家的院子
    out.onGrass = buildCheck('腌坛', PCHOME.x + 9, PCHOME.y + 7);    // 自己那片空地：行

    // ---- ③ 落子扣料、物件真的加进世界 ----
    const spot = freeSpot('腌坛');
    const w0 = PC.inv.wood, m0 = PC.money, n0 = OBJ.length;
    placeBuild('腌坛', spot[0], spot[1]);
    const crock = OBJ[OBJ.length - 1];
    out.placed = {
      objAdded: OBJ.length - n0, wood: w0 - PC.inv.wood, money: Math.round(m0 - PC.money),
      owner: crock.owner, art: !!FURN[artOf(crock)],
      solid: !!solid[crock.y][crock.x], cell: OBJCELL.has(crock.y * GW + crock.x),
      seatFree: !solid[crock.use[0][1]][crock.use[0][0]],
    };
    out.samePlaceTwice = buildCheck('腌坛', spot[0], spot[1]);   // 同一格不能再建

    // ---- ④ 腌坛：山货×2 → 腌货×1 ----
    PC.inv.veg = 3; PC.inv.pickle = 0;
    const canPickle = !!crock.pre(PC);
    crock.eff(PC);
    out.pickle = { canPickle, got: PC.inv.pickle, vegLeft: PC.inv.veg };
    PC.inv.veg = 0; PC.inv.fruit = 0; PC.inv.mush = 0; PC.inv.herb = 0;
    out.pickleWhy = crock.pre(PC) ? null : (typeof crock.why === 'function' ? crock.why(PC) : crock.why);

    // ---- ⑤ 腌货能卖，而且比生货贵 ----
    const stall = OBJ.find(o => o.id === 'stall');
    PC.inv.goods = 0; PC.inv.fish = 0; PC.inv.pickle = 2;
    const canSell = !!stall.pre(PC);
    const mm = PC.money; const ev = stall.eff(PC);
    out.sell = { canSell, type: ev.type, val: ev.val, gain: Math.round(PC.money - mm),
                 vsFish: MKT.pickle.base > MKT.fish.base };

    // ---- ⑥ 水渠：挨着的田每天自动浇 ----
    const f = FIELDS[0];
    f.st = '苗'; f.grow = 0; f.wet = false; f.crop = '稻';
    PC.inv.wood = 999; PC.inv.stone = 999;
    const dOK = placeBuild('水渠', f.x + 1, f.y);
    farmDayTick();
    const auto = f.grow;
    // 拆了水渠就该回到"不浇不长"
    wipeBuilt();
    f.st = '苗'; f.grow = 0; f.wet = false;
    farmDayTick();
    out.ditch = { placed: dOK, watered: auto, without: f.grow };

    // ---- ⑦ 不能把自己砌死（院子现在有南北两个门）----
    PC.inv.wood = 9999; PC.inv.stone = 9999; PC.money = 99999;
    const fill = row => {
      const refused = [];
      for (let x = PCHOME.x; x < PCHOME.x + HW; x++) {
        const why = buildCheck('水渠', x, row);
        if (!why) placeBuild('水渠', x, row);
        else if (/封死/.test(why)) refused.push(x);      // 只数"会把路封死"这一种
      }
      return refused;
    };
    // 【改过】原来的场景是"院子只有两个门，堵完最后一个就封死"。
    // 玩家那块地现在没有篱笆、四面通着，那个场景不存在了。
    // 但这道闸要防的事还在 —— connectivityOK 查的是"所有座位和所有人都还到得了"。
    // 换个还成立的场景：【把自己砌死】。人站在一格上，围三面，第四面必须被拦下。
    const px = PCHOME.x + 5, py = PCHOME.y + 5;
    PC.px = (px + .5) * T; PC.py = (py + .5) * T; PC.gx = px; PC.gy = py;
    out.southRefused = [];                       // 围前三面：一面都不该被拦
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1]]) {
      const why = buildCheck('水渠', px + dx, py + dy);
      if (why) out.southRefused.push(why); else placeBuild('水渠', px + dx, py + dy);
    }
    // 第四面：堵上人就出不来了，必须恰好拦下这一格
    out.gateBlocked = buildCheck('水渠', px, py + 1);
    out.northRefused = out.gateBlocked && /封死/.test(out.gateBlocked) ? [px] : [];

    // ---- ⑧ 堵完之后村子仍然处处走得通 ----
    const start = OBJ.find(o => o.id === 'shrine').use[0];
    const seen = floodFrom(start[0], start[1]);
    out.stillOpen = OBJ.every(o => (o.use || []).every(u => seen.has(u[1] * GW + u[0])));
    out.nobodyPenned = sims.every(s => seen.has((s.py / T | 0) * GW + (s.px / T | 0)));

    // ---- ⑨ 新田进 FIELDS，而且是自己的 ----
    wipeBuilt();
    const nf = FIELDS.length;
    const s2 = freeSpot('新田');
    placeBuild('新田', s2[0], s2[1]);
    out.newField = { added: FIELDS.length - nf, owner: FIELDS[FIELDS.length - 1].owner,
                     onlyMine: score(sims[1], OBJ[OBJ.length - 1], true) === null };

    // ---- ⑩ 工棚就是自家的木作坊 ----
    const s3 = freeSpot('工棚');
    placeBuild('工棚', s3[0], s3[1]);
    const shed = OBJ[OBJ.length - 1];
    PC.inv.wood = 5; PC.inv.goods = 0;
    shed.eff(PC);
    out.shed = { madeGoods: PC.inv.goods, usedWood: 5 - PC.inv.wood, skill: !!shed.skill };

    // ---- ⑪ wipeBuilt 要拆干净：格子放回去、田从 FIELDS 里摘掉 ----
    const cells = [];
    for (const o of OBJ) if (o.built) cells.push([o.x, o.y]);
    wipeBuilt();
    out.wiped = { objLeft: OBJ.filter(o => o.built).length, fields: FIELDS.length,
                  cellsFreed: cells.every(([x, y]) => !solid[y][x] && !OBJCELL.has(y * GW + x)),
                  ditchCleared: DITCH.size === 0, builtList: BUILT.length };

    // ================= T33 新增的五样 =================
    wipeBuilt(); PC.inv.wood = 9999; PC.inv.stone = 9999; PC.money = 99999;
    const townSpot = key => {
      for (let y = PLAZA.y0; y <= PLAZA.y1; y++)
        for (let x = PLAZA.x0; x <= PLAZA.x1; x++)
          if (!buildCheck(key, x, y)) return [x, y];
      throw new Error('广场上找不到能放「' + key + '」的地方：' +
                      buildCheck(key, PLAZA.x0 + 2, PLAZA.y0 + 2));
    };

    // ---- ⑯ 药圃：解开季节锁（药草野外只有冬天有），且有每日上限 ----
    const hs = freeSpot('药圃'); placeBuild('药圃', hs[0], hs[1]);
    const bed = OBJ[OBJ.length - 1];
    const h0 = PC.inv.herb; bed.eff(PC);
    out.herb = { got: PC.inv.herb - h0, again: !!bed.pre(PC), art: !!FURN[artOf(bed)],
                 season: seasonOf(day) };

    // ---- ⑰ 鸡棚：第一个两格建筑 ----
    const cs = freeSpot('鸡棚'); placeBuild('鸡棚', cs[0], cs[1]);
    const coop = OBJ[OBJ.length - 1];
    const e0 = PC.inv.egg; coop.eff(PC); coop.eff(PC);
    out.coop = { w: coop.w, seats: coop.use.length, art: !!FURN[artOf(coop)],
                 bothSolid: solid[coop.y][coop.x] === 1 && solid[coop.y][coop.x + 1] === 1,
                 eggs: PC.inv.egg - e0, capped: !coop.pre(PC) };
    dailyTick();
    out.coopReset = !!coop.pre(PC);

    // ---- ⑱ 水车：第一个有依赖的建造，把浇灌半径 1 → 2 ----
    wipeBuilt(); PC.inv.wood = 9999; PC.inv.stone = 9999; PC.money = 99999;
    out.millNoDitch = buildCheck('水车', PCHOME.x + 9, PCHOME.y + 7);
    // 【改过】FIELDS[0] 原来是玩家那块私田。开局无家之后玩家没有田，
    // FIELDS[0] 变成了邻居的 —— 水渠会被放进别人家院子，水车就永远挨不着。
    // 自己开一块再测。
    const fsp = freeSpot('新田'); placeBuild('新田', fsp[0], fsp[1]);
    const fd = FIELDS[FIELDS.length - 1];
    placeBuild('水渠', fd.x + 2, fd.y);            // 离田两格：没水车够不着
    const reset = () => { fd.st = '苗'; fd.grow = 0; fd.wet = false; fd.crop = '稻'; };
    reset(); farmDayTick(); const noMill = fd.grow;
    const ms = freeSpot('水车'); placeBuild('水车', ms[0], ms[1]);
    reset(); farmDayTick(); const withMill = fd.grow;
    out.mill = { noDitch: out.millNoDitch, on: millOn(), noMill, withMill,
                 twoByTwo: OBJ[OBJ.length - 1].w === 2 && OBJ[OBJ.length - 1].h === 2 };

    // ---- ⑲ 凉亭：第一个公共建筑，NPC 真的看得见 ----
    wipeBuilt(); PC.inv.wood = 9999; PC.inv.stone = 9999; PC.money = 99999;
    out.pavInYard = buildCheck('凉亭', PCHOME.x + 9, PCHOME.y + 7);
    const ps = townSpot('凉亭'); placeBuild('凉亭', ps[0], ps[1]);
    const pav = OBJ[OBJ.length - 1];
    for (const k of NK) if (NEEDS[k].dec) sims[2].need[k] = 45;
    out.pav = { noOwner: !pav.owner, zone: pav.zone, art: !!FURN[artOf(pav)],
                npcSees: score(sims[2], pav, true) != null, social: !!pav.social };

    // ---- ⑳ 义仓：第一件利他建造 —— 捐粮，第二天施给最饿的人 ----
    const gs = townSpot('义仓'); placeBuild('义仓', gs[0], gs[1]);
    const gran = OBJ[OBJ.length - 1];
    PC.inv.food = 5; const gf = PC.inv.food;
    gran.eff(PC);
    const starving = sims[3];
    starving.need.hunger = 8; starving.inv.food = 0;
    doleTick();
    out.dole = { cost: gf - PC.inv.food, stock: DOLE.stock, fed: starving.inv.food,
                 art: !!FURN[artOf(gran)], noOwner: !gran.owner,
                 // 没人挨饿就不该白发粮
                 idle: (() => { const st = DOLE.stock; sims.forEach(s => { s.need.hunger = 90; });
                                doleTick(); return DOLE.stock === st; })() };

    // ---- ㉑ 每一样都得有画法、有"为什么" ----
    out.allArt = Object.keys(BUILD).every(k => !!FURN[BUILD[k].art]);
    out.allWhy = OBJ.filter(o => o.built && o.pre &&
      !o.why && !Object.getOwnPropertyDescriptor(o, 'why')).map(o => o.id);
    out.nKinds = Object.keys(BUILD).length;
    // ---- ㉒ 石料：造价扣得掉，谷仓真的抬高了存粮的封顶 ----
    wipeBuilt(); PC.inv.wood = 9999; PC.inv.stone = 9999; PC.money = 99999;
    const st0 = PC.inv.stone;
    const bs = freeSpot('谷仓'); placeBuild('谷仓', bs[0], bs[1]);
    PC.inv.food = 20;
    const withBarn = provision(PC);
    const savedN = BARN.n; BARN.n = 0;
    const noBarn = provision(PC);
    BARN.n = savedN;
    out.stone = { spent: st0 - PC.inv.stone, withBarn, noBarn,
                  quarryExists: OBJ.some(o => o.quarry),
                  poor: (() => { PC.inv.stone = 0;
                                 const w = buildCheck('义仓', PLAZA.x0, PLAZA.y0);
                                 PC.inv.stone = 9999; return w; })() };

    // ---- 为读档准备：造两样，并把田的状态摆成可辨认的样子 ----
    wipeBuilt();
    PC.inv.wood = 9999; PC.inv.stone = 9999; PC.money = 99999;      // ⑩ 把木料压到 5 了，这里得加回来
    const a = freeSpot('腌坛'); placeBuild('腌坛', a[0], a[1]);
    const c = freeSpot('新田'); placeBuild('新田', c[0], c[1]);
    FIELDS.forEach((fd, i) => { fd.st = '苗'; fd.grow = (i + 1) * 7; fd.wet = i % 2 === 0;
                                fd.crop = '稻'; fd.sower = sims[i % sims.length].name; });
    PC.inv.pickle = 3;
    day = 4; clock = 500;
    saveGame();
    out.before = {
      built: BUILT.map(b => `${b.key}@${b.x},${b.y}`),
      fields: FIELDS.map(fd => `${fd.st}${fd.grow}${fd.wet ? '湿' : '干'}${fd.sower}`),
      nField: FIELDS.length, pickle: PC.inv.pickle,
    };
    return out;
  });

  // ---- ⑬ 关掉再打开：造的东西还在，而且田的状态没有串位 ----
  await page.close();
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errs.push('p2: ' + e.message));
  await p2.goto(FILE);
  await p2.waitForTimeout(1600);
  const after = await p2.evaluate(() => ({
    built: BUILT.map(b => `${b.key}@${b.x},${b.y}`),
    fields: FIELDS.map(fd => `${fd.st}${fd.grow}${fd.wet ? '湿' : '干'}${fd.sower}`),
    nField: FIELDS.length, pickle: PC.inv.pickle,
    objBuilt: OBJ.filter(o => o.built).length,
    // 再读一次不能让建筑翻倍（wipeBuilt 没做对就会）
    twice: (() => { loadGame(); return OBJ.filter(o => o.built).length; })(),
  }));
  await browser.close();

  const b = r.before;
  const P = [
    ['① 木料不够会说差多少', /差 16 根木料/.test(r.poorWood)],
    ['① 钱不够也会说差多少', /差 \d+ 文/.test(r.poorMoney)],
    ['② 手艺不够会说要几级', /手艺不够/.test(r.lowSkill || '')],
    ['② 夯土地上不给建', /不是草地/.test(r.onDirt || '')],
    ['② 别人家屋里不给建', /不是草地|别人家/.test(r.inHouse || '')],
    ['② 别人家院子不给建', /别人家的院子/.test(r.othersYard || '')],
    ['② 自己那片草地给建', r.onGrass === null],
    ['③ 落子扣料并加进世界', r.placed.objAdded === 1 && r.placed.wood === 8 &&
       r.placed.money === 20 && r.placed.owner === '小满' && r.placed.art &&
       r.placed.solid && r.placed.cell && r.placed.seatFree],
    ['③ 同一格不能建两次', !!r.samePlaceTwice],
    ['④ 腌坛：山货×2 → 腌货×1', r.pickle.canPickle && r.pickle.got === 1 && r.pickle.vegLeft === 1],
    ['④ 没山货时说得清为什么', /山货/.test(r.pickleWhy || '')],
    ['⑤ 腌货能卖，且比鱼值钱', r.sell.canSell && r.sell.type === 'econ.soldpickle' &&
       r.sell.gain > 0 && r.sell.vsFish],
    ['⑥ 水渠自动浇田', r.ditch.placed && r.ditch.watered > r.ditch.without * 3],
    ['⑥ 拆了水渠就回到"不浇不长"', r.ditch.without < r.ditch.watered],
    ['⑦ 围前三面时不该拦', r.southRefused.length === 0],
    ['⑦ 第四面会把人砌死，恰好拦下', r.northRefused.length === 1],
    ['⑦ 提示说得清是"把路封死了"', /封死/.test(r.gateBlocked || '')],
    ['⑧ 建完村子处处仍走得通', r.stillOpen && r.nobodyPenned],
    ['⑨ 新田进 FIELDS 且只有自己看得见', r.newField.added === 1 &&
       r.newField.owner === '小满' && r.newField.onlyMine],
    ['⑩ 工棚就是自家的木作坊', r.shed.madeGoods >= 1 && r.shed.usedWood === 2 && r.shed.skill],
    ['⑪ 拆干净：格子放回去 / 田摘掉 / 水渠清空', r.wiped.objLeft === 0 &&
       r.wiped.cellsFreed && r.wiped.ditchCleared && r.wiped.builtList === 0],
    ['⑫ 造的东西存得下、读得回', JSON.stringify(b.built) === JSON.stringify(after.built) &&
       after.objBuilt === b.built.length],
    // 田的状态是按 FIELDS 下标存的，新田会改变数组长度 ——
    // 读档时必须【先】replay 建造再套田的状态，顺序反了整片田就串位。
    ['⑬ 田的状态没有串位（读档顺序对）', b.nField === after.nField &&
       JSON.stringify(b.fields) === JSON.stringify(after.fields)],
    ['⑭ 腌货存得下', b.pickle === after.pickle],
    ['⑮ 再读一次建筑不会翻倍', after.twice === after.objBuilt],
    ['⑯ 药圃：不分季节都采得到药草', r.herb.got === 1 && r.herb.art],
    ['⑯ 药圃有每日上限（不能无限薅）', !r.herb.again],
    ['⑰ 鸡棚是 2×1，两格都占住、两个座位', r.coop.w === 2 && r.coop.seats === 2 &&
       r.coop.bothSolid && r.coop.art],
    ['⑰ 每天两枚蛋，拾完就停，隔天恢复', r.coop.eggs === 2 && r.coop.capped && r.coopReset],
    ['⑱ 水车必须挨着水渠', /挨着水渠/.test(r.mill.noDitch || '')],
    ['⑱ 水车把浇灌半径 1 → 2', r.mill.on && r.mill.noMill < 10 && r.mill.withMill > 30],
    ['⑱ 水车是 2×2', r.mill.twoByTwo],
    ['⑲ 凉亭只能建在镇上', /镇中心/.test(r.pavInYard || '')],
    ['⑲ 凉亭无主，NPC 真的看得见', r.pav.noOwner && r.pav.zone === 'commons' &&
       r.pav.npcSees && r.pav.social && r.pav.art],
    ['⑳ 义仓：捐两斗进公仓', r.dole.cost === 2 && r.dole.stock >= 1 && r.dole.noOwner],
    ['⑳ 第二天施给最饿的人', r.dole.fed === 1],
    ['⑳ 没人挨饿就不白发粮', r.dole.idle],
    // 【别写死样数】—— 这个仓库自己在别处也写过这条教训（"别写死块数"）。
    // 要守的是"每一样都有画法、带条件的都写了为什么"，不是"恰好十样"。
    [`㉑ ${r.nKinds} 样都有画法、带条件的都写了为什么`,
      r.allArt && r.allWhy.length === 0 && r.nKinds >= 10],
    ['㉒ 石料造价扣得掉', r.stone.spent === 10],
    ['㉒ 石料不够时说得清差多少', /差 \d+ 块石料/.test(r.stone.poor || '')],
    ['㉒ 谷仓抬高存粮在家计里的封顶', r.stone.withBarn > r.stone.noBarn],
    ['㉒ 北山有采石场', r.stone.quarryExists],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  T32 建造' : 'FAIL  T32 建造');
  for (const [t, v] of P) console.log(`  ${v ? '✓' : '✗'} ${t}`);
  console.log(`  拦下的格子: 南排 ${r.southRefused.join(',') || '（无，还有北门）'}` +
              `　北排 ${r.northRefused.join(',') || '（无）'}` +
              `　院门内侧提示「${r.gateBlocked}」`);
  console.log(`  水渠: 挨着的田 ${r.ditch.watered} / 拆掉后 ${r.ditch.without}` +
              `　腌货 ${r.sell.val} 文 vs 鱼 ${16} 文`);
  console.log(`  存档: ${b.built.join(' ')}　田 ${b.nField} 块`);
  if (errs.length) console.log('  报错:', errs.join(' | '));
  process.exit(ok ? 0 : 1);
})();
