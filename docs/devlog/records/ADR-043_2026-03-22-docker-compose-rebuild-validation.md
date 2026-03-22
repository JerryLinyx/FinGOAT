---
id: ADR-043
kind: review
title: 2026-03-22 Docker Compose Rebuild Validation
date: 2026-03-22
status: active
supersedes: null
superseded_by: null
implements:
  - ADR-042
verified_by: []
---

# 2026-03-22 Docker Compose Rebuild Validation

## Background

`ADR-042` 将顶层四个 analyst 切成独立子进程并接入 Redis Streams + SSE 之后，需要确认主开发链路下的整套 `docker compose` 镜像可以重新构建，并且前端、Go backend、Python trading-service、market-data-service 仍能一起启动。

本次工作不新增产品能力，重点是做一轮部署级验证。

## Validation scope

验证范围覆盖：

- `docker compose up -d --build`
- `fingoat-frontend`
- `fingoat-backend`
- `fingoat-trading`
- `fingoat-marketdata`
- `fingoat-nginx`
- `fingoat-postgres`
- `fingoat-redis`

同时检查：

- backend 容器内 `/api/health`
- nginx 提供的前端静态资源
- 容器整体健康状态

## Verified result

验证结论：

- `fingoat-frontend` healthy
- `fingoat-backend` healthy
- `fingoat-trading` healthy
- `fingoat-marketdata` healthy
- `fingoat-nginx` healthy
- `fingoat-postgres` healthy
- `fingoat-redis` healthy

从容器内部确认：

- backend `/api/health` 返回 `{"status":"ok", ...}`
- nginx 已提供最新前端构建产物

这说明 `ADR-042` 引入的子进程 fan-out、Redis Streams 事件、前端混合视图改动没有破坏当前 `docker compose` 主开发链路。

## New issue discovered during validation

在 backend 重启日志中暴露了一个新的 feed 数据清洗问题：

- `feed_controller.go` 在 ingest 某些 RSS 条目时，插入 `feed_items` 触发 PostgreSQL `SQLSTATE 22021`
- 具体表现为 `invalid byte sequence for encoding "UTF8"`
- 问题出现在某些 excerpt/title 文本带有非法 UTF-8 字节序列时

影响：

- 当前不会阻塞 backend 启动
- 但会导致对应 feed item 丢失，说明 ingest 路径的文本规范化还不够稳

该问题已回写到 backlog，等待后续修复。

## Follow-up

- 修复 feed ingest 的 UTF-8 清洗与入库前规范化
- 在真实分析链路上继续验证 `ADR-042` 的 SSE / analyst live grid 行为

