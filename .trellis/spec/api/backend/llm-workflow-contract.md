# LLM Configuration and Invocation Contract

## 1. Scope / Trigger

Use this contract when changing LLM model persistence, secret encryption, Provider validation, factor-mining model selection, stock analysis, strategy generation, Engine LLM routes, or the Web model-management UI. These paths form one security boundary across Web, Elysia, PostgreSQL, Redis, FastAPI, and LiteLLM.

`llm_models` is the only persisted source for executable model configuration. Business consumers pass model IDs and project-owned chat DTOs; they never read credentials or call Provider HTTP APIs directly.

## 2. Signatures

API routes:

- `GET /llm -> LlmModelView[]`
- `POST /llm` with `{ name, provider, modelName, baseUrl?, apiKey?, isDefault? }`
- `PUT /llm/:id` with `{ name?, provider?, modelName?, baseUrl?, isDefault?, apiKeyAction?, apiKey? }`
- `DELETE /llm/:id -> { success: true }`
- `POST /llm/:id/default -> LlmModelView`
- `POST /llm/:id/test -> { success: true, provider, model }`

Engine internal routes:

- `POST /internal/llm/chat` with `{ userId, modelId, messages, temperature?, maxTokens?, jsonMode? }`
- `POST /internal/llm/test` with `{ userId, modelId }`
- Chat response: `{ content, provider, model, usage }`

Queue and consumer signatures:

- Factor mining queue params include both `userId` and `llmModelId`.
- Stock analysis and strategy generation resolve the current user's default model ID in API, then call the Engine chat route.

Database signatures:

- `llm_models.userId -> user.id ON DELETE CASCADE`
- `llm_models.isDefault BOOLEAN NOT NULL DEFAULT false`
- Partial unique index on `llm_models(userId) WHERE isDefault = true`
- Index on `llm_models(userId, createdAt)`
- Unique index on `user_configs(userId, key)`; writes use atomic upsert.

## 3. Contracts

### Secret wire format

- `ENCRYPTION_KEY` is required and is unpadded base64url decoding to exactly 32 bytes.
- Persisted secrets use only `v1:<iv>:<tag>:<ciphertext>`.
- IV is 12 bytes, GCM tag is 16 bytes, and AAD is `stock-quant:llm-api-key:v1`.
- Plaintext, legacy three-part ciphertext, unknown versions, invalid lengths, missing keys, and decryption failures are rejected.
- API responses expose only `hasApiKey`; never return plaintext, ciphertext, Authorization values, or a masking sentinel.
- Update semantics are explicit: `keep`, `replace`, or `clear`. `replace` requires `apiKey`; the other actions forbid it.

### Provider rules

| Provider | LiteLLM model | API key | Base URL |
| --- | --- | --- | --- |
| `openai` | `openai/{modelName}` | required | must be null |
| `anthropic` | `anthropic/{modelName}` | required | must be null |
| `ollama` | `ollama/{modelName}` | optional | omitted means `http://localhost:11434` |
| `openai_compatible` | `openai/{modelName}` | required | required |

Custom URLs allow only HTTP/HTTPS, with no embedded credentials or fragment. API validates syntax and DNS/IP safety before persistence; Engine repeats the network-boundary check immediately before Provider I/O. Private, loopback, link-local, multicast, and reserved addresses require `LLM_ALLOW_PRIVATE_BASE_URLS=true`. The implicit Ollama localhost default is the only built-in local exception.

### Invocation boundary

- `LlmModelConfigLoader.get(user_id, model_id)` queries both identifiers and decrypts fail-closed.
- `LlmModelConfig`, `ChatRequest`, and `ChatResult` are immutable project DTOs.
- `LiteLLMClient` is the only direct LiteLLM caller and the only owner of Provider mapping, SDK response normalization, SDK exception mapping, retry configuration, and sanitized request logging.
- No process-global object may store mutable user credentials.
- Only LiteLLM retry policy retries timeout, connection, rate-limit, and recoverable server failures. Business code must not add a second Provider retry loop.
- `jsonMode=true` requires parseable JSON; invalid or empty content is `LLM_RESPONSE_INVALID`.

### Consumer and UI boundary

