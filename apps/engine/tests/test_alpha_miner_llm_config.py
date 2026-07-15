import pytest

from app.core.alpha_miner import AlphaMiner
from app.core.llm_types import LlmConfigError


def test_alpha_miner_requires_an_explicit_model_without_runtime_fallback() -> None:
    with pytest.raises(LlmConfigError, match="模型"):
        AlphaMiner(task_id="task-1", user_id="user-1")
