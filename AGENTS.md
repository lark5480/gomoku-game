# AGENTS.md

此文件为 Codex (Codex.ai/code) 及其他 AI 编码代理提供在此代码库中工作的指导。

**职责边界**：本文件只维护命令、仓库地图、不可破坏的不变量与文档路由；实现细节的唯一归属地是
[docs/development.md](docs/development.md)，在线协议与部署的唯一归属地是 [docs/online-mode.md](docs/online-mode.md)。
新增说明请写进对应专题文档，不要在本文件里展开机制描述——旧版本在三个文件里抄写同一批细节，任何一次单点更新都会造成分叉。
[CLAUDE.md](CLAUDE.md) 是指向本文件的桩文件，不要在那里追加内容。

## 项目概述

HTML5 Canvas + 原生 JavaScript (ES6+) 实现的 15x15 五子棋：双人对战、AI 对战（三种难度）、
在线对战（WebSocket 房间制，断线重连 + 重开自动换先）、棋谱回放（1x/2x/4x 调速）、亮暗主题（默认跟随系统）。

## 文档路由

| 你要做什么                     | 读哪份                                            |
| ------------------------------ | ------------------------------------------------- |
| 跑起来 / 拉人对战              | [README.md](README.md)                            |
| 改前端逻辑、调 AI 棋力、写测试 | [docs/development.md](docs/development.md)        |
| 改在线协议、房间逻辑或部署     | [docs/online-mode.md](docs/online-mode.md)        |
| 代码风格 / 测试命名约定        | `.claude/rules/`（`code-style.md`、`testing.md`） |

## 开发命令

- `npm start` - 启动本地开发服务器（HTTP + WebSocket，端口 8000；静态资源取自仓库根目录）
- `npm run format` - Prettier 格式化（配置在 `.prettierrc.json`）
- `npm test` - 运行全部测试套件（**提交前置条件**，必须全绿）
- 单跑某个套件：`node tests/<文件名>.mjs`

| 测试文件                        | 覆盖范围                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `tests/test.mjs`                | Board 规则：状态转换、落子校验、胜负检测、撤销、边界与无效输入                                  |
| `tests/ai.test.mjs`             | AI 棋型评估：活三 / 冲四 / 不连续 / 双面 / 杀棋                                                 |
| `tests/ai-tactics.test.mjs`     | AI 战术：终端评估、跳型、双威胁、VCF 攻杀与防守、三态未知、强制候选                             |
| `tests/ai-incremental.test.mjs` | 增量评估与全盘扫描一致性、Zobrist 键、搜索中断后状态复原                                        |
| `tests/ai-selfplay.test.mjs`    | 自对弈冒烟：连续多手不破坏棋盘状态                                                              |
| `tests/workers-room.test.mjs`   | Workers 房间协议：建房 / 走子 / 换先 / 重连 / 超时（离线模拟运行时）                            |
| `tests/server-room.test.mjs`    | 本地服务器端到端协议：起真实服务 + 真实 WebSocket 客户端，覆盖认输 / 换先 / 重连颜色 / 超时判胜 |

> 本文件刻意不写断言条数——这类数字每加一个测试就腐烂一次。需要规模就直接跑 `npm test`。

## 仓库地图

```
├── index.html              # 主页面（引 js/game.js；可临时设置 window.__GOMOKO_WS_URL 覆盖服务地址，默认不含此行）
├── css/style.css           # 响应式样式 + 亮/暗主题变量
├── play-online.bat / .ps1  # 联机一键通道：起服务 + 开隧道 + 公网链接进剪贴板（需 cloudflared.exe）
├── js/
│   ├── config.js           # 唯一配置出口（wsUrl；null = 自动用 location.host）
│   ├── utils.js            # 纯函数工具（坐标转换等）
│   ├── board.js            # 规则引擎：Board 类、胜负检测、撤销、restoreState
│   ├── ai.js               # AIPlayer 类：评估 + Alpha-Beta/PVS + VCF/双威胁预检 + 开局原则
│   ├── game.js             # 主控制器：Canvas 渲染、交互、AI 调度、在线协调、回放/提示入口
│   ├── online.js           # OnlineManager：WebSocket 生命周期、消息收发、onXxx 回调通知
│   ├── replay.js           # ReplayPlayer：逐帧回放与调速
│   └── theme.js            # 亮/暗切换、从 CSS 读取 Canvas 调色板
├── server/index.js         # 本地 HTTP + WebSocket 服务、Room 状态机（创建/加入/重连/认输/重开/超时清理）
├── workers/                # Cloudflare Workers 部署（registry Durable Object，协议镜像本地服务器）
├── tests/                  # 见上方测试表
├── docs/                   # development.md（实现细节）、online-mode.md（协议与部署）
└── public/                 # ⚠️ 已 gitignore 的历史构建副本，非源码，请勿编辑（真实源码在 js/）
```

