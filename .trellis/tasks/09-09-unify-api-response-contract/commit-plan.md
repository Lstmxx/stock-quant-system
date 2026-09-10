# 提交计划：统一 API 响应契约

日期：2026-09-10。检查基准：`refactor` / `dc828b8`。

## 当前授权与状态

- 用户于 2026-09-10 明确确认先提交行情功能基线，再提交 API/Web 响应契约；不包含其他任务，也未授权归档或推送。
- 本轮仅更新此清单；业务代码分离与验证在隔离目录完成，不覆盖原工作区文件。
- 下列业务代码、测试、规范与已有任务文档均为接续会话前的改动，不是本轮新写的代码。归属判断依据任务记录、原始会话补丁及当前差异，提交范围已经用户确认。
- 初次清点时暂存区为空，`git diff --check` 通过。本次对两个分离快照重新运行了测试、类型检查和构建，结果见末尾；原实现验证记录仍保留在 `verification.md`。

## 必须先解决的提交依赖

不能直接把“本任务文件”全部暂存后提交：已有行情功能仍是未跟踪文件，而响应契约代码已依赖它。

- `apps/api/src/app.ts` 导入并注册 `modules/market-data`。
- `apps/api/tests/response-contract.test.ts` 导入行情服务，并把行情路由纳入 42 个业务端点的合同测试。
- `apps/web/tests/api/request.types.ts` 使用行情接口证明载荷类型推导。
- 行情服务、调用 hook、类型别名和测试已迁移到本任务新增的响应/请求工具；直接把这些文件全部归入行情前置提交，同样会产生反向依赖。

已确认的提交顺序：

1. 前置提交：`feat: add stock search and K-line chart`。属于 `08-27-stock-search-kline-chart`，作为独立批次获准纳入；分离出响应契约迁移前的行情基线，不直接暂存当前整目录。
2. 本任务：`refactor: unify API response contract and typed web requests`。API、Web、契约测试和相关规范作为一个原子提交，避免只提交生产端或消费端。
3. 工作提交确认完成后，再按用户授权处理归档和日志；不得抢先归档其他任务。

不得通过删除行情路由、削减测试覆盖或顺带提交其他任务来绕过依赖。用户授权仅覆盖上述两批工作提交。

## 本任务候选文件：现有改动，已确认纳入

以下清单在前置基线分离完成后成立。未跟踪文件不等于本任务新建；跨任务文件另列于下一节。

### API 生产代码和验证

- `apps/api/package.json`
- `apps/api/src/app.ts`
- `apps/api/src/index.ts`
- `apps/api/src/contracts/api-response.ts`
- `apps/api/src/lib/api-response.ts`
- `apps/api/src/lib/api-response.test.ts`
- `apps/api/src/plugins/api-errors.ts`
- `apps/api/src/plugins/api-errors.test.ts`
- `apps/api/src/plugins/auth.ts`
- `apps/api/src/modules/config/index.ts`
- `apps/api/src/modules/watchlist/index.ts`
- `apps/api/src/modules/factor/index.ts`
- `apps/api/src/modules/factor/service.ts`
- `apps/api/src/modules/factor-selection/index.ts`
- `apps/api/src/modules/factor-selection/service.ts`
- `apps/api/src/modules/llm/index.ts`
- `apps/api/src/modules/llm/service.ts`
- `apps/api/src/modules/llm/service.test.ts`
- `apps/api/src/modules/llm/validation.ts`
- `apps/api/src/modules/llm-stock-selection/index.ts`
- `apps/api/src/modules/llm-stock-selection/service.ts`
- `apps/api/src/modules/strategy/index.ts`
- `apps/api/src/modules/strategy/service.ts`
- `apps/api/src/modules/task/index.ts`
- `apps/api/src/modules/task/model.ts`
- `apps/api/src/modules/task/model.test.ts`
- `apps/api/src/modules/task/service.ts`
- `apps/api/src/modules/task/service.test.ts`
- `apps/api/tests/response-contract.test.ts`

入口说明：`src/index.ts` 到 `src/app.ts` 的工厂抽取属于响应契约任务；行情注册本身来自前置任务，不能把这次搬迁当作行情功能也属于响应契约的证据。

### Web 消费端和验证

