#!/usr/bin/env python3
"""
大A趋势选股Agent - LLM 逐只分析服务
参照 llm-stock-analysy 架构，每只股票独立调用 LLM 分析
"""
import json
import sys
import os
import asyncio
import argparse
from datetime import datetime
import aiohttp

# ============ LLM 配置 ============
LLM_API_KEY = os.environ.get("XIAOMI_API_KEY", os.environ.get("LLM_API_KEY", ""))
LLM_BASE_URL = os.environ.get("XIAOMI_BASE_URL", os.environ.get("LLM_BASE_URL", "https://api.xiaomimimo.com/v1"))
LLM_MODEL = os.environ.get("LLM_MODEL", "mimo-v2.5-pro")
LLM_CONCURRENCY = int(os.environ.get("LLM_CONCURRENCY", "5"))

SYSTEM_PROMPT = """你是一个专业的金融分析师，将收到完整的股票历史数据、技术指标数据和Alpha因子信号进行分析。
数据包括：
1. 历史数据：最近60个交易日的开盘价、收盘价、最高价、最低价和成交量
2. 技术指标：每日的MA/MACD/KDJ/RSI/BOLL/DMI/CCI/ATR/VR/BIAS等30+指标
3. 市场趋势：日/周/月涨跌幅、区间高低
4. Alpha因子：由因子挖掘系统自动发现的有效因子（IC>0.02）
5. 适用策略：系统根据趋势强度自动判断的策略框架

请基于这些完整的历史数据进行深入分析，包括以下方面：

1. 策略框架判断（重要！）
- 根据趋势强度（R²）和信号判断应该使用哪种策略：
  * 趋势跟踪：R²>0.7 + 均线多头排列 + MACD金叉
  * 均值回归：R²<0.3 + RSI超卖 + 触及BOLL下轨
  * 技术指标：R²在0.3-0.7之间，综合判断
- 说明为什么选择这个策略

2. Alpha因子分析
- 列出该股票的Alpha因子信号
- 如果Alpha因子信号一致，增加置信度
- 如果Alpha因子信号矛盾，提示风险

3. 技术面分析
- 通过历史数据分析长期趋势
- 识别关键的支撑位和压力位
- 分析重要的技术形态（头肩顶/底、双底、旗形等）
- 对所有技术指标进行综合研判
- 寻找指标之间的背离现象（价格创新高但MACD/RSI未创新高）

4. 走势研判
- 判断当前趋势的强度和可能持续性
- 识别可能的趋势转折点
- 分析成交量和价格的配合情况
- 预判可能的运行区间

5. 具体买卖点（重要！）
- 给出具体的买入价位（不是模糊的"逢低买入"）
- 给出具体的止损价位（不是模糊的"均线下方"）
- 给出具体的目标价位（第一目标、第二目标）
- 给出仓位建议（首次建仓比例、加仓比例）

6. 风险提示
- 通过历史数据识别潜在风险
- 列出需要警惕的技术信号
- 提供风险规避的具体建议

请注意：
- 结合全部历史数据做出判断，不要只看最近几天
- 分析结果要有数据支持，引用具体的指标值和价格点位
- 避免过度简化或主观判断
- 结合多个维度的指标进行交叉验证
- 买卖点要具体到价格，不要用模糊描述

请以 JSON 格式返回分析结果，包含以下字段：
{
    "summary": "一句话总结当前趋势和核心判断",
    "prediction": "Bullish/Bearish/Neutral 之一",
    "confidence": 0.0-1.0 之间的置信度,
    "reasoning": "预测的核心理由（2-3句话）",
    "strategy_type": "趋势跟踪/均值回归/技术指标/回避",
    "strategy_reason": "为什么选择这个策略",
    "alpha_signals": ["Alpha因子1看多", "Alpha因子2看多"],
    "alpha_conclusion": "Alpha因子综合结论",
    "technical_analysis": "技术面详细分析（包含关键指标解读）",
    "trend_analysis": "走势研判（趋势强度、转折点、量价关系）",
    "entry_price": "具体买入价位（如：17.50元或回踩MA10不破买入）",
    "stop_loss_price": "具体止损价位（如：16.20元）",
    "target_price_1": "第一目标价位",
    "target_price_2": "第二目标价位",
    "position_advice": "仓位建议（如：首次30%，回踩加仓20%）",
    "holding_period": "持有周期（短线/波段/中线）",
    "exit_signal": "出场信号（如：MA死叉或MACD顶背离）",
    "risk_warning": "风险提示（警惕信号、规避建议）"
}

不要包含 markdown 格式如 ```json ... ```，只返回纯 JSON 对象。"""


