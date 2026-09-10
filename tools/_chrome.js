// 用系统 Chrome 跑测试，不下 playwright 自带的那 150MB 浏览器。
// 用法：node -r ./tools/_chrome.js tools/verify-xxx.js
// 预加载这一个文件，十几个脚本里的 chromium.launch() 一行都不用改。
const { chromium } = require('playwright');
const orig = chromium.launch.bind(chromium);
chromium.launch = (opts = {}) => orig({ channel: 'chrome', ...opts });
