"""
Redis task queue worker.
"""
import asyncio
import json
import logging
from datetime import datetime

import redis.asyncio as aioredis
from sqlalchemy import create_engine, text

from .config import settings

from .core.alpha_miner import AlphaMiner, TaskCancelledError
from .core.factor_selection_runner import run_factor_selection

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
    # ``targetSymbol`` is kept as a read-only fallback for tasks that were
    # already queued before factor mining switched to research directions.
    research_direction = (
        params.get("researchDirection")
        or params.get("targetSymbol")
        or "量价关系"
    )
    days = params.get("days", 250)

    user_id = task_data.get("userId")

    task_type = task_data.get("type", "FACTOR_MINING")
    days = task_data.get("params", {}).get("days", 250)
    force_update = task_data.get("params", {}).get("force", False)
    worker_count = task_data.get("params", {}).get("workerCount", 4)
    llm_model_id = task_data.get("params", {}).get("llmModelId")

    logger.info(f"Processing task {task_id} of type {task_type}")
    
    r_client = aioredis.from_url(settings.redis_url)
    
    # Do not set to RUNNING if already cancelled in queue
    is_cancelled_early = await r_client.get(f"task_cancelled:{task_id}")
    if is_cancelled_early:
        logger.warning(f"Task {task_id} cancelled before starting.")
        await r_client.aclose()
        return

    await update_task_status(task_id, "RUNNING")

    try:
        if task_type == "DATA_COLLECTION":
            def _run_collection():
                from .core.data_loader import DataLoader
                print(f"[Worker] Starting _run_collection for task {task_id} (force={force_update})", flush=True)
                loader = DataLoader()
                target_stocks = params.get("stocks")  # None means full collection
                retry_of = params.get("retryOf")

                if target_stocks:
                    print(f"[Worker] Retry mode: fetching {len(target_stocks)} specified stocks", flush=True)
                    if not retry_of:
                        raise ValueError("重试任务缺少 retryOf")
                    _, summary = loader.retry_failed_stocks(
                        stocks=target_stocks,
                        lookback_days=days,
                        task_id=task_id,
                        retry_of=retry_of,
                        worker_count=worker_count,
                    )
                else:
                    _, summary = loader.collect_latest(
                        lookback_days=days,
                        task_id=task_id,
                        force_update=force_update,
                        worker_count=worker_count,
                    )

                print(f"[Worker] Finished _run_collection for task {task_id}", flush=True)
                result = {
                    **summary,
                    "lookbackDays": days,
                    "completedAt": datetime.now().isoformat(timespec="seconds"),
                }
                if retry_of:
                    result["retryOf"] = retry_of
                return result
            
            result = await asyncio.to_thread(_run_collection)
            
            is_cancelled = await r_client.get(f"task_cancelled:{task_id}")
            if is_cancelled:
                await update_task_status(task_id, "CANCELLED", {**result, "message": "用户手动终止了任务"})
                logger.info(f"Data Collection Task {task_id} cancelled by user")
            else:
                failed_count = int(result.get("failedCount", 0))
                success_count = int(result.get("successCount", 0))
                if failed_count == 0:
                    final_status = "COMPLETED"
                elif success_count > 0:
                    final_status = "PARTIAL_SUCCESS"
                else:
                    final_status = "FAILED"
                await update_task_status(task_id, final_status, result)
                logger.info(f"Data Collection Task {task_id} finished with {final_status}")
        
        elif task_type == "FACTOR_SELECTION":
            result = await asyncio.to_thread(
                run_factor_selection,
                task_id,
                user_id,
                params,
            )
            await update_task_status(task_id, "COMPLETED", result)
            logger.info(f"Factor selection task {task_id} completed successfully")

        else:
            # Run the CPU-bound mining logic in a thread pool
            def _run_miner():
                miner = AlphaMiner(task_id=task_id, user_id=user_id, llm_model_id=llm_model_id)
                miner.load_data(lookback_days=days)
                mining_result = miner.mine(
                    direction=research_direction,
                    max_rounds=3,
                    factors_per_round=3,
                    use_evolution=True
                )
                # return summary
                return {
                    "有效因子数": len(mining_result.valid_factors),
                    "总生成策略": mining_result.generated_count,
                    "研究方向": research_direction,
                    "完成时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }
                
            result = await asyncio.to_thread(_run_miner)
            
            is_cancelled = await r_client.get(f"task_cancelled:{task_id}")
            if is_cancelled:
                await update_task_status(task_id, "CANCELLED", {"message": "用户手动终止了任务", "部分结果": result})
            else:
                await update_task_status(task_id, "COMPLETED", result)
                logger.info(f"Task {task_id} completed successfully")

    except TaskCancelledError:
        logger.warning(f"Task {task_id} was cancelled.")
        await update_task_status(
            task_id,
            "CANCELLED",
            {"message": "Task was manually cancelled"},
        )
    except Exception as e:
        logger.error(f"Task {task_id} failed: {e}")
        await update_task_status(task_id, "FAILED", {"error": str(e)})
            
    finally:
        await r_client.aclose()

async def start_worker() -> None:
    """Main worker loop: poll Redis queue and process tasks."""
    r = aioredis.from_url(settings.redis_url)
    logger.info(f"Worker started, polling queue '{settings.queue_name}'...")

    while True:
        try:
            result = await r.blpop(settings.queue_name, timeout=1)
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
