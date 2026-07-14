"""User-scoped PostgreSQL factor library."""

from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from sqlalchemy import Engine, create_engine, text

from app.config import settings


@dataclass(frozen=True, slots=True)
class FactorRecord:
    """Persisted factor metadata used by mining, evolution, and selection."""

    id: str
    user_id: str
    name: str
    expression: str
    hypothesis: str | None
    research_direction: str | None
    ic_value: float | None
    icir: float | None
    monotonicity: float | None
    direction: int | None
    is_valid: bool
    generation: int


class FactorLibrary:
    """Persist and retrieve factors without crossing user boundaries."""

    def __init__(self, engine: Engine | None = None) -> None:
        self.engine = engine or create_engine(settings.database_url)

    @staticmethod
    def _to_record(row: Any) -> FactorRecord:
        values = row if isinstance(row, dict) else row._mapping
        return FactorRecord(
            id=str(values["id"]),
            user_id=str(values["userId"]),
            name=str(values["name"]),
            expression=str(values["expression"]),
            hypothesis=values["hypothesis"],
            research_direction=values["researchDirection"],
            ic_value=(
                float(values["icValue"]) if values["icValue"] is not None else None
            ),
            icir=float(values["icir"]) if values["icir"] is not None else None,
            monotonicity=(
                float(values["monotonicity"])
                if values["monotonicity"] is not None
                else None
            ),
            direction=(
                int(values["direction"])
                if values["direction"] is not None
                else None
            ),
            is_valid=bool(values["isValid"]),
            generation=int(values["generation"]),
        )

    @staticmethod
    def _select_columns() -> str:
        return '''
            id, "userId", name, expression, hypothesis, "researchDirection",
            "icValue", icir, monotonicity, direction, "isValid", generation
        '''

    def add(
        self,
        *,
        user_id: str,
        name: str,
        expression: str,
        metrics: Any,
        variables: list[str],
        operators: list[str],
        nesting_depth: int,
        hypothesis: str = "",
        research_direction: str | None = None,
        generation: int = 0,
        parent_ids: list[str] | None = None,
    ) -> FactorRecord:
        """Insert a valid factor once per user and return its persisted record."""

        del variables, operators, nesting_depth, parent_ids
        factor_id = str(uuid4())

        with self.engine.begin() as connection:
            connection.execute(
                text(
                    '''
                    INSERT INTO alpha_factors (
                        id, "userId", name, expression, hypothesis,
                        "researchDirection", "icValue", icir, monotonicity,
                        direction, "isValid", generation, "createdAt", "updatedAt"
                    ) VALUES (
                        :id, :user_id, :name, :expression, :hypothesis,
                        :research_direction, :ic_value, :icir, :monotonicity,
                        :direction, :is_valid, :generation,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT ("userId", expression) DO NOTHING
                    '''
                ),
                {
                    "id": factor_id,
                    "user_id": user_id,
                    "name": name,
                    "expression": expression.strip(),
                    "hypothesis": hypothesis or None,
                    "research_direction": research_direction,
                    "ic_value": float(metrics.ic_abs_weighted),
                    "icir": float(metrics.icir),
                    "monotonicity": float(metrics.monotonicity_score),
                    "direction": int(metrics.direction),
                    "is_valid": bool(metrics.is_valid),
                    "generation": generation,
                },
            )
            row = connection.execute(
                text(
                    f'''
                    SELECT {self._select_columns()}
                    FROM alpha_factors
                    WHERE "userId" = :user_id AND expression = :expression
                    '''
                ),
                {"user_id": user_id, "expression": expression.strip()},
            ).mappings().one()

        return self._to_record(dict(row))

    def get(self, user_id: str, factor_id: str) -> FactorRecord | None:
        with self.engine.connect() as connection:
            row = connection.execute(
                text(
                    f'''
                    SELECT {self._select_columns()}
                    FROM alpha_factors
                    WHERE id = :factor_id AND "userId" = :user_id
                    '''
                ),
                {"factor_id": factor_id, "user_id": user_id},
            ).mappings().one_or_none()
        return self._to_record(dict(row)) if row else None

    def list_all(self, user_id: str) -> list[FactorRecord]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                text(
                    f'''
                    SELECT {self._select_columns()}
                    FROM alpha_factors
                    WHERE "userId" = :user_id
                    ORDER BY "createdAt" ASC, id ASC
                    '''
                ),
                {"user_id": user_id},
            ).mappings()
            return [self._to_record(dict(row)) for row in rows]

    def list_valid(self, user_id: str) -> list[FactorRecord]:
        return [factor for factor in self.list_all(user_id) if factor.is_valid]

    def list_expressions(self, user_id: str) -> list[str]:
        return [factor.expression for factor in self.list_all(user_id)]

    def prune(self, user_id: str, **_: Any) -> dict[str, Any]:
        """Return a stable no-op result until pruning rules are implemented."""

        before = len(self.list_all(user_id))
        return {"before": before, "after": before, "removed": 0, "reasons": {}}

    @staticmethod
    def format_summary() -> str:
        return "因子库已持久化至 PostgreSQL，请在 Web 端查看。"


library = FactorLibrary()
