"""
Redis task queue worker.

Listens on the configured queue, processes tasks via the AlphaMinerService,
and writes results back to the database.
"""
import asyncio
import json
import logging

import redis.asyncio as aioredis
from sqlalchemy import create_engine, text

from .config import settings
from .services.alpha_miner_service import AlphaMinerService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def update_task_status(
    task_id: str,
    status: str,
    result: dict | None = None,
) -> None:
    """Update task status in the database via raw SQL (sync, run in thread)."""

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
    target_symbol = params.get("targetSymbol", "sh.000001")
    days = params.get("days", 250)

    logger.info(f"Processing task {task_id} for symbol {target_symbol}")

    # Mark as RUNNING
    await update_task_status(task_id, "RUNNING")

    try:
        # Run the CPU-bound mining logic in a thread pool
        service = AlphaMinerService(target_symbol=target_symbol, days=days)
        result = await asyncio.to_thread(service.run)

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
