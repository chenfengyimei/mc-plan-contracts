# 兼容与版本策略

## Community `0.1.0-alpha.1` 兼容分类

由无生产者/消费者的 `0.1.0-draft` 收敛为**预发布兼容收敛与新增**（Foundation ADR-0014）。新增上传完成、作者资源查询、受控版本下载三操作；锁定上传 1 MiB 上限、签名上传响应头、实际字节封存、分页与错误/幂等/归属语义。既有七操作的范围保持资源闭环，公布审核失败保持待审、版本与许可不可变、下架终态和七天清理规则；正式审核提供商与许可文本仍为所有者门槛。Core alpha.7 与 Skin alpha.1 文件零变化。

顺序：Contracts alpha.1 → Community producer/真实 PostgreSQL 与 S3 兼容集成 → SDK → 真实消费者 → Ops/预发布验收。当前只锁定契约，未声明 Community 已实现，也不在 Core SDK 暴露 Community 操作。草案从未部署，无既有消费者迁移；如已部署的实现不符合本语义，不得以本次预发布追认为兼容。

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

发布顺序为 Contracts `0.1.0-alpha.5` → Core 生产者与契约测试（已由 `MCP-F1-CORE-008` 关闭）→ SDK 暴露（已由 `MCP-F1-CONTRACTS-004` 关闭）→ 后续消费者工作流。回退时生产者可回到仅实现 `0.1.0-alpha.4` 的状态；不得保留一个与本契约语义不一致的事件投递表面。SDK 类型基线随 alpha.5 重生成；`listDeliveredEvents`/`acknowledgeEvents` 已在 `MCP-F1-CONTRACTS-004` 以 `MCP-F1-CORE-008` 的 producer 证据暴露进支持操作清单。

`MCP-F1-CORE-005` 已验证 Contracts 锁提交 `9a85b98` 与 Core `5508d60` 的组合：十二个锁定文件无漂移，十一项生产者契约测试涵盖原 alpha.2/alpha.3 表面回归、CreditBalance 只读响应、负余额/发明字段拒绝，以及按锁定 `events/credit.changed.v1.json`、event-envelope 与 credit-ledger-entry Schema 校验的内部事件记录；74 项单元、57 项 HTTP E2E 与 31 项隔离 PostgreSQL 集成验收通过，包括十二路不同键竞争扣减不透支、十二路同键只产生一条账本效果、失败命令稳定重放、并发/分次退款封顶与跨账户拒绝、ACTIVE ADMIN 人工调整、账本 UPDATE/DELETE 被数据库触发器拒绝、注入投影漂移被显式暴露、整数边界与既有每日权益回归。不代表 SDK、Community 或 Skin 已成为消费者。

`MCP-F1-CORE-008` 已验证 Contracts 锁提交 `5ba7172` 与 Core `87ddd66` 的组合：十四个锁定文件无漂移，二十二项生产者契约测试涵盖既有全部表面回归与 EventPage/EventAcknowledgment/credit.changed.v1 按锁定 Schema 校验的事件拉取/确认响应；114 项单元、66 项 HTTP E2E 与 60 项隔离 PostgreSQL/Keycloak 集成验收通过，含发布时赋位顺序回归（T1 退避后发布、T2 业务事务迟提交、T3 双实例收敛、T4 双发布器真并发+并发消费者零丢失）与持久消费者去重证明；Ops 以固定镜像两轮独立真实验收通过。该组合不代表 Skin/Community 已成为消费者。

## Core `0.1.0-alpha.6` 兼容分类

本版本是在 `0.1.0-alpha.5` 之上的**预发布兼容新增（公开资料与资料名编辑）**：落实 W02 决策包第一阶段的 D1/D2/D4/D6（项目所有者 2026-10-07 采纳建议值；D3 年龄声明与 D5 用户权利端点的未决子项显式延后、不写入本版本）。`GET /v1/users/{userId}`（operationId `getPublicUser`）生产者化并标记 prerelease：保持已锁 PublicActor 三字段零新增（D1），无认证公开面，仅 ACTIVE 业务账号可公开寻址——未知、畸形与非 ACTIVE 标识一律 404 且不泄露账号存在性与状态；响应绝不包含身份邮箱、OIDC subject、issuer 或验证声明。新增 `PATCH /v1/me`（operationId `updateCurrentUser`，prerelease）：唯一可编辑字段为 `display_name`（1..80，请求体字段封闭），需要新 `profile:write` scope（userOAuth 与 personalAccessToken 双凭证面声明，但 PAT 授予目录不含该 scope，机器校验锁定 PAT 永不可获得——编辑实际只能由 OIDC 用户令牌完成）；响应保持 PublicActor；400/401/403 沿用既有锁定语义，不新增公共错误码。D4 维持现状：账户状态不新增公开字段，仍仅经 403 `ACCOUNT_UNAVAILABLE` 隐式表现。D6 批量公开资料查询本轮不冻结，待真实消费者需求另开契约先行工作流。`0.1.0-alpha.5` 已锁定的全部表面保持字节兼容。

发布顺序为 Contracts `0.1.0-alpha.6` → Core 生产者与契约测试（`MCP-F1-CORE-009` 本切片）→ 后续 SDK/消费者工作流。回退时生产者可回到仅实现 `0.1.0-alpha.5` 的状态；不得保留一个与本契约语义不一致的公开资料或资料编辑表面。SDK 类型基线随 alpha.6 重生成（支持操作清单保持 14 个 producer 已验证操作）；`updateCurrentUser`/`getPublicUser` 因尚无 producer 证据不在 SDK 支持操作清单中暴露。

## Core `0.1.0-alpha.7` 兼容分类

