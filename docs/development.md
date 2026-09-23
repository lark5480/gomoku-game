# 开发指南（实现细节）

> 只想跑起来？看 [README.md](../README.md)。代理命令与不变量看 [AGENTS.md](../AGENTS.md)。
> 本文是**代码实现细节的唯一归属地**：面向需要改动代码的开发者，讲清楚架构为什么长这样。

## 架构详解

### 模块依赖

```
config.js ──┐
utils.js  ←── board.js  ←── ai.js
    ↓           ↓
    └──────→ game.js  ←── online.js
                ↓
        replay.js / theme.js
```

- `config.js` — 全局运行时配置（当前只有 `wsUrl`），被 `online.js` 读取
- `utils.js` — 纯函数，无依赖，被所有模块使用
- `board.js` — 游戏规则引擎，依赖 `utils.js`
- `ai.js` — AI 对手，依赖 `board.js`（通过 makeMove/undo 原地搜索）
- `online.js` — WebSocket 管理，不依赖棋盘（只透传坐标与状态）
- `game.js` — 主控制器，组合所有模块，协调 UI → 逻辑 → 渲染
- `replay.js` — 回放引擎，独立模块，被 `game.js` 调用
- `theme.js` — 亮/暗切换与 Canvas 调色板（从 CSS 变量读取，不自带颜色字面量），被 `game.js` 调用

### Board 类（`js/board.js`）

这是整个游戏的核心。关键方法：

| 方法                                | 说明                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `makeMove(row, col)`                | 落子，返回 `true`/`false`，自动检测胜负；**获胜时不切换回合**（currentPlayer 停留在胜方，AI 的 negamax 终端约定依赖这一点） |
| `undo()`                            | 撤销最近一步，恢复回合和状态                                                                                                |
| `getValidMoves(radius = 1)`         | 返回**已有棋子切比雪夫距离 radius 内的空位**（非全部 225 个位置）；AI 使用 radius 2 以覆盖跳型点                            |
| `restoreState(grid, player, state)` | 从服务器数据恢复棋盘（在线重连用），不保留历史                                                                              |
| `isWinningStone(row, col)`          | 判断某颗棋子是否属于获胜五连                                                                                                |
| `setCellDirect(row, col, player)`   | 直接设置格子值（供 AI 走法排序用）                                                                                          |

### AI 搜索流程（`js/ai.js`）

```
getMove()
  ├── 直接取胜检测（O(N) 预检）
  ├── 必堵走法检测（对手成五威胁）
  ├── 开局原则（仅中等/困难，前 4 手应答，findOpeningMove，OPENING_MAX_HISTORY = 7）
  │     ├── 盘面已有三/四棋型 → 交给战术/搜索
  │     ├── 抢占对手成三成长点（一步前瞻 + 贴身封堵优先）
  │     └── 否则向中心发展（首应手斜邻对方棋子）
  ├── 战术预检链（仅中等/困难，findTacticalMove）
  │     ├── 己方 VCF（连续冲四强制取胜，迭代加深 + 三态结果）
  │     ├── 对手 VCF 防守（候选含对手威胁点；截断的复检不算防守成功）
  │     │     └── 无解时回退 findDefensiveMove 堵最急威胁
  │     ├── 对手 VCF 状态未知（预算截断）→ 保守防守（findDefensiveMove）
  │     ├── 己方双威胁点（四三/双三/双四，落子前用 verifyDoubleThreat 做单子化解/竞速验证）
  │     └── 占据对手双威胁点
  ├── 根节点走法排序（按启发式评分降序 → 提升剪枝效率）
  │     └── 战术点（collectForcedCells）顶替低分候选强制保留，根宽保持 24
  └── Alpha-Beta 搜索（makeMove/undo 原地操作，无 clone 开销）
        └── PVS 主变例 + 最后一层候选收窄到 radius 1
```

关键约定与实现：

- **终端局面**：`makeMove` 获胜时不切换回合，终端节点返回 `-(FIVE + depth)`，
  经父节点取负后成为获胜价值；深度奖励让更快的胜利得分更高
- **置换表**：带 EXACT/LOWER/UPPER 边界标记并存储最佳走法；胜负分不入表（与剩余深度相关）；
  key 用增量维护的 Zobrist 哈希（旧的全盘字符串拼接存在歧义碰撞：`'black'+''+'white'` 与
  `'black'+'white'` 同值，曾导致跨局面错误复用边界值）
