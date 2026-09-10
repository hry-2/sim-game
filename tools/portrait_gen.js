#!/usr/bin/env node
// 夜港 · 人物立绘生成器
// ==================================================================
// 对话有脸才是一场戏，没脸就只是剧本。
//
// 和市井的 character_gen.js 同一条路子：在小画布上逐像素画，再整数倍放大。
// 区别是这里画的是【半身像】48×56，放大 3 倍到 144×168，排成一张横向图集，
// 游戏里用 CSS background-position 切出当前说话的人。
//
// 部件：脸型 / 发型 / 眼睛（含义眼）/ 嘴 / 领口 / 赛博件（颈后接口、太阳穴钢板、
// 面罩、疤）。每个人一份配色。名字就是剧本里 **谁**：的那个"谁"。
//
// 用法：
//   node tools/portrait_gen.js            # 出 assets/portraits/nh.png + 预览
//   node tools/portrait_gen.js --embed    # 同时嵌回 games/nightharbor/index.html
'use strict';
const fs = require('fs'), path = require('path');
const { encodePNG } = require('./character_gen.js');
const ROOT = path.resolve(__dirname, '..');
const PW = 48, PH = 56, SCALE = 4;   // 一格 192×224，游戏里 1:1 显示，像素不会被拉歪

const OL = [22, 20, 30];                       // 描边：冷黑
const SKIN = {
  fair: { a: [232, 194, 168], b: [196, 152, 128], c: [156, 112, 96] },
  warm: { a: [214, 168, 132], b: [176, 128, 96], c: [136, 92, 68] },
  tan:  { a: [180, 132, 100], b: [144, 100, 72], c: [108, 70, 50] },
  pale: { a: [222, 206, 200], b: [186, 168, 168], c: [146, 128, 132] },   // 穹顶里晒不到太阳的人
  old:  { a: [206, 178, 156], b: [168, 140, 122], c: [128, 102, 90] },
};
const HAIR = {
  black:  { a: [42, 40, 52], b: [70, 68, 86] },
  ink:    { a: [30, 32, 44], b: [56, 60, 78] },
  brown:  { a: [82, 58, 44], b: [116, 84, 62] },
  grey:   { a: [128, 126, 130], b: [172, 170, 176] },
  white:  { a: [198, 200, 208], b: [230, 232, 238] },
  cyan:   { a: [40, 96, 112], b: [72, 176, 200] },      // 挑染
  magenta:{ a: [110, 40, 78], b: [196, 72, 132] },
  honey:  { a: [150, 112, 62], b: [196, 156, 92] },
};
const CLOTH = {
  suit:   { a: [46, 52, 72], b: [32, 36, 52] },         // 明烛的制服
  suit2:  { a: [58, 62, 78], b: [40, 44, 58] },
  jacket: { a: [86, 60, 48], b: [60, 42, 34] },
  coat:   { a: [64, 70, 66], b: [44, 50, 48] },
  apron:  { a: [186, 172, 142], b: [150, 136, 110] },
  tank:   { a: [72, 78, 92], b: [52, 56, 68] },
  scrubs: { a: [96, 132, 128], b: [68, 100, 98] },
  hood:   { a: [52, 56, 74], b: [36, 40, 54] },
  vest:   { a: [110, 96, 72], b: [80, 70, 52] },
  worn:   { a: [92, 88, 80], b: [66, 64, 58] },
};
const lift = (c, k) => [Math.min(255, c[0] + k), Math.min(255, c[1] + k), Math.min(255, c[2] + k)];
const NEON = { cyan: [69, 240, 255], amber: [255, 185, 90], rose: [255, 90, 150], green: [140, 220, 140], red: [255, 90, 90] };

class Px {
  constructor() { this.d = new Array(PW * PH).fill(null); }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < PW && y < PH && c) this.d[y * PW + x] = c; }
  get(x, y) { return (x >= 0 && y >= 0 && x < PW && y < PH) ? this.d[y * PW + x] : null; }
  rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  // 左右对称地画：只写一半，另一半镜像
  mir(dx, y, c, cx = 24) { this.set(cx + dx, y, c); this.set(cx - 1 - dx, y, c); }
  outline() {
    const src = this.d.slice();
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      if (src[y * PW + x]) continue;
      if ((x > 0 && src[y * PW + x - 1]) || (x < PW - 1 && src[y * PW + x + 1]) ||
          (y > 0 && src[(y - 1) * PW + x]) || (y < PH - 1 && src[(y + 1) * PW + x]))
        this.d[y * PW + x] = OL;
    }
  }
}

