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

The API separates request errors from process-level failures. Expected domain and HTTP errors return an explicit `status(...)` response. Unexpected errors may be thrown and are normalized by the global Elysia `onError` hook in `apps/api/src/index.ts`.

---

## Error Types

<!-- Custom error classes/types -->

Domain errors should use a dedicated error class when callers need a stable code and status. Do not expose database, Redis, Engine, or stack-trace details in HTTP responses.

---

## Error Handling Patterns

<!-- Try-catch patterns, error propagation -->

Register the global `onError` hook before route modules. It logs method, path, request ID, Elysia error code, and the normalized error, then returns a stable `{ success: false, code, message }` payload. Detached timers, Redis callbacks, and background jobs must use `runBackgroundTask` or an equivalent local catch; request-level `onError` does not catch those failures.

---

## API Error Responses

<!-- Standard error response format -->

Validation and parse failures return HTTP 400, missing routes return 404, and unknown failures return HTTP 500 with `INTERNAL_ERROR`. Health readiness failures return HTTP 503. Error details remain in structured server logs only.

---

## Common Mistakes

<!-- Error handling mistakes your team has made -->

Do not assume Elysia `onError` catches detached async work. Do not return raw `error.message` for unknown failures. Do not continue running after `uncaughtException`; log it, close resources, and let the process supervisor restart the service.
