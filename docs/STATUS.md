# 状态

阶段：F1 Core 契约 0.1.0-alpha.7 已锁定（事件投递/公开资料/注销权利端点生产者均已验收，注销生产者 `MCP-F1-CORE-010` 已关闭于 Core `cf95e3e`）；Core TypeScript SDK 已覆盖 17 个 producer 已验证操作，Community TypeScript SDK 已覆盖 10 个 producer 已验证操作

版本：Core `0.1.0-alpha.7`（W02-b 注销权利端点，生产者已关闭）；Skin `0.1.0-alpha.1`（ADR-0012 匿名窗口）；Community `0.1.0-alpha.3`（2026-10-12 F2，ADR-0014 + 门户 GAP-1：10 个已验收操作 + 匿名内联预览契约锁待生产者；producer `70e55a1` + 固定镜像已验收，Community SDK 已交付）

Community 首个预发布契约新增 completeUploadSession/listAuthorResources/downloadResourceVersion，锁定实际字节封存、1 MiB 上传上限、上传签名响应头、确定分页、幂等/归属/错误和失败保持待审语义。公共 scope 保持 resource:read/resource:write/upload:write；未创建 F4 社交/管理员表面，不决定 Q-009/Q-002。Core/Skin 与 Core SDK 支持清单保持原版本。

F0 状态：已完成（本地契约骨架；尚未发布远程）

开发路线：已在 `docs/development-plan.md` 固化契约决策、预发布、生产者、SDK、消费者和稳定发布顺序。

已完成：仓库职责、兼容规则、API 目录、通用 Schema、Core/Community/Skin OpenAPI 骨架、两个跨服务事件骨架，以及首个 TypeScript SDK 切片。

尚未实现：其余 Core 业务接口（W02 公开资料等）、Skin 表面的 SDK 覆盖、社交与审核完整接口、正式域名、发布流水线。

当前进展：Core `0.1.0-alpha.5` 按 Foundation ADR-0011（消费者拉取/HTTP，`MCP-F1-FOUNDATION-011`，`MCP-F1-CONTRACTS-002`）锁定服务事件投递面：`GET /v1/events`（`listDeliveredEvents`，serviceOAuth 专用 `events:consume`，游标分页返回该消费者最旧未确认事件与 `next_cursor`，at-least-once，消费者按 `event_id` 幂等去重）与 `POST /v1/events/acknowledgments`（`acknowledgeEvents`，游标显式确认幂等，未知/畸形游标 400），新增 `EventPage`/`EventAcknowledgment` Schema（事件项复用锁定信封）与内联确认请求体；validate_contracts.py 机器锁定服务专用安全（userOAuth/PAT 不得声明或授予 `events:consume`）、GET-only、limit 1..200、字段集封闭与既有 400/401/403 语义，不新增公共错误码；alpha.4 全表面字节兼容。SDK 类型基线重生成至 alpha.5；`MCP-F1-CONTRACTS-004` 已把 `listDeliveredEvents`/`acknowledgeEvents` 以 `MCP-F1-CORE-008`（Core `87ddd66`）的 producer 证据暴露进 SDK，支持操作扩至 14 个。

历史基线：Core `0.1.0-alpha.4` 锁定只读积分余额表面（`GET /v1/credits/balance`，`credits:read`，OIDC 或 PAT；非负整数余额，无账户的已存在 ACTIVE 用户读取为零且不建账户，严格只读无副作用）。`MCP-F1-CORE-005` 的 Core `5508d60` 生产者已通过验收：12 个锁定文件无漂移，契约 11 项、HTTP E2E 57 项、隔离 PostgreSQL 集成 31 项通过；锁提交 `9a85b98`。`POST /v1/credits/consume` 仍仅 `daily_entitlement` 来源。

`MCP-F1-CONTRACTS-001` 已交付首个经 producer 验证的 SDK：`sdk/typescript` 包 `@mc-plan/core-sdk@0.1.0-alpha.4`（private，仅本地 pack 消费，不发布 npm、不设稳定版本）。类型由 openapi-typescript 从仓库内锁定的 `openapi/core.yaml`（锁提交 `9a85b98`）确定性生成并内嵌 9 个来源文件 sha256 支持清单；仅暴露 12 个有 producer 证据的操作（getPublicUser 与未来积分公共消费/退款/管理不暴露）；注入式 baseURL/fetch/token 提供器、ProblemDetails 类型化、abort/超时、有界幂等重试不换键、200 重放/201 成功。验收：format/lint/严格 typecheck、generate:check 零漂移、25 项单元测试、build、pack 干净工程消费，以及对固定镜像 `mc-plan-core:mcp-f1-core-005-5508d60` + 隔离 PostgreSQL 的真实 HTTP smoke 全通过。

