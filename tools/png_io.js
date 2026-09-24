// PNG 读写：只为精灵导入用，不追求通用。
// 仓库里已经有 encodePNG（写），但从来没有过【读】—— 外来美术进不来就是卡在这儿。
// 零依赖：Node 自带 zlib 就够。
'use strict';
const zlib = require('zlib');

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('不是 PNG');
  let p = 8, W = 0, H = 0, depth = 0, color = 0, inter = 0;
  const idat = [];
  let plte = null, trns = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      W = data.readUInt32BE(0); H = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; inter = data[12];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`只支持 8 位/通道，这张是 ${depth} 位`);
  if (inter !== 0) throw new Error('不支持隔行扫描（Adam7）—— 导出时关掉 interlace');
  const CH = { 0:1, 2:3, 3:1, 4:2, 6:4 }[color];
  if (!CH) throw new Error('未知颜色类型 ' + color);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = W * CH, out = Buffer.alloc(W * H * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const ft = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    // 反滤波：PNG 每行前面有一个字节说明用了哪种滤波器
    for (let i = 0; i < stride; i++) {
      const a = i >= CH ? line[i - CH] : 0, b = prev[i], c = i >= CH ? prev[i - CH] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (ft !== 0) throw new Error('未知滤波器 ' + ft);
      line[i] = v & 255;
    }
    prev = line;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (color === 6) { out[o] = line[x*4]; out[o+1] = line[x*4+1]; out[o+2] = line[x*4+2]; out[o+3] = line[x*4+3]; }
      else if (color === 2) { out[o] = line[x*3]; out[o+1] = line[x*3+1]; out[o+2] = line[x*3+2]; out[o+3] = 255; }
      else if (color === 0) { const v = line[x]; out[o] = out[o+1] = out[o+2] = v; out[o+3] = 255; }
      else if (color === 4) { const v = line[x*2]; out[o]=out[o+1]=out[o+2]=v; out[o+3] = line[x*2+1]; }
      else if (color === 3) {
        const i = line[x]; out[o] = plte[i*3]; out[o+1] = plte[i*3+1]; out[o+2] = plte[i*3+2];
        out[o+3] = trns && i < trns.length ? trns[i] : 255;
      }
    }
  }
  return { width:W, height:H, data:out };
}
module.exports = { decodePNG };
