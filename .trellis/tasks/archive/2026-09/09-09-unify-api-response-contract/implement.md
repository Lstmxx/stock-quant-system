# Implementation Plan

## Gate

- Status is `in_progress`; the user approved implementation after final scope review.
- Creation/planning consent was received on 2026-09-09.
- The coordinated breaking migration in `design.md`, including strict failure `data: null` and recovering task identity through list refreshes, is approved.
- Engine impact assessment and final scope review are complete (`research.md`, `design.md` section 7): no Engine production-code or internal-protocol change is required. The task was started after approval.
- Inline Codex execution: implementation and checking stay in the main session; no implement/check sub-agents or JSONL dispatch setup.

## 1. Establish Baseline and Contracts

- [x] Load `trellis-before-dev` for API and Web and read the applicable error, logging, workflow, type-safety, and quality specs.
- [x] Load Elysia, React, React performance, Better Auth, and Ant Design guidance for touched code; keep technology-specific work within this task's response boundary.
- [x] Record existing dirty/untracked paths and baseline API tests, Web tests/build, and type-check results; do not overwrite unrelated edits.
- [x] Complete an endpoint/status/code matrix using `research.md`, including commands, validation, auth, unknown errors, and special-protocol exclusions.
- [x] Add the browser-safe contract leaf, named numeric code catalog, and package subpath export while preserving the current root export.
- [x] Add typed success/failure constructors and a common public domain error base. Keep success constructors narrow; callers acknowledge explicitly with null, and undefined is an internal error.
- [x] Add code-catalog and response-constructor unit tests.

Checkpoint: contract helpers compile independently and do not pull server initialization into the browser.

## 2. Prove Typed Error Integration

- [x] Extract/consolidate common error handling as a typed Elysia plugin with safe logging and explicit scope/order.
- [x] Update the business authentication macro's 401 body without altering mounted Better Auth SDK responses.
- [x] Migrate market-data error classes/routes first, preserving the existing untracked feature's business logic.
- [x] Add real route-composition and compile-time fixtures proving that success data does not include failure objects; verify global/framework errors as well as explicit route failures.
- [x] Verify literal HTTP status propagation; normalize broad Engine statuses before passing them to `status(...)`.
- [x] Cover the API's Engine conversion boundary: preserve internal string codes/raw DTOs, map known public errors, sanitize unknown/FastAPI failures, and do not expose upstream service-token 401 as a Web session 401.
- [x] Validate unchanged health/root/auth/native-response behavior with targeted tests.

Checkpoint: the vertical market-data slice proves the approach before migrating the other modules; do not deploy this intermediate state.

## 3. Migrate Remaining Business Producers

- [x] Migrate `config`, `watchlist`, and `strategy` route return values.
- [x] Keep strategy simulation's internal `status: "error"` rejection and map it to a public upstream failure; do not return a successful envelope for an Engine HTTP-200 error.
- [x] Migrate `task` routes, including progress, logs, failed-stock details, configuration rollback, start conflicts, cancel, and retry results.
- [x] Give outward task progress records a validated DTO at the Redis boundary; preserve existing worker field names and status semantics.
- [x] Migrate `factor` and `factor-selection`, retaining user scoping, selected-factor semantics, pagination, and failed-enqueue compensation.
- [x] Migrate `llm` and `llm-stock-selection`, consolidating known errors, retaining sanitized Engine errors, and translating legacy transport flags without rewriting persisted/Engine code fields.
- [x] Tighten only service result discriminants/domain reason identifiers needed for correct controller mapping; avoid unrelated business changes.
- [x] Cover all 42 mounted business routes and distinct failure reasons with in-memory HTTP tests and stubbed dependencies.

Checkpoint: business JSON has one outer contract; exceptions remain explicit, and no business `set.status` plus plain-error-object pattern remains.

## 4. Migrate Frontend Consumption

