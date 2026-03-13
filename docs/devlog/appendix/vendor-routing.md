# Vendor Routing

## Purpose

TradingAgents uses a routing layer to map logical data tools to concrete vendors.

## Tool categories

- core stock APIs
- technical indicators
- fundamental data
- news data

## Current vendors observed

- `yfinance`
- `alpha_vantage`
- `openai`
- `google`
- `local`

## Design value

This routing layer is one of the stronger abstractions in the current codebase because it reduces future vendor lock-in and supports fallback behavior.