`MCP-F1-CONTRACTS-003` 已按 Foundation ADR-0012（所有者 W10 方案 A，`MCP-F1-FOUNDATION-012`）锁定 Skin `0.1.0-alpha.1`：在既有四操作之上新增四个匿名操作（会话详情含消息历史、级联候选与字节的会话删除、64x64 候选 PNG 预览字节、成品 PNG 下载字节），顶层 `security: []`（Standalone 匿名窗口：不可猜测 128-bit UUID 寻址、30d 会话/24h 候选保留期），`userOAuth` 保留为 Official 模式文档性方案（redocly no-unused-components 警告为预期）。Skin 生产者实现属后续 Skin 线切片。

`MCP-F1-CONTRACTS-004` 已按 `MCP-F1-CORE-008` 的 producer 证据把消费者拉取事件投递两操作暴露进 `@mc-plan/core-sdk@0.1.0-alpha.5`：`listDeliveredEvents`（limit 1..200 客户端先验、EventPage/EventEnvelope 类型化、GET 幂等可重试）与 `acknowledgeEvents`（游标确认 200 幂等、SDK 不生成游标、按契约幂等可重试），均走服务凭证与既有 transport 规则；`SUPPORTED_OPERATIONS` 12→14、`SUPPORTED_PRODUCER_COMMIT` 锚定 Core `87ddd66`、契约 14 文件零漂移。验收（实际组合：Contracts `5ba7172` 锁 → SDK 14 操作 → 固定镜像 `mc-plan-core:mcp-f1-core-008-87ddd66` + 隔离 PostgreSQL + 本地 JWKS）：format/lint/严格 typecheck、generate:check 零漂移、32 项单元（+7 事件面）、build、pack:check 干净工程严格 tsc 消费两新方法（修复 npm_execpath .mjs 调用形态与 tarball 名随版本派生两处滞后）、真实 HTTP smoke 全通过——flat 事件 PUBLISHED-不可见、两个 [SYNTHETIC-DB-SEED] 锁定合法信封按发布序拉取、文件持久注册表去重（ack 前崩溃→重投→副作用恰一次）、追平空页、重复确认幂等、A/B 主体隔离与跨消费者游标 400、畸形游标 400、缺 `events:consume`/用户令牌 403、错 issuer 401；validate_contracts.py 与 redocly 基线通过。SDK 仍为 private、仅本地 pack，不发布 npm。

`MCP-F1-CORE-010` 契约侧已按所有者 2026-10-08 W02-b 决策（注销联动=仅本地停用，Keycloak 不动）锁定 Core `0.1.0-alpha.7`：新增 `POST /v1/me/deactivation`（`deactivateCurrentUser`，prerelease，仅 userOAuth+`profile:write`，成功 204 无响应体，注销后重复调用与其余全部认证面按既有锁定语义 403 `ACCOUNT_UNAVAILABLE`、公开面自动 404；注销=本地置既有枚举值 CLOSED+同事务 `ACCOUNT_DEACTIVATED` 审计，零迁移、零新 scope、零新错误码），validate_contracts.py 新增 alpha.7 机器门槛（32 operationIds），SDK 类型基线随 alpha.7 重生成。`MCP-F1-CORE-010` 已关闭：Core 生产者最终树 `cf95e3e`（零迁移、CLOSED+同事务 `ACCOUNT_DEACTIVATED` 审计、注销后全认证面 403 `ACCOUNT_UNAVAILABLE`、公开面 404）与运行镜像 `mc-plan-core:mcp-f1-core-010-cf95e3e` 通过全量门禁与隔离 PostgreSQL/Keycloak 集成；其记录明确把真实 Keycloak/PKCE 完整行为 smoke 留给 SDK 切片。`MCP-F1-CONTRACTS-006` 据此把 `deactivateCurrentUser` 以该 producer 证据暴露进 SDK（支持操作 16→17、producer 锚更新为 `cf95e3e`，公共契约零变化），并在本仓自有隔离 Keycloak 26.8.0 容器 + 仓内 realm 夹具上以真实 PKCE 令牌完成注销前后全链路验收与既有 16 操作回归。

下一门槛：Skin/Community 真实消费者集成按契约 → SDK → 消费者顺序另开后续工作流（事件面与注销面契约、生产者与 SDK 均已就绪）；credits 来源消费与免费额度耗尽后的积分回退需先补契约并等 Q-013 价格决策；W02-b 其余权利项（D5 本轮冻结=仅注销）与冷静期/再激活等扩展须所有者后续决策；稳定契约/SDK 需至少一个真实消费者通过集成验收；不得把 SDK/producer 验收写成消费者已支持。

2026-10-12 producer 进展：Community `779803e` 已实现 alpha.2 的 10 操作并通过本地 13 单元/2 契约/30 集成，含真实 Core API 消费与真实 Keycloak PKCE；保持运行审核 disabled，完整 F2/审核/备份/F4 门槛未通过。组合已在 compatibility 分栏记录，不以测试审核冒充生产证据。Core/Skin 接口和 Core SDK 支持清单不变。

