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
- 分析链路是否只在完整可信时产生投资建议
- 事实、舆情和历史报告是否能按时间版本被追溯和复用
- 运行与 provider 路径是否足够稳定和可解释
- 用户配置、治理与数据体验是否达到可持续迭代水平

## Foundations Already Landed

以下能力已经进入主线，不再作为新的 PRD 项目，但它们构成当前版本的基础：

- 用户 profile、email verification、BYOK：`ADR-027`, `ADR-038`
- usage/admin 与 first-pass RBAC：`ADR-029`, `ADR-031`, `ADR-037`
- pgvector 持久记忆基础：`ADR-030`
- unified market-data surface (`chart / quote / terminal`)：`ADR-032`
- runtime boundary convergence、repo slimming、advanced analysis config、analysis export、contract drift guard：`ADR-045`

## v0.1.5 Snapshot Boundary

`v0.1.5` 是中间稳定快照，但它的语义必须窄于 `v0.2.0`：

- `v0.1.5` 已完成：边界收敛、仓库瘦身、旧入口移除、分析导出、高级分析配置、Go/Python contract hygiene。
- `v0.1.5` 不能声明已经完成：strict completion fail-closed、Evidence Ledger、Report Memory、Signal Ledger、outcome evaluation、validated reflection loop。
- 详细边界以 `CHANGELOG.md`、`current/capabilities.md`、`current/task-backlog.md` 和 `archive/v0.1.5/` 为准。

## Active Product Requirements

### 1. Strict Analysis Completion And Recovery

- `why`
  - 金融分析产品不能把缺少关键 agent 的 partial checkpoint 包装成完整报告。
  - 若 required stage 失败后仍产出 `BUY / SELL / HOLD`，会污染用户判断、Signal Ledger、Report Memory 和 Reflection Memory。
- `needed`
  - 定义每种 analysis mode 的 required stage contract
  - required stage 失败时 fail closed，不生成最终投资建议
  - transient failure 支持 bounded retry / equivalent vendor fallback / allowed cache recovery
  - 增加 `failed_recoverable` / `incomplete` / `expired` 等更细任务状态
  - 用户可重试失败 stage 或重新运行完整分析
- `solution direction`
  - 把 checkpoint 与 final report 语义分开
  - 只有 `completed` 且 required stages 全部成功的任务可进入后续信号、记忆、评估链路
  - UI 明确展示失败 stage、错误类别、已尝试恢复动作和后续操作
- `backlog / records`
  - `task-backlog.md` P0
  - `ADR-046`

### 2. Evidence And Report Memory

- `why`
  - 当前 pgvector 主要是反思型 agent memory 基础，不等同于“完整报告自动向量化入库”。
  - 新闻、舆情、财报和市场事实会随时间变化，旧事实可能被新事实推翻；系统必须知道 as-of 语义。
- `needed`
  - 建立 time-aware evidence ledger，记录事实、舆情、新闻、公告、关键假设的 observed/event/as-of 时间
  - 建立 report vector index，把有效完成的 stage/report chunk 向量化并带 task/ticker/date/stage/provider 元数据
  - 支持 repeated analysis delta：相比上次分析，哪些事实新增、失效、反转
  - 防止未来事实泄漏到历史分析或回测
- `solution direction`
  - 将 Evidence Memory、Report Memory、Reflection Memory 分开建模
  - 旧事实默认 supersede，而不是覆盖或删除
  - prompt 检索时显式区分当前证据、历史报告和事后反思 lesson
- `backlog / records`
  - `task-backlog.md` P0/P1
  - `ADR-047`

### 3. Signal Ledger And Reflection Loop

- `why`
  - 当前系统能产出 `BUY / SELL / HOLD`，但还没有把这些信号作为一等对象持续评估。
- `needed`
  - 持久化每次最终信号
  - 做 `T+1 / T+5 / T+20` 结果跟踪
  - 建立 win rate、return、confidence calibration 等评分视图
  - 关联每个 agent stance 和 token cost
  - outcome 成熟后生成 reflection memory，而不是把未经验证的历史报告直接当作经验
- `solution direction`
  - 在 backend 增加 signal ledger 数据模型和只读/聚合 API
  - 前端增加 scorecard / attribution 页面
  - 与 usage 数据打通，而不是单独再造一套统计
  - 只有 `ADR-046` 定义下的有效 `completed` 任务可以进入 signal / outcome / reflection 链路
- `backlog / records`
  - `task-backlog.md` P0
  - `ADR-035`, `ADR-048`

### 4. Runtime And Provider Fidelity Hardening

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

### 5. User Domain Governance

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

### 6. Market Data And Feed Efficiency

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
- 全面引入 fundamentals RAG 或更多 agent
- valuation analyst / 更强结构化输出
- OpenClaw Chat 页面继续扩展为独立产品面
- 直接复制 `.reference/` 项目的实现代码

这些方向在 backlog 和 ADR 中保留，但当前版本优先让现有主线更完整、更可评估、更可追溯。

## Reference Intake Note

`.reference/` 是本地 Git-ignored 参考项目目录，不属于 tracked devlog 结构。它可以保存外部 agent/runtime/frontend style 项目，并通过 `.reference/README.local.md` 维护 source、commit、用途、license review 和 adoption notes。

任何参考项目的功能采纳都必须回到既有 devlog 边界：

- 若形成产品需求，进入 `current/prd.md` 和 `current/task-backlog.md`
- 若形成架构决策，进入 `records/ADR-XXX`
- 若形成稳定接口或模型，进入 `appendix/`
- 若只是设计灵感，保留在本地 `.reference/README.local.md`，不扩大 tracked 文档结构
