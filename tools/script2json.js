#!/usr/bin/env node
// 剧本 → 对话数据
// ==================================================================
// 把 docs/夜港剧本.md 解析成游戏能吃的 JSON。
//
// 为什么要有这个东西：剧本是会天天改的，游戏里不该出现一行"如果玩家选了 A 就说 B"。
// 写手只改 markdown，跑一次这个脚本，游戏就跟着变。剧本因此和策划、README 一样
// 是仓库里的纯文本，能 diff、能 review。
//
// 分工（重要）：
//   * 这个脚本负责【台词】—— 对白、选项、条件、标志位、跳转、旁白、屏显。
//     这是写作量的 95%，也是天天变的部分。
//   * 【场次图】—— 哪一场接哪一场、哪一场要加载哪张地图、目标文字是什么 ——
//     是游戏里手写的几十行数据（GRAPH）。它很少变，而且它是玩法不是文字。
//
// 解析的格式就是剧本现在的写法，不需要给 markdown 加任何标记：
//   ## 5 · P0 · 裁员日        → 一支任务，key = P0
//   ### 场景 1：xxx           → 该任务的第 1 场（跳转 "场景 2" 按序号找）
//   *斜体*                    → 旁白
//   *如果 flag.x：*           → 往下的台词挂上条件，直到 *如果不是：* 反转
//   **谁**（小注）：台词       → 对白
//   **1a**                    → 跳转锚点
//   ```…```                   → 屏显（终端 / 义眼里的字）
//   > 选项 【条件】 → 赋值 → 去哪
//   → 去哪                    → 直接跳
//
// 用法：
//   node tools/script2json.js              # 打印统计与未解析项
//   node tools/script2json.js --out x.json # 写文件
//   node tools/script2json.js --embed      # 嵌回 games/nightharbor/index.html
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'docs', '夜港剧本.md');

// 只解析有全文对白的几节。设定集、大纲、结局画面不是对白，跳过。
const PARSE_SECTIONS = new Set(['5', '6', '7', '8', '9']);
// 已经写成全文的任务。剧本里还是大纲的（S1~S5、R3）不解析 —— 它们没有完整对白，
// 硬解只会得到一堆假数据。等哪一支写全了，把它的号加进来。
const FULLTEXT = new Set(['P0', 'M1', 'G1', 'N1', 'R1']);
// 跳转关键词：不是本场的锚点，而是交给场次图处理的出口
const EXITS = ['任务开始', '撤离', '结算', '结束序章', '硬盘内容', '回潮声', '回船', '战斗'];

const RE = {
  h2:     /^##\s+(\S+)\s+·\s*(.*)$/,
  h3:     /^###\s+(.*)$/,
  quest:  /^([A-Z]\d+|P\d+)\s*·\s*(.*)$/,          // "M1 · 旧钥匙（…）"
  scene:  /^场景\s*(\d+)/,
  say:    /^\*\*(.+?)\*\*(（.+?）)?：(.*)$/,
  label:  /^\*\*(.+?)\*\*(（.+?）)?[：]?\s*$/,
  nar:    /^\*(.+)\*$/,
  opt:    /^>\s*(.+)$/,
  goto:   /^→\s*(.+)$/,
  cond:   /^如果\s*(.*?)[：:]?$/,
  expr:   /(?:flag|rep|love|cyber)\.[a-z_]+|money|days/i,
};

// 【条件】里的中文连接词换成表达式
const normNeed = s => s.replace(/^\s*无\s+(?=\S)/, '!').replace(/\s*或\s*/g, ' || ').replace(/\s*且\s*/g, ' && ').trim();

