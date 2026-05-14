# AI 智能改进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 AI 棋型评估函数的致命 bug（开端口检测、连续性检查），将 AI 从"数子机器"升级为"棋型评估器"，并提升搜索效率。

**Architecture:** 核心修改集中在 `js/ai.js`。修复分三层：先把评估函数修正确（Task 1-3），再优化搜索效率（Task 4-7），最后加测试（Task 8-9）。评估修复会影响所有三个难度等级；搜索优化主要影响中、困难模式。

**Tech Stack:** ES6+ JavaScript, Canvas（不涉及 UI 改动）, Node.js 测试

---

## 文件职责说明

| 文件 | 改动范围 | 职责 |
|------|----------|------|
| `js/ai.js` | ~80% 改动 | `evaluateLineScore` 重写、`evaluateBoard` 双面化、`SCORES` 调整、走法排序、makeMove/undo 替代 clone、直接取胜检测 |
| `js/board.js` | 轻量 | 添加 `setCellDirect` 方法 |
| `tests/ai.test.mjs` | 新建 | AI 棋型评估和搜索行为测试 |

---

### Task 1: 修复棋型开端口检测 — 重写 `evaluateLineScore`，删除 `countOpenEnds`

**Files:**
- Modify: `js/ai.js:237-260`

**背景：** `countOpenEnds` 检查9格窗口的绝对端点 `line[0]` 和 `line[8]`，而非连续棋型的紧邻两侧。对于窗口中心位置的棋型，两端几乎永远是空的，导致 `openEnds` 几乎总是 0。同时旧代码统计窗口内所有同色棋子（不要求连续），两颗隔了4个空位的棋子会被认为是一个棋型。

- [ ] **Step 1: 用连续段检测重写 `evaluateLineScore`**

将 `js/ai.js` 中的 `evaluateLineScore` 方法替换为：

```javascript
evaluateLineScore(line, player) {
    const opponent = player === "black" ? "white" : "black";

    // Mixed line: both player and opponent stones present
    if (line.some((c) => c === opponent)) return 0;

    // Center cell (index 4) must be the player's stone
    const center = 4;
    if (line[center] !== player) return 0;

    // Expand outward from center to find contiguous segment
    let start = center;
    let end = center;
    while (start > 0 && line[start - 1] === player) start--;
    while (end < 8 && line[end + 1] === player) end++;

    const count = end - start + 1;

    // Open ends: empty cells immediately adjacent to the segment
    let openEnds = 0;
    if (start > 0 && line[start - 1] === null) openEnds++;
    if (end < 8 && line[end + 1] === null) openEnds++;

    return this.getPatternScore(count, openEnds, true);
}
```

- [ ] **Step 2: 删除 `countOpenEnds` 方法**

删除 `js/ai.js` 中第 255-260 行的 `countOpenEnds` 方法：

```javascript
  countOpenEnds(line, player) {
    let ends = 0;
    if (line[0] === player) ends++;
    if (line[line.length - 1] === player) ends++;
    return ends;
  }
```

- [ ] **Step 3: 运行现有测试确认无回归**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev && node tests/test.mjs
```

预期：全部10个测试通过。

- [ ] **Step 4: 提交**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev
git add js/ai.js
git commit -m "fix: rewrite evaluateLineScore with contiguous segment detection, remove broken countOpenEnds"
```

---

### Task 2: 评估函数改为双面评估 — 重写 `evaluateBoard`

**Files:**
- Modify: `js/ai.js:182-195`

**背景：** 当前 `evaluateBoard` 只评估 `currentPlayer` 的棋型。对手的冲四在叶子节点（深度 0）不可见，只能靠搜索树发现。在深度 3 的限制下，很多威胁看不到。

- [ ] **Step 1: 将 `evaluateBoard` 改为同时评估双方棋型**

将 `js/ai.js` 中的 `evaluateBoard` 方法替换为：

