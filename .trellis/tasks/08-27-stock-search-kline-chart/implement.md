# 股票搜索与 K 线图实施计划

## 1. API and cache reader

- [x] Add a reusable Redis client module if needed, avoiding another private
  connection factory; preserve `finally`-based `quit()` cleanup.
- [x] Add `market-data` model/service/module with authenticated search and K-line
  routes, symbol validation, stable-key lookup, legacy-key fallback, numeric
  normalization, date filtering, and deterministic duplicate removal.
- [x] Register the module in the API app and add service tests for exact and fuzzy
  search, symbol validation, stable cache reads, legacy fallback, malformed rows,
  and result ordering.

## 2. Web module

- [x] Add and inspect the installed `lightweight-charts` dependency typings.
- [x] Add market feature types, API hook, debounced/race-safe search and chart
  loading state.
- [x] Add the lazy-loaded `/market` page, navigation metadata, Ant Design 6
  `AutoComplete` search, summary header, loading/error/empty states, and chart.
- [x] Add responsive styling using the existing semantic color tokens and verify
  keyboard navigation and accessible labels.
- [x] Add Web hook tests for debounced suggestions and stale chart-response
  protection; chart data is validated before rendering.

## 3. Verification

- [x] Run API tests and build.
- [x] Run Web tests, `antd lint` on changed files, and Web build.
- [x] Run `git diff --check` and inspect the cross-layer response shape.
- [x] Update the data-collection/cache spec with the new read-only market-data
  contract if implementation introduces a convention not already documented.

## Risk checkpoints

- Before dependency installation: confirm package manager lockfile and installed
  chart version.
- Before API implementation: confirm `stock_list_cache` and `stock_names` behavior
  under empty/missing cache conditions.
- Before chart implementation: verify v5 names in local `dist/typings.d.ts`.
- Before finish: do not alter or stage the unrelated cache-fix changes already in
  the working tree.
