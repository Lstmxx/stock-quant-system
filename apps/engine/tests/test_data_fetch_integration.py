import asyncio
import json
from datetime import datetime

import pytest
import redis.asyncio as aioredis
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.config import settings

@pytest.mark.asyncio
async def test_full_data_fetch_integration():
    """
    Test the full data fetching flow without mocking the DataLoader.
    This will connect to the real Baostock API and the real Redis.
    Because Baostock fetching takes a long time, we subscribe to the
    Redis channel and wait with a long timeout.
    """
    symbol = "sh.600000"
    today = datetime.now().strftime("%Y-%m-%d")
    summary_key = f"price_summary:{symbol}:{today}"
    channel_name = f"data_ready:{symbol}"

    # Set up Redis client
    r = aioredis.from_url(settings.redis_url)
    pubsub = r.pubsub()
    await pubsub.subscribe(channel_name)

    # We will trigger the endpoint directly.
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.post("/internal/fetch-data", json={"symbol": symbol, "days": 30})
        
        assert response.status_code == 200
        assert response.json()["status"] == "accepted"

        print(f"Waiting for message on channel {channel_name}...")
        
        # We need a large timeout because downloading all A-shares takes a long time.
        # Let's set a timeout of 1200 seconds (20 minutes).
        message_received = False
        start_time = asyncio.get_event_loop().time()
        
        while True:
            # Check for timeout
            if asyncio.get_event_loop().time() - start_time > 1200:
                pytest.fail("Timeout waiting for data fetch to complete via pub/sub")
            
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=10.0)
            if message:
                data = json.loads(message["data"])
                print("Received message:", data)
                if "error" in data:
                    pytest.fail(f"Data fetch failed: {data['error']}")
                assert data["symbol"] == symbol
                message_received = True
                break
            
        assert message_received, "Message was not received"

        # Now check if the key is in Redis
        cache_data = await r.get(summary_key)
        assert cache_data is not None, f"Key {summary_key} not found in Redis"
        
        summary = json.loads(cache_data)
        assert summary["symbol"] == symbol
        assert "latest_price" in summary
        assert summary["date"] == today

    finally:
        await pubsub.unsubscribe(channel_name)
        await r.aclose()
