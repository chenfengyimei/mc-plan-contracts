# @mc-plan/core-sdk

已验收 Core 公共 API 的官方 TypeScript 客户端（`0.1.0-alpha.4`）。

- **来源**：类型由 `openapi-typescript` 从本仓库锁定的 `openapi/core.yaml`（0.1.0-alpha.4，锁提交 `9a85b98`）确定性生成；`SUPPORTED_CONTRACT_FILES` 内嵌生成输入文件的 sha256，`pnpm test` 会按真实文件复算，任何契约漂移都会失败。`pnpm generate:check` 重跑生成并要求 `git diff` 为空。
- **支持面**：仅 `SUPPORTED_OPERATIONS` 列出的 12 个有 producer 证据的操作（mc-plan-core `5508d60`，MCP-F1-CORE-005 验收）。`getPublicUser`、credits 来源消费/退款/管理与 Skin/Community draft 表面不提供可调用方法。
- **认证边界**：`getUserToken`（浏览器 PKCE OIDC access token 或 PAT）与 `getServiceToken`（client-credentials，`credits:consume`）均为注入式提供器；SDK 不获取、不保存、不刷新任何凭据或 secret，不接管密码。
- **传输**：注入 `fetch` 实现与 `baseUrl`（必填，无默认值）；`AbortSignal` 与可配置超时（默认 10 秒）；有界重试仅限 GET 与契约幂等的 `consumeCredits`（默认 ≤2 次，硬上限 4；5xx/网络错误；**重试不换 Idempotency-Key**）；`consumeCredits` 的 200（重放）与 201（首次成功）都成功，用 `replayed` 区分。
- **错误**：`application/problem+json` 解析为 `McPlanProblemError`（`problem.code` 含已锁定的稳定错误码联合类型、`trace_id`、可选 `errors[]`）；非 Problem 形状的错误响应抛 `McPlanUnexpectedResponseError`。
- **分页**：Core 表面无分页协议；列表响应按契约 `{ items }` 类型化，SDK 不发明游标。
- **版本与发布**：版本随契约预发布（`0.1.0-alpha.4`）；本包 private，仅经 `pnpm pack` 本地消费，不发布 npm、不设稳定版本；已验证组合记录在 `docs/compatibility.md`（producer 验收与 SDK/consumer 验收分栏）。

## 使用

```ts
import { createMcPlanCoreClient } from '@mc-plan/core-sdk';

const client = createMcPlanCoreClient({
  baseUrl: 'https://core.example.com',
  getUserToken: async () => oidcAccessToken, // PKCE flow owned by the app
  getServiceToken: async () => serviceToken, // client-credentials token
});

const me = await client.getCurrentUser();
const balance = await client.getCreditBalance();
const call = await client.consumeCredits(
  {
    user_id: me.user_id,
    module: 'skin',
    operation: 'creation_session',
    units: 1,
    reference_id: orderRef,
  },
  idempotencyKey, // keep stable across retries of the same logical command
);
if (call.replayed) {
  // producer answered 200: recorded idempotent replay
}
```

## 本包验收命令（见仓库 docs/development-plan.md）

```sh
pnpm --dir sdk/typescript format:check
pnpm --dir sdk/typescript lint
pnpm --dir sdk/typescript typecheck
pnpm --dir sdk/typescript generate:check
pnpm --dir sdk/typescript test
pnpm --dir sdk/typescript build
pnpm --dir sdk/typescript pack:check
pnpm --dir sdk/typescript smoke:real   # 固定镜像 + 隔离 PostgreSQL 的真实 HTTP 验收
```

Python SDK 在出现明确第三方需求前不启动（见 `docs/sdk.md`）。