```javascript
evaluateBoard(board) {
    const currentPlayer = board.getCurrentPlayer();
    const opponent = currentPlayer === "black" ? "white" : "black";
    let score = 0;

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const cell = board.getCell(row, col);
            if (cell === currentPlayer) {
                score += this.evaluatePatternsAt(row, col, currentPlayer, board);
            } else if (cell === opponent) {
                score -= this.evaluatePatternsAt(row, col, opponent, board);
            }
        }
    }
    return score;
}
```

- [ ] **Step 2: 更新调用点，去掉 `player` 参数**

`alphaBeta`（`js/ai.js:138`）中调用 `evaluateBoard(board)` 不带第二个参数，签名已兼容。

确认 `alphaBeta` 中的调用：
```javascript
return this.evaluateBoard(board);
```
无需修改（新签名 `evaluateBoard(board)` 不需要 player 参数）。

- [ ] **Step 3: 运行测试确认无回归**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev && node tests/test.mjs
```

预期：全部10个测试通过。

- [ ] **Step 4: 提交**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev
git add js/ai.js
git commit -m "feat: dual-side board evaluation scores both player and opponent patterns"
```

---

### Task 3: 调整评分权重 — 修改 `SCORES` 常量

**Files:**
- Modify: `js/ai.js:10-19`

**背景：** 当前 `LIVE_THREE = 5000 > RUSH_FOUR = 1000`。配合双面评估后，对手冲四贡献 -1000、己方活三贡献 +5000，AI 会优先构建活三而不是封堵对手冲四。权重需要满足：堵冲四 > 建活三。

注意：因为 `evaluateBoard` 对每颗棋子分别评估，一个冲四（4颗子）贡献 4× 分，一个活三（3颗子）贡献 3× 分。权重设计时已考虑此因素。

- [ ] **Step 1: 替换 `SCORES` 常量**

将 `js/ai.js` 中的 `SCORES` 对象替换为：

```javascript
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
```

- [ ] **Step 2: 验证分值关系**

确认满足以下约束：
- `RUSH_FOUR (50000) > LIVE_THREE (5000)` — 堵冲四优先于建活三
- `FIVE (10000000) > 任何组合` — 连五必胜
- `LIVE_FOUR (500000) > RUSH_FOUR × 4 (200000)` — 活四（必胜）优于多个冲四

- [ ] **Step 3: 运行测试确认无回归**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev && node tests/test.mjs
```

预期：全部10个测试通过。

- [ ] **Step 4: 提交**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev
git add js/ai.js
git commit -m "fix: adjust pattern scores so rush-four blocking outranks live-three building"
```

---

### Task 4: 添加 `setCellDirect` 方法到 Board

**Files:**
- Modify: `js/board.js`

**背景：** 走法排序需要临时落子评估棋型，但又不能触发 `makeMove` 的全部逻辑（胜利检测、玩家切换、历史记录）。`setCellDirect` 提供轻量级单元格直接赋值，配合后续的 `setCellDirect(row, col, null)` 清除。

- [ ] **Step 1: 在 Board 类中添加 `setCellDirect` 方法**

在 `js/board.js` 的 `getValidMoves` 方法之后（约第 287 行之后）添加：

```javascript
  /**
   * Directly set a cell value without game logic (win check, player switch, history).
   * Used for heuristic scoring during move ordering.
   * @param {number} row
   * @param {number} col
   * @param {string|null} value - 'black', 'white', or null
   */
  setCellDirect(row, col, value) {
    if (isValidPosition(row, col)) {
      this.grid[row][col] = value;
    }
  }
```

- [ ] **Step 2: 运行测试确认无回归**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev && node tests/test.mjs
```

预期：全部10个测试通过。

- [ ] **Step 3: 提交**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev
git add js/board.js
git commit -m "feat: add setCellDirect for lightweight cell manipulation in move ordering"
```

---

### Task 5: 根节点走法排序 — 修改 `getMoveMedium` 和 `getMoveHard`

**Files:**
- Modify: `js/ai.js:80-96`（`getMoveMedium`）
- Modify: `js/ai.js:101-131`（`getMoveHard`）

