"""
Alpha Miner 主控循环
====================
实现完整的因子挖掘闭环：
1. 假设生成（LLM）
2. 因子表达式生成（LLM）
3. 因子计算
4. 因子评估
5. 反馈生成（LLM）
6. 进化迭代

参考QuantaAlpha/RD-Agent的架构，但简化实现。
"""
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd
import redis

# Core config — resolve via __file__ so this works regardless of CWD
_CORE_DIR = os.path.dirname(__file__)
_APP_DIR = os.path.join(_CORE_DIR, "..")
if _CORE_DIR not in sys.path:
    sys.path.insert(0, _CORE_DIR)
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from config import EvolutionConfig, LLMConfig, FACTORS_DIR  # app/core/config.py
from data_loader import load_market_data
from evolution import evolution
from factor_calculator import calculate_factor
from factor_evaluator import evaluate_factor, FactorMetrics
from factor_library import library, FactorRecord
from factor_parser import parser
from llm_backend import llm

# pydantic settings from app/config.py (for Redis URL etc.)
try:
    from app.config import settings as _app_settings
except ImportError:
    # fallback when running from within app/core directly
    import importlib.util, pathlib
    _spec = importlib.util.spec_from_file_location(
        "app_config",
        pathlib.Path(_APP_DIR) / "config.py"
    )
    _mod = importlib.util.module_from_spec(_spec)  # type: ignore
    _spec.loader.exec_module(_mod)  # type: ignore
    _app_settings = _mod.settings

_REDIS_URL = _app_settings.redis_url

