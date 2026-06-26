#!/usr/bin/env python3
"""
快速生成个股详情分析飞书文档
- 从现有分析结果读取LLM分析
- 只为top N股票拉取120天历史数据生成图表
- 创建美观飞书文档
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import json
import re
import subprocess
import time
from datetime import datetime, timedelta

import baostock as bs
import pandas as pd
import numpy as np
import mplfinance as mpf
import matplotlib
matplotlib.use('Agg')

# ============ 配置 ============
ANALYSIS_FILE = "/tmp/stock_analysis_result.md"
OUTPUT_DIR = "/tmp/stock_fast_output"
TOP_N = 15  # 只为top N生成图表

os.makedirs(OUTPUT_DIR, exist_ok=True)

# ============ 解析分析结果 ============
def parse_analysis(text):
    """解析LLM分析结果"""
    results = []
    sections = re.split(r'\n---\n', text)
    for section in sections:
        # 匹配 ### 代码 名称 | 涨X% | 评分X/7
        header = re.search(r'###\s+(\d+)\s+(\S+)\s*\|\s*涨([\d.]+)%\s*\|\s*评分(\d+)/7', section)
        if not header:
            continue
        code = header.group(1)
        name = header.group(2)
        gain = float(header.group(3))
        score = int(header.group(4))
        
        # 提取各字段
        def extract(label):
            m = re.search(rf'\*\*{label}\*\*:\s*(.+?)(?=\n\*\*|\Z)', section, re.DOTALL)
            return m.group(1).strip() if m else "N/A"
        
        prediction = extract("预测")
        confidence = extract("置信度")
        technical = extract("技术面")
        trend = extract("走势研判")
        advice = extract("操作建议")
        risk = extract("风险")
        
        results.append({
            'code': code, 'name': name, 'gain': gain, 'score': score,
            'prediction': prediction, 'confidence': confidence,
            'technical': technical, 'trend': trend,
            'advice': advice, 'risk': risk,
        })
    return results

# ============ 拉取历史数据 ============
def fetch_history(code_short, days=120):
    """拉取股票历史数据"""
    # 确定前缀
    if code_short.startswith('6'):
        full_code = f"sh.{code_short}"
    else:
        full_code = f"sz.{code_short}"
    
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days + 30)).strftime("%Y-%m-%d")
    
    rs = bs.query_history_k_data_plus(
        full_code,
        "date,open,high,low,close,volume,amount,turn",
        start_date=start_date, end_date=end_date,
        frequency="d", adjustflag="2"
    )
    rows = []
    while rs.next():
        rows.append(rs.get_row_data())
    
    if not rows:
        return None
    
    df = pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume", "amount", "turn"])
    for col in ["open", "high", "low", "close", "volume", "amount", "turn"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date")
    df = df.tail(days)
    return df

# ============ 生成K线图表 ============
def generate_chart(df, code, name, output_path):
    """使用mplfinance生成专业4面板图表"""
    if df is None or len(df) < 20:
        return False
    
    C = df['close'].values
    H = df['high'].values
    L = df['low'].values
    
    # MA
    df['MA5'] = pd.Series(C, index=df.index).rolling(5).mean()
    df['MA10'] = pd.Series(C, index=df.index).rolling(10).mean()
    df['MA20'] = pd.Series(C, index=df.index).rolling(20).mean()
    
    # BOLL
    mid = pd.Series(C, index=df.index).rolling(20).mean()
    std = pd.Series(C, index=df.index).rolling(20).std()
    df['BOLL_UP'] = mid + 2 * std
    df['BOLL_DN'] = mid - 2 * std
    
    # MACD
    ema12 = pd.Series(C, index=df.index).ewm(span=12).mean()
    ema26 = pd.Series(C, index=df.index).ewm(span=26).mean()
    dif = ema12 - ema26
    dea = dif.ewm(span=9).mean()
    df['DIF'] = dif
    df['DEA'] = dea
    df['MACD_HIST'] = (dif - dea) * 2
    
    # KDJ
    low_min = pd.Series(L, index=df.index).rolling(9).min()
    high_max = pd.Series(H, index=df.index).rolling(9).max()
    rsv = (C - low_min) / (high_max - low_min + 1e-10) * 100
    k = rsv.ewm(com=2).mean()
    d = k.ewm(com=2).mean()
    j = 3 * k - 2 * d
    df['K'] = k
    df['D'] = d
    df['J'] = j
    
    # 红涨绿跌配色
    mc = mpf.make_marketcolors(
        up='#FF4444', down='#00CC00',
        edge={'up': '#FF4444', 'down': '#00CC00'},
        wick={'up': '#FF4444', 'down': '#00CC00'},
        volume={'up': '#FF6666', 'down': '#66CC66'},
    )
    s = mpf.make_mpf_style(
        marketcolors=mc, gridstyle=':', gridcolor='#333333',
        facecolor='#1a1a2e', figcolor='#1a1a2e',
        edgecolor='#333333', rc={'font.size': 9}
    )
    
    # 附加线
    add_plots = [
        mpf.make_addplot(df['MA5'], color='#FFD700', width=0.8, panel=0),
        mpf.make_addplot(df['MA10'], color='#00BFFF', width=0.8, panel=0),
        mpf.make_addplot(df['MA20'], color='#FF69B4', width=0.8, panel=0),
        mpf.make_addplot(df['BOLL_UP'], color='#888888', width=0.5, linestyle='--', panel=0),
        mpf.make_addplot(df['BOLL_DN'], color='#888888', width=0.5, linestyle='--', panel=0),
        # MACD
        mpf.make_addplot(df['DIF'], color='#FFD700', width=0.8, panel=2, ylabel='MACD'),
        mpf.make_addplot(df['DEA'], color='#00BFFF', width=0.8, panel=2),
        mpf.make_addplot(df['MACD_HIST'], type='bar', color=['#FF4444' if v >= 0 else '#00CC00' for v in df['MACD_HIST']], width=0.6, panel=2),
        # KDJ
        mpf.make_addplot(df['K'], color='#FFD700', width=0.8, panel=3, ylabel='KDJ'),
        mpf.make_addplot(df['D'], color='#00BFFF', width=0.8, panel=3),
        mpf.make_addplot(df['J'], color='#FF69B4', width=0.8, panel=3),
    ]
    
    try:
        mpf.plot(
            df, type='candle', style=s,
            volume=True, volume_panel=1,
            addplot=add_plots,
            title=f'\n{code} {name}',
            panel_ratios=(4, 1.5, 1.5, 1.5),
            figsize=(12, 10),
            tight_layout=True,
            savefig=dict(fname=output_path, dpi=120, bbox_inches='tight'),
            warn_too_much_data=999,
        )
        return True
    except Exception as e:
        print(f"  ⚠️ Chart error {code}: {e}", file=sys.stderr)
        return False

# ============ 上传图表 ============
def upload_chart(filepath):
    """上传图表到飞书Drive"""
    try:
        result = subprocess.run(
            ['bash', '-c', f'cd "$(dirname "{filepath}")" && ~/.local/bin/lark-cli drive +upload --file "$(basename "{filepath}")"'],
            capture_output=True, text=True, timeout=30
        )
        match = re.search(r'"file_token":\s*"([^"]+)"', result.stdout)
        if match:
            return match.group(1)
    except Exception as e:
        print(f"  ⚠️ Upload failed {filepath}: {e}", file=sys.stderr)
    return None

# ============ 生成报告 ============
def generate_report(analysis_results, chart_tokens, date_str):
    """生成美观的飞书Markdown报告"""
    md = []
    
    # ── 封面 ──
    md.append('# 📊 大A趋势选股 · 个股深度分析')
    md.append('')
    md.append(f'**{date_str}** | AI深度技术分析 + 量化评分')
    md.append('')
    
    # ── 统计概览 ──
    bullish = sum(1 for r in analysis_results if '看多' in r.get('prediction', ''))
    bearish = sum(1 for r in analysis_results if '看空' in r.get('prediction', ''))
    neutral = len(analysis_results) - bullish - bearish
    
    md.append('## 📈 分析概览')
    md.append('')
    md.append(f'| 指标 | 数值 |')
    md.append(f'|------|------|')
    md.append(f'| 分析股票 | **{len(analysis_results)}** 只 |')
    md.append(f'| 🟢 看多 | **{bullish}** 只 |')
    md.append(f'| 🟡 中性 | **{neutral}** 只 |')
    md.append(f'| 🔴 看空 | **{bearish}** 只 |')
    md.append(f'| 分析模型 | mimo-v2.5-pro |')
    md.append(f'| 指标体系 | MyTT 30+ |')
    md.append('')
    md.append('---')
    md.append('')
    
    # ── 个股详情 ──
    md.append('## 🔍 个股深度分析')
    md.append('')
    
    for i, r in enumerate(analysis_results):
        code = r['code']
        name = r['name']
        gain = r['gain']
        score = r['score']
        prediction = r['prediction']
        
        # 预测emoji
        if '看多' in prediction or '🟢' in prediction:
            pred_emoji = '🟢'
        elif '看空' in prediction or '🔴' in prediction:
            pred_emoji = '🔴'
        else:
            pred_emoji = '🟡'
        
        # 标题
        md.append(f'### {pred_emoji} {code} {name}')
        md.append('')
        
        # 概览卡片
        md.append(f'| 涨幅 | 评分 | 预测 | 置信度 |')
        md.append(f'|------|------|------|--------|')
        md.append(f'| +{gain:.2f}% | {score}/7 | {prediction} | {r.get("confidence", "N/A")} |')
        md.append('')
        
        # 图表
        token = chart_tokens.get(code)
        if token:
            md.append(f'![K线图]({token})')
            md.append('')
        
        # 技术面分析
        md.append('**🔬 技术面分析**')
        md.append('')
        md.append(r.get('technical', 'N/A'))
        md.append('')
        
        # 走势研判
        md.append('**📈 走势研判**')
        md.append('')
        md.append(r.get('trend', 'N/A'))
        md.append('')
        
        # 操作建议
        md.append('**💡 操作建议**')
        md.append('')
        md.append(r.get('advice', 'N/A'))
        md.append('')
        
        # 风险提示
        md.append('**⚠️ 风险提示**')
        md.append('')
        md.append(r.get('risk', 'N/A'))
        md.append('')
        
        if i < len(analysis_results) - 1:
            md.append('---')
            md.append('')
    
    # ── 底部 ──
    md.append('---')
    md.append('')
    md.append('**分析模型**: mimo-v2.5-pro | **指标体系**: MyTT 30+ (MA/MACD/KDJ/RSI/BOLL/DMI/CCI/ATR/VR/BIAS/ROC/MTM/DPO/TRIX/PSY/WR/EMV)')
    md.append('')
    md.append('⚠️ **风险提示**: 以上分析基于AI模型对技术指标的量化研判，不构成投资建议。市场有风险，投资需谨慎。')
    
    return '\n'.join(md)

# ============ 创建飞书文档 ============
def create_feishu_doc(title, content_file):
    """创建飞书文档"""
    try:
        result = subprocess.run(
            ['bash', '/opt/data/scripts/create_feishu_doc.sh', title, content_file],
            capture_output=True, text=True, timeout=60
        )
        for line in (result.stdout + result.stderr).split('\n'):
            if 'feishu.cn/docx/' in line:
                match = re.search(r'https://[^\s"]+feishu\.cn/docx/\w+', line)
                if match:
                    return match.group(0)
    except Exception as e:
        print(f"  ⚠️ Doc creation failed: {e}", file=sys.stderr)
    return None

# ============ 主流程 ============
def main():
    # 1. 读取分析结果
    print("📖 读取LLM分析结果...", file=sys.stderr)
    with open(ANALYSIS_FILE) as f:
        analysis_text = f.read()
    analysis_results = parse_analysis(analysis_text)
    print(f"   ✅ {len(analysis_results)} 只股票分析数据", file=sys.stderr)
    
    # 2. 拉取历史数据 + 生成图表
    print("📈 拉取历史数据 + 生成图表...", file=sys.stderr)
    bs.login()
    
    chart_tokens = {}
    for i, r in enumerate(analysis_results[:TOP_N]):
        code = r['code']
        name = r['name']
        print(f"   [{i+1}/{min(TOP_N, len(analysis_results))}] {code} {name}...", file=sys.stderr, end="")
        
        # 拉取数据
        df = fetch_history(code, days=60)
        if df is None:
            print(" ❌ 无数据", file=sys.stderr)
            continue
        
        # 生成图表
        chart_path = os.path.join(OUTPUT_DIR, f"{code}_{name}.png")
        if generate_chart(df, code, name, chart_path):
            print(" 📊", file=sys.stderr, end="")
            
            # 上传
            token = upload_chart(chart_path)
            if token:
                chart_tokens[code] = token
                print(f" ✅ {token}", file=sys.stderr)
            else:
                print(" ⚠️ 上传失败", file=sys.stderr)
        else:
            print(" ❌ 图表失败", file=sys.stderr)
        
        time.sleep(0.2)  # baostock rate limit
    
    bs.logout()
    print(f"   ✅ {len(chart_tokens)} 张图表上传成功", file=sys.stderr)
    
    # 3. 生成报告
    print("📄 生成报告...", file=sys.stderr)
    date_str = datetime.now().strftime("%Y-%m-%d")
    report = generate_report(analysis_results, chart_tokens, date_str)
    
    report_path = os.path.join(OUTPUT_DIR, "report.md")
    with open(report_path, 'w') as f:
        f.write(report)
    print(f"   ✅ 报告: {report_path} ({len(report)} 字符)", file=sys.stderr)
    
    # 4. 创建飞书文档
    print("📤 创建飞书文档...", file=sys.stderr)
    title = f"📊 大A趋势选股·个股深度分析 — {date_str}"
    doc_url = create_feishu_doc(title, report_path)
    if doc_url:
        print(f"   ✅ 飞书文档: {doc_url}", file=sys.stderr)
        print(doc_url)
    else:
        print("   ❌ 文档创建失败", file=sys.stderr)

if __name__ == "__main__":
    main()
