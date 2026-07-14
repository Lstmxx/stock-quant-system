from types import SimpleNamespace
from uuid import UUID

from sqlalchemy import create_engine, text

from app.core.factor_library import FactorLibrary, FactorRecord


def create_test_library() -> FactorLibrary:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(
            text(
                '''
                CREATE TABLE alpha_factors (
                    id TEXT PRIMARY KEY,
                    "userId" TEXT NOT NULL,
                    name TEXT NOT NULL,
                    expression TEXT NOT NULL,
                    hypothesis TEXT,
                    "researchDirection" TEXT,
                    "icValue" REAL,
                    icir REAL,
                    monotonicity REAL,
                    direction INTEGER,
                    "isValid" BOOLEAN NOT NULL,
                    generation INTEGER NOT NULL,
                    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE ("userId", expression)
                )
                '''
            )
        )
    return FactorLibrary(engine=engine)


def valid_metrics():
    return SimpleNamespace(
        ic_abs_weighted=0.08,
        icir=1.4,
        monotonicity_score=0.75,
        direction=1,
        is_valid=True,
    )


def test_same_expression_is_isolated_per_user() -> None:
    library = create_test_library()

    first = library.add(
        user_id="user-a",
        name="Momentum A",
        expression="DELTA(close, 20)",
        metrics=valid_metrics(),
        variables=["close"],
        operators=["DELTA"],
        nesting_depth=1,
        research_direction="动量反转",
    )
    second = library.add(
        user_id="user-b",
        name="Momentum B",
        expression="DELTA(close, 20)",
        metrics=valid_metrics(),
        variables=["close"],
        operators=["DELTA"],
        nesting_depth=1,
        research_direction="动量反转",
    )

    assert isinstance(first, FactorRecord)
    assert isinstance(second, FactorRecord)
    assert UUID(first.id)
    assert UUID(second.id)
    assert first.id != second.id
    assert [factor.name for factor in library.list_all("user-a")] == ["Momentum A"]
    assert [factor.name for factor in library.list_all("user-b")] == ["Momentum B"]
    assert library.list_expressions("user-a") == ["DELTA(close, 20)"]
