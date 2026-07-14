from app.core.evolution import EvolutionStrategy
from app.core.factor_library import FactorRecord


def factor(name: str, expression: str, ic_value: float) -> FactorRecord:
    return FactorRecord(
        id=f"00000000-0000-0000-0000-00000000000{len(name)}",
        user_id="user-a",
        name=name,
        expression=expression,
        hypothesis=None,
        research_direction="动量反转",
        ic_value=ic_value,
        icir=1.0,
        monotonicity=0.7,
        direction=1,
        is_valid=True,
        generation=1,
    )


def test_evolution_keeps_the_highest_quality_factor_as_elite() -> None:
    strategy = EvolutionStrategy()
    population = [
        factor("Low", "DELTA(close, 5)", 0.03),
        factor("High", "DELTA(close, 20)", 0.09),
    ]

    children = strategy.evolve(population, n_children=1)

    assert children == ["DELTA(close, 20)"]
