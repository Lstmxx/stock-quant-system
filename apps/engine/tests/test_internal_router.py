import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app

@pytest.mark.asyncio
async def test_reload_config():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/internal/reload-config", json={"baostock_cron": "0 12 * * 1-5"})
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert "Scheduler updated" in response.json()["message"]

@pytest.mark.asyncio
async def test_fetch_data_returns_accepted(mocker):
    # Mock redis and thread execution to avoid real network/DB calls in test
    mocker.patch("app.routers.internal.aioredis.from_url")
    mocker.patch("app.routers.internal.asyncio.to_thread", return_value={"symbol": "sh.600000"})
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/internal/fetch-data", json={"symbol": "sh.600000", "days": 30})
    
    assert response.status_code == 200
    assert response.json()["status"] == "accepted"
    assert response.json()["symbol"] == "sh.600000"
