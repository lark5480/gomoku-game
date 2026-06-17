/**
 * Main game controller for Gomoku
 * Handles rendering and user interaction
 */

import { Board, GameState, Player } from "./board.js";
import { AIPlayer } from "./ai.js";
import { ReplayPlayer } from "./replay.js";
import { OnlineManager } from "./online.js";
import {
  screenToBoard,
  CELL_SIZE,
  BOARD_PADDING,
  BOARD_SIZE,
} from "./utils.js";

// Development mode switch
const IS_DEV = false; // Set to false for production, true for development

/**
 * Debug logging utility
 * @param {...any} args - Arguments to log
 */
function debugLog(...args) {
  if (IS_DEV) {
    console.log(...args);
  }
}

class GomokuGame {
  constructor() {
    this.canvas = document.getElementById("gameBoard");
    if (!this.canvas || !(this.canvas instanceof HTMLCanvasElement)) {
      throw new Error("游戏画布元素未找到或类型错误");
    }
    this.ctx = this.canvas.getContext("2d");
    this.board = new Board();

    // UI elements
    this.currentPlayerElement = document.getElementById("currentPlayer");
    if (!this.currentPlayerElement) {
      throw new Error("当前玩家显示元素未找到");
    }

    this.gameStatusElement = document.getElementById("gameStatus");
    if (!this.gameStatusElement) {
      throw new Error("游戏状态显示元素未找到");
    }

    this.restartBtn = document.getElementById("restartBtn");
    if (!this.restartBtn) {
      throw new Error("重新开始按钮未找到");
    }

    this.undoBtn = document.getElementById("undoBtn");
    if (!this.undoBtn) {
      throw new Error("撤销按钮未找到");
    }
    // Save original undo button content so we can toggle it for online surrender
    this._undoBtnOriginalHTML = this.undoBtn.innerHTML;

    this.hintBtn = document.getElementById("hintBtn");
    if (!this.hintBtn) {
      throw new Error("提示按钮未找到");
    }

    // Start screen elements
    this.startScreen = document.getElementById("startScreen");
    this.pvpBtn = document.getElementById("pvpBtn");
    this.aiBtn = document.getElementById("aiBtn");
    this.startBtn = document.getElementById("startBtn");
    this.difficultySelection = document.getElementById("difficultySelection");
    this.gameModeDisplay = document.getElementById("gameMode");

    // Game state
    this.isAnimating = false;
    this.highlightedCell = null;
    this.hintCell = null;
    this.isHintActive = false;
    this.hintTimeout = null;
    this.hintAnimationId = null;
    this.cellSize = null;

    // AI game mode
    this.gameMode = "pvp";
    this.aiDifficulty = "medium";
    this.aiPlayer = new AIPlayer(this.board, this.aiDifficulty);
    this.aiPlayerColor = Player.WHITE; // AI plays as WHITE (player plays as BLACK)

    // Replay mode
    this.replay = new ReplayPlayer();
    this.inReplayMode = false;
    this.replayBar = null;
    this.replayStepDisplay = null;

    // Online mode
    this.online = new OnlineManager();
    this.onlineRoomCode = null;
    this.onlineMyColor = null;
    this.onlineOpponentReady = false;
    this.onlineOverlay = null;

    // Initialize
    this.init();
  }

  /**
   * Initialize the game
   */
  init() {
    // Set canvas size
    this.setCanvasSize();

    // Draw initial board
    this.drawBoard();

    // Add event listeners
    this.addEventListeners();

    // Update UI
    this.updateUI();

    // Handle window resize
    window.addEventListener("resize", () => {
      this.setCanvasSize();
      this.drawBoard();
    });
  }

  /**
   * Set canvas size based on device
   */
  setCanvasSize() {
    const isMobile = window.innerWidth <= 768;
    const size = isMobile ? 400 : 600;

    this.canvas.width = size;
    this.canvas.height = size;

    // Update cell size for coordinate conversion
    this.cellSize = (size - 2 * BOARD_PADDING) / (BOARD_SIZE - 1);
  }

