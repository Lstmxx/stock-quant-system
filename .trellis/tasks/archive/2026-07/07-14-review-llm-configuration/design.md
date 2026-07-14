# 大模型配置模块审查设计

## Review Boundary

审查覆盖以下边界：

1. Web 管理页、表单、表格、数据 Hook 与因子任务模型选择。
2. API 的 `/llm` CRUD/default 路由、输入模型、服务层与加密工具。
3. PostgreSQL 的 `llm_models`、`user_configs` 结构和约束。
4. Engine 的模型配置加载、跨语言解密和实际请求构造。
5. API 个股分析、策略生成与 Engine 因子挖掘三类消费路径。

## Data Flow To Verify

```text
Web LLM form
  -> API /llm
  -> llm_models (encrypted apiKey)
  -> factor task stores llmModelId in user_configs
  -> queue payload
  -> Engine loads llm_models and decrypts key
  -> OpenAI-compatible /chat/completions

API stock analysis / strategy generation
  -> user_configs and/or environment variables
  -> provider endpoint
```

重点核对两条路径是否共享同一“默认模型”语义，以及配置管理页的字段是否都能影响最终请求。

## Review Method

- 静态追踪：从 UI 事件开始，逐层追踪参数、返回值、数据库写入及消费方。
- 反例验证：无 API Key、空 Base URL、原生 Anthropic、无效默认 ID、删除已引用模型、并发设默认、加密密钥缺失。
- 测试审查：检查已有单元/集成测试，必要时运行只读测试命令确认实际行为。
- UX 启发式检查：初次使用、编辑已有密钥、加载/保存/删除反馈、空状态、可访问性与防重复操作。

## Severity

- Critical：可能泄露跨用户密钥、使用可预测密钥保护秘密，或核心配置链路事实上不可用。
- High：用户操作成功但业务使用了不同配置，或常见配置会请求错误的提供商。
- Medium：错误恢复、并发一致性、验证缺失或明显体验阻力。
- Low：文案、可访问性、类型和维护性问题。

## Output Contract

最终报告先给 findings，按严重程度排序；每项包含证据位置、实际行为、用户影响、建议修复和建议测试。随后给出整体数据流判断与分阶段优化路线。

## LLM Client Options

### Option A: OpenAI Python SDK

- 适用：所有服务都明确提供 OpenAI-compatible API。
- 优点：改动小；官方 SDK 提供同步/异步客户端、连接复用、类型化响应、超时、自动重试与异常分类；支持自定义 `base_url`。
- 限制：不能把原生 Anthropic Messages API 自动转换成 Chat Completions；`provider` 仍只是展示字段。
- 官方依据：[openai-python README](https://github.com/openai/openai-python/blob/main/README.md)。

### Option B: LiteLLM Python SDK behind a local adapter (Selected)

- 适用：产品要兑现 OpenAI、Anthropic、Ollama 等多 Provider 配置语义。
- 优点：统一 OpenAI 风格输入输出；按 Provider 转换请求；支持统一异常、重试、fallback、流式输出和可观测性扩展。
- 限制：依赖体积和升级面更大；模型标识需要规范为 Provider-aware 格式；仍需自有薄适配层隔离第三方 API。
- 初期只引入 Python SDK，不部署 LiteLLM Proxy，避免提前增加独立网关运维。
- 官方依据：[LiteLLM Getting Started](https://docs.litellm.ai/)。

### Option C: Keep raw requests

- 优点：依赖少。
- 缺点：项目继续自行维护连接池、重试分类、429/5xx、Retry-After、响应校验、Provider 协议和可观测性；不符合当前多 Provider UI 暗示。

### Recommended Boundary

保留项目自己的 `LLMClient`/adapter 接口，让业务层只传标准化的 messages 与生成参数。adapter 内部使用 LiteLLM Python SDK，禁止业务代码直接依赖 LiteLLM 响应对象。这样可在不改因子生成业务接口的前提下替换传输层，并保留未来更换 SDK 的能力。

## Confirmed Decision

- 产品支持真正多 Provider，而非仅支持 OpenAI-compatible endpoint。
- Engine 传输层选用 LiteLLM Python SDK；初期不部署 LiteLLM Proxy。
- 项目自有 adapter 负责把数据库字段转换为 LiteLLM 参数，并把第三方异常/响应归一化为项目类型。
- 审查必须核对至少 OpenAI、Anthropic、Ollama 三类配置：Provider-aware model 标识、自定义 `api_base`、API Key 可选规则、JSON mode 能力差异和错误提示。
- API 内现存的直接 LLM `fetch` 调用也纳入收敛建议，避免 Engine 已多 Provider 而个股分析/策略生成仍固定 OpenAI Chat Completions。

## Compatibility / Safety

本轮不写业务代码、不迁移数据、不访问真实 LLM。若诊断测试可能访问数据库或网络，先限制为现有 mock/静态测试；没有必要时不执行外部请求。
