# Interfaces

本文档整理当前主线（`v0.1.2`）关键接口、调用关系、状态管理方式和后续演进方向。

## 1. Frontend -> Go Backend

### 主要接口

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/articles`
- `GET /api/articles?refresh=true`（smart refresh）
- `GET /api/articles/refresh`（force ingest）
- `POST /api/trading/analyze`
- `GET /api/trading/analysis/:task_id`
- `POST /api/trading/analysis/:task_id/cancel`
- `POST /api/trading/analysis/:task_id/resume`
- `GET /api/trading/analyses`
- `GET /api/trading/stats`
- `GET /api/trading/health`
- `GET /api/trading/chart/:ticker`

### 调用方 / 被调用方

- 调用方：React frontend
- 被调用方：Go backend

### 输入输出格式

- 输入：HTTP JSON
- 输出：HTTP JSON

核心分析请求格式（已确认）：

- `ticker`
- `date`
- `execution_mode`（`default` / `openclaw`）
- `llm_config`
- `data_vendor_config`（可选）

核心分析响应格式（已确认）：

- `task_id`
- `status`
- `execution_mode`
- `stages`（主展示契约）
- `analysis_report`（兼容保留）
- `decision`

### 状态管理方式

- token 存在浏览器 localStorage
- 分析结果靠前端轮询 Go 获取
- 前端优先消费 `stages`，回退到 `analysis_report`

### 当前问题

- 错误模型仍未完全统一
- Go/Python 动态 JSON 区域仍有 schema 漂移风险
- OpenClaw chat 仍是前端本地直连形态，不是统一产品 API 边界

### 后续演进方向

- 统一错误结构和状态语义
- 收紧分析响应 schema
- 保持 Go 单外部 API 边界

## 2. Go <-> Redis（任务协调）

### 主要键与结构

- `trading:analysis:queue`
- `trading:analysis:processing`
- `trading:analysis:runtime:{task_id}`

### 状态管理方式

- Go 创建任务并入队
- Python worker 消费并写 runtime/checkpoint
- Go 查询阶段对账 runtime 与 PostgreSQL 并回写终态
- cancel/resume 会清理 queue + processing 残留 payload

### 当前问题

- 对账修复主要由请求触发，后台 sweeper 尚未统一

## 3. Python Trading Service <-> Redis（执行运行时）

### 主要职责

- 阻塞消费队列
- 写运行态与阶段 checkpoint
- 写终态结果（含 `stages` 与 `analysis_report`）
- worker 健康与自恢复

### 当前问题

- 仍暴露 `/api/v1/analyze` 等任务接口，存在边界重叠历史包袱

## 4. Go -> Python / OpenClaw Gateway（健康探针）

### 主要接口

- Go -> Python: `GET /health`
- Go -> OpenClaw gateway: `GET /health`
- Go 对外健康聚合：`GET /api/trading/health`

### 当前问题

- OpenClaw runtime 在部分本地环境仍可能显示 `degraded`，部署契约需进一步收敛

## 5. Frontend -> OpenClaw Gateway（本地聊天 MVP）

当前是本地 MVP 路径，不是 Go 网关转发：

- 浏览器直连本地 OpenClaw gateway（ws/http）
- `agents.list`
- `sessions.list`
- `chat.history`
- `chat.send`

风险：该路径对本地环境依赖强，暂不适合作为远程 VM/生产标准形态。

## 6. TradingAgents -> Vendor Routing

### 主要工具接口

- `get_stock_data`
- `get_indicators`
- `get_fundamentals`
- `get_balance_sheet`
- `get_cashflow`
- `get_income_statement`
- `get_news`
- `get_global_news`
- `get_insider_sentiment`
- `get_insider_transactions`

### 当前问题

- vendor 级去重、缓存、限流治理仍需系统化

## 7. 协议选择说明

### 当前选择

- Go/Python 保持 REST + Redis 协调

### 原因

- 当前瓶颈在状态治理和契约稳定，不在 RPC 协议本身
- 任务系统已是异步队列模型，协议切换收益有限

### 触发 gRPC 评估条件

- 内部服务数量显著增加
- 对强 streaming / IDL 约束有刚性需求
- REST schema 漂移长期无法收敛