def format_stock_prompt(stock):
    """将单只股票数据格式化为 LLM prompt"""
    code = stock['code']
    name = stock['name']
    time_series = stock.get('time_series', [])
    market_trend = stock.get('market_trend', {})
    signals = stock.get('signals', [])
    
    # Alpha因子信息（新增）
    alpha_signals = stock.get('alpha_signals', [])
    alpha_boost = stock.get('alpha_boost', 0)
    strategy = stock.get('strategy', {})
    boll_r2 = stock.get('boll_r2', 0)
    boll_direction = stock.get('boll_direction', 0)

    key_fields = ['date', 'open', 'close', 'high', 'low', 'volume', 'MA5', 'MA20', 'DIF', 'DEA', 'MACD', 'K', 'D', 'J', 'RSI', 'CCI', 'VR', 'BIAS3']
    recent = []
    for ts in time_series[-10:]:
        entry = {k: ts.get(k) for k in key_fields if k in ts}
        recent.append(entry)

    latest = time_series[-1] if time_series else {}
    summary_fields = ['close', 'MA5', 'MA10', 'MA20', 'MA60', 'DIF', 'DEA', 'MACD', 'K', 'D', 'J', 'RSI', 'CCI', 'VR', 'PDI', 'MDI', 'ADX', 'BIAS3', 'ATR']
    summary = {k: latest.get(k) for k in summary_fields if k in latest}

    return f"""分析股票 {code} {name}

技术信号：{' | '.join(signals) if signals else '无'}

Alpha因子信号：
- Alpha评分加成: {alpha_boost}
- Alpha信号: {' | '.join(alpha_signals) if alpha_signals else '无Alpha因子信号'}

趋势强度：
- BOLL R²: {boll_r2}（R²>0.7=强趋势，R²<0.3=震荡）
- 趋势方向: {'上升' if boll_direction > 0 else '下降' if boll_direction < 0 else '无方向'}

系统建议策略：
- 策略类型: {strategy.get('type', '未知')}
- 策略理由: {strategy.get('reason', '未知')}
- 入场条件: {strategy.get('entry', '未知')}
- 止损条件: {strategy.get('stop_loss', '未知')}
- 出场条件: {strategy.get('exit', '未知')}

最新指标摘要：{json.dumps(summary, ensure_ascii=False)}

近10日行情（含关键指标）：
{json.dumps(recent, ensure_ascii=False)}

市场趋势：{json.dumps(market_trend, ensure_ascii=False)}

请基于以上数据进行全面技术分析，并给出具体的买卖点建议。"""