// 半身像的骨架：肩在下，头在上。cx=24 是中线（画在 23|24 之间）
function draw(s) {
  const px = new Px();
  const sk = SKIN[s.skin || 'fair'], hr = HAIR[s.hair || 'black'], cl = CLOTH[s.cloth || 'coat'];
  const HY0 = s.old ? 9 : 7, HY1 = HY0 + 21;            // 头 21 行高
  const HW = s.wide ? 10 : 9;                            // 半脸宽
  const SY = HY1 + 4;                                    // 肩线

  // ---- 屏幕人格：先铺一层屏底，人是画在屏幕里的 ----
  if (s.screen) {
    px.rect(1, 1, PW - 2, PH - 1, [14, 24, 32]);
    px.rect(2, 2, PW - 3, 4, [18, 32, 42]);
  }

  // ---- 肩 / 衣 ----
  // 斜方肌：从颈根往外张。别让肩膀一行就撑满，那看起来是块板子。
  const SW = s.broad ? 22 : 19;
  for (let y = SY - 4; y < PH; y++) {
    const t = Math.max(0, Math.min(1, (y - (SY - 4)) / 8));
    const w = Math.round(4 + (SW - 4) * Math.pow(t, 0.55));
    px.rect(24 - w - 1, y, 23 + w + 1, y, cl.b);
    px.rect(24 - w, y, 23 + w, y, cl.a);
    px.rect(24 - w, y, 24 - w + 2, y, lift(cl.a, 16));       // 左肩受光
    px.rect(23 + w - 2, y, 23 + w, y, cl.b);                  // 右肩背光
  }
  // 衣褶：两道竖向的暗线，把平板破开
  px.rect(24 - 13, SY + 4, 24 - 13, PH - 1, cl.b);
  px.rect(23 + 12, SY + 6, 23 + 12, PH - 1, cl.b);

  // ---- 颈（在衣服上面，领口再压在颈上）----
  px.rect(24 - 4, HY1 - 2, 23 + 4, SY + 2, sk.b);
  px.rect(24 - 4, HY1 - 2, 24 - 3, SY + 2, sk.a);             // 颈的受光侧
  px.rect(24 - 4, HY1 - 2, 23 + 4, HY1 - 1, sk.c);            // 下巴投在颈上的影

  // ---- 领口 ----
  const col = s.collar || 'v';
  if (col === 'v') {                                     // 西装 V 领 + 衬衫
    for (let i = 0; i < 8; i++) {
      const y = SY - 1 + i;
      px.rect(24 - i - 2, y, 24 - i, y, cl.b); px.rect(23 + i, y, 23 + i + 2, y, cl.b);
      if (i > 0) px.rect(24 - i, y, 23 + i, y, s.shirt ? CLOTH[s.shirt].a : sk.b);
    }
    if (s.tie) { px.rect(22, SY + 3, 25, SY + 4, NEON[s.tie]); px.rect(23, SY + 5, 24, PH - 1, NEON[s.tie]); }
  } else if (col === 'stand') {                          // 立领：公司味
    px.rect(24 - 8, SY - 3, 23 + 8, SY + 1, cl.b);
    px.rect(24 - 7, SY - 2, 23 + 7, SY, cl.a);
    px.rect(24 - 7, SY - 2, 24 - 5, SY, lift(cl.a, 16));
    px.rect(24 - 4, SY - 3, 23 + 4, SY - 2, sk.b);            // 领口里露出的颈
  } else if (col === 'open') {                           // 敞领：港区
    for (let i = 0; i < 9; i++) {
      const y = SY - 2 + i;
      px.rect(24 - i - 2, y, 24 - i, y, cl.b); px.rect(23 + i, y, 23 + i + 2, y, cl.b);
      if (i > 1 && i < 5) px.rect(24 - i, y, 23 + i, y, sk.b);
      else if (i >= 5) px.rect(24 - i, y, 23 + i, y, s.shirt ? CLOTH[s.shirt].a : cl.a);
    }
  } else if (col === 'apron') {
    px.rect(24 - 11, SY + 1, 23 + 11, PH - 1, CLOTH.apron.a);
    px.rect(24 - 11, SY + 1, 23 + 11, SY + 2, CLOTH.apron.b);
    px.rect(24 - 11, SY + 1, 24 - 9, PH - 1, lift(CLOTH.apron.a, 14));
    px.rect(24 - 5, SY + 1, 24 - 5, SY + 6, CLOTH.apron.b);   // 系带
    px.rect(23 + 5, SY + 1, 23 + 5, SY + 6, CLOTH.apron.b);
    px.rect(24 - 4, SY - 2, 23 + 4, SY, sk.b);
  } else if (col === 'hood') {                           // 连帽：兜帽压在肩上
    px.rect(24 - 15, SY - 5, 23 + 15, SY + 3, cl.b);
    px.rect(24 - 13, SY - 4, 23 + 13, SY + 2, cl.a);
    px.rect(24 - 13, SY - 4, 24 - 11, SY + 2, lift(cl.a, 14));
    for (let i = 0; i < 8; i++) {
      const y = SY - 3 + i;
      px.rect(24 - i - 2, y, 24 - i, y, cl.b); px.rect(23 + i, y, 23 + i + 2, y, cl.b);
      if (i > 1) px.rect(24 - i, y, 23 + i, y, sk.c);
    }
  }

  // ---- 脸 ----
  px.rect(24 - HW + 2, HY0, 23 + HW - 2, HY0, sk.a);
  px.rect(24 - HW + 1, HY0 + 1, 23 + HW - 1, HY0 + 1, sk.a);
  px.rect(24 - HW, HY0 + 2, 23 + HW, HY1 - 4, sk.a);
  px.rect(24 - HW + 1, HY1 - 3, 23 + HW - 1, HY1 - 3, sk.a);
  px.rect(24 - HW + 2, HY1 - 2, 23 + HW - 2, HY1 - 2, sk.a);
  px.rect(24 - HW + 4, HY1 - 1, 23 + HW - 4, HY1 - 1, sk.a);
  // 受光：左亮右暗
  px.rect(23 + HW - 2, HY0 + 3, 23 + HW, HY1 - 3, sk.b);
  px.rect(24 - HW, HY0 + 2, 24 - HW + 1, HY1 - 4, [Math.min(255, sk.a[0] + 12), Math.min(255, sk.a[1] + 10), Math.min(255, sk.a[2] + 8)]);
  if (s.old) {                                           // 法令纹和眼袋，年纪就出来了
    px.mir(5, HY0 + 15, sk.c); px.mir(6, HY0 + 16, sk.c);
    px.mir(3, HY0 + 12, sk.b); px.mir(4, HY0 + 12, sk.b);
  }
  if (s.gaunt) { px.mir(HW - 1, HY0 + 11, sk.c); px.mir(HW - 1, HY0 + 12, sk.c); }
  // 耳
  px.set(24 - HW - 1, HY0 + 10, sk.b); px.set(24 - HW - 1, HY0 + 11, sk.b);
  px.set(23 + HW + 1, HY0 + 10, sk.b); px.set(23 + HW + 1, HY0 + 11, sk.b);

  // ---- 眼 ----
  const EY = HY0 + 9;
  const eye = (dx, cyberSide) => {
    const x0 = 24 + dx, x1 = x0 + 3;
    if (s.eyes === 'shut') { px.rect(x0, EY + 1, x1, EY + 1, OL); return; }
    if (s.eyes === 'squint') { px.rect(x0, EY + 1, x1, EY + 1, OL); px.rect(x0, EY + 2, x1, EY + 2, sk.c); return; }
    px.rect(x0, EY, x1, EY, OL);                         // 上眼睑
    px.rect(x0, EY + 1, x1, EY + 2, [246, 244, 250]);    // 眼白
    const ir = cyberSide ? NEON[s.cyber] : (s.iris || [64, 52, 46]);
    px.rect(x0 + 1, EY + 1, x0 + 2, EY + 2, ir);
    px.set(x0 + 1, EY + 1, cyberSide ? [255, 255, 255] : [Math.min(255, ir[0] + 60), Math.min(255, ir[1] + 60), Math.min(255, ir[2] + 60)]);
    if (cyberSide) {                                     // 义眼：外圈金属 + 一点光溢出
      px.rect(x0 - 1, EY - 1, x1 + 1, EY - 1, [96, 102, 118]);
      px.rect(x0 - 1, EY + 3, x1 + 1, EY + 3, [96, 102, 118]);
      px.set(x0 - 1, EY + 1, [130, 138, 156]); px.set(x1 + 1, EY + 1, [130, 138, 156]);
    }
  };
  const cyb = s.cyber ? (s.cyberBoth ? 'both' : 'right') : null;
  eye(-7, cyb === 'both');                               // 画面左（人物的右眼）
  eye(3, !!cyb);
  // 眉
  if (s.brow !== false) {
    const bc = s.browGrey ? HAIR.grey.a : hr.a, BY = EY - 3 + (s.browHigh ? -1 : 0);
    for (let i = 0; i < 5; i++) {
      px.set(24 - 8 + i, BY + (s.browAngry ? (i < 2 ? 1 : 0) : (i > 3 ? 1 : 0)), bc);
      px.set(23 + 8 - i, BY + (s.browAngry ? (i < 2 ? 1 : 0) : (i > 3 ? 1 : 0)), bc);
    }
    if (s.browThick) { for (let i = 0; i < 5; i++) { px.set(24 - 8 + i, BY + 1, bc); px.set(23 + 8 - i, BY + 1, bc); } }
  }
  // 鼻 / 嘴
  px.set(24, EY + 5, sk.b); px.set(23, EY + 5, sk.b); px.set(24, EY + 6, sk.c);
  const MY = EY + 9;
  const lip = s.lip ? NEON[s.lip] : [150, 92, 84];
  if (s.mouth === 'smile') { px.rect(22, MY, 25, MY, lip); px.set(21, MY - 1, lip); px.set(26, MY - 1, lip); }
  else if (s.mouth === 'grin') { px.rect(21, MY, 26, MY, OL); px.rect(22, MY + 1, 25, MY + 1, lip); px.set(20, MY - 1, OL); px.set(27, MY - 1, OL); }
  else if (s.mouth === 'frown') { px.rect(22, MY, 25, MY, lip); px.set(21, MY + 1, lip); px.set(26, MY + 1, lip); }
  else if (s.mouth === 'thin') { px.rect(21, MY, 26, MY, sk.c); }
  else { px.rect(22, MY, 25, MY, lip); }                 // flat
  if (s.scar) { for (let i = 0; i < 6; i++) px.set(23 + HW - 3 + (i % 2), HY0 + 5 + i, [188, 132, 128]); }
  if (s.plate) {                                         // 太阳穴钢板
    px.rect(23 + HW - 3, HY0 + 4, 23 + HW, HY0 + 8, [88, 94, 110]);
    px.rect(23 + HW - 2, HY0 + 5, 23 + HW - 1, HY0 + 7, [122, 130, 148]);
    px.set(23 + HW - 2, HY0 + 6, NEON[s.cyber || 'cyan']);
  }

  // ---- 头发 ----
  hair(px, s, hr, HY0, HY1, HW);

  // ---- 面罩 / 眼镜 ----
  if (s.visor) {
    px.rect(24 - HW - 1, EY, 23 + HW + 1, EY + 2, [26, 30, 42]);
    px.rect(24 - HW, EY + 1, 23 + HW, EY + 1, NEON[s.visor]);
    px.rect(24 - HW + 1, EY + 1, 24 - HW + 3, EY + 1, [255, 255, 255]);
    px.set(23 + HW + 1, EY + 1, [60, 66, 82]);
  }
  if (s.glasses) {
    px.rect(24 - 9, EY - 1, 24 - 4, EY - 1, [70, 74, 88]); px.rect(24 - 9, EY + 3, 24 - 4, EY + 3, [70, 74, 88]);
    px.rect(23 + 4, EY - 1, 23 + 9, EY - 1, [70, 74, 88]); px.rect(23 + 4, EY + 3, 23 + 9, EY + 3, [70, 74, 88]);
    px.set(24 - 10, EY + 1, [70, 74, 88]); px.set(23 + 10, EY + 1, [70, 74, 88]);
    px.rect(24 - 3, EY, 23 + 3, EY, [70, 74, 88]);
  }
  // 屏幕人格：不是人，是一块屏。整张脸压一层扫描线和一圈边框
  if (s.screen) {
    for (let y = 2; y < PH; y += 2) for (let x = 2; x < PW - 2; x++) {
      const c = px.get(x, y); if (c) px.set(x, y, [Math.round(c[0] * .82 + 22), Math.round(c[1] * .86 + 34), Math.round(c[2] * .88 + 40)]);
    }
    px.rect(1, 1, PW - 2, 1, [60, 130, 150]); px.rect(1, PH - 1, PW - 2, PH - 1, [60, 130, 150]);
    px.rect(1, 1, 1, PH - 1, [60, 130, 150]); px.rect(PW - 2, 1, PW - 2, PH - 1, [60, 130, 150]);
    px.set(PW - 4, 3, [120, 240, 200]);                        // 录制指示灯
  }
  px.outline();
  return px;
}
// 把已有像素往某个颜色拉一点（做扫描线用）
function mix(px, x, y, c, k) {
  const o = px.get(x, y); if (!o) return null;
  return [Math.round(o[0] + (c[0] - o[0]) * k), Math.round(o[1] + (c[1] - o[1]) * k), Math.round(o[2] + (c[2] - o[2]) * k)];
}

