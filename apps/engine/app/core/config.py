"""
Alpha Miner 配置文件
"""
import os
from pathlib import Path

# ─── 路径配置 ───
BASE_DIR = Path(__file__).parent
FACTORS_DIR = BASE_DIR / "factors"
FACTORS_DIR.mkdir(exist_ok=True)

FACTOR_LIBRARY_PATH = FACTORS_DIR / "factor_library.json"
FACTOR_VALUES_DIR = FACTORS_DIR / "values"
FACTOR_VALUES_DIR.mkdir(exist_ok=True)

# ─── 数据配置 ───
# 沪深主板股票代码前缀
SH_PREFIX = "sh.60"  # 上海主板 60xxxx
SZ_PREFIX = "sz.00"  # 深圳主板 00xxxx

# 数据时间范围
LOOKBACK_DAYS = 300  # 获取300天数据（预留计算窗口）
EVAL_START_DAYS = 250  # 评估起始（前50天用于预热指标）

# ─── 因子评估标准 ───
class FactorCriteria:
    """因子筛选标准"""
    # IC相关
    IC_ABS_THRESHOLD = 0.02          # IC加权平均绝对值 > 0.02
    IC_DIRECTION_RATIO = 0.45        # IC>0或IC<0占比 > 45%
    
    # 分组收益
    MONOTONICITY_THRESHOLD = 0.4     # 单调性得分 > 0.4（放宽，IC已够严格）
    
    # 数据质量
    MAX_NAN_RATIO = 0.3              # 单只股票NaN比例 < 30%
    MIN_STOCKS = 100                 # 有效股票数 > 100
    
    # 因子复杂度
    MAX_NESTING_DEPTH = 3            # 最大嵌套层数
    MAX_VARIABLES = 5                # 最大变量数

# ─── 进化配置 ───
class EvolutionConfig:
    """进化策略参数"""
    POPULATION_SIZE = 20             # 种群大小
    MUTATION_RATE = 0.3              # 变异概率
    CROSSOVER_RATE = 0.4             # 交叉概率
    ELITE_RATIO = 0.2                # 精英保留比例
    MAX_ROUNDS = 10                  # 最大进化轮数
    STAGNATION_THRESHOLD = 3         # 连续无改进轮数阈值

# ─── LLM配置 ───
class LLMConfig:
    """LLM相关配置"""
    MODEL = "mimo-v2.5-pro"
    API_KEY = os.environ.get("XIAOMI_API_KEY", "")
    BASE_URL = os.environ.get("XIAOMI_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1")
    
    MAX_RETRIES = 3                  # 代码执行失败最大重试次数
    TIMEOUT = 180                    # LLM调用超时(秒)
    
    # 因子生成
    FACTORS_PER_HYPOTHESIS = 3       # 每个假设生成因子数
    
    # 代码调试
    DEBUG_MAX_ATTEMPTS = 5           # 代码调试最大尝试次数