本版本是在 `0.1.0-alpha.6` 之上的**预发布兼容新增（注销权利端点）**：落实所有者 2026-10-08 拍板的 W02-b 决策（注销联动=仅本地停用；Keycloak 不动）。新增 `POST /v1/me/deactivation`（operationId `deactivateCurrentUser`，prerelease）：`profile:write` scope（PAT 授予目录不含该 scope——与 `updateCurrentUser` 同一机器校验——注销因此仅限交互式 OIDC 用户令牌；本操作仅声明 userOAuth 凭证面）；成功 204 且无响应体。注销将业务账号置为既有 PG 枚举值 `CLOSED` 并在同事务写 `ACCOUNT_DEACTIVATED` 审计（含 previous_status/status），因此零迁移、零新 scope、零新公共错误码。注销后仅 ACTIVE 业务账号可解析主体（既有锁定语义），同一令牌的重复调用与其余全部认证面（`GET/PATCH /v1/me`、权益、积分、开发者应用、PAT 面、事件消费面）一律 403 `ACCOUNT_UNAVAILABLE`；公开面 `GET /v1/users/{userId}` 经既有 ACTIVE-only 语义自动 404。注销后的积分/权益状态与 Keycloak 会话维持现状；本 prerelease 无重新激活路径。`0.1.0-alpha.6` 已锁定的全部表面保持字节兼容。

发布顺序为 Contracts `0.1.0-alpha.7` → Core 生产者与契约测试（`MCP-F1-CORE-010` 已关闭，最终树 `cf95e3e`）→ SDK 暴露（`MCP-F1-CONTRACTS-006` 已完成）→ 后续消费者工作流。回退时生产者可回到仅实现 `0.1.0-alpha.6` 的状态；不得保留一个与本契约语义不一致的注销表面。SDK 类型基线随 alpha.7 重生成；`deactivateCurrentUser` 已在 `MCP-F1-CONTRACTS-006` 以 CORE-010 的 producer 证据暴露进 SDK（支持操作 16→17，producer 锚更新为 `cf95e3e`），公共契约文件零变化。

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
| Core `0.1.0-alpha.5` | 预发布；服务事件投递面生产者已实现并验证 | `87ddd66`（`MCP-F1-CORE-008`）：22 项契约、66 项 HTTP E2E、60 项 PostgreSQL/Keycloak 集成通过（发布时赋位/持久去重/真并发回归）；Ops 固定镜像两轮真实验收；锁提交 `5ba7172` | 不适用 | 不适用 | `0.1.0-alpha.5`（`@mc-plan/core-sdk`，`MCP-F1-CONTRACTS-004`）：14 个 producer 已验证操作（12 原有 + `listDeliveredEvents`/`acknowledgeEvents`，producer 锚定 `87ddd66`）；pack 干净工程消费与固定镜像 `87ddd66` 真实 HTTP smoke 通过 |
| Core `0.1.0-alpha.6` | 预发布；公开资料读取与资料名编辑生产者已实现并验证 | `7d22539`（`MCP-F1-CORE-009`）：24 项契约、81 项 HTTP E2E、65 项 PostgreSQL/Keycloak 集成通过；锁提交 `6b80c4c` | 不适用 | 不适用 | `0.1.0-alpha.6`（`@mc-plan/core-sdk`，`MCP-F1-CONTRACTS-005`）：16 个 producer 已验证操作（14 原有 + `getPublicUser`/`updateCurrentUser`，producer 锚定 `7d22539`）；pack 干净工程消费与固定镜像 `mc-plan-core:mcp-f1-core-009-7d22539` 真实 HTTP smoke 通过 |
| Core `0.1.0-alpha.7` | 预发布；注销权利端点契约已锁，生产者已实现并验证 | `cf95e3e`（`MCP-F1-CORE-010`）：25 项契约、86 项 HTTP E2E、68 项 PostgreSQL/Keycloak 集成通过（零迁移、CLOSED+同事务审计、注销后 403/404 语义）；锁提交 `56bff96` | 不适用 | 不适用 | `0.1.0-alpha.7`（`@mc-plan/core-sdk`，`MCP-F1-CONTRACTS-006`）：17 个 producer 已验证操作（16 原有 + `deactivateCurrentUser`，producer 锚定 `cf95e3e`）；pack 干净工程消费与固定镜像 `mc-plan-core:mcp-f1-core-010-cf95e3e` 真实 HTTP smoke 通过（含真实 Keycloak/PKCE 注销链） |
| Core `0.1.0-alpha.8` | 预发布；官方 Community OAuth 委托生产者已实现并验证 | `fb1bc07`（`MCP-F2-CORE-001`）：306 项自动化验收通过；锁提交 `ebb00a6`；Ops 真实登记 PKCE 客户端与指定审核员全链独立验收 | 不适用 | 不适用 | `0.1.0-alpha.8`（`@mc-plan/core-sdk`，类型基线随 alpha.8 重生成）：支持操作保持 17 个；对新固定镜像 `mc-plan-core:mcp-f2-core-001-fb1bc07` 真实 HTTP + Keycloak 回归通过 |
| Core `0.1.0-alpha.9` | 预发布；管理员只读查询面契约已锁，生产者已实现并验证 | `06de705`（`MCP-F4-CORE-001`）：全量门禁 + Ops 真实管理员栈验收 + apps/admin 浏览器 e2e 通过；锁提交 `8f917bd` | 不适用 | 不适用 | `0.1.0-alpha.9`（`@mc-plan/core-sdk`，`MCP-F4-CONTRACTS-001`）：23 个 producer 已验证操作（17 原有 + 六管理只读，producer 锚定 `06de705`）；pack 干净工程消费与固定镜像 `mc-plan-core:mcp-f4-core-001-29939a0` 真实 HTTP smoke 通过 |
| Skin `0.1.0-alpha.1` | 预发布；匿名窗口契约已锁，生产者已实现并验证 | 不适用 | 不适用 | `14a8fe3`（`MCP-F1-SKIN-008/009`）：四公共端点 + 完整创作链全量门禁（unit 128、api 集成 15、worker 12、Playwright fake 2 + image 1、契约零漂移）；锁提交 `3006402` | `0.1.0-alpha.1`（`@mc-plan/skin-sdk`，`MCP-F1-CONTRACTS-007`）：8 个 producer 已验证操作（producer 锚定 `14a8fe3`）；pack 干净工程消费与生产者树真实 HTTP smoke 两轮通过（确定性 Fake Provider） |
| Community `0.1.0-alpha.2` | 预发布；producer 与 Community SDK 均已实现并验证 | 不适用 | `779803e`（`MCP-F2-COMMUNITY-001`）：13 单元、2 契约、30 集成（真实 PostgreSQL/S3 协议/独立 Core 镜像/真实 Keycloak PKCE）+ 固定镜像运行冒烟通过；锁提交 `68b3d42` | 不适用 | `0.1.0-alpha.2`（`@mc-plan/community-sdk`，`MCP-F2-CONTRACTS-002`）：10 个 producer 已验证操作（producer 锚定 `70e55a1`）；pack 干净工程消费与固定镜像 `mcp-f2-community-001-779803e` 真实 HTTP smoke 两轮通过 |
| Community `0.1.0-alpha.3` | 预发布；匿名内联预览契约已锁，生产者未实现（门户切片跟进） | 不适用 | 未实现（预计 `MCP-F2-COMMUNITY-002` 门户切片内落地） | 不适用 | 类型基线已随 alpha.3 重生成（`@mc-plan/community-sdk@0.1.0-alpha.3`，`MCP-F2-CONTRACTS-003`）：仍 10 个 producer 已验证操作，`previewResourceVersion` 无 producer 证据不暴露 |