`MCP-F2-CONTRACTS-002` 已交付首个 Community TypeScript SDK：`sdk/community` 包 `@mc-plan/community-sdk@0.1.0-alpha.2`（private，仅本地 pack 消费，不发布 npm、不设稳定版本）。类型由 openapi-typescript 从仓内锁定的 `openapi/community.yaml`（锁提交 `68b3d42`）确定性生成并内嵌 7 个生成输入文件 sha256 支持清单；暴露全部 10 个 producer 已验证操作（producer 锚定 community `70e55a1`，无排除项）；注入式 baseURL/fetch/用户令牌提供器（双 audience 令牌，SDK 不做 OIDC 流程，公开读取绝不携带凭据头）、ProblemDetails 类型化（11 个 Community 锁定错误码）、abort/超时、有界幂等重试不换键（10 操作全部契约幂等：4 个 GET + 6 个必填 Idempotency-Key 命令）、1 MiB 上限与 limit 1..100 客户端先验、游标只透传。验收：format/lint/严格 typecheck、generate:check 零漂移（契约文件零变化）、38 项单元测试、build、pack:check 干净工程消费（tarball 名随包版本派生），以及对固定镜像 `mc-plan-community:mcp-f2-community-001-779803e` + 独立 Core 镜像 `mcp-f1-core-012-closeout`（真实 `/v1/me` 身份解析）+ 两个隔离 PostgreSQL 17 + 本地 JWKS 测试发行方（诚实标注，非 Keycloak）+ producer 同款 S3rver S3 协议服务的真实 HTTP smoke 两轮 exit 0：完整签名 PUT→封存→版本→发布链、[SYNTHETIC-DB-SEED] 显式标注的审核决定镜像使已发布读取/列表/下载正路径可观测（运行审核按 Q-009 disabled，字节全部经真实校验链）、分页确定性（created_at DESC, resource_id DESC）、下载字节 sha256/Content-Type/attachment/nosniff/no-store 断言、同键重放同体与同键异请求 409、401/403/404/409 全负例面、下架终态后公开面即时消失。SDK 通过不等于任何消费者已集成（真实消费者验收另立项）。

`MCP-F2-CONTRACTS-003` 已按所有者 2026-10-12"两者按序都做"裁决与官网门户 prep 包 GAP-1 方案锁定 Community `0.1.0-alpha.3`：在 alpha.2 十操作之上新增匿名内联预览 `GET /v1/resources/{resourceId}/versions/{versionId}/preview`（`previewResourceVersion`，无请求体）：逐请求可见性与 404 语义与 download 完全一致，流式返回同一封存校验 PNG 字节，响应头 Content-Disposition inline + nosniff + sandbox CSP + Cache-Control no-store（保守默认，有界私有缓存须所有者另行确认）；既有操作/scope/Schema 零变化，ResourceFile `role=preview` 保持 schema-only。validate_contracts.py 机器锁定 alpha.3（11 操作集合、preview 匿名/无体/PNG-only/有界错误面 + docs 分类门槛）。Community SDK 类型基线随 alpha.3 重生成（包版本 `0.1.0-alpha.3`、契约锁提交与文件哈希更新、SUPPORTED_OPERATIONS 保持 10——`previewResourceVersion` 无 producer 证据不暴露）。生产者实现属后续门户工作流 `MCP-F2-COMMUNITY-002`。

2026-10-13 `MCP-F2-COMMUNITY-002`：ADR-0016 人工审核面契约 alpha.4 已锁定（新增 reviewResourceVersion、moderation:review、闭合决定/原因、幂等与失败保持待审），producer 与 SDK 方法待真实验收。alpha.3 预览也纳入该 producer 切片；历史十操作证据不自动扩展。

MCP-F2-COMMUNITY-002 producer/SDK 实测：Community alpha.4 已由 c1cdab0 实现全部十二操作，realm 指定审核 scope + 单决定端点 + 匿名 inline preview。Community SDK 已开放十二方法（40单元/pack/真实HTTP），Core SDK37测试及真实Keycloak/HTTP回归通过；运行镜像与终态记录以完成工作流为准。正式消费者和完整F2/F4仍未完成。

2026-10-13 MCP-F2-CORE-001：Core当前alpha.8，委托目录/PAT隔离与条件audience已由fb1bc07实现306项producer验收；CoreSDKalpha.8仍17操作，37项/pack/真实HTTP+Keycloak新镜像回归；Ops415a108真实登记客户端对独立Communityalpha.4完整资源链验证通过。Community/Skin公共契约不变，CommunitySDK40项及真实HTTP回归过；源码Core来源锁升级随后独立切片处理。

MCP-F2-COMMUNITY-003：Community源码来源锁alpha.8与最终两镜像消费组合完成，SDKproducer锚d482331并对新固定Core/Community镜像真实HTTP通过；12操作/alpha.4表面不变。
