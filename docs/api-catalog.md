# API 目录

## Core v1

`0.1.0-alpha.3` 已锁定：`GET /v1/me`（`profile:read`，OIDC 或 PAT）、Developer App 生命周期（`developer-apps:read/manage`）、PAT 生命周期（`pat:read/manage`，PAT 默认最长 30 天）、`GET /v1/entitlements`（`credits:read`，OIDC 或 PAT，返回当日 Asia/Shanghai 权益视图且不消费额度）与 `POST /v1/credits/consume`（服务间 `credits:consume`，Idempotency-Key 幂等，仅 `daily_entitlement` 来源，稳定返回 `IDEMPOTENCY_KEY_CONFLICT` 与 `ENTITLEMENT_EXHAUSTED`）。

仍为后续 F1 骨架：公开资料按 userId 读取、积分账本（credits 来源消费）。

后续 F1 决定：角色管理、签到和贡献奖励管理、免费额度耗尽后的积分回退编排。未决字段不得先写入稳定契约。

## Community v1

已建立骨架：上传会话、资源创建/列表/详情/下架、资源版本、发布。

后续 F2/F4 分批决定：标签、搜索、点赞、收藏、评论、关注、信息流、排行、通知、举报、处置与申诉。每批先明确状态机和权限，再扩展 OpenAPI。

## Skin v1

已建立骨架：创作会话、候选渲染、确认成品、任务状态。

后续 F3 决定：结构化意图字段、模型能力发现、候选反馈、Standalone 管理配置。提供商特有字段不能进入公共契约。
