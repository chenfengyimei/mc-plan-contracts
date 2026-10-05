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
| Core `0.1.0-alpha.4` | 预发布；只读余额与积分账本切片生产者已实现并验证 | `5508d60`：11 项契约、57 项 HTTP E2E、31 项 PostgreSQL 集成通过（含不可变账本并发/幂等/退款/权限/迁移与整数边界证据）；锁提交 `9a85b98` | 不适用 | 不适用 | 未生成 |

## Core 0.1.0-alpha.1 兼容分类

本版本是从未发布、未实现的 `0.1.0-draft` 锁定首个生产者切片，分类为**预发布兼容收敛**：保留既有 `GET /v1/me`、`profile:read` 和 `PublicActor` 字段，仅补充明确的 `401 AUTHENTICATION_REQUIRED` 以及 `403 INSUFFICIENT_SCOPE` / `ACCOUNT_UNAVAILABLE` 语义，并保证 `403` 不泄露具体业务账号状态。尚未锁定的 Core 路径仍是后续 F1 实现目标，不据此宣称生产者已经支持。

发布顺序为 Contracts `0.1.0-alpha.1` → Core 生产者与契约测试 → Ops Keycloak/Core 集成 → 后续 TypeScript SDK 与消费者工作流。回退时生产者可回到尚无公共业务接口的 Core 第一工程切片；不得保留一个与本契约字段不一致的 `/v1/me`。

`MCP-F1-CORE-002` 已验证 Contracts `f9ad077`、Core `30382fd` 与 Ops `666565b` 的组合：Core 锁定文件及 PublicActor Schema 契约测试通过，并由真实 Keycloak Authorization Code + PKCE S256 令牌完成 `/v1/me` 验收。该组合不代表 SDK、Community 或 Skin 已成为消费者。

矩阵只记录已验证组合，不把“计划支持”写成已支持。
