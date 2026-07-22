"""
因子表达式解析器
================
将DSL表达式字符串解析为可执行代码，包含：
- AST语法检查
- 嵌套深度检查（最大3层）
- 变量提取
- 安全性验证
"""
import ast
from typing import List, Optional, Tuple
from dataclasses import dataclass

from .config import FactorCriteria
from .factor_dsl import OPERATORS


@dataclass
class ParsedFactor:
    """解析后的因子"""
    name: str
    expression: str
    variables: List[str]        # 使用的变量（如 close, volume）
    operators: List[str]        # 使用的算子
    nesting_depth: int          # 嵌套深度
    is_valid: bool              # 是否有效
    error: Optional[str] = None # 错误信息


# 允许的变量名
ALLOWED_VARIABLES = {
    "open", "high", "low", "close", "volume", "amount", "turn",
    "pctChg",  # 涨跌幅
}

# 允许的函数名（从DSL库）
ALLOWED_FUNCTIONS = set(OPERATORS.keys())

# 允许的常量
ALLOWED_CONSTANTS = {"True", "False", "None", "np", "nan"}


class FactorParser:
    """因子表达式解析器"""
    
    def __init__(self):
        self.max_depth = FactorCriteria.MAX_NESTING_DEPTH
        self.max_vars = FactorCriteria.MAX_VARIABLES
    
    def parse(self, expression: str, name: str = "") -> ParsedFactor:
        """
        解析因子表达式
        
        Args:
            expression: 因子表达式字符串，如 "TS_CORR(close, volume, 20)"
            name: 因子名称
            
        Returns:
            ParsedFactor 对象
        """
        result = ParsedFactor(
            name=name,
            expression=expression,
            variables=[],
            operators=[],
            nesting_depth=0,
            is_valid=False,
            error=None
        )
        
        try:
            # 1. 预处理
            expr = self._preprocess(expression)
            
            # 2. 语法检查（用Python AST）
            tree = ast.parse(expr, mode='eval')
            
            # 3. 提取变量和函数
            variables, operators = self._extract_symbols(tree)
            
            # 4. 变量检查
            invalid_vars = variables - ALLOWED_VARIABLES
            if invalid_vars:
                result.error = f"不允许的变量: {invalid_vars}，允许的变量: {ALLOWED_VARIABLES}"
                return result
            
            # 5. 函数检查
            invalid_funcs = operators - ALLOWED_FUNCTIONS
            if invalid_funcs:
                result.error = f"不允许的函数: {invalid_funcs}"
                return result
            
            # 6. 嵌套深度检查
            depth = self._calc_nesting_depth(tree)
            if depth > self.max_depth:
                result.error = f"嵌套深度 {depth} 超过限制 {self.max_depth}"
                return result
            
            # 7. 变量数量检查
            if len(variables) > self.max_vars:
                result.error = f"变量数量 {len(variables)} 超过限制 {self.max_vars}"
                return result
            
            # 8. 基本合理性检查
            sanity_error = self._sanity_check(expr, variables, operators)
            if sanity_error:
                result.error = sanity_error
                return result
            
            # 全部通过
            result.variables = sorted(list(variables))
            result.operators = sorted(list(operators))
            result.nesting_depth = depth
            result.is_valid = True
            
        except SyntaxError as e:
            result.error = f"语法错误: {e}"
        except Exception as e:
            result.error = f"解析错误: {e}"
        
        return result
    
    def _preprocess(self, expr: str) -> str:
        """预处理表达式"""
        # 去除首尾空白
        expr = expr.strip()
        # 去除可能的引号包裹
        if (expr.startswith('"') and expr.endswith('"')) or \
           (expr.startswith("'") and expr.endswith("'")):
            expr = expr[1:-1]
        return expr
    
    def _extract_symbols(self, tree: ast.AST) -> Tuple[set, set]:
        """提取变量名和函数名"""
        variables = set()
        operators = set()
        
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                # 检查是否是函数调用的名称
                if isinstance(getattr(node, '_parent', None), ast.Call):
                    operators.add(node.id)
                else:
                    # 可能是变量或常量
                    if node.id not in ALLOWED_CONSTANTS and node.id not in ALLOWED_FUNCTIONS:
                        variables.add(node.id)
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                operators.add(node.func.id)
        
        return variables, operators
    
    def _calc_nesting_depth(self, tree: ast.AST) -> int:
        """计算最大嵌套深度"""
        max_depth = 0
        
        def _walk(node, depth):
            nonlocal max_depth
            max_depth = max(max_depth, depth)
            
            if isinstance(node, ast.Call):
                for arg in node.args:
                    if isinstance(arg, ast.Call):
                        _walk(arg, depth + 1)
                    elif isinstance(arg, ast.BinOp):
                        _walk(arg, depth + 1)
            elif isinstance(node, ast.BinOp):
                _walk(node.left, depth)
                _walk(node.right, depth)
        
        # 从根节点开始
        if isinstance(tree, ast.Expression) and isinstance(tree.body, ast.Call):
            _walk(tree.body, 1)
        elif isinstance(tree, ast.Expression) and isinstance(tree.body, ast.BinOp):
            _walk(tree.body, 1)
        
        return max_depth
    
    def _sanity_check(self, expr: str, variables: set, operators: set) -> Optional[str]:
        """基本合理性检查"""
        # 检查是否有变量（纯常量表达式无意义）
        if not variables and not operators:
            return "表达式没有使用任何变量或算子"
        
        # 检查量价因子必须涉及量或价
        has_price = bool(variables & {"open", "high", "low", "close", "pctChg"})
        has_volume = bool(variables & {"volume", "amount", "turn"})
        has_operator = bool(operators)
        
        if not has_price and not has_volume and has_operator:
            return "因子必须涉及价格或成交量变量"
        
        return None
    
    def validate_expression(self, expression: str) -> Tuple[bool, str]:
        """
        快速验证表达式是否有效
        
        Returns:
            (is_valid, error_message)
        """
        result = self.parse(expression)
        return result.is_valid, result.error or ""
    
    def to_executable(self, expression: str) -> str:
        """
        将表达式转换为可执行的Python代码
        
        输入: "TS_CORR(close, volume, 20)"
        输出: "TS_CORR(close, volume, 20)"（直接可执行，因为DSL函数已在scope中）
        """
        result = self.parse(expression)
        if not result.is_valid:
            raise ValueError(f"无效表达式: {result.error}")
        return expression


