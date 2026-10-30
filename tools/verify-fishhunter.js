// 捕鱼达人冒烟测试：加载无错、开炮扣币袋、捕鱼进币袋、炮倍、渔网、网具升级、保底、存档、首页卡带与币袋同步
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 420, height: 950 } });
  const errors = [];
  // 手机宽度下（≤600px）次要按钮收进了「☰ 菜单」：按钮看得见就直接点，看不见就走菜单——和手机用户同一条路
  const press = async (id) => {
    if (await page.locator('#' + id).isVisible()) return page.click('#' + id);
    await page.click('#btnMenu');
    await page.click('#mMenu [data-go="' + id + '"]');
  };

  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const url = 'file://' + path.resolve(__dirname, '..', 'games', 'fish-hunter', 'index.html');
  // 游戏页要从 CDN 拉 three.js：机器负载高的时候 30 秒默认超时不够用
  await page.goto(url, { timeout: 90000 });
  await page.waitForFunction(() => !!window.__fish, null, { timeout: 30000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    localStorage.removeItem('fishhunter.v1');
    localStorage.removeItem('arcade.wallet.v1');
  });
  await page.reload({ timeout: 90000 });
  await page.waitForFunction(() => !!window.__fish, null, { timeout: 30000 });
  await page.waitForTimeout(900);

  /* ---------- 开局 ---------- */
  const st0 = await page.evaluate(() => {
    const d = window.__fish;
    return {
      wallet: d.wallet,
      hud: +document.getElementById('uiBal').textContent.replace(/,/g, ''),
      fish: d.fish.length,
      bad: d.fish.filter(f => !Number.isFinite(f.x) || !Number.isFinite(f.y)).length,
      bet: d.S.bet,
      three: (() => {
        const t = d.three;
        if (!t) return null;
        const r = t.renderer.info.render;
        return { calls: r.calls, tris: r.triangles, objs: t.scene.children.length };
      })()
    };
  });
  console.log('opening:', JSON.stringify(st0));
  const seedOk = st0.fish >= 5, cleanOk = st0.bad === 0, walletOk0 = st0.wallet === 300 && st0.hud === 300;
  console.log('fish on screen >= 5:', seedOk ? 'PASS' : 'FAIL', '(' + st0.fish + ')');
  console.log('no NaN fish:', cleanOk ? 'PASS' : 'FAIL', '(' + st0.bad + ')');
  console.log('wallet 300 & hud synced:', walletOk0 ? 'PASS' : 'FAIL');

  /* ---------- 3D 场景 ---------- */
  const t3 = st0.three;
  const threeOk = !!t3 && t3.calls >= 20 && t3.tris > 2000 && t3.objs >= 5;
  console.log('3D scene renders (draw calls / tris):', threeOk ? 'PASS' : 'FAIL', JSON.stringify(t3));

  /* ---------- 开炮扣币 ---------- */
  // 清场 + 关掉自然出鱼：不然这一发可能顺手打中半路冒出来的一条鱼，
  // 账就多了一笔赔付，断言会飘。
  const clearField = () => page.evaluate(() => {
    const d = window.__fish;
    d.setSpawner(false);
    d.clearFish();
    d.clearShots();
  });
  const restoreField = () => page.evaluate(() => { window.__fish.setSpawner(true); });

  await clearField();
  await page.click('#btnFire');
  await page.waitForTimeout(120);
  const st1 = await page.evaluate(() => ({ w: window.__fish.wallet, spent: window.__fish.run.spent, fired: window.__fish.run.fired }));
  const shotOk = st1.w === 299 && st1.spent === 1 && st1.fired === 1;
  console.log('one shot costs 1:', shotOk ? 'PASS' : 'FAIL', JSON.stringify(st1));

  /* ---------- 炮倍 ---------- */
  await page.click('#betRow .abtn[data-bet="10"]');
  await page.waitForTimeout(60);
  const bet10 = await page.evaluate(() => ({ bet: window.__fish.S.bet, hud: document.getElementById('uiBet').textContent }));
  await clearField();
  await page.click('#btnFire');
  await page.waitForTimeout(120);
  const st2 = await page.evaluate(() => ({ w: window.__fish.wallet, bet: window.__fish.S.bet }));
  const betOk = bet10.bet === 10 && bet10.hud === '10×' && st2.w === 299 - 10;
  console.log('bet 10 charges 10:', betOk ? 'PASS' : 'FAIL', JSON.stringify({ bet10, st2 }));
  await restoreField();

  /* ---------- 捕鱼赔付（走真实鱼叉） ---------- */
  await page.click('#betRow .abtn[data-bet="1"]');
  const catchRes = await page.evaluate(async () => {
    const d = window.__fish;
    d.setSpawner(false);                 // 只留靶子，别让野鱼分走赔付
    const w0 = d.wallet, c0 = d.S.caught;
    d.clearFish();                       // 清场，只留靶子
    const f = d.spawn('clown', { x: 220, y: 320, fromLeft: true });
    f.vx = 0; f.amp = 0; f.hp = 0.01; f.hr = 26;
    d.setAim(0);
    let shots = 0;
    for (let i = 0; i < 20 && d.fish.includes(f); i++) {
      if (d.fire()) shots++;
      await new Promise(r => setTimeout(r, 110));
    }
    d.setSpawner(true);
    return { caught: d.S.caught - c0, shots, w0, w1: d.wallet, alive: d.fish.includes(f) };
  });
  const payOk = catchRes.caught === 1 && !catchRes.alive && catchRes.w1 === catchRes.w0 - catchRes.shots + 2;
  console.log('net catches & pays value:', payOk ? 'PASS' : 'FAIL', JSON.stringify(catchRes));

  /* ---------- 渔网罩一片：伤害分摊、能一网双收 ---------- */
  const netRes = await page.evaluate(() => {
    const d = window.__fish;
    d.clearFish();
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

  /* ---------- 龙鱼：四条，按 v 赔，鱼谱里标出来 ---------- */
  const dragonRes = await page.evaluate(() => {
    const d = window.__fish;
    d.clearFish();
    d.wallet = 300;
    const out = {};
    for (const type of ['jade', 'flame', 'aurum', 'violet']) {
      const f = d.spawn(type, { x: 220, y: 300, fromLeft: true });
      f.vx = 0; f.amp = 0; f.hp = 0.004;   // 一发必死（伤害 0.95/v，最小的 v=48 也够）
      const w0 = d.wallet, c0 = d.S.caught;
      d.netAt(220, 300, f);
      out[type] = { pay: d.wallet - w0, caught: d.S.caught - c0, gone: !d.fish.includes(f), v: d.FISH[type].v };
    }
    return { out, rows: document.querySelectorAll('#bookTable tr').length,
      tagged: document.querySelectorAll('#bookTable tr').length &&
        [...document.querySelectorAll('#bookTable tr')].filter(tr => tr.textContent.includes('龙鱼')).length };
  });
  const dragonOk = dragonRes.rows === 13 && dragonRes.tagged === 4 &&
    ['jade', 'flame', 'aurum', 'violet'].every(t => dragonRes.out[t].pay === dragonRes.out[t].v &&
      dragonRes.out[t].caught === 1 && dragonRes.out[t].gone);
  console.log('4 dragon fish pay by value & tagged in book:', dragonOk ? 'PASS' : 'FAIL', JSON.stringify(dragonRes));

  /* ---------- 网具：花币升网口，只加面积不改伤害 ---------- */
  await page.evaluate(() => { window.__fish.wallet = 2000; window.__fish.S.net = 1; window.__fish.syncHud(); window.__fish.syncNet(); });
  await press('btnNet');
  await page.waitForTimeout(80);
  const lvA = await page.evaluate(() => ({ lv: window.__fish.S.net, r: window.__fish.netR(), w: window.__fish.wallet }));
  await page.click('#btnNetUp');
  await page.waitForTimeout(100);
  const lvB = await page.evaluate(() => ({ lv: window.__fish.S.net, r: window.__fish.netR(), w: window.__fish.wallet }));
  const reach = await page.evaluate(() => {
    const d = window.__fish;
    const trial = () => {
      d.clearFish();
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
  await page.evaluate(() => { window.__fish.flush(); });     // 落盘是节流的，读之前先补写
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
  await press('btnPause');
  const paused = await page.evaluate(() => window.__fish.paused && !!document.querySelector('#mPause.show'));
  await page.click('#btnPauseCont');
  const resumed = await page.evaluate(() => !window.__fish.paused);
  console.log('pause sheet pauses/resumes:', paused && resumed ? 'PASS' : 'FAIL');

  /* ---------- 点画布瞄准 ---------- */
  await page.evaluate(() => { window.__fish.clearFish(); window.__fish.wallet = 300; });
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
  await page.setViewportSize({ width: 420, height: 950 });
  await page.waitForTimeout(150);

  /* ================= issue 02：账目要看得见 ================= */
  await page.evaluate(() => {
    const d = window.__fish;
    d.clearFish();
    d.clearShots();   // 还在飞的网落地会再记一次命中 / 开炮，把下面的读数带偏
    d.wallet = 500;
    d.resetRun();
    d.run.fired = 10; d.run.hits = 7; d.run.spent = 10; d.run.got = 4;
    d.syncHud();
  });
  await page.waitForTimeout(80);
  const hud = await page.evaluate(() => ({
    hit: document.getElementById('uiHit').textContent,
    spent: document.getElementById('uiSpent').textContent,
    net: document.getElementById('uiNet').textContent,
    neg: document.getElementById('uiNet').classList.contains('neg'),
    tide: document.getElementById('uiTide').textContent
  }));
  const hudOk = hud.hit === '70%' && hud.spent === '10' && hud.net === '−6' && hud.neg === true;
  console.log('hud: hit rate / spent / net:', hudOk ? 'PASS' : 'FAIL', JSON.stringify(hud));

  /* 小鱼挨过打之后才有血条 */
  const barRes = await page.evaluate(async () => {
    const d = window.__fish;
    try {
      // 暂停 + 清弹：让「画面上只有这一条鱼」成立。
      // 否则自然出鱼 + 还在飞的炮弹会顺手把某条小鱼打成半血，血条数就不止一条了。
      d.setPaused(true);
      d.clearFish();
      d.clearShots();
      const f = d.spawn('clown', { x: 220, y: 260, fromLeft: true });
      f.vx = 0; f.amp = 0;
      await new Promise(r => setTimeout(r, 120));
      // 只数小鱼的小血条：大鱼一直有血条，混进总数会让这条断言变成 flaky。
      const before = d.hpBarsSmall;
      f.hp = 0.5;
      await new Promise(r => setTimeout(r, 120));
      return { before, after: d.hpBarsSmall };
    } finally {
      d.setPaused(false);
    }
  });
  const barOk = barRes.before === 0 && barRes.after === 1;
  console.log('small fish hp bar appears after a hit:', barOk ? 'PASS' : 'FAIL', JSON.stringify(barRes));

  /* 打空了：网还是要张开 */
  const missRes = await page.evaluate(async () => {
    const d = window.__fish;
    try {
      // 关掉自然出鱼：不然半路冒出一条鱼把这一发吃了，就不是「打空」了
      d.setSpawner(false);
      d.clearFish();
      d.clearShots();
      d.parts.length = 0;               // 之前的网特效别混进来（parts 没有缓存，直接清）
      d.setAim(0);                       // 朝天打，上面没鱼
      d.fire();
      let saw = false, kind = '';
      for (let i = 0; i < 60 && !saw; i++) {
        await new Promise(r => setTimeout(r, 30));
        const p = d.parts.find(p => p.kind === 'net');
        if (p) { saw = true; kind = p.col || ''; }
      }
      return { saw, kind };
    } finally {
      d.setSpawner(true);
    }
  });
  // 打空的网是暗色的（#6f9aa8）；打到鱼的网是亮色的，两者颜色不同
  const missOk = missRes.saw === true && missRes.kind === '#6f9aa8';
  console.log('empty net opens on a miss:', missOk ? 'PASS' : 'FAIL', JSON.stringify(missRes));

  /* ================= issue 06：网要罩在鱼上面 =================
     两件事：
     ① 网特效的坐标不能是 NaN。以前「网」这种粒子没给 vx/vy，被粒子推进一算就是 NaN，
        整张网从来没画出来过（玩家只看得见飞出去的那张网）。
     ② 网的深度要排在所有鱼前面，不然会被鱼盖住。 */
  const netFrontRes = await page.evaluate(async () => {
    const d = window.__fish;
    try {
      d.setSpawner(false);
      d.clearFish();
      d.clearShots();
      d.parts.length = 0;
      // 一条 z 最靠前的鱼（ph=0.95 → z≈3.6）
      const f = d.spawn('shark', { x: 220, y: 220, ph: 0.95, fromLeft: true });
      f.vx = 0; f.amp = 0;
      d.netAt(f.x, f.y, f);
      // 等网张开
      let net = null;
      for (let i = 0; i < 40 && !net; i++) {
        await new Promise(r => setTimeout(r, 30));
        net = d.fx.find(fx => fx.grp && fx.grp.type === 'Group');
      }
      if (!net) return { found: false };
      const p = net.grp.position;
      // 网粒子的坐标（NaN 的话整张网就没了）
      const part = d.parts.find(x => x.kind === 'net');
      return {
        found: true,
        x: p.x, y: p.y, z: p.z,
        finite: Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z),
        partFinite: !!part && Number.isFinite(part.x) && Number.isFinite(part.y),
        depths: d.depths
      };
    } finally {
      d.setSpawner(true);
    }
  });
  const dep = netFrontRes.depths || {};
  const netFrontOk = netFrontRes.found && netFrontRes.finite && netFrontRes.partFinite
    && dep.net > dep.fishMax && dep.shot > dep.fishMax;
  console.log('net opens in front of the fish:', netFrontOk ? 'PASS' : 'FAIL', JSON.stringify(netFrontRes));

  /* 大鱼爆金币：小鱼几颗，大鱼一把，鱼王最猛 */
  const coinRes = await page.evaluate(async () => {
    const d = window.__fish;
    const one = async (type) => {
      d.clearFish(); d.clearShots(); d.parts.length = 0;
      d.spawn(type, { x: 220, y: 220, ph: 0.5, fromLeft: true });
      await new Promise(r => setTimeout(r, 60));
      d.catchFish(d.fish[0]);
      const coins = d.parts.filter(p => p.kind === 'coin');
      return { n: coins.length, maxS: coins.length ? Math.max(...coins.map(c => c.s)) : 0 };
    };
    const clown = await one('clown');
    const shark = await one('shark');
    const king = await one('king');
    return { clown, shark, king };
  });
  const coinOk = coinRes.clown.n < coinRes.shark.n && coinRes.shark.n < coinRes.king.n
    && coinRes.clown.maxS < coinRes.shark.maxS && coinRes.shark.maxS < coinRes.king.maxS;
  console.log('big fish bursts more coins:', coinOk ? 'PASS' : 'FAIL', JSON.stringify(coinRes));

  /* ================= issue 04：鱼群编队 + 受惊散开 ================= */
  const schoolRes = await page.evaluate(() => {
    const d = window.__fish;
    d.clearFish();
    for (let i = 0; i < 3; i++) d.school();
    const groups = {};
    for (const f of d.fish) (groups[f.grp] = groups[f.grp] || []).push(f);
    // 取最大的那一群：龙鱼群只有两条，会排在后面
    const big = Object.values(groups).sort((a, b) => b.length - a.length)[0];
    if (!big || big.length < 4) return { found: false, n: d.fish.length };
    const sameSpeed = big.every(f => Math.abs(Math.abs(f.vx) - Math.abs(big[0].vx)) < 1e-9);
    const samePhase = big.every(f => Math.abs(f.ph - big[0].ph) < 1e-9);
    // 打其中一条，同群的要一起受惊
    const a = big[0], b = big[1];
    a.vx = 0; b.vx = 0; a.amp = 0; b.amp = 0;
    d.netAt(a.x, a.y, a);
    return { found: true, n: big.length, sameSpeed, samePhase, scatter: b.scatter, flees: b.flee > 0 };
  });
  const schoolOk = schoolRes.found && schoolRes.sameSpeed && schoolRes.samePhase && schoolRes.scatter > 0 && schoolRes.flees;
  console.log('school: same speed/phase, scatter on hit:', schoolOk ? 'PASS' : 'FAIL', JSON.stringify(schoolRes));

  /* ================= issue 05：潮汐分级 + 大潮 ================= */
  const tierRes = await page.evaluate(() => {
    const d = window.__fish;
    d.setTide(1);  const w1 = d.weights(),  t1 = d.tier();
    d.setTide(6);  const w6 = d.weights(),  t6 = d.tier();
    d.setTide(11); const w11 = d.weights(), t11 = d.tier();
    d.setTide(21); const w21 = d.weights();          // 稀有权重封顶档
    d.setTide(26); const w26 = d.weights();          // 再涨也该封顶
    d.setTide(4);  const b4 = d.bigTide();
    d.setTide(5);  const b5 = d.bigTide();
    d.setTide(10); const b10 = d.bigTide();
    return {
      jade1: w1.jade, jade6: w6.jade, jade11: w11.jade, jade21: w21.jade, jade26: w26.jade,
      shark1: w1.shark, shark6: w6.shark,
      tier1: t1, tier6: t6, tier11: t11, big4: b4, big5: b5, big10: b10
    };
  });
  const tierOk = tierRes.jade6 > tierRes.jade1 && tierRes.jade11 > tierRes.jade6 &&
    tierRes.shark6 > tierRes.shark1 &&
    tierRes.jade21 === tierRes.jade26 &&                       // 稀有权重封顶，不再涨
    tierRes.tier1 === 0 && tierRes.tier6 === 1 && tierRes.tier11 === 2 &&
    tierRes.big4 === false && tierRes.big5 === true && tierRes.big10 === true;
  console.log('tide tiers raise rare weights (capped at 2.2x):', tierOk ? 'PASS' : 'FAIL', JSON.stringify(tierRes));

  const bigTideRes = await page.evaluate(async () => {
    const d = window.__fish;
    const mark = d.tideLog.length;
    d.clearFish();
    d.setTide(4);
    d.forceTide();
    await new Promise(r => setTimeout(r, 400));
    const rec = d.tideLog[mark] || null;
    return {
      tide: d.tide,
      boss: d.fish.some(f => f.boss),
      fish: d.fish.length,
      rec: rec ? { tide: rec.tide, big: rec.big, schools: rec.schools.map(s => s.type + 'x' + s.n) } : null
    };
  });
  // 大潮 = 两群鱼 + 鱼王必来。读「涨潮实录」而不是「屏幕上还剩几群」：
  // 群里的鱼是从画面外一批批游进来的，断言会被出场时机带跑。
  const bigTideOk = bigTideRes.tide === 5 && bigTideRes.boss === true &&
    !!bigTideRes.rec && bigTideRes.rec.tide === 5 && bigTideRes.rec.big === true &&
    bigTideRes.rec.schools.length === 2 && bigTideRes.rec.schools.every(s => !/x0$/.test(s));
  console.log('big tide (every 5th) brings two schools + a king:',
    bigTideOk ? 'PASS' : 'FAIL', JSON.stringify(bigTideRes));

  /* ================= issue 03：落盘节流 + HUD 增量写 ================= */
  await page.evaluate(() => {
    const d = window.__fish;
    d.clearFish();
    d.wallet = 5000;
    d.S.auto = true; d.syncHud();
    window.__cnt = { setItem: 0, qs: 0, wallet: 0, state: 0 };
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      window.__cnt.setItem++;
      if (k === 'arcade.wallet.v1') window.__cnt.wallet++;
      else if (k === 'fishhunter.v1') window.__cnt.state++;
      return orig.call(this, k, v);
    };
    const oq = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (s) { window.__cnt.qs++; return oq.call(this, s); };
    window.__t0 = performance.now();
  });
  await page.waitForTimeout(10000);
  const thr = await page.evaluate(() => {
    const d = window.__fish;
    d.S.auto = false; d.syncHud();
    const secs = (performance.now() - window.__t0) / 1000;
    return { secs, setItem: window.__cnt.setItem, qs: window.__cnt.qs, fired: d.run.fired,
             wallet: window.__cnt.wallet, state: window.__cnt.state };
  });
  const thrOk = thr.setItem / thr.secs <= 6.5 && thr.qs <= 12 && thr.fired >= 40;
  console.log('throttled writes (<=6.5/s) & no per-shot DOM queries:',
    thrOk ? 'PASS' : 'FAIL', JSON.stringify({
      perSec: +(thr.setItem / thr.secs).toFixed(2),
      walletPerSec: +(thr.wallet / thr.secs).toFixed(2),
      statePerSec: +(thr.state / thr.secs).toFixed(2),
      qs: thr.qs, fired: thr.fired, secs: +thr.secs.toFixed(1)
    }));

  /* ================= 全柜联动（issue 29 / ADR-0010）================= */
  // 抓到鱼王 / 龙鱼往信箱给聚宝盆发信；收到聚宝盆的开奖信，下一潮鱼王必来（就算不是第 3 潮）
  const link = await page.evaluate(() => {
    const d = window.__fish;
    localStorage.removeItem('arcade.link.v1');
    d.setSpawner(false); d.clearFish();
    const k = d.spawn('king', { x: 200, y: 200 }); d.catchFish(k);
    const g = d.spawn('jade', { x: 200, y: 200 }); d.catchFish(g);
    const box = JSON.parse(localStorage.getItem('arcade.link.v1'));
    const sent = box.q.filter(m => m.to === 'pusher').map(m => m.kind).join(',');
    d.linkSend('fish', 'jackpot'); d.linkPoll();
    d.clearFish(); d.setTide(1);
    d.forceTide();                                   // 第 2 潮：平常不来鱼王
    return { sent };
  });
  await page.waitForTimeout(400);
  link.king = await page.evaluate(() => { const d = window.__fish; const k = d.fish.some(f => f.type === 'king'); d.setSpawner(true); return k; });
  const linkOk = link.sent === 'king,dragon' && link.king;
  console.log('cabinet link: sends king/dragon, jackpot brings a king:', linkOk ? 'PASS' : 'FAIL', JSON.stringify(link));

  /* ================= 首页 ================= */
  await page.setViewportSize({ width: 420, height: 900 });
  const home = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(home, { timeout: 90000 });
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
  const allPass = linkOk && threeOk && seedOk && cleanOk && walletOk0 && shotOk && betOk && payOk && netOk && dragonOk && netUpOk && maxOk && skinOk && reliefOk && aimOk &&
    saveOk && paused && resumed && overflow <= 0 && homeInfo.card && homeInfo.lit > 100 &&
    purseOk && errors.length === 0 &&
    hudOk && barOk && missOk && schoolOk && tierOk && bigTideOk && thrOk && netFrontOk && coinOk;
  console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
