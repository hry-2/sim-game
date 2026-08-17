#!/usr/bin/env python3
"""
饥荒风格像素角色生成器
------------------------------------------------------------------
思路：在 10 倍超采样画布上用矢量图元作画 → 降采样 → 吸附到固定调色板。
好处是形状精准、边缘干净、风格天然统一，改一个坐标就能重画。

用法:
    python3 tools/character_gen.py            # 生成全部精灵到 assets/sprites/
    python3 tools/character_gen.py --size 64  # 指定输出宽度(高度按比例)
"""
import argparse, os
from PIL import Image, ImageDraw
import numpy as np

S = 10                 # 超采样倍数
W, H = 64, 92          # 逻辑坐标空间（所有绘制坐标都在这个尺度里）

BASE_PAL = {
    'ol':(26,22,20),   'sk':(222,183,142), 'sk2':(190,148,110), 'sk3':(150,112,82),
    'hr':(36,30,28),   'hr2':(63,52,47),   'sh':(220,208,181),  'sh2':(178,165,140),
    'vs':(96,66,50),   'vs2':(64,44,35),   'bt':(158,50,46),    'bt2':(112,33,33),
    'tr':(78,65,52),   'tr2':(54,45,36),   'so':(38,31,27),     'ew':(240,234,218),
}

# 换一套配色就是一个新角色 —— 几何数据完全共用
CAST = {
 'wilson':  {'hr':(36,30,28), 'hr2':(63,52,47),  'sk':(222,183,142),'sk2':(190,148,110),
             'vs':(96,66,50), 'vs2':(64,44,35),  'sh':(220,208,181),'sh2':(178,165,140),'bt':(158,50,46)},
 'willow':  {'hr':(150,80,40),'hr2':(190,112,58),'sk':(232,196,160),'sk2':(200,160,124),
             'vs':(72,84,64), 'vs2':(48,58,44),  'sh':(196,72,64),  'sh2':(150,50,48), 'bt':(212,180,90)},
 'wendy':   {'hr':(58,52,68), 'hr2':(86,78,98),  'sk':(214,196,186),'sk2':(180,160,152),
             'vs':(64,70,96), 'vs2':(42,48,68),  'sh':(176,182,200),'sh2':(138,144,164),'bt':(120,66,110)},
 'wolfgang':{'hr':(196,158,72),'hr2':(224,190,104),'sk':(226,178,132),'sk2':(192,144,100),
             'vs':(120,70,44),'vs2':(84,48,30),  'sh':(206,196,176),'sh2':(164,154,136),'bt':(70,96,60)},
}

# 4 帧行走: (左腿dx, 左腿dy, 右腿dx, 右腿dy, 手臂摆幅, 躯干起伏)
WALK = [(0,0,0,0,0,0), (-2,-2,2,0,1,-1), (0,0,0,0,0,0), (2,0,-2,-2,-1,-1)]


