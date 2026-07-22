# Stock Quant System

面向个人与小团队的 A 股量化研究和工程实验平台。系统把行情数据采集、LLM 辅助分析、Alpha 因子挖掘与策略研究整合到一个本地优先的 Web 工作台中。

> 本项目用于研究和工程实验，不是生产级实盘交易系统，也不构成投资建议。当前系统不负责券商接入、订单执行或资金与仓位管理。

## 当前能力

- 采集并缓存 A 股行情数据，管理自选股与采集参数
- 使用 DSL 表达、计算和评估量价因子
- 通过 LLM 生成研究假设并迭代挖掘因子
- 发起、取消和跟踪数据采集及因子挖掘任务
- 组合因子、模拟策略并生成研究报告
- 以用户维度管理 LLM 模型、密钥和研究数据

## 系统架构

```text
浏览器
  │
  ▼
React Web (:5173)
  │ HTTP / SSE
  ▼
Elysia API (:3000) ───────────────► PostgreSQL
  │                                     ▲
  ├── HTTP ──► FastAPI Engine (:8000) ──┤
  │                    │                 │
  └──────────────► Redis ◄──────────────┘
                  任务队列与行情缓存
```

- `apps/web`：React、Vite 与 Ant Design 构建的研究工作台
- `apps/api`：Elysia/Bun API 网关，处理认证、业务接口和任务入队
- `apps/engine`：FastAPI/Python 计算引擎，执行数据采集、因子计算与后台任务
- `packages/database`：Drizzle schema、迁移和共享数据库访问
- PostgreSQL：持久化用户、配置、任务、因子与策略
- Redis：承载异步任务队列、任务日志、取消信号与行情缓存

业务边界和术语请从 [`CONTEXT-MAP.md`](./CONTEXT-MAP.md) 开始阅读。

## 仓库结构

```text
.
├── apps/
│   ├── api/                  # Elysia API 网关
│   ├── engine/               # FastAPI 量化计算引擎
│   └── web/                  # React 研究工作台
├── packages/
│   ├── config/               # 共享 TypeScript 配置
│   └── database/             # Drizzle schema 与迁移
├── docs/
│   ├── adr/                  # 系统级架构决策
│   ├── agents/               # Agent 工作约定
│   └── contexts/             # 领域上下文与术语表
├── scripts/                  # 兼容/实验用途的旧版独立脚本
├── CONTEXT-MAP.md            # 全局领域导航
└── package.json              # Bun workspace 与统一开发命令
```

## 本地开发

### 1. 准备环境

需要安装：

- [Bun](https://bun.sh/)：JavaScript 运行时与 workspace 包管理器
- Python 3.12 与 [uv](https://docs.astral.sh/uv/)
- Docker 与 Docker Compose：启动 PostgreSQL 和 Redis

安装项目依赖：

```bash
bun install
cd apps/engine
uv sync
cd ../..
```

### 2. 启动基础设施

通用本地环境使用无主机目录绑定的示例配置：

```bash
docker compose -f docker-compose.example.yml up -d
```

仓库内的 `docker-compose.yml` 使用 `${HOME}` 下的持久化目录，适合已经准备好对应目录的开发机。

### 3. 配置环境变量

在仓库根目录创建 `.env`：

```dotenv
DATABASE_URL=postgresql://postgres:password@localhost:5432/stock_quant
REDIS_URL=redis://localhost:6379
ENCRYPTION_KEY=replace-with-a-long-random-secret
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
BETTER_AUTH_URL=http://localhost:3000
INTERNAL_SERVICE_TOKEN=replace-with-a-random-api-engine-token

# 可选：服务地址与端口
PORT_WEB=5173
PORT_API=3000
PORT_ENGINE=8000
CORS_ORIGIN=http://localhost:5173
ENGINE_URL=http://localhost:8000

# 可选：也可以登录后在 Web 界面配置 LLM
# LLM_API_KEY=your-api-key
# LLM_BASE_URL=https://api.openai.com/v1
# LLM_MODEL=your-model-name
```

`ENCRYPTION_KEY` 用于加密保存的 LLM 密钥。同一数据库环境必须保持该值稳定；请勿提交 `.env`。

### 4. 初始化数据库

```bash
cd packages/database
bun run db:migrate
cd ../..
```

### 5. 启动应用

```bash
bun run dev
```

默认地址：

- Web：<http://localhost:5173>
- API：<http://localhost:3000>
- Engine 健康检查：<http://localhost:8000/health>

首次使用时，在 Web 界面注册账户并配置 LLM 模型；因子挖掘任务需要先选择一个可用的模型。

> 旧版 Dashboard 与旧版个股 Analysis API 已暂时下线。新版 Dashboard 和基于统一任务队列的分析流程将另行设计。

也可以分别启动服务：

```bash
bun run dev:web
bun run dev:api
bun run dev:engine
```

## 测试

```bash
# API 与共享包
bun test apps/api/src apps/api/tests packages/database/tests

# Web
(cd apps/web && bunx vitest run)

# Engine
(cd apps/engine && uv run pytest tests)
```

部分 Engine 集成测试需要正在运行的 PostgreSQL、Redis 或外部行情数据源。

## 兼容与实验脚本

根目录 `scripts/` 保留了项目早期的独立数据采集、报告生成和选股脚本。它们用于兼容旧流程或快速实验：

- 不属于当前 Web 平台的主要运行链路
- 不保证与 monorepo 的数据库模型、配置方式和依赖版本同步
- 新功能应优先落在 `apps/` 与 `packages/` 中

## 文档导航

- [`CONTEXT-MAP.md`](./CONTEXT-MAP.md)：全局领域地图与代码导航
- [`docs/adr/`](./docs/adr/)：系统级架构决策记录
- [`docs/agents/domain.md`](./docs/agents/domain.md)：领域文档的维护约定
- [`AGENTS.md`](./AGENTS.md)：仓库级 Agent 工作说明
