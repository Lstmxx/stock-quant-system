#!/bin/bash
# Alpha因子挖掘 Cron Job 脚本(自我优化版)
# 每天北京时间20:00运行(UTC 12:00)
# 流程: 预加载数据 -> 自我优化 -> 因子挖掘

set -euo pipefail

# --─ 工具函数 --─
log() {
    echo "[$(date '+%H:%M:%S')] $*"
}

log_step() {
    echo ""
    echo "----------------------------------------"
    log ">> $*"
    echo "----------------------------------------"
}

log_done() {
    log "[OK] $* 完成"
}

log_fail() {
    log "[FAIL] $* 失败"
}

# --─ 环境准备 --─
log_step "环境准备"
source /opt/data/daily_stock_analysis/venv/bin/activate
export PYTHONUNBUFFERED=1
cd /opt/data/alpha_miner
log_done "环境准备"

# --─ 周末跳过 --─
DAY_OF_WEEK=$(date -u +%u)
if [ "$DAY_OF_WEEK" -ge 6 ]; then
    log "周末不运行，退出"
    exit 0
fi

ROUNDS="${1:-3}"
FACTORS_PER_ROUND="${2:-3}"

log "参数: 方向=自动, 轮数=$ROUNDS, 每轮因子数=$FACTORS_PER_ROUND"
log "开始时间: $(date '+%Y-%m-%d %H:%M:%S')"

# --─ Step 1: 预加载数据 --─
log_step "Step 1/3: 预加载数据 (baostock)"
T1=$(date +%s)
python3 data_loader.py --preload --lookback 250
T2=$(date +%s)
log_done "数据预加载 (耗时 $((T2-T1))秒)"

# --─ Step 2: 自我优化 + 因子挖掘 --─
log_step "Step 2/3: 自我优化 + 因子挖掘"
T3=$(date +%s)
python3 alpha_miner.py \
    --self-optimize \
    --auto-direction \
    --user-id "${FACTOR_USER_ID:?FACTOR_USER_ID is required}" \
    --llm-model-id "${FACTOR_LLM_MODEL_ID:?FACTOR_LLM_MODEL_ID is required}" \
    --rounds "$ROUNDS" \
    --factors-per-round "$FACTORS_PER_ROUND"
T4=$(date +%s)
log_done "因子挖掘 (耗时 $((T4-T3))秒)"

# --─ Step 3: 输出统计 --─
log_step "Step 3/3: 输出因子库统计"
python3 -c "
from factor_library import library
from factor_decay import decay_monitor
from direction_manager import direction_manager

print()
print('=== 优化后状态 ===')
print(library.format_summary())
print()
print(decay_monitor.format_report())
print()
print(direction_manager.format_report())
" 2>/dev/null || log "统计输出跳过"
log_done "统计输出"

# --─ 完成 --─
T_END=$(date +%s)
log_step "全部完成"
log "总耗时: $((T_END-T1))秒"
log "结束时间: $(date '+%Y-%m-%d %H:%M:%S')"

# -- 输出文件路径标记(供cron agent使用) --
OUTPUT_DIR="/tmp/alpha_output_$(date +%Y%m%d)"
mkdir -p "$OUTPUT_DIR"
echo ""
echo "OUTPUT_DIR=$OUTPUT_DIR"
echo "FACTOR_LIBRARY=/opt/data/alpha_miner/factor_library.json"
