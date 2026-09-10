# Response Contract Inventory

## Baseline

- Branch: `refactor`; task created on 2026-09-09.
- Elysia is pinned to `1.4.29`, Eden to `1.4.9` in the root package overrides.
- Frontend consumes `App` through a type-only import and constructs `treaty<App>` (`apps/web/src/api/api.ts:1`, `apps/web/src/api/api.ts:24`).
- No existing shared business response envelope was found.
- Existing changes include API registration, the untracked market-data module and frontend feature/tests, collection/Engine fixes, navigation/styles, dependency metadata, and other tasks. They are not a clean baseline to reset or replace.

## Mounted Business Routes

The `/api` group in `apps/api/src/index.ts:84` mounts nine modules containing 42 ordinary JSON routes.

| Module | Routes | Current response families |
| --- | --- | --- |
| `config` | 2 | Raw records/list; upsert result |
| `watchlist` | 3 | Raw records/list; delete result |
| `task` | 13 | Arrays, paginated objects, config, command results, progress, failures, logs; several `set.status` branches |
| `factor` | 3 | Paginated `{ data, total }`, selection state, legacy command result |
| `factor-selection` | 3 | Legacy command result, paginated history, detail/not-found |
| `strategy` | 3 | Factor recommendations, simulation DTO, parsed report JSON |
| `llm` | 6 | Model DTOs/list, delete acknowledgement, connection result; typed `status(...)` errors |
| `llm-stock-selection` | 7 | Command results, history, detail/results; mixed `set.status` and `status(...)` errors |
| `market-data` | 2 | Search array and K-line DTO; `set.status` error helper |

The four routes in `modules/analysis/index.ts` are not mounted. Do not migrate or re-enable that retired capability.

## Type-Inference Evidence

- `apps/api/src/modules/market-data/index.ts:9` returns an ordinary failure object after mutating `set.status`; success returns the raw service value.
- `apps/api/src/modules/llm-stock-selection/index.ts:15` repeats this pattern with an `error` string and optional `taskId`.
- `apps/api/src/modules/llm/index.ts:12` uses typed `status(...)`, but its body differs from other modules.
- Installed Elysia `dist/index.d.ts:1045` records `onError` return types using `ElysiaHandlerToResponseSchema`; a typed hook is usable, provided scope/order and status literals are preserved through actual module composition.
- Installed Eden `dist/treaty2.d.ts:79` separates 2xx `data` from non-2xx `error.value` according to the route status map.
- Official references consulted: `https://elysiajs.com/essential/handler.md` and `https://elysiajs.com/eden/treaty/response.md`. `set.status` does not associate the returned body with a status at the type level; `status(...)` does.
- A success builder must return `ApiSuccess<T>`, not the wider `ApiResponse<T>`, otherwise the success status can still acquire an error alternative.

## Frontend Migration Inventory

Transport and common types:

- `apps/web/src/api/api.ts`
- `apps/web/src/features/data/types.ts`
- `apps/web/src/features/factor/types.ts`
- `apps/web/src/features/market/types.ts`
- `apps/web/src/features/llm/types.ts`
- `apps/web/src/features/llm-selection/types.ts`
- `apps/web/src/features/llm/api-error.ts`

Current Eden callers:

- `features/market/hooks/use-market-data.ts`
- `features/data/hooks/useTasks.ts`
- `features/data/components/DataCollectionConfigModal.tsx`
- `features/factor/hooks/useFactors.ts`
- `features/factor/hooks/useFactorSelections.ts`
- `features/factor/hooks/useFactorTasks.ts`
- `features/factor/hooks/useTaskLogsPolling.ts`
- `features/factor/components/FactorSelectionResultModal.tsx`
- `features/factor/components/FactorTaskConfigModal.tsx`
- `features/factor/FactorSelectionPage.tsx`
- `features/llm/hooks/useLlmModels.ts`
- `features/llm/components/LlmModelFormModal.tsx`
- `features/llm-selection/hooks/use-llm-stock-selections.ts`
- `features/llm-selection/components/llm-selection-result-modal.tsx`
- `features/llm-selection/LlmStockSelectionPage.tsx`

