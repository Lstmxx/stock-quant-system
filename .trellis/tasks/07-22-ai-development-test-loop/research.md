# Automated Testing Loop Research

Date: 2026-07-22

## 1. Repository Baseline

### Architecture and runtime

- The product path is a React/Vite Web app, Elysia/Bun API, FastAPI/Python Engine, PostgreSQL, and Redis (`README.md`, `CONTEXT-MAP.md`).
- Git remote `origin` is GitHub, so GitHub Actions and required status checks are the natural CI integration point.
- Local infrastructure exists in `docker-compose.example.yml`, but it is development-oriented: it has no test-specific database, Redis namespace, health checks, or automatic cleanup.
- There are no application Dockerfiles and no `.github/workflows/` files. CI must therefore install Bun and uv, run the application processes on the runner, and provision only PostgreSQL/Redis through containers.

### Existing automated tests

- API/database: 19 files, 57 Bun tests; current suite passed in about 0.35 seconds.
- Web: 10 files, 36 Vitest/Testing Library tests; current suite passed in about 4 seconds.
- Engine: 21 files, 59 Pytest tests; 58 passed and one real-data test was skipped in about 4.4 seconds.
- Web and API production builds pass; Engine Ruff passes. Running these checks concurrently completes in roughly 6 seconds on the current machine.
- `antd lint apps/web/src --only a11y --format json` currently reports no accessibility findings.
- The repository README documents package-level commands, but root `package.json` exposes only development commands. There is no single stable command that an AI agent or CI runner can use as the completion gate.

### Important gaps

- No Playwright dependency, configuration, E2E directory, browser-flow tests, or browser artifacts exist.
- Most API tests mock database/Redis collaborators, and most Web tests mock API/auth modules. They validate local contracts but do not prove Web → API → PostgreSQL/Redis → Engine behavior.
- The only live-data test is `apps/engine/tests/test_data_fetch_integration.py`. It is opt-in through `RUN_REAL_DATA_INTEGRATION=1`, uses real Redis and Baostock, and permits a 1,200-second wait.
- That live test requests one symbol but calls `DataLoader.load_latest()`, which can fetch the full market. It is unsuitable as a per-PR completion gate and should be split into a bounded provider canary and a separate full-collection exercise.
- `DataLoader` imports and calls Baostock directly. A deterministic full-stack E2E mode needs a project-owned market-data adapter or fixture-provider seam; browser-level API mocking would bypass too much of the system.
- LiteLLM already has a project-owned adapter and injectable completion function for unit tests. Full-stack tests should point an `openai_compatible` model at a local deterministic stub, never a paid provider.

## 2. Community and Official Practice

### Playwright

Sources:

- [Best Practices](https://playwright.dev/docs/best-practices)
- [Web server](https://playwright.dev/docs/test-webserver)
- [Authentication](https://playwright.dev/docs/auth)
- [Parallelism](https://playwright.dev/docs/test-parallel)
- [Retries](https://playwright.dev/docs/test-retries)
- [Trace Viewer](https://playwright.dev/docs/trace-viewer-intro)
- [Sharding](https://playwright.dev/docs/test-sharding)
- [CI](https://playwright.dev/docs/ci-intro)

Relevant recommendations:

- Assert user-visible behavior through accessible, user-facing locators and web-first assertions.
- Keep tests isolated; shared server-side state requires unique accounts/data per worker.
- Control database contents and avoid making third-party services part of ordinary browser tests.
- Use `webServer` to launch one or multiple application processes, `baseURL` for stable navigation, and `reuseExistingServer: !process.env.CI` for local convenience without weakening CI isolation.
- Reuse authenticated state only when tests do not mutate shared state; otherwise use a unique account per worker. Never commit `storageState` because it may contain impersonation-capable cookies.
- Configure CI retries only for diagnosis, enable `failOnFlakyTests`, and retain a trace/screenshot on failure so a retry cannot silently turn a flaky test green.
- Start with a small browser/project matrix and add sharding only after data isolation makes parallelism safe.

### GitHub Actions

Sources:

- [PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)
- [Redis service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-redis-service-containers)
- [Workflow events (`schedule`, `workflow_dispatch`)](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

Relevant recommendations:

- PostgreSQL and Redis service containers should have explicit health checks and run on Linux runners.
- Pull-request checks, scheduled live probes, and manually dispatched deep tests can be separate workflows with different blocking semantics.
- Playwright HTML/trace results should be uploaded as artifacts even when a test fails, while treating those artifacts as potentially sensitive.

### Mature open-source configurations

- [Cal.com `playwright.config.ts`](https://github.com/calcom/cal.com/blob/main/playwright.config.ts) uses application `webServer` processes, CI-only retries, `forbidOnly`, multiple reports, explicit timeouts, and separate projects.
- [Immich E2E `playwright.config.ts`](https://github.com/immich-app/immich/blob/main/e2e/playwright.config.ts) starts a Docker Compose environment from Playwright, constrains workers for shared-state projects, and records traces/screenshots on failure.
- These examples support an incremental approach: one deterministic environment, conservative workers first, diagnostic artifacts, then broader projects/parallelism.

### Disposable dependency environments

- [Testcontainers for Node.js](https://node.testcontainers.org/) and [Testcontainers Python](https://github.com/testcontainers/testcontainers-python) provide throwaway database/service containers for integration tests.
- Testcontainers is a strong option for package-owned integration tests. It is not the recommended first orchestrator here because the repository has two runtimes plus a browser runner; independently managed Node and Python container lifecycles would duplicate setup. A shared test-only Docker Compose file gives the full stack one lifecycle and matches the Immich pattern.

### Recorded external responses

- [VCR.py](https://vcrpy.readthedocs.io/) records and replays HTTP interactions for deterministic offline tests.
- It can help future HTTP-based market-data or LLM adapters, after secret filtering. It does not directly solve the current Baostock boundary, which is called through the Python SDK; checked-in project-owned market fixtures are the more explicit fit.

## 3. Options Considered

| Option | Confidence | Speed | External flake | Cross-layer coverage | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| Browser tests mock `/api/*` responses | Medium | Fast | None | Low | Keep only for rare UI-only cases; not the primary E2E path |
| Full app stack with real PostgreSQL/Redis and deterministic external adapters | High | Moderate | Low | High | Recommended blocking path |
| Full app stack with live Baostock/paid LLM on every PR | Misleading | Slow | High | High when available | Reject as the normal completion gate |
| Scheduled/manual live provider probes in an isolated environment | High for provider drift | Slow/variable | Expected and attributable | Focused | Recommended second track |
| Testcontainers per language package | High | Moderate | Low | Medium | Useful later for package integration; not the first full-stack orchestrator |

## 4. Recommended Direction

Adopt a dual-track testing model:

1. **Deterministic blocking track** — real Web, API, Engine, PostgreSQL, and Redis; fixed market fixtures and a local fake LLM provider; Playwright verifies user journeys. This runs before an AI task is declared complete and as a required pull-request check.
2. **Live provider track** — bounded Baostock canary nightly/manual, plus a less frequent full collection exercise. It reports external drift without making ordinary feature work hostage to a third-party service. Paid LLM providers remain manual and explicitly authorized only.

The project is small enough that the existing complete unit/build suite should run on every relevant change instead of introducing affected-test tooling now. Optimize through caching and later Playwright sharding only after measurements justify it.
