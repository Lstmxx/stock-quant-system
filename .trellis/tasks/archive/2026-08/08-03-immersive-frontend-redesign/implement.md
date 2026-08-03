# Implementation plan

1. Replace Ant Design icon imports in the shared shell and login with Lucide icons; add page metadata and responsive navigation behavior.
2. Implement global canvas tokens, typography, grid/noise treatments, focus states, reduced-motion handling, and Ant Design component overrides in `main.css`.
3. Restyle `AuthLayout` and `Login` as the branded entry experience without changing auth calls or form validation.
4. Add shared page framing classes to data, factor, LLM, and selection pages; replace remaining action icon imports as encountered.
5. Search for emoji/icon regressions and run the web build plus targeted tests.

Validation:

- `rg "@ant-design/icons|Outlined|Filled|TwoTone" apps/web/src`
- `rg "[\\x{1F300}-\\x{1FAFF}]" apps/web/src`
- `bun run --cwd apps/web build`
- `bun run --cwd apps/web test -- --run` (if the package exposes the test script)
