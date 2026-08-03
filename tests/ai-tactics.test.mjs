// AI tactical tests: terminal evaluation, jump shapes, double threats, VCF
import { Board, Player } from '../js/board.js';
import { AIPlayer } from '../js/ai.js';

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

console.log('=== AI Tactical Tests ===\n');

// --- Test 1: terminal node sign in negamax ---
console.log('Test 1: Winning line is valued positively by the mover');
{
  // Black just completed five at (7,11); makeMove keeps currentPlayer on the
  // winner, so the node is terminal with currentPlayer = winner.
  const board = setupBoard([
    [7, 7],
    [2, 2],
    [7, 8],
    [2, 3],
    [7, 9],
    [3, 3],
    [7, 10],
    [3, 4],
    [7, 11],
  ]);
  assert(board.getGameState() === 'black_win', 'position is terminal');
  const ai = new AIPlayer(board, 'hard');
  const score = ai.alphaBeta(board, 3, -Infinity, Infinity);
  // The parent (the winner) negates this value, so it must be negative here.
  assert(score < 0, `terminal node returns negative for negamax, got ${score}`);
  assert(-score >= 10000000, `parent sees a winning value, got ${-score}`);
}
console.log('');

// --- Test 2: jump shapes are recognized in evaluation ---
console.log('Test 2: Jump shapes score as threats');
{
  // XX_XX (jump four): filling the gap completes five -> rush-four class
  const board = setupBoard([
    [7, 5],
    [0, 0],
    [7, 6],
    [0, 1],
    [7, 8],
    [1, 0],
    [7, 9],
    [1, 1],
  ]);
  const ai = new AIPlayer(board, 'medium');
  const score = ai.evaluateBoard(board);
  assert(score >= 50000, `XX_XX scores at rush-four level (>= 50000), got ${score}`);
}
{
  // X_XX with open outsides is a jump live three
  const board = setupBoard([
    [7, 6],
    [0, 0],
    [7, 8],
    [14, 14],
    [7, 9],
    [0, 14],
  ]);
  const ai = new AIPlayer(board, 'medium');
  const score = ai.evaluateBoard(board);
  assert(score >= 5000, `X_XX open jump three scores at live-three level (>= 5000), got ${score}`);
}
console.log('');

// --- Test 3: double live-three point is played ---
console.log('Test 3: AI creates a double live three');
{
  // Black (7,7)(7,8) and (6,9)(8,9): playing (7,9) makes two live threes.
  const board = setupBoard([
    [7, 7],
    [2, 2],
    [7, 8],
    [2, 3],
    [6, 9],
    [3, 3],
    [8, 9],
    [3, 4],
  ]);
  const ai = new AIPlayer(board, 'hard');
  const move = ai.getMove();
  assert(
    move.row === 7 && move.col === 9,
    `hard plays double-three point (7,9), got (${move.row},${move.col})`
  );
}
{
  const board = setupBoard([
    [7, 7],
    [2, 2],
    [7, 8],
    [2, 3],
    [6, 9],
    [3, 3],
    [8, 9],
    [3, 4],
  ]);
  const ai = new AIPlayer(board, 'medium');
  const move = ai.getMove();
  assert(
    move.row === 7 && move.col === 9,
    `medium plays double-three point (7,9), got (${move.row},${move.col})`
  );
}
console.log('');

// --- Test 4: opponent's double-threat point is denied ---
console.log("Test 4: AI denies opponent's double live three");
{
  // White owns (7,7)(7,8) and (6,9)(8,9); (7,9) would give white two live
  // threes. Black has scattered corner stones and no counterplay.
  const board = setupBoard([
    [0, 0],
    [7, 7],
    [0, 14],
    [7, 8],
    [14, 0],
    [6, 9],
    [14, 14],
    [8, 9],
  ]);
  const ai = new AIPlayer(board, 'hard');
  const move = ai.getMove();
  assert(move.row === 7 && move.col === 9, `hard occupies (7,9), got (${move.row},${move.col})`);
}
console.log('');

