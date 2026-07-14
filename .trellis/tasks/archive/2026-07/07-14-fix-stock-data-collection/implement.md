# 股票数据采集链路实施计划

## 1. 数据库与共享契约

- [x] 更新 Drizzle schema：全局采集配置、可空任务发起人、活跃采集 partial unique index及必要索引。
- [x] 生成并审查迁移 SQL/快照：合并旧用户配置、迁移 cron、处理历史重复活跃任务。
- [x] 更新数据库 schema 测试，验证单例配置、nullable userId 和 partial unique index。
- [x] 定义 API/前端共用的采集状态、结果与失败详情结构，避免各层独立猜测字段。

回滚点：迁移提交前；若数据归并规则不安全，停止后续实施并恢复为不改表的兼容方案。

## 2. API 服务与路由

- [x] 移除注册用户时创建个人采集配置的 hook。
- [x] 将采集配置服务改为全局单例，增加 cron 与后端整数范围校验。
- [x] 新增有界、分页的全局采集任务列表，不改变通用用户任务列表契约。
- [x] 用数据库唯一索引 + 409 冲突实现全局单任务；删除“新建即取消旧任务”行为。
- [x] 手动触发和失败重试统一调用 `enqueueTask`，覆盖投递失败补偿与连接释放。
- [x] 对 status/cancel/progress/failed/retry 建立采集任务全局访问规则，其他任务继续用户隔离。
- [x] 安全解析 Redis 进度 JSON，失败详情返回 code/reason 并保留 `stocks` 兼容字段。
- [x] 从通用 config 保存流程移除 Engine reload；API 启动和全局采集配置保存改用唯一 cron。
- [x] 扩充 API 单元测试：并发冲突、跨用户可见/取消、入队失败、配置校验、重试前置条件、Redis 清理。

验证：

```bash
bun test apps/api/src/modules/task/service.test.ts
bun run --cwd apps/api build
```

## 3. Engine 数据加载、worker 与 scheduler

- [x] 重构 `DataLoader` 的日期范围、聚合构建和原子缓存写入，正常与重试复用同一实现。
- [x] 重试目标股票后重建完整聚合缓存，计算真实成功/失败数，并更新失败集合。
- [x] 为每股失败记录原因，为 worker 写入明确终态；取消时停止把残留 running 快照当成功。
- [x] worker 根据结果写 `COMPLETED/PARTIAL_SUCCESS/FAILED/CANCELLED` 及稳定结果字段。
- [x] scheduler 使用 Asia/Shanghai、全局配置、nullable 发起人、唯一任务冲突和投递失败补偿。
- [x] reload-config 先验证再替换调度 job，失败返回非 2xx 并保留旧计划。
- [x] 新增 Engine 单元测试：重试聚合重建、部分/全部失败、取消、scheduler 配置与入队失败。

验证：

```bash
uv run pytest apps/engine/tests/test_data_loader.py apps/engine/tests/test_worker.py apps/engine/tests/test_scheduler.py
uv run pytest apps/engine/tests -m "not integration"
```

回滚点：聚合写入切换前；保留旧 key，任何重建异常不得覆盖原缓存。

## 4. Web 状态与体验

- [x] 数据页接入专用分页接口，增加页码/总数并限制轮询只刷新当前页和活跃任务。
- [x] `useTasks` 增加串行轮询、generation、防重复提交、可见错误和 CANCELLING 处理。
- [x] `useTaskStream` 使用 AbortController 串行化并保留 partial/failed/cancelled worker 状态，不让旧请求覆盖新任务。
- [x] 详情弹窗通过 ID 派生最新任务；区分失败列表加载错误、空结果和部分成功。
- [x] 更新任务表中文状态、触发来源、操作 loading；活跃任务时禁用触发并解释冲突。
- [x] 配置弹窗展示全局语义、cron/Asia-Shanghai、加载错误和严格校验。
- [x] 更新 antd 6 `Alert` API，并收紧业务组件中的 `any` 类型。
- [x] 新增 Web 测试：串行轮询、重复提交保护、取消文案和 worker 失败状态。

验证：

```bash
bunx vitest run apps/web/tests/data
antd lint apps/web/src/features/data --format json
bun run --cwd apps/web build
```

## 5. 集成检查与文档

- [x] 通过 API/Engine/Web 自动化测试验证冲突、取消状态、部分失败、重试补齐和定时入队数据流；真实 Baostock/Redis 长耗时集成测试留给部署环境。
- [x] 验证因子任务列表、因子选股和分析仍读取原 `market_data:{date}_{days}` key。
- [x] 检查所有新增 Redis 客户端关闭路径和所有 DATA_COLLECTION 状态分支。
- [x] 运行全量 API/Engine/Web 相关测试、构建和格式/类型检查。
- [x] 将最终采集任务/缓存/调度契约写入 `.trellis/spec/`，完成 Trellis quality check。

最终门禁：

```bash
bun test apps/api/src/modules/task/service.test.ts packages/database/tests/factor-schema.test.ts
uv run pytest apps/engine/tests -m "not integration"
bunx vitest run apps/web/tests
bun run --cwd apps/api build
bun run --cwd apps/web build
antd lint apps/web/src/features/data --format json
git diff --check
```
