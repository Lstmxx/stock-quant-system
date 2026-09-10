# Global Stock Data Collection Workflow Contract

## 1. Scope / Trigger

Use this contract whenever changing stock data collection configuration, task creation/cancellation/retry, the Redis worker queue, Baostock loading, `market_data:*` caches, scheduler cron handling, or the Web data-management page. These paths form one cross-layer workflow across PostgreSQL, Elysia, Redis, FastAPI, and React.

The collection dataset is global. It is not user-isolated like factor mining: authenticated users share one active collection slot and one configuration, while `alpha_tasks.userId` records the manual initiator for audit.

## 2. Signatures

### HTTP

All `/api/*` business results below are payloads inside `ApiSuccess.data`; failures follow [API Response Contract](./api-response-contract.md) with numeric codes and null data. `/internal/*` remains the unchanged private Engine protocol.

- `GET /api/tasks/data-collection?limit&offset`
  - `limit`: integer, `1..100`, default `50`
  - `offset`: integer, `>= 0`, default `0`
  - response: `{ items, total, limit, offset, activeTask }`
- `GET /api/tasks/data-collection/config`
  - response: `{ lookbackDays, workerCount, cronExpression }`
- `PUT /api/tasks/data-collection/config`
  - body: `{ lookbackDays, workerCount, cronExpression }`
  - acknowledgement: `data: null`
- `POST /api/tasks/data-collection/run`
  - success payload: `{ taskId }`
  - active-slot conflict: HTTP 409 / `ApiCode.ACTIVE_TASK`, `data: null`; refresh the list to recover `activeTask`
- `POST /api/tasks/:id/cancel`
  - response payload: `{ status }`
- `GET /api/tasks/:id/progress`
  - response: `{ taskId, status, workers[] }`
- `GET /api/tasks/:id/failed-stocks`
  - response: `{ taskId, stocks, failures: [{ code, reason }] }`
- `POST /api/tasks/:id/retry-failed`
  - success payload: `{ taskId, stockCount }`
- `POST /internal/fetch-data`
  - body: `{ symbol: string, days: number, force_update?: boolean }`
  - `force_update` defaults to `false`; real source-integration tests set it to `true`
  - immediate response: `{ status: "accepted", symbol, message }`
- `GET /api/market-data/search?q`
  - authenticated read-only search over the current main-board stock universe
  - response: up to 20 `{ code, name }` results, ranked by exact/prefix code then name
- `GET /api/market-data/:symbol/kline`
  - authenticated read-only chart data lookup; it never triggers Baostock fetching
  - response: `{ symbol, name, bars[], volume[], latest, range }`
  - reads `kline:{code}` first and falls back to the newest legacy range key

### Queue and cache

- Producer: `RPUSH stock:tasks:queue <JSON>`
- Payload: `{ taskId, userId: string | null, type: "DATA_COLLECTION", params }`
- `params.trigger`: `MANUAL | SCHEDULED | RETRY`
- Active status set: `PENDING | RUNNING | CANCELLING`
- Terminal status set: `COMPLETED | PARTIAL_SUCCESS | FAILED | CANCELLED`
- Worker progress: `task_progress:{taskId}` hash; worker status is `running | completed | partial | failed | cancelled`
- Failure codes: `task_failed_stocks:{taskId}` set
- Failure reasons: `task_failed_stock_errors:{taskId}` hash
- Aggregate market data: `market_data:{endDate}_{lookbackDays}`

### Database

- `data_collection_configs.scope = 'GLOBAL'` is unique.
- `alpha_tasks.userId` is nullable only so scheduled collection tasks can have no user actor.
- `alpha_tasks_active_data_collection_unique` is a partial unique index on `type = 'DATA_COLLECTION'` while status is active.

### Environment

- `DATABASE_URL` and `REDIS_URL` are required runtime keys in the repository-root `.env`.
- API, Engine, database runtime, Drizzle config, and config tests resolve the root `.env` from their source file location, never from the current working directory.
- Connection settings have no localhost, username, password, or port fallback. A missing required key fails fast with a key-only error that does not include the connection string.

## 3. Contracts

