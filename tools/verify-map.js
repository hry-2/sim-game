// 地图体检。这个项目每次动地图都出同一类事故，而且逻辑测试一条都看不出来：
//   · T18/T26 三次「物件画成床」—— drawObj 找不到画法就悄悄退回 FURN.bed
//   · T25 整段替换吞掉了 DECOSOLID 和小地图
//   · T27 井压在茶棚的座位上、采集丛落进梨娘家院子
//   · T28 塘差点压住上排那户唯一的院门 —— 那户人会被永久封死在自家院里
// 所以这里不测玩法，只测「这张图还站得住人吗」。加物件、挪东西之后先跑这个。
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'games', 'sim', 'index.html'));
  await page.waitForTimeout(1400);

  const r = await page.evaluate(() => {
    running = false;

    // ---- ① 每个物件都得有专属画法，不能掉进 FURN.bed 兜底 ----
    const noArt = OBJ.filter(o => !FURN[artOf(o)]).map(o => o.id);

    // ---- ② 座位：不能出界、不能被挡 ----
    const badSeat = [];
    for (const o of OBJ) for (const [x, y] of (o.use || [])) {
      if (x < 0 || y < 0 || x >= GW || y >= GH) badSeat.push(`${o.id}@${x},${y}(出界)`);
      else if (solid[y][x]) badSeat.push(`${o.id}@${x},${y}(被挡)`);
    }

    // ---- ③ 物件不能互相压格 ----
    const occ = {}, overlap = [];
    for (const o of OBJ) for (let dx = 0; dx < o.w; dx++) for (let dy = 0; dy < o.h; dy++) {
      const k = (o.x + dx) + ',' + (o.y + dy);
      if (occ[k]) overlap.push(`${occ[k]}×${o.id}@${k}`); else occ[k] = o.id;
    }

    // ---- ④ 连通性：从每个人的床出发，必须走得到每一个座位 ----
    // 只要有一处不通，那个 NPC 就会站在原地反复重选目标 —— 表现是"发呆"，
    // 而不是报错，所以非测不可。
    const seats = [];
    for (const o of OBJ) for (const s of (o.use || [])) seats.push({ id: o.id, x: s[0], y: s[1] });
    const flood = (sx, sy) => {
      const seen = new Set([sy * GW + sx]), q = [[sx, sy]];
      while (q.length) {
        const [x, y] = q.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          const k = ny * GW + nx;
          if (seen.has(k) || solid[ny][nx]) continue;
          seen.add(k); q.push([nx, ny]);
        }
      }
      return seen;
    };
    const unreachable = [];
    for (const s of sims) {
      const bed = OBJ.find(o => o.id === 'bed' + (sims.indexOf(s) + 1)) ||
                  OBJ.find(o => o.owner === s.name && o.use);
      const from = bed ? bed.use[0] : [s.gx, s.gy];
      const seen = flood(from[0], from[1]);
      for (const t of seats) if (!seen.has(t.y * GW + t.x))
        unreachable.push(`${s.name}→${t.id}@${t.x},${t.y}`);
    }

    // ---- ⑤ 每户都出得了自家院子（篱笆三面到底，只有一个院门）----
    const townSeat = OBJ.find(o => o.id === 'shrine').use[0];
    const town = flood(townSeat[0], townSeat[1]);
    const penned = sims.filter(s => {
      const home = OBJ.find(o => o.owner === s.name && o.use);
      return home && !town.has(home.use[0][1] * GW + home.use[0][0]);
    }).map(s => s.name);

    // ---- ⑥ 水面不能压住任何座位或院门 ----
    const inPond = (x, y) => x >= POND.x0 && x <= POND.x1 && y >= POND.y0 && y <= POND.y1;
    const drowned = seats.filter(s => inPond(s.x, s.y)).map(s => s.id);

    // ---- ⑦ 私产必须有主，公共物件必须无主（错一个就会出现"我家的公井"）----
    const ownWrong = OBJ.filter(o =>
      (o.owner && !sims.some(s => s.name === o.owner)) ||
      (o.zone === 'commons' && o.owner)).map(o => o.id);

    // ---- ⑧ 站在座位上必须【总有】提示：能用是能用，不能用要说为什么 ----
    // 以前 nearby() 第一行就是"条件不满足就 continue"，于是集市/木作坊
    // 在没材料时整个从世界里消失 —— 玩家看到的是"这些设施没做交互"。
    const silent = [];
    const savedAct = PC.act, sx = PC.px, sy = PC.py;
    for (const o of OBJ) {
      const u = (o.use || [])[0];
      if (!u) continue;                       // 水渠这类没有座位，不是拿来"用"的
      PC.act = null; PC.px = (u[0] + .5) * T; PC.py = (u[1] + .5) * T;
      const nb = nearby();
      if (!nb || nb.o !== o) silent.push(o.id);
    }
    // ---- ⑨ 玩家点不动别人家的东西（以前只有 NPC 受这道闸门约束）----
    const priv = OBJ.find(o => o.owner && o.owner !== PC.name);
    const pu = priv.use[0];
    PC.act = null; PC.px = (pu[0] + .5) * T; PC.py = (pu[1] + .5) * T;
    const pn = nearby();
    const privGate = !!pn && pn.o === priv && !pn.ok && /家的/.test(pn.why);
    PC.act = savedAct; PC.px = sx; PC.py = sy;

    // ---- ⑪ 掉进实心格必须能自己出来 ----
    // 贴墙滑动的分轴判定有个没写出来的前提：人当前那一格必须是通的。
    // 落进实心格 → 两个轴同时判假 → 四面全堵，永久卡死且不报错。
    // 这张图上「进去就出不来」的格子有三百多个，所以修的不是入口而是出口。
    const stuck = [];
    for (const [x, y] of [[27, 16], [28, 17], [3, 1], [26, 14], [POND.x0, POND.y0]]) {
      PC.act = null; PC.px = (x + .5) * T; PC.py = (y + .5) * T; PC.gx = x; PC.gy = y;
      unstick(PC);
      const gx = (PC.px / T) | 0, gy = (PC.py / T) | 0;
      if (solid[gy][gx]) stuck.push(`${x},${y}`);
    }
    // ---- ⑫ 被挡住的座位不能报成「可用」（瞬移过去就是往实心格里跳）----
    const tb = OBJ.find(o => o.id === 'table'), ts = tb.use[0];
    solid[ts[1]][ts[0]] = 1;
    PC.act = null; PC.px = (ts[0] - .5) * T; PC.py = (ts[1] + .5) * T;
    const bn = nearby();
    const seatGate = !!bn && bn.o === tb && !bn.ok;
    solid[ts[1]][ts[0]] = 0;

    // ---- ⑩ 带 pre 的物件都得写 why，否则只会得到一句"现在还用不了" ----
    const noWhy = OBJ.filter(o => o.pre && !o.why &&
      !Object.getOwnPropertyDescriptor(o, 'why')).map(o => o.id);

    return { noArt, badSeat, overlap, unreachable, penned, drowned, ownWrong,
             silent, privGate, noWhy, stuck, seatGate,
             nObj: OBJ.length, nSeat: seats.length,
             pond: `${POND.x0}-${POND.x1},${POND.y0}-${POND.y1}` };
  });

  const P = [
    ['① 每个物件都有专属画法（不会画成床）', r.noArt.length === 0],
    ['② 座位都站得住人', r.badSeat.length === 0],
    ['③ 物件互不压格', r.overlap.length === 0],
    ['④ 每个座位人人走得到', r.unreachable.length === 0],
    ['⑤ 没有人被封死在自家院里', r.penned.length === 0],
    ['⑥ 水面没压住座位', r.drowned.length === 0],
    ['⑦ 私产有主 / 公物无主', r.ownWrong.length === 0],
    ['⑧ 没有物件会静默消失（用不了也要出提示）', r.silent.length === 0],
    ['⑨ 玩家也点不动别人家的东西', r.privGate],
    ['⑩ 带条件的物件都写了「为什么」', r.noWhy.length === 0],
    ['⑪ 掉进实心格能自己挪出来', r.stuck.length === 0],
    ['⑫ 被挡住的座位不报成可用', r.seatGate],
  ];
  const ok = errs.length === 0 && P.every(p => p[1]);
  console.log(ok ? 'PASS  地图体检' : 'FAIL  地图体检');
  for (const [t, v] of P) console.log(`  ${v ? '✓' : '✗'} ${t}`);
  console.log(`  ${r.nObj} 个物件 / ${r.nSeat} 个座位　塘 ${r.pond}`);
  for (const [k, v] of Object.entries(r))
    if (Array.isArray(v) && v.length) console.log(`  ${k}: ${v.slice(0, 8).join(' ')}${v.length > 8 ? ' …共' + v.length : ''}`);
  if (errs.length) console.log('  报错:', errs.join(' | '));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
