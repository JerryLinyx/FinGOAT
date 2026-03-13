# Service Boundaries

## Frontend

- Owns presentation and user interaction
- Does not own business truth

## Go backend

- Should be the single business API boundary
- Should own persistence-facing workflow and stable API contracts

## Python trading service

- Should act as an execution service/worker
- Should not remain the long-term owner of business task truth

## TradingAgents

- Owns reasoning workflow and vendor-backed analytical capability
- Should not directly absorb unrelated product/API concerns

