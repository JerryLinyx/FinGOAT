# 2026-03-18 Feed Board Review And Fixes

## Scope

Reviewed the newly updated feed board implementation across:

- backend feed board query and pagination
- board cache behavior after preference and user-action mutations
- frontend session-expiry handling for feed routes

This record captures the concrete problems found during review and the fixes applied in the same pass.

## Findings

### 1. Board pagination could permanently skip items after score reranking

Affected code:

- `backend/controllers/feed_controller.go`

Original behavior:

- candidate items were fetched in recency order
- the candidate batch was reranked by score
- `next_cursor` used the last reranked item's `id`
- the next page then filtered by `feed_items.id < cursor`

Impact:

- feed cards that were in the original candidate window but did not make the first scored page could be skipped forever
- this was most visible on `for-you` and `following`, where reranking is strongest

Fix applied:

- switched feed board pagination to an offset cursor over the scored in-memory result set
- removed the old `id < cursor` query behavior
- `next_cursor` now advances by the number of scored items already returned

Status:

- fixed in `backend/controllers/feed_controller.go`

### 2. Feed board cache was not invalidated after preference or like/save mutations

Affected code:

- `backend/controllers/feed_controller.go`

Original behavior:

- `GET /api/feed` cached board responses in Redis under `feed:board:*`
- `PUT /api/feed/preferences`
- `POST /api/feed/items/:id/like`
- `POST /api/feed/items/:id/save`

did not clear that cache

Impact:

- refreshed boards could stay stale for the full TTL after a user changed preferences
- saved/following/engagement-sensitive tabs could show old state after toggles

Fix applied:

- added `invalidateFeedBoardCache(...)`
- called it after successful preference writes
- called it after successful like/save toggle commits

Status:

- fixed in `backend/controllers/feed_controller.go`

### 3. Feed page did not trigger session-expiry flow on unauthorized responses

Affected code:

- `frontend/src/services/feedService.ts`
- `frontend/src/components/FeedPage.tsx`

Original behavior:

- feed requests on `401` threw backend error text such as `unauthorized`
- `FeedPage` only called `onSessionExpired(...)` when the error message contained `401`

Impact:

- expired sessions on the Feed page behaved differently from the rest of the app
- users stayed on the page with an inline error instead of being routed through the normal auth-expiry flow

Fix applied:

- `feedService` now attaches `status` to thrown errors
- `FeedPage` now treats both:
  - `status === 401`
  - `unauthorized`

as session-expiry signals

Status:

- fixed in `frontend/src/services/feedService.ts`
- fixed in `frontend/src/components/FeedPage.tsx`

## Validation

Validated locally with:

```bash
cd /Users/linyuxuan/workSpace/FinGOAT/backend && go test ./...
cd /Users/linyuxuan/workSpace/FinGOAT/frontend && npm run build
```

## Outcome

Status: implemented.

Feed board behavior is now more stable in three important ways:

- pagination no longer drops reranked items between pages
- Redis board cache no longer survives preference or engagement mutations
- Feed now follows the app-wide unauthorized/session-expiry behavior
