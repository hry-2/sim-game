#!/usr/bin/env python3
"""
角色精灵生成器 v6 —— 参数化骨架
==================================================================
和前几版最大的区别：**体型不再硬编码**。
一个角色 = 体型(build) + 五官(face) + 发型(hair) + 服装(outfit) + 调色板(pal)
四层都可以独立替换，所以能在同一套代码里做出 Q 版萝莉、佝偻老人、
壮汉、小孩、以及接近原版饥荒那种瘦长诡异的角色。

关键设计：五官用**头部归一化坐标**（0~1）描述，再映射到实际头框。
这样头身比怎么变，五官都自动落在正确位置——这是支持多体型的前提。
"""
from PIL import Image, ImageDraw
import numpy as np, argparse, os

S = 12                      # 超采样倍数（要能被各输出尺寸整除：12*64=768 → 96/32 都对得上）
CW = 64                     # 画布宽（固定），高度按体型算

# ---------------- 体型档案 ----------------
# hs=头部缩放  bodyH/W=躯干  limbW=肢体粗细  legLen/W=腿  stoop=驼背前倾  top=顶部留白
BUILD = {
 'chibi': dict(hs=1.00, bodyH=19, bodyW=23, limbW=6, armLen=11, legLen=13, legW=7, stoop=0, top=6),
 'slim':  dict(hs=0.78, bodyH=22, bodyW=18, limbW=5, armLen=15, legLen=19, legW=6, stoop=0, top=6),
 'stout': dict(hs=0.88, bodyH=21, bodyW=29, limbW=8, armLen=12, legLen=13, legW=9, stoop=0, top=7),
 'child': dict(hs=0.96, bodyH=14, bodyW=21, limbW=5, armLen=9,  legLen=10, legW=6, stoop=0, top=6),
 'elder': dict(hs=0.82, bodyH=21, bodyW=22, limbW=5, armLen=14, legLen=16, legW=6, stoop=4, top=8),
}

BASE={
 'ol':(38,29,25),'ol2':(74,56,46),
 'sk':(250,218,182),'sk2':(222,182,146),'sk3':(190,148,114),'bl':(240,150,138),
 'hr':(70,50,40),'hr2':(102,76,60),
 'sh':(238,226,200),'sh2':(200,186,158),
 'vs':(152,104,74),'vs2':(110,74,52),
 'bt':(200,78,66),'bt2':(156,52,48),
 'tr':(120,98,76),'tr2':(88,70,54),'so':(62,48,40),
 'cp':(48,44,52),'cp2':(30,28,34),      # 冠巾：必须自成一色，跟发色撞了就白画
 'ew':(252,248,238),'hi':(255,255,255),
}

WALK=[(0,0,0,0,0,0),(-2,-1,2,0,1,-1),(0,0,0,0,0,0),(2,0,-2,-1,-1,-1)]


# ================= 骨架：由体型参数算出所有锚点 =================
def rig(b):
    hrx = 21*b['hs']; hry = 19.5*b['hs']
    headCY = b['top'] + hry
    neckY  = headCY + hry*0.88
    bodyTop= neckY - 1
    bodyBot= bodyTop + b['bodyH']
    footY  = bodyBot + b['legLen']
    return dict(hrx=hrx, hry=hry, headCX=32+b['stoop']*0.5, headCY=headCY,
                bodyTop=bodyTop, bodyBot=bodyBot, footY=footY,
                H=int(footY+9), **b)


