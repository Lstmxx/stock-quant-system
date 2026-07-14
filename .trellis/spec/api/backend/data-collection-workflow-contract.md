# Global Stock Data Collection Workflow Contract

## 1. Scope / Trigger

Use this contract whenever changing stock data collection configuration, task creation/cancellation/retry, the Redis worker queue, Baostock loading, `market_data:*` caches, scheduler cron handling, or the Web data-management page. These paths form one cross-layer workflow across PostgreSQL, Elysia, Redis, FastAPI, and React.

The collection dataset is global. It is not user-isolated like factor mining: authenticated users share one active collection slot and one configuration, while `alpha_tasks.userId` records the manual initiator for audit.

## 2. Signatures

### HTTP

- `GET /api/tasks/data-collection?limit&offset`
  - `limit`: integer, `1..100`, default `50`
  - `offset`: integer, `>= 0`, default `0`
  - response: `{ items, total, limit, offset, activeTask }`
- `GET /api/tasks/data-collection/config`
  - response: `{ lookbackDays, workerCount, cronExpression }`
- `PUT /api/tasks/data-collection/config`
  - body: `{ lookbackDays, workerCount, cronExpression }`
- `POST /api/tasks/data-collection/run`
  - success: `{ success: true, taskId }`
  - active-slot conflict: HTTP 409 with `{ success: false, conflict: true, taskId?, status? }`
- `POST /api/tasks/:id/cancel`
  - response: `{ success: true, status }`
- `GET /api/tasks/:id/progress`
  - response: `{ taskId, status, workers[] }`
- `GET /api/tasks/:id/failed-stocks`
  - response: `{ taskId, stocks, failures: [{ code, reason }] }`
- `POST /api/tasks/:id/retry-failed`
  - success: `{ success: true, taskId, stockCount }`

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

## 3. Contracts

1. A new manual, retry, or scheduled task never cancels an existing active collection task. The API may pre-check for a friendly response, but the PostgreSQL partial unique index is the concurrency authority.
2. Task persistence precedes Redis enqueue. Every producer must compensate enqueue failure by updating the task to `FAILED` with a diagnostic result and close the Redis client in `finally`.
3. Scheduled tasks use `userId = NULL` and `params.trigger = 'SCHEDULED'`; never invent a `system` user foreign key.
4. Collection configuration is global. Generic per-user configuration writes must not reload the scheduler.
5. The scheduler timezone is explicitly `Asia/Shanghai`. Use `mon-fri`, not numeric `1-5`, because APScheduler numbers Monday as `0`.
6. A retry is complete only after successful target symbols are written to per-symbol K-line caches and the full aggregate `market_data:*` value is rebuilt. Write aggregation through a temporary key and `RENAME` so readers see either the old or new complete value.
7. Task results use `{ totalCount, successCount, failedCount, lookbackDays, completedAt, retryOf? }`. Status is derived from counts: no failures is `COMPLETED`, mixed results is `PARTIAL_SUCCESS`, and no successes is `FAILED`.
8. Redis failure details expire. If `result.failedCount > 0` but the failure set is empty, the UI must say that details expired; it must not claim all stocks succeeded.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| `lookbackDays` is non-integer or outside `1..5000` | API validation error; do not persist |
| `workerCount` is non-integer or outside `1..16` | API validation error; do not enqueue |
| cron does not contain five valid APScheduler fields | Engine returns HTTP 400; existing job remains installed |
| active collection task exists | HTTP 409; return active task; do not cancel or insert another task |
| concurrent inserts race | partial unique index rejects one insert; map PostgreSQL `23505` to conflict |
| Redis enqueue fails | task becomes `FAILED`; return a retryable service error |
| progress hash contains malformed JSON | ignore that worker snapshot; do not fail the endpoint |
| retry source is not a terminal data-collection task | reject retry |
| all retry targets fail | task is `FAILED`; preserve the previous aggregate cache |
| some symbols fail | publish reasons and finish as `PARTIAL_SUCCESS` after rebuilding usable aggregate data |
| cancellation requested while running | database status becomes `CANCELLING`, then worker finishes as `CANCELLED` |

## 5. Good / Base / Bad Cases

- Good: user A starts collection; user B sees the same `activeTask`; a second start returns 409; the first task completes and atomically replaces the aggregate cache.
- Base: no global config row exists; API and scheduler use `250`, `4`, and `0 20 * * mon-fri` until the first upsert.
- Good retry: a partial task reports two failed codes; retry repairs one, removes it from the source failure set, rebuilds the aggregate, and finishes `PARTIAL_SUCCESS` with one remaining reason.
- Bad: selecting all active tasks and setting cancellation flags before inserting a new one. This destroys another user's global work and hides the conflict.
- Bad: retrying only `load_kline_data(stocks=failed)` and marking the task complete. Downstream factor code still reads the stale aggregate cache.

## 6. Tests Required

- Database schema test: assert nullable task actor, singleton config index, and partial active-task unique index.
- API service tests: active-slot conflict does not insert/cancel; free slot enqueues; enqueue failure marks `FAILED`; global config defaults/upsert are stable.
- Engine loader tests: aggregate cache uses temporary-key rename; retry rebuilds from the full cache set and clears repaired source failures.
- Worker tests: mixed counts map to `PARTIAL_SUCCESS`; retry calls the aggregate rebuild path.
- Scheduler tests: timezone is `Asia/Shanghai`; invalid cron does not replace the job; enqueue failure is compensated.
- Web hook tests: polling requests do not overlap; failed worker remains failed; `CANCELLING` blocks duplicate start; cancellation copy matches the intermediate state.
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
