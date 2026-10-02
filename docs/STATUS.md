# 状态

阶段：F1 Core 身份预发布契约

版本：Core `0.1.0-alpha.1`；其他契约仍为 `0.1.0-draft`

F0 状态：已完成（本地契约骨架；尚未发布远程）

开发路线：已在 `docs/development-plan.md` 固化契约决策、预发布、生产者、SDK、消费者和稳定发布顺序。

已完成：仓库职责、兼容规则、API 目录、通用 Schema、Core/Community/Skin OpenAPI 骨架和两个跨服务事件骨架。

尚未实现：服务端、SDK 代码、社交与审核完整接口、正式域名、发布流水线。

当前进展：`GET /v1/me`、`profile:read`、PublicActor 以及认证/业务账号拒绝语义已锁定为首个 Core 预发布切片；生产者实现与真实 Keycloak 集成由 `MCP-F1-CORE-002` 验证。

下一门槛：Core 生产者通过契约测试和真实 Keycloak 集成后更新兼容矩阵；SDK 与消费者另开后续工作流。