- `apps/web/src/api/api.ts`
- `apps/web/src/api/request.ts`
- `apps/web/src/features/data/DataManagement.tsx`
- `apps/web/src/features/data/components/DataCollectionConfigModal.tsx`
- `apps/web/src/features/data/components/TaskDetailModal.tsx`
- `apps/web/src/features/data/hooks/useTaskStream.ts`
- `apps/web/src/features/data/hooks/useTasks.ts`
- `apps/web/src/features/data/types.ts`
- `apps/web/src/features/factor/FactorSelectionPage.tsx`
- `apps/web/src/features/factor/components/FactorSelectionResultModal.tsx`
- `apps/web/src/features/factor/components/FactorTaskConfigModal.tsx`
- `apps/web/src/features/factor/hooks/useFactorSelections.ts`
- `apps/web/src/features/factor/hooks/useFactorTasks.ts`
- `apps/web/src/features/factor/hooks/useFactors.ts`
- `apps/web/src/features/factor/hooks/useTaskLogsPolling.ts`
- `apps/web/src/features/factor/types.ts`
- `apps/web/src/features/llm-selection/LlmStockSelectionPage.tsx`
- `apps/web/src/features/llm-selection/components/llm-selection-result-modal.tsx`
- `apps/web/src/features/llm-selection/hooks/use-llm-stock-selections.ts`
- `apps/web/src/features/llm-selection/types.ts`
- `apps/web/src/features/llm/api-error.ts`（删除）
- `apps/web/src/features/llm/components/LlmModelFormModal.tsx`
- `apps/web/src/features/llm/hooks/useLlmModels.ts`
- `apps/web/src/features/llm/types.ts`
- `apps/web/tests/api/request.test.ts`
- `apps/web/tests/api/request.types.ts`
- `apps/web/tests/helpers/api-response.ts`
- `apps/web/tests/data/TaskDetailModal.test.tsx`
- `apps/web/tests/data/useTaskStream.test.ts`
- `apps/web/tests/data/useTasks.test.ts`
- `apps/web/tests/factor/useFactorTasks.test.ts`
- `apps/web/tests/factor/useFactors.test.ts`
- `apps/web/tests/factor/useTaskLogsPolling.test.ts`
- `apps/web/tests/llm-selection/useLlmStockSelections.test.ts`
- `apps/web/tests/llm/useLlmModels.test.ts`
- `apps/web/tsconfig.contracts.json`

### 规范与本任务记录

- `.trellis/spec/api/backend/api-response-contract.md`
- `.trellis/spec/api/backend/error-handling.md`
- `.trellis/spec/api/backend/factor-workflow-contract.md`
- `.trellis/spec/api/backend/index.md`
- `.trellis/spec/api/backend/llm-stock-selection-workflow-contract.md`
- `.trellis/spec/api/backend/llm-workflow-contract.md`
- `.trellis/spec/api/backend/platform-hardening-contract.md`
- `.trellis/spec/web/frontend/index.md`
- `.trellis/spec/web/frontend/type-safety.md`
- `.trellis/tasks/09-09-unify-api-response-contract/baseline.md`
- `.trellis/tasks/09-09-unify-api-response-contract/check.jsonl`
- `.trellis/tasks/09-09-unify-api-response-contract/design.md`
- `.trellis/tasks/09-09-unify-api-response-contract/implement.jsonl`
- `.trellis/tasks/09-09-unify-api-response-contract/implement.md`
- `.trellis/tasks/09-09-unify-api-response-contract/prd.md`
- `.trellis/tasks/09-09-unify-api-response-contract/research.md`
- `.trellis/tasks/09-09-unify-api-response-contract/task.json`
- `.trellis/tasks/09-09-unify-api-response-contract/verification.md`

本轮唯一新增文件：`.trellis/tasks/09-09-unify-api-response-contract/commit-plan.md`。它记录提交范围、分离依据和执行前验证。

## 跨任务文件：必须拆分，禁止整文件归入本任务

| 文件 | 本任务部分 | 保留或移至前置任务的部分 |
| --- | --- | --- |
| `apps/web/package.json` | `typecheck:contracts` 脚本 | `lightweight-charts` 依赖属于行情任务 |
| `.trellis/spec/api/backend/data-collection-workflow-contract.md` | 响应封装、数值错误码、空确认载荷、冲突后刷新、进度 DTO 校验 | 行情只读接口/页面约束属于行情任务；稳定缓存 key 和去重约定属于缓存任务 |
| `apps/api/src/modules/market-data/index.ts` | `apiSuccess` 包装与统一错误处理接入 | 行情路由基线 |
| `apps/api/src/modules/market-data/service.ts` | `MarketDataError` 继承公共错误基类 | Redis 查询、行情解析、搜索和 K 线业务实现 |
| `apps/web/src/features/market/hooks/use-market-data.ts` | `request` 与公共错误消息接入 | 搜索、选择、竞态控制等既有行情 hook |
| `apps/web/src/features/market/types.ts` | `ApiData` 载荷别名 | 行情领域类型与运行时校验 |
| `apps/web/tests/market/useMarketData.test.ts` | 新响应封装的 mock/断言迁移 | 原有搜索与竞态测试 |
| `apps/web/tests/market/types.test.ts` | `ApiCode` 导入与数值错误封装断言 | 原有行情领域校验测试 |

