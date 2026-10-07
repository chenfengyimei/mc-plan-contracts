# 兼容与版本策略

## 分类

兼容变化包括增加可选响应字段、新 endpoint、新事件类型和放宽输入约束。破坏性变化包括删除或重命名字段、增加必填输入、收紧枚举/格式、改变默认语义、复用错误码表达不同含义。

破坏性变化需要新主版本或显式迁移窗口。安全漏洞修复若必须立即收紧行为，也要提供公告、受影响范围和替代路径。

## Core `0.1.0-alpha.2` 兼容分类

本版本是在 `0.1.0-alpha.1` 之上的**预发布兼容新增**：`GET /v1/me` 的字段、响应与 OIDC 语义保持不变，仅新增 personal access token 作为替代认证方式；新增 Developer App 与 PAT 生命周期操作、`developer-apps:read/manage` 与 `pat:read/manage` scope、`VALIDATION_FAILED` / `ROLE_REQUIRED` / `NOT_FOUND` 错误语义。机器校验锁定：PAT 请求的 `expires_in_days` 上限与默认值均为 30 天（Q-007 决策），PAT 元数据 Schema 不得含明文或哈希字段，创建 PAT 的操作只接受 OIDC 用户认证（令牌不得再铸造令牌）。

发布顺序为 Contracts `0.1.0-alpha.2` → Core 生产者与契约测试 → 后续 TypeScript SDK 与消费者工作流。回退时生产者可回到仅实现 `0.1.0-alpha.1` 身份切片的状态；不得保留一个与本契约字段不一致的 Developer App 或 PAT 表面。

`MCP-F1-CORE-003` 已验证 Contracts `bde4dfb`（锁提交 `3f9e13a`+`bde4dfb`）与 Core `ce89a39` 的组合：Core 锁定文件契约验证通过，Producer 对 `GET /v1/me`、Developer App 与 PAT 全部新表面的响应均通过锁定 JSON Schema 验证。该组合不代表 SDK、Community 或 Skin 已成为消费者。

## Core `0.1.0-alpha.3` 兼容分类

本版本收敛在 `0.1.0-alpha.2` 中已声明但从未实现、也尚无任何消费者的 entitlements 与 consume 骨架，分类为**预发布兼容收敛（未实现表面）**：`GET /v1/entitlements` 增加 personal access token 替代认证（与 `/v1/me` 一致）并把 401/403 语义与 AuthenticationRequired/AccessForbidden 对齐；`POST /v1/credits/consume` 明确 400/401/403/404 与两种 409 问题语义（`IDEMPOTENCY_KEY_CONFLICT` 与 `ENTITLEMENT_EXHAUSTED`），并把 `ConsumptionResult.source` 收敛为仅 `daily_entitlement`——credits 来源尚未实现，不得声称已支持。该收窄发生在无任何生产者或消费者实现此端点之前；`0.1.0-alpha.2` 已实现的 `/v1/me`、Developer App 与 PAT 表面全部保持原语义。机器校验锁定：entitlement Schema 字段集与 `Asia/Shanghai` 时区常量、consume 必须要求 Idempotency-Key、source 枚举不得声称未实现的 credits 来源。

发布顺序为 Contracts `0.1.0-alpha.3` → Core 生产者与契约测试 → 后续 TypeScript SDK 与消费者工作流。回退时生产者可回到仅实现 `0.1.0-alpha.2` 授权与令牌切片的状态；不得保留一个与本契约语义不一致的权益或消费表面。

`MCP-F1-CORE-004` 已验证 Contracts 锁提交 `fab1f3c` 与 Core `8ba869a` 的组合：九个锁定文件无漂移，七项生产者契约测试涵盖原 alpha.2 表面回归、EntitlementBalance、直接读取锁定 OpenAPI 的 ConsumptionResult 与两个 409 Problem；52 项 HTTP E2E 和 17 项隔离 PostgreSQL 集成验收通过，包括跨策略并发每天三个、跨日不累计、历史快照、持久化重放及服务 scope 拒绝。兼容分类与发布顺序保持不变；不代表 Keycloak 服务客户端已部署，也不代表 SDK、Community 或 Skin 已集成。

