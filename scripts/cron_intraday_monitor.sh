#!/bin/bash
# 股票盘中监控定时任务wrapper
# 在交易日每小时检查昨日报告中的重点关注和自选股

set -e

# 关键：清除代理环境变量
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy

# 激活虚拟环境
source /opt/data/daily_stock_analysis/venv/bin/activate

# 脚本目录
SCRIPTS_DIR="/opt/data/profiles/quant-trading/scripts"
OUTPUT_DIR="/tmp/intraday_monitor"

# 确保输出目录存在
mkdir -p "$OUTPUT_DIR"

# 生成报告文件名
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="$OUTPUT_DIR/monitor_$TIMESTAMP.md"

# 运行监控脚本
python3 "$SCRIPTS_DIR/stock_intraday_monitor.py" --output "$REPORT_FILE" 2>"$OUTPUT_DIR/monitor.log"

# 输出报告路径供cron job使用
echo "REPORT_FILE=$REPORT_FILE"