## SDK 0.1.0-alpha.4 验收（MCP-F1-CONTRACTS-001，与 producer 验收分栏）

producer 验收（`MCP-F1-CORE-005`，见上文）与本 SDK/consumer 验收是两栏独立事实；SDK 通过不等于任何消费者已集成。本切片组合：Contracts 工作区（锁提交 `9a85b98`，12 个 sha256 锁定文件）→ `@mc-plan/core-sdk@0.1.0-alpha.4`（openapi-typescript 7.10.1 生成，支持清单内嵌 9 个来源文件 sha256 并按真实文件复算校验）→ 固定 producer 镜像 `mc-plan-core:mcp-f1-core-005-5508d60`（Core `5508d60`）+ 隔离 PostgreSQL 17 + 本地 JWKS 测试发行方。

SDK 侧验收证据：`format:check`、`lint --max-warnings 0`、严格 `typecheck`（含 noUncheckedIndexedAccess/exactOptionalPropertyTypes）、`generate:check` 重跑 diff 为空、25 项单元测试（transport 超时/abort/有界重试不换键/非幂等不重试/4xx 不重试、Problem 解析、支持清单 hash 复算、client 表面与 200 重放/201 成功）、`build`、`pack:check`（pnpm pack 后干净临时工程离线安装并以严格 tsc 编译引用）、`smoke:real` 全场景通过：OIDC 用户读取 `/v1/me`、`/v1/entitlements`（skin/creation_session 当日 3 基线、读不消费）、`/v1/credits/balance`（无账户读零，前后 credit_accounts 与 credit_ledger_entries 计数均为 0）、`consumeCredits` 同键首次 201（`daily_entitlement`，余 2）→ 同键同请求 200 重放同 `consumption_id` → 同键异请求 409 `IDEMPOTENCY_KEY_CONFLICT`；不可信 issuer 401 `AUTHENTICATION_REQUIRED`、缺 `credits:read` 403 `INSUFFICIENT_SCOPE`，均以类型化 Problem 暴露。SDK 为 private 包，仅本地 pack 消费，不发布 npm、不设稳定版本。

## SDK 0.1.0-alpha.5 事件操作验收（MCP-F1-CONTRACTS-004，与 producer 验收分栏）

producer 验收（`MCP-F1-CORE-008`，见上文）与本 SDK/consumer 验收仍是两栏独立事实；SDK 通过不等于任何消费者已集成。本切片组合：Contracts 工作区（锁提交 `5ba7172`，14 个 sha256 锁定文件零漂移）→ `@mc-plan/core-sdk@0.1.0-alpha.5`（14 个 producer 已验证操作，`SUPPORTED_PRODUCER_COMMIT` 锚定 Core `87ddd66`）→ 固定 producer 镜像 `mc-plan-core:mcp-f1-core-008-87ddd66`（Core `87ddd66`，运行输入 `OUTBOX_PUBLISHER_ENABLED=true`/`OUTBOX_SINK=pull`/`OUTBOX_DRAIN_INTERVAL_MS=250` + CORE-007 起的 `KEYCLOAK_ADMIN_*` fail-closed 形状校验）+ 隔离 PostgreSQL 17 + 本地 JWKS 测试发行方。

SDK 侧验收证据：`format:check`、`lint --max-warnings 0`、严格 `typecheck`、`generate:check` 零漂移（契约文件零变化）、32 项单元测试（25 原有 + 7 项事件面：服务鉴权/路径与查询形状、limit 1..200 客户端先验、确认 body 形状与游标必验、事件 Problem 映射 403/400、服务凭证边界）、`build`、`pack:check`（修复 npm_execpath 指向 .mjs/.cjs 时经当前 node 调用、tarball 名随包版本派生后，干净临时工程离线安装并以严格 tsc 编译消费 `listDeliveredEvents`/`acknowledgeEvents` 与既有 12 操作）、`smoke:real` 全场景通过：既有 12 操作回归 + 事件闭环——真实身份供给与权益消费产生的 flat 内部事件达终态 PUBLISHED 后拉取面恒为空（空 items+null cursor）；两个 `[SYNTHETIC-DB-SEED]` 锁定合法 `credit.changed.v1` 信封（psql 直插、显式 `gen_random_uuid()` id、无公共写 API 诚实标注）按发布序拉取；文件持久 event_id 注册表去重——首次处理成功后 ack 前崩溃、重建消费者后真实重投同事件、副作用恰一次、最终确认追平；重复确认幂等返回当前确认位置；双服务主体 A/B 进度隔离（A 确认后 B 仍可拉取、B 独立确认追平）；A 的真实游标由 B 使用 400 `VALIDATION_FAILED`、畸形游标 400；`credits:consume`-only 服务令牌与用户 OIDC 令牌 403 `INSUFFICIENT_SCOPE`、错 issuer 服务令牌 401 `AUTHENTICATION_REQUIRED`。契约机器校验基线不变：validate_contracts.py（20 Schema/事件、3 OpenAPI、30 operationIds）与 redocly 三文档 lint 通过。SDK 仍为 private 包，仅本地 pack 消费，不发布 npm、不设稳定版本。

## SDK 0.1.0-alpha.7 注销操作验收（MCP-F1-CONTRACTS-006，与 producer 验收分栏）

