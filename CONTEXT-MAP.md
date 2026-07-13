# Context Map

Stock Quant System 是个人/团队使用的量化研究与工程实验平台。本文是全局领域入口：先根据任务定位上下文，再阅读对应 `CONTEXT.md` 中的边界、术语和代码映射。

系统不包含实盘订单执行、券商接入、资金托管或生产级风险控制。完整决策见 [ADR-0001](./docs/adr/0001-research-platform-boundary.md)。

## 上下文

| 上下文 | 职责 | 领域文档 | 主要实现 |
| --- | --- | --- | --- |
| 市场数据 | 行情采集、缓存、更新调度和数据可用性 | [`docs/contexts/market-data/CONTEXT.md`](./docs/contexts/market-data/CONTEXT.md) | `apps/engine/app/core/data_loader.py`、`apps/engine/app/scheduler.py`、`apps/web/src/features/data` |
| 因子研究 | 因子假设、DSL、计算、评估、进化和因子库 | [`docs/contexts/factor-research/CONTEXT.md`](./docs/contexts/factor-research/CONTEXT.md) | `apps/engine/app/core`、`apps/api/src/modules/factor`、`apps/web/src/features/factor` |
| 投研决策 | 自选股、个股分析、策略模拟和研究报告 | [`docs/contexts/investment-research/CONTEXT.md`](./docs/contexts/investment-research/CONTEXT.md) | `apps/api/src/modules/{analysis,strategy,watchlist}`、对应 Web features |
| 平台运行 | 身份、LLM 配置、异步任务和服务协作 | [`docs/contexts/platform-operations/CONTEXT.md`](./docs/contexts/platform-operations/CONTEXT.md) | `apps/api`、`apps/engine/app/worker.py`、`packages/database` |

这些是业务上下文，不等同于部署单元。一个上下文可以跨 Web、API、Engine、PostgreSQL 和 Redis；一个应用也可以承载多个上下文。

## 关键关系

```text
市场数据 ──提供标准化行情──► 因子研究 ──提供有效因子──► 投研决策
    │                            │                         │
    └─────────────── 任务与配置由平台运行支撑 ──────────────┘
```

- **市场数据 → 因子研究**：因子计算只消费市场数据上下文提供的行情矩阵，不自行定义采集生命周期。
- **市场数据 → 投研决策**：个股分析可读取行情缓存；缓存缺失时由市场数据上下文补齐。
- **因子研究 → 投研决策**：投研决策引用已保存的因子及其评估指标，不改变因子有效性规则。
- **平台运行 → 所有上下文**：提供用户隔离、LLM 凭据、任务状态、队列和跨服务通信。

## 共享约束

- 用户拥有的配置、任务、因子、自选股和策略必须按 `userId` 隔离。
- PostgreSQL 是持久化业务状态的事实来源；Redis 保存队列、短期缓存、日志和协作信号。
- API 网关负责外部认证与授权；Engine 的 `/internal/*` 接口只用于内部服务协作。
- 长耗时采集与挖掘通过异步任务执行，任务状态使用统一生命周期术语。
- 根目录 `scripts/` 是兼容/实验工具，不定义主平台的领域边界，见 [ADR-0002](./docs/adr/0002-monorepo-is-primary.md)。

## 系统级决策

- [ADR-0001：将系统限定为研究与工程实验平台](./docs/adr/0001-research-platform-boundary.md)
- [ADR-0002：以 monorepo 应用作为主要产品路径](./docs/adr/0002-monorepo-is-primary.md)

