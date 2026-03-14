# System Architecture

本文档描述当前主线架构（基线 `v0.1.2`）以及 `v0.2.0` 的收敛方向。

## 1. 当前架构总览

当前系统采用“前端 + Go 业务网关 + Python 运行时 worker + TradingAgents 引擎 + PostgreSQL/Redis”的组合架构。

### 分层视图

- 表现层：`frontend`
- 编排层：`backend`
- 能力层：`langchain-v1` 和 `TradingAgents`
- 数据层：`PostgreSQL` 和 `Redis`
- 外部依赖层：LLM、金融数据源、RSS

## 2. 当前协作方式

### 用户分析请求链路

1. 用户在前端提交股票代码和日期。
2. 前端调用 Go 的 `/api/trading/*` 接口。
3. Go 校验用户身份、落库任务、写入 Redis runtime 初始状态并入队。
4. Python worker 从 Redis 队列消费任务并执行 TradingAgents 图流程。
5. Python 在执行过程中持续写回 runtime checkpoint（含阶段输出）。
6. Go 在查询阶段对账 Redis runtime 与 PostgreSQL，终态写回决策与结果。
7. 前端轮询 Go 并展示进度/阶段输出/最终结果。

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

## 5. 当前不合理之处

### 对外 API 边界仍有历史重叠

- Go 是主入口，但 Python 仍保留分析任务公共接口，存在双入口遗留。

### 跨服务契约仍偏弱

- 部分响应结构仍是动态 JSON 区域，演进风险较高。

### 配置层不统一

- Go/Python/Docker 多来源配置叠加，优先级治理不足。

## 6. v0.2.0 目标架构方向

### 目标边界

- Frontend：展示和交互。
- Go backend：唯一外部业务 API 入口 + 业务状态出口。
- Redis：运行态协调层（queue/runtime/checkpoint）。
- PostgreSQL：持久业务真相源。
- Python Trading Service：内部执行器 / worker。
- TradingAgents：分析引擎。

### 目标收益

- 单一外部边界，减少跨服务语义漂移。
- 任务状态治理更稳，恢复与排障更直接。
- 前后端契约可收紧并支撑后续质量增强。
- 吸收 RAG/结构化输出/valuation 能力时风险更可控。

## 7. 版本判断

`v0.1.2` 已具备工程化 MVP 基础骨架。`v0.2.0` 的重点应放在边界收敛、契约收紧、配置治理、后台调度和回归闭环，而不是继续扩散接口层职责。
