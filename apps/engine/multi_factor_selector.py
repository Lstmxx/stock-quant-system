"""
多因子合成选股
==============
从因子库加载有效因子，IC加权合成综合评分，输出每日Top N选股。
"""
import sys
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from data_loader import load_market_data
from factor_calculator import calculate_factor
from factor_library import library, FactorRecord


class MultiFactorSelector:
    """多因子合成选股器"""
    
    def __init__(self, weight_method: str = "ic_abs"):
        """
        Args:
            weight_method: 权重方法
                - "equal": 等权
                - "ic_abs": IC绝对值加权（默认）
                - "icir": ICIR绝对值加权
        """
        self.weight_method = weight_method
    
    def run(
        self,
        market_data: Dict[str, pd.DataFrame],
        top_n: int = 20,
        factor_ids: Optional[List[str]] = None
    ) -> pd.DataFrame:
        """
        执行多因子选股
        
        Args:
            market_data: 市场数据
            top_n: 选股数量
            factor_ids: 指定因子ID列表，None则使用全部有效因子
            
        Returns:
            DataFrame with columns: [code, score, rank, factors...]
        """
        # 1. 加载因子
        if factor_ids:
            factors = [library.get(fid) for fid in factor_ids]
            factors = [f for f in factors if f is not None]
        else:
            factors = library.get_valid_factors()
        
        if not factors:
            raise ValueError("因子库为空，请先运行因子挖掘")
        
        print(f"[选股] 加载 {len(factors)} 个因子")
        
        # 2. 计算各因子值
        factor_values_dict = {}
        factor_weights = {}
        
        for f in factors:
            print(f"  计算: {f.name} ({f.expression[:50]}...)")
            values, _, error = calculate_factor(f.expression, market_data)
            
            if error or values is None:
                print(f"    跳过: {error}")
                continue
            
            # 只取最后一个交易日的截面数据
            latest = values.iloc[-1].dropna()
            if len(latest) < 100:
                print(f"    跳过: 有效股票数 {len(latest)} < 100")
                continue
            
            factor_values_dict[f.id] = latest
            
            # 计算权重
            if self.weight_method == "equal":
                factor_weights[f.id] = 1.0
            elif self.weight_method == "ic_abs":
                factor_weights[f.id] = f.ic_abs_weighted
            elif self.weight_method == "icir":
                factor_weights[f.id] = abs(f.icir)
            
            print(f"    ✓ 有效: {len(latest)}只, 权重={factor_weights[f.id]:.4f}")
        
        if not factor_values_dict:
            raise ValueError("没有有效的因子值")
        
        # 3. 截面标准化（每个因子独立z-score）
        normalized = {}
        for fid, values in factor_values_dict.items():
            zscore = (values - values.mean()) / values.std()
            # 根据因子方向调整（负向因子取反）
            factor_record = library.get(fid)
            if factor_record and factor_record.direction == -1:
                zscore = -zscore
            normalized[fid] = zscore
        
        # 4. IC加权合成
        total_weight = sum(factor_weights.values())
        composite_score = pd.Series(0.0, index=normalized[list(normalized.keys())[0]].index)
        
        for fid, zscore in normalized.items():
            weight = factor_weights[fid] / total_weight
            composite_score += zscore * weight
        
        # 5. 排名选股
        composite_score = composite_score.dropna().sort_values(ascending=False)
        
        result = pd.DataFrame({
            'code': composite_score.index,
            'score': composite_score.values,
            'rank': range(1, len(composite_score) + 1)
        })
        
        # 添加各因子的原始值
        for fid, values in factor_values_dict.items():
            factor_record = library.get(fid)
            col_name = factor_record.name if factor_record else fid[:8]
            result[col_name] = result['code'].map(values).values
        
        return result.head(top_n)
    
    def format_report(self, result: pd.DataFrame, date: str = "") -> str:
        """格式化选股报告"""
        lines = [
            "=" * 50,
            f"多因子选股报告 {date}",
            "=" * 50,
            f"权重方法: {self.weight_method}",
            f"选股数量: {len(result)}",
            "",
            f"{'排名':<4} {'代码':<12} {'综合得分':<10}",
            "-" * 30,
        ]
        
        for _, row in result.iterrows():
            lines.append(f"{int(row['rank']):<4} {row['code']:<12} {row['score']:.4f}")
        
        lines.extend([
            "",
            "=" * 50,
            "注: 综合得分 = 各因子z-score的IC加权平均",
            "    正向因子得分越高越好，负向因子已取反",
        ])
        
        return "\n".join(lines)


def select_stocks(
    top_n: int = 20,
    weight_method: str = "ic_abs",
    lookback_days: int = 250
) -> Tuple[pd.DataFrame, str]:
    """
    执行选股的便捷函数
    
    Returns:
        (result_df, report_text)
    """
    # 加载数据
    print("[选股] 加载市场数据...")
    data = load_market_data(lookback_days)
    
    # 执行选股
    selector = MultiFactorSelector(weight_method=weight_method)
    result = selector.run(data, top_n=top_n)
    
    # 生成报告
    date = data['close'].index[-1].strftime('%Y-%m-%d')
    report = selector.format_report(result, date)
    
    return result, report


if __name__ == "__main__":
    result, report = select_stocks(top_n=20, weight_method="ic_abs")
    print(report)