def draw(pal, ldx=0, ldy=0, rdx=0, rdy=0, adx=0, bob=0):
    """在超采样画布上绘制一帧，返回 RGBA Image。"""
    C = lambda k: pal[k]
    img = Image.new('RGBA', (W*S, H*S), (0,0,0,0))
    d = ImageDraw.Draw(img)
    E = lambda box, k: d.ellipse([v*S for v in box], fill=C(k))
    P = lambda p, k:  d.polygon([(x*S, y*S) for x, y in p], fill=C(k))
    L = lambda p, k, w: d.line([(x*S, y*S) for x, y in p], fill=C(k), width=int(w*S), joint='curve')
    B = bob

    # 腿
    P([(25+ldx,64+B),(30+ldx,64+B),(30+ldx,85+ldy),(25+ldx,85+ldy)], 'tr')
    P([(34+rdx,64+B),(39+rdx,64+B),(39+rdx,85+rdy),(34+rdx,85+rdy)], 'tr2')
    P([(21+ldx,84+ldy),(30+ldx,84+ldy),(30+ldx,89+ldy),(21+ldx,89+ldy)], 'so')
    E((20+ldx,84+ldy,26+ldx,90+ldy), 'so')
    P([(34+rdx,84+rdy),(43+rdx,84+rdy),(43+rdx,89+rdy),(34+rdx,89+rdy)], 'so')
    E((38+rdx,84+rdy,44+rdx,90+rdy), 'so')
    # 手臂（与腿反相摆动）
    L([(26,49+B),(20-adx,58+B),(19-adx,69+B)], 'sh', 3)
    L([(38,49+B),(44+adx,58+B),(45+adx,69+B)], 'sh2', 3)
    E((16-adx,67+B,23-adx,74+B), 'sk'); E((41+adx,67+B,48+adx,74+B), 'sk2')
    # 躯干
    P([(25,46+B),(39,46+B),(42,66+B),(22,66+B)], 'sh')
    P([(32,46+B),(39,46+B),(42,66+B),(32,66+B)], 'sh2')
    P([(25,46+B),(30,46+B),(29,66+B),(22,66+B)], 'vs')
    P([(34,46+B),(39,46+B),(42,66+B),(35,66+B)], 'vs')
    P([(37,47+B),(39,46+B),(42,66+B),(38,66+B)], 'vs2')
    P([(29,46+B),(32,52+B),(35,46+B)], 'sh')
    P([(28,47+B),(32,50+B),(28,54+B)], 'bt'); P([(36,47+B),(32,50+B),(36,54+B)], 'bt2')
    E((30,48+B,34,52+B), 'bt')
    P([(29,38+B),(35,38+B),(35,47+B),(29,47+B)], 'sk2')          # 脖子
    # 头：颅骨椭圆 + 收窄下颌（饥荒的尖下巴）
    E((19,7+B,45,34+B), 'sk')
    P([(20,22+B),(44,22+B),(42,33+B),(37,40+B),(32,44+B),(27,40+B),(22,33+B)], 'sk')
    P([(32,10+B),(44,18+B),(42,33+B),(37,40+B),(32,44+B)], 'sk2')
    E((21,24+B,28,34+B), 'sk')
    E((16,21+B,22,30+B), 'sk2'); E((42,21+B,48,30+B), 'sk3')      # 耳
    # 头发：高耸角状飞机头
    P([(20,21+B),(17,12+B),(21,6+B),(19,1+B),(26,4+B),(28,0+B),(33,4+B),(38,1+B),(40,5+B),
       (45,4+B),(46,12+B),(48,20+B),(45,15+B),(44,10+B),(38,9+B),(31,8+B),(25,11+B),(22,16+B)], 'hr')
    P([(33,4+B),(38,1+B),(40,5+B),(45,4+B),(46,12+B),(48,20+B),(45,15+B),(44,10+B),(38,9+B),(34,8+B)], 'hr2')
    P([(19,19+B),(22,15+B),(24,20+B),(21,28+B)], 'hr')
    P([(44,18+B),(47,17+B),(47,27+B),(44,27+B)], 'hr')
    # 五官（刻意左右不对称，是饥荒的关键特征）
    E((22,19+B,31,28+B), 'ew'); E((33,20+B,41,28+B), 'ew')
    E((25,22+B,29,27+B), 'ol'); E((35,22+B,38,26+B), 'ol')
    E((26,23+B,27,24+B), 'ew'); E((36,23+B,37,24+B), 'ew')       # 高光
    L([(22,16+B),(27,15+B),(31,17+B)], 'ol', 1)
    L([(34,17+B),(38,15+B),(41,18+B)], 'ol', 1)
    P([(32,25+B),(35,32+B),(30,32+B)], 'sk2'); L([(32,25+B),(35,32+B),(30,32+B)], 'sk3', 1)
    L([(29,35+B),(32,36+B),(35,34+B)], 'ol', 1)
    P([(29,37+B),(35,37+B),(33,42+B),(32,44+B),(30,42+B)], 'hr')  # 山羊胡
    P([(32,37+B),(35,37+B),(33,42+B),(32,44+B)], 'hr2')
    return img


def pixelize(img, pal, out_w=W, out_h=H):
    """降采样 + 调色板吸附 + 加描边。这一步决定成品是不是"真像素画"。"""
    f = int(S * W / out_w)
    hi = np.array(img).astype(np.float32)
    a = hi[..., 3:4] / 255.0
    box = lambda x: x.reshape(out_h, f, out_w, f, -1).mean((1, 3))
    pc, pa = box(hi[..., :3] * a), box(a)                       # 预乘 alpha，否则边缘颜色是脏的
    rgb = np.where(pa > 1e-4, pc / np.maximum(pa, 1e-4), 0)
    m = pa[..., 0] > 0.42

    cols = np.array(list(pal.values()), np.float32)
    idx = ((rgb.reshape(-1, 3)[:, None] - cols[None]) ** 2).sum(2).argmin(1)
    out = np.zeros((out_h, out_w, 4), np.uint8)
    out[..., :3] = cols[idx].reshape(out_h, out_w, 3).astype(np.uint8)
    out[..., 3] = np.where(m, 255, 0)

    nb = np.zeros_like(m)                                        # 外描边
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nb |= np.roll(np.roll(m, dy, 0), dx, 1)
    out[nb & ~m] = (*pal['ol'], 255)

    if out_w >= 64:                                              # 大尺寸才加内缘墨线
        core = np.all([np.roll(np.roll(m, dy, 0), dx, 1)
                       for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]], 0)
        q = out[..., :3].astype(np.float32); q[m & ~core] *= 0.5
        out[..., :3] = np.clip(q, 0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def build(out_dir, size):
    ow, oh = size, int(round(H * size / W))
    os.makedirs(out_dir, exist_ok=True)
    sheet = Image.new('RGBA', (ow * len(WALK), oh * len(CAST)), (0, 0, 0, 0))
    for r, (name, override) in enumerate(CAST.items()):
        pal = dict(BASE_PAL); pal.update(override)
        for c, params in enumerate(WALK):
            frame = pixelize(draw(pal, *params), pal, ow, oh)
            sheet.paste(frame, (c * ow, r * oh))
    path = os.path.join(out_dir, f'cast{ow}.png')
    sheet.save(path)
    sheet.resize((ow * len(WALK) * 4, oh * len(CAST) * 4), Image.NEAREST) \
         .save(os.path.join(out_dir, f'cast{ow}_preview.png'))
    print(f'{path}  ({ow}x{oh} 每帧, {len(WALK)} 帧 x {len(CAST)} 角色)')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--size', type=int, default=0, help='输出宽度，默认同时生成 32 和 64')
    ap.add_argument('--out', default='assets/sprites')
    args = ap.parse_args()
    for s in ([args.size] if args.size else [32, 64]):
        build(args.out, s)
