// 冒烟测试：确认游戏页能加载、无报错、画布真的画出了东西。
// 需要 playwright: npm i -D playwright && npx playwright install chromium
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 880 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html'));
  await page.waitForTimeout(2000);

  const painted = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 400) if (d[i] || d[i + 1] || d[i + 2]) n++;
    return n;
  });

  // 交互菜单必须真的画出来。之前出现过"代码没插进 render 却毫无报错"的情况，
  // 逻辑测试全绿但屏幕上什么都没有 —— 所以这里做像素级断言。
  await page.evaluate(() => {
    running = false;
    const t = sims[1]; t.act = null; PC.act = null;
    PC.px = t.px + 14; PC.py = t.py;
  });
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(150);
  const menuOk = await page.evaluate(() => {
    if (!menu || menu._w == null) return { open: false };
    const c = document.querySelector('canvas');
    const d = c.getContext('2d')
      .getImageData(menu._x * RS, menu._y * RS, menu._w * RS, menu._h * RS).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && d[i + 1] < 40) dark++;
    return { open: true, items: menu.items.length, filled: dark / (d.length / 4) };
  });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { PC.act = null; });

  // 移动必须逐帧平滑。模拟是固定步长的，如果渲染不插值，
  // 每步位移会一次性跳完 —— 逻辑完全正确，但看起来是"一格一格闪现"。
  const smooth = await page.evaluate(async () => {
    running = true;                       // 菜单检查里暂停过，这里必须恢复
    PC.px = T * 22; PC.py = T * 18; PC.ppx = PC.px; PC.ppy = PC.py; PC.act = null;
    keys.KeyD = 1;
    const s = [];
    await new Promise(r => {
      let n = 0;
      const tick = () => { s.push(PC.rx); if (++n < 50) requestAnimationFrame(tick); else r(); };
      requestAnimationFrame(tick);
    });
    keys.KeyD = 0;
    const d = [];
    for (let i = 1; i < s.length; i++) d.push(Math.abs(s[i] - s[i - 1]));
    return { moved: d.filter(v => v > 0.05).length, total: d.length, max: Math.max(...d) };
  });
  await page.evaluate(() => { PC.act = null; });

  // T2 性格特质：必须真的产生行为差异和关系梯度
  const traitPre = await page.evaluate(() => ({
    assigned: sims.every(s => s.tt && s.tt.length >= 2),
    hasOpposing: sims.some(a => sims.some(b => a !== b && friction(a, b) > 0)),
    // 特质要影响行为，不能只是关系修正
    weightSpread: Math.max(...sims.map(s => weightOf(s, 'hygiene')))
                / Math.min(...sims.map(s => weightOf(s, 'hygiene'))),
  }));

  // 快进几天，确认模拟不会卡死也不会全员饿死。
  // 主角默认手动操控，无人值守时必须先托管，否则他会站着饿死 —— 这不是 bug。
  await page.evaluate(() => { autoPilot = true; speed = 30; running = true; });
  await page.waitForTimeout(21000);   // ~3 个游戏日。前面的菜单/平滑度检查会暂停模拟，
                                      // 窗口要留够，否则 NPC 社交采样不足
  const health = await page.evaluate(() => ({
    // 钱的去处：收钱的公共去处几个、免费的退路几个、三天里一共花掉多少
    money: (() => {
      const amen = OBJ.filter(o => ['浴堂', '茶棚', '水井', '茅厕'].includes(o.n));
      // 浴堂设闸（穷了退去水井），茶棚不设闸（有钱添碗茶，没钱白坐）——
      // 所以「收钱」按 eff 数，「有免费退路」按没有 eff 的数
      return { priced: amen.filter(o => o.eff).length,
               free: amen.filter(o => !o.eff).length,
               spent: Math.round(6 * 60 - sims.reduce((a, s) => a + s.money, 0)) };
    })(),
    day, starving: sims.filter(s => s.need.hunger < 5).length,
    // 饿了要说清是谁、为什么 —— 只报个数字，回头还得人肉复现
    starvingWho: sims.filter(s => s.need.hunger < 5).map(s =>
      `${s.name}${s.isPlayer ? '(玩家)' : ''} 米${s.inv.food}柴${s.inv.wood}钱${Math.round(s.money)}` +
      `${OBJ.some(o => o.stove && o.owner === s.name) ? '' : '/无灶台'}` +
      `${OBJ.some(o => artOf(o) === 'jar' && o.owner === s.name) ? '' : '/无米缸'}`),
    avg: Math.round(sims.reduce((a, s) => a + s.need.hunger + s.need.energy, 0) / (sims.length * 2)),
    // 关系梯度：对立的应当明显低于不对立的，且都不能触底 0
    // （摩擦没有地板时会全员归零，关系就不再携带任何信息）
    relFoes: (() => { const v = sims.flatMap(a => sims.filter(b => b !== a && friction(a, b))
                                        .map(b => a.rel[b.name]));
                      return v.length ? v.reduce((x, y) => x + y) / v.length : 0; })(),
    relFriends: (() => { const v = sims.flatMap(a => sims.filter(b => b !== a && !friction(a, b))
                                           .map(b => a.rel[b.name]));
                         return v.length ? v.reduce((x, y) => x + y) / v.length : 100; })(),
    relFloor: Math.min(...sims.flatMap(a => sims.filter(b => b !== a).map(b => a.rel[b.name]))),

    // T9 锚点日程：晚间锚点必须真的把打分推向公共区
    // 直接量【锚点倍率】本身：当季区被放大、非当季区被压低。
    // 原来比的是"第一个 commons 物件 vs 第一个 work 物件的总分"，两个毛病：
    //   ① provision 不在衰减列表里，测试没把它归一 —— 结果随家计状态摆动；
    //   ② 物件表一加东西，"第一个"就换人了（加了祠堂之后立刻假红）。
    // 挑没有前置条件、也不属于任何人的物件当探针，才量得干净。
    anchor: (() => {
      const s = sims[1], saved = clock;
      clock = 20 * 60;                          // 拨到晚上
      for (const k of NK) if (NEEDS[k].dec) s.need[k] = 80;   // 排除"需求告急让位"的干扰
      const z = anchorZone(s);
      const probe = zz => {
        const o = OBJ.find(x => x.zone === zz && !x.owner && !x.pre && x.adv);
        if (!o) return null;
        const withA = score(s, o), noA = score(s, o, true);
        return (withA == null || noA == null || !noA) ? null : +(withA / noA).toFixed(2);
      };
      const rc = probe('commons'), rw = probe('work');
      clock = saved;
      return { zoned: OBJ.filter(o => o.zone).length, zone: z, rc, rw,
               favors: z === 'commons' && rc > 1.2 && rw < 0.8 };
    })(),

    // T8 私有财产 + 市场：不能有负账户、价格不能失控、财富要真的分化
    econ: (() => {
      const cash = sims.map(s => s.money);
      const neg = sims.filter(s => s.money < 0 || s.inv.food < 0 ||
                                   s.inv.wood < 0 || s.inv.goods < 0).length;
      const spread = Math.max(...cash) - Math.min(...cash);
      const inBand = Object.values(MKT).every(m =>
        m.p >= m.base * m.lo * 0.99 && m.p <= m.base * m.hi * 1.01);
      const fed = sims.filter(s => s.inv.food > 0).length;
      return { neg, spread: Math.round(spread), inBand, fed,
               fur: Math.round(MKT.furniture.p), food: Math.round(MKT.food.p) };
    })(),

    // NPC 之间必须真的会主动社交，且不能变成一个只会吵架的村子
    npcSocial: (() => {
      const s = EVENTS.filter(e => e.type.startsWith('social.') && e.type !== 'social.missed'
                                && e.who !== PC.name && e.whom !== PC.name);
      const kinds = new Set(s.map(e => e.type));
      const hostile = s.filter(e => e.type === 'social.争执').length;
      return { n: s.length, kinds: kinds.size, hostileRate: s.length ? hostile / s.length : 0 };
    })(),

    // T13 八卦：消息必须真的在人之间流动，而且必须每传一手就衰减一次。
    // 这是个正反馈系统，四道闸门任何一道漏了都会滚成"全村互恨"。
    gossip: (() => {
      const evs = EVENTS.filter(e => e.type === 'social.gossip');
      const all = [];
      for (const s of sims) for (const about in (s.mem || {}))
        for (const e of s.mem[about]) all.push({ owner: s.name, about, e });
      const second = all.filter(x => x.e.hand === 2);
      // 闸门①：二手记忆绝不能被再次转述（源头必须是亲历的）
      const relayed = second.filter(x => {
        const [o, ab] = x.e.sid.split('|');
        const src = (sims.find(s => s.name === o) || {}).mem || {};
        return (src[ab] || []).some(y => y.hand === 2 &&
          (o + '|' + ab + '|' + y.type + '|' + y.day + '|' + y.clock) === x.e.sid);
      }).length;
      // 传播必然衰减：二手分量必须小于源分量
      const grew = second.filter(x => {
        const [o, ab, ty, dy, ck] = x.e.sid.split('|');
        const src = ((sims.find(s => s.name === o) || {}).mem || {})[ab] || [];
        const m = src.find(y => y.type === ty && y.day == dy && y.clock == ck);
        return m && Math.abs(x.e.w) >= Math.abs(m.w);
      }).length;
      // 闸门④：同一件事只能听一次
      const dup = second.length - new Set(second.map(x => x.owner + '>' + x.e.sid)).size;
      // 传播广度：有多少组"听说者→当事人"的关系被二手信息影响
      const reach = new Set(second.map(x => x.owner + '>' + x.about)).size;
      return { n: evs.length, second: second.length, relayed, grew, dup, reach };
    })(),

    // T2 特质梯度：查【机制】而不是均值。
    // 3 天的窗口太短 —— 摩擦记忆还没攒够，而朝夕相处产生的正面记忆更多，
    // 均值会假性倒挂（实测 day3 敌36/友33，day7 起就正过来 37.6/50.5，day14 是 42.7/75.6）。
    // 扩图到 6 人后这个预热期更长，所以涌现层面的梯度改由 longrun.js 在第 14 天断言。
    traitGrad: (() => {
      let pairs = 0, neg = 0, total = 0;
      for (const a of sims) for (const b of sims) {
        if (a === b || !friction(a, b)) continue;
        pairs++;
        const L = (a.mem && a.mem[b.name]) || [];
        const w = L.filter(e => e.type === 'conflict.friction' && e.hand !== 2)
                   .reduce((t, e) => t + memWeight(e), 0);
        total += w;
        if (w < 0) neg++;
      }
      return { pairs, neg, total: +total.toFixed(1) };
    })(),

    // T19 种地：3 天的窗口收不了一茬（要 3 天以上），所以这里只守"循环真的转起来了"，
    // 完整的状态机与抢收规则由 verify-farm.js 逐条断言。
    farm: (() => {
      // 【改过】原来的断言是"私田人手一块"。开局无家之后，玩家那块地上什么都没有，
      // 田要自己开 —— 基准改成"除玩家那块空地外，每座有人的宅子自带一块私田"，
      // 玩家自己开的田算额外的（mine），不参与这条不变量。
      const priv = FIELDS.filter(f => f.owner).length;
      const npcFields = FIELDS.filter(f => f.owner && f.owner !== PC.name).length;
      const npcHomes  = HOMEOWNER.filter((n, i) => n && i !== PLOT0).length;
      const mine      = FIELDS.filter(f => f.owner === PC.name).length;
      const acted = FIELDS.filter(f => f.st !== '荒').length;
      const stages = new Set(FIELDS.map(f => fieldStage(f)));
      const bad = FIELDS.filter(f => !['荒', '耕', '苗', '穗'].includes(fieldStage(f))
                                  || !(f.grow >= 0 && f.grow <= 100)).length;
      // 已播种的田必须记得住是谁种的 —— 抢收判定全靠它
      const orphan = FIELDS.filter(f => f.st === '苗' && !f.sower).length;
      return { n: FIELDS.length, priv, npcFields, npcHomes, mine,
               acted, stages: stages.size, bad, orphan, people: sims.length };
    })(),

    // T22 手艺 / T23 天气 / T21 日结算：守住"真的起作用"，细节由长跑和定向测试管
    prog: (() => {
      const s = sims[1], probe = { ...s, skill: 0 };
      const lv0 = skillLv({ skill: 0 }), lvHi = skillLv({ skill: 30 });
      return {
        lv0, lvHi,
        // 手艺必须真的影响工时和售价，否则又变回"只涨不用的浮点数"
        fast: skillSpeed({ skill: 30 }) < skillSpeed({ skill: 0 }),
        rich: skillPrice({ skill: 30 }) > skillPrice({ skill: 0 }),
        grew: sims.some(x => x.skill > 0),
        // 天气必须是三种之一，且对同一天永远给同一个结果（不用随机数）
        wxOK: ['晴', '阴', '雨'].includes(wx.id)
              && weatherOf(9).id === weatherOf(9).id && weatherOf(9) === weatherOf(9),
        // 负分倍率方向：惩罚不能把负分抬高
        scaleOK: scale(-10, 0.3) < -10 && scale(10, 0.3) < 10,
        // 日结算能造出来且字段完整
        daily: (() => { const d = buildDaily();
          return d && typeof d.money === 'number' && Array.isArray(d.top) && !!d.wx; })(),
        saved: hasSave(),
      };
    })(),

    // T14 馈赠额度：任何人一周都不能超过 2 次
    giftMax: Math.max(...sims.map(s => (s._gift && s._gift.n) || 0), 0),

    // T4 记忆：关系必须是记忆推导出来的，而不是自己漂
    memEntries: sims.reduce((n, s) => n + Object.values(s.mem || {})
                                              .reduce((m, l) => m + l.length, 0), 0),
    memMaxPair: Math.max(...sims.flatMap(s => Object.values(s.mem || {}).map(l => l.length)), 0),
    // rel 与记忆推导值必须一致（差 <1 容忍刷新间隔）
    memConsistent: sims.every(a => sims.filter(b => b !== a)
      .every(b => Math.abs(a.rel[b.name] - relFromMemory(a, b.name)) < 1)),
    // 衰减有效：把时钟推后 30 天，负面小摩擦应该基本消失
    memDecays: (() => {
      const a = sims[0], n = sims[1].name;
      a.mem[n] = [];
      remember(a, n, 'social.馈赠');
      remember(a, n, 'conflict.blocked', '抢了我的床');
      const gift0 = Math.abs(memWeight(a.mem[n][0])), grudge0 = Math.abs(memWeight(a.mem[n][1]));
      day += 30;
      const gift30 = Math.abs(memWeight(a.mem[n][0])), grudge30 = Math.abs(memWeight(a.mem[n][1]));
      day -= 30;
      return grudge30 < grudge0 * 0.05 && gift30 > gift0 * 0.2;   // 摩擦忘光，恩情还在
    })(),
  }));

  // T1 事件总线：跑完几天后必须有成规模、结构完整的事件
  const ev = await page.evaluate(() => {
    const kinds = {};
    for (const e of EVENTS) kinds[e.type] = (kinds[e.type] || 0) + 1;
    const broken = EVENTS.filter(e => !e.type || !e.who || e.day == null || e.clock == null).length;
    // 中断率：NPC 改主意的次数占"完成+中断"的比例。
    // 过高说明承诺规则失效，事件流会被"改去XX"淹没，故事读不出来。
    const done = kinds['act.done'] || 0, intr = kinds['act.interrupted'] || 0;
    return { total: EVENTS.length, kinds: Object.keys(kinds).length, broken,
             capped: EVENTS.length <= 400,
             intrRate: done + intr ? intr / (done + intr) : 0 };
  });

  // T5 事件流：必须真的渲染出行，且做了信噪比筛选，且没有负库存
  const feed = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#feed .l')];
    const txt = rows.map(r => r.lastElementChild.textContent);
    return {
      rows: rows.length,
      bus: EVENTS.length,
      story: EVENTS.filter(isStory).length,
      // 因果句检查：不该出现"X 想用 Y，只好转去 Y"这种自指
      selfRef: txt.filter(t => /转去/.test(t) &&
                 t.split('被')[0] === (t.split('转去')[1] || '')).length,
      // 占位符没填上的情况
      // 记忆的 why 会被八卦原样引述，所以内部键值（"洁癖 × 邋遢"）绝不能漏进文案
      placeholder: txt.filter(t => /undefined|null|对方|\s×\s/.test(t)).length,
      negStock: sims.filter(s => s.money < 0 || s.inv.food < 0 ||
                                 s.inv.wood < 0 || s.inv.goods < 0).map(s => s.name),
      // T15 信噪比：单次抢家具绝不能进事件流，且任何单一类型都不能吃掉篇幅。
      // 实测降噪前 conflict.blocked 独占 35%，比全部社交加起来还多，
      // 玩家读完只会记得"他们一直在抢沙发"。
      blocked: EVENTS.filter(e => e.type === 'conflict.blocked' && isStory(e)).length,
      topShare: (() => {
        const st = EVENTS.filter(isStory), k = {};
        for (const e of st) k[e.type] = (k[e.type] || 0) + 1;
        const top = Math.max(0, ...Object.values(k));
        return st.length ? top / st.length : 0;
      })(),
      // 八卦行必须排在引发它的交谈行之后，否则因果是反的
      gossipOrder: (() => {
        const bad = [];
        // 从第 4 条起才判：缓冲满了会 shift()，最前面几条八卦的"交谈"
        // 早被挤出去了，那是环形缓冲的盲区，不是顺序错了。
        // （实测就是索引 0 和 1 这两条一直假红。）
        for (let i = 4; i < EVENTS.length; i++) {
          const e = EVENTS[i];
          if (e.type !== 'social.gossip') continue;
          const conv = EVENTS.slice(i - 4, i).some(x =>
            x.type.startsWith('social.') && x.type !== 'social.gossip' &&
            ((x.who === e.who && x.whom === e.whom) || (x.who === e.whom && x.whom === e.who)));
          if (!conv) bad.push(e.type);
        }
        return bad.length;
      })(),
    };
  });

  const menuPass = menuOk.open && menuOk.items >= 4 && menuOk.filled > 0.4;
  // 至少 8 成的帧都有位移，且单帧位移不超过 6px —— 否则就是掉回"闪现"了
  const smoothPass = smooth.moved / smooth.total > 0.8 && smooth.max < 6;
  // 至少 4 类事件、50 条以上、无残缺、环形缓冲没失控
  const evPass = ev.total >= 50 && ev.kinds >= 4 && ev.broken === 0 && ev.capped
              && ev.intrRate < 0.35;      // 承诺规则生效时实测 ~17%，放宽到 35% 作为红线
  // 对立的人之间必须真的产生负分量的摩擦记忆（涌现均值见 longrun 第 14 天）。
  // 原来断言"至少一半的对立组有摩擦"——那个比例是随手定的，3 天窗口下在 6/14 和 8/14
  // 之间抖，天气一改（雨天户外活计打折，碰面的模式就变了）就掉到红线下。
  // 改成查机制本身：摩擦确实发生了，而且总分量是负的。
  // 摩擦【方向】的断言搬去了 longrun（14 天特质梯度）—— 三天窗口里对立的两个人
  // 碰不碰得上纯看运气，实测在 0 对和 6 对之间跳，钉在这里只会制造假红。
  // 这里只守两件在三天里稳定成立的事：真起了摩擦分量必须是负的；关系不许触底。
  const traitPass = traitPre.assigned && traitPre.hasOpposing && traitPre.weightSpread > 2
                 && health.traitGrad.pairs >= 4
                 && (health.traitGrad.neg === 0 || health.traitGrad.total < 0)
                 && health.relFloor > 1;                    // 关系不能触底归零
  // 上限是硬红线：八卦是第二条写入路径，曾经绕开过它把单对记忆顶到 33 条
  const memPass = health.memEntries > 10 && health.memMaxPair <= 30
               && health.memConsistent && health.memDecays;
  // NPC 社交：要真的发生、要有多样性、不能六成以上都是吵架
  // 断言只守"NPC 从不主动社交"这个回归。冒烟测试前面的菜单/平滑度检查会扰动模拟，
  // 采样量不稳定，所以门槛放在能可靠观测的水平；争执占比在样本足够时才判。
  const socialPass = health.npcSocial.n >= 2 && health.npcSocial.kinds >= 2
                  && (health.npcSocial.n < 5 || health.npcSocial.hostileRate < 0.55)
                  && health.relFloor > 1;
  // 经济：无负账户、价格在带内、财富有分化（否则等于还在吃大锅饭）、多数人有存粮
  const econPass = health.econ.neg === 0 && health.econ.inBand
                && health.econ.spread > 5 && health.econ.fed >= 3;
  // 锚点：物件都要分区，晚上的打分要偏向公共区（否则"晚上去酒馆找人"就不成立）
  const anchorPass = health.anchor.zoned >= 12 && health.anchor.favors;
  // 八卦：必须真的传起来（reach≥2），且四道闸门全部生效。
  // relayed/grew/dup 任何一个非零都说明会滚雪球，必须是硬红线。
  const gossipPass = health.gossip.second >= 2 && health.gossip.reach >= 2
                  && health.gossip.relayed === 0 && health.gossip.grew === 0
                  && health.gossip.dup === 0
                  && health.relFloor > 1;          // 传谣不能把全村压到底
  const giftPass = health.giftMax <= 2;
  const progPass = health.prog.lvHi > health.prog.lv0 && health.prog.fast && health.prog.rich
                && health.prog.grew && health.prog.wxOK && health.prog.scaleOK
                && health.prog.daily && health.prog.saved;
  // 田必须真的被动起来（有人开垦/播种），状态不能出现非法值或丢失播种人
  // 别写死块数 —— 上一版是 6 块公田，改成小镇之后是 6 块私田 + 2 块公田，
  // 这条断言就假红了。要查的是"私田人手一块、公田存在、状态合法"。
  // 钱得有下水道：茶钱澡钱是唯一持续的支出口。守两条 ——
  // ① 公共去处真的收钱（不然钱又只进不出）②【穷了有免费的退路】：
  // 水井免费、茅厕免费，否则收费会变成"没钱就活不下去"。
  const moneyPass = health.money.priced === 3          // 浴堂×2 + 茶棚
                 && health.money.free >= 2             // 水井 + 茅厕
                 && health.money.spent > 0;            // 三天里真的花出去过
  const farmPass = health.farm.npcFields === health.farm.npcHomes   // 每座宅子一块
                && health.farm.n > health.farm.priv        // 公田必须还在（抢收靠它）
                && health.farm.acted >= 1
                && health.farm.bad === 0 && health.farm.orphan === 0;
  // 事件流要有内容、要筛掉噪音（story 明显少于 bus）、文案不能有自指或占位符
  const feedPass = feed.rows > 5 && feed.story < feed.bus * 0.6
                && feed.selfRef === 0 && feed.placeholder === 0
                && feed.negStock.length === 0
                && feed.blocked === 0            // 单次抢家具不得进事件流
                && feed.topShare <= 0.35         // 没有任何一类能吃掉三分之一以上
                && feed.gossipOrder === 0;       // 八卦必须跟在交谈之后
  // 以前只吐一个 PASS/FAIL，红了得逐条回去人肉读代码。列出来是哪几条红的。
  const checks = {
    errors: errors.length === 0, painted: painted > 100,
    menu: menuPass, smooth: smoothPass, events: evPass, traits: traitPass,
    mem: memPass, feed: feedPass, social: socialPass, econ: econPass,
    anchor: anchorPass, gossip: gossipPass, gift: giftPass, farm: farmPass,
    prog: progPass, money: moneyPass,
    starving: health.starving === 0, need: health.avg > 20,
  };
  const red = Object.keys(checks).filter(k => !checks[k]);
  const ok = red.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL[' + red.join(',') + ']'}  painted=${painted}  ` +
              `menu=${menuOk.open ? menuOk.items + '项/' + (menuOk.filled * 100 | 0) + '%绘制' : '未打开'}  ` +
              `smooth=${smooth.moved}/${smooth.total}帧/${smooth.max.toFixed(1)}px  ` +
              `events=${ev.total}/${ev.kinds}类/残缺${ev.broken}/中断率${(ev.intrRate * 100) | 0}%  ` +
              `traits=权重差${traitPre.weightSpread.toFixed(1)}x/摩擦${health.traitGrad.neg}对/合计${health.traitGrad.total}  ` +
              `anchor=${health.anchor.zoned}物件/20点→${health.anchor.zone}/` +
              `倍率公${health.anchor.rc}×工${health.anchor.rw}/${health.anchor.favors ? '生效' : '未生效'}  ` +
              `econ=家具${health.econ.fur}/粮${health.econ.food}/贫富差${health.econ.spread}/有粮${health.econ.fed}人  ` +
              `npc社交=${health.npcSocial.n}次/${health.npcSocial.kinds}种/争吵${(health.npcSocial.hostileRate * 100) | 0}%  ` +
              `八卦=${health.gossip.n}次/二手${health.gossip.second}条/波及${health.gossip.reach}对/` +
              `${health.gossip.relayed + health.gossip.grew + health.gossip.dup ? '闸门漏了!' : '闸门OK'}  ` +
              `馈赠峰值=${health.giftMax}/2  ` +
              `手艺=${health.prog.lv0}→${health.prog.lvHi}级/${health.prog.fast && health.prog.rich ? '有用' : '没用!'}  ` +
              `天=${health.prog.wxOK ? '正常' : '异常!'}  存档=${health.prog.saved ? '有' : '无!'}  ` +
              `田=邻${health.farm.npcFields}/${health.farm.npcHomes}+我${health.farm.mine}` +
              `+公${health.farm.n - health.farm.priv}/动过${health.farm.acted}/` +
              `${health.farm.bad + health.farm.orphan ? '状态异常!' : '状态OK'}  ` +
              `mem=${health.memEntries}条/峰值${health.memMaxPair}/${health.memConsistent ? '一致' : '不一致'}/${health.memDecays ? '会衰减' : '不衰减'}  ` +
              `feed=${feed.rows}行/筛${feed.bus}→${feed.story}/最大类${(feed.topShare * 100) | 0}%/` +
              `瑕疵[自指${feed.selfRef}/占位${feed.placeholder}/抢家具${feed.blocked}/八卦序${feed.gossipOrder}]  ` +
              `钱=收费${health.money.priced}处/免费${health.money.free}处/花出${health.money.spent}文  ` +
              `day=${health.day}  starving=${health.starving}${health.starvingWho.length ? '[' + health.starvingWho.join(';') + ']' : ''}` +
              `  avgNeed=${health.avg}  ${errors.join(' | ')}`);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
