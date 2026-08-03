# 开发指南

> 如果你只是想运行项目，看仓库根目录的 [README.md](../README.md) 就够了。
> 这份文档面向需要改动代码的开发者。

## 架构详解

### 模块依赖

```
utils.js  ←── board.js  ←── ai.js
    ↓           ↓
    └──────→ game.js  ←── online.js
                ↓
            replay.js
```

- `utils.js` — 纯函数，无依赖，被所有模块使用
- `board.js` — 游戏规则引擎，依赖 `utils.js`
- `ai.js` — AI 对手，依赖 `board.js`（通过 makeMove/undo 原地搜索）
- `online.js` — WebSocket 管理，完全独立
- `game.js` — 主控制器，组合所有模块，协调 UI → 逻辑 → 渲染
- `replay.js` — 回放引擎，独立模块，被 `game.js` 调用

### Board 类（`js/board.js`）

这是整个游戏的核心。关键方法：

| 方法 | 说明 |
|------|------|
| `makeMove(row, col)` | 落子，返回 `true`/`false`，自动检测胜负；**获胜时不切换回合**（currentPlayer 停留在胜方，AI 的 negamax 终端约定依赖这一点） |
| `undo()` | 撤销最近一步，恢复回合和状态 |
| `getValidMoves(radius = 1)` | 返回**已有棋子切比雪夫距离 radius 内的空位**（非全部 225 个位置）；AI 使用 radius 2 以覆盖跳型点 |
| `restoreState(grid, player, state)` | 从服务器数据恢复棋盘（在线重连用），不保留历史 |
| `isWinningStone(row, col)` | 判断某颗棋子是否属于获胜五连 |
| `setCellDirect(row, col, player)` | 直接设置格子值（供 AI 走法排序用） |

### AI 搜索流程（`js/ai.js`）

```
getMove()
  ├── 直接取胜检测（O(N) 预检）
  ├── 必堵走法检测（对手成五威胁）
  ├── 开局原则（仅中等/困难，前 3 手应答，findOpeningMove）
  │     ├── 盘面已有三/四棋型 → 交给战术/搜索
  │     ├── 抢占对手成三成长点（一步前瞻 + 贴身封堵优先）
  │     └── 否则向中心发展（首应手斜邻对方棋子）
  ├── 战术预检链（仅中等/困难，findTacticalMove）
  │     ├── 己方 VCF（连续冲四强制取胜）
  │     ├── 对手 VCF 防守（模拟候选防守子，重跑对手 VCF 直至失效）
  │     ├── 己方双威胁点（四三/双三/双四，下一步必胜）
  │     └── 占据对手双威胁点
  ├── 根节点走法排序（按启发式评分降序 → 提升剪枝效率）
  └── Alpha-Beta 搜索（makeMove/undo 原地操作，无 clone 开销）
```

关键约定与实现：

- **终端局面**：`makeMove` 获胜时不切换回合，终端节点返回 `-(FIVE + depth)`，
  经父节点取负后成为获胜价值；深度奖励让更快的胜利得分更高
- **置换表**：带 EXACT/LOWER/UPPER 边界标记；胜负分不入表（与剩余深度相关）
- **棋型分类**（`classifyLine`）：连续段 + 单间隙跳型（跳活三/跳冲四/嵌四），
  活三含"真活三"判定（至少一侧有空间成长成活四）；返回 `stones` 参与子数
- **评估归一化**：四以下棋型按参与子数均摊（一个棋型只计一次分），四/五保持逐子；
  叠加中心度加成（`posBonus`）与对手急迫威胁加权（`DEFENSE_URGENCY`）
- **VCF 搜索**（`findVCF`/`_vcf`）：只展开制造冲四/活四的走法，防守方被迫堵成五点；
  用 `setCellDirect` 原地推演，带节点数与时间预算，超预算返回 null（保守回退）

评分权重见 `SCORES` 常量，核心思路是**双面评估**：
- 己方棋子 → 正分（进攻威胁）
- 对手棋子 → 负分（防守威胁）
- 叶子节点即可见威胁，无需等待深层展开

### 在线模式数据流

```
game.js                          server/index.js
  │                                    │
  ├─ online.connect() ── WebSocket ──→ │  connection
  ├─ online.createRoom() ────────────→ │  创建 Room，分配 roomCode
  │  ←──── room:created ──────────────┤
  │                                    │
  │  [对手加入]                         │  ← 对手 WebSocket
  │  ←──── game:start ────────────────┤  广播 game:start
  │                                    │
  ├─ online.sendMove(r,c) ───────────→ │  校验 → 更新 grid → 胜负判定
  │  ←──── move ──────────────────────┤  广播 move
  │                                    │
  │  [断线重连]                         │
  ├─ online.joinRoom(code) ──────────→ │  检测 null 槽位 → 替换连接
  │  ←──── room:joined ───────────────┤
  │  ←──── game:state ────────────────┤  同步完整棋盘状态
```

## 开发约定

### 新增功能 checklist

1. 核心逻辑放对应模块（`board.js` / `ai.js` / `online.js`）
2. UI 交互放 `game.js`
3. 纯工具函数放 `utils.js`
4. 写测试 → `tests/` 目录
5. 更新 `CLAUDE.md`（如果架构有变化）
6. 运行 `npm test` 确保不破坏已有测试

### 测试规范

- Board 测试：覆盖状态转换、边界条件（棋盘边缘、无效输入）
- AI 测试：覆盖棋型识别正确性（活三/冲四/不连续/双面/杀棋）
- 在线模式可用 agent-browser 做端到端测试（建房/加入/走子同步/胜负判定/重启换先/断线重连），暂未纳入 CI 自动运行

### 调试技巧

- `game.js` 顶部有 `IS_DEV` 开关，设为 `true` 启用调试日志
- 浏览器控制台可通过 `window.gomokuGame` 访问游戏实例
- 在线模式调试：打开两个浏览器标签页，一个创建房间，另一个加入

## 常见问题

### 局域网联机连不上

1. 确认在同一网络（互相能 ping 通）
2. Windows 防火墙 → 高级设置 → 入站规则 → 放行 TCP 8000 端口
3. 检查 `npm start` 是否正常运行

### AI 太强/太弱怎么调

修改 `js/ai.js` 中的常量：

- `MAX_DEPTH` / `this.timeLimit`：困难模式迭代加深的层数上限与时间预算，调小变弱变快
- `VCF_MAX_PLIES` / `VCF_NODE_BUDGET` / `VCF_TIME_BUDGET_MS`：VCF 攻杀搜索的深度与预算
- `SEARCH_CANDIDATE_LIMIT` / `SEARCH_RADIUS`：内部节点的候选点数量与候选半径
- `SCORES`：各棋型权重，比如调低 `FIVE` 以外的值让 AI 更保守
- `DEFENSE_URGENCY`：对手急迫威胁（活三及以上）的额外权重，调大更偏防守
- `POS_MAX`：中心度加成上限，调大更倾向占中
- `OPENING_MAX_HISTORY`：开局原则模块生效的最大手数，调 0 可完全关闭开局引导
- 简单模式刻意不走战术预检链（`findTacticalMove` 仅中等/困难启用），保持弱棋力

### 在线模式怎么加新功能

先看 `docs/online-mode.md` 了解协议，然后：
1. 服务端在 `handleMessage` 的 switch 加新 case
2. 客户端在 `OnlineManager._handleMessage` 加对应的 case
3. 如需 UI 反馈，在 `GomokuGame.setupOnlineCallbacks` 注册回调