// --- Test 5: forced win via live three -> live four ---
console.log('Test 5: AI extends live three into a live four');
{
  // Black live three (2,2)(2,3)(2,4); extending makes an unblockable live four.
  const board = setupBoard([
    [2, 2],
    [12, 12],
    [2, 3],
    [11, 11],
    [2, 4],
    [10, 10],
  ]);
  for (const difficulty of ['hard', 'medium']) {
    const clone = board.clone();
    const ai = new AIPlayer(clone, difficulty);
    const move = ai.getMove();
    const ok = move.row === 2 && (move.col === 1 || move.col === 5);
    assert(ok, `${difficulty} extends the three, got (${move.row},${move.col})`);
  }
}
console.log('');

// --- Test 6: VCF (continuous rush fours) is found ---
console.log('Test 6: AI finds a VCF forcing chain');
{
  // Black: sleep three (7,6)(7,7)(7,8) blocked by white (7,9), plus column-5
  // pair (5,5)(6,5). Only winning line: (7,5) rush four -> white forced to
  // block (7,4) -> (4,5) live four -> win.
  const board = setupBoard([
    [7, 6],
    [7, 9],
    [7, 7],
    [0, 0],
    [7, 8],
    [0, 3],
    [5, 5],
    [0, 6],
    [6, 5],
    [0, 9],
  ]);
  const ai = new AIPlayer(board, 'hard');
  const move = ai.getMove();
  assert(
    move.row === 7 && move.col === 5,
    `hard plays VCF first move (7,5), got (${move.row},${move.col})`
  );
}
console.log('');

// --- Test 7: opponent's VCF is disrupted ---
console.log("Test 7: AI disrupts opponent's VCF");
{
  // Mirror of test 6: white owns the forcing chain, black to move.
  const board = setupBoard([
    [7, 9],
    [7, 6],
    [0, 0],
    [7, 7],
    [0, 3],
    [7, 8],
    [0, 6],
    [5, 5],
    [0, 9],
    [6, 5],
  ]);
  const ai = new AIPlayer(board, 'hard');
  const before = ai.findVCF(Player.WHITE);
  assert(before !== null, 'white has a VCF before black moves');

  const move = ai.getMove();
  board.makeMove(move.row, move.col);

  const ai2 = new AIPlayer(board, 'hard');
  const after = ai2.findVCF(Player.WHITE);
  assert(after === null, `black move (${move.row},${move.col}) eliminates white's VCF`);
}
console.log('');

// --- Test 8: own forced win takes priority over blocking ---
console.log('Test 8: AI takes its own win instead of blocking');
{
  // Black live three on row 2 (wins by extending). White threatens a double
  // live three at (7,9). Black must take the win, not block.
  const board = setupBoard([
    [2, 2],
    [7, 7],
    [2, 3],
    [7, 8],
    [2, 4],
    [6, 9],
    [3, 4],
    [8, 9],
  ]);
  const ai = new AIPlayer(board, 'hard');
  const move = ai.getMove();
  const ok = move.row === 2 && (move.col === 1 || move.col === 5);
  assert(ok, `hard takes own win, got (${move.row},${move.col})`);
}
console.log('');

// --- Test 9: board integrity after tactical searches ---
console.log('Test 9: board state is unchanged after getMove');
{
  const board = setupBoard([
    [7, 6],
    [7, 9],
    [7, 7],
    [0, 0],
    [7, 8],
    [0, 3],
    [5, 5],
    [0, 6],
    [6, 5],
    [0, 9],
  ]);
  const ai = new AIPlayer(board, 'hard');
  ai.getMove();
  assert(
    board.getMoveHistory().length === 10,
    `move history preserved (${board.getMoveHistory().length})`
  );
  assert(
    board.getGameState() === 'playing' && board.getCurrentPlayer() === 'black',
    'game state and turn preserved'
  );
}
console.log('');

console.log('=== All Tactical Tests Completed ===');
