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
import os
import re
import sys
import time
from typing import Dict, List, Optional, Tuple

import requests

# Ensure app/core/ is on path so `from config import LLMConfig` resolves correctly
_CORE_DIR = os.path.dirname(__file__)
if _CORE_DIR not in sys.path:
    sys.path.insert(0, _CORE_DIR)

from config import LLMConfig


class LLMBackend:
    """LLM调用后端"""
    
    def __init__(self):
        self.api_key = LLMConfig.API_KEY or os.environ.get("XIAOMI_API_KEY", "")
        self.base_url = LLMConfig.BASE_URL or os.environ.get("XIAOMI_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1")
        self.model = LLMConfig.MODEL
        self.timeout = LLMConfig.TIMEOUT
        
        if not self.api_key:
            raise ValueError("未配置XIAOMI_API_KEY")
    
    def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 4000,
        json_mode: bool = False
    ) -> str:
        """
        调用LLM
        
        Args:
            messages: 消息列表
            temperature: 温度
            max_tokens: 最大token数
            json_mode: 是否要求JSON输出
            
        Returns:
            LLM回复文本
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        
        for attempt in range(LLMConfig.MAX_RETRIES):
            try:
                resp = requests.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=self.timeout
                )
                resp.raise_for_status()
                
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                
                # mimo-v2.5-pro是推理模型，可能有reasoning_content
                # 只取content部分
                return content.strip()
                
            except requests.exceptions.Timeout:
                print(f"[LLM] 超时，重试 {attempt+1}/{LLMConfig.MAX_RETRIES}")
                time.sleep(2 ** attempt)
            except Exception as e:
                print(f"[LLM] 调用失败: {type(e).__name__}: {e}")
                if attempt == LLMConfig.MAX_RETRIES - 1:
                    raise
                time.sleep(2 ** attempt)
        
        raise RuntimeError("LLM调用失败，已重试最大次数")
    
    def generate_hypothesis(
        self,
        direction: str,
        history: List[Dict] = None,
        feedback: str = ""
    ) -> Dict:
        """
        生成研究假设
        
        Args:
            direction: 研究方向（如"量价关系"、"动量反转"）
            history: 历史假设和结果
            feedback: 上一轮反馈
            
        Returns:
            {"hypothesis": str, "observation": str, "knowledge": str}
        """
        from prompts import build_hypothesis_prompt
        
        prompt = build_hypothesis_prompt(direction, history, feedback)
        
        messages = [
            {"role": "system", "content": "你是一个专业的量化研究员，专注于A股市场的因子挖掘。"},
            {"role": "user", "content": prompt}
        ]
        
        response = self.chat(messages, temperature=0.8, max_tokens=2000)
        
        # 解析JSON
        return self._parse_json_response(response, {
            "hypothesis": "",
            "observation": "",
            "knowledge": ""
        })
    
    def generate_factors(
        self,
        hypothesis: str,
        existing_expressions: List[str] = None,
        n_factors: int = 3
    ) -> List[Dict]:
        """
        根据假设生成因子表达式（带重试）
        """
        from prompts import build_factor_generation_prompt
        
        prompt = build_factor_generation_prompt(
            hypothesis, existing_expressions, n_factors
        )
        
        messages = [
            {"role": "system", "content": "你是一个量化因子设计专家。"},
            {"role": "user", "content": prompt}
        ]
        
        # 重试3次（mimo-v2.5-pro偶尔返回空响应）
        for attempt in range(3):
            response = self.chat(messages, temperature=0.6, max_tokens=3000)
            if response and len(response.strip()) > 10:
                factors = self._parse_factor_list(response)
                if factors:
                    return factors
            print(f"  [LLM] 第{attempt+1}次返回空，重试...", flush=True)
        
        return []
    
    def generate_feedback(
        self,
        hypothesis: str,
        metrics_summary: str,
        best_factors: List[Dict],
        failed_factors: List[Dict]
    ) -> Dict:
        """
        生成反馈和新假设方向
        
        Args:
            hypothesis: 原始假设
            metrics_summary: 评估指标摘要
            best_factors: 表现好的因子
            failed_factors: 失败的因子
            
        Returns:
            {"observation": str, "evaluation": str, "new_direction": str, "decision": str}
        """
        from prompts import build_feedback_prompt
        
        prompt = build_feedback_prompt(
            hypothesis, metrics_summary, best_factors, failed_factors
        )
        
        messages = [
            {"role": "system", "content": "你是一个量化研究分析师。"},
            {"role": "user", "content": prompt}
        ]
        
        response = self.chat(messages, temperature=0.5, max_tokens=2000)
        
        return self._parse_json_response(response, {
            "observation": "",
            "evaluation": "",
            "new_direction": "",
            "decision": "continue"
        })
    
    def debug_factor_code(
        self,
        expression: str,
        error_message: str,
        context: str = ""
    ) -> Tuple[str, str]:
        """
        调试因子代码（参考RD-Agent的CoSTEER）
        
        当因子表达式执行失败时，让LLM分析错误并提供修复方案
        
        Args:
            expression: 原始表达式
            error_message: 错误信息
            context: 额外上下文
            
        Returns:
            (fixed_expression, explanation)
        """
        from prompts import build_debug_prompt
        
        prompt = build_debug_prompt(expression, error_message, context)
        
        messages = [
            {"role": "system", "content": "你是一个Python调试专家，擅长修复量化因子表达式的错误。"},
            {"role": "user", "content": prompt}
        ]
        
        response = self.chat(messages, temperature=0.3, max_tokens=2000)
        
        # 提取修复后的表达式
        fixed_expr = self._extract_expression(response)
        
        if not fixed_expr:
            return expression, "无法解析修复方案"
        
        return fixed_expr, response
    
    def analyze_factor_semantics(
        self,
        expression: str,
        metrics_summary: str
    ) -> Dict:
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
            {"role": "user", "content": prompt}
        ]
        
        response = self.chat(messages, temperature=0.5, max_tokens=1500, json_mode=True)
        
        return self._parse_json_response(response, {
            "meaning": "",
            "intuition": "",
            "market_regime": ""
        })
    
    def _parse_json_response(self, response: str, default: Dict) -> Dict:
        """解析JSON响应"""
        try:
            # 尝试直接解析
            return json.loads(response)
        except json.JSONDecodeError:
            pass
        
        try:
            # 尝试提取JSON块
            json_match = re.search(r'```json\s*(.*?)\s*```', response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
        
        try:
            # 尝试提取花括号内容（支持嵌套）
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass
        
        print(f"[LLM] JSON解析失败，使用默认值")
        return default
    
    def _parse_factor_list(self, response: str) -> List[Dict]:
        """解析因子列表"""
        try:
            # 尝试解析JSON数组
            json_match = re.search(r'\[.*\]', response, re.DOTALL)
            if json_match:
                factors = json.loads(json_match.group())
                # 验证格式
                valid_factors = []
                for f in factors:
                    if isinstance(f, dict) and 'expression' in f:
                        valid_factors.append({
                            'name': f.get('name', ''),
                            'expression': f['expression'],
                            'description': f.get('description', ''),
                            'direction': f.get('direction', 'unknown')
                        })
                return valid_factors
        except json.JSONDecodeError:
            pass
        
        # 降级：逐行提取表达式
        factors = []
        lines = response.split('\n')
        current = {}
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # 查找表达式
            expr_match = re.search(r'[\w.]+\s*=\s*(.+)', line)
            if not expr_match:
                expr_match = re.search(r'`(.+)`', line)
            
            if expr_match:
                expr = expr_match.group(1).strip()
                factors.append({
                    'name': current.get('name', f'因子{len(factors)+1}'),
                    'expression': expr,
                    'description': current.get('description', ''),
                    'direction': 'unknown'
                })
                current = {}
            elif 'name' in line.lower() or '名称' in line:
                current['name'] = line.split(':')[-1].strip()
            elif 'desc' in line.lower() or '描述' in line:
                current['description'] = line.split(':')[-1].strip()
        
        return factors
    
    def _extract_expression(self, response: str) -> Optional[str]:
        """从响应中提取表达式"""
        # 查找代码块
        code_match = re.search(r'```(?:python)?\s*(.*?)\s*```', response, re.DOTALL)
        if code_match:
            expr = code_match.group(1).strip()
            # 验证是否像因子表达式
            if any(op in expr for op in ['TS_', 'RANK', 'EMA', 'DELTA', 'close', 'volume']):
                return expr
        
        # 查找等号赋值
        assign_match = re.search(r'[\w.]+\s*=\s*(.+)', response)
        if assign_match:
            return assign_match.group(1).strip()
        
        # 查找反引号
        backtick_match = re.search(r'`(.+)`', response)
        if backtick_match:
            return backtick_match.group(1).strip()
        
        return None


# 全局实例（延迟初始化）
_llm_instance = None

def get_llm() -> LLMBackend:
    """获取LLM后端实例（延迟初始化）"""
    global _llm_instance
    if _llm_instance is None:
        _llm_instance = LLMBackend()
    return _llm_instance

# 兼容：llm_backend.llm
class _LazyLLM:
    def __getattr__(self, name):
        return getattr(get_llm(), name)

llm = _LazyLLM()


if __name__ == "__main__":
    print("=" * 60)
    print("LLM后端测试")
    print("=" * 60)
    
    try:
        backend = LLMBackend()
        
        # 测试假设生成
        print("\n--- 测试假设生成 ---")
        result = backend.generate_hypothesis("量价关系")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(f"测试失败: {e}")