producer 验收（`MCP-F1-CORE-010`，见上文矩阵）与本 SDK/consumer 验收仍是两栏独立事实；SDK 通过不等于任何消费者已集成。本切片组合：Contracts 工作区（锁提交 `56bff96`，公共契约文件零变化）→ `@mc-plan/core-sdk@0.1.0-alpha.7`（17 个 producer 已验证操作，`SUPPORTED_PRODUCER_COMMIT` 更新为 CORE-010 最终树 `cf95e3e`）→ 固定 producer 镜像 `mc-plan-core:mcp-f1-core-010-cf95e3e` + 隔离 PostgreSQL 17 的两阶段真实 HTTP smoke：既有 16 操作回归阶段沿用本地 JWKS 测试发行方（诚实标注，不称真实 Keycloak）；注销链阶段使用本仓提交的 realm 夹具（smoke/fixtures/mc-plan-sdk-smoke-realm.json）与隔离真实 Keycloak 26.8.0 容器（start-dev --import-realm，会话唯一命名，finally 清理），第二个 Core 容器以真实 realm 为 OIDC issuer，全部注销场景令牌均为真实 Authorization Code + PKCE(S256) 令牌。

SDK 侧验收证据：`format:check`、`lint --max-warnings 0`、严格 `typecheck`、`generate:check` 零漂移（契约文件零变化）、37 项单元测试（32 原有 + 5 项注销面：方法/路径/认证提供器边界、空请求体不携带 Content-Type、204 返回 void 且不解析响应体、401/403 Problem 类型化映射、POST 遇 503 不重试只发一次、断连后只发一次注销请求、缺 user 凭证提供器不发送）、`build`、`pack:check`（干净临时工程离线安装并以严格 tsc 编译消费 `deactivateCurrentUser` 与既有操作）；`smoke:real` 全场景通过：[REAL-KEYCLOAK-PKCE] 用户 A 经浏览器 PKCE 登录供给 ACTIVE 业务账号且公开资料可读；[SYNTHETIC-DB-SEED] 隔离测试库内将新账号业务角色由默认 USER 提升为 DEVELOPER（PAT 创建的前置夹具，明确标注）后经 SDK 真实创建 PAT（仅目录 scope `profile:read`，明文只在本会话内存使用），PAT 调注销 403 `INSUFFICIENT_SCOPE`（PAT 目录永不含 `profile:write`）；OIDC 用户令牌注销 204 返回 void；随后 GET/PATCH `/v1/me`、同一令牌重复注销与 PAT 认证面一律 403 `ACCOUNT_UNAVAILABLE`，公开读取 404；用户 B 完全不受影响（身份供给、权益视图、公开面均正常且注销者在其视角仍 404）；[REAL-KEYCLOAK-ADMIN] 经 master realm 管理 API 核对 Keycloak 用户 A 保持 enabled；Keycloak 重新登录仍成功但新 PKCE 令牌被 Core 以 403 拒绝（所有者 2026-10-08 仅本地停用决策的完整边界：登录仍可、Core API 面一律拒绝）；无 `profile:write` 客户端令牌 403 `INSUFFICIENT_SCOPE` 且不改变账号状态；无凭证裸请求 401 `AUTHENTICATION_REQUIRED`。工具链实证：Keycloak audience mapper 要求 `included.client.audience` 指向的客户端存在于 realm——realm 夹具必须包含 `mc-plan-core` bearer 资源服务客户端，否则 access token 完全没有 `aud` 声明、Core 以 401 拒绝。契约机器校验基线不变：validate_contracts.py（20 Schema/事件、3 OpenAPI、32 operationId）与 redocly 三文档通过（1 个 skin.yaml 预期警告）。SDK 仍为 private 包，仅本地 pack 消费，不发布 npm、不设稳定版本。

## SDK 0.1.0-alpha.9 管理只读操作验收（MCP-F4-CONTRACTS-001，与 producer 验收分栏）

producer 验收（`MCP-F4-CORE-001`，见上文矩阵与 alpha.9 分类段）与本 SDK/consumer 验收仍是两栏独立事实；SDK 通过不等于任何消费者已集成。本切片组合：Contracts 工作区（锁提交 `8f917bd`，公共契约文件零变化）→ `@mc-plan/core-sdk@0.1.0-alpha.9`（23 个 producer 已验证操作，`SUPPORTED_PRODUCER_COMMIT` 更新为 F4-CORE-001 最终树 `06de705`；`SUPPORTED_CONTRACT_FILES` 补齐 alpha.9 实际生成输入——新增 11 个 admin 字段封闭 Schema 的 sha256，清单 12→23 项）→ 固定 producer 镜像 `mc-plan-core:mcp-f4-core-001-29939a0`（即 MCP-F4-CORE-001 记录声明的镜像；producer 锚定提交 `06de705` 与镜像源提交 `29939a0` 的差异经 git diff 证实仅为 apps/admin web 文件——callback/logout 路由、playwright 配置、测试改名与 docs——Core API 运行表面一致）+ 隔离 PostgreSQL 17 + 本地 JWKS 测试发行方（管理面阶段，诚实标注非 Keycloak）+ 隔离真实 Keycloak 26.8.0（注销链回归阶段）。