Direct-fetch callers that must not be missed:

- `apps/web/src/features/data/hooks/useTaskStream.ts:37` polls JSON progress; despite its name, this is not a streaming protocol. Preserve its `AbortSignal`, generation checks, serial scheduling, and terminal-state stop.
- `apps/web/src/features/data/components/TaskDetailModal.tsx:40` fetches failed stocks; line 67 posts retry requests and consumes `taskId`/`stockCount` on success.

`api.ts` emits `api-error` events in its custom fetcher. No current listener was found in `apps/web/src`; error presentation already lives in feature hooks/components. The new common request layer should not introduce additional global toasts.

## Compatibility Findings

- The Better Auth macro returns a body-less `status(401)` (`apps/api/src/plugins/auth.ts:34`). Business-route authentication failures need the business envelope; mounted Better Auth SDK endpoints must remain untouched.
- `/health/live`, `/health`, and `/` have dedicated non-envelope success responses (`apps/api/src/index.ts:70`).
- `apps/web/src/hooks/useSSE.ts` uses native `EventSource`. It is not a consumer to wrap in the JSON request helper.
- Live global error handling currently intends parse/validation HTTP 400, route-not-found 404, and unknown failures 500 (`apps/api/src/index.ts:38`). Explicit LLM configuration validation uses 422. Older factor specs contain 422 expectations; full-composition tests must establish and document the effective behavior rather than changing it incidentally.
- Collection errors can contain `conflict` and `taskId` (`apps/api/src/modules/task/service.ts:254`). The data UI already refreshes its task list after a failed start (`apps/web/src/features/data/hooks/useTasks.ts:77`).
- LLM-selection active-conflict `taskId` is an explicit existing contract (`.trellis/spec/api/backend/llm-stock-selection-workflow-contract.md:23`). Strict failure `data: null` removes that error-side field; clients must refresh the list and use its `activeTask` instead. The user explicitly accepted this compatibility change after reviewing the proposal.
- Persisted candidate errors, stock codes, worker `success` counters, queue payloads, and Engine error codes are business data, not envelope fields. Do not rename or numerically convert them globally.
- Existing pagination DTOs differ (`items` versus `data`). Preserve those payloads inside the new envelope instead of expanding this work into pagination redesign.
- Repository searches found no Engine or shared-package consumer of the business Gateway routes. This does not establish the absence of external clients; the user accepted the coordinated breaking migration with that limitation explained.

## Validation Facilities

- API uses Bun tests in `src/**/*.test.ts` and `tests/config.test.ts`; service tests commonly use spies and restore mocks.
- Web uses Vitest/jsdom, configured in `apps/web/vite.config.ts`, with tests under `tests/`.
- Existing coverage includes data polling/cancellation, factor workflows/log polling, LLM actions, LLM selection, authentication, and market-data race handling.
- Web TypeScript configuration currently includes `src`, not test fixtures. Compile-time request-inference assertions need an explicit no-emit test configuration; passing Vitest alone does not verify them.
- Route contract tests should construct in-memory Elysia instances and stub external services/session lookup, not import the listening production entrypoint or invoke real jobs/providers.

## Engine Impact Assessment

Requested after compatibility approval. Conclusion from source inspection: no Engine production-code or internal-response-format change is required for this refactor. The API must continue translating the internal protocol into its new public response contract.

### Communication Direction

