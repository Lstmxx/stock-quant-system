#!/usr/bin/env python3
"""
指数分析模块
分析上证指数走势，判断市场环境
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import baostock as bs
import pandas as pd
import numpy as np
import json
from datetime import datetime, timedelta

from mytt import MA, MACD, KDJ, RSI, BOLL, DMI, BIAS, CCI, ATR


# ─── baostock 超时保护 ───
class BaostockTimeout(Exception):
    pass

def _bs_simple_worker(func, args, kwargs, result_queue):
    """在子进程中执行简单的 baostock 调用（login/logout 等）"""
    try:
        result = func(*args, **kwargs)
        result_queue.put(('ok', result))
    except Exception as e:
        result_queue.put(('error', e))

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
                print(f"  [!] index_analysis: baostock超时(第{attempt+1}次，{timeout}s)，重试...", file=sys.stderr, flush=True)
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
                print(f"  [!] index_analysis: baostock查询超时(第{attempt+1}次，{timeout}s)，重试...", file=sys.stderr, flush=True)
            else:
                raise BaostockTimeout(f"query timed out after {timeout}s x {retries+1} attempts")
        else:
            if not result_queue.empty():
                status, value = result_queue.get_nowait()
                if status == 'ok':
                    return value
                else:
                    raise value
            else:
                raise BaostockTimeout("query returned no result")


def calc_boll_r2(closes, period=20):
    """R² of linear regression over BOLL period."""
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


def get_index_data(code='sh.000001', days=120):
    """获取指数数据
    
    Args:
        code: 指数代码，默认上证指数
        days: 获取天数
    
    Returns:
        DataFrame with OHLCV data
    """
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=days+10)).strftime('%Y-%m-%d')
    
    _, rows = bs_query_with_timeout(
        bs.query_history_k_data_plus,
        code,
        "date,open,high,low,close,volume,amount",
        start_date=start_date, end_date=end_date,
        frequency="d", adjustflag="3",  # 不复权
        timeout=20, retries=2
    )
    
    if not rows:
        return None
    
    df = pd.DataFrame(rows, columns=['date', 'open', 'high', 'low', 'close', 'volume', 'amount'])
    for col in ['open', 'high', 'low', 'close', 'volume', 'amount']:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    
    return df


def calc_index_indicators(df):
    """计算指数技术指标"""
    C = df['close'].values.astype(float)
    H = df['high'].values.astype(float)
    L = df['low'].values.astype(float)
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
    
    # BIAS
    BIAS1, BIAS2, BIAS3 = BIAS(C)
    
    # CCI
    CCI_VAL = CCI(C, H, L)
    
    # ATR
    ATR_VAL = ATR(C, H, L)
    
    # BOLL R² 趋势强度
    boll_r2, boll_direction = calc_boll_r2(C, 20)
    
    return {
        'MA5': MA5, 'MA10': MA10, 'MA20': MA20, 'MA60': MA60,
        'DIF': DIF, 'DEA': DEA, 'MACD': MACD_VAL,
        'K': K, 'D': D, 'J': J,
        'RSI': RSI_VAL,
        'BOLL_UP': BOLL_UP, 'BOLL_MID': BOLL_MID, 'BOLL_DN': BOLL_DN,
        'PDI': PDI, 'MDI': MDI, 'ADX': ADX_VAL,
        'BIAS1': BIAS1, 'BIAS2': BIAS2, 'BIAS3': BIAS3,
        'CCI': CCI_VAL, 'ATR': ATR_VAL,
        'boll_r2': boll_r2, 'boll_direction': boll_direction
    }


def judge_market_phase(indicators):
    """判断市场阶段
    
    Returns:
        dict with market_phase, trend, strength, description
    """
    def last(key):
        v = indicators.get(key, [None])[-1]
        return v if v is not None and not (isinstance(v, float) and np.isnan(v)) else None
    
    ma5 = last('MA5')
    ma10 = last('MA10')
    ma20 = last('MA20')
    ma60 = last('MA60')
    dif = last('DIF')
    dea = last('DEA')
    rsi = last('RSI')
    boll_r2 = indicators.get('boll_r2', 0)
    boll_direction = indicators.get('boll_direction', 0)
    pdi = last('PDI')
    mdi = last('MDI')
    
    # 判断均线排列
    if ma5 and ma10 and ma20 and ma60:
        if ma5 > ma10 > ma20 > ma60:
            ma_alignment = '多头排列'
        elif ma5 < ma10 < ma20 < ma60:
            ma_alignment = '空头排列'
        else:
            ma_alignment = '交叉缠绕'
    else:
        ma_alignment = '数据不足'
    
    # 判断趋势强度
    if boll_r2 > 0.7:
        if boll_direction > 0:
            trend = '强上升趋势'
            strength = '强'
        else:
            trend = '强下降趋势'
            strength = '强'
    elif boll_r2 > 0.4:
        if boll_direction > 0:
            trend = '温和上升'
            strength = '中'
        else:
            trend = '温和下降'
            strength = '中'
    else:
        trend = '震荡整理'
        strength = '弱'
    
    # 判断市场阶段
    if ma_alignment == '多头排列' and dif and dif > 0:
        market_phase = '牛市'
        description = '均线多头排列，MACD在零轴上方，市场处于上升趋势'
    elif ma_alignment == '空头排列' and dif and dif < 0:
        market_phase = '熊市'
        description = '均线空头排列，MACD在零轴下方，市场处于下降趋势'
    elif ma_alignment == '交叉缠绕':
        market_phase = '震荡市'
        description = '均线交叉缠绕，市场方向不明，适合高抛低吸'
    else:
        market_phase = '过渡期'
        description = '市场正在选择方向，建议观望'
    
    # 判断超买超卖
    rsi_signal = ''
    if rsi:
        if rsi > 70:
            rsi_signal = 'RSI超买，短期有回调风险'
        elif rsi < 30:
            rsi_signal = 'RSI超卖，短期有反弹机会'
    
    # 判断量能
    volume = indicators.get('volume', [])
    if len(volume) > 5:
        vol_ma5 = np.mean(volume[-5:])
        vol_ma20 = np.mean(volume[-20:]) if len(volume) >= 20 else vol_ma5
        vol_ratio = vol_ma5 / vol_ma20 if vol_ma20 > 0 else 1
        if vol_ratio > 1.5:
            volume_signal = '近期放量，资金活跃'
        elif vol_ratio < 0.7:
            volume_signal = '近期缩量，资金观望'
        else:
            volume_signal = '量能平稳'
    else:
        volume_signal = '量能数据不足'
    
    return {
        'market_phase': market_phase,
        'trend': trend,
        'strength': strength,
        'ma_alignment': ma_alignment,
        'description': description,
        'rsi_signal': rsi_signal,
        'volume_signal': volume_signal
    }


def get_support_resistance(indicators):
    """计算支撑位和压力位"""
    def last(key):
        v = indicators.get(key, [None])[-1]
        return v if v is not None and not (isinstance(v, float) and np.isnan(v)) else None
    
    boll_up = last('BOLL_UP')
    boll_mid = last('BOLL_MID')
    boll_dn = last('BOLL_DN')
    ma20 = last('MA20')
    ma60 = last('MA60')
    
    supports = []
    resistances = []
    
    if boll_dn:
        supports.append(('BOLL下轨', boll_dn))
    if ma20:
        supports.append(('MA20', ma20))
    if ma60:
        supports.append(('MA60', ma60))
    
    if boll_up:
        resistances.append(('BOLL上轨', boll_up))
    if boll_mid:
        resistances.append(('BOLL中轨', boll_mid))
    
    return {
        'supports': supports,
        'resistances': resistances
    }


def analyze_index(code='sh.000001', days=120):
    """完整分析指数
    
    Returns:
        dict with all analysis results
    """
    # 获取数据
    df = get_index_data(code, days)
    if df is None or len(df) < 30:
        return {'error': '数据不足'}
    
    # 计算指标
    indicators = calc_index_indicators(df)
    
    # 判断市场阶段
    market_phase = judge_market_phase(indicators)
    
    # 计算支撑压力位
    sr = get_support_resistance(indicators)
    
    # 获取最新数据
    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else latest
    
    # 计算涨跌幅
    pct_change = (latest['close'] - prev['close']) / prev['close'] * 100
    pct_5d = (latest['close'] - df.iloc[-6]['close']) / df.iloc[-6]['close'] * 100 if len(df) > 5 else 0
    pct_20d = (latest['close'] - df.iloc[-21]['close']) / df.iloc[-21]['close'] * 100 if len(df) > 20 else 0
    
    return {
        'code': code,
        'name': '上证指数' if code == 'sh.000001' else code,
        'close': round(float(latest['close']), 2),
        'pct_change': round(float(pct_change), 2),
        'pct_5d': round(float(pct_5d), 2),
        'pct_20d': round(float(pct_20d), 2),
        'volume': int(latest['volume']),
        'amount': round(float(latest['amount']) / 1e8, 2),  # 亿元
        'market_phase': market_phase,
        'support_resistance': sr,
        'indicators': {
            'MA5': round(float(indicators['MA5'][-1]), 2) if not np.isnan(indicators['MA5'][-1]) else None,
            'MA10': round(float(indicators['MA10'][-1]), 2) if not np.isnan(indicators['MA10'][-1]) else None,
            'MA20': round(float(indicators['MA20'][-1]), 2) if not np.isnan(indicators['MA20'][-1]) else None,
            'MA60': round(float(indicators['MA60'][-1]), 2) if not np.isnan(indicators['MA60'][-1]) else None,
            'DIF': round(float(indicators['DIF'][-1]), 4) if not np.isnan(indicators['DIF'][-1]) else None,
            'DEA': round(float(indicators['DEA'][-1]), 4) if not np.isnan(indicators['DEA'][-1]) else None,
            'RSI': round(float(indicators['RSI'][-1]), 2) if not np.isnan(indicators['RSI'][-1]) else None,
            'boll_r2': indicators['boll_r2'],
            'boll_direction': indicators['boll_direction']
        },
        'date': latest['date']
    }


if __name__ == "__main__":
    # 测试
    _old_stdout = sys.stdout
    sys.stdout = sys.stderr
    bs.login()
    sys.stdout = _old_stdout
    
    result = analyze_index()
    
    _old_stdout = sys.stdout
    sys.stdout = sys.stderr
    bs.logout()
    sys.stdout = _old_stdout
    
    print(json.dumps(result, ensure_ascii=False, indent=2))