- Factor mining requires an explicit current-user model ID; missing, foreign, deleted, or undecryptable configuration makes the task `FAILED`.
- Analysis and strategy generation require a default model; absence returns an actionable message directing the user to model management.
- Web forms use the Provider union, Provider-aware Base URL/key rules, explicit key actions, visible request errors, test connection, row-level loading, duplicate-action prevention, empty state, and accessible icon labels.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing/malformed `ENCRYPTION_KEY` | `LLM_SECRET_INVALID` at Engine execution boundary; no DB/provider continuation |
| Plaintext, legacy, wrong version, wrong key, invalid GCM data | Reject; never return empty string or plaintext fallback |
| Hosted Provider with custom Base URL | HTTP 422 / `LLM_CONFIG_INVALID` |
| OpenAI-compatible without URL/key | HTTP 422 / `LLM_CONFIG_INVALID` |
| Ollama without API key | Valid |
| Unsafe custom URL or unsafe DNS result | HTTP 422 / `LLM_CONFIG_INVALID`; no Provider call |
| Missing or foreign `(userId, modelId)` | 404 / `LLM_CONFIG_NOT_FOUND`; no Provider call |
| Authentication failure | 502 / `LLM_AUTH_FAILED` |
| Rate limit | 502 / `LLM_RATE_LIMITED` |
| Timeout | 504 / `LLM_TIMEOUT` |
| Provider connection/recoverable 5xx exhausted | 502 / `LLM_PROVIDER_UNAVAILABLE` |
| Empty or invalid JSON response when required | 502 / `LLM_RESPONSE_INVALID` |
| Delete model referenced by `FACTOR_TASK_LLM_MODEL` | 409 / `LLM_CONFIG_REFERENCED` |
| Set default for missing/foreign ID | 404; previous default remains unchanged |
| No default for analysis/strategy | 404 with model-management guidance |

## 5. Good / Base / Bad Cases

- Good: a user creates an OpenAI model, the API encrypts its key, a transaction makes it the sole default, analysis resolves that default, Engine loads it by `(userId, modelId)`, and LiteLLM receives project-normalized arguments.
- Base: a user creates Ollama without a key or Base URL; Engine uses the explicit Ollama localhost default and still requires a valid process `ENCRYPTION_KEY` at the execution boundary.
- Bad: API returns `********`, Engine queries only by model ID, a global singleton mutates credentials between tasks, business code calls `/chat/completions`, custom DNS resolves to a private address, or Provider failures fall back to environment credentials.

## 6. Tests Required

- Node/Python fixed-vector tests assert the same independent `v1` ciphertext decrypts to the known plaintext.
- Secret tests assert missing/malformed keys, plaintext, legacy formats, wrong keys, invalid lengths, and corrupt tags fail closed.
- Schema/migration tests assert table creation, user cascade, non-null default, partial unique default, user/key uniqueness, and deduplication-before-index SQL.
- API tests assert trim/length/provider combinations, explicit key actions, `hasApiKey`-only response, actionable default absence, Engine error normalization, and reference-delete conflict behavior.
- Engine tests assert `(userId, modelId)` query parameters, foreign-model fail-closed behavior, four Provider mappings, keyless Ollama, URL safety, JSON validation, usage normalization, exception codes, and bounded retry configuration.
- Consumer tests assert queue payload `userId + llmModelId`, worker failure propagation, analysis prompt snapshot fields, default-model Engine chat, and strategy Engine chat.
- Web tests assert visible request errors, test connection, duplicate row-action blocking, Provider-aware payloads, and accessible actions. Run `antd lint` on changed LLM components.
- Tests must use fake/mocked LiteLLM and must not call a real paid Provider.

## 7. Wrong vs Correct

### Wrong

```ts
const config = await db.select().from(userConfigs);
await fetch(`${config.baseUrl}/chat/completions`, {
  headers: { Authorization: `Bearer ${config.apiKey}` },
});
```

```python
global_llm.set_user_config(user_id)
config = query_by_model_id_only(model_id)
try:
    return decrypt(value)
except Exception:
    return ""
```

### Correct

```ts
const modelId = await LlmService.requireDefaultId(userId);
return engineClient.chatLlm({ userId, modelId, messages, jsonMode: true });
```

```python
config = loader.get(user_id, model_id)
result = llm_client.chat(config, ChatRequest(messages=messages))
```

The correct path keeps secrets inside the persistence/Engine boundary, scopes every model read by user, and exposes only project DTOs and sanitized domain errors.
