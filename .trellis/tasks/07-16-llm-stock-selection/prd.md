# LLM Stock Selection

## Goal

Provide a user-scoped, auditable LLM stock-selection workflow that considers the
latest complete Shanghai/Shenzhen main-board universe with quantitative factors
and market-derived indicators, sends a bounded candidate set to a selected LLM,
and returns validated structured results for a dedicated Web experience.

The output is research material for approximately the next 20 trading days; it
is not an order or automated trading instruction.

## Background

- Existing `FACTOR_SELECTION` tasks already calculate user-scoped, immutable
  per-stock factor rank, composite score, percentile, and contribution data.
- Existing single-stock analysis already resolves a user's LLM model through
  the Engine LiteLLM boundary, but it uses only a lightweight price summary and
  has no dedicated Web result feature.
- The current market loader supports actively trading Shanghai `60*` and
  Shenzhen `00*` main-board stocks. It does not cover every A-share board.
- Technical-indicator functions exist, but there is no versioned per-stock
  market/indicator/factor snapshot contract for LLM selection.
- A user-scoped `watchlists` table and authenticated CRUD API already exist;
  the future watchlist-management Web module does not yet exist.

## Requirements

### R1. Run creation and immutable configuration

- Runs are manually initiated from a dedicated configuration modal.
- The modal exposes:
  - LLM model, preselected from the user's default but explicitly changeable;
  - quantitative candidate count, default `50`, allowed `20..100`;
  - final Top N, default `10`, allowed `1..20`;
  - lookback trading days, default `250`, allowed `120..500`.
- The modal displays the current factor mode/count, current watchlist count,
  main-board universe wording, and estimated LLM call volume.
- Creation freezes the current-user `llmModelId`, sorted factor IDs and hash,
  factor-selection mode, sorted watchlist symbols, configuration values, schema
  versions, indicator-profile version, and fixed 20-trading-day horizon.
- Missing, deleted, or foreign model IDs are rejected. With no available model,
  submission is blocked and the user is directed to model management.
- One user may have at most one active LLM stock-selection task; other users may
  run independently. A duplicate create returns the active task and never
  auto-cancels it.

### R2. Trading date, universe, and quantitative preparation

- `dataDate` is the latest complete trading date in the loaded market matrices,
  never the server's calendar date. Weekend/holiday runs use the latest trading
  day.
- The first-release universe is explicitly labeled Shanghai/Shenzhen main board
  and consists of actively trading `sh.60*` and `sz.00*` stocks supported by the
  current loader.
- The quantitative stage considers the full frozen universe using the same
  lookback value for market loading, factor calculation, indicators, and
  derived summaries.
- Every universe stock is recorded as eligible or excluded. Exclusions include
  symbol, processing stage, stable error code, sanitized readable reason, and
  timestamp.
- No LLM call occurs unless eligible coverage is at least 90% and eligible stock
  count is at least the configured quantitative candidate count. A failed gate
  gives an actionable data-update error.
- Small exclusions above the coverage threshold are warnings and do not alone
  make the task `PARTIAL_SUCCESS`.
- Quantitative ranking reuses the existing factor direction, z-score,
  percentile, quality-weight, contribution, and composite-score implementation.

### R3. Candidate construction and cost boundary

- Quantitative Top M is selected from eligible stocks.
- LLM candidates are the deterministic, symbol-deduplicated union of
  quantitative Top M and the task's frozen watchlist snapshot.
- Every eligible watchlist stock enters the LLM stage even when outside Top M.
  Watchlist membership does not add score or guarantee final selection.
- Ineligible watchlist stocks remain visible with their exclusion reason.
- The resolved candidate union has a hard maximum of 150. Exceeding it fails
  before any LLM call and instructs the user to reduce Top M or the watchlist.
- The run records actual candidate count and aggregated prompt/completion/total
  token usage. Monetary pricing and billing are not required.

### R4. Versioned candidate input

- The first release uses a versioned `market-technical/v1` profile and excludes
  financial-fundamental data.
- Each candidate snapshot includes trusted stock identity, data date, candidate
  source tags, quantitative rank/score, and actual factor values, direction,
  z-score, percentile, weight, and contribution.
- The LLM receives only the latest 20 trading rows of open/high/low/close,
  volume, amount, turnover, and percentage change, not the complete raw
  lookback history.
- Full-window derived fields include:
  - 1/5/20/60-day returns;
  - MA5/10/20/60 and MACD DIF/DEA/HIST;
  - RSI14, KDJ K/D/J, and ROC20;
  - ATR14, Bollinger position/bandwidth, 20-day volatility, and 60-day maximum
    drawdown;
  - 5/20-day volume ratio, amount change, and 5/20-day turnover summary.
- The snapshot records its input schema, indicator profile, lookback days, data
  date, and fixed 20-day horizon. Non-finite or missing values are normalized at
  this boundary; missing required inputs exclude the stock instead of producing
  fabricated data.

### R5. Structured LLM judgment and trusted ranking

- Each candidate is analyzed independently against one fixed scoring rubric.
  There is no additional full-candidate judge call.
- Provider transient retries remain solely inside the existing LiteLLM adapter;
  business orchestration must not add a competing Provider retry loop.
- Successful model output must validate as structured JSON containing:
  - integer `selectionScore` in `0..100`;
  - `confidence` in `0..1`;
  - `outlook: BULLISH | NEUTRAL | BEARISH`;
  - a bounded non-empty summary;
  - up to three strengths and up to three risks;
  - bounded key signals with category
    `PRICE | VOLUME | TECHNICAL | FACTOR`, name, and interpretation.
