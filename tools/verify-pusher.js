// 聚宝盆冒烟测试：加载无错、投币扣余额、台面币数变化、存档写入、首页缩略图绘制
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

  // 清档，从确定状态开始
  await page.evaluate(() => localStorage.removeItem('coinpusher.jubaopen.v1'));
  await page.reload();
  await page.waitForTimeout(800);

  const before = await page.evaluate(() => ({
    bal: +document.getElementById('uiBal').textContent,
    coins: +document.getElementById('uiCoins').textContent,
    in: +document.getElementById('uiIn').textContent
  }));
  console.log('before:', JSON.stringify(before));

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

  // 币堆就在前沿附近，投入的币很快会被推下前沿赢回一部分：
  // 余额净变化应介于 -5（全亏）与 +30（连赢回血）之间；投入必须 +5；台面数应发生变化
  const okBal = after.bal >= before.bal - 5 && after.bal <= before.bal + 30;
  const okIn = after.in === before.in + 5;
  const okCoins = after.coins !== before.coins || after.bal !== before.bal; // 有币落/被推走/赢回，物理在动
  console.log('balance in [-5,+30] :', okBal ? 'PASS' : 'FAIL');
  console.log('invested +5:', okIn ? 'PASS' : 'FAIL');
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
  console.log('home cart card:', cartExists ? 'PASS' : 'FAIL');
  console.log('home thumbnail lit:', thumb, thumb > 100 ? 'PASS' : 'FAIL');

  const runtimeErrors = errors.slice(homeErr ? 0 : 0);
  console.log('runtime errors:', runtimeErrors.length === 0 ? 'NONE (PASS)' : runtimeErrors.join(' | '));

  const allPass = okBal && okIn && okCoins && three.lib && !three.warn && three.gl
    && saved && cartExists && thumb > 100 && errors.length === 0;
  console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
