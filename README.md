# Stock Quant System

A股量化交易系统：数据采集 → 技术指标 → LLM分析 → Alpha因子挖掘

## 项目结构

```
├── alpha_miner/              # Alpha因子挖掘系统
│   ├── alpha_miner.py        # 主入口：因子进化引擎
│   ├── factor_calculator.py  # 因子计算器
│   ├── factor_evaluator.py   # 因子评估（IC、IR、衰减分析）
│   ├── factor_evolution.py   # 因子进化（遗传算法）
│   ├── factor_dsl.py         # 因子DSL解析器
│   ├── factor_library.py     # 因子库管理
│   ├── factor_decay.py       # 因子衰减分析
│   ├── multi_factor_selector.py # 多因子组合选择
│   ├── data_loader.py        # 数据加载（baostock + HDF5缓存）
│   ├── llm_backend.py        # LLM后端（因子生成）
│   ├── direction_manager.py  # 因子方向管理
│   ├── param_search.py       # 参数搜索优化
│   ├── prompts.py            # LLM Prompt模板
│   └── config.py             # 配置
│
├── scripts/                  # 股票分析脚本
│   ├── stock_cron_data.py    # 数据采集 + 技术指标计算（baostock）
│   ├── stock_llm_analyzer.py # LLM驱动的股票分析器
│   ├── stock_report.py       # Markdown报告生成
│   ├── stock_pipeline_v2.sh  # 主Pipeline编排脚本
│   ├── stock_charts.py       # K线图表生成（mplfinance）
│   ├── index_analysis.py     # 大盘指数分析
│   ├── factor_change_tracker.py  # 因子变动追踪
│   ├── stock_intraday_monitor.py # 盘中异动监控
│   ├── stock_screener.py     # 多因子选股器
│   ├── watchlist_analysis.py # 自选股分析
│   ├── mytt.py               # MyTT技术指标库
│   ├── alpha_factor_calc.py  # Alpha因子计算工具
│   ├── fetch_and_build.py    # 数据获取与构建
│   ├── generate_final_report.py  # 最终报告生成
│   ├── stock_fast_report.py  # 快速报告生成
│   ├── cron_alpha_miner.sh   # Alpha因子定时任务
│   └── cron_intraday_monitor.sh  # 盘中监控定时任务
│
├── .env.example              # 环境变量模板
└── .gitignore
```

## 核心流程

### 1. 数据采集 + 指标计算
```bash
python scripts/stock_cron_data.py
```
- 数据源：baostock（A股日线、分钟线）
- 技术指标：MA、MACD、RSI、KDJ、BOLL、ATR等
- 输出：带指标的股票数据CSV

### 2. LLM股票分析
```bash
python scripts/stock_llm_analyzer.py
```
- 输入：技术指标数据 + 基本面信息
- LLM分析：趋势判断、支撑压力位、买卖信号
- 输出：个股分析报告（Markdown）

### 3. 报告生成
```bash
python scripts/stock_report.py
```
- 汇总所有分析结果
- 生成完整的选股日报

### 4. Alpha因子挖掘
```bash
cd alpha_miner && python alpha_miner.py
```
- LLM生成因子表达式（DSL）
- 遗传算法进化优化
- IC/IR评估 + 衰减分析
- 多因子组合选择

### 5. 完整Pipeline
```bash
bash scripts/stock_pipeline_v2.sh
```
一键执行：数据采集 → 指标计算 → LLM分析 → 报告生成

## 环境要求

```bash
pip install baostock pandas numpy mplfinance ta-lib
# Alpha因子额外依赖
cd alpha_miner && pip install -r requirements.txt
```

## 环境变量

参考 `.env.example` 配置：
- `LLM_API_KEY` - LLM API密钥
- `LLM_BASE_URL` - LLM API地址
- `LLM_MODEL` - 模型名称
