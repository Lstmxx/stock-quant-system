"""Project-owned LLM domain types and sanitized errors."""

from dataclasses import dataclass
from typing import Literal, Protocol


LlmProvider = Literal["openai", "anthropic", "ollama", "openai_compatible"]
ChatMessage = dict[str, str]


class LlmError(RuntimeError):
    code = "LLM_PROVIDER_UNAVAILABLE"


class LlmConfigNotFoundError(LlmError):
    code = "LLM_CONFIG_NOT_FOUND"


class LlmConfigError(LlmError):
    code = "LLM_CONFIG_INVALID"


class LlmSecretError(LlmError):
    code = "LLM_SECRET_INVALID"


class LlmAuthenticationError(LlmError):
    code = "LLM_AUTH_FAILED"


class LlmRateLimitError(LlmError):
    code = "LLM_RATE_LIMITED"


class LlmTimeoutError(LlmError):
    code = "LLM_TIMEOUT"


class LlmProviderUnavailableError(LlmError):
    code = "LLM_PROVIDER_UNAVAILABLE"


class LlmResponseError(LlmError):
    code = "LLM_RESPONSE_INVALID"


@dataclass(frozen=True, slots=True)
class LlmModelConfig:
    id: str
    user_id: str
    provider: LlmProvider
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
class TokenUsage:
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


@dataclass(frozen=True, slots=True)
class ChatResult:
    content: str
    provider: LlmProvider
    model: str
    usage: TokenUsage | None = None


class LLMClient(Protocol):
    def chat(self, config: LlmModelConfig, request: ChatRequest) -> ChatResult: ...
