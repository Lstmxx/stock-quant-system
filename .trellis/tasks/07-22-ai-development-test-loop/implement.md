# Automated Testing Loop Implementation Plan

Status: Draft. Implementation must not start until the user reviews the planning artifacts and the task is explicitly activated.

## Proposed Task Map

The current task should remain the parent planning/integration task. Create child tasks only after planning approval so each deliverable can be implemented and verified independently:

1. `testing-foundation` — root commands, test environment, deterministic fixtures, and fast CI.
2. `playwright-e2e` — Playwright harness and MVP browser journeys.
3. `workflow-e2e-coverage` — factor/LLM asynchronous regression journeys.
4. `live-data-probes` — bounded Baostock canary and full-collection workflow.
5. `trellis-test-gate` — project testing spec and AI completion-gate integration.

## Phase A — Testing Foundation

- [ ] Add pinned root testing dependencies and stable root command names.
- [ ] Add a test environment template with synthetic auth, encryption, and internal-service secrets; ensure developer `.env` is not used accidentally.
- [ ] Add disposable PostgreSQL/Redis test Compose configuration with health checks and cleanup.
- [ ] Add an orchestration runner with `try/finally` teardown, actionable port/container errors, and captured service logs.
- [ ] Add fresh-database migration/reset and deterministic seed commands.
- [ ] Add a market-data provider boundary and checked-in small trading fixture; retain Baostock as the production default.
- [ ] Add a local OpenAI-compatible response stub or equivalent Engine test adapter for full-stack LLM flows.
- [ ] Add service integration tests proving migrations, Better Auth, API authorization, queueing, worker consumption, and terminal task persistence against real PostgreSQL/Redis.
- [ ] Add the GitHub Actions fast job and upload useful logs on failure.

Validation gate:

```bash
bun run verify:fast
bun run test:integration
```

Rollback point: all new test infrastructure is additive; production default provider selection and existing package tests must still pass without test-mode variables.

## Phase B — Playwright Tracer Bullet

- [ ] Add root Playwright configuration, ignored auth/output paths, and Chromium installation command.
- [ ] Configure application `webServer` lifecycle or connect Playwright to the repository orchestration runner.
- [ ] Add auth setup fixtures with unique run identities and non-committed `storageState`.
- [ ] Implement one vertical tracer: UI sign-up → protected `/data` route → reload/session assertion.
- [ ] Implement data-collection tracer: settings → start → active state → fixture-backed worker completion → details.
- [ ] Add accessible locators and only minimal explicit test IDs where Ant Design semantics are ambiguous.
- [ ] Configure HTML/CI reports, traces, screenshots, failed-video retention, `forbidOnly`, and `failOnFlakyTests`.
- [ ] Add the required PR E2E job with a hard time budget and artifact upload.

Validation gate:

```bash
bun run test:e2e -- --grep @smoke
bun run verify:full
```

Rollback point: disable/remove the E2E job without altering product behavior; deterministic provider seams must remain covered by unit tests.

## Phase C — Critical Workflow Coverage

- [ ] Add LLM model-management flow against the local OpenAI-compatible stub, including success and actionable failure.
- [ ] Add one factor-selection flow using fixed market/factor inputs and independently known expected ranks/contributions.
- [ ] Add one LLM stock-selection flow covering terminal result evidence with fake judgments.
- [ ] Add cooperative cancel/retry cases for the highest-risk asynchronous workflow.
- [ ] Add cross-user isolation and global collection conflict cases.
- [ ] Tag tests by capability (`@smoke`, `@regression`, `@data`, `@llm`, `@factor`) rather than by implementation file.
- [ ] Measure runtime/flakiness before enabling more workers, browsers, or shards.

Validation gate:

```bash
bun run verify:full
bun run test:e2e -- --grep @regression
```

## Phase D — Live Data Track

- [ ] Extract a bounded Baostock provider canary that logs in, requests one to three stable symbols for a small date range, and validates schema/freshness without full-market collection.
- [ ] Retain a separate full collection test with explicit long timeout, force-cache-bypass assertions, and isolated Redis/database state.
- [ ] Add `schedule` plus `workflow_dispatch` GitHub workflow, concurrency `1`, hard timeouts, and structured failure categories.
- [ ] Upload sanitized summaries/logs; do not upload cache payloads containing unnecessary market data.
- [ ] Keep paid LLM provider checks outside automation unless a future task defines budget, secrets, data-retention, and explicit authorization.

Validation gate:

```bash
RUN_REAL_DATA_INTEGRATION=1 bun run test:live:data
```

Rollback point: live workflow can be disabled independently; deterministic PR gates remain authoritative for product regressions.

## Phase E — Trellis / AI Completion Loop

- [ ] Add `.trellis/spec/guides/automated-testing.md` with the changed-path-to-gate matrix and anti-flake rules.
- [ ] Link the guide from the shared and relevant package spec indexes.
- [ ] Update planning templates/conventions so each acceptance criterion names its verification layer.
- [ ] Ensure `trellis-check` discovers and runs `verify:fast` or `verify:full` based on scope, then reports Playwright artifact paths.
- [ ] Require browser evidence for Web-visible/cross-layer behavior and regression tests for bug fixes.
- [ ] Document how an agent reruns one failed Playwright spec, opens the HTML report/trace, inspects screenshots, and distinguishes app failure from provider/infrastructure failure.
- [ ] Configure required GitHub status checks after the workflows have demonstrated stability.

Final validation gate:

```bash
bun run verify:full
git diff --check
```

## Review Gates Before Implementation

- [ ] User confirms the blocking vs scheduled policy for real Baostock tests.
- [ ] User approves the MVP browser journeys and proposed child-task split.
- [ ] CI time budget and artifact retention are accepted.
- [ ] No implementation starts until the parent PRD/design/implementation plan have passed convergence review and the first child task is activated.
