# LLM Stock Selection Design

## 1. Architecture and Task Boundary

Keep this as one Trellis implementation task. The database contract, Engine
snapshot builder, queue runner, API projections, and Web result UI depend on the
same task/result schema; splitting them would leave non-runnable intermediate
states. Implementation is still divided into independently validated stages.

```text
Web configuration modal
  -> Elysia create service
     -> validate current-user model
     -> snapshot factor IDs/hash + watchlist symbols + run settings
     -> insert LLM_STOCK_SELECTION alpha_task
     -> RPUSH queue payload
  -> Python worker
     -> load latest complete main-board market snapshot
     -> calculate full-universe factor exposure + indicator eligibility
     -> enforce 90% coverage and Top M availability
     -> candidate union = quantitative Top M U frozen watchlist
     -> persist bounded per-candidate input snapshots
     -> bounded parallel LiteLLM calls with cooperative cancellation
     -> validate judgment/v1 JSON and persist attempt history
     -> rank successful candidates and set terminal status
  -> Elysia list/detail/result/retry projections
  -> dedicated Web history, result tabs, and stock evidence drawer
```

`alpha_tasks` remains the task lifecycle source. New normalized tables own
per-stock outcomes and attempt history instead of putting thousands of rows or
large snapshots into `alpha_tasks.result`.

## 2. Task Contract

Task type: `LLM_STOCK_SELECTION`.

Active statuses: `PENDING | RUNNING | CANCELLING`.

Terminal statuses: `COMPLETED | PARTIAL_SUCCESS | FAILED | CANCELLED`.

Frozen task parameters:

- `llmModelId`
- `candidateCount` (`20..100`, default `50`)
- `finalTopN` (`1..20`, default `10`)
- `lookbackDays` (`120..500`, default `250`)
- `factorIds` sorted and deduplicated
- `factorSetHash`
- `selectionMode: AUTO | MANUAL`
- `watchlistSymbols` sorted and deduplicated
- `universeType: MAIN_BOARD`
- `indicatorProfileVersion: market-technical/v1`
- `inputSchemaVersion: llm-stock-selection-input/v1`
- `outputSchemaVersion: llm-stock-selection-judgment/v1`
- `horizonTradingDays: 20`
- `maxCandidates: 150`

`dataDate` is resolved by the Engine from the loaded matrices and persisted in
the task result and stock rows. It is never derived from the server calendar.

Create-time concurrency is enforced by a PostgreSQL partial unique index on
`alpha_tasks(userId)` for type `LLM_STOCK_SELECTION` in active statuses. API
pre-checks improve the error message; the index is the race authority.

## 3. Persistence

### `llm_stock_selection_results`

One row per frozen-universe stock, including stocks that never reach the LLM:

- identity: `id`, `taskId`, `userId`, `symbol`, `stockName`, `dataDate`
- universe disposition: `ELIGIBLE | EXCLUDED`
- exclusion: `stage`, stable `code`, sanitized `message`, timestamp
- quantitative projection: nullable `quantitativeScore`, `quantitativeRank`
- candidate metadata: `candidateSources` (`QUANTITATIVE`, `WATCHLIST`),
  `isLlmCandidate`
- bounded JSONB `inputSnapshot` only for LLM candidates
- LLM projection: `NOT_REQUESTED | PENDING | SUCCEEDED | FAILED | CANCELLED`,
  validated judgment JSONB, attempt count, latest error, usage totals
- trusted selection projection: `selected`, nullable `finalRank`
- timestamps

Constraints/indexes:

- unique `(taskId, symbol)`
- indexes on `(taskId, selected, finalRank)`, `(taskId, llmStatus)`, and
  `(userId, dataDate)`
- task and user foreign keys cascade

The all-universe rows provide explicit accounting and exclusion reasons. Only
at most 150 rows carry the larger candidate input snapshot.

### `llm_stock_selection_attempts`

One immutable row per candidate attempt:

- `resultId`, `taskId`, `attemptNo`
- status and start/completion timestamps
- model/provider/model-name snapshot
- sanitized error code/message
- validated response JSONB when successful
- prompt/completion/total token usage

Unique `(resultId, attemptNo)` preserves retry history. Raw credentials and
Authorization data are never persisted. Raw Provider bodies are not exposed to
Web; sanitized response text may be logged only under existing LLM rules.

`alpha_tasks.result` stores a compact run summary: `dataDate`, universe/eligible/
excluded/candidate/succeeded/failed/not-run counts, coverage rate, final Top N,
token totals, model display snapshot, versions, and completion time.

## 4. Quantitative and Input Snapshot Pipeline

Refactor around the existing `FactorExposureService`; do not reimplement factor
direction, z-score, percentile, weighting, or composite-score logic.

The new snapshot service returns:

- frozen main-board universe symbols
- latest complete common `dataDate`
- eligible stock exposures
- per-stock exclusions with stable stage/code/reason
- coverage metrics

Coverage gate:

- eligible/universe must be at least `0.90`
- eligible count must be at least `candidateCount`
- no LLM call occurs before both checks pass

Candidate construction:

```text
quantitative candidates = first candidateCount eligible rows by rank
watchlist candidates = eligible rows whose symbols are in frozen watchlist
candidates = stable deduplicated union
```

An ineligible watchlist symbol remains an exclusion and cannot receive a
fabricated prompt. Fail before LLM when the resolved union exceeds 150.

Candidate input schema `llm-stock-selection-input/v1` contains:

- trusted symbol/name/dataDate and candidate sources
- quantitative score/rank and factor contribution snapshot
- last 20 trading rows: open/high/low/close/volume/amount/turn/pctChg
- returns: 1/5/20/60 trading days
- trend: MA5/10/20/60 and MACD DIF/DEA/HIST
- momentum: RSI14, KDJ K/D/J, ROC20
- risk: ATR14, Bollinger position/bandwidth, 20-day volatility, 60-day max drawdown
- volume: 5/20-day volume ratio, amount change, 5/20-day turnover summary
- lookback/profile/schema versions and 20-day analysis horizon

All non-finite values are normalized at this boundary. Missing required fields
exclude the stock with a stable reason; optional unavailable indicators are
represented explicitly as null only when the schema permits it.

## 5. LLM Execution and Validation

The Engine worker owns selection calls because it already owns market matrices,
factor calculation, read-only model loading, and the LiteLLM adapter. It loads
the immutable model config by `(userId, llmModelId)` and never puts secrets in
Redis or task rows.

Calls are independent per candidate with a small bounded worker pool (default
four, runtime-configurable outside the user modal). The scheduler submits only
up to the concurrency bound at once so a cancellation flag stops new dispatch.
Already-issued Provider requests may settle.

The prompt embeds the versioned trusted input and a fixed scoring rubric for the
next 20 trading days. It asks for concise evidence, not hidden chain-of-thought.
`jsonMode=true` remains enabled. Provider transient retries remain exclusively
inside `LiteLLMClient`.

Pydantic validates `llm-stock-selection-judgment/v1`:

```text
selectionScore: integer 0..100
confidence: number 0..1
outlook: BULLISH | NEUTRAL | BEARISH
summary: bounded non-empty string
strengths: 0..3 bounded strings
risks: 0..3 bounded strings
keySignals: bounded array of
  category: PRICE | VOLUME | TECHNICAL | FACTOR
  name: bounded string
  interpretation: bounded string
```

Invalid JSON/schema is `LLM_RESPONSE_INVALID`; no default score or partial field
fabrication is allowed. Stock identity and final selection fields are never read
from the model response.

After attempts settle, backend-owned ranking sorts successful candidates by
`selectionScore DESC`, then `quantitativeRank ASC`, then `symbol ASC`. It clears
and recomputes `selected/finalRank` transactionally.

