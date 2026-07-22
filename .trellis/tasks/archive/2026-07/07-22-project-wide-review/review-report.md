# 全项目架构与体验审查报告

审查基线：`refactor` 分支当前工作树（2026-07-22）。本报告只做诊断，不修改业务代码。

## 结论摘要

系统的主链路已经具备清晰的 monorepo 分层，用户隔离、LLM 配置、因子选股和数据采集的近期跨层契约也比较完整。API/Database 测试 56 项通过，Engine 测试 57 项通过；但仍有几条高风险旁路绕过了这些契约：Engine 内部接口没有可验证的服务认证，分析与策略链路没有完全纳入统一任务队列，且部分结果使用占位或近似指标却以真实研究结果呈现。

最优先修复顺序：

1. 封闭 Engine `/internal/*` 信任边界，并移除 `allow_origins=["*"] + credentials` 的部署风险。
2. 把分析和策略模拟纳入持久化任务/队列，保证重启、超时、取消和重试可恢复。
3. 禁止在数据缺失或指标未计算时生成“成功”研究报告；删除固定/近似回测指标。
4. 修复 Dashboard 的功能映射和前端测试循环，恢复可靠的用户反馈。

## P0/P1：应优先处理

### P1-01 Engine 内部接口没有服务间认证

- **确定性**：强证据；在当前监听方式下若 8000 端口可被其他主机访问即可触发。
- **证据**：`apps/engine/app/main.py:34-40` 对 FastAPI 开启 `allow_origins=["*"]`、允许凭据、所有方法和请求头；`apps/engine/app/routers/internal.py:96-148,230-276` 的 `/internal/llm/chat`、`/internal/llm/test`、`/internal/fetch-data`、`/internal/simulate-factor`、`/internal/reload-config` 没有 token、签名或来源校验。
- **影响**：攻击者可伪造任意 `userId/modelId` 发起 LLM 调用、消耗密钥额度、读取/刷新行情、改变调度配置或触发昂贵的因子模拟。当前注释“Not exposed externally”不是网络安全控制。
- **建议**：API 与 Engine 使用独立的内部服务密钥或 mTLS；Engine 只监听内网/loopback；为内部路由加统一依赖校验和请求审计；CORS 仅配置实际 Web origin，内部接口不依赖 CORS。

### P1-02 策略模拟返回伪造/近似指标

- **确定性**：已验证。
- **证据**：`apps/engine/app/routers/internal.py:260-270` 将 `maxDrawdown` 固定为 `-0.15`，将 `sharpeRatio` 设为 `metrics.icir * 1.5`，`winRate` 缺失时固定为 `0.55`；`apps/api/src/modules/strategy/service.ts:50-57` 又把这些值称为“真实回测表现”。
- **影响**：用户看到的最大回撤、夏普和胜率不是回测结果，可能导致错误研究结论；这也违反“模拟结果是研究估算、不可表述为已实现收益”的产品边界。
- **建议**：在真正计算累计收益、回撤、波动率和胜率前，返回明确的“指标不可用”，并在 UI 上显示估算/缺失状态；为每个指标补固定数据集回归测试。

### P1-03 分析任务绕过统一队列，API 重启会遗留 RUNNING 任务

- **确定性**：已验证。
- **证据**：`apps/api/src/modules/analysis/service.ts:188-204` 先写入 `alpha_tasks`，然后直接调用 `_runAnalysis(...).catch(...)`，没有 Redis 入队、worker 接管或启动恢复扫描；`_setStatus` 在 `:207-212` 也没有租约/版本保护。
- **影响**：API 进程重启、部署或崩溃后任务可能永久停留在 `RUNNING`；无法统一取消、重试、并发限流和恢复；与仓库“长任务通过异步队列执行”的架构契约冲突。
- **建议**：新增明确任务类型和队列消费者，创建后只入队；worker 负责状态迁移和心跳；启动时将超时 RUNNING 任务转为可重试/FAILED；统一使用现有任务状态和日志协议。

