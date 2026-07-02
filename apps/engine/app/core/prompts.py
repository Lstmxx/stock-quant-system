"""
提示词模板模块
==============
管理所有LLM交互的提示词，包含：
- 假设生成提示词
- 因子表达式生成提示词
- 反馈生成提示词
- 代码调试提示词

设计原则：
1. 从量价、资金、情绪角度出发，不做基本面假设
2. 因子表达式使用DSL函数库
3. 组合因子不超过3层嵌套
"""
from typing import Dict, List, Optional

from .factor_dsl import get_operator_docs


# ============================================================
# 假设生成提示词
# ============================================================

HYPOTHESIS_SYSTEM = """你是一个专业的A股量化研究员，专注于量价因子挖掘。

研究哲学：
1. **量价关系是核心**：成交量、价格、换手率之间的关系蕴含丰富的市场信息
2. **资金流向**：大单资金、主力资金的流入流出往往领先价格变化
3. **市场情绪**：波动率、涨跌比、换手率等反映市场参与者的情绪
4. **不做基本面假设**：我们不假设PE、PB、ROE等基本面因子有效

研究方法：
- 从市场微观结构出发（订单流、买卖价差、成交量分布）
- 从行为金融学出发（过度反应、羊群效应、处置效应）
- 从技术分析理论出发（趋势、动量、均值回复）

注意：
- 假设必须具体、可量化、可验证
- 避免模糊的描述（如"股票可能涨"）
- 提出明确的变量和关系（如"成交量放大但价格不涨，可能预示下跌"）"""


HYPOTHESIS_PROMPT = """请基于以下研究方向，提出一个新的量化因子研究假设。

研究方向：{direction}

{history_section}

{feedback_section}

请用JSON格式回答，包含以下字段：
{{
    "hypothesis": "具体的研究假设（50字以内）",
    "observation": "市场现象或规律（为什么你认为这个假设可能成立）",
    "knowledge": "相关的金融理论或市场机制"
}}

注意：
1. 假设必须涉及量价关系、资金流向或市场情绪
2. 假设必须可以转化为具体的因子表达式
3. 避免与历史假设重复"""


# ============================================================
# 因子表达式生成提示词
# ============================================================

FACTOR_GENERATION_SYSTEM = """你是一个量化因子设计专家，擅长将研究假设转化为可执行的因子表达式。

可用的变量（DataFrame格式，行=日期，列=股票代码）：
- open: 开盘价
- high: 最高价
- low: 最低价
- close: 收盘价
- volume: 成交量
- amount: 成交额
- turn: 换手率
- pctChg: 涨跌幅

{operator_docs}

设计规则：
1. **嵌套深度不超过3层**：TS_CORR(TS_MEAN(close, 5), volume, 20) 是2层，可以接受
2. **变量数量不超过5个**
3. **必须涉及量价关系**：因子必须使用close/volume/amount/turn中的至少一个
4. **避免过拟合**：不要使用过于特殊的参数（如TS_MEAN(close, 123)）
5. **常用参数**：5, 10, 20, 60（日），避免随意选择"""


FACTOR_GENERATION_PROMPT = """根据以下假设，设计{n_factors}个量价因子表达式。

研究假设：{hypothesis}

{existing_section}

【重要】必须使用上面列出的DSL算子，禁止使用pandas语法！

正确示例：
- TS_CORR(close, volume, 20)          ✅ 用TS_CORR
- RANK(TS_MEAN(volume, 5))            ✅ 用RANK和TS_MEAN
- DELTA(close, 5) / DELAY(close, 5)   ✅ 用DELTA和DELAY
- EMA(close, 12) - EMA(close, 26)     ✅ 用EMA
- TS_STD(close, 10) / TS_MEAN(close, 10) ✅ 组合使用

错误示例（禁止）：
- close.rolling(20).mean()            ❌ 用了pandas
- volume.diff()                       ❌ 用了pandas
- close.pct_change()                  ❌ 用了pandas

请用JSON数组格式回答，每个因子包含：
[
    {{
        "name": "因子名称（简洁）",
        "expression": "因子表达式（只用DSL算子）",
        "description": "因子含义（30字以内）",
        "direction": "positive/negative（因子值越大，预期收益越高/低）"
    }}
]

注意：
1. 表达式只使用上面列出的DSL算子（TS_MEAN, TS_STD, RANK, DELTA等）
2. 变量只使用: open, high, low, close, volume, amount, turn, pctChg
3. 嵌套深度不超过3层
4. 因子要有明确的经济学含义"""


