# @mc-plan/community-sdk

已验收 Community 公共 API 的官方 TypeScript 客户端（`0.1.0-alpha.4`）。

- **来源**：类型由 `openapi-typescript` 从本仓库锁定的 `openapi/community.yaml`（0.1.0-alpha.4，锁提交 `664fb9d`）确定性生成；`SUPPORTED_CONTRACT_FILES` 内嵌生成输入文件的 sha256，`pnpm test` 会按真实文件复算，任何契约漂移都会失败。`pnpm generate:check` 重跑生成并要求 `git diff` 为空。
- **支持面**：全部 12 个已验收 alpha.4 操作，producer `c1cdab0`（MCP-F2-COMMUNITY-002），包含匿名 previewResourceVersion 与授权 reviewResourceVersion；不暴露未来 F4 操作。
- **认证边界**：`getUserToken`（浏览器 PKCE OIDC access token，携带目标操作 scope + `profile:read`，且须同时被 `mc-plan-core` 与 `mc-plan-community` 双 audience 接受——alpha.2 锁定语义）为注入式提供器；SDK 不获取、不保存、不刷新任何凭据，不做 OIDC 流程，也不存在服务凭证面。公开读取（`listResources`/`listAuthorResources`/`downloadResourceVersion`/`previewResourceVersion` 与默认匿名 `getResource`）绝不携带凭据头；`getResource({ authenticated: true })` 显式切换为持 `resource:read` 的属主私有视图。
- **传输**：注入 `fetch` 实现与 `baseUrl`（必填，无默认值）；`AbortSignal` 与可配置超时（默认 10 秒）；有界重试（默认 ≤2 次，硬上限 4；5xx/网络错误）。Community 全部 12 个操作按契约幂等：5 个 GET 天然幂等，7 个命令全部声明必填 `Idempotency-Key`（8..200 字符）且同键同请求重放返回原始响应——重试原样重发同一请求（含同一键），**绝不换键**；同键异请求由生产者以 409 `IDEMPOTENCY_KEY_CONFLICT` 拒绝。
- **上传流**：`createUploadSession` 返回签名 PUT URL 与必须逐字回放的 `upload_headers`；SDK 本身不执行 S3 PUT（也不发明重试），调用方按契约自行上传原始字节；`completeUploadSession` 无请求体（不携带 Content-Type），生产者重读真实字节做大小/SHA-256/64×64 PNG 校验后封存；上传上限锁定 1 MiB，SDK 先验拒绝。
- **发布语义**：`createResourceVersion`/`publishResource` 的 202 只是受理，不是放行；审核缺位/超时/失败保持 `pending_moderation`（Q-009 决议=本地人工审核，运行镜像 manual，无决定仍待审）；`unpublishResource` 为终态（204 无体，SDK 返回 void 不解析），同键重放与属主重复请求均 204，不产生重复审计/清理。
- **分页**：不透明 HMAC 游标只透传生产者返回的 `next_cursor`（SDK 从不发明或改写游标）；游标绑定资源类型/作者过滤，跨面伪造由生产者 400 `VALIDATION_FAILED` 拒绝；`limit` 客户端先验 1..100。
- **错误**：`application/problem+json` 解析为 `McPlanProblemError`（`problem.code` 含 Community 锁定的 11 个稳定错误码联合类型、`trace_id`、可选 `errors[]`）；非 Problem 形状的错误响应抛 `McPlanUnexpectedResponseError`。
- **版本与发布**：版本随契约预发布（`0.1.0-alpha.4`）；本包 private，仅经 `pnpm pack` 本地消费，不发布 npm、不设稳定版本；已验证组合记录在 `docs/compatibility.md`（producer 验收与 SDK/consumer 验收分栏；SDK 通过不等于任何消费者已集成）。

## 使用

```ts
import { createMcPlanCommunityClient, generateIdempotencyKey } from '@mc-plan/community-sdk';

const client = createMcPlanCommunityClient({
  baseUrl: 'https://community.example.com',
  getUserToken: async () => oidcAccessToken, // PKCE flow owned by the app; dual-audience token
});

const resource = await client.createResource(
  { type: 'skin', title: 'Snow Explorer', description: 'Made with the SDK' },
  generateIdempotencyKey(), // keep stable across retries of the same logical command
);
const session = await client.createUploadSession(
  { purpose: 'resource_primary', media_type: 'image/png', size_bytes: bytes.length, sha256 },
  generateIdempotencyKey(),
);
// The caller performs the binary PUT to session.upload_url with
// session.upload_headers verbatim (the SDK never talks to object storage).
const completed = await client.completeUploadSession(session.upload_id, generateIdempotencyKey());
const version = await client.createResourceVersion(
  resource.resource_id,
  {
    upload_id: completed.upload_id,
    version: '1',
    schema_version: 1,
    metadata: { edition: 'java', width: 64, height: 64, arm_model: 'steve', second_layer: true },
    license_id,
  },
  generateIdempotencyKey(),
);
await client.publishResource(resource.resource_id, generateIdempotencyKey()); // 202 = accepted

const page = await client.listAuthorResources(resource.owner_user_id, { limit: 20 });
const detail = await client.getResource(resource.resource_id); // anonymous published read
const file = await client.downloadResourceVersion(
  detail.resource.resource_id,
  detail.versions[0]!.version_id,
); // bytes hash to detail.versions[0].files[0].sha256
```

## 本包验收命令（见仓库 docs/development-plan.md）

```sh
pnpm --dir sdk/community format:check
pnpm --dir sdk/community lint
pnpm --dir sdk/community typecheck
pnpm --dir sdk/community generate:check
pnpm --dir sdk/community test
pnpm --dir sdk/community build
pnpm --dir sdk/community pack:check
pnpm --dir sdk/community smoke:real   # 固定镜像 + 隔离 PostgreSQL/Core/S3 协议服务的真实 HTTP 验收
```

Python SDK 在出现明确第三方需求前不启动（见 `docs/sdk.md`）。

审核调用必须注入指定审核员的 `moderation:review` + `profile:read` 令牌，作者写令牌不可代替。reviewResourceVersion 的 approve/reject 和可选 1–1000 字原因只针对指定当前待审候选；同键不同决定/目标冲突，不能翻转既有决定，下架终态。真实 smoke 使用授权 review API 让合成内容公开，不再通过 SQL 改决定。

MCP-F2-COMMUNITY-003：Community producer来源锁与夹具升级至Corealpha.8（ebb00a6）；12操作/alpha.4契约不变。当前smoke使用Community镜像mcp-f2-community-003-d482331与Core镜像mcp-f2-core-001-fb1bc07，producer锚d482331，明确独立Core API消费组合。