SDK 侧验收证据：`format:check`、`lint --max-warnings 0`、严格 `typecheck`、`generate:check` 零漂移（契约文件零变化）、47 项单元测试（37 原有 + 10 项管理面：用户令牌边界与服务令牌不可替代、limit/cursor/state/路径客户端先验不发请求、查询形状、404/403 Problem 类型化映射、幂等 GET 5xx 重试）、`build`、`pack:check`（干净临时工程严格 tsc 消费六管理方法）、`smoke:real` 两轮 exit 0：既有 16 操作与真实 Keycloak/PKCE 注销链回归不变，新增管理面——[SYNTHETIC-DB-SEED] 标注的 ADMIN 角色提升与链一致 grant 账本夹具行（psql 直插、显式 id/值、诚实标注；其余全部为真实 producer 数据）；`listAdminUsers` 字段封闭摘要 + 游标分页走到 null cursor 并覆盖烟囱用户与管理员；`getAdminUser` 十字段封闭详情（无邮箱/subject 泄露，余额 0→夹具后 5，身份链接/应用/PAT 计数）与未知标识 404；`listAdminCreditLedger` 锁定条目形状（reason/actor_id 扩展、余额链 0→5）与未知用户 404；`listAdminEntitlementRecords` 读取真实消费物化的记录（granted 3/consumed 1、module/operation/policy_date 封闭）；`listAdminAuditRecords` 真实审计字段封闭 + user_id 过滤收敛；`listAdminOutboxRecords` 字段封闭 + state=PUBLISHED 过滤与投递位次；负例：缺 `admin:read` 403 `INSUFFICIENT_SCOPE`、有 scope 无 ADMIN 角色 403 `ROLE_REQUIRED`、裸请求与服务令牌均在认证层 401 `AUTHENTICATION_REQUIRED`（admin 面仅 userOAuth 凭证面）、原始 limit=101 与伪造游标 400 `VALIDATION_FAILED`、持 `pat:manage` 的管理员经 SDK 请求 `admin:read` PAT 得 400（PAT 目录隔离，UNKNOWN_SCOPE 字段错误）。契约机器校验基线不变：validate_contracts.py 与 redocly 三文档通过（1 个 skin.yaml 预期警告）。SDK 仍为 private 包，仅本地 pack 消费，不发布 npm、不设稳定版本。

## SDK 0.1.0-alpha.2 Community 验收（MCP-F2-CONTRACTS-002，与 producer 验收分栏）

producer 验收（`MCP-F2-COMMUNITY-001`，见上文矩阵）与本 SDK/consumer 验收是两栏独立事实；SDK 通过不等于任何消费者已集成。本切片组合：Contracts 工作区（锁提交 `68b3d42`，7 个生成输入 sha256 锁定文件零漂移）→ `@mc-plan/community-sdk@0.1.0-alpha.2`（10 个 producer 已验证操作，`SUPPORTED_PRODUCER_COMMIT` 锚定 community `70e55a1`）→ 固定 producer 镜像 `mc-plan-community:mcp-f2-community-001-779803e` + 独立 Core 镜像 `mc-plan-core:mcp-f1-core-012-closeout`（每次受保护请求经真实 `GET /v1/me` 解析活动身份）+ 两个隔离 PostgreSQL 17 + 本地 JWKS 测试发行方（诚实标注，非 Keycloak；producer 自身运行冒烟亦用本地签发形态，其真实 Keycloak PKCE 证据在生产者集成测试内）+ producer 同款 S3rver S3 协议服务（拆分服务/公共端点，浏览器可达签名 PUT 从宿主执行）。

SDK 侧验收证据：`format:check`、`lint --max-warnings 0`、严格 `typecheck`（含 noUncheckedIndexedAccess/exactOptionalPropertyTypes）、`generate:check` 零漂移（契约文件零变化）、38 项单元测试（transport 超时/abort/有界重试不换键/4xx 不重试、11 个 Community 锁定错误码 Problem 解析、支持清单 7 文件 sha256 复算、client 表面：每操作路径/鉴权/请求体形状、无体命令不带 Content-Type、204 返回 void、二进制下载返回字节与 mediaType、公开读取绝不携带凭据头、1 MiB/limit/键长客户端先验）、`build`、`pack:check`（tarball 名随包版本派生，干净临时工程离线安装并以严格 tsc 编译消费全部 10 方法）、`smoke:real` 两轮 exit 0：[REAL-PRODUCER-HTTP] 完整上传会话生命周期——真实签名 S3 PUT（`upload_headers` 逐字回放）→ 字节校验 → 封存，重复 complete 返回同体；非 PNG 字节 400 `UPLOAD_INVALID`、未上传字节 409 `UPLOAD_NOT_READY`、1 MiB 上限 SDK 先验 + 原始面 400 `VALIDATION_FAILED`；版本/发布 202 保持 `pending_moderation`（运行审核按 Q-009 disabled）；属主认证私有视图可见候选 vs 匿名 404；[SYNTHETIC-DB-SEED] 显式标注的审核决定镜像（复刻生产者 ResourceWorker APPROVED 写库路径；字节全部经真实校验链）使已发布读取/列表/下载正路径可观测：`listResources`/`listAuthorResources` 游标分页确定性（created_at DESC、resource_id DESC、未知作者空页）、`downloadResourceVersion` 字节 sha256 与 `files[0].sha256` 一致 + Content-Type/attachment/nosniff/no-store 断言、同键重放同体（jsonb 键序无关比较）与同键异请求 409 `IDEMPOTENCY_KEY_CONFLICT`、无版本发布 409 `RESOURCE_STATE_CONFLICT`、外属主版本/下架 404、伪造/跨面游标 400 `VALIDATION_FAILED`、错 scope 403 `INSUFFICIENT_SCOPE`、错 issuer/过期令牌 401 `AUTHENTICATION_REQUIRED`、裸请求 401、`unpublishResource` 204 void（同键/新键重放均 204）、下架终态后全部公开面即时 404/移出列表；10 个暴露操作全部至少一条成功路径。契约机器校验基线不变：validate_contracts.py（20 Schema/事件、3 OpenAPI、35 operationIds）与 redocly 三文档通过（1 个 skin.yaml 预期警告）。SDK 仍为 private 包，仅本地 pack 消费，不发布 npm、不设稳定版本。

## SDK 0.1.0-alpha.1 Skin 验收（MCP-F1-CONTRACTS-007，与 producer 验收分栏）

producer 验收（`MCP-F1-SKIN-008/009`，见上文矩阵）与本 SDK/consumer 验收是两栏独立事实；SDK 通过不等于任何消费者已集成。本切片组合：Contracts 工作区（锁提交 `3006402`，公共契约文件零变化）→ `@mc-plan/skin-sdk@0.1.0-alpha.1`（8 个 producer 已验证操作，`SUPPORTED_PRODUCER_COMMIT` 锚定 skin main `14a8fe3`；`SUPPORTED_CONTRACT_FILES` 内嵌 skin.yaml 与 common/problem.json 两个生成输入的 sha256）→ 生产者树（skin `14a8fe3`，从邻接只读 checkout 以 node 直启 api/worker，本机 testcontainers 策略探测不可用的既有手工容器绕过）+ 会话隔离手工 PostgreSQL 17 与 Redis 7 容器 + 确定性 Fake Provider（诚实标注：无 LLM/图像模型参与、无付费凭据读取、Q-001 不触碰，候选为 fixture 质量——只证明 SDK 与匿名窗口协议，不证明模型质量）。

