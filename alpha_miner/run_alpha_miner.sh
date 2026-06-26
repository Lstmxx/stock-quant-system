#!/bin/bash
# Alpha因子挖掘启动脚本
# 用法: bash run_alpha_miner.sh [方向] [轮数] [每轮因子数]

set -euo pipefail

# 激活venv
source /opt/data/daily_stock_analysis/venv/bin/activate

# 加载环境变量
source /opt/data/.env 2>/dev/null || true

# 切换到项目目录
cd /opt/data/alpha_miner

# 参数
DIRECTION="${1:-量价关系}"
ROUNDS="${2:-5}"
FACTORS_PER_ROUND="${3:-3}"
LOOKBACK_DAYS="${4:-250}"

echo "=========================================="
echo "Alpha因子挖掘器"
echo "=========================================="
echo "研究方向: $DIRECTION"
echo "挖掘轮数: $ROUNDS"
echo "每轮因子数: $FACTORS_PER_ROUND"
echo "数据回看: $LOOKBACK_DAYS 天"
echo "=========================================="
echo ""

# 运行
python3 alpha_miner.py \
    --direction "$DIRECTION" \
    --rounds "$ROUNDS" \
    --factors-per-round "$FACTORS_PER_ROUND" \
    --lookback-days "$LOOKBACK_DAYS" \
    2>&1

echo ""
echo "=========================================="
echo "挖掘完成！因子库位置: /opt/data/alpha_miner/factors/"
echo "=========================================="
