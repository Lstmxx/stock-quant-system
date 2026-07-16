"""Build immutable quantitative and market snapshots for LLM stock selection."""

from dataclasses import dataclass
from datetime import date
from math import isfinite
from typing import Literal, Protocol

import pandas as pd

from .factor_dsl import (
    ATR,
    BOLL_DN,
    BOLL_MID,
    BOLL_UP,
    KDJ_D,
    KDJ_J,
    KDJ_K,
    MACD_DEA,
    MACD_DIF,
    MACD_HIST,
    ROC,
    RSI,
)
from .factor_exposure_service import FactorExposureService, StockExposure
from .factor_library import FactorRecord


INPUT_SCHEMA_VERSION = "llm-stock-selection-input/v1"
INDICATOR_PROFILE_VERSION = "market-technical/v1"
HORIZON_TRADING_DAYS = 20
MAX_LLM_CANDIDATES = 150
MIN_ELIGIBLE_COVERAGE = 0.90
RECENT_BAR_COUNT = 20
MIN_INDICATOR_HISTORY = 60

CandidateSource = Literal["QUANTITATIVE", "WATCHLIST"]
ExclusionStage = Literal["MARKET_DATA", "FACTOR", "INDICATOR", "SNAPSHOT"]


class ExposureCalculator(Protocol):
    """Calculate the shared quantitative exposure snapshot."""

    def calculate(
        self,
        *,
        factors: list[FactorRecord],
        market_data: dict[str, pd.DataFrame],
        universe_symbols: list[str] | None = None,
    ) -> list[StockExposure]: ...


@dataclass(frozen=True, slots=True)
class StockExclusion:
    symbol: str
    stage: ExclusionStage
    code: str
    message: str


@dataclass(frozen=True, slots=True)
class CandidateInput:
    symbol: str
    stock_name: str | None
    data_date: date
    candidate_sources: tuple[CandidateSource, ...]
    quantitative_score: float
    quantitative_rank: int
    recent_bars: tuple[dict[str, float | str], ...]
    indicators: dict[str, dict[str, float | None]]
    factor_contributions: tuple[dict[str, float | int | str], ...]
    lookback_days: int

    def to_payload(self) -> dict:
        """Return the versioned JSON-safe LLM input contract."""
        return {
            "schemaVersion": INPUT_SCHEMA_VERSION,
            "indicatorProfileVersion": INDICATOR_PROFILE_VERSION,
            "horizonTradingDays": HORIZON_TRADING_DAYS,
            "lookbackDays": self.lookback_days,
            "dataDate": self.data_date.isoformat(),
            "symbol": self.symbol,
            "stockName": self.stock_name,
            "candidateSources": list(self.candidate_sources),
            "quantitativeScore": self.quantitative_score,
            "quantitativeRank": self.quantitative_rank,
            "recentBars": list(self.recent_bars),
            "indicators": self.indicators,
            "factorContributions": list(self.factor_contributions),
        }


def candidate_input_from_payload(payload: dict) -> CandidateInput:
    """Decode one persisted input/v1 payload for a retry without new market data."""
    if payload.get("schemaVersion") != INPUT_SCHEMA_VERSION:
        raise StockSelectionSnapshotError("候选快照版本不受支持")
    if payload.get("indicatorProfileVersion") != INDICATOR_PROFILE_VERSION:
        raise StockSelectionSnapshotError("候选指标版本不受支持")
    return CandidateInput(
        symbol=str(payload["symbol"]),
        stock_name=(str(payload["stockName"]) if payload.get("stockName") else None),
        data_date=date.fromisoformat(str(payload["dataDate"])),
        candidate_sources=tuple(payload.get("candidateSources") or []),
        quantitative_score=float(payload["quantitativeScore"]),
        quantitative_rank=int(payload["quantitativeRank"]),
        recent_bars=tuple(payload.get("recentBars") or []),
        indicators=dict(payload.get("indicators") or {}),
        factor_contributions=tuple(payload.get("factorContributions") or []),
        lookback_days=int(payload["lookbackDays"]),
    )


