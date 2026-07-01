import logging
import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from .core.data_loader import preload_market_data

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

async def fetch_daily_data():
    logger.info("Executing scheduled task: fetch_daily_data")
    try:
        # Run synchronous baostock calls in thread
        await asyncio.to_thread(preload_market_data, 250)
        logger.info("Daily data fetch completed successfully")
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
