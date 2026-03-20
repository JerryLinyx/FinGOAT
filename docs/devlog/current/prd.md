# PRD

本文档汇总当前版本还要继续推进的产品需求，以及对应的实现方向。它不替代 backlog，也不替代 ADR。

规则：

- `PRD` 回答“当前版本还要完成什么，为什么做，准备怎么做”
- `task-backlog.md` 回答“具体有哪些可执行项”
- `../records/` 回答“为什么最终这样决策”

## Current Version Goal

把 FinGOAT 从“工程化 MVP 骨架”推进到“可追溯、可评估、可持续迭代的分析产品”。

当前版本的重点不是继续铺功能面，而是把以下三类能力收紧：

- 决策结果是否能被跟踪和评估
- 运行与 provider 路径是否足够稳定和可解释
- 用户配置、治理与数据体验是否达到可持续迭代水平

## Foundations Already Landed

以下能力已经进入主线，不再作为新的 PRD 项目，但它们构成当前版本的基础：

- 用户 profile、email verification、BYOK：`ADR-027`, `ADR-038`
- usage/admin 与 first-pass RBAC：`ADR-029`, `ADR-031`, `ADR-037`
- pgvector 持久记忆：`ADR-030`
- unified market-data surface (`chart / quote / terminal`)：`ADR-032`

## Active Product Requirements

### 1. Signal Ledger And Decision Evaluation

- `why`
  - 当前系统能产出 `BUY / SELL / HOLD`，但还没有把这些信号作为一等对象持续评估。
- `needed`
  - 持久化每次最终信号
  - 做 `T+1 / T+5 / T+20` 结果跟踪
  - 建立 win rate、return、confidence calibration 等评分视图
  - 关联每个 agent stance 和 token cost
- `solution direction`
  - 在 backend 增加 signal ledger 数据模型和只读/聚合 API
  - 前端增加 scorecard / attribution 页面
  - 与 usage 数据打通，而不是单独再造一套统计
- `backlog / records`
  - `task-backlog.md` P0
  - `ADR-035`

### 2. Runtime And Provider Fidelity Hardening

- `why`
  - 当前最大的产品风险仍然是“选择了某条 provider / execution path，但行为和预期不完全一致”。
- `needed`
  - 收口 DashScope provider fidelity
  - 长任务中增量 flush usage events
  - OpenClaw 顶层 stage 也带 token visibility
  - 继续收紧 Go / Python typed contract
- `solution direction`
  - 先补 provider regression matrix 和关键链路回归
  - usage 按阶段/周期写入，而不是只在 terminal completion 汇总
  - OpenClaw 路径保持与主 `stages` 语义一致
- `backlog / records`
  - `task-backlog.md` P0/P1/P2
  - `ADR-025`, `ADR-032`, `ADR-036`, `ADR-037`

### 3. User Domain Governance

- `why`
  - 用户配置已经上线，但治理和迁移收口还不够。
- `needed`
  - email verification Phase 2/3
  - password reset / session management
  - 继续收口 legacy username 兼容路径
  - 更细的 BYOK metadata / governance
- `solution direction`
  - 保持 email-first 主路径
  - 后续认证增强优先沿现有 profile/BYOK 体系扩展，不重开第二套账户模型
- `backlog / records`
  - `task-backlog.md` P0
  - `ADR-020`, `ADR-027`, `ADR-038`

### 4. Market Data And Feed Efficiency

- `why`
  - 图表、terminal、feed 已经可用，但调用成本与缓存治理会成为规模瓶颈。
- `needed`
  - vendor fetch deduplication
  - runtime caching
  - 更稳的 market-data fallback
  - feed freshness / ingest 策略继续增强
- `solution direction`
  - 先建立 request fingerprint + cache policy
  - 避免在 controller/tool 层各自零散补缓存
- `backlog / records`
  - `task-backlog.md` P2
  - `ADR-016`, `ADR-028`, `ADR-032`

## Not Primary Scope Right Now

以下方向有价值，但不是当前版本主优先级：

- 多通道身份（手机号 / 微信）
- 全面引入 fundamentals RAG
- valuation analyst / 更强结构化输出

这些方向在 backlog 和 ADR 中保留，但当前版本优先让现有主线更可评估、更稳、更可追溯。
