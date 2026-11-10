// 抓大鹅的关卡存档：后台刷新后【同一筛还能接着打】才是重点，
// 只验证"localStorage 里有个键"等于什么都没验证。
// 用同一个 browser context 开两个页面，才共享 localStorage。
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert/strict');
const FILE = 'file://' + path.resolve(__dirname, '..', 'games', 'goose', 'index.html');

const STATE = () => ({
  level, total, phase, cleared, caught, uses: { ...uses },
  tiles: tiles.map(t => `${t.id}:${t.type}`).join(','),
  tray: tray.map(t => `${t.id}:${t.type}`).join(','),
  board: tiles.length + tray.length + cleared,
  bodies: window.goose3d ? window.goose3d.bodies.size : 0,
});

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const errs = [];
  const watch = (p, tag) => p.on('pageerror', e => errs.push(tag + ': ' + e.message));

  // ---- 第一次打开：清掉旧档，从第一站开始，并写出存档 ----
  let p = await ctx.newPage(); watch(p, 'p1');
  await p.goto(FILE);
  await p.waitForFunction(() => window.goose3d);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForFunction(() => window.goose3d);
  const first = await p.evaluate(`(${STATE.toString()})()`);
  assert.equal(first.level, 0);
  assert.equal(first.phase, 'playing');
  assert.equal(first.board, first.total);
  assert.equal(first.tiles.split(',').length, 18, '第一站 18 件');
  const seal = await p.evaluate(() => JSON.parse(localStorage.getItem('goose.archive.v1')));
  assert.equal(seal.v, 1);
  assert.equal(seal.level, 0);
  assert.equal(seal.unlocked, 0);
  assert.ok(seal.session && seal.session.tiles.length === 18, '开局盘面就落盘');

  // 存档面板：只有第一站能点
  await p.click('#archive');
  const rows = await p.evaluate(() => [...document.querySelectorAll('.archive-row')].map(r => ({
    disabled: r.disabled, text: r.textContent,
  })));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].disabled, false);
  assert.equal(rows[1].disabled, true);
  assert.equal(rows[2].disabled, true);
  assert.ok(rows[0].text.includes('接着打'), '正在打的那一站标成接着打');
  await p.evaluate(() => document.querySelector('.archive-row').click());
  const stillOpenBoard = await p.evaluate(`(${STATE.toString()})()`);
  assert.equal(stillOpenBoard.tiles, first.tiles, '点当前关不该洗掉打到一半的盘面');
  assert.ok(await p.evaluate(() => document.getElementById('modal').hidden));

  // ---- 打一筛，刷新，还得是同一筛 ----
  await p.evaluate(() => pick(solution[0]));
  const mid = await p.evaluate(`(${STATE.toString()})()`);
  await p.close();

  const p2 = await ctx.newPage(); watch(p2, 'p2');
  await p2.goto(FILE);
  await p2.waitForFunction(() => window.goose3d && window.goose3d.bodies.size > 0);
  await p2.waitForTimeout(300);
  const resumed = await p2.evaluate(`(${STATE.toString()})()`);
  assert.equal(resumed.level, mid.level);
  assert.equal(resumed.phase, 'playing');
  assert.equal(resumed.tiles, mid.tiles, '盘里剩下的物品一致');
  assert.equal(resumed.tray, mid.tray, '收纳槽一致');
  assert.equal(resumed.cleared, mid.cleared);
  assert.equal(resumed.board, resumed.total, '读档后物品总数守恒');
  assert.equal(resumed.bodies, resumed.tiles.split(',').length, '3D 实体按盘面重建');
  assert.ok((await p2.textContent('#status')).includes('接着上次的进度'));
  assert.ok((await p2.textContent('#caught')).includes('0 只鹅'));

  // ---- 通关第一站：记录 + 解锁下一站；通关后的盘面不再续玩 ----
  await p2.evaluate(() => { for (const id of solution.slice()) pick(id); });
  const won = await p2.evaluate(`(${STATE.toString()})()`);
  assert.equal(won.phase, 'won');
  assert.equal(won.caught, 1);
  const afterWin = await p2.evaluate(() => JSON.parse(localStorage.getItem('goose.archive.v1')));
  assert.equal(afterWin.records[0].wins, 1);
  assert.equal(afterWin.records[0].clean, 1, '没用道具通关要记下来');
  assert.equal(afterWin.unlocked, 1);
  assert.equal(afterWin.level, 1);
  assert.equal(afterWin.session, null, '通关后刷新不该回到已清空的盘面');
  assert.equal(afterWin.caught, 1);
  await p2.click('#dialogPrimary'); // 去下一站
  const second = await p2.evaluate(`(${STATE.toString()})()`);
  assert.equal(second.level, 1);
  assert.equal(second.board, second.total);
  assert.equal(second.board, 63, '第二站 63 件');

  await p2.click('#archive');
  const rows2 = await p2.evaluate(() => [...document.querySelectorAll('.archive-row')].map(r => ({
    disabled: r.disabled, text: r.textContent,
  })));
  assert.equal(rows2[0].disabled, false);
  assert.ok(rows2[0].text.includes('★ 无道具通关'));
  assert.equal(rows2[1].disabled, false);
  assert.equal(rows2[2].disabled, true, '第三站仍未解锁');
  await p2.click('#dialogPrimary');

  // ---- 第二站打一半后刷新：多关存档互不串台 ----
  await p2.evaluate(() => pick(solution[0]));
  await p2.click('#shuffle'); // 真实按钮路径：道具次数也要落盘
  const secondMid = await p2.evaluate(`(${STATE.toString()})()`);
  assert.equal(secondMid.uses.shuffle, 1);
  await p2.close();
  const p3 = await ctx.newPage(); watch(p3, 'p3');
  await p3.goto(FILE);
  await p3.waitForFunction(() => window.goose3d);
  await p3.waitForTimeout(300);
  const secondResumed = await p3.evaluate(`(${STATE.toString()})()`);
  assert.equal(secondResumed.level, 1);
  assert.equal(secondResumed.tiles, secondMid.tiles);
  assert.equal(secondResumed.tray, secondMid.tray);
  assert.equal(secondResumed.uses.shuffle, 1, '道具次数也读得回来');
  assert.ok((await p3.textContent('#caught')).includes('1 只鹅'), '抓到的鹅跨会话累计');

  // ---- 坏存档：只丢这一筛，不把页面搞崩 ----
  await p3.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('goose.archive.v1'));
    raw.session = { level: 2, tiles: [{ id: 0, type: 99 }], tray: [], uses: {} };
    localStorage.setItem('goose.archive.v1', JSON.stringify(raw));
  });
  await p3.reload();
  await p3.waitForFunction(() => window.goose3d);
  const broken = await p3.evaluate(`(${STATE.toString()})()`);
  assert.equal(broken.level, 1, '坏的盘面丢掉，关卡记录留着');
  assert.equal(broken.board, broken.total);
  assert.equal(broken.phase, 'playing');
  assert.equal(errs.length, 0, '页面不能报错：' + errs.join(' | '));

  // 体积：75 件的盘面也不能把 localStorage 写爆
  const kb = await p3.evaluate(() => Math.round(localStorage.getItem('goose.archive.v1').length / 1024));
  assert.ok(kb < 256, '存档体积 ' + kb + 'KB');

  // ---- 清空存档 ----
  await p3.click('#archive');
  await p3.evaluate(() => document.querySelector('.archive-reset').click());
  await p3.evaluate(() => document.getElementById('dialogPrimary').click());
  const wiped = await p3.evaluate(`(${STATE.toString()})()`);
  assert.equal(wiped.level, 0);
  assert.equal(wiped.caught, 0);
  const afterWipe = await p3.evaluate(() => JSON.parse(localStorage.getItem('goose.archive.v1')));
  assert.deepEqual(afterWipe.records, [
    { wins: 0, losses: 0, clean: 0 },
    { wins: 0, losses: 0, clean: 0 },
    { wins: 0, losses: 0, clean: 0 },
  ]);
  assert.equal(afterWipe.unlocked, 0);

  await browser.close();
  assert.equal(errs.length, 0);
  console.log('PASS: 关卡存档续玩、跨关记录、捕捉数累计、坏档降级、清档（' + kb + 'KB）');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
