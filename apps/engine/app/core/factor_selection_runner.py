"""Execution boundary for one persisted factor-selection task."""

import json
from datetime import datetime
from uuid import uuid4

import redis
from sqlalchemy import create_engine, text

from app.config import settings

from .alpha_miner import TaskCancelledError
from .data_loader import load_market_data
from .factor_exposure_service import FactorExposureService, StockExposure
from .factor_library import library


def _persist_results(
    task_id: str,
    user_id: str,
    results: list[StockExposure],
) -> None:
    rows = [
        {
            "id": str(uuid4()),
            "task_id": task_id,
            "user_id": user_id,
            "symbol": result.symbol,
            "rank": result.rank,
            "composite_score": result.composite_score,
            "data_date": result.data_date.isoformat(),
            "factor_contributions": json.dumps(
                [
                    {
                        "factorId": contribution.factor_id,
                        "name": contribution.name,
                        "value": contribution.value,
                        "zScore": contribution.z_score,
                        "weight": contribution.weight,
                        "direction": contribution.direction,
                        "contribution": contribution.contribution,
                        "percentile": contribution.percentile,
                    }
                    for contribution in result.factor_contributions
                ]
            ),
        }
        for result in results
    ]
    if not rows:
        raise ValueError("选股任务没有可持久化的股票结果")

    engine = create_engine(settings.database_url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    '''
                    INSERT INTO factor_selection_results (
                        id, "taskId", "userId", symbol, rank,
                        "compositeScore", "dataDate", "factorContributions",
                        "createdAt"
                    ) VALUES (
                        :id, :task_id, :user_id, :symbol, :rank,
                        :composite_score, :data_date,
                        CAST(:factor_contributions AS JSONB), CURRENT_TIMESTAMP
                    )
                    '''
                ),
                rows,
            )
    finally:
        engine.dispose()


def run_factor_selection(task_id: str, user_id: str, params: dict) -> dict:
    """Calculate and atomically persist all exposures for one task snapshot."""
    factor_ids = list(dict.fromkeys(params.get("factorIds") or []))
    if not factor_ids:
        raise ValueError("选股任务缺少因子集合")

    factors = [library.get(user_id, factor_id) for factor_id in factor_ids]
    if any(factor is None or not factor.is_valid for factor in factors):
        raise ValueError("选股任务包含不存在、无效或不属于当前用户的因子")

    sync_redis = redis.Redis.from_url(settings.redis_url)

    def check_cancelled() -> None:
        if sync_redis.get(f"task_cancelled:{task_id}"):
            raise TaskCancelledError(task_id)

    try:
        check_cancelled()
        lookback_days = int(params.get("lookbackDays", 250))
        market_data = load_market_data(lookback_days=lookback_days)
        universe_type = params.get("universeType", "ALL_MARKET")
        universe_symbols = params.get("symbols") if universe_type == "WATCHLIST" else None
        results = FactorExposureService(check_cancelled=check_cancelled).calculate(
            factors=[factor for factor in factors if factor is not None],
            market_data=market_data,
            universe_symbols=universe_symbols,
        )
        check_cancelled()
        _persist_results(task_id, user_id, results)
    finally:
        sync_redis.close()

    top_n = min(int(params.get("topN", 20)), len(results))
    return {
        "成功股票数": len(results),
        "Top N": top_n,
        "数据日期": results[0].data_date.isoformat(),
        "因子数": len(factors),
        "完成时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
