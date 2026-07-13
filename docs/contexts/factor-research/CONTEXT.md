# 因子研究上下文

## 使命

把量价研究假设转化为可执行、可评估、可追踪的 Alpha 因子，并通过 LLM 生成与进化流程扩展因子库。

## 边界

包含：

- 生成因子假设和 DSL 表达式
- 解析、计算、调试和去重因子
- 使用 IC、ICIR、单调性等指标评估因子
- 对候选因子执行迭代和进化
- 持久化并查询用户的因子库
- 模拟单个因子的研究表现

不包含：

- 原始行情的采集生命周期
- 最终投资建议或实盘下单
- 通用 LLM 账户与密钥生命周期

## 核心规则

- 因子由 `expression` 唯一表达其计算逻辑，展示名称不能替代表达式。
- 只有通过评估标准的候选因子才能标记为有效因子。
- 方向用于说明因子值与预期收益的正负关系，不代表买卖指令。
- 因子挖掘任务必须绑定当前用户可用的 LLM 模型配置。
- 因子与任务均属于发起研究的用户。

## 术语表

| 术语 | 定义 | 避免使用 |
| --- | --- | --- |
| 研究假设 | 对某种量价关系为何可能产生超额收益的可检验陈述 | 投资结论 |
| 因子 | 由 DSL 表达式计算得到、用于横截面或时序研究的信号 | 策略（因子本身不是完整策略） |
| 候选因子 | 已生成但尚未通过全部有效性标准的因子 | 无效因子（评估完成前） |
| 有效因子 | 已通过当前评估标准并标记 `isValid` 的因子 | 盈利因子 |
| 因子挖掘任务 | 生成、评估并可能进化多个候选因子的异步任务，类型为 `FACTOR_MINING` | 回测任务 |
| DSL | 描述因子计算的受限表达式语言及算子集合 | Python 公式 |
| IC | 因子值与后续收益的相关性指标 | 收益率 |
| ICIR | IC 均值相对其波动的稳定性指标 | 夏普比率 |
| 单调性 | 分组收益是否随因子排序呈稳定变化的度量 | 趋势强度 |

## 协作关系

- 消费**市场数据**提供的行情矩阵。
- 向**投研决策**提供因子表达式、方向和评估指标。
- 依赖**平台运行**解析 LLM 配置、执行异步任务并保存用户数据。

## 代码地图

- 挖掘主流程：`apps/engine/app/core/alpha_miner.py`
- DSL 与解析：`apps/engine/app/core/factor_dsl.py`、`factor_parser.py`
- 计算与评估：`apps/engine/app/core/factor_calculator.py`、`factor_evaluator.py`
- 进化与因子库：`apps/engine/app/core/evolution.py`、`factor_library.py`
- API：`apps/api/src/modules/factor`、`apps/api/src/modules/task`
- 界面：`apps/web/src/features/factor`
- 持久化：`packages/database/src/schema.ts` 中的 `alphaFactors`、`alphaTasks`