- **棋型分类**（`classifyLine`）：连续段 + 单间隙跳型（跳活三/跳冲四/嵌四），
  活三含"真活三"判定（至少一侧有空间成长成活四）；返回 `stones` 参与子数
- **评估归一化**：四以下棋型按参与子数均摊（一个棋型只计一次分），四/五保持逐子；
  叠加中心度加成（`posBonus`）与对手急迫威胁加权（`DEFENSE_URGENCY`）
- **增量评估**：搜索期间维护"每子分方向棋型贡献"累加器，叶子评估 O(1)；
  `_searchMake`/`_searchUndo` 配对更新（落子只重算受影响子的相连方向），
  搜索外自动回退全盘扫描（`_evaluateBoardFull`）
- **走法排序**：内部节点优先尝试置换表存储的最佳走法（浅层条目也可用），
  其余按启发式评分取前 15（另最多保留 3 个四类威胁点）；困难模式根候选收紧至前 24
  （`ROOT_CANDIDATE_LIMIT`），战术点（`collectForcedCells`）以顶替方式强制保留；
  主循环用 PVS（先全窗口后零窗口复检），最后一层候选收窄到 radius 1（成五/堵五/冲四点必与棋子相邻）
- **VCF 搜索**（`findVCF`/`_vcf`）：只展开制造冲四/活四的走法，防守方被迫堵成五点；
  用 `setCellDirect` 原地推演；迭代加深（4/8/12/16/20 层）带节点数与时间预算，预算按候选密度缩放；
  结果三态化——找到 / 证明没有 / 未知（`vcfExhausted=true`），防御复检不接受未知结果

评分权重见 `SCORES` 常量，核心思路是**双面评估**：

- 己方棋子 → 正分（进攻威胁）
- 对手棋子 → 负分（防守威胁）
- 叶子节点即可见威胁，无需等待深层展开

评分采用 **per-stone 机制**：每颗棋子独立评估其四个方向（含单间隙跳型），而不是整条窗口累加；
再叠加中心度与急迫度修正。上面的“归一化”与“均摊”约定都是在这个粒度上做的，
改动任一侧均摊粒度会整体平移棋力平衡（由 `tests/ai.test.mjs` 守住棋型分类本身）。

### 在线模式数据流

> 协议字段、消息类型、状态机的权威定义在 [online-mode.md](online-mode.md)，此处只画数据流形状，不重复字段表。

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
  │  ←──── room:joined ───────────────┤  含该槽位实际颜色（已换算换先）
  │  ←──── game:state ────────────────┤  同步完整棋盘状态
  │                                    │
  │  [对局结束 → 重开]                  │
  ├─ online.sendRestart() ───────────→ │  colorSwap 取反 → 清空棋盘
  │  ←──── game:restart (带 color) ────┤  逐玩家单发，不能广播
  │                                    │
  │  [断线超过重连窗口]                  │
  │                                    │  RECONNECT_TIMEOUT 到点
  │  ←──── game:end (reason:disconnect)┤  胜方 = 留守玩家的**实际**颜色
