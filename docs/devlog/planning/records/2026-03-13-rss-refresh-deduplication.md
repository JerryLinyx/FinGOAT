# RSS Refresh Deduplication

## Background

The RSS refresh endpoint already attempted basic deduplication, but it only pulled the single latest item from each feed and matched duplicates using raw `link` or `guid`.

## Problem and impact

- duplicate article inserts could still happen when feeds used tracking query parameters or inconsistent GUIDs
- refreshing could miss multiple unseen articles because only one item per feed was considered
- clearing the article table and refreshing would not backfill a recent batch from each source

## Final decision

Make RSS refresh provider-side deduplication stronger and process a recent batch of items per feed instead of a single latest item.

## Implementation design

- `backend/controllers/article_controller.go`
  - added `normalizeArticleLink(...)` to strip tracking parameters and fragments from feed item URLs
  - added `matchesArticleFingerprint(...)` and strengthened duplicate matching through:
    - normalized link
    - GUID
    - source + title + published timestamp
  - changed feed fetch logic from `fetchLatestFeedItem(...)` to `fetchFeedItems(...)`
  - refresh now processes up to 10 recent items per feed, inserting only unseen items
- `backend/controllers/article_controller_test.go`
  - added coverage for link normalization
  - added coverage for duplicate fingerprint matching

## Testing and validation

Validated locally with:

```bash
cd /Users/linyuxuan/workSpace/FinGOAT/backend && go test ./...
```

## Outcome and follow-up

Status: implemented.

## Additional follow-up: chart endpoint compatibility

Later in the same implementation cycle, the stock chart endpoint exposed a separate Alpha Vantage issue:

- `TIME_SERIES_DAILY_ADJUSTED` returned a premium-plan error for the current API key
- this made chart loading fail even after the Go backend was restarted with `ALPHA_VANTAGE_API_KEY`

The chart route was updated to use free-tier-compatible endpoints by range:

- `3m` and `6m` -> `TIME_SERIES_DAILY` with `outputsize=compact`
- `1y` -> `TIME_SERIES_WEEKLY_ADJUSTED`
- `5y` -> `TIME_SERIES_MONTHLY_ADJUSTED`

Implementation details:

- `backend/controllers/chart.go`
  - added `resolveChartEndpoint(range)` to select the free-tier-compatible Alpha Vantage function
  - updated parsing so daily uses `5. volume` and adjusted weekly/monthly use `6. volume`
- `backend/controllers/chart_test.go`
  - added tests for endpoint selection by range

Validation:

```bash
cd /Users/linyuxuan/workSpace/FinGOAT/backend && go test ./...
```

Live validation after restarting the Go backend with `ALPHA_VANTAGE_API_KEY` in its environment:

- `GET /api/trading/chart/AAPL?range=3m` returned daily chart data
- `GET /api/trading/chart/AAPL?range=1y` returned weekly adjusted chart data

Result:

- chart failures are no longer caused by the free tier hitting a premium-only Alpha Vantage endpoint

## Additional follow-up: chart control redesign

The first chart revision still had a UX mismatch:

- the selectable buttons still mixed up:
  - lookback window
  - bar sampling interval
- users correctly pointed out that the button row should communicate how many days each datapoint represents, not just how much history is shown

The chart controls were reinterpreted so the button row now represents bar interval:

- `1D`
- `1W`
- `1M`

The displayed history window is now communicated separately in the chart meta:

- `1D` -> `3M window`
- `1W` -> `1Y window`
- `1M` -> `5Y window`

Implementation details:

- `frontend/src/components/ChartPage.tsx`
  - replaced the window-based button row with interval buttons: `1D / 1W / 1M`
  - mapped each button to an existing supported backend window:
    - `1D` -> `3m`
    - `1W` -> `1y`
    - `1M` -> `5y`
  - changed the default view to `1D`
  - updated chart meta to display both:
    - sampling granularity
    - effective lookback window
  - example:
    - `65 daily bars · 3M window`

Validation:

```bash
cd /Users/linyuxuan/workSpace/FinGOAT/frontend && npm run build
```

Result:

- the button row now matches the user mental model of "how long does one datapoint represent"
- the lookback window remains visible without overloading the button labels

Current scope:

- this change covers article ingestion deduplication and recent-item backfill
- broader vendor-level caching and deduplication for trading/dataflow calls remains a separate backlog item
