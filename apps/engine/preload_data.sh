#!/bin/bash
# 数据预加载脚本：从baostock获取数据并缓存到HDF5
# 建议每天Cron先跑这个，再跑因子挖掘

set -euo pipefail
source /opt/data/daily_stock_analysis/venv/bin/activate
export PYTHONUNBUFFERED=1
cd /opt/data/alpha_miner

echo "[$(date '+%H:%M:%S')] 开始数据预加载..."
python3 data_loader.py --preload --lookback 250
echo "[$(date '+%H:%M:%S')] 数据预加载完成"
