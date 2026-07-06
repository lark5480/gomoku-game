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

---

## 生产部署

### 架构

```
Netlify (静态前端)           Render / Railway (WebSocket 服务器)
  ┌──────────────────┐       ┌────────────────────────┐
  │  index.html       │       │  server/index.js       │
  │  js/*.js          │  ←→  │  WebSocket (wss://...) │
  │  css/*.css        │       │  ws 库                 │
  └──────────────────┘       └────────────────────────┘
```

> **为什么不能只部署到 Netlify？** Netlify 仅托管静态文件，不运行 Node.js 服务。
> WebSocket 服务器需要一台能长期运行进程的机器。

### 步骤 1：部署 WebSocket 服务器（以 Render 为例）

[Render](https://render.com) 免费套餐支持 WebSocket，适合此项目。

1. 将代码推送到 GitHub（确保包含 `package.json` 和 `server/` 目录）
2. 在 Render Dashboard 点击 **New + → Web Service**
3. 连接你的 GitHub 仓库
4. 配置：
   - **Name**: `gomoku-server`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. 点击 **Create Web Service**
6. 部署成功后，你会得到一个 URL，如 `https://gomoku-server.onrender.com`

> 同样适用于 [Railway](https://railway.app)、[Fly.io](https://fly.io) 等平台。

### 步骤 2：配置前端连接地址

部署好服务器后，有两种方式告诉前端去哪里连接：

**方式 A：直接修改 `js/config.js`（推荐）**

```js
export const CONFIG = {
  wsUrl: "wss://gomoku-server.onrender.com", // 替换为你的服务器地址
};
```

**方式 B：在 `index.html` 的 `<head>` 中设置全局变量（不修改源码）**

```html
<script>
  window.__GOMOKO_WS_URL = "wss://gomoku-server.onrender.com";
</script>
```

### 步骤 3：部署前端到 Netlify

1. 将代码推送到 GitHub
2. 在 Netlify 导入该仓库
3. 构建命令：留空（纯静态项目）
4. 发布目录：`/`（根目录）
5. 部署完成后即可访问

> 💡 前端可以部署在任何静态托管平台：Netlify、Vercel、Cloudflare Pages、GitHub Pages 等。

### 本地开发

本地开发无需任何配置修改，`npm start` 同时启动 HTTP 和 WebSocket：

```bash
# 启动开发服务器（HTTP + WebSocket，端口 8000）
npm start

# 浏览器打开 http://localhost:8000
```

前后端同端口，`js/config.js` 的 `wsUrl: null` 会自动使用 `location.host` 完成连接。
