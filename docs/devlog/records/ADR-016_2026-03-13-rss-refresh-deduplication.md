---
id: ADR-016
kind: decision
title: RSS Refresh Deduplication
date: 2026-03-13
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

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

## Additional follow-up: smart feed refresh and article feed UI repair

After the article module was moved into the dedicated `Feed` page, two separate problems showed up:

- `Refresh Feed` semantics were still split across:
  - a force-ingest endpoint
  - a normal article-read endpoint
- the feed UI rendered blank cards with fallback values such as:
  - `SYSTEM`
  - `INVALID DATE`
  - repeated `BEAR`

This exposed that the original article flow still mixed together:

- external RSS ingestion
- database-backed reads
- frontend refresh behavior
- UI-only fallback rendering

### Final decision

Keep the article feed DB-first.

- normal feed reads come from the database
- `refresh=true` becomes a *smart refresh*:
  - check the most recent successful ingest run
  - only pull RSS again when the last successful sync is older than a threshold
  - otherwise return DB-backed articles immediately
- manual force-ingest remains a separate management action

### Implementation design

- `backend/models/feed_ingest_run.go`
  - added `FeedIngestRun` to persist ingest attempts with:
    - `trigger`
    - `status`
    - `started_at`
    - `finished_at`
    - `new_count`
    - `warning_count`
    - `error`
- `backend/config/migrate.go`
  - added `FeedIngestRun` to database migrations
- `backend/controllers/article_controller.go`
  - extracted DB-backed article loading into `loadArticles(...)`
  - added `getLastSuccessfulIngestAt(...)`
  - added `shouldRunSmartRefresh(...)`
  - added `runArticleIngest(...)` as the shared RSS ingest path
  - changed `GET /api/articles?refresh=true` to:
    - trigger ingest only when the last successful sync is stale
    - otherwise return DB-backed results directly
  - preserved `GET /api/articles/refresh` as a force-sync style endpoint
  - added light result shuffling only on the no-sync refresh path so refreshes do not look frozen without becoming fully random
- `frontend/src/components/FeedPage.tsx`
  - changed feed refresh back to the unified smart-refresh route:
    - `GET /api/articles?refresh=true`
  - fixed auth header handling so the page no longer sent:
    - `Authorization: Bearer Bearer <token>`
  - added response normalization to map backend article fields such as:
    - `Title`
    - `Source`
    - `PublishedAt`
    - `CreatedAt`
    into the camelCase fields expected by the React UI
  - removed the fake sentiment fallback chip because there is no real article sentiment pipeline behind the feed cards

### Testing and validation

Validated locally with:

```bash
cd /Users/linyuxuan/workSpace/FinGOAT/backend && go test ./...
cd /Users/linyuxuan/workSpace/FinGOAT/frontend && npm run build
```

Confirmed after restart:

- the new `feed_ingest_runs` table exists in PostgreSQL
- feed requests no longer bounce users back to login because of doubled `Bearer` prefixes
- article cards can render real title/source/date values instead of blank placeholders

### Outcome

Status: implemented.

Current article/feed behavior is now:

- database-first for all normal reads
- conditionally ingest on refresh when the cache is stale
- auditable via ingest-run records
- no misleading article sentiment labels in the feed UI
