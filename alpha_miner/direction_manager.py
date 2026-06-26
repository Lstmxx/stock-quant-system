"""
自动方向调整
============
根据历史挖掘结果，LLM自动选择下一个研究方向。

核心逻辑：
1. 记录每个方向的挖掘结果（因子数量、最佳IC）
2. LLM分析哪些方向有效、哪些无效
3. 自动选择下一个研究方向（探索新方向 or 深挖有效方向）
"""
import json
import random
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from config import FACTORS_DIR

# 方向历史记录路径
DIRECTION_HISTORY_PATH = FACTORS_DIR / "direction_history.json"

# 预设研究方向池
DIRECTION_POOL = [
    "量价关系",           # 成交量与价格的关系
    "动量反转",           # 动量/反转效应
    "波动率",             # 波动率相关因子
    "资金流向",           # 大单资金、主力资金
    "市场情绪",           # 换手率、涨跌比
    "趋势强度",           # 趋势的方向和力度
    "量价背离",           # 量与价的不一致
    "流动性溢价",         # 流动性与收益的关系
    "成交量分布",         # 成交量的时间分布特征
    "价格形态",           # K线形态、支撑阻力
    "换手率异动",         # 换手率的异常变化
    "振幅压缩",           # 波动率收缩后的突破
]


class DirectionManager:
    """研究方向管理器"""
    
    def __init__(self):
        self.history: List[Dict] = []
        self._load_history()
    
    def _load_history(self):
        """加载方向历史"""
        if DIRECTION_HISTORY_PATH.exists():
            try:
                with open(DIRECTION_HISTORY_PATH, 'r') as f:
                    self.history = json.load(f)
            except Exception as e:
                print(f"[方向管理] 加载历史失败: {e}")
                self.history = []
    
    def _save_history(self):
        """保存方向历史"""
        DIRECTION_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(DIRECTION_HISTORY_PATH, 'w') as f:
            json.dump(self.history, f, ensure_ascii=False, indent=2)
    
    def record_result(
        self,
        direction: str,
        n_factors_generated: int,
        n_factors_valid: int,
        best_ic: float,
        avg_ic: float
    ):
        """记录一次挖掘结果"""
        self.history.append({
            'date': datetime.now().strftime('%Y-%m-%d'),
            'direction': direction,
            'n_generated': n_factors_generated,
            'n_valid': n_factors_valid,
            'best_ic': round(best_ic, 4),
            'avg_ic': round(avg_ic, 4),
        })
        # 保留最近50次
        self.history = self.history[-50:]
        self._save_history()
    
    def get_direction_stats(self) -> Dict[str, Dict]:
        """统计各方向的表现"""
        stats = {}
        for record in self.history:
            d = record['direction']
            if d not in stats:
                stats[d] = {
                    'attempts': 0,
                    'total_valid': 0,
                    'total_generated': 0,
                    'best_ic': 0,
                    'avg_ic_sum': 0,
                }
            s = stats[d]
            s['attempts'] += 1
            s['total_valid'] += record['n_valid']
            s['total_generated'] += record['n_generated']
            s['best_ic'] = max(s['best_ic'], record['best_ic'])
            s['avg_ic_sum'] += record['avg_ic']
        
        # 计算平均
        for d, s in stats.items():
            s['avg_ic'] = s['avg_ic_sum'] / s['attempts'] if s['attempts'] > 0 else 0
            s['success_rate'] = s['total_valid'] / s['total_generated'] if s['total_generated'] > 0 else 0
        
        return stats
    
    def select_next_direction(self) -> str:
        """
        选择下一个研究方向
        
        策略：
        1. 优先探索未尝试的方向
        2. 如果都尝试过，选择成功率最高的方向深挖
        3. 加入随机性避免陷入局部最优
        """
        stats = self.get_direction_stats()
        
        # 1. 未尝试的方向
        tried = set(stats.keys())
        untried = [d for d in DIRECTION_POOL if d not in tried]
        
        if untried:
            # 优先选择与已成功方向相关的未尝试方向
            if stats:
                best_dir = max(stats.keys(), key=lambda d: stats[d]['best_ic'])
                # 找与最佳方向相关的未尝试方向
                related = [d for d in untried if self._is_related(best_dir, d)]
                if related:
                    return related[0]
            return untried[0]
        
        # 2. 所有方向都尝试过，选择最佳方向
        if stats:
            # 按best_ic排序，但加入随机性
            sorted_dirs = sorted(
                stats.keys(),
                key=lambda d: stats[d]['best_ic'] + random.uniform(-0.01, 0.01),
                reverse=True
            )
            return sorted_dirs[0]
        
        # 3. 默认
        return "量价关系"
    
    def _is_related(self, dir1: str, dir2: str) -> bool:
        """判断两个方向是否相关"""
        related_groups = [
            {"量价关系", "量价背离", "成交量分布"},
            {"动量反转", "趋势强度", "价格形态"},
            {"波动率", "振幅压缩", "流动性溢价"},
            {"资金流向", "换手率异动", "市场情绪"},
        ]
        for group in related_groups:
            if dir1 in group and dir2 in group:
                return True
        return False
    
    def get_llm_direction(self) -> str:
        """
        让LLM分析历史并推荐下一个方向
        
        Returns:
            推荐的研究方向
        """
        from llm_backend import llm
        
        stats = self.get_direction_stats()
        
        # 构建历史摘要
        history_text = ""
        for d, s in stats.items():
            history_text += (
                f"- {d}: 尝试{s['attempts']}次, "
                f"生成{s['total_generated']}个因子, "
                f"有效{s['total_valid']}个, "
                f"最佳IC={s['best_ic']:.4f}, "
                f"成功率={s['success_rate']:.1%}\n"
            )
        
        # 未尝试方向
        tried = set(stats.keys())
        untried = [d for d in DIRECTION_POOL if d not in tried]
        
        prompt = f"""你是量化因子挖掘策略师。请根据历史数据推荐下一个研究方向。

历史挖掘结果：
{history_text}

未尝试的方向：{', '.join(untried) if untried else '全部已尝试'}

请用JSON回答：
{{
    "direction": "推荐的研究方向",
    "reason": "推荐理由（50字以内）"
}}

要求：
1. 如果有未尝试的方向且历史表现一般，优先推荐未尝试的
2. 如果某个方向表现很好，可以推荐相关的深挖方向
3. 避免重复推荐表现差的方向"""
        
        messages = [
            {"role": "system", "content": "你是量化因子挖掘策略师。"},
            {"role": "user", "content": prompt}
        ]
        
        try:
            response = llm.chat(messages, temperature=0.5, max_tokens=500)
            result = llm._parse_json_response(response, {"direction": "", "reason": ""})
            
            if result.get('direction'):
                print(f"[方向调整] LLM推荐: {result['direction']}")
                print(f"  理由: {result.get('reason', '')}")
                return result['direction']
        except Exception as e:
            print(f"[方向调整] LLM调用失败: {e}")
        
        # 降级到规则选择
        return self.select_next_direction()
    
    def format_report(self) -> str:
        """格式化方向报告"""
        stats = self.get_direction_stats()
        
        lines = [
            "=== 研究方向统计 ===",
            f"已尝试方向: {len(stats)}/{len(DIRECTION_POOL)}",
            "",
            "--- 各方向表现 ---",
        ]
        
        for d, s in sorted(stats.items(), key=lambda x: x[1]['best_ic'], reverse=True):
            lines.append(
                f"  {d:<10} 尝试{s['attempts']}次, "
                f"有效{s['total_valid']}/{s['total_generated']}, "
                f"最佳IC={s['best_ic']:.4f}, "
                f"成功率={s['success_rate']:.1%}"
            )
        
        # 未尝试方向
        tried = set(stats.keys())
        untried = [d for d in DIRECTION_POOL if d not in tried]
        if untried:
            lines.append(f"\n未尝试: {', '.join(untried)}")
        
        return "\n".join(lines)


# 全局实例
direction_manager = DirectionManager()


if __name__ == "__main__":
    print(direction_manager.format_report())
    print(f"\n下一个方向: {direction_manager.select_next_direction()}")
