# 状态

阶段：F1 Core 契约 0.1.0-alpha.5 已锁定（服务事件投递面）；首个 TypeScript SDK 切片已交付

版本：Core `0.1.0-alpha.5`；Skin `0.1.0-alpha.1`（ADR-0012 匿名窗口）；Community 仍为 `0.1.0-draft`

F0 状态：已完成（本地契约骨架；尚未发布远程）

开发路线：已在 `docs/development-plan.md` 固化契约决策、预发布、生产者、SDK、消费者和稳定发布顺序。

已完成：仓库职责、兼容规则、API 目录、通用 Schema、Core/Community/Skin OpenAPI 骨架、两个跨服务事件骨架，以及首个 TypeScript SDK 切片。

尚未实现：其余 Core 业务接口、事件投递面的生产者（预计 `MCP-F1-CORE-008`）、Skin/Community 表面的 SDK 覆盖、社交与审核完整接口、正式域名、发布流水线。

当前进展：Core `0.1.0-alpha.5` 按 Foundation ADR-0011（消费者拉取/HTTP，`MCP-F1-FOUNDATION-011`，`MCP-F1-CONTRACTS-002`）锁定服务事件投递面：`GET /v1/events`（`listDeliveredEvents`，serviceOAuth 专用 `events:consume`，游标分页返回该消费者最旧未确认事件与 `next_cursor`，at-least-once，消费者按 `event_id` 幂等去重）与 `POST /v1/events/acknowledgments`（`acknowledgeEvents`，游标显式确认幂等，未知/畸形游标 400），新增 `EventPage`/`EventAcknowledgment` Schema（事件项复用锁定信封）与内联确认请求体；validate_contracts.py 机器锁定服务专用安全（userOAuth/PAT 不得声明或授予 `events:consume`）、GET-only、limit 1..200、字段集封闭与既有 400/401/403 语义，不新增公共错误码；alpha.4 全表面字节兼容。SDK 类型基线重生成至 alpha.5，支持操作保持 12 个 producer 已验证操作不变。

历史基线：Core `0.1.0-alpha.4` 锁定只读积分余额表面（`GET /v1/credits/balance`，`credits:read`，OIDC 或 PAT；非负整数余额，无账户的已存在 ACTIVE 用户读取为零且不建账户，严格只读无副作用）。`MCP-F1-CORE-005` 的 Core `5508d60` 生产者已通过验收：12 个锁定文件无漂移，契约 11 项、HTTP E2E 57 项、隔离 PostgreSQL 集成 31 项通过；锁提交 `9a85b98`。`POST /v1/credits/consume` 仍仅 `daily_entitlement` 来源。

`MCP-F1-CONTRACTS-001` 已交付首个经 producer 验证的 SDK：`sdk/typescript` 包 `@mc-plan/core-sdk@0.1.0-alpha.4`（private，仅本地 pack 消费，不发布 npm、不设稳定版本）。类型由 openapi-typescript 从仓库内锁定的 `openapi/core.yaml`（锁提交 `9a85b98`）确定性生成并内嵌 9 个来源文件 sha256 支持清单；仅暴露 12 个有 producer 证据的操作（getPublicUser 与未来积分公共消费/退款/管理不暴露）；注入式 baseURL/fetch/token 提供器、ProblemDetails 类型化、abort/超时、有界幂等重试不换键、200 重放/201 成功。验收：format/lint/严格 typecheck、generate:check 零漂移、25 项单元测试、build、pack 干净工程消费，以及对固定镜像 `mc-plan-core:mcp-f1-core-005-5508d60` + 隔离 PostgreSQL 的真实 HTTP smoke 全通过。

`MCP-F1-CONTRACTS-003` 已按 Foundation ADR-0012（所有者 W10 方案 A，`MCP-F1-FOUNDATION-012`）锁定 Skin `0.1.0-alpha.1`：在既有四操作之上新增四个匿名操作（会话详情含消息历史、级联候选与字节的会话删除、64x64 候选 PNG 预览字节、成品 PNG 下载字节），顶层 `security: []`（Standalone 匿名窗口：不可猜测 128-bit UUID 寻址、30d 会话/24h 候选保留期），`userOAuth` 保留为 Official 模式文档性方案（redocly no-unused-components 警告为预期）。Skin 生产者实现属后续 Skin 线切片。

下一门槛：事件投递面生产者实现（预计 `MCP-F1-CORE-008`）先于任何消费者集成；Skin/Community 消费者集成按契约 → SDK → 消费者顺序另开后续工作流；credits 来源消费与免费额度耗尽后的积分回退需先补契约并等 Q-013 价格决策；稳定契约/SDK 需至少一个真实消费者通过集成验收；不得把 SDK/producer 验收写成消费者已支持。
