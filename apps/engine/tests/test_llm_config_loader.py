from unittest.mock import MagicMock

import pytest

from app.core.llm_config_loader import LlmModelConfigLoader
from app.core.llm_types import LlmConfigNotFoundError, LlmSecretError


ENCRYPTION_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"


class _Connection:
    def __init__(self, row):
        self._row = row
        self.params = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def execute(self, _query, params):
        self.params = params
        return MagicMock(fetchone=MagicMock(return_value=self._row))


class _Engine:
    def __init__(self, connection: _Connection):
        self.connection = connection

    def connect(self):
        return self.connection


def test_loads_config_with_both_user_and_model_scope(monkeypatch) -> None:
    monkeypatch.setenv("ENCRYPTION_KEY", ENCRYPTION_KEY)
    connection = _Connection(
        (
            "model-1",
            "user-1",
            "openai",
            "gpt-5",
            None,
            "v1:AAECAwQFBgcICQoL:wjZy1MWVtBDV-SwoAj2UDA:NGn7b6CWtjbsMf6m2owB",
        )
    )
    loader = LlmModelConfigLoader(_Engine(connection))

    config = loader.get("user-1", "model-1")

    assert connection.params == {"user_id": "user-1", "model_id": "model-1"}
    assert config.api_key == "sk-test-api-key"
    assert config.provider == "openai"


def test_foreign_or_missing_model_fails_closed(monkeypatch) -> None:
    monkeypatch.setenv("ENCRYPTION_KEY", ENCRYPTION_KEY)
    loader = LlmModelConfigLoader(_Engine(_Connection(None)))

    with pytest.raises(LlmConfigNotFoundError):
        loader.get("user-2", "model-1")


def test_missing_engine_encryption_key_fails_before_database_access(
    monkeypatch,
) -> None:
    monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
    connection = _Connection(None)
    loader = LlmModelConfigLoader(_Engine(connection))

    with pytest.raises(LlmSecretError):
        loader.get("user-1", "model-1")

    assert connection.params is None
