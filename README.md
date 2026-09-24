# 游戏柜

五个自己写的网页游戏。都是**单个 HTML 文件**——没有构建步骤、没有 npm 依赖，
美术与音效全部由代码生成或内嵌，双击即可运行，也能直接扔到任意静态托管上。

首页 [`index.html`](index.html) 是合集入口。

| 游戏 | 类型 | 入口 | 说明 |
| --- | --- | --- | --- |
| 市井 | 生活模拟 · 效用 AI | [`games/sim/`](games/sim/) | [文档](games/sim/README.md) |
| 霓虹废钢线 | 生存射击 · Roguelite | [`games/neon-scrapline/`](games/neon-scrapline/) | [文档](games/neon-scrapline/README.md) |
| 夜港（原型） | 赛博朋克潜入 · 剧情 | [`games/nightharbor/`](games/nightharbor/) | [文档](games/nightharbor/README.md) · [策划](docs/夜港策划拆解.md) · [剧本](docs/夜港剧本.md) |
| 静街（在做） | 疫后小镇生存日志 | [`games/quiet-street/`](games/quiet-street/) | [策划](docs/静街策划.md) · [拆解](docs/静街任务拆解.md) · [数据规格](docs/静街数据规格.md) —— 进度 T1（镇子生成器）|
| 点头 | 面对面猜词 · 翻转判定 | [`games/nod/`](games/nod/) | 两个人玩 · 十一个词包 2313 词 · [ADR-0004](docs/adr/0004-tilt-is-an-input-not-the-verdict.md) · [ADR-0006](docs/adr/0006-one-rule-for-every-pack.md) |

## 快速开始

```bash
open index.html      # 直接开合集首页
npm run dev          # 或起服务：http://localhost:5173
```

单独玩某一款也可以直接双击 `games/<游戏>/index.html`。

## 部署到 GitHub Pages

仓库根目录已经是可发布的静态站点，不需要 Actions、不需要构建：

**Settings → Pages → Source: `Deploy from a branch` → Branch: `main` / `/ (root)`**

保存约一分钟后访问 `https://<用户名>.github.io/sim-game/`，
五款分别在 `/games/sim/`、`/games/neon-scrapline/`、`/games/nightharbor/`、`/games/quiet-street/`
和 `/games/nod/`。

> **点头必须走 HTTPS**：iOS 13+ 只在安全上下文里给陀螺仪，而且要在用户手势里申请权限。
> `npm run dev` 起的局域网 http 上，它会静默退到点击兜底 —— 能玩，但翻不了。

## 目录结构

```
├── index.html                    合集首页（卡带架，缩略图为程序化动画）
├── games/
│   ├── sim/index.html            市井（精灵内嵌）
│   ├── neon-scrapline/index.html 霓虹废钢线（音效实时合成）
│   ├── nightharbor/index.html    夜港（原型：潜入关卡 + 剧本驱动的对话）
│   ├── quiet-street/index.html   静街（在做：镇子生成器 + 噪音存量模型）
│   └── nod/index.html            点头（两个人：屏幕朝外，翻手机判定）
├── tools/                        sim 的美术生成脚本与自动化测试
├── assets/sprites/               sim 的精灵图产出
└── docs/                         设计与授权文档
```

## 开发脚本

```bash
npm run dev          # 静态服务器，端口 5173
npm run sprites      # 重新生成 sim 的角色精灵并嵌回游戏（零依赖，Node 即可）
npm run check        # sim 的冒烟测试（需 playwright）
npm run script       # 夜港：解析剧本 markdown 并嵌回游戏（零依赖）
npm run portraits    # 夜港：重新生成人物立绘并嵌回游戏（零依赖）
npm run check:neon   # 霓虹废钢线：离线验收（精灵 / 武器 / 初始化，零依赖）
npm run check:street # 静街：离线验收（100 条断言，零依赖）
npm run probe:street # 静街：生存探针（死因分布 / 存活天数 / 守恒 / 卡死）
npm run survivors    # 静街：重新生成幸存者精灵与贴花并嵌回
npm run check:nod    # 点头：离线验收（60 条断言，零依赖）——【验不到传感器，见脚本头部】
```

`tools/` 下的 `verify-*.js` 是 sim 各系统的自动化验收脚本，
路径都指向 `games/sim/index.html`。

`tools/character_gen.js` 是 sim 的角色精灵生成器，`tools/portrait_gen.js` 是夜港的
人物立绘生成器，`tools/script2json.js` 把 [夜港剧本](docs/夜港剧本.md) 解析成夜港读的
对话数据 —— 三个都零依赖，改完跑一次就嵌回游戏。

## 授权

代码与资产分离授权：

| 范围 | 许可证 |
| --- | --- |
| `index.html`、`games/*/index.html`、`tools/` 源代码 | [MIT](LICENSE) |
| `assets/` 美术、音频、剧情、关卡数据 | [专有，保留一切权利](LICENSE-ASSETS.md) |
| 第三方组件与素材 | 见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) |

详见 [授权决策指南](docs/授权决策指南.md)。
