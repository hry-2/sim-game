// 捕鱼达人冒烟测试：加载无错、开炮扣币袋、捕鱼进币袋、炮倍、渔网、网具升级、保底、存档、首页卡带与币袋同步
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 420, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const url = 'file://' + path.resolve(__dirname, '..', 'games', 'fish-hunter', 'index.html');
  await page.goto(url);
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    localStorage.removeItem('fishhunter.v1');
    localStorage.removeItem('arcade.wallet.v1');
  });
  await page.reload();
  await page.waitForTimeout(900);

  /* ---------- 开局 ---------- */
  const st0 = await page.evaluate(() => {
    const d = window.__fish;
    return {
      wallet: d.wallet,
      hud: +document.getElementById('uiBal').textContent.replace(/,/g, ''),
      fish: d.fish.length,
      bad: d.fish.filter(f => !Number.isFinite(f.x) || !Number.isFinite(f.y)).length,
      bet: d.S.bet
    };
  });
  console.log('opening:', JSON.stringify(st0));
  const seedOk = st0.fish >= 5, cleanOk = st0.bad === 0, walletOk0 = st0.wallet === 300 && st0.hud === 300;
  console.log('fish on screen >= 5:', seedOk ? 'PASS' : 'FAIL', '(' + st0.fish + ')');
  console.log('no NaN fish:', cleanOk ? 'PASS' : 'FAIL', '(' + st0.bad + ')');
  console.log('wallet 300 & hud synced:', walletOk0 ? 'PASS' : 'FAIL');

  /* ---------- 开炮扣币 ---------- */
  await page.click('#btnFire');
  await page.waitForTimeout(120);
  const st1 = await page.evaluate(() => ({ w: window.__fish.wallet, spent: window.__fish.run.spent, fired: window.__fish.run.fired }));
  const shotOk = st1.w === 299 && st1.spent === 1 && st1.fired === 1;
  console.log('one shot costs 1:', shotOk ? 'PASS' : 'FAIL', JSON.stringify(st1));

  /* ---------- 炮倍 ---------- */
  await page.click('#betRow .btn[data-bet="10"]');
  await page.waitForTimeout(60);
  const bet10 = await page.evaluate(() => ({ bet: window.__fish.S.bet, hud: document.getElementById('uiBet').textContent }));
  await page.click('#btnFire');
  await page.waitForTimeout(120);
  const st2 = await page.evaluate(() => ({ w: window.__fish.wallet, bet: window.__fish.S.bet }));
  const betOk = bet10.bet === 10 && bet10.hud === '10×' && st2.w === 299 - 10;
  console.log('bet 10 charges 10:', betOk ? 'PASS' : 'FAIL', JSON.stringify({ bet10, st2 }));

  /* ---------- 捕鱼赔付（走真实鱼叉） ---------- */
  await page.click('#betRow .btn[data-bet="1"]');
  const catchRes = await page.evaluate(async () => {
    const d = window.__fish;
    const w0 = d.wallet, c0 = d.S.caught;
    d.fish.length = 0;                       // 清场，只留靶子
    const f = d.spawn('clown', { x: 220, y: 320, fromLeft: true });
    f.vx = 0; f.amp = 0; f.hp = 0.01; f.hr = 26;
    d.setAim(0);
    let shots = 0;
    for (let i = 0; i < 20 && d.fish.includes(f); i++) {
      if (d.fire()) shots++;
      await new Promise(r => setTimeout(r, 110));
    }
    return { caught: d.S.caught - c0, shots, w0, w1: d.wallet, alive: d.fish.includes(f) };
  });
  const payOk = catchRes.caught === 1 && !catchRes.alive && catchRes.w1 === catchRes.w0 - catchRes.shots + 2;
  console.log('net catches & pays value:', payOk ? 'PASS' : 'FAIL', JSON.stringify(catchRes));

  /* ---------- 渔网罩一片：伤害分摊、能一网双收 ---------- */
  const netRes = await page.evaluate(() => {
    const d = window.__fish;
    d.fish.length = 0;
    const a = d.spawn('clown', { x: 200, y: 300, fromLeft: true });
    const b = d.spawn('clown', { x: 228, y: 300, fromLeft: true });
    for (const f of [a, b]) { f.vx = 0; f.amp = 0; f.hr = 17; f.hp = 1; }
    d.netAt(214, 300, a);
    // 满血时力道全给中网那条，旁边的只被罩住、不掉血
    const focus = { a: a.hp, b: b.hp };
    d.wallet = 300;
    const w0 = d.wallet, c0 = d.S.caught;
    a.hp = 0.01; b.hp = 0.01;
    d.netAt(214, 300, a);
    return { focus, caught: d.S.caught - c0, pay: d.wallet - w0, left: d.fish.length };
  });
  const netOk = netRes.focus.a < 1 && netRes.focus.b === 1 &&
    netRes.caught === 2 && netRes.pay === 4 && netRes.left === 0;
  console.log('net focuses one, overflow can take 2:', netOk ? 'PASS' : 'FAIL', JSON.stringify(netRes));

  /* ---------- 网具：花币升网口，只加面积不改伤害 ---------- */
  await page.evaluate(() => { window.__fish.wallet = 2000; window.__fish.S.net = 1; window.__fish.syncHud(); window.__fish.syncNet(); });
  await page.click('#btnNet');
  await page.waitForTimeout(80);
  const lvA = await page.evaluate(() => ({ lv: window.__fish.S.net, r: window.__fish.netR(), w: window.__fish.wallet }));
  await page.click('#btnNetUp');
  await page.waitForTimeout(100);
  const lvB = await page.evaluate(() => ({ lv: window.__fish.S.net, r: window.__fish.netR(), w: window.__fish.wallet }));
  const reach = await page.evaluate(() => {
    const d = window.__fish;
    const trial = () => {
      d.fish.length = 0;
      const a = d.spawn('clown', { x: 200, y: 300, fromLeft: true });
      const b = d.spawn('clown', { x: 260, y: 300, fromLeft: true });
      for (const f of [a, b]) { f.vx = 0; f.amp = 0; f.hr = 17; f.hp = 1; }
      a.hp = 0.02;                              // 一网收掉主目标，余力往外溢
      d.netAt(200, 300, a);
      return b.hp;
    };
    d.S.net = 1; d.syncNet();
    const far1 = trial();
    d.S.net = 2; d.syncNet();
    const far2 = trial();
    return { far1, far2 };
  });
  const netUpOk = lvA.lv === 1 && lvA.r === 48 && lvA.w === 2000 &&
    lvB.lv === 2 && lvB.r === 58 && lvB.w === 1700 &&
    reach.far1 === 1 && reach.far2 < 1;
  console.log('net upgrade: 300 coins, 48 → 58 reach:', netUpOk ? 'PASS' : 'FAIL', JSON.stringify({ lvA, lvB, reach }));

  await page.evaluate(() => { window.__fish.wallet = 900; window.__fish.syncHud(); });
  await page.click('#btnNetUp');
  await page.waitForTimeout(100);
  await page.evaluate(() => document.getElementById('btnNetUp').click());   // 满级：再点不该扣钱
  await page.waitForTimeout(80);
  const maxed = await page.evaluate(() => ({ lv: window.__fish.S.net, r: window.__fish.netR(), w: window.__fish.wallet,
    disabled: document.getElementById('btnNetUp').disabled }));
  const maxOk = maxed.lv === 3 && maxed.r === 70 && maxed.w === 100 && maxed.disabled === true;
  console.log('net tops out at Lv.3, no double charge:', maxOk ? 'PASS' : 'FAIL', JSON.stringify(maxed));

  /* ---------- 网衣：按累计渔获解锁，换上是纯外观 ---------- */
  const skinRes = await page.evaluate(() => {
    const d = window.__fish;
    d.S.skins = 1; d.S.gained = 0; d.syncHud();
    const locked = document.querySelectorAll('#skinRow .skin.lock').length;
    d.S.gained = 1500; d.syncHud();
    const unlocked = document.querySelectorAll('#skinRow .skin.lock').length;
    return { locked, unlocked, bits: d.S.skins };
  });
  await page.click('#skinRow .skin[data-skin="2"]');
  await page.waitForTimeout(80);
  const skinEq = await page.evaluate(() => window.__fish.S.skin);
  const skinOk = skinRes.locked === 2 && skinRes.unlocked === 0 && skinRes.bits === 7 && skinEq === 2;
  console.log('skins unlock by catches & equip:', skinOk ? 'PASS' : 'FAIL', JSON.stringify({ skinRes, skinEq }));
  await page.click('#mNet .closebtn[data-close]');

  /* ---------- 保底 ---------- */
  const relief = await page.evaluate(() => {
    const d = window.__fish;
    d.wallet = 0;
    const ok = d.fire();
    const w = d.wallet;
    d.wallet = 0;
    const ok2 = d.fire();
    return { ok, w, ok2, w2: d.wallet };
  });
  const reliefOk = relief.ok === true && relief.w === 9 && relief.ok2 === false && relief.w2 === 0;
  console.log('broke relief (+10, 45s cd):', reliefOk ? 'PASS' : 'FAIL', JSON.stringify(relief));

  /* ---------- 存档 ---------- */
  const saved = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('fishhunter.v1') || 'null');
    const w = JSON.parse(localStorage.getItem('arcade.wallet.v1') || 'null');
    return { s, w };
  });
  const saveOk = !!saved.s && saved.s.v === 1 && Number.isFinite(saved.s.best) &&
    saved.s.net === 3 && saved.s.skin === 2 && saved.s.skins === 7 &&
    !!saved.w && saved.w.v === 1 && Number.isFinite(saved.w.coins);
  console.log('save written:', saveOk ? 'PASS' : 'FAIL', JSON.stringify(saved).slice(0, 160));

  /* ---------- 暂停 ---------- */
  await page.evaluate(() => { window.__fish.wallet = 300; });
  await page.click('#btnPause');
  const paused = await page.evaluate(() => window.__fish.paused && !!document.querySelector('#mPause.show'));
  await page.click('#btnPauseCont');
  const resumed = await page.evaluate(() => !window.__fish.paused);
  console.log('pause sheet pauses/resumes:', paused && resumed ? 'PASS' : 'FAIL');

  /* ---------- 点画布瞄准 ---------- */
  await page.evaluate(() => { window.__fish.fish.length = 0; window.__fish.wallet = 300; });
  const aimRes = await page.evaluate(async () => {
    const cv = document.getElementById('cv');
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: r.left + r.width * 0.12, clientY: r.top + r.height * 0.45, bubbles: true, pointerId: 7
    }));
    await new Promise(res => setTimeout(res, 160));
    return { aim: window.__fish.aim, locked: !!window.__fish.locked };
  });
  const aimOk = aimRes.aim < -0.2 && !aimRes.locked;
  console.log('canvas tap aims left:', aimOk ? 'PASS' : 'FAIL', JSON.stringify(aimRes));

  /* ---------- 小屏 ---------- */
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(200);
  const ov = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const out = [];
    document.querySelectorAll('body *').forEach(el => {
      const b = el.getBoundingClientRect();
      if (b.right > W + 0.5) out.push(el.tagName + '.' + el.className + '#' + el.id + ' r=' + b.right.toFixed(1) + ' w=' + b.width.toFixed(1) + ' "' + (el.textContent || '').slice(0, 18) + '"');
    });
    return { overflow: document.documentElement.scrollWidth - W, out: out.slice(0, 6) };
  });
  const overflow = ov.overflow;
  if (overflow > 0) console.log('  overflow offenders:', JSON.stringify(ov.out));
  console.log('375px no h-overflow:', overflow <= 0 ? 'PASS' : 'FAIL', '(' + overflow + ')');

  /* ---------- 首页 ---------- */
  await page.setViewportSize({ width: 420, height: 900 });
  const home = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(home);
  await page.waitForTimeout(800);
  const homeInfo = await page.evaluate(() => {
    const c = document.getElementById('shotFish');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 40) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
    const w = JSON.parse(localStorage.getItem('arcade.wallet.v1') || 'null');
    return {
      card: !!document.querySelector('a.cart[href="games/fish-hunter/index.html"]'),
      lit,
      shown: +document.getElementById('purseNum').textContent.replace(/,/g, ''),
      coins: w && w.coins
    };
  });
  const purseOk = homeInfo.coins > 0 && homeInfo.shown === homeInfo.coins;
  console.log('home cart card:', homeInfo.card ? 'PASS' : 'FAIL');
  console.log('home thumbnail lit:', homeInfo.lit, homeInfo.lit > 100 ? 'PASS' : 'FAIL');
  console.log('home purse == wallet:', purseOk ? 'PASS' : 'FAIL', JSON.stringify(homeInfo));

  console.log('runtime errors:', errors.length === 0 ? 'NONE (PASS)' : errors.join(' | '));
  const allPass = seedOk && cleanOk && walletOk0 && shotOk && betOk && payOk && netOk && netUpOk && maxOk && skinOk && reliefOk && aimOk &&
    saveOk && paused && resumed && overflow <= 0 && homeInfo.card && homeInfo.lit > 100 &&
    purseOk && errors.length === 0;
  console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
