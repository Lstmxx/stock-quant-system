"""
因子衰减监控
============
每天重算所有因子的IC，跟踪衰减趋势，自动淘汰衰退因子。

衰减判定规则：
1. IC连续N天下降 → 标记为"衰退"
2. IC跌破阈值 → 标记为"失效"
3. 衰退/失效因子不再参与选股和进化
"""
import json
from typing import Dict, List, Optional, Tuple

import pandas as pd

from .config import FACTORS_DIR
from .factor_calculator import calculate_factor
from .factor_library import library

# IC历史记录路径
IC_HISTORY_PATH = FACTORS_DIR / "ic_history.json"

# 衰减判定参数
DECAY_LOOKBACK = 5          # 连续下降天数阈值
DECAY_IC_THRESHOLD = 0.01   # IC绝对值低于此值视为失效
DECAY_DECLINE_RATIO = 0.5   # IC下降超过初始值的此比例视为衰退


class FactorDecayMonitor:
    """因子衰减监控器"""
    
    def __init__(self):
        self.history: Dict[str, List[Dict]] = {}  # {factor_id: [{date, ic, icir}]}
        self._load_history()
    
    def _load_history(self):
        """加载IC历史"""
        if IC_HISTORY_PATH.exists():
            try:
                with open(IC_HISTORY_PATH, 'r') as f:
                    self.history = json.load(f)
            except Exception as e:
                print(f"[衰减监控] 加载历史失败: {e}")
                self.history = {}
    
    def _save_history(self):
        """保存IC历史"""
        IC_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(IC_HISTORY_PATH, 'w') as f:
            json.dump(self.history, f, ensure_ascii=False, indent=2)
    
    def update(
        self,
        market_data: Dict[str, pd.DataFrame],
        date_str: Optional[str] = None
    ) -> Dict[str, Dict]:
        """
        更新所有因子的IC记录
        
        Args:
            market_data: 市场数据
            date_str: 日期字符串，默认为最新交易日
            
        Returns:
            {factor_id: {date, ic, icir, status}}
        """
        if date_str is None:
            date_str = market_data['close'].index[-1].strftime('%Y-%m-%d')
        
        # 计算下期收益率（排除最后一天NaN）
        close = market_data['close']
        forward_returns = close.pct_change(1).shift(-1)
        
        results = {}
        factors = library.get_all()
        
        print(f"[衰减监控] 更新 {len(factors)} 个因子的IC ({date_str})")
        
        for f in factors:
            # 计算因子值
            values, _, error = calculate_factor(f.expression, market_data)
            if error or values is None:
                continue
            
            # 取倒数第二天（最后一天的forward_returns是NaN）
            valid_dates = values.index.intersection(forward_returns.dropna(how='all').index)
            if len(valid_dates) < 2:
                continue
            
            target_date = valid_dates[-1]
            fv = values.loc[target_date].dropna()
            fr = forward_returns.loc[target_date].dropna()
            common_stocks = fv.index.intersection(fr.index)
            
            if len(common_stocks) < 50:
                continue
            
            from scipy import stats
            ic, _ = stats.spearmanr(fv[common_stocks], fr[common_stocks])
            
            # 记录
            if f.id not in self.history:
                self.history[f.id] = []
            
            self.history[f.id].append({
                'date': date_str,
                'ic': round(float(ic), 6),
            })
            
            # 保留最近60天
            self.history[f.id] = self.history[f.id][-60:]
            
            results[f.id] = {
                'date': date_str,
                'ic': ic,
                'name': f.name,
                'expression': f.expression,
            }
        
        self._save_history()
        return results
    
    def detect_decay(self) -> Tuple[List[str], List[str], List[str]]:
        """
        检测衰减因子
        
        Returns:
            (healthy_ids, decayed_ids,失效_ids)
        """
        healthy = []
        decayed = []
        failed = []
        
        for fid, records in self.history.items():
            if len(records) < 3:
                healthy.append(fid)
                continue
            
            recent_ics = [r['ic'] for r in records[-DECAY_LOOKBACK:]]
            latest_ic = recent_ics[-1]
            
            # 检查失效
            if abs(latest_ic) < DECAY_IC_THRESHOLD:
                failed.append(fid)
                continue
            
            # 检查方向翻转：IC从正变负或从负变正
            signs_consistent = all(
                (r['ic'] >= 0) == (records[0]['ic'] >= 0)
                for r in records
            )
            if not signs_consistent:
                # 方向翻转是严重问题
                decayed.append(fid)
                continue
            
            # 检查衰退：IC绝对值连续下降
            recent_abs_ics = [abs(r['ic']) for r in records[-DECAY_LOOKBACK:]]
            is_declining = all(
                recent_abs_ics[i] <= recent_abs_ics[i-1] 
                for i in range(1, len(recent_abs_ics))
            )
            
            # 检查衰退：IC绝对值大幅下降
            initial_ic_abs = abs(records[0]['ic'])
            latest_ic_abs = abs(latest_ic)
            if initial_ic_abs > 0:
                decline_ratio = 1 - latest_ic_abs / initial_ic_abs
            else:
                decline_ratio = 0
            
            if is_declining and decline_ratio > DECAY_DECLINE_RATIO:
                decayed.append(fid)
            else:
                healthy.append(fid)
        
        return healthy, decayed, failed
    
    def cleanup(self) -> Dict[str, int]:
        """
        清理衰退/失效因子
        
        Returns:
            {healthy: N, decayed: N, failed: N, removed: N}
        """
        healthy, decayed, failed = self.detect_decay()
        
        stats = {
            'healthy': len(healthy),
            'decayed': len(decayed),
            'failed': len(failed),
            'removed': 0,
        }
        
        # 标记衰退因子
        for fid in decayed:
            record = library.get(fid)
            if record:
                library.update(fid, notes="[衰退] IC连续下降")
                print(f"  [衰退] {record.name}: {record.expression[:50]}...")
        
        # 删除失效因子
        for fid in failed:
            record = library.get(fid)
            if record:
                print(f"  [失效] {record.name}: IC<{DECAY_IC_THRESHOLD}")
                library.remove(fid)
                stats['removed'] += 1
                # 同时清理历史
                if fid in self.history:
                    del self.history[fid]
        
        self._save_history()
        return stats
    
    def format_report(self) -> str:
        """格式化衰减监控报告"""
        healthy, decayed, failed = self.detect_decay()
        
        lines = [
            "=== 因子衰减监控报告 ===",
            f"健康因子: {len(healthy)}",
            f"衰退因子: {len(decayed)}",
            f"失效因子: {len(failed)}",
        ]
        
        if decayed:
            lines.append("\n--- 衰退因子 ---")
            for fid in decayed:
                record = library.get(fid)
                if record:
                    ics = [r['ic'] for r in self.history.get(fid, [])[-5:]]
                    lines.append(f"  {record.name}: IC趋势 {ics}")
        
        return "\n".join(lines)


# 全局实例
decay_monitor = FactorDecayMonitor()


if __name__ == "__main__":
    from .data_loader import load_market_data
    
    print("=" * 60)
    print("因子衰减监控测试")
    print("=" * 60)
    
    data = load_market_data(250)
    decay_monitor.update(data)
    print(decay_monitor.format_report())
