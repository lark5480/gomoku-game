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
| `makeMove(row, col)` | 落子，返回 `true`/`false`，自动切换回合、检测胜负 |
| `undo()` | 撤销最近一步，恢复回合和状态 |
| `getValidMoves()` | 返回**邻接已有棋子的空位**（非全部 225 个位置） |
| `restoreState(grid, player, state)` | 从服务器数据恢复棋盘（在线重连用），不保留历史 |
| `isWinningStone(row, col)` | 判断某颗棋子是否属于获胜五连 |
| `setCellDirect(row, col, player)` | 直接设置格子值（供 AI 走法排序用） |

### AI 搜索流程（`js/ai.js`）

```
getMove()
  ├── 直接取胜检测（O(N) 预检）
  ├── 必堵走法检测（对手四连威胁）
  ├── 根节点走法排序（按启发式评分降序 → 提升剪枝效率）
  └── Alpha-Beta 搜索（makeMove/undo 原地操作，无 clone 开销）
```

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
- 在线模式暂无自动化测试，需手动验证：创建房间 → 加入 → 对战 → 断线重连 → 重启

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

修改 `js/ai.js` 中的 `DEPTH` 和 `SCORES` 常量：
- `DEPTH` 越大越强（也越慢），当前困难模式为 3
- `SCORES` 调整各棋型权重，比如调低 `FIVE` 以外的值让 AI 更保守

### 在线模式怎么加新功能

先看 `docs/online-mode.md` 了解协议，然后：
1. 服务端在 `handleMessage` 的 switch 加新 case
2. 客户端在 `OnlineManager._handleMessage` 加对应的 case
3. 如需 UI 反馈，在 `GomokuGame.setupOnlineCallbacks` 注册回调
