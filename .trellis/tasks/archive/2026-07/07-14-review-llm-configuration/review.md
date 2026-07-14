# 大模型配置模块评审报告

## 1. 结论

当前模块具备模型配置 CRUD、因子任务选模型和 Engine 调用 LLM 的基本链路，但还不是可靠的“多 Provider 配置中心”。主要问题不是 `requests` 本身，而是配置来源分裂、Provider 语义未落地、密钥边界不安全，以及默认模型与引用关系缺少数据库一致性保障。

建议采用“真正多 Provider + LiteLLM Python SDK + 项目自有薄适配层”，并让 API 内的分析、策略生成逐步收敛到同一调用边界。首版不引入 LiteLLM Proxy，不引入 LangChain，也不同时保留两套重试逻辑。

## 2. 当前数据流

```text
Web /llm 表单
  -> API /llm CRUD
  -> llm_models（provider/apiKey/baseUrl/modelName/isDefault）

因子任务
  -> user_configs.FACTOR_TASK_LLM_MODEL
  -> 队列 llmModelId
  -> Engine AlphaMiner
  -> 全局可变 llm_backend
  -> requests POST {baseUrl}/chat/completions

股票分析 / 策略生成
  -> user_configs.LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
  -> API 内直接 fetch {baseUrl}/chat/completions
```

因此，`llm_models` 的“默认模型”目前没有实际消费者；用户在模型管理页新增或设为默认后，股票分析与策略生成仍可能提示未配置。

## 3. 风险与优化项

### P0：必须先修复

#### 3.1 可预测的默认加密密钥

- API `apps/api/src/lib/crypto.ts:3-7` 和 Engine `apps/engine/app/core/crypto.py:31-34` 使用相同硬编码 fallback。
- 当前环境未配置 `ENCRYPTION_KEY`，即实际正在使用仓库内公开的密钥。
- 解密逻辑还兼容无分隔符明文；密钥变更后返回空值，缺少密钥版本、轮换和迁移机制。

影响：获取数据库密文的人只需同时看到代码，就可以解密模型 API Key；轮换失败还可能触发后续错误凭据 fallback。

建议：API 与 Engine 启动时强制校验 `ENCRYPTION_KEY`；密文增加版本/密钥 ID；提供旧密文重加密与回滚方案；迁移后移除明文兼容；解密失败抛出领域错误；增加真实 Node/Python 双向固定向量测试。

#### 3.2 模型可能把密钥发给错误 Provider

- Web 把 Base URL 标记为可选：`apps/web/src/features/llm/components/LlmModelFormModal.tsx:70-74`。
- Engine 未读取 `provider`，空 Base URL 会回落到小米默认地址：`apps/engine/app/core/llm_backend.py:77-106`。
- `chat` 始终按 OpenAI Chat Completions 协议发送：`apps/engine/app/core/llm_backend.py:147-178`。

影响：例如 OpenAI 或 Anthropic 模型没有填写 Base URL 时，API Key 可能被发送到错误服务端。

建议：Provider 必须参与配置解析；移除跨 Provider 的全局默认 Base URL；由 Provider 规则决定默认端点、密钥要求和模型前缀。

#### 3.3 全局可变 LLM 单例可能跨用户复用凭据

- `get_llm()` 返回进程级单例。
- `set_user_config` 只覆盖存在的字段，不会完整清空上一用户状态：`apps/engine/app/core/llm_backend.py:48-75`。
- `AlphaMiner` 捕获选中模型加载失败并回落：`apps/engine/app/core/alpha_miner.py:60-77`。
- `chat` 再用 `self.api_key` 等进程状态补缺。

影响：顺序处理不同用户任务时，也可能使用上一用户或环境级凭据，造成数据隔离和计费风险。

建议：使用每任务不可变 `LlmModelConfig`；按 `(userId, modelId)` 加载；删除全局凭据 mutation；显式模型加载或解密失败时直接失败，不做静默 fallback。

#### 3.4 数据库迁移缺失

- `packages/database/src/schema.ts:181-192` 已声明 `llm_models`。
- `packages/database/drizzle/*.sql` 没有创建该表的迁移。

影响：通过迁移创建的新环境可能直接缺表，开发环境使用 `db push` 会掩盖问题。

建议：补齐建表迁移，并同时添加外键、常用索引和默认模型唯一性约束。

### P1：核心功能一致性

#### 3.5 配置来源分裂，默认模型实际无效

- 因子任务使用 `FACTOR_TASK_LLM_MODEL` 指向 `llm_models`。
- 股票分析使用旧 `user_configs.LLM_*`：`apps/api/src/modules/analysis/service.ts:289-300`。
- 策略生成同样使用旧配置：`apps/api/src/modules/strategy/service.ts:59-68`。
- `isDefault` 只在 CRUD 和 UI 中出现，没有业务消费者。

建议把 `llm_models` 设为唯一模型配置源：显式场景保存 `modelId`；未显式选择时解析当前用户默认模型；API 的分析和策略调用统一 LLM 边界；迁移旧 `user_configs.LLM_*` 后删除旧路径。