class AlphaMiner:
    """Alpha因子挖掘主控"""
    
    def __init__(self, task_id: str = "default_task", user_id: str = "system"):
        self.market_data = None
        self.history = []  # 历史假设和结果
        self.current_round = 0
        self.task_id = task_id
        self.user_id = user_id
        self.redis_client = redis.Redis.from_url(_REDIS_URL)
        
    def _log(self, *args, **kwargs):
        msg = " ".join(str(a) for a in args)
        print(msg) # still print locally
        # publish to redis
        try:
            self.redis_client.publish(f"task_log:{self.task_id}", json.dumps({"message": msg}))
        except Exception:
            pass
    
    def load_data(self, lookback_days: int = 250):
        """加载市场数据"""
        self._log("[AlphaMiner] 加载市场数据...")
        self.market_data = load_market_data(lookback_days=lookback_days)
        
        # 验证数据
        if 'close' not in self.market_data:
            raise ValueError("数据缺少close字段")
        
        close = self.market_data['close']
        self._log(f"[AlphaMiner] 数据加载完成: {close.shape[0]}天 x {close.shape[1]}只股票")
    
    def mine(
        self,
        direction: str = "量价关系",
        max_rounds: int = 10,
        factors_per_round: int = 3,
        use_evolution: bool = True
    ) -> List[FactorRecord]:
        """
        执行因子挖掘
        
        Args:
            direction: 研究方向
            max_rounds: 最大轮数
            factors_per_round: 每轮生成因子数
            use_evolution: 是否使用进化策略
            
        Returns:
            发现的有效因子列表
        """
        if self.market_data is None:
            self.load_data()
        
        self._log(f"\n{'='*60}")
        self._log(f"开始因子挖掘: {direction}")
        self._log(f"最大轮数: {max_rounds}, 每轮因子数: {factors_per_round}")
        self._log(f"{'='*60}\n")
        
        all_valid_factors = []
        all_generated_count = 0
        feedback = ""
        
        for round_num in range(1, max_rounds + 1):
            self.current_round = round_num
            self._log(f"\n{'='*40}")
            self._log(f"第 {round_num}/{max_rounds} 轮")
            self._log(f"{'='*40}")
            
            try:
                # 1. 生成假设
                hypothesis = self._generate_hypothesis(direction, feedback)
                if not hypothesis:
                    self._log("[跳过] 假设生成失败")
                    continue
                
                # 2. 生成因子表达式
                expressions = self._generate_factors(
                    hypothesis, factors_per_round
                )
                
                # 3. 如果使用进化，添加进化子代
                if use_evolution and len(library.get_all()) >= 2:
                    evolved = self._evolve_population()
                    expressions.extend(evolved)
                
                all_generated_count += len(expressions)
                
                # 4. 计算和评估因子
                round_results = self._evaluate_expressions(
                    expressions, hypothesis
                )
                
                # 5. 收集有效因子
                valid_factors = [r for r in round_results if r['metrics'].is_valid]
                all_valid_factors.extend(valid_factors)
                
                # 6. 生成反馈
                feedback = self._generate_feedback(
                    hypothesis, round_results
                )
                
                # 7. 记录历史
                self.history.append({
                    'round': round_num,
                    'hypothesis': hypothesis,
                    'n_expressions': len(expressions),
                    'n_valid': len(valid_factors),
                    'feedback': feedback
                })
                
                # 打印本轮结果
                self._print_round_summary(round_num, round_results)
                
            except Exception as e:
                self._log(f"[错误] 第{round_num}轮失败: {type(e).__name__}: {e}")
                continue
        
        # 打印最终结果
        self._print_final_summary(all_valid_factors)
        
        # 自动裁剪垃圾因子
        self._log("\n[自动裁剪] 清理垃圾因子...")
        prune_stats = library.prune()
        
        return all_valid_factors, all_generated_count
    
    def _generate_hypothesis(
        self, direction: str, feedback: str
    ) -> Optional[Dict]:
        """生成研究假设"""
        self._log("\n[1/5] 生成研究假设...")
        
        try:
            hypothesis = llm.generate_hypothesis(
                direction=direction,
                history=self.history,
                feedback=feedback
            )
            
            if hypothesis and hypothesis.get('hypothesis'):
                self._log(f"  假设: {hypothesis['hypothesis']}")
                return hypothesis
            else:
                self._log("  [警告] 生成的假设为空")
                return None
                
        except Exception as e:
            self._log(f"  [错误] 假设生成失败: {e}")
            return None
    
    def _generate_factors(
        self, hypothesis: Dict, n_factors: int
    ) -> List[str]:
        """生成因子表达式"""
        self._log(f"\n[2/5] 生成因子表达式 (目标{n_factors}个)...")
        
        # 获取已有表达式（避免重复）
        existing = library.get_expressions()
        
        try:
            factors = llm.generate_factors(
                hypothesis=hypothesis.get('hypothesis', ''),
                existing_expressions=existing,
                n_factors=n_factors
            )
            
            expressions = [f['expression'] for f in factors if f.get('expression')]
            
            self._log(f"  生成了 {len(expressions)} 个表达式")
            for i, expr in enumerate(expressions, 1):
                self._log(f"    {i}. {expr}")
            
            return expressions
            
        except Exception as e:
            self._log(f"  [错误] 因子生成失败: {e}")
            return []
    
    def _evolve_population(self) -> List[str]:
        """进化种群"""
        self._log("\n[2.5/5] 执行进化操作...")
        
        try:
            population = library.get_valid_factors()
            if len(population) < 2:
                return []
            
            children = evolution.evolve(population, n_children=5)
            self._log(f"  进化生成了 {len(children)} 个子代")
            
            return children
            
        except Exception as e:
            self._log(f"  [错误] 进化失败: {e}")
            return []
    
    def _evaluate_expressions(
        self, expressions: List[str], hypothesis: Dict
    ) -> List[Dict]:
        """计算和评估因子表达式"""
        self._log(f"\n[3/5] 计算和评估 {len(expressions)} 个因子...")
        
        results = []
        
        for i, expr in enumerate(expressions, 1):
            self._log(f"\n  --- 因子 {i}/{len(expressions)} ---")
            self._log(f"  表达式: {expr}")
            
            result = {
                'expression': expr,
                'hypothesis': hypothesis.get('hypothesis', ''),
                'metrics': None,
                'error': None,
                'record': None,
            }
            
            # 尝试计算（带debug重试）
            values, metrics, error = self._calculate_with_debug(expr)
            
            if error:
                self._log(f"  [失败] {error}")
                result['error'] = error
            elif metrics:
                result['metrics'] = metrics
                
                # 如果通过评估，保存到因子库
                if metrics.is_valid:
                    parsed = parser.parse(expr)
                    record = library.add(
                        name=f"Round{self.current_round}_Factor{i}",
                        expression=expr,
                        metrics=metrics,
                        variables=parsed.variables,
                        operators=parsed.operators,
                        nesting_depth=parsed.nesting_depth,
                        hypothesis=hypothesis.get('hypothesis', ''),
                        generation=self.current_round,
                        user_id=self.user_id
                    )
                    result['record'] = record
                    self._log(f"  [PASS 通过] IC={metrics.ic_abs_weighted:.4f}, "
                          f"ICIR={metrics.icir:.4f}, "
                          f"方向={'正向' if metrics.direction == 1 else '负向'}")
                else:
                    self._log(f"  [FAIL 未通过] {metrics.rejection_reason}")
            
            results.append(result)
        
        return results
    
    def _calculate_with_debug(
        self, expression: str, max_attempts: int = 3
    ) -> Tuple[Optional[pd.DataFrame], Optional[FactorMetrics], Optional[str]]:
        """
        计算因子（带debug重试）
        
        参考RD-Agent的CoSTEER，当计算失败时让LLM调试并重试
        """
        current_expr = expression
        
        for attempt in range(max_attempts):
            # 1. 解析表达式
            parsed = parser.parse(current_expr)
            if not parsed.is_valid:
                # 语法错误，尝试debug
                if attempt < max_attempts - 1:
                    fixed_expr, _ = llm.debug_factor_code(
                        current_expr, parsed.error
                    )
                    if fixed_expr != current_expr:
                        self._log(f"    [Debug] 尝试修复: {fixed_expr}")
                        current_expr = fixed_expr
                        continue
                return None, None, parsed.error
            
            # 2. 计算因子值
            values, _, error = calculate_factor(
                current_expr, self.market_data
            )
            
            if error:
                # 计算错误，尝试debug
                if attempt < max_attempts - 1:
                    fixed_expr, _ = llm.debug_factor_code(
                        current_expr, error
                    )
                    if fixed_expr != current_expr:
                        self._log(f"    [Debug] 尝试修复: {fixed_expr}")
                        current_expr = fixed_expr
                        continue
                return None, None, error
            
            # 3. 评估因子
            metrics = evaluate_factor(
                values, self.market_data,
                name=f"Round{self.current_round}",
                expression=current_expr
            )
            
            return values, metrics, None
        
        return None, None, f"超过最大重试次数({max_attempts})"
    
    def _generate_feedback(
        self, hypothesis: Dict, results: List[Dict]
    ) -> str:
        """生成反馈"""
        self._log(f"\n[4/5] 生成反馈...")
        
        # 构建指标摘要
        metrics_summary = self._build_metrics_summary(results)
        
        # 表现好的因子
        best_factors = []
        for r in results:
            if r['metrics'] and r['metrics'].is_valid:
                best_factors.append({
                    'name': r.get('record', {}).name if r.get('record') else '',
                    'expression': r['expression'],
                    'ic': r['metrics'].ic_abs_weighted,
                    'icir': r['metrics'].icir,
                })
        
        # 失败的因子
        failed_factors = []
        for r in results:
            if r['error']:
                failed_factors.append({
                    'expression': r['expression'],
                    'error': r['error'],
                })
        
        try:
            feedback_result = llm.generate_feedback(
                hypothesis=hypothesis.get('hypothesis', ''),
                metrics_summary=metrics_summary,
                best_factors=best_factors,
                failed_factors=failed_factors
            )
            
            observation = feedback_result.get('observation', '')
            new_direction = feedback_result.get('new_direction', '')
            
            self._log(f"  观察: {observation}")
            self._log(f"  新方向: {new_direction}")
            
            return json.dumps(feedback_result, ensure_ascii=False)
            
        except Exception as e:
            self._log(f"  [错误] 反馈生成失败: {e}")
            return ""
    
    def _build_metrics_summary(self, results: List[Dict]) -> str:
        """构建指标摘要"""
        lines = []
        
        for i, r in enumerate(results, 1):
            m = r.get('metrics')
            if m:
                lines.append(
                    f"因子{i}: IC={m.ic_abs_weighted:.4f}, "
                    f"ICIR={m.icir:.4f}, "
                    f"单调性={m.monotonicity_score:.2f}, "
                    f"通过={'是' if m.is_valid else '否'}"
                )
            else:
                lines.append(f"因子{i}: 计算失败 - {r.get('error', '')}")
        
        return "\n".join(lines)
    
    def _print_round_summary(self, round_num: int, results: List[Dict]):
        """打印轮次摘要"""
        n_total = len(results)
        n_valid = sum(1 for r in results if r['metrics'] and r['metrics'].is_valid)
        n_failed = sum(1 for r in results if r['error'])
        
        self._log(f"\n--- 第{round_num}轮摘要 ---")
        self._log(f"  总计: {n_total}, 通过: {n_valid}, 失败: {n_failed}")
    
    def _print_final_summary(self, valid_factors: List[Dict]):
        """打印最终摘要"""
        self._log(f"\n{'='*60}")
        self._log("因子挖掘完成")
        self._log(f"{'='*60}")
        
        self._log(f"\n总发现有效因子: {len(valid_factors)}")
        
        if valid_factors:
            # 按IC排序
            sorted_factors = sorted(
                valid_factors,
                key=lambda r: r['metrics'].ic_abs_weighted,
                reverse=True
            )
            
            self._log(f"\nTop 5 因子:")
            for i, f in enumerate(sorted_factors[:5], 1):
                m = f['metrics']
                self._log(f"\n  {i}. {f['expression']}")
                self._log(f"     IC={m.ic_abs_weighted:.4f}, ICIR={m.icir:.4f}")
                self._log(f"     方向={'正向' if m.direction == 1 else '负向'}")
        
        # 打印因子库摘要
        self._log(f"\n{library.format_summary()}")


    def self_optimize(self):
        """
        自我优化流程：
        1. 因子衰减监控 - 更新IC，淘汰衰退因子
        2. 自动方向调整 - 根据历史选择下一个研究方向
        3. 参数搜索 - 对好因子优化窗口参数
        """
        self._log("\n" + "=" * 60)
        self._log("自我优化流程")
        self._log("=" * 60)
        
        # 1. 因子衰减监控
        self._log("\n[优化1] 因子衰减监控...")
        from factor_decay import decay_monitor
        decay_monitor.update(self.market_data)
        decay_stats = decay_monitor.cleanup()
        self._log(f"  健康: {decay_stats['healthy']}, 衰退: {decay_stats['decayed']}, 失效: {decay_stats['removed']}")
        
        # 2. 自动方向调整
        self._log("\n[优化2] 自动方向调整...")
        from direction_manager import direction_manager
        direction = direction_manager.get_llm_direction()
        self._log(f"  推荐方向: {direction}")
        
        # 3. 参数搜索
        self._log("\n[优化3] 参数搜索...")
        from param_search import param_searcher
        optimized = param_searcher.optimize_all(self.market_data, min_ic=0.05)
        self._log(f"  优化了 {len(optimized)} 个因子")
        
        return direction, decay_stats, optimized