async def analyze_single_stock(semaphore, session, stock, results, progress, total):
    """异步分析单只股票（含重试）"""
    async with semaphore:
        code = stock['code']
        name = stock['name']
        prompt = format_stock_prompt(stock)

        for attempt in range(3):
            try:
                timeout = aiohttp.ClientTimeout(total=180, connect=30)
                async with session.post(
                    f"{LLM_BASE_URL}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {LLM_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": LLM_MODEL,
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0.3,
                        "max_tokens": 4000,
                    },
                    timeout=timeout
                ) as resp:
                    data = await resp.json()

                    if 'choices' not in data:
                        err_msg = data.get('error', {}).get('message', 'unknown')
                        if attempt < 2:
                            print(f"  [!] {code} {name}: API error (retry {attempt+1}): {err_msg}", file=sys.stderr)
                            await asyncio.sleep(2 * (attempt + 1))
                            continue
                        print(f"  [FAIL] {code} {name}: API error - {err_msg}", file=sys.stderr)
                        results.append({'code': code, 'name': name, 'analysis': None, 'error': str(err_msg)})
                        return

                    raw_content = (data['choices'][0]['message'].get('content') or '').strip()

                    if not raw_content:
                        if attempt < 2:
                            print(f"  [!] {code} {name}: empty content (retry {attempt+1})", file=sys.stderr)
                            await asyncio.sleep(2 * (attempt + 1))
                            continue
                        print(f"  [FAIL] {code} {name}: empty content after 3 attempts", file=sys.stderr)
                        results.append({'code': code, 'name': name, 'analysis': None, 'error': 'empty content'})
                        return

                    # 清理 markdown 包装
                    c = raw_content
                    if c.startswith("```json"):
                        c = c[7:]
                    if c.startswith("```"):
                        c = c[3:]
                    if c.endswith("```"):
                        c = c[:-3]
                    c = c.strip()

                    try:
                        analysis = json.loads(c)
                        results.append({'code': code, 'name': name, 'analysis': analysis, 'error': None})
                        progress[0] += 1
                        print(f"  [OK] [{progress[0]}/{total}] {code} {name}: {analysis.get('prediction', '?')} ({analysis.get('confidence', 0):.0%})", file=sys.stderr)
                        return
                    except json.JSONDecodeError as e:
                        # 尝试从截断的JSON中提取部分字段
                        import re as _re
                        def _extract(field, text):
                            m = _re.search(rf'"{field}"\s*:\s*"([^"]*)"', text)
                            return m.group(1) if m else ''
                        def _extract_num(field, text):
                            m = _re.search(rf'"{field}"\s*:\s*([\d.]+)', text)
                            return float(m.group(1)) if m else 0
                        partial_summary = _extract('summary', c) or c[:200]
                        partial_prediction = _extract('prediction', c) or 'Neutral'
                        partial_confidence = _extract_num('confidence', c) or 0.3
                        partial_reasoning = _extract('reasoning', c)
                        partial_tech = _extract('technical_analysis', c)
                        partial_trend = _extract('trend_analysis', c)
                        results.append({
                            'code': code, 'name': name,
                            'analysis': {
                                'summary': partial_summary, 'prediction': partial_prediction,
                                'confidence': partial_confidence,
                                'reasoning': partial_reasoning or c[:300],
                                'technical_analysis': partial_tech or 'N/A',
                                'trend_analysis': partial_trend or 'N/A',
                                'investment_advice': 'N/A', 'risk_warning': 'JSON解析失败(截断)'
                            }, 'error': str(e)
                        })
                        progress[0] += 1
                        print(f"  [!] [{progress[0]}/{total}] {code} {name}: JSON parse error (partial extracted)", file=sys.stderr)
                        return

            except asyncio.TimeoutError:
                if attempt < 2:
                    print(f"  [TIME] {code} {name}: timeout (retry {attempt+1})", file=sys.stderr)
                    await asyncio.sleep(3 * (attempt + 1))
                    continue
                print(f"  [FAIL] {code} {name}: timeout after 3 attempts", file=sys.stderr)
                results.append({'code': code, 'name': name, 'analysis': None, 'error': 'timeout'})
                return
            except aiohttp.ClientError as e:
                if attempt < 2:
                    print(f"  [!] {code} {name}: {type(e).__name__} (retry {attempt+1})", file=sys.stderr)
                    await asyncio.sleep(3 * (attempt + 1))
                    continue
                err_msg = f"{type(e).__name__}: {e}"
                print(f"  [FAIL] {code} {name}: {err_msg}", file=sys.stderr)
                results.append({'code': code, 'name': name, 'analysis': None, 'error': err_msg})
                return
            except Exception as e:
                err_msg = f"{type(e).__name__}: {e}" if str(e) else repr(e)
                print(f"  [FAIL] {code} {name}: {err_msg}", file=sys.stderr)
                results.append({'code': code, 'name': name, 'analysis': None, 'error': err_msg})
                return


