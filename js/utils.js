/**
 * Utility functions for Gomoku game
 */

// Constants
export const BOARD_SIZE  =  15;
export const CELL_SIZE = 40;
export const BOARD_PADDING = 20;
export const STONE_RADIUS = 18;

/**
 * Clamp a value between min and max
 * @param {number} value - The value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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

  // Calculate grid position
  const col = Math.floor(boardX / cellSize);
  const row = Math.floor(boardY / cellSize);

  // Check if within board bounds
  if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
    return { row, col };
  }

  return null;
}

/**
 * Convert board coordinates to screen coordinates
 * @param {number} row - Row on board (0-14)
 * @param {number} col - Column on board (0-14)
 * @param {number} [cellSize] - Optional cell size (defaults to CELL_SIZE)
 * @returns {Object} Screen coordinates {x, y}
 */
export function boardToScreen(row, col, cellSize = CELL_SIZE) {
  const x = BOARD_PADDING + col * cellSize;
  const y = BOARD_PADDING + row * cellSize;
  return { x, y };
}

/**
 * Calculate distance between two points
 * @param {number} x1 - First point x
 * @param {number} y1 - First point y
 * @param {number} x2 - Second point x
 * @param {number} y2 - Second point y
 * @returns {number} Distance
 */
export function distance(x1, y1, x2, y2) {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
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
  return player === "black" ? "white" : "black";
}

/**
 * Format player name for display
 * @param {string} player - Player ('black' or 'white')
 * @returns {string} Formatted player name
 */
export function formatPlayerName(player) {
  return player.charAt(0).toUpperCase() + player.slice(1);
}

/**
 * Debounce function to limit how often a function can be called
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Create a unique ID
 * @returns {string} Unique ID
 */
export function createId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Get current timestamp
 * @returns {number} Current timestamp in milliseconds
 */
export function getTimestamp() {
  return Date.now();
}

/**
 * Calculate dynamic cell size based on canvas width
 * @param {number} canvasWidth - Width of the canvas element
 * @returns {number} Dynamic cell size
 */
export function getCellSize(canvasWidth) {
  return (canvasWidth - 2 * BOARD_PADDING) / (BOARD_SIZE - 1);
}
