#!/usr/bin/env python3
"""
Alpha因子计算模块
从因子库加载因子，计算股票的alpha因子值
"""
import json
import numpy as np
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

FACTOR_LIBRARY_PATH = '/opt/data/alpha_miner/factors/factor_library.json'


def load_alpha_factors():
    """从因子库加载有效因子（IC > 0.02）"""
    try:
        with open(FACTOR_LIBRARY_PATH) as f:
            data = json.load(f)
        
        valid_factors = []
        for factor in data.get('factors', []):
            ic = factor.get('ic_abs_weighted', 0)
            if ic > 0.02:
                valid_factors.append({
                    'id': factor['id'],
                    'name': factor['name'],
                    'expression': factor['expression'],
                    'direction': factor.get('direction', 1),
                    'ic': ic,
                    'hypothesis': factor.get('hypothesis', ''),
                    'monotonicity': factor.get('monotonicity_score', 0)
                })
        
        # 按IC排序
        valid_factors.sort(key=lambda x: -x['ic'])
        return valid_factors
    except Exception as e:
        print(f"  ⚠️ 加载因子库失败: {e}", file=sys.stderr)
        return []


# ============ 时序计算函数 ============
def ts_mean(x, d):
    """时序均值"""
    if len(x) < d:
        return np.zeros_like(x, dtype=float)
    result = np.full_like(x, np.nan, dtype=float)
    for i in range(d-1, len(x)):
        result[i] = np.mean(x[i-d+1:i+1])
    return result


def ts_std(x, d):
    """时序标准差"""
    if len(x) < d:
        return np.zeros_like(x, dtype=float)
    result = np.full_like(x, np.nan, dtype=float)
    for i in range(d-1, len(x)):
        result[i] = np.std(x[i-d+1:i+1], ddof=1)
    return result


def ts_max(x, d):
    """时序最大值"""
    if len(x) < d:
        return np.zeros_like(x, dtype=float)
    result = np.full_like(x, np.nan, dtype=float)
    for i in range(d-1, len(x)):
        result[i] = np.max(x[i-d+1:i+1])
    return result


def ts_min(x, d):
    """时序最小值"""
    if len(x) < d:
        return np.zeros_like(x, dtype=float)
    result = np.full_like(x, np.nan, dtype=float)
    for i in range(d-1, len(x)):
        result[i] = np.min(x[i-d+1:i+1])
    return result


def safe_div(a, b):
    """安全除法"""
    return np.where(b != 0, a / b, 0.0)


def _eval_factor_expression(expression, indicators):
    """计算因子表达式，返回完整numpy数组（内部共用）"""
    var_map = {
        'close': indicators.get('close', np.array([])),
        'volume': indicators.get('volume', np.array([])),
        'high': indicators.get('high', np.array([])),
        'low': indicators.get('low', np.array([])),
        'open': indicators.get('open', np.array([])),
        'turn': indicators.get('turn', np.array([])),
        'amount': indicators.get('amount', np.array([])),
        'pctChg': indicators.get('pctChg', np.array([]))
    }
    internal_vars = {}
    
    def eval_expr(expr):
        expr = expr.strip()
        try:
            return float(expr)
        except:
            pass
        if expr in var_map:
            return var_map[expr]
        if expr in internal_vars:
            return internal_vars[expr]
        
        import re
        func_pattern = r'^(TS_MEAN|TS_STD|TS_MAX|TS_MIN)\((.+),\s*(\d+)\)$'
        match = re.match(func_pattern, expr, re.DOTALL)
        
        if match:
            func_name = match.group(1)
            arg_expr = match.group(2).strip()
            d = int(match.group(3))
            arg_value = eval_expr(arg_expr)
            
            if isinstance(arg_value, np.ndarray):
                if func_name == 'TS_MEAN':
                    result = ts_mean(arg_value, d)
                elif func_name == 'TS_STD':
                    result = ts_std(arg_value, d)
                elif func_name == 'TS_MAX':
                    result = ts_max(arg_value, d)
                elif func_name == 'TS_MIN':
                    result = ts_min(arg_value, d)
                else:
                    return None
                key = f'_result_{len(internal_vars)}'
                internal_vars[key] = result
                return result
        
        # 处理除法
        depth = 0
        div_pos = -1
        for i in range(len(expr)-1, -1, -1):
            if expr[i] == ')': depth += 1
            elif expr[i] == '(': depth -= 1
            elif expr[i] == '/' and depth == 0:
                div_pos = i
                break
        if div_pos > 0:
            left_val = eval_expr(expr[:div_pos].strip())
            right_val = eval_expr(expr[div_pos+1:].strip())
            if isinstance(left_val, np.ndarray) and isinstance(right_val, np.ndarray):
                return safe_div(left_val, right_val)
        
        # 处理乘法
        depth = 0
        mul_pos = -1
        for i in range(len(expr)-1, -1, -1):
            if expr[i] == ')': depth += 1
            elif expr[i] == '(': depth -= 1
            elif expr[i] == '*' and depth == 0:
                mul_pos = i
                break
        if mul_pos > 0:
            left_val = eval_expr(expr[:mul_pos].strip())
            right_val = eval_expr(expr[mul_pos+1:].strip())
            if isinstance(left_val, np.ndarray) and isinstance(right_val, np.ndarray):
                return left_val * right_val
        
        if expr.startswith('(') and expr.endswith(')'):
            return eval_expr(expr[1:-1])
        return None
    
    return eval_expr(expression)


