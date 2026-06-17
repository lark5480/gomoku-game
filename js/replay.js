/**
 * Replay module for Gomoku game records
 * Supports step-by-step playback with speed control
 */

import { Board } from "./board.js";
import { BOARD_SIZE, BOARD_PADDING } from "./utils.js";

export class ReplayPlayer {
  constructor() {
    this.moves = [];
    this.currentMove = -1;
    this.playing = false;
    this.speed = 1;
    this.timer = null;
    this.onChange = null; // callback(currentMove, totalMoves, playing)
    this.board = null;
  }

  /** Load a move array [{row, col, player}, ...] */
  load(moves) {
    this.stop();
    this.moves = moves;
    this.currentMove = -1;
    this.speed = 1;
  }

  get totalMoves() {
    return this.moves.length;
  }

  get isPlaying() {
    return this.playing;
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  play() {
    if (this.currentMove >= this.moves.length - 1) return;
    this.playing = true;
    this._scheduleNext();
    this._notify();
  }

  pause() {
    this.playing = false;
    clearTimeout(this.timer);
    this.timer = null;
    this._notify();
  }

  stop() {
    this.pause();
    this.currentMove = -1;
  }

  next() {
    if (this.currentMove >= this.moves.length - 1) return false;
    this.currentMove++;
    this._notify();
    return true;
  }

  prev() {
    if (this.currentMove <= 0) return false;
    this.currentMove--;
    this._notify();
    return true;
  }

  goto(n) {
    this.currentMove = Math.max(-1, Math.min(n, this.moves.length - 1));
    this._notify();
  }

  first() {
    this.goto(0);
  }

  last() {
    this.goto(this.moves.length - 1);
  }

  setSpeed(s) {
    this.speed = s;
    if (this.playing) {
      clearTimeout(this.timer);
      this._scheduleNext();
    }
    this._notify();
  }

  /**
   * Rebuild board state from scratch up to currentMove.
   * Returns a fresh Board with the moves applied.
   */
  buildBoard() {
    const board = new Board();
    for (let i = 0; i <= this.currentMove && i < this.moves.length; i++) {
      const m = this.moves[i];
      board.makeMove(m.row, m.col);
    }
    return board;
  }

  /** Get the move object at the current position (the last placed stone) */
  getCurrentMoveData() {
    if (this.currentMove < 0 || this.currentMove >= this.moves.length) return null;
    return this.moves[this.currentMove];
  }

  _scheduleNext() {
    const interval = 800 / this.speed;
    this.timer = setTimeout(() => {
      if (!this.playing) return;
      if (this.currentMove >= this.moves.length - 1) {
        this.pause();
        return;
      }
      this.next();
      this._scheduleNext();
    }, interval);
  }

  _notify() {
    if (this.onChange) {
      this.onChange(this.currentMove, this.totalMoves, this.playing);
    }
  }
}