#### 3.6 Provider 字段只是自由文本，没有形成能力模型

表单提示 OpenAI、Anthropic、Ollama，但 API 接受任意字符串，Engine 和 API 只实现 OpenAI-compatible 请求格式；Ollama 常见场景不需要 API Key，当前 Engine 却强制要求。

建议首批支持受控 Provider：

| Provider | LiteLLM 模型名 | API Key | Base URL | 备注 |
| --- | --- | --- | --- | --- |
| OpenAI | `openai/{modelName}` | 必需 | 通常不填 | 可允许受控兼容端点 |
| Anthropic | `anthropic/{modelName}` | 必需 | 通常不填 | 使用原生 Provider 语义 |
| Ollama | `ollama/{modelName}` | 可选 | 必需或本地默认值 | 私网访问需单独策略 |
| OpenAI-compatible | Provider 专用映射 | 按服务要求 | 必需 | 不与 OpenAI 原生配置混用 |

同时维护 `supportsJsonMode`、`supportsStreaming`、`requiresApiKey` 等能力元数据，避免 UI 与运行时各自猜测。

#### 3.7 默认模型写入不原子

- create/update/setDefault 都先清除旧默认，再执行目标写入：`apps/api/src/modules/llm/service.ts:25-71`。
- 无事务、无数据库部分唯一索引；无效或越权 ID 可以把当前默认模型清空，并发请求可以产生多个默认。
- `isDefault` 允许 `NULL`。

建议使用事务完成“验证用户范围 -> 清旧默认 -> 设置新默认”；数据库增加每用户最多一个默认模型的部分唯一索引；字段设为 `NOT NULL DEFAULT false`；所有更新/删除检查受影响行数，未找到返回 404。

#### 3.8 删除模型缺少引用处理

删除不会处理 `FACTOR_TASK_LLM_MODEL`，删除默认模型也不会选择替代项；用户直到下次创建任务才看到失败。

建议删除前返回引用信息并让用户确认；阻止删除被任务配置引用的模型，或在同一事务中显式清理引用；默认删除后清晰展示“未配置默认模型”。

#### 3.9 Base URL 存在 SSRF 风险

登录用户可保存任意 Base URL，API/Engine 会代表服务器访问它。Provider 支持本地 Ollama 又意味着不能简单禁止所有私网地址。

建议按部署策略拆分：托管 Provider 仅允许官方/管理员白名单 HTTPS 地址；OpenAI-compatible 自定义地址默认只允许公网；私网/Ollama 由管理员显式开启，并限制协议、主机、端口、重定向和 DNS 解析结果。

#### 3.10 Secret DTO 和输入校验不清晰

- service 使用 `any`，缺少 trim、长度、Provider、URL 和 Provider 必填字段校验。
- create/update 返回含加密 API Key 的数据库行。
- list 把 `"********"` 放回 `apiKey` 字段；更新又把它解释为“保持不变”。
- 用户无法明确执行“清除 API Key”。

建议响应只返回 `hasApiKey: boolean`，永不返回明文或密文；更新使用 `apiKeyAction: keep | replace | clear`；接口 schema 与 service 输入使用同一受控 DTO。

#### 3.11 `user_configs` 缺少唯一约束

`packages/database/src/schema.ts:28-35` 没有 `(userId, key)` 唯一约束；当前先查后插的 upsert 在并发下会产生重复值，消费者又使用不确定的第一条或字典覆盖结果。

建议添加唯一约束并改为数据库原子 upsert；迁移前先检测和归并重复配置。

### P2：用户体验与可运维性

#### 3.12 配置表单

- Provider 改为受控 Select，并提供常见 Provider 预设。
- 根据 Provider 动态解释/校验 API Key、Base URL、模型名。
- 编辑时显示“已配置密钥”，不要把 `********` 填进密码框。
- 增加“测试连接”，保存与测试分离；错误只返回脱敏、可操作信息。
- 可展示最近测试时间和状态，但不要把一次测试成功当成永久健康证明。

#### 3.13 列表与反馈

- 增加空状态和首次配置引导。
- 默认模型操作增加行级 loading/禁用，避免重复点击。
- 删除确认展示模型名、默认状态及引用影响。
- icon-only 按钮补 `aria-label`/tooltip。
- `useLlmModels` 不再吞掉网络异常；当前 `String(error.value)` 还可能只显示 `[object Object]`。
- 全局 fetcher 发出的 `api-error` 没有监听器，应统一到应用级错误提示或由 hook 显式处理。
- 因子配置缺少模型时，提示应可直接跳转模型配置页。

#### 3.14 可观测性

记录请求 ID、用户/模型内部 ID、Provider、延迟、重试次数、状态类别和 token usage；绝不记录 API Key、Authorization、完整敏感 prompt 或原始 Provider 错误响应。对认证失败、限流、超时、Provider 不支持和响应格式错误使用稳定领域错误码。