def calc_factor_series(expression, indicators):
    """计算因子的完整时间序列，返回numpy数组"""
    result = _eval_factor_expression(expression, indicators)
    if isinstance(result, np.ndarray):
        return result
    return None


def calc_single_factor(expression, indicators):
    """计算单个因子的值（返回最新值）"""
    try:
        result = _eval_factor_expression(expression, indicators)
        if isinstance(result, np.ndarray):
            valid = result[~np.isnan(result)]
            if len(valid) > 0:
                return float(valid[-1])
        elif isinstance(result, (int, float)):
            return float(result)
        return None
        
    except Exception as e:
        return None


def calc_alpha_score(indicators, alpha_factors):
    """用alpha因子计算额外评分
    
    评分逻辑：对每个因子计算全序列的z-score，只有当前值显著高于均值（z>0.5）才加分。
    z-score越高，加分越多（线性衰减）。这样只有因子表现突出的股票才能获得加分。
    
    返回: (score_boost, signals)
    """
    score_boost = 0
    signals = []
    
    # 准备数据（从indicators字典转为numpy数组）
    def to_array(key):
        val = indicators.get(key, [])
        if isinstance(val, (list, np.ndarray)):
            return np.array(val, dtype=float)
        return np.array([], dtype=float)
    
    data = {
        'close': to_array('close'),
        'volume': to_array('volume'),
        'high': to_array('high'),
        'low': to_array('low'),
        'open': to_array('open'),
        'turn': to_array('turn'),
        'amount': to_array('amount'),
        'pctChg': to_array('pctChg')
    }
    
    for factor in alpha_factors:
        try:
            # 计算因子的完整时间序列
            full_series = calc_factor_series(factor['expression'], data)
            
            if full_series is not None and len(full_series) >= 30:
                # 去掉NaN后计算z-score
                valid = full_series[~np.isnan(full_series)]
                if len(valid) < 30:
                    continue
                
                mean_val = np.mean(valid)
                std_val = np.std(valid)
                
                if std_val < 1e-10:
                    continue  # 常数序列，无区分度
                
                current_val = valid[-1]
                z_score = (current_val - mean_val) / std_val
                
                direction = factor['direction']
                ic = factor['ic']
                
                # 根据方向调整z-score（负向因子取反）
                if direction == -1:
                    z_score = -z_score
                
                # z > 0.5 才加分，加分与z-score和IC正相关
                if z_score > 0.5:
                    bonus = ic * min(z_score, 3.0) * 3.33  # z=0.5时约ic*1.67, z=3时满分ic*10
                    score_boost += bonus
                    signals.append(f"Alpha_{factor['name']}(IC={ic:.3f},z={z_score:.2f})")
        except:
            pass
    
    return round(score_boost, 2), signals


def get_alpha_factor_info():
    """获取因子库摘要信息（用于LLM prompt）"""
    factors = load_alpha_factors()
    if not factors:
        return "暂无Alpha因子数据"
    
    info_lines = ["## Alpha因子库（由因子挖掘系统自动发现）\n"]
    info_lines.append(f"因子总数: {len(factors)}\n")
    
    for i, f in enumerate(factors[:5], 1):  # 只展示Top 5
        info_lines.append(f"### 因子{i}: {f['name']}")
        info_lines.append(f"- 表达式: `{f['expression']}`")
        info_lines.append(f"- IC值: {f['ic']:.4f}")
        info_lines.append(f"- 方向: {'正向（值越高越好）' if f['direction'] == 1 else '负向（值越低越好）'}")
        info_lines.append(f"- 假设: {f['hypothesis'][:80]}...")
        info_lines.append("")
    
    return "\n".join(info_lines)


if __name__ == "__main__":
    # 测试加载因子库
    factors = load_alpha_factors()
    print(f"✅ 加载了 {len(factors)} 个有效因子")
    for f in factors:
        print(f"  - {f['name']}: IC={f['ic']:.4f}, 表达式={f['expression'][:50]}...")
