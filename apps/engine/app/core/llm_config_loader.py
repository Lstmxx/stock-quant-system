"""Read-only loader for user-scoped LLM execution configuration."""

from functools import lru_cache

from sqlalchemy import Engine, create_engine, text

from app.config import settings

from .crypto import decrypt, validate_encryption_key
from .llm_types import (
    LlmConfigError,
    LlmConfigNotFoundError,
    LlmModelConfig,
    LlmSecretError,
)


_PROVIDERS = {"openai", "anthropic", "ollama", "openai_compatible"}


class LlmModelConfigLoader:
    """Load one model by both owner and ID; never mutates configuration."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def get(self, user_id: str, model_id: str) -> LlmModelConfig:
        try:
            validate_encryption_key()
        except ValueError as error:
            raise LlmSecretError("Engine 加密密钥未配置或格式无效") from error

        with self._engine.connect() as connection:
            row = connection.execute(
                text(
                    'SELECT id, "userId", provider, "modelName", "baseUrl", "apiKey" '
                    'FROM llm_models WHERE id = :model_id AND "userId" = :user_id'
                ),
                {"user_id": user_id, "model_id": model_id},
            ).fetchone()

        if row is None:
            raise LlmConfigNotFoundError("大模型配置不存在或无权访问")

        config_id, owner_id, provider, model_name, api_base, encrypted_key = row
        if provider not in _PROVIDERS:
            raise LlmConfigError("大模型 Provider 配置无效")
        if not model_name or not str(model_name).strip():
            raise LlmConfigError("大模型名称配置无效")

        try:
            api_key = decrypt(encrypted_key) if encrypted_key else None
        except ValueError as error:
            raise LlmSecretError("大模型密钥无法解密，请重新保存配置") from error

        return LlmModelConfig(
            id=str(config_id),
            user_id=str(owner_id),
            provider=provider,  # type: ignore[arg-type]
            model_name=str(model_name).strip(),
            api_key=api_key,
            api_base=str(api_base).rstrip("/") if api_base else None,
        )


@lru_cache(maxsize=1)
def get_default_config_loader() -> LlmModelConfigLoader:
    """Return a process-wide loader backed by SQLAlchemy's connection pool."""
    return LlmModelConfigLoader(create_engine(settings.database_url))