1. A new manual, retry, or scheduled task never cancels an existing active collection task. The API may pre-check for a friendly response, but the PostgreSQL partial unique index is the concurrency authority.
2. Task persistence precedes Redis enqueue. Every producer must compensate enqueue failure by updating the task to `FAILED` with a diagnostic result and close the Redis client in `finally`.
3. Scheduled tasks use `userId = NULL` and `params.trigger = 'SCHEDULED'`; never invent a `system` user foreign key.
4. Collection configuration is global. Generic per-user configuration writes must not reload the scheduler.
5. The scheduler timezone is explicitly `Asia/Shanghai`. Use `mon-fri`, not numeric `1-5`, because APScheduler numbers Monday as `0`.
6. A retry is complete only after successful target symbols are written to per-symbol K-line caches and the full aggregate `market_data:*` value is rebuilt. Write aggregation through a temporary key and `RENAME` so readers see either the old or new complete value.
7. Task results use `{ totalCount, successCount, failedCount, lookbackDays, completedAt, retryOf? }`. Status is derived from counts: no failures is `COMPLETED`, mixed results is `PARTIAL_SUCCESS`, and no successes is `FAILED`.
8. Redis failure details expire. If `result.failedCount > 0` but the failure set is empty, the UI must say that details expired; it must not claim all stocks succeeded.
9. A real Baostock integration run must bypass both aggregate and per-symbol caches through `force_update = true`. Deleting only `market_data:*` is insufficient because `kline:*` entries can still make the test pass without fetching Baostock.
10. Integration tests remove the target summary before triggering, subscribe before the request, and close pub/sub plus Redis clients in `finally`.
11. The market chart page is a read-only consumer of the per-symbol cache. Missing or invalid chart data is reported as an empty/error state and must not start a collection task.
12. After start/retry conflicts or enqueue failures, Web refreshes task history instead of reading task IDs from error data. Preserve retry task ID/count delivery on success and keep the detail modal open on failure.
13. `parseWorkerProgress` validates Redis records at the HTTP boundary: nonnegative integer worker/count fields, a known worker status, and nullable current symbol. Invalid records are ignored; Engine keys/values and worker success counters are unchanged.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| `lookbackDays` is non-integer or outside `1..5000` | API validation error; do not persist |
| `workerCount` is non-integer or outside `1..16` | API validation error; do not enqueue |
| cron does not contain five valid APScheduler fields | Engine returns HTTP 400; existing job remains installed |
| active collection task exists | HTTP 409 / `ApiCode.ACTIVE_TASK`, null data; list refresh recovers active task; do not cancel or insert another task |
| concurrent inserts race | partial unique index rejects one insert; map PostgreSQL `23505` to conflict |
| Redis enqueue fails | task becomes `FAILED`; return a retryable service error |
| progress hash contains malformed JSON or invalid worker fields | ignore that worker snapshot; do not fail the endpoint |
| retry source is not a terminal data-collection task | reject retry |
| all retry targets fail | task is `FAILED`; preserve the previous aggregate cache |
| some symbols fail | publish reasons and finish as `PARTIAL_SUCCESS` after rebuilding usable aggregate data |
| cancellation requested while running | database status becomes `CANCELLING`, then worker finishes as `CANCELLED` |
| `DATABASE_URL` or `REDIS_URL` is absent | fail startup/config loading with the missing key name; never substitute credentials or localhost |
| config/test starts from a different working directory | load the same repository-root `.env` through a source-relative absolute path |
| integration request uses `force_update = true` | bypass aggregate and per-symbol market caches and call the real Baostock path |

## 5. Good / Base / Bad Cases

- Good: user A starts collection; user B sees the same `activeTask`; a second start returns 409; the first task completes and atomically replaces the aggregate cache.
- Base: no global config row exists; API and scheduler use `250`, `4`, and `0 20 * * mon-fri` until the first upsert.
- Good retry: a partial task reports two failed codes; retry repairs one, removes it from the source failure set, rebuilds the aggregate, and finishes `PARTIAL_SUCCESS` with one remaining reason.
- Bad: selecting all active tasks and setting cancellation flags before inserting a new one. This destroys another user's global work and hides the conflict.
- Bad: retrying only `load_kline_data(stocks=failed)` and marking the task complete. Downstream factor code still reads the stale aggregate cache.
- Good config: running tests from either repository root or a package directory loads the same root `.env` and validates URL structure without printing credentials.
- Bad config: `process.env.REDIS_URL || "redis://localhost:6379"`, fixed PostgreSQL credentials, or `config({ path: "../../.env" })`; these silently target the wrong service or depend on the launch directory.
- Good integration: `force_update = true` reports zero per-symbol cache hits, publishes `data_ready:{symbol}`, and writes a fresh `price_summary`.

## 6. Tests Required

- Database schema test: assert nullable task actor, singleton config index, and partial active-task unique index.
- API service tests: active-slot conflict does not insert/cancel; free slot enqueues; enqueue failure marks `FAILED`; global config defaults/upsert are stable.
- Engine loader tests: aggregate cache uses temporary-key rename; retry rebuilds from the full cache set and clears repaired source failures.
- Worker tests: mixed counts map to `PARTIAL_SUCCESS`; retry calls the aggregate rebuild path.
- Scheduler tests: timezone is `Asia/Shanghai`; invalid cron does not replace the job; enqueue failure is compensated.
- Web hook tests: polling requests do not overlap; failed worker remains failed; `CANCELLING` blocks duplicate start; cancellation copy matches the intermediate state.
- Config tests: execute from repository root and package directories; assert required URL protocols/hosts without asserting or printing usernames, passwords, ports, or full URLs.
- Real integration test: send `force_update = true`, observe actual Baostock collection, assert accepted response, pub/sub success, fresh `price_summary`, and resource cleanup.
- Build gates: API Bun build, Web TypeScript/Vite build, Python compile check, antd lint, and `git diff --check`.

## 7. Wrong vs Correct

### Wrong

```typescript
for (const task of activeTasks) await cancel(task.id);
await insertCollectionTask();
await redis.rpush(queue, payload);
```

This silently cancels global work, races with concurrent requests, and leaves `PENDING` rows when Redis fails.

### Correct

```typescript
const active = await findActiveDataCollectionTask();
if (active) return conflict(active);

const task = await insertPendingTask(); // partial unique index is the race guard
const enqueued = await enqueueTask(task.id, payload); // compensates to FAILED
return enqueued ? success(task.id) : enqueueFailure(task.id);
```

For retries, the equivalent rule is: refresh target per-symbol caches, rebuild the complete aggregate into a temporary key, atomically rename it, and only then publish the terminal task status.

### Configuration and real integration

#### Wrong

```typescript
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
config({ path: "../../.env" });
```

```python
data = loader.load_latest(lookback_days=30)  # may be a cache-only false positive
```

#### Correct

```typescript
const rootEnv = fileURLToPath(new URL("../../../../.env", import.meta.url));
config({ path: rootEnv });
const redisUrl = requireEnv("REDIS_URL");
```

```python
data = loader.load_latest(lookback_days=30, force_update=True)
```