## Core `0.1.0-alpha.4` 兼容分类

本版本是在 `0.1.0-alpha.3` 之上的**预发布兼容新增（只读余额）**：新增 `GET /v1/credits/balance` 与 `CreditBalance` JSON Schema（`credits:read`，OIDC 或 PAT；非负整数余额；未建立积分账户的已存在 ACTIVE 用户读取为零且不建账户；严格只读，不产生积分账户、账本、审计或 outbox 副作用；401/403 沿用既有 AuthenticationRequired/AccessForbidden 与 actor 解析语义，不新增公共错误码）。`0.1.0-alpha.3` 已锁定的全部表面保持原语义，`POST /v1/credits/consume` 的 `ConsumptionResult.source` 枚举仍仅 `daily_entitlement`；机器校验锁定余额只读（路径仅 GET）、CreditBalance 字段集与非负下限、CreditLedgerEntry 四类 kind 与非负边界，以及 consume 来源枚举不扩展。Core 内部不可变积分账本（grant/consume/refund/adjustment 四类可信内部原语、credits 专用幂等命令表、单事务非负不变量、同事务审计与 INTERNAL outbox、应用服务级余额核对）不是公共接口变化，由生产者工作流按内部记录校验输入（`events/credit.changed.v1.json`、`event-envelope` 与 `credit-ledger-entry` Schema）验收；内部原语不经任何公共 HTTP 输入暴露。

发布顺序为 Contracts `0.1.0-alpha.4` → Core 生产者与契约测试 → 后续 TypeScript SDK 与消费者工作流（须等本生产者工作流关闭）。回退时生产者可回到仅实现 `0.1.0-alpha.3` 每日权益切片的状态；不得保留一个与本契约语义不一致的余额表面。

## Core `0.1.0-alpha.5` 兼容分类

本版本是在 `0.1.0-alpha.4` 之上的**预发布兼容新增（服务事件投递）**：按 Foundation ADR-0011（消费者拉取/HTTP，`MCP-F1-FOUNDATION-011`）新增 `GET /v1/events`（operationId `listDeliveredEvents`，serviceOAuth `events:consume` 专用，游标分页返回该服务消费者最旧的未确认事件与 `next_cursor`，at-least-once，消费者按信封 `event_id` 幂等去重）与 `POST /v1/events/acknowledgments`（operationId `acknowledgeEvents`，游标显式确认且幂等，未知/畸形游标 400 `VALIDATION_FAILED`），新增 `EventPage` 与 `EventAcknowledgment` JSON Schema（事件项复用锁定的事件信封，信封本身零修改）以及内联确认请求体（cursor 必填、1..512）。机器校验锁定：两操作 serviceOAuth 专用（userOAuth/PAT 一律不得声明或授予 `events:consume`）、`/v1/events` 仅 GET、limit 1..200、EventPage/EventAcknowledgment 字段集封闭、401/403 沿用既有语义、不新增公共错误码。`0.1.0-alpha.4` 已锁定的全部表面保持字节兼容。

发布顺序为 Contracts `0.1.0-alpha.5` → Core 生产者与契约测试（预计 `MCP-F1-CORE-008`）→ 后续消费者工作流。回退时生产者可回到仅实现 `0.1.0-alpha.4` 的状态；不得保留一个与本契约语义不一致的事件投递表面。SDK 类型基线随 alpha.5 重生成，但 `listDeliveredEvents`/`acknowledgeEvents` 因尚无 producer 证据不在 SDK 支持操作清单中暴露。