function hair(px, s, hr, HY0, HY1, HW) {
  const st = s.hairStyle || 'short';
  if (st === 'bald') {
    px.rect(24 - HW + 3, HY0 - 1, 23 + HW - 3, HY0 - 1, [Math.min(255, SKIN[s.skin || 'fair'].a[0] + 14), Math.min(255, SKIN[s.skin || 'fair'].a[1] + 12), Math.min(255, SKIN[s.skin || 'fair'].a[2] + 10)]);
    px.rect(24 - HW - 1, HY0 + 6, 24 - HW, HY0 + 11, hr.a);
    px.rect(23 + HW, HY0 + 6, 23 + HW + 1, HY0 + 11, hr.a);
    return;
  }
  // 共用发盖
  px.rect(24 - HW + 2, HY0 - 3, 23 + HW - 2, HY0 - 3, hr.a);
  px.rect(24 - HW, HY0 - 2, 23 + HW, HY0 - 1, hr.a);
  px.rect(24 - HW - 1, HY0, 23 + HW + 1, HY0 + 3, hr.a);
  px.rect(24 - HW + 1, HY0 - 2, 24 - HW + 4, HY0 - 1, hr.b);      // 左上高光
  px.set(24 - HW, HY0, hr.b); px.set(24 - HW, HY0 + 1, hr.b);

  if (st === 'short') {
    px.rect(24 - HW - 1, HY0 + 4, 24 - HW - 1, HY0 + 8, hr.a);
    px.rect(23 + HW + 1, HY0 + 4, 23 + HW + 1, HY0 + 8, hr.a);
    px.rect(24 - HW, HY0 + 4, 24 - HW + 3, HY0 + 4, hr.a);        // 刘海压一点额头
    px.rect(23 + HW - 3, HY0 + 4, 23 + HW, HY0 + 4, hr.a);
  } else if (st === 'buzz') {
    px.rect(24 - HW, HY0 + 4, 23 + HW, HY0 + 4, hr.a);
    px.rect(24 - HW - 1, HY0 + 4, 24 - HW - 1, HY0 + 7, hr.a);
    px.rect(23 + HW + 1, HY0 + 4, 23 + HW + 1, HY0 + 7, hr.a);
  } else if (st === 'undercut') {                                  // 一侧剃短，另一侧压下来
    px.rect(24 - HW - 1, HY0 + 4, 24 - HW + 5, HY0 + 5, hr.a);
    px.rect(24 - HW - 1, HY0 + 6, 24 - HW, HY0 + 9, hr.a);
    px.rect(23 + HW - 1, HY0 + 4, 23 + HW + 1, HY0 + 6, hr.b);
    if (s.streak) { px.rect(24 - HW + 1, HY0 - 2, 24 - HW + 2, HY0 + 5, NEON[s.streak]); }
  } else if (st === 'bun') {
    px.rect(22, HY0 - 7, 26, HY0 - 6, hr.a); px.rect(21, HY0 - 6, 27, HY0 - 4, hr.a);
    px.set(22, HY0 - 6, hr.b); px.set(23, HY0 - 6, hr.b);
    px.rect(24 - HW - 1, HY0 + 4, 24 - HW - 1, HY0 + 6, hr.a);
    px.rect(23 + HW + 1, HY0 + 4, 23 + HW + 1, HY0 + 6, hr.a);
    if (s.pin) { px.rect(26, HY0 - 7, 30, HY0 - 7, NEON[s.pin]); }
  } else if (st === 'long') {
    px.rect(24 - HW - 2, HY0 + 2, 24 - HW - 1, HY1 + 6, hr.a);
    px.rect(23 + HW + 1, HY0 + 2, 23 + HW + 2, HY1 + 6, hr.a);
    px.rect(23 + HW + 1, HY0 + 2, 23 + HW + 1, HY1 + 2, hr.b);
    px.rect(24 - HW, HY0 + 4, 24 - HW + 4, HY0 + 4, hr.a);
    px.rect(23 + HW - 4, HY0 + 4, 23 + HW, HY0 + 5, hr.a);
    if (s.streak) px.rect(24 - HW - 2, HY0 + 8, 24 - HW - 1, HY1 + 4, NEON[s.streak]);
  } else if (st === 'tail') {                                      // 马尾：脑后一束垂到肩
    px.rect(23 + HW + 1, HY0 + 2, 23 + HW + 3, HY0 + 4, hr.a);
    px.rect(23 + HW + 2, HY0 + 5, 23 + HW + 4, HY1 + 3, hr.a);
    px.rect(24 - HW - 1, HY0 + 4, 24 - HW - 1, HY0 + 6, hr.a);
    px.rect(24 - HW, HY0 + 4, 24 - HW + 3, HY0 + 4, hr.a);
  } else if (st === 'spiky') {
    for (const dx of [-8, -5, -1, 3, 6]) { px.set(24 + dx, HY0 - 5, hr.a); px.set(24 + dx, HY0 - 4, hr.a); px.set(24 + dx + 1, HY0 - 4, hr.a); }
    px.rect(24 - HW - 1, HY0 + 4, 24 - HW - 1, HY0 + 7, hr.a);
    px.rect(23 + HW + 1, HY0 + 4, 23 + HW + 1, HY0 + 7, hr.a);
    px.rect(24 - HW, HY0 + 4, 24 - HW + 2, HY0 + 4, hr.a);
  } else if (st === 'wisps') {                                     // 老人稀发
    px.rect(24 - HW - 1, HY0 + 3, 24 - HW, HY0 + 9, hr.a);
    px.rect(23 + HW, HY0 + 3, 23 + HW + 1, HY0 + 9, hr.a);
    px.rect(24 - HW + 3, HY0 - 2, 23 + HW - 3, HY0 - 2, hr.b);
  }
  if (s.beard) {
    const bc = HAIR[s.beard].a;
    px.rect(24 - HW + 2, HY1 - 6, 23 + HW - 2, HY1 - 6, bc);
    px.rect(24 - HW + 3, HY1 - 4, 23 + HW - 3, HY1 - 3, bc);
    px.rect(22, HY1 - 1, 25, HY1 + 2, bc);
    px.rect(24 - HW + 2, HY0 + 13, 24 - HW + 2, HY1 - 6, bc);
    px.rect(23 + HW - 2, HY0 + 13, 23 + HW - 2, HY1 - 6, bc);
    px.rect(21, HY0 + 16, 26, HY0 + 16, bc);                       // 髭
  }
}