@dataclass(frozen=True, slots=True)
class StockSelectionSnapshot:
    data_date: date
    universe_symbols: tuple[str, ...]
    eligible_exposures: tuple[StockExposure, ...]
    exclusions: tuple[StockExclusion, ...]
    candidates: tuple[CandidateInput, ...]

    @property
    def coverage_rate(self) -> float:
        if not self.universe_symbols:
            return 0.0
        return len(self.eligible_exposures) / len(self.universe_symbols)


class StockSelectionSnapshotError(ValueError):
    """Preparation failure that must occur before any LLM call."""

    def __init__(
        self,
        message: str,
        snapshot: StockSelectionSnapshot | None = None,
    ) -> None:
        super().__init__(message)
        self.snapshot = snapshot


class LlmStockSelectionSnapshotService:
    """Create one bounded and reproducible LLM stock-selection input snapshot."""

    _required_fields = (
        "open",
        "high",
        "low",
        "close",
        "volume",
        "amount",
        "turn",
        "pctChg",
    )

    def __init__(self, exposure_calculator: ExposureCalculator | None = None) -> None:
        self._exposure_calculator = exposure_calculator or FactorExposureService()

    def build(
        self,
        *,
        factors: list[FactorRecord],
        market_data: dict[str, pd.DataFrame],
        universe_symbols: list[str],
        watchlist_symbols: list[str],
        candidate_count: int,
        lookback_days: int,
    ) -> StockSelectionSnapshot:
        universe = tuple(sorted(set(universe_symbols)))
        if not universe:
            raise StockSelectionSnapshotError("沪深主板股票池为空")

        missing_fields = [field for field in self._required_fields if field not in market_data]
        if missing_fields:
            raise StockSelectionSnapshotError(
                f"行情矩阵缺少必要字段: {', '.join(missing_fields)}"
            )

        exposures = self._exposure_calculator.calculate(
            factors=factors,
            market_data=market_data,
            universe_symbols=list(universe),
        )
        if not exposures:
            raise StockSelectionSnapshotError("没有可用的量化因子暴露")

        data_date = exposures[0].data_date
        exposure_by_symbol = {exposure.symbol: exposure for exposure in exposures}
        exclusions: dict[str, StockExclusion] = {
            symbol: StockExclusion(
                symbol=symbol,
                stage="FACTOR",
                code="INCOMPLETE_FACTOR_EXPOSURE",
                message="股票在选股日期缺少完整因子暴露",
            )
            for symbol in universe
            if symbol not in exposure_by_symbol
        }

        profile = _MarketTechnicalProfile(market_data, data_date)
        eligible: list[StockExposure] = []
        for exposure in exposures:
            error = profile.validate_symbol(exposure.symbol)
            if error is not None:
                exclusions[exposure.symbol] = error
                continue
            eligible.append(exposure)

        coverage_rate = len(eligible) / len(universe)
        if coverage_rate < MIN_ELIGIBLE_COVERAGE:
            raise StockSelectionSnapshotError(
                f"有效数据覆盖率 {coverage_rate:.1%} 低于 90%，请先更新行情数据",
                StockSelectionSnapshot(
                    data_date=data_date,
                    universe_symbols=universe,
                    eligible_exposures=tuple(eligible),
                    exclusions=tuple(
                        exclusions[symbol] for symbol in sorted(exclusions)
                    ),
                    candidates=(),
                ),
            )
        if len(eligible) < candidate_count:
            raise StockSelectionSnapshotError(
                f"有效股票数 {len(eligible)} 少于候选数 {candidate_count}",
                StockSelectionSnapshot(
                    data_date=data_date,
                    universe_symbols=universe,
                    eligible_exposures=tuple(eligible),
                    exclusions=tuple(
                        exclusions[symbol] for symbol in sorted(exclusions)
                    ),
                    candidates=(),
                ),
            )

        eligible_by_symbol = {exposure.symbol: exposure for exposure in eligible}
        candidate_sources: dict[str, set[CandidateSource]] = {}
        for exposure in eligible[:candidate_count]:
            candidate_sources.setdefault(exposure.symbol, set()).add("QUANTITATIVE")
        for symbol in sorted(set(watchlist_symbols)):
            if symbol in eligible_by_symbol:
                candidate_sources.setdefault(symbol, set()).add("WATCHLIST")

        if len(candidate_sources) > MAX_LLM_CANDIDATES:
            raise StockSelectionSnapshotError(
                f"去重后的 LLM 候选数 {len(candidate_sources)} 超过上限 150"
            )

        candidates: list[CandidateInput] = []
        for symbol in sorted(
            candidate_sources,
            key=lambda candidate_symbol: (
                eligible_by_symbol[candidate_symbol].rank,
                candidate_symbol,
            ),
        ):
            exposure = eligible_by_symbol[symbol]
            candidates.append(
                CandidateInput(
                    symbol=symbol,
                    stock_name=profile.stock_name(symbol),
                    data_date=data_date,
                    candidate_sources=tuple(sorted(candidate_sources[symbol])),
                    quantitative_score=exposure.composite_score,
                    quantitative_rank=exposure.rank,
                    recent_bars=profile.recent_bars(symbol),
                    indicators=profile.indicators(symbol),
                    factor_contributions=tuple(
                        {
                            "factorId": contribution.factor_id,
                            "name": contribution.name,
                            "value": contribution.value,
                            "zScore": contribution.z_score,
                            "weight": contribution.weight,
                            "direction": contribution.direction,
                            "contribution": contribution.contribution,
                            "percentile": contribution.percentile,
                        }
                        for contribution in exposure.factor_contributions
                    ),
                    lookback_days=lookback_days,
                )
            )

        return StockSelectionSnapshot(
            data_date=data_date,
            universe_symbols=universe,
            eligible_exposures=tuple(eligible),
            exclusions=tuple(exclusions[symbol] for symbol in sorted(exclusions)),
            candidates=tuple(candidates),
        )


