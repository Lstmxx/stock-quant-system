# 统一 API 响应契约与前端类型安全调用

## Goal

Make ordinary business API calls return a consistent, type-safe response contract so frontend callers receive their business payload without repeating transport-shape checks, while preserving existing workflows and meaningful failure handling.

## Background

- The user requested a refactor following the API response and Eden type-inference discussion, and approved creating this task and entering planning on 2026-09-09.
- The user accepted the coordinated compatibility break and requested an Engine impact assessment before implementation.
- Market-data routes currently return raw success payloads but a different error shape, with HTTP status assigned through `set.status` (`apps/api/src/modules/market-data/index.ts:9`).
- Market-data consumers compensate with shape guards and an `unknown` annotation (`apps/web/src/features/market/hooks/use-market-data.ts:52`, `apps/web/src/features/market/hooks/use-market-data.ts:85`).
- The mounted `/api` business group contains nine modules and 42 JSON routes (`apps/api/src/index.ts:84`). The full producer/consumer inventory and supporting evidence are in `research.md`.
- The requested Engine impact assessment found no need to change Python production code or its internal HTTP protocol; the Gateway owns the public conversion. Source evidence and boundary regressions are recorded in `research.md`.
- The workspace contains pre-existing edits and untracked market-data implementation/tests; these must be preserved.

## Requirements

- R1: All mounted business JSON responses use the same `success`, numeric `code`, `message`, and `data` fields. Success uses code `0` and carries the endpoint payload or an explicit null acknowledgement. Failure uses a stable nonzero code and null data; the success flag and data availability must remain correlated in TypeScript.
- R2: Preserve meaningful HTTP status codes and expose success/error alternatives to Elysia/Eden's type system. Do not report errors as successful HTTP requests merely to simplify clients.
- R3: Centralize frontend response unwrapping and error normalization while retaining inferred endpoint payload types. Business callers should not supply response generics, assertions, or shape checks to distinguish transport success from failure.
- R4: Migrate all affected producers, Eden/direct-fetch consumers, type aliases, and tests together. Preserve user scoping, pagination, task IDs on successful commands, cancellation, retry callbacks, non-overlapping polling, aborts, stale-response protection, and loading/action-lock cleanup.
- R5: Keep dedicated authentication, health-check, root, and streaming protocols compatible. Business-route authentication failures still participate in the business error contract. Do not re-enable retired Analysis routes.
- R6: Retain safe public errors, structured server logging, and runtime validation where external or untrusted data actually requires it. Error messages remain actionable, and the common transport layer must not create duplicate UI notifications.
- R7: Under the approved coordinated migration, preserve access to active/failed task identity by refreshing task lists after conflict or enqueue failure. This intentionally replaces existing error-side task ID contracts (`.trellis/spec/api/backend/llm-stock-selection-workflow-contract.md:23`, `.trellis/spec/api/backend/data-collection-workflow-contract.md:23`).
- R8: Keep the inspected API/Engine boundary compatible: internal HTTP successes/error strings, service authentication, Redis queues/progress, and database contracts remain unchanged. The Gateway maps internal failures to public errors without treating Engine service-auth failures as browser-auth failures or internal simulation errors as public successes.

## Acceptance Criteria

- [x] AC1 / R1: Every mounted business route has a tested success envelope; each distinct failure path exposes all four fields with false, a registered nonzero code, a safe message, and null data. Code assignments are unique and acknowledgements do not omit data.
- [x] AC2 / R2: Compile-time and HTTP tests prove success-only 2xx data and intended 400/401/404/409/422/5xx error statuses, including validation, authentication, domain, and unknown failures.
- [x] AC3 / R3: Request-helper type fixtures infer array, paginated, object, and null payloads without caller-supplied generics/assertions and reject incompatible assignments. Runtime tests cover malformed/non-JSON responses, business failures, network errors, and aborts.
- [x] AC4 / R4: Existing and migrated tests retain serial polling, latest-request wins, retry-ID delivery, terminal-state stop, cancellation, modal retention on failure, and action-lock behavior. No business caller bypasses the common response boundary.
- [x] AC5 / R5: Authentication protocol endpoints, health checks, root text, and established stream/native-response bodies retain their dedicated formats; retired Analysis stays unmounted.
- [x] AC6 / R6: Unknown failures do not expose infrastructure details; domain-data validation is not replaced by unchecked assertions; one failed action does not gain duplicate notifications.
- [x] AC7 / R7: Conflict/queue-failure tests show the task list still exposes the relevant active or persisted failed task, and updated specs state the approved replacement for error-side IDs.
- [x] AC8 / R8: Existing Engine internal-router tests retain their raw DTO/string-code expectations; Gateway regression tests cover known and unknown upstream errors, internal-auth failures, and HTTP-200 simulation failure. No Python production-code, queue, or database migration is introduced by this task.

Implementation evidence and unchanged baseline failures are recorded in `verification.md`. Code/spec work is complete; commit/archive steps remain user-controlled.

## Out of Scope

- Trading, collection, selection, or authentication feature changes.
- Database migrations, Engine/queue/provider response redesign, new dependencies, pagination redesign, or blanket HTTP-200 error handling.
- Renaming stock codes, persisted candidate error identifiers, worker success counters, or other nested domain fields to resemble the outer envelope.
- Reverting or cleaning up unrelated existing work.

## Approved Compatibility

Migrate API and Web together without a legacy response adapter or versioned route set. Failures carry null data; callers recover active/persisted task identity through list refreshes instead of error-side IDs. The user accepts that any external clients of the old business protocol must migrate as well.

## Planning Artifacts

- `research.md`: route/caller inventory, framework evidence, existing contracts, and validation facilities.
- `design.md`: response/error boundaries, code policy, type propagation, client behavior, approved compatibility strategy, and Engine impact.
- `implement.md`: ordered changes, checks, ownership precautions, and rollout/rollback gates.

The user approved the final scope and requested implementation. Task status is `in_progress`; the compatibility decision and Engine impact assessment are resolved.
