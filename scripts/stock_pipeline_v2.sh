#!/bin/bash
# 大A趋势选股Agent - 完整流程编排(优化版)
# 用法: stock_pipeline_v2.sh [--date YYYY-MM-DD] [--top N]
# 流程: 数据采集 -> LLM分析 -> 报告+飞书文档
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="/opt/data/daily_stock_analysis/venv/bin/activate"
ENV_FILE="/opt/data/.env"
OUTPUT_DIR="/tmp/stock_output_$(date +%Y%m%d%H%M%S)"
DATE_ARG=""

# 解析命名参数
while [[ $# -gt 0 ]]; do
    case "$1" in
        --date) DATE_ARG="--date $2"; shift 2 ;;
        *) shift ;;
    esac
done

# 日期参数:如果未指定则自动获取最近交易日
if [ -z "$DATE_ARG" ]; then
    DOW=$(date +%u)  # 1=Mon, 7=Sun
    if [ "$DOW" -eq 6 ]; then
        DATE_ARG="--date $(date -d 'yesterday' +%Y-%m-%d)"
    elif [ "$DOW" -eq 7 ]; then
        DATE_ARG="--date $(date -d '2 days ago' +%Y-%m-%d)"
    fi
fi

mkdir -p "$OUTPUT_DIR"

source "$VENV"
if [ -f "$ENV_FILE" ]; then
  set -a; source "$ENV_FILE"; set +a
fi

echo "[*] 大A趋势选股完整流程启动" >&2
echo "   输出: $OUTPUT_DIR" >&2

# -- Step 1: 数据采集+指标计算(含自选股)--
echo "" >&2
echo "[>>] Step 1/3: 数据采集+指标计算..." >&2
DATA_FILE="$OUTPUT_DIR/stock_data.json"
WATCHLIST_ARG=""
if [ -f "/opt/data/profiles/quant-trading/config/watchlist.json" ]; then
    WL_COUNT=$(python3 -c "import json; print(len(json.load(open('/opt/data/profiles/quant-trading/config/watchlist.json')).get('stocks',[])))" 2>/dev/null || echo 0)
    if [ "$WL_COUNT" -gt 0 ]; then
        WATCHLIST_ARG="--watchlist /opt/data/profiles/quant-trading/config/watchlist.json"
        echo "   [!] 含 $WL_COUNT 只自选股" >&2
    fi
fi
python3 "$SCRIPTS_DIR/stock_cron_data.py" $DATE_ARG $WATCHLIST_ARG > "$DATA_FILE" 2>/dev/null

