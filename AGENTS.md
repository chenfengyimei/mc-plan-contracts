# MC Plan Contracts Agent Guide

本仓库是公共 API、Schema、事件和 SDK 表面的唯一真相。

变更前必须：

1. 阅读 `docs/architecture.md`、`docs/compatibility.md` 和相关 OpenAPI/Schema。
2. 确认数据所有者与产品语义已经在 Foundation 或 ADR 中决定。
3. 分类兼容或破坏性变化，并列出生产者、SDK、消费者和部署顺序。

不得加入服务业务逻辑、Prisma 模型、真实生产域名、密钥或推测性字段。公共类型不得在服务仓库手写复制。

提交前运行 `docs/validation.md` 中的校验，并更新兼容性矩阵或状态页。
