# 游戏柜

三个自己写的网页游戏。都是**单个 HTML 文件**——没有构建步骤、没有 npm 依赖，
美术与音效全部由代码生成或内嵌，双击即可运行，也能直接扔到任意静态托管上。

首页 [`index.html`](index.html) 是合集入口。

| 游戏 | 类型 | 入口 | 说明 |
| --- | --- | --- | --- |
| 市井 | 生活模拟 · 效用 AI | [`games/sim/`](games/sim/) | [文档](games/sim/README.md) |
| 霓虹废钢线 | 生存射击 · Roguelite | [`games/neon-scrapline/`](games/neon-scrapline/) | [文档](games/neon-scrapline/README.md) |
| 夜港（原型） | 赛博朋克潜入 · 剧情 | [`games/nightharbor/`](games/nightharbor/) | [文档](games/nightharbor/README.md) · [策划](docs/夜港策划拆解.md) · [剧本](docs/夜港剧本.md) |

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
两款游戏分别在 `/games/sim/` 和 `/games/neon-scrapline/`。

## 目录结构

```
├── index.html                    合集首页（卡带架，缩略图为程序化动画）
├── games/
│   ├── sim/index.html            市井（精灵内嵌）
│   ├── neon-scrapline/index.html 霓虹废钢线（音效实时合成）
│   └── nightharbor/index.html    夜港（原型：潜入关卡 + 剧本驱动的对话）
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
