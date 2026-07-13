# 平台运行上下文

## 使命

为所有研究上下文提供身份、配置、持久化、异步任务和服务协作能力，使耗时研究流程可追踪并保持用户隔离。

## 边界

包含：

- 邮箱密码认证、会话和用户归属
- LLM 提供商、模型、端点和加密密钥配置
- 异步任务的创建、入队、执行、取消、日志和状态更新
- API、Engine、PostgreSQL 与 Redis 的协作约定
- 服务端口、内部接口和运行时配置

不包含：

- 各研究任务内部的行情、因子或分析算法
- 面向公网的多节点生产运维承诺
- 券商账户、交易权限或资金安全

## 核心规则

- 外部请求经 API 网关认证；业务查询必须使用会话中的用户身份限定数据范围。
- LLM API 密钥以 `ENCRYPTION_KEY` 派生的密钥加密；同一数据环境不得随意更换该配置。
- PostgreSQL 是任务状态的事实来源；Redis 是队列和短期协作状态，不是长期业务记录。
- Engine 消费队列并回写任务状态；Web 不直接调用 Engine。
- 任务状态使用 `PENDING`、`RUNNING`、`COMPLETED`、`FAILED`、`CANCELLED`。
- `/internal/*` 是 API 与 Engine 的内部协作接口，不是稳定的外部 API。

## 术语表

| 术语 | 定义 | 避免使用 |
| --- | --- | --- |
| 用户 | 拥有配置、任务和研究资产的认证主体 | 租户（当前没有组织级租户模型） |
| LLM 模型配置 | 用户保存的提供商、模型名称、端点和凭据组合 | 系统模型（除非指全局默认值） |
| 任务 | 需要异步执行并具有统一生命周期的工作记录 | 请求（任务可超出一次 HTTP 请求的生命周期） |
| 任务队列 | Redis 列表 `stock:tasks:queue`，用于 API 向 Engine 交付工作 | 事件总线 |
| 任务状态 | PostgreSQL 中任务当前生命周期阶段 | Redis 状态 |
| 内部接口 | 仅供 API 与 Engine 协作的 Engine HTTP 接口 | 公共 API |

## 任务生命周期

```text
PENDING ──► RUNNING ──► COMPLETED
   │            │
   ├────────────┴─────► CANCELLED
   └──────────────────► FAILED
```

## 协作关系

- 支撑**市场数据**的采集、重试和调度任务。
- 支撑**因子研究**的 LLM 配置、挖掘任务和因子持久化。
- 支撑**投研决策**的身份隔离、LLM 调用和报告保存。

## 代码地图

- API 入口与认证：`apps/api/src/index.ts`、`apps/api/src/plugins/auth.ts`
- LLM 配置：`apps/api/src/modules/llm`、`apps/api/src/modules/config`
- 任务 API：`apps/api/src/modules/task`
- Engine worker：`apps/engine/app/worker.py`
- 内部 Engine API：`apps/engine/app/routers/internal.py`
- 数据模型与迁移：`packages/database`

