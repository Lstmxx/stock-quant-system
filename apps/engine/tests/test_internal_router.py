import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import Mock

from app.main import app
from app.config import settings
from app.core.llm_types import ChatResult, LlmConfigNotFoundError, LlmModelConfig


@pytest.fixture(autouse=True)
def internal_token():
    previous = settings.internal_service_token
    settings.internal_service_token = "test-internal-token"
    yield
    settings.internal_service_token = previous


def auth_headers():
    return {"Authorization": "Bearer test-internal-token"}


@pytest.mark.asyncio
async def test_internal_routes_reject_missing_service_token():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/internal/reload-config", json={"baostock_cron": "0 20 * * mon-fri"}
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_reload_config():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/internal/reload-config",
            json={"baostock_cron": "0 20 * * mon-fri"},
            headers=auth_headers(),
        )
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert "Scheduler updated" in response.json()["message"]


@pytest.mark.asyncio
async def test_reload_config_rejects_invalid_cron():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/internal/reload-config",
            json={"baostock_cron": "invalid"},
            headers=auth_headers(),
        )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_fetch_data_returns_accepted(mocker):
    # Mock redis and thread execution to avoid real network/DB calls in test
    mocker.patch("app.routers.internal.aioredis.from_url")
    mocker.patch(
        "app.routers.internal.asyncio.to_thread", return_value={"symbol": "sh.600000"}
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/internal/fetch-data",
            json={"symbol": "sh.600000", "days": 30},
            headers=auth_headers(),
        )

    assert response.status_code == 200
    assert response.json()["status"] == "accepted"
    assert response.json()["symbol"] == "sh.600000"


@pytest.mark.asyncio
async def test_llm_chat_loads_the_user_scoped_model_and_returns_project_dto(mocker):
    config = LlmModelConfig(
        id="model-1",
        user_id="user-1",
        provider="openai",
        model_name="gpt-5",
        api_key="secret",
        api_base=None,
    )
    loader = Mock()
    loader.get.return_value = config
    client = Mock()
    client.chat.return_value = ChatResult(
        content="hello",
        provider="openai",
        model="openai/gpt-5",
    )
    mocker.patch(
        "app.routers.internal.get_default_config_loader",
        return_value=loader,
    )
    mocker.patch(
        "app.routers.internal.get_default_llm_client",
        return_value=client,
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        response = await ac.post(
            "/internal/llm/chat",
            headers=auth_headers(),
            json={
                "userId": "user-1",
                "modelId": "model-1",
                "messages": [{"role": "user", "content": "hi"}],
                "temperature": 0.2,
                "maxTokens": 100,
                "jsonMode": False,
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "content": "hello",
        "provider": "openai",
        "model": "openai/gpt-5",
        "usage": None,
    }
    loader.get.assert_called_once_with("user-1", "model-1")


@pytest.mark.asyncio
async def test_llm_chat_does_not_call_provider_for_foreign_model(mocker):
    loader = Mock()
    loader.get.side_effect = LlmConfigNotFoundError("大模型配置不存在或无权访问")
    client = Mock()
    mocker.patch(
        "app.routers.internal.get_default_config_loader",
        return_value=loader,
    )
    mocker.patch(
        "app.routers.internal.get_default_llm_client",
        return_value=client,
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        response = await ac.post(
            "/internal/llm/chat",
            headers=auth_headers(),
            json={
                "userId": "user-2",
                "modelId": "model-1",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )

    assert response.status_code == 404
    assert response.json()["code"] == "LLM_CONFIG_NOT_FOUND"
    client.chat.assert_not_called()
