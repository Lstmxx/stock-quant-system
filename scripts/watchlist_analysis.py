#!/usr/bin/env python3
"""
自选股分析脚本 - 对用户关注的股票进行完整技术分析
读取 watchlist.json 配置，复用 stock_cron_data.py 的指标计算逻辑
输出与 stock_cron_data.py 兼容的 JSON 格式
"""
import sys
import os
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

import baostock as bs
import pandas as pd
import numpy as np

# 复用 stock_cron_data 的计算函数
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stock_cron_data import (
    calc_all_indicators, calc_quant_score, build_time_series,
    build_market_trend, calc_boll_r2, classify_strategy, safe_round,
    get_last_trading_day, CACHE_DIR, _cache_fresh, _cache_load, _cache_save,
    LOOKBACK_DAYS
)
from alpha_factor_calc import load_alpha_factors, calc_alpha_score

WATCHLIST_PATH = Path("/opt/data/profiles/quant-trading/config/watchlist.json")


def load_watchlist():
    """加载自选股配置"""
    if not WATCHLIST_PATH.exists():
        print(f"  ⚠️ 自选股配置不存在: {WATCHLIST_PATH}", file=sys.stderr)
        return []

    with open(WATCHLIST_PATH) as f:
        config = json.load(f)

    stocks = config.get("stocks", [])
    # 校验 code 格式
    valid = []
    for s in stocks:
        code = s.get("code", "").strip()
        if code and (code.startswith("sh.") or code.startswith("sz.")):
            valid.append(s)
        else:
            print(f"  ⚠️ 跳过无效代码: {code}", file=sys.stderr)

    return valid


def fetch_stock_history(code, start_date, end_date):
    """拉取单只股票历史数据"""
    rs = bs.query_history_k_data_plus(
        code, "date,code,open,high,low,close,volume,amount,pctChg,turn",
        start_date=start_date, end_date=end_date, frequency="d", adjustflag="2"
    )
    rows = []
    while rs.next():
        rows.append(rs.get_row_data())
    if not rows:
        return None

    df = pd.DataFrame(rows, columns=["date", "code", "open", "high", "low",
                                      "close", "volume", "amount", "pctChg", "turn"])
    for col in ["open", "high", "low", "close", "volume", "amount", "pctChg", "turn"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def analyze_watchlist(trade_date=None):
    """分析自选股列表"""
    watchlist = load_watchlist()
    if not watchlist:
        return {"error": "自选股列表为空", "stocks": []}

    if trade_date is None:
        trade_date = get_last_trading_day()

    print(f"  自选股分析: {len(watchlist)} 只, 日期: {trade_date}", file=sys.stderr, flush=True)

    # 加载Alpha因子
    alpha_factors = load_alpha_factors()
    print(f"  加载 {len(alpha_factors)} 个Alpha因子", file=sys.stderr, flush=True)

    # 登录 baostock
    _old_stdout = sys.stdout
    sys.stdout = sys.stderr
    bs.login()
    sys.stdout = _old_stdout

    start_date = (datetime.strptime(trade_date, "%Y-%m-%d") - timedelta(days=LOOKBACK_DAYS + 10)).strftime("%Y-%m-%d")

    results = []
    for item in watchlist:
        code = item["code"]
        note = item.get("note", "")
        cache_key = f"watchlist_{code}_{trade_date}"

        # 尝试缓存
        if _cache_fresh(cache_key):
            cached = _cache_load(cache_key)
            if cached is not None and len(cached) >= 30:
                stock_df = cached
            else:
                stock_df = fetch_stock_history(code, start_date, trade_date)
        else:
            stock_df = fetch_stock_history(code, start_date, trade_date)
            if stock_df is not None and len(stock_df) >= 30:
                _cache_save(cache_key, stock_df)

        if stock_df is None or len(stock_df) < 30:
            print(f"  ⚠️ {code} 数据不足，跳过", file=sys.stderr)
            results.append({
                "code": code.replace("sh.", "").replace("sz.", ""),
                "name": note or code,
                "error": "数据不足",
                "quant_score": 0,
                "signals": ["数据不足"],
                "is_watchlist": True,
            })
            continue

        stock_df = stock_df.sort_values("date").reset_index(drop=True)

        # 获取股票名称
        code_short = code.replace("sh.", "").replace("sz.", "")
        name = note.split(" - ")[0] if " - " in note else (note or code_short)

        # 计算全部指标
        indicators = calc_all_indicators(stock_df)
        score, signals = calc_quant_score(indicators)

        # Alpha因子评分
        alpha_boost, alpha_signals = calc_alpha_score(indicators, alpha_factors)
        score += alpha_boost
        signals.extend(alpha_signals)

        # 趋势强度
        closes = stock_df['close'].values.astype(float)
        boll_r2, boll_direction = calc_boll_r2(closes, 20) if len(closes) >= 20 else (0, 0)

        # 策略判断
        strategy = classify_strategy(boll_r2, boll_direction, signals)

        # 时序数据
        time_series = build_time_series(stock_df, indicators, lookback=60)
        market_trend = build_market_trend(stock_df)

        # 涨跌幅
        last_row = stock_df.iloc[-1]
        pct_today = float(last_row['pctChg']) if pd.notna(last_row['pctChg']) else 0
        pct_5d = ((closes[-1] / closes[-6]) - 1) * 100 if len(closes) > 5 else 0

        results.append({
            "code": code_short,
            "name": name,
            "note": note,
            "close": safe_round(float(last_row['close'])),
            "pctChg_today": safe_round(pct_today),
            "pctChg_5d": safe_round(pct_5d),
            "amount_yi": safe_round(float(last_row['amount']) / 1e8) if pd.notna(last_row['amount']) else 0,
            "turnover": safe_round(float(last_row['turn'])) if pd.notna(last_row['turn']) else 0,
            "quant_score": score,
            "signals": signals,
            "alpha_boost": alpha_boost,
            "alpha_signals": alpha_signals,
            "strategy": strategy,
            "boll_r2": safe_round(boll_r2, 4),
            "boll_direction": int(boll_direction),
            "market_trend": market_trend,
            "time_series": time_series,
            "is_watchlist": True,
        })
        print(f"  ✅ {name}({code_short}) 评分:{score} 信号:{','.join(signals[:3])}", file=sys.stderr, flush=True)

    sys.stdout = sys.stderr
    bs.logout()
    sys.stdout = _old_stdout

    # 按评分排序
    results.sort(key=lambda x: -x.get("quant_score", 0))

    output = {
        "date": trade_date,
        "scan_time": datetime.now().isoformat(),
        "count": len(results),
        "stocks": results,
    }

    return output


def main():
    import argparse
    parser = argparse.ArgumentParser(description="自选股分析")
    parser.add_argument("--date", help="指定交易日期 YYYY-MM-DD")
    parser.add_argument("--output", help="输出文件路径（默认stdout）")
    args = parser.parse_args()

    result = analyze_watchlist(args.date)

    output_json = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, "w") as f:
            f.write(output_json)
        print(f"  自选股分析结果已保存: {args.output}", file=sys.stderr)
    else:
        print(output_json)


if __name__ == "__main__":
    main()
