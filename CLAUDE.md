# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 提供在此代码库中工作的指导。

## 项目概述

这是一个使用 HTML5 Canvas 和原生 JavaScript (ES6+) 实现的五子棋游戏。游戏采用 15×15 棋盘，两名玩家轮流落子，目标是在水平、垂直或对角线方向上连成五子。项目为纯前端实现，包含简单的 Node.js HTTP 服务器用于本地开发。

## 开发命令

### 本地开发

- `npm start` - 启动本地开发服务器（端口 8000）
- 游戏地址：`http://localhost:8000/`

### 代码质量

- `npm run format` - 使用 Prettier 格式化所有代码（配置在 `.prettierrc.json`）
- 无需构建步骤 - 使用原生 ES6 模块

### 测试

- `node tests/test.mjs` - 运行游戏逻辑测试套件（Board 类测试）
- package.json 中未配置自动化测试套件
- 手动测试涵盖游戏流程、胜利条件、边界情况和 UI 响应性
- 测试文件 `tests/test.mjs` 验证核心游戏逻辑，包括胜利检测、移动验证和撤销功能

## 架构设计

### 文件结构

- `index.html` - 主 HTML 文件，包含游戏 UI 和 Font Awesome 图标
- `css/style.css` - 所有游戏样式，支持移动端/桌面端响应式设计
- `js/utils.js` - 工具函数（坐标转换、验证、常量）
- `js/board.js` - 游戏逻辑和状态管理（Board 类、胜利检测、移动验证）
- `js/game.js` - 主游戏控制器（Canvas 渲染、用户交互、动画）
- `tests/test.mjs` - 棋盘逻辑测试套件
- `server.js` - 用于本地测试的简单静态 HTTP 服务器

### 核心模块

**Board 类 (`board.js`)**

- 使用 15×15 网格管理游戏状态
- 验证移动并检测胜利（水平、垂直、对角线）
- 跟踪移动历史并支持撤销功能
- 导出 `GameState` 和 `Player` 常量

**游戏控制器 (`game.js`)**

- `GomokuGame` 类处理 Canvas 渲染和用户交互
- 响应式棋盘尺寸（移动端 400px / 桌面端 600px）
- 棋子放置动画和胜利高亮显示
- 提示系统（使用评分算法）
- 开发模式开关（`IS_DEV` 标志控制调试日志）

**工具函数 (`utils.js`)**

- 屏幕坐标与棋盘坐标之间的转换
- 棋盘常量（`BOARD_SIZE = 15`、`CELL_SIZE` 等）
- 验证、克隆和玩家管理的辅助函数

### 关键设计模式

- **关注点分离**：游戏逻辑 (board.js) 与渲染逻辑 (game.js) 分离
- **ES6 模块**：所有 JavaScript 文件使用 `import`/`export`
- **Canvas 渲染**：游戏棋盘使用 Canvas API 绘制，无 DOM 操作
- **响应式设计**：Canvas 根据设备宽度调整大小，CSS 中包含媒体查询

### 游戏流程

1. 棋盘初始化创建 15×15 网格
2. 玩家轮流落子（黑棋先行）
3. 点击检测将屏幕坐标转换为棋盘位置
4. 棋盘验证移动并更新状态
5. Canvas 渲染棋子并播放动画
6. 每次移动后从最后落子位置进行胜利检测

## 配置说明

### 代码风格

- Prettier 配置在 `.prettierrc.json`
- 忽略模式在 `.prettierignore`
- `.claude/rules/` 包含代码风格指南，涵盖 JavaScript 代码风格、测试规范和 API 约定

### Claude Code 命令

- `.claude/commands/` 包含 Claude Code 的自定义命令：
  - `review.md` - 代码审查清单
  - `fix-issue.md` - GitHub issue 修复流程
  - `deploy.md` - （空）部署说明

### 服务器配置

- 静态文件服务器运行在端口 8000
- 包含防止目录遍历的安全措施
- 正确处理 MIME 类型

## 浏览器兼容性

- 需要 ES6 模块支持（Chrome 61+、Firefox 60+、Safari 10.1+、Edge 16+）
- 不支持 Internet Explorer
- 移动端响应式设计，支持触摸操作

## 开发注意事项

### 添加功能

- 游戏逻辑修改应在 `board.js` 中进行
- UI/渲染更改属于 `game.js`
- 常量和工具函数放在 `utils.js`
- 开发时启用 `game.js` 中的 `IS_DEV = true` 进行调试日志记录

### 测试考虑

- 测试所有方向的胜利条件（从最后落子位置的 8 个向量）
- 验证坐标转换处理边界情况
- 确保响应式设计在各断点（768px、480px）正常工作
- 检查撤销功能在胜利状态下的表现

### 性能优化

- Canvas 渲染优化，减少重绘
- 提示系统使用评分算法而非完整游戏树搜索
- 动画使用 `requestAnimationFrame` 实现平滑更新

## 项目特点

- 纯前端实现，无外部依赖
- 支持撤销/重做操作
- 智能提示系统
- 胜利棋子高亮显示
- 平滑的棋子放置动画
- 中文化游戏界面和提示
