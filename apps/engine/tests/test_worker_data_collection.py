import pytest

import app.core.data_loader as data_loader_module
import app.worker as worker_module


class FakeRedis:
    async def get(self, _key: str):
        return None

    async def aclose(self) -> None:
        return None


@pytest.mark.asyncio
async def test_worker_marks_partial_collection_success(monkeypatch) -> None:
    statuses: list[tuple[str, str, object]] = []

    class StubLoader:
        def retry_failed_stocks(self, **_kwargs):
            raise AssertionError("full collection must not use retry path")

        def collect_latest(self, **_kwargs):
            return {}, {"totalCount": 3, "successCount": 2, "failedCount": 1}

    async def record_status(task_id: str, status: str, result=None) -> None:
        statuses.append((task_id, status, result))

    monkeypatch.setattr(data_loader_module, "DataLoader", StubLoader)
    monkeypatch.setattr(worker_module, "update_task_status", record_status)
    monkeypatch.setattr(worker_module.aioredis, "from_url", lambda _url: FakeRedis())

    await worker_module.process_task(
        {
            "taskId": "collection-task",
            "userId": "user-a",
            "type": "DATA_COLLECTION",
            "params": {
                "days": 250,
                "workerCount": 4,
                "force": True,
                "trigger": "MANUAL",
            },
        }
    )

    assert statuses[0][1] == "RUNNING"
    assert statuses[-1][1] == "PARTIAL_SUCCESS"
    assert statuses[-1][2]["successCount"] == 2
    assert statuses[-1][2]["failedCount"] == 1
    assert statuses[-1][2]["lookbackDays"] == 250


@pytest.mark.asyncio
async def test_retry_uses_aggregate_rebuild_path(monkeypatch) -> None:
    observed: dict[str, object] = {}
    statuses: list[tuple[str, str, object]] = []

    class StubLoader:
        def collect_latest(self, **_kwargs):
            raise AssertionError("retry must not start a full forced collection")

        def retry_failed_stocks(self, **kwargs):
            observed.update(kwargs)
            return {}, {"totalCount": 2, "successCount": 2, "failedCount": 0}

    async def record_status(task_id: str, status: str, result=None) -> None:
        statuses.append((task_id, status, result))

    monkeypatch.setattr(data_loader_module, "DataLoader", StubLoader)
    monkeypatch.setattr(worker_module, "update_task_status", record_status)
    monkeypatch.setattr(worker_module.aioredis, "from_url", lambda _url: FakeRedis())

    await worker_module.process_task(
        {
            "taskId": "retry-task",
            "userId": "user-a",
            "type": "DATA_COLLECTION",
            "params": {
                "stocks": ["sh.600000", "sz.000001"],
                "retryOf": "original-task",
                "days": 250,
                "workerCount": 2,
                "force": True,
                "trigger": "RETRY",
            },
        }
    )

    assert observed["retry_of"] == "original-task"
    assert observed["stocks"] == ["sh.600000", "sz.000001"]
    assert statuses[-1][1] == "COMPLETED"
    assert statuses[-1][2]["retryOf"] == "original-task"
