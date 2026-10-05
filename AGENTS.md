# MC Plan Contracts Agent Guide

本仓库是公共 API、Schema、事件和 SDK 表面的唯一真相。

任何写操作前必须使用 `$mc-plan-development`，确认本仓库是活动工作流的唯一主仓库或可写辅助仓库，并从工作区根目录运行协调预检。没有 Tracking ID、活动记录或通过的预检时不得编辑。

变更前必须：

1. 阅读 `docs/architecture.md`、`docs/compatibility.md` 和相关 OpenAPI/Schema。
2. 确认数据所有者与产品语义已经在 Foundation 或 ADR 中决定。
3. 分类兼容或破坏性变化，并列出生产者、SDK、消费者和部署顺序。

不得加入服务业务逻辑、Prisma 模型、真实生产域名、密钥或推测性字段。公共类型不得在服务仓库手写复制。

`sdk/typescript` 是从本仓库锁定 OpenAPI/Schema 生成的唯一官方 SDK 工程（`@mc-plan/core-sdk`，private，仅本地 pack 消费，不发布 npm）。任何契约文件变更必须同步重跑 `pnpm --dir sdk/typescript generate:check`（生成产物零漂移）并使该包全部验收命令通过；SDK 不得暴露无 producer 证据的操作。

提交前运行 `docs/development-plan.md` 和 `docs/validation.md` 中的校验，并仅在实际兼容组合或里程碑变化时更新矩阵/状态页。
