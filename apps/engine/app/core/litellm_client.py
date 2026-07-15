"""Thin, project-owned adapter around the LiteLLM Python SDK."""

import ipaddress
import json
import logging
import os
import socket
import time
from collections.abc import Callable
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "true")

import litellm  # noqa: E402
from litellm.types.router import RetryPolicy  # noqa: E402

from .llm_types import (  # noqa: E402
    ChatRequest,
    ChatResult,
    LlmAuthenticationError,
    LlmConfigError,
    LlmModelConfig,
    LlmProviderUnavailableError,
    LlmRateLimitError,
    LlmResponseError,
    LlmTimeoutError,
    TokenUsage,
)


Completion = Callable[..., Any]
UrlValidator = Callable[[str], None]
logger = logging.getLogger(__name__)


def validate_custom_api_base(api_base: str) -> None:
    """Reject unsafe custom destinations immediately before provider I/O."""
    parsed = urlparse(api_base)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise LlmConfigError("自定义 Base URL 必须使用 http 或 https")
    if parsed.username or parsed.password or parsed.fragment:
        raise LlmConfigError("自定义 Base URL 不能包含凭据或 fragment")
    if os.environ.get("LLM_ALLOW_PRIVATE_BASE_URLS", "false").lower() == "true":
        return

    try:
        addresses = {
            result[4][0]
            for result in socket.getaddrinfo(parsed.hostname, parsed.port or 443)
        }
    except socket.gaierror as error:
        raise LlmConfigError("自定义 Base URL 无法解析") from error

    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise LlmConfigError("自定义 Base URL 不允许访问私网或保留地址")


class LiteLLMClient:
    """Map project config to LiteLLM without leaking SDK types to callers."""

    def __init__(
        self,
        completion: Completion = litellm.completion,
        url_validator: UrlValidator = validate_custom_api_base,
        timeout_seconds: float = 180,
        max_retries: int = 2,
    ) -> None:
        self._completion = completion
        self._url_validator = url_validator
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries

    def _resolve(self, config: LlmModelConfig) -> tuple[str, str | None]:
        if config.provider in {"openai", "anthropic"}:
            if config.api_base:
                raise LlmConfigError("托管 Provider 不允许自定义 Base URL")
            if not config.api_key:
                raise LlmConfigError("当前 Provider 必须配置 API Key")
            return f"{config.provider}/{config.model_name}", None

        if config.provider == "ollama":
            if config.api_base:
                self._url_validator(config.api_base)
                return f"ollama/{config.model_name}", config.api_base
            return f"ollama/{config.model_name}", "http://localhost:11434"

        if config.provider == "openai_compatible":
            if not config.api_key or not config.api_base:
                raise LlmConfigError("OpenAI-compatible 配置需要 API Key 和 Base URL")
            self._url_validator(config.api_base)
            return f"openai/{config.model_name}", config.api_base

        raise LlmConfigError("不支持的大模型 Provider")

    def chat(self, config: LlmModelConfig, request: ChatRequest) -> ChatResult:
        model, api_base = self._resolve(config)
        started_at = time.perf_counter()
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": list(request.messages),
            "api_key": config.api_key,
            "api_base": api_base,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "timeout": self._timeout_seconds,
            "stream": False,
            "num_retries": self._max_retries,
            "retry_policy": RetryPolicy(
                BadRequestErrorRetries=0,
                AuthenticationErrorRetries=0,
                ContentPolicyViolationErrorRetries=0,
                TimeoutErrorRetries=self._max_retries,
                RateLimitErrorRetries=self._max_retries,
                InternalServerErrorRetries=self._max_retries,
            ),
        }
        if request.json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            response = self._completion(**kwargs)
        except litellm.AuthenticationError as error:
            raise LlmAuthenticationError("模型认证失败，请检查 API Key") from error
        except litellm.RateLimitError as error:
            raise LlmRateLimitError("模型服务限流，请稍后重试") from error
        except litellm.Timeout as error:
            raise LlmTimeoutError("模型调用超时") from error
        except litellm.BadRequestError as error:
            raise LlmConfigError("模型请求参数或能力不受支持") from error
        except (litellm.APIConnectionError, litellm.ServiceUnavailableError) as error:
            raise LlmProviderUnavailableError("模型服务暂时不可用") from error
        except Exception as error:
            raise LlmProviderUnavailableError("模型调用失败") from error

        content = self._extract_content(response)
        if request.json_mode:
            try:
                json.loads(content)
            except json.JSONDecodeError as error:
                raise LlmResponseError("模型未返回有效 JSON") from error
        usage = self._extract_usage(response)
        logger.info(
            "LLM request completed model_id=%s provider=%s duration_ms=%d retries=%d usage=%s",
            config.id,
            config.provider,
            int((time.perf_counter() - started_at) * 1000),
            self._max_retries,
            usage.total_tokens if usage else None,
        )
        return ChatResult(
            content=content,
            provider=config.provider,
            model=model,
            usage=usage,
        )

    @staticmethod
    def _extract_content(response: Any) -> str:
        try:
            content = response.choices[0].message.content
        except (AttributeError, IndexError, TypeError) as error:
            raise LlmResponseError("模型返回格式无效") from error
        if not isinstance(content, str) or not content.strip():
            raise LlmResponseError("模型返回了空内容")
        return content.strip()

    @staticmethod
    def _extract_usage(response: Any) -> TokenUsage | None:
        usage = getattr(response, "usage", None)
        if usage is None:
            return None
        try:
            return TokenUsage(
                prompt_tokens=int(usage.prompt_tokens),
                completion_tokens=int(usage.completion_tokens),
                total_tokens=int(usage.total_tokens),
            )
        except (AttributeError, TypeError, ValueError):
            return None


@lru_cache(maxsize=1)
def get_default_llm_client() -> LiteLLMClient:
    """Reuse the stateless SDK adapter without storing user credentials globally."""
    return LiteLLMClient()