/* ================= 阵容：名字就是剧本里的「谁」 ================= */
const CAST = {
  // —— 玩家（两个性别，台词一字不改，只有立绘不同）——
  '陈九男': { skin: 'warm', hair: 'ink', hairStyle: 'buzz', cloth: 'jacket', collar: 'open',
    cyber: 'cyan', plate: 1, port: 'cyan', mouth: 'thin', brow: true, browThick: 1,
    iris: [60, 50, 44], shirt: 'tank', broad: 1 },
  '陈九女': { skin: 'warm', hair: 'ink', hairStyle: 'long', cloth: 'jacket', collar: 'open',
    cyber: 'cyan', plate: 1, port: 'cyan', mouth: 'thin', brow: true, iris: [60, 50, 44],
    streak: 'cyan', shirt: 'tank' },
  // —— 公司 ——
  '晨曦': { skin: 'pale', hair: 'cyan', hairStyle: 'bun', cloth: 'suit', collar: 'stand',
    screen: 1, eyes: 'open', mouth: 'smile', lip: 'cyan', iris: [90, 200, 220], brow: true },
  '许维安': { skin: 'pale', hair: 'grey', hairStyle: 'short', cloth: 'suit', collar: 'v', shirt: 'suit2',
    tie: 'amber', old: 1, gaunt: 1, mouth: 'thin', browGrey: 1, glasses: 1, port: 'amber' },
  '林可': { skin: 'pale', hair: 'black', hairStyle: 'long', cloth: 'suit2', collar: 'stand',
    mouth: 'flat', brow: true, iris: [48, 60, 88], streak: 'cyan' },
  '保安': { skin: 'fair', hair: 'brown', hairStyle: 'buzz', cloth: 'suit', collar: 'stand',
    mouth: 'frown', brow: true, visor: 'cyan' },
  // —— 港区 ——
  '桂姐': { skin: 'warm', hair: 'grey', hairStyle: 'bun', cloth: 'worn', collar: 'apron',
    old: 1, mouth: 'flat', browGrey: 1, wide: 1 },
  '豆包': { skin: 'tan', hair: 'brown', hairStyle: 'spiky', cloth: 'vest', collar: 'open', shirt: 'worn',
    mouth: 'grin', brow: true, browHigh: 1 },
  '阿鲈': { skin: 'warm', hair: 'black', hairStyle: 'undercut', cloth: 'tank', collar: 'open', shirt: 'tank',
    mouth: 'flat', brow: true, streak: 'rose', port: 'rose', broad: 1 },
  '六指': { skin: 'tan', hair: 'black', hairStyle: 'buzz', cloth: 'coat', collar: 'stand',
    mouth: 'thin', brow: true, browThick: 1, browAngry: 1, scar: 1, broad: 1, wide: 1, beard: 'ink' },
  '白岚': { skin: 'pale', hair: 'white', hairStyle: 'bun', cloth: 'scrubs', collar: 'stand',
    mouth: 'thin', brow: true, iris: [70, 100, 100], glasses: 1 },
  '老韩': { skin: 'old', hair: 'grey', hairStyle: 'bald', cloth: 'vest', collar: 'v', shirt: 'worn',
    old: 1, mouth: 'thin', browGrey: 1, wide: 1, eyes: 'squint' },
  '陆妈妈': { skin: 'old', hair: 'grey', hairStyle: 'bun', cloth: 'worn', collar: 'stand',
    old: 1, mouth: 'frown', browGrey: 1, eyes: 'squint' },
  '小陆': { skin: 'tan', hair: 'black', hairStyle: 'spiky', cloth: 'jacket', collar: 'open', shirt: 'tank',
    mouth: 'flat', brow: true, browHigh: 1, port: 'green' },
  '大勇': { skin: 'tan', hair: 'brown', hairStyle: 'buzz', cloth: 'vest', collar: 'open', shirt: 'worn',
    mouth: 'thin', brow: true, browThick: 1, broad: 1, wide: 1, scar: 1 },
  // —— 网客 ——
  '老鲸': { skin: 'old', hair: 'white', hairStyle: 'wisps', cloth: 'coat', collar: 'open',
    old: 1, gaunt: 1, cyber: 'amber', mouth: 'thin', browGrey: 1, beard: 'white', port: 'amber' },
  '青蛉': { skin: 'pale', hair: 'magenta', hairStyle: 'undercut', cloth: 'hood', collar: 'hood',
    cyber: 'rose', cyberBoth: 1, mouth: 'flat', brow: true, port: 'rose', gaunt: 1 },
  // —— 杂鱼 ——
  '巡查甲': { skin: 'tan', hair: 'black', hairStyle: 'buzz', cloth: 'coat', collar: 'stand',
    mouth: 'frown', brow: true, browAngry: 1, visor: 'amber', broad: 1 },
  '巡查乙': { skin: 'fair', hair: 'brown', hairStyle: 'buzz', cloth: 'coat', collar: 'stand',
    mouth: 'thin', brow: true, visor: 'amber' },
};

