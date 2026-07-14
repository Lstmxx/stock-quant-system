# 因子模块可靠性与下游桥接设计

## 1. Architecture

本次保留现有 Web → Elysia API → Redis Queue → Python Worker → PostgreSQL/Redis 架构，不引入新的消息系统。统一后的数据流为：

```text
研究方向 + LLM 配置
  → FACTOR_MINING task snapshot
  → AlphaMiner 生成/计算/评估
  → user-scoped FactorRecord
  → 用户默认或手选因子集合
  → FACTOR_SELECTION task snapshot
  → FactorExposureService 计算全横截面
  → factor_selection_results（每任务/每股票一行）
  ├→ Web 任务列表 + Top N 详情
  └→ LLM 个股分析的实际因子上下文
```

`alpha_tasks` 继续作为异步任务状态与参数快照的统一入口。选股明细单独持久化，避免把全股票结果塞入一个 JSONB，同时支持按 `taskId + symbol` 查询个股暴露。

## 2. Domain Contracts

### ResearchDirection

Web、API 和 Engine 共享同一组值：`量价关系`、`动量反转`、`波动率`、`资金流向`、`市场情绪`、`趋势跟踪`。API 在边界验证；任务参数使用 `researchDirection`，移除 `targetSymbol` 的挖掘语义。

### FactorRecord

Python 领域对象统一为：

- `id: str`（数据库 UUID 字符串）
- `user_id: str`
- `name: str`
- `expression: str`
- `hypothesis: str | None`
- `research_direction: str | None`
- `ic_value: float | None`
- `icir: float | None`
- `monotonicity: float | None`
- `direction: int | None`
- `is_valid: bool`
- `generation: int`

FactorLibrary 的 `add/get/list_all/list_valid/list_expressions` 全部显式接收 `user_id`。`add` 返回 `FactorRecord`；EvolutionStrategy 只接受 `list[FactorRecord]`，权重统一读取 `abs(ic_value)` 或 `abs(icir)`。

### Factor selection task

任务类型：`FACTOR_SELECTION`。

参数快照：

- `factorIds: string[]`（排序、去重后的实际集合）
- `factorSetHash: string`
- `selectionMode: AUTO | MANUAL`
- `universeType: ALL_MARKET | WATCHLIST`
- `symbols?: string[]`（WATCHLIST 必填，创建时固化）
- `topN: number`（默认 20，设上下限）
- `dataDate: YYYY-MM-DD`
- `lookbackDays: number`

任务结果摘要保存成功股票数、Top N 数量、数据日期、因子数和耗时，不保存整份股票矩阵。

### Selection result row

新表 `factor_selection_results`：

- UUID 主键、`taskId`、`userId`、`symbol`
- `rank`、`compositeScore`、`dataDate`
- `factorContributions` JSONB，元素包含 `factorId/name/value/zScore/weight/direction/contribution/percentile`
- `createdAt`

唯一约束 `(taskId, symbol)`；索引 `(userId, dataDate)` 和 `(taskId, rank)`。API 始终同时按 `taskId` 与 `userId` 查询。

用户手选集合使用用户-因子关联表持久化；没有关联记录时进入 AUTO 模式，按 `isValid`、`abs(icValue)`、`abs(icir)` 和稳定 ID 自动取前 5 个。

## 3. Database Migration

- `alpha_factors` 的 IC、ICIR、单调性改为 double precision，方向和 generation 改为 integer。
- 增加可空 `researchDirection`。
- ID 保持 UUID；新写入使用 UUID。现存合法 UUID 保留。
- 增加 `(userId, expression)` 唯一索引。迁移前按用户检查重复表达式；保留质量更高/更新时间更晚的一条，并修正引用。
- 新增用户手选因子关联表和选股结果表，外键删除策略明确为 cascade/restrict：删除任务级联结果；删除因子时清理手选关联，但历史贡献 JSONB 保留快照。
- 提供迁移 SQL 与数据库测试。回滚只删除新表/索引和新列；数值列回退为文本会损失类型保证，因此生产回滚应优先恢复备份而非逆转换。

## 4. Mining and Persistence

