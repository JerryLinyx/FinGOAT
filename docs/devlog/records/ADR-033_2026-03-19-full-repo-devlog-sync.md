---
id: ADR-033
kind: review
title: 2026-03-19 Full Repo Devlog Sync
date: 2026-03-19
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# 2026-03-19 Full Repo Devlog Sync

## 背景

在主线代码持续推进后，`docs/devlog` 内部出现了两类偏差：

- 某些能力已经落地，但 overview / appendix / debt 仍写成“未实现”
- 记录文件覆盖了局部主题，但缺少一份把当前仓库职责索引和当前规划状态统一起来的审计型同步记录

本次工作目标不是新增功能，而是把 devlog 重新对齐到当前仓库实现状态。

## 审计范围

本次同步面向以下仓库区域：

- `frontend/src`
- `backend`
- `langchain-v1`
- `TradingAgents/tradingagents`
- `openclaw-gateway`
- `docs/devlog`

同时补充了仓库级文件职责索引，作为 module map 的细粒度补充。

## 对照后确认已落地主线、但原 devlog 记录不足的能力

### 用户域 / BYOK

代码已具备：

- email-first 兼容登录与注册
- `User` 扩展字段：`email/email_verified/display_name/avatar_url/role`
- Profile 页面与对应 Go API
- user-scoped API key 加密存储、脱敏列表展示、删除/更新
- email verification / resend verification

这部分已不应继续被描述为“仍是 username + password 的最小模型”。

### Usage / Admin

代码已具备：

- usage event 采集
- Redis 暂存 + PostgreSQL 汇总落库
- 用户 usage summary 接口与前端页面
- admin usage summary / user usage 接口

这部分此前在 overview / appendix 中未被完整纳入主线能力。

### 市场数据统一壳层

代码已具备：

- `chart`
- `quote`
- `terminal`
- 前端 Chart / Terminal 统一市场模式壳层

这意味着 Chart 已经不是单一图表实验页，而是 market-data 产品面的组成部分。

### 前端产品壳层扩展

前端当前已不仅包含 dashboard / feed / trading：

- Profile
- Usage
- Chart / Terminal
- OpenClaw 本地聊天页
- Ollama model discovery

因此 module map 与 overview 需要体现“页面域已经扩展，后续重点是结构拆分和状态治理”。

## 本次更新内容

### 1. 规划层更新

更新以下文档，使问题判断与当前实现一致：

- `current/overview.md`
- `current/problems-and-debts.md`

核心修正包括：

- 把“用户域未实现”改成“用户域已上线但仍在迁移/治理期”
- 把 Trading 重复运行从“完全缺失”改成“前端确认已落地，系统级策略仍可增强”
- 把 Chart 历史查询从“缺失”改成“本地历史已落地，跨端同步仍缺”

### 2. 记录层补档

新增并补充以下记录：

- `ADR-038`
- `ADR-034`
- `ADR-036`

### 3. 附录层统一

更新 appendix，使其与当前代码职责一致：

- `appendix/module-map.md`
- `appendix/interfaces.md`
- `appendix/data-models.md`
- `appendix/system-architecture.md`
- `appendix/service-boundaries.md`
- `appendix/analysis-report-schema.md`
- `appendix/README.md`

### 4. 新增仓库级职责索引

新增：

- `appendix/repo-file-index.md`

用途：

- 对当前 tracked file 的职责做集中说明
- 为“看清当前每个模块分别负责什么”提供稳定入口
- 避免未来只能靠零散 record 追踪现状

## 当前结论

从代码与 devlog 对照来看，当前主线不应再按 `v0.1.1` 或“仅最小 PoC”来描述。

更准确的表达是：

- `v0.1.2` 已冻结为基线归档
- 当前仓库处于 `v0.2.0` 进行中
- 若对外标识版本，应更接近 `v0.2.0-dev` / `v0.2.0-beta`

## 仍待继续补充的方向

- 更强的 Go/Python 契约强类型化
- feed 定时 ingest / scheduler
- 用户域的 legacy username 收口策略
- 多通道身份（手机号 / 微信）是否进入主线的产品决策
- BYOK 审计 / key validation / provider 覆盖增强
- Trading 去重从前端确认升级为系统级策略