class _MarketTechnicalProfile:
    """Vectorized market-technical/v1 computations shared by all candidates."""

    def __init__(self, market_data: dict[str, pd.DataFrame], data_date: date) -> None:
        cutoff = pd.Timestamp(data_date)
        self._frames = {
            field: market_data[field].loc[market_data[field].index <= cutoff].sort_index()
            for field in LlmStockSelectionSnapshotService._required_fields
        }
        close = self._frames["close"]
        high = self._frames["high"]
        low = self._frames["low"]

        self._indicator_frames = {
            "ma5": close.rolling(5).mean(),
            "ma10": close.rolling(10).mean(),
            "ma20": close.rolling(20).mean(),
            "ma60": close.rolling(60).mean(),
            "macdDif": MACD_DIF(close),
            "macdDea": MACD_DEA(close),
            "macdHist": MACD_HIST(close),
            "rsi14": RSI(close, 14),
            "kdjK": KDJ_K(high, low, close),
            "kdjD": KDJ_D(high, low, close),
            "kdjJ": KDJ_J(high, low, close),
            "roc20": ROC(close, 20),
            "atr14": ATR(high, low, close, 14),
            "bollUp": BOLL_UP(close, 20),
            "bollMid": BOLL_MID(close, 20),
            "bollDown": BOLL_DN(close, 20),
        }
        stock_names = market_data.get("stock_names")
        self._stock_names = stock_names if isinstance(stock_names, pd.Series) else pd.Series()

    def validate_symbol(self, symbol: str) -> StockExclusion | None:
        close = self._frames["close"].get(symbol)
        if close is None or close.dropna().shape[0] < MIN_INDICATOR_HISTORY:
            return StockExclusion(
                symbol=symbol,
                stage="INDICATOR",
                code="INSUFFICIENT_HISTORY",
                message="可用历史行情不足 60 个交易日",
            )

        recent = self._recent_frame(symbol)
        if recent.shape[0] < RECENT_BAR_COUNT or recent.isna().any(axis=None):
            return StockExclusion(
                symbol=symbol,
                stage="MARKET_DATA",
                code="INCOMPLETE_RECENT_BARS",
                message="最近 20 个交易日行情字段不完整",
            )
        return None

    def stock_name(self, symbol: str) -> str | None:
        value = self._stock_names.get(symbol)
        return str(value) if value is not None and str(value) else None

    def recent_bars(self, symbol: str) -> tuple[dict[str, float | str], ...]:
        frame = self._recent_frame(symbol).tail(RECENT_BAR_COUNT)
        return tuple(
            {
                "date": index.date().isoformat(),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row["volume"]),
                "amount": float(row["amount"]),
                "turnover": float(row["turn"]),
                "percentageChange": float(row["pctChg"]),
            }
            for index, row in frame.iterrows()
        )

    def indicators(self, symbol: str) -> dict[str, dict[str, float | None]]:
        close = self._frames["close"][symbol].dropna()
        volume = self._frames["volume"][symbol].dropna()
        amount = self._frames["amount"][symbol].dropna()
        turnover = self._frames["turn"][symbol].dropna()
        latest_close = float(close.iloc[-1])
        boll_up = self._latest("bollUp", symbol)
        boll_mid = self._latest("bollMid", symbol)
        boll_down = self._latest("bollDown", symbol)

        return {
            "returns": {
                "oneDay": _period_return(close, 1),
                "fiveDay": _period_return(close, 5),
                "twentyDay": _period_return(close, 20),
                "sixtyDay": _period_return(close, 60),
            },
            "trend": {
                "ma5": self._latest("ma5", symbol),
                "ma10": self._latest("ma10", symbol),
                "ma20": self._latest("ma20", symbol),
                "ma60": self._latest("ma60", symbol),
                "macdDif": self._latest("macdDif", symbol),
                "macdDea": self._latest("macdDea", symbol),
                "macdHist": self._latest("macdHist", symbol),
            },
            "momentum": {
                "rsi14": self._latest("rsi14", symbol),
                "kdjK": self._latest("kdjK", symbol),
                "kdjD": self._latest("kdjD", symbol),
                "kdjJ": self._latest("kdjJ", symbol),
                "roc20": self._latest("roc20", symbol),
            },
            "risk": {
                "atr14": self._latest("atr14", symbol),
                "bollingerPosition": _safe_ratio(
                    latest_close - boll_down if boll_down is not None else None,
                    boll_up - boll_down
                    if boll_up is not None and boll_down is not None
                    else None,
                ),
                "bollingerBandwidth": _safe_ratio(
                    boll_up - boll_down
                    if boll_up is not None and boll_down is not None
                    else None,
                    boll_mid,
                ),
                "volatility20": _finite_or_none(
                    close.pct_change().tail(20).std() * (252**0.5)
                ),
                "maxDrawdown60": _max_drawdown(close.tail(60)),
            },
            "volume": {
                "volumeRatio5": _safe_ratio(float(volume.iloc[-1]), volume.tail(5).mean()),
                "volumeRatio20": _safe_ratio(
                    float(volume.iloc[-1]), volume.tail(20).mean()
                ),
                "amountChange": _period_return(amount, 5),
                "turnover5": _finite_or_none(turnover.tail(5).mean()),
                "turnover20": _finite_or_none(turnover.tail(20).mean()),
            },
        }

    def _recent_frame(self, symbol: str) -> pd.DataFrame:
        return pd.concat(
            {field: self._frames[field][symbol] for field in self._frames},
            axis=1,
            join="inner",
        ).tail(RECENT_BAR_COUNT)

    def _latest(self, name: str, symbol: str) -> float | None:
        series = self._indicator_frames[name].get(symbol)
        if series is None:
            return None
        values = series.dropna()
        return _finite_or_none(values.iloc[-1]) if not values.empty else None


def _period_return(series: pd.Series, periods: int) -> float | None:
    if len(series) <= periods:
        return None
    previous = float(series.iloc[-periods - 1])
    if previous == 0:
        return None
    return _finite_or_none(float(series.iloc[-1]) / previous - 1)


def _safe_ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return _finite_or_none(float(numerator) / float(denominator))


def _max_drawdown(series: pd.Series) -> float | None:
    if series.empty:
        return None
    running_max = series.cummax()
    drawdown = series / running_max - 1
    return _finite_or_none(drawdown.min())


def _finite_or_none(value) -> float | None:
    try:
        normalized = float(value)
    except (TypeError, ValueError):
        return None
    return normalized if isfinite(normalized) else None
