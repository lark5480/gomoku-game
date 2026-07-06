/**
 * Gomoku Game Server — Cloudflare Workers 版
 *
 * 兼容现有 WebSocket 协议，客户端零改动。
 * 单 Worker 模式，用内存 Map 管理房间（无需 Durable Objects）。
 *
 * 局限：如果两个玩家被路由到不同的 Worker 实例，房间状态不可见。
 * 实际上同地区玩家大概率路由到同一实例，对局不受影响。
 */

const BOARD_SIZE = 15;
const ROOM_TTL = 10 * 60 * 1000; // 10 分钟无活动自动清理
const RECONNECT_TIMEOUT = 30 * 1000; // 30 秒重连窗口

// ==================== 房间状态（内存） ====================

/** @type {Map<string, Room>} */
const rooms = new Map();

/** @type {Map<WebSocket, string>} */
const wsRoomMap = new Map();

/** @type {Map<WebSocket, number>} */
const wsIndexMap = new Map();

// ==================== Worker 入口 ====================

let cleanupStarted = false;

/** 启动房间清理定时器（必须在 feth 处理函数内调用） */
function startCleanupTimer() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (now - room.lastActivity > ROOM_TTL) {
        room.broadcast({ type: "room:closed", reason: "timeout" });
        for (const p of room.players) {
          if (p) {
            try {
              p.close();
            } catch {}
          }
        }
        rooms.delete(code);
      }
    }
  }, 60 * 1000);
}

export default {
  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    // 确保清理定时器已启动（Worker 限制：全局作用域不能调 setInterval）
    startCleanupTimer();

    // CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // WebSocket 升级
    if (request.headers.get("Upgrade") === "websocket") {
      return handleWebSocketUpgrade(request);
    }

    // 健康检查
    return new Response("Gomoku Game Server (Cloudflare Workers)", {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  },
};

// ==================== WebSocket 连接处理 ====================

/**
 * @param {Request} request
 * @returns {Response}
 */
function handleWebSocketUpgrade(request) {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];

  server.accept();

  server.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(server, msg);
    } catch {
      // 忽略无效 JSON
    }
  });

  server.addEventListener("close", () => {
    handleDisconnect(server);
  });

  server.addEventListener("error", () => {
    handleDisconnect(server);
  });

  return new Response(null, { status: 101, webSocket: client });
}

// ==================== 消息处理 ====================

/**
 * @param {WebSocket} ws
 * @param {object} msg
 */
function handleMessage(ws, msg) {
  switch (msg.type) {
    case "create":
      handleCreate(ws);
      break;
    case "join":
      handleJoin(ws, (msg.roomCode || "").toUpperCase().trim());
      break;
    case "move":
      handleMove(ws, msg);
      break;
    case "surrender":
      handleSurrender(ws);
      break;
    case "restart":
      handleRestart(ws);
      break;
    case "chat":
      handleChat(ws, msg.text || "");
      break;
  }
}

// ---- 创建房间 ----

function handleCreate(ws) {
  leaveCurrentRoom(ws);

  const code = generateRoomCode();
  const room = new Room(code, ws);
  rooms.set(code, room);
  wsRoomMap.set(ws, code);
  wsIndexMap.set(ws, 0);

  send(ws, { type: "room:created", roomCode: code, color: "black" });
}

// ---- 加入房间 ----

function handleJoin(ws, code) {
  const room = rooms.get(code);

  if (!room) {
    send(ws, { type: "error", message: "房间不存在" });
    return;
  }

  if (room.full) {
    // 重连：检查是否有空槽位（断开连接留下的 null）
    const emptyIdx = room.players.indexOf(null);
    if (emptyIdx === -1) {
      send(ws, { type: "error", message: "房间已满" });
      return;
    }
    // 重连
    room.players[emptyIdx] = ws;
    wsRoomMap.set(ws, code);
    wsIndexMap.set(ws, emptyIdx);

    const color = emptyIdx === 0 ? "black" : "white";
    send(ws, { type: "room:joined", color, opponentReady: true });

    // 通知对手
    const opponent = room.opponentOf(ws);
    if (opponent) {
      send(opponent, { type: "opponent:reconnect" });
    }

    // 恢复棋盘状态
    send(ws, {
      type: "game:state",
      grid: room.grid,
      currentPlayer: room.currentPlayer,
      state: room.state,
      winner: room.winner,
    });
    return;
  }

  // 正常加入
  leaveCurrentRoom(ws);
  room.players.push(ws);
  wsRoomMap.set(ws, code);
  wsIndexMap.set(ws, 1);
  room.touch();

  send(ws, { type: "room:joined", color: "white", opponentReady: true });

  // 双方就绪，开始游戏
  room.state = "playing";
  room.broadcast({ type: "game:start" });
}

// ---- 落子 ----