- Invalid JSON, enum, bounds, required fields, or signal structure fails that
  candidate. No fallback score or filled default judgment is allowed.
- The backend, not the model, owns stock identity, quantitative data, watchlist
  membership, candidate sources, selected flag, and final rank.
- Final ranking is deterministic: `selectionScore DESC`, quantitative rank ASC,
  then normalized symbol ASC. The first final Top N successful candidates are
  marked selected.

### R6. Persistence, status, cancellation, and retry

- Every frozen-universe stock is persisted, including non-candidates and data
  exclusions. Every LLM candidate preserves its bounded input snapshot and
  execution outcome.
- Every LLM attempt preserves attempt number, status, model/provider metadata,
  token usage, timestamps, and sanitized error code/message or validated output.
- Terminal status rules are:
  - every candidate succeeds -> `COMPLETED`;
  - some fail and successful candidates are at least final Top N ->
    `PARTIAL_SUCCESS`;
  - successful candidates are fewer than final Top N, or preparation fails ->
    `FAILED`;
  - cancellation completes -> `CANCELLED` with no authoritative final Top N.
- Cancellation is cooperative through `CANCELLING`: stop dispatching new calls,
  allow already-issued calls to settle, and preserve completed, failed, and
  not-run candidate states.
- Failed candidates support single or batch retry. Retry reuses the original
  frozen input snapshot, model ID, data date, and configuration; appends attempt
  history; and recomputes ranking.
- Retry is rejected with actionable guidance if the frozen model no longer
  exists. Historical stored results remain readable.

### R7. API and Web experience

- Add a user-scoped API for create, paginated history, task detail, filtered
  selected/all/failed results, per-stock evidence/attempt detail, cancel, and
  failed-item retry.
- Shared decoders/types own JSONB normalization. Web/API consumers must not cast
  raw event or snapshot fields independently.
- Add a dedicated `LLM Stock Selection` Web page rather than mixing results into
  factor-selection history.
- Each history row shows data date, model, Top M, final Top N, candidate count,
  coverage, status, failure count, and token usage.
- Result exploration separates final selections, all candidates, and failures.
  A stock drawer shows model judgment, recent bars, indicators, factor evidence,
  source tags, errors, usage, and attempt history.
- Failed create keeps the modal open with values preserved. Polling is serial,
  ignores stale responses, stops at terminal status, and exposes request errors.
- Cancel/retry actions use visible loading, duplicate-action prevention,
  actionable errors, and accessible labels.

### R8. Isolation, safety, and compatibility

- Every task, factor, model, watchlist, result, attempt, cancel, and retry query
  is scoped by `userId`. Global market data remains shared.
- Queue payloads contain IDs and frozen non-secret configuration only. Secrets
  remain inside the Engine model-loader/LiteLLM boundary.
- Logs and stored failures are sanitized and never include credentials,
  Authorization values, or raw sensitive Provider bodies.
- Existing factor selection and single-stock analysis public contracts remain
  compatible. Automated tests use fake/mocked LLMs and never call a paid model.

## Acceptance Criteria

- [ ] AC1: The creation modal validates and freezes the selected model, Top M,
      final Top N, lookback, factors, watchlist, versions, and horizon, preserving
      values on failure.
- [ ] AC2: Concurrent create requests for one user produce one active task;
      another user's task is not blocked.
- [ ] AC3: Weekend/holiday execution uses the latest complete trading date and
      the UI labels the universe as Shanghai/Shenzhen main board.
- [ ] AC4: Every universe stock is eligible or excluded with a recorded reason;
      coverage below 90% or eligible count below Top M causes zero LLM calls.
- [ ] AC5: Candidate construction is exactly quantitative Top M union frozen
      watchlist, deduplicated; ineligible watchlist stocks remain visible; 151
      candidates fail before LLM while 150 are allowed.
- [ ] AC6: Candidate snapshots contain at most 20 raw trading rows, the agreed
      versioned market/technical indicators, and actual persisted factor
      exposure fields from the same data date/lookback.
- [ ] AC7: Model output outside the strict judgment contract fails the candidate
      without defaults; trusted fields cannot be overwritten by model content.
- [ ] AC8: Successful candidates rank by LLM score, quantitative rank, then
      symbol; watchlist membership gives no bonus and final Top N is backend-owned.
- [ ] AC9: All universe outcomes and all candidate attempts are user-scoped and
      queryable with stable status/error/usage metadata.
- [ ] AC10: The completed/partial/failed/cancelled matrix follows R6, and a
      cancelled run never exposes a complete-looking final Top N.
- [ ] AC11: Single and batch retry reuse the frozen input, preserve attempt
      history, handle deleted models explicitly, and recompute ranking.
- [ ] AC12: The dedicated page renders history, selected/all/failed views, and a
      full evidence drawer; polling, cancel, retry, and errors behave reliably.
- [ ] AC13: User isolation tests prevent cross-user model, factor, watchlist,
      result, attempt, cancel, or retry access.
- [ ] AC14: Database, API, Engine, Web, build, lint, and cross-layer regression
      gates pass without a real Provider request.

## Out of Scope

- Web watchlist-management UI; this feature consumes the existing watchlist
  table/API so the later module can integrate without redesign.
- Financial-fundamental data such as PE, PB, ROE, revenue, profit, balance-sheet
  data, analyst estimates, or related ingestion.
- ChiNext, STAR Market, Beijing Stock Exchange, or other unsupported boards.
- Historical-date selection, scheduled automatic selection, and live intraday
  analysis.
- Full raw-lookback prompts, a second global LLM judge call, streaming model
  output, monetary billing, automatic orders, positions, or execution.
