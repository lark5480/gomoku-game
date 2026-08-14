/**
 * AI Module for Gomoku
 * Implements AIPlayer class with multiple difficulty levels.
 *
 * Techniques:
 * - Pattern-aware evaluation: contiguous and jump shapes (per-stone, dual-side)
 * - Tactical pre-checks: immediate win, must-block, double threats
 * - VCF (continuous rush-four) search for forced wins and forced-win defense
 * - Iterative deepening negamax alpha-beta with flagged transposition table
 */

import { Board, GameState, Player } from './board.js';
import { BOARD_SIZE, isValidPosition } from './utils.js';

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

// Pattern types ordered by strength (index = rank)
const PATTERN_TYPES = [
  'one',
  'sleepTwo',
  'liveTwo',
  'sleepThree',
  'liveThree',
  'rushFour',
  'liveFour',
  'five',
];

const PATTERN_SCORE = {
  five: SCORES.FIVE,
  liveFour: SCORES.LIVE_FOUR,
  rushFour: SCORES.RUSH_FOUR,
  liveThree: SCORES.LIVE_THREE,
  sleepThree: SCORES.SLEEP_THREE,
  liveTwo: SCORES.LIVE_TWO,
  sleepTwo: SCORES.SLEEP_TWO,
  one: SCORES.ONE,
};

// Directions for pattern detection
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

// Search constants
const SEARCH_RADIUS = 2;
const SEARCH_CANDIDATE_LIMIT = 15;
// Root candidates searched by hard mode (heuristic ordering reliably puts
// winning/blocking moves first, so the long tail can be dropped)
const ROOT_CANDIDATE_LIMIT = 24;
const MAX_DEPTH = 9;

// Transposition table entry flags
const TT_EXACT = 0;
const TT_LOWER = 1;
const TT_UPPER = 2;

// VCF search defaults
const VCF_MAX_PLIES = 20;
const VCF_NODE_BUDGET = 6000;
const VCF_TIME_BUDGET_MS = 700;

// Evaluation tuning:
// Opponent sharp threats (live three and up) were just created and must be
// answered, so they weigh extra from the side-to-move's perspective.
const DEFENSE_URGENCY = 0.25;
// Centrality bonus per stone: POS_MAX at board center, 0 beyond Chebyshev 7.
const POS_MAX = 12;
// Opening guidance applies only to the AI's first few moves (plies 2/4/6/8).
const OPENING_MAX_HISTORY = 7;

// Thrown when iterative deepening search exceeds time budget
class SearchTimeout extends Error {}

export class AIPlayer {
  constructor(board, difficulty = 'medium') {
    this.board = board;
    this.difficulty = difficulty;
    this.transpositionTable = new Map();
    this.timeLimit = 2000; // ms, for iterative deepening in hard mode
    this.searchStartTime = 0;
    this.nodeCount = 0;
    this.vcfNodes = 0;
    this.vcfDeadline = 0;
    // Three-state VCF result: move | null-with-vcfExhausted=false (proven
    // none) | null-with-vcfExhausted=true (budget/time cut the search short —
    // the answer is unknown, not "no forced win").
    this.vcfExhausted = false;
    // Zobrist hashing state (two 32-bit accumulators; combined into one
    // exact 53-bit key). Maintained only while incremental evaluation is
    // active, i.e. during alpha-beta search.
    this.zobrist = new Map();
    this._hashHi = 0;
    this._hashLo = 0;

    // Incremental evaluation state (active only during alpha-beta search):
    // per-stone pattern cache, side-independent accumulators and a rollback
    // stack, so leaf evaluation is O(1) instead of a full board scan.
    this._incActive = false;
    this._cache = new Map();
    this._acc = {
      T: { black: 0, white: 0 },
      S: { black: 0, white: 0 },
      P: { black: 0, white: 0 },
    };
    this._undoStack = [];
  }

  /**
   * Get the best move for AI
   * @returns {Object} Best position {row, col}
   */
  getMove() {
    const validMoves = this.board.getValidMoves(SEARCH_RADIUS);

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

    // Opening principles + tactical pre-checks for medium & hard
    if (this.difficulty !== 'easy') {
      const opening = this.findOpeningMove();
      if (opening) return opening;

      const tactical = this.findTacticalMove();
      if (tactical) return tactical;
    }

    switch (this.difficulty) {
      case 'easy':
        return this.getMoveEasy(validMoves);
      case 'hard':
        return this.getMoveHard(validMoves);
      case 'medium':
      default:
        return this.getMoveMedium(validMoves);
    }
  }

  /**
   * Tactical pre-check pipeline: own VCF, opponent VCF defense,
   * own double threat, opponent double-threat point occupation.
   * @returns {Object|null} Tactical move {row, col} or null
   */
  findTacticalMove() {
    const player = this.board.getCurrentPlayer();
    const opponent = player === Player.BLACK ? Player.WHITE : Player.BLACK;

    // Forced win for us (continuous rush fours)
    const vcfMove = this.findVCF(player);
    if (vcfMove) return vcfMove;

    // Opponent has a forced win: try to disrupt it
    const oppVcf = this.findVCF(opponent);
    if (oppVcf) {
      const defense = this.defendVCF(opponent);
      if (defense) return defense;
      // No disruption exists. Answer the sharpest current threat anyway:
      // denying the opponent's slower double-threat point is pointless when
      // a faster forcing chain is already unstoppable.
      const fallback = this.findDefensiveMove(opponent);
      if (fallback) return fallback;
    } else if (this.vcfExhausted) {
      // The opponent forcing-win search was cut short, so the position is
      // not proven safe: answer their sharpest current threat instead of
      // playing a neutral move.
      const defense = this.findDefensiveMove(opponent);
      if (defense) return defense;
    }

    // We can create two simultaneous threats (win next move); verify a
    // single opponent reply cannot outrun or dissolve them.
    const doubleMove = this.findDoubleThreat(player, { verify: true });
    if (doubleMove) return doubleMove;

    // Deny opponent's double-threat point
    const oppDouble = this.findDoubleThreat(opponent);
    if (oppDouble) return oppDouble;

    return null;
  }