### P1-04 数据采集失败后仍继续生成分析并标记 COMPLETED

- **确定性**：已验证。
- **证据**：`apps/api/src/modules/analysis/service.ts:227-241` 等待数据最多 60 秒后直接 `resolve()`，注释明确“proceed anyway with empty stats”；`:168-175` 缓存缺失时返回占位对象；`:244-294` 继续调用 LLM 并最终写入 `COMPLETED`。
- **影响**：行情缺失、补数失败或超时会被包装成看似成功的分析报告，用户无法区分真实数据、占位数据和部分失败，研究结论不可复现。
- **建议**：把数据准备作为显式阶段；失败时将任务置为 `FAILED`/`PARTIAL_SUCCESS`，携带可操作错误；只有通过数据完整性校验才允许 LLM 调用，报告保存数据快照日期和来源。

### P1-05 Dashboard 入口与后端能力错配

- **确定性**：已验证。
- **证据**：`apps/web/src/features/dashboard/Dashboard.tsx:48-57,118-145` 的“New Analysis”实际调用 `api.tasks.mining.post`，表单字段是 `researchDirection`，按钮文案是“Start Mining”；真正的分析 API 在 `apps/api/src/modules/analysis/index.ts:12-39`，但 `apps/web/src/app/router.tsx:16-76` 没有分析页面或路由。
- **影响**：用户以为发起个股分析，实际创建的是因子挖掘任务；分析 API 处于不可发现/不可使用状态，任务列表和状态文案也混淆两个领域。
- **建议**：拆分“因子挖掘 Dashboard”和“个股分析”页面；为 `/analysis` 增加路由、任务详情和 SSE；表单使用后端的 `symbol/days/type`，不要复用 mining DTO。

## P2：功能、可靠性与体验问题

### P2-01 LLM 选股 Hook 测试持续更新并超时

- **确定性**：已验证，当前测试套件实际失败。
- **证据**：`apps/web/tests/llm-selection/useLlmStockSelections.test.ts:47,69,89` 三个用例超时；运行时产生 `Maximum update depth exceeded` 和大量未包裹 `act(...)` 警告。Hook `apps/web/src/features/llm-selection/hooks/use-llm-stock-selections.ts:27-74` 将 `fetchTasks` 依赖 `message`、分页状态和轮询状态；测试中的 `App.useApp()` 每次渲染返回新对象，导致 effect 反复重建。
- **影响**：Web 全量测试退出码为 1，回归保护失效；若真实反馈对象身份不稳定，也会产生轮询重置和重复请求。
- **建议**：让通知适配器稳定（或只依赖稳定方法）；将初始加载和轮询拆成稳定 effect；用 fake timers/`waitFor` 验证轮询；清理所有异步更新和 `act` 警告。

### P2-02 Engine lint 基线未通过，且存在重复实现痕迹

- **确定性**：已验证。
- **证据**：`uv run ruff check .` 报 34 项错误；`apps/engine/app/core/data_loader.py:195-220` 在已有实现后再次导入模块并重新定义常量、Redis 工厂和 `DataLoader`；`apps/engine/app/core/factor_evaluator.py:204` 使用裸 `except`；其余包含未使用导入、吞异常和中途导入。
- **影响**：代码路径难以判断，静态工具无法作为合并门禁；异常可能被静默吞掉，数据采集/评估问题难以诊断。
- **建议**：先合并重复的 DataLoader 实现，再启用 Ruff CI；用结构化 logger 替换 print；按异常类型记录并向 worker 传播可读失败原因。

### P2-03 策略持久化失败被吞掉，接口仍返回成功

