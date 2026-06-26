"""
进化策略模块
============
实现因子表达式的进化操作：
- 变异（Mutation）：修改参数或替换算子
- 交叉（Crossover）：组合两个因子
- 精英保留（Elitism）：保留表现最好的因子

参考QuantaAlpha的进化策略，但简化实现。
"""
import random
import re
from typing import Dict, List, Optional, Tuple

from config import EvolutionConfig
from factor_library import FactorRecord


class EvolutionStrategy:
    """进化策略"""
    
    def __init__(self):
        self.mutation_rate = EvolutionConfig.MUTATION_RATE
        self.crossover_rate = EvolutionConfig.CROSSOVER_RATE
        self.elite_ratio = EvolutionConfig.ELITE_RATIO
        
        # 常用参数池
        self.common_params = [3, 5, 10, 15, 20, 30, 60]
        
        # 可替换的算子对（功能相似）
        self.operator_groups = {
            "moving_average": ["TS_MEAN", "EMA", "SMA", "WMA"],
            "volatility": ["TS_STD", "TS_MAX", "TS_MIN"],
            "momentum": ["DELTA", "ROC", "MTM"],
            "rank": ["RANK", "ZSCORE", "TS_RANK"],
            "correlation": ["TS_CORR", "TS_COV"],
            "technical": ["RSI", "MACD_DIF", "MACD_HIST", "KDJ_J", "WR", "CCI"],
        }
        
        # 变量池
        self.price_vars = ["open", "high", "low", "close"]
        self.volume_vars = ["volume", "amount", "turn"]
        self.all_vars = self.price_vars + self.volume_vars + ["pctChg"]
    
    def evolve(
        self,
        population: List[FactorRecord],
        n_children: int = 10
    ) -> List[str]:
        """
        执行进化操作
        
        Args:
            population: 当前种群（因子记录列表）
            n_children: 生成子代数量
            
        Returns:
            子代因子表达式列表
        """
        if not population:
            return []
        
        children = []
        
        # 1. 精英保留
        n_elite = max(1, int(len(population) * self.elite_ratio))
        elite = sorted(population, key=lambda f: f.ic_abs_weighted, reverse=True)[:n_elite]
        
        # 精英直接进入下一代（不变异）
        for e in elite:
            children.append(e.expression)
        
        # 2. 变异操作
        n_mutate = int(n_children * self.mutation_rate)
        for _ in range(n_mutate):
            parent = self._select_parent(population)
            child_expr = self._mutate(parent.expression)
            if child_expr:
                children.append(child_expr)
        
        # 3. 交叉操作
        n_crossover = int(n_children * self.crossover_rate)
        for _ in range(n_crossover):
            parent1, parent2 = self._select_parents(population, 2)
            child_expr = self._crossover(parent1.expression, parent2.expression)
            if child_expr:
                children.append(child_expr)
        
        # 4. 随机探索（保持多样性）
        n_random = n_children - len(children)
        for _ in range(max(0, n_random)):
            random_expr = self._generate_random()
            if random_expr:
                children.append(random_expr)
        
        return children[:n_children]
    
    def _select_parent(self, population: List[FactorRecord]) -> FactorRecord:
        """选择父代（锦标赛选择）"""
        # 锦标赛选择：随机选3个，取最好的
        tournament_size = min(3, len(population))
        tournament = random.sample(population, tournament_size)
        return max(tournament, key=lambda f: f.ic_abs_weighted)
    
    def _select_parents(
        self,
        population: List[FactorRecord],
        n: int
    ) -> List[FactorRecord]:
        """选择多个父代"""
        parents = []
        for _ in range(n):
            parent = self._select_parent(population)
            parents.append(parent)
        return parents
    
    def _mutate(self, expression: str) -> Optional[str]:
        """
        变异操作
        
        变异方式：
        1. 修改参数（窗口期）
        2. 替换算子（同类替换）
        3. 替换变量
        4. 嵌套包装
        """
        try:
            mutation_type = random.choice(["param", "operator", "variable", "wrap"])
            
            if mutation_type == "param":
                return self._mutate_param(expression)
            elif mutation_type == "operator":
                return self._mutate_operator(expression)
            elif mutation_type == "variable":
                return self._mutate_variable(expression)
            elif mutation_type == "wrap":
                return self._mutate_wrap(expression)
            
        except Exception:
            pass
        
        return None
    
    def _mutate_param(self, expression: str) -> str:
        """修改参数（窗口期）— 只匹配函数调用中的窗口参数"""
        # 匹配函数调用中的数字参数：FUNC(var, 数字) 或 FUNC(var1, var2, 数字)
        func_param_pattern = r'(\w+\([^)]*?,\s*)(\d+)(\))'
        matches = list(re.finditer(func_param_pattern, expression))
        if not matches:
            return expression
        
        # 随机选择一个匹配的窗口参数替换
        match = random.choice(matches)
        old_num = match.group(2)
        new_num = str(random.choice(self.common_params))
        
        if old_num == new_num:
            return expression
        
        # 精确替换该位置
        start, end = match.start(2), match.end(2)
        return expression[:start] + new_num + expression[end:]
    
    def _mutate_operator(self, expression: str) -> str:
        """替换算子"""
        # 查找使用的算子
        used_ops = []
        for op_name in self.operator_groups:
            for op in self.operator_groups[op_name]:
                if op in expression:
                    used_ops.append((op, op_name))
        
        if not used_ops:
            return expression
        
        # 随机选择一个算子替换
        old_op, group_name = random.choice(used_ops)
        group = self.operator_groups[group_name]
        
        # 选择同组的其他算子
        candidates = [op for op in group if op != old_op]
        if not candidates:
            return expression
        
        new_op = random.choice(candidates)
        return expression.replace(old_op, new_op, 1)
    
    def _mutate_variable(self, expression: str) -> str:
        """替换变量"""
        # 查找使用的变量
        used_vars = []
        for var in self.all_vars:
            if re.search(r'\b' + var + r'\b', expression):
                used_vars.append(var)
        
        if not used_vars:
            return expression
        
        # 随机选择一个变量替换
        old_var = random.choice(used_vars)
        
        # 根据类型选择替换
        if old_var in self.price_vars:
            new_var = random.choice(self.price_vars)
        elif old_var in self.volume_vars:
            new_var = random.choice(self.volume_vars)
        else:
            new_var = random.choice(self.all_vars)
        
        return expression.replace(old_var, new_var, 1)
    
    def _mutate_wrap(self, expression: str) -> str:
        """嵌套包装"""
        # 包装方式
        wrappers = [
            "RANK({})",
            "ZSCORE({})",
            "ABS({})",
            "LOG({})",
            "TS_MEAN({}, 5)",
            "TS_STD({}, 10)",
            "EMA({}, 10)",
        ]
        
        wrapper = random.choice(wrappers)
        
        # 检查嵌套深度
        new_expr = wrapper.format(expression)
        nesting_depth = self._calc_nesting_depth(new_expr)
        
        if nesting_depth > 3:
            return expression
        
        return new_expr
    
    def _crossover(self, expr1: str, expr2: str) -> Optional[str]:
        """
        交叉操作
        
        方式：
        1. 算术组合：expr1 * expr2, expr1 + expr2 等
        2. 函数组合：将expr2作为expr1的参数
        """
        try:
            crossover_type = random.choice(["arithmetic", "functional"])
            
            if crossover_type == "arithmetic":
                operators = ["+", "-", "*", "/"]
                op = random.choice(operators)
                
                if op == "/":
                    # 除法需要安全处理
                    return f"SAFE_DIVIDE({expr1}, {expr2})"
                else:
                    return f"({expr1}) {op} ({expr2})"
            
            elif crossover_type == "functional":
                # 尝试将expr2作为expr1的参数
                # 查找expr1中的变量
                for var in self.all_vars:
                    if var in expr1:
                        return expr1.replace(var, f"({expr2})", 1)
                
                # 如果没有找到变量，使用加法
                return f"({expr1}) + ({expr2})"
            
        except Exception:
            pass
        
        return None
    
    def _generate_random(self) -> Optional[str]:
        """生成随机因子表达式"""
        try:
            # 简单模板
            templates = [
                "TS_CORR({var1}, {var2}, {param})",
                "RANK(TS_MEAN({var1}, {param}))",
                "DELTA({var1}, {param}) / DELAY({var1}, {param})",
                "EMA({var1}, {param1}) - EMA({var1}, {param2})",
                "TS_STD({var1}, {param}) / TS_MEAN({var1}, {param})",
                "({high} - {low}) / {close}",
                "VOLUME_RATIO({volume}, {param})",
                "PRICE_VOLUME_CORR({close}, {volume}, {param})",
                "BIAS({close}, {param})",
            ]
            
            template = random.choice(templates)
            
            # 填充变量
            var1 = random.choice(self.price_vars)
            var2 = random.choice(self.volume_vars)
            param = random.choice(self.common_params)
            param2 = random.choice([p for p in self.common_params if p != param])
            
            expr = template.format(
                var1=var1,
                var2=var2,
                high="high",
                low="low",
                close="close",
                volume="volume",
                param=param,
                param1=param,
                param2=param2,
            )
            
            # 检查嵌套深度
            if self._calc_nesting_depth(expr) <= 3:
                return expr
            
        except Exception:
            pass
        
        return None
    
    def _calc_nesting_depth(self, expression: str) -> int:
        """计算嵌套深度"""
        max_depth = 0
        current_depth = 0
        
        for char in expression:
            if char == '(':
                current_depth += 1
                max_depth = max(max_depth, current_depth)
            elif char == ')':
                current_depth -= 1
        
        return max_depth


