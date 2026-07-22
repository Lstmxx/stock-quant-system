"""
因子评估模块
============
评估因子质量，核心指标：
- IC (Information Coefficient): 因子值与下期收益的相关系数
- ICIR (IC Information Ratio): IC的均值/标准差
- 分组收益: 按因子值分5组，看多空收益和单调性
- 换手率: 因子排名的日均变化
- IC衰减: IC在不同持有期的变化

评估标准（来自config.py）：
- IC加权平均绝对值 > 0.02
- IC方向明确（>0占比>45% 或 <0占比>45%）
- 分组收益单调
"""
import warnings
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd
from scipy import stats

from .config import FactorCriteria

warnings.filterwarnings("ignore")


@dataclass
class FactorMetrics:
    """因子评估指标"""
    # 基本信息
    name: str = ""
    expression: str = ""
    
    # IC指标
    ic_mean: float = 0.0              # IC均值
    ic_std: float = 0.0               # IC标准差
    icir: float = 0.0                 # ICIR = IC均值 / IC标准差
    ic_positive_ratio: float = 0.0    # IC > 0 的占比
    ic_negative_ratio: float = 0.0    # IC < 0 的占比
    ic_abs_weighted: float = 0.0      # IC绝对值加权平均
    ic_series: Optional[pd.Series] = field(default=None, repr=False)
    
    # 分组收益
    group_returns: Optional[pd.DataFrame] = field(default=None, repr=False)  # 5组收益
    long_short_return: float = 0.0    # 多空年化收益
    monotonicity_score: float = 0.0   # 单调性得分 (0~1)
    
    # 换手率
    turnover_rate: float = 0.0        # 因子排名日均换手率
    
    # 数据质量
    valid_days: int = 0               # 有效评估天数
    valid_stocks: int = 0             # 平均每日有效股票数
    nan_ratio: float = 0.0            # NaN比例
    
    # 评估结果
    is_valid: bool = False            # 是否通过筛选
    direction: int = 0                # 因子方向: 1=正向, -1=负向, 0=不明确
    rejection_reason: str = ""        # 拒绝原因


