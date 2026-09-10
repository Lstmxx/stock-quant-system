# Unified API Response Design

## Status and Decision Boundary

Task creation, planning, final scope review, and the coordinated breaking migration of the business JSON contract are approved. The user requested implementation on 2026-09-09. The Engine impact assessment is complete: keep Engine production code and its internal protocol unchanged, and adapt responses at the API boundary.

Use one task rather than independent parent/child deliverables: backend response types, frontend decoding, and consumer fixtures must be validated together. Internal implementation checkpoints are allowed, but partially migrated contracts must not be deployed.

## 1. Contract Boundary

All 42 mounted business JSON routes in `research.md` use:

```ts
type ApiSuccess<T> = {
  success: true;
  code: 0;
  message: string;
  data: T;
};

type ApiFailure = {
  success: false;
  code: ApiErrorCode;
  message: string;
  data: null;
};

type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
```

- `ApiErrorCode` is a union of registered nonzero integer constants, exposed as a numeric JSON field.
- Successful reads and commands retain their business payload. An acknowledgement with no payload uses `data: null`, never omitted/undefined data.
- Existing transport-only command flags such as top-level `success`/`error`/`conflict` are translated at the HTTP boundary, not nested as a second result protocol inside `data`.
- Business fields that happen to have these names remain intact, including numeric worker success counters and stock codes.
- Preserve per-route pagination keys, date serialization, nullable business fields, IDs, and cancellation status. This is not a DTO-wide naming redesign.
- Health endpoints, root text, Better Auth SDK routes, native Response bodies, SSE, and future binary/download responses do not receive a blanket wrapper. The retired Analysis API remains disabled.

## 2. Shared Contract Location

Add `apps/api/src/contracts/api-response.ts` as a runtime-safe leaf module containing envelope types and the numeric code catalog. It must import no Elysia server, database, environment loader, auth plugin, or process startup code.

Expose it through an explicit package subpath such as `@stock-quant/api/contracts`, while preserving the existing package root and `App` type import. This avoids adding a new workspace package or importing the listening API entrypoint into the browser at runtime.

Place Elysia response construction and domain-error support under `apps/api/src/lib/`; place the error hook integration under `apps/api/src/plugins/`. Browser code may import the contract leaf, never those server integration modules.

## 3. Error Codes and HTTP Status

Use named, explicitly assigned integer constants. Reserve `0` for success and the following ranges for error families:

| Range | Family |
| --- | --- |
| 1000-1099 | Common request, authentication, validation, not-found, internal, and upstream failures |
| 2000-2099 | Collection/mining/task lifecycle and queue preconditions |
| 3000-3099 | Factor sets and quantitative selection |
| 4000-4099 | Market data, symbols, and cache availability/validity |
| 5000-5099 | LLM configuration and invocation |
| 6000-6099 | LLM stock-selection preconditions and conflicts |

Map every currently public domain failure to a named entry; do not derive identifiers from array order, localized messages, or HTTP status arithmetic. Document concrete assignments and assert uniqueness during implementation.

HTTP status is separate from the business code. Preserve existing 400/401/404/409/422/5xx distinctions; do not change all failures to HTTP 200. Narrow HTTP-facing status types to the supported literal union rather than `number`. Unknown upstream statuses/codes map to an explicit sanitized upstream fallback.

Existing Engine protocol strings and stored candidate error codes stay unchanged. Only the Gateway response boundary maps them to public numeric codes.

## 4. Backend Response and Error Flow

```text
request -> auth/schema checks -> controller -> existing service
                                       -> ApiSuccess<Payload>
known domain failure -> common error mapping -> status(literal, ApiFailure)
unknown failure -> structured log -> status(500, sanitized ApiFailure)
```

- Success constructors return the narrow `ApiSuccess<T>`, not `ApiResponse<T>`, to keep failure alternatives out of the 2xx response type.
- Failure constructors use Elysia `status(...)`. Do not use `set.status` plus an ordinary object in business routes.
- Introduce a common HTTP-facing domain error base with numeric public code, sanitized message, and supported HTTP status. Existing named domain classes can remain, backed by that base. Translate `EngineClientError` once at the boundary rather than changing the Engine transport.
- Existing result-returning services may keep their internal result convention. Controllers explicitly translate each success/failure branch, using stable domain reason identifiers where a service currently has only a human-readable error. Do not infer error codes from message strings.
- Consolidate repeated module error helpers into a typed Elysia error plugin registered before business routes. Installed Elysia supports typed `onError` return propagation; contract tests must prove scope/order through the actual `.use`/`.group` composition. Add explicit error response schemas where required, not unchecked casts.
- Normalize business-route authentication failures to the same 401 envelope without wrapping Better Auth's mounted handler.
- Reuse safe global logging for unhandled exceptions; preserve request ID, method/path, error cause, and process/background-task handling. Never expose arbitrary database/Redis/provider exception messages.
- Framework parse/validation errors retain the currently intended HTTP 400 behavior; explicit LLM service validation retains 422. Verify the actual assembled route behavior and align outdated spec examples as part of the contract update.
- Do not implement response unification solely in `onAfterHandle`, `mapResponse`, or a Proxy: runtime-only wrapping would conceal the contract from Eden and can damage non-JSON protocols.

## 5. Frontend Request Boundary

Add a reusable `request` helper in `apps/web/src/api/request.ts` and keep the Eden client in `api.ts`.

Target consumption:

```ts
const chart = await request(api['market-data']({ symbol }).kline.get());
const result = await request(api.tasks['data-collection'].get({
  query: { limit: pageSize, offset },
}));
```

The helper accepts a typed Eden request promise and infers its successful envelope payload. It returns `Promise<T>` without a caller-written generic, assertion, or DTO copy. Provide a payload-extraction utility for feature type aliases currently based directly on `TreatyResponse.data`.

Processing order:

1. Await the request; preserve intentional aborts without user feedback.
2. If Eden reports an HTTP error, normalize its status and envelope from `error.value`.
3. Validate the common envelope boundary; reject absent, malformed, or inconsistent envelopes as protocol errors rather than returning them as `T`.
4. Handle `success: false` defensively even if an upstream response incorrectly uses 2xx.
5. Return the successful payload, including legitimate `null`, zero, false, or empty arrays.

Use a common `ApiRequestError` carrying a failure kind, HTTP status when available, business code when available, a display-safe message, and cause. Network/protocol failures must not invent a server-issued business code. Retain fallback handling for non-JSON HTTP errors at this single boundary.

The common request layer is presentation-free. Feature components own inline errors and Ant Design messages; remove the current transport event side effect rather than introducing a second toast path. Move `getApiErrorMessage` out of the LLM feature into the common API layer and migrate its imports.

Direct `fetch` users move to Eden plus the same helper. Forward `AbortSignal` through Eden fetch options and preserve generation guards, non-overlapping polling, terminal-state stops, loading cleanup, action locks, and retry callbacks.

Static inference is not runtime data validation. Keep domain validation at cache/provider/persisted-JSON boundaries; type dynamic task progress DTOs there rather than casting unknown rows in components. Remove only guards and duplicate types whose sole purpose is compensating for the old response union. Do not discard chart safety or persisted-data normalization.

## 6. Compatibility and Rollout

Approved policy: replace the old business wire contract in one coordinated API/Web release, with no dual-shape adapter or `/v2` route set. Deploy and roll back the matching API/Web pair together.

Consequences that must be explicit:

- Raw successful DTOs move under `data`; string envelope codes become stable integers.
- Failed responses always carry `data: null`. Old error-side `taskId` and `conflict` fields disappear; public code/status communicate the failure, and task-list responses remain the source of active/persisted task identity.
- Refresh collection and LLM-selection lists after conflict or enqueue failures so the UI still exposes the active or compensated failed task. Update the existing LLM-selection spec that currently promises `taskId` inside the 409 body.
- Engine routes, queue payloads, database schema, provider contracts, auth SDK traffic, health success payloads, and stream frames are unchanged.
- Any external consumers of the old body shape or error-side IDs must migrate with the release; this compatibility break is explicitly accepted. Do not silently introduce a second protocol or weaken the four-field contract.

## 7. Engine Boundary

The source-backed assessment is recorded in `research.md`. Engine does not consume the business Gateway responses being changed: it receives private HTTP calls from `engineClient`, consumes Redis task messages, and reads/writes shared database/cache records directly.

Keep all five `/internal/*` endpoints, Engine `/health`, string LLM error codes, request bodies, service-token authentication, scheduler/worker queues, database records, and cache/progress formats unchanged. Do not add the public envelope to Engine or run numeric-code replacement across Python exception classes and persisted candidate errors.

Required API-side handling:

- Preserve raw Engine success DTO parsing, then construct the public envelope at the business controller boundary.
- Map `EngineClientError` string codes to the public code catalog in one place. Narrow its status before calling Elysia `status(...)`; recognized model/validation/provider/timeout failures retain their intended 404/422/502/504 public status.
- Normalize unknown/malformed internal responses to a sanitized upstream error. An Engine service-token 401 is an upstream integration failure (public 502), not a browser-session 401. Preserve explicit Engine unavailability as 503 when available. Do not display FastAPI internal `detail` bodies or unrecognized upstream messages verbatim.
- Keep the existing fail-soft reload/fetch helpers and configuration compensation behavior; the public-envelope refactor must not change their scheduling or background-notification semantics.
- Preserve the simulation result check: Engine can return HTTP 200 with `status: "error"`. Convert that rejected result to a sanitized public upstream failure, never `success: true`.
- Type/validate progress records at the Gateway's Redis read boundary, retaining worker field names and status values rather than altering Python writers.

Verification includes the existing Engine internal-router suite plus Gateway adapter/public-conversion tests. No Engine production-code modification or new deployment dependency is required.

## 8. Verification and Risk Controls

- Compile-time regression fixtures prove precise payload inference, success-only 2xx data, known error status/body types, body-less acknowledgements, and absence of `any` widening for representative endpoints.
- In-memory HTTP tests cover every mounted business route's success envelope with stubbed dependencies, plus each distinct error path and common authentication/parse/validation/unknown-error path.
- Client tests cover success, null payload, 2xx business failure, non-2xx envelope, malformed/non-JSON failure, network error, abort, and no duplicate notifications.
- Engine-boundary regressions keep raw internal success/error shapes intact and distinguish upstream service-auth failures from browser authentication; an internal simulation error must stay a public failure.
- Existing frontend tests retain stale-response, serial polling, modal retention on failure, action-lock, cancellation, retry-ID, and terminal-state behavior.
- Establish unrelated baseline failures before editing production files. Do not fix or hide them as part of this refactor.
- Preserve pre-existing uncommitted work through targeted patches; rollback applies only to changes owned by this task, never a repository-wide reset.