# 全局实例
evolution = EvolutionStrategy()


if __name__ == "__main__":
    print("=" * 60)
    print("进化策略测试")
    print("=" * 60)
    
    # 创建模拟种群
    from factor_library import FactorRecord
    from datetime import datetime
    
    mock_population = [
        FactorRecord(
            id="test1",
            name="量价相关",
            expression="TS_CORR(close, volume, 20)",
            direction=1,
            is_positive=True,
            ic_mean=0.03,
            ic_std=0.02,
            icir=1.5,
            ic_abs_weighted=0.03,
            ic_positive_ratio=0.6,
            ic_negative_ratio=0.4,
            monotonicity_score=0.8,
            long_short_return=0.05,
            turnover_rate=0.2,
            variables=["close", "volume"],
            operators=["TS_CORR"],
            nesting_depth=1,
            created_at=datetime.now().isoformat(),
            updated_at=datetime.now().isoformat(),
        ),
        FactorRecord(
            id="test2",
            name="5日动量",
            expression="DELTA(close, 5) / DELAY(close, 5)",
            direction=1,
            is_positive=True,
            ic_mean=0.02,
            ic_std=0.015,
            icir=1.3,
            ic_abs_weighted=0.02,
            ic_positive_ratio=0.55,
            ic_negative_ratio=0.45,
            monotonicity_score=0.7,
            long_short_return=0.03,
            turnover_rate=0.25,
            variables=["close"],
            operators=["DELTA", "DELAY"],
            nesting_depth=1,
            created_at=datetime.now().isoformat(),
            updated_at=datetime.now().isoformat(),
        ),
    ]
    
    # 测试进化
    children = evolution.evolve(mock_population, n_children=10)
    
    print(f"\n生成了 {len(children)} 个子代表达式：")
    for i, expr in enumerate(children, 1):
        print(f"{i}. {expr}")