  /**
   * Opening principles for the AI's first replies (plies 2/4/6). In quiet
   * early positions the search horizon sees no tactics, so play by rule:
   * occupy the point where the opponent would grow a two into a live three;
   * otherwise develop toward the center near own stones.
   * @returns {Object|null} Opening move {row, col} or null
   */
  findOpeningMove() {
    const history = this.board.getMoveHistory();
    if (history.length > OPENING_MAX_HISTORY || history.length % 2 !== 1) {
      return null;
    }

    // Only steer quiet positions; once a three/four exists, defer to
    // tactics and search.
    if (this.hasSharpShapes()) return null;

    const me = this.board.getCurrentPlayer();
    const opp = me === Player.BLACK ? Player.WHITE : Player.BLACK;

    const contest = this.findThreatContestMove(me, opp);
    if (contest) return contest;
    return this.findDevelopMove(me);
  }

  /**
   * Whether any stone on the board already forms a live-three-or-stronger
   * shape (for either player).
   */
  hasSharpShapes() {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = this.board.getCell(row, col);
        if (!cell) continue;
        const detail = this.evaluatePatternsDetail(row, col, cell, this.board);
        if (detail.sharp > 0) return true;
      }
    }
    return false;
  }

  /**
   * Find the opponent's growth points (cells where they would create a
   * sleep three or stronger) and occupy the one that leaves them with the
   * fewest remaining growth options.
   */
  findThreatContestMove(me, opp) {
    const candidates = [];
    for (const move of this.board.getValidMoves(SEARCH_RADIUS)) {
      this.board.setCellDirect(move.row, move.col, opp);
      const level = this.maxShapeAt(move.row, move.col, opp);
      this.board.setCellDirect(move.row, move.col, null);

      if (level >= PATTERN_TYPES.indexOf('sleepThree')) candidates.push(move);
    }
    if (candidates.length === 0) return null;

    let best = null;
    let bestLeft = Infinity;
    let bestContact = -1;
    let bestScore = -Infinity;
    for (const move of candidates) {
      this.board.makeMove(move.row, move.col);
      const left = this.countGrowthCells(opp);
      this.board.undo();

      const contact = this.countAdjacentStones(move.row, move.col, opp);
      const score = this.scoreMove(move.row, move.col, me, this.board);
      const better =
        left < bestLeft ||
        (left === bestLeft &&
          (contact > bestContact || (contact === bestContact && score > bestScore)));
      if (better) {
        bestLeft = left;
        bestContact = contact;
        bestScore = score;
        best = move;
      }
    }
    return best;
  }

  /**
   * Count stones of `player` within Chebyshev distance 1 of (row, col).
   */
  countAdjacentStones(row, col, player) {
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (isValidPosition(r, c) && this.board.getCell(r, c) === player) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Count empty cells where `player` would create a sleep-three-or-stronger
   * shape by playing there.
   */
  countGrowthCells(player) {
    let count = 0;
    for (const move of this.board.getValidMoves(SEARCH_RADIUS)) {
      this.board.setCellDirect(move.row, move.col, player);
      const level = this.maxShapeAt(move.row, move.col, player);
      this.board.setCellDirect(move.row, move.col, null);
      if (level >= PATTERN_TYPES.indexOf('sleepThree')) count++;
    }
    return count;
  }

  /**
   * Strongest shape rank (index into PATTERN_TYPES) formed through
   * (row, col) for `player`; the stone must already be placed. -1 if none.
   */
  maxShapeAt(row, col, player) {
    let maxRank = -1;
    for (const [dr, dc] of DIRECTIONS) {
      const line = this.extractLine(row, col, dr, dc, this.board);
      const pattern = this.classifyLine(line, player);
      if (pattern) {
        maxRank = Math.max(maxRank, PATTERN_TYPES.indexOf(pattern.type));
      }
    }
    return maxRank;
  }

  /**
   * Quiet development: play near own stones toward the center. On the very
   * first reply, answer the opponent's stone diagonally toward the center.
   */
  findDevelopMove(me) {
    const own = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (this.board.getCell(row, col) === me) own.push({ row, col });
      }
    }

    if (own.length === 0) {
      const history = this.board.getMoveHistory();
      const last = history[history.length - 1];
      return this.diagonalTowardsCenter(last.row, last.col);
    }

    let best = null;
    let bestScore = -Infinity;
    for (const move of this.board.getValidMoves(1)) {
      let connectivity = 0;
      for (const stone of own) {
        const dist = Math.max(Math.abs(stone.row - move.row), Math.abs(stone.col - move.col));
        if (dist === 1) connectivity++;
      }
      const score = 2 * this.posBonus(move.row, move.col) + connectivity;
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  }

  /**
   * Pick the empty diagonal neighbor of (row, col) closest to board center.
   */
  diagonalTowardsCenter(row, col) {
    const diagonals = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
    let best = null;
    let bestDist = Infinity;
    for (const [dr, dc] of diagonals) {
      const r = row + dr;
      const c = col + dc;
      if (!isValidPosition(r, c) || this.board.getCell(r, c) !== null) continue;
      const dist = Math.max(Math.abs(r - 7), Math.abs(c - 7));
      if (dist < bestDist) {
        bestDist = dist;
        best = { row: r, col: c };
      }
    }
    return best;
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
      move.heuristicScore = this.scoreMove(move.row, move.col, currentPlayer, this.board);
    }
    validMoves.sort((a, b) => b.heuristicScore - a.heuristicScore);

    let bestScore = -Infinity;
    let bestMove = validMoves[0];

    const savedHistoryLen = this.board.getMoveHistory().length;

    this._initIncremental();
    try {
      for (const move of validMoves) {
        this._searchMake(move);

        const score = -this.alphaBeta(this.board, 1, -Infinity, Infinity);

        this._searchUndo();

        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
      }
    } finally {
      while (this.board.getMoveHistory().length > savedHistoryLen) {
        this.board.undo();
      }
      this._discardIncremental();
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

    // Score and sort candidates once. Forced tactical cells (winning moves,
    // blocks of fours, double-threat points) must survive the truncation
    // below even when the heuristic undervalues them, so they replace the
    // lowest-ranked ordinary candidates — the root width stays 24 to keep
    // the search depth (width costs depth, which costs strength).
    for (const move of validMoves) {
      move.heuristicScore = this.scoreMove(move.row, move.col, currentPlayer, this.board);
    }
    const forced = this.collectForcedCells(currentPlayer, validMoves);
    for (const move of validMoves) {
      move._forced = forced.has(move.row + ',' + move.col);
    }
    validMoves.sort((a, b) => b.heuristicScore - a.heuristicScore);

    const kept = validMoves.slice(0, ROOT_CANDIDATE_LIMIT);
    const keptSet = new Set(kept.map((m) => m.row + ',' + m.col));
    for (const move of validMoves) {
      const key = move.row + ',' + move.col;
      if (move._forced && !keptSet.has(key)) {
        keptSet.add(key);
        kept.push(move);
        if (kept.length > ROOT_CANDIDATE_LIMIT) {
          // Drop the lowest-ranked non-forced move to make room.
          for (let i = kept.length - 1; i >= 0; i--) {
            if (!kept[i]._forced) {
              keptSet.delete(kept[i].row + ',' + kept[i].col);
              kept.splice(i, 1);
              break;
            }
          }
        }
      }
    }
    validMoves.splice(0, validMoves.length, ...kept);

    this.transpositionTable.clear();
    this.searchStartTime = performance.now();
    this.nodeCount = 0;

    let bestMove = validMoves[0];

    const savedHistoryLen = this.board.getMoveHistory().length;

    this._initIncremental();
    try {
      for (let depth = 1; depth <= MAX_DEPTH; depth++) {
        // Don't start a depth we are unlikely to finish: a partially
        // completed iteration is discarded anyway, so spend the remaining
        // budget where it already produced a result.
        const elapsed = performance.now() - this.searchStartTime;
        if (depth > 1 && elapsed > this.timeLimit * 0.75) break;

        let bestScore = -Infinity;
        let depthBestMove = validMoves[0];

        for (const move of validMoves) {
          this._searchMake(move);
          const score = -this.alphaBeta(this.board, depth, -Infinity, Infinity);
          this._searchUndo();

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
    } finally {
      // Restore board: undo any phantom stones left by interrupted search
      while (this.board.getMoveHistory().length > savedHistoryLen) {
        this.board.undo();
      }
      this._discardIncremental();
    }

    return bestMove;
  }

  /**
   * Tactical cells that must survive root-candidate truncation: cells that
   * complete five, create a four, or create a double live three for either
   * side, plus the completion cells of opponent fours. The pre-check chain
   * covers the direct cases, but this keeps secondary threats searchable.
   * @returns {Set<string>} "row,col" keys
   */
  collectForcedCells(player, validMoves) {
    const opponent = player === Player.BLACK ? Player.WHITE : Player.BLACK;
    const forced = new Set();
    const addCell = (r, c) => {
      if (isValidPosition(r, c) && this.board.getCell(r, c) === null) {
        forced.add(r + ',' + c);
      }
    };

    for (const move of validMoves) {
      this.board.setCellDirect(move.row, move.col, player);
      const mine = this.threatInfoAt(move.row, move.col, player);
      this.board.setCellDirect(move.row, move.col, opponent);
      const theirs = this.threatInfoAt(move.row, move.col, opponent);
      this.board.setCellDirect(move.row, move.col, null);

      if (mine.five || mine.fours > 0 || mine.liveThrees >= 2) {
        addCell(move.row, move.col);
      }
      if (theirs.five || theirs.fours > 0 || theirs.liveThrees >= 1) {
        addCell(move.row, move.col);
        for (const c of theirs.completions) addCell(c.row, c.col);
      }
    }
    return forced;
  }

  /**
   * Alpha-beta pruning with time budget and internal move ordering.
   * Returns the score from the perspective of the player to move.
   */
  alphaBeta(board, depth, alpha, beta) {
    // Periodic time check (every 4096 nodes for performance)
    this.nodeCount++;
    if ((this.nodeCount & 0xfff) === 0) {
      if (performance.now() - this.searchStartTime > this.timeLimit) {
        throw new SearchTimeout();
      }
    }

    // Terminal nodes: the previous move ended the game. Since makeMove does
    // not switch currentPlayer on a win, the mover (the parent) won. From
    // negamax convention this node is a loss for the side "to move", and the
    // parent's negation turns it into a win. The depth bonus prefers faster
    // wins and slower losses.
    const state = board.getGameState();
    if (state !== GameState.PLAYING) {
      if (state === GameState.DRAW) return 0;
      return -(SCORES.FIVE + depth);
    }

    if (depth === 0) {
      return this.evaluateBoard(board);
    }

    const alphaOrig = alpha;
    const key = this.getBoardKey(board);
    const cached = this.transpositionTable.get(key);
    let ttMove = null;
    if (cached) {
      // The stored best move aids ordering even when the entry is too
      // shallow to provide a usable bound
      if (cached.move) ttMove = cached.move;
      if (cached.depth >= depth) {
        if (cached.flag === TT_EXACT) return cached.score;
        if (cached.flag === TT_LOWER) alpha = Math.max(alpha, cached.score);
        else if (cached.flag === TT_UPPER) beta = Math.min(beta, cached.score);
        if (alpha >= beta) return cached.score;
      }
    }

    // The last ply only needs cells adjacent to existing stones: every
    // five-completing, four-creating or blocking point touches a stone, so
    // radius 1 is tactically complete there and keeps the leaf width (and
    // therefore the whole tree cost) manageable. The TT move is injected
    // back in case it lies at distance 2.
    const validMoves = board.getValidMoves(depth === 1 ? 1 : SEARCH_RADIUS);
    if (
      ttMove &&
      board.getCell(ttMove.row, ttMove.col) === null &&
      !validMoves.some((m) => m.row === ttMove.row && m.col === ttMove.col)
    ) {
      validMoves.unshift({ row: ttMove.row, col: ttMove.col });
    }
    if (validMoves.length === 0) {
      return this.evaluateBoard(board);
    }

    const { best, bestMove } = this._searchNodeMoves(board, depth, alpha, beta, validMoves, ttMove);

    // Store with bound flag and best move; skip win/loss scores
    // (they are depth-dependent)
    if (Math.abs(best) < SCORES.FIVE) {
      let flag = TT_EXACT;
      if (best <= alphaOrig) flag = TT_UPPER;
      else if (best >= beta) flag = TT_LOWER;
      this.transpositionTable.set(key, {
        score: best,
        depth,
        flag,
        move: bestMove ? { row: bestMove.row, col: bestMove.col } : null,
      });
    }

    return best;
  }

  /**
   * Iterate a node's candidate moves: try the transposition-table move
   * first, then the heuristically ordered candidates.
   * @returns {{best:number, bestMove:Object|null}}
   */
  _searchNodeMoves(board, depth, alpha, beta, validMoves, ttMove) {
    let best = -Infinity;
    let bestMove = null;

    if (ttMove) {
      const idx = validMoves.findIndex((m) => m.row === ttMove.row && m.col === ttMove.col);
      if (idx !== -1) {
        validMoves.splice(idx, 1);
        this._searchMake(ttMove);
        const score = -this.alphaBeta(board, depth - 1, -beta, -alpha);
        this._searchUndo();

        best = score;
        bestMove = ttMove;
        if (score > alpha) alpha = score;
      }
    }

    if (alpha >= beta) return { best, bestMove };

    // Move ordering at internal nodes: keep only the strongest candidates,
    // plus at most a handful of four-class threats that the heuristic might
    // have ranked just below the cutoff (jump shapes can score many cells
    // at rush-four level, so the extras are capped to keep branching sane).
    if (validMoves.length > 1 && depth >= 2) {
      const currentPlayer = board.getCurrentPlayer();
      for (const move of validMoves) {
        move._hs = this.scoreMove(move.row, move.col, currentPlayer, board);
      }
      validMoves.sort((a, b) => b._hs - a._hs);
      const kept = [];
      for (const move of validMoves) {
        if (kept.length < SEARCH_CANDIDATE_LIMIT) {
          kept.push(move);
        } else if (move._hs >= SCORES.RUSH_FOUR && kept.length < SEARCH_CANDIDATE_LIMIT + 3) {
          kept.push(move);
        }
      }
      validMoves.splice(0, validMoves.length, ...kept);
    }

    // Principal variation search: the first move (after the TT move) is
    // searched with the full window; the rest get a null window first and
    // are re-searched only on fail-high. With the heuristic ordering this
    // cuts the node count several-fold at equal results.
    let first = true;
    for (const move of validMoves) {
      this._searchMake(move);
      let score;
      if (first) {
        first = false;
        score = -this.alphaBeta(board, depth - 1, -beta, -alpha);
      } else {
        score = -this.alphaBeta(board, depth - 1, -alpha - 1, -alpha);
        if (score > alpha && score < beta) {
          score = -this.alphaBeta(board, depth - 1, -beta, -alpha);
        }
      }
      this._searchUndo();

      if (score > best) {
        best = score;
        bestMove = move;
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }

    return { best, bestMove };
  }

  /**
   * VCF search: find a forced win for `attacker` using continuous fours.
   * Assumes the attacker moves next (hypothetically if it is not their turn).
   * @param {string} attacker - 'black' or 'white'
   * @param {Object} [opts] - {maxPlies, nodeBudget}
   * @returns {Object|null} First winning move {row, col} or null
   */
  findVCF(attacker, opts = {}) {
    this.vcfNodes = 0;
    this.vcfExhausted = false;
    this.vcfDeadline = performance.now() + VCF_TIME_BUDGET_MS;
    const maxPlies = opts.maxPlies ?? VCF_MAX_PLIES;

    // Every VCF level enumerates all nearby empty cells, so node cost grows
    // with candidate density: scale the budget so dense middlegames can still
    // see chains of the same depth before being cut off.
    const density = this.board.getValidMoves(SEARCH_RADIUS).length;
    this.vcfBudget =
      opts.nodeBudget ?? Math.min(24000, VCF_NODE_BUDGET + Math.max(0, density - 60) * 60);

    // Iterative deepening: prove shallow forcing chains first, then deepen.
    // A rung that finds a win answers immediately; a rung cut off by
    // budget/time marks the result as unknown instead of a proven "none".
    for (const plies of [4, 8, 12, 16, 20].filter((p) => p <= maxPlies)) {
      if (performance.now() > this.vcfDeadline) break;
      const move = this._vcf(attacker, plies);
      if (move) return move;
      if (this.vcfExhausted) break; // budget gone; deeper rungs are pointless
    }
    return null;
  }

  /**
   * VCF recursion: attacker plays a four, defender's reply is forced.
   */
  _vcf(attacker, pliesLeft) {
    // Plies exhausted without a win: a definitive "not within this depth".
    if (pliesLeft <= 0) return null;
    // Budget exhausted: the search was cut short, so the result is unknown.
    if (this.vcfNodes >= this.vcfBudget) {
      this.vcfExhausted = true;
      return null;
    }

    const defender = attacker === Player.BLACK ? Player.WHITE : Player.BLACK;
    const candidates = this.board.getValidMoves(SEARCH_RADIUS);
    const fourMoves = [];

    for (const move of candidates) {
      if (++this.vcfNodes >= this.vcfBudget) {
        this.vcfExhausted = true;
        return null;
      }
      if ((this.vcfNodes & 0xff) === 0 && performance.now() > this.vcfDeadline) {
        this.vcfExhausted = true;
        return null;
      }

      this.board.setCellDirect(move.row, move.col, attacker);
      const info = this.threatInfoAt(move.row, move.col, attacker);
      this.board.setCellDirect(move.row, move.col, null);

      if (info.five) return move;
      // Two or more completion points = unblockable (live four / double four)
      if (info.fours > 0 && info.completions.length >= 2) return move;
      if (info.fours > 0) fourMoves.push({ move, block: info.completions[0] });
    }

    for (const { move, block } of fourMoves) {
      this.board.setCellDirect(move.row, move.col, attacker);
      this.board.setCellDirect(block.row, block.col, defender);
      const win = this._vcf(attacker, pliesLeft - 2);
      this.board.setCellDirect(block.row, block.col, null);
      this.board.setCellDirect(move.row, move.col, null);
      if (win) return move;
    }

    return null;
  }

  /**
   * Pick a move that disrupts the opponent's VCF.
   * Tries our strongest candidates and re-runs the opponent's VCF.
   * @param {string} attacker - opponent who owns the VCF
   * @returns {Object|null} Defensive move {row, col} or null
   */
  defendVCF(attacker) {
    const defender = attacker === Player.BLACK ? Player.WHITE : Player.BLACK;
    const all = this.board.getValidMoves(SEARCH_RADIUS);

    // Priority candidates: cells where the attacker would create a four or a
    // live three. Occupying those is the most direct disruption, and it must
    // never be skipped just because a heuristic ranked them low.
    const forced = new Set();
    for (const move of all) {
      this.board.setCellDirect(move.row, move.col, attacker);
      const info = this.threatInfoAt(move.row, move.col, attacker);
      this.board.setCellDirect(move.row, move.col, null);
      if (info.fours > 0 || info.liveThrees > 0) {
        forced.add(move.row + ',' + move.col);
      }
    }

    for (const move of all) {
      move.heuristicScore = this.scoreMove(move.row, move.col, defender, this.board);
    }
    all.sort((a, b) => b.heuristicScore - a.heuristicScore);

    const candidates = [];
    const seen = new Set();
    const push = (m) => {
      const key = m.row + ',' + m.col;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(m);
      }
    };
    for (const key of forced) {
      const [r, c] = key.split(',').map(Number);
      push({ row: r, col: c });
    }
    for (const m of all) {
      if (candidates.length >= 20) break;
      push(m);
    }

    for (const move of candidates) {
      this.board.makeMove(move.row, move.col);
      const stillWinning = this.findVCF(attacker, {
        maxPlies: 16,
        nodeBudget: 2500,
      });
      const inconclusive = this.vcfExhausted;
      this.board.undo();
      // Only accept a defense we could fully verify: a truncated re-search
      // must not be mistaken for "the VCF is gone".
      if (!stillWinning && !inconclusive) return move;
    }
    return null;
  }

  /**
   * Conservative defensive fallback used when the opponent's VCF status is
   * unknown: occupy the best cell that denies the opponent's sharpest
   * current threats (five completions, four creation, three growth).
   * @returns {Object|null} Defensive move {row, col} or null if no threat
   */
  findDefensiveMove(opponent) {
    const me = opponent === Player.BLACK ? Player.WHITE : Player.BLACK;
    const candidates = this.board.getValidMoves(SEARCH_RADIUS);
    const threatCells = new Set();

    for (const move of candidates) {
      this.board.setCellDirect(move.row, move.col, opponent);
      const info = this.threatInfoAt(move.row, move.col, opponent);
      this.board.setCellDirect(move.row, move.col, null);

      if (info.five) return move; // safety net; must-block runs earlier
      if (info.fours > 0) {
        for (const c of info.completions) threatCells.add(c.row + ',' + c.col);
        // A two-completion four cannot be blocked after the fact: deny the
        // creation cell itself.
        if (info.completions.length >= 2) threatCells.add(move.row + ',' + move.col);
      }
      if (info.liveThrees > 0) threatCells.add(move.row + ',' + move.col);
    }

    let best = null;
    let bestScore = -Infinity;
    for (const key of threatCells) {
      const [r, c] = key.split(',').map(Number);
      if (this.board.getCell(r, c) !== null) continue;
      const score = this.scoreMove(r, c, me, this.board);
      if (score > bestScore) {
        bestScore = score;
        best = { row: r, col: c };
      }
    }
    return best;
  }

  /**
   * Threat summary for a stone already placed at (row, col):
   * number of four-class directions, live-three directions, and the set
   * of points where the player would complete five.
   */
  threatInfoAt(row, col, player) {
    let five = false;
    let fours = 0;
    let liveThrees = 0;
    const completions = new Set();

    for (const [dr, dc] of DIRECTIONS) {
      const line = this.extractLine(row, col, dr, dc, this.board);
      const pattern = this.classifyLine(line, player);
      if (!pattern) continue;

      if (pattern.type === 'five') {
        five = true;
      } else if (pattern.type === 'liveFour' || pattern.type === 'rushFour') {
        fours++;
        for (const idx of pattern.completions) {
          completions.add(`${row + dr * (idx - 4)},${col + dc * (idx - 4)}`);
        }
      } else if (pattern.type === 'liveThree') {
        liveThrees++;
      }
    }

    return {
      five,
      fours,
      liveThrees,
      completions: [...completions].map((key) => {
        const [r, c] = key.split(',').map(Number);
        return { row: r, col: c };
      }),
    };
  }

  /**
   * Find a move creating two simultaneous threats for `player`
   * (four + three, double four, or double live three). Such a move
   * wins on the following move since only one threat can be blocked.
   * @param {string} player - 'black' or 'white'
   * @returns {Object|null} Double-threat move {row, col} or null
   */
  findDoubleThreat(player, opts = {}) {
    const validMoves = this.board.getValidMoves(SEARCH_RADIUS);

    for (const move of validMoves) {
      this.board.setCellDirect(move.row, move.col, player);
      const info = this.threatInfoAt(move.row, move.col, player);
      if (!(info.five || info.fours + info.liveThrees >= 2)) {
        this.board.setCellDirect(move.row, move.col, null);
        continue;
      }
      const ok = opts.verify ? this.verifyDoubleThreat(move.row, move.col, player) : true;
      this.board.setCellDirect(move.row, move.col, null);
      if (ok) return move;
    }
    return null;
  }

  /**
   * Verify that a double threat through the already-placed stone at
   * (row, col) cannot be outrun by a single opponent reply: reject when the
   * opponent can answer with a five, or with a four that we cannot counter
   * with an immediate five of our own (a four+three or double-four threat
   * always has one, a double three may not).
   * @returns {boolean}
   */
  verifyDoubleThreat(row, col, player) {
    const opponent = player === Player.BLACK ? Player.WHITE : Player.BLACK;

    for (const reply of this.board.getValidMoves(SEARCH_RADIUS)) {
      this.board.setCellDirect(reply.row, reply.col, opponent);
      const oppInfo = this.threatInfoAt(reply.row, reply.col, opponent);

      let refutable = false;
      if (oppInfo.five) {
        refutable = true;
      } else if (oppInfo.fours > 0 && !this.hasImmediateFive(player)) {
        refutable = true;
      }

      this.board.setCellDirect(reply.row, reply.col, null);
      if (refutable) return false;
    }
    return true;
  }

  /**
   * Whether `player` can complete five immediately (used to judge races
   * between our double threat and an opponent four).
   * @returns {boolean}
   */
  hasImmediateFive(player) {
    for (const move of this.board.getValidMoves(SEARCH_RADIUS)) {
      this.board.setCellDirect(move.row, move.col, player);
      const info = this.threatInfoAt(move.row, move.col, player);
      this.board.setCellDirect(move.row, move.col, null);
      if (info.five) return true;
    }
    return false;
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
    const opponent = this.board.getCurrentPlayer() === Player.BLACK ? Player.WHITE : Player.BLACK;
    for (const move of validMoves) {
      this.board.setCellDirect(move.row, move.col, opponent);
      const patterns = this.evaluatePatternsAt(move.row, move.col, opponent, this.board);
      this.board.setCellDirect(move.row, move.col, null);

      if (patterns >= SCORES.FIVE) return move;
    }
    return null;
  }

  /**
   * Heuristic move score for ordering: attack + defense value of a position,
   * plus a small centrality bonus.
   */
  scoreMove(row, col, player, board) {
    const opponent = player === Player.BLACK ? Player.WHITE : Player.BLACK;

    // Attack: what patterns does this position create for the player?
    board.setCellDirect(row, col, player);
    let score = this.evaluatePatternsAt(row, col, player, board);

    // Defense: what patterns would the opponent create if they took this spot?
    board.setCellDirect(row, col, opponent);
    score += this.evaluatePatternsAt(row, col, opponent, board);

    // Clean up
    board.setCellDirect(row, col, null);
    return score + this.posBonus(row, col);
  }

  /**
   * Board hash key for the transposition table. During search this is the
   * incrementally maintained Zobrist hash (two 32-bit accumulators combined
   * into one exact integer); outside search it falls back to a full-board
   * string key.
   */
  getBoardKey(board) {
    if (this._incActive) {
      return (this._hashHi >>> 0) * 0x100000000 + (this._hashLo >>> 0);
    }
    return board.getState().flat().join('');
  }

  /**
   * Random Zobrist pair (two int32 values) for one cell/color combination.
   * Generated lazily; XOR cancellation makes make/undo updates O(1).
   */
  _getZobristPair(row, col, color) {
    const key = (row * BOARD_SIZE + col) * 2 + (color === Player.BLACK ? 0 : 1);
    let pair = this.zobrist.get(key);
    if (!pair) {
      pair = [(Math.random() * 0x100000000) >>> 0, (Math.random() * 0x100000000) >>> 0];
      this.zobrist.set(key, pair);
    }
    return pair;
  }

  /**
   * Toggle one stone's contribution in the incremental Zobrist hash.
   */
  _updateHash(row, col, color) {
    const [hi, lo] = this._getZobristPair(row, col, color);
    this._hashHi ^= hi;
    this._hashLo ^= lo;
  }

  /**
   * Evaluate entire board for both players.
   * During search this is an O(1) read of incrementally maintained
   * accumulators; outside search it falls back to a full board scan.
   * Combines shape scores (normalized so a shape counts once, not once per
   * stone), a centrality differential, and an urgency surcharge on the
   * opponent's sharp threats (live three and up), which were just created
   * and must be answered by the side to move.
   */
  evaluateBoard(board) {
    const currentPlayer = board.getCurrentPlayer();
    const opponent = currentPlayer === Player.BLACK ? Player.WHITE : Player.BLACK;

    if (this._incActive) {
      const acc = this._acc;
      return (
        acc.T[currentPlayer] -
        acc.T[opponent] +
        (acc.P[currentPlayer] - acc.P[opponent]) -
        DEFENSE_URGENCY * acc.S[opponent]
      );
    }

    return this._evaluateBoardFull(board);
  }

  /**
   * Full-scan board evaluation (reference implementation, also used to
   * initialize the incremental accumulators before search).
   */
  _evaluateBoardFull(board) {
    const currentPlayer = board.getCurrentPlayer();
    const opponent = currentPlayer === Player.BLACK ? Player.WHITE : Player.BLACK;

    let myScore = 0;
    let oppScore = 0;
    let oppSharp = 0;
    let posScore = 0;

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = board.getCell(row, col);
        if (cell === currentPlayer) {
          myScore += this.evaluatePatternsAt(row, col, currentPlayer, board);
          posScore += this.posBonus(row, col);
        } else if (cell === opponent) {
          const d = this.evaluatePatternsDetail(row, col, opponent, board);
          oppScore += d.total;
          oppSharp += d.sharp;
          posScore -= this.posBonus(row, col);
        }
      }
    }

    return myScore - oppScore - DEFENSE_URGENCY * oppSharp + posScore;
  }

  /**
   * Normalized contribution of one classified pattern (shared by the
   * full-scan and incremental evaluators).
   * @returns {{score:number, sharp:number}}
   */
  _patternContribution(pattern) {
    const isBig =
      pattern.type === 'rushFour' || pattern.type === 'liveFour' || pattern.type === 'five';
    let score = pattern.score;
    if (!isBig) score = score / pattern.stones;
    const sharp = isBig || pattern.type === 'liveThree' ? score : 0;
    return { score, sharp };
  }

  /**
   * Classify one direction of the stone at (row, col); the stone must be
   * placed. Returns the normalized {score, sharp} contribution.
   */
  _dirEntry(row, col, dr, dc, player) {
    const line = this.extractLine(row, col, dr, dc, this.board);
    const pattern = this.classifyLine(line, player);
    if (!pattern) return { score: 0, sharp: 0 };
    return this._patternContribution(pattern);
  }

  /**
   * Initialize incremental evaluation from the current position.
   * Must be called before the search loop; _discardIncremental after it.
   * Cache entries keep per-direction contributions so that a stone touched
   * by a new neighbor only needs one direction reclassified.
   */
  _initIncremental() {
    this._cache = new Map();
    this._acc = {
      T: { black: 0, white: 0 },
      S: { black: 0, white: 0 },
      P: { black: 0, white: 0 },
    };
    this._undoStack = [];
    this._hashHi = 0;
    this._hashLo = 0;

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = this.board.getCell(row, col);
        if (!cell) continue;
        this._updateHash(row, col, cell);
        const dirs = DIRECTIONS.map(([dr, dc]) => this._dirEntry(row, col, dr, dc, cell));
        const total = dirs.reduce((sum, d) => sum + d.score, 0);
        const sharp = dirs.reduce((sum, d) => sum + d.sharp, 0);
        this._cache.set(row * BOARD_SIZE + col, { total, sharp, dirs });
        this._acc.T[cell] += total;
        this._acc.S[cell] += sharp;
        this._acc.P[cell] += this.posBonus(row, col);
      }
    }
    this._incActive = true;
  }

  /**
   * Tear down incremental evaluation state.
   */
  _discardIncremental() {
    this._incActive = false;
    this._cache = new Map();
    this._undoStack = [];
  }

  /**
   * Accumulator helpers: add/remove one stone's pattern contribution.
   */
  _accAdd(entry, color) {
    this._acc.T[color] += entry.total;
    this._acc.S[color] += entry.sharp;
  }

  _accSub(entry, color) {
    this._acc.T[color] -= entry.total;
    this._acc.S[color] -= entry.sharp;
  }

  /**
   * Stones whose pattern windows include (row, col): every stone within
   * 4 steps along the four directions. dirIdx records which of the stone's
   * directions is affected, so only that direction needs reclassifying.
   */
  _collectAffected(row, col) {
    const affected = [];
    for (let dirIdx = 0; dirIdx < DIRECTIONS.length; dirIdx++) {
      const [dr, dc] = DIRECTIONS[dirIdx];
      for (const sign of [1, -1]) {
        for (let i = 1; i <= 4; i++) {
          const r = row + dr * i * sign;
          const c = col + dc * i * sign;
          if (!isValidPosition(r, c)) break;
          const cell = this.board.getCell(r, c);
          if (cell) {
            affected.push({
              key: r * BOARD_SIZE + c,
              row: r,
              col: c,
              color: cell,
              dirIdx,
            });
          }
        }
      }
    }
    return affected;
  }

  /**
   * makeMove wrapper that keeps the incremental evaluation consistent.
   * Only for use inside the search (medium/hard root loops and alphaBeta).
   */
  _searchMake(move) {
    if (!this._incActive) {
      this.board.makeMove(move.row, move.col);
      return;
    }

    const color = this.board.getCurrentPlayer();
    const key = move.row * BOARD_SIZE + move.col;
    const affected = this._collectAffected(move.row, move.col);

    // Detach old contributions of stones whose windows include the new one
    for (const a of affected) {
      a.old = this._cache.get(a.key);
      this._accSub(a.old, a.color);
    }

    this.board.makeMove(move.row, move.col);
    this._updateHash(move.row, move.col, color);

    // Add the placed stone (all four directions are new)
    const dirs = DIRECTIONS.map(([dr, dc]) => this._dirEntry(move.row, move.col, dr, dc, color));
    const placed = {
      total: dirs.reduce((sum, d) => sum + d.score, 0),
      sharp: dirs.reduce((sum, d) => sum + d.sharp, 0),
      dirs,
    };
    this._cache.set(key, placed);
    this._accAdd(placed, color);
    this._acc.P[color] += this.posBonus(move.row, move.col);

    // Recompute only the affected direction of each neighbor stone
    for (const a of affected) {
      const newDir = this._dirEntry(
        a.row,
        a.col,
        DIRECTIONS[a.dirIdx][0],
        DIRECTIONS[a.dirIdx][1],
        a.color
      );
      const oldDir = a.old.dirs[a.dirIdx];
      const newDirs = a.old.dirs.slice();
      newDirs[a.dirIdx] = newDir;
      const entry = {
        total: a.old.total - oldDir.score + newDir.score,
        sharp: a.old.sharp - oldDir.sharp + newDir.sharp,
        dirs: newDirs,
      };
      this._cache.set(a.key, entry);
      this._accAdd(entry, a.color);
    }

    this._undoStack.push({ key, color, placed, affected });
  }

  /**
   * undo wrapper that restores the incremental evaluation state.
   */
  _searchUndo() {
    if (!this._incActive) {
      this.board.undo();
      return;
    }

    const frame = this._undoStack.pop();

    // Affected stones: drop post-move values, restore pre-move values
    for (const a of frame.affected) {
      this._accSub(this._cache.get(a.key), a.color);
      this._cache.set(a.key, a.old);
      this._accAdd(a.old, a.color);
    }

    // Remove the placed stone's contribution
    this._accSub(frame.placed, frame.color);
    const row = Math.floor(frame.key / BOARD_SIZE);
    const col = frame.key % BOARD_SIZE;
    this._acc.P[frame.color] -= this.posBonus(row, col);
    this._cache.delete(frame.key);
    this._updateHash(row, col, frame.color);

    this.board.undo();
  }

  /**
   * Centrality bonus: higher near the board center, 0 at the outermost ring.
   */
  posBonus(row, col) {
    const d = Math.max(Math.abs(row - 7), Math.abs(col - 7));
    return Math.max(0, POS_MAX - d);
  }

  /**
   * Evaluate position score (kept for compatibility)
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
   * Evaluate patterns at a position: total score across the 4 directions.
   * Shapes below rush-four are normalized by their stone count so a shape
   * contributes once, not once per stone; four/five stay per-stone to remain
   * dominant. Used for ordering, win detection, and board evaluation.
   */
  evaluatePatternsAt(row, col, player, board) {
    return this.evaluatePatternsDetail(row, col, player, board).total;
  }

  /**
   * Per-position pattern detail.
   * @returns {{total:number, sharp:number}} total = normalized shape score;
   * sharp = portion from live-three-and-up threats (used for urgency).
   */
  evaluatePatternsDetail(row, col, player, board) {
    let total = 0;
    let sharp = 0;

    for (const [dr, dc] of DIRECTIONS) {
      const line = this.extractLine(row, col, dr, dc, board);
      const pattern = this.classifyLine(line, player);
      if (!pattern) continue;

      const isBig =
        pattern.type === 'rushFour' || pattern.type === 'liveFour' || pattern.type === 'five';
      let score = pattern.score;
      if (!isBig) score = score / pattern.stones;

      total += score;
      if (isBig || pattern.type === 'liveThree') sharp += score;
    }

    return { total, sharp };
  }

  /**
   * Extract a 9-cell line centered at (row, col) along a direction.
   * Out-of-board cells are `undefined` (treated as walls).
   */
  extractLine(row, col, dr, dc, board) {
    const line = [];
    for (let i = -4; i <= 4; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      line.push(isValidPosition(r, c) ? board.getCell(r, c) : undefined);
    }
    return line;
  }

  /**
   * Classify the strongest pattern for `player` through the center cell.
   * Recognizes contiguous shapes and single-gap jump shapes
   * (e.g. X_XX, XX_X, XX_XX, X_XXX).
   * @returns {Object|null} {type, score, completions, stones} — completions
   * are line indices (0-8) where placing a stone completes five; stones is
   * how many of the player's stones participate in the shape (used to
   * normalize per-stone double counting in board evaluation).
   */
  classifyLine(line, player) {
    const center = 4;
    if (line[center] !== player) return null;

    let start = center;
    let end = center;
    while (start > 0 && line[start - 1] === player) start--;
    while (end < 8 && line[end + 1] === player) end++;
    const count = end - start + 1;

    if (count >= 5) {
      return { type: 'five', score: SCORES.FIVE, completions: [], stones: count };
    }

    let best = null;
    const consider = (type, completions, stones) => {
      if (!best || PATTERN_TYPES.indexOf(type) > PATTERN_TYPES.indexOf(best.type)) {
        best = { type, score: PATTERN_SCORE[type], completions, stones };
      }
    };

    this.classifyContiguous(line, start, end, count, consider);
    this.classifyJump(line, start, end, count, 'left', player, consider);
    this.classifyJump(line, start, end, count, 'right', player, consider);

    return best;
  }

  /**
   * Classify the contiguous segment [start..end].
   */
  classifyContiguous(line, start, end, count, consider) {
    const isOpen = (v) => v === null;
    const leftOpen = isOpen(line[start - 1]);
    const rightOpen = isOpen(line[end + 1]);
    const openEnds = (leftOpen ? 1 : 0) + (rightOpen ? 1 : 0);

    if (count === 4) {
      if (openEnds === 2) consider('liveFour', [start - 1, end + 1], count);
      else if (openEnds === 1) {
        consider('rushFour', [leftOpen ? start - 1 : end + 1], count);
      }
    } else if (count === 3) {
      if (openEnds === 2) {
        // True live three: at least one side has room to grow into a live four
        const canGrow = isOpen(line[start - 2]) || isOpen(line[end + 2]);
        consider(canGrow ? 'liveThree' : 'sleepThree', [], count);
      } else if (openEnds === 1) {
        consider('sleepThree', [], count);
      }
    } else if (count === 2) {
      if (openEnds === 2) consider('liveTwo', [], count);
      else if (openEnds === 1) consider('sleepTwo', [], count);
    } else if (count === 1) {
      if (openEnds === 2) consider('one', [], count);
    }
  }

  /**
   * Classify single-gap jump shapes adjacent to the segment:
   * e.g. segment + gap + stones on the given side.
   */
  classifyJump(line, start, end, count, side, player, consider) {
    const isOpen = (v) => v === null;
    const gapIdx = side === 'left' ? start - 1 : end + 1;
    if (!isOpen(line[gapIdx])) return;

    // Count contiguous stones beyond the gap
    let t = 0;
    let idx = side === 'left' ? start - 2 : end + 2;
    while (idx >= 0 && idx <= 8 && line[idx] === player) {
      t++;
      idx += side === 'left' ? -1 : 1;
    }
    if (t === 0) return;

    const composite = count + t;
    const beyond = line[idx]; // cell just past the far segment
    const near = side === 'left' ? line[end + 1] : line[start - 1];
    const endsOpen = (isOpen(beyond) ? 1 : 0) + (isOpen(near) ? 1 : 0);

    if (composite >= 4) {
      // Filling the gap completes five — a rush-four-class threat
      consider('rushFour', [gapIdx], composite);
    } else if (composite === 3) {
      if (endsOpen === 2) consider('liveThree', [gapIdx], composite);
      else if (endsOpen === 1) consider('sleepThree', [gapIdx], composite);
    } else if (composite === 2) {
      if (endsOpen === 2) consider('liveTwo', [gapIdx], composite);
      else if (endsOpen === 1) consider('sleepTwo', [gapIdx], composite);
    }
  }

  /**
   * Evaluate a line and return score (kept for compatibility)
   */
  evaluateLineScore(line, player) {
    const pattern = this.classifyLine(line, player);
    return pattern ? pattern.score : 0;
  }

  /**
   * Get score for pattern (kept for compatibility)
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
