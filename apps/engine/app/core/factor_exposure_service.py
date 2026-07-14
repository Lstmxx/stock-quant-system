"""Cross-sectional factor exposure and stock ranking calculations."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date

import pandas as pd

from .factor_calculator import calculate_factor
from .factor_library import FactorRecord


@dataclass(frozen=True, slots=True)
class FactorContribution:
    factor_id: str
    name: str
    value: float
    z_score: float
    weight: float
    direction: int
    contribution: float
    percentile: float


@dataclass(frozen=True, slots=True)
class StockExposure:
    symbol: str
    rank: int
    composite_score: float
    data_date: date
    factor_contributions: tuple[FactorContribution, ...]


FactorCalculator = Callable[[str, dict[str, pd.DataFrame]], tuple]


class FactorExposureService:
    """Calculate one immutable cross-sectional selection snapshot."""

    def __init__(
        self,
        calculate: FactorCalculator = calculate_factor,
        check_cancelled: Callable[[], None] | None = None,
    ) -> None:
        self._calculate = calculate
        self._check_cancelled = check_cancelled or (lambda: None)

    def calculate(
        self,
        *,
        factors: Sequence[FactorRecord],
        market_data: dict[str, pd.DataFrame],
        universe_symbols: Sequence[str] | None = None,
    ) -> list[StockExposure]:
        valid_factors = [factor for factor in factors if factor.is_valid]
        if not valid_factors:
            raise ValueError("没有可用于选股的有效因子")
        if len({factor.user_id for factor in valid_factors}) != 1:
            raise ValueError("选股因子必须属于同一用户")
        if universe_symbols is not None and not universe_symbols:
            raise ValueError("选股股票池不能为空")

        raw_values: dict[str, pd.Series] = {}
        matrices: dict[str, pd.DataFrame] = {}
        for factor in valid_factors:
            self._check_cancelled()
            values, _, error = self._calculate(factor.expression, market_data)
            if error or values is None or values.empty:
                raise ValueError(f"因子 {factor.name} 计算失败: {error or '无有效值'}")
            matrices[factor.id] = values

        data_timestamp = min(values.index.max() for values in matrices.values())
        requested_symbols = set(universe_symbols) if universe_symbols is not None else None

        common_symbols: set[str] | None = None
        for factor in valid_factors:
            values = matrices[factor.id]
            available_dates = values.index[values.index <= data_timestamp]
            if available_dates.empty:
                raise ValueError(f"因子 {factor.name} 在选股日期没有有效数据")
            latest = values.loc[available_dates[-1]].dropna().astype(float)
            if requested_symbols is not None:
                latest = latest[latest.index.isin(requested_symbols)]
            raw_values[factor.id] = latest
            symbols = set(latest.index)
            common_symbols = symbols if common_symbols is None else common_symbols & symbols

        if not common_symbols:
            raise ValueError("所选股票池没有完整的因子暴露")
        ordered_symbols = sorted(common_symbols)

        weights = self._normalized_weights(valid_factors)
        adjusted_zscores: dict[str, pd.Series] = {}
        percentiles: dict[str, pd.Series] = {}
        for factor in valid_factors:
            values = raw_values[factor.id].reindex(ordered_symbols)
            standard_deviation = values.std()
            if pd.isna(standard_deviation) or standard_deviation == 0:
                zscore = pd.Series(0.0, index=values.index)
            else:
                zscore = (values - values.mean()) / standard_deviation
            direction = -1 if factor.direction == -1 else 1
            adjusted = zscore * direction
            adjusted_zscores[factor.id] = adjusted
            percentiles[factor.id] = adjusted.rank(method="average", pct=True) * 100

        composite = pd.Series(0.0, index=ordered_symbols)
        for factor in valid_factors:
            composite += adjusted_zscores[factor.id] * weights[factor.id]
        ranked_symbols = list(composite.sort_values(ascending=False, kind="stable").index)

        results: list[StockExposure] = []
        for rank, symbol in enumerate(ranked_symbols, start=1):
            self._check_cancelled()
            contributions = tuple(
                FactorContribution(
                    factor_id=factor.id,
                    name=factor.name,
                    value=float(raw_values[factor.id][symbol]),
                    z_score=float(adjusted_zscores[factor.id][symbol]),
                    weight=weights[factor.id],
                    direction=-1 if factor.direction == -1 else 1,
                    contribution=float(adjusted_zscores[factor.id][symbol] * weights[factor.id]),
                    percentile=float(percentiles[factor.id][symbol]),
                )
                for factor in valid_factors
            )
            results.append(
                StockExposure(
                    symbol=symbol,
                    rank=rank,
                    composite_score=float(composite[symbol]),
                    data_date=data_timestamp.date(),
                    factor_contributions=contributions,
                )
            )
        return results

    @staticmethod
    def _normalized_weights(factors: Sequence[FactorRecord]) -> dict[str, float]:
        raw_weights = {
            factor.id: abs(factor.ic_value or 0.0) or abs(factor.icir or 0.0)
            for factor in factors
        }
        total = sum(raw_weights.values())
        if total == 0:
            return {factor.id: 1 / len(factors) for factor in factors}
        return {factor_id: weight / total for factor_id, weight in raw_weights.items()}
