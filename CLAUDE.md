# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 提供在此代码库中工作的指导。

## 项目概述

使用 HTML5 Canvas + 原生 JavaScript (ES6+) 实现的五子棋游戏。15x15 棋盘，支持双人对战和 AI 对战（三种难度）。

## 开发命令

- `npm start` - 启动本地开发服务器（端口 8000）
- `npm run format` - Prettier 格式化（配置在 `.prettierrc.json`）
- `npm test` - 运行全部测试（Board + AI，共 16 项）
- `node tests/test.mjs` - 仅运行 Board 测试（10 项）
- `node tests/ai.test.mjs` - 仅运行 AI 测试（6 项）

## 架构

### 文件结构

```
├── index.html          # 主 HTML 文件
├── css/style.css       # 响应式样式
├── js/
│   ├── utils.js        # 工具函数（坐标转换、常量）
│   ├── board.js        # 游戏逻辑（Board 类、胜利检测、移动验证、撤销）
│   ├── game.js         # Canvas 渲染和用户交互（GomokuGame 类）
│   └── ai.js           # AI 对战（AIPlayer 类、三种难度）
├── server/             # 静态 HTTP 服务器
│   └── index.js
├── tests/
│   ├── test.mjs         # 棋盘逻辑测试（10 项）
│   └── ai.test.mjs      # AI 棋型评估测试（6 项）
```

### 关键设计

- AI 双面评估：己方加分、对手减分，叶子节点即可见威胁
- Alpha-Beta 搜索使用 makeMove/undo 原地操作，无 clone 开销
- 根节点走法按启发式评分排序（攻击+防御），提升剪枝效率
- 搜索前先检查直接取胜和必堵走法（O(N) 预检）
- `IS_DEV` 标志控制调试日志

## AI 难度

| 难度 | 算法 | 搜索深度 | 说明 |
|------|------|----------|------|
| 简单 | 随机 + 位置评分 | - | 从 top5 候选中随机 |
| 中等 | Alpha-Beta 剪枝 | 1 | 无置换表 |
| 困难 | Alpha-Beta + 置换表 + 走法排序 | 3 | makeMove/undo 原地搜索 |

## 配置

- Prettier 配置：`.prettierrc.json`、`.prettierignore`
- 代码风格规则：`.claude/rules/`（包含 JS 代码风格、测试规范）
- 自定义命令：`.claude/commands/`（commit、review、check-links）

## 开发指南

- Board 关键方法：`makeMove`/`undo`（支持原地搜索）、`setCellDirect`（走法排序用）、`getValidMoves`（返回邻接空位，**非全部空位**）
- AI 评分采用 per-stone 机制（每颗棋子独立评估四个方向），评分权重见 `SCORES` 常量
- 测试覆盖：AI 棋型评估（活三/冲四/不连续/双面/杀棋）见 `tests/ai.test.mjs`
