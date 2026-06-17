# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 提供在此代码库中工作的指导。

## 项目概述

使用 HTML5 Canvas + 原生 JavaScript (ES6+) 实现的五子棋游戏。15x15 棋盘，支持双人对战、AI 对战（三种难度）和在线对战（WebSocket 房间制）。

## 开发命令

- `npm start` - 启动本地开发服务器（HTTP + WebSocket，端口 8000）
- `npm run format` - Prettier 格式化（配置在 `.prettierrc.json`）
- `npm test` - 运行全部测试（Board + AI，共 16 项）
- `node tests/test.mjs` - 仅运行 Board 测试（10 项）
- `node tests/ai.test.mjs` - 仅运行 AI 测试（6 项）

## 架构

### 文件结构

```
├── index.html          # 主 HTML 文件
├── css/style.css       # 响应式样式
├── js/
│   ├── utils.js        # 工具函数（坐标转换用 Math.round 取最近交叉点）
│   ├── board.js        # 游戏逻辑（Board 类、胜利检测、移动验证、撤销、restoreState）
│   ├── game.js         # 主控制器（Canvas 渲染、交互、AI 调度、在线协调、回放入口）
│   ├── ai.js           # AI 对战（AIPlayer 类、三种难度）
│   ├── online.js       # 在线管理（OnlineManager 类、WebSocket 连接/房间/同步）
│   └── replay.js       # 回放引擎（ReplayPlayer 类、逐帧播放 + 调速）
├── server/             # HTTP + WebSocket 服务器
│   └── index.js        # 静态文件服务 + 房间管理（创建/加入/重连/重启/超时清理）
├── tests/
│   ├── test.mjs         # 棋盘逻辑测试（10 项）
│   └── ai.test.mjs      # AI 棋型评估测试（6 项）
└── docs/
    ├── README.md         # 项目文档（新同学入口）
    └── online-mode.md    # 在线对战协议与流程文档
```

### 关键设计

- AI 双面评估：己方加分、对手减分，叶子节点即可见威胁
- Alpha-Beta 搜索使用 makeMove/undo 原地操作，无 clone 开销
- 根节点走法按启发式评分排序（攻击+防御），提升剪枝效率
- 搜索前先检查直接取胜和必堵走法（O(N) 预检）
- `IS_DEV` 标志控制调试日志

### 在线模式架构

- **OnlineManager**（`js/online.js`）：WebSocket 生命周期管理、消息收发、回调通知
- **GomokuGame 在线方法**（`js/game.js`）：`setupOnlineLobby`/`showOnlineLobby`/`setupOnlineCallbacks`/`enterOnlineGameView`
- **服务器**（`server/index.js`）：Room 类管理房间状态，支持创建/加入/重连/重启/超时清理
- 通信协议：JSON 消息，类型见 `docs/online-mode.md`
- 重连流程：服务端 `game:state` 消息恢复完整棋盘 → 客户端 `onGameState` 回调同步状态
- 重启流程：任意一方发送 `restart` → 服务端重置房间 → 广播 `game:restart` 给双方

## AI 难度

| 难度 | 算法 | 搜索深度 | 说明 |
|------|------|----------|------|
| 简单 | 随机 + 位置评分 | - | 从 top5 候选中随机 |
| 中等 | Alpha-Beta 剪枝 | 1 | 无置换表 |
| 困难 | Alpha-Beta + 置换表 + 走法排序 | 3 | makeMove/undo 原地搜索 |

## 配置

- Prettier 配置：`.prettierrc.json`、`.prettierignore`
- 代码风格规则：`.claude/rules/`（包含 JS 代码风格、测试规范）
- 自定义命令：`.claude/commands/`（commit、review、check-links）

## 开发指南

- Board 关键方法：`makeMove`/`undo`（支持原地搜索）、`setCellDirect`（走法排序用）、`getValidMoves`（返回邻接空位，**非全部空位**）、`restoreState`（在线重连用，不保留历史）
- AI 评分采用 per-stone 机制（每颗棋子独立评估四个方向），评分权重见 `SCORES` 常量
- 测试覆盖：AI 棋型评估（活三/冲四/不连续/双面/杀棋）见 `tests/ai.test.mjs`
- OnlineManager 回调模式：`onXxx` 回调由 `game.js` 的 `setupOnlineCallbacks()` 统一注册
- 坐标转换：`screenToBoard` 使用 `Math.round` 取最近交叉点（不是 `Math.floor`）
- 新同学文档：`docs/README.md`（项目概览）、`docs/online-mode.md`（在线对战协议）
