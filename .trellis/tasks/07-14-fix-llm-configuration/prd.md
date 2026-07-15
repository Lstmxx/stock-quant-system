# 修复大模型配置与多 Provider 调用链

## Goal

把 `llm_models` 建成唯一、用户隔离的大模型配置源，消除密钥泄漏和跨用户凭据复用风险，通过项目自有 `LLMClient` + LiteLLM Python SDK 支持 OpenAI、Anthropic、Ollama 与 OpenAI-compatible Provider，并让因子挖掘、股票分析和策略生成共享同一调用契约。

## Background

- 当前 API 与 Engine 在缺少 `ENCRYPTION_KEY` 时使用仓库内公开的默认密钥。
- Engine 使用全局可变 LLM 单例，未读取 Provider，空 Base URL 会回落到小米端点。
- `llm_models` 只被因子任务部分使用；股票分析和策略生成仍读取 `user_configs.LLM_*` 并直接调用 `/chat/completions`。
- 默认模型写入缺少事务和数据库唯一约束，`llm_models` 也缺少正式 SQL 迁移。
- 项目尚未上线，不保留旧密文、旧明文或旧 `user_configs.LLM_*` 的兼容读取。

## Requirements

### R1 — Secret contract

- `ENCRYPTION_KEY` 必须是明确格式的 32-byte secret；缺失或非法时，加解密和 Engine LLM 启动边界必须失败。
- 新密文使用唯一的版本化 AES-256-GCM 格式；API 加密与 Engine 解密必须由固定向量证明跨语言一致。
- 删除硬编码 fallback、明文兼容、旧三段密文读取和解密失败返回空字符串的行为。
- API 响应不得返回明文、密文或 `********` sentinel，只返回 `hasApiKey`。
- 更新密钥使用显式 `apiKeyAction: keep | replace | clear`。

### R2 — Database consistency

- 为 `llm_models` 添加正式迁移、用户外键级联、必要索引和每用户最多一个默认模型的数据库约束。
- `isDefault` 必须 `NOT NULL DEFAULT false`。
- `user_configs` 添加 `(userId, key)` 唯一约束并使用原子 upsert；迁移在加约束前去重。
- 默认模型切换、创建默认模型和删除引用处理必须在事务中完成；无效或外部用户 ID 返回 not found，不得破坏当前默认值。
- 删除被 `FACTOR_TASK_LLM_MODEL` 引用的模型时返回可操作冲突错误；不静默留下失效引用。

### R3 — Provider and validation contract

- Provider 限定为 `openai | anthropic | ollama | openai_compatible`。
- Provider 决定 LiteLLM 模型前缀、API Key 必填性、Base URL 规则和 JSON mode 能力。
- OpenAI/Anthropic 使用官方默认端点时不接受任意 Base URL；Ollama/API-compatible 地址执行 URL 与 SSRF 校验。
- 私网自定义地址只有 `LLM_ALLOW_PRIVATE_BASE_URLS=true` 时允许；Ollama 本地默认地址作为显式 Provider 规则处理。
- 名称、模型名、URL 与密钥操作在 API 边界完成 trim、长度和组合校验，Engine 再做防御性校验。

### R4 — Unified LLM invocation

- Engine 定义不可变 `LlmModelConfig`、`ChatRequest`、`ChatResult`、领域异常和项目 `LLMClient` 协议。
- `LiteLLMClient` 是第三方 SDK 的唯一直接调用方；业务代码不得依赖 LiteLLM 响应或异常类型。
- 每次调用显式传入 `(userId, modelId)` 加载的配置，删除全局可变用户凭据和环境模型 fallback。
- 只保留一层重试策略；只重试连接失败、超时、429 和可恢复 5xx，并限制总尝试次数。
- 显式选择的模型不存在、越权、密钥无效或不支持所需能力时 fail closed。

### R5 — Consumer convergence

- 因子任务继续使用显式 `llmModelId`，Engine 必须同时按 `userId` 查询。
- 股票分析和策略生成解析当前用户默认 `llm_models`，通过现有 API→Engine 内部客户端调用统一 chat 接口。
- 删除 API 中直接 LLM `fetch` 及 `user_configs.LLM_API_KEY/LLM_BASE_URL/LLM_MODEL` 读取路径。
- 默认模型不存在时返回可操作错误，引导用户进入模型配置页。

### R6 — Configuration UX

- Provider 使用受控 Select，字段提示和校验随 Provider 变化。
- 编辑页只展示“已配置密钥”状态，支持明确保留、替换、清除。
- 提供“测试连接”操作，返回脱敏、可操作的领域错误。
- 列表提供空状态、行级操作 loading、防重复提交、明确删除影响和 icon-only 按钮可访问标签。
- 网络与 API 错误必须可见；缺少模型的因子配置提示可跳转模型管理。

### R7 — Tests and observability

- 为加密、数据库约束/事务、Provider 映射、用户隔离、LiteLLM 异常归一、统一消费者和 Web 关键旅程增加回归测试。
- 日志允许记录请求 ID、内部模型 ID、Provider、耗时、重试与 usage，不得记录密钥、Authorization 或原始敏感响应。
- 不使用真实付费模型；集成测试通过受控 fake/mocked LiteLLM 与测试数据库验证完整边界。

## Acceptance Criteria

- [x] AC1：没有任何硬编码加密密钥、旧密文/明文兼容或解密失败空值 fallback；缺少/非法 key 的测试失败符合预期。
- [x] AC2：Node 加密/Python 解密使用固定独立向量通过，密文格式仅接受新版本。
- [x] AC3：数据库迁移可从当前迁移集创建 `llm_models`，并强制默认唯一、`user_configs` 唯一和用户级联。
- [x] AC4：LLM CRUD 使用类型化 DTO、事务、正确 404/409，响应只暴露 `hasApiKey`。
- [x] AC5：Engine 无全局用户凭据；模型查询按 userId + modelId；错误 Provider、越权和解密失败均不会调用外部服务。
- [x] AC6：OpenAI、Anthropic、Ollama、OpenAI-compatible 都映射到正确 LiteLLM 参数，无密钥 Ollama 可用。
- [x] AC7：因子挖掘、股票分析、策略生成均通过统一 Engine LLM 适配层，旧 `user_configs.LLM_*` 和 API 直连代码删除。
- [x] AC8：Web 支持 Provider 感知表单、密钥动作、连接测试、空状态、可见错误、行级 loading 与可访问操作。
- [x] AC9：相关 API、Engine、Database、Web 测试和构建通过，且没有真实 Provider 请求。

## Out of Scope

- LiteLLM Proxy 或独立网关部署。
- LangChain、Agent 框架、流式输出 UI、成本计费和 Provider 自动 fallback。
- 旧密文、旧明文和旧 LLM user_configs 的数据迁移或兼容读取。
- 真实模型质量与 prompt 内容优化。

## Technical Notes

- 现有本地 `llm_models.apiKey` 值会被视为无效；用户需重新保存密钥。
- 首版保留同步 `LLMClient.chat`，因为因子挖掘已在线程中运行；内部 HTTP 路由可异步包裹同步 SDK 调用。
- LiteLLM 官方 SDK 是 Provider 协议和异常适配基础，项目领域接口仍是稳定边界。
