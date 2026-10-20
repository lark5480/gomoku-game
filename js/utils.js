/**
 * Utility functions for Gomoku game
 */

// Constants
export const BOARD_SIZE = 15;
export const CELL_SIZE = 40;
export const BOARD_PADDING = 20;

/**
 * Convert screen coordinates to board coordinates
 * @param {number} x - X coordinate on screen
 * @param {number} y - Y coordinate on screen
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {number} [cellSize] - Optional cell size (defaults to CELL_SIZE)
 * @returns {Object|null} Board coordinates {row, col} or null if outside board
 */
export function screenToBoard(x, y, canvas, cellSize = CELL_SIZE) {
  const rect = canvas.getBoundingClientRect();
  const canvasX = x - rect.left;
  const canvasY = y - rect.top;

  // Adjust for board padding
  const boardX = canvasX - BOARD_PADDING;
  const boardY = canvasY - BOARD_PADDING;

  // Calculate grid position (round to nearest intersection)
  const col = Math.round(boardX / cellSize);
  const row = Math.round(boardY / cellSize);

  // Check if within board bounds
  if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
    return { row, col };
  }

  return null;
}

/**
 * Check if a position is valid on the board
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @returns {boolean} True if valid position
 */
export function isValidPosition(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/**
 * Deep clone a 2D array
 * @param {Array} array - 2D array to clone
 * @returns {Array} Cloned array
 */
export function clone2DArray(array) {
  return array.map((row) => [...row]);
}

/**
 * Get opposite player
 * @param {string} player - Current player ('black' or 'white')
 * @returns {string} Opposite player
 */
export function getOppositePlayer(player) {
  return player === 'black' ? 'white' : 'black';
}