Terminal state matrix:

- all candidates succeeded -> `COMPLETED`
- some failed and successes >= finalTopN -> `PARTIAL_SUCCESS`
- successes < finalTopN or preparation gate failed -> `FAILED`
- cancellation observed -> `CANCELLED`, with no authoritative final Top N

## 6. Retry and Cancellation

Cancel uses the existing Redis cancellation key and `CANCELLING` transition.
The runner checks before preparation phases, before each dispatch, and before
ranking. Unsubmitted candidates become `CANCELLED`/not-run for audit.

Retry accepts all failed candidates or a user-scoped subset. It:

1. verifies the original task is terminal and no other active selection exists;
2. verifies the frozen model still exists for the user;
3. reuses persisted candidate `inputSnapshot` without rebuilding newer data;
4. transitions the same task back to `PENDING`, enqueues a retry payload, and
   appends new attempt rows;
5. recomputes the full successful ranking and terminal summary.

If the model was deleted, retry is rejected with actionable model-management
guidance; historical results remain readable from stored metadata.

## 7. API Contract

New authenticated module prefix: `/llm-stock-selections`.

- `POST /` with `{ llmModelId, candidateCount, finalTopN, lookbackDays }`
  -> success `{ taskId }`; active conflict -> HTTP 409 with active task
- `GET /?limit&offset` -> paginated task summaries plus active task
- `GET /:id` -> user-scoped task summary/config/coverage
- `GET /:id/results?view=selected|all|failed&limit&offset`
- `GET /:id/results/:symbol` -> full trusted evidence and attempt history
- `POST /:id/cancel`
- `POST /:id/retry-failed` with optional `{ symbols }`

Create resolves and freezes the current factor set and watchlist, validates the
chosen current-user model, inserts before Redis enqueue, and compensates enqueue
failure to `FAILED`. Result decoders/types are owned in this module; Web does not
cast raw JSONB fields.

## 8. Web Design

Add a lazy route and navigation item for a dedicated LLM stock-selection page.

Creation modal fields:

- model selector, default model preselected
- quantitative candidate count, default 50, range 20..100
- final Top N, default 10, range 1..20
- lookback days, default 250, range 120..500
- read-only factor mode/count, watchlist count, main-board universe label,
  estimated upper-bound calls, 150-call warning

Submission stays open on failure. Missing models link to model management.

The page uses serial polling with one request at a time and stops on terminal
state. History rows show config, counts, coverage, model, status, token usage,
and failure count. Result exploration has `Selected`, `All candidates`, and
`Failures` tabs. A stock drawer renders model judgment and trusted recent bars,
indicators, factor contributions, source tags, errors, and attempts. Cancel and
retry actions have row-level loading, duplicate-action protection, visible
errors, and accessible labels.

## 9. Compatibility, Rollout, and Rollback

- Existing `FACTOR_SELECTION` and single-stock `LLM_ANALYSIS` APIs remain
  compatible. Shared factor calculation may be refactored only behind existing
  tests.
- No old LLM-selection data exists, so the new schema has no data migration.
- Database migration is forward-only during implementation; rollback drops the
  new indexes/tables after the feature is disabled.
- The feature adds no real Provider call to automated tests; all LLM tests use
  fakes/mocks.
- The future watchlist-management UI writes the existing `watchlists` table and
  needs no selection-contract change.

## 10. Observability and Security

- Every query and mutation is scoped by `userId`; market data remains global.
- Queue payloads contain IDs and frozen non-secret configuration only.
- Logs include task ID, symbol, stage, attempt, duration, sanitized error code,
  provider/model identity, and token usage; never prompts containing credentials,
  API keys, Authorization values, or raw sensitive Provider errors.
- Stable failure stages include `UNIVERSE`, `MARKET_DATA`, `FACTOR`, `INDICATOR`,
  `SNAPSHOT`, `LLM`, `VALIDATION`, `CANCELLED`.