SDK 侧验收证据：`format:check`、`lint --max-warnings 0`、严格 `typecheck`（含 noUncheckedIndexedAccess/exactOptionalPropertyTypes）、`generate:check` 零漂移（契约文件零变化）、29 项单元测试（transport 超时/abort/有界重试不换键/4xx 不重试、10 个 SKIN 错误码 Problem 解析、支持清单 2 文件 sha256 复算、client 表面：每操作路径/无凭据头断言、命令键与请求体形状、臂模型枚举与消息/标题/描述先验、204 返回 void、二进制面 64x64 PNG 魔数与 IHDR 先验、非 PNG/错误尺寸拒绝、幂等 GET 5xx 重试）、`build`、`pack:check`（tarball 名随版本派生，干净临时工程离线安装并以严格 tsc 消费创作/渲染/预览/删除链）、`smoke:real` 两轮 exit 0：创建（字段封闭会话）→ 同键同请求重放原始会话与同键异请求 409 `SKIN_IDEMPOTENCY_CONFLICT` → 渲染 202 + 任务轮询至 succeeded（candidate_id）→ 候选预览字节（image/png）与未知候选 404 `SKIN_CANDIDATE_NOT_FOUND` → 会话详情含消息历史（消息字段封闭、attempts 3/1）→ 确认 202 + 轮询至 succeeded（resource_id）与同键重放原任务 → 成品下载字节与未知资源 404 `SKIN_RESOURCE_NOT_FOUND` → 完成后再确认 409 `SKIN_CONVERSATION_NOT_ACTIVE` → 第二会话三次渲染后第四次 409 `SKIN_ATTEMPTS_EXHAUSTED` → 未知任务/会话 404 `SKIN_JOB_NOT_FOUND`/`SKIN_CONVERSATION_NOT_FOUND` → 删除 204 void 后详情/预览/下载全部 404 不复活；无时钟操控（24h/30d 保留窗口仅作为元数据读取）；冒烟日志零凭据泄露、零残留容器/卷。Official 模式/F3 集成、Q-001/Q-011/Q-012/Q-013 与真实消费者集成为独立门槛，不因 SDK 交付而视为已支持。SDK 仍为 private 包，仅本地 pack 消费，不发布 npm、不设稳定版本。

## Core 0.1.0-alpha.1 兼容分类

本版本是从未发布、未实现的 `0.1.0-draft` 锁定首个生产者切片，分类为**预发布兼容收敛**：保留既有 `GET /v1/me`、`profile:read` 和 `PublicActor` 字段，仅补充明确的 `401 AUTHENTICATION_REQUIRED` 以及 `403 INSUFFICIENT_SCOPE` / `ACCOUNT_UNAVAILABLE` 语义，并保证 `403` 不泄露具体业务账号状态。尚未锁定的 Core 路径仍是后续 F1 实现目标，不据此宣称生产者已经支持。

发布顺序为 Contracts `0.1.0-alpha.1` → Core 生产者与契约测试 → Ops Keycloak/Core 集成 → 后续 TypeScript SDK 与消费者工作流。回退时生产者可回到尚无公共业务接口的 Core 第一工程切片；不得保留一个与本契约字段不一致的 `/v1/me`。

`MCP-F1-CORE-002` 已验证 Contracts `f9ad077`、Core `30382fd` 与 Ops `666565b` 的组合：Core 锁定文件及 PublicActor Schema 契约测试通过，并由真实 Keycloak Authorization Code + PKCE S256 令牌完成 `/v1/me` 验收。该组合不代表 SDK、Community 或 Skin 已成为消费者。

矩阵只记录已验证组合，不把“计划支持”写成已支持。

## Skin `0.1.0-alpha.1` 兼容分类

本版本是从未发布、未实现生产者的 `0.1.0-draft` 锁定首个 Skin 预发布切片，分类为**预发布兼容新增（匿名窗口语义）**：按 Foundation ADR-0012（所有者 2026-10-07 W10 方案 A）在既有四操作（createConversation/createRender/finalizeSkin/getJob，形状不变）之上新增四个匿名操作——`GET /v1/conversations/{conversationId}`（会话详情含消息历史）、`DELETE /v1/conversations/{conversationId}`（级联候选与字节的会话删除，204）、`GET /v1/conversations/{conversationId}/candidates/{candidateId}/preview` 与 `GET /v1/conversations/{conversationId}/skins/{resourceId}/download`（PNG 字节）。机器可校验规则：顶层 `security: []`（Standalone 匿名窗口），`userOAuth` 保留为 Official 模式文档性方案（不被任何操作引用属预期），每操作显式 404，全部路径 `/v1/` 前缀与唯一 operationId。生产者已由 `MCP-F1-SKIN-008/009` 工程范围验收关闭（skin `14a8fe3`；受控视觉验收与厂商绑定仍按 ADR-0015/Q-001 归属后续基准，不追认 fixture 质量）。

发布顺序为 Contracts `0.1.0-alpha.1` → Skin 生产者实现与契约测试（`MCP-F1-SKIN-008/009` 已关闭）→ SDK 暴露（`MCP-F1-CONTRACTS-007` 已完成）→ 后续消费者工作流。回退时 Skin 生产者可回到仅实现四操作草案面的状态；不得保留一个与本契约匿名窗口语义不一致的预览/下载/删除表面。

## Community `0.1.0-alpha.2` 身份依赖收敛

alpha.1 尚无 producer、消费者或部署；alpha.2 在所有认证操作中显式加入既有 `profile:read`，与资源/上传 scope 同时要求，用于通过 Core `GET /v1/me` 获取稳定且仍可用的业务用户 ID。令牌需要同时被 Community 与 Core audience 接受。此项是**预发布安全语义收紧**，以新预发布版本和明确无部署迁移窗口处理；不发明用户 ID claim、不缓存或复制 Core 身份真相，不直接读其数据库。匿名公开读取不变，Core/Skin 契约与 Core SDK 17 操作均不变。生产者只能锁 alpha.2 后实现，alpha.1 不进入兼容组合。

