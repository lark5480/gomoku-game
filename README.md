# 五子棋游戏

使用 HTML5 Canvas 和原生 JavaScript (ES6+) 实现的 15x15 五子棋游戏，支持双人对战、AI 对战和在线对战。

## 快速开始

```bash
npm install
npm start
```

访问 http://localhost:8000/

> 和同事局域网对战：把 `localhost` 换成你的 IP（如 `http://192.168.1.100:8000/`），确保防火墙放行 8000 端口。

无 Node.js 时可用（仅双人和 AI 模式，无在线对战）：

```bash
python -m http.server 8000
```

## 功能

- **双人对战** — 同屏轮流落子
- **AI 对战** — 三种难度（简单/中等/困难），Alpha-Beta 搜索 + 置换表
- **在线对战** — WebSocket 房间制，支持局域网联机、断线重连、重开一局
- **棋谱回放** — 对局结束后逐步回放，支持 1x/2x/4x 调速
- AI 智能提示、高亮预览
- 棋子放置动画、获胜高亮
- 撤销落子（AI 模式自动撤两步）
- 响应式设计（桌面/移动端）

## 项目结构

```
├── index.html          # 主页面
├── css/style.css       # 样式
├── js/
│   ├── board.js        # 游戏逻辑（Board 类、胜负检测、状态恢复）
│   ├── game.js         # 主控制器（Canvas 渲染、交互、在线协调）
│   ├── ai.js           # AI 对战（AIPlayer 类、Alpha-Beta 搜索）
│   ├── online.js       # 在线管理（OnlineManager 类、WebSocket 通信）
│   ├── replay.js       # 回放引擎（ReplayPlayer 类、逐步播放）
│   └── utils.js        # 工具函数与常量
├── server/
│   └── index.js        # HTTP + WebSocket 服务器（房间管理、走棋同步）
├── tests/
│   ├── test.mjs         # 棋盘逻辑测试（10 项）
│   └── ai.test.mjs      # AI 棋型评估测试（6 项）
└── docs/
    ├── development.md    # 开发指南（架构、约定、FAQ）
    └── online-mode.md    # 在线对战技术文档
```

## 开发

```bash
npm start          # 启动服务器（HTTP + WebSocket）
npm test           # 运行全部测试
npm run format     # 代码格式化
```

新同学建议先阅读 `docs/development.md`。

## 许可证

ISC 许可证（见 package.json）