基线已通过可核实的原始会话补丁重建，分离过程与依赖闭包验证见末尾。未把当前未跟踪文件直接当作纯行情基线。

## 未纳入本任务的已有改动

### 独立行情前置批次，已获准提交

除上表中的行情基线部分外：

- `apps/api/src/modules/market-data/model.ts`
- `apps/api/src/modules/market-data/service.test.ts`
- `apps/web/src/features/market/MarketChartPage.tsx`
- `apps/web/src/features/market/components/stock-kline-chart.tsx`
- `apps/web/src/app/router.tsx`
- `apps/web/src/components/layout/AppLayout.tsx`
- `apps/web/src/assets/css/main.css`
- `bun.lock`
- `.trellis/tasks/08-27-stock-search-kline-chart/`

### 明确排除，不属于这两个提交

- `apps/engine/app/core/data_loader.py`
- `apps/engine/tests/test_data_loader_collection.py`
- `.trellis/tasks/08-27-fix-stock-cache-overwrite/`
- `.trellis/tasks/07-22-ai-development-test-loop/`
- `.agents/skills/lightweight-charts/`
- `.claude/skills/lightweight-charts`
- `skills-lock.json`
- `examples/`
- 共享采集规范中的缓存修复部分，如上表所述。

## 执行前检查

1. 按用户确认的两个独立批次执行；新增范围须再次确认。
2. 重新检查 HEAD 和暂存区。若用户新增改动或已暂存文件，先保留并重新分类。
3. 使用明确路径和经核实的分块补丁；不得使用 `git add .` 或把未跟踪行情目录直接整体加入本任务。
4. 对实际将提交的分离后内容做构建、类型与相关测试验证；现有混合工作区的历史绿灯不能证明分离提交正确。
5. 检查暂存差异及 `git diff --cached --check`，确认 Engine、其他任务、技能、示例与缓存规范未混入。
6. 按确认后的批次提交；不 amend、不 push、不自动归档。涉及范围变化时重新确认。

## 分离依据与本轮验证

- 行情基线重放了会话 `01a0422c-a7f3-7533-9d6f-8553dac5d1eb` 的 14 个成功补丁；失败尝试未作为成功变更采用。
- 对共享文件重放会话 `01a0840a-6c1b-79b3-bff6-af4a075286b6` 的 7 个响应契约补丁，验证结果与当前工作区一致；采集规范仅留下明确排除的 5 行缓存约定。
- 既有行情日期归一化代码与配套回归测试保留在第一批。原行情基线没有后续调试用的 `console.log`，重建时不重新引入；契约迁移对应移除基线里的 `unknown` 标注，不改变最终代码。
- 补丁第一批涉及 23 个文件，第二批涉及 92 个文件。两个补丁分别通过其前置快照上的 `git apply --check`。
- 使用隔离快照及本地现有依赖；工作区包链接指向快照自身，不回落到原工作区的 API/Database 源码。API 测试使用无真实服务的测试 URL，没有复制真实 `.env` 或调用行情采集/付费模型。

| 检查 | 行情基线 | 响应契约完成态 |
| --- | --- | --- |
| API 定向测试 | 6 通过 | 135 通过 |
| API 全量测试 | 50 通过，0 失败 | 187 通过，0 失败 |
| API TypeScript / 构建 | 均通过 | 均通过 |
| Web 定向测试 | 4 通过 | 24 通过 |
| Web 全量测试 | 36 通过，4 个既有失败 | 66 通过，同样 4 个既有失败 |
| Web 应用 TypeScript / 构建 | 均通过 | 均通过 |
| Web 契约类型检查 | 前置版本尚无此脚本 | 通过 |

两个 Web 快照失败的均为 `tests/auth/Login.test.tsx` 中相同的 4 个表单文案/选择器测试，没有新增失败；原有大于 500 kB 的构建分包警告仍在。未跳过、屏蔽或改动这些既有测试。

第一批已创建工作提交 `ee615a2`（23 个文件），暂存内容逐文件校验为已验证的行情快照。本记录在第二批工作提交前写入；不把提交确认等同于任务归档或日志记录完成。
