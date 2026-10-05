# 状态

阶段：F1 Core 积分账本与只读余额预发布契约

版本：Core `0.1.0-alpha.4`；其他契约仍为 `0.1.0-draft`

F0 状态：已完成（本地契约骨架；尚未发布远程）

开发路线：已在 `docs/development-plan.md` 固化契约决策、预发布、生产者、SDK、消费者和稳定发布顺序。

已完成：仓库职责、兼容规则、API 目录、通用 Schema、Core/Community/Skin OpenAPI 骨架和两个跨服务事件骨架。

尚未实现：其余 Core 业务接口、SDK 代码、社交与审核完整接口、正式域名、发布流水线。

当前进展：Core `0.1.0-alpha.4` 锁定只读积分余额表面（`GET /v1/credits/balance`，`credits:read`，OIDC 或 PAT；非负整数余额，无账户的已存在 ACTIVE 用户读取为零且不建账户，严格只读无副作用，401/403 沿用既有语义）。`MCP-F1-CORE-005` 的 Core `5508d60` 生产者已通过验收：12 个锁定文件无漂移，契约 11 项、HTTP E2E 57 项、隔离 PostgreSQL 集成 31 项（不可变账本并发/幂等/退款封顶/ADMIN 调整/账本触发器拒绝/投影漂移/整数边界/每日权益回归）通过，最终 runtime 镜像从最终提交源码构建并以非 root 通过迁移与 live/ready 冒烟；锁提交 `9a85b98`。原 alpha.3 表面保持兼容，`POST /v1/credits/consume` 仍仅 `daily_entitlement` 来源。

下一门槛：`MCP-F1-CORE-005` 关闭后，SDK 与消费者另开后续工作流并继续遵守契约 → SDK → 消费者顺序；credits 来源消费与免费额度耗尽后的积分回退需先补契约并等 Q-013 价格决策；不得把服务端验收写成 SDK 或消费者已支持。
