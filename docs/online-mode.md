# 在线对战 — 技术文档

## 概览

在线模式使用 WebSocket 实现房间制对战。服务端在 `server/index.js`，客户端在 `js/online.js`（OnlineManager 类），由 `js/game.js`（GomokuGame 类）协调 UI 交互。

## 通信协议

所有消息为 JSON 格式：`{ type: "xxx", ... }`。

### 客户端 → 服务端

| type | 参数 | 说明 |
|------|------|------|
| `create` | - | 创建新房间 |
| `join` | `roomCode: string` | 加入已有房间 |
| `move` | `row, col: number` | 落子 |
| `restart` | - | 请求重开一局（仅 finished 状态有效） |
| `chat` | `text: string` | 发送聊天消息 |

### 服务端 → 客户端

| type | 触发时机 | 携带字段 |
|------|----------|----------|
| `room:created` | 房间创建成功 | `roomCode`, `color: "black"` |
| `room:joined` | 加入房间成功 | `color: "white"`, `opponentReady` |
| `game:start` | 双方就绪，游戏开始 | - |
| `move` | 对手落子 | `row`, `col`, `player` |
| `game:end` | 游戏结束 | `winner: "black"\|"white"\|null`, `reason?` |
| `game:state` | 重连时同步状态 | `grid`, `currentPlayer`, `state`, `winner` |
| `game:restart` | 重开一局 | - |
| `opponent:disconnect` | 对手断线 | - |
| `opponent:reconnect` | 对手重连 | - |
| `error` | 操作失败 | `message` |
| `room:closed` | 房间被清理 | - |

## 房间生命周期

```
创建 → 等待中 → 对战中 → 结束
  │                │        │
  └── 10min TTL ──→ 清理    │
                   │        │
      断线(30s)→ 对手胜     │
                   │        │
      重连成功 → 恢复对局   │
                            │
                     restart → 对战中
```

### 状态机

```
waiting ──(双方加入)──→ playing ──(五连/满盘)──→ finished
                            ↑                        │
                            └──(restart 消息)─────────┘
```

## 重连机制

### 断线检测

- 服务端通过 `ws.on("close")` 检测断线
- 断线玩家在 `room.players` 数组中的位置设为 `null`
- 启动 30 秒重连计时器

### 重连流程

1. 玩家重新连接 WebSocket，发送 `{ type: "join", roomCode }`
2. 服务端检测 `room.full && room.players` 中有 `null` 槽位
3. 替换 `null` 槽位为新 WebSocket 连接
4. 发送 `room:joined`（含玩家颜色）+ `game:state`（含完整棋盘状态）
5. 客户端 `onGameState` 回调恢复棋盘、清除覆盖层、同步玩家颜色

### 超时处理

- 30 秒内未重连 → 对手自动获胜（`game:end` + `reason: "disconnect"`）
- 10 分钟无任何活动 → 房间清理，双方断连

## 重开一局

- 任意一方在游戏结束后点击"重新开始"
- 客户端发送 `{ type: "restart" }`
- 服务端重置房间：清空棋盘、`currentPlayer = "black"`、`state = "playing"`
- 广播 `{ type: "game:restart" }` 给双方
- 双方客户端同时清空棋盘、开始新对局

## 关键设计决策

### 为什么不在客户端判断胜负？

服务端独立判定胜负，防止客户端篡改。棋盘状态以服务端为准。

### 为什么 "重新开始" 不需要双方确认？

简化实现。同事间对战场景下恶意操作风险低。如果后续需要，可以改为"请求重赛 → 对方确认"模式。

### 房间码生成

4 位字符，排除易混淆字符（0/O、1/I/L），实际字符集：`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`。碰撞时重新生成。
