# Interfaces

本文档整理当前系统的关键接口，包括调用关系、输入输出格式、状态管理方式、当前问题和后续演进方向。

## 1. Frontend -> Go Backend

### 主要接口

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/articles`
- `GET /api/articles/refresh`
- `POST /api/trading/analyze`
- `GET /api/trading/analysis/:task_id`
- `GET /api/trading/analyses`
- `GET /api/trading/stats`

### 调用方 / 被调用方

- 调用方：React frontend
- 被调用方：Go backend

### 输入输出格式

- 输入：HTTP JSON
- 输出：HTTP JSON

核心分析请求格式（已确认）：

- `ticker`
- `date`
- `llm_config`

### 状态管理方式

- token 存在浏览器 localStorage
- 分析结果靠前端轮询获取

### 当前问题

- 错误结构不统一
- 分析结果结构受内部 Go/Python 契约影响
- 认证 header 契约存在不一致风险

### 后续演进方向

- 统一错误模型
- 统一 token 使用方式
- 让前端看到显式的阶段状态和关键中间结果

## 2. Go Backend -> Python Trading Service

### 主要接口

- `POST /api/v1/analyze`
- `POST /api/v1/analyze/sync`
- `GET /api/v1/analysis/{task_id}`
- `GET /api/v1/config`
- `GET /health`

### 调用方 / 被调用方

- 调用方：Go backend
- 被调用方：Python Trading Service

### 输入输出格式

- 输入：HTTP JSON
- 输出：HTTP JSON

Python 当前支持的配置输入（已确认）：

- `llm_config`
- `data_vendor_config`

### 状态管理方式

- Go 提交任务给 Python
- Python 返回 `task_id`
- Go 在任务未结束时回查 Python 状态

### 当前问题

- Go/Python 双重拥有任务状态
- Go 使用弱类型 map 接收 Python 响应
- 运行态状态不可靠

### 后续演进方向

- Go 负责业务状态入口
- Python 负责执行
- Redis 负责运行态协调
- 保持 REST，先收紧 schema

## 3. TradingAgents -> Vendor Routing

### 主要接口

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

### 调用方 / 被调用方

- 调用方：TradingAgents analyst nodes
- 被调用方：vendor routing layer

### 输入输出格式

- 输入：Python 工具调用参数
- 输出：字符串化数据、报表、文本分析输入

### 状态管理方式

- 当前主要是即时调用，没有统一共享状态

### 当前问题

- 重复抓取
- fallback 有了，但缓存和限流不足
- 输出格式偏文本，后续可计算性不足

### 后续演进方向

- 数据抓取去重
- Redis 级共享缓存
- vendor 调用限流与熔断

## 4. Go Backend -> PostgreSQL / Redis

### PostgreSQL

- 调用方：Go backend
- 主要对象：`User`、`Article`、`TradingAnalysisTask`、`TradingDecision`
- 当前问题：运行态任务状态尚未纳入统一设计

### Redis

- 调用方：Go backend
- 当前对象：文章缓存、点赞数
- 当前问题：未承担任务主链路职责

### 后续演进方向

- PostgreSQL：继续作为持久业务真相源
- Redis：扩展为任务协调层、运行态缓存层和共享数据层

## 5. Nginx Reverse Proxy

### 主要入口

- `/api/` -> Go backend
- `/trading/` -> Python trading service
- `/` -> frontend

### 当前问题

- 当前路由本身合理，主要问题不在代理层，而在内部状态和契约设计

## 6. 协议选择说明

### 当前选择

- Go/Python 继续使用 REST

### 原因

- 当前任务系统以异步轮询为主
- 真正瓶颈是 LLM 与数据获取延迟，而不是协议开销
- 当前首先要解决的是状态和 schema，而不是换协议

### 后续触发条件

以下场景出现时，再考虑 gRPC：

- 内部服务显著增加
- 需要稳定 streaming
- schema 漂移长期难控
- 需要更严格的 IDL 驱动开发
