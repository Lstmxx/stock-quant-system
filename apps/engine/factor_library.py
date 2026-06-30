"""
因子库管理模块
==============
JSON持久化存储，支持：
- 因子注册/更新/删除
- 按IC/ICIR排序
- 去重（MD5 + 表达式相似度）
- 历史记录
"""
import hashlib
import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from config import FACTOR_LIBRARY_PATH, FACTOR_VALUES_DIR
from factor_evaluator import FactorMetrics


@dataclass
class FactorRecord:
    """因子记录"""
    id: str                    # MD5哈希ID
    name: str                  # 因子名称
    expression: str            # 因子表达式
    direction: int             # 因子方向: 1=正向, -1=负向
    is_positive: bool          # 是否为正向因子
    
    # 评估指标
    ic_mean: float
    ic_std: float
    icir: float
    ic_abs_weighted: float
    ic_positive_ratio: float
    ic_negative_ratio: float
    monotonicity_score: float
    long_short_return: float
    turnover_rate: float
    
    # 元信息
    variables: List[str]       # 使用的变量
    operators: List[str]       # 使用的算子
    nesting_depth: int         # 嵌套深度
    
    # 时间戳
    created_at: str            # 创建时间
    updated_at: str            # 更新时间
    
    # 进化信息
    generation: int = 0        # 进化代数
    parent_ids: List[str] = None  # 父因子ID
    
    # 额外信息
    hypothesis: str = ""       # 生成该因子的假设
    notes: str = ""            # 备注


