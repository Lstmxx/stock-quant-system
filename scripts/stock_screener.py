#!/usr/bin/env python3
"""
大A趋势选股Agent - 每日自动化流程
1. baostock 扫描沪市主板+深市主板 涨幅>3% 的股票
2. DSA 数据聚合（K线、技术指标、新闻）
3. 输出结构化数据供 Hermes Agent 分析
"""

import baostock as bs
import pandas as pd
import subprocess
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

# ============ 配置 ============
DSA_DIR = Path("/opt/data/daily_stock_analysis")
DSA_VENV = DSA_DIR / "venv" / "bin" / "python"
OUTPUT_DIR = Path("/opt/data/scripts/stock_output")
LOOKBACK_DAYS = 60  # K线回看天数
GAIN_THRESHOLD = 3.0  # 涨幅阈值
TOP_N = 30  # 最多分析N只（控制成本和时间）


def get_last_trading_day():
    """获取最近交易日"""
    today = datetime.now()
    # 如果是周末，回退到周五
    if today.weekday() == 5:  # Saturday
        today -= timedelta(days=1)
    elif today.weekday() == 6:  # Sunday
        today -= timedelta(days=2)
    return today.strftime("%Y-%m-%d")


def screen_gainers(trade_day=None):
    """扫描涨幅>3%的沪市主板+深市主板股票"""
    if trade_day is None:
        trade_day = get_last_trading_day()

    print(f"📊 扫描日期: {trade_day}")
    print(f"📋 条件: 沪市主板+深市主板, 涨幅>{GAIN_THRESHOLD}%")

    lg = bs.login()
    if lg.error_code != "0":
        print(f"❌ baostock 登录失败: {lg.error_msg}")
        return []

    # 获取全量股票列表
    rs = bs.query_all_stock(day=trade_day)
    stocks = []
    while rs.next():
        stocks.append(rs.get_row_data())
    all_df = pd.DataFrame(stocks, columns=rs.fields)

    # 筛选沪市主板(sh.60xxxx) + 深市主板(sz.00xxxx)，排除ST
    mask = (
        all_df["code"].str.match(r"^(sh\.60|sz\.00)\d{4}$")
        & (all_df["code"].str.len() <= 10)
        & (~all_df["code_name"].str.contains("ST", na=False))
    )
    main_stocks = all_df[mask][["code", "code_name"]].copy()
    print(f"  沪市+深市主板（排除ST）: {len(main_stocks)} 只")

    # 批量查询最新日K数据获取涨跌幅
    start = time.time()
    results = []
    total = len(main_stocks)
    query_start = (datetime.strptime(trade_day, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")
    for i, code in enumerate(main_stocks["code"].tolist()):
        if (i + 1) % 200 == 0:
            print(f"  进度: {i+1}/{total} ({(i+1)/total*100:.0f}%)")
        rs2 = bs.query_history_k_data_plus(
            code,
            "date,code,open,high,low,close,volume,amount,pctChg,turn",
            start_date=query_start,
            end_date=trade_day,
            frequency="d",
            adjustflag="2",
        )
        while rs2.next():
            results.append(rs2.get_row_data())

    elapsed = time.time() - start

    if not results:
        print("❌ 未获取到K线数据")
        return []

    # 构建 DataFrame
    kdf = pd.DataFrame(
        results, columns=["date", "code", "open", "high", "low", "close", "volume", "amount", "pctChg", "turn"]
    )
    kdf["pctChg"] = pd.to_numeric(kdf["pctChg"], errors="coerce")
    kdf["close"] = pd.to_numeric(kdf["close"], errors="coerce")
    kdf["volume"] = pd.to_numeric(kdf["volume"], errors="coerce")
    kdf["amount"] = pd.to_numeric(kdf["amount"], errors="coerce")

    # 取每只股票最新一天的数据
    kdf_sorted = kdf.sort_values("date")
    latest = kdf_sorted.groupby("code").last().reset_index()

    # 筛选涨幅 > 阈值，排除新股（K线少于5天）
    stock_counts = kdf_sorted.groupby("code").size()
    valid_codes = stock_counts[stock_counts >= 5].index
    latest_valid = latest[latest["code"].isin(valid_codes)]
    gainers = latest_valid[latest_valid["pctChg"] > GAIN_THRESHOLD].copy()
    gainers = gainers.sort_values("pctChg", ascending=False)

    # 合并股票名称
    name_map = dict(zip(main_stocks["code"], main_stocks["code_name"]))
    gainers["name"] = gainers["code"].map(name_map)

    # 限制数量
    if len(gainers) > TOP_N:
        print(f"  涨幅>{GAIN_THRESHOLD}%: {len(gainers)} 只，取前 {TOP_N} 只")
        gainers = gainers.head(TOP_N)
    else:
        print(f"  涨幅>{GAIN_THRESHOLD}%: {len(gainers)} 只")

    print(f"  耗时: {elapsed:.1f}s")

    # 输出结果
    result_list = []
    for _, row in gainers.iterrows():
        result_list.append({
            "code": row["code"],
            "name": row["name"],
            "close": float(row["close"]),
            "pctChg": float(row["pctChg"]),
            "volume": int(row["volume"]) if pd.notna(row["volume"]) else 0,
            "amount": float(row["amount"]) if pd.notna(row["amount"]) else 0,
            "turn": float(row["turn"]) if pd.notna(row["turn"]) else 0,
            "date": row["date"],
        })

    return result_list


def fetch_dsa_data(stock_code, trade_day):
    """用 DSA 的数据层获取单只股票的完整数据（K线+技术指标+新闻）"""
    # 转换代码格式: sh.600519 -> 600519
    code = stock_code.replace("sh.", "").replace("sz.", "")

    cmd = [
        str(DSA_VENV),
        str(DSA_DIR / "main.py"),
        "--dry-run",
        "--no-notify",
        "--stocks", code,
        "--force-run",
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(DSA_DIR),
            env={**os.environ, "PYTHONPATH": str(DSA_DIR)},
        )
        # 读取生成的报告
        report_dir = DSA_DIR / "reports"
        # DSA saves reports with stock code in name
        report_files = sorted(report_dir.glob(f"*{code}*"), key=os.path.getmtime, reverse=True)
        if report_files:
            return report_files[0].read_text(encoding="utf-8")
        return None
    except subprocess.TimeoutExpired:
        print(f"  ⚠️ {code} DSA 数据获取超时")
        return None
    except Exception as e:
        print(f"  ❌ {code} DSA 数据获取失败: {e}")
        return None


def fetch_kline_data(stock_code, trade_day, lookback_days=LOOKBACK_DAYS):
    """用 baostock 获取K线数据和计算技术指标（复用全局连接）"""
    code = stock_code  # sh.600519 format
    start_date = (datetime.strptime(trade_day, "%Y-%m-%d") - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    bs.login()  # ensure connected
    rs = bs.query_history_k_data_plus(
        code,
        "date,code,open,high,low,close,volume,amount,pctChg,turn",
        start_date=start_date,
        end_date=trade_day,
        frequency="d",
        adjustflag="2",
    )
    data = []
    while rs.next():
        data.append(rs.get_row_data())

    if not data:
        return None

    df = pd.DataFrame(data, columns=["date", "code", "open", "high", "low", "close", "volume", "amount", "pctChg", "turn"])
    for col in ["open", "high", "low", "close", "volume", "amount", "pctChg", "turn"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # 计算技术指标
    # MA
    for w in [5, 10, 20, 60]:
        df[f"MA{w}"] = df["close"].rolling(w).mean()

    # MACD (12, 26, 9)
    ema12 = df["close"].ewm(span=12, adjust=False).mean()
    ema26 = df["close"].ewm(span=26, adjust=False).mean()
    df["DIF"] = ema12 - ema26
    df["DEA"] = df["DIF"].ewm(span=9, adjust=False).mean()
    df["MACD"] = (df["DIF"] - df["DEA"]) * 2

    # KDJ (9, 3, 3)
    low_min = df["low"].rolling(9).min()
    high_max = df["high"].rolling(9).max()
    rsv = (df["close"] - low_min) / (high_max - low_min) * 100
    df["K"] = rsv.ewm(com=2, adjust=False).mean()
    df["D"] = df["K"].ewm(com=2, adjust=False).mean()
    df["J"] = 3 * df["K"] - 2 * df["D"]

    # BOLL (20, 2)
    df["BOLL_MID"] = df["close"].rolling(20).mean()
    std20 = df["close"].rolling(20).std()
    df["BOLL_UP"] = df["BOLL_MID"] + 2 * std20
    df["BOLL_DN"] = df["BOLL_MID"] - 2 * std20

    # 量比（5日均量）
    df["VOL_MA5"] = df["volume"].rolling(5).mean()
    df["VOL_RATIO"] = df["volume"] / df["VOL_MA5"]

    # 取最近30天的数据
    recent = df.tail(30).copy()
    return recent


def generate_stock_report(gainer, kline_df):
    """为单只股票生成结构化数据报告"""
    if kline_df is None or kline_df.empty:
        return None

    latest = kline_df.iloc[-1]
    prev = kline_df.iloc[-2] if len(kline_df) > 1 else latest

    code = gainer["code"].replace("sh.", "").replace("sz.", "")
    name = gainer["name"]

    # 多头排列判断
    ma5 = latest.get("MA5", 0)
    ma10 = latest.get("MA10", 0)
    ma20 = latest.get("MA20", 0)
    ma60 = latest.get("MA60", 0)
    bullish_ma = (ma5 > ma10 > ma20) if all(pd.notna([ma5, ma10, ma20])) else False

    # MACD 金叉判断
    macd_golden = (latest["DIF"] > latest["DEA"]) and (prev["DIF"] <= prev["DEA"]) if all(pd.notna([latest["DIF"], latest["DEA"], prev["DIF"], prev["DEA"]])) else False
    macd_above_zero = latest["DIF"] > 0 if pd.notna(latest["DIF"]) else False

    # KDJ 状态
    kdj_oversold = latest["J"] < 20 if pd.notna(latest["J"]) else False
    kdj_golden = (latest["K"] > latest["D"]) and (prev["K"] <= prev["D"]) if all(pd.notna([latest["K"], latest["D"], prev["K"], prev["D"]])) else False

    # BOLL 位置
    boll_position = "中轨上方" if latest["close"] > latest.get("BOLL_MID", 0) else "中轨下方"
    boll_breakout = latest["close"] > latest.get("BOLL_UP", float("inf"))

    # 量能
    vol_ratio = latest.get("VOL_RATIO", 1.0)

    # 近5日涨跌
    recent_5d = kline_df.tail(5)
    pct_5d = ((recent_5d.iloc[-1]["close"] / recent_5d.iloc[0]["close"]) - 1) * 100 if len(recent_5d) >= 5 else 0

    report = f"""
## {code} {name}

### 基本行情
- 最新价: {latest['close']:.2f} | 当日涨幅: {latest['pctChg']:.2f}%
- 近5日涨幅: {pct_5d:.2f}%
- 成交量: {latest['volume']/10000:.0f}万手 | 成交额: {latest['amount']/1e8:.2f}亿
- 换手率: {latest['turn']:.2f}% | 量比: {vol_ratio:.2f}

### 均线系统
- MA5={ma5:.2f} MA10={ma10:.2f} MA20={ma20:.2f} MA60={ma60:.2f}
- 多头排列: {'✅ 是' if bullish_ma else '❌ 否'}
- 价量关系: {'站上' if latest['close'] > ma5 else '跌破'}5日线

### MACD
- DIF={latest['DIF']:.3f} DEA={latest['DEA']:.3f} MACD={latest['MACD']:.3f}
- 金叉: {'✅ 当日金叉' if macd_golden else '未金叉'} | 零轴上方: {'✅' if macd_above_zero else '❌'}

### KDJ
- K={latest['K']:.1f} D={latest['D']:.1f} J={latest['J']:.1f}
- 金叉: {'✅ 当日金叉' if kdj_golden else '未金叉'} | 超卖区: {'✅ J<20' if kdj_oversold else '否'}

### BOLL
- 上轨={latest.get('BOLL_UP',0):.2f} 中轨={latest.get('BOLL_MID',0):.2f} 下轨={latest.get('BOLL_DN',0):.2f}
- 位置: {boll_position} | 突破上轨: {'✅' if boll_breakout else '❌'}

### 近10日K线数据
| 日期 | 开盘 | 最高 | 最低 | 收盘 | 涨跌幅 | 成交量(万) |
|------|------|------|------|------|--------|-----------|
"""
    for _, row in kline_df.tail(10).iterrows():
        report += f"| {row['date']} | {row['open']:.2f} | {row['high']:.2f} | {row['low']:.2f} | {row['close']:.2f} | {row['pctChg']:.2f}% | {row['volume']/10000:.0f} |\n"

    return report


def main():
    """主流程"""
    print("=" * 60)
    print("🔍 大A趋势选股Agent - 每日扫描")
    print(f"⏰ 运行时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # 确保输出目录存在
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: 扫描涨幅>3%的股票
    print("\n📊 Step 1: 扫描涨幅>3%的股票...")
    trade_day = get_last_trading_day()

    # 保持 baostock 连接贯穿全流程
    bs.login()

    gainers = screen_gainers(trade_day)

    if not gainers:
        print("\n❌ 今日无涨幅>3%的沪市+深市主板股票，或数据获取失败")
        # Still output a message
        output_file = OUTPUT_DIR / f"scan_{trade_day}.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump({"date": trade_day, "gainers": [], "message": "无符合条件的股票"}, f, ensure_ascii=False, indent=2)
        print(f"结果已保存: {output_file}")
        return

    print(f"\n✅ 找到 {len(gainers)} 只涨幅>{GAIN_THRESHOLD}%的股票:")
    for g in gainers[:10]:
        print(f"  {g['code'].replace('sh.','').replace('sz.','')} {g['name']:8s} | +{g['pctChg']:.2f}% | {g['close']:.2f}元")
    if len(gainers) > 10:
        print(f"  ... 共 {len(gainers)} 只")

    # Step 2: 获取每只股票的K线数据和技术指标
    print(f"\n📈 Step 2: 获取K线数据和技术指标...")
    stock_reports = []
    for i, g in enumerate(gainers):
        code = g["code"]
        name = g["name"]
        print(f"  [{i+1}/{len(gainers)}] {code.replace('sh.','').replace('sz.','')} {name}...")
        kdf = fetch_kline_data(code, trade_day)
        report = generate_stock_report(g, kdf)
        if report:
            stock_reports.append({
                "code": g["code"],
                "name": g["name"],
                "pctChg": g["pctChg"],
                "report": report,
                "data": g,
            })

    # Step 3: 保存结果
    today_str = datetime.now().strftime("%Y%m%d")
    output_file = OUTPUT_DIR / f"scan_{today_str}.json"
    report_file = OUTPUT_DIR / f"scan_{today_str}.md"

    # 保存 JSON
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump({
            "date": trade_day,
            "scan_time": datetime.now().isoformat(),
            "total_gainers": len(stock_reports),
            "threshold": GAIN_THRESHOLD,
            "stocks": [{
                "code": s["code"],
                "name": s["name"],
                "pctChg": s["pctChg"],
                "close": s["data"]["close"],
                "amount": s["data"]["amount"],
            } for s in stock_reports],
        }, f, ensure_ascii=False, indent=2)

    # 保存 Markdown 报告
    md = f"# 大A趋势选股扫描报告\n\n"
    md += f"**日期**: {trade_day} | **扫描时间**: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
    md += f"**条件**: 沪市主板+深市主板 涨幅>{GAIN_THRESHOLD}% | **结果**: {len(stock_reports)} 只\n\n"
    md += "---\n\n"
    for s in stock_reports:
        md += s["report"] + "\n---\n\n"

    with open(report_file, "w", encoding="utf-8") as f:
        f.write(md)

    print(f"\n{'=' * 60}")
    print(f"✅ 扫描完成!")
    print(f"  JSON: {output_file}")
    print(f"  报告: {report_file}")
    print(f"  共 {len(stock_reports)} 只股票")
    print(f"{'=' * 60}")

    bs.logout()


if __name__ == "__main__":
    main()
