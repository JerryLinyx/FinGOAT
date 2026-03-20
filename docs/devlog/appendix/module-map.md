---
title: Module Map
last_verified: 2026-03-19
verified_against: v0.2.0-dev
---

# Module Map

本文档描述当前主线（`v0.2.0` 进行中）核心模块、职责、输入输出、依赖和薄弱点。

## 1. Frontend

- 位置：`frontend/`
- 模块职责：
  - 认证与会话管理
  - Dashboard / Feed / Chart / Terminal / OpenClaw / Profile / Usage 页面
  - 分析任务提交、轮询、cancel/resume
  - 阶段化分析结果展示（优先 `stages`）
  - 用户 BYOK、自助配置、本地 Ollama 模型发现
- 关键输入：
  - 用户表单与操作
  - Go API 返回的任务/文章/图表数据
- 关键输出：
  - 对 Go API 的请求
  - OpenClaw 本地聊天 MVP 的直连请求（仅本地）
- 关键依赖：
  - Go backend API
  - 浏览器 localStorage
  - 本地 OpenClaw gateway（可选）
- 当前状态：已形成可用产品壳层
- 已知风险：
  - `App.tsx` 状态仍偏重
  - OpenClaw chat 与 trading workflow 绑定尚未收敛
  - 页面域已扩展，后续需要继续拆分状态和样式边界

## 2. Go Backend

- 位置：`backend/`
- 模块职责：
  - JWT 鉴权与业务 API 统一入口
  - 用户 profile / email verification / API key 配置
  - usage 聚合与 admin 视图
  - 交易任务创建、查询、cancel/resume、统计
  - Redis 任务协调与 runtime 对账
  - 文章/RSS DB-first 读取 + smart refresh 管理
  - chart / quote / terminal 市场数据接口
  - 交易与 OpenClaw 健康聚合
- 关键输入：
  - 前端 HTTP 请求
  - Redis runtime/queue 数据
  - PostgreSQL 持久数据
- 关键输出：
  - 面向前端的 JSON API
  - 任务与决策持久化更新
- 关键依赖：
  - PostgreSQL
  - Redis
  - Python trading service（health）
  - OpenClaw gateway（health）
- 当前状态：主业务编排层已成型
- 已知风险：
  - 契约仍有动态 JSON 区域
  - 运行态修复以请求触发为主
  - 用户域仍在 email-first 与 legacy username 兼容迁移期

## 3. Python Trading Service

- 位置：`services/trading-service/`
- 模块职责：
  - Redis worker 消费分析任务
  - 运行 TradingAgents 并持续写 checkpoint
  - 生成 `stages` + `analysis_report` + `decision`
  - 采集并持久化 usage / token metrics
  - worker 存活管理与健康输出
- 关键输入：
  - `task_id/user_id/ticker/date/execution_mode`
  - `llm_config/data_vendor_config`
- 关键输出：
  - Redis runtime state
  - 阶段结果 `stages`
  - `analysis_report`（含 `__stages` 兼容数据）
- 当前状态：运行时执行器已稳定
- 已知风险：
  - 仍保留公共任务 API（边界重叠）
  - OpenClaw 依赖在部分环境下可降级
  - Python 环境与 provider 组合路径仍需持续回归

## 3b. Python Shared Runtime

- 位置：`services/python-common/`
- 模块职责：
  - `marketdata` 共享包
  - `usage_collector` 与消息安全序列化
  - shared Python dependencies manifest
- 当前状态：已从旧 `langchain-v1` 目录中拆出

## 4. TradingAgents Engine

- 位置：`TradingAgents/`
- 模块职责：
  - LangGraph 异步图编排
  - analyst 并发 fan-out + downstream debate/risk workflow
  - vendor 工具路由与阶段输出生成
  - `execution_mode=openclaw` 下的 analyst 适配调用
  - Qwen / DashScope / OpenAI / Ollama 等 provider 适配
- 关键依赖：
  - LangGraph
  - LLM provider routing
  - vendor data tools
  - OpenClaw adapter（按 execution_mode）
- 当前状态：核心分析引擎可用
- 已知风险：
  - 结构化输出标准仍需收紧
  - vendor 级缓存与去重未系统化

## 5. OpenClaw Gateway

- 位置：`openclaw-gateway/`
- 模块职责：
  - per-user analyst registry/bootstrap
  - stage-run 接口
  - 健康检查
- 当前状态：已接入，支持本地 MVP 路径
- 已知风险：
  - 运行依赖与部署契约尚未完全收敛
  - 与前端聊天页的连接仍是 local-first 方案

## 6. Persistence Layer

- 位置：`backend/models/` + `backend/config/`
- 模块职责：
  - 持久化用户、email token、用户 API key、usage、文章、任务、决策、feed ingest run
- 关键对象：
  - `User`
  - `UserAPIKey`
  - `EmailToken`
  - `Article`
  - `RSSFeed`
  - `TradingAnalysisTask`
  - `TradingDecision`
  - `LLMUsageEvent`
  - `AnalysisRunMetrics`
  - `FeedIngestRun`
- 当前状态：持久化主干已可用
- 已知风险：
  - 跨服务 schema 管理仍需进一步硬化

## 7. Redis Layer

- 主要职责：
  - 任务队列与 processing 队列
  - 任务 runtime 状态
  - usage 事件暂存
  - 文章缓存与点赞计数
- 当前状态：已进入核心任务链路
- 已知风险：
  - vendor 级运行时缓存尚未建立

## 8. Infra And Entry

- 位置：`docker-compose.yml`、`nginx/`、`k8s/`
- 模块职责：
  - 本地编排与服务入口
  - backend / trading-service / openclaw-gateway / postgres / redis / nginx 协同启动
  - 部署方向预留
- 当前状态：可支持本地联调与 MVP 运行
- 已知风险：
  - 生产/VM 配置规范与密钥治理仍需收敛

## 9. Reference Index

- 位置：`docs/devlog/appendix/repo-file-index.md`
- 模块职责：
  - 提供仓库级文件职责索引
  - 作为 module map 的细粒度补充
- 当前状态：已覆盖当前主线仓库的主要 tracked file 责任说明
