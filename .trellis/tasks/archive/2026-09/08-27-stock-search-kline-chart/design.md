# 股票搜索与 K 线图技术设计

## 1. Architecture

The feature is a read-only path across the existing API gateway, Redis cache, and
React application:

```text
React /market
  -> API /api/market-data/search
  -> Redis stock_list_cache + stock_names

React selected symbol
  -> API /api/market-data/:symbol/kline
  -> Redis kline:{code} (legacy date-range fallback during migration)
  -> normalized chart payload
  -> lightweight-charts v5 candlestick + volume panes
```

The API reads Redis directly, matching the existing stock-name and task-progress
paths. The page does not call Engine or start a Baostock request. Data collection
remains the only write path.

## 2. API boundary

Add an authenticated `market-data` Elysia module:

- `GET /api/market-data/search?q=<text>` returns at most 20 main-board matches:
  `{ code, name }[]`.
- `GET /api/market-data/:symbol/kline` returns a normalized payload:
  `{ symbol, name, bars, volume, latest, range }`.
- The service validates symbols against the current `stock_list_cache`; arbitrary
  user input is never interpolated into a provider request.
- Search normalizes case and accepts `600000`, `sh.600000`, or a Chinese name.
- K-line values are parsed to finite numbers, dates are constrained to the cached
  requested history, duplicate dates keep the last valid row, and output dates
  are strictly ascending.
- The service reads `kline:{code}` first. If absent, it scans only the matching
  legacy `kline:{code}:*` keys and selects the one with the newest encoded end
  date. It never uses an unrelated symbol's cache.
- Missing stock list, missing cache, invalid symbol, and malformed cache have
  separate sanitized API errors/statuses; Redis connections close in `finally`.

## 3. Web boundary

- Add a lazy-loaded `/market` route and an `行情图表 / MARKET VIEW` navigation item.
- `useMarketData` owns search text, debounced search requests, selected symbol,
  chart loading/error/empty states, and a monotonically increasing request
  generation so stale responses cannot replace the current symbol.
- Use Ant Design 6 `AutoComplete` with accessible placeholder, clear action, and
  selectable options showing both code and name. Selecting an option loads the
  chart; pressing Enter can select an exact code/name match.
- `StockKlineChart` is a focused client component. It creates one chart in an
  effect, adds `CandlestickSeries` in pane 0 and `HistogramSeries` in pane 1,
  calls `setData` only when the selected dataset changes, fits the content, and
  removes the chart in cleanup.
- Use business-day string times (`YYYY-MM-DD`) in ascending order. Volume bars
  receive per-point colors based on close versus open. Do not use millisecond
  timestamps or v4 `addCandlestickSeries` APIs.
- The page displays the selected symbol/name, latest close, daily change, and
  cached date range beside the chart. Empty/error states explain the next action.

## 4. Compatibility and rollout

- Add `lightweight-charts` as a direct Web dependency and verify the installed
  version and local typings before implementation.
- Existing API routes, data-collection task status, and aggregate cache contracts
  remain unchanged.
- Existing legacy per-symbol caches remain readable during their TTL. New data
  collection writes use the stable key introduced by the preceding task.
- No database migration is required.

## 5. Risks and trade-offs

- A Redis SCAN fallback adds a small read cost only for symbols without a stable
  key; it avoids forcing users to run a collection immediately after deployment.
- Returning normalized bars from the API keeps provider/cache field positions out
  of React and makes chart input deterministic, at the cost of a small server-side
  transform per request.
- The page deliberately does not show intraday or live streaming data; the source
  cache is daily and the feature is a historical inspection view.
