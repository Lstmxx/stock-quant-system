# Logging Guidelines

> How logging is done in this project.

---

## Overview

<!--
Document your project's logging conventions here.

Questions to answer:
- What logging library do you use?
- What are the log levels and when to use each?
- What should be logged?
- What should NOT be logged (PII, secrets)?
-->

The API uses the small structured logger in `apps/api/src/lib/logger.ts`. It writes one JSON object per line to stdout/stderr, so local terminals and production log collectors consume the same format without parsing human-oriented prefixes.

---

## Log Levels

<!-- When to use each level: debug, info, warn, error -->

Use `debug` for diagnostic detail, `info` for lifecycle and successful request events, `warn` for recoverable dependency failures or fallbacks, `error` for failed requests and background jobs, and `fatal` for process-level failures.

---

## Structured Logging

<!-- Log format, required fields -->

Every log includes `timestamp`, `level`, `service`, and `message`. Request logs should include `requestId`, HTTP method, path, and status where available. Error values are normalized to name, message, stack, and cause.

---

## What to Log

<!-- Important events to log -->

Log server start/stop, request completion/failure, background task failure, Engine/Redis/Database dependency failures, and process-level `unhandledRejection`/`uncaughtException` events.

---

## What NOT to Log

<!-- Sensitive data, PII, secrets -->

Never log passwords, cookies, authorization headers, Better Auth secrets, API keys, database URLs, Redis URLs, or full request bodies. Engine URLs may be logged only without credentials or tokens.
