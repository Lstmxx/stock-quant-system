#!/usr/bin/env python3
"""
大A趋势选股Agent - 专业报告生成器
生成美观的飞书文档 + 嵌入mplfinance图表
"""
import json
import sys
import os
import re
import argparse
import subprocess
from datetime import datetime
from collections import Counter


def upload_chart(filepath):
    """上传图表到飞书Drive，返回file_token"""
    try:
        result = subprocess.run(
            ['bash', '-c', f'export PATH="/opt/data/home/.local/bin:$PATH" && cd "$(dirname "{filepath}")" && lark-cli drive +upload --file "$(basename "{filepath}")"'],
            capture_output=True, text=True, timeout=30
        )
        match = re.search(r'"file_token":\s*"([^"]+)"', result.stdout)
        if match:
            return match.group(1)
    except Exception as e:
        print(f"  ⚠️ Upload failed {filepath}: {e}", file=sys.stderr)
    return None


def create_feishu_doc(title, content_file):
    """创建飞书文档，返回URL"""
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


def _render_stock_detail(s, i, llm_map, chart_tokens):
    """渲染单只股票的详细分析（供重点股和自选股共用）"""
    lines = []
    code = s['code']
    name = s['name']
    score = s.get('quant_score', 0)
    signals = s.get('signals', [])
    close = s.get('close', 0)
    pct = s.get('pctChg_today', 0)
    pct5 = s.get('pctChg_5d', 0)
    amount = s.get('amount_yi', 0)
    turn = s.get('turnover', 0)
    alpha_boost = s.get('alpha_boost', 0)
    alpha_signals = s.get('alpha_signals', [])
    strategy = s.get('strategy', {})
    boll_r2 = s.get('boll_r2', 0)
    note = s.get('note', '')

    llm = llm_map.get(code, {})
    llm_analysis = llm.get('analysis') or {}
    pred = llm_analysis.get('prediction', '')
    pred_icon = {'Bullish': '📈', 'Bearish': '📉', 'Neutral': '➡️'}.get(pred, '⏳')
    conf = llm_analysis.get('confidence', 0)

    title_extra = f' — {note}' if note else ''
    # MA5策略标记
    ma5_tags = []
    if '五日线战法' in signals:
        ma5_tags.append('[五日线战法]')
    if '二波主升浪' in signals:
        ma5_tags.append('[二波主升浪]')
    ma5_mark = ' ' + ' '.join(ma5_tags) if ma5_tags else ''
    lines.append(f'### {i}. {code} {name}{title_extra}{ma5_mark}')
    lines.append('')
    lines.append(f'`¥{close}` `{pct:+.2f}%` `5日{pct5:+.1f}%` `评分{score}` `额{amount:.1f}亿` `换手{turn:.1f}%`')
    lines.append('')

    if strategy:
        lines.append(f'**📊 策略框架**: {strategy.get("type", "未知")}')
        lines.append(f'- 理由: {strategy.get("reason", "")}')
        lines.append(f'- 趋势强度: R²={boll_r2}')
        lines.append('')

    if alpha_signals:
        lines.append(f'**🧬 Alpha因子**: 加分{alpha_boost}')
        for sig in alpha_signals[:3]:
            lines.append(f'- {sig}')
        lines.append('')

    if signals:
        tags = ' '.join([f'`{s}`' for s in signals[:6]])
        lines.append(f'**信号**: {tags}')
        lines.append('')

    if llm_analysis:
        lines.append(f'**{pred_icon} AI判断**: {pred} 置信度 {conf:.0%}')
        if llm_analysis.get('summary'):
            lines.append(f'> {llm_analysis["summary"]}')
        if llm_analysis.get('reasoning'):
            lines.append(f'> 💡 核心理由: {llm_analysis["reasoning"]}')
        lines.append('')
        if llm_analysis.get('technical_analysis'):
            lines.append(f'**🔬 技术面分析**')
            lines.append(f'> {llm_analysis["technical_analysis"]}')
            lines.append('')
        if llm_analysis.get('trend_analysis'):
            lines.append(f'**📈 走势研判**')
            lines.append(f'> {llm_analysis["trend_analysis"]}')
            lines.append('')
        if llm_analysis.get('strategy_type'):
            lines.append(f'**📊 策略**: {llm_analysis["strategy_type"]} - {llm_analysis.get("strategy_reason", "")}')
        if llm_analysis.get('alpha_conclusion'):
            lines.append(f'**🧬 Alpha**: {llm_analysis["alpha_conclusion"]}')
        lines.append('')
        if llm_analysis.get('entry_price'):
            lines.append(f'> 🎯 买入: {llm_analysis["entry_price"]}')
        if llm_analysis.get('stop_loss_price'):
            lines.append(f'> 🛑 止损: {llm_analysis["stop_loss_price"]}')
        if llm_analysis.get('target_price_1'):
            lines.append(f'> 📈 目标1: {llm_analysis["target_price_1"]}')
        if llm_analysis.get('target_price_2'):
            lines.append(f'> 📈 目标2: {llm_analysis["target_price_2"]}')
        if llm_analysis.get('position_advice'):
            lines.append(f'> 📦 仓位: {llm_analysis["position_advice"]}')
        if llm_analysis.get('holding_period'):
            lines.append(f'> ⏰ 周期: {llm_analysis["holding_period"]}')
        if llm_analysis.get('exit_signal'):
            lines.append(f'> 🔄 出场: {llm_analysis["exit_signal"]}')
        if llm_analysis.get('risk_warning'):
            lines.append(f'> ⚠️ {llm_analysis["risk_warning"]}')
        lines.append('')

    token = chart_tokens.get(code)
    if token:
        lines.append(f'![{code} {name} K线图]({token})')
        lines.append('')

    return lines


