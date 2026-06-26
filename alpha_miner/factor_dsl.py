"""
因子表达式 DSL 函数库
====================
提供60+个量化算子，全部基于pandas/numpy实现。
支持DataFrame输入（行=日期，列=股票代码），返回同形DataFrame。

算子分类：
- 时序算子：TS_MEAN, TS_STD, TS_MAX, TS_MIN, TS_RANK, TS_CORR, DELTA, DELAY, EMA, SMA, SUM
- 截面算子：RANK, ZSCORE, CS_MAX, CS_MIN, CS_SUM, CS_MEAN
- 数学算子：LOG, ABS, SIGN, SQRT, POW, MAX, MIN, ADD, SUB, MUL, DIV
- 条件算子：IF_THEN, WHERE
- 技术指标：RSI, MACD_DIF, MACD_DEA, MACD_HIST, KDJ_K, KDJ_D, KDJ_J, BOLL_UP, BOLL_MID, BOLL_DN, ATR, VR, BIAS, ROC, MTM, DPO, TRIX, PSY, WR, CCI, EMV

所有算子对NaN友好，不会传播无意义的NaN。
"""
import numpy as np
import pandas as pd
from typing import Union

# 类型别名
DF = pd.DataFrame
Series = pd.Series

# ============================================================
# 时序算子 (Time-Series Operators)
# ============================================================