  /**
   * Add event listeners
   */
  addEventListeners() {
    // Canvas click for placing stones
    this.canvas.addEventListener("click", (e) => this.handleCanvasClick(e));

    // Canvas mouse move for highlighting
    this.canvas.addEventListener("mousemove", (e) => this.handleMouseMove(e));
    this.canvas.addEventListener("mouseleave", () => {
      if (this.inReplayMode) return;
      this.highlightedCell = null;
      this.drawBoard();
    });

    // Control buttons
    this.restartBtn.addEventListener("click", () => this.restartGame());
    this.undoBtn.addEventListener("click", () => {
      if (this.gameMode === "online" && this.board.getGameState() === GameState.PLAYING) {
        this.online.sendSurrender();
      } else {
        this.undoMove();
      }
    });
    this.hintBtn.addEventListener("click", () => this.showHint());

    // Start screen buttons
    this.pvpBtn.addEventListener("click", () => this.handleModeSelect("pvp"));
    this.aiBtn.addEventListener("click", () => this.handleModeSelect("ai"));
    this.startBtn.addEventListener("click", () => this.startGame());

    // Difficulty buttons
    const diffButtons = this.difficultySelection.querySelectorAll(".diff-btn");
    diffButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const difficulty = btn.dataset.difficulty;
        this.handleDifficultySelect(difficulty);
      });
    });

    // Replay elements (lazy-init, created when game ends)
    this.replayBtn = document.getElementById("replayBtn");
    this.replayBar = document.getElementById("replayBar");
    if (this.replayBtn) {
      this.replayBtn.addEventListener("click", () => this.startReplay());
      this.replayBtn.style.display = "none";
    }
    if (this.replayBar) {
      this.replayBar.style.display = "none";
      this.setupReplayControls();
    }

    // Online mode elements
    this.onlineBtn = document.getElementById("onlineBtn");
    this.onlineLobby = document.getElementById("onlineLobby");
    if (this.onlineBtn) {
      this.onlineBtn.addEventListener("click", () => this.handleModeSelect("online"));
    }
    this.setupOnlineLobby();
    this.setupOnlineCallbacks();
  }

  /**
   * Handle mode selection from start screen
   * @param {string} mode - 'pvp' or 'ai'
   */
  handleModeSelect(mode) {
    this.setGameMode(mode);

    // Update UI
    this.pvpBtn.classList.toggle("selected", mode === "pvp");
    this.aiBtn.classList.toggle("selected", mode === "ai");
    if (this.onlineBtn) this.onlineBtn.classList.toggle("selected", mode === "online");

    // Show/hide difficulty selection
    this.difficultySelection.classList.toggle("visible", mode === "ai");

    // Show/hide online lobby
    if (this.onlineLobby) {
      this.onlineLobby.classList.toggle("visible", mode === "online");
    }
  }

  /**
   * Handle difficulty selection
   * @param {string} difficulty - 'easy', 'medium', or 'hard'
   */
  handleDifficultySelect(difficulty) {
    this.setAIDifficulty(difficulty);

    // Update UI
    const diffButtons = this.difficultySelection.querySelectorAll(".diff-btn");
    diffButtons.forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.difficulty === difficulty);
    });
  }

  /**
   * Start the game
   */
  startGame() {
    // Hide start screen
    if (this.startScreen) {
      this.startScreen.style.display = "none";
    }

    // Update game mode display
    if (this.gameModeDisplay) {
      const modeNames = { ai: "AI 模式", pvp: "双人模式", online: "在线对战" };
      this.gameModeDisplay.textContent = modeNames[this.gameMode] || "双人模式";
    }

    if (this.gameMode === "online") {
      // Online mode: don't start game yet, wait for room creation/join
      this.resetGame();
      // Show lobby overlay on the game screen
      this.showOnlineLobby();
      return;
    }

    // Initialize AI player if in AI mode
    if (this.gameMode === "ai") {
      this.aiPlayer = new AIPlayer(this.board, this.aiDifficulty);
    }

    // Reset and start fresh
    this.resetGame();
  }

  /**
   * Handle canvas click
   * @param {MouseEvent} e - Mouse event
   */
  handleCanvasClick(e) {
    if (this.inReplayMode) return;
    if (this.isAnimating || this.board.getGameState() !== GameState.PLAYING) {
      return;
    }

    // Skip if it's AI's turn
    if (
      this.gameMode === "ai" &&
      this.board.getCurrentPlayer() === this.aiPlayerColor
    ) {
      return;
    }

    // Skip if online and not our turn
    if (
      this.gameMode === "online" &&
      this.board.getCurrentPlayer() !== this.onlineMyColor
    ) {
      return;
    }

    const boardPos = screenToBoard(
      e.clientX,
      e.clientY,
      this.canvas,
      this.cellSize,
    );
    if (!boardPos) return;

    const { row, col } = boardPos;

    if (this.board.makeMove(row, col)) {
      // Clear hint if player moves to hint position
      if (
        this.hintCell &&
        this.hintCell.row === row &&
        this.hintCell.col === col
      ) {
        this.clearHint();
      }

      // Draw the stone with animation
      this.drawStone(
        row,
        col,
        this.board.getCurrentPlayer() === Player.WHITE
          ? Player.BLACK
          : Player.WHITE,
        true,
      );

      // Update UI
      this.updateUI();

      // Enable/disable undo button
      this.undoBtn.disabled = this.board.getMoveHistory().length === 0;

      // Send move to server in online mode
      if (this.gameMode === "online") {
        this.online.sendMove(row, col);
      }

      // Trigger AI move if in AI mode and game continues
      if (
        this.gameMode === "ai" &&
        this.board.getGameState() === GameState.PLAYING
      ) {
        this.makeAIMove();
      }
    }
  }

  /**
   * Handle mouse movement for highlighting
   * @param {MouseEvent} e - Mouse event
   */
  handleMouseMove(e) {
    if (this.inReplayMode) return;
    if (this.isAnimating || this.board.getGameState() !== GameState.PLAYING) {
      this.highlightedCell = null;
      return;
    }

    const boardPos = screenToBoard(
      e.clientX,
      e.clientY,
      this.canvas,
      this.cellSize,
    );
    if (!boardPos) {
      this.highlightedCell = null;
      this.drawBoard();
      return;
    }

    const { row, col } = boardPos;

    // Only highlight if cell is empty
    if (this.board.getCell(row, col) === null) {
      this.highlightedCell = { row, col };
      this.drawBoard();
    } else if (this.highlightedCell) {
      this.highlightedCell = null;
      this.drawBoard();
    }
  }

  /**
   * Draw the entire game board
   */
  drawBoard() {
    const { width, height } = this.canvas;
    const ctx = this.ctx;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw background
    ctx.fillStyle = "#deb887";
    ctx.fillRect(0, 0, width, height);

    // Calculate cell size based on current canvas size
    const cellSize = this.cellSize;

    // Draw grid lines
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;

    // Draw vertical lines
    for (let i = 0; i < BOARD_SIZE; i++) {
      const x = BOARD_PADDING + i * cellSize;
      ctx.beginPath();
      ctx.moveTo(x, BOARD_PADDING);
      ctx.lineTo(x, height - BOARD_PADDING);
      ctx.stroke();
    }

    // Draw horizontal lines
    for (let i = 0; i < BOARD_SIZE; i++) {
      const y = BOARD_PADDING + i * cellSize;
      ctx.beginPath();
      ctx.moveTo(BOARD_PADDING, y);
      ctx.lineTo(width - BOARD_PADDING, y);
      ctx.stroke();
    }

    // Draw star points (traditional Gomoku points)
    this.drawStarPoints(ctx, cellSize);

    // Draw existing stones
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const player = this.board.getCell(row, col);
        if (player) {
          const isWinning = this.board.isWinningStone(row, col);
          this.drawStone(row, col, player, false, isWinning);
        }
      }
    }

    // Draw highlighted cell (mouse hover)
    if (this.highlightedCell) {
      this.drawHoverHighlight(
        this.highlightedCell.row,
        this.highlightedCell.col,
        ctx,
        cellSize,
      );
    }

    // Draw hint cell
    if (this.isHintActive && this.hintCell) {
      this.drawHighlight(this.hintCell.row, this.hintCell.col, ctx, cellSize);
    }
  }

  /**
   * Draw star points on the board
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} cellSize - Size of each cell
   */
  drawStarPoints(ctx, cellSize) {
    const points = [3, 7, 11]; // Positions for 15x15 board

    ctx.fillStyle = "#000000";

    for (const row of points) {
      for (const col of points) {
        // Skip center if it's the intersection of all three
        if (row === 7 && col === 7) continue;

        const x = BOARD_PADDING + col * cellSize;
        const y = BOARD_PADDING + row * cellSize;

        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw center point
    const centerX = BOARD_PADDING + 7 * cellSize;
    const centerY = BOARD_PADDING + 7 * cellSize;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Draw a stone on the board
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @param {string} player - Player ('black' or 'white')
   * @param {boolean} animate - Whether to animate the stone
   * @param {boolean} isWinning - Whether this is a winning stone
   */
  drawStone(row, col, player, animate = false, isWinning = false) {
    const cellSize = this.cellSize;
    const x = BOARD_PADDING + col * cellSize;
    const y = BOARD_PADDING + row * cellSize;
    const radius = cellSize * 0.4;

    const ctx = this.ctx;

    // Create gradient for stone
    const gradient = ctx.createRadialGradient(
      x - radius / 3,
      y - radius / 3,
      1,
      x,
      y,
      radius,
    );

    if (player === Player.BLACK) {
      gradient.addColorStop(0, "#666666");
      gradient.addColorStop(0.7, "#000000");
      gradient.addColorStop(1, "#000000");
    } else {
      gradient.addColorStop(0, "#FFFFFF");
      gradient.addColorStop(0.7, "#CCCCCC");
      gradient.addColorStop(1, "#AAAAAA");
    }

    // Draw stone shadow
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Draw stone
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);

    if (animate) {
      this.animateStone(ctx, x, y, radius, gradient, isWinning);
    } else {
      ctx.fillStyle = gradient;
      ctx.fill();

      if (isWinning) {
        this.highlightWinningStone(ctx, x, y, radius);
      }
    }

    ctx.restore();
  }

  /**
   * Animate stone placement
   */
  animateStone(ctx, x, y, radius, gradient, isWinning) {
    this.isAnimating = true;

    let scale = 0;
    const animationDuration = 300; // ms
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / animationDuration, 1);

      // Easing function
      scale = 1 - Math.pow(1 - progress, 3);

      // Clear and redraw board
      this.drawBoard();

      // Draw animated stone
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.translate(-x, -y);

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      if (isWinning && progress === 1) {
        this.highlightWinningStone(ctx, x, y, radius);
      }

      ctx.restore();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.isAnimating = false;

        // Redraw to ensure winning stones are highlighted
        if (isWinning) {
          this.drawBoard();
        }
      }
    };

    animate();
  }

  /**
   * Highlight a winning stone
   */
  highlightWinningStone(ctx, x, y, radius) {
    ctx.save();
    ctx.strokeStyle = "#FFD700";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw hover highlight on empty cell (mouse hover)
   */
  drawHoverHighlight(row, col, ctx, cellSize) {
    const x = BOARD_PADDING + col * cellSize;
    const y = BOARD_PADDING + row * cellSize;
    const radius = cellSize * 0.15;

    ctx.save();
    ctx.fillStyle =
      this.board.getCurrentPlayer() === Player.BLACK
        ? "rgba(0, 0, 0, 0.3)"
        : "rgba(255, 255, 255, 0.3)";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draw hint highlight on empty cell
   */
  drawHighlight(row, col, ctx, cellSize) {
    debugLog("Drawing hint at", row, col);
    const x = BOARD_PADDING + col * cellSize;
    const y = BOARD_PADDING + row * cellSize;
    const radius = cellSize * 0.25;

    ctx.save();
    this.drawHintGlow(x, y, radius, ctx);
    this.drawHintInnerCircle(x, y, radius, ctx);
    this.drawHintPulse(x, y, radius, ctx);
    ctx.restore();
  }

  /**
   * Draw outer glow for hint
   */
  drawHintGlow(x, y, radius, ctx) {
    const gradient = ctx.createRadialGradient(
      x,
      y,
      radius * 0.5,
      x,
      y,
      radius * 2,
    );

    if (this.board.getCurrentPlayer() === Player.BLACK) {
      gradient.addColorStop(0, "rgba(255, 215, 0, 0.8)");
      gradient.addColorStop(0.5, "rgba(255, 215, 0, 0.4)");
      gradient.addColorStop(1, "rgba(255, 215, 0, 0)");
    } else {
      gradient.addColorStop(0, "rgba(0, 191, 255, 0.8)");
      gradient.addColorStop(0.5, "rgba(0, 191, 255, 0.4)");
      gradient.addColorStop(1, "rgba(0, 191, 255, 0)");
    }

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Draw inner circle for hint
   */
  drawHintInnerCircle(x, y, radius, ctx) {
    ctx.fillStyle =
      this.board.getCurrentPlayer() === Player.BLACK
        ? "rgba(255, 215, 0, 0.8)"
        : "rgba(0, 191, 255, 0.8)";
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Draw pulsing effect for hint
   */
  drawHintPulse(x, y, radius, ctx) {
    ctx.strokeStyle =
      this.board.getCurrentPlayer() === Player.BLACK
        ? "rgba(255, 215, 0, 1)"
        : "rgba(0, 191, 255, 1)";
    ctx.lineWidth = 3;
    const pulseRadius = radius * 1.8 * (1 + 0.3 * Math.sin(Date.now() / 500));
    ctx.beginPath();
    ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * Update UI elements
   */
  updateUI() {
    const gameState = this.board.getGameState();
    const currentPlayer = this.board.getCurrentPlayer();

    // Update current player display
    const playerIcon = this.currentPlayerElement.querySelector(".player-icon");
    playerIcon.className = "player-icon";
    playerIcon.classList.add(currentPlayer);

    const playerText = currentPlayer === Player.BLACK ? "黑子 下" : "白子 下";
    this.currentPlayerElement.querySelector(
      "span:not(.player-icon)",
    ).textContent = playerText;

    // Update game status
    let statusText = "游戏进行中";
    let statusColor = "#4dff88";

    switch (gameState) {
      case GameState.BLACK_WIN:
        statusText = "黑子 胜!";
        statusColor = "#FFD700";
        break;
      case GameState.WHITE_WIN:
        statusText = "白子 胜!";
        statusColor = "#FFD700";
        break;
      case GameState.DRAW:
        statusText = "Game Draw!";
        statusColor = "#FFA500";
        break;
    }

    this.gameStatusElement.textContent = statusText;
    this.gameStatusElement.style.color = statusColor;

    // Update button states
    this.restartBtn.disabled = this.gameMode === "online" && gameState === GameState.PLAYING;

    if (this.gameMode === "online" && gameState === GameState.PLAYING) {
      // Online mode: repurpose undo button as surrender
      this.undoBtn.disabled = false;
      this.undoBtn.innerHTML = '<i class="fas fa-flag"></i> 认输';
    } else {
      this.undoBtn.disabled =
        this.gameMode === "online" ||
        this.board.getMoveHistory().length === 0 ||
        gameState !== GameState.PLAYING;
      // Restore original undo text if it was changed
      if (this.undoBtn.innerHTML !== this._undoBtnOriginalHTML) {
        this.undoBtn.innerHTML = this._undoBtnOriginalHTML;
      }
    }

    // Disable hint in online mode
    this.hintBtn.disabled = this.gameMode === "online";

    // Clear hint if game is over
    if (gameState !== GameState.PLAYING) {
      this.clearHint();
      // Show replay button when game ends
      if (this.replayBtn && this.board.getMoveHistory().length > 0) {
        this.replayBtn.style.display = "";
      }
    } else {
      if (this.replayBtn) this.replayBtn.style.display = "none";
    }
  }

  /**
   * Restart the game
   */
  restartGame() {
    if (this.gameMode === "online") {
      this.online.sendRestart();
      return;
    }
    this.resetGame();
  }

  /**
   * Set game mode
   * @param {string} mode - 'pvp' or 'ai'
   */
  setGameMode(mode) {
    this.gameMode = mode;
    if (mode === "ai") {
      this.aiPlayer = new AIPlayer(this.board, this.aiDifficulty);
    }
  }

  /**
   * Set AI difficulty
   * @param {string} difficulty - 'easy', 'medium', or 'hard'
   */
  setAIDifficulty(difficulty) {
    this.aiDifficulty = difficulty;
    if (this.gameMode === "ai") {
      this.aiPlayer = new AIPlayer(this.board, difficulty);
    }
  }

  /**
   * Reset the game completely
   */
  resetGame() {
    this.exitReplayMode();
    this.board.reset();
    this.highlightedCell = null;
    this.clearHint();
    if (this.gameMode === "ai") {
      this.aiPlayer = new AIPlayer(this.board, this.aiDifficulty);
    }
    this.drawBoard();
    this.updateUI();
  }

  /**
   * Make AI move
   */
  makeAIMove() {
    if (
      this.gameMode !== "ai" ||
      this.board.getGameState() !== GameState.PLAYING
    ) {
      return;
    }

    // Show AI thinking indicator
    this.gameStatusElement.textContent = "AI 思考中...";
    this.gameStatusElement.style.color = "#FFA500";

    // Use setTimeout to allow UI to update before AI computation
    setTimeout(() => {
      const move = this.aiPlayer.getMove();
      if (move && this.board.makeMove(move.row, move.col)) {
        this.drawStone(move.row, move.col, this.aiPlayerColor, true);
        this.updateUI();
        this.undoBtn.disabled = this.board.getMoveHistory().length === 0;
      }
    }, 100);
  }

  /**
   * Undo the last move
   */
  undoMove() {
    if (this.board.undo()) {
      // In AI mode, undo both the AI's move and the player's move
      // so it's always the player's turn after undo
      if (
        this.gameMode === "ai" &&
        this.board.getMoveHistory().length > 0 &&
        this.board.getCurrentPlayer() === this.aiPlayerColor
      ) {
        this.board.undo();
      }
      this.clearHint();
      this.drawBoard();
      this.updateUI();
    }
  }

  /**
   * Show a hint (improved implementation)
   */
  showHint() {
    debugLog("Hint button clicked");
    if (this.board.getGameState() !== GameState.PLAYING || this.isAnimating) {
      debugLog("Game not in playing state or animating, ignoring hint");
      return;
    }

    // Clear any existing hint
    this.clearHint();

    // Find a good position for hint
    const hintPosition = this.findBestHintPosition();
    if (!hintPosition) {
      // Fallback to center if no good position found
      this.hintCell = {
        row: Math.floor(BOARD_SIZE / 2),
        col: Math.floor(BOARD_SIZE / 2),
      };
      debugLog("No hint position found, using center:", this.hintCell);
    } else {
      this.hintCell = hintPosition;
      debugLog("Hint position set to:", this.hintCell);
    }

    // Activate hint
    this.isHintActive = true;
    debugLog("Hint activated, isHintActive:", this.isHintActive);
    this.drawBoard();

    // Start hint animation loop
    this.startHintAnimation();

    // Clear hint after 5 seconds
    this.hintTimeout = setTimeout(() => {
      this.clearHint();
    }, 5000);
  }

  /**
   * Find a good position for hint
   * Looks for positions near existing stones
   */
  findBestHintPosition() {
    debugLog("Finding best hint position");
    const emptyPositions = this.collectEmptyPositions();

    if (emptyPositions.length === 0) return null;

    // Score all positions
    for (const pos of emptyPositions) {
      pos.score = this.scorePosition(pos);
    }

    // Return position with highest score
    return this.selectBestPosition(emptyPositions);
  }

  /**
   * Collect all empty positions on the board
   */
  collectEmptyPositions() {
    const positions = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (this.board.getCell(row, col) === null) {
          positions.push({ row, col, score: 0 });
        }
      }
    }
    return positions;
  }

  /**
   * Score a position based on proximity to existing stones and center
   */
  scorePosition(pos) {
    let score = 0;

    // Check surrounding area for existing stones
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r = pos.row + dr;
        const c = pos.col + dc;

        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
          if (this.board.getCell(r, c) !== null) {
            const distance = Math.sqrt(dr * dr + dc * dc);
            score += 10 / (distance + 1);
          }
        }
      }
    }

    // Bonus for center positions
    const center = BOARD_SIZE / 2;
    const distanceFromCenter = Math.sqrt(
      Math.pow(pos.row - center, 2) + Math.pow(pos.col - center, 2),
    );
    score += 20 / (distanceFromCenter + 1);

    return score;
  }

  /**
   * Select the best position from scored positions
   */
  selectBestPosition(positions) {
    positions.sort((a, b) => b.score - a.score);
    const bestPos = positions[0];
    debugLog(
      "Best hint position found:",
      bestPos.row,
      bestPos.col,
      "with score:",
      bestPos.score,
    );
    debugLog("Total empty positions:", positions.length);
    return { row: bestPos.row, col: bestPos.col };
  }

  /**
   * Clear the current hint
   */
  clearHint() {
    this.isHintActive = false;
    this.hintCell = null;
    if (this.hintTimeout) {
      clearTimeout(this.hintTimeout);
      this.hintTimeout = null;
    }
    this.stopHintAnimation();
    this.drawBoard();
  }

  /**
   * Start hint animation loop
   */
  startHintAnimation() {
    debugLog("Starting hint animation");
    if (this.hintAnimationId) {
      debugLog("Hint animation already running");
      return; // Already animating
    }

    const animate = () => {
      if (!this.isHintActive) {
        debugLog("Hint not active, stopping animation");
        this.stopHintAnimation();
        return;
      }

      // Only redraw hint area instead of entire board for performance
      this.redrawHintArea();

      // Continue animation
      this.hintAnimationId = requestAnimationFrame(animate);
    };

    // Start animation loop
    this.hintAnimationId = requestAnimationFrame(animate);
    debugLog("Hint animation started with id:", this.hintAnimationId);
  }

  /**
   * Redraw only the hint area for animation performance
   */
  redrawHintArea() {
    if (!this.hintCell) return;

    const { row, col } = this.hintCell;
    const cellSize = this.cellSize;
    const x = BOARD_PADDING + col * cellSize;
    const y = BOARD_PADDING + row * cellSize;
    const radius = cellSize * 0.25;

    // Clear only the hint area
    const clearRadius = radius * 3;
    this.ctx.clearRect(
      x - clearRadius,
      y - clearRadius,
      clearRadius * 2,
      clearRadius * 2,
    );

    // Redraw grid lines that were cleared
    this.ctx.strokeStyle = "#000000";
    this.ctx.lineWidth = 1;

    // Vertical line
    this.ctx.beginPath();
    this.ctx.moveTo(x, BOARD_PADDING);
    this.ctx.lineTo(x, this.canvas.height - BOARD_PADDING);
    this.ctx.stroke();

    // Horizontal line
    this.ctx.beginPath();
    this.ctx.moveTo(BOARD_PADDING, y);
    this.ctx.lineTo(this.canvas.width - BOARD_PADDING, y);
    this.ctx.stroke();

    // Redraw hint highlight
    this.drawHintGlow(x, y, radius, this.ctx);
    this.drawHintInnerCircle(x, y, radius, this.ctx);
    this.drawHintPulse(x, y, radius, this.ctx);
  }

  /**
   * Stop hint animation loop
   */
  stopHintAnimation() {
    debugLog("Stopping hint animation");
    if (this.hintAnimationId) {
      debugLog("Cancelling animation frame:", this.hintAnimationId);
      cancelAnimationFrame(this.hintAnimationId);
      this.hintAnimationId = null;
    }
  }

  // ==================== Replay Methods ====================

  /** Enter replay mode and load the current game's move history */
  startReplay() {
    const history = this.board.getMoveHistory();
    if (!history || history.length === 0) return;

    this.inReplayMode = true;
    this.hideOnlineStatus();
    this.replay.load(history.map((m) => ({ row: m.row, col: m.col, player: m.player })));
    this.replay.onChange = (step, total, playing) => {
      this.updateReplayUI(step, total, playing);
      this.redrawReplayBoard();
    };

    // Show replay bar, hide normal controls
    if (this.replayBar) this.replayBar.style.display = "";
    if (this.replayBtn) this.replayBtn.style.display = "none";

    // Disable normal control buttons
    this.restartBtn.disabled = true;
    this.undoBtn.disabled = true;
    this.hintBtn.disabled = true;

    // Clear board and show step 0
    this.board.reset();
    this.replay.next();
    this.redrawReplayBoard();
  }

  /** Exit replay mode and restore normal game view */
  exitReplayMode() {
    if (!this.inReplayMode) return;
    this.inReplayMode = false;
    this.replay.stop();

    if (this.replayBar) this.replayBar.style.display = "none";

    // Re-enable normal controls
    this.restartBtn.disabled = false;
    this.hintBtn.disabled = false;
  }

  /** Wire up replay control bar buttons */
  setupReplayControls() {
    const bar = this.replayBar;
    if (!bar) return;

    this.replayStepDisplay = bar.querySelector(".replay-step");

    const bind = (sel, fn) => {
      const el = bar.querySelector(sel);
      if (el) el.addEventListener("click", fn);
    };

    bind(".replay-first", () => { this.replay.first(); this.redrawReplayBoard(); });
    bind(".replay-prev", () => { this.replay.prev(); this.redrawReplayBoard(); });
    bind(".replay-toggle", () => {
      this.replay.toggle();
      this.redrawReplayBoard();
    });
    bind(".replay-next", () => { this.replay.next(); this.redrawReplayBoard(); });
    bind(".replay-last", () => { this.replay.last(); this.redrawReplayBoard(); });
    bind(".replay-exit", () => {
      this.exitReplayMode();
      this.resetGame();
    });

    // Speed buttons
    const speedBtns = bar.querySelectorAll(".replay-speed");
    speedBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = parseFloat(btn.dataset.speed);
        this.replay.setSpeed(s);
        speedBtns.forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
  }

  /** Update the replay step counter and play/pause icon */
  updateReplayUI(step, total, playing) {
    if (this.replayStepDisplay) {
      this.replayStepDisplay.textContent = `${step + 1} / ${total}`;
    }
    const toggleBtn = this.replayBar?.querySelector(".replay-toggle");
    if (toggleBtn) {
      toggleBtn.innerHTML = playing
        ? '<i class="fas fa-pause"></i>'
        : '<i class="fas fa-play"></i>';
    }
  }

  /** Redraw the entire board showing replay state up to current move */
  redrawReplayBoard() {
    // Rebuild board state from replay
    const replayBoard = this.replay.buildBoard();
    // Swap in the replay board state temporarily for drawing
    const origBoard = this.board;
    this.board = replayBoard;
    this.drawBoard();

    // Draw move number on the last placed stone
    const lastMove = this.replay.getCurrentMoveData();
    if (lastMove) {
      this.drawMoveNumber(lastMove.row, lastMove.col, this.replay.currentMove + 1);
    }

    // Restore original board reference
    this.board = origBoard;
  }

  /** Draw a move number label on top of a stone */
  drawMoveNumber(row, col, num) {
    const cellSize = this.cellSize;
    const x = BOARD_PADDING + col * cellSize;
    const y = BOARD_PADDING + row * cellSize;
    const ctx = this.ctx;

    ctx.save();
    ctx.font = `bold ${Math.round(cellSize * 0.35)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Determine stone color to choose text color
    const moveIdx = this.replay.currentMove;
    const player = this.replay.moves[moveIdx]?.player;
    ctx.fillStyle = player === Player.BLACK ? "#ffffff" : "#000000";

    ctx.fillText(String(num), x, y + 1);
    ctx.restore();
  }

  // ==================== Online Mode Methods ====================

  /** Set up the online lobby UI (create/join room) */
  setupOnlineLobby() {
    const lobby = this.onlineLobby;
    if (!lobby) return;

    const createBtn = lobby.querySelector("#createRoomBtn");
    const joinBtn = lobby.querySelector("#joinRoomBtn");
    const codeInput = lobby.querySelector("#roomCodeInput");

    if (createBtn) {
      createBtn.addEventListener("click", () => {
        this.enterOnlineGameView();
        this.online.connect();
        // Wait for connection before creating room
        const waitForConnection = () => {
          if (this.online.connected) {
            this.online.createRoom();
            this.showOnlineStatus("正在创建房间...");
          } else {
            setTimeout(waitForConnection, 100);
          }
        };
        waitForConnection();
      });
    }

    if (joinBtn && codeInput) {
      joinBtn.addEventListener("click", () => {
        const code = codeInput.value.trim().toUpperCase();
        if (!code) {
          this.enterOnlineGameView();
          this.showOnlineStatus("请输入房间码");
          return;
        }
        this.enterOnlineGameView();
        this.online.connect();
        const waitForConnection = () => {
          if (this.online.connected) {
            this.online.joinRoom(code);
            this.showOnlineStatus("正在加入房间...");
          } else {
            setTimeout(waitForConnection, 100);
          }
        };
        waitForConnection();
      });
    }
  }

  /**
   * Transition from start screen to game view for online mode.
   * Hides the start screen and prepares the game board so status
   * messages from createRoom/joinRoom are visible to the user.
   */
  enterOnlineGameView() {
    if (this.startScreen) {
      this.startScreen.style.display = "none";
    }
    if (this.gameModeDisplay) {
      this.gameModeDisplay.textContent = "在线对战";
    }
    this.resetGame();
  }

  /** Set up all OnlineManager callbacks */
  setupOnlineCallbacks() {
    this.online.onRoomCreated = (code) => {
      this.onlineRoomCode = code;
      this.showOnlineStatus(`房间码: ${code}，等待对手加入...`);
    };

    this.online.onGameStart = (myColor) => {
      this.onlineMyColor = myColor;
      this.onlineOpponentReady = true;
      this.hideOnlineStatus();
      this.board.reset();
      this.drawBoard();
      this.updateUI();

      // Update mode display with color info
      if (this.gameModeDisplay) {
        const colorName = myColor === "black" ? "黑子" : "白子";
        this.gameModeDisplay.textContent = `在线对战 (${colorName})`;
      }
    };

    this.online.onOpponentMove = (move) => {
      // Only apply if it's valid on our local board
      if (this.board.makeMove(move.row, move.col)) {
        this.drawStone(move.row, move.col, move.player, true);
        this.updateUI();
      }
    };

    this.online.onGameEnd = ({ winner, reason }) => {
      let msg;
      if (reason === "surrender") {
        msg = winner === this.onlineMyColor ? "对手认输，你赢了!" : "你认输了!";
      } else if (reason === "disconnect") {
        msg = "对手断线，你赢了!";
      } else if (winner === this.onlineMyColor) {
        msg = "你赢了!";
      } else if (winner === null) {
        msg = "平局!";
      } else {
        msg = "你输了!";
      }

      // Update local board state so restart button enables
      if (winner === "black") {
        this.board.gameState = GameState.BLACK_WIN;
      } else if (winner === "white") {
        this.board.gameState = GameState.WHITE_WIN;
      } else {
        this.board.gameState = GameState.DRAW;
      }

      this.showOnlineStatus(msg);
      this.updateUI();
    };

    this.online.onOpponentDisconnect = () => {
      this.showOnlineStatus("对手已断线，等待重连...");
    };

    this.online.onOpponentReconnect = () => {
      this.hideOnlineStatus();
    };

    this.online.onGameRestart = () => {
      this.resetGame();
      this.hideOnlineStatus();
    };

    this.online.onError = (message) => {
      this.showOnlineStatus(`错误: ${message}`);
    };

    this.online.onConnectionChange = (connected) => {
      if (!connected && this.gameMode === "online") {
        this.showOnlineStatus("连接已断开");
      }
    };

    this.online.onGameState = (msg) => {
      // Sync my color from the OnlineManager (set by room:joined or room:created)
      this.onlineMyColor = this.online.myColor;

      // Map server state to client GameState
      let clientState;
      if (msg.state === "playing") {
        clientState = GameState.PLAYING;
        this.hideOnlineStatus();
        // Mark game as in-progress so clicks work
        this.online.inGame = true;
      } else if (msg.state === "finished") {
        if (msg.winner === "black") {
          clientState = GameState.BLACK_WIN;
        } else if (msg.winner === "white") {
          clientState = GameState.WHITE_WIN;
        } else {
          clientState = GameState.DRAW;
        }
        this.hideOnlineStatus();
      } else {
        // "waiting" — room created but opponent hasn't joined yet
        clientState = GameState.PLAYING;
        if (this.online.roomCode) {
          this.showOnlineStatus(`房间码: ${this.online.roomCode}，等待对手加入...`);
        }
      }

      // Update mode display with color info
      if (this.gameModeDisplay && this.onlineMyColor) {
        const colorName = this.onlineMyColor === "black" ? "黑子" : "白子";
        this.gameModeDisplay.textContent = `在线对战 (${colorName})`;
      }

      this.board.restoreState(msg.grid, msg.currentPlayer, clientState);
      this.drawBoard();
      this.updateUI();
    };
  }

  /** Show an overlay status message on the board */
  showOnlineStatus(message) {
    if (!this.onlineOverlay) {
      this.onlineOverlay = document.getElementById("onlineOverlay");
    }
    if (this.onlineOverlay) {
      this.onlineOverlay.textContent = message;
      this.onlineOverlay.classList.add("visible");
    } else {
      // Fallback: use game status
      this.gameStatusElement.textContent = message;
      this.gameStatusElement.style.color = "#FFA500";
    }
  }

  /** Hide the online status overlay */
  hideOnlineStatus() {
    if (this.onlineOverlay) {
      this.onlineOverlay.classList.remove("visible");
    }
    this.updateUI();
  }

  /** Show online lobby overlay on the game screen */
  showOnlineLobby() {
    this.showOnlineStatus("选择操作：创建房间或输入房间码加入");

    // Create lobby overlay content if not already created
    let lobbyOverlay = document.getElementById("onlineLobbyOverlay");
    if (!lobbyOverlay) {
      lobbyOverlay = document.createElement("div");
      lobbyOverlay.id = "onlineLobbyOverlay";
      lobbyOverlay.className = "online-lobby-overlay";
      lobbyOverlay.innerHTML = `
        <div class="lobby-overlay-card">
          <h3>在线对战</h3>
          <div class="lobby-overlay-actions">
            <button class="btn btn-primary" id="overlayCreateBtn">
              <i class="fas fa-plus"></i> 创建房间
            </button>
            <div class="join-room">
              <input type="text" id="overlayRoomCodeInput" placeholder="房间码" maxlength="4" />
              <button class="btn btn-secondary" id="overlayJoinBtn">
                <i class="fas fa-sign-in-alt"></i> 加入
              </button>
            </div>
          </div>
          <button class="btn btn-secondary lobby-back-btn" id="overlayBackBtn">
            <i class="fas fa-arrow-left"></i> 返回
          </button>
        </div>
      `;
      this.canvas.parentElement.appendChild(lobbyOverlay);
    }

    lobbyOverlay.style.display = "flex";
    this.hideOnlineStatus();

    // Wire up lobby overlay buttons
    const createBtn = document.getElementById("overlayCreateBtn");
    const joinBtn = document.getElementById("overlayJoinBtn");
    const codeInput = document.getElementById("overlayRoomCodeInput");
    const backBtn = document.getElementById("overlayBackBtn");

    // Remove old listeners by cloning
    const freshCreate = createBtn.cloneNode(true);
    createBtn.parentNode.replaceChild(freshCreate, createBtn);
    const freshJoin = joinBtn.cloneNode(true);
    joinBtn.parentNode.replaceChild(freshJoin, joinBtn);
    const freshBack = backBtn.cloneNode(true);
    backBtn.parentNode.replaceChild(freshBack, backBtn);

    freshCreate.addEventListener("click", () => {
      this.online.connect();
      lobbyOverlay.style.display = "none";
      const waitForConnection = () => {
        if (this.online.connected) {
          this.online.createRoom();
        } else {
          setTimeout(waitForConnection, 100);
        }
      };
      waitForConnection();
    });

    freshJoin.addEventListener("click", () => {
      const code = codeInput.value.trim().toUpperCase();
      if (!code) {
        this.showOnlineStatus("请输入房间码");
        return;
      }
      this.online.connect();
      lobbyOverlay.style.display = "none";
      const waitForConnection = () => {
        if (this.online.connected) {
          this.online.joinRoom(code);
        } else {
          setTimeout(waitForConnection, 100);
        }
      };
      waitForConnection();
    });

    freshBack.addEventListener("click", () => {
      lobbyOverlay.style.display = "none";
      this.gameMode = "pvp";
      this.online.disconnect();
      // Show start screen again
      if (this.startScreen) {
        this.startScreen.style.display = "flex";
        this.pvpBtn.classList.add("selected");
        this.aiBtn.classList.remove("selected");
        if (this.onlineBtn) this.onlineBtn.classList.remove("selected");
      }
    });
  }
}

// Initialize game when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  const game = new GomokuGame();
  debugLog("Gomoku game initialized!");

  // Make game accessible from console for debugging
  window.gomokuGame = game;
});