function handleMove(ws, msg) {
  const roomCode = wsRoomMap.get(ws);
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  if (!room || room.state !== "playing") return;

  const { row, col } = msg;
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return;
  if (room.grid[row][col] !== null) return;

  const playerColor = room.playerColor(ws);
  if (playerColor !== room.currentPlayer) {
    send(ws, { type: "error", message: "不是你的回合" });
    return;
  }

  // 落子
  room.grid[row][col] = playerColor;
  room.touch();
  room.broadcast({ type: "move", row, col, player: playerColor });

  // 检查胜利
  if (room.checkWin(row, col, playerColor)) {
    room.state = "finished";
    room.winner = playerColor;
    room.broadcast({ type: "game:end", winner: playerColor });
    return;
  }

  // 检查平局
  if (room.isBoardFull()) {
    room.state = "finished";
    room.winner = null;
    room.broadcast({ type: "game:end", winner: null });
    return;
  }

  // 切换回合
  room.currentPlayer = room.currentPlayer === "black" ? "white" : "black";
}

// ---- 认输 ----

function handleSurrender(ws) {
  const roomCode = wsRoomMap.get(ws);
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  if (!room || room.state !== "playing") return;

  const playerColor = room.playerColor(ws);
  const winnerColor = playerColor === "black" ? "white" : "black";

  room.state = "finished";
  room.winner = winnerColor;
  room.touch();

  if (room.disconnectTimer) {
    clearTimeout(room.disconnectTimer);
    room.disconnectTimer = null;
  }

  room.broadcast({
    type: "game:end",
    winner: winnerColor,
    reason: "surrender",
  });
}

// ---- 重新开始 ----

function handleRestart(ws) {
  const roomCode = wsRoomMap.get(ws);
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  if (!room || room.state !== "finished") return;

  // 重置房间
  room.grid = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(null),
  );
  room.currentPlayer = "black";
  room.state = "playing";
  room.winner = null;
  room.touch();

  if (room.disconnectTimer) {
    clearTimeout(room.disconnectTimer);
    room.disconnectTimer = null;
  }

  room.broadcast({ type: "game:restart" });
}

// ---- 聊天 ----

function handleChat(ws, text) {
  const roomCode = wsRoomMap.get(ws);
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  if (!room) return;

  const opponent = room.opponentOf(ws);
  if (opponent) {
    send(opponent, { type: "chat", text });
  }
}

// ---- 断线处理 ----

function handleDisconnect(ws) {
  const roomCode = wsRoomMap.get(ws);
  if (!roomCode) return;

  const room = rooms.get(roomCode);
  if (!room) return;

  wsRoomMap.delete(ws);
  const idx = wsIndexMap.get(ws);
  wsIndexMap.delete(ws);

  if (idx !== undefined) {
    room.players[idx] = null;
  }

  const opponent = room.players.find((p) => p !== null);
  if (!opponent) {
    // 都走了，等 TTL 清理
    room.touch();
    return;
  }

  send(opponent, { type: "opponent:disconnect" });

  if (room.state === "playing") {
    room.disconnectTimer = setTimeout(() => {
      if (room.players[idx] === null) {
        room.state = "finished";
        const winnerColor = idx === 0 ? "white" : "black";
        room.winner = winnerColor;
        send(opponent, {
          type: "game:end",
          winner: winnerColor,
          reason: "disconnect",
        });
      }
    }, RECONNECT_TIMEOUT);
  }
}

// ---- 离开当前房间 ----

function leaveCurrentRoom(ws) {
  const roomCode = wsRoomMap.get(ws);
  if (!roomCode) return;

  const room = rooms.get(roomCode);
  if (!room) return;

  wsRoomMap.delete(ws);
  const idx = wsIndexMap.get(ws);
  wsIndexMap.delete(ws);
  if (idx !== undefined) {
    room.players[idx] = null;
  }
}

// ---- 辅助函数 ----

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

// ==================== Room 类 ====================

class Room {
  constructor(code, hostWs) {
    this.code = code;
    this.players = [hostWs]; // [黑, 白]
    this.grid = Array.from({ length: BOARD_SIZE }, () =>
      Array(BOARD_SIZE).fill(null),
    );
    this.currentPlayer = "black";
    this.state = "waiting"; // waiting | playing | finished
    this.winner = null;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.disconnectTimer = null;
  }

  get full() {
    return this.players.length >= 2;
  }

  playerIndex(ws) {
    return this.players.indexOf(ws);
  }

  playerColor(ws) {
    const idx = this.playerIndex(ws);
    if (idx === 0) return "black";
    if (idx === 1) return "white";
    return null;
  }

  opponentOf(ws) {
    const idx = this.playerIndex(ws);
    if (idx === 0) return this.players[1];
    if (idx === 1) return this.players[0];
    return null;
  }

  broadcast(msg, excludeWs = null) {
    for (const p of this.players) {
      if (p && p !== excludeWs && p.readyState === WebSocket.OPEN) {
        p.send(JSON.stringify(msg));
      }
    }
  }

  checkWin(row, col, player) {
    const dirs = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ];
    for (const [dr, dc] of dirs) {
      let count = 1;
      for (let d = 1; d < 5; d++) {
        const r = row + dr * d,
          c = col + dc * d;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break;
        if (this.grid[r][c] !== player) break;
        count++;
      }
      for (let d = 1; d < 5; d++) {
        const r = row - dr * d,
          c = col - dc * d;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break;
        if (this.grid[r][c] !== player) break;
        count++;
      }
      if (count >= 5) return true;
    }
    return false;
  }

  isBoardFull() {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (this.grid[r][c] === null) return false;
      }
    }
    return true;
  }

  touch() {
    this.lastActivity = Date.now();
  }
}
