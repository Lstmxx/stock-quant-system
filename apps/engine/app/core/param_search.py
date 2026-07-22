"""
参数搜索
========
对表现好的因子，自动尝试不同窗口期，保留最优参数组合。

策略：
1. 识别因子中的窗口参数（如TS_MEAN(volume, 30)中的30）
2. 替换为候选窗口（5/10/15/20/30/60）
3. 评估所有变体，保留最优
"""
import re
from typing import Dict, List, Optional, Tuple

import pandas as pd

from .factor_calculator import calculate_factor
from .factor_evaluator import evaluate_factor, FactorMetrics
from .factor_library import library, FactorRecord
from .factor_parser import parser

# 候选窗口期
WINDOW_CANDIDATES = [5, 10, 15, 20, 30, 60]


class ParamSearcher:
    """参数搜索器"""
    
    def __init__(self, window_candidates: List[int] = None):
        self.window_candidates = window_candidates or WINDOW_CANDIDATES
    
    def search(
        self,
        expression: str,
        market_data: Dict[str, pd.DataFrame],
        name_prefix: str = ""
    ) -> List[Tuple[str, FactorMetrics]]:
        """
        对一个因子表达式进行参数搜索
        
        Args:
            expression: 因子表达式
            market_data: 市场数据
            name_prefix: 因子名前缀
            
        Returns:
            [(expression, metrics), ...] 按IC排序
        """
        # 1. 提取窗口参数
        windows = self._extract_windows(expression)
        if not windows:
            return []
        
        # 2. 生成变体
        variants = self._generate_variants(expression, windows)
        
        # 3. 评估每个变体
        results = []
        for variant_expr in variants:
            values, parsed, error = calculate_factor(variant_expr, market_data)
            if error or values is None:
                continue
            
            metrics = evaluate_factor(
                values, market_data,
                name=f"{name_prefix}_param",
                expression=variant_expr
            )
            
            if metrics.ic_abs_weighted > 0:  # 至少有IC值
                results.append((variant_expr, metrics))
        
        # 4. 按IC排序
        results.sort(key=lambda x: x[1].ic_abs_weighted, reverse=True)
        
        return results
    
    def _extract_windows(self, expression: str) -> List[int]:
        """提取表达式中的窗口参数"""
        # 匹配模式：函数名(变量, 数字) 如 TS_MEAN(volume, 30)
        pattern = r'\w+\([^,]+,\s*(\d+)\)'
        matches = re.findall(pattern, expression)
        return list(set(int(m) for m in matches))
    
    def _generate_variants(
        self,
        expression: str,
        original_windows: List[int]
    ) -> List[str]:
        """生成参数变体"""
        variants = set()
        
        for orig_win in original_windows:
            for new_win in self.window_candidates:
                if new_win == orig_win:
                    continue
                
                # 替换窗口参数
                # 需要精确替换，避免替换其他数字
                variant = self._replace_window(expression, orig_win, new_win)
                if variant and variant != expression:
                    variants.add(variant)
        
        return list(variants)
    
    def _replace_window(
        self,
        expression: str,
        old_window: int,
        new_window: int
    ) -> Optional[str]:
        """精确替换窗口参数"""
        # 匹配函数调用中的窗口参数
        # 如 TS_MEAN(volume, 30) → TS_MEAN(volume, 10)
        pattern = r'(\w+\([^,]+,\s*)' + str(old_window) + r'(\))'
        
        # 只替换第一个匹配
        result = re.sub(pattern, r'\g<1>' + str(new_window) + r'\2', expression, count=1)
        
        if result != expression:
            return result
        return None
    
    def optimize_factor(
        self,
        factor: FactorRecord,
        market_data: Dict[str, pd.DataFrame]
    ) -> Optional[FactorRecord]:
        """
        优化单个因子的参数
        
        Args:
            factor: 原始因子
            market_data: 市场数据
            
        Returns:
            优化后的因子（如果更好），否则None
        """
        print(f"  [参数搜索] {factor.name}: {factor.expression[:50]}...")
        
        results = self.search(
            factor.expression,
            market_data,
            name_prefix=factor.name
        )
        
        if not results:
            print("    无有效变体")
            return None
        
        # 找最佳变体
        best_expr, best_metrics = results[0]
        
        # 与原始比较
        if best_metrics.ic_abs_weighted <= factor.ic_abs_weighted:
            print(f"    原始更优 (IC={factor.ic_abs_weighted:.4f})")
            return None
        
        # 检查是否已存在
        if library.exists(best_expr):
            print("    变体已存在")
            return None
        
        # 保存优化后的因子
        parsed = parser.parse(best_expr)
        if not parsed.is_valid:
            return None
        
        new_record = library.add(
            name=f"{factor.name}_opt",
            expression=best_expr,
            metrics=best_metrics,
            variables=parsed.variables,
            operators=parsed.operators,
            nesting_depth=parsed.nesting_depth,
            hypothesis=f"参数优化自: {factor.expression}",
            generation=factor.generation + 1,
            parent_ids=[factor.id],
        )
        
        print(f"    ✓ 优化成功: IC {factor.ic_abs_weighted:.4f} → {best_metrics.ic_abs_weighted:.4f}")
        print(f"      新表达式: {best_expr}")
        
        return new_record
    
    def optimize_all(
        self,
        market_data: Dict[str, pd.DataFrame],
        min_ic: float = 0.05
    ) -> List[FactorRecord]:
        """
        优化所有表现好的因子
        
        Args:
            market_data: 市场数据
            min_ic: 最小IC阈值（只优化IC>此值的因子）
            
        Returns:
            优化后的因子列表
        """
        factors = library.get_valid_factors()
        good_factors = [f for f in factors if f.ic_abs_weighted >= min_ic]
        
        print(f"[参数搜索] 优化 {len(good_factors)} 个因子 (IC>={min_ic})")
        
        optimized = []
        for f in good_factors:
            result = self.optimize_factor(f, market_data)
            if result:
                optimized.append(result)
        
        print(f"[参数搜索] 优化了 {len(optimized)} 个因子")
        return optimized


# 全局实例
param_searcher = ParamSearcher()


if __name__ == "__main__":
    from .data_loader import load_market_data
    
    print("=" * 60)
    print("参数搜索测试")
    print("=" * 60)
    
    data = load_market_data(250)
    
    # 测试单个因子
    test_expr = "TS_MEAN(volume, 30) / TS_STD(close, 30)"
    print(f"\n测试: {test_expr}")
    
    results = param_searcher.search(test_expr, data, "test")
    print(f"找到 {len(results)} 个变体:")
    for expr, metrics in results[:5]:
        print(f"  IC={metrics.ic_abs_weighted:.4f}  {expr}")