`MCP-F1-CORE-005` 已验证 Contracts 锁提交 `9a85b98` 与 Core `5508d60` 的组合：十二个锁定文件无漂移，十一项生产者契约测试涵盖原 alpha.2/alpha.3 表面回归、CreditBalance 只读响应、负余额/发明字段拒绝，以及按锁定 `events/credit.changed.v1.json`、event-envelope 与 credit-ledger-entry Schema 校验的内部事件记录；74 项单元、57 项 HTTP E2E 与 31 项隔离 PostgreSQL 集成验收通过，包括十二路不同键竞争扣减不透支、十二路同键只产生一条账本效果、失败命令稳定重放、并发/分次退款封顶与跨账户拒绝、ACTIVE ADMIN 人工调整、账本 UPDATE/DELETE 被数据库触发器拒绝、注入投影漂移被显式暴露、整数边界与既有每日权益回归。不代表 SDK、Community 或 Skin 已成为消费者。

## 发布顺序

契约预发布 → 生产者兼容实现 → SDK 预发布 → 消费者兼容实现 → 集成验证 → 稳定契约/SDK → 观察期后移除旧行为。

## 兼容矩阵

| Contract | 状态 | Core | Community | Skin | TypeScript SDK |
|---|---|---|---|---|---|
| `0.1.0-draft` | 文档骨架 | 未实现 | 未实现 | 未实现 | 未生成 |
| Core `0.1.0-alpha.1` | 预发布；生产者与本地身份组合已验证 | `30382fd`：契约测试通过 | 不适用 | 不适用 | 未生成 |
| Core `0.1.0-alpha.2` | 预发布；生产者已实现并验证 | `ce89a39`：契约测试通过（含 Developer App/PAT 表面与 alpha.1 表面回归） | 不适用 | 不适用 | 未生成 |
| Core `0.1.0-alpha.3` | 预发布；每日权益生产者已实现并验证 | `8ba869a`：7 项契约、52 项 HTTP E2E、17 项 PostgreSQL 集成通过；锁提交 `fab1f3c` | 不适用 | 不适用 | 未生成 |
| Core `0.1.0-alpha.4` | 预发布；只读余额与积分账本切片生产者已实现并验证 | `5508d60`：11 项契约、57 项 HTTP E2E、31 项 PostgreSQL 集成通过（含不可变账本并发/幂等/退款/权限/迁移与整数边界证据）；锁提交 `9a85b98` | 不适用 | 不适用 | `0.1.0-alpha.4`（`@mc-plan/core-sdk`，`MCP-F1-CONTRACTS-001`）：generate-check 零漂移、25 项单元、pack 干净工程消费、固定镜像 `5508d60` 真实 HTTP smoke 通过 |
| Core `0.1.0-alpha.5` | 预发布；服务事件投递契约已锁，生产者未实现 | 未实现（预计 `MCP-F1-CORE-008`） | 不适用 | 不适用 | `0.1.0-alpha.5`（`@mc-plan/core-sdk`，`MCP-F1-CONTRACTS-002`）：类型基线重生成、支持操作仍为 12 个 producer 已验证操作（事件投递不暴露） |
| Skin `0.1.0-alpha.1` | 预发布；匿名窗口五缺口契约已锁，生产者未实现（Skin 产线在 Q-001 决策后跟进） | 不适用 | 不适用 | 未实现（ADR-0012 匿名窗口语义，预计后续 Skin 线切片） | 未生成 |

## SDK 0.1.0-alpha.4 验收（MCP-F1-CONTRACTS-001，与 producer 验收分栏）

producer 验收（`MCP-F1-CORE-005`，见上文）与本 SDK/consumer 验收是两栏独立事实；SDK 通过不等于任何消费者已集成。本切片组合：Contracts 工作区（锁提交 `9a85b98`，12 个 sha256 锁定文件）→ `@mc-plan/core-sdk@0.1.0-alpha.4`（openapi-typescript 7.10.1 生成，支持清单内嵌 9 个来源文件 sha256 并按真实文件复算校验）→ 固定 producer 镜像 `mc-plan-core:mcp-f1-core-005-5508d60`（Core `5508d60`）+ 隔离 PostgreSQL 17 + 本地 JWKS 测试发行方。