# ============================================================
# 反馈生成提示词
# ============================================================

FEEDBACK_SYSTEM = """你是一个量化研究分析师，负责评估因子挖掘结果并提供下一步建议。

评估标准：
1. IC绝对值 > 0.02（基本可用）
2. ICIR > 0.5（稳定性好）
3. 分组收益单调（因子有区分度）
4. 换手率 < 30%（交易成本可控）

分析重点：
- 为什么这个因子有效/无效？
- 市场环境是否影响因子表现？
- 如何改进因子？"""


FEEDBACK_PROMPT = """请分析以下因子挖掘结果，并给出下一步建议。

原始假设：{hypothesis}

评估指标摘要：
{metrics_summary}

表现较好的因子：
{best_factors}

失败的因子：
{failed_factors}

请用JSON格式回答：
{{
    "observation": "对本轮结果的观察（100字以内）",
    "evaluation": "对原始假设的评估（是否被验证）",
    "new_direction": "下一步研究方向建议",
    "decision": "continue/stop（是否继续挖掘）"
}}"""


# ============================================================
# 因子演化提示词 (LLM Evolution)
# ============================================================

EVOLUTION_SYSTEM = """你是一个量化因子设计专家，擅长通过对表现优秀的“精英因子”进行逻辑变异和交叉，从而演化出更强大的新因子。

可用的变量（DataFrame格式，行=日期，列=股票代码）：
- open: 开盘价
- high: 最高价
- low: 最低价
- close: 收盘价
- volume: 成交量
- amount: 成交额
- turn: 换手率
- pctChg: 涨跌幅

{operator_docs}

演化规则：
1. **理解语义**：请分析提供的“精英因子”在表达什么经济学含义（例如是动量、反转还是量价背离）。
2. **逻辑变异**：基于该含义进行合理的变体（例如将收盘价改为均价，或改变时间窗口）。
3. **逻辑交叉**：如果提供了多个因子，可以尝试将其背后的逻辑合并（例如用均线算子包裹动量算子）。
4. **必须使用DSL**：新生成的因子必须严格使用上述列出的算子，禁止使用pandas语法。
5. **深度限制**：嵌套深度不超过3层。"""


EVOLUTION_PROMPT = """以下是在上一轮挖掘中表现优秀的“精英因子”：

{elite_section}

请基于上述因子的内在逻辑，演化（变异或交叉）生成 {n_children} 个新的衍生因子。
【重要】新因子必须与原来的精英因子有所不同，不要直接原样复制！

请用JSON数组格式回答，每个新因子包含：
[
    {{
        "name": "新衍生因子名称（简洁）",
        "expression": "因子表达式（只用DSL算子）",
        "description": "这是从哪个精英因子演化来的，以及演化的思路（30字以内）",
        "direction": "positive/negative"
    }}
]"""

# ============================================================
# 代码调试提示词
# ============================================================

DEBUG_SYSTEM = """你是一个Python调试专家，擅长修复量化因子表达式的错误。

常见错误类型：
1. 语法错误：括号不匹配、缺少逗号
2. 变量错误：使用了不存在的变量名
3. 算子错误：参数类型或数量不匹配
4. 嵌套过深：超过3层嵌套

修复原则：
1. 保持因子的经济学含义不变
2. 优先使用更简洁的表达
3. 确保嵌套深度不超过3层"""


DEBUG_PROMPT = """请修复以下因子表达式的错误。

原始表达式：
```
{expression}
```

错误信息：
{error_message}

{context}

{history_section}

请提供修复后的表达式，格式如下：
```python
修复后的表达式
```

并简要说明修复原因。"""


# ============================================================
# 提示词构建函数
# ============================================================

def build_hypothesis_prompt(
    direction: str,
    history: Optional[List[Dict]] = None,
    feedback: str = ""
) -> str:
    """构建假设生成提示词"""
    
    # 历史部分
    history_section = ""
    if history:
        history_section = "已尝试的假设（请避免重复）：\n"
        for i, h in enumerate(history[-5:], 1):  # 只显示最近5个
            history_section += f"{i}. {h.get('hypothesis', '')}\n"
    
    # 反馈部分
    feedback_section = ""
    if feedback:
        feedback_section = f"上一轮反馈：\n{feedback}\n"
    
    return HYPOTHESIS_PROMPT.format(
        direction=direction,
        history_section=history_section,
        feedback_section=feedback_section
    )