def draw(spec, ldx=0,ldy=0,rdx=0,rdy=0,adx=0,bob=0):
    b=BUILD[spec['build']]; R=rig(b); H=R['H']
    pal=dict(BASE); pal.update(spec.get('pal',{}))
    img=Image.new('RGBA',(CW*S,H*S),(0,0,0,0)); d=ImageDraw.Draw(img)
    C=lambda k:pal[k]
    E=lambda box,k: d.ellipse([v*S for v in box],fill=C(k))
    P=lambda p,k: d.polygon([(x*S,y*S) for x,y in p],fill=C(k))
    L=lambda p,k,w: d.line([(x*S,y*S) for x,y in p],fill=C(k),width=max(1,int(w*S)),joint='curve')
    A=lambda box,s,e,k,w: d.arc([v*S for v in box],s,e,fill=C(k),width=max(1,int(w*S)))
    B=bob

    cx=32; bt=R['bodyTop']+B; bb=R['bodyBot']+B; fy=R['footY']+B
    bw=R['bodyW']; lw=R['legW']; hipY=bb-1

    # ---------------- 腿 + 鞋 ----------------
    lx,rx = cx-bw*0.20, cx+bw*0.20
    for x,dx,dy,shade in ((lx,ldx,ldy,'tr'),(rx,rdx,rdy,'tr2')):
        L([(x+dx,hipY),(x+dx,fy+dy)],'ol',lw+2); L([(x+dx,hipY),(x+dx,fy+dy)],shade,lw)
        E((x+dx-lw*0.9,fy+dy-2,x+dx+lw*0.9,fy+dy+6),'ol')
        E((x+dx-lw*0.9+.8,fy+dy-1.2,x+dx+lw*0.9-.8,fy+dy+5),'so')

    # ---------------- 下装 ----------------
    of = spec.get('outfit')
    waistY = bb - R['bodyH']*(0.58 if of=='ruqun' else 0.30)   # 襦裙腰线高得多
    if of in ('ruqun','changshan','daopao'):
        # 下摆不能一路垂到脚：32px 下裙和腿同色会糊成一坨，人就没有"人形"了。
        # 留出两三格露出小腿和鞋，剪影才立得住。
        hemY = fy - 3.0
        P([(cx-bw*0.46,waistY),(cx+bw*0.46,waistY),
           (cx+bw*0.78,hemY),(cx-bw*0.78,hemY)],'ol')
        P([(cx-bw*0.42,waistY+.8),(cx+bw*0.42,waistY+.8),
           (cx+bw*0.72,hemY-1),(cx-bw*0.72,hemY-1)],'vs')
        P([(cx,waistY+.8),(cx+bw*0.42,waistY+.8),
           (cx+bw*0.72,hemY-1),(cx,hemY-1)],'vs2')
        L([(cx-bw*0.70,hemY-1.2),(cx+bw*0.70,hemY-1.2)],'bt',0.9)   # 襕边
    elif of=='duanda':                                         # 短打：小腿裹行縢
        for x,dx,dy in ((lx,ldx,ldy),(rx,rdx,rdy)):
            L([(x+dx,hipY+2.5),(x+dx,fy+dy-2.5)],'vs',lw+0.6)

    # ---------------- 躯干 ----------------
    E((cx-bw/2,bt,cx+bw/2,bb),'ol'); E((cx-bw/2+1,bt+1,cx+bw/2-1,bb-1),'sh')
    P([(cx,bt+1),(cx+bw/2-1,bt+bw*0.14),(cx+bw/2-1,bb-bw*0.12),(cx,bb-1)],'sh2')
    if of in ('ruqun','changshan','daopao','duanda'):
        # 交领右衽：只画两条【窄】的深色衣缘压在浅色衣身上。
        # 别把整个躯干铺成深色 —— 32px 下能读出来的是"浅底 + 深线"，
        # 两块相近的色一downsample就糊成一坨，人形直接没了。
        ct = bt + bw*0.05
        botY = (waistY+1.0) if of=='ruqun' else (bb-1)
        L([(cx-bw*0.42,ct),(cx+bw*0.02,ct+bw*0.34),(cx+bw*0.02,botY)],'vs',1.5)
        L([(cx+bw*0.42,ct),(cx-bw*0.04,ct+bw*0.30),(cx-bw*0.04,botY)],'vs2',1.5)
        # 腰带：浅衣身上的一道强对比横带 —— 第二个能读出来的记号
        L([(cx-bw*0.50,waistY),(cx+bw*0.50,waistY)],'ol',2.6)
        L([(cx-bw*0.47,waistY),(cx+bw*0.47,waistY)],'bt',1.8)
        if of!='duanda':                                           # 垂下来的绦
            L([(cx+bw*0.10,waistY+1),(cx+bw*0.13,waistY+R['bodyH']*0.26)],'bt2',0.9)

    # ---------------- 手臂 ----------------
    aw=R['limbW']; al=R['armLen']; sy=bt+R['bodyH']*0.18
    for sgn,shade,skin in ((-1,'sh','sk'),(1,'sh2','sk2')):
        ex=cx+sgn*(bw/2+2+adx*sgn*0.5); ey=sy+al
        L([(cx+sgn*bw*0.40,sy),(ex,ey)],'ol',aw+2)
        L([(cx+sgn*bw*0.40,sy),(ex,ey)],shade,aw)
        # 大袖：袖子用衣身的浅色（跟躯干连成一体），只在袖口压一道深缘。
        # 整只袖子画深色会把人形撑宽撑黑，正好毁掉剪影。
        if of in ('ruqun','changshan','daopao'):
            sx0,sy0 = cx+sgn*bw*0.42, sy
            P([(sx0,sy0-aw*0.5),(ex+sgn*aw*1.6,ey-aw*0.7),
               (ex+sgn*aw*1.4,ey+aw*1.7),(sx0-sgn*aw*0.2,sy0+aw*1.4)],'ol')
            P([(sx0,sy0-aw*0.1),(ex+sgn*aw*1.35,ey-aw*0.4),
               (ex+sgn*aw*1.15,ey+aw*1.45),(sx0-sgn*aw*0.1,sy0+aw*1.15)],shade)
            L([(ex+sgn*aw*1.25,ey-aw*0.45),(ex+sgn*aw*1.05,ey+aw*1.45)],'vs',1.0)
        E((ex-aw*0.9,ey-aw*0.9,ex+aw*0.9,ey+aw*0.9),'ol')
        E((ex-aw*0.9+.8,ey-aw*0.9+.8,ex+aw*0.9-.8,ey+aw*0.9-.8),skin)

    # ---------------- 领口 ----------------
    P([(cx-bw*0.18,bt),(cx,bt+bw*0.22),(cx+bw*0.18,bt)],'sh')
    if spec.get('bowtie',False):
        P([(cx-bw*0.26,bt+1),(cx-bw*0.07,bt+bw*0.13),(cx-bw*0.26,bt+bw*0.26)],'bt')
        P([(cx+bw*0.26,bt+1),(cx+bw*0.07,bt+bw*0.13),(cx+bw*0.26,bt+bw*0.26)],'bt2')
        E((cx-bw*0.10,bt+bw*0.05,cx+bw*0.10,bt+bw*0.25),'bt')

    # ---------------- 头 ----------------
    hx,hy = R['headCX'], R['headCY']+B
    rx,ry = R['hrx'], R['hry']
    hb=(hx-rx,hy-ry,hx+rx,hy+ry)                       # 头框
    hair_back(d,spec,pal,hb,E,P,L)
    E((hb[0]-1,hb[1]-1,hb[2]+1,hb[3]+1),'ol'); E(hb,'sk')
    P([(hx,hy-ry*0.85),(hx+rx*0.82,hy-ry*0.3),(hx+rx*0.78,hy+ry*0.5),(hx,hy+ry*0.95)],'sk2')
    E((hx-rx,hy-ry*0.1,hx+rx*0.2,hy+ry),'sk')
    E((hx-rx-2,hy-ry*0.2,hx-rx+2.5,hy+ry*0.35),'ol'); E((hx-rx-1.4,hy-ry*0.13,hx-rx+2,hy+ry*0.3),'sk2')
    E((hx+rx-2.5,hy-ry*0.2,hx+rx+2,hy+ry*0.35),'ol');  E((hx+rx-2,hy-ry*0.13,hx+rx+1.4,hy+ry*0.3),'sk3')
    face(d,spec,pal,hb,E,P,L,A)
    hair_front(d,spec,pal,hb,E,P,L)
    return img, H


