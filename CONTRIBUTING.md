# 贡献指南

公共契约变更会影响独立服务和第三方客户端，必须先说明所有者、语义和兼容等级。

- 先修改 Schema/OpenAPI/事件和兼容说明，再修改服务实现。
- 不增加未经产品或 ADR 确认的字段。
- ID 保持不透明，写操作定义幂等语义，OAuth 操作声明最小 scope。
- 使用短期分支、Conventional Commits 和 PR。
- PR 列出生产者、SDK、消费者、部署顺序和回退方式。

验证要求见 `docs/validation.md`。
