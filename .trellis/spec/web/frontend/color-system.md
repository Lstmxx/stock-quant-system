# Color System Contract

## Scope

All Web UI colors are defined in `apps/web/src/assets/css/main.css` using three layers:

1. Primitive palette values are theme-only.
2. Semantic `--color-*` tokens describe page, text, border, and status meaning.
3. Component `--component-*` tokens describe controls such as inputs, buttons, tables, and alerts.

## Contract

- Page and feature components consume semantic or component tokens; do not add raw hex, `rgb`, or `rgba` values to feature JSX/TSX.
- Ant Design theme values in `src/app/App.tsx` are infrastructure-level mirrors of the CSS primitives and must stay synchronized with the CSS token values.
- Input text must use `--component-input-text`, placeholder text must use `--component-input-placeholder`, and focus must use `--component-input-focus`.
- Every status color must be paired with a readable text color and a non-color cue where applicable (label, icon, or status text).
- New theme colors require foreground/background contrast checks: 4.5:1 for normal text and 3:1 for large text or essential UI boundaries.

## Common Mistake

Ant Design's nested `.ant-input` can keep its own text color even when `.ant-input-affix-wrapper` is themed. Always style both selectors and set `-webkit-text-fill-color` when a browser autofill or password input can override the computed color.

## Good / Bad

```css
/* Good: the foreground is verified against the actual input surface. */
.ant-input { color:var(--component-input-text); background:var(--component-input-bg); }

/* Bad: a local gray can become unreadable when the theme surface changes. */
.ant-input { color:#666; background:#f5f5f5; }
```