# ================= 头部归一化坐标工具 =================
def mk(hb):
    x0,y0,x1,y1=hb; w=x1-x0; h=y1-y0
    return (lambda u,v:(x0+u*w, y0+v*h)), w, h


# ================= 发型 =================
def hair_back(d,spec,pal,hb,E,P,L):
    p,w,h=mk(hb); s=spec.get('hair')
    if s=='long':
        P([p(-.05,.32),p(1.05,.32),p(1.12,1.5),p(.88,1.62),p(.86,.72),p(.14,.72),p(.12,1.62),p(-.12,1.5)],'ol')
        P([p(-.01,.35),p(1.01,.35),p(1.07,1.45),p(.9,1.55),p(.86,.75),p(.14,.75),p(.1,1.55),p(-.07,1.45)],'hr')
        P([p(.5,.35),p(1.01,.35),p(1.07,1.45),p(.9,1.55),p(.86,.75),p(.5,.75)],'hr2')
    elif s=='twintail':
        for u,sg in ((.02,-1),(.98,1)):
            P([p(u,.34),p(u+sg*.13,.40),p(u+sg*.17,.95),p(u+sg*.08,1.34),p(u-sg*.04,1.28),p(u+sg*.03,.92)],'ol')
            P([p(u+sg*.02,.37),p(u+sg*.11,.43),p(u+sg*.14,.95),p(u+sg*.07,1.28),p(u-sg*.01,1.22),p(u+sg*.04,.92)],'hr')
    elif s=='bun':
        P([p(.30,-.28),p(.70,-.28),p(.74,.12),p(.26,.12)],'ol')
        E((*p(.30,-.24),*p(.70,.10)),'hr'); E((*p(.36,-.18),*p(.53,-.02)),'hr2')

