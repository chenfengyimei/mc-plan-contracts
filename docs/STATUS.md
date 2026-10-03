# 状态

阶段：F1 Core 授权与令牌预发布契约

版本：Core `0.1.0-alpha.2`；其他契约仍为 `0.1.0-draft`

F0 状态：已完成（本地契约骨架；尚未发布远程）

开发路线：已在 `docs/development-plan.md` 固化契约决策、预发布、生产者、SDK、消费者和稳定发布顺序。

已完成：仓库职责、兼容规则、API 目录、通用 Schema、Core/Community/Skin OpenAPI 骨架和两个跨服务事件骨架。

尚未实现：其余 Core 业务接口、SDK 代码、社交与审核完整接口、正式域名、发布流水线。

当前进展：Core `0.1.0-alpha.2` 在 alpha.1 之上兼容新增 Developer App、scope 词汇（`developer-apps:read/manage`、`pat:read/manage`）与 PAT 生命周期表面，并把 `expires_in_days` 机器锁定为上限/默认 30 天（Q-007 已决）；`MCP-F1-CORE-003` 已完成 Core 生产者契约测试与全部新表面响应的锁定 Schema 验证。

下一门槛：SDK 与消费者必须另开后续工作流，并继续遵守契约 → SDK → 消费者顺序；尚未锁定的 Core F1 能力（每日权益、积分账本）需先补契约。
