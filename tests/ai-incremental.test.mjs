// Incremental evaluation consistency tests:
// the O(1) search-time evaluation must agree with the full board scan.
import { Board } from '../js/board.js';
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

// Deterministic PRNG so the random walks are reproducible
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

console.log('=== Incremental Evaluation Tests ===\n');

// --- Test 1: accumulators track the full scan along random search paths ---
console.log('Test 1: incremental evaluation matches full scan');
{
  const positions = [
    [
      [7, 7],
      [8, 8],
    ],
    [
      [7, 7],
      [8, 8],
      [7, 8],
      [6, 6],
      [8, 7],
      [9, 9],
      [6, 8],
      [8, 6],
      [5, 9],
      [7, 9],
    ],
    [
      [7, 7],
      [7, 11],
      [7, 8],
      [6, 2],
      [7, 10],
      [0, 0],
      [6, 3],
      [0, 3],
      [6, 4],
      [0, 6],
      [6, 5],
      [0, 9],
      [5, 7],
      [1, 1],
      [5, 8],
      [1, 4],
      [5, 9],
      [1, 7],
      [5, 10],
      [1, 10],
    ],
  ];

  for (let p = 0; p < positions.length; p++) {
    const board = setupBoard(positions[p]);
    const ai = new AIPlayer(board, 'hard');
    ai._initIncremental();

    const initialFull = ai._evaluateBoardFull(board);
    assert(
      Math.abs(ai.evaluateBoard(board) - initialFull) < 1e-6,
      `position ${p}: init matches full scan`
    );

    const rng = makeRng(42 + p);
    const stack = [];
    let steps = 0;

    for (let step = 0; step < 60; step++) {
      if (stack.length > 0 && rng() < 0.35) {
        ai._searchUndo();
        stack.pop();
        steps++;
      } else {
        if (board.getGameState() !== 'playing') break;
        const moves = board.getValidMoves(2);
        if (moves.length === 0) break;
        const move = moves[Math.floor(rng() * moves.length)];
        ai._searchMake(move);
        stack.push(move);
        steps++;
      }

      const inc = ai.evaluateBoard(board);
      const full = ai._evaluateBoardFull(board);
      if (Math.abs(inc - full) > 1e-6) {
        throw new Error(`FAIL: position ${p}, step ${step}: incremental ${inc} != full ${full}`);
      }
    }

    while (stack.length > 0) {
      ai._searchUndo();
      stack.pop();
    }
    assert(
      Math.abs(ai.evaluateBoard(board) - initialFull) < 1e-6,
      `position ${p}: evaluation restored after ${steps} make/undo steps`
    );

    ai._discardIncremental();
    assert(
      board.getMoveHistory().length === positions[p].length,
      `position ${p}: board history intact`
    );
  }
}
console.log('');

// --- Test 2: interrupted search leaves a clean state ---
console.log('Test 2: state is clean after a time-interrupted search');
{
  const board = setupBoard([
    [7, 7],
    [8, 8],
    [7, 8],
    [6, 6],
    [8, 7],
    [9, 9],
    [6, 8],
    [8, 6],
    [5, 9],
    [7, 9],
    [6, 7],
    [5, 6],
    [9, 7],
    [10, 8],
    [8, 9],
    [7, 10],
  ]);
  const before = board.getMoveHistory().length;
  const toMove = board.getCurrentPlayer();

  const ai = new AIPlayer(board, 'hard');
  ai.timeLimit = 250; // likely interrupted mid-depth
  const move = ai.getMove();

  assert(move && typeof move.row === 'number', 'getMove still returns a move');
  assert(!ai._incActive, 'incremental state discarded after search');
  assert(
    board.getMoveHistory().length === before && board.getCurrentPlayer() === toMove,
    'board restored after interrupted search'
  );

  // A second move must work (re-initialization path)
  board.makeMove(move.row, move.col);
  const ai2 = new AIPlayer(board, 'hard');
  ai2.timeLimit = 250;
  const move2 = ai2.getMove();
  assert(move2 && typeof move2.row === 'number', 'second search works too');
}
console.log('');

// --- Test 3: medium mode (depth-2 root loop) stays consistent ---
console.log('Test 3: medium search keeps the board intact');
{
  const board = setupBoard([
    [7, 7],
    [8, 8],
    [7, 8],
    [6, 6],
    [8, 7],
    [9, 9],
  ]);
  const before = board.getMoveHistory().length;
  const ai = new AIPlayer(board, 'medium');
  const move = ai.getMove();
  assert(move && typeof move.row === 'number', 'medium returns a move');
  assert(!ai._incActive, 'incremental state discarded');
  assert(board.getMoveHistory().length === before, 'board history intact');
}
console.log('');

// --- Test 4: Zobrist hash tracks search make/undo and returns to baseline ---
console.log('Test 4: Zobrist key is O(1) and consistent across make/undo');
{
  const board = setupBoard([
    [7, 7],
    [8, 8],
    [7, 8],
    [6, 6],
    [8, 7],
    [9, 9],
  ]);
  const ai = new AIPlayer(board, 'hard');
  ai._initIncremental();

  const key0 = ai.getBoardKey(board);
  assert(typeof key0 === 'number', `key is a number, got ${typeof key0}`);

  const move = board.getValidMoves(2)[0];
  ai._searchMake(move);
  const key1 = ai.getBoardKey(board);
  assert(key1 !== key0, 'hash changes after a search move');

  ai._searchUndo();
  assert(ai.getBoardKey(board) === key0, 'hash restored after undo');

  ai._discardIncremental();
  assert(
    board.getMoveHistory().length === 6,
    `board history intact (${board.getMoveHistory().length})`
  );
}
console.log('');

console.log('=== All Incremental Tests Completed ===');
