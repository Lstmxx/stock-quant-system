from types import SimpleNamespace

import pytest

import app.core.alpha_miner as alpha_miner_module
from app.core.alpha_miner import AlphaMiner, TaskCancelledError
from app.core.factor_library import FactorRecord


class StubLibrary:
    def list_all(self, user_id: str) -> list[FactorRecord]:
        assert user_id == "user-a"
        return []

    def list_valid(self, user_id: str) -> list[FactorRecord]:
        assert user_id == "user-a"
        return []

    def prune(self, user_id: str):
        assert user_id == "user-a"
        return {"before": 1, "after": 1, "removed": 0, "reasons": {}}


class SuccessfulMiner(AlphaMiner):
    def __init__(self) -> None:
        self.market_data = {"close": object()}
        self.history = []
        self.current_round = 0
        self.task_id = "task-a"
        self.user_id = "user-a"
        self.llm_config = None
        self.evaluated = False

    def _log(self, *args, **kwargs) -> None:
        return None

    def _generate_hypothesis(self, direction: str, feedback: str):
        assert direction == "动量反转"
        return {"hypothesis": "价格动量可能延续"}

    def _generate_factors(self, hypothesis, n_factors: int) -> list[str]:
        return ["DELTA(close, 20)"]

    def _evaluate_expressions(self, expressions, hypothesis):
        self.evaluated = True
        record = FactorRecord(
            id="18fe00a0-cdd3-49b8-bda2-d95d6b311b9d",
            user_id=self.user_id,
            name="Momentum",
            expression=expressions[0],
            hypothesis=hypothesis["hypothesis"],
            research_direction="动量反转",
            ic_value=0.08,
            icir=1.4,
            monotonicity=0.75,
            direction=1,
            is_valid=True,
            generation=1,
        )
        return [
            {
                "expression": expressions[0],
                "hypothesis": hypothesis["hypothesis"],
                "metrics": SimpleNamespace(is_valid=True),
                "error": None,
                "record": record,
            }
        ]

    def _generate_feedback(self, hypothesis, results) -> str:
        return "继续验证"

    def _print_round_summary(self, round_num, results) -> None:
        return None

    def _print_final_summary(self, factors) -> None:
        return None


def test_mining_evaluates_generated_factors(monkeypatch) -> None:
    monkeypatch.setattr(alpha_miner_module, "library", StubLibrary())
    miner = SuccessfulMiner()

    result = miner.mine(
        direction="动量反转",
        max_rounds=1,
        factors_per_round=1,
        use_evolution=True,
    )

    assert miner.evaluated is True
    assert result.generated_count == 1
    assert [factor.name for factor in result.valid_factors] == ["Momentum"]


def test_mining_stops_before_evaluating_next_factor(monkeypatch) -> None:
    monkeypatch.setattr(alpha_miner_module, "library", StubLibrary())

    class CancellingMiner(SuccessfulMiner):
        def __init__(self) -> None:
            super().__init__()
            self.cancel_checks = 0

        def _check_cancelled(self) -> None:
            self.cancel_checks += 1
            if self.cancel_checks >= 4:
                raise TaskCancelledError("task-a")

        def _generate_factors(self, hypothesis, n_factors: int) -> list[str]:
            return ["DELTA(close, 20)", "MEAN(close, 5)"]

        def _evaluate_expressions(self, expressions, hypothesis):
            return AlphaMiner._evaluate_expressions(self, expressions, hypothesis)

        def _calculate_with_debug(self, expression, max_attempts=3):
            raise AssertionError("cancelled factor must not be evaluated")

    with pytest.raises(TaskCancelledError):
        CancellingMiner().mine(
            direction="动量反转",
            max_rounds=1,
            factors_per_round=2,
            use_evolution=False,
        )
