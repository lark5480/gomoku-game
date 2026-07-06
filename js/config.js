/**
 * Game Configuration
 *
 * 本地开发：WebSocket 自动使用 location.host（默认行为，无需修改）
 * 生产部署：
 *   方案一：Cloudflare Workers（推荐，免费）
 *     - 部署 workers/ 到 Cloudflare → 拿到 https://gomoku-server.xxx.workers.dev
 *  方案二：本机 + Cloudflare Tunnel（零成本）
 *     - cloudflared tunnel --url http://localhost:8000
 *  方案三：Render / Railway / Fly.io
 *     - 将 server/ 部署到云平台
 *
 * 配置方式（优先级从高到低）：
 *   1. window.__GOMOKO_WS_URL 全局变量（index.html 中设置）
 *   2. 下面 CONFIG.wsUrl
 *   3. 自动使用 location.host（本地开发默认）
 */

export const CONFIG = {
  /**
   * WebSocket server URL.
   * null = 自动使用 location.host（本地开发）
   * 生产环境改为你的服务器地址，如 "wss://xxx.trycloudflare.com"
   */
  wsUrl: "wss://logos-eight-standard-neck.trycloudflare.com",
};
