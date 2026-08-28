// 定向验证 T28 钓鱼。
// 钓鱼在这里担两个角色，两个都得能被证伪：
//   ① 一条【不用米】的口粮 —— 断粮又没钱时的后路
//   ② 让【雨天】第一次变成好事 —— 之前下雨只是"田不用浇了"加"露天活难干"
// 另外还有一条老账：物件的 adv 广播了 provision，eff 就必须真的把家计抬上去。
// 广播和结算对不上是这套效用 AI 最阴的一类 bug —— NPC 会永远上同一个当。
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(1400);

  const r = await page.evaluate(() => {
    running = false;
    const s = sims[1];

    // 采样一批竿，别只看一竿 —— 哈希是确定的，但单点说明不了分布
    const cast = (d, rain, sk, n = 60) => {
      const od = day, ow = wx, os = s.skill, oc = clock;
      day = d; wx = rain ? WX.雨 : WX.晴; s.skill = sk;
      let miss = 0, w = 0; const kinds = {};
      for (let i = 0; i < n; i++) {
        clock = (i * 30) % 1440;
        const f = fishRoll(1 + (i % 2), s);
        if (!f) miss++; else { w += f.w; kinds[f.n] = (kinds[f.n] || 0) + 1; }
      }
      day = od; wx = ow; s.skill = os; clock = oc;
      return { miss: miss / n, w, kinds };
    };

    // ① 同一天同一竿必须给同一条鱼（全项目不用 Math.random，重放才对得上）
    const a = fishRoll(1, s), b = fishRoll(1, s);
    const determinism = (a === null && b === null) || (a && b && a.n === b.n);

    // ② 季节鱼：春夏鲤、秋冬鳜，且鲫鱼四季都在
    const seasons = {};
    for (const d of [1, 8, 15, 22]) seasons[seasonOf(d)] = fishPool().length &&
      (() => { const o = day; day = d; const p = fishPool().map(f => f.n); day = o; return p; })();

    // ③ 雨天：空手更少、进账更多
    const sun = cast(1, false, 0), rain = cast(1, true, 0);

    // ④ 手艺：从生手到宗师，空手率要真的往下走
    const bySkill = [0, 2, 8, 40].map(sk => ({ lv: skillLv({ skill: sk }), miss: cast(1, false, sk).miss }));

    // ⑤ 天气倍率：钓点加成，林地照旧打折（同一套 weatherMul，别改坏了别人）
    const fo = OBJ.find(o => o.id === 'fishA'), tr = OBJ.find(o => o.id === 'tree1');
    const ow = wx;
    wx = WX.晴; const sunF = weatherMul(fo), sunT = weatherMul(tr);
    wx = WX.雨; const rainF = weatherMul(fo), rainT = weatherMul(tr);
    wx = ow;

    // ⑥ 广播兑现：钓点广播 provision，鱼就得算家底
    const t = sims[2]; const of_ = t.inv.fish;
    t.inv.fish = 0; const p0 = provision(t);
    t.inv.fish = 3; const p1 = provision(t);
    t.inv.fish = of_;

    // ⑦ angle() 真的把鱼放进兜里，空手也要有回音
    const t2 = sims[3]; t2.inv.fish = 0;
    let got = null, miss = null;
    for (let i = 0; i < 60 && (!got || !miss); i++) {
      clock = (i * 30) % 1440;
      const before = t2.inv.fish, e = angle(t2, 1);
      if (e.type === 'fish.got' && !got) got = { e, gain: t2.inv.fish - before };
      if (e.type === 'fish.miss' && !miss) miss = { e, gain: t2.inv.fish - before };
    }

    // ⑧ 烤鱼不费米 —— 这才叫"断粮的后路"
    const roast = RECIPE.find(x => x.n === '烤鱼');
    const soup = RECIPE.find(x => x.n === '鱼羹');

    // ⑨ 集市收鱼，而且卖多了会跌
    const t3 = sims[4]; t3.inv.goods = 0; t3.inv.fish = 6;
    const stall = OBJ.find(o => o.id === 'stall');
    const canSell = !!stall.pre(t3);
    const first = mktSellFish(t3);
    for (let i = 0; i < 4; i++) mktSellFish(t3);
    const last = MKT.fish.p;

    // ⑩ 画法不能掉进"画成床"的默认分支（这个项目栽过三次）
    const artOK = ['fishA', 'fishB'].every(id => !!FURN[artOf(OBJ.find(o => o.id === id))]);

    // ⑪ 钓点座位得站得住人
    const seatOK = ['fishA', 'fishB'].every(id => {
      const o = OBJ.find(x => x.id === id);
      return o.use.every(([x, y]) => !solid[y][x]);
    });

    // ⑫ 事件文案不能漏（漏了会掉进 evText 的兜底，事件流里出现原始 key）
    const text = ['fish.got', 'fish.miss', 'econ.soldfish'].map(t =>
      evText({ type: t, who: '阿沅', why: '鲫鱼', val: 2 }));

    return { determinism, seasons, sun, rain, bySkill,
             mul: { sunF, rainF, sunT, rainT }, prov: { p0, p1 },
             got, miss, roast, soup, sell: { canSell, first, last, base: MKT.fish.base },
             artOK, seatOK, text };
  });

  const P = [
    ['① 同一竿结果可复现（无随机数）', r.determinism],
    ['② 鲫鱼四季都在', ['春', '夏', '秋', '冬'].every(s => r.seasons[s].includes('鲫鱼'))],
    ['③ 春夏鲤、秋冬鳜（季节鱼是硬窗口）',
      r.seasons.春.includes('鲤鱼') && r.seasons.夏.includes('鲤鱼') &&
      r.seasons.秋.includes('鳜鱼') && r.seasons.冬.includes('鳜鱼') &&
      !r.seasons.春.includes('鳜鱼') && !r.seasons.秋.includes('鲤鱼')],
    ['④ 雨天空手更少', r.rain.miss < r.sun.miss],
    ['⑤ 雨天进账更多', r.rain.w > r.sun.w],
    ['⑥ 手艺越高空手越少（生手→宗师）',
      r.bySkill[0].miss > r.bySkill[3].miss && r.bySkill[3].miss <= 0.15],
    ['⑦ 雨天钓点【加成】而不是打折', r.mul.rainF > 1 && r.mul.sunF === 1],
    ['⑧ 没把林地的雨天惩罚改坏', r.mul.rainT < 1 && r.mul.sunT === 1],
    ['⑨ 鱼算家底（广播的 provision 兑现了）', r.prov.p1 > r.prov.p0],
    ['⑩ 钓上就进兜', r.got && r.got.gain >= 1],
    ['⑪ 空手也有回音，且不掉东西', r.miss && r.miss.gain === 0],
    ['⑫ 烤鱼不费米（断粮的后路）', r.roast && !r.roast.need.food && r.roast.need.fish >= 1],
    ['⑬ 鱼羹是升级版（费米但更顶饱）', r.soup && r.soup.need.food >= 1 &&
      r.soup.adv.hunger > r.roast.adv.hunger],
    ['⑭ 集市收鱼', r.sell.canSell && r.sell.first > 0],
    ['⑮ 卖多了会跌价（随行就市）', r.sell.last < r.sell.base],
    ['⑯ 钓点有专属画法（不会画成床）', r.artOK],
    ['⑰ 钓点座位站得住人', r.seatOK],
    ['⑱ 三条文案齐全', r.text.every(t => t && !/^[a-z]+\./.test(t))],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  T28 钓鱼' : 'FAIL  T28 钓鱼');
  for (const [t, v] of P) console.log(`  ${v ? '✓' : '✗'} ${t}`);
  const pct = v => (v * 100).toFixed(0) + '%';
  console.log(`  晴天 空手${pct(r.sun.miss)}/共${r.sun.w}尾 → 雨天 空手${pct(r.rain.miss)}/共${r.rain.w}尾`);
  console.log(`  手艺: ` + r.bySkill.map(b => `${skillNameOf(b.lv)}${pct(b.miss)}`).join(' → '));
  console.log(`  倍率: 钓点 晴${r.mul.sunF}/雨${r.mul.rainF}　林地 晴${r.mul.sunT}/雨${r.mul.rainT}`);
  console.log(`  家计: 无鱼 ${r.prov.p0.toFixed(1)} → 三尾 ${r.prov.p1.toFixed(1)}`);
  console.log(`  鱼价: ${r.sell.base} → 连卖五尾后 ${r.sell.last.toFixed(1)}`);
  console.log(`  文案: ${r.text.join(' / ')}`);
  if (errs.length) console.log('  报错:', errs.join(' | '));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();

function skillNameOf(lv) { return ['生手', '学徒', '匠人', '好手', '巧匠', '大匠', '宗师'][lv] || '?'; }
