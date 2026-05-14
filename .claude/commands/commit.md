---
allowed-tools: Read, Grep, Bash(git add:*), Bash(git status:*), Bash(git diff:*), Bash(git commit:*)
argument-hint: [commit-message]
description: 检查代码质量后提交
---

## 暂存区内容
!`git diff --cached`

提交前检查以下问题，发现问题则报告并询问是否继续：
1. 遗留的 `console.log` / `print` 调试语句
2. 未处理的 `TODO` / `FIXME` 注释
3. 大段被注释掉的代码
4. 测试文件中的 `.only` / `.skip` 标记
5. 敏感信息（API Key、Token、密码等）泄露
6. 调试用的 `debugger` 语句

若无问题，使用以下信息提交：$ARGUMENTS