def hair_front(d,spec,pal,hb,E,P,L):
    p,w,h=mk(hb); s=spec.get('hair')
    _beard(d,spec,pal,hb,E,P,L) if s=='bald' else None      # bald 会提前返回，胡子得先画
    if s=='bald':                                        # 地中海：马蹄形侧发，头顶光亮
        for u,sg in ((.04,-1),(.96,1)):
            P([p(u,.26),p(u+sg*.14,.22),p(u+sg*.18,.58),p(u+sg*.09,.82),p(u-sg*.05,.76),p(u+sg*.02,.52)],'ol')
            P([p(u+sg*.02,.28),p(u+sg*.12,.25),p(u+sg*.15,.58),p(u+sg*.08,.77),p(u-sg*.02,.71),p(u+sg*.04,.52)],'hr')
        return
    # 共用发盖
    P([p(.03,.42),p(.00,.12),p(.16,-.06),p(.40,-.12),p(.62,-.12),p(.85,-.04),p(.99,.14),p(1.03,.42),
       p(.94,.22),p(.82,.30),p(.62,.20),p(.36,.20),p(.16,.28),p(.07,.42)],'ol')
    P([p(.06,.40),p(.03,.14),p(.18,-.02),p(.40,-.08),p(.62,-.08),p(.83,0),p(.96,.16),p(.99,.40),
       p(.92,.24),p(.80,.32),p(.66,.22),p(.50,.30),p(.34,.20),p(.20,.28),p(.10,.40)],'hr')
    P([p(.55,-.08),p(.83,0),p(.96,.16),p(.99,.40),p(.92,.24),p(.80,.32),p(.66,.22),p(.58,.24)],'hr2')
    if s=='short':
        for u,sg in ((.03,-1),(.97,1)):
            P([p(u,.22),p(u+sg*.11,.30),p(u+sg*.12,.70),p(u+sg*.22,.88),p(u+sg*.06,.84),p(u-sg*.02,.62)],'ol')
            P([p(u+sg*.02,.25),p(u+sg*.09,.32),p(u+sg*.10,.70),p(u+sg*.18,.84),p(u+sg*.06,.78),p(u+sg*.01,.62)],'hr')
    elif s=='twintail':
        P([p(.03,.38),p(.18,.20),p(.50,.14),p(.82,.20),p(.97,.38),p(.97,.46),p(.03,.46)],'hr')
        P([p(.55,.15),p(.82,.20),p(.97,.38),p(.97,.46),p(.55,.46)],'hr2')
    elif s=='long':
        P([p(.03,.46),p(.13,.18),p(.44,.10),p(.80,.20),p(.97,.42),p(.80,.30),p(.50,.28),p(.22,.44)],'hr')
    elif s=='bun':
        P([p(.10,.42),p(.24,.18),p(.48,.28),p(.46,.44)],'hr'); P([p(.90,.42),p(.76,.18),p(.52,.28),p(.54,.44)],'hr2')
    elif s=='spiky':                                     # 饥荒式尖翘
        for u0,u1,u2,v in ((.14,.22,.30,-.13),(.38,.48,.58,-.19),(.64,.74,.84,-.11)):
            P([p(u0,.10),p(u1,v),p(u2,.08)],'ol'); P([p(u0+.02,.10),p(u1,v+.05),p(u2-.02,.08)],'hr')
    _beard(d,spec,pal,hb,E,P,L)
    _cap(d,spec,pal,hb,E,P,L)


def _cap(d,spec,pal,hb,E,P,L):
    p,w,h=mk(hb); c=spec.get('cap')
    if c=='jin':                       # 幞头/方巾：包住发顶，脑后垂两只软脚
        P([p(-.06,.44),p(-.02,.06),p(.18,-.16),p(.50,-.22),p(.82,-.16),p(1.02,.06),p(1.06,.44),
           p(.86,.30),p(.50,.24),p(.14,.30)],'ol')
        P([p(-.01,.42),p(.02,.10),p(.20,-.11),p(.50,-.17),p(.80,-.11),p(.98,.10),p(1.01,.42),
           p(.84,.28),p(.50,.22),p(.16,.28)],'cp')
        P([p(.52,-.17),p(.80,-.11),p(.98,.10),p(1.01,.42),p(.84,.28),p(.52,.22)],'cp2')
        P([p(.10,.30),p(.02,.62),p(.14,.60),p(.20,.34)],'cp2')          # 软脚
        P([p(.90,.30),p(.98,.62),p(.86,.60),p(.80,.34)],'cp2')
    elif c=='zan':                     # 发簪：一根横插的簪子 + 一点簪头
        L([p(.24,.06),p(.80,-.04)],'ol',1.6)
        L([p(.26,.06),p(.78,-.03)],'bt',1.0)
        E((*p(.76,-.10),*p(.90,.04)),'ol'); E((*p(.78,-.08),*p(.88,.02)),'bt')