def TS_MEAN(x: DF, d: int) -> DF:
    """d日均值"""
    return x.rolling(window=d, min_periods=max(1, d // 2)).mean()

def TS_STD(x: DF, d: int) -> DF:
    """d日标准差"""
    return x.rolling(window=d, min_periods=max(1, d // 2)).std()

def TS_MAX(x: DF, d: int) -> DF:
    """d日最大值"""
    return x.rolling(window=d, min_periods=1).max()

def TS_MIN(x: DF, d: int) -> DF:
    """d日最小值"""
    return x.rolling(window=d, min_periods=1).min()

def TS_SUM(x: DF, d: int) -> DF:
    """d日累加"""
    return x.rolling(window=d, min_periods=1).sum()

def TS_RANK(x: DF, d: int) -> DF:
    """d日时序排名百分位 (0~1)"""
    def rank_pct(arr):
        if len(arr) < 2:
            return np.nan
        return pd.Series(arr).rank(pct=True).iloc[-1]
    return x.rolling(window=d, min_periods=max(2, d // 2)).apply(rank_pct, raw=True)

def TS_CORR(x: DF, y: DF, d: int) -> DF:
    """d日滚动相关系数"""
    return x.rolling(window=d, min_periods=max(2, d // 2)).corr(y)

def TS_COV(x: DF, y: DF, d: int) -> DF:
    """d日滚动协方差"""
    return x.rolling(window=d, min_periods=max(2, d // 2)).cov(y)

def DELTA(x: DF, d: int) -> DF:
    """d日差分: x[t] - x[t-d]"""
    return x.diff(periods=d)

def DELAY(x: DF, d: int) -> DF:
    """d日延迟: x[t-d]"""
    return x.shift(periods=d)

def EMA(x: DF, d: int) -> DF:
    """指数移动平均"""
    return x.ewm(span=d, min_periods=max(1, d // 2), adjust=False).mean()

def SMA(x: DF, d: int) -> DF:
    """简单移动平均"""
    return x.rolling(window=d, min_periods=1).mean()

def WMA(x: DF, d: int) -> DF:
    """加权移动平均（近期权重更大）"""
    weights = np.arange(1, d + 1, dtype=float)
    def weighted_mean(arr):
        if len(arr) < d:
            return np.nan
        return np.average(arr, weights=weights[-len(arr):])
    return x.rolling(window=d, min_periods=d).apply(weighted_mean, raw=True)

def DECAY_LINEAR(x: DF, d: int) -> DF:
    """线性衰减加权均值"""
    weights = np.arange(1, d + 1, dtype=float)
    weights = weights / weights.sum()
    def decay_mean(arr):
        if len(arr) < d:
            return np.nan
        return np.dot(arr[-d:], weights)
    return x.rolling(window=d, min_periods=d).apply(decay_mean, raw=True)

# ============================================================
# 截面算子 (Cross-Sectional Operators)
# ============================================================

def RANK(x: DF) -> DF:
    """截面排名百分位 (0~1)，每日对所有股票排名"""
    return x.rank(axis=1, pct=True)

def ZSCORE(x: DF) -> DF:
    """截面标准化 (z-score)"""
    mean = x.mean(axis=1)
    std = x.std(axis=1)
    std = std.replace(0, np.nan)  # 避免除零
    return x.sub(mean, axis=0).div(std, axis=0)

def CS_MAX(x: DF) -> DF:
    """截面最大值（返回每行的最大值，广播到整行）"""
    return x.max(axis=1).values[:, None] * np.ones(x.shape)

def CS_MIN(x: DF) -> DF:
    """截面最小值"""
    return x.min(axis=1).values[:, None] * np.ones(x.shape)

def CS_SUM(x: DF) -> DF:
    """截面求和"""
    return x.sum(axis=1).values[:, None] * np.ones(x.shape)

def CS_MEAN(x: DF) -> DF:
    """截面均值"""
    return x.mean(axis=1).values[:, None] * np.ones(x.shape)

def CS_RANK(x: DF) -> DF:
    """等同于RANK，别名"""
    return RANK(x)

# ============================================================
# 数学算子 (Mathematical Operators)
# ============================================================

def LOG(x: DF) -> DF:
    """自然对数（处理负值）"""
    return np.log(x.clip(lower=1e-10))

def LOG10(x: DF) -> DF:
    """以10为底的对数"""
    return np.log10(x.clip(lower=1e-10))

def ABS(x: DF) -> DF:
    """绝对值"""
    return x.abs()

def SIGN(x: DF) -> DF:
    """符号函数: -1, 0, +1"""
    return np.sign(x)

def SQRT(x: DF) -> DF:
    """平方根（取绝对值后开方）"""
    return np.sqrt(x.abs())

def POW(x: DF, n: float) -> DF:
    """幂运算"""
    return x ** n

def MAX(x: Union[DF, float], y: Union[DF, float]) -> DF:
    """逐元素取较大值"""
    if isinstance(x, (int, float)):
        x = pd.DataFrame(x, index=y.index, columns=y.columns) if isinstance(y, DF) else x
    if isinstance(y, (int, float)):
        y = pd.DataFrame(y, index=x.index, columns=x.columns) if isinstance(x, DF) else y
    return np.maximum(x, y)

def MIN(x: Union[DF, float], y: Union[DF, float]) -> DF:
    """逐元素取较小值"""
    if isinstance(x, (int, float)):
        x = pd.DataFrame(x, index=y.index, columns=y.columns) if isinstance(y, DF) else x
    if isinstance(y, (int, float)):
        y = pd.DataFrame(y, index=x.index, columns=x.columns) if isinstance(x, DF) else y
    return np.minimum(x, y)

def ADD(x: DF, y: Union[DF, float]) -> DF:
    """加法"""
    return x + y

def SUB(x: DF, y: Union[DF, float]) -> DF:
    """减法"""
    return x - y

def MUL(x: DF, y: Union[DF, float]) -> DF:
    """乘法"""
    return x * y

def DIV(x: DF, y: Union[DF, float]) -> DF:
    """安全除法（避免除零）"""
    if isinstance(y, DF):
        y = y.replace(0, np.nan)
    elif y == 0:
        return pd.DataFrame(np.nan, index=x.index, columns=x.columns)
    return x / y

def NEG(x: DF) -> DF:
    """取负"""
    return -x

def MOD(x: DF, y: Union[DF, float]) -> DF:
    """取模"""
    return x % y

# ============================================================
# 条件算子 (Conditional Operators)
# ============================================================

def IF_THEN(condition: DF, x: DF, y: DF) -> DF:
    """条件选择: condition为True时取x，否则取y"""
    return pd.DataFrame(
        np.where(condition, x, y),
        index=x.index,
        columns=x.columns
    )

# 别名
IF = IF_THEN

def WHERE(condition: DF, x: DF) -> DF:
    """条件过滤: condition为True时取x，否则NaN"""
    return x.where(condition)

# ============================================================
# 技术指标 (Technical Indicators)
# ============================================================

def RSI(x: DF, d: int = 14) -> DF:
    """相对强弱指标 RSI"""
    delta = x.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1/d, min_periods=d, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/d, min_periods=d, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)

def MACD_DIF(x: DF, fast: int = 12, slow: int = 26) -> DF:
    """MACD DIF线"""
    ema_fast = x.ewm(span=fast, adjust=False).mean()
    ema_slow = x.ewm(span=slow, adjust=False).mean()
    return ema_fast - ema_slow

def MACD_DEA(x: DF, fast: int = 12, slow: int = 26, signal: int = 9) -> DF:
    """MACD DEA线"""
    dif = MACD_DIF(x, fast, slow)
    return dif.ewm(span=signal, adjust=False).mean()

def MACD_HIST(x: DF, fast: int = 12, slow: int = 26, signal: int = 9) -> DF:
    """MACD柱状图 (DIF - DEA)"""
    return MACD_DIF(x, fast, slow) - MACD_DEA(x, fast, slow, signal)

def KDJ_K(high: DF, low: DF, close: DF, n: int = 9, m1: int = 3, m2: int = 3) -> DF:
    """KDJ K值"""
    lowest_low = TS_MIN(low, n)
    highest_high = TS_MAX(high, n)
    rsv = (close - lowest_low) / (highest_high - lowest_low).replace(0, np.nan) * 100
    k = rsv.ewm(alpha=1/m1, adjust=False).mean()
    return k

def KDJ_D(high: DF, low: DF, close: DF, n: int = 9, m1: int = 3, m2: int = 3) -> DF:
    """KDJ D值"""
    k = KDJ_K(high, low, close, n, m1, m2)
    return k.ewm(alpha=1/m2, adjust=False).mean()

def KDJ_J(high: DF, low: DF, close: DF, n: int = 9, m1: int = 3, m2: int = 3) -> DF:
    """KDJ J值"""
    k = KDJ_K(high, low, close, n, m1, m2)
    d = KDJ_D(high, low, close, n, m1, m2)
    return 3 * k - 2 * d

def BOLL_UP(x: DF, d: int = 20, k: float = 2.0) -> DF:
    """布林带上轨"""
    mid = SMA(x, d)
    std = TS_STD(x, d)
    return mid + k * std

def BOLL_MID(x: DF, d: int = 20) -> DF:
    """布林带中轨"""
    return SMA(x, d)

def BOLL_DN(x: DF, d: int = 20, k: float = 2.0) -> DF:
    """布林带下轨"""
    mid = SMA(x, d)
    std = TS_STD(x, d)
    return mid - k * std

def ATR(high: DF, low: DF, close: DF, d: int = 14) -> DF:
    """平均真实波幅 ATR"""
    prev_close = close.shift(1)
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    tr = pd.DataFrame(np.maximum(np.maximum(tr1, tr2), tr3), index=close.index, columns=close.columns)
    return tr.rolling(window=d, min_periods=1).mean()

def VR(volume: DF, close: DF, d: int = 26) -> DF:
    """成交量比率 VR"""
    prev_close = close.shift(1)
    up_vol = volume.where(close > prev_close, 0)
    down_vol = volume.where(close < prev_close, 0)
    up_sum = up_vol.rolling(window=d, min_periods=1).sum()
    down_sum = down_vol.rolling(window=d, min_periods=1).sum()
    return (up_sum / down_sum.replace(0, np.nan)) * 100

def BIAS(x: DF, d: int) -> DF:
    """乖离率 BIAS"""
    ma = SMA(x, d)
    return (x - ma) / ma.replace(0, np.nan) * 100

def ROC(x: DF, d: int) -> DF:
    """变动率 ROC"""
    prev = x.shift(d)
    return (x - prev) / prev.replace(0, np.nan) * 100

def MTM(x: DF, d: int) -> DF:
    """动量指标 MTM"""
    return x - x.shift(d)

def MTM_MA(x: DF, d1: int, d2: int) -> DF:
    """MTM的移动平均"""
    return SMA(MTM(x, d1), d2)

def DPO(x: DF, d: int) -> DF:
    """去趋势价格震荡指标 DPO"""
    return x - SMA(x, d // 2 + 1).shift(d // 2 + 1)

def TRIX(x: DF, d: int) -> DF:
    """三重指数平滑移动平均 TRIX"""
    ema1 = x.ewm(span=d, adjust=False).mean()
    ema2 = ema1.ewm(span=d, adjust=False).mean()
    ema3 = ema2.ewm(span=d, adjust=False).mean()
    prev = ema3.shift(1)
    return (ema3 - prev) / prev.replace(0, np.nan) * 100

def PSY(x: DF, d: int) -> DF:
    """心理线 PSY"""
    up = (x > x.shift(1)).astype(float)
    return up.rolling(window=d, min_periods=1).sum() / d * 100

def WR(high: DF, low: DF, close: DF, d: int = 14) -> DF:
    """威廉指标 WR"""
    highest = TS_MAX(high, d)
    lowest = TS_MIN(low, d)
    return (highest - close) / (highest - lowest).replace(0, np.nan) * -100

def CCI(high: DF, low: DF, close: DF, d: int = 14) -> DF:
    """顺势指标 CCI"""
    tp = (high + low + close) / 3
    ma_tp = SMA(tp, d)
    md = tp.rolling(window=d, min_periods=1).apply(lambda x: np.mean(np.abs(x - x.mean())), raw=True)
    return (tp - ma_tp) / (0.015 * md).replace(0, np.nan)

def EMV(high: DF, low: DF, volume: DF, d: int = 14) -> DF:
    """简易波动指标 EMV"""
    mid_move = (high + low) / 2 - (high.shift(1) + low.shift(1)) / 2
    box_ratio = (volume / 1e8) / (high - low).replace(0, np.nan)
    emv = mid_move / box_ratio.replace(0, np.nan)
    return SMA(emv, d)

def OBV(close: DF, volume: DF) -> DF:
    """能量潮 OBV"""
    direction = np.sign(close.diff())
    return (direction * volume).cumsum()

def VWAP(close: DF, volume: DF, d: int = 20) -> DF:
    """成交量加权平均价"""
    return (close * volume).rolling(d, min_periods=1).sum() / volume.rolling(d, min_periods=1).sum().replace(0, np.nan)

# ============================================================
# 情绪/资金流算子
# ============================================================

def VOLUME_RATIO(volume: DF, d: int = 5) -> DF:
    """量比: 当日成交量 / 过去d日平均成交量"""
    return volume / TS_MEAN(volume, d).replace(0, np.nan)

def TURNOVER_RATE(turn: DF, d: int = 5) -> DF:
    """换手率均值"""
    return TS_MEAN(turn, d)

def AMOUNT_RATIO(amount: DF, d: int = 5) -> DF:
    """成交额比"""
    return amount / TS_MEAN(amount, d).replace(0, np.nan)

def PRICE_VOLUME_CORR(close: DF, volume: DF, d: int = 20) -> DF:
    """量价相关系数（核心因子）"""
    return TS_CORR(close, volume, d)

def UP_DOWN_RATIO(close: DF, volume: DF, d: int = 5) -> DF:
    """上涨日成交量占比"""
    up_vol = volume.where(close > close.shift(1), 0)
    total_vol = volume.rolling(d, min_periods=1).sum()
    up_sum = up_vol.rolling(d, min_periods=1).sum()
    return up_sum / total_vol.replace(0, np.nan)

# ============================================================
# 工具函数
# ============================================================

def SAFE_DIVIDE(x: DF, y: DF) -> DF:
    """安全除法"""
    return DIV(x, y)

def CLIP(x: DF, lower: float = -10.0, upper: float = 10.0) -> DF:
    """截断极端值"""
    return x.clip(lower=lower, upper=upper)

def FILLNA(x: DF, value: float = 0) -> DF:
    """填充NaN"""
    return x.fillna(value)

def SHIFT(x: DF, d: int) -> DF:
    """等同于DELAY"""
    return DELAY(x, d)

def DIFF(x: DF, d: int = 1) -> DF:
    """等同于DELTA"""
    return DELTA(x, d)

def PCT_CHANGE(x: DF, d: int = 1) -> DF:
    """百分比变化"""
    return x.pct_change(periods=d)

def CUMSUM(x: DF) -> DF:
    """累加"""
    return x.cumsum()

def CUMPROD(x: DF) -> DF:
    """累乘"""
    return x.cumprod()

# ============================================================
# 所有算子注册表（用于LLM参考）
# ============================================================

OPERATORS = {
    # 时序算子
    "TS_MEAN": {"func": TS_MEAN, "args": "x, d", "desc": "d日均值"},
    "TS_STD": {"func": TS_STD, "args": "x, d", "desc": "d日标准差"},
    "TS_MAX": {"func": TS_MAX, "args": "x, d", "desc": "d日最大值"},
    "TS_MIN": {"func": TS_MIN, "args": "x, d", "desc": "d日最小值"},
    "TS_SUM": {"func": TS_SUM, "args": "x, d", "desc": "d日累加"},
    "TS_RANK": {"func": TS_RANK, "args": "x, d", "desc": "d日时序排名百分位"},
    "TS_CORR": {"func": TS_CORR, "args": "x, y, d", "desc": "d日滚动相关系数"},
    "DELTA": {"func": DELTA, "args": "x, d", "desc": "d日差分"},
    "DELAY": {"func": DELAY, "args": "x, d", "desc": "d日延迟"},
    "EMA": {"func": EMA, "args": "x, d", "desc": "指数移动平均"},
    "SMA": {"func": SMA, "args": "x, d", "desc": "简单移动平均"},
    "WMA": {"func": WMA, "args": "x, d", "desc": "加权移动平均"},
    "DECAY_LINEAR": {"func": DECAY_LINEAR, "args": "x, d", "desc": "线性衰减加权均值"},
    # 截面算子
    "RANK": {"func": RANK, "args": "x", "desc": "截面排名百分位"},
    "ZSCORE": {"func": ZSCORE, "args": "x", "desc": "截面标准化"},
    "CS_MAX": {"func": CS_MAX, "args": "x", "desc": "截面最大值"},
    "CS_MIN": {"func": CS_MIN, "args": "x", "desc": "截面最小值"},
    "CS_SUM": {"func": CS_SUM, "args": "x", "desc": "截面求和"},
    "CS_MEAN": {"func": CS_MEAN, "args": "x", "desc": "截面均值"},
    # 数学算子
    "LOG": {"func": LOG, "args": "x", "desc": "自然对数"},
    "ABS": {"func": ABS, "args": "x", "desc": "绝对值"},
    "SIGN": {"func": SIGN, "args": "x", "desc": "符号函数"},
    "SQRT": {"func": SQRT, "args": "x", "desc": "平方根"},
    "POW": {"func": POW, "args": "x, n", "desc": "幂运算"},
    "MAX": {"func": MAX, "args": "x, y", "desc": "逐元素取较大值"},
    "MIN": {"func": MIN, "args": "x, y", "desc": "逐元素取较小值"},
    "DIV": {"func": DIV, "args": "x, y", "desc": "安全除法"},
    "NEG": {"func": NEG, "args": "x", "desc": "取负"},
    # 条件算子
    "IF_THEN": {"func": IF_THEN, "args": "condition, x, y", "desc": "条件选择"},
    "IF": {"func": IF, "args": "condition, x, y", "desc": "条件选择(别名)"},
    # 技术指标
    "RSI": {"func": RSI, "args": "x, d=14", "desc": "RSI"},
    "MACD_DIF": {"func": MACD_DIF, "args": "x", "desc": "MACD DIF线"},
    "MACD_DEA": {"func": MACD_DEA, "args": "x", "desc": "MACD DEA线"},
    "MACD_HIST": {"func": MACD_HIST, "args": "x", "desc": "MACD柱状图"},
    "KDJ_K": {"func": KDJ_K, "args": "high, low, close", "desc": "KDJ K值"},
    "KDJ_D": {"func": KDJ_D, "args": "high, low, close", "desc": "KDJ D值"},
    "KDJ_J": {"func": KDJ_J, "args": "high, low, close", "desc": "KDJ J值"},
    "BOLL_UP": {"func": BOLL_UP, "args": "x, d=20", "desc": "布林带上轨"},
    "BOLL_MID": {"func": BOLL_MID, "args": "x, d=20", "desc": "布林带中轨"},
    "BOLL_DN": {"func": BOLL_DN, "args": "x, d=20", "desc": "布林带下轨"},
    "ATR": {"func": ATR, "args": "high, low, close, d=14", "desc": "ATR"},
    "VR": {"func": VR, "args": "volume, close, d=26", "desc": "成交量比率"},
    "BIAS": {"func": BIAS, "args": "x, d", "desc": "乖离率"},
    "ROC": {"func": ROC, "args": "x, d", "desc": "变动率"},
    "MTM": {"func": MTM, "args": "x, d", "desc": "动量指标"},
    "DPO": {"func": DPO, "args": "x, d", "desc": "去趋势价格震荡"},
    "TRIX": {"func": TRIX, "args": "x, d", "desc": "三重指数平滑"},
    "PSY": {"func": PSY, "args": "x, d", "desc": "心理线"},
    "WR": {"func": WR, "args": "high, low, close, d=14", "desc": "威廉指标"},
    "CCI": {"func": CCI, "args": "high, low, close, d=14", "desc": "CCI"},
    "EMV": {"func": EMV, "args": "high, low, volume, d=14", "desc": "简易波动"},
    "OBV": {"func": OBV, "args": "close, volume", "desc": "能量潮"},
    "VWAP": {"func": VWAP, "args": "close, volume, d=20", "desc": "成交量加权均价"},
    # 资金/情绪算子
    "VOLUME_RATIO": {"func": VOLUME_RATIO, "args": "volume, d=5", "desc": "量比"},
    "TURNOVER_RATE": {"func": TURNOVER_RATE, "args": "turn, d=5", "desc": "换手率均值"},
    "AMOUNT_RATIO": {"func": AMOUNT_RATIO, "args": "amount, d=5", "desc": "成交额比"},
    "PRICE_VOLUME_CORR": {"func": PRICE_VOLUME_CORR, "args": "close, volume, d=20", "desc": "量价相关系数"},
    "UP_DOWN_RATIO": {"func": UP_DOWN_RATIO, "args": "close, volume, d=5", "desc": "上涨日成交量占比"},
    # 工具函数
    "SAFE_DIVIDE": {"func": SAFE_DIVIDE, "args": "x, y", "desc": "安全除法"},
    "CLIP": {"func": CLIP, "args": "x, lower, upper", "desc": "截断极端值"},
    "FILLNA": {"func": FILLNA, "args": "x, value", "desc": "填充NaN"},
    "PCT_CHANGE": {"func": PCT_CHANGE, "args": "x, d=1", "desc": "百分比变化"},
}

def get_operator_docs() -> str:
    """生成算子文档（供LLM参考）"""
    lines = ["可用算子列表："]
    for name, info in OPERATORS.items():
        lines.append(f"- {name}({info['args']}): {info['desc']}")
    return "\n".join(lines)


if __name__ == "__main__":
    # 简单测试
    print(f"DSL函数库共 {len(OPERATORS)} 个算子")
    print(get_operator_docs()[:500] + "...")
