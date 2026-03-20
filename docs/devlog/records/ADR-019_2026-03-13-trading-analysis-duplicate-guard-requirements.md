---
id: ADR-019
kind: requirement
title: v0.2.0 Trading Analysis Duplicate Guard Requirements
date: 2026-03-13
status: superseded
supersedes: null
superseded_by: ADR-024
implements: []
verified_by: []
---

# v0.2.0 Trading Analysis Duplicate Guard Requirements

## Status Note

本文件是早期需求稿，不再代表当前主线现状。

当前状态请同时参照：

- `current/overview.md`
- `ADR-033`

## 1. 背景

Dashboard 的 TradingAgents 分析入口目前可直接发起任务，缺少“重复分析防护”。
当用户对同一股票代码、同一分析日期反复提交时，会产生不必要的重复执行成本。

## 2. 新增需求（本次追加）

在 Dashboard 的 TradingAgents 发起分析流程增加判重确认：

1. 若“同用户 + 同股票代码 + 同分析日期”已有历史分析记录，则在提交前弹窗二次确认。
2. 用户确认后才继续发起新任务；取消则终止本次提交。
3. 目标是减少无意重复跑分析，而非强制禁止重复分析。

## 3. 已确认事实

- 系统已提供历史分析查询能力（如 recent analyses / task query）。
- 当前流程未对“同代码+同日期”做提交前交互确认。
- `推断`：仅前端判重不足以覆盖并发场景，后端应提供可复用的判重查询语义。

## 4. 方案对比（摘要）

### 方案 A：仅前端基于已加载历史做判重提醒

- 优点：改动小、上线快
- 缺点：依赖前端数据完整性，可能漏判

### 方案 B：前端弹窗 + 后端判重查询（推荐）

- 优点：判重口径统一、行为更可控
- 缺点：需要补充后端查询契约

## 5. 决策

采用方案 B：  
提交前使用后端语义判重，命中时由前端弹窗确认后再执行。

## 6. 当前状态

- 状态：历史需求稿；前端重复运行确认已落地，系统级 dedupe 策略仍待增强
- 关联 backlog：`current/task-backlog.md` 中保留对应后续条目
