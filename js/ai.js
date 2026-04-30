/**
 * AI Module for Gomoku
 * Implements AIPlayer class with multiple difficulty levels
 */

import { Board, Player } from "./board.js";
import { BOARD_SIZE, isValidPosition } from "./utils.js";

// Pattern scores
const SCORES = {
  FIVE: 100000,
  LIVE_FOUR: 10000,
  RUSH_FOUR: 1000,
  LIVE_THREE: 5000,
  SLEEP_THREE: 500,
  LIVE_TWO: 500,
  SLEEP_TWO: 50,
  ONE: 5,
};

// Directions for pattern detection
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export class AIPlayer {
  constructor(board, difficulty = "medium") {
    this.board = board;
    this.difficulty = difficulty;
    this.transpositionTable = new Map();
  }

  /**
   * Get the best move for AI
   * @returns {Object} Best position {row, col}
   */
  getMove() {
    const validMoves = this.board.getValidMoves();

    if (validMoves.length === 0) {
      return { row: 7, col: 7 };
    }

    if (validMoves.length === 1) {
      return validMoves[0];
    }

    switch (this.difficulty) {
      case "easy":
        return this.getMoveEasy(validMoves);
      case "hard":
        return this.getMoveHard(validMoves);
      case "medium":
      default:
        return this.getMoveMedium(validMoves);
    }
  }

  /**
   * Easy mode: random from top candidates
   */
  getMoveEasy(validMoves) {
    const scored = validMoves.map((m) => ({
      ...m,
      score: this.evaluatePosition(m.row, m.col),
    }));
    scored.sort((a, b) => b.score - a.score);

    const topCount = Math.min(5, scored.length);
    const topMoves = scored.slice(0, topCount);
    return topMoves[Math.floor(Math.random() * topMoves.length)];
  }

  /**
   * Medium mode: alpha-beta depth 2
   */
  getMoveMedium(validMoves) {
    let bestScore = -Infinity;
    let bestMove = validMoves[0];

    for (const move of validMoves) {
      const boardClone = this.board.clone();
      boardClone.makeMove(move.row, move.col);

      const score = -this.alphaBeta(boardClone, 1, -Infinity, Infinity);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  /**
   * Hard mode: alpha-beta depth 3 with transposition table
   */
  getMoveHard(validMoves) {
    let bestScore = -Infinity;
    let bestMove = validMoves[0];

    for (const move of validMoves) {
      const boardClone = this.board.clone();
      boardClone.makeMove(move.row, move.col);

      const key = this.getBoardKey(boardClone);
      if (this.transpositionTable.has(key)) {
        const cached = this.transpositionTable.get(key);
        if (cached.depth >= 3) {
          if (cached.score > bestScore) {
            bestScore = cached.score;
            bestMove = move;
          }
          continue;
        }
      }

      const score = -this.alphaBeta(boardClone, 3, -Infinity, Infinity);
      this.transpositionTable.set(key, { score, depth: 3 });

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  /**
   * Alpha-beta pruning search
   */
  alphaBeta(board, depth, alpha, beta) {
    if (depth === 0) {
      return this.evaluateBoard(board);
    }

    const validMoves = board.getValidMoves();
    if (validMoves.length === 0 || board.getGameState() !== "playing") {
      return this.evaluateBoard(board);
    }

    const key = this.getBoardKey(board);
    if (this.transpositionTable.has(key)) {
      const cached = this.transpositionTable.get(key);
      if (cached.depth >= depth) {
        return cached.score;
      }
    }

    for (const move of validMoves) {
      const boardClone = board.clone();
      boardClone.makeMove(move.row, move.col);

      const score = -this.alphaBeta(boardClone, depth - 1, -beta, -alpha);
      if (score > alpha) {
        alpha = score;
      }
      if (alpha >= beta) {
        beta = alpha;
        break;
      }
    }

    this.transpositionTable.set(key, { score: alpha, depth: depth });
    return alpha;
  }

  /**
   * Generate board hash key for transposition table
   */
  getBoardKey(board) {
    return board.getState().flat().join("");
  }

  /**
   * Evaluate entire board for a player
   */
  evaluateBoard(board, player = null) {
    const currentPlayer = player || board.getCurrentPlayer();
    let score = 0;

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board.getCell(row, col) === currentPlayer) {
          score += this.evaluatePatternsAt(row, col, currentPlayer, board);
        }
      }
    }

    return score;
  }

  /**
   * Evaluate position score
   */
  evaluatePosition(row, col) {
    const currentPlayer = this.board.getCurrentPlayer();
    let score = 0;

    const tempBoard = this.board.clone();
    tempBoard.grid[row][col] = currentPlayer;

    score = this.evaluatePatternsAt(row, col, currentPlayer, tempBoard);

    tempBoard.grid[row][col] = null;
    return score;
  }

  /**
   * Evaluate patterns at a position
   */
  evaluatePatternsAt(row, col, player, board) {
    let score = 0;

    for (const [dr, dc] of DIRECTIONS) {
      const line = [];
      for (let i = -4; i <= 4; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        line.push(board.getCell(r, c));
      }

      const patternScore = this.evaluateLineScore(line, player);
      score += patternScore;
    }

    return score;
  }

  /**
   * Evaluate a line and return score
   */
  evaluateLineScore(line, player) {
    const opponent = player === "black" ? "white" : "black";
    const playerCount = line.filter((c) => c === player).length;
    const oppCount = line.filter((c) => c === opponent).length;

    if (oppCount > 0 && playerCount > 0) return 0;
    if (playerCount === 0 && oppCount === 0) return 0;

    const count = Math.max(playerCount, oppCount);
    const isPlayer = oppCount === 0;
    const openEnds = this.countOpenEnds(line, isPlayer ? player : opponent);

    return this.getPatternScore(count, openEnds, isPlayer);
  }

  /**
   * Count open ends of a line
   */
  countOpenEnds(line, player) {
    let ends = 0;
    if (line[0] === player) ends++;
    if (line[line.length - 1] === player) ends++;
    return ends;
  }

  /**
   * Get score for pattern
   */
  getPatternScore(count, openEnds, isPlayer) {
    const sign = isPlayer ? 1 : -1;

    if (count >= 5) return sign * SCORES.FIVE;
    if (count === 4) {
      if (openEnds === 2) return sign * SCORES.LIVE_FOUR;
      if (openEnds === 1) return sign * SCORES.RUSH_FOUR;
    }
    if (count === 3) {
      if (openEnds === 2) return sign * SCORES.LIVE_THREE;
      if (openEnds === 1) return sign * SCORES.SLEEP_THREE;
    }
    if (count === 2) {
      if (openEnds === 2) return sign * SCORES.LIVE_TWO;
      if (openEnds === 1) return sign * SCORES.SLEEP_TWO;
    }
    if (count === 1 && openEnds === 2) return sign * SCORES.ONE;

    return 0;
  }
}
