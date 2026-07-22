"""
Internal API router — endpoints called only by the API (ElysiaJS) gateway.
Not exposed externally.
"""

import asyncio
import json
import logging
from dataclasses import asdict
from datetime import datetime
from typing import Literal, Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from ..config import settings
from ..core.litellm_client import get_default_llm_client
from ..core.llm_config_loader import get_default_config_loader
from ..core.llm_types import ChatRequest, LlmError
from ..scheduler import update_scheduler_config

logger = logging.getLogger(__name__)

async def require_internal_token(
    authorization: str | None = Header(default=None),
) -> None:
    """Require an API-to-Engine bearer token."""
    expected = settings.internal_service_token
    if not expected:
        raise HTTPException(status_code=503, detail="Engine internal token is not configured")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Invalid internal service token")


router = APIRouter(
    prefix="/internal",
    tags=["internal"],
    dependencies=[Depends(require_internal_token)],
)


# ─── Request Models ───


class FetchDataRequest(BaseModel):
    symbol: str  # e.g. "sh.600000"
    days: int = 250
    force_update: bool = False


class ReloadConfigRequest(BaseModel):
    baostock_cron: Optional[str] = None


class LlmChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=100_000)


class LlmChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    user_id: str = Field(alias="userId", min_length=1)
    model_id: str = Field(alias="modelId", min_length=1)
    messages: list[LlmChatMessage] = Field(min_length=1, max_length=100)
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=4000, alias="maxTokens", ge=1, le=100_000)
    json_mode: bool = Field(default=False, alias="jsonMode")


class LlmTestRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    user_id: str = Field(alias="userId", min_length=1)
    model_id: str = Field(alias="modelId", min_length=1)


# ─── Endpoints ───


def _llm_error_response(error: LlmError) -> JSONResponse:
    status_by_code = {
        "LLM_CONFIG_NOT_FOUND": 404,
        "LLM_CONFIG_INVALID": 422,
        "LLM_SECRET_INVALID": 422,
        "LLM_AUTH_FAILED": 502,
        "LLM_RATE_LIMITED": 502,
        "LLM_TIMEOUT": 504,
        "LLM_PROVIDER_UNAVAILABLE": 502,
        "LLM_RESPONSE_INVALID": 502,
    }
    return JSONResponse(
        status_code=status_by_code.get(error.code, 502),
        content={"code": error.code, "message": str(error)},
    )


def _run_llm_chat(body: LlmChatRequest):
    config = get_default_config_loader().get(body.user_id, body.model_id)
    request = ChatRequest(
        messages=tuple(message.model_dump() for message in body.messages),
        temperature=body.temperature,
        max_tokens=body.max_tokens,
        json_mode=body.json_mode,
    )
    return get_default_llm_client().chat(config, request)


@router.post("/llm/chat")
async def llm_chat(body: LlmChatRequest):
    try:
        result = await asyncio.to_thread(_run_llm_chat, body)
    except LlmError as error:
        return _llm_error_response(error)
    return {
        "content": result.content,
        "provider": result.provider,
        "model": result.model,
        "usage": asdict(result.usage) if result.usage else None,
    }


@router.post("/llm/test")
async def test_llm_connection(body: LlmTestRequest):
    request = LlmChatRequest(
        userId=body.user_id,
        modelId=body.model_id,
        messages=[LlmChatMessage(role="user", content="Reply with OK.")],
        temperature=0,
        maxTokens=16,
        jsonMode=False,
    )
    try:
        result = await asyncio.to_thread(_run_llm_chat, request)
    except LlmError as error:
        return _llm_error_response(error)
    return {
        "success": True,
        "provider": result.provider,
        "model": result.model,
    }