**背景：** Alpha-beta 剪枝在无序走法下效率很低。在根节点按启发式评分排序走法，让最有希望的走法先被搜索，最大化剪枝效率。只在根节点排序（不在递归 `alphaBeta` 内排序），避免内部节点排序的额外开销。

启发式评分同时评估攻击（落己方子后的棋型）和防守（落对方子后的棋型，即"如果对手占了这个位置会怎样"）。

- [ ] **Step 1: 在 `AIPlayer` 类中添加 `scoreMove` 辅助方法**

在 `js/ai.js` 的 `evaluatePosition` 方法之后添加：

```javascript
  /**
   * Heuristic move score for ordering: attack + defense value of a position.
   */
  scoreMove(row, col, player, board) {
    const opponent = player === "black" ? "white" : "black";

    // Attack: what patterns does this position create for the player?
    board.setCellDirect(row, col, player);
    let score = this.evaluatePatternsAt(row, col, player, board);

    // Defense: what patterns would the opponent create if they took this spot?
    board.setCellDirect(row, col, opponent);
    score += this.evaluatePatternsAt(row, col, opponent, board);

    // Clean up
    board.setCellDirect(row, col, null);
    return score;
  }
```

- [ ] **Step 2: 在 `getMoveMedium` 中添加走法排序**

将 `js/ai.js` 中的 `getMoveMedium` 方法替换为：

```javascript
  getMoveMedium(validMoves) {
    const currentPlayer = this.board.getCurrentPlayer();

    // Move ordering: score each candidate position heuristically
    for (const move of validMoves) {
      move.heuristicScore = this.scoreMove(
        move.row, move.col, currentPlayer, this.board
      );
    }
    validMoves.sort((a, b) => b.heuristicScore - a.heuristicScore);

    let bestScore = -Infinity;
    let bestMove = validMoves[0];

    for (const move of validMoves) {
      const boardClone = this.board.clone();
      boardClone.makeMove(move.row, move.col);

      const score = -this.alphaBeta(boardClone, 1, -Infinity, Infinity);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }
```

- [ ] **Step 3: 在 `getMoveHard` 中添加走法排序**

将 `js/ai.js` 中的 `getMoveHard` 方法替换为：

```javascript
  getMoveHard(validMoves) {
    const currentPlayer = this.board.getCurrentPlayer();

    // Move ordering: score each candidate position heuristically
    for (const move of validMoves) {
      move.heuristicScore = this.scoreMove(
        move.row, move.col, currentPlayer, this.board
      );
    }
    validMoves.sort((a, b) => b.heuristicScore - a.heuristicScore);

    let bestScore = -Infinity;
    let bestMove = validMoves[0];

    for (const move of validMoves) {
      const boardClone = this.board.clone();
      boardClone.makeMove(move.row, move.col);

      const key = this.getBoardKey(boardClone);
      if (this.transpositionTable.has(key)) {
        const cached = this.transpositionTable.get(key);
        if (cached.depth >= 3) {
          if (cached.score > bestScore) {
            bestScore = cached.score;
            bestMove = move;
          }
          continue;
        }
      }

      const score = -this.alphaBeta(boardClone, 3, -Infinity, Infinity);
      this.transpositionTable.set(key, { score, depth: 3 });

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }
```

- [ ] **Step 4: 运行测试确认无回归**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev && node tests/test.mjs
```

预期：全部10个测试通过。

- [ ] **Step 5: 提交**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev
git add js/ai.js
git commit -m "feat: add root-level move ordering by heuristic score for better alpha-beta pruning"
```

---

### Task 6: 用 makeMove/undo 替代 clone — 修改 `alphaBeta`

**Files:**
- Modify: `js/ai.js:136-169`（`alphaBeta`）
- Modify: `js/ai.js:80-96`（`getMoveMedium`）
- Modify: `js/ai.js:101-131`（`getMoveHard`）

**背景：** 当前每个搜索节点都 `board.clone()` 深拷贝 15×15 数组，大量内存分配和 GC 压力。`Board` 已有 `makeMove`/`undo` 方法，原地操作可消除克隆开销。

