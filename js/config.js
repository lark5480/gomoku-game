/**
 * Game Configuration
 *
 * 本地开发：WebSocket 自动使用 location.host（默认行为，无需修改）
 * 生产部署（如 Netlify + Render）：
 *   1. 将 server/ 部署到 Render / Railway / Fly.io
 *   2. 把下面的 wsUrl 改为你的服务器地址，例如：
 *      "wss://gomoku-server.onrender.com"
 *   3. 也可以不改文件，在 index.html 中 <script> 前设置全局变量：
 *      window.__GOMOKO_WS_URL = "wss://gomoku-server.onrender.com";
 */

export const CONFIG = {
  /**
   * WebSocket server URL.
   * null = 自动使用 location.host（本地开发）
   * 生产环境改为你的服务器地址，如 "wss://xxx.trycloudflare.com"
   */
  wsUrl: "wss://logos-eight-standard-neck.trycloudflare.com",
};