def main():
    """主入口"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Alpha因子挖掘器")
    parser.add_argument("--direction", type=str, default="量价关系",
                       help="研究方向")
    parser.add_argument("--rounds", type=int, default=10,
                       help="最大轮数")
    parser.add_argument("--factors-per-round", type=int, default=3,
                       help="每轮生成因子数")
    parser.add_argument("--lookback-days", type=int, default=250,
                       help="数据回看天数")
    parser.add_argument("--no-evolution", action="store_true",
                       help="禁用进化策略")
    parser.add_argument("--self-optimize", action="store_true",
                       help="启用自我优化（衰减监控+方向调整+参数搜索）")
    parser.add_argument("--auto-direction", action="store_true",
                       help="自动选择研究方向")
    
    args = parser.parse_args()
    
    # 创建矿工
    miner = AlphaMiner()
    
    # 加载数据
    miner.load_data(lookback_days=args.lookback_days)
    
    # 自动方向
    direction = args.direction
    if args.auto_direction:
        from direction_manager import direction_manager
        direction = direction_manager.get_llm_direction()
    
    # 自我优化（挖掘前）
    if args.self_optimize:
        direction, decay_stats, optimized = miner.self_optimize()
    
    # 开始挖掘
    valid_factors, total_generated = miner.mine(
        direction=direction,
        max_rounds=args.rounds,
        factors_per_round=args.factors_per_round,
        use_evolution=not args.no_evolution,
    )
    
    # 记录方向结果
    if args.auto_direction or args.self_optimize:
        from direction_manager import direction_manager
        valid_factors_list = list(valid_factors)
        direction_manager.record_result(
            direction=direction,
            n_factors_generated=total_generated,
            n_factors_valid=len(valid_factors_list),
            best_ic=max((f.get('ic_abs_weighted', 0) if isinstance(f, dict) else f.ic_abs_weighted for f in valid_factors_list), default=0),
            avg_ic=sum((f.get('ic_abs_weighted', 0) if isinstance(f, dict) else f.ic_abs_weighted for f in valid_factors_list)) / max(len(valid_factors_list), 1),
        )
    else:
        valid_factors_list = list(valid_factors)
    
    return valid_factors_list


if __name__ == "__main__":
    main()
