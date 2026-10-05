# 状态

阶段：F1 Core 每日权益预发布契约

版本：Core `0.1.0-alpha.3`；其他契约仍为 `0.1.0-draft`

F0 状态：已完成（本地契约骨架；尚未发布远程）

开发路线：已在 `docs/development-plan.md` 固化契约决策、预发布、生产者、SDK、消费者和稳定发布顺序。

已完成：仓库职责、兼容规则、API 目录、通用 Schema、Core/Community/Skin OpenAPI 骨架和两个跨服务事件骨架。

尚未实现：其余 Core 业务接口、SDK 代码、社交与审核完整接口、正式域名、发布流水线。

当前进展：Core `0.1.0-alpha.3` 已收敛每日权益与服务消费表面（credits:read 的 OIDC/PAT 读取、credits:consume 的服务 OAuth 消费、Idempotency-Key 和稳定耗尽/冲突语义，仅 daily_entitlement 来源）。原 alpha.2 身份、Developer App 与 PAT 表面保持兼容。`MCP-F1-CORE-004` 的 Core `8ba869a` 生产者已通过七项契约测试、52 项 HTTP E2E 和 17 项真实 PostgreSQL 集成验收；锁定文件提交仍为 `fab1f3c`，本次只补文档与已验证组合，不修改契约文件。

下一门槛：SDK 与消费者必须另开后续工作流，并继续遵守契约 → SDK → 消费者顺序；下一阶段积分账本与 credits 来源消费需先补契约；不得把服务端验收写成 SDK 或消费者已支持。