注意：置换表的 key 是棋盘状态的字符串快照（`getState().flat().join("")`），与棋盘是否原地修改无关——key 在 `getBoardKey` 中即时生成，不依赖棋盘引用。

- [ ] **Step 1: 修改 `alphaBeta` 使用 makeMove/undo**

将 `js/ai.js` 中的 `alphaBeta` 方法替换为：

```javascript
  alphaBeta(board, depth, alpha, beta) {
    if (depth === 0) {
      return this.evaluateBoard(board);
    }

    const validMoves = board.getValidMoves();
    if (validMoves.length === 0 || board.getGameState() !== "playing") {
      return this.evaluateBoard(board);
    }

    const key = this.getBoardKey(board);
    if (this.transpositionTable.has(key)) {
      const cached = this.transpositionTable.get(key);
      if (cached.depth >= depth) {
        return cached.score;
      }
    }

    for (const move of validMoves) {
      board.makeMove(move.row, move.col);

      const score = -this.alphaBeta(board, depth - 1, -beta, -alpha);

      board.undo();

      if (score > alpha) {
        alpha = score;
      }
      if (alpha >= beta) {
        break;
      }
    }

    this.transpositionTable.set(key, { score: alpha, depth: depth });
    return alpha;
  }
```

- [ ] **Step 2: 修改 `getMoveMedium` 使用 makeMove/undo**

替换 `getMoveMedium` 中的搜索循环部分。将 Task 5 Step 2 中的 `getMoveMedium` 替换为：

```javascript
  getMoveMedium(validMoves) {
    const currentPlayer = this.board.getCurrentPlayer();

    for (const move of validMoves) {
      move.heuristicScore = this.scoreMove(
        move.row, move.col, currentPlayer, this.board
      );
    }
    validMoves.sort((a, b) => b.heuristicScore - a.heuristicScore);

    let bestScore = -Infinity;
    let bestMove = validMoves[0];

    for (const move of validMoves) {
      this.board.makeMove(move.row, move.col);

      const score = -this.alphaBeta(this.board, 1, -Infinity, Infinity);

      this.board.undo();

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }
```

- [ ] **Step 3: 修改 `getMoveHard` 使用 makeMove/undo**

替换 `getMoveHard` 中的搜索循环部分。将 Task 5 Step 3 中的 `getMoveHard` 替换为：

```javascript
  getMoveHard(validMoves) {
    const currentPlayer = this.board.getCurrentPlayer();

    for (const move of validMoves) {
      move.heuristicScore = this.scoreMove(
        move.row, move.col, currentPlayer, this.board
      );
    }
    validMoves.sort((a, b) => b.heuristicScore - a.heuristicScore);

    let bestScore = -Infinity;
    let bestMove = validMoves[0];
    this.transpositionTable.clear();

    for (const move of validMoves) {
      this.board.makeMove(move.row, move.col);

      const key = this.getBoardKey(this.board);
      let score;

      if (this.transpositionTable.has(key)) {
        const cached = this.transpositionTable.get(key);
        if (cached.depth >= 3) {
          score = cached.score;
        } else {
          score = -this.alphaBeta(this.board, 3, -Infinity, Infinity);
          this.transpositionTable.set(key, { score, depth: 3 });
        }
      } else {
        score = -this.alphaBeta(this.board, 3, -Infinity, Infinity);
        this.transpositionTable.set(key, { score, depth: 3 });
      }

      this.board.undo();

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }
```

- [ ] **Step 4: 运行测试确认无回归**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev && node tests/test.mjs
```

预期：全部10个测试通过。若有失败，说明 makeMove/undo 状态管理有问题，回退检查。

- [ ] **Step 5: 提交**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev
git add js/ai.js
git commit -m "perf: replace board.clone() with makeMove/undo in alpha-beta search"
```

---

### Task 7: 添加直接取胜和必堵检测 — 修改 `getMove`

**Files:**
- Modify: `js/ai.js:40-60`（`getMove`）
- Add helper method: `js/ai.js`