function parse(md) {
  const lines = md.split('\n');
  const quests = {};                       // key → {key, title, scenes:[]}
  const warn = [], notes = [];
  let sec = null, q = null, scene = null, cond = null, pendingCode = null, table = null;
  const skipped = new Set();

  const push = step => {
    if (!scene) return;
    if (cond) step.need = cond;
    scene.steps.push(step);
  };
  const startQuest = (key, title) => {
    if (!FULLTEXT.has(key)) { skipped.add(key); return null; }
    const nq = { key, title: title.replace(/（.*$/, '').trim(), scenes: [], after: [] };
    quests[key] = nq; return nq;
  };
  const newScene = (title, num) => {
    if (!q) return null;
    scene = { id: `${q.key}.${num != null ? num : q.scenes.length + 1}`, title, steps: [], labels: {} };
    q.scenes.push(scene); cond = null;
    return scene;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], line = raw.trim();

    let m = raw.match(RE.h2);
    if (m) {
      sec = m[1]; q = null; scene = null; cond = null;
      const qm = m[2].match(RE.quest);                  // ## 5 · P0 · 裁员日（全文）
      if (qm && PARSE_SECTIONS.has(sec)) q = startQuest(qm[1], qm[2]);
      continue;
    }
    if (!sec || !PARSE_SECTIONS.has(sec)) continue;
    if (raw.startsWith('## ')) continue;

    m = raw.match(RE.h3);
    if (m) {
      const h = m[1].trim();
      const qm = h.match(RE.quest);
      if (qm) {                                        // 新任务（含支线那一节里的 R1/S1…）
        q = startQuest(qm[1], qm[2]); scene = null; cond = null; table = null;
        if (q) newScene(q.title, 1);
        continue;
      }
      if (!q) continue;                                // 属于被跳过的任务
      table = null;
      const sm = h.match(RE.scene);
      newScene(h.replace(/^场景\s*\d+[：:]\s*/, ''), sm ? +sm[1] : null);
      continue;
    }
    if (!scene) continue;

    if (line.startsWith('```')) {                      // 屏显：整块收进来
      if (pendingCode) { push({ t: 'screen', lines: pendingCode }); pendingCode = null; }
      else pendingCode = [];
      continue;
    }
    if (pendingCode) { pendingCode.push(raw.replace(/^\s+/, '')); continue; }

    if (!line) { cond = null; continue; }

    if (line.startsWith('|')) {                        // 次日街坊表
      if (table !== 'after') continue;
      const c = line.split('|').map(x => x.trim()).filter((x, k, a) => k > 0 && k < a.length);
      if (c.length < 2 || /^-+$/.test(c[0]) || c[0] === '条件') continue;
      const cm = c[1].match(/^(.+?)[（(](.+?)[）)]?[：:](.*)$/) || c[1].match(/^(.+?)[：:](.*)$/);
      const who = cm ? cm[1].trim() : '';
      const text = (cm ? (cm[3] != null ? cm[3] : cm[2]) : c[1]).trim();
      const need = /^(无条件|无)$/.test(c[0]) ? undefined : normNeed(c[0]);
      const rule = { who, text: text || c[1], quest: q.key };
      if (need) { if (RE.expr.test(need)) rule.need = need; else rule.needLabel = c[0]; }
      q.after.push(rule);
      continue;
    }

    m = line.match(RE.opt);
    if (m) {
      const o = parseOpt(m[1], i + 1, warn);
      const last = scene.steps[scene.steps.length - 1];
      if (last && last.t === 'ask' && (last.need || null) === (cond || null)) last.opts.push(o);
      else push({ t: 'ask', opts: [o] });
      continue;
    }

    m = line.match(RE.goto);
    if (m) {
      const seg = parseSegs(m[1], i + 1, warn);
      push(Object.assign({ t: seg.goto || seg.action ? 'goto' : 'set' }, seg));
      continue;
    }

    if (line.startsWith('**')) {
      m = line.match(RE.say);
      if (m && m[3].trim()) { push({ t: 'say', who: m[1], note: m[2] || undefined, text: m[3].trim() }); continue; }
      m = line.match(RE.label);
      if (m) {
        if (m[1] === '次日街坊') { table = 'after'; cond = null; continue; }
        scene.labels[m[1]] = scene.steps.length; cond = null; continue;
      }
      warn.push(`${i + 1}: 像对白又不是对白 —— ${line}`);
      continue;
    }

    m = line.match(RE.nar);
    if (m) {
      const text = m[1].replace(/\*\*/g, '').trim();
      const bare = text.replace(/^[（(]\s*/, '').replace(/\s*[）)]$/, '');   // *（如果 flag.x：）* 也算条件标记
      const cm = bare.match(RE.cond);
      if (cm) {                                        // *如果 xxx：* / *如果不是：*
        if (RE.expr.test(cm[1])) cond = normNeed(cm[1]);
        else if (cond) { cond = cond.startsWith('!(') ? cond.slice(2, -1) : `!(${cond})`; notes.push(`${i + 1}: 「${text}」= 上一个条件取反 → ${cond}`); }
        else warn.push(`${i + 1}: 「${text}」找不到能取反的条件，已忽略`);
        continue;
      }
      // 「走位：<地图> · <提示>」= 这里把控制权交给玩家，走到目标点再接着往下说
      const wm = text.match(/^走位[：:]\s*([a-z0-9_]+)\s*[·|]\s*(.+)$/i);
      if (wm) { push({ t: 'walk', key: wm[1], hint: wm[2].trim() }); continue; }
      // 关卡说明、可选目标、教学提示是写给做关卡的人看的，不是台词
      push({ t: /^(关卡[：:]|可选目标[：:]|（教学)/.test(text) ? 'note' : 'nar', text });
      continue;
    }

    if (line === '---' || line.startsWith('> **')) { continue; }
    if (/^[（(]/.test(line)) { push({ t: 'nar', text: line }); continue; }
    warn.push(`${i + 1}: 没认出来 —— ${line.slice(0, 40)}`);
  }
  return { quests, warn, notes, skipped: [...skipped] };
}

