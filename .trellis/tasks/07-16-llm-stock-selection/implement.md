# LLM Stock Selection Implementation Plan

## 1. Database contract

- [x] Add Drizzle types/tables for `llm_stock_selection_results` and
      `llm_stock_selection_attempts`.
- [x] Add the per-user active `LLM_STOCK_SELECTION` partial unique index on
      `alpha_tasks`.
- [x] Add indexes, foreign keys, uniqueness, defaults, and the forward SQL
      migration plus Drizzle metadata.
- [x] Add database tests for schema shape, active uniqueness, cascades, attempt
      uniqueness, and nullable/required result fields.

Validation:

- `bun test packages/database/tests`
- `bun --cwd packages/database run db:generate` only when intentionally
  regenerating migration metadata; review generated SQL before keeping it.

Rollback point: migration and schema-only commit boundary; no runtime code may
query the tables until this gate passes.

## 2. Engine quantitative snapshot domain

- [x] Add typed/versioned domain objects for universe disposition, exclusions,
      technical indicator snapshot, recent bars, and candidate input.
- [x] Refactor/reuse `FactorExposureService` so existing factor-selection math
      remains the single owner of direction, z-score, percentile, weights, and
      composite score.
- [x] Implement latest-complete-data-date resolution, frozen main-board universe
      accounting, per-stock exclusion reasons, and 90%/Top-M coverage gates.
- [x] Implement `market-technical/v1` indicators and finite/null normalization.
- [x] Build candidate union from quantitative Top M plus frozen watchlist,
      deduplicate deterministically, and enforce the resolved 150 cap.
- [x] Persist all-universe rows and bounded candidate input snapshots in batches.

Tests first/alongside implementation:

- fixed market matrices for data-date resolution and all indicator values
- weekend/non-trading server date regression
- factor calculation reuse and deterministic rank
- eligible/excluded accounting and stable failure codes
- 89.9% failure versus 90% success boundary
- ineligible watchlist handling, union deduplication, and 150/151 boundaries
- latest-20-row bound and version fields

Validation:

- `uv run pytest apps/engine/tests/test_factor_exposure_service.py`
- `uv run pytest apps/engine/tests/test_llm_stock_selection_snapshot.py`
- `uv run ruff check apps/engine/app/core apps/engine/tests`

Rollback point: new snapshot services remain unused by the worker until their
tests pass and existing factor-selection tests stay green.

## 3. Engine LLM runner, attempts, ranking, and cancellation

- [x] Add Pydantic judgment/v1 schema and prompt builder with the fixed 20-day
      rubric and bounded field rules.
- [x] Add a persistence repository for result rows, attempt history, usage, and
      transactional ranking projection.
- [x] Implement bounded candidate dispatch using the existing user/model config
      loader and `LiteLLMClient`; do not add a second Provider retry loop.
- [x] Add cancellation checkpoints that stop new submissions and mark not-run
      candidates audibly.
- [x] Implement completed/partial/failed/cancelled terminal-state matrix.
- [x] Implement retry mode that reuses persisted input snapshots, appends
      attempts, and recomputes ranking.
- [x] Add `LLM_STOCK_SELECTION` handling to `worker.py` without falling through
      to factor mining.

Tests:

- strict JSON/schema success and every invalid boundary
- no fabricated defaults after invalid output
- provider failure isolation and token aggregation
- deterministic score/rank/symbol ordering
- finalTopN status threshold
- bounded dispatch and cancellation before/during execution
- retry uses frozen input and increments attempt history
- deleted/foreign model fails closed
- worker dispatch selects the new runner and writes the correct terminal state

Validation:

- `uv run pytest apps/engine/tests/test_llm_stock_selection_runner.py`
- `uv run pytest apps/engine/tests/test_worker_mining.py`
- `uv run pytest apps/engine/tests/test_litellm_client.py apps/engine/tests/test_llm_config_loader.py`
- `uv run ruff check apps/engine/app apps/engine/tests`

Rollback point: feature queue type can be disabled while leaving persisted
planning rows readable; no API create route is enabled before this gate passes.

## 4. API service and routes

- [x] Add Elysia schemas/types for create, pagination, result views, cancel, and
      retry subset requests.
