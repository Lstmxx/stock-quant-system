#!/usr/bin/env python3
"""
大A趋势选股 - mplfinance 专业K线图表生成器
读取 stock_cron_data.py 输出的 time_series 数据，生成4面板图表
"""
import json
import sys
import os
import re
import argparse
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import mplfinance as mpf

# 中文字体
plt.rcParams['font.sans-serif'] = ['WenQuanYi Zen Hei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False


def build_mpf_style():
    """A股风格暗色主题：红涨绿跌"""
    mc = mpf.make_marketcolors(
        up='#ef5350', down='#26a69a',
        edge='inherit', wick='inherit',
        volume={'up': '#ef5350', 'down': '#26a69a'},
        ohlc='i'
    )
    return mpf.make_mpf_style(
        marketcolors=mc,
        figcolor='#1a1a2e',
        facecolor='#16213e',
        gridcolor='#2a2a4a',
        gridstyle='--',
        rc={
            'font.sans-serif': ['WenQuanYi Zen Hei', 'DejaVu Sans'],
            'axes.unicode_minus': False,
            'axes.labelcolor': '#e0e0e0',
            'xtick.color': '#e0e0e0',
            'ytick.color': '#e0e0e0',
        },
    )


def time_series_to_df(time_series):
    """将 time_series 列表转换为 mplfinance 格式的 DataFrame"""
    df = pd.DataFrame(time_series)
    df['date'] = pd.to_datetime(df['date'])
    df.set_index('date', inplace=True)
    df.rename(columns={
        'open': 'Open', 'close': 'Close', 'high': 'High',
        'low': 'Low', 'volume': 'Volume'
    }, inplace=True)
    return df


def draw_chart(df, stock_info, indicators, output_path, style):
    """绘制4面板图表：K线+BOLL / 成交量 / MACD / KDJ"""
    # 均线
    addplots = []
    colors = {'MA5': '#ffeb3b', 'MA10': '#2196f3', 'MA20': '#e91e63', 'MA60': '#78909c'}
    for ma, color in colors.items():
        if ma in df.columns and df[ma].notna().any():
            addplots.append(mpf.make_addplot(df[ma], color=color, width=1.0, panel=0))

    # BOLL 带
    if 'BOLL_UP' in df.columns and 'BOLL_DN' in df.columns:
        if df['BOLL_UP'].notna().any():
            addplots.append(mpf.make_addplot(df['BOLL_UP'], color='#78909c', linestyle='--', width=0.8, panel=0))
            addplots.append(mpf.make_addplot(df['BOLL_DN'], color='#78909c', linestyle='--', width=0.8, panel=0))
            addplots.append(mpf.make_addplot(df['BOLL_MID'], color='#78909c', width=0.6, panel=0))

    # MACD 面板 (panel=2)
    if 'MACD' in df.columns and df['MACD'].notna().any():
        # 柱状图
        macd_hist = df['MACD'].values
        macd_pos = pd.Series(np.where(macd_hist >= 0, macd_hist, np.nan), index=df.index)
        macd_neg = pd.Series(np.where(macd_hist < 0, macd_hist, np.nan), index=df.index)
        addplots.append(mpf.make_addplot(macd_pos, type='bar', color='#ef5350', width=0.7, panel=2))
        addplots.append(mpf.make_addplot(macd_neg, type='bar', color='#26a69a', width=0.7, panel=2))
        addplots.append(mpf.make_addplot(df['DIF'], color='#ffeb3b', width=1.2, panel=2))
        addplots.append(mpf.make_addplot(df['DEA'], color='#2196f3', width=1.2, panel=2))

    # KDJ 面板 (panel=3)
    if 'K' in df.columns and df['K'].notna().any():
        addplots.append(mpf.make_addplot(df['K'], color='#ffeb3b', width=1.2, panel=3))
        addplots.append(mpf.make_addplot(df['D'], color='#2196f3', width=1.2, panel=3))
        addplots.append(mpf.make_addplot(df['J'], color='#e91e63', width=1.2, panel=3))
        # 超买超卖参考线
        overbought = pd.Series(80, index=df.index)
        oversold = pd.Series(20, index=df.index)
        addplots.append(mpf.make_addplot(overbought, color='#ef5350', linestyle=':', width=0.5, panel=3))
        addplots.append(mpf.make_addplot(oversold, color='#26a69a', linestyle=':', width=0.5, panel=3))

    # 标题
    code = stock_info.get('code', '')
    name = stock_info.get('name', '')
    close = stock_info.get('close', 0)
    pct = stock_info.get('pctChg_today', 0)
    pct5 = stock_info.get('pctChg_5d', 0)
    signals = stock_info.get('signals', [])
    signal_str = ' | '.join(signals[:4]) if signals else '无特殊信号'
    title = f'{code} {name}  ¥{close}  +{pct:.2f}% (5日{pct5:+.1f}%)  [{signal_str}]'

    # 面板比例: K线4 成交量1 MACD1.5 KDJ1.5
    panel_ratios = (4, 1, 1.5, 1.5)

    mpf.plot(
        df, type='candle', style=style,
        volume=True, addplot=addplots,
        panel_ratios=panel_ratios,
        figsize=(16, 10),
        title=title,
        savefig=dict(fname=output_path, dpi=120, facecolor='#1a1a2e', bbox_inches='tight'),
        warn_too_much_data=999,
    )
    plt.close('all')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("data_file", help="stock_cron_data.py 输出的 JSON 文件")
    parser.add_argument("--output-dir", default="/tmp/stock_charts", help="图表输出目录")
    parser.add_argument("--top", type=int, default=0, help="生成前N只股票的图表（0=全部）")
    args = parser.parse_args()

    with open(args.data_file) as f:
        text = f.read()
    match = re.search(r'\{.*\}', text, re.DOTALL)
    data = json.loads(match.group())

    stocks = data.get('stocks', [])
    # 合并自选股（确保图表也生成）
    watchlist = data.get('watchlist_stocks', [])
    if watchlist:
        existing = {s['code'] for s in stocks}
        for ws in watchlist:
            if ws['code'] not in existing and ws.get('time_series'):
                stocks.append(ws)
    if not stocks:
        print("No stocks found", file=sys.stderr)
        return

    os.makedirs(args.output_dir, exist_ok=True)
    style = build_mpf_style()

    top_stocks = stocks if args.top <= 0 else stocks[:args.top]
    print(f'Generating charts for {len(top_stocks)} stocks...', file=sys.stderr)

    chart_files = []
    for i, s in enumerate(top_stocks):
        time_series = s.get('time_series', [])
        if len(time_series) < 10:
            continue

        try:
            df = time_series_to_df(time_series)
            filename = f'{s["code"]}_{s["name"]}.png'
            output_path = os.path.join(args.output_dir, filename)
            draw_chart(df, s, {}, output_path, style)
            chart_files.append(output_path)
            if (i + 1) % 10 == 0:
                print(f'  {i+1}/{len(top_stocks)} done', file=sys.stderr)
        except Exception as e:
            print(f'  Error {s["code"]}: {e}', file=sys.stderr)

    print(f'Generated {len(chart_files)} charts in {args.output_dir}', file=sys.stderr)
    print(json.dumps({"count": len(chart_files), "output_dir": args.output_dir, "files": chart_files}))


if __name__ == "__main__":
    main()