function build() {
  const names = Object.keys(CAST);
  const W = PW * SCALE * names.length, H = PH * SCALE;
  const buf = Buffer.alloc(W * H * 4);
  names.forEach((n, i) => {
    const px = draw(CAST[n]);
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const c = px.get(x, y); if (!c) continue;
      for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
        const X = i * PW * SCALE + x * SCALE + dx, Y = y * SCALE + dy, k = (Y * W + X) * 4;
        buf[k] = c[0]; buf[k + 1] = c[1]; buf[k + 2] = c[2]; buf[k + 3] = 255;
      }
    }
  });
  return { png: encodePNG(W, H, buf), names, W, H };
}
// 预览：深底铺开，肉眼审
function preview() {
  const names = Object.keys(CAST), S = 4, cols = 7;
  const rows = Math.ceil(names.length / cols);
  const W = (PW * S + 6) * cols + 6, H = (PH * S + 6) * rows + 6;
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = 18; buf[i * 4 + 1] = 20; buf[i * 4 + 2] = 28; buf[i * 4 + 3] = 255; }
  names.forEach((n, i) => {
    const px = draw(CAST[n]);
    const ox = 6 + (i % cols) * (PW * S + 6), oy = 6 + Math.floor(i / cols) * (PH * S + 6);
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const c = px.get(x, y); if (!c) continue;
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
        const X = ox + x * S + dx, Y = oy + y * S + dy, k = (Y * W + X) * 4;
        buf[k] = c[0]; buf[k + 1] = c[1]; buf[k + 2] = c[2]; buf[k + 3] = 255;
      }
    }
  });
  return encodePNG(W, H, buf);
}

