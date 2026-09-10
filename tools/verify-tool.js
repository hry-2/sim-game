// 定向验证 T34 工具 + 菜单入口。
//
// 这一版真正的发现不是工具，而是【三个已经写好的系统玩家够不着】：
// tryInteract() 只认 EXTRA 表，于是灶台的菜谱(T26)、祠堂的四季供奉(T27)、
// 熟田的选种(T24) 全都弹不出菜单 —— openObjMenu() 里那些代码从来没被调用过。
// 祠堂更狠：它连 eff 都没有，按 E 只是干站 40 分钟，供奉永远不会发生。
//
// 所以 ①~④ 比工具那几条更要紧：它们钉的是"入口存在"，
// 而入口这种东西一旦断了，逻辑测试全绿、文档写着已完成，玩家却什么都点不到。
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
    running = false; wipeSave(); wipeBuilt(); TOOLS = {};
    const out = {};
    // 【改过】原来是 `PC.act.left = 0; step(0.25)` 跳结算。
    // 力气活（田、木作坊）现在是一下一下抡出来的，根本不走计时那条路 ——
    // left 置零毫无作用，行动会一直挂着。统一走 finishAct()，两种都收得掉。
    const finish = () => { if (PC.act) finishAct(PC); };
    const stand = id => {
      const o = OBJ.find(x => x.id === id);
      const u = o.use[0];
      PC.act = null; menu = null;
      PC.px = (u[0] + .5) * T; PC.py = (u[1] + .5) * T; PC.gx = u[0]; PC.gy = u[1];
      tryInteract();
      const m = menu ? { n: menu.items.length, labels: menu.items.map(i => i.label) } : null;
      return { o, m, acted: !!PC.act };
    };

    // 【改过】开局无家之后，玩家名下没有灶台/米缸/私田了 —— 先自己造出来再测。
    // 这反而更贴近真实玩法：这三样本来就该是玩家亲手立的。
    const mkMine = key => {
      PC.inv.wood = 999; PC.inv.stone = 999; PC.money = 9999;
      for (let y = PCHOME.y; y < PCHOME.y + HH; y++)
        for (let x = PCHOME.x; x < PCHOME.x + HW; x++)
          if (!buildCheck(key, x, y)) { placeBuild(key, x, y); return OBJ[OBJ.length - 1].id; }
      return null;
    };
    const STOVE = mkMine('灶台'), JAR = mkMine('米缸'), FIELD = mkMine('新田');

    // 手艺闸是后加的：铁斧要手艺 2 级。先确认它【真的拦得住】，
    // 再把手艺给足往下测 —— 这个文件测的是工具本身，不是解锁条件。
    PC.skill = 0; PC.inv.wood = 20; PC.money = 500;
    out.lowSkillTool = missText(craftLack(PC, CRAFT.find(c => c.tool === '斧')));

    // ---- ① 四个入口都得弹得出菜单 ----
    PC.inv.food = 9; PC.inv.veg = 3; PC.inv.wood = 9; PC.money = 500;
    const f1 = OBJ.find(o => o.id === FIELD); f1.field.st = '耕'; f1.field.grow = 0;
    out.gates = {};
    for (const [label, id] of [['stove1', STOVE], ['shrine', 'shrine'],
                               ['field1', FIELD], ['bench', 'bench']])
      out.gates[label] = stand(id).m ? stand(id).m.n : 0;
    // 只有一种做法的不该弹菜单（米缸就是"取些冷食"，弹菜单是噪音）
    const jar = stand(JAR);
    out.jarDirect = !jar.m && jar.acted;

    // ---- ② 祠堂：供奉这条路真的走得通（以前连 eff 都没有）----
    menu = null; PC.act = null;
    const se = seasonOf(day), need = OFFER[se].need;
    for (const k in need) PC.inv[k] = need[k] + 2;
    const sh = stand('shrine');
    out.shrineRow = sh.m && sh.m.labels[0];
    out.shrineOK = !!(menu && menu.items[0].ok);
    menu.idx = 0; runMenu();
    const before = JSON.stringify(SHRINE.done);
    finish();                                         // 直接跳到结算
    step(0.25);
    out.shrine = { before, after: JSON.stringify(SHRINE.done), done: !!SHRINE.done[se] };

    // ---- ③ 灶台：菜谱真的能选，而且选哪道做哪道 ----
    menu = null; PC.act = null;
    PC.inv.food = 9; PC.inv.fish = 2; PC.need.hunger = 20;
    stand(STOVE);
    const iRoast = menu.items.findIndex(i => i.label === '烤鱼');
    menu.idx = iRoast; runMenu();
    const pickedRoast = PC.act && PC.act.recipe && PC.act.recipe.n;
    const f0 = PC.inv.food, fi0 = PC.inv.fish;
    finish();
    out.cook = { picked: pickedRoast, foodSpent: f0 - PC.inv.food, fishSpent: fi0 - PC.inv.fish };

    // ---- ④ 熟田：选种要摊开，而且当季不长的那行必须是灰的（硬窗口）----
    menu = null; PC.act = null;
    f1.field.st = '耕'; f1.field.grow = 0; PC.inv.food = 9;
    const dSpring = day;
    stand(FIELD);
    out.crop = { rows: menu.items.length, springDisabled: menu.items.filter(i => !i.ok).length,
                 labels: menu.items.map(i => i.label), season: seasonOf(day) };
    menu = null; PC.act = null;
    day = dSpring + SEASON_LEN * 3;                    // 挪到冬天：稻的时令倍率是 0
    f1.field.st = '耕'; f1.field.grow = 0;
    stand(FIELD);
    out.cropWinter = { season: seasonOf(day),
                       disabled: menu.items.filter(i => !i.ok).map(i => i.label) };
    day = dSpring; menu = null; PC.act = null;
    f1.field.st = '耕'; f1.field.grow = 0;
    stand(FIELD);
    const okRow = menu.items.findIndex(i => i.ok);
    menu.idx = okRow; runMenu();
    finish();
    out.sown = { st: f1.field.st, crop: f1.field.crop, sower: f1.field.sower };

    // ================= 工具 =================
    menu = null; PC.act = null; TOOLS = {};
    const bench = OBJ.find(o => o.id === 'bench');

    // ---- ⑤ 木料/钱不够时那一行是灰的 ----
    PC.inv.wood = 2; PC.money = 5;
    stand('bench');
    out.poorRow = menu.items.filter(i => !i.ok).length;

    // ---- ⑥ 打一把斧：扣料、进"家什"、清单里不再出现 ----
    PC.skill = 999;                     // 铁斧要手艺 2 级（上面刚验过拦得住）
    PC.inv.wood = 20; PC.money = 500;
    menu = null; PC.act = null; stand('bench');
    const iAxe = menu.items.findIndex(i => /铁斧/.test(i.label));
    const w0 = PC.inv.wood, m0 = PC.money;
    menu.idx = iAxe; runMenu();
    finish();
    out.axe = { has: !!TOOLS['斧'], wood: w0 - PC.inv.wood, money: Math.round(m0 - PC.money),
                names: toolNames() };
    menu = null; PC.act = null; stand('bench');
    out.axeGone = !menu.items.some(i => /铁斧/.test(i.label));

    // ---- ⑦ 斧子真的改伐木：2 → 3 根，工时也短了 ----
    const tree = OBJ.find(o => o.id === 'tree1');
    const durWith = playerDur(tree);
    const t0 = PC.inv.wood; tree.eff(PC); const gainWith = PC.inv.wood - t0;
    const npc = sims[2], n0 = npc.inv.wood; tree.eff(npc); const gainNpc = npc.inv.wood - n0;
    TOOLS = {};
    const durWithout = playerDur(tree);
    const t1 = PC.inv.wood; tree.eff(PC); const gainWithout = PC.inv.wood - t1;
    out.axeEffect = { gainWith, gainWithout, gainNpc, durWith, durWithout, note: tree.note };

    // ---- ⑧ 背篓：采集 2 → 3；NPC 不吃 ----
    const bush = OBJ.find(o => o.forage);
    bush.forage.left = 9;
    const key = seasonForage().key;
    const b0 = PC.inv[key] || 0; bush.eff(PC); const noBag = (PC.inv[key] || 0) - b0;
    TOOLS = { 筐: 1 };
    const b1 = PC.inv[key] || 0; bush.eff(PC); const withBag = (PC.inv[key] || 0) - b1;
    const c0 = npc.inv[key] || 0; bush.eff(npc); const npcBag = (npc.inv[key] || 0) - c0;
    out.bag = { noBag, withBag, npcBag };

    // ---- ⑨ 鱼篓：空竿更少，而且 NPC 不沾光 ----
    const cast = (s, n = 60) => { let miss = 0;
      for (let i = 0; i < n; i++) { clock = (i * 30) % 1440; if (!fishRoll(1 + i % 2, s)) miss++; }
      return miss / n; };
    // 手艺会自己压低空竿率；满级时本来就只剩 1%，鱼篓的效果就量不出来了。
    // 这一段测的是【鱼篓】，所以先把手艺放回生手。
    const skBak = PC.skill; PC.skill = 0;
    TOOLS = {}; const missNo = cast(PC);
    TOOLS = { 篓: 1 }; const missYes = cast(PC); const missNpc = cast(npc);
    out.creel = { missNo, missYes, missNpc };
    PC.skill = skBak;

    // ---- ⑩ 锄：田里的活省三成工时 ----
    TOOLS = {}; const hoeNo = playerDur(f1);
    TOOLS = { 锄: 1 }; const hoeYes = playerDur(f1);
    out.hoe = { hoeNo, hoeYes };

    // ---- ⑪ 以前只有弹菜单的物件吃到手艺折扣，钓点(skill:true)漏了 ----
    TOOLS = {};
    const spot = OBJ.find(o => o.fish);
    PC.skill = 0; const d0 = playerDur(spot);
    PC.skill = 40; const d1 = playerDur(spot);
    out.skillDur = { d0, d1, base: spot.dur };

    // ---- 存档准备 ----
    TOOLS = { 斧: 1, 篓: 1 }; PC.skill = 3; day = 5; clock = 400;
    saveGame();
    out.before = { tools: Object.keys(TOOLS).sort() };
    return out;
  });

  // ---- ⑫ 工具存得下 ----
  await page.close();
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errs.push('p2: ' + e.message));
  await p2.goto(FILE);
  await p2.waitForTimeout(1600);
  const after = await p2.evaluate(() => ({ tools: Object.keys(TOOLS).sort(),
                                           names: toolNames() }));
  await browser.close();

  const P = [
    ['① 灶台弹得出菜谱（T26 起就够不着）', r.gates.stove1 >= 7],
    ['① 祠堂弹得出供奉清单（T27 起就够不着）', r.gates.shrine === 1],
    ['① 熟田弹得出选种（T24 起就够不着）', r.gates.field1 === 2],
    ['① 木作坊弹得出木器+工具', r.gates.bench >= 5],
    ['① 只有一种做法的不弹菜单（米缸）', r.jarDirect],
    ['② 祠堂供奉真的能完成', r.shrine.done && r.shrine.before !== r.shrine.after],
    ['③ 灶台选哪道做哪道（烤鱼不费米）', r.cook.picked === '烤鱼' &&
       r.cook.fishSpent === 1 && r.cook.foodSpent === 0],
    ['④ 选种摊成两行，春天两种都能种', r.crop.rows === 2 && r.crop.springDisabled === 0],
    ['④ 冬天「种稻」变灰（硬窗口真的挡住了）',
      r.cropWinter.season === '冬' && r.cropWinter.disabled.includes('种稻')],
    ['④ 选完真的种下去了', r.sown.st === '苗' && !!r.sown.crop],
    ['⑤ 料不够的工具行是灰的', r.poorRow >= 3],
    ['⑥a 手艺不够时打不了铁斧', /手艺/.test(r.lowSkillTool || '')],
    ['⑥ 打铁斧：扣木4·60文，进「家什」', r.axe.has && r.axe.wood === 4 &&
       r.axe.money === 60 && r.axe.names.includes('铁斧')],
    ['⑥ 打过的工具不再出现在清单里', r.axeGone],
    ['⑦ 铁斧：伐木 5 → 7 根', r.axeEffect.gainWithout === 5 && r.axeEffect.gainWith === 7],
    ['⑦ 铁斧：工时也短了', r.axeEffect.durWith < r.axeEffect.durWithout],
    ['⑦ NPC 不吃工具（经济不被整体抬一档）', r.axeEffect.gainNpc === 5],
    ['⑧ 背篓：采集 2 → 3，NPC 不沾光', r.bag.noBag === 2 && r.bag.withBag === 3 &&
       r.bag.npcBag === 2],
    ['⑨ 鱼篓：空竿更少，NPC 不沾光', r.creel.missYes < r.creel.missNo &&
       r.creel.missNpc === r.creel.missNo],
    ['⑩ 锄：田里的活省三成工时', r.hoe.hoeYes < r.hoe.hoeNo * 0.75],
    // 顺手修的老账：tryInteract 那条路径从来没乘过 skillSpeed，
    // 于是钓点(skill:true)对 NPC 有工时折扣、对玩家没有。
    ['⑪ 玩家现在也吃得到手艺的工时折扣', r.skillDur.d1 < r.skillDur.d0],
    ['⑫ 工具存得下读得回', JSON.stringify(r.before.tools) === JSON.stringify(after.tools) &&
       after.names.length === 2],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  T34 工具 / 菜单入口' : 'FAIL  T34 工具 / 菜单入口');
  for (const [t, v] of P) console.log(`  ${v ? '✓' : '✗'} ${t}`);
  console.log(`  入口: 灶台${r.gates.stove1}项 祠堂${r.gates.shrine}项 ` +
              `熟田${r.gates.field1}项 木作坊${r.gates.bench}项　` +
              `选种「${r.crop.labels.join('/')}」，冬天灰掉「${r.cropWinter.disabled.join('/')||'（无）'}」`);
  console.log(`  伐木: ${r.axeEffect.gainWithout}根/${r.axeEffect.durWithout}分 → ` +
              `${r.axeEffect.gainWith}根/${r.axeEffect.durWith}分（NPC 仍 ${r.axeEffect.gainNpc} 根）`);
  console.log(`  空竿: ${(r.creel.missNo * 100) | 0}% → ${(r.creel.missYes * 100) | 0}%　` +
              `田工时 ${r.hoe.hoeNo} → ${r.hoe.hoeYes}　钓点工时 ${r.skillDur.d0} → ${r.skillDur.d1}`);
  if (errs.length) console.log('  报错:', errs.join(' | '));
  process.exit(ok ? 0 : 1);
})();
