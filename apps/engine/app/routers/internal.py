"""
Internal API router — endpoints called only by the API (ElysiaJS) gateway.
Not exposed externally.
"""
import asyncio
import json
import logging
import pickle
from datetime import datetime
from typing import Optional

import redis.asyncio as aioredis
from fastapi import APIRouter
from pydantic import BaseModel

from ..config import settings
from ..scheduler import update_scheduler_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])


# ─── Request Models ───

class FetchDataRequest(BaseModel):
    symbol: str  # e.g. "sh.600000"
    days: int = 250


class ReloadConfigRequest(BaseModel):
    baostock_cron: Optional[str] = None


# ─── Endpoints ───

@router.post("/reload-config")
async def reload_config(body: ReloadConfigRequest = ReloadConfigRequest()):
    """
    Reload scheduler configuration.
    Called by API after user updates system config.
    """
    cron = body.baostock_cron or "0 12 * * 1-5"
    try:
        update_scheduler_config(cron)
        logger.info(f"Scheduler reloaded with cron: {cron}")
        return {"status": "ok", "message": f"Scheduler updated: {cron}"}
    except Exception as e:
        logger.error(f"Failed to reload scheduler: {e}")
        return {"status": "error", "message": str(e)}


@router.post("/fetch-data")
async def fetch_data(body: FetchDataRequest):
    """
    Trigger a data fetch for a specific symbol and cache to Redis.
    Called by API when it needs market data for LLM analysis but Redis has no cache.
    After writing data, publishes to `data_ready:{symbol}` channel.
    """
    symbol = body.symbol
    days = body.days

    async def _do_fetch():
        r = aioredis.from_url(settings.redis_url)
        try:
            # Import the synchronous data loader and run in thread
            from ..core.data_loader import DataLoader

            def _load():
                loader = DataLoader()
                data = loader.load_latest(lookback_days=days)
                loader.logout()

                # Write a lightweight price summary for the given symbol to Redis
                if "close" in data and symbol in data["close"].columns:
                    close = data["close"][symbol].dropna()
                    if not close.empty:
                        last_n = close.tail(30)
                        summary = {
                            "symbol": symbol,
                            "latest_price": float(close.iloc[-1]),
                            "change_30d": float((close.iloc[-1] / close.iloc[-30] - 1) * 100) if len(close) >= 30 else 0,
                            "high_30d": float(last_n.max()),
                            "low_30d": float(last_n.min()),
                            "avg_30d": float(last_n.mean()),
                            "date": datetime.now().strftime("%Y-%m-%d"),
                        }
                        return summary
                return {"symbol": symbol, "note": "symbol not found in dataset"}

            summary = await asyncio.to_thread(_load)

            today = datetime.now().strftime("%Y-%m-%d")
            summary_key = f"price_summary:{symbol}:{today}"
            await r.setex(summary_key, 20 * 3600, json.dumps(summary))

            # Notify API that data is ready
            await r.publish(f"data_ready:{symbol}", json.dumps({"symbol": symbol, "date": today}))
            logger.info(f"Data fetch completed for {symbol}, published to data_ready channel")

        except Exception as e:
            logger.error(f"Data fetch failed for {symbol}: {e}")
            # Still publish so API doesn't hang waiting
            await r.publish(f"data_ready:{symbol}", json.dumps({"symbol": symbol, "error": str(e)}))
        finally:
            await r.aclose()

    # Run in background, respond immediately
    asyncio.create_task(_do_fetch())
    return {"status": "accepted", "symbol": symbol, "message": "Data fetch started in background"}