`docs/superpowers/` 同样被 gitignore，存放代理生成的历史计划，内容可能已被后续重构取代。

## 不可破坏的不变量

改到相关代码前先读 `docs/development.md` 的对应章节；括号内是守护测试。

- **`makeMove` 获胜时不切换 `currentPlayer`** —— negamax 终端返回 `-(FIVE + depth)`、父节点取负即胜，整条搜索链依赖此约定（`tests/ai-tactics.test.mjs`）
- **`getValidMoves(radius)` 返回的是已有棋子邻域内的空位，不是全部空位** —— AI 用 radius 2，搜索最后一层收窄到 radius 1（`tests/test.mjs`）
- **增量评估必须与 `_evaluateBoardFull` 全盘扫描逐点一致**，`_searchMake` / `_searchUndo` 必须配对更新（`tests/ai-incremental.test.mjs`）
- **置换表 key 必须是增量 Zobrist 哈希，且胜负分（|score| ≥ FIVE）不入表** —— 浅层条目带边界值/深度相关信息；旧的全盘字符串拼接存在歧义碰撞（`'black'+''+'white'` 与 `'black'+'white'` 同值）
- **评估归一化约定**：四以下棋型按参与子数均摊、一个棋型只计一次分，四/五保持逐子以维持统治力 —— 任何一侧改动都会整体平移棋力平衡（`tests/ai.test.mjs`）
- **简单模式刻意不走战术预检链**（`findTacticalMove` 仅中等/困难启用），用于保持弱棋力
- **`screenToBoard` 用 `Math.round` 取最近交叉点**，不是 `Math.floor`
- **在线 `game:restart` 必须逐玩家单发并携带 `color`** —— 重开自动换先后两人颜色互换，广播同一条消息会让一方执错子（`tests/workers-room.test.mjs`、`tests/server-room.test.mjs`）
- **房间 `players` 的下标是席位，不是颜色** —— 重连回填颜色、断线超时判胜都必须经 `Room.playerColorAt()` / `_playerColor()` 推导，不得写死 `idx === 0 ? "black" : "white"`（`tests/server-room.test.mjs`）
- **本地服务器与 Workers 是同一套协议的两个实现** —— 改任一侧的 `switch` 分支都要同步另一侧与协议文档（`tests/server-room.test.mjs` 守护本地侧）
- **OnlineManager 的 `onXxx` 回调只在 `GomokuGame.setupOnlineCallbacks()` 里统一注册**，别处不要直接赋值
- **`IS_DEV`（`js/game.js` 顶部）提交时保持 `false`**

## AI 难度

| 难度 | 算法                                               | 搜索深度                          | 说明                                                    |
| ---- | -------------------------------------------------- | --------------------------------- | ------------------------------------------------------- |
| 简单 | 随机 + 位置评分                                    | -                                 | 从 top5 候选中随机，仅直接取胜 / 必堵预检               |
| 中等 | 开局原则 + 战术预检 + Alpha-Beta 剪枝              | 2                                 | 归一化评估，预检链生效                                  |
| 困难 | 开局原则 + 战术预检 + 迭代加深 Alpha-Beta + 置换表 | ≤9（2 秒时限，实际常完成 4-5 层） | VCF 攻杀/防守、双威胁验证、PVS、增量评估、中心度/急迫度 |

各难度共用的搜索流程、可调常量与调参入口见 `docs/development.md`。

## 在线模式要点

- 客户端 `OnlineManager`（`js/online.js`）↔ 服务端 `server/index.js`（Room 状态机）↔ Workers `workers/room.js`（协议镜像）
- 消息为 JSON，类型与字段以 `docs/online-mode.md` 的协议表为准（含 `surrender`、换先后的 `color` 语义）
- 重连靠服务端 `game:state` 全量恢复棋盘；席位与颜色的关系、“为何重开不能广播”记在 `docs/online-mode.md` §约定：座位不等于颜色
- ⚠️ `*.workers.dev` 免费域名国内被墙，国内使用需绑定自定义域名（方案对比与步骤见 `docs/online-mode.md` §生产部署）

## 配置

- Prettier：`.prettierrc.json`、`.prettierignore`
- 代码风格规则：`.claude/rules/code-style.md`；测试规则：`.claude/rules/testing.md`
- 运行时配置：`js/config.js`（优先级：`window.__GOMOKO_WS_URL` > `CONFIG.wsUrl` > `location.host`）
- 自定义命令：`.claude/commands/`（commit、review、check-links）

## 改动后的文档维护

- 架构 / 不变量变化 → 更新本文件（一次，不要抄到别处）
- 实现细节 / 常量 / 测试覆盖变化 → 更新 `docs/development.md`
- 协议字段或房间状态变化 → 更新 `docs/online-mode.md`（三处必须同步：协议表、生命周期图、对应实现）
- 面向使用者的入口或联机方式变化 → 更新 `README.md`
