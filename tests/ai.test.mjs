// AI pattern evaluation tests
import { Board, Player, GameState } from "../js/board.js";
import { AIPlayer } from "../js/ai.js";

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

function setupBoard(moves) {
  const board = new Board();
  for (const [row, col] of moves) {
    board.makeMove(row, col);
  }
  return board;
}

console.log("=== AI Pattern Evaluation Tests ===\n");

// --- Test 1: Live three scoring ---
console.log("Test 1: Live three is scored correctly");
{
  const board = setupBoard([
    [7, 7], [0, 0], [7, 8], [0, 5], [7, 9], [0, 10],
  ]);
  // Black has stones at (7,7), (7,8), (7,9) = horizontal live three
  const ai = new AIPlayer(board, "medium");
  const score = ai.evaluateBoard(board);
  // Score should be positive (good for black, current player)
  assert(score > 0, `Live three gives positive score, got ${score}`);
  // With per-stone scoring, live three (3 stones, each scoring LIVE_THREE=5000)
  // Each stone's patterns in 4 dirs, but horizontal dir gives 5000 at each stone
  // Minimum: at least 5000 from the pattern
  assert(score >= 5000, `Score should be at least 5000, got ${score}`);
}
console.log("");

// --- Test 2: Discontinuous stones do NOT form a pattern ---
console.log("Test 2: Discontinuous stones are not scored as a pattern");
{
  const board = setupBoard([
    [7, 7], [0, 0], [7, 9], [0, 1], [7, 11], [0, 2],
  ]);
  // Black has stones at (7,7), (7,9), (7,11) = NOT continuous
  // Old buggy code would count playerCount=3 and score as live three
  const ai = new AIPlayer(board, "medium");
  const score = ai.evaluateBoard(board);
  // Should NOT be scored as live three (3*5000=15000)
  assert(score < 15000, `Discontinuous stones should not score as live three, got ${score}`);
}
console.log("");

// --- Test 3: Rush four is scored ---
console.log("Test 3: Rush four is scored correctly");
{
  // Black at (7,0)-(7,3) with left side blocked by board edge (col 0)
  // This creates a rush four: 4 contiguous stones, one open end at (7,4)
  const board = setupBoard([
    [7, 0], [1, 0], [7, 1], [3, 5], [7, 2], [5, 10], [7, 3], [8, 8],
  ]);
  const ai = new AIPlayer(board, "medium");
  const score = ai.evaluateBoard(board);
  assert(score >= 50000, `Rush four score >= 50000, got ${score}`);
}
console.log("");

// --- Test 4: Opponent threat produces negative score ---
console.log("Test 4: Dual-side evaluation: opponent threat gives negative score");
{
  const board = new Board();
  // Black = AI, White = opponent
  // After these moves, current player = black, white has a live three
  board.makeMove(0, 0);  // 1: black (scattered, no pattern)
  board.makeMove(7, 7);  // 2: white
  board.makeMove(2, 0);  // 3: black (not adjacent to 0,0 — isolated)
  board.makeMove(7, 8);  // 4: white
  board.makeMove(4, 0);  // 5: black (not adjacent to 2,0 — isolated)
  board.makeMove(7, 9);  // 6: white — live three at (7,7)-(7,9), current=black

  // Black stones: (0,0),(2,0),(4,0) — all isolated, ~10 pts each ≈ 30 total
  // White stones: (7,7),(7,8),(7,9) — live three, ~5000 pts each ≈ 15000
  // Net should be negative since white's threat outweighs black's weak position
  const ai = new AIPlayer(board, "medium");
  const score = ai.evaluateBoard(board);
  assert(score < 0, `Opponent threat should make score negative, got ${score}`);
}
console.log("");

// --- Test 5: Immediate win detection ---
console.log("Test 5: AI detects and plays immediate win");
{
  const board = setupBoard([
    [7, 7], [0, 0], [7, 8], [0, 1], [7, 9], [0, 2], [7, 10], [0, 3],
  ]);
  // Black has 4 in a row at (7,7)-(7,10), needs (7,11) or (7,6) to win
  const ai = new AIPlayer(board, "hard");
  const move = ai.getMove();
  // Should play the winning move
  const isWinMove =
    (move.row === 7 && move.col === 11) || (move.row === 7 && move.col === 6);
  assert(isWinMove, `AI should play winning move, got (${move.row},${move.col})`);
}
console.log("");

// --- Test 6: Must-block detection ---
console.log("Test 6: AI blocks opponent's immediate win");
{
  const board = new Board();
  // Black first (AI is black)
  // We need: it's black's turn, white has 4 in a row about to win
  // Moves: 1=black, 2=white, 3=black, 4=white, ... black's turn = odd moves
  board.makeMove(1, 0); // 1 black
  board.makeMove(7, 7); // 2 white
  board.makeMove(0, 10); // 3 black
  board.makeMove(7, 8); // 4 white
  board.makeMove(1, 1); // 5 black
  board.makeMove(7, 9); // 6 white
  board.makeMove(0, 11); // 7 black
  board.makeMove(7, 10); // 8 white - white has 4 in a row!
  // Now it's black's turn (move 9). Must block at (7,11) or (7,6)
  const ai = new AIPlayer(board, "hard");
  const move = ai.getMove();
  const isBlockMove =
    (move.row === 7 && move.col === 11) || (move.row === 7 && move.col === 6);
  assert(isBlockMove, `AI must block at (7,11) or (7,6), got (${move.row},${move.col})`);
}
console.log("");

console.log("=== All AI Tests Completed ===");
