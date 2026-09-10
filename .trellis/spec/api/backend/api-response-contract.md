# Business API Response Contract

## 1. Scope / Trigger

Read this when adding or changing Gateway JSON routes, public errors, Eden types,
frontend requests, or API-to-Engine adapters. It covers the 42 business endpoints
assembled by `apps/api/src/app.ts`, not private Engine or persistence protocols.

API and Web use a coordinated breaking migration. Deploy or roll back both
together; there is no legacy response adapter. No Engine or database migration
is required.

## 2. Signatures

The browser-safe source of truth is
`apps/api/src/contracts/api-response.ts`, exported as `@stock-quant/api/contracts`:

```ts
type ApiResponse<T> =
  | { success: true; code: 0; message: string; data: T }
  | { success: false; code: ApiErrorCode; message: string; data: null };
```

- `apiSuccess<T>(data: T, message?): ApiSuccess<T>` returns the narrow success type.
- `apiFailure(status, code, message)` returns an Elysia `status(...)` result.
- `ApiDomainError(code, message, status, options?)` carries a safe public error.
- `request(api.route.get())` infers `Promise<T>` without response generics or casts.
- `ApiData<typeof api.route.get>` extracts a feature's successful payload type.

`ApiCode` explicitly assigns integers: common errors `1000..1099`, task lifecycle
`2000..2007`, factors `3000..3004`, market data `4000..4007`, LLM `5000..5008`, and
selection-specific reasons `6000..6002`. Shared reasons such as `ACTIVE_TASK`
and `QUEUE_UNAVAILABLE` keep the same code across workflows. Do not renumber
existing entries or derive codes from messages, HTTP statuses, or array positions.

## 3. Contracts

- All business successes and failures contain exactly the four outer fields.
  Success is code zero; failure is a registered nonzero code and null data.
- Keep HTTP semantics separate from business codes. Returning an ordinary error
  object after mutating `set.status` breaks Eden's status-based inference.
- Install the named `apiErrors` plugin before business modules. Its global
  `onError` returns typed failures for domain, Engine, schema, parse, missing-route,
  and unexpected errors. Unknown diagnostics remain in structured server logs.
- Success helpers must not return the wider `ApiResponse<T>` union; that would
  put failures back in Eden's 2xx data type. Do not implement runtime-only wrapping
  in `mapResponse`, `onAfterHandle`, or a Proxy.
- Configuration writes and Watchlist/LLM deletions acknowledge with
  `apiSuccess(null)`. Passing undefined is an internal error, not an omitted field.
- Preserve payload pagination: collection/LLM selection use `items`; factor
  lists/history use `data`. A factor list therefore has `response.data.data` on
  the wire, but only `payload.data` after `request(...)`.
- Command payloads contain `taskId`, `status`, `stockCount`, or `retryCount` as
  applicable, without a second transport `success` flag. Worker `success` counts,
  stock `code` identifiers, and persisted error strings remain domain data.
- Failures never expose the old outer `taskId`/`conflict` fields. Refresh task
  history after conflict or enqueue failure to recover active/failed task identity.
- The frontend helper normalizes HTTP, business, network, and protocol errors
  into `ApiRequestError`. Network/protocol failures do not invent a business code.
  Preserve AbortError even when a DOMException is not an `instanceof Error`.
- Validate external data where needed, not repeatedly in feature transport code.
  `request(operation, isMarketKlineData)` retains chart validation. Redis progress
  is decoded by `parseWorkerProgress`; ignore invalid records, preserve count and
  status semantics. Persisted selection status normalization remains separate.
- The request helper emits no toast or global event. UI code owns feedback,
  loading cleanup, modal retention, serial polling, and stale-response guards.
- Better Auth owns `/api/auth` and `/api/auth/*` with `parse: "none"`. Do not mount
  its handler on `/*`: that intercepts unknown business routes and bypasses the
  business 404 contract. Do not wrap SDK responses, health, root text, or streams.