class FactorEvaluator:
    """因子评估器"""
    
    def __init__(self, n_groups: int = 5):
        self.n_groups = n_groups
        self.criteria = FactorCriteria()
    
    def evaluate(
        self,
        factor_values: pd.DataFrame,
        forward_returns: pd.DataFrame,
        name: str = "",
        expression: str = ""
    ) -> FactorMetrics:
        """
        评估因子质量
        
        Args:
            factor_values: 因子值 DataFrame (行=日期, 列=股票代码)
            forward_returns: 下期收益率 DataFrame (同形)
            name: 因子名称
            expression: 因子表达式
            
        Returns:
            FactorMetrics 对象
        """
        metrics = FactorMetrics(name=name, expression=expression)
        
        try:
            # 1. 数据对齐
            common_dates = factor_values.index.intersection(forward_returns.index)
            common_stocks = factor_values.columns.intersection(forward_returns.columns)
            
            if len(common_dates) < 20 or len(common_stocks) < self.criteria.MIN_STOCKS:
                metrics.rejection_reason = f"数据不足: {len(common_dates)}天, {len(common_stocks)}只股票"
                return metrics
            
            fv = factor_values.loc[common_dates, common_stocks]
            fr = forward_returns.loc[common_dates, common_stocks]
            
            # 2. 计算IC序列
            ic_series = self._calc_ic_series(fv, fr)
            
            if ic_series.empty or ic_series.isna().all():
                metrics.rejection_reason = "IC计算全部为NaN"
                return metrics
            
            # 3. IC指标
            metrics.ic_series = ic_series
            metrics.ic_mean = ic_series.mean()
            metrics.ic_std = ic_series.std()
            metrics.icir = metrics.ic_mean / metrics.ic_std if metrics.ic_std > 0 else 0
            metrics.ic_positive_ratio = (ic_series > 0).mean()
            metrics.ic_negative_ratio = (ic_series < 0).mean()
            
            # IC绝对值加权平均（用成交额或波动率加权更合理，这里简化用等权）
            metrics.ic_abs_weighted = ic_series.abs().mean()
            
            # 4. 分组评估
            group_returns, long_short, monotonicity = self._calc_group_metrics(fv, fr)
            metrics.group_returns = group_returns
            metrics.long_short_return = long_short
            metrics.monotonicity_score = monotonicity
            
            # 5. 换手率
            metrics.turnover_rate = self._calc_turnover(fv)
            
            # 6. 数据质量
            metrics.valid_days = len(common_dates)
            metrics.valid_stocks = len(common_stocks)
            metrics.nan_ratio = fv.isna().sum().sum() / (fv.shape[0] * fv.shape[1])
            
            # 7. 综合判断
            metrics.is_valid, metrics.direction, metrics.rejection_reason = \
                self._judge(metrics)
            
        except Exception as e:
            metrics.rejection_reason = f"评估异常: {type(e).__name__}: {e}"
        
        return metrics
    
    def _calc_ic_series(
        self,
        factor_values: pd.DataFrame,
        forward_returns: pd.DataFrame
    ) -> pd.Series:
        """
        计算每日IC（Spearman秩相关）
        """
        ic_list = []
        
        for date in factor_values.index:
            fv_row = factor_values.loc[date].dropna()
            fr_row = forward_returns.loc[date].dropna()
            
            # 取交集
            common = fv_row.index.intersection(fr_row.index)
            if len(common) < 30:
                continue
            
            fv_common = fv_row[common]
            fr_common = fr_row[common]
            
            # Spearman秩相关
            corr, _ = stats.spearmanr(fv_common, fr_common)
            ic_list.append((date, corr))
        
        if not ic_list:
            return pd.Series(dtype=float)
        
        return pd.Series(dict(ic_list))
    
    def _calc_group_metrics(
        self,
        factor_values: pd.DataFrame,
        forward_returns: pd.DataFrame
    ) -> Tuple[pd.DataFrame, float, float]:
        """
        计算分组收益和单调性
        
        Returns:
            (group_returns_df, long_short_annual_return, monotonicity_score)
        """
        n_groups = self.n_groups
        group_returns_list = []
        
        for date in factor_values.index:
            fv_row = factor_values.loc[date].dropna()
            fr_row = forward_returns.loc[date].dropna()
            
            common = fv_row.index.intersection(fr_row.index)
            if len(common) < n_groups * 10:  # 每组至少10只
                continue
            
            fv_common = fv_row[common]
            fr_common = fr_row[common]
            
            # 按因子值分组
            try:
                groups = pd.qcut(fv_common, n_groups, labels=False, duplicates='drop')
            except (ValueError, TypeError):
                continue
            
            # 计算每组平均收益
            group_ret = fr_common.groupby(groups).mean()
            
            if len(group_ret) == n_groups:
                group_returns_list.append(group_ret)
        
        if not group_returns_list:
            return pd.DataFrame(), 0.0, 0.0
        
        # 汇总
        group_returns_df = pd.DataFrame(group_returns_list)
        avg_group_returns = group_returns_df.mean()
        
        # 多空收益（最高组 - 最低组）
        long_short = avg_group_returns.iloc[-1] - avg_group_returns.iloc[0]
        
        # 年化（假设每日都有信号）
        long_short_annual = long_short * 252  # 简化年化
        
        # 单调性检查
        monotonicity = self._calc_monotonicity(avg_group_returns)
        
        return group_returns_df, long_short_annual, monotonicity
    
    def _calc_monotonicity(self, group_returns: pd.Series) -> float:
        """
        计算单调性得分
        
        使用Spearman相关系数衡量分组收益与组号的相关性。
        完美单调递增=1.0，完美单调递减=-1.0，无序=0
        
        返回绝对值，表示单调性强度（不区分方向）
        """
        if len(group_returns) < 3:
            return 0.0
        
        group_ids = np.arange(len(group_returns))
        corr, _ = stats.spearmanr(group_ids, group_returns.values)
        
        return abs(corr)
    
    def _calc_turnover(self, factor_values: pd.DataFrame) -> float:
        """
        计算因子排名的换手率
        
        每天对股票按因子值排名，计算相邻两天排名的变化比例
        """
        # 截面排名
        ranks = factor_values.rank(axis=1, pct=True)
        
        # 计算相邻两天排名差异
        rank_diff = ranks.diff().abs()
        
        # 平均换手率（排名变化>20%视为换手）
        turnover = (rank_diff > 0.2).mean().mean()
        
        return turnover
    
    def _judge(self, m: FactorMetrics) -> Tuple[bool, int, str]:
        """
        综合判断因子是否有效
        
        Returns:
            (is_valid, direction, rejection_reason)
            direction: 1=正向, -1=负向, 0=不明确
        """
        reasons = []
        
        # 1. IC绝对值检查
        if m.ic_abs_weighted < self.criteria.IC_ABS_THRESHOLD:
            reasons.append(f"IC绝对值 {m.ic_abs_weighted:.4f} < {self.criteria.IC_ABS_THRESHOLD}")
        
        # 2. IC方向明确性检查
        direction = 0
        if m.ic_positive_ratio >= self.criteria.IC_DIRECTION_RATIO:
            direction = 1  # 正向因子
        elif m.ic_negative_ratio >= self.criteria.IC_DIRECTION_RATIO:
            direction = -1  # 负向因子
        else:
            reasons.append(
                f"IC方向不明确: 正比{m.ic_positive_ratio:.2%}, 负比{m.ic_negative_ratio:.2%}"
            )
        
        # 3. 单调性检查
        if m.monotonicity_score < self.criteria.MONOTONICITY_THRESHOLD:
            reasons.append(f"单调性 {m.monotonicity_score:.2f} < {self.criteria.MONOTONICITY_THRESHOLD}")
        
        # 4. 数据质量检查
        if m.nan_ratio > self.criteria.MAX_NAN_RATIO:
            reasons.append(f"NaN比例 {m.nan_ratio:.2%} > {self.criteria.MAX_NAN_RATIO:.2%}")
        
        # 5. 有效天数检查
        if m.valid_days < 20:
            reasons.append(f"有效天数 {m.valid_days} < 20")
        
        is_valid = len(reasons) == 0
        rejection_reason = "; ".join(reasons) if reasons else ""
        
        return is_valid, direction, rejection_reason
    
    def format_report(self, m: FactorMetrics) -> str:
        """格式化评估报告"""
        lines = [
            f"=== 因子评估报告: {m.name} ===",
            f"表达式: {m.expression}",
            "",
            "--- IC指标 ---",
            f"  IC均值: {m.ic_mean:.4f}",
            f"  IC标准差: {m.ic_std:.4f}",
            f"  ICIR: {m.icir:.4f}",
            f"  IC绝对值(加权): {m.ic_abs_weighted:.4f}",
            f"  IC>0占比: {m.ic_positive_ratio:.2%}",
            f"  IC<0占比: {m.ic_negative_ratio:.2%}",
            "",
            "--- 分组收益 ---",
            f"  多空年化收益: {m.long_short_return:.2%}",
            f"  单调性得分: {m.monotonicity_score:.2f}",
        ]
        
        if m.group_returns is not None:
            avg_returns = m.group_returns.mean()
            lines.append("  分组平均收益:")
            for i, ret in enumerate(avg_returns):
                lines.append(f"    组{i+1}: {ret:.4%}")
        
        lines.extend([
            "",
            "--- 其他指标 ---",
            f"  换手率: {m.turnover_rate:.2%}",
            f"  有效天数: {m.valid_days}",
            f"  有效股票数: {m.valid_stocks}",
            f"  NaN比例: {m.nan_ratio:.2%}",
            "",
            "--- 评估结果 ---",
            f"  通过: {'✓ 是' if m.is_valid else '✗ 否'}",
            f"  因子方向: {'正向' if m.direction == 1 else '负向' if m.direction == -1 else '不明确'}",
        ])
        
        if m.rejection_reason:
            lines.append(f"  拒绝原因: {m.rejection_reason}")
        
        return "\n".join(lines)


