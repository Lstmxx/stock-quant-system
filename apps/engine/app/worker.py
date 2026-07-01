"""
Redis task queue worker.
"""
import asyncio
import json
import logging

import redis.asyncio as aioredis
from sqlalchemy import create_engine, text

from .config import settings

# Since we are moving alpha_miner logic, let's use the core miner instead of the stub
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'core'))
from .core.alpha_miner import AlphaMiner

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def update_task_status(
    task_id: str,
    status: str,
    result: dict | None = None,
) -> None:
    """Update task status in the database via raw SQL."""
    def _update():
        engine = create_engine(settings.database_url)
        with engine.connect() as conn:
            if result is not None:
                conn.execute(
                    text(
                        'UPDATE alpha_tasks SET status = :status, result = :result, '
                        '"updatedAt" = NOW() WHERE id = :id'
                    ),
                    {"status": status, "result": json.dumps(result), "id": task_id},
                )
            else:
                conn.execute(
                    text(
                        'UPDATE alpha_tasks SET status = :status, '
                        '"updatedAt" = NOW() WHERE id = :id'
                    ),
                    {"status": status, "id": task_id},
                )
            conn.commit()
        engine.dispose()
    await asyncio.to_thread(_update)

async def process_task(task_data: dict) -> None:
    """Process a single task from the queue."""
    task_id = task_data.get("taskId")
    params = task_data.get("params", {})
    target_symbol = params.get("targetSymbol", "量价关系")
    days = params.get("days", 250)

    user_id = task_data.get("userId", "system")

    logger.info(f"Processing task {task_id} for direction {target_symbol}")
    await update_task_status(task_id, "RUNNING")

    try:
        # Run the CPU-bound mining logic in a thread pool
        def _run_miner():
            miner = AlphaMiner(task_id=task_id, user_id=user_id) # pass task_id for redis logging
            miner.load_data(lookback_days=days)
            valid_factors, total = miner.mine(
                direction=target_symbol,
                max_rounds=3,
                factors_per_round=3,
                use_evolution=True
            )
            # return summary
            return {
                "status": "completed",
                "factors_discovered": len(valid_factors),
                "total_generated": total
            }
            
        result = await asyncio.to_thread(_run_miner)

        # Mark as COMPLETED with result
        await update_task_status(task_id, "COMPLETED", result)
        logger.info(f"Task {task_id} completed successfully")

    except Exception as e:
        logger.error(f"Task {task_id} failed: {e}")
        await update_task_status(task_id, "FAILED", {"error": str(e)})

async def start_worker() -> None:
    """Main worker loop: poll Redis queue and process tasks."""
    r = aioredis.from_url(settings.redis_url)
    logger.info(f"Worker started, polling queue '{settings.queue_name}'...")

    while True:
        try:
            result = await r.blpop(settings.queue_name, timeout=0)
            if result:
                _, message = result
                task_data = json.loads(message)
                await process_task(task_data)

        except asyncio.CancelledError:
            logger.info("Worker shutdown requested.")
            break
        except Exception as e:
            logger.error(f"Error in worker loop: {e}")
            await asyncio.sleep(1)

    await r.aclose()
