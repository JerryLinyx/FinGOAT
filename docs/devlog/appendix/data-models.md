# Data Models

本文档整理当前系统中的核心数据、格式、来源、生命周期和处理链路。

## 1. 核心业务数据

### User

- 来源：前端注册/登录请求
- 主要格式：
  - `username`
  - `password`（哈希后存储）
- 生命周期：长期持久化
- 当前存储：PostgreSQL

### Article

- 来源：
  - RSS/Atom 抓取
  - 手工创建文章接口
- 主要格式：
  - `title`
  - `content`
  - `preview`
  - `source`
  - `source_url`
  - `link`
  - `guid`
  - `published_at`
- 生命周期：长期持久化，可被缓存
- 当前存储：PostgreSQL + Redis 缓存

### TradingAnalysisTask

- 来源：前端提交分析请求后由 Go 创建
- 主要格式：
  - `task_id`
  - `user_id`
  - `ticker`
  - `analysis_date`
  - `status`
  - `llm_provider`
  - `llm_model`
  - `llm_base_url`
  - `error`
  - `completed_at`
  - `processing_time_seconds`
- 生命周期：
  - 创建于任务提交
  - 更新于执行过程和结束后
- 当前存储：PostgreSQL
- 当前问题：运行态和最终态未分层建模

### TradingDecision

- 来源：Python 服务完成分析后，由 Go 持久化
- 主要格式：
  - `action`
  - `confidence`
  - `position_size`
  - `analysis_report`
  - `raw_decision`
- 生命周期：长期持久化
- 当前存储：PostgreSQL

## 2. 运行时数据

### 任务运行态

- 来源：Python Trading Service
- 主要格式：
  - `pending`
  - `processing`
  - `completed`
  - `failed`
  - 以及结果、错误、耗时等附属字段
- 生命周期：任务执行期
- 当前存储：Python 进程内内存
- 当前问题：不持久、不共享、不可恢复

### Agent 中间状态

- 来源：TradingAgents 图执行过程
- 主要格式：
  - `market_report`
  - `sentiment_report`
  - `news_report`
  - `fundamentals_report`
  - `investment_plan`
  - `risk_debate_state`
  - `final_trade_decision`
  - 以及其他 `raw_state/messages`
- 生命周期：执行期间产生，部分汇总后持久化
- 当前存储：
  - 执行时主要在 Python 内存中
  - 最终部分字段进入 `analysis_report`
- 当前问题：结构标准化不足

### Redis 缓存数据

- 来源：
  - 文章列表缓存
  - 点赞计数
- 生命周期：短期缓存 / 短期计数
- 当前问题：尚未扩展到任务协调层

## 3. 外部数据

### Vendor 数据

- 来源：
  - `yfinance`
  - `alpha_vantage`
  - `google`
  - `openai`
  - `local`
- 主要格式：
  - OHLCV
  - technical indicators
  - fundamentals
  - news / insider data
- 生命周期：当前以运行时临时获取为主
- 当前问题：
  - 缺少统一缓存
  - 缺少共享抓取
  - 缺少统一限流策略

### RSS 数据

- 来源：外部 RSS/Atom feed
- 处理链路：
  - fetch
  - parse
  - sanitize
  - deduplicate
  - persist
  - cache
- 当前问题：与核心交易能力在同一 Go 服务中，边界略混杂

## 4. 数据处理链路

### 分析任务链路

- 前端提交请求
- Go 创建任务
- Go 调 Python
- Python 调 TradingAgents
- TradingAgents 调 vendor tools
- Python 汇总结果
- Go 持久化任务和决策
- 前端轮询读取

### 文章链路

- Go 抓取 RSS
- 解析 XML/Atom
- 清洗文本与截断 preview
- 按 `link/guid` 去重
- 写入 PostgreSQL
- 写入 Redis 缓存

## 5. 当前数据问题与瓶颈

- 任务运行态没有统一生命周期模型
- `analysis_report` 结构松散
- 最终态和运行态未分层
- Redis 与 PostgreSQL 的边界尚未明确
- vendor 数据抓取缺少共享缓存与锁

## 6. 未来需要统一或重构的数据结构

- 分析任务状态机
- Go/Python 分析结果 schema
- `analysis_report` 顶层字段定义
- 运行态缓存结构
- vendor 数据缓存 key 和失效策略

## 7. 结论

- PostgreSQL 继续作为持久业务数据存储是必要的。
- Redis 应扩展为任务协调和运行态缓存层。
- 运行态数据和持久态数据必须在 v0.2 分层建模。