## Community alpha.2 本地 producer 与 Core 消费者组合

`MCP-F2-COMMUNITY-001` 已在 Community `779803e` 实现 10 个 alpha.2 操作，锁定 Contracts 接口提交 `68b3d42` 的 11 个来源文件；公开类型由 OpenAPI 生成，未复制服务源码。验证：13 单元、2 契约、30 集成；真实 PostgreSQL/本地磁盘 S3 协议服务、隔离 Core 镜像及真实 Keycloak 26.8 S256 PKCE，实际字节封存、并发/归属/不可变性/删除与租约恢复均有证据。

Core 消费组合单独记录：Community `779803e` → Core API alpha.7、Core 运行镜像 `mc-plan-core:mcp-f1-core-012-closeout`（代码树 `9303cc6`）→ Core `/v1/me`；每次受保护请求通过公开 API 解析活动用户，真实注销后同 token 被 Community 拒绝。使用生成的契约类型与响应验证，不跨库、不导入私有业务源码；该事实不等于 Community 已消费 Core SDK 的全部操作。

审核 allow/reject 在本地测试中明确为 SYNTHETIC-MODERATION；运行入口 disabled，保持待审。这里登记的是本地工程组合，不是正式审核、目标对象存储、备份恢复、Community SDK 或完整 F2/F4 首发。Community 最终运行镜像与完成状态以工作流记录为准。Core/Skin 接口与 Core SDK 17 操作未改变，SDK 全量门禁及固定镜像真实 HTTP/Keycloak smoke 已再次通过。Community SDK 首切片此后已由 `MCP-F2-CONTRACTS-002` 交付并验收（见上 SDK 分栏与兼容矩阵）；正式审核（Q-009 本地人工决议落地）、目标对象存储、备份恢复与完整 F2/F4 首发仍是独立门槛。

## Community `0.1.0-alpha.3` 兼容分类

本版本是在 `0.1.0-alpha.2` 之上的**预发布兼容新增（匿名内联预览）**：按所有者 2026-10-12 官网门户派工（prep 包 05 §GAP-1 方案），新增 `GET /v1/resources/{resourceId}/versions/{versionId}/preview`（operationId `previewResourceVersion`，匿名，无请求体）。逐请求可见性检查与 download 完全一致（未知/失配/未发布/已清理一律 404 不区分），流式返回与 download 相同的封存校验 PNG 字节；响应头语义为 Content-Type image/png、Content-Disposition inline、X-Content-Type-Options nosniff、sandbox CSP 与 Cache-Control no-store——保守默认锁定 no-store，有界私有缓存（如 `private, max-age≤60`）须所有者另行确认并复核 ADR-0014 下架传播窗口后才可放宽。公开页面可将其用作 `<img>` 直链而不暴露任何长期公开对象 URL。版本作用域与 download 对称：字节不可变、网格可用 `current_version_id` 组 URL、不新增"当前版本别名"语义。既有 10 操作、scope 与 Schema 零变化；ResourceFile `role=preview` 保持 schema-only（生产者是否填充由后续门户切片决定）。validate_contracts.py 机器锁定 alpha.3：11 操作集合、preview 匿名/无体/PNG-only/有界错误面，以及本分类段的 docs 门槛。生产者尚无实现（属后续门户工作流 `MCP-F2-COMMUNITY-002`），Community SDK 不暴露 `previewResourceVersion`（无 producer 证据，类型基线已随 alpha.3 重生成）。发布顺序为 Contracts alpha.3 锁 → 门户切片内 Community 生产者实现 → 真实门户消费者集成。回退时生产者可回到仅实现 alpha.2 的状态；不得保留一个与本契约语义不一致的预览表面。

## Community `0.1.0-alpha.4` 兼容分类

在 alpha.3 上预发布兼容新增（本地人工审核），按 Foundation ADR-0016 新增 `moderation:review` + `profile:read` 的 `reviewResourceVersion`，POST 指定不可变候选，闭合 approve/reject 与可选原因，必填幂等键，200 Resource。身份 realm 仅将审核 scope 授予指定用户，作者不能以请求 scope 自授权。404 未知/失配，409 非当前待审/已决定/终态，503 禁用/依赖故障保持待审；单人批准、拒绝替换保留旧版、事务审计/outbox。不扩展私有读取权限或队列。原十一操作及 Core/Skin 文件不变。部署顺序：本契约锁 → Community producer 与实际身份/并发/故障验证 → SDK → 消费者；SDK 仍只暴露已有证据的十操作，preview/review 待 producer 后开放。回退关闭审核模式，已有发布/决定不可被反转；不以回退删库。

## Community alpha.4 producer / SDK 本地组合

MCP-F2-COMMUNITY-002：Contracts 锁 f52859c → Community producer c1cdab0（alpha.4，12 操作）→ Community SDK alpha.4。Producer 实跑13单元、3契约、40集成（真实 PostgreSQL/S3、Keycloak26.8 S256 PKCE 的 realm role 限制、并发决定、替换拒绝、下架/旧租约隔离、存储故障及审计失败全事务回滚）。SDK 40 单元、严格静态/build/pack 干净消费者全部通过；对固定镜像 mc-plan-community:mcp-f2-community-002-c1cdab0、独立 Core/DB/S3/本地 JWKS 的真实 HTTP smoke 通过，十二方法含授权 review 与匿名 preview；全部合成内容通过真实审核 API，不再 SQL 放行。Core SDK 37测试、pack与真实HTTP/Keycloak smoke回归通过，Core/Skin公共契约未变。SDK使用本地JWKS与producer真实Keycloak证据分开记录；SDK包仍private，本地pack，真实产品消费者/稳定发行/生产部署与完整F2/F4不在此证据范围。

## Core `0.1.0-alpha.8` 兼容分类