def _beard(d,spec,pal,hb,E,P,L):
    p,w,h=mk(hb)
    if spec.get('beard'):                                # 络腮胡：贴脸颊一圈，不糊住嘴
        P([p(.16,.62),p(.26,.88),p(.40,.96),p(.60,.96),p(.74,.88),p(.84,.62),
           p(.80,.86),p(.66,1.06),p(.50,1.12),p(.34,1.06),p(.20,.86)],'ol')
        P([p(.19,.64),p(.28,.86),p(.41,.93),p(.59,.93),p(.72,.86),p(.81,.64),
           p(.77,.84),p(.65,1.02),p(.50,1.08),p(.35,1.02),p(.23,.84)],'hr2')
        L([p(.34,.80),p(.50,.86),p(.66,.80)],'hr',1.2)                    # 髭


# ================= 五官 =================
def face(d,spec,pal,hb,E,P,L,A):
    p,w,h=mk(hb)
    eye=spec.get('eye','round'); brow=spec.get('brow','soft')
    mouth=spec.get('mouth','smile'); lash=spec.get('lash',0)
    ey=spec.get('eyeY',.58); es=spec.get('eyeSize',1.0)
    ew_=.175*es; eh_=.17*es; gap=.115

    def one(sgn):
        ucx=.5+sgn*(gap+ew_/2)
        x0,y0=p(ucx-ew_/2, ey-eh_/2); x1,y1=p(ucx+ew_/2, ey+eh_/2)
        if eye=='smile': A((x0,y0-2,x1,y1+4),200,340,'ol',max(1,h*.035)); return
        if eye=='squint':
            L([(x0,(y0+y1)/2),(x1,(y0+y1)/2)],'ol',max(1,h*.04))
            L([(x0+1,(y0+y1)/2-1.5),(x1-1,(y0+y1)/2-1.5)],'ol2',1); return
        E((x0-1,y0-1,x1+1,y1+1),'ol'); E((x0,y0,x1,y1),'ew')
        iw,ih=x1-x0,y1-y0
        k={'almond':(.22,.28,.18),'big':(.14,.16,.12),'round':(.20,.24,.16),'beady':(.32,.34,.28)}[eye]
        E((x0+iw*k[0],y0+ih*k[1],x1-iw*k[0],y1-ih*k[2]),'ol')
        if eye!='beady':
            E((x0+iw*.24,y0+ih*.24,x0+iw*.5,y0+ih*.5),'hi')
            E((x1-iw*.36,y1-ih*.34,x1-iw*.18,y1-ih*.16),'hi')
        for i in range(lash):
            sx = x0 if sgn<0 else x1
            L([(sx,y0+2+i*3.2),(sx+sgn*4,y0-1+i*3.2)],'ol',1.4)
    one(-1); one(1)

    by=ey-eh_/2-.07
    for sgn in (-1,1):
        u0,u1=.5+sgn*gap*.6, .5+sgn*(gap+ew_)
        a,b_=p(min(u0,u1),by), p(max(u0,u1),by)
        if brow=='flat':   P([a,b_,(b_[0],b_[1]+h*.03),(a[0],a[1]+h*.03)],'ol')
        elif brow=='raised':
            m=p(.5+sgn*(gap+ew_*.5), by-.05)
            P([a,m,b_,(b_[0],b_[1]+h*.03),m,(a[0],a[1]+h*.03)],'ol')
        elif brow=='thin':
            L([a,p(.5+sgn*(gap+ew_*.5),by-.02),b_],'ol2',1)
        elif brow=='bushy':
            P([a,p(.5+sgn*(gap+ew_*.5),by-.05),b_,(b_[0],b_[1]+h*.05),(a[0],a[1]+h*.05)],'hr')
        else:
            m=p(.5+sgn*(gap+ew_*.5), by-.03)
            P([a,m,b_,(b_[0],b_[1]+h*.03),m,(a[0],a[1]+h*.03)],'ol2')

    nz=spec.get('nose','dot')
    if nz=='dot':   E((*p(.44,ey+.14),*p(.56,ey+.22)),'sk3')
    elif nz=='beak':P([p(.50,ey+.06),p(.60,ey+.24),p(.42,ey+.24)],'sk3')
    my=ey+.30
    if mouth=='grin':   A((*p(.34,my-.06),*p(.66,my+.14)),10,170,'ol',max(1,h*.035))
    elif mouth=='pout': E((*p(.45,my),*p(.55,my+.07)),'ol')
    elif mouth=='small':E((*p(.44,my-.02),*p(.56,my+.08)),'ol'); E((*p(.46,my),*p(.54,my+.04)),'sk3')
    elif mouth=='frown':A((*p(.36,my+.02),*p(.64,my+.20)),190,350,'ol',max(1,h*.03))
    elif mouth=='line': L([p(.40,my+.04),p(.60,my+.02)],'ol',max(1,h*.028))
    else:               A((*p(.36,my-.06),*p(.64,my+.10)),20,160,'ol',max(1,h*.03))
    if spec.get('blush',True):
        E((*p(.08,ey+.10),*p(.28,ey+.24)),'bl'); E((*p(.72,ey+.12),*p(.92,ey+.26)),'bl')


