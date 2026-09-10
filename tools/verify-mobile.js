// 多尺寸适配验证。手机上出问题的典型症状是"横向溢出"和"画布大到看不全"，
// 两者都只在真实视口下才暴露 —— 冒烟测试固定 1280×880，一辈子测不到。
const { chromium, devices } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html');

const CASES = [
  { n: '手机竖屏', w: 390, h: 844, touch: true },
  { n: '手机横屏', w: 844, h: 390, touch: true },
  { n: '小手机',   w: 360, h: 640, touch: true },
  { n: '平板',     w: 820, h: 1180, touch: true },
  { n: '桌面',     w: 1440, h: 900, touch: false },
];

(async () => {
  const browser = await chromium.launch();
  const rows = [];
  for (const c of CASES) {
    const page = await browser.newPage({
      viewport: { width: c.w, height: c.h }, hasTouch: c.touch, isMobile: c.touch,
      deviceScaleFactor: c.touch ? 2 : 1,
    });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(FILE);
    await page.waitForTimeout(1400);

    const r = await page.evaluate(() => {
      // 走两步，确认镜头真的跟上了（不跟随的话主角会走出视口）
      running = true; keys.KeyD = 1;
      return new Promise(res => setTimeout(() => {
        keys.KeyD = 0;
        const sx = PC.rx - CAM.x, sy = PC.ry - CAM.y;
        res({
          view: VIEWW + '×' + VIEWH, pxs: PXS,
          // VPW/VPH 是【世界像素】的视口尺寸；cv.width 现在是它的 RS 倍（后备存储）
          cvW: VPW, cvH: VPH, rs: RS,
          cssW: cv.clientWidth, cssH: cv.clientHeight,
          // 后备存储必须正好是 VPW*RS —— 错了就说明 fit() 和渲染变换对不上
          backing: cv.width === VPW * RS && cv.height === VPH * RS,
          // CSS 放大倍率只能是整数，或者是缩小（缩小等于超采样，高 DPI 屏上反而正好）
          crisp: (PXS % RS === 0) || (PXS < RS),
          // 横向溢出：手机上最常见的翻车
          overflow: document.documentElement.scrollWidth - innerWidth,
          touchUI: getComputedStyle(document.getElementById('tc')).display,
          // 主角必须始终在视口内
          inView: sx >= 0 && sx <= VPW && sy >= 0 && sy <= VPH,
          // 镜头必须夹在地图内，不能露出画布外的黑边
          camOK: CAM.x >= -0.5 && CAM.y >= -0.5 &&
                 CAM.x <= GW * T - VPW + 0.5 && CAM.y <= GH * T - VPH + 0.5,
          // 视口不能大于地图
          fits: VIEWW <= GW && VIEWH <= GH,
        });
      }, 900));
    });

    // 触屏档位必须真的能靠摇杆走路。
    // 先把主角挪到空地 —— 上面的按键测试已经把他推到卧室墙边了，
    // 在墙角测摇杆只会测出"走不动"，那是测试的错不是摇杆的错。
    let joy = null;
    if (c.touch) {
      const before = await page.evaluate(() => {
        PC.act = null; PC.gx = 22; PC.gy = 18;
        PC.px = 22.5 * T; PC.py = 18.5 * T; PC.ppx = PC.px; PC.ppy = PC.py;
        CAM.init = 0;
        return PC.px;
      });
      await page.waitForTimeout(200);
      const box = await page.locator('#tcpad').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 34, box.y + box.height / 2, { steps: 4 });
      await page.waitForTimeout(700);
      await page.mouse.up();
      const after = await page.evaluate(() => PC.px);
      joy = after - before > 4;
    }

    const ok = errs.length === 0 && r.overflow <= 0 && r.inView && r.camOK && r.fits
            && r.backing && r.crisp
            && r.cssW <= c.w && (c.touch ? (r.touchUI === 'block' && joy) : true);
    rows.push({ ...c, ...r, joy, ok, err: errs[0] || '' });
    if (c.n === '手机竖屏') await page.screenshot({ path: '/tmp/phone.png' });
    if (c.n === '手机横屏') await page.screenshot({ path: '/tmp/phone-land.png' });
    if (c.n === '桌面') await page.screenshot({ path: '/tmp/desktop.png' });
    await page.close();
  }
  await browser.close();

  const all = rows.every(r => r.ok);
  console.log(all ? 'PASS  多尺寸适配' : 'FAIL  多尺寸适配');
  for (const r of rows)
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.n.padEnd(5)} ${String(r.w).padStart(4)}×${r.h}` +
      `  视口 ${r.view} @${r.pxs}x/RS${r.rs} → ${r.cssW}×${r.cssH}px` +
      `  溢出 ${r.overflow}  ${r.inView ? '镜头跟上' : '主角出屏!'}` +
      `  ${r.touch ? (r.joy ? '摇杆可走' : '摇杆失灵!') : '键鼠'}` +
      (r.err ? '  报错:' + r.err : ''));
  process.exit(all ? 0 : 1);
})();
