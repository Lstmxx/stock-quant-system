# LLM Stock Selection Workflow Contract

## 1. Scope / Trigger

Use this contract when changing `LLM_STOCK_SELECTION` task creation, main-board
quantitative screening, watchlist candidate inclusion, market/indicator input
snapshots, per-stock LLM judgment, attempt persistence, ranking, cancellation,
retry, or the dedicated Web result UI.

This workflow spans Web, Elysia, PostgreSQL, Redis, the Python worker, market
data, factor calculations, the read-only LLM model loader, and LiteLLM. It also
inherits the factor, data-collection, and LLM contracts; it does not redefine
their math, cache, secret, or Provider ownership.

## 2. Signatures

HTTP:

All routes use [API Response Contract](./api-response-contract.md). Success payloads are inside `data`; failures carry numeric codes and null data. Candidate/attempt error codes remain persisted domain strings.

- `POST /api/llm-stock-selections`
  - body: `{ llmModelId, candidateCount, finalTopN, lookbackDays }`
  - bounds: candidate `20..100`, final `1..20`, lookback `120..500`
  - success: `{ taskId }`
  - active conflict: HTTP 409 / `ApiCode.ACTIVE_TASK`, null data; list refresh recovers the current `activeTask`
- `GET /api/llm-stock-selections?limit&offset`
- `GET /api/llm-stock-selections/:id`
- `GET /api/llm-stock-selections/:id/results?view=selected|all|failed&limit&offset`
- `GET /api/llm-stock-selections/:id/results/:symbol`
- `POST /api/llm-stock-selections/:id/cancel`
  - success payload: `{ status }`; a service-level cancellation failure must not become a successful envelope
- `POST /api/llm-stock-selections/:id/retry-failed`
  - body: `{ symbols?: string[] }`, at most 150 unique symbols
  - success payload: `{ taskId, retryCount }`
  - create/retry errors keep the modal/action failure visible and refresh history to recover active/failed task identity

Queue:

- payload: `{ taskId, userId, type: "LLM_STOCK_SELECTION", params }`
- params freeze model identity/display metadata, factor IDs/hash/mode,
  watchlist symbols, Top M/N, lookback, main-board universe, schema/profile
  versions, 20-day horizon, and max-candidate limit.
- retry adds `retrySymbols`; Engine must load persisted `inputSnapshot` instead
  of current market data.

Database:

- `alpha_tasks.type = 'LLM_STOCK_SELECTION'`
- partial unique index on `alpha_tasks(userId)` while status is
  `PENDING|RUNNING|CANCELLING`
- `llm_stock_selection_results`: unique `(taskId, symbol)`, one row for every
  frozen-universe stock
- `llm_stock_selection_attempts`: unique `(resultId, attemptNo)`

## 3. Contracts

### Preparation and universe

- `dataDate` is the latest complete date in market matrices, never wall-clock
  today. The first universe is active `sh.60*` and `sz.00*` main-board stocks.
- Every universe stock is `ELIGIBLE` or `EXCLUDED`; exclusions persist stage,
  stable code, sanitized message, and timestamp.
- Coverage must be at least 90% and eligible count at least Top M before any LLM
  call. Persist partial exclusion rows before failing a coverage gate.
- Quantitative math reuses `FactorExposureService`; consumers must not duplicate
  direction, z-score, percentile, weights, contribution, or composite score.

### Candidate and input snapshot

- candidates = quantitative Top M union frozen eligible watchlist, deduplicated
  by normalized symbol. Watchlist gives no score bonus.
- the resolved union is at most 150.
- `llm-stock-selection-input/v1` contains at most 20 recent OHLCV/amount/turn/
  pctChg rows, `market-technical/v1` indicators, quantitative rank/score, and
  actual factor contributions from one data date/lookback.
- retry must decode the persisted versioned snapshot and must not rebuild it.

### Model judgment and trusted projection

- each candidate uses one independent `jsonMode=true` call through
  `LlmModelConfigLoader.get(userId, modelId)` and `LiteLLMClient`.
- Provider transient retries remain inside LiteLLM. Business code does not add
  another Provider retry loop.
- judgment/v1 requires score `0..100`, confidence `0..1`, outlook enum, bounded
  summary, at most three strengths/risks, and categorized key signals.
- invalid JSON/schema is candidate `FAILED`; never synthesize a score.
- backend ranks successful rows by score DESC, quantitative rank ASC, symbol
  ASC. Model output never owns symbol, selected, or final rank.