# ================= 角色阵容：跨风格 =================
CAST = {
 '小满': dict(build='chibi', hair='twintail', eye='round',  brow='flat',   mouth='smile',
   outfit='ruqun', cap='zan', lash=2, eyeY=.60, eyeSize=1.0, trait='勤勉',
   pal={'hr':(96,62,42),'hr2':(132,90,62),'vs':(108,138,132),'vs2':(78,104,100),
        'sh':(226,236,232),'sh2':(186,202,200),'bt':(178,88,62),'bt2':(134,62,46),
        'tr':(58,52,46),'tr2':(42,38,34)}),

 '阿柳': dict(build='slim',  hair='long',     eye='almond', brow='thin',   mouth='pout',
   outfit='ruqun', cap='zan', lash=3, eyeY=.54, eyeSize=.88, trait='端方',
   pal={'hr':(52,44,58),'hr2':(84,74,92),'vs':(126,110,150),'vs2':(92,80,112),
        'sh':(228,224,240),'sh2':(190,186,206),'bt':(96,74,120),'bt2':(70,54,90),
        'tr':(50,46,58),'tr2':(36,33,42)}),

 '芜青': dict(build='child', hair='short',    eye='smile',  brow='raised', mouth='grin',
   outfit='duanda', lash=0, eyeY=.62, eyeSize=1.05, trait='耽乐',
   pal={'hr':(200,112,58),'hr2':(232,152,88),'vs':(150,132,70),'vs2':(112,98,50),
        'sh':(226,206,152),'sh2':(190,170,122),'bt':(184,74,58),'bt2':(140,52,42),
        'tr':(62,54,42),'tr2':(46,40,30)}),

 '铁山': dict(build='stout', hair='spiky',    eye='beady',  brow='bushy',  mouth='line',
   outfit='duanda', cap='jin', lash=0, eyeY=.56, eyeSize=.78, blush=False, beard=True, nose='beak', trait='勤勉',
   pal={'hr':(64,48,40),'hr2':(92,70,56),'vs':(140,104,66),'vs2':(102,74,44),
        'sh':(214,196,164),'sh2':(178,162,132),'bt':(150,60,50),'bt2':(112,42,36),
        'tr':(56,48,40),'tr2':(40,34,28),'cp':(48,60,74),'cp2':(30,40,52)}),

 '阿沅': dict(build='slim',  hair='spiky',    eye='big',    brow='raised', mouth='frown',
   outfit='changshan', cap='jin', lash=0, eyeY=.50, eyeSize=1.02, blush=False, nose='beak', trait='善交',
   pal={'hr':(46,38,34),'hr2':(74,62,54),'vs':(84,104,138),'vs2':(58,74,102),
        'sh':(206,218,232),'sh2':(170,182,198),'bt':(150,84,54),'bt2':(112,60,38),
        'tr':(48,46,50),'tr2':(34,32,36),'cp':(38,42,56),'cp2':(24,26,36)}),

 '老莫': dict(build='elder', hair='bald',     eye='squint', brow='bushy',  mouth='line',
   outfit='daopao', lash=0, eyeY=.55, eyeSize=.85, blush=False, beard=True, nose='beak', trait='端方',
   pal={'hr':(206,200,190),'hr2':(230,226,218),'vs':(146,142,132),'vs2':(110,106,98),
        'sh':(240,238,230),'sh2':(204,202,192),'bt':(104,80,60),'bt2':(76,56,42),
        'tr':(60,58,54),'tr2':(44,42,38),
        'sk':(226,196,164),'sk2':(196,164,134),'sk3':(164,134,106)}),

 '梨娘': dict(build='chibi', hair='bun',      eye='big',    brow='soft',   mouth='small',
   outfit='ruqun', cap='zan', lash=3, eyeY=.60, eyeSize=1.12, trait='善交',
   pal={'hr':(224,184,94),'hr2':(248,216,134),'vs':(186,140,72),'vs2':(142,102,48),
        'sh':(244,230,196),'sh2':(206,192,160),'bt':(96,132,88),'bt2':(66,98,60),
        'tr':(60,52,42),'tr2':(44,38,30)}),

 '豆丁': dict(build='child', hair='short',      eye='round',  brow='soft',   mouth='grin',
   outfit='duanda', lash=0, eyeY=.63, eyeSize=1.15, trait='耽乐',
   pal={'hr':(120,84,54),'hr2':(158,116,78),'vs':(96,132,146),'vs2':(68,98,110),
        'sh':(222,232,236),'sh2':(186,198,204),'bt':(212,150,72),'bt2':(166,112,48),
        'tr':(54,50,46),'tr2':(38,35,32)}),
}


