/**
 * Board class for Gomoku game
 * Manages game state and logic
 */

import {
  BOARD_SIZE,
  isValidPosition,
  getOppositePlayer,
  clone2DArray,
} from "./utils.js";

// Game states
export const GameState = {
  PLAYING: "playing",
  BLACK_WIN: "black_win",
  WHITE_WIN: "white_win",
  DRAW: "draw",
};

// Players
export const Player = {
  BLACK: "black",
  WHITE: "white",
};

// Directions for win checking
const DIRECTIONS = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal down-right
  [1, -1], // diagonal down-left
];

export class Board {
  constructor() {
    this.size = BOARD_SIZE;
    this.reset();
  }

  /**
   * Reset the board to initial state
   */
  reset() {
    // Create empty board (null = empty, 'black' or 'white' = stone)
    this.grid = Array(this.size)
      .fill()
      .map(() => Array(this.size).fill(null));
    this.currentPlayer = Player.BLACK;
    this.gameState = GameState.PLAYING;
    this.moveHistory = [];
    this.winningStones = [];
  }

  /**
   * Restore board state from a saved snapshot (e.g. online reconnect).
   * Does not preserve move history.
   * @param {string[][]} grid - 2D grid array
   * @param {string} currentPlayer - 'black' or 'white'
   * @param {string} gameState - One of GameState values
   */
  restoreState(grid, currentPlayer, gameState) {
    this.grid = clone2DArray(grid);
    this.currentPlayer = currentPlayer;
    this.gameState = gameState;
    this.moveHistory = [];
    this.winningStones = [];
  }

  /**
   * Make a move at specified position
   * @param {number} row - Row index (0-14)
   * @param {number} col - Column index (0-14)
   * @returns {boolean} True if move was successful
   */
  makeMove(row, col) {
    // Check if move is valid
    if (!this.isValidMove(row, col)) {
      return false;
    }

    // Place stone
    this.grid[row][col] = this.currentPlayer;
    this.moveHistory.push({ row, col, player: this.currentPlayer });

    // Check for win
    if (this.checkWin(row, col)) {
      this.gameState =
        this.currentPlayer === Player.BLACK
          ? GameState.BLACK_WIN
          : GameState.WHITE_WIN;
    } else if (this.isBoardFull()) {
      this.gameState = GameState.DRAW;
    } else {
      // Switch player
      this.currentPlayer = getOppositePlayer(this.currentPlayer);
    }

    return true;
  }

  /**
   * Check if a move is valid
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @returns {boolean} True if move is valid
   */
  isValidMove(row, col) {
    // Check if game is still playing
    if (this.gameState !== GameState.PLAYING) {
      return false;
    }

    // Check if position is within board
    if (!isValidPosition(row, col)) {
      return false;
    }

    // Check if position is empty
    return this.grid[row][col] === null;
  }

  /**
   * Check if the board is full
   * @returns {boolean} True if board is full
   */
  isBoardFull() {
    return this.grid.every((row) => row.every((cell) => cell !== null));
  }

  /**
   * Check for win from last move position
   * @param {number} row - Row of last move
   * @param {number} col - Column of last move
   * @returns {boolean} True if current player has won
   */
  checkWin(row, col) {
    const player = this.grid[row][col];
    if (!player) return false;

    this.winningStones = [];

    // Check each direction
    for (const [dr, dc] of DIRECTIONS) {
      let count = 1;
      let stones = [{ row, col }];

      // Check positive direction
      let r = row + dr;
      let c = col + dc;
      while (isValidPosition(r, c) && this.grid[r][c] === player) {
        count++;
        stones.push({ row: r, col: c });
        r += dr;
        c += dc;
      }

      // Check negative direction
      r = row - dr;
      c = col - dc;
      while (isValidPosition(r, c) && this.grid[r][c] === player) {
        count++;
        stones.push({ row: r, col: c });
        r -= dr;
        c -= dc;
      }

      // If we have 5 or more in a row, we have a win
      if (count >= 5) {
        this.winningStones = stones;
        return true;
      }
    }

    return false;
  }

