// 捏人验证。要守的不是"界面弹出来了"，而是【捏出来的东西真的落到世界上】：
// 名字被别人的 rel 和 HOMEOWNER 当键用、长相撞脸要换、
// 性格/脾气/心性必须真的改变打分，否则捏人就只是换皮。
const { chromium } = require('playwright');
const path = require('path');
const BASE = 'file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE);                       // 【不带 ?auto】：新局该弹捏人
  await page.waitForTimeout(1600);

  const r = await page.evaluate(async () => {
    const out = {};
    const $ = s => document.querySelector(s);
    out.shown = !!$('#create');
    out.paused = running === false;            // 捏人时世界该停着
    out.faces = document.querySelectorAll('#cfaces canvas').length;
    out.drawn = (() => { const c = $('#cfaces canvas'); if (!c) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i]) return true;   // 有不透明像素
      return false; })();

    // ---- 捏一个和默认完全不同的人 ----
    const before = { name: PC.name, row: PC.row, trait: PC.trait,
                     tt: PC.tt.slice(), mbti: PC.mbti };
    const otherRow = sims.find(s => s !== PC).row;       // 故意挑一个会撞脸的
    const victim = sims.find(s => s !== PC && s.row === otherRow).name;
    $('#cfaces canvas[data-row="' + otherRow + '"]').click();
    $('#create [data-t="耽乐"]').click();
    for (const t of before.tt) { const b = $(`#create [data-tt="${t}"]`); if (b && b.classList.contains('on')) b.click(); }
    $('#create [data-tt="邋遢"]').click();
    $('#create [data-tt="孤僻"]').click();
    for (const [i, ch] of [[0,'I'],[1,'N'],[2,'F'],[3,'P']])
      $(`#create [data-mb="${i}:${ch}"]`).click();
    const nameBox = $('#cname'); nameBox.value = '三娘';
    nameBox.dispatchEvent(new Event('input'));
    out.tipMentions = $('#ctip').textContent.includes('耽乐') && $('#ctip').textContent.includes('邋遢');

    // ---- 落地 ----
    $('#cgo').click();
    out.closed = !$('#create');
    out.running = running === true;
    out.after = { name: PC.name, row: PC.row, trait: PC.trait,
                  tt: PC.tt.slice(), mbti: PC.mbti };
    // 名字：别人的 rel 必须跟着改键，HOMEOWNER 也是
    out.relRekeyed = sims.every(s => s === PC ||
      (s.rel['三娘'] !== undefined && s.rel[before.name] === undefined));
    out.homeowner = HOMEOWNER.includes('三娘') && !HOMEOWNER.includes(before.name);
    out.rosterName = NAMES.includes('三娘');
    // 长相：撞脸的那个该拿到玩家原来那一行，全村不许重样
    out.swapped = sims.find(s => s.name === victim).row === before.row;
    out.uniqueRows = new Set(sims.map(s => s.row)).size === sims.length;
    // 性格/心性必须真的进了打分层
    out.weights = { fun: weightOf(PC, 'fun'), provision: weightOf(PC, 'provision') };
    out.mbApplied = { patience: mb(PC, 'patience'), socDec: mb(PC, 'socDec') };
    out.traitApplied = PC.tt.includes('邋遢') && weightOf(PC, 'hygiene') < 1;

    // ---- 存档要存得住这张脸 ----
    saveGame();
    return out;
  });

  // 读档：重开一次，捏出来的人该原样回来，而且不再弹捏人
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errs.push('p2: ' + e.message));
  await p2.goto(BASE);
  await p2.waitForTimeout(1600);
  const after = await p2.evaluate(() => ({
    creator: !!document.querySelector('#create'),
    name: PC.name, row: PC.row, trait: PC.trait, tt: PC.tt.slice(), mbti: PC.mbti,
  }));

  // ---- 各尺寸下这个框放不放得下 ----
  // 捏人是玩家看到的【第一屏】，在手机上要滚才看得全的话，第一印象就废了。
  const sizes = [];
  for (const c of [{ n:'小手机', w:360, h:640 }, { n:'手机竖屏', w:390, h:844 },
                   { n:'手机横屏', w:844, h:390 }, { n:'桌面', w:1280, h:720 }]) {
    // 【每个尺寸开一个干净的 context】：和主测试共用的话，主测试那句 saveGame()
    // 留下的存档会让捏人不再弹（而且 reload 前 pagehide 还会再存一次，wipeSave 白搭）。
    const c2 = await browser.newContext({ viewport: { width: c.w, height: c.h },
                                          hasTouch: true, isMobile: c.h > c.w });
    const pg = await c2.newPage();
    await pg.goto(BASE);
    await pg.waitForTimeout(1500);
    sizes.push({ ...c, ...await pg.evaluate(() => {
      const b = document.querySelector('#create .cbox');
      if (!b) return { shown: false };
      const r = b.getBoundingClientRect(), f = document.querySelector('#cfaces canvas').getBoundingClientRect();
      return { shown: true, boxH: Math.round(r.height), boxW: Math.round(r.width),
               face: Math.round(f.width), fits: r.height <= innerHeight - 16 };
    }) });
    await c2.close();
  }

  // 带 ?auto=1 不该弹
  const p3 = await ctx.newPage();
  await p3.goto(BASE + '?auto=1');
  await p3.evaluate(() => wipeSave());
  await p3.reload();
  await p3.waitForTimeout(1600);
  const auto = await p3.evaluate(() => ({ creator: !!document.querySelector('#create'), running }));
  await browser.close();

  const P = [
    ['① 新局弹出捏人，世界停着', r.shown && r.paused],
    [`① ${r.faces} 张脸都画出来了`, r.faces === 16 && r.drawn],
    ['② 说明跟着选择变（不是死文案）', r.tipMentions],
    ['③ 选完就关，世界开始走', r.closed && r.running],
    ['④ 名字改了', r.after.name === '三娘'],
    ['④ 别人的 rel 跟着改键（不改的话关系全丢）', r.relRekeyed],
    ['④ HOMEOWNER 和花名册也跟着改', r.homeowner && r.rosterName],
    ['⑤ 撞脸的人换走了原来那一行，全村不重样', r.swapped && r.uniqueRows],
    ['⑥ 性格进了需求权重（耽乐：闲趣重、家计轻）',
      r.after.trait === '耽乐' && r.weights.fun > 1.5 && r.weights.provision < 1],
    ['⑥ 脾气进了权重（邋遢：不在乎脏）', r.traitApplied],
    ['⑥ 心性进了决策（INFP：耐心低、交游掉得慢）',
      r.after.mbti === 'INFP' && r.mbApplied.patience < 1 && r.mbApplied.socDec < 1],
    ['⑦ 存得下读得回，而且读档不再弹捏人',
      !after.creator && after.name === '三娘' && after.row === r.after.row &&
      after.trait === '耽乐' && after.mbti === 'INFP' &&
      JSON.stringify(after.tt) === JSON.stringify(r.after.tt)],
    ['⑧ ?auto=1 直接跳过（测试走这条）', !auto.creator && auto.running === true],
    // 横屏 390 高本来就放不下这么多选项，允许它滚；竖屏和桌面必须一屏看全
    ['⑨ 手机竖屏/小手机/桌面都一屏放得下',
      sizes.filter(s2 => s2.n !== '手机横屏').every(s2 => s2.shown && s2.fits)],
    ['⑨ 头像不至于小到点不准（≥40px）', sizes.every(s2 => s2.face >= 40)],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  捏人' : 'FAIL  捏人');
  for (const [n, v] of P) console.log(`  ${v ? '✓' : '✗'} ${n}`);
  console.log(`  捏出来的：${r.after.name} · ${r.after.trait} · ${r.after.tt.join('+')} · ${r.after.mbti}` +
              `　长相第 ${r.after.row} 行（原来 ${r.faces ? '' : ''}${r.swapped ? '换给了撞脸的那位' : '?'}）`);
  for (const s2 of sizes)
    console.log(`  ${s2.fits ? '✓' : '·'} ${s2.n.padEnd(5)} ${s2.w}×${s2.h}` +
                `  框 ${s2.boxW}×${s2.boxH}px  脸 ${s2.face}px  ${s2.fits ? '一屏看全' : '要滚'}`);
  if (errs.length) console.log('  报错: ' + errs.join(' | '));
  process.exit(ok ? 0 : 1);
})();
