---
allowed-tools: Read, Bash, WebFetch
argument-hint: [文档文件路径]
default: README.md
description: 检查文档中的链接是否全部有效
model: claude-haiku-4-5-20251001
---

读取 $ARGUMENTS 文件，提取所有超链接（支持 Markdown [text](url) 格式和原始 URL），逐一请求并检查响应状态码。

处理规则：
- 跳过相对路径链接（仅检查 http/https 链接）
- 并发请求限制：每次最多 5 个，避免对目标服务器造成压力

输出格式：
- 有效链接（200）
- 重定向链接（3xx）及目标地址
- 失效链接（4xx/5xx）及建议替代链接

最后输出汇总：共 N 个链接，M 个失效。