**背景：** AI 可能因搜索深度不够而漏看一步杀棋（自己连五）或对手的一步杀棋。O(N) 代价的预检查可消除这种最低级失误。

- [ ] **Step 1: 添加 `findImmediateWin` 和 `findMustBlock` 辅助方法**

在 `js/ai.js` 的 `AIPlayer` 类中添加（可以放在 `evaluatePosition` 方法之后）：

```javascript
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

      // Check if any direction forms a five
      // Since evaluatePatternsAt returns total score from 4 directions,
      // a FIVE (10000000) in any direction means immediate win
      if (patterns >= SCORES.FIVE) return move;
    }
    return null;
  }

  /**
   * Check if opponent has an immediate winning threat that must be blocked.
   * @returns {Object|null} Blocking move {row, col} or null
   */
  findMustBlock(validMoves) {
    const opponent = this.board.getCurrentPlayer() === "black" ? "white" : "black";
    for (const move of validMoves) {
      this.board.setCellDirect(move.row, move.col, opponent);
      const patterns = this.evaluatePatternsAt(move.row, move.col, opponent, this.board);
      this.board.setCellDirect(move.row, move.col, null);

      // If opponent would get a five here, we must block
      if (patterns >= SCORES.FIVE) return move;
    }
    return null;
  }
```

- [ ] **Step 2: 在 `getMove` 开头添加预检查**

在 `js/ai.js` 的 `getMove` 方法中，在 `switch` 语句之前（约第 50 行之前）插入：

```javascript
    // Pre-check: immediate win
    const winMove = this.findImmediateWin(validMoves);
    if (winMove) return winMove;

    // Pre-check: must block opponent's immediate win
    const blockMove = this.findMustBlock(validMoves);
    if (blockMove) return blockMove;
```

完整的 `getMove` 方法：

```javascript
  getMove() {
    const validMoves = this.board.getValidMoves();

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

    switch (this.difficulty) {
      case "easy":
        return this.getMoveEasy(validMoves);
      case "hard":
        return this.getMoveHard(validMoves);
      case "medium":
      default:
        return this.getMoveMedium(validMoves);
    }
  }
```

- [ ] **Step 3: 运行测试确认无回归**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev && node tests/test.mjs
```

预期：全部10个测试通过。

- [ ] **Step 4: 提交**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev
git add js/ai.js
git commit -m "feat: add immediate win and must-block detection before search"
```

---

### Task 8: 编写 AI 棋型评估单元测试

**Files:**
- Create: `tests/ai.test.mjs`

**背景：** 核心评估逻辑需要自动化测试覆盖：棋型得分正确性、连续性检查、双面评估、封堵优先级。

- [ ] **Step 1: 创建测试文件**

创建 `tests/ai.test.mjs`：

```javascript
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
    [7, 7], [0, 0], [7, 8], [0, 1], [7, 9], [0, 2],
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
    [7, 0], [0, 0], [7, 1], [0, 1], [7, 2], [0, 2], [7, 3], [0, 3],
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
  board.makeMove(0, 0); // 1 black
  board.makeMove(7, 7); // 2 white
  board.makeMove(0, 1); // 3 black
  board.makeMove(7, 8); // 4 white
  board.makeMove(0, 2); // 5 black
  board.makeMove(7, 9); // 6 white
  board.makeMove(0, 3); // 7 black
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
```

- [ ] **Step 2: 运行 AI 测试**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev && node tests/ai.test.mjs
```

预期：全部6个 AI 测试通过。若有失败，根据错误信息修复对应逻辑后重新运行。

- [ ] **Step 3: 确认全部测试通过**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev && node tests/test.mjs && node tests/ai.test.mjs
```

预期：10个基础测试 + 6个 AI 测试全部通过。

