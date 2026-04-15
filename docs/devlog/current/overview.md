# Current Overview

`v0.1.5` 已作为最新稳定基线完成封版归档。`current/` 继续承载后续开发工作，下一阶段产品闭环目标仍然是 `v0.2.0`。

## Current State

- 当前主链路：`frontend -> Go API -> PostgreSQL/Redis -> Python worker -> TradingAgents -> runtime checkpoints -> Go query/reconcile -> frontend stage view`
- 当前稳定基线：`v0.1.5`
- 当前快照定位：运行边界收敛、仓库瘦身、分析配置增强、导出能力和 contract hygiene
- 当前规划目标：`v0.2.0`
- 当前主线变化：边界收敛和仓库瘦身已落地，旧 `articles / langchain-v1 / CLI / deprecated Python APIs` 已退出主仓
- 当前主风险：严格完整性契约、时序证据/记忆、signal evaluation、typed contract 与质量治理，而不是旧边界残留
- 当前参考策略：`.reference/` 是本地忽略的外部项目参考区；后续 agent/runtime/frontend style 借鉴先进入既有 PRD/backlog/ADR 流程，再进入实现

## Read This Next

- 当前能力矩阵：[./capabilities.md](./capabilities.md)
- 当前版本 PRD：[./prd.md](./prd.md)
- 当前 backlog：[./task-backlog.md](./task-backlog.md)
- 当前问题与技术债：[./problems-and-debts.md](./problems-and-debts.md)
- 当前阶段计划：[./milestones.md](./milestones.md)
- ADR 索引：[../records/README.md](../records/README.md)
- 版本摘要：[../CHANGELOG.md](../CHANGELOG.md)

## Stable Reference

- 模块说明：[../appendix/module-map.md](../appendix/module-map.md)
- 接口说明：[../appendix/interfaces.md](../appendix/interfaces.md)
- 数据模型：[../appendix/data-models.md](../appendix/data-models.md)
- 系统架构：[../appendix/system-architecture.md](../appendix/system-architecture.md)
- 仓库级文件索引：[../appendix/repo-file-index.md](../appendix/repo-file-index.md)

## Current Focus

- 在已收敛边界上继续强化 typed contract 和错误模型
- 推进 strict completion / evidence memory / report memory / signal ledger / attribution / smart routing 这些更高 ROI 的分析能力
- 用 `.reference/` 中的 agent 项目和 frontend style 项目做受控评估，先在既有文档体系里沉淀设计判断，再进入实现
- 继续补用户域迁移收口与配置治理
- 巩固 provider fidelity、后台治理和回归验证
