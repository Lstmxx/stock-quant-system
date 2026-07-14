import pytest

import app.scheduler as scheduler_module


def test_default_cron_uses_explicit_shanghai_timezone() -> None:
    trigger = scheduler_module.build_cron_trigger(
        scheduler_module.DEFAULT_CRON_EXPRESSION
    )
    assert str(trigger.timezone) == "Asia/Shanghai"
    assert str(trigger.fields[5]) == "20"


def test_invalid_cron_is_rejected_before_replacing_job(monkeypatch) -> None:
    add_job_calls: list[object] = []
    monkeypatch.setattr(
        scheduler_module.scheduler,
        "add_job",
        lambda *args, **kwargs: add_job_calls.append((args, kwargs)),
    )

    with pytest.raises(ValueError):
        scheduler_module.update_scheduler_config("invalid cron")

    assert add_job_calls == []


@pytest.mark.asyncio
async def test_enqueue_failure_marks_scheduled_task_failed(monkeypatch) -> None:
    failures: list[tuple[str, str]] = []

    class FailingRedis:
        async def rpush(self, *_args):
            raise ConnectionError("redis unavailable")

        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(
        scheduler_module,
        "_create_scheduled_task",
        lambda: ("scheduled-task", 250, 4),
    )
    monkeypatch.setattr(
        scheduler_module,
        "_mark_enqueue_failed",
        lambda task_id, detail: failures.append((task_id, detail)),
    )
    monkeypatch.setattr(
        scheduler_module.aioredis,
        "from_url",
        lambda _url: FailingRedis(),
    )

    await scheduler_module.fetch_daily_data()

    assert failures == [("scheduled-task", "redis unavailable")]
