# Alpha因子挖掘器

基于LLM的A股量价因子自动挖掘系统。

## 核心特性

Engine 的 `/internal/*` 接口必须配置 `INTERNAL_SERVICE_TOKEN`，API 通过
`Authorization: Bearer <token>` 调用；不要把 Engine 端口暴露到公网。

- **LLM驱动**：使用mimo-v2.5-pro自动生成研究假设和因子表达式
- **量价专注**：专注量价关系、资金流向、市场情绪，不做基本面假设
- **自动进化**：参考QuantaAlpha/RD-Agent的进化策略，自动迭代优化因子
- **严格评估**：IC/ICIR/分组收益/单调性多维度评估
- **代码调试**：因子执行失败时LLM自动调试修复

## 评估标准

| 指标 | 标准 | 说明 |
|------|------|------|
| IC绝对值 | > 0.02 | 因子与下期收益的相关性 |
| IC方向 | >45%或<-45% | 因子方向明确（正向/负向） |
| 单调性 | > 0.6 | 分组收益的单调程度 |
| NaN比例 | < 30% | 数据质量 |
| 嵌套深度 | ≤ 3 | 因子复杂度限制 |

## 文件结构

```
alpha_miner/
├── config.py              # 配置文件
├── factor_dsl.py          # DSL函数库（61个量价算子）
├── factor_parser.py       # 表达式解析器
├── data_loader.py         # baostock数据加载
├── factor_calculator.py   # 因子计算引擎
├── factor_evaluator.py    # 因子评估模块
├── factor_library.py      # 因子库管理
├── llm_backend.py         # LLM调用后端
├── prompts.py             # 提示词模板
├── evolution.py           # 进化策略
├── alpha_miner.py         # 主控循环
├── run_alpha_miner.sh     # 手动运行脚本
├── cron_alpha_miner.sh    # Cron Job脚本
└── factors/               # 因子库数据
    ├── factor_library.json
    └── values/
```

## 使用方法

### 手动运行

```bash
# 激活环境
source /opt/data/daily_stock_analysis/venv/bin/activate
source /opt/data/.env

# 运行挖掘
cd /opt/data/alpha_miner
python3 alpha_miner.py --direction "量价关系" --rounds 5

# 或使用脚本
bash run_alpha_miner.sh "量价关系" 5 3
```

### Cron Job（每天自动运行）

```bash
# 每天北京时间20:00运行（UTC 12:00）
0 12 * * 1-5 /opt/data/alpha_miner/cron_alpha_miner.sh "量价关系" 3 3
```

## DSL算子库

### 时序算子
- `TS_MEAN(x, d)` - d日均值
- `TS_STD(x, d)` - d日标准差
- `TS_MAX(x, d)` / `TS_MIN(x, d)` - d日最大/最小值
- `TS_CORR(x, y, d)` - d日相关系数
- `DELTA(x, d)` - d日差分
- `EMA(x, d)` / `SMA(x, d)` - 指数/简单移动平均

### 截面算子
- `RANK(x)` - 截面排名百分位
- `ZSCORE(x)` - 截面标准化

### 技术指标
- `RSI(x, d)` - 相对强弱指标
- `MACD_DIF(x)` / `MACD_HIST(x)` - MACD
- `KDJ_K/KDJ_D/KDJ_J(...)` - KDJ
- `BOLL_UP/BOLL_DN(...)` - 布林带
- `ATR(h, l, c, d)` - 平均真实波幅

### 量价算子
- `VOLUME_RATIO(volume, d)` - 量比
- `PRICE_VOLUME_CORR(close, volume, d)` - 量价相关
- `UP_DOWN_RATIO(close, volume, d)` - 上涨日成交量占比

## 研究方向

可用的研究方向：
- `量价关系` - 成交量与价格的关系
- `动量反转` - 动量/反转效应
- `波动率` - 波动率相关因子
- `资金流向` - 大单资金、主力资金
- `市场情绪` - 换手率、涨跌比
- `趋势跟踪` - 趋势强度、方向

## 注意事项

1. **数据来源**：使用baostock获取沪深主板数据
2. **运行时间**：建议在北京时间20:00后运行（baostock数据更新需要时间）
3. **API限制**：mimo-v2.5-pro有调用频率限制，每轮约需5-10分钟
4. **因子去重**：系统自动基于表达式MD5去重
5. **进化策略**：当因子库有2个以上有效因子时，自动启用进化
