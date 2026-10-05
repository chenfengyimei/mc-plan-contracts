# Contracts 开发计划

状态：Active

当前里程碑：F1 Core `0.1.0-alpha.4` 积分只读余额预发布契约；不可变积分账本生产者（Core）由 `MCP-F1-CORE-005` 实现进行中；SDK 与消费者按后续工作流推进。

## 固定顺序

1. 从 Foundation/ADR 和数据所有者确认产品语义，拒绝推测性字段。
2. 标记变更为兼容或破坏性，列出生产者、SDK、消费者和部署顺序。
3. 先修改 OpenAPI、JSON Schema、事件、scope、错误码和示例。
4. 运行结构、语义和引用校验，发布或锁定预发布版本。
5. 生产者实现通过契约测试后生成/更新 TypeScript SDK。
6. 消费者集成验证后更新兼容矩阵；至少一个真实实现通过后才发布稳定版本。

## 辅助仓库

- 主仓库为 Contracts 时，最多把当前契约的数据所有者和一个直接消费者声明为可写辅助仓库。
- 实现工作流中 Contracts 可以作为辅助仓库，但契约提交和预发布版本必须先于实现提交。
- Foundation 只读用于确认决策；未决定的语义返回 Foundation，而不是在 Schema 中发明。

## 验收命令

```powershell
python scripts/validate_contracts.py
pnpm --package=@redocly/cli dlx redocly lint "openapi/*.yaml"
pwsh -File ..\mc-plan-foundation\scripts\validate-coordination.ps1 `
  -TrackingId <ID> -Phase Continue
```

引入 SDK 工程后再增加生成差异、类型检查、单元测试和消费者契约测试；命令必须写回本文件与 `AGENTS.md`。

## 完成条件

- 所有权、兼容分类、版本、迁移与发布顺序明确。
- OpenAPI/Schema/事件可机器验证且不存在重复类型。
- 兼容矩阵只登记实际通过的生产者、SDK 和消费者组合。
- 破坏性变化具有新主版本或明确迁移窗口与回退方案。

## 不得提前实现

不得加入服务业务逻辑、Prisma 模型、私有数据库字段、真实生产域名、未决定的社交/审核字段或未经真实需求证明的 Python SDK。
