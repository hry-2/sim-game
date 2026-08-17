// 最小冒烟测试：确认两个原型能加载且不报错。CI 里跑这个。
// 需要 playwright: npm i -D playwright && npx playwright install chromium
const { chromium } = require('playwright');
const path = require('path');

const PAGES = ['src/sim/index.html', 'src/survival/index.html'];

(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  for (const rel of PAGES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto('file://' + path.resolve(__dirname, '..', rel));
    await page.waitForTimeout(2000);

    const painted = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return 0;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 400) if (d[i] || d[i + 1] || d[i + 2]) n++;
      return n;
    });

    const ok = errors.length === 0 && painted > 100;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${rel}  painted=${painted}  ${errors.join(' | ')}`);
    if (!ok) failed++;
    await page.close();
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
