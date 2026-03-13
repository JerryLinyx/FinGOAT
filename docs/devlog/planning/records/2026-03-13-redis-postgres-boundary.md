# Redis PostgreSQL Boundary

## Background

Redis is currently present in the system but mostly used for article caching and like counters. PostgreSQL already stores core business entities.

## Problem and impact

Redis is underused, while PostgreSQL is not yet the sole truth for analysis state. The boundary between the two systems is not explicit.

## Current state analysis

Confirmed:

- PostgreSQL stores users, articles, analysis tasks, and decisions.
- Redis stores article cache and like counters.
- Runtime execution state for analysis tasks is not handled by either in a durable, coordinated way.

## Options considered

### Option A

Use PostgreSQL only and keep Redis minimal.

### Option B

Use Redis only for task state and task results.

### Option C

Use PostgreSQL for persistent records and Redis for runtime coordination and caching.

## Tradeoff comparison

### Option A

- Pros: fewer systems in the critical path
- Cons: weaker fit for transient task state and coordination

### Option B

- Pros: fast state updates
- Cons: poor fit for auditability, historical queries, and user-linked business records

### Option C

- Pros: matches system needs well
- Cons: requires explicit lifecycle rules

## Final decision

Adopt PostgreSQL for durable business records and Redis for runtime coordination, locks, queues, and short-lived cache/state.

## Planned Redis responsibilities

- task queue
- task runtime status
- short-lived progress metadata
- deduplication/locking for expensive fetches
- selected hot-result cache

## Planned PostgreSQL responsibilities

- users
- articles
- analysis tasks
- decisions
- final reports and historical lookup

## Testing and validation

Planned:

- persistence durability test
- runtime failover test
- queue consumption integrity test

## Outcome and follow-up

Status: planned, not yet implemented.

