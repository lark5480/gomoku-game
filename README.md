# 五子棋游戏

使用 HTML5 Canvas 和原生 JavaScript (ES6+) 实现的 15x15 五子棋游戏，支持双人对战。

## 快速开始

```bash
npm install
npm start
```

访问 http://localhost:8000/

无 Node.js 时可用：

```bash
python -m http.server 8000
```

## 功能

- 棋子放置动画与获胜高亮
- 悬停预览下一步棋位
- 智能提示（评分算法）
- 撤销上一步
- 响应式设计（桌面/移动端）

## 项目结构

```
├── index.html          # 主页面
├── css/style.css       # 样式
├── js/
│   ├── board.js        # 游戏逻辑（Board 类、胜利检测）
│   ├── game.js         # 渲染与交互（GomokuGame 类）
│   └── utils.js        # 工具函数与常量
├── tests/test.mjs      # 棋盘逻辑测试
└── server.js           # 本地开发服务器
```

## 开发

格式化代码：

```bash
npm run format
```

运行测试：

```bash
node tests/test.mjs
```

## 许可证

ISC 许可证（见 package.json）
