import logging
import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from .core.data_loader import preload_market_data

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

import json
import uuid
import redis.asyncio as aioredis
from sqlalchemy import create_engine, text
from .config import settings

async def fetch_daily_data():
    logger.info("Executing scheduled task: fetch_daily_data")
    try:
        def _create_task():
            engine = create_engine(settings.database_url)
            with engine.connect() as conn:
                # Get config
                result = conn.execute(
                    text('SELECT "lookbackDays", "workerCount" FROM data_collection_configs LIMIT 1')
                ).fetchone()
                lookback_days = 250
                worker_count = 4
                if result:
                    lookback_days = result[0]
                    worker_count = result[1]
                
                # Insert task
                task_id = str(uuid.uuid4())
                user_id = "system" # system task
                conn.execute(
                    text("""
                        INSERT INTO alpha_tasks (id, "userId", type, status, params, "createdAt", "updatedAt")
                        VALUES (:id, :user_id, 'DATA_COLLECTION', 'PENDING', :params, NOW(), NOW())
                    """),
                    {"id": task_id, "user_id": user_id, "params": json.dumps({"days": lookback_days, "workerCount": worker_count})}
                )
                conn.commit()
                return task_id, user_id, lookback_days, worker_count
        
        task_id, user_id, lookback_days, worker_count = await asyncio.to_thread(_create_task)
        
        # Push to Redis
        r = aioredis.from_url(settings.redis_url)
        await r.lpush(
            settings.queue_name,
            json.dumps({
                "taskId": task_id,
                "userId": user_id,
                "type": "DATA_COLLECTION",
                "params": {"days": lookback_days, "workerCount": worker_count}
            })
        )
        await r.aclose()
        logger.info(f"Daily data fetch task created successfully: {task_id}")
    except Exception as e:
        logger.error(f"Failed to fetch daily data: {e}")

def update_scheduler_config(cron_expression: str = "0 12 * * 1-5"):
    """
    Update the scheduler config.
    cron_expression format: "minute hour day month day_of_week"
    By default: 12:00 UTC (20:00 Beijing time) Monday to Friday.
    """
    logger.info(f"Updating baostock scheduler with cron: {cron_expression}")
    
    # Remove existing job if any
    job_id = "baostock_daily_fetch"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)

    # Parse standard cron 5 parts: min hour dom mon dow
    parts = cron_expression.split()
    if len(parts) == 5:
        minute, hour, day, month, day_of_week = parts
        trigger = CronTrigger(
            minute=minute, 
            hour=hour, 
            day=day, 
            month=month, 
            day_of_week=day_of_week
        )
        scheduler.add_job(
            fetch_daily_data, 
            trigger=trigger, 
            id=job_id,
            replace_existing=True
        )
        logger.info("Baostock job added/updated successfully.")
    else:
        logger.error(f"Invalid cron expression: {cron_expression}")

def start_scheduler():
    logger.info("Starting background scheduler...")
    # Initialize with default
    update_scheduler_config()
    scheduler.start()
