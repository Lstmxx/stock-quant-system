"""Execute one persisted LLM stock-selection task snapshot."""

import json
from collections.abc import Callable, Iterable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Literal, Protocol
from uuid import uuid4

import redis
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import Engine, create_engine, text

from app.config import settings

from .data_loader import DataLoader, load_market_data
from .factor_library import library
from .litellm_client import get_default_llm_client
from .llm_config_loader import get_default_config_loader
from .llm_stock_selection_snapshot import (
    CandidateInput,
    LlmStockSelectionSnapshotService,
    StockSelectionSnapshot,
    StockSelectionSnapshotError,
    candidate_input_from_payload,
)
from .llm_types import ChatRequest, LLMClient, LlmError, LlmModelConfig, TokenUsage


class KeySignal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Literal["PRICE", "VOLUME", "TECHNICAL", "FACTOR"]
    name: str = Field(min_length=1, max_length=80)
    interpretation: str = Field(min_length=1, max_length=300)


BoundedEvidence = Annotated[str, Field(min_length=1, max_length=200)]


class LlmStockJudgment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selection_score: int = Field(alias="selectionScore", ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    outlook: Literal["BULLISH", "NEUTRAL", "BEARISH"]
    summary: str = Field(min_length=1, max_length=300)
    strengths: list[BoundedEvidence] = Field(max_length=3)
    risks: list[BoundedEvidence] = Field(max_length=3)
    key_signals: list[KeySignal] = Field(
        alias="keySignals",
        min_length=1,
        max_length=8,
    )


@dataclass(frozen=True, slots=True)
class CandidateAttempt:
    candidate: CandidateInput
    attempt_no: int
    judgment: LlmStockJudgment | None
    usage: TokenUsage | None
    error_code: str | None
    error_message: str | None

    @property
    def succeeded(self) -> bool:
        return self.judgment is not None


@dataclass(frozen=True, slots=True)
class LlmStockSelectionRunResult:
    status: Literal["COMPLETED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"]
    summary: dict


class StockSelectionRepository(Protocol):
    def persist_snapshot(
        self,
        task_id: str,
        user_id: str,
        snapshot: StockSelectionSnapshot,
    ) -> None: ...

    def begin_attempt(
        self,
        task_id: str,
        user_id: str,
        candidate: CandidateInput,
        model: LlmModelConfig,
    ) -> int: ...

    def finish_attempt(
        self,
        task_id: str,
        user_id: str,
        attempt: CandidateAttempt,
        model: LlmModelConfig,
    ) -> None: ...

    def mark_not_run_cancelled(
        self,
        task_id: str,
        user_id: str,
        symbols: Iterable[str],
    ) -> None: ...

    def load_retry_candidates(
        self,
        task_id: str,
        user_id: str,
        symbols: list[str] | None,
    ) -> tuple[CandidateInput, ...]: ...

    def finalize_ranking(
        self,
        task_id: str,
        user_id: str,
        final_top_n: int,
    ) -> tuple[int, int, TokenUsage]: ...

    def get_run_metrics(self, task_id: str, user_id: str) -> dict: ...


class SqlStockSelectionRepository:
    """SQLAlchemy persistence boundary for stock-selection outcomes."""

    def __init__(self, engine: Engine | None = None) -> None:
        self._engine = engine or create_engine(settings.database_url)

    def persist_snapshot(
        self,
        task_id: str,
        user_id: str,
        snapshot: StockSelectionSnapshot,
    ) -> None:
        candidates = {candidate.symbol: candidate for candidate in snapshot.candidates}
        exposures = {
            exposure.symbol: exposure for exposure in snapshot.eligible_exposures
        }
        exclusions = {exclusion.symbol: exclusion for exclusion in snapshot.exclusions}
        rows = []
        for symbol in snapshot.universe_symbols:
            candidate = candidates.get(symbol)
            exposure = exposures.get(symbol)
            exclusion = exclusions.get(symbol)
            rows.append(
                {
                    "id": str(uuid4()),
                    "task_id": task_id,
                    "user_id": user_id,
                    "symbol": symbol,
                    "stock_name": candidate.stock_name if candidate else None,
                    "data_date": snapshot.data_date.isoformat(),
                    "universe_status": "ELIGIBLE" if exposure else "EXCLUDED",
                    "exclusion_stage": exclusion.stage if exclusion else None,
                    "exclusion_code": exclusion.code if exclusion else None,
                    "exclusion_message": exclusion.message if exclusion else None,
                    "quantitative_score": exposure.composite_score if exposure else None,
                    "quantitative_rank": exposure.rank if exposure else None,
                    "candidate_sources": json.dumps(
                        list(candidate.candidate_sources) if candidate else []
                    ),
                    "is_llm_candidate": candidate is not None,
                    "input_snapshot": (
                        json.dumps(candidate.to_payload()) if candidate else None
                    ),
                    "llm_status": "PENDING" if candidate else "NOT_REQUESTED",
                }
            )

        with self._engine.begin() as connection:
            connection.execute(
                text(
                    'DELETE FROM llm_stock_selection_results WHERE "taskId" = :task_id'
                ),
                {"task_id": task_id},
            )
            connection.execute(
                text(
                    '''
                    INSERT INTO llm_stock_selection_results (
                        id, "taskId", "userId", symbol, "stockName", "dataDate",
                        "universeStatus", "exclusionStage", "exclusionCode",
                        "exclusionMessage", "excludedAt", "quantitativeScore",
                        "quantitativeRank", "candidateSources", "isLlmCandidate",
                        "inputSnapshot", "llmStatus", "createdAt", "updatedAt"
                    ) VALUES (
                        :id, :task_id, :user_id, :symbol, :stock_name, :data_date,
                        :universe_status, :exclusion_stage, :exclusion_code,
                        :exclusion_message,
                        CASE WHEN :exclusion_code IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
                        :quantitative_score, :quantitative_rank,
                        CAST(:candidate_sources AS JSONB), :is_llm_candidate,
                        CAST(:input_snapshot AS JSONB), :llm_status,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    '''
                ),
                rows,
            )

    def begin_attempt(
        self,
        task_id: str,
        user_id: str,
        candidate: CandidateInput,
        model: LlmModelConfig,
    ) -> int:
        with self._engine.begin() as connection:
            result = connection.execute(
                text(
                    '''
                    SELECT id, "attemptCount"
                    FROM llm_stock_selection_results
                    WHERE "taskId" = :task_id AND "userId" = :user_id
                      AND symbol = :symbol
                    FOR UPDATE
                    '''
                ),
                {
                    "task_id": task_id,
                    "user_id": user_id,
                    "symbol": candidate.symbol,
                },
            ).mappings().one()
            attempt_no = int(result["attemptCount"]) + 1
            connection.execute(
                text(
                    '''
                    UPDATE llm_stock_selection_results
                    SET "attemptCount" = :attempt_no, "llmStatus" = 'PENDING',
                        "latestErrorCode" = NULL, "latestErrorMessage" = NULL,
                        "latestErrorAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
                    WHERE id = :result_id
                    '''
                ),
                {"attempt_no": attempt_no, "result_id": result["id"]},
            )
            connection.execute(
                text(
                    '''
                    INSERT INTO llm_stock_selection_attempts (
                        id, "resultId", "taskId", "userId", "attemptNo", status,
                        "llmModelId", provider, "modelName", "modelDisplayName",
                        "startedAt"
                    ) VALUES (
                        :id, :result_id, :task_id, :user_id, :attempt_no, 'RUNNING',
                        :model_id, :provider, :model_name, :model_name,
                        CURRENT_TIMESTAMP
                    )
                    '''
                ),
                {
                    "id": str(uuid4()),
                    "result_id": result["id"],
                    "task_id": task_id,
                    "user_id": user_id,
                    "attempt_no": attempt_no,
                    "model_id": model.id,
                    "provider": model.provider,
                    "model_name": model.model_name,
                },
            )
        return attempt_no

    def finish_attempt(
        self,
        task_id: str,
        user_id: str,
        attempt: CandidateAttempt,
        model: LlmModelConfig,
    ) -> None:
        del model
        judgment = (
            json.dumps(attempt.judgment.model_dump(by_alias=True))
            if attempt.judgment
            else None
        )
        usage = attempt.usage or TokenUsage(0, 0, 0)
        status = "SUCCEEDED" if attempt.succeeded else "FAILED"
        with self._engine.begin() as connection:
            connection.execute(
                text(
                    '''
                    UPDATE llm_stock_selection_attempts
                    SET status = :status, judgment = CAST(:judgment AS JSONB),
                        "errorCode" = :error_code, "errorMessage" = :error_message,
                        "promptTokens" = :prompt_tokens,
                        "completionTokens" = :completion_tokens,
                        "totalTokens" = :total_tokens,
                        "completedAt" = CURRENT_TIMESTAMP
                    WHERE "taskId" = :task_id AND "userId" = :user_id
                      AND "attemptNo" = :attempt_no
                      AND "resultId" = (
                        SELECT id FROM llm_stock_selection_results
                        WHERE "taskId" = :task_id AND "userId" = :user_id
                          AND symbol = :symbol
                      )
                    '''
                ),
                {
                    "status": status,
                    "judgment": judgment,
                    "error_code": attempt.error_code,
                    "error_message": attempt.error_message,
                    "prompt_tokens": usage.prompt_tokens,
                    "completion_tokens": usage.completion_tokens,
                    "total_tokens": usage.total_tokens,
                    "task_id": task_id,
                    "user_id": user_id,
                    "attempt_no": attempt.attempt_no,
                    "symbol": attempt.candidate.symbol,
                },
            )
            connection.execute(
                text(
                    '''
                    UPDATE llm_stock_selection_results
                    SET "llmStatus" = :status,
                        judgment = CAST(:judgment AS JSONB),
                        "latestErrorCode" = :error_code,
                        "latestErrorMessage" = :error_message,
                        "latestErrorAt" = CASE
                          WHEN :error_code IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
                        "promptTokens" = "promptTokens" + :prompt_tokens,
                        "completionTokens" = "completionTokens" + :completion_tokens,
                        "totalTokens" = "totalTokens" + :total_tokens,
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE "taskId" = :task_id AND "userId" = :user_id
                      AND symbol = :symbol
                    '''
                ),
                {
                    "status": status,
                    "judgment": judgment,
                    "error_code": attempt.error_code,
                    "error_message": attempt.error_message,
                    "prompt_tokens": usage.prompt_tokens,
                    "completion_tokens": usage.completion_tokens,
                    "total_tokens": usage.total_tokens,
                    "task_id": task_id,
                    "user_id": user_id,
                    "symbol": attempt.candidate.symbol,
                },
            )

    def mark_not_run_cancelled(
        self,
        task_id: str,
        user_id: str,
        symbols: Iterable[str],
    ) -> None:
        symbols = list(symbols)
        if not symbols:
            return
        with self._engine.begin() as connection:
            connection.execute(
                text(
                    '''
                    UPDATE llm_stock_selection_results
                    SET "llmStatus" = 'CANCELLED', "updatedAt" = CURRENT_TIMESTAMP
                    WHERE "taskId" = :task_id AND "userId" = :user_id
                      AND symbol = :symbol
                    '''
                ),
                [
                    {"task_id": task_id, "user_id": user_id, "symbol": symbol}
                    for symbol in symbols
                ],
            )

    def load_retry_candidates(
        self,
        task_id: str,
        user_id: str,
        symbols: list[str] | None,
    ) -> tuple[CandidateInput, ...]:
        with self._engine.connect() as connection:
            rows = list(
                connection.execute(
                    text(
                        '''
                        SELECT symbol, "inputSnapshot"
                        FROM llm_stock_selection_results
                        WHERE "taskId" = :task_id AND "userId" = :user_id
                          AND "llmStatus" = 'FAILED'
                          AND "inputSnapshot" IS NOT NULL
                        ORDER BY "quantitativeRank" ASC, symbol ASC
                        '''
                    ),
                    {"task_id": task_id, "user_id": user_id},
                ).mappings()
            )
        selected = set(symbols) if symbols else None
        return tuple(
            candidate_input_from_payload(dict(row["inputSnapshot"]))
            for row in rows
            if selected is None or row["symbol"] in selected
        )

    def finalize_ranking(
        self,
        task_id: str,
        user_id: str,
        final_top_n: int,
    ) -> tuple[int, int, TokenUsage]:
        with self._engine.begin() as connection:
            rows = list(
                connection.execute(
                    text(
                        '''
                        SELECT id, symbol, "quantitativeRank",
                               CAST(judgment->>'selectionScore' AS INTEGER) AS score,
                               "promptTokens", "completionTokens", "totalTokens"
                        FROM llm_stock_selection_results
                        WHERE "taskId" = :task_id AND "userId" = :user_id
                          AND "llmStatus" = 'SUCCEEDED'
                        ORDER BY score DESC, "quantitativeRank" ASC, symbol ASC
                        '''
                    ),
                    {"task_id": task_id, "user_id": user_id},
                ).mappings()
            )
            failed_count = int(
                connection.execute(
                    text(
                        '''
                        SELECT COUNT(*)
                        FROM llm_stock_selection_results
                        WHERE "taskId" = :task_id AND "userId" = :user_id
                          AND "isLlmCandidate" = true AND "llmStatus" = 'FAILED'
                        '''
                    ),
                    {"task_id": task_id, "user_id": user_id},
                ).scalar_one()
            )
            usage_row = connection.execute(
                text(
                    '''
                    SELECT
                      COALESCE(SUM("promptTokens"), 0) AS "promptTokens",
                      COALESCE(SUM("completionTokens"), 0) AS "completionTokens",
                      COALESCE(SUM("totalTokens"), 0) AS "totalTokens"
                    FROM llm_stock_selection_results
                    WHERE "taskId" = :task_id AND "userId" = :user_id
                      AND "isLlmCandidate" = true
                    '''
                ),
                {"task_id": task_id, "user_id": user_id},
            ).mappings().one()
            connection.execute(
                text(
                    '''
                    UPDATE llm_stock_selection_results
                    SET selected = false, "finalRank" = NULL,
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE "taskId" = :task_id AND "userId" = :user_id
                    '''
                ),
                {"task_id": task_id, "user_id": user_id},
            )
            for rank, row in enumerate(rows[:final_top_n], start=1):
                connection.execute(
                    text(
                        '''
                        UPDATE llm_stock_selection_results
                        SET selected = true, "finalRank" = :rank,
                            "updatedAt" = CURRENT_TIMESTAMP
                        WHERE id = :id
                        '''
                    ),
                    {"rank": rank, "id": row["id"]},
                )

        usage = TokenUsage(
            prompt_tokens=int(usage_row["promptTokens"]),
            completion_tokens=int(usage_row["completionTokens"]),
            total_tokens=int(usage_row["totalTokens"]),
        )
        return len(rows), failed_count, usage

    def get_run_metrics(self, task_id: str, user_id: str) -> dict:
        with self._engine.connect() as connection:
            row = connection.execute(
                text(
                    '''
                    SELECT
                      MIN("dataDate") AS "dataDate",
                      COUNT(*) AS "universeCount",
                      COUNT(*) FILTER (WHERE "universeStatus" = 'ELIGIBLE') AS "eligibleCount",
                      COUNT(*) FILTER (WHERE "universeStatus" = 'EXCLUDED') AS "excludedCount",
                      COUNT(*) FILTER (WHERE "isLlmCandidate" = true) AS "candidateCount"
                    FROM llm_stock_selection_results
                    WHERE "taskId" = :task_id AND "userId" = :user_id
                    '''
                ),
                {"task_id": task_id, "user_id": user_id},
            ).mappings().one()
        universe_count = int(row["universeCount"])
        eligible_count = int(row["eligibleCount"])
        return {
            "dataDate": row["dataDate"],
            "universeCount": universe_count,
            "eligibleCount": eligible_count,
            "excludedCount": int(row["excludedCount"]),
            "candidateCount": int(row["candidateCount"]),
            "coverageRate": eligible_count / universe_count if universe_count else 0.0,
        }


def build_stock_selection_prompt(candidate: CandidateInput) -> str:
    """Build the fixed 20-trading-day structured judgment prompt."""
    return f"""你是一位审慎的A股量化研究员。请仅根据给定快照，评估该股票未来约20个交易日的研究吸引力。

评分标准：
- 0-39：风险或弱势明显
- 40-59：中性，缺乏清晰优势
- 60-79：具备可跟踪的积极信号
- 80-100：多类证据一致且风险可控

不得编造快照中不存在的数据，不得输出股票代码、最终排名或是否入选。只返回严格 JSON。

输入快照：
{json.dumps(candidate.to_payload(), ensure_ascii=False, separators=(",", ":"))}

输出结构：
{{
  "selectionScore": 0到100的整数,
  "confidence": 0到1的小数,
  "outlook": "BULLISH" 或 "NEUTRAL" 或 "BEARISH",
  "summary": "不超过150字的结论",
  "strengths": ["最多3项"],
  "risks": ["最多3项"],
  "keySignals": [
    {{"category":"PRICE|VOLUME|TECHNICAL|FACTOR","name":"信号","interpretation":"解释"}}
  ]
}}"""


class LlmCandidateExecutor:
    """Run bounded independent candidate calls and persist each attempt."""

    def __init__(
        self,
        *,
        repository: StockSelectionRepository,
        llm_client: LLMClient,
        max_workers: int,
    ) -> None:
        self._repository = repository
        self._llm_client = llm_client
        self._max_workers = max(1, max_workers)

    def execute(
        self,
        *,
        task_id: str,
        user_id: str,
        model: LlmModelConfig,
        candidates: tuple[CandidateInput, ...],
        is_cancelled: Callable[[], bool],
    ) -> bool:
        pending = iter(candidates)
        unsubmitted = list(candidates)
        futures: dict[Future[CandidateAttempt], CandidateInput] = {}

        with ThreadPoolExecutor(max_workers=self._max_workers) as executor:
            while len(futures) < self._max_workers and unsubmitted and not is_cancelled():
                candidate = next(pending)
                unsubmitted.pop(0)
                futures[
                    executor.submit(
                        self._call_candidate,
                        task_id,
                        user_id,
                        model,
                        candidate,
                    )
                ] = candidate

            while futures:
                done, _ = wait(futures, return_when=FIRST_COMPLETED)
                for future in done:
                    candidate = futures.pop(future)
                    attempt = future.result()
                    self._repository.finish_attempt(
                        task_id,
                        user_id,
                        attempt,
                        model,
                    )
                    if not is_cancelled() and unsubmitted:
                        next_candidate = next(pending)
                        unsubmitted.pop(0)
                        futures[
                            executor.submit(
                                self._call_candidate,
                                task_id,
                                user_id,
                                model,
                                next_candidate,
                            )
                        ] = next_candidate

        cancelled = is_cancelled()
        if cancelled:
            self._repository.mark_not_run_cancelled(
                task_id,
                user_id,
                [candidate.symbol for candidate in unsubmitted],
            )
        return cancelled

    def _call_candidate(
        self,
        task_id: str,
        user_id: str,
        model: LlmModelConfig,
        candidate: CandidateInput,
    ) -> CandidateAttempt:
        attempt_no = self._repository.begin_attempt(
            task_id,
            user_id,
            candidate,
            model,
        )
        usage: TokenUsage | None = None
        try:
            result = self._llm_client.chat(
                model,
                ChatRequest(
                    messages=(
                        {"role": "user", "content": build_stock_selection_prompt(candidate)},
                    ),
                    temperature=0.2,
                    max_tokens=1800,
                    json_mode=True,
                ),
            )
            usage = result.usage
            judgment = LlmStockJudgment.model_validate_json(result.content)
            return CandidateAttempt(
                candidate=candidate,
                attempt_no=attempt_no,
                judgment=judgment,
                usage=usage,
                error_code=None,
                error_message=None,
            )
        except ValidationError:
            return CandidateAttempt(
                candidate=candidate,
                attempt_no=attempt_no,
                judgment=None,
                usage=usage,
                error_code="LLM_RESPONSE_INVALID",
                error_message="模型返回的选股 JSON 不符合结构约束",
            )
        except LlmError as error:
            return CandidateAttempt(
                candidate=candidate,
                attempt_no=attempt_no,
                judgment=None,
                usage=None,
                error_code=error.code,
                error_message=str(error),
            )
        except Exception:
            return CandidateAttempt(
                candidate=candidate,
                attempt_no=attempt_no,
                judgment=None,
                usage=None,
                error_code="LLM_PROVIDER_UNAVAILABLE",
                error_message="模型调用失败",
            )


def run_llm_stock_selection(
    task_id: str,
    user_id: str,
    params: dict,
    *,
    repository: StockSelectionRepository | None = None,
    is_cancelled: Callable[[], bool] | None = None,
) -> LlmStockSelectionRunResult:
    """Build, execute, persist, and rank one LLM stock-selection task."""
    repository = repository or SqlStockSelectionRepository()
    redis_client = None
    if is_cancelled is None:
        redis_client = redis.Redis.from_url(settings.redis_url)

        def redis_cancelled() -> bool:
            return bool(redis_client.get(f"task_cancelled:{task_id}"))

        is_cancelled = redis_cancelled

    try:
        if is_cancelled():
            return LlmStockSelectionRunResult(
                status="CANCELLED",
                summary={"message": "任务在准备阶段被取消"},
            )

        retry_symbols = params.get("retrySymbols")
        snapshot: StockSelectionSnapshot | None = None
        if retry_symbols is not None:
            candidates = repository.load_retry_candidates(
                task_id,
                user_id,
                list(retry_symbols) or None,
            )
            if not candidates:
                raise ValueError("没有可重试的失败候选")
        else:
            factor_ids = list(dict.fromkeys(params.get("factorIds") or []))
            factors = [library.get(user_id, factor_id) for factor_id in factor_ids]
            if not factor_ids or any(
                factor is None or not factor.is_valid for factor in factors
            ):
                raise ValueError("任务包含不存在、无效或不属于当前用户的因子")

            lookback_days = int(params.get("lookbackDays", 250))
            market_data = load_market_data(lookback_days=lookback_days)
            loader = DataLoader()
            try:
                universe_symbols = loader.get_main_board_stocks()
            finally:
                loader.logout()

            try:
                snapshot = LlmStockSelectionSnapshotService().build(
                    factors=[factor for factor in factors if factor is not None],
                    market_data=market_data,
                    universe_symbols=universe_symbols,
                    watchlist_symbols=list(params.get("watchlistSymbols") or []),
                    candidate_count=int(params.get("candidateCount", 50)),
                    lookback_days=lookback_days,
                )
            except StockSelectionSnapshotError as error:
                if error.snapshot is not None:
                    repository.persist_snapshot(task_id, user_id, error.snapshot)
                raise
            repository.persist_snapshot(task_id, user_id, snapshot)
            candidates = snapshot.candidates

        model_id = str(params.get("llmModelId") or "")
        model = get_default_config_loader().get(user_id, model_id)
        cancelled = LlmCandidateExecutor(
            repository=repository,
            llm_client=get_default_llm_client(),
            max_workers=settings.llm_selection_concurrency,
        ).execute(
            task_id=task_id,
            user_id=user_id,
            model=model,
            candidates=candidates,
            is_cancelled=is_cancelled,
        )
        if cancelled:
            data_date = (
                snapshot.data_date.isoformat()
                if snapshot is not None
                else candidates[0].data_date.isoformat()
            )
            return LlmStockSelectionRunResult(
                status="CANCELLED",
                summary={
                    "dataDate": data_date,
                    "candidateCount": len(candidates),
                    "message": "用户取消了任务，未生成完整 Top N",
                },
            )

        final_top_n = int(params.get("finalTopN", 10))
        success_count, failed_count, usage = repository.finalize_ranking(
            task_id,
            user_id,
            final_top_n,
        )
        status: Literal["COMPLETED", "PARTIAL_SUCCESS", "FAILED"]
        if failed_count == 0:
            status = "COMPLETED"
        elif success_count >= final_top_n:
            status = "PARTIAL_SUCCESS"
        else:
            status = "FAILED"

        metrics = (
            {
                "dataDate": snapshot.data_date.isoformat(),
                "universeCount": len(snapshot.universe_symbols),
                "eligibleCount": len(snapshot.eligible_exposures),
                "excludedCount": len(snapshot.exclusions),
                "coverageRate": snapshot.coverage_rate,
                "candidateCount": len(snapshot.candidates),
            }
            if snapshot is not None
            else repository.get_run_metrics(task_id, user_id)
        )
        return LlmStockSelectionRunResult(
            status=status,
            summary={
                **metrics,
                "successCount": success_count,
                "failedCount": failed_count,
                "finalTopN": min(final_top_n, success_count),
                "promptTokens": usage.prompt_tokens,
                "completionTokens": usage.completion_tokens,
                "totalTokens": usage.total_tokens,
                "completedAt": datetime.now().isoformat(timespec="seconds"),
            },
        )
    finally:
        if redis_client is not None:
            redis_client.close()