- Web constructs an Eden client for the Gateway; no Engine URL, port, or `/internal/*` call was found in Web source.
- API-to-Engine HTTP is centralized in `apps/api/src/lib/engine-client.ts:67`, using `ENGINE_URL`/`PORT_ENGINE` and the internal Bearer token.
- Engine registers health plus the internal router (`apps/engine/app/main.py:42`), not Gateway business endpoints. All five internal endpoints share service-token authentication (`apps/engine/app/routers/internal.py:26`).
- Engine source/config contains no Gateway HTTP client or callback URL. Worker task results are persisted directly (`apps/engine/app/worker.py:21`), tasks arrive through Redis `BLPOP` (`apps/engine/app/worker.py:217`), and the scheduler queues work with `RPUSH` (`apps/engine/app/scheduler.py:113`).
- LLM configuration is read directly from PostgreSQL with owner/model scoping (`apps/engine/app/core/llm_config_loader.py:27`), not through the public `/api/llm` endpoint.

### Existing Internal HTTP Contracts

| Endpoint | Current internal response | Gateway impact |
| --- | --- | --- |
| `POST /internal/llm/chat` | Raw `{ content, provider, model, usage }`; known failures use `{ code: string, message }` and non-2xx status | Keep the DTO and string error protocol; map errors to numeric public codes at the Gateway |
| `POST /internal/llm/test` | `{ success: true, provider, model }`; same LLM errors | Translate the acknowledgement at the public controller boundary, without changing Engine |
| `POST /internal/reload-config` | `{ status: "ok", message }`; failures use FastAPI `detail`/HTTP 400 | Preserve `reloadConfig(): Promise<boolean>` and configuration rollback behavior |
| `POST /internal/fetch-data` | Immediate `{ status: "accepted", symbol, message }`; completion uses Redis publication | Preserve fail-soft triggering and `data_ready:{symbol}` notifications |
| `POST /internal/simulate-factor` | HTTP 200 with `{ status: "ok", data }` or `{ status: "error", message }` | Preserve the existing business-failure check; an internal error must not become a successful public envelope |
| `GET /health` | `{ status: "ok", service: "stock-quant-engine" }` | Leave health checks outside the business envelope |

Evidence: `apps/engine/app/routers/internal.py:83`, `:111`, `:125`, `:146`, `:162`, `:245`; `apps/engine/app/routers/health.py:6`.

### Adapter and Error Considerations

- `EngineClientError` intentionally exposes internal string codes and a broad numeric status (`apps/api/src/lib/engine-client.ts:51`). Preserve that private protocol and translate/narrow it before constructing Elysia public errors.
- Known LLM statuses are currently 404, 422, 502, and 504 (`apps/engine/app/routers/internal.py:83`). Preserve the meaningful known-domain mappings and map unknown internal bodies/codes to a sanitized upstream error.
- Internal service-token failures use HTTP 401/503 and FastAPI `{ detail }`, not the LLM error body. When handling `EngineClientError`, an Engine service-auth 401 must not masquerade as a Web session-auth 401; use a public upstream failure instead, and do not expose internal detail bodies.
- Simulation returns an internal HTTP-200 error alternative (`apps/engine/app/routers/internal.py:287`). `StrategyService.simulateFactor` already rejects it; retain that check and convert the rejection through the common public error mapping rather than blindly wrapping the internal response.
- Progress records are Redis JSON written by Engine, not HTTP envelopes. Validate/normalize their outward DTO in the API read boundary without rewriting Engine worker fields or existing collection fixes.

### Boundary Regression Coverage

- Existing `apps/api/src/lib/engine-client.test.ts:59` verifies raw LLM success; line 83 verifies string-coded Engine failures. Retain these tests and add public conversion coverage without changing their private wire expectations.
- `apps/engine/tests/test_internal_router.py:84` asserts the exact raw chat DTO; line 138 asserts the existing string error code. Run the targeted internal-router test file during implementation verification to detect accidental protocol drift.
- Add API-side cases for internal-auth errors, FastAPI/non-JSON/unknown upstream failures, known LLM status/code mapping, and simulation HTTP-200 business failure.
- Do not run real market-data fetching or Provider calls for this boundary check. No Python production-code patch or database/queue migration is planned.

This assessment is based on source and existing test inspection; tests have not been executed during planning.