async def analyze_batch(stocks):
    """批量分析股票（分批处理，避免连接池堆积）"""
    results = []
    progress = [0]
    total = len(stocks)
    batch_size = 50

    connector = aiohttp.TCPConnector(limit=LLM_CONCURRENCY, limit_per_host=LLM_CONCURRENCY, ttl_dns_cache=300)
    async with aiohttp.ClientSession(connector=connector) as session:
        for i in range(0, total, batch_size):
            batch = stocks[i:i+batch_size]
            semaphore = asyncio.Semaphore(LLM_CONCURRENCY)
            tasks = [
                analyze_single_stock(semaphore, session, stock, results, progress, total)
                for stock in batch
            ]
            await asyncio.gather(*tasks)
            print(f"  [BATCH] 批次 {i//batch_size + 1} 完成 ({min(i+batch_size, total)}/{total})", file=sys.stderr)

    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("data_file", help="stock_cron_data.py 输出的 JSON 文件")
    parser.add_argument("--top", type=int, default=0, help="分析前N只股票（0=全部）")
    parser.add_argument("--api-key", help="LLM API Key (或设置 LLM_API_KEY 环境变量)")
    parser.add_argument("--base-url", help="LLM API Base URL")
    parser.add_argument("--model", help="LLM Model name")
    args = parser.parse_args()

    global LLM_API_KEY, LLM_BASE_URL, LLM_MODEL
    if args.api_key:
        LLM_API_KEY = args.api_key
    if args.base_url:
        LLM_BASE_URL = args.base_url
    if args.model:
        LLM_MODEL = args.model

    if not LLM_API_KEY:
        print("Error: LLM_API_KEY not set. Use --api-key or set LLM_API_KEY env var.", file=sys.stderr)
        sys.exit(1)

    with open(args.data_file) as f:
        text = f.read()
    import re
    match = re.search(r'\{.*\}', text, re.DOTALL)
    data = json.loads(match.group())

    all_stocks = data.get('stocks', [])
    # 自选股始终加入LLM分析（不受top限制）——插入到列表最前面
    watchlist_stocks = data.get('watchlist_stocks', [])
    if watchlist_stocks:
        existing_codes = {s['code'] for s in all_stocks}
        wl_to_add = []
        for ws in watchlist_stocks:
            if ws['code'] not in existing_codes:
                wl_to_add.append(ws)
                print(f"   [!] 自选股 {ws.get('name','?')}({ws['code']}) 加入LLM分析", file=sys.stderr)
        if wl_to_add:
            all_stocks = wl_to_add + all_stocks  # 插入到最前面
    stocks = all_stocks if args.top <= 0 else all_stocks[:args.top]
    print(f"[*] 准备分析 {len(stocks)} 只股票 (model: {LLM_MODEL}, concurrency: {LLM_CONCURRENCY})", file=sys.stderr)

    t_start = datetime.now()
    results = asyncio.run(analyze_batch(stocks))
    elapsed = (datetime.now() - t_start).total_seconds()

    success = sum(1 for r in results if r['analysis'] is not None)
    failed = sum(1 for r in results if r['analysis'] is None)
    bullish = [r for r in results if (r.get('analysis') or {}).get('prediction') == 'Bullish']
    bearish = [r for r in results if (r.get('analysis') or {}).get('prediction') == 'Bearish']
    neutral = [r for r in results if (r.get('analysis') or {}).get('prediction') == 'Neutral']

    print(f"\n[OK] 分析完成: {success}成功 / {failed}失败 / 耗时{elapsed:.1f}秒", file=sys.stderr)
    print(f"   [UP] 看多: {len(bullish)} | [DOWN] 看空: {len(bearish)} | [->] 中性: {len(neutral)}", file=sys.stderr)

    output = {
        'date': data.get('date', ''),
        'analysis_time': datetime.now().isoformat(),
        'analysis_seconds': round(elapsed, 1),
        'model': LLM_MODEL,
        'total_analyzed': len(results),
        'success': success,
        'failed': failed,
        'predictions': {
            'bullish': len(bullish),
            'bearish': len(bearish),
            'neutral': len(neutral),
        },
        'results': results,
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
