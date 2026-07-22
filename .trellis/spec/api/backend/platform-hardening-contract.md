# Platform Hardening Contract

## 1. Scope / Trigger

Use this contract when changing API-to-Engine HTTP calls, authentication runtime configuration, interrupted task recovery, the application landing route, or legacy analysis/dashboard capabilities.

## 2. Signatures

- Engine internal HTTP: `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>` is required for every `/internal/*` request.
- Public health HTTP: `GET /health` remains unauthenticated.
- Web root route: `/ -> /data`.
- Legacy route: `/dashboard` is not registered and falls through to `/data`.
- API startup recovery: `TaskService.failInterruptedAnalysisTasks() -> number` marks legacy `LLM_ANALYSIS` rows in `PENDING|RUNNING` as `FAILED`.
- Database migration `0005_overconfident_cannonball.sql` enforces unique `(watchlists.userId, watchlists.symbol)` and cascades Watchlist/Strategy deletion with the owning user.

## 3. Contracts

- `INTERNAL_SERVICE_TOKEN` must be identical in API and Engine environments and must not be exposed to Web/Vite variables.
- Engine never trusts CORS, port placement, `userId`, or `modelId` as authentication.
- `BETTER_AUTH_SECRET` must contain at least 32 characters in production; `BETTER_AUTH_URL` identifies the API auth base URL.
- The legacy Dashboard and legacy Analysis API remain disabled until analysis is rebuilt on the durable Redis worker lifecycle.
- Missing market data is a failed analysis precondition; placeholder data must never produce `COMPLETED` research output.
- Simulation metrics that are not actually calculated are `null`, never fixed or inferred constants.

## 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| `/internal/*` without or with a wrong token | HTTP 401 |
| Engine has no internal token configured | HTTP 503 |
| Production Better Auth secret missing/short | API startup error naming only the key |
| Legacy analysis left active across API restart | task becomes `FAILED` with actionable retry text |
| Price summary unavailable or data preparation times out | analysis fails; no LLM success report |
| Watchlist symbol already exists for the user | PostgreSQL unique violation / idempotent API handling |
| `/` or an unknown Web route | redirect to `/data` |

## 5. Good / Base / Bad Cases

- Good: API sends the internal token, Engine validates it, and a private Engine route executes.
- Base: the user opens the application and lands on Data Management while no Dashboard is shipped.
- Bad: expose port 8000 and rely on the word `internal`, generate a report from placeholder prices, or label a fixed drawdown as a real simulation result.

## 6. Tests Required

- Engine tests assert missing internal authorization is rejected and valid authorization succeeds.
- API Engine-client tests assert the Bearer header is attached without logging the token.
- Web router/build tests assert no Dashboard module or menu entry is shipped and `/` redirects to `/data`.
- Database tests assert the migration contains Watchlist uniqueness and two cascade foreign keys.
- Full gates: Bun API/DB tests, Web Vitest/build, Engine Pytest/Ruff, and `antd lint`.

## 7. Wrong vs Correct

### Wrong

```python
router = APIRouter(prefix="/internal")  # Network placement is not authentication.
```

```typescript
return { maxDrawdown: -0.15, sharpeRatio: metrics.icir * 1.5 };
```

### Correct

```python
router = APIRouter(
    prefix="/internal",
    dependencies=[Depends(require_internal_token)],
)
```

```typescript
return { maxDrawdown: null, sharpeRatio: null };
```
