#!/usr/bin/env python3
"""
大A趋势选股Agent - 数据采集+指标计算脚本
输出: 涨幅>3%的股票，每只包含120天时序数据 + 30+技术指标 + Alpha因子
供 LLM 分析器和图表生成器使用
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, '/opt/data/scripts')  # mytt, alpha_factor_calc, index_analysis

import baostock as bs
import pandas as pd
import numpy as np
import json
import time
import re
from datetime import datetime, timedelta
from pathlib import Path


# ─── baostock 超时保护 ───
class BaostockTimeout(Exception):
    pass

def _bs_worker(func, args, kwargs, result_queue):
    """在子进程中执行 baostock 调用"""
    try:
        result = func(*args, **kwargs)
        result_queue.put(('ok', result))
    except Exception as e:
        result_queue.put(('error', e))

def _bs_query_worker(query_func, query_args, query_kwargs, result_queue):
    """在子进程中执行 baostock 查询并迭代收集所有行数据"""
    try:
        import baostock as bs
        import sys
        import io
        # 抑制 baostock 的 stdout 输出
        old_stdout = sys.stdout
        sys.stdout = io.StringIO()
        bs.login()
        rs = query_func(*query_args, **query_kwargs)
        rows = []
        while rs.next():
            rows.append(rs.get_row_data())
        fields = rs.fields
        bs.logout()
        sys.stdout = old_stdout
        result_queue.put(('ok', (fields, rows)))
    except Exception as e:
        sys.stdout = old_stdout if 'old_stdout' in dir() else sys.__stdout__
        result_queue.put(('error', e))

def _bs_simple_worker(func, args, kwargs, result_queue):
    """在子进程中执行简单的 baostock 调用（login/logout 等）"""
    try:
        result = func(*args, **kwargs)
        result_queue.put(('ok', result))
    except Exception as e:
        result_queue.put(('error', e))

def bs_query_with_timeout(query_func, *args, timeout=30, retries=2, **kwargs):
    """带超时的 baostock 查询调用（自动在子进程中 login/logout + 迭代收集数据）"""
    import multiprocessing
    for attempt in range(retries + 1):
        result_queue = multiprocessing.Queue()
        proc = multiprocessing.Process(
            target=_bs_query_worker, args=(query_func, args, kwargs, result_queue)
        )
        proc.start()
        proc.join(timeout=timeout)
        
        if proc.is_alive():
            proc.terminate()
            proc.join(timeout=2)
            if proc.is_alive():
                proc.kill()
            if attempt < retries:
                print(f"  [!] baostock 查询超时(第{attempt+1}次，{timeout}s)，重试...", file=sys.stderr, flush=True)
            else:
                print(f"  [FAIL] baostock 查询超时，已重试{retries}次", file=sys.stderr, flush=True)
                raise BaostockTimeout(f"query timed out after {timeout}s x {retries+1} attempts")
        else:
            if not result_queue.empty():
                status, value = result_queue.get_nowait()
                if status == 'ok':
                    return value
                else:
                    if attempt < retries:
                        print(f"  [!] baostock 查询错误(第{attempt+1}次): {value}", file=sys.stderr, flush=True)
                    else:
                        raise value
            else:
                if attempt < retries:
                    print(f"  [!] baostock 查询无结果(第{attempt+1}次)，重试...", file=sys.stderr, flush=True)
                else:
                    raise BaostockTimeout("query returned no result")

def bs_call_with_timeout(func, *args, timeout=15, retries=2, **kwargs):
    """带超时的 baostock 简单调用（login/logout 等）"""
    import multiprocessing
    for attempt in range(retries + 1):
        result_queue = multiprocessing.Queue()
        proc = multiprocessing.Process(
            target=_bs_simple_worker, args=(func, args, kwargs, result_queue)
        )
        proc.start()
        proc.join(timeout=timeout)
        
        if proc.is_alive():
            proc.terminate()
            proc.join(timeout=2)
            if proc.is_alive():
                proc.kill()
            if attempt < retries:
                print(f"  [!] baostock 调用超时(第{attempt+1}次，{timeout}s)，重试...", file=sys.stderr, flush=True)
            else:
                raise BaostockTimeout(f"call timed out after {timeout}s x {retries+1} attempts")
        else:
            if not result_queue.empty():
                status, value = result_queue.get_nowait()
                if status == 'ok':
                    return value
                else:
                    raise value
            else:
                raise BaostockTimeout("call returned no result")


# 数据缓存目录（与 alpha_miner 共享缓存策略）
CACHE_DIR = Path("/opt/data/cache")
CACHE_TTL_HOURS = 20  # 缓存有效期

from mytt import (
    MA, EMA, SMA, STD, HHV, LLV, REF, DIFF, ABS, MAX, MIN, SUM, IF, COUNT,
    MACD, KDJ, RSI, BOLL, DMI, VR, BRAR, ROC, MTM, DPO, TRIX, PSY, WR,
    BIAS, CCI, ATR, EMV, RD
)

# 导入Alpha因子计算模块
from alpha_factor_calc import load_alpha_factors, calc_alpha_score, get_alpha_factor_info

# 导入指数分析模块
from index_analysis import analyze_index

# 数据缓存目录（与 alpha_miner 共享缓存策略）
CACHE_DIR = Path("/opt/data/cache")
CACHE_TTL_HOURS = 20  # 缓存有效期


def _cache_path(key: str) -> Path:
    """生成缓存文件路径"""
    return CACHE_DIR / f"{key}.pkl"


def _cache_fresh(key: str) -> bool:
    """检查缓存是否在有效期内"""
    p = _cache_path(key)
    if not p.exists():
        return False
    age_hours = (time.time() - p.stat().st_mtime) / 3600
    return age_hours < CACHE_TTL_HOURS


def _cache_load(key: str):
    """加载缓存数据"""
    p = _cache_path(key)
    age_hours = (time.time() - p.stat().st_mtime) / 3600
    print(f"  [Cache] 命中 {key} ({age_hours:.1f}h前)", file=sys.stderr, flush=True)
    return pd.read_pickle(p)


def _cache_save(key: str, df):
    """保存数据到缓存（pickle格式，支持混合类型DataFrame）"""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p = _cache_path(key)
    df.to_pickle(p)
    print(f"  [Cache] 已保存 {key} ({p.stat().st_size/1024:.0f}KB)", file=sys.stderr, flush=True)


# ─── HDF5 数据加载（替代 baostock 逐只查询）───
HDF5_PATH = "/opt/data/alpha_miner/factors/market_data.h5"

def load_from_hdf5(trade_day, gain_threshold=3.0, lookback=120, load_all=False):
    """从 alpha_miner 的 HDF5 缓存加载数据，返回 (kdf, gainer_codes, name_map)
    
    Args:
        trade_day: 交易日期 YYYY-MM-DD
        gain_threshold: 涨幅阈值
        lookback: 回看天数
        load_all: True=加载所有股票数据（用于MA5全市场扫描），False=仅加载涨幅股
    
    Returns:
        kdf: DataFrame with columns [date, code, open, high, low, close, volume, amount, pctChg, turn]
        gainer_codes: list of codes with pctChg > threshold on trade_day
        name_map: dict (empty, HDF5 doesn't have names)
    """
    import time as _time
    t0 = _time.time()
    
    if not os.path.exists(HDF5_PATH):
        return None, [], {}
    
    store = pd.HDFStore(HDF5_PATH, mode='r')
    
    # 检查日期是否在数据范围内
    pctChg_df = store['/pctChg']
    available_dates = pctChg_df.index
    
    # 找到 trade_day 对应的日期
    trade_ts = pd.Timestamp(trade_day)
    if trade_ts not in available_dates:
        # 尝试最近的交易日
        valid_dates = available_dates[available_dates <= trade_ts]
        if len(valid_dates) == 0:
            store.close()
            return None, [], {}
        trade_ts = valid_dates[-1]
        print(f"  [HDF5] 使用最近交易日: {trade_ts.date()}", file=sys.stderr, flush=True)
    
    # 获取涨幅>阈值的股票
    today_pct = pctChg_df.loc[trade_ts]
    gainer_codes = today_pct[today_pct > gain_threshold].dropna().index.tolist()
    print(f"  [HDF5] 涨幅>{gain_threshold}%: {len(gainer_codes)} 只 ({_time.time()-t0:.1f}s)", file=sys.stderr, flush=True)
    
    if not gainer_codes:
        store.close()
        return None, [], {}
    
    # 取 lookback 天数据
    date_idx = available_dates.get_loc(trade_ts)
    start_idx = max(0, date_idx - lookback + 1)
    dates = available_dates[start_idx:date_idx + 1]
    
    # 确定要加载的股票列表
    if load_all:
        # 加载所有股票（用于MA5全市场扫描）
        all_codes = pctChg_df.columns.tolist()
        # 过滤主板股票
        load_codes = [c for c in all_codes if c.startswith(("sh.60", "sz.00")) and len(c) <= 10]
        print(f"  [HDF5] 加载全部 {len(load_codes)} 只股票数据...", file=sys.stderr, flush=True)
    else:
        load_codes = gainer_codes
    
    # 向量化构造 kdf（使用 stack 高效转换）
    fields = ['open', 'high', 'low', 'close', 'volume', 'amount', 'pctChg', 'turn']
    dfs = {}
    for field in fields:
        df = store[f'/{field}']
        dfs[field] = df.loc[dates, [c for c in load_codes if c in df.columns]]
    
    store.close()
    
    # 使用 stack 高效构造长格式 DataFrame
    kdf_parts = []
    for field in fields:
        stacked = dfs[field].stack()
        stacked.name = field
        kdf_parts.append(stacked)
    
    kdf = pd.concat(kdf_parts, axis=1).reset_index()
    kdf.columns = ['date', 'code'] + fields
    kdf['date'] = kdf['date'].apply(lambda x: str(x.date()) if hasattr(x, 'date') else str(x)[:10])
    
    print(f"  [HDF5] kdf 构造完成: {len(kdf)} 行, {kdf['code'].nunique()} 只 ({_time.time()-t0:.1f}s)", file=sys.stderr, flush=True)
    
    return kdf, gainer_codes, {}


GAIN_THRESHOLD = 3.0
TOP_N = 999
LOOKBACK_DAYS = 120


def get_last_trading_day():
    today = datetime.now()
    if today.weekday() == 5:
        today -= timedelta(days=1)
    elif today.weekday() == 6:
        today -= timedelta(days=2)
    return today.strftime("%Y-%m-%d")


def calc_all_indicators(df):
    def DMA_IND(C, N1=10, N2=50, M=10):
        d = MA(C, N1) - MA(C, N2)
        return d, MA(d, M)
    """计算全部30+技术指标，使用MyTT库"""
    C = df['close'].values.astype(float)
    H = df['high'].values.astype(float)
    L = df['low'].values.astype(float)
    O = df['open'].values.astype(float)
    V = df['volume'].values.astype(float)

    # 均线
    MA5 = MA(C, 5)
    MA10 = MA(C, 10)
    MA20 = MA(C, 20)
    MA60 = MA(C, 60)

    # MACD
    DIF, DEA, MACD_VAL = MACD(C)

    # KDJ
    K, D, J = KDJ(C, H, L)

    # RSI
    RSI_VAL = RSI(C)

    # BOLL
    BOLL_UP, BOLL_MID, BOLL_DN = BOLL(C)

    # DMI
    PDI, MDI, ADX_VAL, ADXR_VAL = DMI(C, H, L)

    # 成交量指标
    VR_VAL = VR(C, V)
    AR_VAL, BR_VAL = BRAR(O, C, H, L)

    # 动量指标
    ROC_VAL, MAROC_VAL = ROC(C)
    MTM_VAL, MTMMA_VAL = MTM(C)

    # 区间振荡
    DPO_VAL, MADPO_VAL = DPO(C)

    # 三重平滑
    TRIX_VAL, TRMA_VAL = TRIX(C)

    # 心理线
    PSY_VAL, PSYMA_VAL = PSY(C)

    # 威廉指标
    WR_VAL, WR1_VAL = WR(C, H, L)

    # 乖离率
    BIAS1, BIAS2, BIAS3 = BIAS(C)

    # 顺势指标
    CCI_VAL = CCI(C, H, L)

    # 真实波幅
    ATR_VAL = ATR(C, H, L)

    # 简易波动
    EMV_VAL, MAEMV_VAL = EMV(H, L, V)

    # 平行线差
    DIF_DMA, DIFMA_DMA = DMA_IND(C)

    # 量比 (5日均量比)
    VOL_MA5 = MA(V, 5)
    VOL_RATIO = np.where(VOL_MA5 > 0, V / VOL_MA5, np.nan)

    # 换手率 (从原始数据取)
    turn = df['turn'].values.astype(float) if 'turn' in df.columns else np.full(len(C), np.nan)

    return {
        # 原始OHLCV数据（供Alpha因子计算使用，key必须小写）
        'close': C, 'open': O, 'high': H, 'low': L, 'volume': V,
        'turn': turn, 'amount': df['amount'].values.astype(float) if 'amount' in df.columns else np.full(len(C), np.nan),
        # 技术指标
        'MA5': MA5, 'MA10': MA10, 'MA20': MA20, 'MA60': MA60,
        'DIF': DIF, 'DEA': DEA, 'MACD': MACD_VAL,
        'K': K, 'D': D, 'J': J,
        'RSI': RSI_VAL,
        'BOLL_UP': BOLL_UP, 'BOLL_MID': BOLL_MID, 'BOLL_DN': BOLL_DN,
        'PDI': PDI, 'MDI': MDI, 'ADX': ADX_VAL, 'ADXR': ADXR_VAL,
        'VR': VR_VAL, 'AR': AR_VAL, 'BR': BR_VAL,
        'ROC': ROC_VAL, 'MAROC': MAROC_VAL,
        'MTM': MTM_VAL, 'MTMMA': MTMMA_VAL,
        'DPO': DPO_VAL, 'MADPO': MADPO_VAL,
        'TRIX': TRIX_VAL, 'TRMA': TRMA_VAL,
        'PSY': PSY_VAL, 'PSYMA': PSYMA_VAL,
        'WR': WR_VAL, 'WR1': WR1_VAL,
        'BIAS1': BIAS1, 'BIAS2': BIAS2, 'BIAS3': BIAS3,
        'CCI': CCI_VAL, 'ATR': ATR_VAL,
        'EMV': EMV_VAL, 'MAEMV': MAEMV_VAL,
        'VOL_RATIO': VOL_RATIO, 'TURN': turn,
    }


def safe_round(val, decimals=2):
    """安全四舍五入，处理nan/None"""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    return round(float(val), decimals)


def build_time_series(df, indicators, lookback=60):
    """构建逐日时序数据（最近lookback天）"""
    dates = df['date'].tolist()
    total = len(dates)
    start_idx = max(0, total - lookback)

    series = []
    for i in range(start_idx, total):
        day = {
            'date': dates[i],
            'open': safe_round(df['open'].iloc[i]),
            'close': safe_round(df['close'].iloc[i]),
            'high': safe_round(df['high'].iloc[i]),
            'low': safe_round(df['low'].iloc[i]),
            'volume': int(df['volume'].iloc[i]) if not pd.isna(df['volume'].iloc[i]) else 0,
        }
        # 添加所有指标
        for key, arr in indicators.items():
            if i < len(arr):
                v = arr[i]
                decimals = 4 if key in ('DIF', 'DEA', 'MACD') else 2
                day[key] = safe_round(v, decimals)
        series.append(day)

    return series


def build_market_trend(df):
    """计算市场趋势摘要"""
    closes = df['close'].values.astype(float)
    highs = df['high'].values.astype(float)
    lows = df['low'].values.astype(float)

    if len(closes) < 2:
        return {}

    latest = closes[-1]
    prev = closes[-2]
    week_ago = closes[-6] if len(closes) > 5 else prev
    month_ago = closes[-21] if len(closes) > 20 else prev

    return {
        '日涨跌幅': f'{((latest - prev) / prev * 100):.2f}%',
        '周涨跌幅': f'{((latest - week_ago) / week_ago * 100):.2f}%',
        '月涨跌幅': f'{((latest - month_ago) / month_ago * 100):.2f}%',
        '最新收盘价': safe_round(latest),
        '区间最高价': safe_round(np.max(highs[-60:])),
        '区间最低价': safe_round(np.min(lows[-60:])),
    }


def calc_boll_r2(closes, period=20):
    """R² of linear regression over BOLL period.
    Returns (r2, direction): r2 in [0,1], direction +1/-1.
    R²→1: price follows a straight line (strong trend)
    R²→0: price is noisy (oscillation, no direction)
    """
    if len(closes) < period:
        return 0.0, 0.0
    y = closes[-period:]
    x = np.arange(period, dtype=float)
    n = period
    sx, sy = x.sum(), y.sum()
    sx2 = (x * x).sum()
    sxy = (x * y).sum()
    denom = n * sx2 - sx * sx
    if denom == 0:
        return 0.0, 0.0
    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    y_pred = slope * x + intercept
    ss_res = ((y - y_pred) ** 2).sum()
    y_mean = y.mean()
    ss_tot = ((y - y_mean) ** 2).sum()
    if ss_tot == 0:
        return 1.0 if ss_res == 0 else 0.0, 0.0
    r2 = 1.0 - ss_res / ss_tot
    direction = 1.0 if slope >= 0 else -1.0
    return round(float(r2), 4), round(float(direction), 0)


def classify_strategy(boll_r2, boll_direction, signals):
    """根据趋势强度和信号判断适用策略
    
    返回: {
        'type': '趋势跟踪' | '均值回归' | '技术指标',
        'reason': '策略选择理由',
        'entry': '入场条件',
        'stop_loss': '止损条件',
        'exit': '出场条件'
    }
    """
    # 判断是否超卖（均值回归信号）
    oversold_signals = ['KDJ超卖', 'RSI超卖', '触及BOLL下轨']
    is_oversold = any(s in signals for s in oversold_signals)
    
    # 判断是否趋势信号
    trend_signals = ['多头排列', 'MACD金叉', 'PDI>MDI']
    trend_count = sum(1 for s in trend_signals if s in signals)
    
    if boll_r2 > 0.7 and boll_direction == 1:
        # 强上升趋势 → 趋势跟踪
        return {
            'type': '趋势跟踪',
            'reason': f'强上升趋势(R²={boll_r2:.2f})，均线多头排列',
            'entry': '回踩MA10不破买入',
            'stop_loss': '跌破MA20止损',
            'exit': 'MA死叉或MACD顶背离卖出'
        }
    elif boll_r2 > 0.7 and boll_direction == -1:
        # 强下降趋势 → 回避或做空
        return {
            'type': '回避',
            'reason': f'强下降趋势(R²={boll_r2:.2f})，不宜做多',
            'entry': '不建议买入',
            'stop_loss': 'N/A',
            'exit': 'N/A'
        }
    elif boll_r2 < 0.3 and is_oversold:
        # 震荡市 + 超卖 → 均值回归
        return {
            'type': '均值回归',
            'reason': f'震荡市(R²={boll_r2:.2f})+超卖信号，适合均值回归',
            'entry': 'RSI<30 + 触及BOLL下轨买入',
            'stop_loss': '跌破BOLL下轨2%止损',
            'exit': '触及BOLL上轨卖出'
        }
    elif boll_r2 < 0.3:
        # 震荡市 → 技术指标
        return {
            'type': '技术指标',
            'reason': f'震荡市(R²={boll_r2:.2f})，适合技术指标操作',
            'entry': '站上BOLL中轨 + 量比>1.5买入',
            'stop_loss': '跌破BOLL中轨止损',
            'exit': '触及BOLL上轨卖出'
        }
    elif trend_count >= 2:
        # 中等趋势 + 趋势信号 → 趋势跟踪
        return {
            'type': '趋势跟踪',
            'reason': f'中等趋势(R²={boll_r2:.2f})+{trend_count}个趋势信号',
            'entry': '多头排列 + 量能配合买入',
            'stop_loss': '跌破MA20止损',
            'exit': '趋势转弱卖出'
        }
    else:
        # 默认 → 技术指标
        return {
            'type': '技术指标',
            'reason': f'中等波动(R²={boll_r2:.2f})，综合判断',
            'entry': '站上BOLL中轨 + 量比>1.5买入',
            'stop_loss': '跌破BOLL中轨止损',
            'exit': '触及BOLL上轨卖出'
        }


def calc_quant_score(indicators):
    """量化评分（用于排序筛选）"""
    n = len(indicators.get('MA5', []))
    if n < 10:
        return -999, {}

    # 取最新值
    def last(key):
        v = indicators.get(key, [None])[-1]
        return v if v is not None and not (isinstance(v, float) and np.isnan(v)) else None

    score = 0
    signals = []

    # 多头排列
    ma5, ma10, ma20 = last('MA5'), last('MA10'), last('MA20')
    if ma5 and ma10 and ma20 and ma5 > ma10 > ma20:
        score += 2; signals.append('多头排列')

    # MACD
    dif, dea = last('DIF'), last('DEA')
    if dif and dif > 0:
        score += 1; signals.append('MACD>0')
    # MACD金叉 (近3天内)
    dif_arr = indicators.get('DIF', [])
    dea_arr = indicators.get('DEA', [])
    if len(dif_arr) >= 3:
        for j in range(-3, 0):
            if (dif_arr[j] is not None and dea_arr[j] is not None and
                dif_arr[j-1] is not None and dea_arr[j-1] is not None and
                dif_arr[j] > dea_arr[j] and dif_arr[j-1] <= dea_arr[j-1]):
                score += 2; signals.append('MACD金叉'); break

    # KDJ
    k, d, j = last('K'), last('D'), last('J')
    if k and d and j:
        if k > d:
            score += 1
        if j > 80:
            score -= 1; signals.append('KDJ超买')
        if j < 20:
            signals.append('KDJ超卖')

    # BOLL
    close = last('close') if 'close' in indicators else None
    boll_mid, boll_up = last('BOLL_MID'), last('BOLL_UP')
    if close and boll_mid and close > boll_mid:
        score += 1; signals.append('站上BOLL中轨')
    if close and boll_up and close > boll_up:
        score += 1; signals.append('突破BOLL上轨')

    # RSI
    rsi = last('RSI')
    if rsi and rsi > 70:
        score -= 1; signals.append('RSI超买')
    if rsi and rsi < 30:
        signals.append('RSI超卖')

    # DMI
    pdi, mdi = last('PDI'), last('MDI')
    if pdi and mdi and pdi > mdi:
        score += 1; signals.append('PDI>MDI')

    # CCI
    cci = last('CCI')
    if cci and cci > 100:
        signals.append('CCI强势')

    return score, signals


def detect_ma5_strategy(df, indicators):
    """五日线战法信号检测
    
    核心逻辑（三步确认法）：
    1. 趋势：股价站上5日均线
    2. 资金：连续3个交易日放量
    3. 确认：7个交易日内出现1-2次巨量（>=1.45倍前期均量）
    
    二波主升浪信号：
    - 股价回到5日线附近（偏离不超过4.5%）
    - 再次放出巨量
    
    Returns:
        (bool, list[str]): (是否触发信号, 信号详情列表)
    """
    closes = df['close'].values.astype(float)
    volumes = df['volume'].values.astype(float)
    n = len(closes)
    
    if n < 15:
        return False, []
    
    # --- 基础数据准备 ---
    ma5_arr = indicators.get('MA5', [])
    if len(ma5_arr) < 5:
        return False, []
    
    latest_close = closes[-1]
    latest_ma5 = ma5_arr[-1]
    
    if latest_ma5 is None or np.isnan(latest_ma5) or latest_ma5 <= 0:
        return False, []
    
    signals = []
    passed_conditions = []
    
    # ─── 条件1：趋势 ───
    # 股价必须站上5日均线
    above_ma5 = latest_close >= latest_ma5
    if not above_ma5:
        return False, []
    passed_conditions.append("趋势")
    
    # ─── 条件2：资金（连续3日放量） ───
    # 放量定义：当日成交量 > 前一日成交量
    if n < 5:
        return False, []
    
    vol_increase_streak = 0
    for i in range(-1, -4, -1):  # 最近3天
        if i - 1 < -n:
            break
        if volumes[i] > volumes[i - 1] and volumes[i] > 0:
            vol_increase_streak += 1
        else:
            break
    
    continuous_volume = vol_increase_streak >= 3
    if not continuous_volume:
        # 不满足连续放量，但检查是否满足二波主升浪条件
        pass
    else:
        passed_conditions.append("资金")
    
    # ─── 条件3：确认（7日内出现1-2次巨量） ───
    # 巨量 = 成交量 >= 前期均量的1.45倍
    # 前期均量 = 近7日之前的10日均量
    lookback_start = max(0, n - 17)  # 前10日（用于计算基准均量）
    recent_7_start = max(0, n - 7)
    
    if lookback_start < recent_7_start:
        base_avg_vol = np.mean(volumes[lookback_start:recent_7_start])
    else:
        base_avg_vol = np.mean(volumes[max(0, n - 10):n - 7]) if n > 10 else np.mean(volumes)
    
    huge_vol_count = 0
    if base_avg_vol > 0:
        for i in range(recent_7_start, n):
            if volumes[i] >= base_avg_vol * 1.45:
                huge_vol_count += 1
    
    huge_volume = 1 <= huge_vol_count <= 2
    if huge_volume:
        passed_conditions.append("确认")
    
    # ─── 二波主升浪检测 ───
    second_wave = False
    deviation_pct = abs(latest_close - latest_ma5) / latest_ma5 * 100
    
    if deviation_pct <= 4.5:
        # 价格偏离5日线不超过4.5%
        # 检查最近是否有巨量出现
        if huge_vol_count >= 1:
            # 检查之前是否有过一次突破失败或回踩（价格曾高于MA5后回落到MA5附近）
            # 简化判断：最近10天内最高价远离MA5超过8%，现在回到MA5附近
            recent_10_highs = closes[max(0, n - 10):n]
            recent_10_ma5 = ma5_arr[max(0, len(ma5_arr) - 10):]
            
            had_breakout = False
            for i, (h, m) in enumerate(zip(recent_10_highs, recent_10_ma5)):
                if m is not None and not np.isnan(m) and m > 0:
                    if (h - m) / m * 100 > 8:
                        had_breakout = True
                        break
            
            if had_breakout:
                second_wave = True
                signals.append("二波主升浪")
    
    # ─── 综合判定 ───
    # 三步确认法全部满足
    if len(passed_conditions) >= 3:  # 趋势 + 资金 + 确认
        signals.insert(0, "五日线战法")
        return True, signals
    
    # 二波主升浪信号
    if second_wave:
        return True, signals
    
    return False, []


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="指定交易日期 YYYY-MM-DD")
    parser.add_argument("--top", type=int, default=0, help="LLM分析的股票数量（按评分排序，0=全部）")
    parser.add_argument("--watchlist", help="自选股配置JSON路径（可选）")
    args = parser.parse_args()

    if args.date:
        trade_day = args.date
    else:
        trade_day = get_last_trading_day()
        if datetime.now().weekday() >= 5:
            print(json.dumps({"error": "周末非交易日", "date": trade_day}, ensure_ascii=False))
            return

    t_start = time.time()
    
    # 加载Alpha因子库
    print("  加载Alpha因子库...", file=sys.stderr, flush=True)
    alpha_factors = load_alpha_factors()
    print(f"  加载了 {len(alpha_factors)} 个有效Alpha因子", file=sys.stderr, flush=True)

    # 加载自选股配置
    watchlist_items = []
    watchlist_codes = []
    if args.watchlist and os.path.exists(args.watchlist):
        with open(args.watchlist) as f:
            wl_conf = json.load(f)
        for item in wl_conf.get("stocks", []):
            code = item.get("code", "").strip()
            if code and (code.startswith("sh.") or code.startswith("sz.")):
                watchlist_items.append(item)
                watchlist_codes.append(code)
        if watchlist_codes:
            print(f"  加载 {len(watchlist_codes)} 只自选股", file=sys.stderr, flush=True)
    
    # 股票列表（优先从 alpha_miner HDF5 缓存获取，绕过 query_all_stock 阻塞问题）
    stock_list_key = "stock_list_main"
    
    # 方案1: 从 alpha_miner 的 HDF5 缓存获取股票代码列表
    hdf5_path = "/opt/data/alpha_miner/factors/market_data.h5"
    codes = []
    name_map = {}
    
    if os.path.exists(hdf5_path):
        try:
            store = pd.HDFStore(hdf5_path, mode='r')
            if '/close' in store:
                close_df = store['/close']
                codes = list(close_df.columns)
                print(f"  股票列表: 从 HDF5 缓存获取 {len(codes)} 只股票", file=sys.stderr, flush=True)
            store.close()
        except Exception as e:
            print(f"  [!] HDF5 读取失败: {e}", file=sys.stderr, flush=True)
    
    # 方案2: 从本地缓存获取
    if not codes and _cache_fresh(stock_list_key):
        print("  股票列表: 使用本地缓存...", file=sys.stderr, flush=True)
        main_stocks = _cache_load(stock_list_key)
        name_map = dict(zip(main_stocks["code"], main_stocks.get("code_name", main_stocks["code"])))
        codes = main_stocks["code"].tolist()
    
    # 方案3: 尝试 query_all_stock（带超时）
    if not codes:
        print("  股票列表: 尝试 query_all_stock...", file=sys.stderr, flush=True)
        try:
            fields, stocks = bs_query_with_timeout(bs.query_all_stock, day=trade_day, timeout=60, retries=2)
            all_df = pd.DataFrame(stocks, columns=fields)
            mask = (
                all_df["code"].str.match(r"^(sh\\.60|sz\\.00)\\d{4}$") &
                (all_df["code"].str.len() <= 10) &
                (~all_df["code_name"].str.contains("ST", na=False))
            )
            main_stocks = all_df[mask]
            _cache_save(stock_list_key, main_stocks)
            name_map = dict(zip(main_stocks["code"], main_stocks["code_name"]))
            codes = main_stocks["code"].tolist()
            print(f"  股票列表: 获取 {len(codes)} 只主板股票", file=sys.stderr, flush=True)
        except (BaostockTimeout, Exception) as e:
            print(f"  [!] query_all_stock 失败: {e}", file=sys.stderr, flush=True)
            # 尝试过期缓存
            p = _cache_path(stock_list_key)
            if p.exists():
                main_stocks = _cache_load(stock_list_key)
                name_map = dict(zip(main_stocks["code"], main_stocks.get("code_name", main_stocks["code"])))
                codes = main_stocks["code"].tolist()
    
    if not codes:
        print("  [FAIL] 无可用股票列表，退出", file=sys.stderr, flush=True)
        return
    
    # 过滤主板股票（如果从 HDF5 获取的未过滤）
    if not name_map:
        # HDF5 中的代码已经是 sh.60xxxx 格式的主板股票
        # 过滤掉非主板代码
        codes = [c for c in codes if c.startswith(("sh.60", "sz.00")) and len(c) <= 10]
        print(f"  过滤后: {len(codes)} 只主板股票", file=sys.stderr, flush=True)
        
        # 从 baostock 缓存或查询获取股票名称
        name_cache_key = "stock_name_map"
        if _cache_fresh(name_cache_key):
            name_map = _cache_load(name_cache_key)
            print(f"  股票名称: 从缓存加载 {len(name_map)} 只", file=sys.stderr, flush=True)
        else:
            try:
                import io as _io
                _old_stdout = sys.stdout
                sys.stdout = sys.stderr
                bs.login()
                sys.stdout = _old_stdout
                fields, stocks = bs_query_with_timeout(bs.query_all_stock, day=trade_day, timeout=60, retries=2)
                all_df = pd.DataFrame(stocks, columns=fields)
                name_map = dict(zip(all_df["code"], all_df["code_name"]))
                _cache_save(name_cache_key, name_map)
                bs.logout()
                print(f"  股票名称: 从 baostock 查询 {len(name_map)} 只", file=sys.stderr, flush=True)
            except Exception as e:
                print(f"  [!] 股票名称查询失败: {e}", file=sys.stderr, flush=True)

    # Phase 1 + Phase 2: 优先从 HDF5 加载，跳过 baostock 逐只查询
    t_data_start = time.time()
    kdf = None
    gainer_codes = []
    # 保留已有的 name_map（从上面的股票列表获取阶段得到）
    
    # 尝试从 HDF5 加载（快速，~8秒）
    hdf5_kdf, hdf5_gainers, hdf5_names = load_from_hdf5(trade_day, GAIN_THRESHOLD, LOOKBACK_DAYS, load_all=True)
    
    if hdf5_kdf is not None and len(hdf5_gainers) > 0:
        kdf = hdf5_kdf
        gainer_codes = hdf5_gainers
        # hdf5_names 为空，不覆盖已有的 name_map
        print(f"  [HDF5] 跳过 baostock 查询，直接使用缓存数据", file=sys.stderr, flush=True)
        
        # 分析上证指数（使用独立的 baostock 子进程）
        print("  分析上证指数...", file=sys.stderr, flush=True)
        index_analysis = analyze_index('sh.000001', 120)
        print(f"  上证指数: {index_analysis.get('close', 'N/A')}", file=sys.stderr, flush=True)
    else:
        # 回退到 baostock 查询
        print(f"  [HDF5] 无数据，回退到 baostock...", file=sys.stderr, flush=True)
        
        # 主进程登录 baostock
        import io
        _old_stdout = sys.stdout
        sys.stdout = sys.stderr
        bs.login()
        sys.stdout = _old_stdout

        # 分析上证指数
        print("  分析上证指数...", file=sys.stderr, flush=True)
        index_analysis = analyze_index('sh.000001', 120)
        print(f"  上证指数: {index_analysis.get('close', 'N/A')}", file=sys.stderr, flush=True)

        # Phase 1: 拉取当天数据
        phase1_key = f"stock_daily_{trade_day}"
        if _cache_fresh(phase1_key):
            day_df = _cache_load(phase1_key)
        else:
            print(f"  Phase 1: 拉取{trade_day}行情...", file=sys.stderr, flush=True)
            day_results = []
            for i, code in enumerate(codes):
                try:
                    rs2 = bs.query_history_k_data_plus(
                        code, "date,code,open,high,low,close,volume,amount,pctChg,turn",
                        start_date=trade_day, end_date=trade_day, frequency="d", adjustflag="2"
                    )
                    while rs2.next():
                        day_results.append(rs2.get_row_data())
                except:
                    continue
                if (i + 1) % 500 == 0:
                    print(f"  进度: {i+1}/{len(codes)}", file=sys.stderr, flush=True)
            day_df = pd.DataFrame(day_results, columns=["date","code","open","high","low","close","volume","amount","pctChg","turn"])
            for col in ["open","high","low","close","volume","amount","pctChg","turn"]:
                day_df[col] = pd.to_numeric(day_df[col], errors="coerce")
            _cache_save(phase1_key, day_df)

        gainer_codes = day_df[day_df["pctChg"] > GAIN_THRESHOLD]["code"].tolist()

        # Phase 2: 拉取历史数据
        phase2_codes = list(set(gainer_codes + watchlist_codes))
        phase2_key = f"stock_gainers_{trade_day}"
        if _cache_fresh(phase2_key):
            kdf = _cache_load(phase2_key)
        else:
            print(f"  Phase 2: 拉取{len(phase2_codes)}只股票120天历史...", file=sys.stderr, flush=True)
            start_date = (datetime.strptime(trade_day, "%Y-%m-%d") - timedelta(days=LOOKBACK_DAYS + 10)).strftime("%Y-%m-%d")
            results = []
            for i, code in enumerate(phase2_codes):
                try:
                    rs2 = bs.query_history_k_data_plus(
                        code, "date,code,open,high,low,close,volume,amount,pctChg,turn",
                        start_date=start_date, end_date=trade_day, frequency="d", adjustflag="2"
                    )
                    while rs2.next():
                        results.append(rs2.get_row_data())
                except:
                    continue
            kdf = pd.DataFrame(results, columns=["date","code","open","high","low","close","volume","amount","pctChg","turn"])
            for col in ["open","high","low","close","volume","amount","pctChg","turn"]:
                kdf[col] = pd.to_numeric(kdf[col], errors="coerce")
            _cache_save(phase2_key, kdf)

        bs.logout()

    # 合并自选股（如果需要额外拉取）
    if watchlist_codes and kdf is not None:
        existing_codes = set(kdf['code'].unique())
        extra_codes = [c for c in watchlist_codes if c not in existing_codes]
        if extra_codes:
            print(f"  自选股额外需拉取: {len(extra_codes)} 只", file=sys.stderr, flush=True)
            # 从 baostock 拉取这些自选股的数据
            try:
                import io
                _old_stdout = sys.stdout
                sys.stdout = sys.stderr
                bs.login()
                sys.stdout = _old_stdout
                start_date = (datetime.strptime(trade_day, "%Y-%m-%d") - timedelta(days=LOOKBACK_DAYS + 10)).strftime("%Y-%m-%d")
                extra_results = []
                for code in extra_codes:
                    try:
                        rs2 = bs.query_history_k_data_plus(
                            code, "date,code,open,high,low,close,volume,amount,pctChg,turn",
                            start_date=start_date, end_date=trade_day, frequency="d", adjustflag="2"
                        )
                        while rs2.next():
                            extra_results.append(rs2.get_row_data())
                    except:
                        continue
                bs.logout()
                if extra_results:
                    extra_df = pd.DataFrame(extra_results, columns=["date","code","open","high","low","close","volume","amount","pctChg","turn"])
                    for col in ["open","high","low","close","volume","amount","pctChg","turn"]:
                        extra_df[col] = pd.to_numeric(extra_df[col], errors="coerce")
                    kdf = pd.concat([kdf, extra_df], ignore_index=True)
            except:
                pass

    # 主进程退出 baostock（抑制 stdout 输出）
    import io as _io
    _old = sys.stdout
    sys.stdout = _io.StringIO()
    try:
        bs.logout()
    except:
        pass
    sys.stdout = _old

    t_data = round(time.time() - t_data_start, 1)
    total_stocks = kdf['code'].nunique() if kdf is not None else 0
    print(f"  数据采集完成: {total_stocks}只, 耗时{t_data}秒", file=sys.stderr, flush=True)

    kdf_sorted = kdf.sort_values("date")
    counts = kdf_sorted.groupby("code").size()
    valid_codes = counts[counts >= 30].index  # 至少30天数据

    latest = kdf_sorted[kdf_sorted["code"].isin(valid_codes)].groupby("code").last().reset_index()
    gainers = latest[latest["pctChg"] > GAIN_THRESHOLD].copy()
    gainers = gainers.sort_values("pctChg", ascending=False).head(TOP_N)

    # 为每只股票计算指标 + 构建时序 + Alpha因子
    t_calc = time.time()
    stock_reports = []
    for idx, (_, row) in enumerate(gainers.iterrows()):
        code = row["code"]
        code_short = code.replace("sh.", "").replace("sz.", "")
        name = name_map.get(code, "?")

        stock_df = kdf_sorted[kdf_sorted["code"] == code].copy().reset_index(drop=True)
        if len(stock_df) < 30:
            continue

        # 计算全部指标
        indicators = calc_all_indicators(stock_df)

        # 量化评分（原有技术指标）
        score, signals = calc_quant_score(indicators)
        
        # Alpha因子评分（新增）
        alpha_boost, alpha_signals = calc_alpha_score(indicators, alpha_factors)
        score += alpha_boost
        signals.extend(alpha_signals)
        
        # 五日线战法检测（与现有条件为OR关系，额外加分）
        ma5_hit, ma5_signals = detect_ma5_strategy(stock_df, indicators)
        if ma5_hit:
            score += 3  # 五日线战法加分
            signals.extend(ma5_signals)
        
        # 计算趋势强度（BOLL R²）
        closes = stock_df['close'].values.astype(float)
        boll_r2, boll_direction = calc_boll_r2(closes, 20) if len(closes) >= 20 else (0, 0)
        
        # 判断适用策略
        strategy = classify_strategy(boll_r2, boll_direction, signals)

        # 构建60天时序
        time_series = build_time_series(stock_df, indicators, lookback=60)

        # 市场趋势
        market_trend = build_market_trend(stock_df)

        # 5日涨幅
        pct_5d = ((closes[-1] / closes[-6]) - 1) * 100 if len(closes) > 5 else 0

        stock_reports.append({
            'code': code_short,
            'name': name,
            'close': safe_round(float(row['close'])),
            'pctChg_today': safe_round(float(row['pctChg'])),
            'pctChg_5d': safe_round(pct_5d),
            'amount_yi': safe_round(float(row['amount']) / 1e8) if pd.notna(row['amount']) else 0,
            'turnover': safe_round(float(row['turn'])) if pd.notna(row['turn']) else 0,
            'quant_score': score,
            'signals': signals,
            'alpha_boost': alpha_boost,
            'alpha_signals': alpha_signals,
            'strategy': strategy,
            'boll_r2': safe_round(boll_r2, 4),
            'boll_direction': int(boll_direction),
            'market_trend': market_trend,
            'time_series': time_series,  # 60天逐日数据
        })

    # 按评分排序
    stock_reports.sort(key=lambda x: (-x['quant_score'], -x['pctChg_today']))

    # ── 五日线战法：全市场扫描（OR关系，不限于涨幅>3%的股票）──
    analyzed_codes = {r['code'] for r in stock_reports}
    ma5_candidates = []
    # 从kdf中取出所有有效股票的最新数据
    all_latest = kdf_sorted[kdf_sorted["code"].isin(valid_codes)].groupby("code").last().reset_index()
    non_gainer_codes = all_latest[~all_latest["code"].isin(
        [c for c in gainers["code"].tolist()]
    )]["code"].tolist()
    
    print(f"  [MA5] 扫描 {len(non_gainer_codes)} 只非涨幅股...", file=sys.stderr, flush=True)
    ma5_hit_count = 0
    for code in non_gainer_codes:
        code_short = code.replace("sh.", "").replace("sz.", "")
        if code_short in analyzed_codes:
            continue
        
        stock_df = kdf_sorted[kdf_sorted["code"] == code].copy().reset_index(drop=True)
        if len(stock_df) < 30:
            continue
        
        # 轻量级预过滤：只检查MA5和成交量基本条件，再做完整指标计算
        closes_quick = stock_df['close'].values.astype(float)
        volumes_quick = stock_df['volume'].values.astype(float)
        n_quick = len(closes_quick)
        if n_quick < 15:
            continue
        
        # 快速计算MA5
        ma5_quick = np.convolve(closes_quick, np.ones(5)/5, mode='valid')
        if len(ma5_quick) < 2:
            continue
        latest_close_q = closes_quick[-1]
        latest_ma5_q = ma5_quick[-1]
        
        # 条件1：股价必须站上5日均线
        if latest_close_q < latest_ma5_q:
            continue
        
        # 条件2：最近3天至少有2天放量（放宽预过滤，精确判断在detect函数中）
        vol_up = sum(1 for i in range(-1, -4, -1) if i-1 >= -n_quick and volumes_quick[i] > volumes_quick[i-1])
        if vol_up < 2:
            continue
        
        # 通过预过滤，执行完整的五日线战法检测
        indicators = calc_all_indicators(stock_df)
        ma5_hit, ma5_sigs = detect_ma5_strategy(stock_df, indicators)
        
        if ma5_hit:
            ma5_hit_count += 1
            closes = stock_df['close'].values.astype(float)
            last_row = stock_df.iloc[-1]
            pct_today = float(last_row['pctChg']) if pd.notna(last_row['pctChg']) else 0
            pct_5d = ((closes[-1] / closes[-6]) - 1) * 100 if len(closes) > 5 else 0
            
            # 计算基础评分（技术指标 + Alpha因子）
            base_score, base_signals = calc_quant_score(indicators)
            alpha_boost, alpha_signals = calc_alpha_score(indicators, alpha_factors)
            total_score = base_score + alpha_boost + 3  # +3 五日线战法加分
            all_signals = base_signals + alpha_signals + ma5_sigs
            
            boll_r2, boll_direction = calc_boll_r2(closes, 20) if len(closes) >= 20 else (0, 0)
            strategy = classify_strategy(boll_r2, boll_direction, all_signals)
            time_series = build_time_series(stock_df, indicators, lookback=60)
            market_trend = build_market_trend(stock_df)
            
            ma5_candidates.append({
                'code': code_short,
                'name': name_map.get(code, "?"),
                'close': safe_round(float(last_row['close'])),
                'pctChg_today': safe_round(pct_today),
                'pctChg_5d': safe_round(pct_5d),
                'amount_yi': safe_round(float(last_row['amount']) / 1e8) if pd.notna(last_row['amount']) else 0,
                'turnover': safe_round(float(last_row['turn'])) if pd.notna(last_row['turn']) else 0,
                'quant_score': total_score,
                'signals': all_signals,
                'alpha_boost': alpha_boost,
                'alpha_signals': alpha_signals,
                'strategy': strategy,
                'boll_r2': safe_round(boll_r2, 4),
                'boll_direction': int(boll_direction),
                'market_trend': market_trend,
                'time_series': time_series,
                'ma5_strategy': True,  # 标记为五日线战法选出
            })
    
    if ma5_candidates:
        print(f"  [MA5] 发现 {ma5_hit_count} 只五日线战法信号股", file=sys.stderr, flush=True)
        stock_reports.extend(ma5_candidates)
        # 重新排序
        stock_reports.sort(key=lambda x: (-x['quant_score'], -x['pctChg_today']))
    
    # ── 自选股分析（复用Phase2已拉取的数据）──
    watchlist_reports = []
    gainer_analyzed_codes = {r['code'] for r in stock_reports}
    if watchlist_items:
        wl_name_map = name_map if name_map else {}
        for item in watchlist_items:
            code = item["code"]
            code_short = code.replace("sh.", "").replace("sz.", "")
            note = item.get("note", "")
            name = note.split(" - ")[0] if " - " in note else wl_name_map.get(code, code_short)

            # 跳过已在gainer列表中分析过的
            if code_short in gainer_analyzed_codes:
                # 找到已有的分析结果，补充note和is_watchlist标记
                for r in stock_reports:
                    if r['code'] == code_short:
                        r['note'] = note
                        r['is_watchlist'] = True
                        watchlist_reports.append(r)
                        break
                continue

            # 从kdf中取出该股票数据
            stock_df = kdf_sorted[kdf_sorted["code"] == code].copy().reset_index(drop=True)
            if len(stock_df) < 30:
                print(f"  [!] 自选股 {code} 数据不足({len(stock_df)}天)，跳过", file=sys.stderr)
                watchlist_reports.append({
                    "code": code_short, "name": name, "note": note,
                    "error": "数据不足", "quant_score": 0, "signals": ["数据不足"],
                    "is_watchlist": True,
                })
                continue

            indicators = calc_all_indicators(stock_df)
            score, signals = calc_quant_score(indicators)
            alpha_boost, alpha_signals = calc_alpha_score(indicators, alpha_factors)
            score += alpha_boost
            signals.extend(alpha_signals)
            
            # 五日线战法检测
            ma5_hit, ma5_sigs = detect_ma5_strategy(stock_df, indicators)
            if ma5_hit:
                score += 3
                signals.extend(ma5_sigs)

            closes = stock_df['close'].values.astype(float)
            boll_r2, boll_direction = calc_boll_r2(closes, 20) if len(closes) >= 20 else (0, 0)
            strategy = classify_strategy(boll_r2, boll_direction, signals)
            time_series = build_time_series(stock_df, indicators, lookback=60)
            market_trend = build_market_trend(stock_df)

            last_row = stock_df.iloc[-1]
            pct_today = float(last_row['pctChg']) if pd.notna(last_row['pctChg']) else 0
            pct_5d = ((closes[-1] / closes[-6]) - 1) * 100 if len(closes) > 5 else 0

            wl_report = {
                'code': code_short, 'name': name, 'note': note,
                'close': safe_round(float(last_row['close'])),
                'pctChg_today': safe_round(pct_today),
                'pctChg_5d': safe_round(pct_5d),
                'amount_yi': safe_round(float(last_row['amount']) / 1e8) if pd.notna(last_row['amount']) else 0,
                'turnover': safe_round(float(last_row['turn'])) if pd.notna(last_row['turn']) else 0,
                'quant_score': score, 'signals': signals,
                'alpha_boost': alpha_boost, 'alpha_signals': alpha_signals,
                'strategy': strategy,
                'boll_r2': safe_round(boll_r2, 4), 'boll_direction': int(boll_direction),
                'market_trend': market_trend, 'time_series': time_series,
                'is_watchlist': True,
            }
            watchlist_reports.append(wl_report)
            print(f"  [OK] 自选股 {name}({code_short}) 评分:{score}", file=sys.stderr, flush=True)

        watchlist_reports.sort(key=lambda x: -x.get('quant_score', 0))

    elapsed = round(time.time() - t_start, 1)
    output = {
        'date': trade_day,
        'scan_time': datetime.now().isoformat(),
        'scan_seconds': elapsed,
        'total_main_board': len(codes) if codes else 0,
        'gainers_gt_3pct': len(gainers),
        'ma5_strategy_hits': len([s for s in stock_reports if s.get('ma5_strategy')]),
        'analyzed': len(stock_reports),
        'top_n': args.top,
        'alpha_factors_count': len(alpha_factors),
        'alpha_factors': [{'name': f['name'], 'expression': f['expression'], 'ic': f['ic']} for f in alpha_factors[:5]],
        'index_analysis': index_analysis,  # 盘面分析
        'stocks': stock_reports,
        'watchlist_stocks': watchlist_reports,  # 自选股分析结果
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
