"""
LLM调用后端
============
封装与mimo-v2.5-pro的交互，包含：
- 假设生成
- 因子表达式生成
- 反馈分析
- 代码调试（参考QuantaAlpha/RD-Agent的debug能力）
"""

import json
import re
from typing import Dict, List, Optional, Tuple

from .litellm_client import LiteLLMClient
from .llm_types import ChatRequest, LLMClient, LlmModelConfig, LlmResponseError


class LLMBackend:
    """High-level factor prompts backed only by the project LLM contract."""

    def __init__(
        self,
        config: LlmModelConfig,
        client: LLMClient | None = None,
    ) -> None:
        self._config = config
        self._client = client or LiteLLMClient()

    def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 4000,
        json_mode: bool = False,
    ) -> str:
        result = self._client.chat(
            self._config,
            ChatRequest(
                messages=tuple(messages),
                temperature=temperature,
                max_tokens=max_tokens,
                json_mode=json_mode,
            ),
        )
        return result.content

    def generate_hypothesis(
        self,
        direction: str,
        history: List[Dict] = None,
        feedback: str = "",
    ) -> Dict:
        """
        生成研究假设
        """
        from .prompts import build_hypothesis_prompt, get_system_prompt

        prompt = build_hypothesis_prompt(direction, history, feedback)

        messages = [
            {"role": "system", "content": get_system_prompt("hypothesis")},
            {"role": "user", "content": prompt},
        ]

        response = self.chat(messages, temperature=0.8, max_tokens=2000)

        # 解析JSON
        return self._parse_json_response(
            response, {"hypothesis": "", "observation": "", "knowledge": ""}
        )

    def generate_factors(
        self,
        hypothesis: str,
        existing_expressions: List[str] = None,
        n_factors: int = 3,
    ) -> List[Dict]:
        """
        根据假设生成因子表达式（带重试）
        """
        from .prompts import build_factor_generation_prompt, get_system_prompt

        prompt = build_factor_generation_prompt(
            hypothesis, existing_expressions, n_factors
        )

        messages = [
            {"role": "system", "content": get_system_prompt("factor_generation")},
            {"role": "user", "content": prompt},
        ]

        response = self.chat(messages, temperature=0.6, max_tokens=3000)
        factors = self._parse_factor_list(response)
        if not factors:
            raise LlmResponseError("模型未返回可用的因子表达式")
        return factors

    def evolve_factors(
        self,
        elite_expressions: List[str],
        n_children: int = 5,
    ) -> List[Dict]:
        """
        通过LLM演化（变异/交叉）生成新因子
        """
        from .prompts import build_evolution_prompt, get_system_prompt

        prompt = build_evolution_prompt(elite_expressions, n_children)

        messages = [
            {"role": "system", "content": get_system_prompt("evolution")},
            {"role": "user", "content": prompt},
        ]

        response = self.chat(messages, temperature=0.7, max_tokens=3000)
        factors = self._parse_factor_list(response)
        if not factors:
            raise LlmResponseError("模型未返回可用的演化因子")
        return factors

    def generate_feedback(
        self,
        hypothesis: str,
        metrics_summary: str,
        best_factors: List[Dict],
        failed_factors: List[Dict],
    ) -> Dict:
        """
        生成反馈和新假设方向
        """
        from .prompts import build_feedback_prompt, get_system_prompt

        prompt = build_feedback_prompt(
            hypothesis, metrics_summary, best_factors, failed_factors
        )

        messages = [
            {"role": "system", "content": get_system_prompt("feedback")},
            {"role": "user", "content": prompt},
        ]

        response = self.chat(messages, temperature=0.5, max_tokens=2000)

        return self._parse_json_response(
            response,
            {
                "observation": "",
                "evaluation": "",
                "new_direction": "",
                "decision": "continue",
            },
        )

    def debug_factor_code(
        self,
        expression: str,
        error_message: str,
        context: str = "",
        history: Optional[List[Dict[str, str]]] = None,
    ) -> Tuple[str, str]:
        """
        调试因子代码
        """
        from .prompts import build_debug_prompt, get_system_prompt

        prompt = build_debug_prompt(expression, error_message, context, history)

        messages = [
            {"role": "system", "content": get_system_prompt("debug")},
            {"role": "user", "content": prompt},
        ]

        response = self.chat(messages, temperature=0.3, max_tokens=2000)

        # 提取修复后的表达式
        fixed_expr = self._extract_expression(response)

        if not fixed_expr:
            return expression, "无法解析修复方案"

        return fixed_expr, response

    def analyze_factor_semantics(self, expression: str, metrics_summary: str) -> Dict:
        """
        分析因子的经济学含义

        Args:
            expression: 因子表达式
            metrics_summary: 评估指标

        Returns:
            {"meaning": str, "intuition": str, "market_regime": str}
        """
        prompt = f"""请分析以下量化因子的经济学含义和直觉：

因子表达式: {expression}
评估指标: {metrics_summary}

请用JSON格式回答：
{{
    "meaning": "因子的经济学含义",
    "intuition": "为什么这个因子可能有效（从市场微观结构/行为金融角度）",
    "market_regime": "在什么市场环境下可能更有效"
}}"""

        messages = [
            {"role": "system", "content": "你是一个量化金融研究员。"},
            {"role": "user", "content": prompt},
        ]

        response = self.chat(messages, temperature=0.5, max_tokens=1500, json_mode=True)

        return self._parse_json_response(
            response, {"meaning": "", "intuition": "", "market_regime": ""}
        )

    def _parse_json_response(self, response: str, default: Dict) -> Dict:
        """解析JSON响应"""
        try:
            # 尝试直接解析
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        try:
            # 尝试提取JSON块
            json_match = re.search(r"```json\s*(.*?)\s*```", response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

        try:
            # 尝试提取花括号内容（支持嵌套）
            json_match = re.search(r"\{.*\}", response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass

        print("[LLM] JSON解析失败，使用默认值")
        return default

    def _parse_factor_list(self, response: str) -> List[Dict]:
        """解析因子列表"""
        try:
            # 尝试解析JSON数组
            json_match = re.search(r"\[.*\]", response, re.DOTALL)
            if json_match:
                factors = json.loads(json_match.group())
                # 验证格式
                valid_factors = []
                for f in factors:
                    if isinstance(f, dict) and "expression" in f:
                        valid_factors.append(
                            {
                                "name": f.get("name", ""),
                                "expression": f["expression"],
                                "description": f.get("description", ""),
                                "direction": f.get("direction", "unknown"),
                            }
                        )
                return valid_factors
        except json.JSONDecodeError:
            pass

        # 降级：逐行提取表达式
        factors = []
        lines = response.split("\n")
        current = {}

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # 查找表达式
            expr_match = re.search(r"[\w.]+\s*=\s*(.+)", line)
            if not expr_match:
                expr_match = re.search(r"`(.+)`", line)

            if expr_match:
                expr = expr_match.group(1).strip()
                factors.append(
                    {
                        "name": current.get("name", f"因子{len(factors) + 1}"),
                        "expression": expr,
                        "description": current.get("description", ""),
                        "direction": "unknown",
                    }
                )
                current = {}
            elif "name" in line.lower() or "名称" in line:
                current["name"] = line.split(":")[-1].strip()
            elif "desc" in line.lower() or "描述" in line:
                current["description"] = line.split(":")[-1].strip()

        return factors

    def _extract_expression(self, response: str) -> Optional[str]:
        """从响应中提取表达式"""
        # 查找代码块
        code_match = re.search(r"```(?:python)?\s*(.*?)\s*```", response, re.DOTALL)
        if code_match:
            expr = code_match.group(1).strip()
            # 验证是否像因子表达式
            if any(
                op in expr for op in ["TS_", "RANK", "EMA", "DELTA", "close", "volume"]
            ):
                return expr

        # 查找等号赋值
        assign_match = re.search(r"[\w.]+\s*=\s*(.+)", response)
        if assign_match:
            return assign_match.group(1).strip()

        # 查找反引号
        backtick_match = re.search(r"`(.+)`", response)
        if backtick_match:
            return backtick_match.group(1).strip()

        return None
