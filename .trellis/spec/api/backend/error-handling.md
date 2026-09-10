# Error Handling

> How errors are handled in this project.

---

## Overview

<!--
Document your project's error handling conventions here.

Questions to answer:
- What error types do you define?
- How are errors propagated?
- How are errors logged?
- How are errors returned to clients?
-->

The API separates request errors from process-level failures. Business JSON follows [API Response Contract](./api-response-contract.md). Expected failures return `apiFailure(...)` or throw `ApiDomainError`; the typed global hook in `apps/api/src/plugins/api-errors.ts` normalizes thrown errors. `apps/api/src/app.ts` assembles routes without listening; `index.ts` owns process startup/shutdown and detached work.

---

## Error Types

<!-- Custom error classes/types -->

HTTP-facing domain errors extend `ApiDomainError` with a registered `ApiCode`, safe message, and literal HTTP error status. Result-returning services may retain private string reason keys; controllers translate them with `apiFailure`. Engine string codes and persisted candidate errors are not public wire codes. Do not expose database, Redis, Engine, or stack-trace details in HTTP responses.

---

## Error Handling Patterns

<!-- Try-catch patterns, error propagation -->

Register `apiErrors` before route modules. It logs method, path, request ID, Elysia error code, and the normalized error, then returns typed HTTP status with `{ success: false, code: ApiErrorCode, message, data: null }`. Do not mutate `set.status` and return a plain business failure: Eden would infer it as 2xx data. Detached timers, Redis callbacks, and background jobs must use `runBackgroundTask` or an equivalent local catch; request-level `onError` does not catch those failures.

---

## API Error Responses

<!-- Standard error response format -->

Validation and parse failures return HTTP 400, missing routes return 404, and unknown failures return HTTP 500 with numeric `ApiCode.INTERNAL_ERROR`. Explicit LLM domain validation retains 422. Engine service-auth 401/403 maps to upstream 502 rather than browser 401. Health readiness failures retain their native HTTP 503 body. Auth SDK, health, root text, and stream bodies are not wrapped. Error details remain in structured server logs only.

---

## Common Mistakes

<!-- Error handling mistakes your team has made -->

Do not assume Elysia `onError` catches detached async work. Do not return raw `error.message` for unknown failures. Do not continue running after `uncaughtException`; log it, close resources, and let the process supervisor restart the service.