class FactorLibrary:
    """因子库管理器"""
    
    def __init__(self, path: Optional[str] = None):
        self.path = Path(path or FACTOR_LIBRARY_PATH)
        self.values_dir = Path(FACTOR_VALUES_DIR)
        self.values_dir.mkdir(exist_ok=True)
        
        self._factors: Dict[str, FactorRecord] = {}
        self._load()
    
    def _load(self):
        """从JSON文件加载因子库"""
        if self.path.exists():
            try:
                with open(self.path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                for factor_data in data.get('factors', []):
                    record = FactorRecord(**factor_data)
                    self._factors[record.id] = record
                print(f"[FactorLibrary] 加载了 {len(self._factors)} 个因子")
            except Exception as e:
                print(f"[FactorLibrary] 加载失败: {e}")
    
    def _save(self):
        """保存因子库到JSON文件"""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        
        data = {
            'version': '1.0',
            'updated_at': datetime.now().isoformat(),
            'count': len(self._factors),
            'factors': [asdict(f) for f in self._factors.values()]
        }
        
        with open(self.path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    
    @staticmethod
    def _generate_id(expression: str) -> str:
        """生成因子ID（基于表达式MD5）"""
        return hashlib.md5(expression.strip().encode()).hexdigest()[:12]
    
    def add(
        self,
        name: str,
        expression: str,
        metrics: FactorMetrics,
        variables: List[str],
        operators: List[str],
        nesting_depth: int,
        hypothesis: str = "",
        generation: int = 0,
        parent_ids: Optional[List[str]] = None
    ) -> FactorRecord:
        """
        添加因子到库
        
        Args:
            name: 因子名称
            expression: 因子表达式
            metrics: 评估指标
            variables: 使用的变量
            operators: 使用的算子
            nesting_depth: 嵌套深度
            hypothesis: 生成假设
            generation: 进化代数
            parent_ids: 父因子ID列表
            
        Returns:
            FactorRecord
        """
        factor_id = self._generate_id(expression)
        now = datetime.now().isoformat()
        
        # 确定因子方向
        direction = metrics.direction
        is_positive = direction == 1
        
        record = FactorRecord(
            id=factor_id,
            name=name,
            expression=expression,
            direction=direction,
            is_positive=is_positive,
            ic_mean=metrics.ic_mean,
            ic_std=metrics.ic_std,
            icir=metrics.icir,
            ic_abs_weighted=metrics.ic_abs_weighted,
            ic_positive_ratio=metrics.ic_positive_ratio,
            ic_negative_ratio=metrics.ic_negative_ratio,
            monotonicity_score=metrics.monotonicity_score,
            long_short_return=metrics.long_short_return,
            turnover_rate=metrics.turnover_rate,
            variables=variables,
            operators=operators,
            nesting_depth=nesting_depth,
            created_at=now,
            updated_at=now,
            generation=generation,
            parent_ids=parent_ids or [],
            hypothesis=hypothesis,
        )
        
        self._factors[factor_id] = record
        self._save()
        
        return record
    
    def update(self, factor_id: str, **kwargs) -> Optional[FactorRecord]:
        """更新因子信息"""
        if factor_id not in self._factors:
            return None
        
        record = self._factors[factor_id]
        for key, value in kwargs.items():
            if hasattr(record, key):
                setattr(record, key, value)
        
        record.updated_at = datetime.now().isoformat()
        self._save()
        return record
    
    def remove(self, factor_id: str) -> bool:
        """删除因子"""
        if factor_id in self._factors:
            del self._factors[factor_id]
            self._save()
            return True
        return False
    
    def get(self, factor_id: str) -> Optional[FactorRecord]:
        """获取因子"""
        return self._factors.get(factor_id)
    
    def exists(self, expression: str) -> bool:
        """检查因子是否已存在"""
        factor_id = self._generate_id(expression)
        return factor_id in self._factors
    
    def get_all(self) -> List[FactorRecord]:
        """获取所有因子"""
        return list(self._factors.values())
    
    def get_sorted_by_ic(self, ascending: bool = False) -> List[FactorRecord]:
        """按IC绝对值排序"""
        return sorted(
            self._factors.values(),
            key=lambda f: f.ic_abs_weighted,
            reverse=not ascending
        )
    
    def get_sorted_by_icir(self, ascending: bool = False) -> List[FactorRecord]:
        """按ICIR排序"""
        return sorted(
            self._factors.values(),
            key=lambda f: abs(f.icir),
            reverse=not ascending
        )
    
    def get_valid_factors(self) -> List[FactorRecord]:
        """获取所有有效因子"""
        return [f for f in self._factors.values() if f.ic_abs_weighted > 0]
    
    def get_best_factors(self, top_n: int = 10) -> List[FactorRecord]:
        """获取最佳因子"""
        return self.get_sorted_by_ic()[:top_n]
    
    def get_expressions(self) -> List[str]:
        """获取所有因子表达式"""
        return [f.expression for f in self._factors.values()]
    
    def get_statistics(self) -> Dict:
        """获取因子库统计信息"""
        if not self._factors:
            return {"count": 0}
        
        factors = list(self._factors.values())
        ics = [f.ic_abs_weighted for f in factors]
        icirs = [abs(f.icir) for f in factors]
        
        return {
            "count": len(factors),
            "ic_mean": sum(ics) / len(ics),
            "ic_max": max(ics),
            "ic_min": min(ics),
            "icir_mean": sum(icirs) / len(icirs),
            "icir_max": max(icirs),
            "positive_count": sum(1 for f in factors if f.direction == 1),
            "negative_count": sum(1 for f in factors if f.direction == -1),
            "avg_generation": sum(f.generation for f in factors) / len(factors),
        }
    
    def prune(self, icir_threshold: float = 0.1, decay_icir_threshold: float = 0.2, max_opt_gen: int = 1) -> Dict:
        """
        自动裁剪垃圾因子
        
        规则:
        1. |ICIR| < icir_threshold → 删除
        2. 标记衰退 + |ICIR| < decay_icir_threshold → 删除  
        3. 优化代数 > max_opt_gen → 删除
        
        Args:
            icir_threshold: ICIR最低阈值
            decay_icir_threshold: 衰退因子的ICIR阈值
            max_opt_gen: 最大优化代数
            
        Returns:
            裁剪统计 {removed, kept, reasons}
        """
        before_count = len(self._factors)
        to_remove = []
        reasons = {}
        
        for factor_id, record in self._factors.items():
            icir = abs(record.icir)
            is_decayed = '衰退' in (record.notes or '')
            opt_gen = record.name.count('_opt')
            
            # 规则1: ICIR过低
            if icir < icir_threshold:
                to_remove.append(factor_id)
                reasons['ICIR过低'] = reasons.get('ICIR过低', 0) + 1
                continue
            
            # 规则2: 衰退+ICIR不够高
            if is_decayed and icir < decay_icir_threshold:
                to_remove.append(factor_id)
                reasons['衰退+ICIR低'] = reasons.get('衰退+ICIR低', 0) + 1
                continue
            
            # 规则3: 优化代数过高
            if opt_gen > max_opt_gen:
                to_remove.append(factor_id)
                reasons[f'优化代数>{max_opt_gen}'] = reasons.get(f'优化代数>{max_opt_gen}', 0) + 1
                continue
        
        # 执行删除
        for factor_id in to_remove:
            del self._factors[factor_id]
        
        if to_remove:
            self._save()
        
        after_count = len(self._factors)
        
        stats = {
            'before': before_count,
            'after': after_count,
            'removed': len(to_remove),
            'reasons': reasons
        }
        
        if to_remove:
            print(f"[FactorLibrary] 裁剪: {before_count} → {after_count} (删除{len(to_remove)}个)")
            for reason, cnt in reasons.items():
                print(f"  - {reason}: {cnt}")
        
        return stats

    def format_summary(self) -> str:
        """格式化因子库摘要"""
        stats = self.get_statistics()
        
        if stats["count"] == 0:
            return "因子库为空"
        
        lines = [
            "=== 因子库摘要 ===",
            f"因子总数: {stats['count']}",
            f"正向因子: {stats['positive_count']}",
            f"负向因子: {stats['negative_count']}",
            "",
            "--- IC指标 ---",
            f"  IC均值: {stats['ic_mean']:.4f}",
            f"  IC最大: {stats['ic_max']:.4f}",
            f"  IC最小: {stats['ic_min']:.4f}",
            "",
            "--- ICIR指标 ---",
            f"  ICIR均值: {stats['icir_mean']:.4f}",
            f"  ICIR最大: {stats['icir_max']:.4f}",
            "",
            "--- Top 5 因子 ---",
        ]
        
        best = self.get_best_factors(5)
        for i, f in enumerate(best, 1):
            lines.append(f"  {i}. [{f.id}] {f.name}")
            lines.append(f"     IC={f.ic_abs_weighted:.4f}, ICIR={f.icir:.4f}")
            lines.append(f"     {f.expression[:60]}...")
        
        return "\n".join(lines)


# 全局实例
library = FactorLibrary()


if __name__ == "__main__":
    print("=" * 60)
    print("因子库管理测试")
    print("=" * 60)
    
    # 打印当前状态
    print(library.format_summary())
