# Current Overview

`v0.1.4` 已作为最新稳定基线完成封版归档。`current/` 继续承载后续开发工作，当前下一阶段目标仍然是 `v0.2.0`。

## Current State

- 当前主链路：`frontend -> Go API -> PostgreSQL/Redis -> Python worker -> TradingAgents -> runtime checkpoints -> Go query/reconcile -> frontend stage view`
- 当前稳定基线：`v0.1.4`
- 当前规划目标：`v0.2.0`
- 当前主风险：边界与治理，而不是“有没有跑通”

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

- 收敛 Go / Python 单外部边界和 typed contract
- 继续补用户域迁移收口与配置治理
- 巩固 `chart / quote / terminal` 与 usage/admin 主线能力
- 提升 provider fidelity、后台治理和回归验证
