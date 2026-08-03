# AGENTS.md

此文件为 Codex (Codex.ai/code) 提供在此代码库中工作的指导。

## 项目概述

使用 HTML5 Canvas + 原生 JavaScript (ES6+) 实现的五子棋游戏。15x15 棋盘，支持双人对战、AI 对战（三种难度）和在线对战（WebSocket 房间制）。

## 开发命令

- `npm start` - 启动本地开发服务器（HTTP + WebSocket，端口 8000）
- `npm run format` - Prettier 格式化（配置在 `.prettierrc.json`）
- `npm test` - 运行全部测试（Board + AI 棋型 + AI 战术，共 25 组）
- `node tests/test.mjs` - 仅运行 Board 测试（10 项）
- `node tests/ai.test.mjs` - 仅运行 AI 棋型评估测试（6 项）
- `node tests/ai-tactics.test.mjs` - 仅运行 AI 战术测试（9 项：终端评估/跳型/双威胁/VCF）

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
│   ├── replay.js       # 回放引擎（ReplayPlayer 类、逐帧播放 + 调速）
│   └── config.js        # 全局配置（WebSocket 地址、AI 参数）
├── server/             # HTTP + WebSocket 服务器
│   └── index.js        # 静态文件服务 + 房间管理（创建/加入/重连/重启/超时清理）
├── tests/
│   ├── test.mjs         # 棋盘逻辑测试（10 项）
│   ├── ai.test.mjs      # AI 棋型评估测试（6 项）
│   └── ai-tactics.test.mjs # AI 战术测试（9 项：终端评估/跳型/双威胁/VCF）
└── docs/
    ├── development.md    # 开发指南（架构、约定、FAQ）
    └── online-mode.md    # 在线对战协议与流程文档
```

### 关键设计

- AI 双面评估：己方加分、对手减分，叶子节点即可见威胁；棋型分类支持连续与单间隙跳型（`classifyLine`：活三含真活三判定，跳活三/跳冲四/嵌四均计入威胁），并返回 `stones` 参与子数
- 评估归一化：四以下棋型按参与子数均摊（一个棋型只计一次分，不再逐子重复累加），四/五保持逐子以维持统治力；另有中心度加成（`posBonus`）与对手急迫威胁加权（`DEFENSE_URGENCY`，活三及以上刚成形必须应答）
- Alpha-Beta 搜索使用 makeMove/undo 原地操作，无 clone 开销
- Negamax 终端约定：`makeMove` 获胜时不切换 `currentPlayer`，因此终端节点返回 `-(FIVE + depth)`，父节点取负后即为获胜价值（深度奖励使更快的胜利得分更高）
- 置换表带 EXACT/LOWER/UPPER 边界标记；胜负分（绝对值 ≥ FIVE）不入表（与深度相关）
- 根节点走法按启发式评分排序（攻击+防御+中心度），提升剪枝效率
- 开局原则模块（中等/困难，前 3 手应答）：盘面无三/四棋型时，抢占对手"成三成长点"（一步前瞻选剩余发展点最少者，平分时优选贴身封堵），否则向中心发展；首应手走对方棋子的朝中心斜邻
- 搜索前预检链（中等/困难）：直接取胜 → 必堵 → 开局原则 → 己方 VCF → 对手 VCF 防守 → 己方双威胁（四三/双三/双四）→ 占据对手双威胁点
- VCF（连续冲四）搜索：只展开制造冲四/活四的走法，防守方回应被迫，带节点与时间预算；`setCellDirect` 原地推演，不污染走法历史
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
| 简单 | 随机 + 位置评分 | - | 从 top5 候选中随机，仅直接取胜/必堵预检 |
| 中等 | 开局原则 + 战术预检 + Alpha-Beta 剪枝 | 2 | 开局/预检链（VCF/双威胁）+ 归一化评估 |
| 困难 | 开局原则 + 战术预检 + 迭代加深 Alpha-Beta + 置换表 | ≤9（2 秒时限） | VCF 攻杀/防守 + 双威胁 + 边界标记置换表 + 中心度/急迫度评估 |

## 配置

- Prettier 配置：`.prettierrc.json`、`.prettierignore`
- 代码风格规则：`.claude/rules/`（包含 JS 代码风格、测试规范）
- 自定义命令：`.claude/commands/`（commit、review、check-links）

## 开发指南

- Board 关键方法：`makeMove`/`undo`（支持原地搜索，**获胜时不切换回合**）、`setCellDirect`（走法排序/战术推演用）、`getValidMoves(radius=1)`（返回已有棋子切比雪夫距离 radius 内的空位，**非全部空位**；AI 用 radius 2）、`restoreState`（在线重连用，不保留历史）
- AI 评分采用 per-stone 机制（每颗棋子独立评估四个方向，含单间隙跳型），评分权重见 `SCORES` 常量，棋型分类见 `classifyLine`
- 测试覆盖：AI 棋型评估（活三/冲四/不连续/双面/杀棋）见 `tests/ai.test.mjs`；AI 战术（终端符号/跳型/双威胁/VCF 攻杀与防守）见 `tests/ai-tactics.test.mjs`
- OnlineManager 回调模式：`onXxx` 回调由 `game.js` 的 `setupOnlineCallbacks()` 统一注册
- 坐标转换：`screenToBoard` 使用 `Math.round` 取最近交叉点（不是 `Math.floor`）
- 新同学文档：`docs/development.md`（开发指南）、`docs/online-mode.md`（在线对战协议）
