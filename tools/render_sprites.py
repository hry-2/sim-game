# Blender 渲染脚本：把 Mixamo 的 FBX 渲成静街要的 28 帧。
#
#   blender -b -P tools/render_sprites.py -- --walk 走.fbx --attack 挥砍.fbx --out /tmp/frames
#
# 输出 s-0.png … e-6.png（28 张），直接喂给 tools/sprite_import.js。
#
# 为什么是这条路：动作僵硬只有动捕能解决，而 Mixamo 的动捕免费、不用建模也不用绑骨。
# PZ 的角色本来就是 3D 渲成的精灵。
#
# ⚠️ 这个脚本【还没在真 Blender 上跑过】—— 我机器上没装。
#    第一次跑大概率要改一两处，把报错发我。
import bpy, sys, os, math, argparse

def parse():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--walk', required=True, help='走路循环的 FBX')
    p.add_argument('--attack', help='挥砍的 FBX（没有就用走路帧顶上）')
    p.add_argument('--out', required=True, help='帧输出目录')
    p.add_argument('--w', type=int, default=576, help='渲染宽（会被导入器降到 96）')
    p.add_argument('--h', type=int, default=756)
    p.add_argument('--tilt', type=float, default=18.0, help='相机俯角。静街是伪 2.5D 正视，不是等距')
    return p.parse_args(argv)

def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for c in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions):
        for b in list(c): c.remove(b)

def load(fbx):
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(fbx))
    arm = next((o for o in bpy.context.scene.objects if o.type == 'ARMATURE'), None)
    if not arm: raise SystemExit('FBX 里没有骨架：' + fbx)
    # 站到原点、脚底贴地 —— 不对齐的话四个朝向会各站各的
    objs = [o for o in bpy.context.scene.objects if o.type in {'MESH', 'ARMATURE'}]
    zs, xs, ys = [], [], []
    for o in objs:
        for v in o.bound_box:
            w = o.matrix_world @ __import__('mathutils').Vector(v)
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    arm.location.x -= (min(xs) + max(xs)) / 2
    arm.location.y -= (min(ys) + max(ys)) / 2
    arm.location.z -= min(zs)
    return arm, (max(zs) - min(zs))

def setup(height, tilt, W, H):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True                      # 要 alpha，不要背景
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    # Blender 4.2 改了 Eevee 的标识符，两个都试
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH'):
        try: sc.render.engine = eng; break
        except TypeError: continue
    cam_d = bpy.data.cameras.new('cam'); cam_d.type = 'ORTHO'
    # 正交，视野比人高一点点 —— 留边给挥出去的武器
    cam_d.ortho_scale = height * 1.35
    cam = bpy.data.objects.new('cam', cam_d); sc.collection.objects.link(cam)
    r = height * 4
    t = math.radians(tilt)
    cam.location = (0, -r * math.cos(t), height * .5 + r * math.sin(t))
    cam.rotation_euler = (math.radians(90) - t, 0, 0)
    sc.camera = cam
    # 平涂一点的光：强剪影比细腻明暗更重要 —— 降到 96 像素宽之后细腻全会糊掉
    key = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN'))
    key.data.energy = 3.0; key.rotation_euler = (math.radians(55), 0, math.radians(-35))
    sc.collection.objects.link(key)
    fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
    fill.data.energy = 1.0; fill.rotation_euler = (math.radians(70), 0, math.radians(140))
    sc.collection.objects.link(fill)
    return cam

DIRS = [('s', 180), ('n', 0), ('w', 90), ('e', -90)]       # 朝向 = 绕 Z 转模型

def shoot(arm, out, tag_frames):
    """tag_frames: [(槽位, 动画帧号)]"""
    sc = bpy.context.scene
    for name, deg in DIRS:
        arm.rotation_euler.z = math.radians(deg)
        for slot, f in tag_frames:
            sc.frame_set(int(f))
            sc.render.filepath = os.path.join(out, f'{name}-{slot}.png')
            bpy.ops.render.render(write_still=True)
            print(f'  {name}-{slot}.png  ← 第 {f} 帧')

def main():
    a = parse()
    os.makedirs(a.out, exist_ok=True)

    # ── 走路 4 帧：在循环里【等距取四张】 ──
    clear()
    arm, hgt = load(a.walk)
    setup(hgt, a.tilt, a.w, a.h)
    s, e = bpy.context.scene.frame_start, bpy.context.scene.frame_end
    n = max(1, e - s)
    walk = [(i, s + round(n * i / 4)) for i in range(4)]
    print(f'走路：{s}~{e}，取 {[f for _, f in walk]}')
    shoot(arm, a.out, walk)

    # ── 出手 / 收手 / 处决 ──
    if a.attack:
        clear()
        arm, hgt = load(a.attack)
        setup(hgt, a.tilt, a.w, a.h)
        s, e = bpy.context.scene.frame_start, bpy.context.scene.frame_end
        n = max(1, e - s)
        # 4=出手（打击瞬间，约 45%）5=收手（约 75%）6=处决（最靠后那一下）
        atk = [(4, s + round(n * .45)), (5, s + round(n * .75)), (6, s + round(n * .60))]
        print(f'挥砍：{s}~{e}，取 {[f for _, f in atk]}')
        shoot(arm, a.out, atk)
    else:
        print('没给 --attack：出手/收手/处决 会缺，导入器会用走路第 0 帧顶上')

    print(f'\n完成 → {a.out}')
    print('下一步：node tools/sprite_import.js ' + a.out + ' --colors 20 --row 0')

main()
