# 验证说明

当前阶段至少执行：

1. 所有 `.json` 文件可解析。
2. 所有 Schema 声明 Draft 2020-12，`$id` 唯一，内部 `$ref` 可解析。
3. 所有 OpenAPI 文件可解析为 YAML，版本为 3.1.x，operationId 唯一。
4. OpenAPI 的本地 `$ref` 指向存在的文件。
5. 事件名称与文件名都包含主版本。
6. 契约内不得出现真实域名、密钥或服务数据库字段。

安装隔离的验证依赖后运行仓库自带检查：

```powershell
python -m pip install -r requirements-validation.txt
python scripts/validate_contracts.py
pnpm --package=@redocly/cli dlx redocly lint "openapi/*.yaml"
```

`validate_contracts.py` 只读取文件，不生成产物；它校验 JSON Schema 元语法、唯一 `$id`、本地引用、事件命名、OpenAPI 版本路径、operationId 和显式 4xx 响应。Redocly 执行完整 OpenAPI 推荐规则检查。命令显式选择 `redocly` binary，因为当前 `@redocly/cli` 同时发布 `redocly` 与 `openapi`，直接 `pnpm dlx @redocly/cli` 无法可靠选择入口。

引入 Node 工具链后在 CI 使用 Redocly 或 Spectral 校验 OpenAPI、AJV 校验 JSON Schema，并对 SDK 生成结果执行差异检查。当前仓库不为验证工具提前生成业务工程。

## SDK 工程校验（`sdk/typescript`，MCP-F1-CONTRACTS-001 起）

SDK 包的全部验收命令见 `docs/development-plan.md`（format:check / lint / typecheck / generate:check / test / build / pack:check / smoke:real）。要点：

- `generate:check` 用 openapi-typescript 从 `openapi/core.yaml` 重跑生成并要求 `src/generated` 零漂移；契约文件任何变更未同步再生成即失败。
- 单元测试按真实文件复算 `SUPPORTED_CONTRACT_FILES` 的 sha256（来源 hash 防漂移），并覆盖 transport 超时/abort/有界重试（重试不换 Idempotency-Key、非幂等操作不重试、4xx 不重试）与 Problem 解析。
- `pack:check` 在系统临时目录创建干净工程，从本地 tarball 离线安装并以严格 tsc 编译引用样本；不发布任何注册表。
- `smoke:real` 仅依赖本地固定 producer 镜像与隔离 PostgreSQL（会话唯一命名，finally 清理自己的容器/网络/卷），是真实 HTTP 验收，不得以 mock transport 替代。
