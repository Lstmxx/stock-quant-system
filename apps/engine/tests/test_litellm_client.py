from types import SimpleNamespace
from unittest.mock import Mock

import litellm
import pytest

from app.core.litellm_client import LiteLLMClient, validate_custom_api_base
from app.core.llm_types import (
    ChatRequest,
    LlmAuthenticationError,
    LlmConfigError,
    LlmModelConfig,
    LlmRateLimitError,
    LlmResponseError,
    LlmTimeoutError,
)


def _response(content: str = "ok") -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=2, completion_tokens=3, total_tokens=5),
    )


def _config(
    provider: str,
    *,
    api_key: str | None = "secret",
    api_base: str | None = None,
) -> LlmModelConfig:
    return LlmModelConfig(
        id="model-1",
        user_id="user-1",
        provider=provider,
        model_name="model-name",
        api_key=api_key,
        api_base=api_base,
    )


@pytest.mark.parametrize(
    ("provider", "api_base", "expected_model"),
    [
        ("openai", None, "openai/model-name"),
        ("anthropic", None, "anthropic/model-name"),
        ("ollama", None, "ollama/model-name"),
        (
            "openai_compatible",
            "https://gateway.example.com/v1",
            "openai/model-name",
        ),
    ],
)
def test_maps_provider_config_to_litellm(
    provider: str, api_base: str | None, expected_model: str
) -> None:
    completion = Mock(return_value=_response())
    client = LiteLLMClient(completion=completion, url_validator=lambda _: None)

    result = client.chat(
        _config(provider, api_base=api_base),
        ChatRequest(messages=({"role": "user", "content": "hello"},)),
    )

    kwargs = completion.call_args.kwargs
    assert kwargs["model"] == expected_model
    assert kwargs.get("api_base") == api_base or (
        provider == "ollama" and kwargs["api_base"] == "http://localhost:11434"
    )
    assert result.content == "ok"
    assert result.usage is not None and result.usage.total_tokens == 5


def test_allows_ollama_without_an_api_key() -> None:
    completion = Mock(return_value=_response())
    client = LiteLLMClient(completion=completion, url_validator=lambda _: None)

    client.chat(
        _config("ollama", api_key=None),
        ChatRequest(messages=({"role": "user", "content": "hello"},)),
    )

    assert completion.call_args.kwargs["api_key"] is None


@pytest.mark.parametrize(
    ("provider_error", "domain_error"),
    [
        (
            litellm.AuthenticationError("bad key", "openai", "gpt"),
            LlmAuthenticationError,
        ),
        (litellm.RateLimitError("limited", "openai", "gpt"), LlmRateLimitError),
        (litellm.Timeout("timeout", "gpt", "openai"), LlmTimeoutError),
    ],
)
def test_normalizes_provider_errors(
    provider_error: Exception, domain_error: type[Exception]
) -> None:
    completion = Mock(side_effect=provider_error)
    client = LiteLLMClient(completion=completion, url_validator=lambda _: None)

    with pytest.raises(domain_error):
        client.chat(
            _config("openai"),
            ChatRequest(messages=({"role": "user", "content": "hello"},)),
        )


def test_rejects_empty_provider_response() -> None:
    client = LiteLLMClient(
        completion=Mock(return_value=_response("   ")), url_validator=lambda _: None
    )

    with pytest.raises(LlmResponseError):
        client.chat(
            _config("openai"),
            ChatRequest(messages=({"role": "user", "content": "hello"},)),
        )


def test_json_mode_rejects_non_json_content() -> None:
    client = LiteLLMClient(
        completion=Mock(return_value=_response("not json")),
        url_validator=lambda _: None,
    )

    with pytest.raises(LlmResponseError, match="JSON"):
        client.chat(
            _config("openai"),
            ChatRequest(
                messages=({"role": "user", "content": "hello"},),
                json_mode=True,
            ),
        )


def test_custom_base_url_rejects_private_dns_results(monkeypatch) -> None:
    monkeypatch.delenv("LLM_ALLOW_PRIVATE_BASE_URLS", raising=False)
    monkeypatch.setattr(
        "app.core.litellm_client.socket.getaddrinfo",
        lambda *_args: [(None, None, None, None, ("127.0.0.1", 443))],
    )

    with pytest.raises(LlmConfigError, match="私网"):
        validate_custom_api_base("https://gateway.example.com/v1")
