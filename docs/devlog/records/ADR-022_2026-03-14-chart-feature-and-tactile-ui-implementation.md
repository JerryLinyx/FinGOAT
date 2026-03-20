---
id: ADR-022
kind: decision
title: Chart Feature and Tactile UI Implementation
date: 2026-03-14
status: active
supersedes: ADR-004
superseded_by: null
implements: [ADR-004]
verified_by: []
---

# Chart Feature and Tactile UI Implementation

## 1. Background

User requested a K-line chart feature, tactile UI feedback for buttons, and a specialized animation for the analysis trigger.

## 2. Changes

### 2.1 K-line Chart (Full implementation)

- **Backend Proxy**: Added `GET /api/trading/chart/:ticker` in Go backend.
  - Proxies Alpha Vantage `TIME_SERIES_DAILY_ADJUSTED`.
  - Handles daily, weekly, and monthly data aggregation via proxy logic or Alpha Vantage intervals.
  - Securely uses `ALPHA_VANTAGE_API_KEY` from server environment.
- **New Chart Page**: Created a dedicated "Chart" tab in the main navigation.
  - Zero-dependency rendering using TradingView's `lightweight-charts`.
  - Support for OHLC candlesticks and Volume histogram.
  - Interactive range/interval selector (1D, 1W, 1M).
- **Query History**: 
  - Implemented `localStorage`-backed history (up to 8 deduplicated symbols).
  - Clickable chips for instant re-querying.
  - "Clear history" functionality.

### 2.2 Tactile UI Enhancements

- **Calm Tactile Design**: 
  - Replaced high-contrast blue shadows with soft, recessed borders and warm neutrals.
  - Added `:active` scaling effects to all primary buttons (`Analyze Stock`, `Like`) to provide haptic-like visual feedback.
  - Heart icon jelly-bounce animation on like button hover.
- **Rocket Lift-off Animation**:
  - Implemented a CSS transform-based animation for the rocket emoji.
  - On "Analyze Stock" click, the rocket "flies" towards the top-right before the loading state takes over.

## 3. Implementation Details

- **Frontend**: `lightweight-charts` npm package added to `frontend/`.
- **Backend**: `controllers/chart.go` handles Alpha Vantage JSON parsing and range filtering.
- **State**: `App.tsx` navigation state upgraded to support `activeTab`.

## 4. Status

- [x] Backend Proxy Endpoint
- [x] Chart Page Component
- [x] Tactile Button Styles
- [x] Rocket Emoji Animation
- [x] Query History & LocalPersistence
