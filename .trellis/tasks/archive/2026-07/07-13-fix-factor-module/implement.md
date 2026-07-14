# 因子模块可靠性与下游桥接实施计划

## Phase A — 基线与契约测试

- [ ] 为当前 P0 建立失败测试：缺失方法、挖掘假成功、FactorRecord/Evolution 类型、UUID、跨用户表达式。
- [ ] 增加共享任务/因子 DTO 或领域常量的单一所有者，搜索并列出所有 `targetSymbol`、`FACTOR_MINING`、因子指标字符串读取点。
- [ ] 记录当前数据库迁移快照与回滚点。

验证：

```bash
cd apps/engine && uv run pytest tests -q
bun test apps/api/src/modules/factor apps/api/src/modules/task packages/database/tests
cd apps/web && bunx vitest run tests/factor
```

## Phase B — 数据库与 FactorLibrary

- [ ] 修改 Drizzle schema：数值指标、generation、researchDirection、用户表达式唯一索引。
- [ ] 新增用户手选因子关联表与 factor_selection_results 表及类型。
- [ ] 生成并审阅迁移；处理用户内重复表达式和历史数据转换。
- [ ] 重写 FactorRecord/FactorLibrary 为显式 user scope 和一致返回类型。
- [ ] 修复 EvolutionStrategy、MultiFactorSelector、AlphaMiner 的字段引用与返回契约。
- [ ] 增加真实数据库或可代表 SQL 契约的持久化/隔离测试。

门禁：FactorLibrary、进化与挖掘核心测试全绿，迁移可在空库和历史样本库应用。

## Phase C — 挖掘任务可靠性

- [ ] API/模型/Web 将 targetSymbol 迁移为 researchDirection，兼容旧任务只读展示。
- [ ] 实现受支持方向枚举和 days 边界验证。
- [ ] 实现 FIFO 入队、入队失败补偿、Redis finally 关闭。
- [ ] 实现 TaskCancelledError 与 AlphaMiner 协作取消点。
- [ ] 收紧异常传播和 COMPLETED 判定，保存结构化失败原因。
- [ ] 修复创建 Modal 成功/失败返回契约和任务列表状态展示。

门禁：成功、主流程失败、入队失败、排队取消、运行中取消测试全绿。

## Phase D — 因子集合与选股 Engine

- [ ] 实现 AUTO 前 5 质量排序和 MANUAL 用户关联 CRUD。
- [ ] 实现因子集合规范化和 factorSetHash。
- [ ] 从现有 MultiFactorSelector 提取 FactorExposureService，统一值、方向、权重、排名和贡献计算。
- [ ] 支持 ALL_MARKET/WATCHLIST；固化 watchlist symbols 快照并校验空集合。
- [ ] Worker 支持 FACTOR_SELECTION，批量事务写结果并保存任务摘要。
- [ ] 增加同因子集合/两股票池/空值/无有效因子/计算失败/取消测试。

门禁：固定行情 fixture 的 Top N、贡献求和、方向反转、用户隔离结果可重复。

## Phase E — 选股 API 与 Web

- [ ] 新增 factor-selection 模块：创建、分页任务列表、任务详情、Top N 明细。
- [ ] 所有任务和结果查询强制 userId；响应 schema 可由 Eden 推导。
- [ ] 因子列表增加手选状态与批量设置入口。
- [ ] 新增“因子选股”菜单/路由、创建任务配置和历史任务表。
- [ ] 实现任务结果 Modal：Top N、数据日期、股票池、因子贡献展开。
- [ ] 增加加载、空自选股、失败、过期和取消反馈。

门禁：组件/Hook 测试覆盖 AUTO/MANUAL、两股票池、任务历史与结果查看。

## Phase F — LLM 个股分析桥接

- [ ] 增加最新兼容 selection 结果查询与按 symbol 暴露读取。
- [ ] 缺失时幂等创建一次 ALL_MARKET 选股任务并有界等待。
- [ ] 用共享 FactorAnalysisContext DTO 构造 Prompt，保存 selectionTaskId/dataDate/universeType。
- [ ] 修复 analysis/strategy 中因子查询的 userId 和 isValid 限定及数值排序。
- [ ] 增加已有快照复用、自动补齐、超时失败、跨用户拒绝和 Prompt 内容测试。

门禁：同一 symbol 在选股详情与 LLM Prompt 中的值、排名和数据日期一致。

## Phase G — 日志、构建与全链路验证

- [ ] 日志改为串行轮询，增加代次/卸载保护、终态停止和错误 UI。
- [ ] 修复因子模块 TypeScript 错误、无用变量及 antd Drawer 弃用 API。
- [ ] 运行 factor 相关 API/Web/Engine/数据库测试、Web typecheck/build、antd lint。
- [ ] 在隔离 PostgreSQL + Redis 环境执行 mining → selection(ALL_MARKET/WATCHLIST) → LLM analysis 冒烟。
- [ ] 检查 git diff，确保不覆盖现有 `.trellis/config.yaml`、review hook 和其他用户变更。

最终验证命令：

```bash
bun test apps/api/src packages/database/tests
cd apps/web && bunx vitest run && bun run build
cd apps/engine && uv run pytest tests -q
antd lint apps/web/src/features/factor --format json
git diff --check
```

## Risk and Rollback Points

- 数据迁移前：备份 alpha_factors/alpha_tasks；重复表达式合并清单需可审阅。
- Phase B 后：若类型迁移失败，停止部署，不运行新 Worker。
- Phase D 后：选股计算可通过不暴露 API/UI 回滚，不影响挖掘。
- Phase F 后：LLM 桥接失败必须显式 FAILED；不得静默退回旧的“仅因子定义”Prompt。
- 每个 Phase 结束运行对应门禁；失败时只回退该 Phase 的代码，不使用破坏性 git 命令。
