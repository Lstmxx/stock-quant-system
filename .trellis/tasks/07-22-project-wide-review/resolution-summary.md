# 审查问题修复结果

## P1

- P1-01：Engine `/internal/*` 增加服务 Bearer Token；移除通配 CORS；补认证测试和环境文档。
- P1-02：移除固定最大回撤、ICIR 推导夏普和固定胜率；未计算指标返回 `null`。
- P1-03：旧 Analysis API 从主路由下线；API 启动会把遗留 `PENDING/RUNNING` 分析任务标为失败。新版分析必须基于统一 Redis worker 另行实现。
- P1-04：旧分析实现不再公开；内部实现遇到行情超时或摘要缺失会失败，不再生成 `COMPLETED` 占位报告。
- P1-05：按用户决定删除 Dashboard 页面、测试、导航和路由；根路径及未知路径跳转 `/data`。

## P2

- P2-01：稳定 LLM 选股 Hook 的通知依赖；Web 测试恢复通过。
- P2-02：清理 Engine lint 问题；Ruff 0 错误。
- P2-03：策略持久化错误不再吞掉。
- P2-04：Analysis SSE 增加 abort、unsubscribe、listener、timer 和 Redis 连接清理（模块当前下线，保留正确实现供未来迁移参考）。
- P2-05：Engine 启动时读取数据库中的全局 cron；失败才显式回退默认值。
- P2-06：移除未配置的 Tailwind/Nuxt UI 指令，生产 CSS 无未知 at-rule。
- P2-07：全部静态 antd feedback API 改为 `App.useApp()`，迁移 deprecated props；antd lint 0 问题。
- P2-08：Watchlist 增加用户+股票唯一索引；Watchlist/Strategy 用户外键改为级联删除，并生成迁移。
- P2-09：README 补 Better Auth 与内部服务配置；生产环境校验 Better Auth secret 长度。

## P3

- 增加 Engine simulation DTO，减少 `any` 传播。
- 将内部服务认证、旧 Dashboard/Analysis 下线、真实指标和数据库约束写入平台加固契约。
- 根目录实验脚本仍保留，继续遵循 ADR-0002 的兼容/实验边界；本任务未删除可能仍在使用的脚本。

## 验证

- API/Database：57 tests passed。
- Web：36 tests passed；production build passed。
- Engine：58 tests passed，1 integration test skipped；Ruff passed。
- Ant Design：lint 0 issues。
