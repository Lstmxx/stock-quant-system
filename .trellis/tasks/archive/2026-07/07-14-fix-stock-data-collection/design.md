# 股票数据采集链路修复设计

## 1. 边界与不变量

本任务保留现有 Web → Elysia API → PostgreSQL/Redis → FastAPI Engine 架构，建立以下不变量：

1. `DATA_COLLECTION` 是全局资源；数据库中最多存在一个活跃采集任务。
2. `alpha_tasks.userId` 表示人工任务的发起人；定时任务允许为 `NULL`，并通过 `params.trigger = "SCHEDULED"` 标识来源。
3. PostgreSQL 任务记录是状态源，Redis 只承载队列、取消标志、进度和失败详情。
4. 任务创建后若队列投递失败，任务必须补偿为 `FAILED`。
5. 单股缓存与 `market_data:{endDate}_{lookbackDays}` 聚合缓存必须在成功任务结束前达到一致。
6. 终态集合为 `COMPLETED | PARTIAL_SUCCESS | FAILED | CANCELLED`；`CANCELLING` 仍是活跃状态。

## 2. 数据模型与迁移

### 2.1 全局采集配置

把 `data_collection_configs` 从“每用户一行”迁移为 `scope = "GLOBAL"` 的单例：

- 新增唯一 `scope`，默认 `GLOBAL`。
- 原 `userId` 改为可空的 `updatedBy`，仅用于审计。
- 新增 `cronExpression`，默认 `0 20 * * mon-fri`，避免 APScheduler 数字星期从 Monday=0 开始导致歧义。
- 保留 `lookbackDays`、`workerCount`。
- 迁移时选择 `updatedAt` 最新的一行作为全局值；cron 从最新的 `user_configs.BAOSTOCK_CRON` 迁入，没有值时使用默认值；删除其余旧配置行。
- 用户注册钩子不再创建采集配置，API 在单例缺失时使用数据库 upsert 建立默认配置。

### 2.2 全局任务互斥

- `alpha_tasks.userId` 改为可空，只有定时 `DATA_COLLECTION` 可为空；业务代码保持因子等用户任务必须带 userId。
- 添加 PostgreSQL partial unique index：当 `type = 'DATA_COLLECTION'` 且状态属于 `PENDING/RUNNING/CANCELLING` 时，`type` 唯一。
- 建索引前，将历史上并存的活跃采集任务按 `createdAt DESC` 保留最新一条，其余标记为 `CANCELLED` 并写入迁移说明结果。
- API 插入时仍先查询活跃任务以返回友好冲突信息；唯一索引负责封堵并发请求的竞态，捕获 `23505` 并映射为 HTTP 409。

## 3. API 契约

### 3.1 专用采集接口

新增/调整以下契约，避免改变因子任务列表的现有语义：

- `GET /tasks/data-collection?limit&offset`：返回全局采集任务的有界列表，默认 50、最大 100，并返回 `items/total`。
- `GET/PUT /tasks/data-collection/config`：读写全局 `lookbackDays`、`workerCount`、`cronExpression`；数字必须为整数且范围分别为 1..5000、1..16。
- `POST /tasks/data-collection/run`：空闲时创建任务；活跃时返回 409 和现有 `taskId/status`，不取消已有任务。
- `POST /tasks/:id/cancel`：对于采集任务按全局权限读取；`RUNNING` 进入 `CANCELLING`，`PENDING` 进入 `CANCELLED`。其他任务仍按 userId 隔离。
- progress、failed-stocks、retry 对采集任务使用同一全局访问规则，并校验任务类型和允许的终态。

API 返回标准化的失败信息。failed-stocks 同时返回失败代码和最后错误原因；在过渡期保留 `stocks` 字段，避免旧调用方立即失效。

### 3.2 可靠投递

手动采集、失败重试和定时采集统一遵守“插入任务 → 投递 Redis → 失败补偿”的行为：

- API 复用现有 `enqueueTask`，所有 Redis 客户端在 `finally` 中退出。
- Engine scheduler 增加等价的入队辅助函数；投递失败更新任务为 `FAILED` 并记录错误。
- 失败重试也受全局活跃任务唯一约束。

