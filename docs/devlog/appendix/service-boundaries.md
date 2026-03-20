---
title: Service Boundaries
last_verified: 2026-03-19
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

## Python trading service

- Should act as an execution service/worker
- Owns queue consumption, runtime checkpointing, and usage-event emission/ingestion helpers
- Should not remain the long-term owner of business task truth
- Should not be kept as a parallel external task API boundary in production

## TradingAgents

- Owns reasoning workflow and vendor-backed analytical capability
- Owns model/provider routing and OpenClaw analyst adaptation
- Should not directly absorb unrelated product/API concerns