def _render_summary_table(stocks, llm_map, title="总览"):
    """渲染股票摘要表格"""
    import re as _re

    def _short_price(val):
        """提取价位中的数字部分，截断到15字符"""
        if not val or val == '—':
            return '—'
        # 提取第一个数字
        m = _re.search(r'[\d.]+', val)
        if m:
            return m.group() + '元'
        return val[:15]

    def _short_pos(val):
        """截断仓位建议"""
        if not val or val == '—':
            return '—'
        # 提取百分比
        m = _re.search(r'[\d.]+%', val)
        if m:
            return m.group()
        return val[:12]

    lines = []
    lines.append(f'### 📋 {title}速查表')
    lines.append('')
    lines.append('| # | 代码 | 名称 | 价格 | 涨幅 | 5日 | 评分 | AI判断 | 策略 | 买入 | 止损 | 目标1 | 目标2 | 仓位 | 核心理由 |')
    lines.append('|---|------|------|------|------|-----|------|--------|------|------|------|-------|-------|------|----------|')
    for i, s in enumerate(stocks, 1):
        code = s['code']
        name = s['name']
        close = s.get('close', 0)
        pct = s.get('pctChg_today', 0)
        pct5 = s.get('pctChg_5d', 0)
        score = s.get('quant_score', 0)
        strategy_type = s.get('strategy', {}).get('type', '—')

        llm = llm_map.get(code, {})
        llm_analysis = llm.get('analysis') or {}
        pred = llm_analysis.get('prediction', '')
        pred_short = {'Bullish': '📈看多', 'Bearish': '📉看空', 'Neutral': '➡️中性'}.get(pred, '⏳')
        conf = llm_analysis.get('confidence', 0)
        ai_str = f'{pred_short} {conf:.0%}' if pred else '—'
        entry = _short_price(llm_analysis.get('entry_price', ''))
        stop = _short_price(llm_analysis.get('stop_loss_price', ''))
        t1 = _short_price(llm_analysis.get('target_price_1', ''))
        t2 = _short_price(llm_analysis.get('target_price_2', ''))
        pos = _short_pos(llm_analysis.get('position_advice', ''))
        reasoning = llm_analysis.get('reasoning', '') or llm_analysis.get('summary', '')
        if len(reasoning) > 40:
            reasoning = reasoning[:40] + '...'
        reasoning = reasoning.replace('|', '\\|').replace('\n', ' ')

        pct_str = f'+{pct:.2f}%' if pct >= 0 else f'{pct:.2f}%'
        pct5_str = f'+{pct5:.1f}%' if pct5 >= 0 else f'{pct5:.1f}%'

        lines.append(f'| {i} | {code} | {name} | ¥{close} | {pct_str} | {pct5_str} | {score} | {ai_str} | {strategy_type} | {entry} | {stop} | {t1} | {t2} | {pos} | {reasoning} |')
    lines.append('')
    return lines


