import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";

const PORT = 8000;
const BOARD_SIZE = 15;
const ROOM_TTL = 10 * 60 * 1000; // 10 minutes
const RECONNECT_TIMEOUT = 30 * 1000; // 30 seconds

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

// ==================== Static File Server ====================

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method Not Allowed");
    return;
  }

  let filePath = "." + req.url;
  if (filePath === "./") filePath = "./index.html";

  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(path.resolve("."))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const extname = path.extname(filePath);
  const contentType = MIME_TYPES[extname] || "application/octet-stream";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404);
        res.end("File not found");
      } else {
        res.writeHead(500);
        res.end("Server error: " + err.code);
      }
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
});

// ==================== Room Management ====================

/** @type {Map<string, Room>} */
const rooms = new Map();

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

class Room {
  constructor(code, hostWs) {
    this.code = code;
    this.players = [hostWs]; // [host, guest]
    this.grid = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
    this.currentPlayer = "black"; // black goes first
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
    const data = JSON.stringify(msg);
    for (const p of this.players) {
      if (p && p !== excludeWs && p.readyState === 1) {
        p.send(data);
      }
    }
  }

  send(ws, msg) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }

  checkWin(row, col, player) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      let count = 1;
      for (let d = 1; d < 5; d++) {
        const r = row + dr * d, c = col + dc * d;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break;
        if (this.grid[r][c] !== player) break;
        count++;
      }
      for (let d = 1; d < 5; d++) {
        const r = row - dr * d, c = col - dc * d;
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

// Periodically clean up stale rooms
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL) {
      room.broadcast({ type: "room:closed", reason: "timeout" });
      for (const p of room.players) {
        if (p) p.close();
      }
      rooms.delete(code);
      console.log(`Room ${code} expired and cleaned up`);
    }
  }
}, 60 * 1000);

// ==================== WebSocket Server ====================

const wss = new WebSocketServer({ server });

// Map ws -> room for quick lookup
/** @type {Map<import('ws').WebSocket, Room>} */
const wsRoomMap = new Map();

wss.on("connection", (ws) => {
  console.log("WebSocket client connected");

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    handleMessage(ws, msg);
  });

  ws.on("close", () => {
    handleDisconnect(ws);
  });

  ws.on("error", () => {
    handleDisconnect(ws);
  });
});

