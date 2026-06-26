"""
因子计算引擎
============
将解析后的因子表达式应用到市场数据上，计算因子值。
包含：
- 安全的执行环境
- 因子值质量检查
- NaN处理
"""
import sys
import warnings
from io import StringIO
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd

from config import FactorCriteria
from factor_dsl import OPERATORS
from factor_parser import ParsedFactor, parser

# 类型别名
MarketData = Dict[str, pd.DataFrame]


class FactorCalculator:
    """因子计算引擎"""
    
    def __init__(self):
        self.nan_threshold = FactorCriteria.MAX_NAN_RATIO
        self.min_stocks = FactorCriteria.MIN_STOCKS
    
    def calculate(
        self,
        parsed_factor: ParsedFactor,
        market_data: MarketData
    ) -> Tuple[Optional[pd.DataFrame], Optional[str]]:
        """
        计算因子值
        
        Args:
            parsed_factor: 解析后的因子
            market_data: 市场数据字典
            
        Returns:
            (factor_values, error_message)
            factor_values: DataFrame（行=日期，列=股票代码）或 None
            error_message: 错误信息或 None
        """
        if not parsed_factor.is_valid:
            return None, f"因子表达式无效: {parsed_factor.error}"
        
        try:
            # 1. 构建执行环境
            scope = self._build_scope(market_data)
            
            # 2. 执行表达式
            factor_values = self._execute_expression(
                parsed_factor.expression, scope
            )
            
            if factor_values is None:
                return None, "表达式执行返回None"
            
            # 3. 类型检查
            if not isinstance(factor_values, pd.DataFrame):
                return None, f"返回类型错误: {type(factor_values)}，期望DataFrame"
            
            # 4. 形状检查
            if factor_values.empty:
                return None, "返回空DataFrame"
            
            # 5. NaN检查
            nan_ratio = factor_values.isna().sum().sum() / (factor_values.shape[0] * factor_values.shape[1])
            if nan_ratio > 0.99:
                return None, f"NaN比例过高: {nan_ratio:.2%}"
            
            # 6. 全NaN列检查
            all_nan_cols = factor_values.columns[factor_values.isna().all()]
            if len(all_nan_cols) > 0:
                # 移除全NaN列
                factor_values = factor_values.drop(columns=all_nan_cols)
                if factor_values.empty:
                    return None, "所有列都是全NaN"
            
            # 7. 常量列检查（方差为0的列无意义）
            constant_cols = []
            for col in factor_values.columns:
                non_nan = factor_values[col].dropna()
                if len(non_nan) > 0 and non_nan.std() == 0:
                    constant_cols.append(col)
            if constant_cols:
                factor_values = factor_values.drop(columns=constant_cols)
            
            # 8. 极端值处理
            factor_values = self._winsorize(factor_values)
            
            return factor_values, None
            
        except Exception as e:
            return None, f"计算异常: {type(e).__name__}: {e}"
    
    def _build_scope(self, market_data: MarketData) -> dict:
        """构建执行作用域"""
        scope = {}
        
        # 添加市场数据变量
        variable_map = {
            'open': 'open',
            'high': 'high',
            'low': 'low',
            'close': 'close',
            'volume': 'volume',
            'amount': 'amount',
            'turn': 'turn',
            'pctChg': 'pctChg',
        }
        
        for var_name, data_key in variable_map.items():
            if data_key in market_data:
                scope[var_name] = market_data[data_key]
        
        # 添加所有DSL算子
        for op_name, op_info in OPERATORS.items():
            scope[op_name] = op_info['func']
        
        # 添加numpy
        scope['np'] = np
        scope['nan'] = np.nan
        
        return scope
    
    def _execute_expression(self, expression: str, scope: dict) -> Optional[pd.DataFrame]:
        """
        执行因子表达式
        
        使用exec比eval更安全，但仍需注意：
        - 禁止import
        - 禁止访问__builtins__
        """
        # 安全检查
        forbidden = ['import', 'exec', 'eval', 'open', 'file', 'os.', 'sys.', 'subprocess']
        for word in forbidden:
            if word in expression:
                raise ValueError(f"表达式包含禁止的关键词: {word}")
        
        # 抑制输出
        old_stdout = sys.stdout
        sys.stdout = StringIO()
        
        try:
            # 使用eval执行表达式
            result = eval(expression, {"__builtins__": {}}, scope)
            return result
        finally:
            sys.stdout = old_stdout
    
    def _winsorize(self, df: pd.DataFrame, n_std: float = 5.0) -> pd.DataFrame:
        """
        极端值处理（缩尾）
        将超过 n_std 个标准差的值截断
        """
        mean = df.mean()
        std = df.std()
        lower = mean - n_std * std
        upper = mean + n_std * std
        return df.clip(lower=lower, upper=upper, axis=1)
    
    def validate_output(self, factor_values: pd.DataFrame) -> Tuple[bool, str]:
        """
        验证因子输出质量
        
        Returns:
            (is_valid, message)
        """
        if factor_values is None or factor_values.empty:
            return False, "因子值为空"
        
        # 检查股票数量
        n_stocks = len(factor_values.columns)
        if n_stocks < self.min_stocks:
            return False, f"有效股票数 {n_stocks} < {self.min_stocks}"
        
        # 检查日期数量
        n_days = len(factor_values)
        if n_days < 20:
            return False, f"有效日期数 {n_days} < 20"
        
        # 检查NaN比例
        nan_ratio = factor_values.isna().sum().sum() / (factor_values.shape[0] * factor_values.shape[1])
        if nan_ratio > self.nan_threshold:
            return False, f"NaN比例 {nan_ratio:.2%} > {self.nan_threshold:.2%}"
        
        # 检查全NaN列
        all_nan_cols = factor_values.columns[factor_values.isna().all()]
        if len(all_nan_cols) > 0:
            return False, f"存在 {len(all_nan_cols)} 个全NaN列"
        
        return True, "通过"