def build_factor_generation_prompt(
    hypothesis: str,
    existing_expressions: Optional[List[str]] = None,
    n_factors: int = 3
) -> str:
    """构建因子表达式生成提示词"""
    
    # 已有因子部分
    existing_section = ""
    if existing_expressions:
        existing_section = "已有因子（请避免重复）：\n"
        for i, expr in enumerate(existing_expressions[-10:], 1):  # 只显示最近10个
            existing_section += f"{i}. {expr}\n"
    
    # 算子文档
    operator_docs = get_operator_docs()
    
    # 先构建system（包含算子文档）
    system = FACTOR_GENERATION_SYSTEM.format(operator_docs=operator_docs)
    
    # 再构建user prompt
    prompt = FACTOR_GENERATION_PROMPT.format(
        hypothesis=hypothesis,
        n_factors=n_factors,
        existing_section=existing_section
    )
    
    return prompt


def build_feedback_prompt(
    hypothesis: str,
    metrics_summary: str,
    best_factors: List[Dict],
    failed_factors: List[Dict]
) -> str:
    """构建反馈生成提示词"""
    
    # 表现好的因子
    best_str = ""
    if best_factors:
        for i, f in enumerate(best_factors[:3], 1):
            best_str += f"{i}. {f.get('name', '')}: {f.get('expression', '')}\n"
            best_str += f"   IC={f.get('ic', 0):.4f}, ICIR={f.get('icir', 0):.4f}\n"
    else:
        best_str = "无\n"
    
    # 失败的因子
    failed_str = ""
    if failed_factors:
        for i, f in enumerate(failed_factors[:3], 1):
            failed_str += f"{i}. {f.get('expression', '')}\n"
            failed_str += f"   失败原因: {f.get('error', '')}\n"
    else:
        failed_str = "无\n"
    
    return FEEDBACK_PROMPT.format(
        hypothesis=hypothesis,
        metrics_summary=metrics_summary,
        best_factors=best_str,
        failed_factors=failed_str
    )


def build_debug_prompt(
    expression: str,
    error_message: str,
    context: str = "",
    history: Optional[List[Dict[str, str]]] = None
) -> str:
    """构建代码调试提示词"""
    
    context_section = ""
    if context:
        context_section = f"上下文信息：\n{context}\n"
        
    history_section = ""
    if history:
        history_section = "【注意】你之前已经尝试过以下修复，但都失败了。请仔细分析原因，务必提出一个与以下历史记录中截然不同的新表达式：\n"
        for i, h in enumerate(history, 1):
            history_section += f"{i}. 尝试的表达式: `{h['expression']}`\n   导致的错误: {h['error']}\n"
    
    return DEBUG_PROMPT.format(
        expression=expression,
        error_message=error_message,
        context=context_section,
        history_section=history_section
    )


def build_evolution_prompt(
    elite_expressions: List[str],
    n_children: int = 5
) -> str:
    """构建因子演化提示词"""
    
    elite_section = ""
    for i, expr in enumerate(elite_expressions, 1):
        elite_section += f"{i}. {expr}\n"
        
    return EVOLUTION_PROMPT.format(
        elite_section=elite_section,
        n_children=n_children
    )

def get_system_prompt(prompt_type: str, **kwargs) -> str:
    """获取系统提示词"""
    prompts = {
        "hypothesis": HYPOTHESIS_SYSTEM,
        "factor_generation": FACTOR_GENERATION_SYSTEM.format(
            operator_docs=get_operator_docs()
        ),
        "feedback": FEEDBACK_SYSTEM,
        "debug": DEBUG_SYSTEM,
        "evolution": EVOLUTION_SYSTEM.format(
            operator_docs=get_operator_docs()
        ),
    }
    return prompts.get(prompt_type, "")


if __name__ == "__main__":
    print("=" * 60)
    print("提示词模板测试")
    print("=" * 60)
    
    # 测试假设生成提示词
    print("\n--- 假设生成提示词 ---")
    prompt = build_hypothesis_prompt("量价关系")
    print(prompt[:500] + "...")
    
    # 测试因子生成提示词
    print("\n--- 因子生成提示词 ---")
    prompt = build_factor_generation_prompt("成交量放大但价格不涨可能预示下跌")
    print(prompt[:500] + "...")
