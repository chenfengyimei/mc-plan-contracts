# API 目录

## Core v1

`0.1.0-alpha.1` 已锁定 `GET /v1/me`：使用 `profile:read`，成功响应只包含 PublicActor；认证失败返回 `AUTHENTICATION_REQUIRED`，scope 不足或业务账号不可用分别返回 `INSUFFICIENT_SCOPE`、不泄露具体状态的 `ACCOUNT_UNAVAILABLE`。

仍为后续 F1 骨架：公开资料、每日权益、幂等积分消费。

后续 F1 决定：开发者应用管理、PAT 生命周期、角色管理、签到和贡献奖励管理。未决字段不得先写入稳定契约。

## Community v1

已建立骨架：上传会话、资源创建/列表/详情/下架、资源版本、发布。

后续 F2/F4 分批决定：标签、搜索、点赞、收藏、评论、关注、信息流、排行、通知、举报、处置与申诉。每批先明确状态机和权限，再扩展 OpenAPI。

## Skin v1

已建立骨架：创作会话、候选渲染、确认成品、任务状态。

后续 F3 决定：结构化意图字段、模型能力发现、候选反馈、Standalone 管理配置。提供商特有字段不能进入公共契约。
