# v0.2 Overview

本文档是 `v0.2.0` 的总纲，目标是把当前系统从“已打通主链路”推进到“可持续迭代的 MVP”。

配套文档：

- 模块说明：[../appendix/module-map.md](../appendix/module-map.md)
- 关键接口：[../appendix/interfaces.md](../appendix/interfaces.md)
- 系统架构：[../appendix/system-architecture.md](../appendix/system-architecture.md)
- 数据设计：[../appendix/data-models.md](../appendix/data-models.md)
- 问题与技术债：[./problems-and-debts.md](./problems-and-debts.md)

## 1. 项目当前状态（v0.1.2 -> v0.2.0 进行中）

### 一句话概述

当前主线已经形成“前端提交分析 -> Go 持久化与入队 -> Python worker 执行 TradingAgents -> Redis 运行态同步 -> Go 回写与查询 -> 前端阶段化展示”的可运行闭环。

### 当前版本的核心能力

- 用户注册、登录、JWT 鉴权、受保护接口可用。
- 交易分析主流程可用：`POST /api/trading/analyze` 发起、`GET /api/trading/analysis/:task_id` 轮询。
- 任务运行态已从 Python 内存迁移到 Redis（队列 + runtime key），并保留 PostgreSQL 持久业务记录。
- Go 已支持取消/继续：`POST /api/trading/analysis/:task_id/cancel`、`POST /api/trading/analysis/:task_id/resume`。
- 分析请求已支持 `execution_mode`（`default` / `openclaw`），主响应已支持 `stages` 作为阶段主展示契约。
- Python worker 已支持：
  - 阻塞队列消费与 processing 队列恢复
  - 运行态 checkpoint 持续写回
  - worker 存活检测与自动重启
- 分析过程透明度已进入主线：
  - `stages`（主）
  - `analysis_report.__stage_times/__key_outputs`（兼容）
  - 前端阶段视图与处理中间结果展示
- 文章链路已切到 DB-first smart refresh，并记录 `feed_ingest_runs` 审计数据。
- 认证 header 已统一为 Bearer 约定（前端补齐，后端兼容解析）。

### 当前版本的边界

- Go/Python 的任务结果契约仍以弱结构为主（`map[string]interface{}`/动态 JSON 区域较多）。
- provider fidelity 仍有收尾验证事项（尤其是 DashScope 端到端回归闭环）。
- Go/FastAPI 在“任务 API 对外暴露”层面仍有重叠，需要收敛为单外部入口。
- 配置优先级（Go/Python/Docker）尚未形成统一规则文档和强约束。
- 前端状态边界仍偏集中，`App.tsx` 拆分不彻底。
- OpenClaw 仍存在“workflow 适配层 vs chat 本地直连 MVP”的双路径收敛问题。
- feed 仍缺后台定时 ingest（当前以 smart refresh/manual 为主）。
- `推断`：当前已具备 MVP 骨架，但在多环境稳定性和回归测试覆盖上仍处于“工程收敛期”。

## 2. 核心模块梳理

### Frontend

- 模块职责：认证态、文章流、分析任务发起/轮询、阶段化结果展示、取消/继续交互。
- 输入/输出：输入用户操作与 token，输出对 Go API 的 REST 请求与 UI 状态。
- 关键依赖：`backend` API、浏览器本地存储。
- 与其他模块关系：用户入口层，消费 `analysis_report` 的阶段元数据。
- 当前状态：部分完成。
- 薄弱点：页面状态管理边界仍较重，后续重构空间大。

### Go Backend

- 模块职责：统一 API 入口、鉴权、任务创建与持久化、Redis 队列写入、运行态对账、结果回写。
- 输入/输出：接收前端 HTTP JSON，返回任务/统计/图表/健康检查 JSON。
- 关键依赖：PostgreSQL、Redis、Python Trading Service（健康检查）。
- 与其他模块关系：系统编排层与对外业务真相层。
- 当前状态：主链路完成。
- 薄弱点：跨语言契约仍未完全强类型化。

### Python Trading Service