# 全局解析器实例
parser = FactorParser()


def validate_factor_expression(expression: str) -> Tuple[bool, str]:
    """验证因子表达式的便捷函数"""
    return parser.validate_expression(expression)


def parse_factor_expression(expression: str, name: str = "") -> ParsedFactor:
    """解析因子表达式的便捷函数"""
    return parser.parse(expression, name)


if __name__ == "__main__":
    # 测试用例
    test_cases = [
        # 有效表达式
        ("TS_CORR(close, volume, 20)", True),
        ("RANK(TS_MEAN(volume, 5))", True),
        ("DELTA(close, 5) / close", True),
        ("TS_STD(close, 10) / TS_MEAN(close, 10)", True),
        ("EMA(close, 12) - EMA(close, 26)", True),
        ("RANK(TS_CORR(close, volume, 20))", True),
        # 嵌套超过3层
        ("TS_CORR(TS_MEAN(TS_STD(close, 5), 3), volume, 20)", False),
        # 不允许的变量
        ("pe_ttm * 0.5", False),
        # 无意义表达式
        ("1 + 2", False),
    ]
    
    print("=" * 60)
    print("因子表达式解析器测试")
    print("=" * 60)
    
    for expr, expected_valid in test_cases:
        result = parser.parse(expr)
        status = "✓" if result.is_valid == expected_valid else "✗"
        print(f"\n{status} 表达式: {expr}")
        print(f"  有效: {result.is_valid}")
        if result.variables:
            print(f"  变量: {result.variables}")
        if result.operators:
            print(f"  算子: {result.operators}")
        print(f"  嵌套深度: {result.nesting_depth}")
        if result.error:
            print(f"  错误: {result.error}")
