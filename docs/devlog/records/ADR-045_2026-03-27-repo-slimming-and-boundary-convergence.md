---
id: ADR-045
kind: decision
title: 2026-03-27 Repo Slimming And Boundary Convergence
date: 2026-03-27
status: active
supersedes: null
superseded_by: null
implements:
  - ADR-021
  - ADR-026
  - ADR-044
verified_by: []
---

# 2026-03-27 Repo Slimming And Boundary Convergence

## Background

在 `ADR-021`、`ADR-026` 和 `ADR-044` 之后，主线已经基本形成：

- Go 是唯一应当对外暴露的业务 API
- Python `trading-service` 已进入 Redis-backed runtime 模式
- `market-data-service` 已独立承担 `chart / quote / terminal`
- 前端已经以 `stages[] + SSE` 为核心展示分析过程

但仓库里仍保留了多组历史路径：

- `articles` 系统与 `feed` 系统并存
- `langchain-v1/` 历史实验目录仍在主仓
- TradingAgents CLI 仍保留安装入口和文档形态
- `trading-service` 仍挂着 deprecated 分析端点和重复 market-data 端点
- Go / Python 契约虽然已收紧，但缺少一个轻量、可执行的防漂移机制

## Problem and impact

- 仓库继续保留重复职责，会误导后续开发沿着旧边界继续扩展。
- Python 侧如果同时保留 public analysis API 和 market-data API，Go 单外部边界就只是“约定”，不是“仓库真实状态”。
- CLI 保留会让“真实用户入口”再次分裂，前端状态展示和导出能力难以成为唯一产品面。
- `langchain-v1/` 继续留在主仓会制造“还有第二套 agent 主线”的错觉。
- 共享契约如果只靠口头对齐，字段仍会继续漂移。

## Options considered

### Option A: 保留旧代码，但通过文档标注 deprecated

不采用。

原因：

- 这类代码已经不是兼容层，而是重复系统
- 继续保留会让后续贡献者错误复用旧路径
- 维护成本和认知成本都持续存在

### Option B: 一次性删除旧系统，并把缺失能力补到 Web/API 主线

采用。

原因：

- 能让仓库结构与架构边界重新一致
- 删除量大，但替代路径已经存在或可低成本补齐
- 对长期维护成本和新成员理解成本的收益最高

### Option C: 同时引入 JSON Schema / proto 代码生成，彻底自动化契约

本轮不采用。

原因：

- 当前主要问题是边界和事实源混乱，不是生成器缺失
- 先落地轻量文档事实源 + 校验脚本，成本更低、迁移风险更小

## Final decision

### 1. 删除 `articles` 系统，仅保留 `feed`

移除：

- `/api/articles*` 路由
- `article_controller.go`
- `like_controller.go`
- `Article / RSSFeed / FeedIngestRun` 旧模型
- 对应 migration 注册与旧测试

不保留历史文章数据迁移，也不保留兼容读取。

### 2. 删除 `langchain-v1/`

处理方式：

- 不再保留可执行脚本或样例输出
- 其有价值的思想只通过当前 `TradingAgents` 主线和 devlog 文档保留

结论：

- `TradingAgents` 成为唯一 agent engine 代码主线

### 3. 固定服务边界

边界定义：

- `frontend`: 只调 Go
- `backend`: 唯一产品 API，负责任务创建、查询、取消、恢复、导出、健康聚合
- `trading-service`: 只做执行运行时、结果查询、SSE 流和健康检查
- `market-data-service`: 唯一 `chart / quote / terminal` 服务

因此删除：

- `trading-service` 的 deprecated 分析端点
- `trading-service` 的重复 market-data 端点

### 4. 删除 CLI，但先完成 Web/API 能力平移

新增并暴露：

- `selected_analysts`
- `max_debate_rounds`
- `max_risk_discuss_rounds`
- `export.json`
- `export.md`

明确：

- CLI 的 agent 状态追踪能力已由前端 `SSE + stages[] + AnalystLiveGrid + AgentDashboard` 覆盖

随后删除：

- TradingAgents CLI 目录
- console entry
- CLI 文档与截图资产

### 5. 引入轻量契约事实源与校验

新增：

- `docs/devlog/appendix/api-contracts.md`
- `scripts/check_api_contracts.py`

策略：

- Python runtime 类型仍是实现源
- 文档列出共享字段、默认值、约束和 stage constants
- 校验脚本检查 Go struct 字段是否覆盖文档中的共享字段

这轮目标是“防漂移”，不是代码生成。

## Follow-up

- 继续减少 `analysis_report` 兼容层里的动态区域
- 为 Python runtime 准备稳定的本地测试环境，恢复 mock pipeline 自动回归
- 继续把 OpenClaw 从 `7/9` 推到 `9/9`
- 在导出和任务详情之间进一步统一“稳定报告 schema”
