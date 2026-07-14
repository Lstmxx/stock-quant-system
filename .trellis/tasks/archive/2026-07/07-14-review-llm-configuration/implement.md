# 大模型配置模块审查执行计划

## 1. Inventory

- [x] 列出 Web、API、数据库、Engine 的相关文件和现有测试。
- [x] 建立字段级映射：provider、modelName、name、baseUrl、apiKey、isDefault、llmModelId。

## 2. UX Review

- [x] 检查列表加载、空状态、新增、编辑、删除、默认切换和错误反馈。
- [x] 检查表单校验、密钥保留语义、Provider 引导、连接测试与重复提交。
- [x] 检查因子任务选择模型时的失效引用与导航恢复路径。

## 3. Logic and Security Review

- [x] 检查 CRUD 的用户隔离、无效 ID、返回语义和敏感字段。
- [x] 检查默认模型唯一性、事务、并发和删除引用行为。
- [x] 检查加密密钥来源、跨语言格式、旧明文兼容和失败处理。
- [x] 检查 Base URL 规范化、Provider 协议、SSRF 边界和 API Key 必填规则。

## 4. Consumer Trace

- [x] 追踪因子挖掘的 llmModelId 队列与 Engine 加载路径。
- [x] 追踪个股分析和策略生成的配置来源。
- [x] 判断 isDefault/provider 是否真正影响所有消费方。

## 5. LLM Client Evaluation

- [x] 对照当前 `requests.post` 行为列出 SDK 必须保持的契约：同步调用、messages、temperature、max_tokens、JSON mode、超时和重试。
- [x] 比较 OpenAI Python SDK 与 LiteLLM Python SDK 的 Provider 覆盖、异常、重试、连接复用、流式输出、依赖和测试方式。
- [x] 设计自有薄 adapter 边界，避免业务层直接依赖第三方响应类型。
- [x] 定义 OpenAI、Anthropic、Ollama 的 provider/model/api_base/api_key 映射表及能力差异。
- [x] 检查 LiteLLM 迁移是否需要同步收敛 API 个股分析与策略生成的直接 `fetch` 调用。
- [x] 给出渐进迁移步骤和回滚方案，不在本审查任务中安装依赖或修改 `chat`。

## 6. Tests and Evidence

- [x] 审查 LLM 模块前后端测试覆盖。
- [x] 运行相关现有 mock 测试和构建检查，避免真实付费调用。
- [x] 为每个 High/Critical finding 复核触发路径和文件行号。

建议验证命令：

```bash
bun test src/modules/task/service.test.ts src/modules/analysis/service.test.ts
bun run build
uv run pytest tests/test_crypto.py tests/test_worker_mining.py -q
```

## 7. Deliverable

- [x] 输出按严重程度排序的 findings。
- [x] 输出用户旅程与配置数据流结论。
- [x] 输出 P0/P1/P2 分阶段修复建议及对应测试。
- [x] 输出 `chat` 传输层的推荐 SDK 与迁移边界。
- [x] 明确本轮未修改业务代码。

## Rollback

本任务仅产生审查文档和任务记录，无业务代码回滚点。若发现范围扩张到实际修复，先结束本审查并由用户确认后创建或启动独立修复任务。