STOCK_COUNT=$(python3 -c "
import json, re
with open('$DATA_FILE') as f:
    data = json.loads(re.search(r'\{.*\}', f.read(), re.DOTALL).group())
print(data.get('analyzed', 0))
")
echo "   [OK] $STOCK_COUNT 只股票数据就绪" >&2

if [ "$STOCK_COUNT" -eq 0 ]; then
    echo "[!] 无数据，退出" >&2
    exit 0
fi

# -- Step 2: LLM逐只分析 --
echo "" >&2
echo "[AI] Step 2/3: LLM逐只分析..." >&2
ANALYSIS_FILE="$OUTPUT_DIR/analysis.json"
python3 "$SCRIPTS_DIR/stock_llm_analyzer.py" "$DATA_FILE" > "$ANALYSIS_FILE" 2>"$OUTPUT_DIR/analyzer.log" || {
    echo "   [!] LLM分析失败，使用量化评分替代" >&2
    # 生成无LLM的报告
    python3 -c "
import json, re, sys
with open('$DATA_FILE') as f:
    data = json.loads(re.search(r'\{.*\}', f.read(), re.DOTALL).group())
results = []
for s in data['stocks']:
    results.append({
        'code': s['code'], 'name': s['name'],
        'analysis': {
            'summary': f\"量化评分: {s.get('quant_score', 0)} | 信号: {', '.join(s.get('signals', []))}\",
            'prediction': 'Bullish' if s.get('quant_score', 0) >= 4 else ('Bearish' if s.get('quant_score', 0) < 0 else 'Neutral'),
            'confidence': min(0.5 + s.get('quant_score', 0) * 0.05, 0.95),
            'reasoning': '基于量化评分(无LLM分析)',
            'technical_analysis': 'N/A',
            'trend_analysis': 'N/A',
            'investment_advice': 'N/A',
            'risk_warning': 'N/A'
        },
        'error': None
    })
output = {
    'date': data.get('date', ''),
    'analysis_time': '$(date -Iseconds)',
    'analysis_seconds': 0,
    'model': 'quant-only',
    'total_analyzed': len(results),
    'success': len(results),
    'failed': 0,
    'predictions': {
        'bullish': sum(1 for r in results if r['analysis']['prediction']=='Bullish'),
        'bearish': sum(1 for r in results if r['analysis']['prediction']=='Bearish'),
        'neutral': sum(1 for r in results if r['analysis']['prediction']=='Neutral'),
    },
    'results': results,
}
with open('$ANALYSIS_FILE', 'w') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print(f'量化分析完成: {len(results)} 只', file=sys.stderr)
" 2>&1
}
echo "   [OK] 分析完成" >&2

# -- Step 2.5: Alpha因子变动追踪 --
echo "" >&2
echo "[DNA] Step 2.5/3: Alpha因子变动追踪..." >&2
FACTOR_CHANGES_FILE="$OUTPUT_DIR/factor_changes.json"
python3 "$SCRIPTS_DIR/factor_change_tracker.py" > "$FACTOR_CHANGES_FILE" 2>"$OUTPUT_DIR/factor_changes.log" || {
    echo "   [!] 因子变动追踪失败(非致命)" >&2
    FACTOR_CHANGES_FILE=""
}
if [ -n "$FACTOR_CHANGES_FILE" ] && [ -f "$FACTOR_CHANGES_FILE" ]; then
    echo "   [OK] 因子变动追踪完成" >&2
fi

# -- Step 3: 生成报告+飞书文档 --
echo "" >&2
echo "[DOC] Step 3/3: 生成报告+飞书文档..." >&2
REPORT_FILE="$OUTPUT_DIR/report.md"
FACTOR_CHANGES_ARG=""
if [ -n "$FACTOR_CHANGES_FILE" ] && [ -f "$FACTOR_CHANGES_FILE" ]; then
    FACTOR_CHANGES_ARG="--factor-changes $FACTOR_CHANGES_FILE"
fi
python3 "$SCRIPTS_DIR/stock_report.py" "$DATA_FILE" --analysis "$ANALYSIS_FILE" --output "$REPORT_FILE" $FACTOR_CHANGES_ARG 2>&1

# -- Strip emoji from report (飞书不支持部分emoji导致99992402) --
echo "" >&2
echo "[CLEAN] 去除报告中的emoji字符..." >&2
python3 -c "
import re, sys
emoji_pat = re.compile(
    '[\U0001F000-\U0001FFFF\U00002702-\U000027B0\U0000FE00-\U0000FE0F\U0000200D'
    '\U00002600-\U000026FF\U0000231A-\U0000231B\U000023E9-\U000023F3\U000023F8-\U000023FA'
    '\U00002934-\U00002935\U000025AA-\U000025AB\U000025B6\U000025C0\U000025FB-\U000025FE'
    '\U00002B05-\U00002B07\U00002B1B-\U00002B1C\U00002B50\U00002B55\U00003030\U0000303D'
    '\U00003297\U00003299\U0001FA00-\U0001FA6F\U0001FA70-\U0001FAFF]+',
    flags=re.UNICODE
)
with open('$REPORT_FILE', 'r') as f:
    text = f.read()
cleaned = emoji_pat.sub('', text)
# Also strip common text emojis like ✅ ❌ ⚠️
cleaned = re.sub(r'[✅❌⚠️⭐🎯📋📊📈📉🔄🆕🔬🏅🏆🥇🥈🥉💥🔥💡🚀💰🔔📌📎🛡️🚨]', '', cleaned)
if cleaned != text:
    with open('$REPORT_FILE', 'w') as f:
        f.write(cleaned)
    removed = len(text) - len(cleaned)
    print(f'   [OK] 已去除 {removed} 个emoji字符', file=sys.stderr)
else:
    print(f'   [OK] 无需清洗', file=sys.stderr)
"

echo "" >&2
echo "[OK] 全部完成！" >&2
echo "   数据: $DATA_FILE" >&2
echo "   分析: $ANALYSIS_FILE" >&2
echo "   报告: $REPORT_FILE" >&2

# -- 输出文件路径标记(供cron agent使用) --
echo ""
echo "REPORT_FILE=$REPORT_FILE"
echo "ANALYSIS_FILE=$ANALYSIS_FILE"
echo "DATA_FILE=$DATA_FILE"
