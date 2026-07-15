from unittest.mock import Mock

from app.core.llm_backend import LLMBackend
from app.core.llm_types import ChatResult, LlmModelConfig


def _config() -> LlmModelConfig:
    return LlmModelConfig(
        id="model-1",
        user_id="user-1",
        provider="openai",
        model_name="gpt-5",
        api_key="secret",
        api_base=None,
    )


def test_chat_uses_the_injected_project_client_and_immutable_config() -> None:
    config = _config()
    client = Mock()
    client.chat.return_value = ChatResult(
        content="ok",
        provider="openai",
        model="openai/gpt-5",
    )
    backend = LLMBackend(config=config, client=client)

    result = backend.chat(
        [{"role": "user", "content": "hello"}],
        temperature=0.2,
        max_tokens=123,
        json_mode=True,
    )

    assert result == "ok"
    called_config, request = client.chat.call_args.args
    assert called_config is config
    assert request.messages == ({"role": "user", "content": "hello"},)
    assert request.temperature == 0.2
    assert request.max_tokens == 123
    assert request.json_mode is True