SDK 侧验收证据：`format:check`、`lint --max-warnings 0`、严格 `typecheck`（含 noUncheckedIndexedAccess/exactOptionalPropertyTypes）、`generate:check` 重跑 diff 为空、25 项单元测试（transport 超时/abort/有界重试不换键/非幂等不重试/4xx 不重试、Problem 解析、支持清单 hash 复算、client 表面与 200 重放/201 成功）、`build`、`pack:check`（pnpm pack 后干净临时工程离线安装并以严格 tsc 编译引用）、`smoke:real` 全场景通过：OIDC 用户读取 `/v1/me`、`/v1/entitlements`（skin/creation_session 当日 3 基线、读不消费）、`/v1/credits/balance`（无账户读零，前后 credit_accounts 与 credit_ledger_entries 计数均为 0）、`consumeCredits` 同键首次 201（`daily_entitlement`，余 2）→ 同键同请求 200 重放同 `consumption_id` → 同键异请求 409 `IDEMPOTENCY_KEY_CONFLICT`；不可信 issuer 401 `AUTHENTICATION_REQUIRED`、缺 `credits:read` 403 `INSUFFICIENT_SCOPE`，均以类型化 Problem 暴露。SDK 为 private 包，仅本地 pack 消费，不发布 npm、不设稳定版本。

## Core 0.1.0-alpha.1 兼容分类

本版本是从未发布、未实现的 `0.1.0-draft` 锁定首个生产者切片，分类为**预发布兼容收敛**：保留既有 `GET /v1/me`、`profile:read` 和 `PublicActor` 字段，仅补充明确的 `401 AUTHENTICATION_REQUIRED` 以及 `403 INSUFFICIENT_SCOPE` / `ACCOUNT_UNAVAILABLE` 语义，并保证 `403` 不泄露具体业务账号状态。尚未锁定的 Core 路径仍是后续 F1 实现目标，不据此宣称生产者已经支持。

发布顺序为 Contracts `0.1.0-alpha.1` → Core 生产者与契约测试 → Ops Keycloak/Core 集成 → 后续 TypeScript SDK 与消费者工作流。回退时生产者可回到尚无公共业务接口的 Core 第一工程切片；不得保留一个与本契约字段不一致的 `/v1/me`。

`MCP-F1-CORE-002` 已验证 Contracts `f9ad077`、Core `30382fd` 与 Ops `666565b` 的组合：Core 锁定文件及 PublicActor Schema 契约测试通过，并由真实 Keycloak Authorization Code + PKCE S256 令牌完成 `/v1/me` 验收。该组合不代表 SDK、Community 或 Skin 已成为消费者。

矩阵只记录已验证组合，不把“计划支持”写成已支持。

## Skin `0.1.0-alpha.1` 兼容分类

本版本是从未发布、未实现生产者的 `0.1.0-draft` 锁定首个 Skin 预发布切片，分类为**预发布兼容新增（匿名窗口语义）**：按 Foundation ADR-0012（所有者 2026-10-07 W10 方案 A）在既有四操作（createConversation/createRender/finalizeSkin/getJob，形状不变）之上新增四个匿名操作——`GET /v1/conversations/{conversationId}`（会话详情含消息历史）、`DELETE /v1/conversations/{conversationId}`（级联候选与字节的会话删除，204）、`GET /v1/conversations/{conversationId}/candidates/{candidateId}/preview` 与 `GET /v1/conversations/{conversationId}/skins/{resourceId}/download`（PNG 字节）。机器可校验规则：顶层 `security: []`（Standalone 匿名窗口），`userOAuth` 保留为 Official 模式文档性方案（不被任何操作引用属预期），每操作显式 404，全部路径 `/v1/` 前缀与唯一 operationId。生产者实现属后续 Skin 线切片（SKIN-008 产线在 Q-001 决策后跟进）。

发布顺序为 Contracts `0.1.0-alpha.1` → Skin 生产者实现与契约测试 → 后续消费者工作流。回退时 Skin 生产者可回到仅实现四操作草案面的状态；不得保留一个与本契约匿名窗口语义不一致的预览/下载/删除表面。
