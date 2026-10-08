# API 目录

## Core v1

`0.1.0-alpha.6` 已锁定：`GET /v1/me`（`profile:read`，OIDC 或 PAT）、Developer App 生命周期（`developer-apps:read/manage`）、PAT 生命周期（`pat:read/manage`，PAT 默认最长 30 天）、`GET /v1/entitlements`（`credits:read`，OIDC 或 PAT，返回当日 Asia/Shanghai 权益视图且不消费额度）、`GET /v1/credits/balance`（`credits:read`，OIDC 或 PAT，返回非负整数余额；无账户的已存在 ACTIVE 用户读取为零且不建账户；严格只读，不产生账户、账本、审计或 outbox 副作用）、`POST /v1/credits/consume`（服务间 `credits:consume`，Idempotency-Key 幂等，仅 `daily_entitlement` 来源，稳定返回 `IDEMPOTENCY_KEY_CONFLICT` 与 `ENTITLEMENT_EXHAUSTED`），ADR-0011 消费者拉取事件投递面：`GET /v1/events`（`listDeliveredEvents`，服务专用 `events:consume`，游标分页返回该消费者最旧未确认事件与 `next_cursor`，at-least-once，消费者按 `event_id` 幂等去重）与 `POST /v1/events/acknowledgments`（`acknowledgeEvents`，游标显式确认且幂等，未知/畸形游标 400；生产者已由 `MCP-F1-CORE-008` 验收、SDK 已暴露），以及 W02 第一阶段公开资料表面：`GET /v1/users/{userId}`（`getPublicUser`，prerelease，无认证公开面，仅 ACTIVE 账号，未知/畸形/非 ACTIVE 一律 404 不泄露存在性）与 `PATCH /v1/me`（`updateCurrentUser`，prerelease，唯一可编辑字段 display_name 1..80，新 `profile:write` scope 仅供 OIDC 用户令牌——PAT 授予目录不含该 scope，机器校验锁定 PAT 永不可获得）。公开资料两操作生产者实现中（`MCP-F1-CORE-009`），SDK 在其关闭前不暴露。

仍为后续 F1 骨架：积分账本的公共消费（credits 来源消费，Q-013 待决）。

后续 F1 决定：角色管理、签到和贡献奖励管理、免费额度耗尽后的积分回退编排。未决字段不得先写入稳定契约。Core 内部不可变积分账本原语（grant/consume/refund/adjustment、幂等命令、余额核对）属服务内部实现，不经公共接口暴露。

## Community v1

已建立骨架：上传会话、资源创建/列表/详情/下架、资源版本、发布。

后续 F2/F4 分批决定：标签、搜索、点赞、收藏、评论、关注、信息流、排行、通知、举报、处置与申诉。每批先明确状态机和权限，再扩展 OpenAPI。

## Skin v1

`0.1.0-alpha.1` 已锁定（ADR-0012 匿名窗口语义）：既有四操作（创作会话、候选渲染、确认成品、任务状态）保持形状，新增 `GET /v1/conversations/{conversationId}`（会话详情含消息历史）、`DELETE /v1/conversations/{conversationId}`（级联候选与字节的会话删除）、`GET /v1/conversations/{conversationId}/candidates/{candidateId}/preview`（64x64 候选 PNG 字节）与 `GET /v1/conversations/{conversationId}/skins/{resourceId}/download`（成品 PNG 字节）。全部操作按 ADR-0012 匿名窗口语义：不可猜测 128-bit UUID 寻址、30d 会话/24h 候选保留期、无凭据对象模型（userOAuth 保留为 Official 模式文档性方案）；生产者实现属后续 Skin 线切片。

后续 F3 决定：结构化意图字段、模型能力发现、候选反馈、Standalone 管理配置。提供商特有字段不能进入公共契约。
