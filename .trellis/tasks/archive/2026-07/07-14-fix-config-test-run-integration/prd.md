# 修复配置测试并运行真实数据集成测试

## Goal

让配置测试不再依赖特定数据库密码或启动目录，并用真实 Baostock 与 Redis 验证行情拉取、发布通知和缓存写入链路。

## Requirements

- R1：TypeScript 数据库配置测试从仓库根 `.env` 读取 `DATABASE_URL`，只验证配置存在且是合法 PostgreSQL URL，不固定用户名、密码或端口。
- R2：Engine 的 `.env` 路径必须相对源码文件解析，不能依赖 pytest/uvicorn 的当前工作目录。
- R3：Python 配置测试验证实际 Settings 值来自根 `.env`，失败信息不得打印连接密码。
- R4：运行 `test_data_fetch_integration.py`，真实连接 Redis 和 Baostock，等待最多 20 分钟。
- R5：集成测试必须验证内部 API 接受请求、Redis pub/sub 收到成功消息、`price_summary` 缓存存在且包含目标股票价格。

## Acceptance Criteria

- [x] AC1：数据库与 Engine 配置测试在仓库根目录和包目录执行时均不依赖固定密码。
- [x] AC2：相关配置单测通过，且不会在失败输出中泄露完整连接字符串。
- [x] AC3：真实长耗时集成测试通过；若外部服务不可用，记录具体阻塞点和已验证阶段，不伪报成功。
- [x] AC4：测试产生的 Redis pub/sub、连接和后台资源得到清理。

## Constraints

- 不修改用户当前 `.env` 的凭据。
- 不输出数据库密码或其他秘密。
- 不 mock Baostock、Redis 或数据加载器的长耗时集成测试路径。

## Verification

- `bun test apps/api/tests/config.test.ts`：通过（仓库根目录）。
- `bun test tests/config.test.ts`：通过（`apps/api` 和 `packages/database` 包目录）。
- `bun test src tests`（`apps/api`）：24 项通过；显式排除 `dist` 中的历史编译测试副本。
- `uv run pytest tests/test_config.py tests/test_internal_router.py tests/test_data_loader_collection.py -q`：6 项通过。
- `uv run pytest tests/test_data_fetch_integration.py -s -q`：真实 Redis/Baostock 强制刷新通过，单股缓存命中 0，只，拉取 3189 只股票，耗时 277.02 秒。
- 集成测试收到 `data_ready:sh.600000`，验证当日 `price_summary` 后显式取消订阅并关闭 pub/sub 与 Redis 客户端。
- API、Web 构建与 Python compileall 通过；`antd lint` 为 0 错误、4 个既有弃用提示。