不在本次引入 outbox；partial unique index + 失败补偿满足当前单队列部署的最低可靠性要求。

## 4. Engine 数据一致性

### 4.1 统一构建聚合数据

在 `DataLoader` 中提取共享步骤：

- 统一计算 `endDate/startDate/dateKey`，文案使用“回溯天数”而非保证交易日数量。
- 从完整股票集合的单股缓存构建 DataFrame、pivot、行业和股票名称，再原子写入聚合 key。
- 正常采集和重试都调用同一聚合构建函数。

重试流程先强制拉取目标股票，再从所有股票的单股缓存重建 `market_data:{endDate}_{lookbackDays}`。写聚合缓存使用临时 key + rename，防止下游读到半成品。

### 4.2 结果和进度

- `_fetch_stock_chunk` 在 Redis hash 中记录每只失败股票的最后错误原因。
- 每个 worker 明确写入 `completed/failed/cancelled` 终态，不依赖前端通过计数推断。
- 任务结果使用稳定字段：`totalCount/successCount/failedCount/lookbackDays/completedAt/retryOf`，可附带中文展示但前端不再解析任意对象推断状态。
- `failedCount = 0` → `COMPLETED`；成功和失败并存 → `PARTIAL_SUCCESS`；全部失败或聚合构建失败 → `FAILED`；检测到取消 → `CANCELLED`。
- 重试成功后删除原任务失败集合中已修复的代码，并保留新任务自身的失败快照。

## 5. Scheduler

- `AsyncIOScheduler(timezone="Asia/Shanghai")`，默认 cron 为 `0 20 * * mon-fri`。
- scheduler 从全局配置单例读取回溯天数、worker 数和 cron，不再 `LIMIT 1` 读取任意用户配置。
- scheduler 插入 `userId = NULL`、`trigger = SCHEDULED` 的任务，并遵守相同全局唯一索引；已有活跃任务时跳过并记录原因。
- API 启动及全局配置保存后调用 Engine reload；Engine 先校验新 cron，再替换现有 job。无效 cron 返回非 2xx，旧 job 保持不变。
- 通用用户配置保存不再触发 scheduler reload。

## 6. Web 体验与状态管理

- 数据页改用专用全局采集列表接口；默认展示最近任务并支持服务端分页。
- hook 使用串行 timeout 轮询；每次请求带 generation/AbortController，组件卸载或任务切换时丢弃过期响应。
- 保存 `selectedTaskId`，从最新列表派生详情任务。
- `PENDING/RUNNING/CANCELLING` 都视为活跃；活跃时禁用“立即更新”并说明当前任务，不再让用户通过新建任务隐式取消。
- 触发、取消、配置和失败列表均有 loading 与可见错误；取消成功提示“取消请求已提交”或“待执行任务已取消”。
- worker 类型支持 `failed/cancelled`；任务标签支持中文的 `PARTIAL_SUCCESS/CANCELLING`。
- 配置弹窗增加 cron 字段及默认时区说明；回溯文案不承诺精确交易日数量。
- 失败列表展示代码、名称（若有）和最后错误；读取失败时不显示“全部成功”。
- 替换 antd 6 已弃用的 `Alert.message` 为 `title`。

## 7. 兼容性与回滚

- `DATA_COLLECTION` 专用 API 隔离了列表返回结构变化；通用 `/tasks` 继续服务因子和 Dashboard。
- failed-stocks 暂时保留旧 `stocks` 字段。
- 数据库迁移不可简单删除：回滚前需确认没有 `userId IS NULL` 的任务；回滚脚本应先为定时任务补合法用户或归档。
- 聚合缓存 key 保持不变；若新构建失败，原 key 因临时 key + rename 仍可继续读取。
- 可单独关闭 scheduler，不影响手动采集。

## 8. 主要风险

- Baostock 和 Redis 集成测试依赖外部服务，单元测试需用 fake/mocks 验证聚合重建和失败计数，真实集成测试作为可选门禁。
- 数据库 partial index 是并发正确性的核心；必须用至少一个数据库层测试或迁移 SQL 审查验证。
- `alpha_tasks.userId` 变为 nullable 后，非采集代码必须继续显式按用户过滤，防止扩大其他任务可见范围。
