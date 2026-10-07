# Contracts 开发计划

状态：Active

当前里程碑：F1 Core `0.1.0-alpha.5` 服务事件投递契约（ADR-0011 消费者拉取，`MCP-F1-CONTRACTS-002`）已锁定；`0.1.0-alpha.4` 积分只读余额预发布契约与不可变积分账本生产者（Core `5508d60`，`MCP-F1-CORE-005`）已验证；首个 TypeScript SDK 切片（`@mc-plan/core-sdk`，12 个已验收操作，`MCP-F1-CONTRACTS-001`）已实现并对固定镜像完成真实 HTTP 验收；事件投递面生产者（预计 `MCP-F1-CORE-008`）与消费者按后续工作流推进；Skin `0.1.0-alpha.1`（ADR-0012 匿名窗口五缺口，`MCP-F1-CONTRACTS-003`）已锁定，Skin 产线生产者在 Q-001 决策后跟进。

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

SDK 工程（`sdk/typescript`，`MCP-F1-CONTRACTS-001` 引入后追加）：

```sh
pnpm --dir sdk/typescript format:check
pnpm --dir sdk/typescript lint
pnpm --dir sdk/typescript typecheck
pnpm --dir sdk/typescript generate:check   # openapi-typescript 重跑，src/generated diff 必须为空
pnpm --dir sdk/typescript test
pnpm --dir sdk/typescript build
pnpm --dir sdk/typescript pack:check       # pnpm pack + 干净临时工程消费验证
pnpm --dir sdk/typescript smoke:real       # 固定 producer 镜像 + 隔离 PostgreSQL 的真实 HTTP 验收
```

引入 SDK 工程后再增加生成差异、类型检查、单元测试和消费者契约测试；命令必须写回本文件与 `AGENTS.md`。

## 完成条件

- 所有权、兼容分类、版本、迁移与发布顺序明确。
- OpenAPI/Schema/事件可机器验证且不存在重复类型。
- 兼容矩阵只登记实际通过的生产者、SDK 和消费者组合。
- 破坏性变化具有新主版本或明确迁移窗口与回退方案。

## 不得提前实现

不得加入服务业务逻辑、Prisma 模型、私有数据库字段、真实生产域名、未决定的社交/审核字段或未经真实需求证明的 Python SDK。
