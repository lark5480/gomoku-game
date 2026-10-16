# 五子棋游戏

HTML5 Canvas + 原生 JavaScript (ES6+) 实现的 15x15 五子棋：双人对战、AI 对战（三种难度）、
在线对战（WebSocket 房间制，断线重连 + 重开自动换先）、棋谱回放、亮暗主题。

## 快速开始

```bash
npm install
npm start
```

访问 http://localhost:8000/

> 和同事在局域网对战：把 `localhost` 换成你的 IP（如 `http://192.168.1.100:8000/`），防火墙放行 8000 端口。

没有 Node.js 时也能玩（仅双人 + AI，无在线对战）：

```bash
python -m http.server 8000
```

## 功能

- **双人对战** — 同屏轮流落子
- **AI 对战** — 简单 / 中等 / 困难三档；困难为迭代加深 Alpha-Beta + 置换表 + VCF/双威胁战术预检
- **在线对战** — 房间码开局，支持断线重连（30 秒窗口）、认输、重开自动换先
- **棋谱回放** — 对局结束后逐步回放，1x / 2x / 4x 调速
- **AI 智能提示** 与落子高亮预览
- **动画反馈** — 棋子放置动画、获胜五连高亮
- **撤销落子**（AI 模式自动撤两步）
- **亮/暗主题**，默认跟随系统偏好
- 响应式设计（桌面 / 移动端）

## 文档

| 你想做什么                     | 读哪份                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| 只是玩 / 拉人对战              | 本文                                                                    |
| 改前端代码、调 AI 棋力、写测试 | [docs/development.md](docs/development.md) — 架构详解、约定、调参 FAQ   |
| 改在线协议、房间逻辑或部署     | [docs/online-mode.md](docs/online-mode.md) — 通信协议、状态机、部署方案 |
| 你是 AI 编码代理               | [AGENTS.md](AGENTS.md) — 命令、仓库地图、不可破坏的不变量               |

## 在线对战

在线对战需要**两台设备都能访问同一个服务端**。按场景选一条路：

| 场景                     | 方案                                 | 怎么做                                                                               |
| ------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------ |
| 同一 WiFi / 局域网       | 本机起服务                           | `npm start`，双方访问 `http://你的IP:8000`（放行 8000 端口）                         |
| 不在同一网络，临时玩一局 | **一键公网通道**                     | 双击 `play-online.bat`：自动起服务 + 开隧道，公网链接直接进剪贴板，粘贴发给朋友      |
| 想要长期可访问的入口     | Cloudflare Workers（免服务器，免费） | 见 [docs/online-mode.md §方案 A](docs/online-mode.md#plan-a)（国内需绑定自定义域名） |
| 自己的云服务器           | 部署 `server/`                       | 见 [docs/online-mode.md §生产部署](docs/online-mode.md#生产部署)                     |

> 手工开隧道的等价命令、`wsUrl` 配置与三种方案的对比统一记录在
> [docs/online-mode.md](docs/online-mode.md)，本文不重复。本地开发无需任何配置。

## 项目结构

面向使用者的顶层视图：

```
├── index.html          # 主页面
├── css/                # 样式与主题变量
├── js/                 # 前端源码（board / ai / game / online / replay / theme / utils / config）
├── server/             # 本地 HTTP + WebSocket 服务器（房间管理、走子同步）
├── workers/            # Cloudflare Workers 部署版服务端
├── tests/              # 自动化测试套件
├── docs/               # 开发指南、在线对战文档
└── public/             # ⚠️ 历史构建副本（已 gitignore），非源码，请勿编辑
```

逐文件职责与模块依赖见 [AGENTS.md §仓库地图](AGENTS.md#仓库地图)、[docs/development.md §模块依赖](docs/development.md#模块依赖)。

## 开发

```bash
npm start          # 启动服务器（HTTP + WebSocket，端口 8000）
npm test           # 运行全部测试（提交前置条件）
npm run format     # Prettier 格式化
```

新同学建议先读 [docs/development.md](docs/development.md)。

## 许可证

ISC 许可证（见 package.json）
