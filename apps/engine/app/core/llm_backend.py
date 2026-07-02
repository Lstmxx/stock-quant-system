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

# Config
from .config import LLMConfig


class LLMBackend:
    """LLM调用后端"""
    
    def __init__(self):
        self.api_key = LLMConfig.API_KEY or os.environ.get("XIAOMI_API_KEY", "")
        self.base_url = LLMConfig.BASE_URL or os.environ.get("XIAOMI_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1")
        self.model = LLMConfig.MODEL
        self.timeout = LLMConfig.TIMEOUT
        self.user_id = "system"
        
    def set_user_config(self, user_id: str):
        """
        根据用户ID从数据库加载大模型配置
        如果未找到，则保留环境变量默认配置
        """
        self.user_id = user_id
        if not user_id or user_id == "system":
            return
            
        try:
            from sqlalchemy import create_engine, text
            from app.config import settings
            
            engine = create_engine(settings.database_url)
            with engine.connect() as conn:
                query = text('SELECT key, value FROM user_configs WHERE "userId" = :uid')
                result = conn.execute(query, {"uid": user_id}).fetchall()
                
                configs = {row[0]: row[1] for row in result}
                
                if configs.get("LLM_API_KEY"):
                    self.api_key = configs["LLM_API_KEY"]
                if configs.get("LLM_BASE_URL"):
                    self.base_url = configs["LLM_BASE_URL"]
                if configs.get("LLM_MODEL"):
                    self.model = configs["LLM_MODEL"]
                    
                print(f"[LLMBackend] 已成功加载用户 {user_id} 的专属大模型配置 (Model: {self.model})", flush=True)
        except Exception as e:
            print(f"[LLMBackend] 从数据库加载用户配置失败: {e}，将使用环境变量默认配置", flush=True)
            
    def _check_api_key(self):
        if not self.api_key:
            raise ValueError("未配置LLM API KEY (数据库与环境变量均未配置)")
    
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
        self._check_api_key()
        
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
        """
        from .prompts import build_hypothesis_prompt, get_system_prompt
        
        prompt = build_hypothesis_prompt(direction, history, feedback)
        
        messages = [
            {"role": "system", "content": get_system_prompt("hypothesis")},
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
        from .prompts import build_factor_generation_prompt, get_system_prompt
        
        prompt = build_factor_generation_prompt(
            hypothesis, existing_expressions, n_factors
        )
        
        messages = [
            {"role": "system", "content": get_system_prompt("factor_generation")},
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
        
    def evolve_factors(
        self,
        elite_expressions: List[str],
        n_children: int = 5
    ) -> List[Dict]:
        """
        通过LLM演化（变异/交叉）生成新因子
        """
        from .prompts import build_evolution_prompt, get_system_prompt
        
        prompt = build_evolution_prompt(elite_expressions, n_children)
        
        messages = [
            {"role": "system", "content": get_system_prompt("evolution")},
            {"role": "user", "content": prompt}
        ]
        
        for attempt in range(3):
            response = self.chat(messages, temperature=0.7, max_tokens=3000)
            if response and len(response.strip()) > 10:
                factors = self._parse_factor_list(response)
                if factors:
                    return factors
            print(f"  [LLM] 第{attempt+1}次演化返回空，重试...", flush=True)
            
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
        """
        from .prompts import build_feedback_prompt, get_system_prompt
        
        prompt = build_feedback_prompt(
            hypothesis, metrics_summary, best_factors, failed_factors
        )
        
        messages = [
            {"role": "system", "content": get_system_prompt("feedback")},
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
        context: str = "",
        history: Optional[List[Dict[str, str]]] = None
    ) -> Tuple[str, str]:
        """
        调试因子代码
        """
        from .prompts import build_debug_prompt, get_system_prompt
        
        prompt = build_debug_prompt(expression, error_message, context, history)
        
        messages = [
            {"role": "system", "content": get_system_prompt("debug")},
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
