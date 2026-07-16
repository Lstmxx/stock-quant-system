import json
from datetime import date

import pytest
from pydantic import ValidationError

from app.core.llm_stock_selection_runner import (
    LlmCandidateExecutor,
    LlmStockJudgment,
    build_stock_selection_prompt,
)
from app.core.llm_stock_selection_snapshot import CandidateInput
from app.core.llm_types import ChatResult, LlmModelConfig, TokenUsage


def candidate(symbol: str, rank: int) -> CandidateInput:
    return CandidateInput(
        symbol=symbol,
        stock_name=symbol,
        data_date=date(2026, 7, 15),
        candidate_sources=("QUANTITATIVE",),
        quantitative_score=2.0 - rank,
        quantitative_rank=rank,
        recent_bars=tuple(
            {
                "date": f"2026-07-{day:02d}",
                "open": 10.0,
                "high": 10.5,
                "low": 9.8,
                "close": 10.2,
                "volume": 1000.0,
                "amount": 10000.0,
                "turnover": 1.2,
                "percentageChange": 1.0,
            }
            for day in range(1, 21)
        ),
        indicators={"returns": {}, "trend": {}, "momentum": {}, "risk": {}, "volume": {}},
        factor_contributions=(),
        lookback_days=250,
    )


class FakeRepository:
    def __init__(self) -> None:
        self.started: list[str] = []
        self.finished = []
        self.cancelled: list[str] = []

    def persist_snapshot(self, task_id, user_id, snapshot):
        raise AssertionError("not used")

    def begin_attempt(self, task_id, user_id, candidate, model):
        self.started.append(candidate.symbol)
        return 1

    def finish_attempt(self, task_id, user_id, attempt, model):
        self.finished.append(attempt)

    def mark_not_run_cancelled(self, task_id, user_id, symbols):
        self.cancelled.extend(symbols)

    def finalize_ranking(self, task_id, user_id, final_top_n):
        raise AssertionError("not used")


class FakeClient:
    def __init__(self, contents: list[str]) -> None:
        self.contents = iter(contents)

    def chat(self, config, request):
        return ChatResult(
            content=next(self.contents),
            provider=config.provider,
            model=config.model_name,
            usage=TokenUsage(100, 20, 120),
        )


def valid_judgment(score: int = 80) -> str:
    return json.dumps(
        {
            "selectionScore": score,
            "confidence": 0.8,
            "outlook": "BULLISH",
            "summary": "量价和因子信号一致",
            "strengths": ["趋势向上"],
            "risks": ["波动较高"],
            "keySignals": [
                {
                    "category": "FACTOR",
                    "name": "Momentum",
                    "interpretation": "横截面排名靠前",
                }
            ],
        }
    )


def model() -> LlmModelConfig:
    return LlmModelConfig(
        id="model-1",
        user_id="user-1",
        provider="openai",
        model_name="gpt-test",
        api_key="secret",
        api_base=None,
    )


def test_validates_strict_judgment_contract() -> None:
    judgment = LlmStockJudgment.model_validate_json(valid_judgment(91))
    assert judgment.selection_score == 91

    invalid = json.loads(valid_judgment())
    invalid["selectionScore"] = 101
    with pytest.raises(ValidationError):
        LlmStockJudgment.model_validate(invalid)

    invalid = json.loads(valid_judgment())
    invalid["unexpected"] = True
    with pytest.raises(ValidationError):
        LlmStockJudgment.model_validate(invalid)


def test_executor_isolates_invalid_candidate_response() -> None:
    repository = FakeRepository()
    executor = LlmCandidateExecutor(
        repository=repository,
        llm_client=FakeClient([valid_judgment(88), "{}"]),
        max_workers=1,
    )

    cancelled = executor.execute(
        task_id="task-1",
        user_id="user-1",
        model=model(),
        candidates=(candidate("sh.600000", 1), candidate("sh.600001", 2)),
        is_cancelled=lambda: False,
    )

    assert cancelled is False
    assert [attempt.succeeded for attempt in repository.finished] == [True, False]
    assert repository.finished[1].error_code == "LLM_RESPONSE_INVALID"


def test_executor_stops_dispatching_after_cancellation() -> None:
    repository = FakeRepository()
    executor = LlmCandidateExecutor(
        repository=repository,
        llm_client=FakeClient([valid_judgment()]),
        max_workers=1,
    )

    cancelled = executor.execute(
        task_id="task-1",
        user_id="user-1",
        model=model(),
        candidates=(
            candidate("sh.600000", 1),
            candidate("sh.600001", 2),
            candidate("sh.600002", 3),
        ),
        is_cancelled=lambda: len(repository.finished) >= 1,
    )

    assert cancelled is True
    assert repository.started == ["sh.600000"]
    assert repository.cancelled == ["sh.600001", "sh.600002"]


def test_prompt_contains_bounded_snapshot_and_excludes_trusted_rank_fields() -> None:
    prompt = build_stock_selection_prompt(candidate("sh.600000", 1))
    assert "llm-stock-selection-input/v1" in prompt
    assert "未来约20个交易日" in prompt
    assert "不得输出股票代码、最终排名或是否入选" in prompt
