# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 提供在此代码库中工作的指导。

## 项目概述

使用 HTML5 Canvas + 原生 JavaScript (ES6+) 实现的五子棋游戏。15x15 棋盘，双人轮流落子，先连成五子者胜。纯前端实现，无外部依赖。

## 开发命令

- `npm start` - 启动本地开发服务器（端口 8000）
- `npm run format` - Prettier 格式化（配置在 `.prettierrc.json`）
- `node tests/test.mjs` - 运行 Board 类测试套件

## 架构

### 文件结构

- `index.html` - 主 HTML 文件
- `css/style.css` - 响应式样式
- `js/utils.js` - 工具函数（坐标转换、常量）
- `js/board.js` - 游戏逻辑（Board 类、胜利检测、移动验证、撤销）
- `js/game.js` - Canvas 渲染和用户交互（GomokuGame 类）
- `server.js` - 静态 HTTP 服务器
- `tests/test.mjs` - 棋盘逻辑测试

### 关键设计

- 游戏逻辑 (board.js) 与渲染 (game.js) 分离
- ES6 模块，`import`/`export`
- Canvas 渲染，无 DOM 操作
- 响应式：移动端 400px / 桌面端 600px
- 提示系统使用评分算法，非完整搜索树
- `IS_DEV` 标志控制调试日志

## 配置

- Prettier 配置：`.prettierrc.json`、`.prettierignore`
- 代码风格规则：`.claude/rules/`（包含 JS 代码风格、测试规范）
- 自定义命令：`.claude/commands/`（review、fix-issue 等）

## 开发指南

- 游戏逻辑修改在 `board.js`，UI/渲染在 `game.js`，常量/工具在 `utils.js`
- 测试重点：胜利检测（8 个方向）、坐标转换边界情况、响应式断点（768px、480px）
- 性能：Canvas 减少重绘，动画用 `requestAnimationFrame`