- 模块职责：消费 Redis 队列、执行 TradingAgents、写回 Redis runtime 状态与报告。
- 输入/输出：输入任务 payload（ticker/date/config），输出 runtime 状态、决策和分析报告。
- 关键依赖：TradingAgents、LLM provider、外部数据 vendor、Redis。
- 与其他模块关系：执行引擎服务，不直接对前端暴露任务主流程接口。
- 当前状态：已完成 Redis 化运行模式。
- 薄弱点：worker 仍是进程内线程模型，横向扩展和调度治理仍可增强。

### TradingAgents Engine

- 模块职责：组织 analyst/research/risk/trader 流程，产出投资决策与中间分析状态。
- 输入/输出：输入标的与日期、模型与数据源配置；输出报告与决策对象。
- 关键依赖：LangGraph、LLM provider routing、vendor tools。
- 与其他模块关系：Python 服务内部核心能力层。
- 当前状态：已完成并支持阶段元数据产出。
- 薄弱点：结构化输出标准与 vendor 侧缓存去重尚未完全统一。

### Persistence And Runtime Coordination

- 模块职责：
  - PostgreSQL：用户/文章/任务/决策等持久业务数据
  - Redis：任务队列、processing 队列、runtime state、近期任务索引、文章缓存与点赞
- 与其他模块关系：Go 与 Python 的共享状态中枢。
- 当前状态：核心职责已落地（不再仅是文章缓存）。
- 薄弱点：vendor 抓取去重和更系统的缓存分层尚未完成。

## 3. 关键接口梳理

### 前端 -> Go API（主业务接口）

- 调用方/被调用方：React -> Go。
- 输入输出：REST JSON。
- 主要接口：
  - `POST /api/trading/analyze`
  - `GET /api/trading/analysis/:task_id`
  - `POST /api/trading/analysis/:task_id/cancel`
  - `POST /api/trading/analysis/:task_id/resume`
  - `GET /api/trading/analyses`
  - `GET /api/trading/stats`
- 状态管理方式：前端轮询 + 本地 active task 记忆。
- 当前问题：部分字段仍依赖后端动态结构，前后端契约有演进风险。
- 演进方向：统一 schema、错误码、字段语义。

### Go <-> Redis（任务协调接口）

- 调用方/被调用方：Go runtime 控制器 -> Redis。
- 输入输出：Redis key/value + list payload。
- 状态管理方式：
  - Go 创建任务时写 runtime 初始态并入队
  - Go 查询时做 runtime 对账与持久化回写
  - Go 取消/继续时同步清理 queue/processing 残留 payload
- 当前问题：对账主要依赖请求触发，后台定时修复机制仍可补强。
- 演进方向：补 sweeper/metrics，提升异常恢复闭环能力。

### Python <-> Redis（执行运行时接口）

- 调用方/被调用方：Python worker -> Redis。
- 输入输出：队列 payload 与 runtime JSON。
- 状态管理方式：
  - `queue` -> `processing` 的阻塞消费
  - checkpoint 期间持续写 runtime
  - terminal 状态写回并清理 processing
- 当前问题：线程级 worker 的并发模型与扩展策略仍需定义。
- 演进方向：可观测性增强、可选多 worker/进程治理。

### Go -> Python（服务健康接口）

- 调用方/被调用方：Go -> Python `/health`。
- 输入输出：HTTP JSON。
- 状态管理方式：健康探针，不承载任务主链路状态。
- 当前问题：健康状态与任务吞吐指标尚未统一可观测视图。
- 演进方向：把 worker queue depth、runtime lag 纳入统一健康面板。

### TradingAgents -> Vendor Tools

- 调用方/被调用方：agent nodes -> vendor routing。
- 输入输出：工具调用与文本/结构化片段结果。
- 状态管理方式：执行期拉取，逐步沉淀进 `analysis_report`。
- 当前问题：高成本调用缺少全局去重/缓存策略。
- 演进方向：vendor 级去重、缓存、失败降级与重试策略。

## 4. 系统架构

当前系统可抽象为五层：

- 表现层：`frontend`
- 编排层：`backend`
- 能力层：`langchain-v1` + `TradingAgents`
- 数据层：`PostgreSQL` + `Redis`
- 外部依赖层：LLM、金融数据源、RSS