@router.post("/reload-config")
async def reload_config(body: ReloadConfigRequest = ReloadConfigRequest()):
    """
    Reload scheduler configuration.
    Called by API after user updates system config.
    """
    cron = body.baostock_cron or "0 20 * * mon-fri"
    try:
        update_scheduler_config(cron)
        logger.info(f"Scheduler reloaded with cron: {cron}")
        return {"status": "ok", "message": f"Scheduler updated: {cron}"}
    except Exception as e:
        logger.error(f"Failed to reload scheduler: {e}")
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/fetch-data")
async def fetch_data(body: FetchDataRequest):
    """
    Trigger a data fetch for a specific symbol and cache to Redis.
    Called by API when it needs market data for LLM analysis but Redis has no cache.
    After writing data, publishes to `data_ready:{symbol}` channel.
    """
    symbol = body.symbol
    days = body.days
    force_update = body.force_update

    async def _do_fetch():
        r = aioredis.from_url(settings.redis_url)
        try:
            # Import the synchronous data loader and run in thread
            from ..core.data_loader import DataLoader

            def _load():
                loader = DataLoader()
                data = loader.load_latest(
                    lookback_days=days,
                    force_update=force_update,
                )
                loader.logout()

                # Write a lightweight price summary for the given symbol to Redis
                if "close" in data and symbol in data["close"].columns:
                    close = data["close"][symbol].dropna()
                    if not close.empty:
                        last_n = close.tail(30)
                        summary = {
                            "symbol": symbol,
                            "latest_price": float(close.iloc[-1]),
                            "change_30d": float(
                                (close.iloc[-1] / close.iloc[-30] - 1) * 100
                            )
                            if len(close) >= 30
                            else 0,
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
            await r.set(summary_key, json.dumps(summary), ex=20 * 3600)

            # Notify API that data is ready
            await r.publish(
                f"data_ready:{symbol}", json.dumps({"symbol": symbol, "date": today})
            )
            logger.info(
                f"Data fetch completed for {symbol}, published to data_ready channel"
            )

        except Exception as e:
            logger.error(f"Data fetch failed for {symbol}: {e}")
            # Still publish so API doesn't hang waiting
            await r.publish(
                f"data_ready:{symbol}", json.dumps({"symbol": symbol, "error": str(e)})
            )
        finally:
            await r.aclose()

    # Run in background, respond immediately
    asyncio.create_task(_do_fetch())
    return {
        "status": "accepted",
        "symbol": symbol,
        "message": "Data fetch started in background",
    }


class SimulateFactorRequest(BaseModel):
    expression: str
    days: int = 250


@router.post("/simulate-factor")
async def simulate_factor(body: SimulateFactorRequest):
    """
    Evaluate a factor expression and return real simulation metrics.
    Called by API when the user requests Backtest & Review.
    """
    try:
        from ..core.data_loader import DataLoader
        from ..core.factor_calculator import calculate_factor
        from ..core.factor_evaluator import FactorEvaluator

        def _simulate():
            loader = DataLoader()
            data = loader.load_latest(lookback_days=body.days)
            loader.logout()

            if not data or "close" not in data:
                raise ValueError("No stock data loaded")

            # Calculate factor
            factor_df = calculate_factor(body.expression, data)
            if factor_df is None or factor_df.empty:
                raise ValueError(f"Factor calculation failed for: {body.expression}")

            # Evaluate factor
            evaluator = FactorEvaluator(factor_df, data)
            metrics = evaluator.evaluate()

            # The evaluator.evaluate() returns a FactorMetrics object
            # FactorMetrics has ic_mean, icir, long_short_return, turnover_rate, monotonicity_score
            return {
                "annualReturn": float(metrics.long_short_return * 252)
                if metrics.long_short_return
                else 0.0,
                "maxDrawdown": None,
                "sharpeRatio": None,
                "winRate": float(metrics.ic_positive_ratio)
                if hasattr(metrics, "ic_positive_ratio")
                else None,
                "ic": float(metrics.ic_mean) if metrics.ic_mean else 0.0,
            }

        result = await asyncio.to_thread(_simulate)
        return {"status": "ok", "data": result}
    except Exception as e:
        logger.error(f"Factor simulation failed: {e}")
        return {"status": "error", "message": str(e)}