## 4. LiteLLM 薄适配层设计

LiteLLM 官方 Python SDK 提供统一的 OpenAI 风格输入/输出、Provider 路由、异常映射、重试/回退与流式能力，适合放在 Engine 基础设施层。项目仍需自己的薄适配层，避免业务代码直接依赖 LiteLLM 参数和异常类型。

```python
@dataclass(frozen=True)
class LlmModelConfig:
    id: str
    user_id: str
    provider: Provider
    model_name: str
    api_key: str | None
    api_base: str | None

@dataclass(frozen=True)
class ChatRequest:
    messages: list[ChatMessage]
    timeout_seconds: float
    response_format: ResponseFormat | None = None

@dataclass(frozen=True)
class ChatResult:
    content: str
    provider: str
    model: str
    usage: TokenUsage | None

class LLMClient(Protocol):
    def chat(self, config: LlmModelConfig, request: ChatRequest) -> ChatResult: ...
```

`LiteLLMClient` 负责：

1. 把受控 Provider 映射为 `openai/...`、`anthropic/...`、`ollama/...` 等 LiteLLM 模型名。
2. 显式传递该任务的 `api_key`、`api_base` 和 timeout，不写入全局环境或单例状态。
3. 把 LiteLLM 异常转换为项目领域异常，例如认证、限流、超时、配置、Provider 和格式错误。
4. 选择唯一重试所有者；若使用 LiteLLM 重试，删除现有无差别循环，只重试超时、连接失败、429 和部分 5xx，并设置退避/jitter 与总时限。
5. 对 JSON 输出先校验 Provider 能力，再选择原生 structured output 或严格应用层解析。

首版继续同步接口是合理的：当前 `AlphaMiner` 已在线程中运行同步挖掘逻辑。以后确有高并发需求再增加 `AsyncLLMClient`，不要在同一次迁移中扩大范围。

API 内的股票分析与策略生成不应各自直接依赖 LiteLLM。推荐通过受信任的 Engine 内部接口或共享应用服务调用同一适配层，并由服务端上下文确定 userId，避免客户端任意指定其他用户模型。

## 5. 分阶段实施顺序

### 阶段 A：安全与一致性止血

1. 强制加密密钥、版本化密文、旧数据重加密、跨语言测试。
2. 去掉 Engine 全局可变凭据和错误 Provider/Base URL fallback。
3. 补齐 `llm_models` 迁移、默认唯一约束和 `user_configs` 唯一约束。
4. 显式模型加载/解密失败时 fail closed，并返回可操作错误。

### 阶段 B：统一调用层

1. 定义 Provider enum、能力元数据、领域 DTO/错误。
2. 增加项目 `LLMClient` 和 LiteLLM 实现，用测试替换旧 `requests` 路径。
3. 因子任务先切换到新适配层。
4. 股票分析与策略生成切换到统一模型解析和调用入口。
5. 迁移并移除旧 `user_configs.LLM_*`。

### 阶段 C：完整产品体验

1. Provider 感知表单、secret 状态、测试连接。
2. 默认模型真正成为无显式选择场景的 fallback。
3. 删除引用保护、行级状态、空状态、可访问性和错误恢复。
4. 增加审计、指标、限流和成本/token 可观测性。

## 6. 必需测试矩阵

- 加密：Node/Python 双向固定向量、错 key、旧版本迁移、启动缺 key。
- Repository：严格 userId 隔离、缺模型、删除模型、解密失败、无跨任务状态。
- Provider：OpenAI、Anthropic、Ollama、OpenAI-compatible 的模型映射、Key/Base URL 规则。
- Adapter：成功、空响应、格式错误、401、429、timeout、5xx、Retry-After、总重试时限、JSON mode 能力。
- API：默认模型事务、并发唯一、越权 ID、404、secret DTO、URL 策略、删除引用。
- 跨层：Web 保存 -> DB -> API/队列 -> Engine 加载 -> LiteLLM 参数映射；股票分析和策略生成解析同一默认模型。
- Web：新建/编辑/清 key、Provider 动态字段、测试连接、空状态、网络错误、重复点击、键盘与辅助技术标签。

## 7. 已执行验证

- `antd lint src/features/llm --format json`：0 个静态规则问题。
- `bun test src/modules/task/service.test.ts src/modules/analysis/service.test.ts`：12 passed。
- API build：通过。
- Web build：通过；存在与本模块无关的既有 Tailwind/LightningCSS unknown at-rule 警告。
- `uv run pytest tests/test_llm_backend.py tests/test_crypto.py tests/test_worker_mining.py -q`：13 passed。
- 未执行真实付费 LLM 请求；当前测试覆盖不足以验证 Provider 兼容、安全隔离和跨语言加密。

## 8. 参考资料

- LiteLLM Python SDK 与多 Provider 统一接口：https://docs.litellm.ai/
- OpenAI Python SDK 的同步/异步客户端、重试、超时与错误处理：https://github.com/openai/openai-python/blob/main/README.md
