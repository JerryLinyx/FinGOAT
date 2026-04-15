---
title: Service Boundaries
last_verified: 2026-03-27
verified_against: v0.2.0-dev
---

# Service Boundaries

Current planning state: `v0.2.0` in progress, baseline archived at `v0.1.4`

## Frontend

- Owns presentation and user interaction
- Owns local UX state such as recent charts, local theme, and OpenClaw local chat session selection
- Does not own business truth

## Go backend

- Should be the single business API boundary
- Should own persistence-facing workflow and stable API contracts
- Owns auth/profile/BYOK/usage/admin-facing product APIs
- Owns market-data API composition for chart/quote/terminal
- Owns analysis export endpoints and SSE aggregation for the web app

## Python trading service

- Should act as an execution service/worker
- Owns queue consumption, runtime checkpointing, and usage-event emission/ingestion helpers
- Owns only internal result lookup and SSE/runtime endpoints for Go integration
- Must not expose parallel product-level analysis APIs or market-data APIs

## Market-data service

- Owns the only chart / quote / terminal API implementation
- Owns market vendor adaptation, cache, and degradation behavior
- Should remain independently deployable from the trading execution runtime

## TradingAgents

- Owns reasoning workflow and vendor-backed analytical capability
- Owns model/provider routing and OpenClaw analyst adaptation
- Owns the single agent-engine code path
- CLI 已退役，实时 agent 状态追踪由前端 `SSE + stages[] + AnalystLiveGrid + AgentDashboard` 覆盖