- `AlphaMiner.mine()` 返回明确的 `MiningResult(valid_factors, generated_count)`，不再返回与注解不符的 tuple。
- 删除宽泛的轮次级“记录后继续并最终成功”语义：可恢复的单候选失败记录到结果；主流程契约、数据库、配置和取消异常向 Worker 传播。
- 自定义 `TaskCancelledError`；Worker 将 Redis 取消检查回调传给 AlphaMiner，在轮次、LLM 调用前、候选计算前后和持久化前检查。
- Worker 仅捕获该异常标记 `CANCELLED`；其他异常标记 `FAILED` 并保存可读原因。
- 队列统一使用 `RPUSH + BLPOP` 实现 FIFO。
- API 创建任务先写 PENDING 再入队；入队失败时将同一任务补偿更新为 FAILED，返回错误，不留下永久 PENDING。Redis 连接用 `try/finally` 关闭。

## 5. Selection Computation

新增 Engine `FactorExposureService`，作为选股和 LLM 分析的唯一计算所有者：

1. 按用户和 factorIds 加载有效 FactorRecord。
2. 一次加载指定回溯窗口的市场矩阵。
3. 每个因子计算最后有效交易日横截面值。
4. 依据方向调整 z-score；按质量权重归一化。
5. 生成全股票 composite score、rank、percentile 和逐因子贡献。
6. WATCHLIST 在计算后按任务快照 symbols 过滤并在该股票池内重新标准化/排名；空自选股在 API 边界拒绝。
7. 在一个数据库事务中批量写入该任务的结果行；失败不保留半批结果。

结果复用键为 `userId + dataDate + factorSetHash + universeType + symbolsHash`。每次手工运行仍创建新任务；复用只用于 LLM 分析自动补齐，避免重复计算。历史任务不可变。

## 6. LLM Analysis Integration

- 开始个股分析时解析当前有效因子集合和当天数据日期。
- 优先查找当天、相同 factorSetHash、结果包含目标 symbol 的最新成功选股任务；上下文明确携带 universeType，避免把自选股百分位描述成全市场百分位。
- 没有兼容结果时自动创建一次 `ALL_MARKET` 选股任务并等待终态，设置有界超时；失败或超时使分析任务 FAILED，而不是静默退化为只传因子定义。
- Prompt 使用共享 DTO：实际值、z-score、百分位、方向、贡献、综合得分、排名、股票池与数据日期。
- 报告结果保存选择任务 ID，保证分析可追溯。

## 7. API Boundaries

- `/factors`：数值分页校验、数值质量排序、手选集合读写。
- `/tasks/mining`：`researchDirection` 枚举、days 范围。
- `/factor-selections`：创建、分页列出用户任务、读取任务摘要与 Top N 明细。
- 任务/结果响应定义 Elysia schema，Web 通过 Eden 推导类型，不在组件内 `any` 解析 JSONB。
- 所有按 ID 的因子、策略、任务和选股结果查询同时带 userId 条件；顺带修复当前 strategy simulate 只按 factorId 查询的问题。

## 8. Web UX

- 因子任务弹窗将“标的代码”替换为研究方向 Select，展示方向说明。
- 创建失败返回结构化结果；Modal 仅成功后关闭。
- 因子列表增加有效状态、中性方向、手选复选框和“前往因子选股”。
- 新增因子选股任务页：创建配置（股票池、Top N、因子模式/摘要）、历史任务表、轮询状态、失败原因。
- 每行“查看”打开结果弹窗，展示 Top N 与可展开因子贡献。
- WATCHLIST 为空时阻止提交并引导添加自选股。
- 日志使用串行 timeout 轮询、请求代次保护和终态停止；Drawer 使用 antd 6 `size` API。

## 9. Compatibility, Rollout, Rollback

- 旧 FACTOR_MINING 任务中的 `targetSymbol` 只作为历史展示兼容，不重新执行；新任务只写 `researchDirection`。
- 迁移先部署数据库，再部署兼容读新旧字段的 API/Worker，最后部署 Web。
- 新增选股功能可通过隐藏菜单入口回滚；核心 FactorLibrary 和数值迁移不可与旧 Worker 混跑。
- 发布前在隔离数据库/Redis 上完成 mining → selection → analysis 冒烟链路。

## 10. Key Trade-offs

- 使用结果明细表而非任务 JSONB：增加一张表和批量写入，但换来可查询、可分页、可追溯的个股暴露。
- 协作式取消不能中断已经发出的单次外部 LLM 请求，但会阻止下一昂贵步骤；真正强制取消需要更换可取消的 LLM/作业执行模型，超出本次范围。
- 本任务保持单一 Trellis 任务：数据库契约、Engine 领域对象、选择结果和 LLM DTO 强依赖同一迁移顺序，拆成独立子任务会产生不可运行的中间版本；实施清单仍按可验证阶段设置门禁。