### Lifecycle

- all candidates succeed -> `COMPLETED`
- some fail and successes >= final Top N -> `PARTIAL_SUCCESS`
- preparation fails or successes < final Top N -> `FAILED`
- cancellation -> `CANCELLED` with no complete-looking final Top N
- cooperative cancellation stops new submissions and lets issued calls settle.
- every attempt records model metadata, status, sanitized error or validated
  judgment, usage, and timestamps. Invalid-JSON attempts still count Provider
  token usage when usage was returned.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Foreign/deleted model | 404; no task or retry call |
| Empty effective factor set | 400; no task |
| Same user already has active task | 409 / `ApiCode.ACTIVE_TASK`; null data, refresh history; never auto-cancel |
| Concurrent create race | partial unique index rejects one; map to 409 |
| Redis enqueue failure | task becomes `FAILED`; API returns 503 |
| Latest market snapshot unavailable | `FAILED` before LLM with actionable data error |
| Coverage < 90% or eligible < Top M | persist exclusions, zero LLM calls, `FAILED` |
| Candidate union > 150 | zero LLM calls, `FAILED` with scope guidance |
| Candidate required input missing | exclude with stage/code/reason |
| Invalid judgment JSON/schema | candidate `FAILED`, no fallback score |
| Provider transient failure exhausted | candidate failure uses normalized LLM code |
| Cancel during execution | stop new dispatch, preserve settled/not-run rows, `CANCELLED` |
| Retry non-failed/foreign symbol | HTTP 400 |
| Frozen model deleted before retry | HTTP 404 with recreate-task guidance |
| Cross-user task/result/attempt access | not found; never leak data |

## 5. Good / Base / Bad Cases

- Good: user chooses model A, Top 50/10 and 250 days; API freezes five factors
  and 12 watchlist symbols; Engine resolves the latest trading date, records
  98% coverage, analyzes the deduplicated 57 candidates, validates every JSON,
  ranks deterministically, and Web renders Top 10 plus all evidence.
- Base: watchlist is empty; Top M alone proceeds. A few suspended/incomplete
  stocks are recorded as exclusions while coverage stays above 90%.
- Good retry: two candidates fail after LiteLLM retry; the run is partial. User
  retries one symbol; Engine uses its persisted input/v1 snapshot, appends
  attempt 2, preserves attempt 1, and recomputes the full ranking.
- Bad: use server date for result labels, send all raw 250-day rows, recalculate
  factors separately in the LLM path, trust model-supplied rank, delete failed
  rows, overwrite attempt history, or rebuild market data during retry.

## 6. Tests Required

- Database: new tables, cascades, unique task/symbol and result/attempt, active
  per-user partial unique index, and forward migration SQL.
- Snapshot: trading-date resolution, exact indicators, last-20 bound, 89.9/90%
  coverage boundary, factor/indicator exclusions, watchlist union, and 150/151.
- Engine: strict judgment validation, invalid-output isolation, token usage on
  invalid JSON, bounded dispatch, cancellation, deterministic ranking, status
  matrix, frozen retry, user/model fail-closed behavior, and worker dispatch.
- API: bounds, model/factor/watchlist snapshot, FIFO enqueue/compensation,
  concurrency conflict, user-scoped projections, result views, cancel/retry,
  subset ownership, and active-model delete conflict.
- Web: modal defaults/errors, model preselection, serial polling after creation,
  terminal stop, history/results/detail rendering, cancellation copy, failure
  reasons, and single/batch retry.
- Automated tests use mocked/fake LLMs and never call a paid Provider.

## 7. Wrong vs Correct

### Wrong

```python
for symbol in all_market:
    response = requests.post(provider_url, json=build_full_250_day_prompt(symbol))
    results.append({"symbol": response.json()["symbol"], "rank": response.json()["rank"]})
```

This bypasses the model security boundary, creates uncontrolled calls, sends
unbounded history, and trusts identity/ranking from the model.

### Correct

```python
snapshot = snapshot_service.build(...)
repository.persist_snapshot(task_id, user_id, snapshot)
executor.execute(
    task_id=task_id,
    user_id=user_id,
    model=config_loader.get(user_id, frozen_model_id),
    candidates=snapshot.candidates,
    is_cancelled=check_cancelled,
)
repository.finalize_ranking(task_id, user_id, final_top_n)
```

The correct path gates coverage before LLM, preserves trusted versioned inputs
and attempts, keeps credentials inside Engine, and computes final selection in
backend-owned deterministic logic.
