---
allowed-tools: Read, Bash, WebFetch
argument-hint: [文档文件路径]
default: README.md
description: 检查文档中的链接是否全部有效
---

读取 $ARGUMENTS 文件，提取所有超链接（Markdown `[text](url)` 与裸 URL），逐类检查。

处理规则：

- **http/https**：请求并检查状态码；并发最多 5 个
- **相对路径**（含 `../`）：按所在文件目录解析，校验目标文件存在；路径存在且带 `#锚点` 时，校验目标 `.md` 中有对应标题（GFM slug：小写、去标点、空格转 `-`）或显式 `<a id="...">`
- 跳过纯锚点 `#xxx` 与 `mailto:`

输出格式：

- 有效外链（200）
- 重定向（3xx）及目标
- 失效外链（4xx/5xx）及建议替代
- 失效相对链接 / 锚点（注明源文件与行号）

最后输出汇总：外链 N 个（M 失效），相对链接 K 个（L 失效）。
