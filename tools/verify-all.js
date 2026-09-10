// 一把跑完全部回归。单个跑：node -r ./tools/_chrome.js tools/verify-xxx.js
// 用系统 Chrome（见 _chrome.js），不下 playwright 自带的那 150MB 浏览器。
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const dir = __dirname;
const only = process.argv[2];
const files = fs.readdirSync(dir)
  .filter(f => /^verify-.*\.js$/.test(f) && f !== 'verify-all.js')
  .filter(f => f !== 'verify-neon.js')             // 那是另一个游戏
  .concat('smoke-test.js')
  .filter(f => !only || f.includes(only));
let bad = [];
for (const f of files) {
  process.stdout.write(f.padEnd(20));
  try {
    execFileSync(process.execPath, ['-r', path.join(dir, '_chrome.js'), path.join(dir, f)],
                 { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('✓');
  } catch (e) {
    bad.push(f);
    const out = (e.stdout || '') + (e.stderr || '');
    const why = String(out).split('\n').filter(l => /^(FAIL|\s+✗)|Error:/.test(l)).slice(0, 6);
    console.log('✗\n' + why.map(l => '    ' + l.trim()).join('\n'));
  }
}
console.log(`\n绿 ${files.length - bad.length} / 红 ${bad.length}${bad.length ? '：' + bad.join(' ') : ''}`);
process.exit(bad.length ? 1 : 0);
