"""
因子库管理模块 (PostgreSQL + SQLAlchemy)
==============
取代了原本的 JSON 存储，使用数据库中的 `alpha_factors` 表保存因子。
"""
import hashlib
from typing import Dict, List, Optional
from datetime import datetime

from sqlalchemy import create_engine, text
from app.config import settings
from dataclasses import dataclass

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
    ir: float
    t_stat_mean: float
    win_rate: float
    annual_return: float
    max_drawdown: float
    turnover: float
    
    # 组合指标
    fitness: float
    
    # 元数据
    variables: List[str]
    operators: List[str]
    nesting_depth: int
    created_at: str
    
    # 新增字段: 演化关系
    parent_ids: List[str]
    generation: int
    mutation_type: str

class FactorLibrary:
    """因子库管理器 (DB-backed)"""
    
    def __init__(self):
        self.engine = create_engine(settings.database_url)
    
    @staticmethod
    def _generate_id(expression: str) -> str:
        return hashlib.md5(expression.strip().encode()).hexdigest()[:12]
    
    def add(
        self,
        name: str,
        expression: str,
        metrics: any,
        variables: List[str],
        operators: List[str],
        nesting_depth: int,
        hypothesis: str = "",
        generation: int = 0,
        parent_ids: Optional[List[str]] = None,
        user_id: str = "system" # default or passed from task
    ):
        """
        添加因子到库 (数据库)
        """
        factor_id = self._generate_id(expression)
        
        with self.engine.connect() as conn:
            # check if exists
            res = conn.execute(
                text("SELECT id FROM alpha_factors WHERE id = :id"),
                {"id": factor_id}
            ).fetchone()
            
            if not res:
                conn.execute(
                    text("""
                        INSERT INTO alpha_factors (
                            id, "userId", name, expression, hypothesis, 
                            "icValue", icir, monotonicity, direction, 
                            "isValid", generation, "createdAt", "updatedAt"
                        ) VALUES (
                            :id, :userId, :name, :expression, :hypothesis,
                            :icValue, :icir, :monotonicity, :direction,
                            :isValid, :generation, NOW(), NOW()
                        )
                    """),
                    {
                        "id": factor_id,
                        "userId": user_id,
                        "name": name,
                        "expression": expression,
                        "hypothesis": hypothesis,
                        "icValue": str(metrics.ic_abs_weighted),
                        "icir": str(metrics.icir),
                        "monotonicity": str(metrics.monotonicity_score),
                        "direction": str(metrics.direction),
                        "isValid": metrics.is_valid,
                        "generation": str(generation)
                    }
                )
                conn.commit()
                
        return {"id": factor_id, "name": name}
    
    def get_expressions(self) -> List[str]:
        with self.engine.connect() as conn:
            res = conn.execute(text("SELECT expression FROM alpha_factors"))
            return [row[0] for row in res]
            
    def get_valid_factors(self) -> List[str]:
        with self.engine.connect() as conn:
            res = conn.execute(text("SELECT expression FROM alpha_factors WHERE \"isValid\" = true"))
            return [row[0] for row in res]

    def prune(self, **kwargs):
        # implement prune if needed, just a stub for now
        return {"before": 0, "after": 0, "removed": 0, "reasons": {}}
        
    def format_summary(self) -> str:
        return "因子库迁移至PostgreSQL，请在Web端查看。"

# 全局实例
library = FactorLibrary()
