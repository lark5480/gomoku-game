/**
 * AI Module for Gomoku
 * Implements AIPlayer class with multiple difficulty levels
 */

import { Board, Player } from "./board.js";
import { BOARD_SIZE, isValidPosition } from "./utils.js";

// Pattern scores
const SCORES = {
  FIVE: 10000000,
  LIVE_FOUR: 500000,
  RUSH_FOUR: 50000,
  LIVE_THREE: 5000,
  SLEEP_THREE: 500,
  LIVE_TWO: 500,
  SLEEP_TWO: 50,
  ONE: 10,
};

// Directions for pattern detection
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

// Thrown when iterative deepening search exceeds time budget
class SearchTimeout extends Error {}

export class AIPlayer {
  constructor(board, difficulty = "medium") {
    this.board = board;
    this.difficulty = difficulty;
    this.transpositionTable = new Map();
    this.timeLimit = 2000; // ms, for iterative deepening in hard mode
    this.searchStartTime = 0;
    this.nodeCount = 0;
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

    // Pre-check: immediate win
    const winMove = this.findImmediateWin(validMoves);
    if (winMove) return winMove;

    // Pre-check: must block opponent's immediate win
    const blockMove = this.findMustBlock(validMoves);
    if (blockMove) return blockMove;

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
    const currentPlayer = this.board.getCurrentPlayer();
    this.searchStartTime = performance.now();
    this.nodeCount = 0;

    // Move ordering: score each candidate position heuristically
    for (const move of validMoves) {
      move.heuristicScore = this.scoreMove(
        move.row, move.col, currentPlayer, this.board
      );
    }
    validMoves.sort((a, b) => b.heuristicScore - a.heuristicScore);

    let bestScore = -Infinity;
    let bestMove = validMoves[0];

    for (const move of validMoves) {
      this.board.makeMove(move.row, move.col);

      const score = -this.alphaBeta(this.board, 1, -Infinity, Infinity);

      this.board.undo();

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  /**
   * Hard mode: iterative deepening alpha-beta with time limit
   * Searches depth 1, 2, 3, ... until time runs out.
   * Returns the best move from the last fully completed depth.
   */
  getMoveHard(validMoves) {
    const currentPlayer = this.board.getCurrentPlayer();

    // Score and sort candidates once
    for (const move of validMoves) {
      move.heuristicScore = this.scoreMove(
        move.row, move.col, currentPlayer, this.board
      );
    }
    validMoves.sort((a, b) => b.heuristicScore - a.heuristicScore);

    this.transpositionTable.clear();
    this.searchStartTime = performance.now();
    this.nodeCount = 0;

    let bestMove = validMoves[0];
    const MAX_DEPTH = 7;

    try {
      for (let depth = 1; depth <= MAX_DEPTH; depth++) {
        let bestScore = -Infinity;
        let depthBestMove = validMoves[0];

        for (const move of validMoves) {
          this.board.makeMove(move.row, move.col);

          const key = this.getBoardKey(this.board);
          let score;

          const cached = this.transpositionTable.get(key);
          if (cached && cached.depth >= depth) {
            score = cached.score;
          } else {
            score = -this.alphaBeta(this.board, depth, -Infinity, Infinity);
            this.transpositionTable.set(key, { score, depth });
          }

          this.board.undo();

          if (score > bestScore) {
            bestScore = score;
            depthBestMove = move;
          }
        }

        bestMove = depthBestMove;

        // Re-sort: move the best to front for next depth
        const idx = validMoves.indexOf(depthBestMove);
        if (idx > 0) {
          validMoves.splice(idx, 1);
          validMoves.unshift(depthBestMove);
        }

        // Stop early if we found a winning move
        if (bestScore >= SCORES.FIVE) break;
      }
    } catch (e) {
      if (!(e instanceof SearchTimeout)) throw e;
      // Time expired — bestMove holds the result from the last completed depth
    }

    return bestMove;
  }

  /**
   * Alpha-beta pruning with time budget and internal move ordering
   */
  alphaBeta(board, depth, alpha, beta) {
    // Periodic time check (every 4096 nodes for performance)
    this.nodeCount++;
    if ((this.nodeCount & 0xfff) === 0) {
      if (performance.now() - this.searchStartTime > this.timeLimit) {
        throw new SearchTimeout();
      }
    }

    if (depth === 0) {
      return this.evaluateBoard(board);
    }

    const validMoves = board.getValidMoves();
    if (validMoves.length === 0 || board.getGameState() !== "playing") {
      return this.evaluateBoard(board);
    }

    const key = this.getBoardKey(board);
    const cached = this.transpositionTable.get(key);
    if (cached && cached.depth >= depth) {
      return cached.score;
    }

    // Move ordering at internal nodes: sort top candidates for better pruning
    if (validMoves.length > 1 && depth >= 2) {
      const currentPlayer = board.getCurrentPlayer();
      const limit = Math.min(validMoves.length, 15);
      for (const move of validMoves) {
        move._hs = this.scoreMove(move.row, move.col, currentPlayer, board);
      }
      validMoves.sort((a, b) => b._hs - a._hs);
      validMoves.length = limit;
    }

    for (const move of validMoves) {
      board.makeMove(move.row, move.col);
      const score = -this.alphaBeta(board, depth - 1, -beta, -alpha);
      board.undo();

      if (score > alpha) {
        alpha = score;
      }
      if (alpha >= beta) {
        break;
      }
    }

    this.transpositionTable.set(key, { score: alpha, depth });
    return alpha;
  }

  /**
   * Generate board hash key for transposition table
   */
  getBoardKey(board) {
    return board.getState().flat().join("");
  }

  /**
   * Evaluate entire board for both players
   */
  evaluateBoard(board) {
    const currentPlayer = board.getCurrentPlayer();
    const opponent = currentPlayer === "black" ? "white" : "black";
    let score = 0;

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = board.getCell(row, col);
        if (cell === currentPlayer) {
          score += this.evaluatePatternsAt(row, col, currentPlayer, board);
        } else if (cell === opponent) {
          score -= this.evaluatePatternsAt(row, col, opponent, board);
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
   * Check if there is a move that immediately wins (completes five in a row).
   * @returns {Object|null} Winning move {row, col} or null
   */
  findImmediateWin(validMoves) {
    const player = this.board.getCurrentPlayer();
    for (const move of validMoves) {
      this.board.setCellDirect(move.row, move.col, player);
      const patterns = this.evaluatePatternsAt(move.row, move.col, player, this.board);
      this.board.setCellDirect(move.row, move.col, null);

      if (patterns >= SCORES.FIVE) return move;
    }
    return null;
  }

  /**
   * Check if opponent has an immediate winning threat that must be blocked.
   * @returns {Object|null} Blocking move {row, col} or null
   */
  findMustBlock(validMoves) {
    const opponent = this.board.getCurrentPlayer() === "black" ? "white" : "black";
    for (const move of validMoves) {
      this.board.setCellDirect(move.row, move.col, opponent);
      const patterns = this.evaluatePatternsAt(move.row, move.col, opponent, this.board);
      this.board.setCellDirect(move.row, move.col, null);

      if (patterns >= SCORES.FIVE) return move;
    }
    return null;
  }

  /**
   * Heuristic move score for ordering: attack + defense value of a position.
   */
  scoreMove(row, col, player, board) {
    const opponent = player === "black" ? "white" : "black";

    // Attack: what patterns does this position create for the player?
    board.setCellDirect(row, col, player);
    let score = this.evaluatePatternsAt(row, col, player, board);

    // Defense: what patterns would the opponent create if they took this spot?
    board.setCellDirect(row, col, opponent);
    score += this.evaluatePatternsAt(row, col, opponent, board);

    // Clean up
    board.setCellDirect(row, col, null);
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
        if (isValidPosition(r, c)) {
          line.push(board.getCell(r, c));
        } else {
          line.push(undefined);
        }
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

    // Mixed line: both player and opponent stones present
    if (line.some((c) => c === opponent)) return 0;

    // Center cell (index 4) must be the player's stone
    const center = 4;
    if (line[center] !== player) return 0;

    // Expand outward from center to find contiguous segment
    let start = center;
    let end = center;
    while (start > 0 && line[start - 1] === player) start--;
    while (end < 8 && line[end + 1] === player) end++;

    const count = end - start + 1;

    // Open ends: empty cells immediately adjacent to the segment
    let openEnds = 0;
    if (start > 0 && line[start - 1] === null) openEnds++;
    if (end < 8 && line[end + 1] === null) openEnds++;

    return this.getPatternScore(count, openEnds, true);
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
