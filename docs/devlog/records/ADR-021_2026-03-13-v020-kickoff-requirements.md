---
id: ADR-021
kind: requirement
title: v0.2.0 Kickoff Requirements
date: 2026-03-13
status: active
supersedes: null
superseded_by: null
implements: [ADR-013, ADR-018, ADR-026]
verified_by: []
---

# v0.2.0 Kickoff Requirements

## Status Note

本文件是 v0.2.0 启动时的边界治理需求稿。

当前状态请同时参照：

- `current/overview.md`
- `ADR-013`
- `ADR-033`

## 1. 背景

在当前主线代码中，交易任务已采用 `Go + Redis + Python Worker` 运行模型：  
Go 写入任务与入队，Python 消费队列执行 TradingAgents，Go 对账并对外提供查询。

同时，Python `trading_service` 仍保留 `POST /api/v1/analyze`、`GET /api/v1/analysis/{task_id}` 等外部可调用接口，形成与 Go 网关的职责重叠。

## 2. 问题和影响

- 外部入口重叠，容易出现绕过 Go 鉴权和业务约束的调用路径。
- 团队成员在开发/联调时可能混用 `:3000` 与 `:8001` 接口，增加定位成本。
- 未来契约治理（schema、错误码、版本）难以收敛到单一边界。

## 3. 已确认事实（来自当前代码）

- 前端主调用路径是 Go 的 `/api/trading/*`。
- Go 提供任务生命周期接口：analyze / query / cancel / resume / stats / analyses。
- Go 目前仅通过 `/health` 访问 Python 服务。
- Python 仍暴露完整任务 API，但主业务路径已不依赖它们。

## 4. v0.2.0 需求清单（本次写入）

### P0

1. Go 作为唯一外部交易 API 边界（Single External API Boundary）。
2. Python trading service 收敛为内部执行服务（worker/runtime），不再作为产品对外任务 API。
3. 对 Python 任务 API 做生产路径限制（禁用/内网化/网关层封禁，择一落地）。

### P1

1. 清理前端未使用的 `/trading -> :8001` 本地代理，防止误用旧路径。
2. 增加边界回归检查，避免重新引入 direct frontend->python 或 go->python analyze 调用。

## 5. 方案对比

### 方案 A：保持双 API 并存

- 优点：改动最少。
- 缺点：边界持续模糊，长期治理成本高。

### 方案 B：Go 单外部边界 + Python 内部 worker（推荐）

- 优点：职责清晰、鉴权和契约治理集中、演进路径稳定。
- 缺点：需要处理历史脚本和调试方式迁移。

## 6. 决策

采用方案 B，作为 v0.2.0 第一阶段基础设施治理要求。

## 7. 预期产出

- 对外仅保留 Go 交易接口集合。
- Python 对外暴露收敛到健康和必要运维接口。
- 文档、backlog、里程碑统一按该边界推进。

## 8. 当前状态

- 状态：历史 kickoff 需求稿；Go 已成为主外部交易入口，但 Python 公共任务接口仍未完全退场
- 关联 backlog：`current/task-backlog.md` 中保留对应后续条目
