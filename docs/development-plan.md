# Contracts 开发计划

状态：Active

当前里程碑：F1 Core `0.1.0-alpha.5` 服务事件投递契约（ADR-0011 消费者拉取，`MCP-F1-CONTRACTS-002`）已锁定；`0.1.0-alpha.4` 积分只读余额预发布契约与不可变积分账本生产者（Core `5508d60`，`MCP-F1-CORE-005`）已验证；首个 TypeScript SDK 切片（`@mc-plan/core-sdk`，12 个已验收操作，`MCP-F1-CONTRACTS-001`）已实现并对固定镜像完成真实 HTTP 验收；事件投递面生产者已由 `MCP-F1-CORE-008`（Core `87ddd66`）关闭，`MCP-F1-CONTRACTS-004` 已把事件两操作暴露进 SDK（14 个 producer 已验证操作，producer 锚定 `87ddd66`，pack 干净工程消费与固定镜像真实 HTTP smoke 通过）；Skin/Community 消费者按后续工作流推进；Skin `0.1.0-alpha.1`（ADR-0012 匿名窗口五缺口，`MCP-F1-CONTRACTS-003`）已锁定，Skin 产线生产者在 Q-001 决策后跟进；Community `0.1.0-alpha.2`（ADR-0014）已锁定且 producer 已由 `MCP-F2-COMMUNITY-001` 验收（community `70e55a1` + 固定镜像 `mcp-f2-community-001-779803e`），首个 Community TypeScript SDK（`sdk/community`，`@mc-plan/community-sdk@0.1.0-alpha.2`，10 个 producer 已验证操作，`MCP-F2-CONTRACTS-002`）已交付并完成固定镜像真实 HTTP 验收；管理员只读六操作已由 `MCP-F4-CONTRACTS-001` 以 `MCP-F4-CORE-001` 的 producer 证据暴露进 Core SDK（支持操作 17→23，producer 锚定 Core `06de705`，`SUPPORTED_CONTRACT_FILES` 补齐 11 个 admin Schema 后 23 项，固定镜像真实 HTTP smoke 通过）；首个 Skin SDK（`sdk/skin`，`@mc-plan/skin-sdk@0.1.0-alpha.1`，8 个 producer 已验证操作，`MCP-F1-CONTRACTS-007`）已交付并对生产者树（skin `14a8fe3` + 确定性 Fake Provider + 手工隔离 PostgreSQL/Redis）完成真实 HTTP 验收。

## 固定顺序

2026-10-12 F2：按 Foundation ADR-0014 锁定 Community `0.1.0-alpha.2`（alpha.1 之后显式补齐 Core profile:read 身份依赖），从尚无实现的 draft 收敛上传完成、作者查询和受控下载及既有资源七操作的可执行语义；不新增 F4 scope，不替所有者决定审核提供商/正式许可。Community producer 已验收（`MCP-F2-COMMUNITY-001`，community `70e55a1`），Community SDK 已由 `MCP-F2-CONTRACTS-002` 交付；`MCP-F2-CONTRACTS-003` 已按所有者门户裁决锁定 `0.1.0-alpha.3` 匿名内联预览（官网 P3 前置，生产者实现属后续门户工作流）；真实消费者证据仍按固定顺序后置，Core alpha.7/Skin alpha.1 不变。

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

Community SDK 工程（`sdk/community`，`MCP-F2-CONTRACTS-002` 引入后追加，命令与 Core SDK 同构）：

```sh
pnpm --dir sdk/community format:check
pnpm --dir sdk/community lint
pnpm --dir sdk/community typecheck
pnpm --dir sdk/community generate:check   # openapi-typescript 重跑，src/generated diff 必须为空
pnpm --dir sdk/community test
pnpm --dir sdk/community build
pnpm --dir sdk/community pack:check       # pnpm pack + 干净临时工程消费验证
pnpm --dir sdk/community smoke:real       # 固定 community 镜像 + 独立 Core 镜像 + 隔离 PostgreSQL/S3 协议服务的真实 HTTP 验收
```

Skin SDK 工程（`sdk/skin`，`MCP-F1-CONTRACTS-007` 引入后追加，命令与 Core SDK 同构）：

```sh
pnpm --dir sdk/skin format:check
pnpm --dir sdk/skin lint
pnpm --dir sdk/skin typecheck
pnpm --dir sdk/skin generate:check   # openapi-typescript 重跑，src/generated diff 必须为空
pnpm --dir sdk/skin test
pnpm --dir sdk/skin build
pnpm --dir sdk/skin pack:check       # pnpm pack + 干净临时工程消费验证
pnpm --dir sdk/skin smoke:real       # 生产者树（skin main）+ 手工隔离 PostgreSQL/Redis 容器 + 确定性 Fake Provider 的真实 HTTP 验收
```

引入 SDK 工程后再增加生成差异、类型检查、单元测试和消费者契约测试；命令必须写回本文件与 `AGENTS.md`。

## 完成条件

- 所有权、兼容分类、版本、迁移与发布顺序明确。
- OpenAPI/Schema/事件可机器验证且不存在重复类型。
- 兼容矩阵只登记实际通过的生产者、SDK 和消费者组合。
- 破坏性变化具有新主版本或明确迁移窗口与回退方案。

## 不得提前实现

不得加入服务业务逻辑、Prisma 模型、私有数据库字段、真实生产域名、未决定的社交/审核字段或未经真实需求证明的 Python SDK。