- **确定性**：已验证。
- **证据**：`apps/api/src/modules/strategy/service.ts:89-100` 对 `db.insert(quantStrategies)` 使用 `.catch(console.error)`，随后无条件返回 `structuredReport`。
- **影响**：用户收到成功报告但历史中没有策略记录，重试会重复消耗 LLM；前端无法区分“生成成功”和“保存失败”。
- **建议**：让持久化异常进入统一错误响应；使用事务同时保存报告和指标；返回持久化 ID，UI 明确显示保存状态。

### P2-04 分析 SSE 连接缺少完整清理

- **确定性**：强证据。
- **证据**：`apps/api/src/modules/analysis/index.ts:48-73` 创建 Redis subscriber、注册 `message` 监听和 5 秒 interval，但只在 `stream.send` 抛错时清理；没有统一的流关闭/finally 清理和取消订阅。
- **影响**：用户频繁打开/关闭日志抽屉或网络断线时可能积累 Redis 连接、监听器和定时器。
- **建议**：使用请求断开信号/Stream finally；`unsubscribe`、移除监听、清理 interval、`quit`/`disconnect`；限制单用户并发 SSE 数量。

### P2-05 调度配置存在启动顺序竞态

- **确定性**：强证据。
- **证据**：Engine `apps/engine/app/scheduler.py:150-154` 启动时总是 `update_scheduler_config()` 默认 cron；API `apps/api/src/index.ts:48-58` 仅在启动 2 秒后读取数据库并向 Engine 推送一次，失败只 `console.error`，无重试或健康状态。
- **影响**：Engine 启动晚于 API、数据库暂不可用或首次推送超时时，持久化配置与实际调度不一致，直到人工重启/修改配置才恢复。
- **建议**：Engine 启动时直接从数据库加载配置并校验；API 推送采用重试/幂等；增加“当前生效 cron”健康指标和 UI 提示。

### P2-06 生产构建仍包含未编译 Tailwind 指令

- **确定性**：已验证。
- **证据**：`apps/web/src/assets/css/main.css:1-2` 只写 `@import "tailwindcss"` 和 `@import "@nuxt/ui"`，Vite 未配置 Tailwind/PostCSS 插件；`bun run build` 输出多条 `Unknown at rule: @theme/@tailwind/@source/@variant`，且 `apps/web/dist/assets/index-VOlFbSmB.css` 仍含这些指令。
- **影响**：依赖 Tailwind/ Nuxt UI 的样式在浏览器中可能被忽略，构建虽成功但视觉结果与开发环境不一致；问题容易被误判为组件样式 bug。
- **建议**：明确选择 Tailwind v4 的 Vite 插件或 PostCSS 管线，移除不使用的 `@nuxt/ui`；在 CI 中检查产物不得含未处理指令，并增加关键页面截图/样式冒烟测试。

### P2-07 antd 迁移和反馈 API 使用不一致

- **确定性**：工具已验证。
- **证据**：`antd lint apps/web/src` 报 32 项：4 项 deprecated（Alert `message`、Drawer `width`、Modal `destroyOnClose`/`maskClosable`）和 28 项静态 `message.*` 无法消费 `ConfigProvider` 上下文；典型位置为 `apps/web/src/features/data/hooks/useTasks.ts:2,77-104`、`apps/web/src/features/factor/hooks/useFactors.ts:2,33-81`。
- **影响**：主题、语言、通知容器配置在不同页面不一致，升级 antd v6 时可能出现行为变化；用户错误提示难以统一。
- **建议**：统一通过 `App.useApp()` 注入反馈 API，集中封装错误映射；按 antd v6 API 迁移 deprecated props。

### P2-08 Watchlist 和用户删除语义不完整

- **确定性**：已验证。
- **证据**：`packages/database/src/schema.ts:19-26` 的 `watchlists` 没有 `(userId, symbol)` 唯一约束；`:388-397` 的 `quantStrategies.userId` 和 `:21` 的 `watchlists.userId` 没有 `onDelete: cascade`，而部分新表已经显式 cascade。
- **影响**：同一用户可重复添加同一股票；用户删除时可能因外键阻止而失败或与其他表删除策略不一致。
- **建议**：补唯一约束和幂等 upsert；统一所有用户资产的删除策略，并补用户生命周期集成测试。

