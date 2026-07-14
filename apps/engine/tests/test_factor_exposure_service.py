from dataclasses import replace
from datetime import date

import pandas as pd
import pytest

from app.core.factor_exposure_service import FactorExposureService
from app.core.factor_library import FactorRecord


def factor(factor_id: str, name: str, expression: str, direction: int) -> FactorRecord:
    return FactorRecord(
        id=factor_id,
        user_id="user-a",
        name=name,
        expression=expression,
        hypothesis=None,
        research_direction="动量反转",
        ic_value=0.1,
        icir=1.0,
        monotonicity=0.8,
        direction=direction,
        is_valid=True,
        generation=1,
    )


def test_watchlist_is_standardized_and_ranked_inside_its_snapshot() -> None:
    index = pd.to_datetime(["2026-07-10"])
    values = {
        "momentum": pd.DataFrame([[1.0, 2.0, 100.0]], index=index, columns=["A", "B", "C"]),
        "risk": pd.DataFrame([[1.0, 3.0, 2.0]], index=index, columns=["A", "B", "C"]),
    }

    def calculate(expression, _market_data):
        return values[expression], None, None

    service = FactorExposureService(calculate=calculate)
    results = service.calculate(
        factors=[
            factor("factor-1", "Momentum", "momentum", 1),
            factor("factor-2", "Risk", "risk", -1),
        ],
        market_data={"close": values["momentum"]},
        universe_symbols=["A", "B"],
    )

    assert [row.symbol for row in results] == ["A", "B"]
    assert [row.rank for row in results] == [1, 2]
    assert all(row.data_date == date(2026, 7, 10) for row in results)
    assert results[0].composite_score == pytest.approx(0.0)
    assert sum(item.contribution for item in results[0].factor_contributions) == pytest.approx(
        results[0].composite_score
    )

    risk = next(item for item in results[0].factor_contributions if item.factor_id == "factor-2")
    assert risk.direction == -1
    assert risk.z_score > 0
    assert risk.percentile == pytest.approx(100.0)


def test_selection_rejects_empty_or_wrong_user_factor_set() -> None:
    service = FactorExposureService()
    with pytest.raises(ValueError, match="有效因子"):
        service.calculate(factors=[], market_data={})

    foreign = factor("factor-1", "Momentum", "momentum", 1)
    foreign = replace(foreign, user_id="user-b")
    with pytest.raises(ValueError, match="同一用户"):
        service.calculate(
            factors=[factor("factor-2", "Risk", "risk", -1), foreign],
            market_data={},
        )
