# 状态

阶段：F1 Core 契约 0.1.0-alpha.4 已验收；首个 TypeScript SDK 切片已交付

版本：Core `0.1.0-alpha.4`；其他契约仍为 `0.1.0-draft`

F0 状态：已完成（本地契约骨架；尚未发布远程）

开发路线：已在 `docs/development-plan.md` 固化契约决策、预发布、生产者、SDK、消费者和稳定发布顺序。

已完成：仓库职责、兼容规则、API 目录、通用 Schema、Core/Community/Skin OpenAPI 骨架、两个跨服务事件骨架，以及首个 TypeScript SDK 切片。

尚未实现：其余 Core 业务接口、Skin/Community 表面的 SDK 覆盖、社交与审核完整接口、正式域名、发布流水线。

当前进展：Core `0.1.0-alpha.4` 锁定只读积分余额表面（`GET /v1/credits/balance`，`credits:read`，OIDC 或 PAT；非负整数余额，无账户的已存在 ACTIVE 用户读取为零且不建账户，严格只读无副作用，401/403 沿用既有语义）。`MCP-F1-CORE-005` 的 Core `5508d60` 生产者已通过验收：12 个锁定文件无漂移，契约 11 项、HTTP E2E 57 项、隔离 PostgreSQL 集成 31 项（不可变账本并发/幂等/退款封顶/ADMIN 调整/账本触发器拒绝/投影漂移/整数边界/每日权益回归）通过，最终 runtime 镜像从最终提交源码构建并以非 root 通过迁移与 live/ready 冒烟；锁提交 `9a85b98`。原 alpha.3 表面保持兼容，`POST /v1/credits/consume` 仍仅 `daily_entitlement` 来源。

`MCP-F1-CONTRACTS-001` 已交付首个经 producer 验证的 SDK：`sdk/typescript` 包 `@mc-plan/core-sdk@0.1.0-alpha.4`（private，仅本地 pack 消费，不发布 npm、不设稳定版本）。类型由 openapi-typescript 从仓库内锁定的 `openapi/core.yaml`（锁提交 `9a85b98`）确定性生成并内嵌 9 个来源文件 sha256 支持清单；仅暴露 12 个有 producer 证据的操作（getPublicUser 与未来积分公共消费/退款/管理不暴露）；注入式 baseURL/fetch/token 提供器、ProblemDetails 类型化、abort/超时、有界幂等重试不换键、200 重放/201 成功。验收：format/lint/严格 typecheck、generate:check 零漂移、25 项单元测试、build、pack 干净工程消费，以及对固定镜像 `mc-plan-core:mcp-f1-core-005-5508d60` + 隔离 PostgreSQL 的真实 HTTP smoke（OIDC 读资料/权益（3/日基线）/余额为零且无账户与账本副作用、同键 201→200 重放同 consumption_id、同键异请求 409、错 issuer 401、缺 scope 403 全通过）。

下一门槛：Skin/Community 消费者集成按契约 → SDK → 消费者顺序另开后续工作流；credits 来源消费与免费额度耗尽后的积分回退需先补契约并等 Q-013 价格决策；稳定契约/SDK 需至少一个真实消费者通过集成验收；不得把 SDK/producer 验收写成消费者已支持。