def generate_beautiful_report(data, analysis_results=None, chart_tokens=None, factor_changes=None):
    """生成美观的Markdown报告"""
    stocks = data.get('stocks', [])
    date = data.get('date', '')
    chart_tokens = chart_tokens or {}
    watchlist_stocks = data.get('watchlist_stocks', [])

    # 盘面分析（新增）
    index_analysis = data.get('index_analysis', {})

    # 分类
    green = [s for s in stocks if s.get('quant_score', 0) >= 4]
    yellow = [s for s in stocks if 1 <= s.get('quant_score', 0) < 4]
    red = [s for s in stocks if s.get('quant_score', 0) < 1]

    # LLM分析结果映射
    llm_map = {}
    if analysis_results:
        for r in analysis_results:
            llm_map[r['code']] = r

    # 行业分布
    industries = Counter()
    for s in stocks:
        if s.get('industry'):
            industries[s['industry']] += 1

    md = []

    # ── 封面 ──
    md.append(f'# 📊 大A趋势选股日报')
    md.append('')
    md.append(f'**{date}** | 沪市主板 + 深市主板')
    md.append('')
    md.append('---')
    md.append('')

    # ── 盘面分析（新增）──
    if index_analysis and 'error' not in index_analysis:
        md.append('## 📈 盘面分析（上证指数）')
        md.append('')
        
        # 指数概况
        close = index_analysis.get('close', 0)
        pct_change = index_analysis.get('pct_change', 0)
        pct_5d = index_analysis.get('pct_5d', 0)
        pct_20d = index_analysis.get('pct_20d', 0)
        amount = index_analysis.get('amount', 0)
        
        pct_icon = '📈' if pct_change >= 0 else '📉'
        md.append(f'**上证指数**: `{close}` {pct_icon} `{pct_change:+.2f}%`')
        md.append(f'- 5日涨幅: `{pct_5d:+.2f}%` | 20日涨幅: `{pct_20d:+.2f}%`')
        md.append(f'- 成交额: `{amount:.0f}亿`')
        md.append('')
        
        # 市场阶段
        market_phase = index_analysis.get('market_phase', {})
        phase = market_phase.get('market_phase', '未知')
        trend = market_phase.get('trend', '未知')
        strength = market_phase.get('strength', '未知')
        ma_alignment = market_phase.get('ma_alignment', '未知')
        description = market_phase.get('description', '')
        rsi_signal = market_phase.get('rsi_signal', '')
        volume_signal = market_phase.get('volume_signal', '')
        
        phase_icon = {'牛市': '🐂', '熊市': '🐻', '震荡市': '🔄', '过渡期': '⏳'}.get(phase, '❓')
        md.append(f'**市场阶段**: {phase_icon} **{phase}**')
        md.append(f'- 趋势: {trend}（强度: {strength}）')
        md.append(f'- 均线排列: {ma_alignment}')
        md.append(f'- {description}')
        if rsi_signal:
            md.append(f'- {rsi_signal}')
        if volume_signal:
            md.append(f'- {volume_signal}')
        md.append('')
        
        # 技术指标
        indicators = index_analysis.get('indicators', {})
        ma5 = indicators.get('MA5')
        ma10 = indicators.get('MA10')
        ma20 = indicators.get('MA20')
        ma60 = indicators.get('MA60')
        dif = indicators.get('DIF')
        dea = indicators.get('DEA')
        rsi = indicators.get('RSI')
        boll_r2 = indicators.get('boll_r2', 0)
        
        md.append('**技术指标**:')
        if ma5 and ma10 and ma20 and ma60:
            md.append(f'- 均线: MA5={ma5} | MA10={ma10} | MA20={ma20} | MA60={ma60}')
        if dif and dea:
            macd_status = '金叉' if dif > dea else '死叉'
            md.append(f'- MACD: DIF={dif:.2f} | DEA={dea:.2f} | {macd_status}')
        if rsi:
            rsi_status = '超买' if rsi > 70 else '超卖' if rsi < 30 else '正常'
            md.append(f'- RSI: {rsi:.1f}（{rsi_status}）')
        md.append(f'- 趋势强度: R²={boll_r2}')
        md.append('')
        
        # 支撑压力位
        sr = index_analysis.get('support_resistance', {})
        supports = sr.get('supports', [])
        resistances = sr.get('resistances', [])
        
        if supports:
            md.append('**支撑位**:')
            for name, price in supports[:3]:
                md.append(f'- {name}: {price:.2f}')
        
        if resistances:
            md.append('**压力位**:')
            for name, price in resistances[:3]:
                md.append(f'- {name}: {price:.2f}')
        md.append('')
        
        # 操作建议
        md.append('**操作建议**:')
        if phase == '牛市':
            md.append('- ✅ 市场处于上升趋势，适合积极做多')
            md.append('- 📊 重点关注趋势跟踪策略的股票')
        elif phase == '熊市':
            md.append('- ⚠️ 市场处于下降趋势，建议控制仓位')
            md.append('- 📊 只关注超跌反弹机会，严格止损')
        elif phase == '震荡市':
            md.append('- 🔄 市场震荡整理，适合高抛低吸')
            md.append('- 📊 关注均值回归策略的股票')
        else:
            md.append('- ⏳ 市场方向不明，建议观望为主')
        md.append('')
        
        md.append('---')
        md.append('')

    # ── 市场全景 ──
    md.append('## 📈 市场全景')
    md.append('')
    md.append(f'| 指标 | 数值 |')
    md.append(f'|------|------|')
    md.append(f'| 扫描股票 | {data.get("total_main_board", 0)} 只 |')
    md.append(f'| 涨幅>3% | {data.get("gainers_gt_3pct", 0)} 只 |')
    md.append(f'| 🟢 关注（评分≥4） | {len(green)} 只 |')
    md.append(f'| 🟡 观望（1-3分） | {len(yellow)} 只 |')
    md.append(f'| 🔴 回避（<1分） | {len(red)} 只 |')
    md.append(f'| 耗时 | {data.get("scan_seconds", 0):.0f} 秒 |')
    md.append('')

    # 涨幅分布
    pct_10 = sum(1 for s in stocks if s.get('pctChg_today', 0) >= 10)
    pct_5_10 = sum(1 for s in stocks if 5 <= s.get('pctChg_today', 0) < 10)
    pct_3_5 = sum(1 for s in stocks if 3 <= s.get('pctChg_today', 0) < 5)
    md.append(f'**涨幅分布**: 🔴涨停≥10% {pct_10}只 | 🟠 5%-10% {pct_5_10}只 | 🟡 3%-5% {pct_3_5}只')
    md.append('')

    # 行业分布
    if industries:
        md.append('**行业热力 Top 10**:')
        md.append('')
        md.append('| 行业 | 数量 | 热力条 |')
        md.append('|------|------|--------|')
        max_cnt = industries.most_common(1)[0][1] if industries else 1
        for name, cnt in industries.most_common(10):
            bar_len = int(cnt / max_cnt * 15)
            bar = '█' * bar_len + '░' * (15 - bar_len)
            md.append(f'| {name} | {cnt} | {bar} |')
        md.append('')

    md.append('---')
    md.append('')

    # ── 🧬 Alpha因子变动 ──
    if factor_changes:
        md.append('## 🧬 Alpha因子变动')
        md.append('')
        md.append(f'*{factor_changes.get("compare_note", "")} | 共{factor_changes.get("total_factors", 0)}个因子，{factor_changes.get("valid_factors", 0)}个有效*')
        md.append('')
        md.append(f'> {factor_changes.get("summary", "")}')
        md.append('')

        changes = factor_changes.get('changes', {})

        # 新增因子
        new_factors = changes.get('new', [])
        if new_factors:
            md.append('### 🆕 新增因子')
            md.append('')
            for f in new_factors:
                ic_str = f'{f.get("ic", 0):.4f}' if f.get('ic') else '—'
                md.append(f'- **{f.get("name", "")}** (IC={ic_str})')
                md.append(f'  - 表达式: `{f.get("expression", "")}`')
                if f.get('hypothesis'):
                    md.append(f'  - 假设: {f["hypothesis"]}')
                md.append(f'  - 原因: {f.get("reason", "")}')
            md.append('')

        # IC提升
        improved = changes.get('improved', [])
        if improved:
            md.append('### 📈 IC提升')
            md.append('')
            md.append('| 因子 | 旧IC | 新IC | 变动 | 假设/思路 |')
            md.append('|------|------|------|------|-----------|')
            for f in improved[:10]:
                hypothesis = f.get('hypothesis', '') or f.get('notes', '')
                if len(hypothesis) > 60:
                    hypothesis = hypothesis[:60] + '...'
                md.append(f'| {f.get("name","")} | {f.get("old_ic",0):.4f} | {f.get("new_ic",0):.4f} | +{f.get("delta",0):.4f} | {hypothesis} |')
            md.append('')

        # IC下降
        declined = changes.get('declined', [])
        if declined:
            md.append('### 📉 IC下降')
            md.append('')
            md.append('| 因子 | 旧IC | 新IC | 变动 | 假设/思路 |')
            md.append('|------|------|------|------|-----------|')
            for f in declined[:10]:
                hypothesis = f.get('hypothesis', '') or f.get('notes', '')
                if len(hypothesis) > 60:
                    hypothesis = hypothesis[:60] + '...'
                md.append(f'| {f.get("name","")} | {f.get("old_ic",0):.4f} | {f.get("new_ic",0):.4f} | {f.get("delta",0):.4f} | {hypothesis} |')
            md.append('')

        # 排名变动
        ranking = changes.get('ranking', [])
        if ranking:
            md.append('### 🏆 排名变动（≥2位）')
            md.append('')
            for f in ranking[:10]:
                arrow = '⬆️' if f['rank_delta'] > 0 else '⬇️'
                md.append(f'- {arrow} **{f.get("name","")}**: 第{f.get("old_rank")}→第{f.get("new_rank")} (IC={f.get("ic",0):.4f})')
            md.append('')

        # 移除因子
        removed = changes.get('removed', [])
        if removed:
            md.append('### ❌ 移除因子')
            md.append('')
            for f in removed:
                md.append(f'- **{f.get("name","")}** (IC={f.get("ic",0):.4f}): {f.get("reason","")}')
            md.append('')

        # Top因子排行
        top_factors = factor_changes.get('top_factors', [])
        if top_factors:
            md.append('### 🏅 当前Top因子')
            md.append('')
            md.append('| 排名 | 因子 | IC | ICIR | 方向 | 假设 |')
            md.append('|------|------|-----|------|------|------|')
            for f in top_factors[:10]:
                direction = '正向' if f.get('direction', 1) > 0 else '负向'
                hypothesis = f.get('hypothesis', '')
                if len(hypothesis) > 50:
                    hypothesis = hypothesis[:50] + '...'
                md.append(f'| {f["rank"]} | {f.get("name","")} | {f.get("ic",0):.4f} | {f.get("icir",0):.4f} | {direction} | {hypothesis} |')
            md.append('')

        md.append('---')
        md.append('')

    # ── ⭐ 自选股分析 ──
    if watchlist_stocks:
        md.append('## ⭐ 自选股分析')
        md.append('')
        md.append(f'*共 {len(watchlist_stocks)} 只自选股*')
        md.append('')
        # 摘要表格
        md.extend(_render_summary_table(watchlist_stocks, llm_map, "自选股"))
        # 详细分析
        for i, s in enumerate(watchlist_stocks, 1):
            md.extend(_render_stock_detail(s, i, llm_map, chart_tokens))
            if i < len(watchlist_stocks):
                md.append('---')
                md.append('')
        md.append('---')
        md.append('')

    # ── 🟢 重点关注 ──
    if green:
        md.append('## 🟢 重点关注（评分≥4）')
        md.append('')
        # 摘要表格
        md.extend(_render_summary_table(green[:20], llm_map, "重点关注"))
        # 详细分析
        for i, s in enumerate(green[:20], 1):
            md.extend(_render_stock_detail(s, i, llm_map, chart_tokens))
            if i < len(green[:20]):
                md.append('---')
                md.append('')

    # ── 🟡 观望 ──
    if yellow:
        md.append('## 🟡 观望（评分1-3）')
        md.append('')
        md.append('| 代码 | 名称 | 涨幅 | 评分 | 信号 |')
        md.append('|------|------|------|------|------|')
        for s in yellow[:30]:
            sigs = ', '.join(s.get('signals', [])[:3])
            md.append(f'| {s["code"]} | {s["name"]} | +{s.get("pctChg_today",0):.2f}% | {s.get("quant_score",0)} | {sigs} |')
        if len(yellow) > 30:
            md.append(f'')
            md.append(f'*...及其他 {len(yellow)-30} 只*')
        md.append('')

    # ── 🔴 回避 ──
    if red:
        md.append('## 🔴 回避（评分<1）')
        md.append('')
        for s in red[:20]:
            md.append(f'- {s["code"]} {s["name"]} +{s.get("pctChg_today",0):.2f}% — 评分{s.get("quant_score",0)}')
        if len(red) > 20:
            md.append(f'- *...及其他 {len(red)-20} 只*')
        md.append('')

    # ── 底部 ──
    md.append('---')
    md.append('')
    md.append('**分析模型**: mimo-v2.5-pro | **指标体系**: MyTT 30+ (MA/MACD/KDJ/RSI/BOLL/DMI/CCI/ATR/VR/BIAS/ROC/MTM/DPO/TRIX/PSY/WR/EMV)')
    md.append('')
    md.append('⚠️ **风险提示**: 以上分析基于AI模型对技术指标的量化研判，不构成投资建议。市场有风险，投资需谨慎。')

    return '\n'.join(md)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("data_file", help="stock_cron_data.py 输出的 JSON")
    parser.add_argument("--analysis", help="LLM分析结果 JSON（可选）")
    parser.add_argument("--charts-dir", help="图表目录（可选）")
    parser.add_argument("--output", help="输出文件路径")
    parser.add_argument("--feishu", action="store_true", help="创建飞书文档")
    parser.add_argument("--factor-changes", help="因子变动追踪 JSON（可选）")
    args = parser.parse_args()

    # 读取数据
    with open(args.data_file) as f:
        text = f.read()
    match = re.search(r'\{.*\}', text, re.DOTALL)
    data = json.loads(match.group())

    # 读取LLM分析结果
    analysis_results = None
    if args.analysis:
        with open(args.analysis) as f:
            text = f.read()
        match = re.search(r'\{.*\}', text, re.DOTALL)
        analysis_data = json.loads(match.group())
        analysis_results = analysis_data.get('results', [])

    # 上传图表
    chart_tokens = {}
    if args.charts_dir and os.path.isdir(args.charts_dir):
        print(f"📤 上传图表到飞书...", file=sys.stderr)
        for fname in os.listdir(args.charts_dir):
            if fname.endswith('.png'):
                code = fname.split('_')[0]
                fpath = os.path.join(args.charts_dir, fname)
                token = upload_chart(fpath)
                if token:
                    chart_tokens[code] = token
                    print(f"  ✅ {fname} -> {token}", file=sys.stderr)
        print(f"  上传完成: {len(chart_tokens)} 张", file=sys.stderr)

    # 读取因子变动数据
    factor_changes = None
    if args.factor_changes and os.path.exists(args.factor_changes):
        try:
            with open(args.factor_changes) as f:
                factor_changes = json.load(f)
        except Exception as e:
            print(f"⚠️ 读取因子变动数据失败: {e}", file=sys.stderr)

    # 生成报告
    report = generate_beautiful_report(data, analysis_results, chart_tokens, factor_changes)

    # 保存
    output_path = args.output or f'/tmp/stock_report_{data.get("date", "unknown")}.md'
    with open(output_path, 'w') as f:
        f.write(report)
    print(f"📄 报告: {output_path} ({len(report)} 字符)", file=sys.stderr)

    # 创建飞书文档（可选，失败不影响报告生成）
    if args.feishu:
        date = data.get('date', '')
        title = f"📊 大A趋势选股日报 — {date}"
        doc_url = create_feishu_doc(title, output_path)
        if doc_url:
            print(f"📄 飞书文档: {doc_url}", file=sys.stderr)
            print(f"FEISHU_DOC_URL={doc_url}", file=sys.stderr)
        else:
            print(f"⚠️ 飞书文档创建失败，将使用文件附件方式发送", file=sys.stderr)
            print(f"FEISHU_DOC_FAILED=1", file=sys.stderr)

    print(report)


if __name__ == "__main__":
    main()
