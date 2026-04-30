# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 提供在此代码库中工作的指导。

## 项目概述

使用 HTML5 Canvas + 原生 JavaScript (ES6+) 实现的五子棋游戏。15x15 棋盘，支持双人对战和 AI 对战（三种难度）。

## 开发命令

- `npm start` - 启动本地开发服务器（端口 8000）
- `npm run format` - Prettier 格式化（配置在 `.prettierrc.json`）
- `npm test` - 运行测试套件

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
└── tests/test.mjs      # 棋盘逻辑测试
```

### 关键设计

- 游戏逻辑 (board.js) 与渲染 (game.js) 分离
- AI 算法独立 (ai.js)，通过接口与 game.js 交互
- ES6 模块，`import`/`export`
- Canvas 渲染，无 DOM 操作
- 响应式：移动端 / 桌面端自适应
- 提示系统使用评分算法，非完整搜索树
- `IS_DEV` 标志控制调试日志

## AI 难度

| 难度 | 算法 | 搜索深度 |
|------|------|----------|
| 简单 | 随机 + 基础评分 | - |
| 中等 | Alpha-Beta 剪枝 | 1 |
| 困难 | Alpha-Beta + 置换表 | 2 |

## 配置

- Prettier 配置：`.prettierrc.json`、`.prettierignore`
- 代码风格规则：`.claude/rules/`（包含 JS 代码风格、测试规范）
- 自定义命令：`.claude/commands/`（commit、review、check-links）

## 开发指南

- 游戏逻辑修改在 `board.js`，UI/渲染在 `game.js`，AI 在 `ai.js`，常量/工具在 `utils.js`
- 测试重点：胜利检测（8 个方向）、坐标转换边界情况
- 性能：Canvas 减少重绘，动画用 `requestAnimationFrame`