// "赋值 → 去哪" / "动作 → 去哪" / "去哪"
function parseSegs(s, ln, warn) {
  const segs = s.split('→').map(x => x.trim()).filter(Boolean);
  const out = {};
  segs.forEach((seg, k) => {
    const isLast = k === segs.length - 1;
    if (/[+\-]?=/.test(seg)) {                        // 赋值：全角逗号也算分隔符
      const one = seg.split(/[;；，,]/).map(x => x.trim()).filter(Boolean).join('; ');
      out.set = out.set ? out.set + '; ' + one : one;
    }
    else if (isLast) out.goto = seg.replace(/（.*?）/g, '').trim();
    else out.action = seg;
  });
  if (!out.goto && !out.set && !out.action) warn.push(`${ln}: 空的跳转`);
  return out;
}
function parseOpt(s, ln, warn) {
  let need;
  s = s.replace(/【(.+?)】/, (_, n) => { need = normNeed(n); return ''; });
  const parts = s.split('→');
  const o = { text: parts[0].trim() };
  if (need) o.need = need;
  if (parts.length > 1) Object.assign(o, parseSegs(parts.slice(1).join('→'), ln, warn));
  return o;
}

// 分支块的最后一步必须是 goto 或 ask，否则执行会漏进下一个块 —— 这类 bug 肉眼极难看出来
function lint(quests, warn) {
  for (const q of Object.values(quests)) for (const sc of q.scenes) {
    const targets = new Set();
    for (const st of sc.steps) for (const tg of (st.t === 'ask' ? st.opts : [st]))
      if (tg.goto && sc.labels[tg.goto] != null) targets.add(tg.goto);
    for (const [name, at] of Object.entries(sc.labels)) {
      if (!targets.has(name) || at === 0) continue;         // 只查真的被跳进来的块
      const prev = sc.steps[at - 1];
      const ok = prev && (prev.t === 'goto' || prev.t === 'ask');
      if (!ok) warn.push(`${sc.id}: 上一个分支走完会漏进「${name}」块 —— 给它一个显式的 →`);
    }
  }
}
// 跳转目标要么是本场锚点、要么是本任务的场号、要么是出口关键词
function link(quests, warn) {
  let exits = new Set();
  for (const q of Object.values(quests)) for (const sc of q.scenes) {
    for (const st of sc.steps) {
      const targets = st.t === 'ask' ? st.opts : [st];
      for (const tg of targets) {
        if (!tg.goto) continue;
        if (sc.labels[tg.goto] != null) { tg.to = { scene: sc.id, step: sc.labels[tg.goto] }; continue; }
        const sm = tg.goto.match(RE.scene);
        if (sm) { tg.to = { scene: `${q.key}.${+sm[1]}`, step: 0 }; continue; }
        // 本任务里同名的场次优先 —— "回潮声" 在 G1 和 R1 里各是一场戏，不是通用出口
        const other = q.scenes.find(x => x.id !== sc.id && (x.title === tg.goto || x.title.startsWith(tg.goto)));
        if (other) { tg.to = { scene: other.id, step: 0 }; continue; }
        if (EXITS.includes(tg.goto)) { tg.to = { exit: tg.goto }; exits.add(`${sc.id} → ${tg.goto}`); continue; }
        tg.to = { exit: tg.goto }; exits.add(`${sc.id} → ${tg.goto}`);
        warn.push(`${sc.id}: 跳转 "${tg.goto}" 不是本场锚点也不是场号，当成出口交给场次图`);
      }
    }
  }
  return [...exits].sort();
}