当前协作主链路：

1. 前端请求分析任务。
2. Go 生成 `task_id`，落库 `trading_analysis_tasks`，写 Redis runtime 初始状态并入队。
3. Python worker 从 Redis 消费任务，执行 TradingAgents，并持续回写 runtime/checkpoint。
4. Go 在查询时读取 runtime 并与 DB 对账，终态回写 DB（含 decision/report）。
5. 前端轮询任务并渲染阶段进度、关键输出与最终结果。

当前结构判断：

- 分层是合理的，且比 v0.1 初期更清晰。
- 当前主风险已经从“状态设计错误”转为“契约与治理不够硬”（schema、配置、回归验证、缓存策略）。

## 5. 数据设计

### 核心数据类型

- 用户与认证数据（PostgreSQL）
- 文章/RSS 与点赞数据（PostgreSQL + Redis）
- 分析任务实体（PostgreSQL）
- 分析运行态（Redis runtime key）
- 分析队列态（Redis queue/processing list）
- 决策与报告（PostgreSQL `trading_decisions` + runtime 中间态）
- vendor 拉取数据（执行期临时对象，部分结果进入报告）

### 当前数据流

- 分析任务：
  - Frontend -> Go API -> PostgreSQL + Redis queue
  - Python worker -> TradingAgents -> Redis runtime checkpoints
  - Go 查询对账 -> PostgreSQL 终态写入 -> Frontend 展示
- RSS：
  - Go 拉取/清洗 -> DB -> Redis cache -> Frontend

### 当前问题

- `analysis_report` 结构仍偏“半结构化”，字段约束不足。
- runtime 丢失后的对账主要由查询路径触发，主动修复仍可增强。
- vendor 数据去重和缓存分层未形成统一策略。
- `推断`：后续若引入 fundamentals RAG，需要把“长生命周期知识数据”与“实时调用数据”彻底分层。

## 6. 当前存在的问题与挑战（按重要程度排序）

### P0

- Go/FastAPI 对外任务 API 边界仍有重叠，存在绕过网关风险。
- Go/Python 结果契约仍弱类型，结构演进存在运行时风险。
- provider fidelity 的端到端回归尚未完全收口（DashScope 仍有待验证闭环）。
- OpenClaw 运行依赖/健康契约在部分本地场景仍未完全稳定。

### P1

- 配置优先级规则未统一（Go/Python/Docker 组合下可预期性不足）。
- 前端状态边界仍有重耦合，扩展成本偏高。
- 运行态修复机制以请求触发为主，后台治理能力可继续增强。
- feed 缺少后台定时 ingest 调度能力。

### P2

- vendor 级去重缓存、结构化输出增强、RAG/valuation 能力仍在评估阶段。
- 分支能力吸收仍是“按能力摘取”过程，尚未全部主线化。

## 7. v0.2 后续优化方向与新增功能（按重要程度排序）

### 方向 A：服务边界收敛（P0）

- 为什么要做：当前存在双入口历史包袱，边界不收敛会持续引入治理噪音。
- 不足点：Python 仍暴露分析任务 API，与 Go 网关职责有重叠。
- 解决真实问题：避免绕过 Go 鉴权/持久化语义，统一外部契约演进入口。
- 设计路线：Go 作为唯一外部交易 API；Python 收敛为内部 worker/runtime 服务。
- 备选路线：保留双入口但约定“只用 Go”。
- 选择原因：工程上“约定”不如“边界”可靠。

### 方向 B：Go/Python 强契约化（P0）

- 为什么要做：当前最大故障风险来自 schema 漂移。
- 不足点：关键路径仍有动态字段和宽松解析。
- 解决真实问题：减少运行时解析错误，稳定前后端演进。
- 设计路线：保持 REST，先统一 JSON schema 与错误模型，再决定是否需要 gRPC。
- 备选路线：直接迁移 gRPC（约束更强但迁移成本更高）。
- 选择原因：当前痛点是契约治理，不是协议性能。

### 方向 C：Provider Fidelity 收口（P0）

