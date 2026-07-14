import asyncio
import json
import logging
import uuid

import redis.asyncio as aioredis
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from .config import settings

logger = logging.getLogger(__name__)

DEFAULT_CRON_EXPRESSION = "0 20 * * mon-fri"
SCHEDULER_TIMEZONE = "Asia/Shanghai"
JOB_ID = "baostock_daily_fetch"

scheduler = AsyncIOScheduler(timezone=SCHEDULER_TIMEZONE)


def build_cron_trigger(cron_expression: str) -> CronTrigger:
    parts = cron_expression.split()
    if len(parts) != 5:
        raise ValueError("cron 表达式必须包含 5 个字段")
    minute, hour, day, month, day_of_week = parts
    return CronTrigger(
        minute=minute,
        hour=hour,
        day=day,
        month=month,
        day_of_week=day_of_week,
        timezone=SCHEDULER_TIMEZONE,
    )


def _create_scheduled_task() -> tuple[str, int, int] | None:
    engine = create_engine(settings.database_url)
    try:
        with engine.begin() as connection:
            config = connection.execute(
                text(
                    'SELECT "lookbackDays", "workerCount" '
                    "FROM data_collection_configs "
                    "WHERE scope = 'GLOBAL' LIMIT 1"
                )
            ).fetchone()
            lookback_days = int(config[0]) if config else 250
            worker_count = int(config[1]) if config else 4
            task_id = str(uuid.uuid4())
            params = {
                "days": lookback_days,
                "workerCount": worker_count,
                "force": True,
                "trigger": "SCHEDULED",
            }
            connection.execute(
                text(
                    'INSERT INTO alpha_tasks '
                    '(id, "userId", type, status, params, "createdAt", "updatedAt") '
                    "VALUES (:id, NULL, 'DATA_COLLECTION', 'PENDING', "
                    "CAST(:params AS jsonb), NOW(), NOW())"
                ),
                {"id": task_id, "params": json.dumps(params)},
            )
            return task_id, lookback_days, worker_count
    except IntegrityError as error:
        if getattr(error.orig, "pgcode", None) == "23505":
            logger.info("Skipping scheduled collection because an active task exists")
            return None
        raise
    finally:
        engine.dispose()


def _mark_enqueue_failed(task_id: str, detail: str) -> None:
    engine = create_engine(settings.database_url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE alpha_tasks SET status = 'FAILED', "
                    "result = CAST(:result AS jsonb), "
                    '"updatedAt" = NOW() WHERE id = :id'
                ),
                {
                    "id": task_id,
                    "result": json.dumps(
                        {"error": "任务入队失败", "detail": detail},
                    ),
                },
            )
    finally:
        engine.dispose()


async def fetch_daily_data() -> None:
    logger.info("Executing scheduled data collection")
    task = await asyncio.to_thread(_create_scheduled_task)
    if task is None:
        return

    task_id, lookback_days, worker_count = task
    params = {
        "days": lookback_days,
        "workerCount": worker_count,
        "force": True,
        "trigger": "SCHEDULED",
    }
    redis = aioredis.from_url(settings.redis_url)
    try:
        await redis.rpush(
            settings.queue_name,
            json.dumps(
                {
                    "taskId": task_id,
                    "userId": None,
                    "type": "DATA_COLLECTION",
                    "params": params,
                }
            ),
        )
        logger.info("Scheduled data collection task created: %s", task_id)
    except Exception as error:
        await asyncio.to_thread(_mark_enqueue_failed, task_id, str(error))
        logger.exception("Failed to enqueue scheduled data collection task")
    finally:
        await redis.aclose()


def update_scheduler_config(
    cron_expression: str = DEFAULT_CRON_EXPRESSION,
) -> None:
    """Validate and atomically replace the global collection schedule."""
    trigger = build_cron_trigger(cron_expression)
    scheduler.add_job(
        fetch_daily_data,
        trigger=trigger,
        id=JOB_ID,
        replace_existing=True,
    )
    logger.info(
        "Data collection schedule updated: %s (%s)",
        cron_expression,
        SCHEDULER_TIMEZONE,
    )


def start_scheduler() -> None:
    logger.info("Starting background scheduler")
    update_scheduler_config()
    if not scheduler.running:
        scheduler.start()
