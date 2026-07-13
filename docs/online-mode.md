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
Netlify (静态前端)           WebSocket 服务器
  ┌──────────────────┐       ┌───────────────────────────────┐
  │  index.html       │       │  Cloudflare Workers（推荐）    │
  │  js/*.js          │  ←→  │  或 Render / Tunnel           │
  │  css/*.css        │       │  WebSocket (wss://...)       │
  └──────────────────┘       └───────────────────────────────┘
```

> **为什么不能只部署到 Netlify？** Netlify 仅托管静态文件，不运行 Node.js 服务。
> WebSocket 服务器需要一台能长期运行进程的机器（或 Cloudflare Workers）。

---

### 方案对比

| 方案 | 费用 | 稳定性 | 需要本机 | 难度 |
|------|------|--------|---------|------|
| 🌟 **Cloudflare Workers** | 免费 | ★★★★ | 否 | 低 |
| Cloudflare Tunnel | 免费 | ★★★ | 是 | 低 |
| Zeabur / Render | 有免费额度 | ★★★★★ | 否 | 低 |

---

### 方案 A：Cloudflare Workers（推荐，🚧 未实现）

**零成本，不需要服务器，不需要备案。**

> 🚧 **此方案尚未实现**——`workers/` 目录目前不存在。当前可用的部署方式是方案 B（Cloudflare Tunnel）或方案 C（云服务器）。Workers 方案预留给未来可能的 Cloudflare Workers 迁移。

> ⚠️ 单 Worker 模式，房间状态在内存中。同地区玩家通常路由到同一实例，对局不受影响。极端情况可能因 Worker 重启丢失对局。

#### 部署步骤

1. 注册 [Cloudflare](https://cloudflare.com) 账号（免费）
2. 在项目根目录执行：

```bash
cd workers
npx wrangler deploy
```

3. 首次部署按提示登录 Cloudflare 账号
4. 部署成功后，你会得到一个 URL，如：
   ```
   https://gomoku-server.你的子域名.workers.dev
   ```

> 如果 `wrangler` 命令找不到：`npm install -g wrangler`

#### 前端配置

把 Worker 地址填到 `js/config.js`：

```js
wsUrl: "https://gomoku-server.你的子域名.workers.dev",
```

> 填 `https://` 就行，代码里会自动转为 `wss://` WebSocket 地址。

#### 重新部署前端

```bash
git add js/config.js
git commit -m "config: 指向 Cloudflare Workers"
git push
# Netlify 自动重新部署
```

---

### 方案 B：本机 + Cloudflare Tunnel（零成本）

适合临时玩。把本机暴露到公网，不需要任何云服务。

1. 本机启动游戏服务：`npm start`
2. 启动 Tunnel：`cloudflared tunnel --url http://localhost:8000`
3. 拿到 `https://xxx.trycloudflare.com` 地址
4. 填到 `js/config.js`：

```js
wsUrl: "wss://xxx.trycloudflare.com",
```

> ⚠️ Tunnel 关闭后地址失效，下次重启地址会变。电脑关机就不能玩。

---

### 方案 C：Zeabur / Render（国内可选）

[Zeabur](https://zeabur.cn) 国内可访问，部署方式：

1. 代码推送到 GitHub
2. Zeabur → 创建项目 → 导入 GitHub 仓库
3. 供应商选阿里云或腾讯云
4. 启动命令：`npm start`
5. 拿到 `https://xxx.zeabur.app` 地址

---

### 本地开发

本地开发无需任何配置，`wsUrl: null` 自动使用 `location.host`：

```bash
# 启动开发服务器（HTTP + WebSocket，端口 8000）
npm start

# 浏览器打开 http://localhost:8000
```