- `EngineClientError` still uses internal string codes. `mapEngineError` translates
  them only at the Gateway boundary. Keep Engine HTTP/Redis/DB/cache formats intact.

## 4. Validation & Error Matrix

| Condition | Public HTTP / numeric code |
| --- | --- |
| Elysia schema or JSON parse failure | 400 / `VALIDATION_ERROR` = 1004 |
| Missing business session | 401 / `UNAUTHENTICATED` = 1001 |
| Unknown business route | 404 / `NOT_FOUND` = 1003 |
| Missing/foreign task | 404 / `TASK_NOT_FOUND` = 2000 |
| Active collection/LLM-selection task | 409 / `ACTIVE_TASK` = 2001 |
| Collection start or LLM-selection enqueue failure | 503 / `QUEUE_UNAVAILABLE` = 2002 |
| Mining, factor-selection, collection-retry enqueue failure | Existing 400 / `QUEUE_UNAVAILABLE` = 2002 |
| Explicit LLM configuration validation | 422 / `LLM_CONFIG_INVALID` = 5001 |
| Referenced LLM model deletion | 409 / `LLM_CONFIG_REFERENCED` = 5002 |
| Engine service-token 401/403 | 502 / `UPSTREAM_AUTH_ERROR` = 1007; not a browser login error |
| Engine LLM timeout | 504 / `LLM_TIMEOUT` = 5006 |
| Unknown/non-JSON Engine LLM failure | Sanitized 502, or 503 when upstream is 503 / `LLM_PROVIDER_UNAVAILABLE` = 5007 |
| Engine simulation HTTP 200 with `status: "error"` | 502 / `UPSTREAM_ERROR` = 1005 |
| Unexpected exception | 500 / `INTERNAL_ERROR` = 1099; no private diagnostic text |
| Health readiness failure | Native 503 health body, outside this envelope |

## 5. Good / Base / Bad Cases

- Good: an authenticated K-line request returns `ApiSuccess<KlinePayload>`;
  missing data is typed HTTP 404; the chart hook receives only `KlinePayload`.
- Base: deletion returns null; the request helper accepts it as success rather
  than treating falsy data as a missing response.
- Bad: always return HTTP 200, cast a failure to a DTO, include task IDs in failure
  data, or wrap Engine queues/authentication with the public protocol.

## 6. Tests Required

- `apps/api/tests/response-contract.test.ts` uses `createApp()` without listening
  or startup timers. Its matrix must equal the actual mounted business routes,
  asserting all 42 success envelopes and authentication failures.
- Cover framework/domain errors, task conflicts/queue failures, config rollback,
  narrow command payloads, native protocols, safe Engine conversion, and internal
  HTTP-200 simulation errors. Stub services/transport; never run real jobs/providers.
- Catalog tests enforce unique integer codes and explicit null acknowledgements.
- `apps/web/tests/api/request.types.ts` is checked with `bun run typecheck:contracts`
  from `apps/web`; Vitest alone does not check these types. Assert inferred arrays,
  objects, pagination, null, literal success/code fields, and typed HTTP failures.
  Elysia may represent equivalent errors as intersections: check bidirectional
  assignability and literal field types rather than object identity alone.
- Request runtime tests cover malformed/non-JSON/HTTP/network/business failures,
  optional domain validation, falsy success values, and abort preservation.
- Hook/component tests retain serial polling, abort/stale protection, task identity
  refresh, retry ID/count delivery, modal retention, and action-lock cleanup.
- Run `uv run pytest tests/test_internal_router.py -q` from `apps/engine` to verify
  the unchanged private Engine DTO/string-code protocol.

## 7. Wrong vs Correct

Wrong:

```ts
set.status = 404;
return { success: false, error: "Missing task" };
```

Correct:

```ts
return apiFailure(404, "TASK_NOT_FOUND", "任务不存在或无权访问");
```

Wrong:

```ts
const result = await api.tasks['data-collection'].get();
const tasks = result.data as Task[];
```

Correct:

```ts
const payload = await request(api.tasks['data-collection'].get());
setTasks(payload.items);
```
