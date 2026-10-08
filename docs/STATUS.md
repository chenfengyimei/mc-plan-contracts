# 状态

阶段：F1 Core 契约 0.1.0-alpha.6 已锁定（事件投递面生产者已验收；公开资料表面生产者实现中 `MCP-F1-CORE-009`）；TypeScript SDK 已覆盖 14 个 producer 已验证操作

版本：Core `0.1.0-alpha.6`（W02 第一阶段公开资料 + 资料名编辑，`MCP-F1-CORE-009` 契约侧锁提交 `6b80c4c`，生产者实现中）；Skin `0.1.0-alpha.1`（ADR-0012 匿名窗口）；Community 仍为 `0.1.0-draft`

F0 状态：已完成（本地契约骨架；尚未发布远程）

开发路线：已在 `docs/development-plan.md` 固化契约决策、预发布、生产者、SDK、消费者和稳定发布顺序。

已完成：仓库职责、兼容规则、API 目录、通用 Schema、Core/Community/Skin OpenAPI 骨架、两个跨服务事件骨架，以及首个 TypeScript SDK 切片。

尚未实现：其余 Core 业务接口（W02 公开资料等）、Skin/Community 表面的 SDK 覆盖、社交与审核完整接口、正式域名、发布流水线。

当前进展：Core `0.1.0-alpha.5` 按 Foundation ADR-0011（消费者拉取/HTTP，`MCP-F1-FOUNDATION-011`，`MCP-F1-CONTRACTS-002`）锁定服务事件投递面：`GET /v1/events`（`listDeliveredEvents`，serviceOAuth 专用 `events:consume`，游标分页返回该消费者最旧未确认事件与 `next_cursor`，at-least-once，消费者按 `event_id` 幂等去重）与 `POST /v1/events/acknowledgments`（`acknowledgeEvents`，游标显式确认幂等，未知/畸形游标 400），新增 `EventPage`/`EventAcknowledgment` Schema（事件项复用锁定信封）与内联确认请求体；validate_contracts.py 机器锁定服务专用安全（userOAuth/PAT 不得声明或授予 `events:consume`）、GET-only、limit 1..200、字段集封闭与既有 400/401/403 语义，不新增公共错误码；alpha.4 全表面字节兼容。SDK 类型基线重生成至 alpha.5；`MCP-F1-CONTRACTS-004` 已把 `listDeliveredEvents`/`acknowledgeEvents` 以 `MCP-F1-CORE-008`（Core `87ddd66`）的 producer 证据暴露进 SDK，支持操作扩至 14 个。

历史基线：Core `0.1.0-alpha.4` 锁定只读积分余额表面（`GET /v1/credits/balance`，`credits:read`，OIDC 或 PAT；非负整数余额，无账户的已存在 ACTIVE 用户读取为零且不建账户，严格只读无副作用）。`MCP-F1-CORE-005` 的 Core `5508d60` 生产者已通过验收：12 个锁定文件无漂移，契约 11 项、HTTP E2E 57 项、隔离 PostgreSQL 集成 31 项通过；锁提交 `9a85b98`。`POST /v1/credits/consume` 仍仅 `daily_entitlement` 来源。

`MCP-F1-CONTRACTS-001` 已交付首个经 producer 验证的 SDK：`sdk/typescript` 包 `@mc-plan/core-sdk@0.1.0-alpha.4`（private，仅本地 pack 消费，不发布 npm、不设稳定版本）。类型由 openapi-typescript 从仓库内锁定的 `openapi/core.yaml`（锁提交 `9a85b98`）确定性生成并内嵌 9 个来源文件 sha256 支持清单；仅暴露 12 个有 producer 证据的操作（getPublicUser 与未来积分公共消费/退款/管理不暴露）；注入式 baseURL/fetch/token 提供器、ProblemDetails 类型化、abort/超时、有界幂等重试不换键、200 重放/201 成功。验收：format/lint/严格 typecheck、generate:check 零漂移、25 项单元测试、build、pack 干净工程消费，以及对固定镜像 `mc-plan-core:mcp-f1-core-005-5508d60` + 隔离 PostgreSQL 的真实 HTTP smoke 全通过。

`MCP-F1-CONTRACTS-003` 已按 Foundation ADR-0012（所有者 W10 方案 A，`MCP-F1-FOUNDATION-012`）锁定 Skin `0.1.0-alpha.1`：在既有四操作之上新增四个匿名操作（会话详情含消息历史、级联候选与字节的会话删除、64x64 候选 PNG 预览字节、成品 PNG 下载字节），顶层 `security: []`（Standalone 匿名窗口：不可猜测 128-bit UUID 寻址、30d 会话/24h 候选保留期），`userOAuth` 保留为 Official 模式文档性方案（redocly no-unused-components 警告为预期）。Skin 生产者实现属后续 Skin 线切片。

`MCP-F1-CONTRACTS-004` 已按 `MCP-F1-CORE-008` 的 producer 证据把消费者拉取事件投递两操作暴露进 `@mc-plan/core-sdk@0.1.0-alpha.5`：`listDeliveredEvents`（limit 1..200 客户端先验、EventPage/EventEnvelope 类型化、GET 幂等可重试）与 `acknowledgeEvents`（游标确认 200 幂等、SDK 不生成游标、按契约幂等可重试），均走服务凭证与既有 transport 规则；`SUPPORTED_OPERATIONS` 12→14、`SUPPORTED_PRODUCER_COMMIT` 锚定 Core `87ddd66`、契约 14 文件零漂移。验收（实际组合：Contracts `5ba7172` 锁 → SDK 14 操作 → 固定镜像 `mc-plan-core:mcp-f1-core-008-87ddd66` + 隔离 PostgreSQL + 本地 JWKS）：format/lint/严格 typecheck、generate:check 零漂移、32 项单元（+7 事件面）、build、pack:check 干净工程严格 tsc 消费两新方法（修复 npm_execpath .mjs 调用形态与 tarball 名随版本派生两处滞后）、真实 HTTP smoke 全通过——flat 事件 PUBLISHED-不可见、两个 [SYNTHETIC-DB-SEED] 锁定合法信封按发布序拉取、文件持久注册表去重（ack 前崩溃→重投→副作用恰一次）、追平空页、重复确认幂等、A/B 主体隔离与跨消费者游标 400、畸形游标 400、缺 `events:consume`/用户令牌 403、错 issuer 401；validate_contracts.py 与 redocly 基线通过。SDK 仍为 private、仅本地 pack，不发布 npm。

下一门槛：Skin/Community 真实消费者集成按契约 → SDK → 消费者顺序另开后续工作流（事件面契约、生产者与 SDK 均已就绪）；credits 来源消费与免费额度耗尽后的积分回退需先补契约并等 Q-013 价格决策；W02 公开资料/用户权利（D1-D6 已决、D5=仅注销）按 α.6 先锁后生产者再 SDK；稳定契约/SDK 需至少一个真实消费者通过集成验收；不得把 SDK/producer 验收写成消费者已支持。