在alpha.7上预发布兼容新增（官方Community OAuth委托），依据Foundation ADR0017：DeveloperApp既有创建/批准端点的可委托目录增加已锁resource:read/resource:write/upload:write，仍限制在当前调用者scope上限；获准这些scope时才加入Community audience，收窄后删除该audience辅助scope，realm核对检查全部必需辅助scope。PAT六项目录/最长30天/服务scope隔离不变；moderation:review仅realm指定审核员，不进入App/PAT委托。原字段与操作形状保持，使用x-mc-plan-delegatable-scopes机器固定有效目录，无新scope名、API或migration。新授权受收窄/撤销，既有离线JWT需到期，不能声称即时反向修改。发布顺序：契约锁→Core producer与新镜像→CoreSDK类型/17操作回归→真实登记PKCE客户端访问Community→Ops。Communityalpha.4与Skin alpha.1表面不变；Community契约来源Corealpha.7元数据升级由独立消费者切片处理。

## Core alpha.8 producer / SDK / 官方 Community OAuth 消费者组合

MCP-F2-CORE-001：Contracts ebb00a6 → Core fb1bc07及固定镜像mc-plan-core:mcp-f2-core-001-fb1bc07（sha256:2c9ee8fba75c79dbdabe904533bfe60bca340eb8e0fddb7d5b346b74fa389867）→ CoreSDKalpha.8（仍17方法）。121单元+86HTTP E2E+25契约+74真实PG/Keycloak集成=306，8既有迁移及strict/build全通过。CoreSDK37测试/生成零漂移/干净pack与新镜像真实HTTP+Keycloak通过，CommunitySDK40测试/pack/真实HTTP回归过。Ops415a108独立真实消费证据：Core登记public客户端→真实S256 PKCE→双audience同Core业务ID→Communityalpha.4运行镜像签名PUT/完成封存/版本/202待审→指定realm审核员真实review API决定→同哈希preview/作者下架404；普通请求审核scope不能自授权，新授权收窄/撤销拒绝，非root/DB故障拒绝通过。只有合成角色夹具使用SQL，publication无SQL旁路；测试内容/许可/S3rver限定保留。旧客户端生命周期脚本对新镜像回归通过。Community运行API消费组合兼容，源码生成锁从Corealpha.7升级是后续独立消费者切片，未冒称其源码已同步。无稳定发布/生产部署/完整F2/F4完成。

## Communityalpha.4 → Corealpha.8 来源与运行闭环

MCP-F2-COMMUNITY-003将producer的Core来源从alpha.7升级alpha.8（联合API源snapshot481cc85，11哈希重算、类型再生成零漂移）。Community d482331、镜像mc-plan-community:mcp-f2-community-003-d482331（sha256:116a9003526d0fd758e2fae2bd14d2a338ee23c6207bec077854ff4482ee3e5f）→ Core镜像mc-plan-core:mcp-f2-core-001-fb1bc07；56项producer/严格检查、真实Keycloak与两模式runtime全过。CommunitySDKalpha.4十二方法，producer锚d482331，40项/生成/pack/两新镜像真实HTTP通过。CoreSDKalpha.8生成零漂移及前一工作流真实HTTP/Keycloak证据保留。原Community/Skin契约无变化；此前“来源锁待独立升级”门槛已由该切片关闭。未宣称完整F2/F4或生产对象/恢复验收。

## Core `0.1.0-alpha.9` 兼容分类

本版本是在 `0.1.0-alpha.8` 之上的**预发布兼容新增（管理员只读查询面）**：按 Foundation [ADR-0018](../../mc-plan-foundation/decisions/0018-admin-console-authorization-model.md)（所有者 2026-10-13 管理员后台派工 + 四项同日实答）新增六个严格只读管理操作——`GET /v1/admin/users`（`listAdminUsers`，用户目录游标分页 newest-first）、`GET /v1/admin/users/{userId}`（`getAdminUser`，含非负 `credit_balance` 与身份链接/开发者应用/PAT 计数；未知/畸形标识一律 404 不泄露存在性）、`GET /v1/admin/users/{userId}/credit-ledger`（`listAdminCreditLedger`，条目=锁定 CreditLedgerEntry 字段 + 管理员专用扩展 `reason`/`actor_id`，落实"人工调整必须记录管理员原因"的审计规则）、`GET /v1/admin/users/{userId}/entitlement-records`（`listAdminEntitlementRecords`，物化 DailyEntitlement 行含 module/operation/policy_date/granted/consumed）、`GET /v1/admin/audit`（`listAdminAuditRecords`，可选 `user_id` uuid 过滤；metadata 为按动作原样记录的对象）、`GET /v1/admin/outbox`（`listAdminOutboxRecords`，可选 `state` 枚举过滤，暴露投递位次/尝试计数/512 上界 last_error）。全部操作仅声明 userOAuth+新 scope `admin:read` 凭证面：机器校验锁定 PAT 授予目录不含 `admin:read`（运行时 `UNKNOWN_SCOPE`，同 profile:write 先例）、serviceOAuth 不得声明、Developer App 可委托目录不含；生产者授权=令牌 scope + ADMIN 业务角色 + ACTIVE 状态三者同时满足（MFA 按 identity-and-access 既有要求为 realm 侧职责）。游标分页统一 limit 1..100 默认 20、PageCursor 1..512，未知/畸形游标 400 `VALIDATION_FAILED`；全部 Schema 字段封闭且不暴露身份邮箱、OIDC subject、issuer、令牌哈希或明文。零新公共错误码、零迁移；管理写操作（人工积分调整/退款暴露、PAT 撤销、应用撤销、用户状态变更）显式不在本版本，须逐项所有者决策+审计设计后另开契约；Community 待审队列/双人复核/申诉仍按 Q-010 门槛。`0.1.0-alpha.8` 已锁定的全部表面保持字节兼容。

发布顺序为 Contracts `0.1.0-alpha.9` 锁 → Core 生产者与契约测试（`MCP-F4-CORE-001` 已关闭，最终树 `06de705`）→ Ops realm 指定管理员配置与真实验收 → `apps/admin` 管理台 → SDK 暴露（`MCP-F4-CONTRACTS-001` 已完成）。SDK 类型基线随 alpha.9 重生成；六个管理操作已以 `MCP-F4-CORE-001` 的 producer 证据暴露进 SDK 支持操作清单（支持操作 17→23，producer 锚定 Core `06de705`，`SUPPORTED_CONTRACT_FILES` 补齐 11 个 admin 字段封闭 Schema 后为 23 项）。回退时生产者可回到仅实现 `0.1.0-alpha.8` 的状态；不得保留一个与本契约语义不一致的管理员查询表面。
