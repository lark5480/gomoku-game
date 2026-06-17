/**
 * Online multiplayer manager for Gomoku
 * Handles WebSocket connection, room management, and move synchronization
 */

export class OnlineManager {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.roomCode = null;
    this.myColor = null;
    this.inGame = false;

    // Callbacks — set by game.js
    this.onRoomCreated = null; // (roomCode) => {}
    this.onGameStart = null; // (myColor) => {}
    this.onOpponentMove = null; // ({row, col, player}) => {}
    this.onGameEnd = null; // ({winner, reason}) => {}
    this.onOpponentDisconnect = null; // () => {}
    this.onOpponentReconnect = null; // () => {}
    this.onError = null; // (message) => {}
    this.onChat = null; // (text) => {}
    this.onConnectionChange = null; // (connected) => {}
    this.onGameState = null; // ({grid, currentPlayer, state, winner}) => {}
  }

  /** Connect to the game server */
  connect() {
    if (this.ws && this.ws.readyState <= 1) return; // already open/connecting

    // Close existing connection cleanly
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.ws = new WebSocket(`${protocol}//${location.host}`);

    this.ws.onopen = () => {
      this.connected = true;
      this._notify("onConnectionChange", true);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.inGame = false;
      this._notify("onConnectionChange", false);
    };

    this.ws.onerror = () => {
      this.connected = false;
      this._notify("onConnectionChange", false);
    };

    this.ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this._handleMessage(msg);
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.inGame = false;
    this.roomCode = null;
    this.myColor = null;
  }

  /** Send a raw message */
  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Create a new room */
  createRoom() {
    this._send({ type: "create" });
  }

  /** Join an existing room by code */
  joinRoom(code) {
    this.roomCode = code;
    this._send({ type: "join", roomCode: code });
  }

  /** Send a move to the server */
  sendMove(row, col) {
    this._send({ type: "move", row, col });
  }

  /** Surrender the current game (online mode) */
  sendSurrender() {
    this._send({ type: "surrender" });
  }

  /** Request a game restart (online mode) */
  sendRestart() {
    this._send({ type: "restart" });
  }

  /** Send a chat message */
  sendChat(text) {
    this._send({ type: "chat", text });
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case "room:created":
        this.roomCode = msg.roomCode;
        this.myColor = msg.color;
        this._notify("onRoomCreated", msg.roomCode);
        break;

      case "room:joined":
        this.myColor = msg.color;
        break;

      case "game:start":
        this.inGame = true;
        this._notify("onGameStart", this.myColor);
        break;

      case "move":
        this._notify("onOpponentMove", { row: msg.row, col: msg.col, player: msg.player });
        break;

      case "game:end":
        this.inGame = false;
        this._notify("onGameEnd", { winner: msg.winner, reason: msg.reason });
        break;

      case "game:state":
        this._notify("onGameState", msg);
        break;

      case "opponent:disconnect":
        this._notify("onOpponentDisconnect");
        break;

      case "opponent:reconnect":
        this._notify("onOpponentReconnect");
        break;

      case "chat":
        this._notify("onChat", msg.text);
        break;

      case "error":
        this._notify("onError", msg.message);
        break;

      case "game:restart":
        this.inGame = true;
        this._notify("onGameRestart");
        break;

      case "room:closed":
        this.inGame = false;
        this._notify("onError", "房间已关闭");
        break;
    }
  }

  _notify(callbackName, ...args) {
    const fn = this[callbackName];
    if (typeof fn === "function") fn(...args);
  }
}