```

客户端侧的模块分工与回调清单（`setupOnlineLobby` / `setupOnlineCallbacks` / `enterOnlineGameView` 等）
见 [online-mode.md §客户端模块分工](online-mode.md#客户端模块分工)；所有 `onXxx` 回调只在 `setupOnlineCallbacks()` 里注册。

**席位不等于颜色**：`Room.players` 的下标只表示占了哪个坑，实际颜色由 `colorSwap` 决定，
本地侧集中在 `Room.playerColorAt(idx)`（`playerColor(ws)` 只是先查下标再转发），Workers 侧是
`_playerColor(room, idx)`。重连回填与断线超时判胜都必须调它们——两处历史上都退回过下标直推。
规则缘由与回归用例见 [online-mode.md §约定：座位不等于颜色](online-mode.md#约定座位不等于颜色)。

> 测试可用 `RECONNECT_TIMEOUT_MS` 缩短本地服务器的重连窗口（见 `tests/server-room.test.mjs`），生产不设置则保持 30 秒。

## 开发约定

### 新增功能 checklist

1. 核心逻辑放对应模块（`board.js` / `ai.js` / `online.js`）
2. UI 交互放 `game.js`
3. 纯工具函数放 `utils.js`，主题相关放 `theme.js`，配置项放 `config.js`
4. 写测试 → `tests/` 目录，并接进 `package.json` 的 `test` 脚本
5. 按变更类型更新**对应的那一份**文档（只改一处，不要抄写到多个文件）：
   - 命令 / 仓库结构 / 不变量 → `AGENTS.md`
   - 实现机制 / 常量 / 调参 → 本文
   - 协议字段 / 房间状态 / 部署 → `docs/online-mode.md`
   - 使用者看到的入口与玩法 → `README.md`
6. 运行 `npm test` 确保不破坏已有测试，`npm run format` 统一格式

### 测试规范

各测试套件的覆盖范围见 [AGENTS.md §开发命令](../AGENTS.md#开发命令)（单点维护，此处不重复列表）。写新测试时注意：

- **口径**：单元套件里一个 `Test N` 块 = 一个用例，块内每条 `✓` 是一条断言；协议/冒烟套件（无 `Test N`，用 `=== 章节 ===`）按场景计数；文档里只统计用例数，不写断言条数
- **Board**：状态转换 + 边界条件（棋盘边缘、无效输入、重复落子）
- **AI**：棋型识别正确性要断言“分类 + 参与子数”，不锁定具体分值；搜索类断言要验证搜索后棋盘/历史/增量状态完全复原
- **战术**：终端分数符号、双威胁竞速、VCF 三态结果（找到 / 证明没有 / 预算截断未知）分开覆盖
- **协议**：优先在离线模拟运行时里覆盖状态机转换（如换先后重连保颜色），UI 层再补浏览器端到端
- 在线模式的浏览器端到端（建房/加入/走子同步/胜负/重开换先/断线重连）可用 agent-browser 手动跑，暂未纳入自动运行

### 调试技巧

- `game.js` 顶部有 `IS_DEV` 开关，设为 `true` 启用调试日志（**提交前改回 `false`**）
- 浏览器控制台可通过 `window.gomokuGame` 访问游戏实例（棋盘、AI 实例、回放器）
- 在线模式调试：打开两个浏览器标签页，一个创建房间，另一个加入

## 常见问题

### 局域网联机连不上

1. 确认在同一网络（互相能 ping 通）
2. Windows 防火墙 → 高级设置 → 入站规则 → 放行 TCP 8000 端口
3. 检查 `npm start` 是否正常运行

### AI 太强/太弱怎么调

修改 `js/ai.js` 中的常量：

- `MAX_DEPTH` / `this.timeLimit`：困难模式迭代加深的层数上限与时间预算，调小变弱变快；每层结束后若已消耗约 75% 预算则提前收尾（避免已开始的层被废弃）
- `VCF_MAX_PLIES` / `VCF_NODE_BUDGET` / `VCF_TIME_BUDGET_MS`：VCF 攻杀搜索的深度与预算；节点预算会按候选密度自动缩放，迭代加深按 4/8/12/16/20 层递进
- `SEARCH_CANDIDATE_LIMIT` / `SEARCH_RADIUS`：内部节点的候选点数量与候选半径（最后一层自动收窄到 radius 1）
- `ROOT_CANDIDATE_LIMIT`：困难模式根节点搜索的候选数上限；战术点由 `collectForcedCells` 顶替低分候选强制保留，调大更全面但更浅
- `SCORES`：各棋型权重，比如调低 `FIVE` 以外的值让 AI 更保守
- `DEFENSE_URGENCY`：对手急迫威胁（活三及以上）的额外权重，调大更偏防守
- `POS_MAX`：中心度加成上限，调大更倾向占中
- `OPENING_MAX_HISTORY`：开局原则模块生效的最大手数，调 0 可完全关闭开局引导
- 简单模式刻意不走战术预检链（`findTacticalMove` 仅中等/困难启用），保持弱棋力

### 在线模式怎么加新功能

先看 [online-mode.md](online-mode.md) 了解协议，然后四处都要动（漏任一处会造成本地/线上行为不一致）：

1. 本地服务端：`server/index.js` 的 `handleMessage` switch 加新 case
2. Workers：`workers/room.js` 加同构分支（两边协议必须一致）
3. 客户端：`OnlineManager._handleMessage` 加对应 case，必要时新增 `onXxx` 回调
4. 如需 UI 反馈，在 `GomokuGame.setupOnlineCallbacks` 注册回调
5. 同步文档：`online-mode.md` 的协议表、房间生命周期图、§约定：座位不等于颜色（如涉及颜色推导）
6. 补测试：Workers 侧进 `tests/workers-room.test.mjs`（离线模拟），本地服务器侧进 `tests/server-room.test.mjs`（真实 socket），两边都要接进 `npm test`

> `js/config.js` 顶部注释也列了部署方案，改默认行为时顺带校对。