- [x] Add the inferred `request` helper, payload type extractor, common request error, and shared message accessor.
- [x] Add request-boundary runtime tests plus a dedicated no-emit type-check configuration that includes compile-time fixtures.
- [x] Remove custom-fetcher notification side effects while retaining credentials and normal fetch behavior.
- [x] Migrate all Eden callers and type aliases listed in `research.md`; remove envelope-compensation assertions and duplicated DTOs where inference suffices.
- [x] Migrate task progress, failed-stock detail, and retry direct-fetch paths through Eden; preserve abort signals and retry `taskId`/`stockCount` consumption.
- [x] Preserve market-data latest-request wins, serial polling, cancellation semantics, row locks, and loading/error cleanup.
- [x] Refresh active/persisted task lists after conflicts and enqueue failures to replace the old error-body ID contract.
- [x] Update hook/component mocks to realistic success/error envelopes; retain existing regression behaviors rather than merely weakening assertions.
- [x] Keep legitimate domain JSON/chart validation separate from transport decoding.

Checkpoint: business callers receive inferred payloads from one boundary and handle display errors without parsing transport shapes.

## 5. Verify, Document, and Review

- [x] Load `trellis-check` and verify runtime contracts, inferred types, scope boundaries, logging safety, and code reuse directly.
- [x] Run targeted tests first, then API tests, Web tests, type-checks, and builds.
- [x] Run the existing Engine internal-router tests as a compatibility regression; leave Python production code, queue/cache formats, and the user's existing Engine edits untouched.
- [x] Search for remaining business direct-fetch calls, ad hoc envelope checks, `set.status` error returns, unchecked request casts, and feature-owned generic API error helpers.
- [x] Update `.trellis/spec/api/backend/error-handling.md` and add a concrete response-contract reference/index entry.
- [x] Update affected workflow signatures and Web type-safety guidance, including numeric wire codes, payload nesting, acknowledgement nulls, conflict list-refresh behavior, and protocol exclusions.
- [x] Keep existing unrelated spec additions, particularly market-data/cache work, intact.
- [x] Review the task-owned diff and summarize verification results and any pre-existing failures. Do not commit or archive unfinished work without the required user/workflow gates.

All implementation checkpoints are complete. See `verification.md` for exact results and the four unchanged baseline Web failures. Commit/archive remain deferred until requested.

## Planned Validation Commands

Run from the repository root unless the command changes directory. New test/config paths are to be created by the steps above.

```sh
cd apps/api && bun test src/lib/api-response.test.ts src/lib/engine-client.test.ts src/plugins/api-errors.test.ts tests/response-contract.test.ts
cd apps/engine && uv run pytest tests/test_internal_router.py -q
cd apps/web && bunx --no-install vitest run tests/api/request.test.ts tests/market tests/data tests/factor tests/llm tests/llm-selection
cd apps/web && bun run typecheck:contracts
cd apps/api && bun test
cd apps/web && bunx --no-install vitest run
cd apps/api && bunx --no-install tsc --noEmit -p tsconfig.json
bun run --cwd apps/api build
bun run --cwd apps/web build
git diff --check
```

Each `cd ... && ...` command is an independent invocation from the repository root. Use installed dependencies and the existing project tooling. Run existing lint tooling if configured; do not install a formatter or change unrelated compiler settings to suppress baseline failures. Engine verification is limited to the existing internal-router contract suite with mocked dependencies; no live Provider/market-data calls or full Engine/database migration work is part of this scope.

## Risk and Rollback Points

- `apps/api/src/index.ts`, market-data files, Web routing/dependency files, and some specs already contain user work. Never restore them wholesale.
- Do not import the production listening API entrypoint in tests or browser runtime code.
- Do not mistake `useTaskStream` for exempt SSE: it consumes ordinary JSON and must migrate.
- Do not apply the public envelope or numeric error catalog to private Engine responses, queue messages, worker progress, or persisted error records.
- Do not treat every `success`, `code`, or `data` field as transport metadata; preserve nested domain fields and pagination.
- Do not use Vitest success as evidence that compile-time inference fixtures passed.
- Do not deploy an API-only or Web-only contract change. Roll back matching release artifacts and task-owned patches together; database/Engine migrations are not part of this task.