- [x] Implement create-time current-user model validation, factor-set snapshot,
      watchlist snapshot, active-task pre-check, unique-race mapping, persistence,
      FIFO enqueue, and enqueue-failure compensation.
- [x] Add user-scoped list/detail/result/stock-detail projections with one
      central JSONB decoder and no consumer-local casts.
- [x] Add cancel and retry-failed services with terminal/active checks and
      actionable model-deleted behavior.
- [x] Register `/llm-stock-selections` in the API root.
- [x] Extend LLM deletion reference checks for active LLM selection tasks while
      allowing historical results to survive deletion via stored metadata.
- [x] Retire or clearly isolate any overlapping background behavior in the old
      single-stock analysis service; do not break its public contract.

Tests:

- input bounds and integer validation
- default/explicit/foreign/deleted model behavior
- snapshot of sorted factor IDs and watchlist symbols
- per-user active conflict including concurrent insert race
- queue FIFO and enqueue compensation
- all list/detail/result paths enforce user isolation
- selected/all/failed filters, pagination, and stable ordering
- cancel/retry validation and subset ownership
- LLM delete conflict for active reference

Validation:

- `bun test apps/api/src/modules/llm-stock-selection`
- `bun test apps/api/src/modules/llm apps/api/src/modules/factor-selection apps/api/src/modules/task`
- `bun --cwd apps/api run build`

Rollback point: remove module registration to stop new tasks while retaining
readable database records and worker compatibility.

## 5. Web feature

- [x] Add shared typed projections for task summary, result rows, attempts,
      input snapshots, and API errors.
- [x] Add a dedicated route/navigation entry and lazy-loaded LLM selection page.
- [x] Build the creation modal with model/default selection, Top M, final Top N,
      lookback, factor/watchlist summaries, main-board copy, and call estimate.
- [x] Keep the modal open with values preserved on failed submission; link
      missing models to model management.
- [x] Build serial, terminal-aware task polling and active-task conflict/cancel
      handling.
- [x] Build history table and Selected/All/Failures result views with pagination.
- [x] Build stock evidence drawer for judgment, recent bars, indicators, factor
      contributions, source tags, failures, usage, and attempt history.
- [x] Add single and batch retry with row-level loading, duplicate prevention,
      visible errors, and accessible icon labels.

Tests:

- modal defaults/bounds and model preselection
- call estimate/watchlist display and missing-model path
- failed create preserves form/modal
- polling has no overlap, ignores stale responses, and stops at terminal state
- result tab filtering and trusted-field rendering
- cancel copy reflects `CANCELLING`
- single/batch retry states and errors
- user-visible failure reasons and exclusion details

Validation:

- `bunx vitest run apps/web/tests/llm-selection`
- `bun --cwd apps/web run build`
- `antd lint apps/web/src/features/llm-selection`

Rollback point: remove route/navigation entry while API/worker remain backward
compatible and existing factor pages continue to build.

## 6. Cross-layer integration and final gate

- [x] Trace one fixed task through modal payload, API params, Redis payload,
      Engine snapshot, persisted results, API projection, and Web rendering.
- [x] Verify schema/version names, status labels, candidate/source enums, error
      stages/codes, date format, and token fields match in every layer.
- [x] Verify no layer uses server-calendar date as the result data date.
- [x] Verify no prompt/response consumer casts raw JSONB fields locally.
- [x] Verify user isolation, model deletion behavior, cancellation, retry, and
      active uniqueness against concurrent cases.
- [x] Run the full relevant regression gate without real Provider calls.

Final validation:

- `bun test packages/database/tests`
- `bun test apps/api/src`
- `bun --cwd apps/api run build`
- `uv run pytest`
- `uv run ruff check apps/engine/app apps/engine/tests`
- `bunx vitest run apps/web/tests`
- `bun --cwd apps/web run build`
- `antd lint apps/web/src/features/llm-selection`
- `git diff --check`

## 7. Documentation and review gate

- [x] Update the factor, LLM, data-collection, database, Engine, API, and Web
      specs with the final cross-layer contracts learned during implementation.
- [x] Run `trellis-check` after implementation.
- [x] Review migration SQL, changed-file scope, test evidence, and rollback shape.
- [ ] Do not run `task.py start` until the user reviews and approves `prd.md`,
      `design.md`, and `implement.md`.