function main() {
  const args = process.argv.slice(2);
  const out = path.join(ROOT, 'assets', 'portraits');
  fs.mkdirSync(out, { recursive: true });
  const { png, names, W, H } = build();
  fs.writeFileSync(path.join(out, 'nh.png'), png);
  fs.writeFileSync(path.join(out, 'nh_preview.png'), preview());
  console.log(`assets/portraits/nh.png  ${W}x${H}  ${names.length} 人 · 每格 ${PW * SCALE}x${PH * SCALE}  ${(png.length / 1024).toFixed(1)}KB`);
  console.log(names.join(' '));
  if (args.includes('--embed')) {
    const f = path.join(ROOT, 'games', 'nightharbor', 'index.html');
    let src = fs.readFileSync(f, 'utf8');
    const reP = /(\/\*@port\*\/)[\s\S]*?(\/\*@port\*\/)/;
    const reN = /(\/\*@portnames\*\/)[\s\S]*?(\/\*@portnames\*\/)/;
    if (!reP.test(src) || !reN.test(src)) { console.error('index.html 里找不到 /*@port*/ 或 /*@portnames*/ 标记，未写入'); process.exit(1); }
    src = src.replace(reP, `$1'data:image/png;base64,${png.toString('base64')}'$2`);
    src = src.replace(reN, `$1${JSON.stringify(names)}$2`);
    fs.writeFileSync(f, src);
    console.log(`已嵌入 games/nightharbor/index.html`);
  }
}
if (require.main === module) main();
module.exports = { draw, CAST, PW, PH, SCALE };
