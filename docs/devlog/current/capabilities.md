# Capabilities

本文档记录当前主线“已经能做什么 / 部分完成什么 / 还缺什么”。它是 `overview.md` 的详细展开页。

## Auth / Profile / BYOK

- `working`
  - email-first 兼容注册/登录
  - JWT 鉴权与受保护接口
  - Profile 页面与基础资料编辑
  - email verification / resend verification
  - per-user API key 加密存储与脱敏展示
- `partial`
  - legacy username 兼容路径仍保留
  - BYOK 已可用，但角色治理和密钥审计还不完整
- `gaps`
  - 手机号 / 微信登录
  - password reset / session management
  - 更细粒度角色管理入口
- `source ADRs`
  - `ADR-020`, `ADR-027`, `ADR-029`, `ADR-031`, `ADR-038`

## Trading Runtime

- `working`
  - Go 创建分析任务并持久化
  - Redis queue + processing + runtime state
  - Python worker 消费任务并持续写 checkpoint
  - cancel / resume
  - `stages` 作为主展示契约
  - 顶层四个 analyst 以独立子进程执行，并通过 Redis Streams + SSE 实时上报事件
  - provider usage 已统一走 shared normalization，`ollama` token 重新进入 stage 统计链
- `partial`
  - Go/Python 结果结构仍有动态 JSON 区域，但 selected stages 已开始收敛到 `StageRequest / StageResult / ExecutionBackend`
  - runtime 修复仍偏请求驱动
  - 只有顶层四个 analyst 已进程化；debate stages 仍在单 graph run 内
- `gaps`
  - 更系统的后台 sweeper / reconciliation
  - 更强的 typed contract 和错误模型
  - debate multi-agent protocol 仍未 backend 化
- `source ADRs`
  - `ADR-001`, `ADR-012`, `ADR-013`, `ADR-014`, `ADR-017`, `ADR-018`, `ADR-021`, `ADR-026`, `ADR-042`, `ADR-044`

## Market Data

- `working`
  - `chart`, `quote`, `terminal` 三类主接口
  - `US / CN` 统一前端壳层
  - 独立 `market-data-service`
  - 本地图表历史查询复用
- `partial`
  - provider fallback 与 cache 策略仍在打磨
  - A-share / US 行情能力虽已统一壳层，但仍有 provider 差异
- `gaps`
  - 更系统的 vendor dedupe / runtime cache
  - 更细的图表查询历史持久化与跨端同步
- `source ADRs`
  - `ADR-004`, `ADR-016`, `ADR-022`, `ADR-032`

## Feed

- `working`
  - DB-first smart refresh
  - RSS dedupe 与 backfill
  - `feed_ingest_runs` 审计
  - feed board 基本交互与修复
- `partial`
  - freshness 仍部分依赖当前调度策略
- `gaps`
  - 更系统的调度与缓存治理
- `source ADRs`
  - `ADR-016`, `ADR-028`

## Usage / Admin

- `working`
  - usage event 采集
  - user usage summary
  - admin usage summary / users
  - first-pass RBAC with `user/admin`
- `partial`
  - usage ingest 仍以 terminal completion 为主
  - admin 能力仍偏最小化
- `gaps`
  - 增量 flush usage events
  - 更完整的 admin governance
- `source ADRs`
  - `ADR-029`, `ADR-031`, `ADR-037`

## OpenClaw

- `working`
  - OpenClaw gateway
  - `execution_mode=openclaw`
  - per-user analyst registry / stage-run
  - workflow 专用 agents 已支持 `market / social / news / fundamentals / portfolio_manager / trader_plan / risk_management` 共 `7/9` stages
  - Dockerized backend / trading-service 已可通过 `host.docker.internal` 连接宿主机 OpenClaw gateway
- `partial`
  - chat 与 workflow 已相关，但仍有 local-first 历史包袱
  - 聊天页里 4-agent role match 仍是历史 MVP；workflow 实际使用的是单独的 7-stage workflow agents
  - stage-level provider/duration 已统一，但 token usage 仍未从 gateway 回传
  - 健康契约和部署路径仍需收敛
- `gaps`
  - `research_debate / risk_debate` 的 multi-agent protocol
  - 更稳定的 VM / remote deployment 形态
  - 更完整的 usage / token visibility
- `source ADRs`
  - `ADR-010`, `ADR-023`, `ADR-026`, `ADR-044`

## Deployment / Infra

- `working`
  - docker-compose 主开发链路
  - nginx 作为统一入口
  - backend / trading-service / market-data-service / OpenClaw gateway 分层
- `partial`
  - Go / Python / Docker 配置优先级仍需更明确文档和约束
- `gaps`
  - 更强的环境分层与密钥治理
  - 生产部署回归清单
- `source ADRs`
  - `ADR-021`, `ADR-026`, `ADR-032`, `ADR-033`
