# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | To fill |
| [Error Handling](./error-handling.md) | Error types, handling strategies | Active |
| [API Response Contract](./api-response-contract.md) | Typed JSON envelopes, numeric codes, Eden inference, and protocol exclusions | Active |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |
| [Factor Workflow Contract](./factor-workflow-contract.md) | Mining, queue, selection, cancellation, and analysis contracts | Active |
| [Data Collection Workflow Contract](./data-collection-workflow-contract.md) | Global collection, scheduler, retry, cache, and UI contracts | Active |
| [LLM Workflow Contract](./llm-workflow-contract.md) | Secret, Provider, model persistence, Engine adapter, consumer, and UI contracts | Active |
| [LLM Stock Selection Workflow Contract](./llm-stock-selection-workflow-contract.md) | Main-board screening, snapshots, LLM judgments, retries, and result UI | Active |
| [Platform Hardening Contract](./platform-hardening-contract.md) | Internal service auth, legacy Dashboard/Analysis retirement, auth env, and user-asset constraints | Active |

## Pre-Development Checklist

- When changing business routes, response types, public errors, or API consumers, read [API Response Contract](./api-response-contract.md) and [Error Handling](./error-handling.md).
- When changing factor mining, task queues, selection, or stock analysis, read [Factor Workflow Contract](./factor-workflow-contract.md).
- When changing stock collection, scheduler, retries, or market-data caches, read [Data Collection Workflow Contract](./data-collection-workflow-contract.md).
- When changing LLM configuration, factor/analysis/strategy model calls, or model-management UI, read [LLM Workflow Contract](./llm-workflow-contract.md).
- When changing LLM stock selection, candidate snapshots, ranking, retry, or result UI, read [LLM Stock Selection Workflow Contract](./llm-stock-selection-workflow-contract.md).
- When changing API-to-Engine calls, auth runtime configuration, app landing routes, or legacy analysis/dashboard code, read [Platform Hardening Contract](./platform-hardening-contract.md).

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
