import pytest
from unittest.mock import patch, MagicMock

from app.core.alpha_miner import AlphaMiner

@patch("app.core.alpha_miner.llm")
@patch("app.core.alpha_miner.parser")
@patch("app.core.alpha_miner.calculate_factor")
def test_alpha_miner_debug_infinite_loop_breaker(mock_calc, mock_parser, mock_llm):
    """测试因子计算中的Debug死循环断路器"""
    
    # 初始化
    miner = AlphaMiner(task_id="test_task", user_id="test_user")
    
    # 模拟第一次执行时报错
    mock_parser.parse.return_value = MagicMock(is_valid=False, error="SyntaxError: invalid syntax")
    
    # 模拟 LLM 修复返回的内容
    # 假设LLM一直返回相同的代码（与原来相同）
    mock_llm.debug_factor_code.return_value = ("BAD_EXPR(close)", "I fixed it")
    
    # 运行函数
    values, metrics, error = miner._calculate_with_debug("BAD_EXPR(close)", max_attempts=3)
    
    # 验证返回值
    assert values is None
    assert metrics is None
    assert error == "SyntaxError: invalid syntax"
    
    # 验证LLM被调用的次数为1次（因为断路器生效，阻止了后续重试）
    assert mock_llm.debug_factor_code.call_count == 1
    
    # --- 测试A -> B -> A死循环 ---
    mock_llm.debug_factor_code.reset_mock()
    
    # LLM 依次返回: "BAD_EXPR_B", 然后返回 "BAD_EXPR_A" (历史已经尝试过的)
    mock_llm.debug_factor_code.side_effect = [
        ("BAD_EXPR_B", "Try B"),
        ("BAD_EXPR_A", "Try A again")
    ]
    
    # parser 每次都报错
    mock_parser.parse.side_effect = [
        MagicMock(is_valid=False, error="Error A"),
        MagicMock(is_valid=False, error="Error B"),
        MagicMock(is_valid=False, error="Error C")
    ]
    
    values, metrics, error = miner._calculate_with_debug("BAD_EXPR_A", max_attempts=5)
    
    # 断路器应该在第二次调用LLM后触发，因为 "BAD_EXPR_A" 已经在历史记录中（最初就是A）
    assert values is None
    assert error == "Error B"
    assert mock_llm.debug_factor_code.call_count == 2
