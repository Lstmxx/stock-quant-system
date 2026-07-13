"""
tests/test_llm_backend.py
==========================
TDD tests for LLMBackend.chat() llm_config parameter injection (方案Q).

Design under test:
  - chat(..., llm_config=None) → uses instance defaults (api_key, base_url, model)
  - chat(..., llm_config={...}) → uses config dict values for this call only,
    does NOT mutate instance state
"""
from unittest.mock import MagicMock, patch

import pytest
import requests

from app.core.llm_backend import LLMBackend


FAKE_RESPONSE_BODY = {
    "choices": [{"message": {"content": "ok"}}]
}


def _make_mock_response(body=None):
    resp = MagicMock(spec=requests.Response)
    resp.raise_for_status.return_value = None
    resp.json.return_value = body or FAKE_RESPONSE_BODY
    return resp


class TestChatWithLlmConfig:
    """chat() should use llm_config values when provided, without touching instance state."""

    def test_chat_uses_default_instance_api_key_when_no_config(self):
        """Without llm_config, requests.post is called with instance api_key."""
        backend = LLMBackend()
        backend.api_key = "instance-key"
        backend.base_url = "https://instance.api"
        backend.model = "instance-model"

        with patch("requests.post", return_value=_make_mock_response()) as mock_post:
            backend.chat([{"role": "user", "content": "hello"}])

        call_kwargs = mock_post.call_args
        headers = call_kwargs.kwargs.get("headers") or call_kwargs[1].get("headers") or call_kwargs[0][1]
        assert "instance-key" in headers.get("Authorization", "")

    def test_chat_uses_llm_config_api_key_when_provided(self):
        """When llm_config contains api_key, that key is used in the Authorization header."""
        backend = LLMBackend()
        backend.api_key = "instance-key"
        backend.base_url = "https://instance.api"
        backend.model = "instance-model"

        override_config = {
            "api_key": "override-key",
            "base_url": "https://override.api",
            "model": "override-model",
        }

        with patch("requests.post", return_value=_make_mock_response()) as mock_post:
            backend.chat([{"role": "user", "content": "hello"}], llm_config=override_config)

        call_kwargs = mock_post.call_args
        headers = call_kwargs.kwargs.get("headers") or call_kwargs[1].get("headers")
        assert "override-key" in headers.get("Authorization", "")

    def test_chat_uses_llm_config_model_when_provided(self):
        """When llm_config contains model, that model is used in the request payload."""
        backend = LLMBackend()
        backend.api_key = "instance-key"
        backend.base_url = "https://instance.api"
        backend.model = "instance-model"

        override_config = {
            "api_key": "override-key",
            "base_url": "https://override.api",
            "model": "override-model",
        }

        with patch("requests.post", return_value=_make_mock_response()) as mock_post:
            backend.chat([{"role": "user", "content": "hello"}], llm_config=override_config)

        payload = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
        assert payload["model"] == "override-model"

    def test_chat_does_not_mutate_instance_state_after_override(self):
        """After a call with llm_config, instance api_key/model remain unchanged."""
        backend = LLMBackend()
        backend.api_key = "instance-key"
        backend.base_url = "https://instance.api"
        backend.model = "instance-model"

        override_config = {
            "api_key": "override-key",
            "base_url": "https://override.api",
            "model": "override-model",
        }

        with patch("requests.post", return_value=_make_mock_response()):
            backend.chat([{"role": "user", "content": "hello"}], llm_config=override_config)

        assert backend.api_key == "instance-key"
        assert backend.model == "instance-model"
        assert backend.base_url == "https://instance.api"
