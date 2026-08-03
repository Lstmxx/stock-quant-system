# Design

## Architecture

- `src/assets/css/main.css` 成为全局视觉 token、背景画布、动效和 Ant Design 覆盖层的唯一入口。
- `AppLayout` 负责品牌导航、当前页面元信息、用户菜单和响应式侧栏；业务页面继续通过 `Outlet` 渲染，不改变路由边界。
- `AuthLayout`/`Login` 共享同一套背景画布和表单语言；表单仍使用 Ant Design 控件以保持校验和测试兼容，图标替换为 Lucide。
- 业务页面保留原有 hooks、API、表格和 modal 组件，只调整页面级 wrapper、操作按钮图标和必要的 className。

## Visual system

- 颜色：`#090b0f` 画布、`#11161d` 面板、`#e6ff5a` 主强调、`#79a8ff` 辅强调、低透明白色边框。
- 排版：系统无衬线用于正文，等宽字体用于状态/元数据；标题使用紧缩字距和响应式 `clamp`。
- 形态：细边框、较小圆角、叠层面板、网格/径向渐变背景；避免大量圆角白卡片。
- 动效：页面淡入、面板上浮、导航 hover 光晕和缓慢背景漂移；统一用 CSS transition/keyframes，减少 JS 动画。

## Compatibility and rollback

- 不删除 Ant Design 组件依赖；仅移除图标包引用。
- 所有样式集中在新 class 和 token 中，若需回滚可恢复 `AppLayout`/`AuthLayout`/`Login` 旧 JSX，业务 hooks 不受影响。
