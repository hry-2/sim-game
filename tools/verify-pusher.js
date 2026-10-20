// 聚宝盆冒烟测试：加载无错、投币扣余额、台面币数变化、存档写入、币袋同步、首页缩略图绘制
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
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

  // 积分兑换：100 积分 → 10 币（余额 +10、积分 −100）
  await page.evaluate(() => { const d = window.__coinpusher; d.S.score = 400; d.S.bal = 50; });
  await page.waitForTimeout(600);
  await page.click('#btnShop');
  await page.waitForTimeout(200);
  const shop0 = await page.evaluate(() => ({ sc: __coinpusher.S.score, bal: __coinpusher.S.bal }));
  await page.click('#btnBuyCoin');
  await page.waitForTimeout(200);
  const shop1 = await page.evaluate(() => ({ sc: __coinpusher.S.score, bal: __coinpusher.S.bal }));
  const shopOk = shop1.bal >= shop0.bal + 10 && shop1.sc <= shop0.sc - 95;
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
    && walletOk && purseOk;
  console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
