# Stock Cache Overwrite Verification

Date: 2026-09-10

## Scope

- Engine per-symbol cache replacement, legacy-key fallback, stock-list
  deduplication, and duplicate market-row handling.
- Existing aggregate-cache atomic replacement and retry behavior remain covered.
- No API, frontend, or task-status contract changes are included.

## Acceptance Evidence

- `test_fetch_stock_chunk_replaces_stable_cache_across_date_ranges` fetches two
  batches for the same symbol with different end dates. Each read returns the
  latest JSON payload, only `kline:sh.600000` exists in the mock cache, and both
  writes retain the seven-day TTL. Baostock, Redis, waits, and signals are mocked.
- `test_load_kline_data_prefers_stable_cache` and
  `test_load_kline_data_falls_back_to_legacy_cache` cover cache-key migration.
- `test_load_kline_data_deduplicates_symbols_before_cache_read` covers repeated
  stock codes without repeated per-symbol reads.
- `test_load_kline_data_filters_range_and_keeps_last_valid_duplicate` rejects
  out-of-range dates, malformed dates, and invalid closing prices before keeping
  the last valid duplicate and producing a pivoted result.
- `test_pivot_data_keeps_last_duplicate_date_and_symbol` covers duplicate inputs
  passed directly to the pivot operation.
- The existing aggregate-cache and retry tests verify temporary-key rename and
  rebuilding the full aggregate after repairing failed stocks.

## Checks

Python commands ran from `apps/engine` with
`UV_CACHE_DIR=/tmp/stock-quant-uv-cache` and without dependency synchronization.

| Command | Result |
| --- | --- |
| `uv run --no-sync pytest tests/test_data_loader_collection.py -q` | 8 passed |
| `RUN_REAL_DATA_INTEGRATION=0 uv run --no-sync pytest -q` | 64 passed, 1 skipped |
| `uv run --no-sync ruff check app/core/data_loader.py tests/test_data_loader_collection.py` | Passed |
| `uv run --no-sync python -m compileall -q app/core/data_loader.py tests/test_data_loader_collection.py` | Passed |
| `git diff --check` restricted to this task's tracked changes | Passed |

The full suite ran outside the sandbox to access the user's local Redis service.
The real-data integration test remains opt-in and was skipped with
`RUN_REAL_DATA_INTEGRATION=0`; this run does not verify a live Baostock fetch.

## Handoff

Only this task's implementation, tests, specification changes, and task artifacts
belong in its work commit. Other task directories, skill changes, and examples
remain outside the commit and archive scope. Obtain Phase 3.4 confirmation before
committing, then archive this task and record the journal using the current
session's explicit `TRELLIS_CONTEXT_ID`.
