# v0.2 Overview

本文档是 `v0.2.0` 的总纲，目标是把当前 `v0.1.0` 从“可演示的多 agent 原型”推进到“可持续迭代的 MVP”。

配套文档：

- 模块说明：[../appendix/module-map.md](../appendix/module-map.md)
- 关键接口：[../appendix/interfaces.md](../appendix/interfaces.md)
- 系统架构：[../appendix/system-architecture.md](../appendix/system-architecture.md)
- 数据设计：[../appendix/data-models.md](../appendix/data-models.md)
- 问题与技术债：[./problems-and-debts.md](./problems-and-debts.md)

## 1. 项目当前状态（v0.1.0）

### 一句话概述

`v0.1.0` 已经完成了“用户提交股票分析请求 -> Go 网关协调 -> Python 调用 TradingAgents -> 数据落库 -> 前端轮询展示结果”的基本闭环。

### 当前版本的核心能力

- 用户可注册、登录并访问受保护接口。
- 前端可提交股票分析请求并轮询任务结果。
- Go 服务已具备鉴权、文章/RSS、分析任务 API 和数据库持久化。
- Python FastAPI 已封装 TradingAgents，多 agent 分析可异步执行。
- TradingAgents 已具备多 analyst、研究/风险链路和 vendor 数据路由。
- PostgreSQL 已保存任务、决策、文章等核心业务数据。
- Redis 已接入，但当前主要用于文章缓存和点赞计数。

### 当前版本的边界

- 任务运行期状态管理仍然是 PoC 级实现。
- Go/Python 契约仍偏弱类型。
- 前端主要展示最终结果，对 agent 过程透明度不足。
- `origin/dev_gq2142` 与 `origin/rag_fund` 的高价值能力尚未主线化。
- `推断`：主线的分析质量在实验场景可用，但尚未形成严格的质量验证体系。

## 2. 核心模块梳理

详细版本见 [../appendix/module-map.md](../appendix/module-map.md)。这里给出 v0.2 设计所需的主视图。

### Frontend

- 模块职责：用户交互、认证态维护、文章流展示、分析任务提交、分析结果展示。
- 输入/输出：输入用户表单和 token，输出 HTTP 请求和 UI 状态。
- 关键依赖：Go API、浏览器存储。
- 与其他模块关系：唯一面向用户的入口层。
- 当前状态：部分完成。
- 薄弱点：`App.tsx` 过重，分析过程展示不足。

### Go Backend

- 模块职责：业务 API 网关、JWT 鉴权、文章/RSS 管理、任务持久化、Python 协调。
- 输入/输出：接收前端 HTTP 请求，返回统一业务 JSON。
- 关键依赖：PostgreSQL、Redis、Python Trading Service。
- 与其他模块关系：当前系统的业务控制层。
- 当前状态：已完成基础闭环。
- 薄弱点：和 Python 的契约太松，状态源不唯一。

### Python Trading Service

- 模块职责：接受分析任务、执行后台流程、包装 TradingAgents 返回结果。
- 输入/输出：输入 `ticker/date/llm_config/data_vendor_config`，输出 `task_id/status/decision/analysis_report`。
- 关键依赖：TradingAgents、LLM、外部金融数据源。
- 与其他模块关系：Go 的内部执行服务。
- 当前状态：已完成。
- 薄弱点：任务状态保存在 Python 内存中，无法可靠服务化。

### TradingAgents Engine

- 模块职责：图编排 analyst/research/risk/trader 节点，生成最终决策。
- 输入/输出：输入 `ticker/trade_date`，输出完整状态和最终信号。
- 关键依赖：LangGraph、LLM provider、vendor tool routing。
- 与其他模块关系：Python 服务内部的核心能力层。
- 当前状态：已完成。
- 薄弱点：输出标准化不足，执行透明度与缓存治理尚弱。

### Data Vendor Routing

- 模块职责：把逻辑工具映射到 `yfinance/alpha_vantage/openai/google/local` 等供应商。
- 输入/输出：输入标准工具调用，输出文本化数据或报表。
- 关键依赖：vendor adapters、配置系统。
- 与其他模块关系：是 agent 的数据工具层。
- 当前状态：已完成。
- 薄弱点：缺少统一缓存、限流与共享抓取机制。

### Persistence And Runtime Coordination

- 模块职责：
  - PostgreSQL：保存用户、文章、任务、决策
  - Redis：当前主要做缓存和点赞，未来应扩展为任务协调层
- 当前状态：部分完成。
- 薄弱点：Redis 还未进入主分析任务主链路。

## 3. 关键接口梳理

详细版本见 [../appendix/interfaces.md](../appendix/interfaces.md)。

### 前端 -> Go API

- 调用方/被调用方：React -> Go
- 输入输出格式：HTTP JSON
- 状态管理方式：前端轮询任务状态
- 当前问题：响应字段依赖后端内部弱类型结构，错误语义不统一
- 演进方向：保持 REST，统一 schema 和错误模型

