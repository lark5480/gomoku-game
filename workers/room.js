/**
 * Registry Durable Object for Gomoku online mode.
 *
 * One instance holds every room in memory and relays the WebSocket protocol,
 * mirroring server/index.js. The message protocol is unchanged, so the
 * existing client works without modification.
 *
 * Lifecycle notes:
 * - WebSockets use the Hibernation API (WebSocketPair + acceptWebSocket), so
 *   idle connections cost nothing and survive DO restarts gracefully.
 * - A single alarm drives both the 30s reconnect judgment and the 10-minute
 *   room TTL cleanup. While rooms exist the alarm is always pending, which
 *   also keeps the DO from being evicted.
 * - Room state is in-memory only. A Worker redeploy mid-game drops rooms —
 *   the same caveat as the old single-process server.
 *
 * Note: WebSocketPair is a Workers runtime GLOBAL (not an export of
 * 'cloudflare:workers'); the test harness injects it as a function parameter.
 */

const BOARD_SIZE = 15;
const ROOM_TTL_MS = 10 * 60 * 1000; // 10 minutes without activity
const RECONNECT_TIMEOUT_MS = 30 * 1000; // 30 seconds to reconnect
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    /** @type {Map<string, object>} room code -> room state */
    this.rooms = new Map();
    /** @type {Map<WebSocket, string>} socket -> room code */
    this.socketToRoom = new Map();
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ==================== WebSocket lifecycle ====================

  async webSocketMessage(ws, message) {
    let msg;
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
      msg = JSON.parse(text);
    } catch {
      this._send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'create': {
        this._leaveCurrentRoom(ws);

        const code = this._generateRoomCode();
        const room = {
          code,
          players: [ws], // [host, guest]; a null slot appears only after a disconnect
          grid: Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null)),
          currentPlayer: 'black',
          state: 'waiting', // waiting | playing | finished
          winner: null,
          colorSwap: false, // restart swaps colors
          lastActivity: Date.now(),
          reconnectDeadline: 0,
        };
        this.rooms.set(code, room);
        this.socketToRoom.set(ws, code);

        this._send(ws, { type: 'room:created', roomCode: code, color: 'black' });
        this._rescheduleAlarm();
        break;
      }

      case 'join': {
        const code = (msg.roomCode || '').toUpperCase().trim();
        const room = this.rooms.get(code);

        if (!room) {
          this._send(ws, { type: 'error', message: '房间不存在' });
          return;
        }

        const disconnectedIdx = room.players.indexOf(null);
        if (room.players.length >= 2 && disconnectedIdx === -1) {
          this._send(ws, { type: 'error', message: '房间已满' });
          return;
        }

        if (disconnectedIdx !== -1) {
          // Reconnect: replace the disconnected slot
          this._leaveCurrentRoom(ws);
          room.players[disconnectedIdx] = ws;
          this.socketToRoom.set(ws, code);
          room.reconnectDeadline = 0;
          this._touch(room);

          this._send(ws, {
            type: 'room:joined',
            color: this._playerColor(room, disconnectedIdx),
            opponentReady: true,
          });
          const opponent = room.players[1 - disconnectedIdx];
          if (opponent) this._send(opponent, { type: 'opponent:reconnect' });
          this._send(ws, {
            type: 'game:state',
            grid: room.grid,
            currentPlayer: room.currentPlayer,
            state: room.state,
            winner: room.winner,
          });
          break;
        }

        // Normal join
        this._leaveCurrentRoom(ws);
        room.players.push(ws);
        this.socketToRoom.set(ws, code);
        this._touch(room);

        this._send(ws, { type: 'room:joined', color: 'white', opponentReady: true });

        room.state = 'playing';
        this._broadcast(room, { type: 'game:start' });
        break;
      }

      case 'move': {
        const room = this._roomOf(ws);
        if (!room || room.state !== 'playing') return;

        const { row, col } = msg;
        if (
          !Number.isInteger(row) ||
          !Number.isInteger(col) ||
          row < 0 ||
          row >= BOARD_SIZE ||
          col < 0 ||
          col >= BOARD_SIZE ||
          room.grid[row][col] !== null
        ) {
          return;
        }

        const idx = room.players.indexOf(ws);
        const playerColor = this._playerColor(room, idx);
        if (playerColor !== room.currentPlayer) {
          this._send(ws, { type: 'error', message: '不是你的回合' });
          return;
        }

        room.grid[row][col] = playerColor;
        this._touch(room);
        this._broadcast(room, { type: 'move', row, col, player: playerColor });

        if (this._checkWin(room, row, col, playerColor)) {
          room.state = 'finished';
          room.winner = playerColor;
          room.reconnectDeadline = 0;
          this._broadcast(room, { type: 'game:end', winner: playerColor });
          break;
        }
        if (this._isBoardFull(room)) {
          room.state = 'finished';
          room.winner = null;
          room.reconnectDeadline = 0;
          this._broadcast(room, { type: 'game:end', winner: null });
          break;
        }

        room.currentPlayer = room.currentPlayer === 'black' ? 'white' : 'black';
        break;
      }

      case 'surrender': {
        const room = this._roomOf(ws);
        if (!room || room.state !== 'playing') return;

        const idx = room.players.indexOf(ws);
        const playerColor = this._playerColor(room, idx);
        const winnerColor = playerColor === 'black' ? 'white' : 'black';

        room.state = 'finished';
        room.winner = winnerColor;
        room.reconnectDeadline = 0;
        this._touch(room);

        this._broadcast(room, {
          type: 'game:end',
          winner: winnerColor,
          reason: 'surrender',
        });
        break;
      }

      case 'restart': {
        const room = this._roomOf(ws);
        if (!room || room.state !== 'finished') return;

        room.colorSwap = !room.colorSwap;
        room.grid = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
        room.currentPlayer = 'black';
        room.state = 'playing';
        room.winner = null;
        room.reconnectDeadline = 0;
        this._touch(room);

        // Colors may differ per player after the swap — send individually
        room.players.forEach((p, i) => {
          if (p) this._send(p, { type: 'game:restart', color: this._playerColor(room, i) });
        });
        break;
      }

      case 'chat': {
        const room = this._roomOf(ws);
        if (!room) return;
        const idx = room.players.indexOf(ws);
        const opponent = room.players[1 - idx];
        if (opponent) this._send(opponent, { type: 'chat', text: msg.text || '' });
        break;
      }
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    this._handleDisconnect(ws);
  }

  async webSocketError(ws, error) {
    this._handleDisconnect(ws);
  }

  // ==================== Scheduled maintenance ====================

  async alarm() {
    const now = Date.now();

    for (const [code, room] of [...this.rooms]) {
      // Reconnect timeout: the missing player loses
      if (room.state === 'playing' && room.reconnectDeadline > 0 && now >= room.reconnectDeadline) {
        const idx = room.players.indexOf(null);
        if (idx !== -1) {
          room.state = 'finished';
          // Winner is the remaining player's actual color (colorSwap-aware,
          // unlike a fixed slot-to-color mapping).
          const opponentIdx = 1 - idx;
          const winnerColor = this._playerColor(room, opponentIdx);
          room.winner = winnerColor;
          room.reconnectDeadline = 0;
          const opponent = room.players[opponentIdx];
          if (opponent) {
            this._send(opponent, {
              type: 'game:end',
              winner: winnerColor,
              reason: 'disconnect',
            });
          }
        }
      }

      // Room TTL: no activity for ROOM_TTL_MS -> close the room
      if (now - room.lastActivity > ROOM_TTL_MS) {
        this._broadcast(room, { type: 'room:closed', reason: 'timeout' });
        for (const p of room.players) {
          if (p) {
            try {
              p.close(1000, 'room expired');
            } catch {
              // already closed
            }
          }
        }
        this.rooms.delete(code);
        for (const [sock, c] of this.socketToRoom) {
          if (c === code) this.socketToRoom.delete(sock);
        }
      }
    }

    this._rescheduleAlarm();
  }

  // ==================== Helpers ====================

  _roomOf(ws) {
    const code = this.socketToRoom.get(ws);
    return code ? this.rooms.get(code) : null;
  }

  _handleDisconnect(ws) {
    const code = this.socketToRoom.get(ws);
    if (!code) return;
    this.socketToRoom.delete(ws);

    const room = this.rooms.get(code);
    if (!room) return;

    const idx = room.players.indexOf(ws);
    if (idx !== -1) room.players[idx] = null;

    const opponent = room.players.find((p) => p !== null);
    if (!opponent) {
      // Both players gone: let the TTL clean up
      this._touch(room);
      return;
    }

    this._send(opponent, { type: 'opponent:disconnect' });

    if (room.state === 'playing') {
      room.reconnectDeadline = Date.now() + RECONNECT_TIMEOUT_MS;
      this._rescheduleAlarm();
    }
  }

  _leaveCurrentRoom(ws) {
    if (this.socketToRoom.has(ws)) this._handleDisconnect(ws);
  }

  _playerColor(room, idx) {
    let color;
    if (idx === 0) color = 'black';
    else if (idx === 1) color = 'white';
    else return null;
    return room.colorSwap ? (color === 'black' ? 'white' : 'black') : color;
  }

  _touch(room) {
    room.lastActivity = Date.now();
    this._rescheduleAlarm();
  }

  /** Arm the alarm at the earliest pending deadline (0 = none). */
  _rescheduleAlarm() {
    let next = 0;
    for (const room of this.rooms.values()) {
      const deadline = Math.max(room.lastActivity + ROOM_TTL_MS, room.reconnectDeadline);
      if (!next || deadline < next) next = deadline;
    }
    if (next) this.state.storage.setAlarm(next);
  }

  _generateRoomCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  _send(ws, msg) {
    if (!ws) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already closed; the close handler cleans up.
    }
  }

  _broadcast(room, msg, excludeWs = null) {
    for (const p of room.players) {
      if (p && p !== excludeWs) this._send(p, msg);
    }
  }

  _checkWin(room, row, col, player) {
    const dirs = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ];
    for (const [dr, dc] of dirs) {
      let count = 1;
      for (let d = 1; d < 5; d++) {
        const r = row + dr * d;
        const c = col + dc * d;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break;
        if (room.grid[r][c] !== player) break;
        count++;
      }
      for (let d = 1; d < 5; d++) {
        const r = row - dr * d;
        const c = col - dc * d;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break;
        if (room.grid[r][c] !== player) break;
        count++;
      }
      if (count >= 5) return true;
    }
    return false;
  }

  _isBoardFull(room) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (room.grid[r][c] === null) return false;
      }
    }
    return true;
  }
}
