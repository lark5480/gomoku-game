<!-- .claude/commands/pr-review.md -->
---
allowed-tools: Read, Grep, Glob, Bash, Agent
description: 全面的 PR 代码审查
---

## 获取 PR 信息
!`gh pr view --json title,body,state,author,headRefName 2>/dev/null || echo "Not a PR context"`

## 变更文件
!`git diff --name-only HEAD~5..HEAD 2>/dev/null || git diff --name-only HEAD~1`

## 详细差异
!`git diff HEAD~5..HEAD 2>/dev/null || git diff HEAD~1`

## 近期提交
!`git log --oneline -10`

## 审查维度

按以下结构输出审查结果：

### 🔴 Critical（必须修复）
- 安全漏洞
- 导致功能完全不可用的 bug
- 数据丢失风险

### 🟠 Major（强烈建议修复）
- 代码逻辑错误
- 性能问题（N+1 查询等）
- 边界情况未处理
- 缺少必要的错误处理

### 🟡 Minor（建议优化）
- 代码可读性问题
- 重复代码可提取
- 缺少注释
- 测试覆盖率不足
- 文档不完整

### ✅ 亮点
- 值得借鉴的实现
- 优雅的解决方案

### 总体建议
- 总结评审意见
- 优先级排序的修复建议