### Go -> Python Trading Service

- 调用方/被调用方：Go -> FastAPI
- 输入输出格式：HTTP JSON
- 状态管理方式：Go 查询 Python 任务状态，再落库
- 当前问题：任务状态双源、契约弱类型
- 演进方向：Go 负责业务真相，Python 负责执行；引入 Redis 作为运行时协调层

### TradingAgents -> Vendor Tools

- 调用方/被调用方：agent nodes -> `route_to_vendor()`
- 输入输出格式：Python 工具调用
- 状态管理方式：即取即用，缺少统一共享状态
- 当前问题：重复抓取、限流不足、结果结构不统一
- 演进方向：加缓存、加共享抓取、加 vendor 级治理

## 4. 系统架构

详细版本见 [../appendix/system-architecture.md](../appendix/system-architecture.md)。

当前系统可抽象为五层：

- 表现层：`frontend`
- 编排层：`backend`
- 能力层：`langchain-v1` + `TradingAgents`
- 数据层：`PostgreSQL` + `Redis`
- 外部依赖层：LLM、金融数据源、RSS

当前协作方式：

- 用户请求进入前端。
- 前端调用 Go API。
- Go 鉴权、记录任务，并把分析请求发给 Python。
- Python 调用 TradingAgents 图流程，TradingAgents 通过 vendor tools 抓取数据并运行 agent。
- Python 返回状态和结果，Go 持久化后供前端轮询读取。

当前最大结构问题不是“分层错误”，而是“运行期状态的职责还没有收紧”。

## 5. 数据设计

详细版本见 [../appendix/data-models.md](../appendix/data-models.md)。

### 核心数据类型

- 用户数据
- 文章与 RSS 数据
- 分析任务数据
- 交易决策数据
- agent 中间状态与分析报告
- vendor 获取的行情/新闻/基本面数据
- Redis 中的缓存与计数数据

### 当前数据流

- 用户请求 -> Go -> Python -> TradingAgents -> vendor data -> Python 汇总 -> Go 落库 -> 前端轮询
- RSS -> Go fetch/parse/sanitize -> DB -> Redis cache -> Frontend

### 当前问题

- 任务运行态没有统一生命周期设计
- `analysis_report` 结构偏弱
- vendor 数据没有统一缓存/共享策略
- `推断`：后续若接入 RAG，需要把“知识库数据”和“实时工具数据”分开建模

## 6. 当前存在的问题与挑战（按重要程度排序）

详细问题档案见 [./problems-and-debts.md](./problems-and-debts.md)。这里总结 v0.2 的主矛盾。

### P0

- Python 任务状态在内存中，服务重启和多实例不可用
- Go 和 Python 同时维护任务状态，系统真相源不唯一
- Go/Python 契约弱类型，存在运行时风险

### P1

- Redis 职责过轻，没有承担运行时协调
- 前端和后端都缺少分析过程透明度
- 配置来源分散，部署和调试成本高

### P2

- 前端模块边界不清晰
- 团队分支成果尚未系统吸收
- 基本面 RAG 和结构化输出仍在主线之外

## 7. v0.2 后续优化方向与新增功能（按重要程度排序）

### 方向 A：任务状态治理与执行链路重构

- 为什么要做：这是当前系统最核心的稳定性问题。
- 现有方案哪里不够：Python 内存状态无法支撑可靠任务系统。
- 解决什么真实问题：重启丢任务、多实例不可扩展、状态不一致。
- 对谁有价值：开发者、维护者、最终用户。
- 为什么现在做：如果不先解决，后续所有功能都建立在不稳的执行模型上。
- 设计思路：PostgreSQL 做业务真相，Redis 做执行协调，Python 降为执行器。
- 可选路线：仅 PostgreSQL；仅 Redis；引入更重队列系统。
- 取舍依据：`Redis + PostgreSQL` 在当前复杂度下最平衡。
- 实现成本：中等。
- 风险：跨服务改动较多。
- 预期收益：系统从 demo 向 MVP 转变。
- 优先级：P0
- 技术壁垒：不高，关键是边界设计和工程收敛。
- 核心竞争力：系统整合能力。

### 方向 B：Go/Python 契约收紧

- 为什么要做：当前真实风险是 schema 漂移和弱类型 panic，不是协议性能。
- 现有方案哪里不够：Go 直接处理动态 map。
- 解决什么问题：降低运行时错误，提升服务边界清晰度。
- 对谁有价值：后端开发、前端接入、后续可观测性建设。
- 为什么现在做：它是任务状态治理和前端透明度的共同前提。
- 设计思路：继续用 REST，先统一 JSON schema。
- 可选路线：直接迁移 gRPC。
- 取舍依据：gRPC 不直接解决当前主要问题。
- 成本：低到中等。
- 风险：需要一次性梳理所有相关返回结构。
- 预期收益：显著提升内部接口稳定性。
- 优先级：P0

