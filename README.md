# MC Plan Contracts

MC Plan 公共接口的机器可验证真相仓库。它保存 OpenAPI 3.1、JSON Schema、版本化事件、兼容性矩阵和 SDK 发布规范，不包含服务业务实现或私有数据库模型。

## 目录

- `openapi/`：Core、Community、Skin 的公共 HTTP API 骨架。
- `schemas/`：跨接口复用的数据 Schema，按所有权域组织。
- `events/`：跨服务事件 Schema。
- `docs/`：接口目录、兼容与 SDK 规则、当前状态。
- `sdk/typescript/`：未来生成 TypeScript SDK 的发布边界；当前仅有说明。

## 变更流程

1. 先说明产品语义、所有者和兼容等级。
2. 修改契约和示例并通过校验。
3. 发布预发布版本供生产者、SDK 和消费者实现。
4. 至少一个实现通过契约测试后再发布稳定版本。

未知业务字段必须保留为待决事项，不能为了“完整”而伪造。

## 验证

基础结构由 Foundation 的 `scripts/validate-workspace.ps1` 检查。OpenAPI 使用 Redocly CLI 校验；建议命令：

```powershell
pnpm dlx @redocly/cli lint openapi/*.yaml
```

## 许可

本仓库采用 [Apache-2.0](LICENSE) 许可。
