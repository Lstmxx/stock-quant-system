# Factor Mining and Selection Workflow Contract

## 1. Scope / Trigger

Use this contract when changing factor mining, factor persistence, Redis task dispatch, factor selection, task cancellation, selection result consumption, or the LLM stock-analysis bridge. These paths span Web, Elysia, PostgreSQL, Redis, and the Python worker; a locally valid field or status change can otherwise break another layer.

## 2. Signatures

Business HTTP uses [API Response Contract](./api-response-contract.md). Payloads below are inside success `data`; failures have numeric codes and null data.

- `POST /api/tasks/mining`: `{ researchDirection, days } -> { taskId }`
- `GET /api/factors?limit&offset&keyword`: `{ data, total }`; numeric `limit`/`offset` after Elysia coercion
- `GET|PUT /api/factors/selection`: shared AUTO/MANUAL factor set; PUT returns `{ mode }`
- `POST /api/factor-selections`: `{ universeType, topN, lookbackDays? } -> { taskId }`
- `GET /api/factor-selections`: `{ data, total }` history; `GET /api/factor-selections/:id`: user-scoped Top N detail
- Queue producer/consumer: `RPUSH stock:tasks:queue <payload>` with `BLPOP stock:tasks:queue`
- Task lifecycle: `PENDING -> RUNNING -> COMPLETED|FAILED`; cancellation uses `RUNNING -> CANCELLING -> CANCELLED` and may use `PENDING -> CANCELLED`.

Database contracts:

- `alpha_factors`: UUID id, numeric IC/ICIR/monotonicity, integer direction/generation, unique `(userId, expression)`
- `user_selected_factors`: current manual override
- `factor_selection_results`: immutable `(taskId, symbol)` rows with score, rank, data date, and typed factor contributions

## 3. Contracts

- `researchDirection` is one of `量价关系`, `动量反转`, `波动率`, `资金流向`, `市场情绪`, `趋势跟踪`; it is never a stock symbol.
- Every factor read, deduplication query, evolution input, selection task, result lookup, and analysis lookup is scoped by `userId`.
- `FACTOR_SELECTION.params` snapshots sorted factor IDs, `factorSetHash`, selection mode, universe type, watchlist symbols when applicable, Top N, data date, and lookback days.
- AUTO selects at most five valid factors by absolute IC, absolute ICIR, then stable ID. MANUAL uses only valid factors owned by the current user.
- The analysis prompt consumes a persisted `FactorAnalysisContext`: selection task ID, data date, universe, symbol, composite score/rank, and actual per-factor value/z-score/percentile/direction/contribution.
- Queue insertion failure compensates the persisted task to `FAILED`; it must not leave a permanent `PENDING` row.
- Web refreshes history after failed create/enqueue; failed task IDs are recovered from history, not from the error envelope.
- Mining infrastructure, LLM contract, evolution, or persistence exceptions propagate to the worker and become `FAILED`. Candidate expression/evaluation rejection may remain a recorded candidate failure.
- Cancellation is cooperative. UI text says a cancellation request was submitted until the worker reaches a checkpoint and writes `CANCELLED`.
- Log polling is serial (`await request`, then `setTimeout`), generation-scoped to the active task, stops after a terminal state, and exposes request errors.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unsupported research direction or `days` outside 10..1000 | Assembled API HTTP 400 / `ApiCode.VALIDATION_ERROR` |
| Factor list `limit` outside 1..100, fractional pagination, or negative `offset` | Assembled API HTTP 400 / `ApiCode.VALIDATION_ERROR` |
| Selection `topN` outside 1..100 or lookback outside 30..1000 | Assembled API HTTP 400 / `ApiCode.VALIDATION_ERROR` |
| WATCHLIST with no current-user symbols | 400 with actionable error; no task created |
| Empty effective factor set | 400 with actionable error; no task created |
| Foreign, invalid, missing, or duplicated manual factor ID | 400; previous selection remains unchanged |
| Redis enqueue failure after task insert | task `FAILED` plus API failure |
| Mining round contract/LLM/persistence exception | worker writes `FAILED` with readable reason |
| Cancellation during running work | API writes `CANCELLING`; worker later writes `CANCELLED` |
| Selection/analysis result requested by another user | not found; never return cross-user data |

## 5. Good / Base / Bad Cases

- Good: user runs WATCHLIST selection; symbols and factor IDs are frozen in task params; results contain only that user's snapshot and analysis reuses the same contribution rows.
- Base: no manual selection exists; AUTO resolves up to five valid factors deterministically and ALL_MARKET runs asynchronously.
- Bad: use `LPUSH + BLPOP`, mark a running task `CANCELLED` before work stops, swallow an LLM exception and return an empty successful mining result, or let each consumer reinterpret raw JSON independently.

## 6. Tests Required

- API schema tests assert research direction, integer pagination, Top N, and lookback boundaries.
- Queue tests assert `RPUSH`, FIFO behavior, Redis cleanup, and enqueue-failure compensation.
- Engine tests assert mining success, round failure -> `FAILED`, cooperative cancellation, UUID persistence, user-scoped duplicate expressions, and evolution inputs.
- Selection tests use fixed market data to assert direction-adjusted z-scores, normalized contributions, deterministic rank, both universes, and user isolation.
- Web tests assert failed create keeps the modal open, log requests never overlap, late prior-task responses are ignored, terminal tasks stop polling, and errors are visible.
- Analysis tests assert the prompt contains actual value, percentile, direction, score/rank, data date, and selection task ID from the persisted snapshot.

## 7. Wrong vs Correct

### Wrong

```ts
await redis.lpush(queue, payload); // BLPOP now consumes newest first
await db.update(alphaTasks).set({ status: "CANCELLED" }); // work may still run
```

```python
try:
    hypothesis = llm.generate_hypothesis(...)
except Exception:
    return None  # worker may later report COMPLETED
```

### Correct

```ts
await redis.rpush(queue, payload);
await db.update(alphaTasks).set({ status: "CANCELLING" });
```

```python
hypothesis = llm.generate_hypothesis(...)
if not hypothesis or not hypothesis.get("hypothesis"):
    raise RuntimeError("LLM did not return a usable hypothesis")
```
