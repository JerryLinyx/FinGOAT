---
title: Data Models
last_verified: 2026-03-19
verified_against: v0.2.0-dev
---

# Data Models

本文档整理当前主线（`v0.2.0` 进行中）核心数据、来源、生命周期和主要流转链路。

## 1. 核心业务数据

### User

- 来源：前端注册/登录
- 关键字段：`username`、`password_hash`、`email`、`email_verified`、`display_name`、`avatar_url`、`role`
- 存储：PostgreSQL
- 生命周期：长期
- 当前状态：已从最小用户名模型扩展到 email-first 兼容 profile 模型

### UserAPIKey

- 来源：Profile 页面 API key 配置
- 关键字段：`user_id/provider/encrypted_key/key_mask`
- 存储：PostgreSQL
- 生命周期：长期
- 用途：按用户注入 provider key，替代纯运维级统一密钥

### EmailToken

- 来源：注册验证、重发验证、邮箱变更
- 关键字段：`user_id/token_hash/purpose/expires_at/used_at`
- 存储：PostgreSQL
- 生命周期：短中期
- 用途：email verification 流程

### Article

- 来源：RSS ingest + 手工创建接口
- 关键字段：`title/content/preview/source/source_url/link/guid/published_at`
- 存储：PostgreSQL（主）+ Redis（列表缓存）
- 生命周期：长期（缓存短周期）

### FeedIngestRun

- 来源：每次 RSS ingest（manual / refresh）
- 关键字段：`trigger/status/started_at/finished_at/new_count/warning_count/error`
- 存储：PostgreSQL
- 生命周期：长期审计与决策数据
- 用途：支撑 DB-first smart refresh 策略

### TradingAnalysisTask

- 来源：前端提交分析后由 Go 创建
- 关键字段：
  - `task_id/user_id/ticker/analysis_date/status`
  - `execution_mode`
  - `llm_provider/llm_model/llm_base_url`
  - `config/error/completed_at/processing_time_seconds`
- 存储：PostgreSQL（持久业务真相）
- 生命周期：创建 -> 运行 -> 终态

### TradingDecision

- 来源：任务终态回写
- 关键字段：
  - `action/confidence/position_size`
  - `analysis_report`
  - `raw_decision`
- 存储：PostgreSQL
- 生命周期：长期

### LLMUsageEvent / AnalysisRunMetrics

- 来源：analysis 运行阶段的 usage collector
- 关键字段：
  - `provider/model/node_name/prompt_tokens/completion_tokens/total_tokens`
  - `estimated_cost_usd/latency_ms/success/error_message`
  - 任务级汇总字段如 `total_tokens/total_cost/total_llm_calls`
- 存储：PostgreSQL
- 生命周期：长期
- 用途：用户 usage 页面、admin dashboard、成本分析

## 2. 运行时数据

### 任务运行态（runtime state）

- 来源：Go 初始化 + Python worker 持续更新
- 关键字段：
  - `status/cancel_requested`
  - `execution_mode`
  - `stages`
  - `analysis_report`
  - `decision/error/completed_at/processing_time_seconds`
- 存储：Redis（`trading:analysis:runtime:{task_id}`）
- 生命周期：执行期 + TTL

### 任务队列态

- Redis 列表：
  - `trading:analysis:queue`
  - `trading:analysis:processing`
- 用途：异步消费、失败恢复、cancel/resume 清理

### Agent 中间状态

- 来源：TradingAgents 图执行过程
- 关键形态：
  - canonical `stages`（主消费）
  - `analysis_report`（兼容保留，含 `__stages`/`__stage_times`/`__key_outputs`）
- 存储：
  - 执行期在 Redis runtime
  - 终态部分持久化入 PostgreSQL 决策记录

### Chart / Quote / Terminal 本地视图状态

- 来源：前端图表与 terminal 页面操作
- 关键形态：
  - recent queries（本地历史）
  - selected market / period / indicator state
- 存储：浏览器 localStorage / 组件本地状态
- 生命周期：本地会话级或持久本地
- 当前限制：尚无跨端同步

## 3. 外部数据

### Vendor 数据

- 来源：`yfinance/alpha_vantage/google/openai/local` 等
- 用途：行情、指标、基本面、新闻、insider 数据
- 生命周期：执行期临时使用，部分进入报告
- 当前问题：统一去重/缓存/限流尚未完成

### OpenClaw 运行数据（可选执行路径）

- 来源：`execution_mode=openclaw` 分析请求与 gateway stage-run
- 关键字段：stage backend、agent id、session key、raw output
- 生命周期：任务运行期
- 当前问题：部署依赖和健康契约仍在收敛

### Market data response objects

- 来源：Go backend market-data controllers + Python marketdata service
- 关键形态：
  - `chart`
  - `quote`
  - `terminal`
- 生命周期：短周期缓存 + 请求时拉取
- 当前问题：provider fallback 与缓存治理还在持续打磨

## 4. 数据处理链路

### 分析任务链路

1. Frontend -> Go：提交任务（含 `execution_mode`）。
2. Go：落库任务 + 写 Redis runtime 初始态 + 入队。
3. Python worker：消费队列，执行 TradingAgents，持续写 checkpoint。
4. Go：查询时对账 runtime 与 DB，终态回写决策。
5. Frontend：轮询读取 `stages/analysis_report/decision`。

### 文章链路（DB-first）

1. 正常读取：直接 DB 读取，返回文章列表（可缓存）。
2. `refresh=true`：先看最近成功 ingest，若过旧再触发 ingest。
3. `/api/articles/refresh`：强制 ingest。
4. ingest 全过程写 `FeedIngestRun` 审计记录。

## 5. 当前数据问题与瓶颈

- `analysis_report` 仍是半结构化兼容层，需要继续收紧。
- Go/Python 跨服务 schema 仍有动态区域。
- vendor 数据缺少统一 runtime 缓存与去重策略。
- feed 仍缺后台定时 ingest（目前以 smart refresh + manual 为主）。
- 用户域仍处于兼容迁移期，身份与配置相关模型需要继续治理。

## 6. 未来需要统一或重构的数据结构

- `stages` 的稳定 schema 与版本策略
- `analysis_report` 的兼容退场路径
- Go/Python 契约强类型化
- vendor 缓存 key + TTL + 去重策略
- feed 定时任务与 ingest run 生命周期策略
- 用户 API key 审计字段与更多 provider 元数据