- [ ] **Step 4: 提交**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev
git add tests/ai.test.mjs
git commit -m "test: add AI pattern evaluation and search behavior tests"
```

---

### Task 9 (可选): 迭代加深搜索 — 重写 `getMoveHard`

**Files:**
- Modify: `js/ai.js:101-131`（`getMoveHard`）

**背景：** 困难模式固定深度 3，无法利用多余时间。迭代加深从深度 1 开始逐层加深，设 2 秒时间上限，超时时返回当前已完成深度的最佳走法。可达到深度 4-5。

此任务为可选增强，可在核心修复验证通过后再实施。

- [ ] **Step 1: 将 `getMoveHard` 改为迭代加深**

替换 `js/ai.js` 中的 `getMoveHard` 方法：

```javascript
  getMoveHard(validMoves) {
    const currentPlayer = this.board.getCurrentPlayer();
    const TIME_LIMIT = 2000; // 2 seconds max
    const startTime = Date.now();

    // Move ordering
    for (const move of validMoves) {
      move.heuristicScore = this.scoreMove(
        move.row, move.col, currentPlayer, this.board
      );
    }
    validMoves.sort((a, b) => b.heuristicScore - a.heuristicScore);

    let bestMove = validMoves[0];
    let maxDepth = 0;

    // Iterative deepening: depth 1, 2, 3, ...
    for (let depth = 1; depth <= 10; depth++) {
      this.transpositionTable.clear();

      let currentBestScore = -Infinity;
      let currentBestMove = validMoves[0];

      for (const move of validMoves) {
        // Check time
        if (Date.now() - startTime > TIME_LIMIT) break;

        this.board.makeMove(move.row, move.col);

        const key = this.getBoardKey(this.board);
        let score;

        if (this.transpositionTable.has(key)) {
          const cached = this.transpositionTable.get(key);
          if (cached.depth >= depth) {
            score = cached.score;
          } else {
            score = -this.alphaBeta(this.board, depth, -Infinity, Infinity);
            this.transpositionTable.set(key, { score, depth });
          }
        } else {
          score = -this.alphaBeta(this.board, depth, -Infinity, Infinity);
          this.transpositionTable.set(key, { score, depth });
        }

        this.board.undo();

        if (score > currentBestScore) {
          currentBestScore = score;
          currentBestMove = move;
        }
      }

      // If we ran out of time, return the previous depth's result
      if (Date.now() - startTime > TIME_LIMIT) break;

      // Otherwise, keep this depth's result and try deeper
      bestMove = currentBestMove;
      maxDepth = depth;
    }

    return bestMove;
  }
```

- [ ] **Step 2: 运行全部测试**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev && node tests/test.mjs && node tests/ai.test.mjs
```

预期：全部测试通过。

- [ ] **Step 3: 提交**

```bash
cd F:/other/code/ai/claudeCodeDemo1/.worktrees/dev
git add js/ai.js
git commit -m "feat: iterative deepening search with 2s time limit for hard mode"
```

---

## 实施顺序

```
Task 1 (evaluateLineScore) ──→ Task 2 (evaluateBoard) ──→ Task 3 (SCORES)
         │                                                      │
         └──────────── Task 4 (setCellDirect) ──────────────────┘
                              │
                    Task 5 (move ordering)
                              │
                    Task 6 (makeMove/undo)
                              │
                    Task 7 (win/block detect)
                              │
                    Task 8 (AI tests)
                              │
                    Task 9 (iterative deepening, optional)
```

- Task 1-3 是核心修复，高度依赖，必须顺序执行
- Task 4-6 是搜索优化，依赖 Task 1 的修复但彼此可调整顺序
- Task 7 独立，可并行于任何 Task
- Task 8 应在 Task 1-7 之后执行，验证全部修复
- Task 9 是可选增强，放最后

## 验证方法

1. `node tests/test.mjs` — 基础棋盘测试全部通过（每个 Task 后运行）
2. `node tests/ai.test.mjs` — AI 专项测试全部通过（Task 8 后）
3. 浏览器中对战困难 AI — 验证 AI 不再犯低级错误（漏堵冲四、漏看活三、不连续棋子误判）
4. 观察 AI 思考时间 — 确保不超过 2-3 秒
