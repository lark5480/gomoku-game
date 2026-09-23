/**
 * Game Configuration
 *
 * 配置方式（优先级从高到低）：
 *   1. window.__GOMOKO_WS_URL 全局变量（index.html 中自行设置，页面默认不含此行）
 *   2. 下面 CONFIG.wsUrl
 *   3. 自动使用 location.host（本地开发默认）
 */

export const CONFIG = {
  /**
   * WebSocket server URL.
   * null = 自动使用 location.host（本地开发 + Cloudflare 部署均适用）
   * 如需分离部署，填入独立地址如 "wss://ws.example.com"
   */
  wsUrl: null,
};

// 部署方案详情见 docs/online-mode.md §生产部署（与下表注释保持同步）：
//   方案 A：Cloudflare Workers（推荐，免费）— 部署 workers/
//   方案 B：本机 + Cloudflare Tunnel（零成本）— cloudflared tunnel --url http://localhost:8000
//   方案 C：Zeabur / Render（国内可选）— 将 server/ 部署到云平台