def pixelize(img, pal, ow, oh, src_h):
    f = int(S*CW/ow)
    hi=np.array(img).astype(np.float32); a=hi[...,3:4]/255.
    th=src_h*S//f*f
    hi=hi[:th]; a=a[:th]; oh2=th//f
    box=lambda x:x.reshape(oh2,f,ow,f,-1).mean((1,3))
    pc,pa=box(hi[...,:3]*a),box(a)
    rgb=np.where(pa>1e-4,pc/np.maximum(pa,1e-4),0); m=pa[...,0]>0.42
    cols=np.array(list(pal.values()),np.float32)
    idx=((rgb.reshape(-1,3)[:,None]-cols[None])**2).sum(2).argmin(1)
    out=np.zeros((oh2,ow,4),np.uint8)
    out[...,:3]=cols[idx].reshape(oh2,ow,3).astype(np.uint8); out[...,3]=np.where(m,255,0)
    nb=np.zeros_like(m)
    for dy in(-1,0,1):
        for dx in(-1,0,1): nb|=np.roll(np.roll(m,dy,0),dx,1)
    out[nb&~m]=(*pal['ol'],255)
    return Image.fromarray(out,'RGBA')


def build_sheet(out_dir, size, names=None):
    """所有角色统一对齐到同一帧高（按最高的角色），脚底对齐。"""
    names = names or list(CAST)
    scale = size/CW
    frames={}
    maxh=0
    for n in names:
        col=[]
        for pr in WALK:
            img,srcH = draw(CAST[n], *pr)
            pal=dict(BASE); pal.update(CAST[n].get('pal',{}))
            ow=size; f=int(S*CW/ow)
            col.append(pixelize(img,pal,ow,srcH,srcH))
        frames[n]=col; maxh=max(maxh, col[0].height)
    fh=maxh+1
    sheet=Image.new('RGBA',(size*4, fh*len(names)),(0,0,0,0))
    for r,n in enumerate(names):
        for c,im in enumerate(frames[n]):
            sheet.paste(im,(c*size, r*fh+(fh-im.height)))      # 脚底对齐
    os.makedirs(out_dir,exist_ok=True)
    sheet.save(f'{out_dir}/cast{size}.png')
    sheet.resize((size*4*4, fh*len(names)*4),Image.NEAREST).save(f'{out_dir}/cast{size}_preview.png')
    return size, fh



# ==========================================================================
#  T39 · 按种子生成外观
#  上面那张 CAST 是六个人一个个手填的。要让"有人过世、有人迁入"成立，
#  就得能【凭空造出一张没见过的脸】—— 素材库本来就在（体型/发型/五官/服装/
#  调色板各一套），缺的只是把它们按种子展开。
#
#  两条约束，不然会生出四不像：
#    ① 服制要自洽：襦裙配挽发和簪，短打配短发，道袍配长须的老者
#    ② 用确定性哈希，不用 random —— 同一个种子永远是同一张脸，
#       游戏里存的就只是那个种子（也和这个项目"不用 Math.random"的规矩一致）
# ==========================================================================
def _h(seed, salt):
    x = (seed * 2654435761 + salt * 40503) & 0xFFFFFFFF
    x ^= (x >> 13); x = (x * 1274126177) & 0xFFFFFFFF; x ^= (x >> 16)
    return x / 0xFFFFFFFF

def _pick(seed, salt, opts):
    return opts[int(_h(seed, salt) * len(opts)) % len(opts)]

# 调色板不是乱撒：每一族给一个色相带，深浅由种子在带内取
HAIR_COLS = [((52,44,58),(84,74,92)), ((96,62,42),(132,90,62)), ((70,50,40),(102,76,60)),
             ((38,34,32),(72,66,62)), ((124,96,58),(160,130,84)), ((150,146,140),(186,182,176))]
