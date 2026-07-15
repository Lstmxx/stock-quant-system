# 大模型配置与多 Provider 调用链实施计划

## Phase A — Security and persistence

- [x] RED/GREEN：Node/Python 新密文固定向量、非法 key、旧格式拒绝测试。
- [x] 删除硬编码 secret、明文兼容和空值解密 fallback；实现严格 `v1` AES-GCM。
- [x] 补齐 `llm_models`/索引/外键迁移，修正 Drizzle schema。
- [x] 为 `user_configs` 去重、唯一索引和原子 upsert 增加回归测试与实现。
- [x] RED/GREEN：LLM CRUD DTO、secret response、404/409、默认事务和引用删除测试。
- [x] 实现 Provider-aware 校验、事务 CRUD 和 `hasApiKey` 响应。

## Phase B — Unified Engine adapter

- [x] 添加 LiteLLM 依赖并移除 Engine 对 `requests` 的 LLM 使用。
- [x] RED/GREEN：只读 ConfigLoader 按 userId+modelId 隔离、无全局状态、解密 fail-closed。
- [x] RED/GREEN：四类 Provider 参数映射、无密钥 Ollama、JSON mode 和响应归一。
- [x] RED/GREEN：认证/限流/超时/不可用/非法响应异常映射与有限重试。
- [x] 实现领域 DTO、只读 `LlmModelConfigLoader`、`LLMClient` 协议与 `LiteLLMClient`；Engine 不提供配置 CRUD。
- [x] 改造 AlphaMiner 使用每任务不可变配置并删除静默 fallback。
- [x] 增加 Engine 内部 chat/test 路由与 schema。

## Phase C — Consumer convergence

- [x] 扩展 API `engineClient` 的类型化 chat/test 方法和错误映射测试。
- [x] 股票分析解析默认 modelId 并通过 Engine 调用，删除直接 fetch/旧配置读取。
- [x] 策略生成解析默认 modelId 并通过 Engine 调用，删除直接 fetch/旧配置读取。
- [x] 确认因子任务队列继续传递 userId+modelId，越权/失效配置使任务 FAILED。
- [x] 添加三类消费者统一调用契约的集成测试。

## Phase D — Web UX

- [x] 查询 Ant Design Select/Form/Alert/Empty/Button/Tooltip API 后修改组件。
- [x] 更新前端类型：Provider union、`hasApiKey`、显式 key action。
- [x] 实现 Provider Select、动态规则、已配置密钥状态、替换/清除交互。
- [x] 实现测试连接、空状态、行级 loading、重复提交保护和可访问标签。
- [x] 修复 hook 错误提取与吞异常，增加缺省模型恢复导航。
- [x] 添加创建/编辑/测试/删除/错误/可访问性关键测试。

## Phase E — Quality gate

- [x] Engine lint/type/test（含 fake LiteLLM，不访问外网）。
- [x] API 与 Database lint/type/test/build。
- [x] Web tests/build 与 `antd lint`。
- [x] 从 Web DTO 到 Engine LiteLLM 参数做跨层字段审计。
- [x] 检查日志、错误响应和 git diff，确认无 secret、调试代码或兼容 fallback。
- [x] 使用 `trellis-update-spec` 写入七段式 LLM 跨层可执行契约。

## Validation Commands

```bash
cd apps/engine && uv run pytest -q
cd apps/api && bun test && bun run build
cd packages/database && bun test
cd apps/web && bun test && bun run build
antd lint apps/web/src/features/llm --format json
git diff --check
```

## Risk / Rollback Points

- Secret 格式是有意 breaking change；现有本地模型配置必须重新保存。
- Migration 必须先去重再加唯一索引，避免现有开发库升级失败。
- 不在适配层完成前删除 API direct-fetch；切换完成后同一提交内删除旧路径，避免长期双实现。
- LiteLLM 安装或锁文件变更若失败，不使用手写 Provider 请求作为替代。
