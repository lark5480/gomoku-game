// Self-play smoke test: two hard-mode AIs with tiny time budgets must not
// crash, must always return legal moves, and must leave the board intact.
import { Board } from '../js/board.js';
import { AIPlayer } from '../js/ai.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

console.log('=== AI Self-Play Smoke Tests ===\n');

{
  const board = new Board();
  const aiBlack = new AIPlayer(board, 'hard');
  aiBlack.timeLimit = 30;
  const aiWhite = new AIPlayer(board, 'hard');
  aiWhite.timeLimit = 30;

  let ply = 0;
  let invalid = null;
  while (board.getGameState() === 'playing' && ply < 24) {
    const ai = board.getCurrentPlayer() === 'black' ? aiBlack : aiWhite;
    const move = ai.getMove();
    if (!move || typeof move.row !== 'number') {
      invalid = `no move at ply ${ply}`;
      break;
    }
    if (!board.makeMove(move.row, move.col)) {
      invalid = `illegal move (${move.row},${move.col}) at ply ${ply}`;
      break;
    }
    ply++;
  }

  assert(invalid === null, invalid || `24 plies completed without corruption`);
  assert(
    ['playing', 'black_win', 'white_win'].includes(board.getGameState()),
    `terminal state is valid (${board.getGameState()})`
  );
}
console.log('');

console.log('=== All Self-Play Smoke Tests Completed ===');