- 为什么要做：多 provider 体系若存在隐式回退，会直接影响成本和结果可信度。
- 不足点：已有修复，但仍有待完成的端到端回归闭环。
- 解决真实问题：确保“选了谁就真正调用谁”。
- 设计路线：建立 provider 回归矩阵（模型、embedding、news/vendor 路由）。
- 备选路线：仅靠手工抽测。
- 选择原因：自动化回归更可靠，可持续复用。

### 方向 D：配置治理统一（P1）

- 为什么要做：多语言多服务系统已出现配置心智负担。
- 不足点：优先级与覆盖关系缺少单一规则。
- 解决真实问题：降低部署与调试不确定性。
- 设计路线：固化 `默认值 < 配置文件 < 环境变量`，补可视化生效配置输出。
- 备选路线：env-only 或 file-only。
- 选择原因：混合模式更符合当前团队开发节奏。

### 方向 E：OpenClaw 收敛治理（P1）

- 为什么要做：当前 OpenClaw 有 workflow 与 chat 两条路径，部署与健康语义未统一。
- 不足点：本地可运行不等于远程可部署，且 health 可能出现误导性 degraded。
- 解决真实问题：降低集成歧义，明确“可运行/可部署/可观测”边界。
- 设计路线：统一 gateway 依赖契约、修正健康判定、打通 chat role binding 与 workflow 配置。
- 备选路线：保持本地 MVP 独立演化。
- 选择原因：长期看必须回归单条产品化路径。

### 方向 F：前端状态边界重构（P1）

- 为什么要做：阶段化能力已上线，继续叠加功能会放大状态耦合成本。
- 不足点：主容器承担过多职责。
- 解决真实问题：提升可维护性与测试粒度。
- 设计路线：拆分 auth/articles/analysis 三块状态域。
- 备选路线：维持现状继续堆功能。
- 选择原因：现在拆分成本最低。

### 方向 G：数据获取治理（P2）

- 为什么要做：vendor 调用成本和稳定性将成为规模瓶颈。
- 不足点：去重、缓存、限流治理尚不系统。
- 解决真实问题：降低重复请求和外部依赖抖动影响。
- 设计路线：引入 request fingerprint + runtime cache + failure fallback。
- 备选路线：只在单点工具函数做临时缓存。
- 选择原因：系统级策略更可控，长期收益更高。

### 方向 H：能力增强吸收（P2）

- 为什么要做：`origin/rag_fund`、`origin/dev_gq2142` 仍有未吸收价值。
- 不足点：主线质量增强能力还不完整。
- 解决真实问题：提升分析深度、可审计性和长期差异化。
- 设计路线：按能力摘取（RAG、valuation、结构化输出），避免整分支合并。
- 备选路线：直接并分支。
- 选择原因：主线与分支偏差大，整合风险高。

## 8. 建议的 v0.2 里程碑

### 阶段 1：边界收敛与契约回归基线（P0）

- 目标：收敛 Go/FastAPI 外部边界，收紧 schema，并完成 provider fidelity 回归闭环。
- 产出：单外部 API 边界、统一响应 schema、契约测试、provider 回归矩阵。
- 依赖：现有 Redis 运行时链路（已具备）。
- 风险：跨服务字段同步成本。

### 阶段 2：配置与可观测性（P1）

- 目标：统一配置优先级并提升运行可见性。
- 产出：配置规范、运行时指标、任务修复策略增强。
- 依赖：阶段 1 的 schema 稳定。
- 风险：历史配置兼容处理。

### 阶段 3：前端结构重整（P1）

- 目标：降低前端维护复杂度，支撑持续迭代。
- 产出：状态域拆分、测试补强、页面行为一致性校验。
- 依赖：阶段 1-2 的接口语义稳定。
- 风险：迁移期间 UI 回归。

### 阶段 4：质量增强与能力吸收（P2）

- 目标：在稳定底座上推进分析质量升级。
- 产出：RAG/valuation/结构化输出的可控接入。
- 依赖：前 3 阶段完成。
- 风险：能力增强引入额外复杂度。

## 结论

`v0.2.0` 的优先级已经从“打通流程”转向“收紧契约、提升可维护性、做可持续增强”。主线已具备 MVP 骨架，接下来应以工程治理和验证闭环为先，再扩功能深度。
