---
title: System Architecture
last_verified: 2026-03-19
verified_against: v0.2.0-dev
---

# System Architecture

本文档描述当前主线架构（`v0.2.0` 进行中，基线归档为 `v0.1.4`）以及后续收敛方向。

## 1. 当前架构总览

当前系统采用“前端 + Go 业务网关 + Python 运行时 worker + TradingAgents 引擎 + PostgreSQL/Redis”的组合架构。

### 分层视图

- 表现层：`frontend`
- 编排层：`backend`
- 能力层：`services/trading-service`、`services/market-data-service`、`services/python-common` 和 `TradingAgents`
- 数据层：`PostgreSQL` 和 `Redis`
- 外部依赖层：LLM、金融数据源、RSS
- 本地扩展层：OpenClaw gateway、Ollama、本地浏览器状态

## 2. 当前协作方式

### 用户分析请求链路

1. 用户在前端提交股票代码和日期。
2. 前端调用 Go 的 `/api/trading/*` 接口。
3. Go 校验用户身份、落库任务、写入 Redis runtime 初始状态并入队。
4. Python worker 从 Redis 队列消费任务并执行 TradingAgents 图流程。
5. Python 在执行过程中持续写回 runtime checkpoint（含阶段输出）。
6. Go 在查询阶段对账 Redis runtime 与 PostgreSQL，终态写回决策与结果。
7. 前端轮询 Go 并展示进度/阶段输出/最终结果。

### 用户配置链路

1. 用户在前端 Profile 页面维护基础资料和 provider key。
2. Go backend 负责鉴权、邮箱验证流程、API key 加密存储。
3. Trading 请求进入 Go 后端时，按用户配置注入 provider key / 覆盖默认配置。
4. Python worker 与 TradingAgents 使用解析后的 provider 配置执行。

### 市场数据链路

1. 前端调用 Go 的 chart / quote / terminal 接口。
2. Go 负责鉴权、市场模式解析、响应归一化。
3. Python marketdata service 或 backend controller 拉取外部行情/公告/终端侧栏数据。
4. 前端在 Chart / Terminal 页面展示结果并保留本地查询历史。

### 文章链路

1. Go 从 RSS/Atom feed 获取数据。
2. 解析并清洗内容。
3. 去重后写入 PostgreSQL。
4. 写入 Redis 缓存。
5. 前端读取展示。

## 3. 当前边界划分

### Frontend

- 负责展示和用户交互。
- 不拥有业务真相。

### Go Backend

- 当前外部业务 API 主边界。
- 持有业务持久化与状态语义。

### Python Trading Service

- 当前职责是运行时执行服务（queue consumer / worker）。
- 不应继续扩展为并行外部业务 API 入口。

### TradingAgents

- 专注分析编排、推理流程和工具调用。
- 不吸收产品 API 与持久化职责。

## 4. 当前合理之处

- Go/Python 分层已经从“HTTP 同步调用”收敛到“队列驱动执行”。
- Redis 已承担任务队列和运行态协调，而非仅缓存。
- TradingAgents 独立为能力引擎层，便于迭代模型和策略逻辑。
- 前端已可消费阶段元数据，具备基础可解释性。
- 用户配置与 provider key 已进入产品主路径，不再完全依赖环境变量。
- usage 事件链路已形成“执行采集 -> Redis 暂存 -> PostgreSQL 汇总”的基本闭环。

## 5. 当前不合理之处

### 对外 API 边界仍有历史重叠

- Go 是主入口，但 Python 仍保留分析任务公共接口，存在双入口遗留。

### 跨服务契约仍偏弱

- 部分响应结构仍是动态 JSON 区域，演进风险较高。

### 配置层不统一

- Go/Python/Docker 多来源配置叠加，优先级治理不足。

### 用户域仍在兼容迁移期

- email-first 已落地，但 legacy username 仍保留兼容路径。
- 手机号 / 微信等多通道身份尚未进入统一设计。

## 6. v0.2.0 目标架构方向

### 目标边界

- Frontend：展示和交互。
- Go backend：唯一外部业务 API 入口 + 业务状态出口。
- Redis：运行态协调层（queue/runtime/checkpoint）。
- PostgreSQL：持久业务真相源。
- Python Trading Service：内部执行器 / worker。
- TradingAgents：分析引擎。
- OpenClaw gateway：可选本地/远程 analyst runtime 辅助层，不与 Go 争夺外部产品边界。

### 目标收益

- 单一外部边界，减少跨服务语义漂移。
- 任务状态治理更稳，恢复与排障更直接。
- 前后端契约可收紧并支撑后续质量增强。
- 吸收 RAG/结构化输出/valuation 能力时风险更可控。

## 7. 版本判断

`v0.1.2` 提供了工程化 MVP 基础骨架。当前主线已经进入 `v0.2.0` 进行中阶段，重点应继续放在边界收敛、契约收紧、配置治理、后台调度和回归闭环，而不是继续扩散接口层职责。
