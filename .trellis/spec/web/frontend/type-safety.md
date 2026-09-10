# Type Safety

> Type safety patterns in this project.

---

## Overview

Web uses strict TypeScript and Eden's inferred `App` contract. Follow the shared
[API Response Contract](../../api/backend/api-response-contract.md) for all
business JSON; authentication SDK and native/stream protocols remain separate.

---

## Type Organization

Keep the client in `apps/web/src/api/api.ts`, response decoding/error normalization
in `api/request.ts`, and feature aliases beside their consumers. Import `App` and
backend DTOs only as types; runtime contract constants come from the pure
`@stock-quant/api/contracts` subpath, never the listening server entrypoint.

Derive DTOs with `ApiData` rather than copying API fields or extracting success
from an error-contaminated union in every feature:

```ts
type Task = ApiData<typeof api.tasks.get>[number];
type Model = ApiData<typeof api.llm.get>[number];
```

UI-only state and form inputs may use local interfaces. Domain-normalized types
can refine a wire DTO with `Omit`/`Pick` without duplicating the entire structure.

---

## Validation

`request(...)` validates the outer four-field envelope once, handles Eden HTTP
errors and defensive 2xx business failures, and returns inferred success data.
It accepts legitimate null, false, zero, empty strings, and empty arrays.

Domain validation is distinct: chart data is checked for finite/sorted values
before reaching lightweight-charts via `request(operation, isMarketKlineData)`;
persisted selection statuses are validated by `normalizeLlmSelectionTask`.
Do not remove these checks merely because transport unwrapping is centralized.

---

## Common Patterns

```ts
try {
  const payload = await request(api.tasks['data-collection'].get());
  setTasks(payload.items);
} catch (error) {
  message.error(getApiErrorMessage(error, '加载任务失败'));
}
```

`ApiRequestError` exposes `kind`, HTTP `status`, and numeric business `code`.
Local network/protocol errors have no invented server code. Preserve aborts and
pass `fetch: { signal }` through Eden polling requests. Keep request generations,
terminal stopping, serial timers, and action/loading cleanup in their owning hook.

UI owns messages; the request layer must not dispatch global notification events.
After conflict/enqueue failure, refresh task history instead of expecting an
error-side task ID. Modal callbacks close only after successful requests.

Run `bun run typecheck:contracts` in `apps/web` as well as the application build:
the dedicated config includes `tests/api/request.types.ts`. Vitest transpilation
does not prove generic inference. HTTP/hook mocks use the complete envelope from
`tests/helpers/api-response.ts`, not the old raw-payload response shape.

---

## Forbidden Patterns

- No caller-written response generic or cast such as `as LlmModel[]` to force a
  business request into the desired type.
- No repeated `response.error`, `'items' in data`, or `data.success` transport
  branching in feature consumers; call `request` and catch a normalized error.
- No business `fetch(...).json()` bypass, truthiness-based success detection,
  duplicated feature-owned generic error helper, or broad runtime server import.
- No assumption that a single `success: boolean` plus `data: T` represents both
  success and failure safely: the shared union correlates false with null.