### P2-09 认证关键配置未纳入文档和启动校验

- **确定性**：强证据。
- **证据**：`apps/api/src/plugins/auth.ts:6-18` 未显式设置 `secret/baseURL`，仓库 README 的环境变量示例也未列出 `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`；API `requireEnv` 只强制 `REDIS_URL`（`apps/api/src/lib/env.ts:10-18`）。
- **影响**：不同环境可能使用隐式默认/不一致的 Better Auth 配置，部署后会出现会话失效、跨域或安全等级不一致，且启动阶段不暴露明确原因。
- **建议**：生产环境强制 secret（至少 32 字符）和可信 origin；启动时 fail fast；把配置写入 README、docker 示例和配置测试，禁止输出 secret 值。

## P3：架构与治理改进

### P3-01 领域入口仍有重复和遗留路径

- `scripts/` 保留多套独立采集、选股和报告脚本；README 已声明它们不是主路径，但未提供版本/数据写入隔离检查。建议建立“只读/实验”运行配置、明确弃用时间和 CI 漂移检查。
- `packages/database/src/schema.ts` 仍大量使用 camelCase PostgreSQL 列名和无时区 `timestamp`，新旧表风格不一致。短期先冻结约定，长期迁移时统一时区和命名。

### P3-02 类型和输入契约仍有逃逸

- `apps/api/src/lib/engine-client.ts:165-173` 返回 `Promise<any>`；`apps/api/src/modules/strategy/service.ts:24,49` 使用 `any`；Dashboard 多处使用 `Record<string, any>`。
- 建议为 Engine simulation、strategy body、task params 建立共享 DTO/响应 schema，开启更严格的 TypeScript 与 Python 类型检查。

## 自动验证结果

| 检查 | 结果 | 说明 |
|---|---|---|
| API + Database Bun tests | 通过，56 项 | 发现 ioredis 测试期间有多次未处理连接错误输出，应修复测试隔离/监听器 |
| Web build | 通过 | 但有未编译 Tailwind at-rule 警告 |
| Web Vitest | 失败，34 通过 / 3 失败 | 失败集中在 `useLlmStockSelections`，伴随最大更新深度和 act 警告 |
| Engine Pytest | 通过，57 通过 / 1 跳过 | 跳过项依赖真实数据源 |
| Engine Ruff | 失败，34 项 | 见 P2-02 |
| antd lint | 32 项警告 | 4 deprecated + 28 feedback/context 使用问题 |

## 推荐实施路线

### 快速收益（1-3 天）

1. 给 Engine 内部接口加共享密钥、限制监听地址，修正 CORS。
2. 修复 Dashboard 入口文案/路由，至少禁止把 mining 任务称为 analysis。
3. 修复 `useLlmStockSelections` 测试和通知依赖，恢复 Web CI 绿灯。
4. 删除固定回测指标；数据不足时明确失败，不生成成功报告。
5. 统一 antd 反馈 API，消除 32 项警告。

### 中期改造（1-2 周）

1. 把 analysis/strategy 任务纳入 Redis worker 和统一状态机。
2. 为任务增加 lease/heartbeat、启动恢复、取消和重试协议。
3. 补数据完整性快照、真实回测指标和契约测试。
4. 修复 SSE 生命周期、Redis 客户端复用和日志/指标观测。
5. 清理 DataLoader 重复实现并让 Ruff 成为合并门禁。

### 长期治理

1. 生成共享 API/Engine DTO 或 OpenAPI 契约，减少 `any` 和本地 JSON cast。
2. 建立统一的错误码、通知、加载/空/失败/部分成功 UI 状态组件。
3. 建立旧脚本弃用/漂移治理和端到端环境矩阵。
4. 统一数据库时间、命名、删除语义和用户资产生命周期测试。