function handleMessage(ws, msg) {
  switch (msg.type) {
    case "create": {
      // Close existing room if player was in one
      leaveCurrentRoom(ws);

      const code = generateRoomCode();
      const room = new Room(code, ws);
      rooms.set(code, room);
      wsRoomMap.set(ws, room);

      room.send(ws, { type: "room:created", roomCode: code, color: "black" });
      console.log(`Room ${code} created`);
      break;
    }

    case "join": {
      const code = (msg.roomCode || "").toUpperCase().trim();
      const room = rooms.get(code);

      if (!room) {
        ws.send(JSON.stringify({ type: "error", message: "房间不存在" }));
        return;
      }
      if (room.full) {
        // Check if reconnecting
        const existingIdx = room.playerIndex(null); // check for disconnected slot
        if (existingIdx === -1) {
          ws.send(JSON.stringify({ type: "error", message: "房间已满" }));
          return;
        }
        // Reconnect: replace the null slot
        room.players[existingIdx] = ws;
        wsRoomMap.set(ws, room);
        room.send(ws, {
          type: "room:joined",
          color: existingIdx === 0 ? "black" : "white",
          opponentReady: true,
        });
        const opponent = room.opponentOf(ws);
        if (opponent) {
          room.send(opponent, { type: "opponent:reconnect" });
        }
        // Resend game state
        room.send(ws, {
          type: "game:state",
          grid: room.grid,
          currentPlayer: room.currentPlayer,
          state: room.state,
          winner: room.winner,
        });
        room.touch();
        console.log(`Player reconnected to room ${code}`);
        return;
      }

      // Normal join
      leaveCurrentRoom(ws);
      room.players.push(ws);
      wsRoomMap.set(ws, room);
      room.touch();

      room.send(ws, { type: "room:joined", color: "white", opponentReady: true });

      // Both players ready — start game
      room.state = "playing";
      room.broadcast({ type: "game:start" });
      console.log(`Room ${code} game started`);
      break;
    }

    case "move": {
      const room = wsRoomMap.get(ws);
      if (!room || room.state !== "playing") return;

      const { row, col } = msg;
      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return;
      if (room.grid[row][col] !== null) return;

      const playerColor = room.playerColor(ws);
      if (playerColor !== room.currentPlayer) {
        room.send(ws, { type: "error", message: "不是你的回合" });
        return;
      }

      // Apply move
      room.grid[row][col] = playerColor;
      room.touch();

      // Broadcast move to both players
      room.broadcast({ type: "move", row, col, player: playerColor });

      // Check win
      if (room.checkWin(row, col, playerColor)) {
        room.state = "finished";
        room.winner = playerColor;
        room.broadcast({ type: "game:end", winner: playerColor });
        console.log(`Room ${room.code}: ${playerColor} wins`);
        return;
      }

      // Check draw
      if (room.isBoardFull()) {
        room.state = "finished";
        room.winner = null;
        room.broadcast({ type: "game:end", winner: null });
        console.log(`Room ${room.code}: draw`);
        return;
      }

      // Switch turn
      room.currentPlayer = room.currentPlayer === "black" ? "white" : "black";
      break;
    }

    case "restart": {
      const room = wsRoomMap.get(ws);
      if (!room || room.state !== "finished") return;

      // Reset room state for a new game
      room.grid = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
      room.currentPlayer = "black";
      room.state = "playing";
      room.winner = null;
      room.touch();

      if (room.disconnectTimer) {
        clearTimeout(room.disconnectTimer);
        room.disconnectTimer = null;
      }

      // Notify both players — black goes first
      room.broadcast({ type: "game:restart" });
      console.log(`Room ${room.code}: game restarted`);
      break;
    }

    case "chat": {
      const room = wsRoomMap.get(ws);
      if (!room) return;
      const opponent = room.opponentOf(ws);
      if (opponent) {
        room.send(opponent, { type: "chat", text: msg.text || "" });
      }
      break;
    }
  }
}

function handleDisconnect(ws) {
  const room = wsRoomMap.get(ws);
  if (!room) return;

  wsRoomMap.delete(ws);

  // Mark player slot as disconnected (set to null for reconnect)
  const idx = room.playerIndex(ws);
  if (idx !== -1) {
    room.players[idx] = null;
  }

  const opponent = room.players.find((p) => p !== null);

  if (!opponent) {
    // Both gone, clean up after TTL
    room.touch();
    return;
  }

  // Notify opponent
  room.send(opponent, { type: "opponent:disconnect" });

  // Set reconnect timer — if player doesn't reconnect, opponent wins
  if (room.state === "playing") {
    room.disconnectTimer = setTimeout(() => {
      if (room.players[idx] === null) {
        room.state = "finished";
        const winnerColor = idx === 0 ? "white" : "black";
        room.winner = winnerColor;
        room.send(opponent, { type: "game:end", winner: winnerColor, reason: "disconnect" });
        console.log(`Room ${room.code}: player disconnected, ${winnerColor} wins`);
      }
    }, RECONNECT_TIMEOUT);
  }

  console.log(`Player disconnected from room ${room.code}`);
}

function leaveCurrentRoom(ws) {
  const room = wsRoomMap.get(ws);
  if (!room) return;
  handleDisconnect(ws);
}

// ==================== Start Server ====================

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`WebSocket available at ws://localhost:${PORT}/`);
  console.log("Open your browser and navigate to the above URL");
  console.log("Press Ctrl+C to stop the server");
});
