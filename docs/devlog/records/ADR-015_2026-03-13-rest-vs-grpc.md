---
id: ADR-015
kind: decision
title: REST Vs gRPC
date: 2026-03-13
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# REST Vs gRPC

## Background

The current Go/Python boundary uses REST and JSON. There was a question about whether this should move to gRPC.

## Problem and impact

The current pain points are weak contracts and unstable task ownership, not raw request latency.

## Current state analysis

- Go submits analysis requests to Python over HTTP.
- The workflow is asynchronous and often dominated by LLM and external data latency.
- The frontend already relies on polling semantics rather than streaming.

## Options considered

### Option A

Keep REST and tighten schemas.

### Option B

Migrate Go/Python communication to gRPC now.

## Tradeoff comparison

### Option A

- Pros: minimal migration cost, fits current async workflow, solves the actual short-term problem if schemas are tightened
- Cons: leaves protocol-level typing weaker than gRPC

### Option B

- Pros: stronger generated contracts, good future support for streaming
- Cons: higher migration cost, does not directly solve the task-state ownership problem

## Final decision

Keep REST for v0.2 and fix the contract and state model first.

## Implementation design

- Define typed request/response schemas.
- Remove weak map parsing in Go.
- Standardize error payloads and task-state transitions.

## Testing and validation

Planned:

- contract compatibility tests between Go and Python
- error-shape validation tests
- backward-compatibility check for frontend polling

## Outcome and follow-up

Status: planned, not yet implemented.

gRPC remains a future option if internal service count grows or if staged streaming becomes a strict requirement.