### 方向 C：吸收分析透明度能力

- 为什么要做：多 agent 系统如果只给最终结论，用户和开发者都很难判断过程质量。
- 现有方案哪里不够：主线基本只暴露最终结果。
- 解决什么问题：无法看到阶段、耗时、关键中间结果。
- 对谁有价值：用户、开发者、后续产品设计。
- 为什么现在做：v0.2 应从“跑通”升级到“可解释、可排障”。
- 设计思路：吸收 `origin/dev_gq2142` 中的 `stage_times`、`key_outputs`、前端阶段视图。
- 可选路线：只做日志，不做前端展示。
- 取舍依据：前端阶段展示对用户价值更直接。
- 成本：中等。
- 风险：如果 schema 不先稳定，UI 会反复改。
- 预期收益：提升信任感、调试效率和产品可用性。
- 优先级：P1
- 技术壁垒：中等，在于跨层数据抽象。
- `推断`：如果透明度体系成熟，未来会形成明显的产品差异化。

### 方向 D：配置治理

- 为什么要做：当前 Go/Python/Compose 配置分散且有隐式覆盖。
- 现有方案哪里不够：调试和部署时容易出现“看起来配置了，实际没生效”的问题。
- 解决什么问题：环境一致性和可维护性。
- 对谁有价值：开发者和部署维护者。
- 为什么现在做：与任务状态重构同时推进成本最低。
- 设计思路：定义配置优先级与 source of truth，减少硬编码。
- 可选路线：全 env-only 或全 config-file。
- 取舍依据：保留“文件配置 + env 覆盖”的混合模式更适合当前项目。
- 成本：低。
- 优先级：P1

### 方向 E：前端模块化重构

- 为什么要做：当前 UI 逻辑在 `App.tsx` 里过于集中。
- 现有方案哪里不够：后续加 agent transparency 和更多页面时维护成本会快速上升。
- 解决什么问题：降低前端继续开发的阻力。
- 对谁有价值：前端开发者和后续协作成员。
- 为什么现在做：如果透明度 UI 要接入，现在顺手拆边界最划算。
- 设计思路：拆 auth、articles、analysis 等模块状态。
- 可选路线：先不拆继续堆功能。
- 取舍依据：再往后拆成本更高。
- 成本：中等。
- 优先级：P1

### 方向 F：分析质量增强（结构化输出、估值分析、RAG）

- 为什么要做：当前主线更像执行闭环打通，分析质量提升空间仍然大。
- 现有方案哪里不够：输出标准化不足，fundamentals 缺少更强的上下文支撑。
- 解决什么问题：提高分析可比较性、可审计性和深度。
- 对谁有价值：最终用户和后续研究开发。
- 为什么现在不排到更前：稳定性和边界问题优先于质量增强。
- 设计思路：
  - 从 `origin/dev_gq2142` 吸收结构化 analyst 输出和 valuation 思路
  - 从 `origin/rag_fund` 吸收 fundamentals RAG 抽象
- 可选路线：整分支合并。
- 取舍依据：两分支都落后主线，且含大量无关改动，必须按能力吸收。
- 成本：中到高。
- 风险：增强能力可能重新把系统拉回复杂但不稳定的状态。
- 预期收益：中长期较高，短期低于基础设施工作。
- 优先级：P2
- 技术壁垒：中等，关键在高质量数据资产和跨层集成。
- `推断`：如果后续形成高质量知识库和结构化评估体系，会形成长期复利。

## 8. 建议的 v0.2 里程碑

### 阶段 1：执行稳定性

- 目标：统一任务状态与服务边界
- 产出物：任务状态机、Redis 运行时协调、PostgreSQL 真相源、Go/Python 强类型 schema
- 依赖：无，必须最先开始
- 风险：跨服务联动改动多
- 适合先做的 PoC：最小任务队列与状态回写闭环

### 阶段 2：透明度与可观测性

- 目标：暴露 agent 阶段信息与关键中间结果
- 产出物：阶段耗时、关键输出、前端阶段视图
- 依赖：阶段 1 的 schema 稳定
- 风险：若阶段字段反复变更，前端会返工

### 阶段 3：结构整理

- 目标：降低后续迭代成本
- 产出物：配置治理、前端边界拆分、文档持续化
- 依赖：阶段 2 的接口形态基本确定
- 风险：容易被“看起来不直接产出功能”的工作压后

### 阶段 4：质量增强

- 目标：在稳定系统上增强分析质量
- 产出物：结构化输出、估值分析、fundamentals RAG、vendor 缓存与共享
- 依赖：前 3 阶段完成
- 风险：复杂度再次上升

## 结论

`v0.2.0` 的核心不是“加更多 agent”，而是把现有系统收紧成真正可持续开发的 MVP。先修稳定性和边界，再吸收透明度和质量增强能力，是当前最稳妥的推进顺序。