# 全局实例
evaluator = FactorEvaluator()


def evaluate_factor(
    factor_values: pd.DataFrame,
    market_data: Dict[str, pd.DataFrame],
    holding_period: int = 1,
    name: str = "",
    expression: str = ""
) -> FactorMetrics:
    """
    评估因子的便捷函数
    
    Args:
        factor_values: 因子值
        market_data: 市场数据（需要close字段计算收益率）
        holding_period: 持有期（天）
        name: 因子名称
        expression: 因子表达式
        
    Returns:
        FactorMetrics 对象
    """
    close = market_data['close']
    
    # 计算下期收益率
    forward_returns = close.pct_change(periods=holding_period).shift(-holding_period)
    
    return evaluator.evaluate(factor_values, forward_returns, name, expression)


if __name__ == "__main__":
    from .data_loader import load_market_data
    from .factor_calculator import calculate_factor
    
    print("=" * 60)
    print("因子评估测试")
    print("=" * 60)
    
    # 加载数据
    data = load_market_data(lookback_days=120)
    
    # 测试因子
    test_cases = [
        ("TS_CORR(close, volume, 20)", "量价相关"),
        ("RANK(TS_MEAN(volume, 5))", "5日均量排名"),
        ("DELTA(close, 5) / DELAY(close, 5)", "5日动量"),
    ]
    
    for expr, name in test_cases:
        print(f"\n{'='*40}")
        print(f"测试因子: {name}")
        print(f"{'='*40}")
        
        # 计算因子
        values, _, error = calculate_factor(expr, data, name)
        if error:
            print(f"计算失败: {error}")
            continue
        
        # 评估因子
        metrics = evaluate_factor(values, data, name=name, expression=expr)
        
        # 打印报告
        print(evaluator.format_report(metrics))