CLOTH_COLS = [((108,138,132),(78,104,100)), ((126,110,150),(92,80,112)),
              ((152,104,74),(110,74,52)),   ((96,132,146),(68,98,110)),
              ((146,120,72),(108,88,50)),   ((120,98,76),(88,70,54)),
              ((104,124,88),(74,92,62)),    ((150,96,96),(112,68,68))]
SHIRT_COLS = [((226,236,232),(186,202,200)), ((238,226,200),(200,186,158)),
              ((228,224,240),(190,186,206)), ((236,232,214),(198,194,178))]
BELT_COLS  = [((178,88,62),(134,62,46)), ((96,74,120),(70,54,90)),
              ((200,78,66),(156,52,48)), ((146,110,58),(110,80,40))]

def gen_look(seed, adult=True, old=False):
    """种子 → 一副长相。adult/old 只用来收窄体型和服制，别的全交给种子。"""
    female = _h(seed, 1) < 0.5
    if old:      build = 'elder'
    elif not adult: build = 'child'
    else:        build = _pick(seed, 2, ['chibi', 'slim', 'slim', 'stout'])

    if not adult:
        hair = _pick(seed, 3, ['short', 'twintail', 'bun'])
        outfit, cap, lash = 'duanda', None, (2 if female else 0)
    elif female:
        hair = _pick(seed, 3, ['twintail', 'long', 'bun'])
        outfit = _pick(seed, 4, ['ruqun', 'ruqun', 'changshan'])
        cap, lash = ('zan' if _h(seed, 5) < 0.7 else None), _pick(seed, 6, [2, 2, 3])
    else:
        hair = _pick(seed, 3, ['short', 'spiky', 'bald'] if old else ['short', 'spiky'])
        outfit = _pick(seed, 4, ['daopao', 'changshan'] if old else ['duanda', 'changshan'])
        cap, lash = ('jin' if _h(seed, 5) < 0.6 else None), 0

    hr, hr2 = HAIR_COLS[5] if old else _pick(seed, 7, HAIR_COLS)
    vs, vs2 = _pick(seed, 8, CLOTH_COLS)
    sh, sh2 = _pick(seed, 9, SHIRT_COLS)
    bt, bt2 = _pick(seed, 10, BELT_COLS)
    return dict(build=build, hair=hair,
        eye=_pick(seed, 11, ['round', 'almond', 'big', 'smile', 'squint', 'beady']),
        brow=_pick(seed, 12, ['flat', 'thin', 'raised', 'bushy', 'soft']),
        mouth=_pick(seed, 13, ['smile', 'pout', 'grin', 'line', 'frown', 'small']),
        outfit=outfit, cap=cap, lash=lash,
        eyeY=0.50 + _h(seed, 14) * 0.14, eyeSize=0.80 + _h(seed, 15) * 0.32,
        blush=female or _h(seed, 16) < 0.25,
        beard=(old and not female), nose=('beak' if not female else None),
        pal={'hr': hr, 'hr2': hr2, 'vs': vs, 'vs2': vs2,
             'sh': sh, 'sh2': sh2, 'bt': bt, 'bt2': bt2,
             'tr': (58, 52, 46), 'tr2': (42, 38, 34)})

def build_atlas(out_dir, size, n, seed0=1):
    """一张 n 行的图集：第 i 行就是种子 seed0+i 那张脸。
       前六行沿用手写的六位主角（他们的长相已经和性格绑在一起了）。"""
    global CAST
    names = []
    for i, nm in enumerate(['小满', '阿沅', '老莫', '芜青', '阿柳', '梨娘']):
        names.append(nm)
    for i in range(len(names), n):
        sd = seed0 + i
        key = 'gen%02d' % i
        CAST[key] = gen_look(sd, adult=True, old=(_h(sd, 20) < 0.18))
        names.append(key)
    return build_sheet(out_dir, size, names)

if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--size',type=int,default=0)
    ap.add_argument('--out',default='assets/sprites')
    ap.add_argument('--only',default='')
    ap.add_argument('--atlas',type=int,default=0)
    a=ap.parse_args()
    names=[x for x in a.only.split(',') if x] or None
    if a.atlas:
        w,fh=build_atlas(a.out, a.size or 96, a.atlas)
        print(f'{a.out}/cast{w}.png  帧 {w}x{fh}, 4 帧 x {a.atlas} 行（图集）')
    else:
        for sz in ([a.size] if a.size else [32,64]):
            w,fh=build_sheet(a.out,sz,names)
            print(f'{a.out}/cast{w}.png  帧 {w}x{fh}, 4 帧 x {len(names or CAST)} 角色')
