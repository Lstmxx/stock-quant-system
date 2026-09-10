# Implementation Baseline

User approved implementation after the Engine scope review. Task activated on 2026-09-09.

- API `bun test`: 50 passed, 0 failed (14 files).
- API `bunx --no-install tsc --noEmit -p tsconfig.json` from `apps/api`: passed. Root `bunx --no-install tsc` cannot resolve the package-local executable; run from the package directory.
- Web `bunx --no-install vitest run`: 36 passed, 4 failed (12 files). All failures are pre-existing `tests/auth/Login.test.tsx` selectors expecting the old login copy (`Welcome back!`, input placeholders, and submit labels). Do not modify those unrelated tests or the login UI.
- Web `bun run build`: passed, with the existing >500 kB chunk-size warning.
- Initial dirty paths are recorded by the task research; preserve existing Engine, market-data, navigation/style, dependency, and spec changes.
