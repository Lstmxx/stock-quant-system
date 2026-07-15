# 大模型配置与多 Provider 调用链设计

## 1. Architecture

```text
Web LLM Management
  -> Elysia /llm CRUD + /llm/:id/test
  -> PostgreSQL llm_models (encrypted secret, one default/user)

Factor mining                  Analysis / Strategy
  -> queue userId+modelId        -> resolve user's default modelId
  -> Engine worker               -> API EngineClient
            \                    /
             Engine internal /llm/chat
               -> LlmModelConfigLoader.get(userId, modelId)
               -> LiteLLMClient.chat(config, request)
               -> Provider
```

`llm_models` is the only persisted model source. Business consumers know only model IDs and project DTOs. LiteLLM types remain inside `LiteLLMClient`.

## 2. Secret Contract

`ENCRYPTION_KEY` is base64url without padding and must decode to exactly 32 bytes. There is no default and no hashing of arbitrary strings.

Ciphertext format:

```text
v1:<base64url-12-byte-iv>:<base64url-16-byte-tag>:<base64url-ciphertext>
```

AES-256-GCM additional authenticated data is the literal `stock-quant:llm-api-key:v1`. Both Node and Python reject any other version/segment count/length. Existing three-segment ciphertext and plaintext are intentionally unsupported because the product is pre-launch.

## 3. API Contracts

### Create

```ts
POST /llm
{
  name: string;
  provider: "openai" | "anthropic" | "ollama" | "openai_compatible";
  modelName: string;
  baseUrl?: string;
  apiKey?: string;
  isDefault?: boolean;
}
```

### Update

```ts
PUT /llm/:id
{
  name?: string;
  provider?: Provider;
  modelName?: string;
  baseUrl?: string | null;
  isDefault?: boolean;
  apiKeyAction?: "keep" | "replace" | "clear";
  apiKey?: string;
}
```

`replace` requires non-empty `apiKey`; `keep` forbids it; `clear` stores null and is rejected when the resulting Provider requires a key.

### Response

```ts
interface LlmModelView {
  id: string;
  name: string;
  provider: Provider;
  modelName: string;
  baseUrl: string | null;
  hasApiKey: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### Test connection

`POST /llm/:id/test` invokes a minimal non-JSON chat through Engine and returns `{ success: true, model, provider }`. Domain failures map to stable, sanitized messages; credentials and raw Provider response bodies never cross back to Web.

## 4. Provider Rules

| Provider | LiteLLM model | Key | Base URL | JSON mode |
| --- | --- | --- | --- | --- |
| openai | `openai/{modelName}` | required | null | supported per LiteLLM/model |
| anthropic | `anthropic/{modelName}` | required | null | adapter requests JSON and application validates |
| ollama | `ollama/{modelName}` | optional | default `http://localhost:11434` or explicit allowed URL | application validates |
| openai_compatible | `{modelName}` with explicit `api_base` | configurable but initially required | required | endpoint-dependent |

Provider normalization is owned once in API shared model constants and once defensively in the Python adapter. Arbitrary Provider strings are rejected.

## 5. Engine Domain

```python
@dataclass(frozen=True, slots=True)
class LlmModelConfig:
    id: str
    user_id: str
    provider: Provider
    model_name: str
    api_key: str | None
    api_base: str | None

@dataclass(frozen=True, slots=True)
class ChatRequest:
    messages: tuple[ChatMessage, ...]
    temperature: float = 0.7
    max_tokens: int = 4000
    json_mode: bool = False

@dataclass(frozen=True, slots=True)
class ChatResult:
    content: str
    provider: Provider
    model: str
    usage: TokenUsage | None

class LLMClient(Protocol):
    def chat(self, config: LlmModelConfig, request: ChatRequest) -> ChatResult: ...
```

`LlmModelConfigLoader.get(user_id, model_id)` is read-only: it selects both identifiers and decrypts fail-closed. All list/create/update/delete/default operations remain exclusively in the API `LlmService`. `LiteLLMClient` calls `litellm.completion` and owns model mapping, response normalization and domain exception mapping. It never mutates LiteLLM global credentials.

Retry owner is LiteLLMClient configuration. Authentication, validation and unsupported-provider failures are never retried. Timeout, connection, 429 and selected 5xx errors use bounded exponential retry without a second outer loop.

## 6. Database Design

- Create `llm_models` in a new forward migration matching Drizzle schema.
- `userId` references `user.id` with `ON DELETE CASCADE`.
- Partial unique index: one row where `isDefault = true` per user.
- Index `(userId, createdAt)` for stable listing.
- Unique index `(userConfigs.userId, userConfigs.key)` after deterministic duplicate removal.
- Default operations run in `db.transaction`; target existence is checked before clearing the current default.
- Deleting a referenced model returns conflict. Deleting an unreferenced default is allowed and leaves the explicit “no default” state.

## 7. SSRF Boundary

API validates URL syntax and Provider combinations. Engine repeats network-boundary validation before LiteLLM:

- only `http`/`https`, no URL credentials or fragment;
- hosted OpenAI/Anthropic do not accept custom URL in this release;
- loopback/private/link-local/multicast/reserved destinations are rejected unless `LLM_ALLOW_PRIVATE_BASE_URLS=true`;
- Ollama's canonical localhost URL is allowed only as the explicit Ollama default or when private URLs are enabled for a custom address;
- DNS-resolved addresses are checked immediately before invocation.

## 8. Errors

Domain error codes: `LLM_CONFIG_NOT_FOUND`, `LLM_CONFIG_INVALID`, `LLM_SECRET_INVALID`, `LLM_AUTH_FAILED`, `LLM_RATE_LIMITED`, `LLM_TIMEOUT`, `LLM_PROVIDER_UNAVAILABLE`, `LLM_RESPONSE_INVALID`.

Internal Engine responses contain code and sanitized message. API maps not-found to 404, referenced/delete conflict to 409, validation to 422, and Provider operational failures to 502/504 as appropriate.

## 9. Compatibility and Rollback

- There is deliberately no old secret compatibility. Existing local configs must be recreated.
- Database migration rollback drops only the newly created indexes/table; it must not attempt to restore legacy config semantics.
- During implementation, consumer convergence happens after Engine adapter tests pass. A single commit can be reverted if the full cross-layer gate fails; no dual runtime path remains after completion.
- No real Provider calls are used in CI or local verification.