  /**
   * Undo the last move
   * @returns {boolean} True if undo was successful
   */
  undo() {
    if (this.moveHistory.length === 0) {
      return false;
    }

    const lastMove = this.moveHistory.pop();
    this.grid[lastMove.row][lastMove.col] = null;

    // Reset game state to playing
    this.gameState = GameState.PLAYING;

    // Switch back to previous player
    this.currentPlayer = lastMove.player;

    // Clear winning stones
    this.winningStones = [];

    return true;
  }

  /**
   * Get board state as a 2D array
   * @returns {Array} 2D array representing board state
   */
  getState() {
    return clone2DArray(this.grid);
  }

  /**
   * Get current player
   * @returns {string} Current player ('black' or 'white')
   */
  getCurrentPlayer() {
    return this.currentPlayer;
  }

  /**
   * Get game state
   * @returns {string} Current game state
   */
  getGameState() {
    return this.gameState;
  }

  /**
   * Get winning stones positions
   * @returns {Array} Array of {row, col} objects for winning stones
   */
  getWinningStones() {
    return [...this.winningStones];
  }

  /**
   * Get move history
   * @returns {Array} Array of moves
   */
  getMoveHistory() {
    return [...this.moveHistory];
  }

  /**
   * Get cell value at position
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @returns {string|null} Cell value ('black', 'white', or null)
   */
  getCell(row, col) {
    if (!isValidPosition(row, col)) {
      return null;
    }
    return this.grid[row][col];
  }

  /**
   * Directly set a cell value without game logic (win check, player switch, history).
   * Used for heuristic scoring during move ordering.
   * @param {number} row
   * @param {number} col
   * @param {string|null} value - 'black', 'white', or null
   */
  setCellDirect(row, col, value) {
    if (isValidPosition(row, col)) {
      this.grid[row][col] = value;
    }
  }

  /**
   * Get all valid moves (empty positions adjacent to existing stones)
   * @returns {Array} Array of {row, col} objects
   */
  getValidMoves() {
    const moves = new Set();
    const directions = [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ];

    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (this.grid[row][col] !== null) {
          for (const [dr, dc] of directions) {
            const nr = row + dr;
            const nc = col + dc;
            if (isValidPosition(nr, nc) && this.grid[nr][nc] === null) {
              moves.add(`${nr},${nc}`);
            }
          }
        }
      }
    }

    return Array.from(moves).map((key) => {
      const [row, col] = key.split(",").map(Number);
      return { row, col };
    });
  }

  /**
   * Check if a cell is part of winning line
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @returns {boolean} True if cell is a winning stone
   */
  isWinningStone(row, col) {
    return this.winningStones.some(
      (stone) => stone.row === row && stone.col === col,
    );
  }

  /**
   * Create a deep copy of the board
   * @returns {Board} New Board instance with copied state
   */
  clone() {
    const copy = new Board();
    copy.size = this.size;
    copy.grid = clone2DArray(this.grid);
    copy.currentPlayer = this.currentPlayer;
    copy.gameState = this.gameState;
    copy.moveHistory = this.moveHistory.map((m) => ({ ...m }));
    copy.winningStones = this.winningStones.map((s) => ({ ...s }));
    return copy;
  }

  /**
   * Evaluate a line of 5 positions for AI scoring
   * @param {Array} line - Array of 5 cell values (null, 'black', or 'white')
   * @returns {number} Score for this line
   */
  static evaluateLine(line) {
    const counts = { black: 0, white: 0, empty: 0 };
    for (const cell of line) {
      if (cell === null) counts.empty++;
      else counts[cell]++;
    }

    if (counts.black > 0 && counts.white > 0) return 0;

    const player = counts.black > 0 ? "black" : "white";
    const count = counts[player];
    const openEnds = (line[0] === null ? 1 : 0) + (line[4] === null ? 1 : 0);

    if (count >= 5) return 100000;
    if (count === 4 && openEnds > 0) return openEnds === 2 ? 10000 : 1000;
    if (count === 3 && openEnds === 2) return 1000;
    if (count === 3 && openEnds === 1) return 100;
    if (count === 2 && openEnds === 2) return 100;
    if (count === 2 && openEnds === 1) return 10;
    if (count === 1 && openEnds === 2) return 10;

    return 0;
  }
}
