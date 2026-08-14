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
| 🌟 **Cloudflare Workers** | 免费 | ★★★★ | 否 | 低（国内需自定义域名） |
| Cloudflare Tunnel | 免费 | ★★★ | 是 | 低 |
| Zeabur / Render | 有免费额度 | ★★★★★ | 否 | 低 |

---

### 方案 A：Cloudflare Workers + Durable Objects（已实现，免费）

**零服务器成本。** 代码位于 `workers/`（`index.js` 入口 + `room.js` 房间注册 DO），
协议与本地 `server/index.js` 完全一致，客户端零改动。

> ⚠️ **国内访问注意**：`*.workers.dev` 免费域名在中国大陆被墙（无法打开）。
> 国内使用必须绑定**你自己的域名**（付费域名约 ¥10-30/年，或免费的 eu.org
> 需申请审批）。海外/代理网络可直接用免费地址。
>
> 房间状态保存在单个 registry Durable Object 的内存中（WebSocket 休眠 API +
> alarm 定时清理），Worker 重新部署会丢房间——与旧单进程服务器同样的限制，
> 朋友间对局可接受。

#### 部署步骤（Cloudflare Workers Builds，GitHub 集成）

1. 注册 [Cloudflare](https://cloudflare.com) 账号（免费），并认领一个 `*.workers.dev` 子域名
2. Workers & Pages → Create → **Workers Builds** → 连接本项目 GitHub 仓库，填写：

   | 配置项 | 值 |
   |--------|-----|
   | 根目录 | `workers/` |
   | 构建命令 | 留空（代码零第三方依赖） |
   | 部署命令 | `npx wrangler deploy` |

3. 部署成功后得到 `https://gomoku-game.你的子域名.workers.dev`
4. （国内使用必做）购买/申请一个域名加入 Cloudflare → 该 Worker 的
   Settings → Domains & Routes → Add custom domain → 绑定 `ws.你的域名.com`
5. 把地址填到 `js/config.js`：

```js
wsUrl: "https://ws.你的域名.com", // 或 https://gomoku-game.你的子域名.workers.dev（仅海外可用）
```

> 填 `https://` 就行，代码里会自动转为 `wss://` WebSocket 地址。
> 也可不改文件，直接在 `index.html` 设置 `window.__GOMOKO_WS_URL` 临时覆盖。

#### 本地验证（可选）

```bash
cd workers
npx wrangler dev   # 本地模拟 Worker + Durable Object + WebSocket
```

浏览器开两个标签页：建房 → 加入 → 落子同步 → 关一个标签页再重连 → 重开换先。
离线协议级测试见 `tests/workers-room.test.mjs`（已纳入 `npm test`）。

---

### 方案 B：本机 + Cloudflare Tunnel（零成本，一键脚本）

适合临时玩，不需要任何云服务。已提供一键脚本：**双击项目根目录的
`play-online.bat`** → 自动启动游戏服务（`npm start`）+ 隧道，抓到公网
链接后**自动复制到剪贴板**，直接粘贴发给朋友；关掉窗口即断开通道。

> 前提：项目根目录放好 `cloudflared.exe`（[下载](https://developers.cloudflare.com/cloudflared/)）。
> 隧道把页面和 WebSocket 一起暴露，朋友直接打开链接即可玩，无需改任何配置。

手动方式（脚本的等价操作）：

1. 本机启动游戏服务：`npm start`
2. 启动 Tunnel：`cloudflared tunnel --url http://localhost:8000`
3. 把 `https://xxx.trycloudflare.com` 地址发给朋友

> ⚠️ Tunnel 关闭后地址失效，下次重启地址会变。电脑关机就不能玩；对局期间电脑不要睡眠。

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
