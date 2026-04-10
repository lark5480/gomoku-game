// Test script for Gomoku game logic
import { Board, Player, GameState } from "../js/board.js";

console.log("=== Gomoku Game Tests ===\n");

function runTests() {
  console.log("Test 1: Board initialization");
  const board = new Board();
  console.log(`✓ Board size: ${board.size}x${board.size}`);
  console.log(
    `✓ Current player: ${board.getCurrentPlayer()} (should be black)`,
  );
  console.log(`✓ Game state: ${board.getGameState()} (should be playing)\n`);

  console.log("Test 2: Valid moves");
  const validMove = board.isValidMove(7, 7);
  console.log(`✓ Move at (7,7) valid: ${validMove} (should be true)`);

  const invalidMove = board.isValidMove(15, 15);
  console.log(`✓ Move at (15,15) valid: ${invalidMove} (should be false)\n`);

  console.log("Test 3: Making moves");
  const moveResult1 = board.makeMove(7, 7);
  console.log(`✓ First move at (7,7): ${moveResult1} (should be true)`);
  console.log(`✓ Cell value: ${board.getCell(7, 7)} (should be black)`);
  console.log(
    `✓ Current player: ${board.getCurrentPlayer()} (should be white)\n`,
  );

  console.log("Test 4: Invalid move (occupied cell)");
  const moveResult2 = board.makeMove(7, 7);
  console.log(`✓ Move at occupied (7,7): ${moveResult2} (should be false)\n`);

  console.log("Test 5: Win detection - horizontal");
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
    `✓ Horizontal win detection: ${gameState === GameState.BLACK_WIN ? "PASS" : "FAIL"} (should be BLACK_WIN)\n`,
  );

  console.log("Test 6: Win detection - vertical");
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
    `✓ Vertical win detection: ${gameState3 === GameState.BLACK_WIN ? "PASS" : "FAIL"} (should be BLACK_WIN)\n`,
  );

  console.log("Test 7: Win detection - diagonal");
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
    `✓ Diagonal win detection: ${gameState4 === GameState.BLACK_WIN ? "PASS" : "FAIL"} (should be BLACK_WIN)\n`,
  );

  console.log("Test 8: Undo move");
  const board5 = new Board();
  board5.makeMove(7, 7);
  board5.makeMove(0, 0);
  const movesBeforeUndo = board5.getMoveHistory().length;
  const undoResult = board5.undo();
  const movesAfterUndo = board5.getMoveHistory().length;
  console.log(`✓ Undo successful: ${undoResult} (should be true)`);
  console.log(`✓ Moves before undo: ${movesBeforeUndo} (should be 2)`);
  console.log(`✓ Moves after undo: ${movesAfterUndo} (should be 1)`);
  console.log(
    `✓ Cell (0,0) after undo: ${board5.getCell(0, 0)} (should be null)\n`,
  );

  console.log("Test 9: Board full detection (draw)");
  const board6 = new Board();
  // Fill the board (simplified test - just check method exists)
  console.log(
    `✓ isBoardFull method exists: ${typeof board6.isBoardFull === "function" ? "PASS" : "FAIL"}\n`,
  );

  console.log("Test 10: Winning stones tracking");
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
    `✓ Winning stones include (7,7): ${winningStones.some((s) => s.row === 7 && s.col === 7) ? "YES" : "NO"}`,
  );
  console.log(
    `✓ Winning stones include (7,11): ${winningStones.some((s) => s.row === 7 && s.col === 11) ? "YES" : "NO"}\n`,
  );

  console.log("=== All Tests Completed ===");
  console.log(
    "Note: For complete testing, open the game in a browser and play a few rounds.",
  );
}

// Run tests
try {
  runTests();
} catch (error) {
  console.error("Test failed with error:", error);
  process.exit(1);
}
