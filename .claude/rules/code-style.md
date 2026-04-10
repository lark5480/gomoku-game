# JavaScript 代码风格规则

- **ES6+ 特性**: 使用现代 JavaScript 语法（const/let、箭头函数、模板字符串等）
- **模块化**: 使用 ES6 模块导入/导出（import/export）
- **函数长度**: 函数不超过 40 行，超出则应拆分为更小的函数
- **变量声明**: 优先使用 const，只有在需要重新赋值时才使用 let
- **命名约定**:
  - 类名使用 PascalCase（如 `GameBoard`）
  - 函数和变量名使用 camelCase（如 `getCurrentPlayer`）
  - 常量使用 UPPER_SNAKE_CASE（如 `BOARD_SIZE`）
- **导入顺序**: 第三方库 → 本地模块
- **注释规范**:
  - 公共 API（export 的函数/类）需要 JSDoc 注释
  - 复杂逻辑需要行内注释说明
- **错误处理**: 使用 try-catch 处理可能失败的异步操作
- **格式工具**: 使用 Prettier 进行代码格式化（配置在 `.prettierrc.json`）