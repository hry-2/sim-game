// 聚宝盆冒烟测试：加载无错、投币扣余额、台面币数变化、存档写入、币袋同步、首页缩略图绘制
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  // 手机宽度下（≤600px）次要按钮收进了「☰ 菜单」：按钮看得见就直接点，看不见就走菜单——和手机用户同一条路
  const press = async (id) => {
    if (await page.locator('#' + id).isVisible()) return page.click('#' + id);
    await page.click('#btnMenu');
    await page.click('#mMenu [data-go="' + id + '"]');
  };

  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const url = 'file://' + path.resolve(__dirname, '..', 'games', 'coin-pusher', 'index.html');
  await page.goto(url);
  await page.waitForTimeout(1200);

  // 清档，从确定状态开始（余额现在记在全柜通用的币袋里，两处都要清）
  await page.evaluate(() => {
    localStorage.removeItem('coinpusher.jubaopen.v1');
    localStorage.removeItem('arcade.wallet.v1');
  });
  await page.reload();
  await page.waitForTimeout(800);

  // 台面必须真的铺出币堆，且全场坐标有限。
  // （回归史：seedCoins 引用不存在的旧常量 → 开局空台；NaN 沿分离约束传染全场 →
  //   投出的币落地即蒸发，而旧断言全部 PASS——这两条就是补这个盲区的。）
  const phys0 = await page.evaluate(() => {
    const d = window.__coinpusher;
    return {
      total: d.coins.length,
      bad: d.coins.filter(c => !Number.isFinite(c.x) || !Number.isFinite(c.z) || !Number.isFinite(c.h)).length
    };
  });
  const seedOk = phys0.total >= 100;
  const clean0 = phys0.bad === 0;
  console.log('seeded pile >= 100:', seedOk ? 'PASS' : 'FAIL', '(' + phys0.total + ')');
  console.log('no NaN coins at start:', clean0 ? 'PASS' : 'FAIL', '(' + phys0.bad + ')');

  // 开局静置 4.2 秒：满机第一推只会把币堆轻轻压实。
  // 历史回归：种子列距 < 分离阈值 → 加载 0.5s 弹掉 35+ 枚；
  //           分离判层阈值 1.4T → 叠层币互相当成"横向穿插"，第一推崩掉 44 点。
  // 现在第一推只掉 5 点左右，所以这里收紧到 15。
  await page.waitForTimeout(4200);
  const before = await page.evaluate(() => ({
    bal: +document.getElementById('uiBal').textContent,
    coins: +document.getElementById('uiCoins').textContent,
    in: +document.getElementById('uiIn').textContent
  }));
  console.log('before:', JSON.stringify(before));
  const openOk = before.bal <= 300 + 15;
  console.log('opening settle <= 15:', openOk ? 'PASS' : 'FAIL', '(bal ' + before.bal + ')');

  // 投 5 枚（分批下落）
  await page.click('#btnDrop5');
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    bal: +document.getElementById('uiBal').textContent,
    coins: +document.getElementById('uiCoins').textContent,
    in: +document.getElementById('uiIn').textContent,
    paused: document.querySelector('.modal.show') !== null
  }));
  console.log('after :', JSON.stringify(after));

  // 投币落地后依然不能出现 NaN（落地是传染发生的时机）
  const phys1 = await page.evaluate(() => {
    const d = window.__coinpusher;
    return { bad: d.coins.filter(c => !Number.isFinite(c.x) || !Number.isFinite(c.z) || !Number.isFinite(c.h)).length };
  });
  const clean1 = phys1.bad === 0;
  console.log('no NaN after drops:', clean1 ? 'PASS' : 'FAIL', '(' + phys1.bad + ')');

  // 币堆就在前沿附近，投入的币很快会被推下前沿赢回一部分：
  // 余额净变化应介于 -5（全亏）与 +30（连赢回血）之间；投入必须 +5；台面数应发生变化
  const okBal = after.bal >= before.bal - 5 && after.bal <= before.bal + 30;
  const okIn = after.in === before.in + 5;
  const okCoins = after.coins !== before.coins || after.bal !== before.bal; // 有币落/被推走/赢回，物理在动
  console.log('balance in [-5,+30] :', okBal ? 'PASS' : 'FAIL');
  console.log('invested +5:', okIn ? 'PASS' : 'FAIL');

  // 币袋（全柜通用）：机台里的余额必须落在共享的那份账本上
  // （回归史：余额只写机内存档 → 首页会显示一个永远不动的旧数字）
  const wallet = await page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem('arcade.wallet.v1') || 'null');
    return { coins: w && w.coins, bal: Math.round(window.__coinpusher.S.bal) };
  });
  const walletOk = !!wallet.coins && wallet.coins === wallet.bal;
  console.log('wallet == balance:', walletOk ? 'PASS' : 'FAIL', JSON.stringify(wallet));
  console.log('table moved:', okCoins ? 'PASS' : 'FAIL');

  // WebGL 真 3D 就绪（Three.js 加载、无降级警告、WebGL 上下文存在）
  const three = await page.evaluate(() => {
    const c = document.getElementById('cv');
    return {
      lib: typeof THREE !== 'undefined',
      warn: document.getElementById('warn').style.display === 'flex',
      gl: !!(c.getContext('webgl2') || c.getContext('webgl'))
    };
  });
  console.log('three lib  :', three.lib ? 'PASS' : 'FAIL');
  console.log('no fallback:', !three.warn ? 'PASS' : 'FAIL');
  console.log('webgl ctx  :', three.gl ? 'PASS' : 'FAIL');

  // 存档
  await page.waitForTimeout(5300);
  const saved = await page.evaluate(() => !!localStorage.getItem('coinpusher.jubaopen.v1'));
  console.log('save written:', saved ? 'PASS' : 'FAIL');

  // 键盘投币
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  const kb = await page.evaluate(() => +document.getElementById('uiIn').textContent);
  console.log('keyboard coin:', kb === after.in + 1 ? 'PASS' : 'FAIL', '(' + kb + ')');

  // 破产保底：余额清零后再投一枚，机器应补 10 枚（净 9；桌上同时出币可能再多一点）
  await page.evaluate(() => { const d = window.__coinpusher; d.S.bal = 0; d.S.reliefT = 0; });
  await page.click('#btnDrop1');
  await page.waitForTimeout(600);
  const relief = await page.evaluate(() => window.__coinpusher.S.bal);
  const reliefOk = relief >= 8 && relief <= 25;
  console.log('broke relief (+10):', reliefOk ? 'PASS' : 'FAIL', '(bal ' + relief + ')');

  // 积分兑换：2000 积分 → 10 币（余额 +10、积分 −2000，ADR-0009）
  await page.evaluate(() => { const d = window.__coinpusher; d.S.score = 2400; d.S.bal = 50; });
  await page.waitForTimeout(600);
  await press('btnShop');
  await page.waitForTimeout(200);
  const shop0 = await page.evaluate(() => ({ sc: __coinpusher.S.score, bal: __coinpusher.S.bal }));
  await page.click('#btnBuyCoin');
  await page.waitForTimeout(200);
  const shop1 = await page.evaluate(() => ({ sc: __coinpusher.S.score, bal: __coinpusher.S.bal }));
  const shopOk = shop1.bal >= shop0.bal + 10 && shop1.sc <= shop0.sc - 1995;
  console.log('score shop (+10):', shopOk ? 'PASS' : 'FAIL', JSON.stringify(shop1));
  await page.evaluate(() => document.getElementById('mShop').classList.remove('show'));

  // 点击机台选位：点左侧 → 落点应变为有限的负数
  // （回归史：射线平面用了不存在的 WORLD.pushY，点击静默失效）
  const pos = await page.evaluate(() => {
    const cv = document.getElementById('cv');
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: r.left + r.width * 0.25, clientY: r.top + r.height * 0.5, bubbles: true
    }));
    return window.__coinpusher.S.pos;
  });
  const clickOk = Number.isFinite(pos) && pos < -0.05;
  console.log('canvas click picks spot:', clickOk ? 'PASS' : 'FAIL', '(' + pos + ')');

  // ---- 账：长期回收率（ADR-0009）----
  // 用 sim() 快进游戏时间，不渲染。回归史：连击乘钱 + 侧槽 ×2 + 投出凤凰币，
  // 长期每投 1 枚回 4.8 枚（全柜币袋通胀）；短测 60 投又只回 13%——两头都没被测出来。
  // ① 挂机不投币：机器不该自己往外吐币  ② 一直自动投：回收落在 0.6~0.95
  // ③ 帧率无关：物理是固定步长，60Hz / 120Hz 屏同一台机器
  const econ = await page.evaluate(() => {
    const d = window.__coinpusher, S = d.S;
    const was = S.paused;
    S.paused = true; S.auto = false; S.queue = 0; S.bal = 1e6;
    const b0 = S.bal; d.sim(180);
    const idle = Math.round(S.bal - b0);
    S.auto = true; S.autoT = 0; S.pos = 0;   // 前面点机台把落点挪到了最左——那一条正对侧槽，币大半进槽不赔
    const in0 = S.totalIn, out0 = S.totalOut;
    d.sim(600);
    S.auto = false; S.paused = was;
    const live = d.coins.filter(c => c.state === 0).length;
    return { idle, rate: +((S.totalOut - out0) / (S.totalIn - in0)).toFixed(2), coinsIn: S.totalIn - in0, live,
      nan: d.coins.filter(c => !Number.isFinite(c.x + c.z + c.y + c.h)).length };
  });
  const idleOk = econ.idle <= 5;
  const rateOk = econ.rate >= 0.6 && econ.rate <= 1.0 && econ.nan === 0 && econ.live > 150 && econ.live < 480;
  console.log('idle machine pays nothing (3 min):', idleOk ? 'PASS' : 'FAIL', JSON.stringify({ idle: econ.idle }));
  console.log('long-run payout 0.6~1.0 (10 min auto; 20-min calibration ≈ 0.84):', rateOk ? 'PASS' : 'FAIL', JSON.stringify(econ));
  await page.evaluate(() => { window.__coinpusher.S.bal = 300; });

  // ---- 抽奖口 + 奖品（issue 26）----
  // ① 玩家的币穿过发光框 → 转盘转起来、转完结算；② 奖品放在出币口前，推下去进账；
  // ③ 奖品落在侧槽那一侧，掉下去不赔
  const pp = await page.evaluate(() => {
    const d = window.__coinpusher, S = d.S;
    const was = S.paused; S.paused = true; S.queue = 0; S.auto = false; S.bal = 1000;
    // ① 框停在正中、落点居中，直接投 1 枚
    d.setGatePhase(0); S.pos = 0; S.slot = null; S.slotQ = 0;
    const h0 = S.gateHits;
    S.queue = 1; S.queueT = 0;
    for (let i = 0; i < 20; i++) { d.setGatePhase(0); d.sim(1 / 60); }   // 下落那 0.3 秒里框别跑开
    const hit = S.gateHits - h0;
    const spinning = !!S.slot;
    d.sim(3 * (1 + (S.slotQ || 0)));    // 前一段留在半空的币也可能穿框：排队的转盘一起等完
    const settled = !S.slot && !S.slotQ;
    // ② 结算规则：奖品正中刚过掉落线 → 进账；侧槽那一侧刚过线 → 不赔
    const b1 = S.bal;
    d.spawnPrize(1, 0, d.WORLD.dropZ - 0.3); d.prize.state = 0; d.prize.y = 0; d.prize.z = d.WORLD.dropZ + 0.001;
    d.sim(1 / 60);
    const pay = S.bal - b1;
    d.sim(2);
    const b2 = S.bal;
    d.spawnPrize(2, 1.0, d.WORLD.dropZ - 0.3); d.prize.state = 0; d.prize.y = 0; d.prize.z = d.WORLD.dropZ + 0.001;
    d.sim(1 / 60);
    const sidePay = S.bal - b2;
    d.sim(2);
    // ③ 正常玩：奖品从币堆后沿落下，自动投 90 秒，它得被挤着往前走（或者已经推下去了）
    d.spawnPrize(0, 0);
    d.sim(2);
    const z0 = d.prize ? d.prize.z : 0, paid0 = S.prizes;
    S.auto = true; S.autoT = 0; d.sim(90); S.auto = false;
    const moved = (S.prizes > paid0) || (d.prize && d.prize.z - z0 > 0.1);
    const dz = d.prize ? +(d.prize.z - z0).toFixed(3) : 'paid';
    S.paused = was;
    return { hit, spinning, settled, pay, sidePay, moved, dz, v1: d.PRIZES[1].v };
  });
  const slotOk = pp.hit >= 1 && pp.spinning && pp.settled;
  const prizeOk = pp.pay === pp.v1 && pp.sidePay === 0 && pp.moved;
  console.log('pocket hit spins the slot:', slotOk ? 'PASS' : 'FAIL', JSON.stringify({ hit: pp.hit, spinning: pp.spinning, settled: pp.settled }));
  console.log('prize pays at the front, not in the gutter:', prizeOk ? 'PASS' : 'FAIL', JSON.stringify({ pay: pp.pay, sidePay: pp.sidePay, moved: pp.moved, dz: pp.dz }));

  // ---- 狂热 / 生肖 / 每日任务（issue 27）----
  // 直接往侧槽那一条放一枚刚过线的币：狂热里照赔、狂热外不赔；生肖币推下去收进图鉴，重复的给积分；
  // 任务完成一条发 500 分
  const fz = await page.evaluate(() => {
    const d = window.__coinpusher, S = d.S, W = d.WORLD;
    const was = S.paused; S.paused = true; S.auto = false; S.queue = 0;
    const edgeCoin = (x, type, zod) => {
      const c = Object.assign({}, d.coins.find(c => c.state === 0), { id: 990000 + Math.floor(Math.random() * 9999), x, z: W.dropZ + 0.005, h: 0, vx: 0, vz: 0, state: 0, type, zod, _m: null });
      d.coins.push(c);
    };
    S.feverT = 0; S.feverCD = 0;
    let b = S.bal; edgeCoin(1.1, 0); d.sim(1 / 60);
    const sideNoFever = S.bal - b;
    d.startFever();
    b = S.bal; edgeCoin(1.1, 0); d.sim(1 / 60);
    const sideFever = S.bal - b;
    d.sim(16);
    const over = S.feverT === 0 && S.feverCD > 0;
    b = S.bal; edgeCoin(1.1, 0); d.sim(1 / 60);
    const sideAfter = S.bal - b;
    S.zod = 0;
    edgeCoin(0, 3, 4); d.sim(1 / 60);
    const got = S.zod === (1 << 4);
    const sc = S.score; edgeCoin(0, 3, 4); d.sim(1 / 60);
    const dup = S.score - sc;
    // 任务：今天这批第一条直接推满
    d.dailyEnsure();
    const m = S.daily.m[0], before = S.score;
    m.done = false; m.p = 0;
    const kinds = ['phoenix', 'gate', 'prize', 'slotwin', 'combo', 'fever', 'zod', 'coins'];
    const k = kinds[m.i];
    for (let i = 0; i < 120 && !m.done; i++) d.missionBump(k, k === 'combo' ? 99 : 1);
    const mission = m.done && S.score - before >= 500;
    S.paused = was;
    return { sideNoFever, sideFever, over, sideAfter, got, dup, mission, k };
  });
  const feverOk = fz.sideNoFever === 0 && fz.sideFever === 1 && fz.over && fz.sideAfter === 0;
  const zodOk = fz.got && fz.dup >= 50;
  console.log('fever pays the gutters, then stops:', feverOk ? 'PASS' : 'FAIL', JSON.stringify({ off: fz.sideNoFever, on: fz.sideFever, after: fz.sideAfter, over: fz.over }));
  console.log('zodiac coin collected, dup gives points:', zodOk ? 'PASS' : 'FAIL', JSON.stringify({ got: fz.got, dup: fz.dup }));
  console.log('daily mission pays 500:', fz.mission ? 'PASS' : 'FAIL', fz.k);

  // ---- 彩球宾果（issue 28）----
  // 把彩球放到刚过掉落线：点亮对应格；凑成一条线往币堆撒 6 枚；九格全亮送奖品 + 狂热、换卡；
  // 重复的号给积分；侧槽里的不算
  const bg = await page.evaluate(() => {
    const d = window.__coinpusher, S = d.S, W = d.WORLD;
    const was = S.paused; S.paused = true; S.auto = false; S.queue = 0;
    S.feverT = 0; S.feverCD = 0;
    // 出场的球要掉出画面才从台上清掉（还占着 3 颗的名额）：测试里每颗之前先清台
    const exitBall = (n, x) => { d.balls.length = 0; const b = d.spawnBall(n, x || 0, W.dropZ - 0.2); b.state = 0; b.base = 0.05; b.z = W.dropZ + 0.002; d.sim(1 / 60); };
    d.balls.length = 0;
    d.newCard();
    const card = S.bingo.card;
    exitBall(card[0]);
    const lit1 = S.bingo.lit === 1;
    const fallingBefore = d.coins.filter(c => c.state === 1).length;
    exitBall(card[1]); exitBall(card[2]);                         // 第一行凑齐
    const rained = d.coins.filter(c => c.state === 1).length - fallingBefore;
    const line = (S.bingo.lines & 1) === 1;
    const sc = S.score; exitBall(card[0]);
    const dup = S.score - sc;
    const litBefore = S.bingo.lit; exitBall(card[4], 1.1);         // 侧槽：不算
    const sideIgnored = S.bingo.lit === litBefore;
    d.balls.length = 0;
    const bingos0 = S.bingos;
    for (const i of [3, 4, 5, 6, 7, 8]) exitBall(card[i]);
    const full = S.bingos === bingos0 + 1;
    d.sim(1.5);
    const fever = S.feverT > 0;
    d.sim(2);
    const fresh = S.bingo.lit === 0;
    S.feverT = 0; S.paused = was;
    return { lit1, rained, line, dup, sideIgnored, full, fever, fresh };
  });
  const bingoOk = bg.lit1 && bg.line && bg.rained >= 6 && bg.dup >= 30 && bg.sideIgnored && bg.full && bg.fever && bg.fresh;
  console.log('bingo: light, line pays, full card -> fever + new card:', bingoOk ? 'PASS' : 'FAIL', JSON.stringify(bg));

  // ---- 机台等级 / 台面事件 / 全柜联动（issue 29）----
  const lv = await page.evaluate(() => {
    const d = window.__coinpusher, S = d.S;
    const was = S.paused; S.paused = true; S.auto = false; S.queue = 0;
    // ① 升级：攒到 Lv.5 → 框 0.18；Lv.8 前不出招财猫
    const xp0 = S.xp; S.xp = 0; S.lv = 1; d.applyLevel();
    const gate1 = d.GATE.w;
    d.gainXp(1200);
    const lv5 = S.lv, gate5 = d.GATE.w;
    let cat = 0; for (let i = 0; i < 200; i++) { d.spawnPrize(); if (d.prize.type === 4) cat++; }
    d.gainXp(5000);
    let cat10 = 0; for (let i = 0; i < 200; i++) { d.spawnPrize(); if (d.prize.type === 4) cat10++; }
    // ② 台面事件：挂机不倒数；有人在玩才倒数
    S.activeT = 0; S.eventT = 5; const ev0 = S.events; d.sim(10);
    const idleEvent = S.events - ev0;
    S.activeT = 60; S.eventT = 1; d.sim(2);
    const playEvent = S.events - ev0;
    // ③ 信箱：鱼王 → 奖品；龙鱼 → 彩球；开奖 → 给捕鱼发信
    d.balls.length = 0; d.spawnPrize(0, 0, 5); d.sim(1 / 60); d.sim(3);       // 把台上那个奖品清掉
    localStorage.removeItem('arcade.link.v1');
    d.linkSend('pusher', 'king'); d.linkSend('pusher', 'dragon'); d.linkPoll(); d.sim(0.1);
    const gotPrize = !!d.prize && d.prize.state !== 2, gotBall = d.balls.length >= 1;
    const inbox = JSON.parse(localStorage.getItem('arcade.link.v1'));
    const consumed = inbox && inbox.q.filter(m => m.to === 'pusher').length === 0;
    d.jackpot();
    const toFish = JSON.parse(localStorage.getItem('arcade.link.v1')).q.some(m => m.to === 'fish' && m.kind === 'jackpot');
    d.sim(3); S.feverT = 0;
    return { gate1, lv5, gate5, cat, cat10, idleEvent, playEvent, gotPrize, gotBall, consumed, toFish };
  });
  await page.evaluate(() => { const d = window.__coinpusher; d.S.paused = false; });
  const lvOk = lv.gate1 === 0.16 && lv.lv5 === 5 && lv.gate5 === 0.18 && lv.cat === 0 && lv.cat10 > 0;
  const evOk = lv.idleEvent === 0 && lv.playEvent >= 1;
  const linkOk = lv.gotPrize && lv.gotBall && lv.consumed && lv.toFish;
  console.log('machine level unlocks gate + prizes:', lvOk ? 'PASS' : 'FAIL', JSON.stringify({ g1: lv.gate1, lv5: lv.lv5, g5: lv.gate5, cat: lv.cat, cat10: lv.cat10 }));
  console.log('table events only while playing:', evOk ? 'PASS' : 'FAIL', JSON.stringify({ idle: lv.idleEvent, play: lv.playEvent }));
  console.log('cabinet link: king -> prize, dragon -> ball:', linkOk ? 'PASS' : 'FAIL', JSON.stringify({ prize: lv.gotPrize, ball: lv.gotBall, consumed: lv.consumed, toFish: lv.toFish }));

  // ---- 首页 ----
  const home = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(home);
  await page.waitForTimeout(900);
  const homeErr = errors.length;
  const thumb = await page.evaluate(() => {
    const c = document.getElementById('shotCoin');
    if (!c) return -1;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 40) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
    return lit;
  });
  const cartExists = await page.evaluate(() => !!document.querySelector('a.cart[href="games/coin-pusher/index.html"]'));
  const purse = await page.evaluate(() => {
    const el = document.getElementById('purseNum');
    const w = JSON.parse(localStorage.getItem('arcade.wallet.v1') || 'null');
    return { shown: el ? +el.textContent.replace(/,/g, '') : -1, coins: w && w.coins };
  });
  const purseOk = purse.coins > 0 && purse.shown === purse.coins;
  console.log('home purse == wallet:', purseOk ? 'PASS' : 'FAIL', JSON.stringify(purse));
  console.log('home cart card:', cartExists ? 'PASS' : 'FAIL');
  console.log('home thumbnail lit:', thumb, thumb > 100 ? 'PASS' : 'FAIL');

  const runtimeErrors = errors.slice(homeErr ? 0 : 0);
  console.log('runtime errors:', runtimeErrors.length === 0 ? 'NONE (PASS)' : runtimeErrors.join(' | '));

  const allPass = okBal && okIn && okCoins && three.lib && !three.warn && three.gl
    && saved && cartExists && thumb > 100 && errors.length === 0
    && seedOk && clean0 && clean1 && clickOk && openOk && reliefOk && shopOk
    && walletOk && purseOk && idleOk && rateOk && slotOk && prizeOk && feverOk && zodOk && fz.mission && bingoOk && lvOk && evOk && linkOk;
  console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
