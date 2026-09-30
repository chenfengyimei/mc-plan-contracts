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
pnpm dlx @redocly/cli lint "openapi/*.yaml"
```

`validate_contracts.py` 只读取文件，不生成产物；它校验 JSON Schema 元语法、唯一 `$id`、本地引用、事件命名、OpenAPI 版本路径、operationId 和显式 4xx 响应。Redocly 执行完整 OpenAPI 推荐规则检查。

引入 Node 工具链后在 CI 使用 Redocly 或 Spectral 校验 OpenAPI、AJV 校验 JSON Schema，并对 SDK 生成结果执行差异检查。当前仓库不为验证工具提前生成业务工程。
