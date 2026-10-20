// Test script for Gomoku game logic
import { Board, Player, GameState } from '../js/board.js';

console.log('=== Gomoku Game Tests ===\n');

function runTests() {
  console.log('Test 1: Board initialization');
  const board = new Board();
  console.log(`✓ Board size: ${board.size}x${board.size}`);
  console.log(`✓ Current player: ${board.getCurrentPlayer()} (should be black)`);
  console.log(`✓ Game state: ${board.getGameState()} (should be playing)\n`);

  console.log('Test 2: Valid moves');
  const validMove = board.isValidMove(7, 7);
  console.log(`✓ Move at (7,7) valid: ${validMove} (should be true)`);

  const invalidMove = board.isValidMove(15, 15);
  console.log(`✓ Move at (15,15) valid: ${invalidMove} (should be false)\n`);

  console.log('Test 3: Making moves');
  const moveResult1 = board.makeMove(7, 7);
  console.log(`✓ First move at (7,7): ${moveResult1} (should be true)`);
  console.log(`✓ Cell value: ${board.getCell(7, 7)} (should be black)`);
  console.log(`✓ Current player: ${board.getCurrentPlayer()} (should be white)\n`);

  console.log('Test 4: Invalid move (occupied cell)');
  const moveResult2 = board.makeMove(7, 7);
  console.log(`✓ Move at occupied (7,7): ${moveResult2} (should be false)\n`);

  console.log('Test 5: Win detection - horizontal');
  const board2 = new Board();
  // Black: (7,7), (7,8), (7,9), (7,10), (7,11)
  board2.makeMove(7, 7); // Black
  board2.makeMove(0, 0); // White (different location)
  board2.makeMove(7, 8); // Black
  board2.makeMove(0, 1); // White
  board2.makeMove(7, 9); // Black
  board2.makeMove(0, 2); // White
  board2.makeMove(7, 10); // Black
  board2.makeMove(0, 3); // White
  board2.makeMove(7, 11); // Black - should win

  const gameState = board2.getGameState();
  console.log(
    `✓ Horizontal win detection: ${gameState === GameState.BLACK_WIN ? 'PASS' : 'FAIL'} (should be BLACK_WIN)\n`
  );

  console.log('Test 6: Win detection - vertical');
  const board3 = new Board();
  board3.makeMove(7, 7); // Black
  board3.makeMove(0, 0); // White
  board3.makeMove(8, 7); // Black
  board3.makeMove(0, 1); // White
  board3.makeMove(9, 7); // Black
  board3.makeMove(0, 2); // White
  board3.makeMove(10, 7); // Black
  board3.makeMove(0, 3); // White
  board3.makeMove(11, 7); // Black - should win

  const gameState3 = board3.getGameState();
  console.log(
    `✓ Vertical win detection: ${gameState3 === GameState.BLACK_WIN ? 'PASS' : 'FAIL'} (should be BLACK_WIN)\n`
  );

  console.log('Test 7: Win detection - diagonal');
  const board4 = new Board();
  board4.makeMove(7, 7); // Black
  board4.makeMove(0, 0); // White
  board4.makeMove(8, 8); // Black
  board4.makeMove(0, 1); // White
  board4.makeMove(9, 9); // Black
  board4.makeMove(0, 2); // White
  board4.makeMove(10, 10); // Black
  board4.makeMove(0, 3); // White
  board4.makeMove(11, 11); // Black - should win

  const gameState4 = board4.getGameState();
  console.log(
    `✓ Diagonal win detection: ${gameState4 === GameState.BLACK_WIN ? 'PASS' : 'FAIL'} (should be BLACK_WIN)\n`
  );

  console.log('Test 8: Undo move');
  const board5 = new Board();
  board5.makeMove(7, 7);
  board5.makeMove(0, 0);
  const movesBeforeUndo = board5.getMoveHistory().length;
  const undoResult = board5.undo();
  const movesAfterUndo = board5.getMoveHistory().length;
  console.log(`✓ Undo successful: ${undoResult} (should be true)`);
  console.log(`✓ Moves before undo: ${movesBeforeUndo} (should be 2)`);
  console.log(`✓ Moves after undo: ${movesAfterUndo} (should be 1)`);
  console.log(`✓ Cell (0,0) after undo: ${board5.getCell(0, 0)} (should be null)\n`);

  console.log('Test 9: Board full detection (draw)');
  const board6 = new Board();
  // Fill the board (simplified test - just check method exists)
  console.log(
    `✓ isBoardFull method exists: ${typeof board6.isBoardFull === 'function' ? 'PASS' : 'FAIL'}\n`
  );

  console.log('Test 10: Winning stones tracking');
  const board7 = new Board();
  board7.makeMove(7, 7);
  board7.makeMove(0, 0);
  board7.makeMove(7, 8);
  board7.makeMove(0, 1);
  board7.makeMove(7, 9);
  board7.makeMove(0, 2);
  board7.makeMove(7, 10);
  board7.makeMove(0, 3);
  board7.makeMove(7, 11); // Win

  const winningStones = board7.getWinningStones();
  console.log(`✓ Winning stones count: ${winningStones.length} (should be 5)`);
  console.log(
    `✓ Winning stones include (7,7): ${winningStones.some((s) => s.row === 7 && s.col === 7) ? 'YES' : 'NO'}`
  );
  console.log(
    `✓ Winning stones include (7,11): ${winningStones.some((s) => s.row === 7 && s.col === 11) ? 'YES' : 'NO'}\n`
  );

  console.log('Test 11: getValidMoves returns the neighborhood, not the whole board');
  const board8 = new Board();
  console.log(
    `✓ Empty board has no candidates: ${board8.getValidMoves(1).length === 0 ? 'PASS' : 'FAIL'} (should be 0)`
  );

  board8.makeMove(7, 7);
  const near1 = board8.getValidMoves(1);
  const near2 = board8.getValidMoves(2);
  const has = (moves, row, col) => moves.some((m) => m.row === row && m.col === col);

  console.log(
    `✓ radius 1 yields 8 adjacent cells: ${near1.length === 8 ? 'PASS' : 'FAIL'} (got ${near1.length})`
  );
  console.log(`✓ radius 1 excludes the far cell (5,5): ${has(near1, 5, 5) ? 'FAIL' : 'PASS'}`);
  console.log(
    `✓ radius 2 yields 24 cells (5x5 minus the stone): ${near2.length === 24 ? 'PASS' : 'FAIL'} (got ${near2.length})`
  );
  console.log(`✓ radius 2 covers jump points like (5,5): ${has(near2, 5, 5) ? 'PASS' : 'FAIL'}`);
  console.log(
    `✓ radius 2 stops at Chebyshev distance 2, no (4,4): ${has(near2, 4, 4) ? 'FAIL' : 'PASS'}`
  );
  console.log(
    `✓ candidates never include occupied cells: ${
      near2.every((m) => board8.getCell(m.row, m.col) === null) ? 'PASS' : 'FAIL'
    }`
  );
  console.log(
    `✓ candidates are far fewer than all 225 cells: ${
      near2.length < 225 ? 'PASS' : 'FAIL'
    } (this is what AI candidate generation relies on)\n`
  );

  console.log('Test 12: getValidMoves clamps to the board edge');
  const board9 = new Board();
  board9.makeMove(0, 0);
  const corner = board9.getValidMoves(1);
  console.log(
    `✓ Corner stone has only 3 neighbors: ${corner.length === 3 ? 'PASS' : 'FAIL'} (got ${corner.length})`
  );
  console.log(
    `✓ No out-of-bounds candidate: ${
      corner.every((m) => m.row >= 0 && m.row < 15 && m.col >= 0 && m.col < 15) ? 'PASS' : 'FAIL'
    }\n`
  );

  console.log('=== All Tests Completed ===');
  console.log('Note: For complete testing, open the game in a browser and play a few rounds.');
}

// Run tests
try {
  runTests();
} catch (error) {
  console.error('Test failed with error:', error);
  process.exit(1);
}
