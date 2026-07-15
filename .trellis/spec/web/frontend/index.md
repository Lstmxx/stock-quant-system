# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | To fill |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, global state, server state | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |
| [Factor Workflow Contract](../../api/backend/factor-workflow-contract.md) | Factor task UI, status, selection, and log-polling contracts | Active |
| [Data Collection Workflow Contract](../../api/backend/data-collection-workflow-contract.md) | Global collection UI, status, pagination, and polling contracts | Active |
| [LLM Workflow Contract](../../api/backend/llm-workflow-contract.md) | Provider forms, key actions, connection tests, errors, and accessible row actions | Active |

## Pre-Development Checklist

- When changing factor pages, task status, selection, or logs, read [Factor Workflow Contract](../../api/backend/factor-workflow-contract.md).
- When changing the data-management page, collection status, failures, or polling, read [Data Collection Workflow Contract](../../api/backend/data-collection-workflow-contract.md).
- When changing LLM management or missing-model recovery UI, read [LLM Workflow Contract](../../api/backend/llm-workflow-contract.md).

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
