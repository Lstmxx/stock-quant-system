from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.core.factor_exposure_service import FactorContribution, StockExposure
from app.core.llm_stock_selection_snapshot import (
    LlmStockSelectionSnapshotService,
    StockSelectionSnapshotError,
)


class FakeExposureCalculator:
    def __init__(self, missing: set[str] | None = None) -> None:
        self.missing = missing or set()

    def calculate(self, *, factors, market_data, universe_symbols=None):
        symbols = [symbol for symbol in universe_symbols or [] if symbol not in self.missing]
        return [
            StockExposure(
                symbol=symbol,
                rank=index,
                composite_score=float(len(symbols) - index),
                data_date=date(2026, 7, 15),
                factor_contributions=(
                    FactorContribution(
                        factor_id="factor-1",
                        name="Momentum",
                        value=float(index),
                        z_score=0.1 * index,
                        weight=1.0,
                        direction=1,
                        contribution=0.1 * index,
                        percentile=100 - index,
                    ),
                ),
            )
            for index, symbol in enumerate(symbols, start=1)
        ]


def market_data(symbols: list[str], periods: int = 130) -> dict[str, pd.DataFrame]:
    index = pd.bdate_range("2026-01-15", periods=periods)
    base = np.arange(periods, dtype=float)[:, None]
    offsets = np.arange(len(symbols), dtype=float)[None, :]
    close = pd.DataFrame(10 + base * 0.05 + offsets, index=index, columns=symbols)
    frames = {
        "open": close - 0.1,
        "high": close + 0.2,
        "low": close - 0.2,
        "close": close,
        "volume": pd.DataFrame(
            1_000 + base * 10 + offsets,
            index=index,
            columns=symbols,
        ),
        "amount": pd.DataFrame(
            10_000 + base * 100 + offsets,
            index=index,
            columns=symbols,
        ),
        "turn": pd.DataFrame(
            1 + base * 0.001 + offsets * 0.01,
            index=index,
            columns=symbols,
        ),
        "pctChg": close.pct_change().fillna(0) * 100,
        "stock_names": pd.Series({symbol: f"Name {symbol}" for symbol in symbols}),
    }
    return frames


def test_builds_top_m_union_watchlist_with_bounded_payload() -> None:
    symbols = [f"sh.600{index:03d}" for index in range(10)]
    service = LlmStockSelectionSnapshotService(FakeExposureCalculator())

    snapshot = service.build(
        factors=[],
        market_data=market_data(symbols),
        universe_symbols=symbols,
        watchlist_symbols=[symbols[0], symbols[7]],
        candidate_count=3,
        lookback_days=250,
    )

    assert snapshot.data_date == date(2026, 7, 15)
    assert snapshot.coverage_rate == 1.0
    assert [candidate.symbol for candidate in snapshot.candidates] == [
        symbols[0],
        symbols[1],
        symbols[2],
        symbols[7],
    ]
    assert snapshot.candidates[0].candidate_sources == (
        "QUANTITATIVE",
        "WATCHLIST",
    )
    payload = snapshot.candidates[0].to_payload()
    assert payload["schemaVersion"] == "llm-stock-selection-input/v1"
    assert payload["dataDate"] == "2026-07-15"
    assert len(payload["recentBars"]) == 20
    assert payload["indicators"]["trend"]["ma60"] is not None
    assert payload["factorContributions"][0]["factorId"] == "factor-1"


def test_records_factor_and_indicator_exclusions_at_ninety_percent_boundary() -> None:
    symbols = [f"sz.000{index:03d}" for index in range(10)]
    data = market_data(symbols)
    data["close"].loc[:, symbols[8]] = np.nan
    service = LlmStockSelectionSnapshotService(
        FakeExposureCalculator(missing={symbols[9]})
    )

    with pytest.raises(StockSelectionSnapshotError, match="低于 90%") as error:
        service.build(
            factors=[],
            market_data=data,
            universe_symbols=symbols,
            watchlist_symbols=[],
            candidate_count=3,
            lookback_days=250,
        )
    assert error.value.snapshot is not None
    assert len(error.value.snapshot.exclusions) == 2

    data = market_data(symbols)
    snapshot = LlmStockSelectionSnapshotService(
        FakeExposureCalculator(missing={symbols[9]})
    ).build(
        factors=[],
        market_data=data,
        universe_symbols=symbols,
        watchlist_symbols=[symbols[9]],
        candidate_count=3,
        lookback_days=250,
    )
    assert snapshot.coverage_rate == 0.9
    assert snapshot.exclusions[0].symbol == symbols[9]
    assert snapshot.exclusions[0].code == "INCOMPLETE_FACTOR_EXPOSURE"


def test_rejects_incomplete_recent_bars_and_missing_required_matrices() -> None:
    symbols = [f"sh.600{index:03d}" for index in range(10)]
    data = market_data(symbols)
    data["volume"].loc[data["volume"].index[-1], symbols[0]] = np.nan
    snapshot = LlmStockSelectionSnapshotService(FakeExposureCalculator()).build(
        factors=[],
        market_data=data,
        universe_symbols=symbols,
        watchlist_symbols=[],
        candidate_count=3,
        lookback_days=250,
    )
    assert any(
        exclusion.symbol == symbols[0]
        and exclusion.code == "INCOMPLETE_RECENT_BARS"
        for exclusion in snapshot.exclusions
    )

    data.pop("amount")
    with pytest.raises(StockSelectionSnapshotError, match="amount"):
        LlmStockSelectionSnapshotService(FakeExposureCalculator()).build(
            factors=[],
            market_data=data,
            universe_symbols=symbols,
            watchlist_symbols=[],
            candidate_count=3,
            lookback_days=250,
        )