function main() {
  const args = process.argv.slice(2);
  const md = fs.readFileSync(SRC, 'utf8');
  const { quests, warn, notes, skipped } = parse(md);
  lint(quests, warn);
  const exits = link(quests, warn);
  const data = { quests };

  const nq = Object.keys(quests).length;
  let ns = 0, nst = 0, nopt = 0;
  for (const q of Object.values(quests)) { ns += q.scenes.length; for (const s of q.scenes) { nst += s.steps.length; nopt += s.steps.filter(x => x.t === 'ask').reduce((a, x) => a + x.opts.length, 0); } }
  let naf = 0; for (const q of Object.values(quests)) naf += q.after.length;
  console.log(`任务 ${nq}（${Object.keys(quests).join(' ')}） 场 ${ns} 步 ${nst} 选项 ${nopt} 街坊台词 ${naf}`);
  if (skipped.length) console.log(`还是大纲、未解析：${skipped.join(' ')}`);
  console.log(`出口（场次图必须定义这些）：\n  ${exits.join('\n  ') || '（无）'}`);
  if (notes.length) console.log(`\n按约定推断（各看一眼就好）：\n  ${notes.join('\n  ')}`);
  if (warn.length) console.log(`\n没解析掉（${warn.length} 条）：\n  ${warn.join('\n  ')}`);

  const json = JSON.stringify(data);
  const oi = args.indexOf('--out');
  if (oi >= 0 && args[oi + 1]) { fs.writeFileSync(args[oi + 1], JSON.stringify(data, null, 1)); console.log(`\n写出 ${args[oi + 1]}  ${(json.length / 1024).toFixed(1)}KB`); }
  if (args.includes('--embed')) {
    const f = path.join(ROOT, 'games', 'nightharbor', 'index.html');
    const src = fs.readFileSync(f, 'utf8');
    const re = /(\/\*@script\*\/)[\s\S]*?(\/\*@script\*\/)/;
    if (!re.test(src)) { console.error('index.html 里找不到 /*@script*/ 标记，未写入'); process.exit(1); }
    fs.writeFileSync(f, src.replace(re, `$1${json}$2`));
    console.log(`\n已嵌入 games/nightharbor/index.html  ${(json.length / 1024).toFixed(1)}KB`);
  }
}
if (require.main === module) main();
module.exports = { parse, link };
