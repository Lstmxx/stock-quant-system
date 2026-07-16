import pytest

import app.worker as worker_module
from app.core.alpha_miner import MiningResult
from app.core.llm_stock_selection_runner import LlmStockSelectionRunResult


class FakeRedis:
    async def get(self, key: str):
        return None

    async def aclose(self) -> None:
        return None


@pytest.mark.asyncio
async def test_worker_uses_research_direction_and_structured_result(monkeypatch) -> None:
    observed: dict[str, object] = {}

    class StubMiner:
        def __init__(self, **kwargs) -> None:
            observed["miner_kwargs"] = kwargs

        def load_data(self, lookback_days: int) -> None:
            observed["lookback_days"] = lookback_days

        def mine(self, **kwargs) -> MiningResult:
            observed["mine_kwargs"] = kwargs
            return MiningResult(valid_factors=[], generated_count=4)

    async def record_status(task_id: str, status: str, result=None) -> None:
        observed.setdefault("statuses", []).append((task_id, status, result))

    monkeypatch.setattr(worker_module, "AlphaMiner", StubMiner)
    monkeypatch.setattr(worker_module, "update_task_status", record_status)
    monkeypatch.setattr(
        worker_module.aioredis,
        "from_url",
        lambda _url: FakeRedis(),
    )

    await worker_module.process_task(
        {
            "taskId": "task-a",
            "userId": "user-a",
            "type": "FACTOR_MINING",
            "params": {
                "researchDirection": "动量反转",
                "days": 180,
                "llmModelId": "model-a",
            },
        }
    )

    assert observed["mine_kwargs"] == {
        "direction": "动量反转",
        "max_rounds": 3,
        "factors_per_round": 3,
        "use_evolution": True,
    }
    task_id, status, result = observed["statuses"][-1]
    assert task_id == "task-a"
    assert status == "COMPLETED"
    assert result["有效因子数"] == 0
    assert result["总生成策略"] == 4
    assert result["研究方向"] == "动量反转"
    assert isinstance(result["完成时间"], str)


@pytest.mark.asyncio
async def test_worker_dispatches_factor_selection_without_starting_miner(monkeypatch) -> None:
    observed: dict[str, object] = {}

    def run_selection(task_id: str, user_id: str, params: dict):
        observed["selection"] = (task_id, user_id, params)
        return {
            "成功股票数": 300,
            "Top N": 20,
            "数据日期": "2026-07-10",
            "因子数": 5,
        }

    class FailingMiner:
        def __init__(self, **_kwargs) -> None:
            raise AssertionError("selection task must not start AlphaMiner")

    async def record_status(task_id: str, status: str, result=None) -> None:
        observed.setdefault("statuses", []).append((task_id, status, result))

    monkeypatch.setattr(worker_module, "run_factor_selection", run_selection)
    monkeypatch.setattr(worker_module, "AlphaMiner", FailingMiner)
    monkeypatch.setattr(worker_module, "update_task_status", record_status)
    monkeypatch.setattr(worker_module.aioredis, "from_url", lambda _url: FakeRedis())

    params = {
        "factorIds": ["factor-1"],
        "topN": 20,
        "lookbackDays": 250,
        "universeType": "ALL_MARKET",
    }
    await worker_module.process_task(
        {
            "taskId": "task-selection",
            "userId": "user-a",
            "type": "FACTOR_SELECTION",
            "params": params,
        }
    )

    assert observed["selection"] == ("task-selection", "user-a", params)
    assert observed["statuses"][-1][1] == "COMPLETED"


@pytest.mark.asyncio
async def test_worker_dispatches_llm_stock_selection_status(monkeypatch) -> None:
    observed: dict[str, object] = {}

    def run_selection(task_id: str, user_id: str, params: dict):
        observed["selection"] = (task_id, user_id, params)
        return LlmStockSelectionRunResult(
            status="PARTIAL_SUCCESS",
            summary={"successCount": 49, "failedCount": 1},
        )

    class FailingMiner:
        def __init__(self, **_kwargs) -> None:
            raise AssertionError("LLM selection task must not start AlphaMiner")

    async def record_status(task_id: str, status: str, result=None) -> None:
        observed.setdefault("statuses", []).append((task_id, status, result))

    monkeypatch.setattr(worker_module, "run_llm_stock_selection", run_selection)
    monkeypatch.setattr(worker_module, "AlphaMiner", FailingMiner)
    monkeypatch.setattr(worker_module, "update_task_status", record_status)
    monkeypatch.setattr(worker_module.aioredis, "from_url", lambda _url: FakeRedis())

    params = {"factorIds": ["factor-1"], "llmModelId": "model-1"}
    await worker_module.process_task(
        {
            "taskId": "task-llm-selection",
            "userId": "user-a",
            "type": "LLM_STOCK_SELECTION",
            "params": params,
        }
    )

    assert observed["selection"] == ("task-llm-selection", "user-a", params)
    assert observed["statuses"][-1] == (
        "task-llm-selection",
        "PARTIAL_SUCCESS",
        {"successCount": 49, "failedCount": 1},
    )


@pytest.mark.asyncio
async def test_worker_marks_mining_failed_when_a_round_raises(monkeypatch) -> None:
    observed: list[tuple[str, str, object]] = []

    class FailingMiner:
        def __init__(self, **_kwargs) -> None:
            return None

        def load_data(self, lookback_days: int) -> None:
            return None

        def mine(self, **_kwargs):
            raise RuntimeError("LLM hypothesis request failed")

    async def record_status(task_id: str, status: str, result=None) -> None:
        observed.append((task_id, status, result))

    monkeypatch.setattr(worker_module, "AlphaMiner", FailingMiner)
    monkeypatch.setattr(worker_module, "update_task_status", record_status)
    monkeypatch.setattr(worker_module.aioredis, "from_url", lambda _url: FakeRedis())

    await worker_module.process_task(
        {
            "taskId": "task-failed",
            "userId": "user-a",
            "type": "FACTOR_MINING",
            "params": {"researchDirection": "量价关系"},
        }
    )

    assert observed[-1][1] == "FAILED"
    assert observed[-1][2] == {"error": "LLM hypothesis request failed"}