# 全局实例
calculator = FactorCalculator()


def calculate_factor(
    expression: str,
    market_data: MarketData,
    name: str = ""
) -> Tuple[Optional[pd.DataFrame], Optional[ParsedFactor], Optional[str]]:
    """
    计算因子的便捷函数
    
    Args:
        expression: 因子表达式
        market_data: 市场数据
        name: 因子名称
        
    Returns:
        (factor_values, parsed_factor, error)
    """
    # 1. 解析表达式
    parsed = parser.parse(expression, name)
    if not parsed.is_valid:
        return None, parsed, parsed.error
    
    # 2. 计算因子值
    values, error = calculator.calculate(parsed, market_data)
    
    return values, parsed, error


if __name__ == "__main__":
    from data_loader import load_market_data
    
    print("=" * 60)
    print("因子计算测试")
    print("=" * 60)
    
    # 加载数据
    data = load_market_data(lookback_days=60)
    
    # 测试表达式
    test_expressions = [
        ("TS_CORR(close, volume, 20)", "量价相关"),
        ("RANK(TS_MEAN(volume, 5))", "5日均量排名"),
        ("DELTA(close, 5) / DELAY(close, 5)", "5日动量"),
        ("EMA(close, 12) - EMA(close, 26)", "MACD原始"),
        ("TS_STD(close, 10) / TS_MEAN(close, 10)", "波动率"),
    ]
    
    for expr, name in test_expressions:
        print(f"\n--- {name}: {expr} ---")
        values, parsed, error = calculate_factor(expr, data, name)
        
        if error:
            print(f"  错误: {error}")
        else:
            print(f"  形状: {values.shape}")
            print(f"  日期: {values.index[0]} ~ {values.index[-1]}")
            print(f"  股票数: {len(values.columns)}")
            print(f"  NaN比例: {values.isna().sum().sum() / (values.shape[0] * values.shape[1]):.2%}")
            print(f"  均值: {values.mean().mean():.4f}")
            print(f"  标准差: {values.std().mean():.4f}")
